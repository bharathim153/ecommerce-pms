<?php

namespace App\Services;

use App\Models\OtpVerification;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

class OtpService
{
    public const TTL_MINUTES = 10;
    public const RESEND_COOLDOWN_SECONDS = 60;
    public const MAX_ATTEMPTS = 5;

    /** @return bool false when the resend cooldown is still active */
    public function send(User $user, string $purpose = 'login'): bool
    {
        $last = OtpVerification::where('user_id', $user->id)->where('purpose', $purpose)
            ->whereNull('consumed_at')->latest('id')->first();

        if ($last && $last->last_sent_at && $last->last_sent_at->diffInSeconds(now(), true) < self::RESEND_COOLDOWN_SECONDS) {
            return false;
        }

        // invalidate older codes
        OtpVerification::where('user_id', $user->id)->where('purpose', $purpose)
            ->whereNull('consumed_at')->update(['consumed_at' => now()]);

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        OtpVerification::create([
            'user_id' => $user->id,
            'purpose' => $purpose,
            'code_hash' => Hash::make($code),
            'expires_at' => now()->addMinutes(self::TTL_MINUTES),
            'last_sent_at' => now(),
        ]);

        $minutes = self::TTL_MINUTES;
        Mail::html(
            "<p>Hello {$this->e($user->name)},</p><p>Your verification code is <strong style=\"font-size:20px;letter-spacing:3px\">{$code}</strong>.</p><p>It expires in {$minutes} minutes. If you did not request it, ignore this email.</p>",
            fn ($m) => $m->to($user->email)->subject('Your verification code')
        );

        return true;
    }

    /** @return 'ok'|'invalid'|'expired'|'locked'|'none' */
    public function verify(User $user, string $code, string $purpose = 'login'): string
    {
        $otp = OtpVerification::where('user_id', $user->id)->where('purpose', $purpose)
            ->whereNull('consumed_at')->latest('id')->first();

        if (! $otp) return 'none';
        if ($otp->expires_at->isPast()) return 'expired';
        if ($otp->attempts >= self::MAX_ATTEMPTS) return 'locked';

        if (! Hash::check($code, $otp->code_hash)) {
            $otp->increment('attempts');
            return 'invalid';
        }

        $otp->update(['consumed_at' => now()]);
        return 'ok';
    }

    private function e(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    }
}
