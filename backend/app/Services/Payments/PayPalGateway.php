<?php

namespace App\Services\Payments;

use App\Models\Payment;
use App\Models\ProductOrder;
use App\Models\WebhookEvent;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class PayPalGateway
{
    public function __construct(private PaymentSettings $settings, private OrderPaymentService $orders) {}

    private function base(): string
    {
        return $this->settings->get('paypal_mode') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    }

    private function token(): string
    {
        $cacheKey = 'paypal_token_'.md5($this->base().$this->settings->get('paypal_client_id'));

        return Cache::remember($cacheKey, 300, function () {
            $res = Http::asForm()->withBasicAuth((string) $this->settings->get('paypal_client_id'), (string) $this->settings->get('paypal_client_secret'))
                ->timeout(20)->post($this->base().'/v1/oauth2/token', ['grant_type' => 'client_credentials']);
            if (! $res->successful() || ! $res->json('access_token')) {
                throw new RuntimeException('PayPal authentication failed.');
            }

            return $res->json('access_token');
        });
    }

    private function api(): PendingRequest
    {
        return Http::withToken($this->token())->acceptJson()->timeout(30);
    }

    public function createOrder(ProductOrder $order, string $returnUrl, string $cancelUrl): array
    {
        $payment = $order->payments()->create([
            'provider' => 'paypal', 'amount' => $order->total, 'currency' => $order->currency, 'status' => 'pending',
        ]);

        try {
            $res = $this->api()->withHeaders(['PayPal-Request-Id' => 'create-'.$payment->id])->post($this->base().'/v2/checkout/orders', [
            'intent' => 'CAPTURE',
            'purchase_units' => [[
                'reference_id' => $order->number,
                'custom_id' => (string) $order->id,
                'description' => 'Order '.$order->number,
                'amount' => ['currency_code' => $order->currency, 'value' => number_format((float) $order->total, 2, '.', '')],
            ]],
            'payment_source' => ['paypal' => ['experience_context' => [
                'return_url' => $returnUrl, 'cancel_url' => $cancelUrl, 'user_action' => 'PAY_NOW', 'shipping_preference' => 'NO_SHIPPING',
            ]]],
        ]);
        } catch (\Throwable $e) {
            $this->orders->markFailed($payment->id, ['error' => mb_substr($e->getMessage(), 0, 300)], failOrder: false);

            throw $e;
        }

        if (! $res->successful()) {
            $this->orders->markFailed($payment->id, ['error' => $res->json()], failOrder: false);
            throw new RuntimeException('PayPal could not create the order.');
        }

        $approve = collect($res->json('links', []))->first(fn ($l) => in_array($l['rel'], ['payer-action', 'approve'], true))['href'] ?? null;
        $payment->update(['provider_reference' => $res->json('id')]);

        return ['payment_id' => $payment->id, 'paypal_order_id' => $res->json('id'), 'approve_url' => $approve];
    }

    /** Capture after buyer approval. The paypal order id must belong to a pending payment of THIS order. */
    public function capture(ProductOrder $order, string $paypalOrderId): string
    {
        $payment = $order->payments()->where('provider', 'paypal')->where('provider_reference', $paypalOrderId)->first();
        if (! $payment) {
            return 'unknown_payment';
        }
        if ($payment->status === 'succeeded') {
            return 'already_paid';
        }

        $res = $this->api()->withHeaders(['PayPal-Request-Id' => 'capture-'.$payment->id])
            ->withBody('{}', 'application/json')->post($this->base().'/v2/checkout/orders/'.rawurlencode($paypalOrderId).'/capture');

        $body = $res->json() ?? [];
        // Already captured (e.g. webhook got there first): re-read the order instead of failing.
        if ($res->status() === 422 && ($body['details'][0]['issue'] ?? '') === 'ORDER_ALREADY_CAPTURED') {
            $res = $this->api()->get($this->base().'/v2/checkout/orders/'.rawurlencode($paypalOrderId));
            $body = $res->json() ?? [];
        } elseif (! $res->successful()) {
            $this->orders->markFailed($payment->id, ['error' => $body]);

            return 'failed';
        }

        $unit = $body['purchase_units'][0] ?? [];
        $cap = $unit['payments']['captures'][0] ?? null;

        if (($body['status'] ?? '') !== 'COMPLETED' || ! $cap || ($cap['status'] ?? '') !== 'COMPLETED') {
            return 'not_completed';
        }
        if (($unit['custom_id'] ?? $cap['custom_id'] ?? null) !== (string) $order->id) {
            return 'mismatch';
        }

        return $this->orders->markPaid($payment->id, $cap['id'], $cap['amount']['value'], $cap['amount']['currency_code'], ['paypal_order' => $paypalOrderId]);
    }

    /** Asks PayPal to verify the signature of a webhook delivery. */
    public function verifyWebhook(array $headers, string $rawBody): bool
    {
        $webhookId = $this->settings->get('paypal_webhook_id');
        $event = json_decode($rawBody, true);
        if (! $webhookId || ! is_array($event)) {
            return false;
        }
        $h = fn (string $k) => $headers[strtolower($k)][0] ?? $headers[strtolower($k)] ?? null;

        $res = $this->api()->post($this->base().'/v1/notifications/verify-webhook-signature', [
            'auth_algo' => $h('paypal-auth-algo'),
            'cert_url' => $h('paypal-cert-url'),
            'transmission_id' => $h('paypal-transmission-id'),
            'transmission_sig' => $h('paypal-transmission-sig'),
            'transmission_time' => $h('paypal-transmission-time'),
            'webhook_id' => $webhookId,
            'webhook_event' => $event,
        ]);

        return $res->successful() && $res->json('verification_status') === 'SUCCESS';
    }

    public function handleWebhook(array $event): string
    {
        $row = WebhookEvent::firstOrCreate(['provider' => 'paypal', 'event_id' => $event['id'] ?? ''], ['type' => $event['event_type'] ?? null]);
        if (! $row->wasRecentlyCreated && $row->processed_at) {
            return 'duplicate';
        }

        $res = $event['resource'] ?? [];
        $paypalOrderId = $res['supplementary_data']['related_ids']['order_id'] ?? null;
        $payment = $paypalOrderId ? Payment::where('provider', 'paypal')->where('provider_reference', $paypalOrderId)->first() : null;

        $result = 'ignored';
        if ($payment) {
            $result = match ($event['event_type'] ?? '') {
                'PAYMENT.CAPTURE.COMPLETED' => ($res['status'] ?? '') === 'COMPLETED'
                    ? $this->orders->markPaid($payment->id, $res['id'], $res['amount']['value'], $res['amount']['currency_code'], ['webhook' => $event['id']])
                    : 'not_completed',
                'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED' => tap('failed', fn () => $this->orders->markFailed($payment->id, ['webhook' => $event['id']])),
                'PAYMENT.CAPTURE.REFUNDED' => tap('refunded', fn () => $this->orders->markRefunded($payment->id, ['webhook' => $event['id']])),
                default => 'ignored',
            };
        }
        $row->update(['processed_at' => now()]);

        return $result;
    }
}
