<?php

namespace Tests\Feature;

use App\Models\Payment;
use App\Models\Product;
use App\Models\ProductOrder;
use App\Models\Role;
use App\Models\Setting;
use App\Models\User;
use App\Services\Payments\StripeGateway;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Runs against the dev MySQL database inside a transaction that is rolled back,
 * so no data is left behind. Gateways are faked; webhook signatures are real HMACs.
 */
class PaymentsTest extends TestCase
{
    use DatabaseTransactions;

    private const WHSEC = 'whsec_testsecret123';

    protected function setUp(): void
    {
        parent::setUp();
        Setting::query()->delete(); // inside the rolled-back transaction
        config([
            'services.payments.currency' => 'USD',
            'services.payments.stripe.secret_key' => 'sk_test_dummy',
            'services.payments.stripe.webhook_secret' => self::WHSEC,
            'services.payments.paypal.client_id' => 'cid',
            'services.payments.paypal.client_secret' => 'csecret',
            'services.payments.paypal.webhook_id' => 'WH-1',
            'services.payments.paypal.mode' => 'sandbox',
        ]);
    }

    private function customer(bool $verified = true): User
    {
        return User::factory()->create([
            'role_id' => Role::where('name', 'customer')->value('id'),
            'email_verified_at' => $verified ? now() : null,
        ]);
    }

    private function product(array $o = []): Product
    {
        static $n = 0;
        $n++;

        return Product::create($o + ['name' => "P$n", 'slug' => "p-$n-".uniqid(), 'sku' => "T-$n-".uniqid(), 'price' => 19.99, 'stock' => 10, 'status' => 'published']);
    }

    /** @return array{0: User, 1: ProductOrder, 2: Product} */
    private function pendingOrder(int $qty = 2): array
    {
        $u = $this->customer();
        $p = $this->product();
        $r = $this->actingAs($u, 'sanctum')->postJson('/api/orders', ['items' => [['product_id' => $p->id, 'quantity' => $qty]]])->assertCreated();

        return [$u, ProductOrder::find($r->json('data.id')), $p];
    }

    private function stripePayment(ProductOrder $o, string $session = 'cs_test_1'): Payment
    {
        return $o->payments()->create(['provider' => 'stripe', 'provider_reference' => $session, 'amount' => $o->total, 'currency' => 'USD', 'status' => 'pending']);
    }

    private function signed(array $event, ?string $secret = null, ?int $t = null): array
    {
        $body = json_encode($event);
        $t ??= time();
        $sig = hash_hmac('sha256', "$t.$body", $secret ?? self::WHSEC);

        return [$body, ['HTTP_STRIPE_SIGNATURE' => "t=$t,v1=$sig", 'CONTENT_TYPE' => 'application/json']];
    }

    private function completedEvent(string $id, string $session, int $cents, string $cur = 'usd'): array
    {
        return ['id' => $id, 'object' => 'event', 'type' => 'checkout.session.completed', 'data' => ['object' => [
            'id' => $session, 'object' => 'checkout.session', 'payment_status' => 'paid', 'amount_total' => $cents, 'currency' => $cur, 'payment_intent' => 'pi_'.$id,
        ]]];
    }

    private function postWebhook(string $body, array $server)
    {
        return $this->call('POST', '/api/webhooks/stripe', [], [], [], $server, $body);
    }

    // ---------- orders ----------

    public function test_order_total_is_computed_server_side_and_rejects_bad_items(): void
    {
        [$u, $o] = $this->pendingOrder(3);
        $this->assertSame('59.97', (string) $o->total);
        $this->assertSame('pending', $o->status);

        $draft = $this->product(['status' => 'draft']);
        $low = $this->product(['stock' => 1]);
        $this->actingAs($u, 'sanctum')->postJson('/api/orders', ['items' => [['product_id' => $draft->id, 'quantity' => 1]]])->assertStatus(422);
        $this->actingAs($u, 'sanctum')->postJson('/api/orders', ['items' => [['product_id' => $low->id, 'quantity' => 2]]])->assertStatus(422);
        $this->actingAs($u, 'sanctum')->postJson('/api/orders', ['items' => [['product_id' => $low->id, 'quantity' => 0]]])->assertStatus(422);
    }

