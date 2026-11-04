<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class SecurityTest extends TestCase
{
    use DatabaseTransactions;

    /** The ONLY routes allowed to answer without a login. Adding a public route means editing this list on purpose. */
    private const PUBLIC_ROUTES = [
        'POST api/auth/register', 'POST api/auth/login', 'POST api/auth/mfa/verify', 'POST api/auth/mfa/resend',
        'POST api/auth/forgot-password', 'POST api/auth/reset-password', 'GET api/auth/email/verify/{id}/{hash}',
        'GET api/categories', 'GET api/products', 'GET api/products/{slug}', 'GET api/payment-methods',
        'GET api/unsubscribe/{token}', 'POST api/unsubscribe/{token}', 'POST api/resubscribe/{token}',
        'POST api/webhooks/stripe', 'POST api/webhooks/paypal', 'POST api/webhooks/mailgun',
    ];

    /** @return array<string, \Illuminate\Routing\Route> keyed "METHOD uri" */
    private function apiRoutes(): array
    {
        $out = [];
        foreach (Route::getRoutes() as $r) {
            if (! str_starts_with($r->uri(), 'api/')) {
                continue;
            }
            foreach (array_diff($r->methods(), ['HEAD', 'OPTIONS']) as $m) {
                $out["$m {$r->uri()}"] = $r;
            }
        }

        return $out;
    }

    private function fill(string $uri): string
    {
        return '/'.preg_replace('/\{[^}]+\}/', '1', $uri);
    }

    public function test_every_route_that_is_not_explicitly_public_requires_authentication(): void
    {
        $leaks = [];
        foreach ($this->apiRoutes() as $key => $route) {
            if (in_array($key, self::PUBLIC_ROUTES, true)) {
                continue;
            }
            [$method] = explode(' ', $key);
            $this->app['auth']->forgetGuards();
            $status = $this->json($method, $this->fill($route->uri()))->getStatusCode();
            if ($status !== 401) {
                $leaks[] = "$key -> $status";
            }
        }
        $this->assertSame([], $leaks, "These routes answered an anonymous caller:\n".implode("\n", $leaks));
    }

    public function test_every_admin_route_rejects_a_logged_in_customer(): void
    {
        $customer = User::factory()->create(['role_id' => Role::where('name', 'customer')->value('id'), 'email_verified_at' => now()]);
        $leaks = [];
        $admin = 0;
        foreach ($this->apiRoutes() as $key => $route) {
            if (! str_starts_with($route->uri(), 'api/admin/')) {
                continue;
            }
            $admin++;
            [$method] = explode(' ', $key);
            $status = $this->actingAs($customer, 'sanctum')->json($method, $this->fill($route->uri()))->getStatusCode();
            if ($status !== 403) {
                $leaks[] = "$key -> $status";
            }
        }
        $this->assertGreaterThan(30, $admin, 'sanity: the audit actually covered the admin surface');
        $this->assertSame([], $leaks, "Admin routes reachable by a customer:\n".implode("\n", $leaks));
    }

    public function test_public_route_list_has_no_stale_entries(): void
    {
        $existing = array_keys($this->apiRoutes());
        foreach (self::PUBLIC_ROUTES as $p) {
            $this->assertContains($p, $existing, "Allow-list entry no longer exists: $p");
        }
    }

    public function test_payment_webhooks_reject_unsigned_requests(): void
    {
        $this->postJson('/api/webhooks/stripe', ['id' => 'evt_x'])->assertStatus(400);
        $this->postJson('/api/webhooks/paypal', ['id' => 'WH-x'])->assertStatus(400);
        $this->postJson('/api/webhooks/mailgun', ['event-data' => ['event' => 'delivered']])->assertStatus(400);
    }

    public function test_api_responses_carry_security_headers_and_are_not_cacheable(): void
    {
        $r = $this->getJson('/api/categories');
        $this->assertSame('nosniff', $r->headers->get('X-Content-Type-Options'));
        $this->assertSame('DENY', $r->headers->get('X-Frame-Options'));
        $this->assertSame('no-referrer', $r->headers->get('Referrer-Policy'));
        $this->assertStringContainsString("frame-ancestors 'none'", $r->headers->get('Content-Security-Policy'));
        $this->assertStringContainsString('no-store', $r->headers->get('Cache-Control'));
        $this->assertNull($r->headers->get('Strict-Transport-Security'), 'HSTS only over HTTPS');
        $this->assertNull($r->headers->get('X-Powered-By'));
    }

    public function test_api_tokens_expire(): void
    {
        $this->assertSame(10080, (int) config('sanctum.expiration'));
        $u = User::factory()->create(['role_id' => Role::where('name', 'customer')->value('id')]);
        $token = $u->createToken('t')->plainTextToken;
        $this->withToken($token)->getJson('/api/auth/me')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->travel(8)->days();
        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_repeated_wrong_passwords_lock_the_account_for_that_ip(): void
    {
        $u = User::factory()->create(['role_id' => Role::where('name', 'customer')->value('id')]);
        $key = 'login:'.strtolower($u->email).'|127.0.0.1';
        RateLimiter::clear($key);

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/login', ['email' => $u->email, 'password' => 'wrong'.$i])->assertStatus(401);
        }
        // Even the CORRECT password is refused while locked: an attacker can't learn when they guessed right.
        $this->postJson('/api/auth/login', ['email' => $u->email, 'password' => 'password'])->assertStatus(429);
        RateLimiter::clear($key);
    }

    public function test_login_does_not_reveal_whether_an_account_exists(): void
    {
        $a = $this->postJson('/api/auth/login', ['email' => 'nobody-'.uniqid().'@example.com', 'password' => 'whatever1A'])->assertStatus(401)->json('message');
        $u = User::factory()->create(['role_id' => Role::where('name', 'customer')->value('id')]);
        RateLimiter::clear('login:'.strtolower($u->email).'|127.0.0.1');
        $b = $this->postJson('/api/auth/login', ['email' => $u->email, 'password' => 'WrongPass1'])->assertStatus(401)->json('message');
        $this->assertSame($a, $b);
        $this->postJson('/api/auth/forgot-password', ['email' => 'nobody-'.uniqid().'@example.com'])->assertOk();
    }

    public function test_privileged_fields_cannot_be_set_through_registration_or_profile(): void
    {
        $r = $this->postJson('/api/auth/register', [
            'name' => 'Sneaky', 'email' => 'sneaky'.uniqid().'@example.com', 'password' => 'Passw0rdX', 'password_confirmation' => 'Passw0rdX',
            'role_id' => Role::where('name', 'admin')->value('id'), 'role' => 'admin', 'is_active' => true, 'email_verified_at' => now()->toDateTimeString(),
        ])->assertCreated();
        $this->assertSame('customer', $r->json('data.user.role'));
        $this->assertFalse($r->json('data.user.email_verified'), 'cannot self-verify');

        $this->withToken($r->json('data.token'))->patchJson('/api/auth/profile', ['name' => 'S', 'role_id' => 1, 'role' => 'admin'])->assertOk();
        $this->withToken($r->json('data.token'))->getJson('/api/admin/users')->assertForbidden();
    }

    public function test_production_seeding_refuses_known_credentials(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        foreach ([[null, 'admin@example.com'], ['Admin@12345', 'boss@company.com'], ['short', 'boss@company.com'], ['A-Long-Unique-Passphrase-1', 'admin@example.com']] as [$pw, $mail]) {
            putenv('ADMIN_PASSWORD='.$pw); putenv('ADMIN_EMAIL='.$mail);
            $threw = false;
            try {
                (new DatabaseSeeder)->setContainer($this->app)->run(); // not db:seed, which itself refuses in production
            } catch (\RuntimeException) {
                $threw = true;
            }
            $this->assertTrue($threw, 'seeder must refuse '.json_encode([$pw, $mail]));
        }
        putenv('ADMIN_PASSWORD'); putenv('ADMIN_EMAIL');
        $this->app->detectEnvironment(fn () => 'testing');
    }

    public function test_uploads_reject_scripts_svg_and_oversized_dimensions(): void
    {
        $admin = User::where('email', 'admin@example.com')->first();
        $evil = \Illuminate\Http\UploadedFile::fake()->createWithContent('shell.php.png', '<?php system($_GET["c"]);');
        $svg = \Illuminate\Http\UploadedFile::fake()->createWithContent('x.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        $huge = \Illuminate\Http\UploadedFile::fake()->image('big.png', 6000, 100);
        foreach ([$evil, $svg, $huge] as $f) {
            $this->actingAs($admin, 'sanctum')->post('/api/admin/uploads/image', ['image' => $f], ['Accept' => 'application/json'])->assertStatus(422);
        }
    }
}
