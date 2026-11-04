<?php

namespace Tests\Feature;

use App\Models\Payment;
use App\Models\Product;
use App\Models\ProductOrder;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class DashboardAndProfileTest extends TestCase
{
    use DatabaseTransactions;

    private function admin(): User { return User::where('email', 'admin@example.com')->first(); }

    private function customer(): User
    {
        return User::factory()->create(['role_id' => Role::where('name', 'customer')->value('id'), 'email_verified_at' => now()]);
    }

    private function order(User $u, string $status, float $total, $paidAt = null): ProductOrder
    {
        return ProductOrder::create(['number' => 'T-'.uniqid(), 'user_id' => $u->id, 'status' => $status, 'subtotal' => $total, 'total' => $total, 'currency' => 'USD', 'paid_at' => $paidAt]);
    }

    public function test_dashboard_is_admin_only(): void
    {
        $this->actingAs($this->customer(), 'sanctum')->getJson('/api/admin/dashboard')->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/admin/dashboard')->assertUnauthorized();
    }

    public function test_dashboard_aggregates_revenue_series_and_breakdowns_correctly(): void
    {
        $before = $this->actingAs($this->admin(), 'sanctum')->getJson('/api/admin/dashboard?days=7')->assertOk()->json('data');

        $c = $this->customer();
        $this->order($c, 'paid', 100.50, now());
        $this->order($c, 'paid', 49.50, now());
        $this->order($c, 'paid', 1000.00, now()->subDays(20)); // outside a 7-day window
        $this->order($c, 'pending', 999);
        $this->order($c, 'failed', 5);
        $p = $this->order($c, 'paid', 10, now()->subDays(2));
        Payment::create(['order_id' => $p->id, 'provider' => 'stripe', 'amount' => 10, 'currency' => 'USD', 'status' => 'succeeded']);
        Payment::create(['order_id' => $p->id, 'provider' => 'stripe', 'amount' => 10, 'currency' => 'USD', 'status' => 'failed']);
        Payment::create(['order_id' => $p->id, 'provider' => 'paypal', 'amount' => 7, 'currency' => 'USD', 'status' => 'succeeded']);

        $r = $this->actingAs($this->admin(), 'sanctum')->getJson('/api/admin/dashboard?days=7')->assertOk();
        $d = $r->json('data');

        $this->assertSame(7, count($d['series']), 'one point per day, zero-filled');
        $this->assertSame(now()->toDateString(), end($d['series'])['date']);
        $today = collect($d['series'])->firstWhere('date', now()->toDateString());
        $this->assertEqualsWithDelta(150.0, $today['revenue'] - ($before['series'][6]['revenue'] ?? 0), 0.001);
        $this->assertSame(2, $today['orders'] - ($before['series'][6]['orders'] ?? 0));

        $this->assertEqualsWithDelta($d['totals']['revenue']['period'] - $before['totals']['revenue']['period'], 160.0, 0.001, 'period revenue = 100.5+49.5+10, excluding the 20-day-old and non-paid orders');
        $this->assertEqualsWithDelta($d['totals']['revenue']['total'] - $before['totals']['revenue']['total'], 1160.0, 0.001, 'all-time revenue includes the old paid order');
        $this->assertSame(6, $d['totals']['orders']['total'] - $before['totals']['orders']['total']);

        $status = collect($d['orders_by_status'])->pluck('count', 'status');
        $statusBefore = collect($before['orders_by_status'])->pluck('count', 'status');
        $this->assertSame(4, $status['paid'] - $statusBefore['paid'], 'status breakdown is by creation date, so the old-paid order created now is included');
        $this->assertSame(1, $status['pending'] - $statusBefore['pending']);

        $stripe = collect($d['payments'])->firstWhere('provider', 'stripe');
        $this->assertSame(1, $stripe['succeeded'] - collect($before['payments'])->firstWhere('provider', 'stripe')['succeeded']);
        $this->assertSame(1, $stripe['failed'] - collect($before['payments'])->firstWhere('provider', 'stripe')['failed']);

        $this->assertCount(6, $d['recent_orders']);
        $this->assertArrayNotHasKey('password', $d['recent_customers'][0]);
        $this->assertSame(30, $this->actingAs($this->admin(), 'sanctum')->getJson('/api/admin/dashboard?days=999')->json('data.days'), 'unknown range falls back to 30');
    }

    public function test_profile_update_and_validation(): void
    {
        $u = $this->customer();
        $this->actingAs($u, 'sanctum')->patchJson('/api/auth/profile', ['name' => 'New Name', 'phone' => '+1 (555) 123-4567'])->assertOk()->assertJsonPath('data.name', 'New Name');
        $this->actingAs($u, 'sanctum')->patchJson('/api/auth/profile', ['name' => '', 'phone' => 'abc'])->assertStatus(422)->assertJsonValidationErrors(['name', 'phone']);
        $this->assertSame($u->email, $u->fresh()->email, 'email cannot be changed through the profile endpoint');
        $this->actingAs($u, 'sanctum')->patchJson('/api/auth/profile', ['name' => 'X', 'email' => 'hijack@example.com']);
        $this->assertSame($u->email, $u->fresh()->email);
    }

    public function test_password_change_requires_current_password_and_signs_out_other_devices(): void
    {
        $u = $this->customer();
        $u->update(['password' => 'OldPassw0rd']);
        $other = $u->createToken('other-device')->plainTextToken;
        $mine = $u->createToken('this-device')->plainTextToken;

        $this->withToken($mine)->putJson('/api/auth/password', ['current_password' => 'wrong', 'password' => 'NewPassw0rd1', 'password_confirmation' => 'NewPassw0rd1'])->assertStatus(422);
        $this->withToken($mine)->putJson('/api/auth/password', ['current_password' => 'OldPassw0rd', 'password' => 'OldPassw0rd', 'password_confirmation' => 'OldPassw0rd'])->assertStatus(422);
        $this->withToken($mine)->putJson('/api/auth/password', ['current_password' => 'OldPassw0rd', 'password' => 'weak', 'password_confirmation' => 'weak'])->assertStatus(422);
        $this->assertNotNull(\Illuminate\Support\Facades\Hash::check('OldPassw0rd', $u->fresh()->password));

        $this->withToken($mine)->putJson('/api/auth/password', ['current_password' => 'OldPassw0rd', 'password' => 'NewPassw0rd1', 'password_confirmation' => 'NewPassw0rd1'])->assertOk();
        $this->assertTrue(\Illuminate\Support\Facades\Hash::check('NewPassw0rd1', $u->fresh()->password));
        $this->assertSame(1, $u->tokens()->count(), 'only the current session survives');
    }

    public function test_customers_see_only_their_own_orders(): void
    {
        $a = $this->customer();
        $b = $this->customer();
        $o = $this->order($a, 'paid', 20, now());
        $this->actingAs($b, 'sanctum')->getJson('/api/orders')->assertOk()->assertJsonMissing(['number' => $o->number]);
        $this->actingAs($b, 'sanctum')->getJson("/api/orders/{$o->id}")->assertNotFound();
        $this->actingAs($a, 'sanctum')->getJson("/api/orders/{$o->id}")->assertOk()->assertJsonPath('data.number', $o->number);
    }
}
