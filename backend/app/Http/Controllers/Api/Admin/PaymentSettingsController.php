<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\Payments\PaymentSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaymentSettingsController extends Controller
{
    public function show(PaymentSettings $s): JsonResponse
    {
        return $this->ok($s->publicView() + ['webhook_urls' => [
            'stripe' => url('/api/webhooks/stripe'),
            'paypal' => url('/api/webhooks/paypal'),
        ]]);
    }

    /** Blank secret fields mean "keep the current value". Send "__clear__" to remove an admin override. */
    public function update(Request $request, PaymentSettings $s): JsonResponse
    {
        $data = $request->validate([
            'currency' => ['sometimes', 'string', 'size:3', 'alpha'],
            'stripe_enabled' => ['sometimes', 'boolean'],
            'stripe_secret_key' => ['sometimes', 'nullable', 'string', 'max:255', 'regex:/^(sk|rk)_(test|live)_[A-Za-z0-9]+$|^__clear__$/'],
            'stripe_webhook_secret' => ['sometimes', 'nullable', 'string', 'max:255', 'regex:/^whsec_[A-Za-z0-9]+$|^__clear__$/'],
            'paypal_enabled' => ['sometimes', 'boolean'],
            'paypal_mode' => ['sometimes', 'in:sandbox,live'],
            'paypal_client_id' => ['sometimes', 'nullable', 'string', 'max:255'],
            'paypal_client_secret' => ['sometimes', 'nullable', 'string', 'max:255'],
            'paypal_webhook_id' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]);

        foreach ($data as $key => $value) {
            if (is_bool($value)) {
                $value = $value ? '1' : '0';
            }
            if ($value === null || $value === '') {
                if (! (PaymentSettings::FIELDS[$key][1] ?? false)) {
                    $s->set($key, null);
                }
                continue; // blank secret = unchanged
            }
            $s->set($key, $value === '__clear__' ? null : (string) ($key === 'currency' ? strtoupper($value) : $value));
        }

        return $this->ok($s->publicView(), 'Payment settings saved.');
    }
}
