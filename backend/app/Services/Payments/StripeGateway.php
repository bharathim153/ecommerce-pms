<?php

namespace App\Services\Payments;

use App\Models\Payment;
use App\Models\ProductOrder;
use Stripe\Exception\SignatureVerificationException;
use Stripe\StripeClient;
use Stripe\Webhook;
use UnexpectedValueException;

class StripeGateway
{
    public function __construct(private PaymentSettings $settings, private OrderPaymentService $orders) {}

    private function client(): StripeClient
    {
        $cfg = ['api_key' => $this->settings->get('stripe_secret_key')];
        if ($base = config('services.payments.stripe.api_base')) {
            $cfg['api_base'] = $base;
        }

        return new StripeClient($cfg);
    }

    /** Creates a hosted Checkout Session; the browser is redirected to Stripe, card data never touches us. */
    public function createCheckout(ProductOrder $order, string $successUrl, string $cancelUrl): array
    {
        $payment = $order->payments()->create([
            'provider' => 'stripe', 'amount' => $order->total, 'currency' => $order->currency, 'status' => 'pending',
        ]);

        $lines = $order->items->map(fn ($i) => [
            'quantity' => $i->quantity,
            'price_data' => [
                'currency' => strtolower($order->currency),
                'unit_amount' => (int) round($i->unit_price * 100),
                'product_data' => ['name' => mb_substr($i->product_name, 0, 250)],
            ],
        ])->all();

        try {
            $session = $this->client()->checkout->sessions->create([
            'mode' => 'payment',
            'line_items' => $lines,
            'client_reference_id' => (string) $order->id,
            'metadata' => ['order_id' => (string) $order->id, 'payment_id' => (string) $payment->id],
            'payment_intent_data' => ['metadata' => ['order_id' => (string) $order->id, 'payment_id' => (string) $payment->id]],
            'customer_email' => $order->user->email,
            'success_url' => $successUrl,
            'cancel_url' => $cancelUrl,
        ], ['idempotency_key' => 'order-'.$order->id.'-payment-'.$payment->id]);
        } catch (\Throwable $e) {
            $this->orders->markFailed($payment->id, ['error' => mb_substr($e->getMessage(), 0, 300)], failOrder: false);

            throw $e;
        }

        $payment->update(['provider_reference' => $session->id]);

        return ['payment_id' => $payment->id, 'session_id' => $session->id, 'url' => $session->url];
    }

    /** Server-side re-check of a session (used by the success page; the browser's claim is never trusted). */
    public function syncSession(Payment $payment): string
    {
        $session = $this->client()->checkout->sessions->retrieve($payment->provider_reference, ['expand' => ['payment_intent']]);

        return $this->applySession($payment, $session);
    }

    /** @return string event outcome, for logging/tests */
    public function handleWebhook(string $payload, ?string $signature): string
    {
        $secret = $this->settings->get('stripe_webhook_secret');
        if (! $secret) {
            throw new UnexpectedValueException('Stripe webhook secret is not configured.');
        }
        // Throws on bad signature / stale timestamp (5 min tolerance by default).
        $event = Webhook::constructEvent($payload, (string) $signature, $secret);

        $first = \App\Models\WebhookEvent::firstOrCreate(['provider' => 'stripe', 'event_id' => $event->id], ['type' => $event->type]);
        if (! $first->wasRecentlyCreated && $first->processed_at) {
            return 'duplicate';
        }

        $obj = $event->data->object;
        $result = match ($event->type) {
            'checkout.session.completed', 'checkout.session.async_payment_succeeded' => $this->onSession($obj),
            'checkout.session.expired', 'checkout.session.async_payment_failed' => $this->onSessionFailed($obj),
            'payment_intent.payment_failed' => $this->onIntentFailed($obj),
            'charge.refunded' => $this->onRefund($obj),
            default => 'ignored',
        };

        $first->update(['processed_at' => now()]);

        return $result;
    }

    private function onSession($session): string
    {
        $payment = Payment::where('provider', 'stripe')->where('provider_reference', $session->id)->first();

        return $payment ? $this->applySession($payment, $session) : 'unknown_payment';
    }

    private function applySession(Payment $payment, $session): string
    {
        if ($session->payment_status !== 'paid') {
            return 'not_paid';
        }
        $intent = is_object($session->payment_intent ?? null) ? $session->payment_intent->id : ($session->payment_intent ?? $session->id);

        return $this->orders->markPaid(
            $payment->id,
            (string) $intent,
            number_format($session->amount_total / 100, 2, '.', ''),
            strtoupper($session->currency),
            ['session' => $session->id, 'payment_status' => $session->payment_status],
        );
    }

    private function onSessionFailed($session): string
    {
        $payment = Payment::where('provider', 'stripe')->where('provider_reference', $session->id)->first();
        if ($payment) {
            $this->orders->markFailed($payment->id, ['session' => $session->id]);
        }

        return 'failed';
    }

    private function onIntentFailed($intent): string
    {
        $paymentId = $intent->metadata['payment_id'] ?? null;
        if ($paymentId) {
            // A failed attempt inside Checkout can still be retried by the customer in the same session, so
            // we only record it; the session expiry (or success) decides the final state.
            Payment::whereKey($paymentId)->where('status', 'pending')->update(['raw_payload' => ['last_error' => $intent->last_payment_error->message ?? 'payment failed']]);
        }

        return 'attempt_failed';
    }

    private function onRefund($charge): string
    {
        $intentId = $charge->payment_intent ?? null;
        $payment = $intentId ? Payment::where('provider', 'stripe')->where('provider_transaction_id', $intentId)->first() : null;
        if ($payment && $charge->refunded) {
            $this->orders->markRefunded($payment->id, ['charge' => $charge->id]);
        }

        return 'refunded';
    }

    public static function isSignatureError(\Throwable $e): bool
    {
        return $e instanceof SignatureVerificationException || $e instanceof UnexpectedValueException;
    }
}
