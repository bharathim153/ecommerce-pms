<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Api\Admin\SubscriberController;
use App\Models\EmailSubscriber;
use App\Models\Role;
use App\Models\User;
use App\Services\OtpService;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;

class AuthController extends Controller
{
    public function __construct(private OtpService $otp) {}

    public function register(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email:rfc', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', PasswordRule::min(8)->letters()->mixedCase()->numbers()],
            'marketing_opt_in' => ['sometimes', 'boolean'],
        ]);
        $optIn = (bool) ($data['marketing_opt_in'] ?? false); // explicit consent only; never pre-ticked
        unset($data['marketing_opt_in']);

        $user = User::create([
            ...$data,
            'role_id' => Role::where('name', 'customer')->value('id'),
        ]);

        $user->refresh();
        if ($optIn) {
            $this->setMarketing($user, true, 'signup');
        }
        $this->sendVerificationEmail($user);

        return $this->ok([
            'user' => $this->userPayload($user),
            'token' => $user->createToken('auth')->plainTextToken,
        ], 'Registered. Please verify your email.', 201);
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        // Brute-force guard per account+IP (the route-level throttle only limits per IP).
        $key = 'login:'.strtolower($data['email']).'|'.$request->ip();
        if (RateLimiter::tooManyAttempts($key, 5)) {
            return $this->fail('Too many sign-in attempts. Try again in '.RateLimiter::availableIn($key).' seconds.', 429);
        }

        $user = User::where('email', $data['email'])->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            RateLimiter::hit($key, 300);

            return $this->fail('Invalid credentials.', 401);
        }
        RateLimiter::clear($key);
        if (! $user->is_active) {
            return $this->fail('Account disabled.', 403);
        }

        if ($user->mfa_enabled) {
            $this->otp->send($user, 'login');
            return $this->ok(['mfa_required' => true, 'email' => $user->email], 'Verification code sent to your email.');
        }

        return $this->ok($this->session($user), 'Logged in.');
    }

    public function verifyMfa(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email'], 'code' => ['required', 'digits:6']]);

        $user = User::where('email', $data['email'])->where('is_active', true)->first();
        $result = $user ? $this->otp->verify($user, $data['code'], 'login') : 'none';

        return match ($result) {
            'ok' => $this->ok($this->session($user), 'Logged in.'),
            'expired' => $this->fail('Code expired. Request a new one.', 422),
            'locked' => $this->fail('Too many attempts. Request a new code.', 429),
            default => $this->fail('Invalid code.', 422),
        };
    }

    public function resendMfa(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);
        $user = User::where('email', $data['email'])->where('mfa_enabled', true)->where('is_active', true)->first();

        // Same response whether or not the account exists (no enumeration).
        if ($user && ! $this->otp->send($user, 'login')) {
            return $this->fail('Please wait before requesting another code.', 429);
        }

        return $this->ok(null, 'If the account exists, a new code was sent.');
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();
        return $this->ok(null, 'Logged out.');
    }

    public function me(Request $request): JsonResponse
    {
        return $this->ok($this->userPayload($request->user()));
    }

    public function updateMfa(Request $request): JsonResponse
    {
        $data = $request->validate(['enabled' => ['required', 'boolean'], 'password' => ['required', 'string']]);

        if (! Hash::check($data['password'], $request->user()->password)) {
            return $this->fail('Password is incorrect.', 422);
        }

        $request->user()->update(['mfa_enabled' => $data['enabled']]);
        return $this->ok($this->userPayload($request->user()->fresh()), 'MFA setting updated.');
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $d = $request->validate(['name' => ['required', 'string', 'max:255'], 'phone' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+()\-.\s]*$/']]);
        $request->user()->update($d);

        return $this->ok($this->userPayload($request->user()->fresh()), 'Profile updated.');
    }

    public function changePassword(Request $request): JsonResponse
    {
        $d = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'confirmed', 'different:current_password', PasswordRule::min(8)->letters()->mixedCase()->numbers()],
        ]);
        $user = $request->user();
        if (! Hash::check($d['current_password'], $user->password)) {
            return $this->fail('Your current password is incorrect.', 422, ['current_password' => 'Your current password is incorrect.']);
        }
        $user->update(['password' => $d['password']]);
        // Sign every other device out; keep this session.
        $user->tokens()->where('id', '!=', $user->currentAccessToken()->id)->delete();

        return $this->ok(null, 'Password changed. Other devices were signed out.');
    }

    public function marketing(Request $request): JsonResponse
    {
        $s = $this->subscriberFor($request->user());

        return $this->ok(['subscribed' => (bool) ($s?->is_subscribed && ! $s->bounced_at)]);
    }

    public function updateMarketing(Request $request): JsonResponse
    {
        $d = $request->validate(['subscribed' => ['required', 'boolean']]);
        $this->setMarketing($request->user(), $d['subscribed'], 'account');

        return $this->ok(['subscribed' => $d['subscribed']], $d['subscribed'] ? 'You will receive our emails.' : 'You have been unsubscribed.');
    }

    private function subscriberFor(User $user): ?EmailSubscriber
    {
        return EmailSubscriber::where('user_id', $user->id)->orWhere('email', strtolower($user->email))->first();
    }

    private function setMarketing(User $user, bool $on, string $source): void
    {
        $s = $this->subscriberFor($user);
        if (! $s) {
            if ($on) {
                SubscriberController::make(strtolower($user->email), $user->name, $source, $user->id);
            }

            return;
        }
        $s->forceFill(['user_id' => $user->id])->save();
        if ($on && ! $s->is_subscribed) {
            $s->update(['is_subscribed' => true, 'unsubscribed_at' => null, 'subscribed_at' => now()]);
        } elseif (! $on && $s->is_subscribed) {
            $s->update(['is_subscribed' => false, 'unsubscribed_at' => now()]);
        }
    }

    public function verifyEmail(Request $request, int $id, string $hash)
    {
        $frontend = rtrim(config('app.frontend_url'), '/');
        $user = User::find($id);

        if (! $request->hasValidSignature() || ! $user || ! hash_equals(sha1($user->email), $hash)) {
            return redirect("{$frontend}/login?verified=0");
        }

        if (! $user->email_verified_at) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        return redirect("{$frontend}/login?verified=1");
    }

    public function resendVerification(Request $request): JsonResponse
    {
        if ($request->user()->email_verified_at) {
            return $this->ok(null, 'Email already verified.');
        }
        $this->sendVerificationEmail($request->user());
        return $this->ok(null, 'Verification email sent.');
    }

    public function forgotPassword(Request $request): JsonResponse
    {
        $request->validate(['email' => ['required', 'email']]);
        Password::sendResetLink($request->only('email'));

        return $this->ok(null, 'If the email exists, a reset link was sent.');
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'email'],
            'password' => ['required', 'confirmed', PasswordRule::min(8)->letters()->mixedCase()->numbers()],
        ]);

        $status = Password::reset($data, function (User $user, string $password) {
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
            $user->tokens()->delete(); // revoke all sessions
            event(new PasswordReset($user));
        });

        return $status === Password::PASSWORD_RESET
            ? $this->ok(null, 'Password reset successfully.')
            : $this->fail('Invalid or expired reset token.', 422);
    }

    private function session(User $user): array
    {
        return ['user' => $this->userPayload($user), 'token' => $user->createToken('auth')->plainTextToken];
    }

    private function userPayload(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role?->name,
            'mfa_enabled' => $user->mfa_enabled,
            'email_verified' => (bool) $user->email_verified_at,
            'phone' => $user->phone,
        ];
    }

    private function sendVerificationEmail(User $user): void
    {
        $url = URL::temporarySignedRoute('verification.verify', now()->addHours(24), [
            'id' => $user->id, 'hash' => sha1($user->email),
        ]);
        $name = e($user->name);

        Mail::html(
            "<p>Hello {$name},</p><p>Please confirm your email address:</p><p><a href=\"{$url}\">Verify email</a></p>",
            fn ($m) => $m->to($user->email)->subject('Verify your email address')
        );
    }
}
