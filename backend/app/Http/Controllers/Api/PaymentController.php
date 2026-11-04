<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ProductOrder;
use App\Services\Payments\PayPalGateway;
use App\Services\Payments\PaymentSettings;
use App\Services\Payments\StripeGateway;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class PaymentController extends Controller
{
    public function __construct(private PaymentSettings $settings, private StripeGateway $stripe, private PayPalGateway $paypal) {}

    private function front(string $path): string
    {
        return rtrim(config('app.frontend_url'), '/').$path;
    }

    private function payable(Request $request, ProductOrder $order): ?JsonResponse
    {
        abort_unless($order->user_id === $request->user()->id, 404);
        if ($order->status === 'paid') {
            return $this->fail('This order is already paid.', 409);
        }
        if (! in_array($order->status, ['pending', 'failed'], true)) {
            return $this->fail('This order cannot be paid.', 409);
        }

        return null;
    }

    public function stripeCheckout(Request $request, ProductOrder $order): JsonResponse
    {
        if ($err = $this->payable($request, $order)) {
            return $err;
        }
        if (! $this->settings->enabled('stripe')) {
            return $this->fail('Card payments are not available right now.', 503);
        }

        try {
            $order->load('items', 'user')->update(['status' => 'pending']);
            $r = $this->stripe->createCheckout($order,
                $this->front('/checkout/success?order='.$order->id.'&provider=stripe'),
                $this->front('/checkout/failure?order='.$order->id.'&provider=stripe'));
        } catch (\Throwable $e) {
            Log::error('Stripe checkout creation failed', ['order' => $order->id, 'error' => $e->getMessage()]);

            return $this->fail('Could not start the card payment. Please try again.', 502);
        }

        return $this->ok(['url' => $r['url']], 'Redirect to Stripe.');
    }

    /** Success page calls this; it asks Stripe directly, so a forged redirect can't mark an order paid. */
    public function stripeConfirm(Request $request, ProductOrder $order): JsonResponse
    {
        abort_unless($order->user_id === $request->user()->id, 404);
        $payment = $order->payments()->where('provider', 'stripe')->whereNotNull('provider_reference')->latest('id')->first();

        if ($payment && $payment->status === 'pending' && $this->settings->configured('stripe')) {
            try {
                $this->stripe->syncSession($payment);
            } catch (\Throwable $e) {
                Log::error('Stripe confirm failed', ['order' => $order->id, 'error' => $e->getMessage()]);
            }
        }

        return $this->ok(OrderController::present($order->fresh(['items', 'payments'])));
    }

    public function paypalCreate(Request $request, ProductOrder $order): JsonResponse
    {
        if ($err = $this->payable($request, $order)) {
            return $err;
        }
        if (! $this->settings->enabled('paypal')) {
            return $this->fail('PayPal is not available right now.', 503);
        }

        try {
            $order->load('items')->update(['status' => 'pending']);
            $r = $this->paypal->createOrder($order,
                $this->front('/checkout/paypal-return?order='.$order->id),
                $this->front('/checkout/failure?order='.$order->id.'&provider=paypal'));
        } catch (\Throwable $e) {
            Log::error('PayPal create failed', ['order' => $order->id, 'error' => $e->getMessage()]);

            return $this->fail('Could not start the PayPal payment. Please try again.', 502);
        }

        return $this->ok(['approve_url' => $r['approve_url'], 'paypal_order_id' => $r['paypal_order_id']]);
    }

    public function paypalCapture(Request $request, ProductOrder $order): JsonResponse
    {
        abort_unless($order->user_id === $request->user()->id, 404);
        $data = $request->validate(['paypal_order_id' => ['required', 'string', 'max:64', 'regex:/^[A-Za-z0-9_-]+$/']]);

        try {
            $result = $this->paypal->capture($order, $data['paypal_order_id']);
        } catch (\Throwable $e) {
            Log::error('PayPal capture error', ['order' => $order->id, 'error' => $e->getMessage()]);

            return $this->fail('We could not confirm your PayPal payment. If you were charged, it will be reflected shortly.', 502);
        }

        $order = $order->fresh(['items', 'payments']);

        return in_array($result, ['paid', 'already_paid'], true)
            ? $this->ok(OrderController::present($order), 'Payment confirmed.')
            : $this->fail('Payment was not completed.', 402);
    }
}
