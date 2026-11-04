<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Payments\PayPalGateway;
use App\Services\Payments\StripeGateway;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    public function stripe(Request $request, StripeGateway $stripe): JsonResponse
    {
        try {
            $result = $stripe->handleWebhook($request->getContent(), $request->header('Stripe-Signature'));
        } catch (\Throwable $e) {
            if (StripeGateway::isSignatureError($e)) {
                return $this->fail('Invalid signature.', 400);
            }
            Log::error('Stripe webhook processing failed', ['error' => $e->getMessage()]);

            return $this->fail('Processing error.', 500); // Stripe will retry
        }

        return $this->ok(['result' => $result]);
    }

    public function paypal(Request $request, PayPalGateway $paypal): JsonResponse
    {
        try {
            if (! $paypal->verifyWebhook($request->headers->all(), $request->getContent())) {
                return $this->fail('Invalid signature.', 400);
            }
            $result = $paypal->handleWebhook($request->json()->all());
        } catch (\Throwable $e) {
            Log::error('PayPal webhook processing failed', ['error' => $e->getMessage()]);

            return $this->fail('Processing error.', 500);
        }

        return $this->ok(['result' => $result]);
    }
}
