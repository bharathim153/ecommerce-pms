<?php

namespace App\Services\Payments;

use App\Models\Setting;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Schema;

/**
 * Resolves gateway configuration: admin-saved value (secrets stored encrypted) wins, env is the fallback.
 * Secrets are never returned to the frontend; only a masked hint is.
 */
class PaymentSettings
{
    /** key => [config path, is_secret] */
    public const FIELDS = [
        'currency' => ['currency', false],
        'stripe_enabled' => ['stripe.enabled', false],
        'stripe_secret_key' => ['stripe.secret_key', true],
        'stripe_webhook_secret' => ['stripe.webhook_secret', true],
        'paypal_enabled' => ['paypal.enabled', false],
        'paypal_mode' => ['paypal.mode', false],
        'paypal_client_id' => ['paypal.client_id', false],
        'paypal_client_secret' => ['paypal.client_secret', true],
        'paypal_webhook_id' => ['paypal.webhook_id', false],
    ];

    private ?array $db = null;

    public function get(string $key): mixed
    {
        [$path, $secret] = self::FIELDS[$key];
        $row = $this->rows()[$key] ?? null;
        if ($row !== null && $row['value'] !== null && $row['value'] !== '') {
            return $secret ? $this->decrypt($row['value']) : $row['value'];
        }

        return config('services.payments.'.$path);
    }

    public function enabled(string $gateway): bool
    {
        $flag = $this->get($gateway.'_enabled');
        $on = filter_var($flag, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? true;

        return $on && $this->configured($gateway);
    }

    public function configured(string $gateway): bool
    {
        return match ($gateway) {
            'stripe' => (bool) $this->get('stripe_secret_key'),
            'paypal' => $this->get('paypal_client_id') && $this->get('paypal_client_secret'),
            default => false,
        };
    }

    public function currency(): string
    {
        return strtoupper((string) ($this->get('currency') ?: 'USD'));
    }

    public function set(string $key, ?string $value): void
    {
        [, $secret] = self::FIELDS[$key];
        Setting::updateOrCreate(['key' => $key], [
            'value' => ($secret && $value !== null && $value !== '') ? Crypt::encryptString($value) : $value,
            'is_secret' => $secret,
        ]);
        $this->db = null;
    }

    /** Safe view for the admin UI. */
    public function publicView(): array
    {
        $out = [];
        foreach (self::FIELDS as $key => [, $secret]) {
            $v = $this->get($key);
            $source = isset(($this->rows())[$key]) && ($this->rows()[$key]['value'] ?? '') !== '' ? 'admin' : (($v !== null && $v !== '') ? 'env' : 'unset');
            $out[$key] = $secret
                ? ['set' => (bool) $v, 'hint' => $v ? '••••'.substr((string) $v, -4) : null, 'source' => $source]
                : ['value' => is_bool($v) ? $v : $v, 'source' => $source];
        }
        $out['stripe_status'] = ['configured' => $this->configured('stripe'), 'enabled' => $this->enabled('stripe')];
        $out['paypal_status'] = ['configured' => $this->configured('paypal'), 'enabled' => $this->enabled('paypal')];

        return $out;
    }

    private function rows(): array
    {
        if ($this->db !== null) {
            return $this->db;
        }
        if (! Schema::hasTable('settings')) {
            return $this->db = [];
        }

        return $this->db = Setting::all()->mapWithKeys(fn ($s) => [$s->key => ['value' => $s->value]])->all();
    }

    private function decrypt(string $v): ?string
    {
        try {
            return Crypt::decryptString($v);
        } catch (\Throwable) {
            return null; // APP_KEY rotated: treat as unset rather than crash checkout
        }
    }
}