    public function test_unverified_email_cannot_checkout_and_guests_are_rejected(): void
    {
        $p = $this->product();
        $this->actingAs($this->customer(false), 'sanctum')->postJson('/api/orders', ['items' => [['product_id' => $p->id, 'quantity' => 1]]])->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/orders', ['items' => [['product_id' => $p->id, 'quantity' => 1]]])->assertUnauthorized();
    }

    public function test_user_cannot_view_or_pay_someone_elses_order(): void
    {
        [, $o] = $this->pendingOrder();
        $other = $this->customer();
        $this->actingAs($other, 'sanctum')->getJson("/api/orders/{$o->id}")->assertNotFound();
        $this->actingAs($other, 'sanctum')->postJson("/api/orders/{$o->id}/pay/stripe")->assertNotFound();
        $this->actingAs($other, 'sanctum')->postJson("/api/orders/{$o->id}/pay/paypal")->assertNotFound();
    }

    // ---------- Stripe ----------

    public function test_stripe_checkout_returns_hosted_url(): void
    {
        [$u, $o] = $this->pendingOrder();
        $this->mock(StripeGateway::class)->shouldReceive('createCheckout')->once()->andReturn(['payment_id' => 1, 'session_id' => 'cs_x', 'url' => 'https://checkout.stripe.com/c/pay/cs_x']);
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/stripe")->assertOk()->assertJsonPath('data.url', 'https://checkout.stripe.com/c/pay/cs_x');
    }

    public function test_stripe_webhook_marks_order_paid_once_and_decrements_stock_once(): void
    {
        [, $o, $p] = $this->pendingOrder(2);
        $pay = $this->stripePayment($o);
        [$body, $srv] = $this->signed($this->completedEvent('evt_1', 'cs_test_1', 3998));

        $this->postWebhook($body, $srv)->assertOk()->assertJsonPath('data.result', 'paid');
        $this->assertSame('paid', $o->fresh()->status);
        $this->assertNotNull($o->fresh()->paid_at, 'paid_at must be recorded');
        $this->assertSame('succeeded', $pay->fresh()->status);
        $this->assertSame('pi_evt_1', $pay->fresh()->provider_transaction_id);
        $this->assertSame(8, $p->fresh()->stock);

        // Stripe retries / replays the same event
        $this->postWebhook($body, $srv)->assertOk()->assertJsonPath('data.result', 'duplicate');
        // A *different* event for the same session (e.g. async_payment_succeeded after completed)
        [$b2, $s2] = $this->signed($this->completedEvent('evt_2', 'cs_test_1', 3998));
        $this->postWebhook($b2, $s2)->assertOk()->assertJsonPath('data.result', 'already_paid');
        $this->assertSame(8, $p->fresh()->stock, 'stock must be decremented only once');
        $this->assertSame(1, Payment::where('order_id', $o->id)->where('status', 'succeeded')->count());
    }

    public function test_stripe_webhook_rejects_bad_signature_wrong_secret_and_stale_timestamp(): void
    {
        [, $o] = $this->pendingOrder();
        $this->stripePayment($o);
        $ev = $this->completedEvent('evt_9', 'cs_test_1', 3998);

        [$b, $s] = $this->signed($ev, 'whsec_wrong');
        $this->postWebhook($b, $s)->assertStatus(400);
        [$b, $s] = $this->signed($ev, null, time() - 3600);
        $this->postWebhook($b, $s)->assertStatus(400);
        $this->postWebhook(json_encode($ev), ['CONTENT_TYPE' => 'application/json'])->assertStatus(400);
        // tampered body, signature of the original
        [$b, $s] = $this->signed($ev);
        $this->postWebhook(str_replace('3998', '1', $b), $s)->assertStatus(400);

        $this->assertSame('pending', $o->fresh()->status, 'no unsigned/forged event may change an order');
    }

