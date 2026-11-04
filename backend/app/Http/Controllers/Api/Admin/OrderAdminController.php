<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Controller;
use App\Models\ProductOrder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrderAdminController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $page = ProductOrder::with(['user:id,name,email', 'items', 'payments'])
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->query('search'), fn ($q, $s) => $q->where('number', 'like', '%'.addcslashes($s, '%_\\').'%'))
            ->latest('id')->paginate(min((int) $request->query('per_page', 15), 100));

        return $this->ok([
            'items' => collect($page->items())->map(fn ($o) => OrderController::present($o) + ['customer' => $o->user ? ['name' => $o->user->name, 'email' => $o->user->email] : null]),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    public function show(ProductOrder $order): JsonResponse
    {
        $order->load('items', 'payments', 'user:id,name,email');

        return $this->ok(OrderController::present($order) + ['customer' => $order->user, 'payment_note' => $order->payment_note]);
    }
}
