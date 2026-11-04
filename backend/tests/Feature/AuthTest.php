<?php

namespace Tests\Feature;

use App\Models\OtpVerification;
use App\Models\Role;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use DatabaseTransactions;

    private const PW = 'Passw0rdX';

    private function user(array $o = []): User
    {
        return User::factory()->create($o + ['role_id' => Role::where('name', 'customer')->value('id'), 'password' => self::PW, 'email_verified_at' => now()]);
    }

    /** Last 6-digit code from the in-memory mail transport (the OTP mail is raw HTML, not a Mailable). */
    private function lastOtp(): string
    {
        $messages = app('mailer')->getSymfonyTransport()->messages();
        $this->assertNotEmpty($messages, 'no mail was sent');
        preg_match('/letter-spacing:3px">(\d{6})</', $messages->last()->getOriginalMessage()->getHtmlBody(), $m);

        return $m[1] ?? $this->fail('no OTP found in the last mail');
    }

    // ---------- registration ----------

    public function test_registration_validates_and_creates_an_unverified_customer(): void
    {
        $base = ['name' => 'New Person', 'email' => 'new.person@example.test', 'password' => self::PW, 'password_confirmation' => self::PW];
        foreach ([['password' => 'short', 'password_confirmation' => 'short'], ['password' => 'alllowercase1', 'password_confirmation' => 'alllowercase1'], ['password_confirmation' => 'Different1X'], ['email' => 'not-an-email'], ['name' => '']] as $bad) {
            $this->postJson('/api/auth/register', array_merge($base, $bad))->assertStatus(422);
        }
        $r = $this->postJson('/api/auth/register', $base)->assertCreated();
        $this->assertSame('customer', $r->json('data.user.role'));
        $this->assertFalse($r->json('data.user.email_verified'));
        $this->assertNotSame(self::PW, User::where('email', $base['email'])->value('password'), 'password is hashed');
        $this->postJson('/api/auth/register', $base)->assertStatus(422)->assertJsonValidationErrors('email');
    }

    // ---------- login / logout ----------

    public function test_login_logout_and_token_revocation(): void
    {
        $u = $this->user();
        RateLimiter::clear('login:'.strtolower($u->email).'|127.0.0.1');
        $token = $this->postJson('/api/auth/login', ['email' => $u->email, 'password' => self::PW])->assertOk()->json('data.token');
        $this->withToken($token)->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.email', $u->email);
        $this->withToken($token)->postJson('/api/auth/logout')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_deactivated_accounts_cannot_log_in(): void
    {
        $u = $this->user(['is_active' => false]);
        $this->postJson('/api/auth/login', ['email' => $u->email, 'password' => self::PW])->assertForbidden();
    }

    // ---------- MFA ----------

    public function test_mfa_can_only_be_changed_with_the_password(): void
    {
        $u = $this->user();
        $this->actingAs($u, 'sanctum')->patchJson('/api/auth/mfa', ['enabled' => true, 'password' => 'wrong'])->assertStatus(422);
        $this->assertFalse($u->fresh()->mfa_enabled);
        $this->actingAs($u, 'sanctum')->patchJson('/api/auth/mfa', ['enabled' => true, 'password' => self::PW])->assertOk();
        $this->assertTrue($u->fresh()->mfa_enabled);
    }

    public function test_mfa_login_requires_the_emailed_code_which_is_single_use(): void
    {
        $u = $this->user(['mfa_enabled' => true]);
        RateLimiter::clear('login:'.strtolower($u->email).'|127.0.0.1');
        $r = $this->postJson('/api/auth/login', ['email' => $u->email, 'password' => self::PW])->assertOk();
        $this->assertTrue($r->json('data.mfa_required'));
        $this->assertArrayNotHasKey('token', $r->json('data'), 'no token before the code is verified');

        $code = $this->lastOtp();
        $this->assertNotSame(self::PW, OtpVerification::where('user_id', $u->id)->value('code_hash'), 'code is stored hashed');
        $this->postJson('/api/auth/mfa/verify', ['email' => $u->email, 'code' => $code === '000000' ? '111111' : '000000'])->assertStatus(422);
        $ok = $this->postJson('/api/auth/mfa/verify', ['email' => $u->email, 'code' => $code])->assertOk();
        $this->assertNotEmpty($ok->json('data.token'));
        $this->postJson('/api/auth/mfa/verify', ['email' => $u->email, 'code' => $code])->assertStatus(422); // replay
    }

    public function test_mfa_code_expires_locks_after_five_wrong_tries_and_resend_is_throttled(): void
    {
        $u = $this->user(['mfa_enabled' => true]);
        RateLimiter::clear('login:'.strtolower($u->email).'|127.0.0.1');
        $this->postJson('/api/auth/login', ['email' => $u->email, 'password' => self::PW])->assertOk();
        $code = $this->lastOtp();
        $wrong = $code === '999999' ? '888888' : '999999';

        $this->postJson('/api/auth/mfa/resend', ['email' => $u->email])->assertStatus(429); // inside the 60s cooldown
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/mfa/verify', ['email' => $u->email, 'code' => $wrong])->assertStatus(422);
        }
        $this->postJson('/api/auth/mfa/verify', ['email' => $u->email, 'code' => $code])->assertStatus(429); // locked even for the right code

        $this->travel(61)->seconds();
        $this->postJson('/api/auth/mfa/resend', ['email' => $u->email])->assertOk();
        $fresh = $this->lastOtp();
        $this->travel(11)->minutes();
        $this->postJson('/api/auth/mfa/verify', ['email' => $u->email, 'code' => $fresh])->assertStatus(422)->assertJsonPath('message', 'Code expired. Request a new one.');
    }

    // ---------- email verification ----------

    public function test_email_verification_link_is_signed_and_expires(): void
    {
        $u = $this->user(['email_verified_at' => null]);
        $good = URL::temporarySignedRoute('verification.verify', now()->addHour(), ['id' => $u->id, 'hash' => sha1($u->email)]);

        $this->get($good.'x')->assertStatus(403);
        $this->assertNull($u->fresh()->email_verified_at, 'tampered signature');
        $this->get(URL::temporarySignedRoute('verification.verify', now()->addHour(), ['id' => $u->id, 'hash' => 'deadbeef']))->assertRedirect(config('app.frontend_url').'/login?verified=0');
        $this->assertNull($u->fresh()->email_verified_at, 'wrong hash');

        $this->get($good)->assertRedirect(config('app.frontend_url').'/login?verified=1');
        $this->assertNotNull($u->fresh()->email_verified_at);

        $other = $this->user(['email_verified_at' => null]);
        $old = URL::temporarySignedRoute('verification.verify', now()->addMinutes(5), ['id' => $other->id, 'hash' => sha1($other->email)]);
        $this->travel(10)->minutes();
        $this->get($old)->assertStatus(403); // expired signature is rejected by the `signed` middleware
        $this->assertNull($other->fresh()->email_verified_at);
    }

    // ---------- password reset ----------

    public function test_password_reset_flow_revokes_sessions_and_tokens_are_single_use(): void
    {
        Notification::fake();
        $u = $this->user();
        $session = $u->createToken('old')->plainTextToken;

        $this->postJson('/api/auth/forgot-password', ['email' => $u->email])->assertOk();
        $this->postJson('/api/auth/forgot-password', ['email' => 'ghost@example.test'])->assertOk(); // same answer: no enumeration
        $token = null;
        Notification::assertSentTo($u, ResetPassword::class, function ($n) use (&$token) { $token = $n->token; return true; });

        $new = ['token' => $token, 'email' => $u->email, 'password' => 'BrandNew1pw', 'password_confirmation' => 'BrandNew1pw'];
        $this->postJson('/api/auth/reset-password', ['token' => 'bad'] + $new)->assertStatus(422);
        $this->postJson('/api/auth/reset-password', ['password' => 'weak', 'password_confirmation' => 'weak'] + $new)->assertStatus(422);
        $this->postJson('/api/auth/reset-password', $new)->assertOk();
        $this->assertTrue(Hash::check('BrandNew1pw', $u->fresh()->password));
        $this->assertSame(0, $u->tokens()->count(), 'every existing session is revoked');
        $this->app['auth']->forgetGuards();
        $this->withToken($session)->getJson('/api/auth/me')->assertUnauthorized();
        $this->postJson('/api/auth/reset-password', $new)->assertStatus(422); // token already used
    }

    // ---------- user management (admin) ----------

    public function test_admin_can_manage_users_but_not_deactivate_themselves(): void
    {
        $admin = User::where('email', 'admin@example.com')->first();
        $u = $this->user();
        $tok = $u->createToken('x')->plainTextToken;

        $this->actingAs($admin, 'sanctum')->getJson('/api/admin/users?search='.urlencode($u->email))->assertOk()->assertJsonPath('data.data.0.email', $u->email);
        $this->actingAs($admin, 'sanctum')->patchJson("/api/admin/users/{$admin->id}", ['is_active' => false])->assertStatus(422);
        $this->actingAs($admin, 'sanctum')->patchJson("/api/admin/users/{$u->id}", ['mfa_enabled' => true])->assertOk();
        $this->assertTrue($u->fresh()->mfa_enabled, 'MFA is admin-configurable');
        $this->actingAs($admin, 'sanctum')->patchJson("/api/admin/users/{$u->id}", ['is_active' => false])->assertOk();
        $this->assertSame(0, $u->tokens()->count(), 'deactivation signs the user out everywhere');
        $this->actingAs($admin, 'sanctum')->patchJson("/api/admin/users/{$u->id}", ['role_id' => 1, 'password' => 'x'])->assertOk();
        $this->assertSame('customer', $u->fresh()->role->name, 'role cannot be changed through this endpoint');
    }
}