    public function test_stripe_amount_or_currency_mismatch_does_not_mark_paid(): void
    {
        [, $o, $p] = $this->pendingOrder(2);
        $pay = $this->stripePayment($o);
        [$b, $s] = $this->signed($this->completedEvent('evt_m', 'cs_test_1', 100)); // paid 1.00 instead of 39.98
        $this->postWebhook($b, $s)->assertOk()->assertJsonPath('data.result', 'mismatch');
        $this->assertSame('pending', $o->fresh()->status);
        $this->assertSame('failed', $pay->fresh()->status);
        $this->assertStringContainsString('mismatch', $o->fresh()->payment_note);
        $this->assertSame(10, $p->fresh()->stock);

        $pay2 = $this->stripePayment($o, 'cs_test_2');
        [$b, $s] = $this->signed($this->completedEvent('evt_c', 'cs_test_2', 3998, 'eur'));
        $this->postWebhook($b, $s)->assertJsonPath('data.result', 'mismatch');
        $this->assertSame('pending', $o->fresh()->status);
    }

    public function test_stripe_expired_session_fails_payment_but_never_downgrades_a_paid_one(): void
    {
        [, $o] = $this->pendingOrder();
        $pay = $this->stripePayment($o);
        [$b, $s] = $this->signed(['id' => 'evt_x', 'object' => 'event', 'type' => 'checkout.session.expired', 'data' => ['object' => ['id' => 'cs_test_1', 'object' => 'checkout.session']]]);
        $this->postWebhook($b, $s)->assertOk();
        $this->assertSame('failed', $pay->fresh()->status);
        $this->assertSame('failed', $o->fresh()->status);

        // paid order must not be reverted by a late "expired" event
        [, $o2] = $this->pendingOrder();
        $p2 = $this->stripePayment($o2, 'cs_paid');
        [$b, $s] = $this->signed($this->completedEvent('evt_p', 'cs_paid', 3998));
        $this->postWebhook($b, $s)->assertJsonPath('data.result', 'paid');
        [$b, $s] = $this->signed(['id' => 'evt_late', 'object' => 'event', 'type' => 'checkout.session.expired', 'data' => ['object' => ['id' => 'cs_paid', 'object' => 'checkout.session']]]);
        $this->postWebhook($b, $s)->assertOk();
        $this->assertSame('paid', $o2->fresh()->status);
        $this->assertSame('succeeded', $p2->fresh()->status);
    }

    // ---------- PayPal ----------

    private function fakePaypal(array $capture = null, string $verify = 'SUCCESS'): void
    {
        Http::swap(new \Illuminate\Http\Client\Factory); // a fresh fake; stubs from an earlier call would win otherwise
        Http::fake([
            '*/v1/oauth2/token' => Http::response(['access_token' => 'tok', 'expires_in' => 3000]),
            '*/v2/checkout/orders' => Http::response(['id' => 'PP-ORDER-1', 'status' => 'PAYER_ACTION_REQUIRED', 'links' => [['rel' => 'payer-action', 'href' => 'https://sandbox.paypal.com/checkoutnow?token=PP-ORDER-1']]]),
            '*/v2/checkout/orders/*/capture' => Http::response($capture ?? [], $capture ? 201 : 422),
            '*/v1/notifications/verify-webhook-signature' => Http::response(['verification_status' => $verify]),
        ]);
    }

    private function captureBody(ProductOrder $o, string $value, string $cur = 'USD', string $status = 'COMPLETED'): array
    {
        return ['id' => 'PP-ORDER-1', 'status' => $status, 'purchase_units' => [['custom_id' => (string) $o->id, 'payments' => ['captures' => [['id' => 'CAP-1', 'status' => $status, 'amount' => ['value' => $value, 'currency_code' => $cur], 'custom_id' => (string) $o->id]]]]]];
    }

