<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductOrder;
use App\Services\Payments\PaymentSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    public function __construct(private PaymentSettings $settings) {}

    public function methods(): JsonResponse
    {
        return $this->ok([
            'currency' => $this->settings->currency(),
            'stripe' => $this->settings->enabled('stripe'),
            'paypal' => $this->settings->enabled('paypal'),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $page = $request->user()->orders()->with('items')->latest('id')->paginate(15);

        return $this->ok(['items' => collect($page->items())->map(fn ($o) => $this->row($o)), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]]);
    }

    public function show(Request $request, ProductOrder $order): JsonResponse
    {
        $this->authorizeOwner($request, $order);

        return $this->ok($this->row($order->load('items', 'payments')));
    }

    /** Prices and names come from the database, never from the client. */
    public function store(Request $request): JsonResponse
    {
        if (! $request->user()->email_verified_at) {
            return $this->fail('Please verify your email address before checking out.', 403);
        }

        $data = $request->validate([
            'items' => ['required', 'array', 'min:1', 'max:50'],
            'items.*.product_id' => ['required', 'integer', 'distinct'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:100'],
        ]);

        $products = Product::published()->whereIn('id', collect($data['items'])->pluck('product_id'))->get()->keyBy('id');
        $lines = [];
        $errors = [];
        foreach ($data['items'] as $i => $it) {
            $p = $products->get($it['product_id']);
            if (! $p) {
                $errors["items.$i.product_id"] = 'This product is no longer available.';
            } elseif ($p->stock < $it['quantity']) {
                $errors["items.$i.quantity"] = "Only {$p->stock} of \"{$p->name}\" in stock.";
            } else {
                $lines[] = [$p, $it['quantity']];
            }
        }
        if ($errors) {
            return $this->fail('Some items cannot be ordered.', 422, $errors);
        }

        $order = DB::transaction(function () use ($request, $lines) {
            $subtotal = collect($lines)->sum(fn ($l) => round($l[0]->price * $l[1], 2));
            $order = ProductOrder::create([
                'number' => 'ORD-'.now()->format('ymd').'-'.strtoupper(Str::random(6)),
                'user_id' => $request->user()->id,
                'status' => 'pending',
                'subtotal' => $subtotal,
                'total' => $subtotal,
                'currency' => $this->settings->currency(),
            ]);
            foreach ($lines as [$p, $qty]) {
                $order->items()->create([
                    'product_id' => $p->id, 'product_name' => $p->name, 'sku' => $p->sku,
                    'unit_price' => $p->price, 'quantity' => $qty, 'line_total' => round($p->price * $qty, 2),
                ]);
            }

            return $order;
        });

        return $this->ok($this->row($order->load('items')), 'Order created.', 201);
    }

    private function authorizeOwner(Request $request, ProductOrder $order): void
    {
        abort_unless($order->user_id === $request->user()->id || $request->user()->isAdmin(), 404);
    }

    public static function present(ProductOrder $o): array
    {
        return [
            'id' => $o->id, 'number' => $o->number, 'status' => $o->status,
            'subtotal' => $o->subtotal, 'total' => $o->total, 'currency' => $o->currency,
            'paid_at' => $o->paid_at, 'created_at' => $o->created_at,
            'items' => $o->relationLoaded('items') ? $o->items->map(fn ($i) => [
                'id' => $i->id, 'product_id' => $i->product_id, 'name' => $i->product_name, 'sku' => $i->sku,
                'unit_price' => $i->unit_price, 'quantity' => $i->quantity, 'line_total' => $i->line_total,
            ])->values() : [],
            'payments' => $o->relationLoaded('payments') ? $o->payments->map(fn ($p) => [
                'id' => $p->id, 'provider' => $p->provider, 'status' => $p->status, 'amount' => $p->amount, 'created_at' => $p->created_at,
            ])->values() : [],
        ];
    }

    private function row(ProductOrder $o): array
    {
        return self::present($o);
    }
}
