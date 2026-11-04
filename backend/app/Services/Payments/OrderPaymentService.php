<?php

namespace App\Services\Payments;

use App\Models\Payment;
use App\Models\Product;
use App\Models\ProductOrder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** The only place that moves an order to paid/failed/refunded. Idempotent and amount-verified. */
class OrderPaymentService
{
    /** @return 'paid'|'already_paid'|'mismatch'|'ignored' */
    public function markPaid(int $paymentId, string $transactionId, string $amount, string $currency, array $payload = []): string
    {
        return DB::transaction(function () use ($paymentId, $transactionId, $amount, $currency, $payload) {
            $payment = Payment::whereKey($paymentId)->lockForUpdate()->firstOrFail();
            $order = ProductOrder::whereKey($payment->order_id)->lockForUpdate()->firstOrFail();

            if ($payment->status === 'succeeded') {
                return 'already_paid'; // duplicate webhook / double confirm
            }
            if ($order->status === 'paid') {
                // A second payment succeeded for an already-paid order: record it, flag for refund.
                $payment->update(['status' => 'succeeded', 'provider_transaction_id' => $transactionId, 'raw_payload' => $payload]);
                $order->update(['payment_note' => 'Duplicate payment received (payment #'.$payment->id.'); refund required.']);
                Log::warning('Duplicate payment for paid order', ['order' => $order->id, 'payment' => $payment->id]);

                return 'already_paid';
            }

            // Never trust the gateway message blindly: amount and currency must match what we charged.
            $paid = self::cents($amount);
            if ($paid !== self::cents($payment->amount) || $paid !== self::cents($order->total)
                || strtoupper($payment->currency) !== strtoupper($currency)) {
                $payment->update(['status' => 'failed', 'provider_transaction_id' => $transactionId, 'raw_payload' => $payload]);
                $order->update(['payment_note' => "Amount/currency mismatch: got {$amount} {$currency}, expected {$order->total} {$order->currency}."]);
                Log::error('Payment amount mismatch', ['order' => $order->id, 'got' => "$amount $currency"]);

                return 'mismatch';
            }

            $payment->update(['status' => 'succeeded', 'provider_transaction_id' => $transactionId, 'raw_payload' => $payload]);
            $order->update(['status' => 'paid', 'paid_at' => now(), 'payment_note' => null]);

            foreach ($order->items as $item) {
                if ($item->product_id) {
                    // Guarded decrement; never goes negative. Money is already taken, so we don't fail the order.
                    Product::whereKey($item->product_id)->where('stock', '>=', $item->quantity)->decrement('stock', $item->quantity);
                }
            }

            return 'paid';
        });
    }

    /** Money as integer cents; avoids float drift and the bcmath dependency. */
    public static function cents(string|int|float $v): int
    {
        return (int) round(((float) $v) * 100);
    }

    /** @param bool $failOrder false when the customer never reached the gateway (session creation error): keep the order retryable as 'pending' */
    public function markFailed(int $paymentId, array $payload = [], bool $failOrder = true): void
    {
        DB::transaction(function () use ($paymentId, $payload, $failOrder) {
            $payment = Payment::whereKey($paymentId)->lockForUpdate()->first();
            if (! $payment || $payment->status !== 'pending') {
                return; // never downgrade a succeeded payment
            }
            $payment->update(['status' => 'failed', 'raw_payload' => $payload]);
            if (! $failOrder) {
                return;
            }
            $order = ProductOrder::whereKey($payment->order_id)->lockForUpdate()->first();
            // The order stays retryable (pending) unless every attempt failed and it was never paid.
            if ($order && $order->status === 'pending' && ! $order->payments()->whereIn('status', ['pending', 'succeeded'])->exists()) {
                $order->update(['status' => 'failed']);
            }
        });
    }

    public function markRefunded(int $paymentId, array $payload = []): void
    {
        DB::transaction(function () use ($paymentId, $payload) {
            $payment = Payment::whereKey($paymentId)->lockForUpdate()->first();
            if (! $payment || $payment->status !== 'succeeded') {
                return;
            }
            $payment->update(['status' => 'refunded', 'raw_payload' => $payload]);
            ProductOrder::whereKey($payment->order_id)->update(['status' => 'refunded']);
        });
    }
}