    public function test_paypal_create_then_capture_marks_paid_and_is_idempotent(): void
    {
        [$u, $o, $p] = $this->pendingOrder(2);
        $this->fakePaypal($this->captureBody($o, '39.98'));

        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/paypal")->assertOk()
            ->assertJsonPath('data.paypal_order_id', 'PP-ORDER-1')->assertJsonPath('data.approve_url', 'https://sandbox.paypal.com/checkoutnow?token=PP-ORDER-1');

        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/paypal/capture", ['paypal_order_id' => 'PP-ORDER-1'])->assertOk()->assertJsonPath('data.status', 'paid');
        $this->assertSame(8, $p->fresh()->stock);
        // double-click / refresh on the return page
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/paypal/capture", ['paypal_order_id' => 'PP-ORDER-1'])->assertOk();
        $this->assertSame(8, $p->fresh()->stock);
        $this->assertSame(1, Payment::where('order_id', $o->id)->where('status', 'succeeded')->count());
    }

    public function test_paypal_capture_rejects_foreign_order_id_underpayment_and_incomplete(): void
    {
        [$u, $o] = $this->pendingOrder(2);
        $this->fakePaypal($this->captureBody($o, '1.00')); // attacker paid a cheap PayPal order
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/paypal")->assertOk();

        // PayPal order id that was never created for THIS order
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/paypal/capture", ['paypal_order_id' => 'SOMEONE-ELSES'])->assertStatus(402);
        $this->assertSame('pending', $o->fresh()->status);

        // real PayPal order, but amount doesn't match the order total
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/paypal/capture", ['paypal_order_id' => 'PP-ORDER-1'])->assertStatus(402);
        $this->assertSame('pending', $o->fresh()->status);
        $this->assertStringContainsString('mismatch', (string) $o->fresh()->payment_note);

        // malformed id is rejected before any HTTP call
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/paypal/capture", ['paypal_order_id' => '../../x'])->assertStatus(422);
    }

    public function test_paypal_webhook_requires_valid_signature_and_is_idempotent(): void
    {
        [$u, $o, $p] = $this->pendingOrder(2);
        $this->fakePaypal(null, 'FAILURE');
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/paypal")->assertOk();

        $event = ['id' => 'WH-EVT-1', 'event_type' => 'PAYMENT.CAPTURE.COMPLETED', 'resource' => ['id' => 'CAP-1', 'status' => 'COMPLETED', 'amount' => ['value' => '39.98', 'currency_code' => 'USD'], 'supplementary_data' => ['related_ids' => ['order_id' => 'PP-ORDER-1']]]];
        $this->postJson('/api/webhooks/paypal', $event)->assertStatus(400);
        $this->assertSame('pending', $o->fresh()->status);

        $this->fakePaypal(null, 'SUCCESS');
        $this->postJson('/api/webhooks/paypal', $event)->assertOk()->assertJsonPath('data.result', 'paid');
        $this->assertSame('paid', $o->fresh()->status);
        $this->postJson('/api/webhooks/paypal', $event)->assertOk()->assertJsonPath('data.result', 'duplicate');
        $this->assertSame(8, $p->fresh()->stock);
    }

    public function test_paypal_webhook_refund_marks_order_refunded(): void
    {
        [$u, $o] = $this->pendingOrder(2);
        $this->fakePaypal($this->captureBody($o, '39.98'));
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/paypal")->assertOk();
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/paypal/capture", ['paypal_order_id' => 'PP-ORDER-1'])->assertOk();

        $this->postJson('/api/webhooks/paypal', ['id' => 'WH-R', 'event_type' => 'PAYMENT.CAPTURE.REFUNDED', 'resource' => ['id' => 'R1', 'supplementary_data' => ['related_ids' => ['order_id' => 'PP-ORDER-1']]]])->assertOk();
        $this->assertSame('refunded', $o->fresh()->status);
    }

    // ---------- admin settings ----------

    public function test_admin_settings_store_secrets_encrypted_and_never_return_them(): void
    {
        $admin = User::where('email', 'admin@example.com')->first();
        $r = $this->actingAs($admin, 'sanctum')->putJson('/api/admin/payment-settings', [
            'stripe_secret_key' => 'sk_test_ABCDEFGH1234', 'paypal_client_secret' => 'super-secret-value', 'paypal_mode' => 'sandbox', 'currency' => 'eur',
        ])->assertOk();

        $json = json_encode($r->json());
        $this->assertStringNotContainsString('sk_test_ABCDEFGH1234', $json);
        $this->assertStringNotContainsString('super-secret-value', $json);
        $this->assertSame('••••1234', $r->json('data.stripe_secret_key.hint'));
        $this->assertSame('EUR', $r->json('data.currency.value'));

        $raw = Setting::find('stripe_secret_key')->value;
        $this->assertStringNotContainsString('sk_test_ABCDEFGH1234', $raw, 'stored encrypted');
        $this->assertSame('sk_test_ABCDEFGH1234', app(\App\Services\Payments\PaymentSettings::class)->get('stripe_secret_key'));

        // blank secret = keep existing
        $this->actingAs($admin, 'sanctum')->putJson('/api/admin/payment-settings', ['stripe_secret_key' => ''])->assertOk();
        $this->assertSame('sk_test_ABCDEFGH1234', app(\App\Services\Payments\PaymentSettings::class)->get('stripe_secret_key'));
    }

    public function test_settings_validate_key_format_and_restrict_to_admins(): void
    {
        $admin = User::where('email', 'admin@example.com')->first();
        $this->actingAs($admin, 'sanctum')->putJson('/api/admin/payment-settings', ['stripe_secret_key' => 'not-a-key'])->assertStatus(422);
        $this->actingAs($admin, 'sanctum')->putJson('/api/admin/payment-settings', ['stripe_webhook_secret' => 'nope'])->assertStatus(422);
        $this->actingAs($this->customer(), 'sanctum')->getJson('/api/admin/payment-settings')->assertForbidden();
        $this->actingAs($this->customer(), 'sanctum')->putJson('/api/admin/payment-settings', ['currency' => 'USD'])->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/admin/payment-settings')->assertUnauthorized();
    }

    public function test_disabled_or_unconfigured_gateway_cannot_start_payment(): void
    {
        [$u, $o] = $this->pendingOrder();
        config(['services.payments.stripe.secret_key' => null]);
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/stripe")->assertStatus(503);
        $this->getJson('/api/payment-methods')->assertJsonPath('data.stripe', false)->assertJsonPath('data.paypal', true);
    }

    public function test_gateway_error_at_session_creation_keeps_order_pending_and_retryable(): void
    {
        [$u, $o] = $this->pendingOrder();
        config(['services.payments.stripe.api_base' => 'http://127.0.0.1:9']); // nothing listens: connection refused
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/stripe")->assertStatus(502);
        $this->assertSame('pending', $o->fresh()->status, 'customer never reached the gateway');
        $this->assertSame(['failed'], $o->payments()->pluck('status')->all());

        Http::fake(['*' => Http::response([], 500)]);
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/paypal")->assertStatus(502);
        $this->assertSame('pending', $o->fresh()->status);
    }

    public function test_paid_order_cannot_be_paid_again(): void
    {
        [$u, $o] = $this->pendingOrder();
        $o->update(['status' => 'paid']);
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/stripe")->assertStatus(409);
        $this->actingAs($u, 'sanctum')->postJson("/api/orders/{$o->id}/pay/paypal")->assertStatus(409);
    }
}
