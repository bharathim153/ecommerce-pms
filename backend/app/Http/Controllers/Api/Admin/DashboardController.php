<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\EmailCampaign;
use App\Models\EmailSubscriber;
use App\Models\PdfExport;
use App\Models\Payment;
use App\Models\Product;
use App\Models\ProductOrder;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * One read-only endpoint feeding the whole admin dashboard. Totals are all-time snapshots
 * (with an "in period" figure beside them); charts, tables and breakdowns are scoped to ?days=.
 */
class DashboardController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $days = in_array((int) $request->query('days'), [7, 30, 90], true) ? (int) $request->query('days') : 30;
        $to = Carbon::today();
        $from = $to->copy()->subDays($days - 1)->startOfDay();
        $currency = app(\App\Services\Payments\PaymentSettings::class)->currency();

        $customers = fn () => User::whereHas('role', fn ($q) => $q->where('name', 'customer'));

        // Paid revenue per calendar day (by payment date), zero-filled so the chart axis is continuous.
        $daily = ProductOrder::where('status', 'paid')->where('paid_at', '>=', $from)
            ->selectRaw('DATE(paid_at) d, COUNT(*) orders, SUM(total) revenue')->groupBy('d')->get()->keyBy('d');
        $series = [];
        for ($d = $from->copy(); $d <= $to; $d->addDay()) {
            $k = $d->toDateString();
            $series[] = ['date' => $k, 'revenue' => round((float) ($daily[$k]->revenue ?? 0), 2), 'orders' => (int) ($daily[$k]->orders ?? 0)];
        }

        $byStatus = ProductOrder::where('created_at', '>=', $from)->selectRaw('status, COUNT(*) n')->groupBy('status')->pluck('n', 'status');

        $payments = Payment::where('created_at', '>=', $from)
            ->selectRaw("provider, COUNT(*) attempts, SUM(status='succeeded') succeeded, SUM(status='failed') failed, SUM(status='refunded') refunded, SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END) revenue")
            ->groupBy('provider')->get()->keyBy('provider');
        $paymentRows = collect(['stripe', 'paypal'])->map(fn ($p) => [
            'provider' => $p,
            'attempts' => (int) ($payments[$p]->attempts ?? 0),
            'succeeded' => (int) ($payments[$p]->succeeded ?? 0),
            'failed' => (int) ($payments[$p]->failed ?? 0),
            'refunded' => (int) ($payments[$p]->refunded ?? 0),
            'revenue' => round((float) ($payments[$p]->revenue ?? 0), 2),
        ])->values();

        $subs = [
            'subscribed' => EmailSubscriber::where('is_subscribed', true)->whereNull('bounced_at')->count(),
            'unsubscribed' => EmailSubscriber::where('is_subscribed', false)->count(),
            'bounced' => EmailSubscriber::whereNotNull('bounced_at')->count(),
        ];
        $camp = EmailCampaign::where('created_at', '>=', $from);

        return $this->ok([
            'days' => $days,
            'currency' => $currency,
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'totals' => [
                'products' => ['total' => Product::count(), 'new' => Product::where('created_at', '>=', $from)->count(), 'published' => Product::where('status', 'published')->count()],
                'customers' => ['total' => $customers()->count(), 'new' => $customers()->where('created_at', '>=', $from)->count()],
                'orders' => ['total' => ProductOrder::count(), 'new' => ProductOrder::where('created_at', '>=', $from)->count(), 'paid' => ProductOrder::where('status', 'paid')->count()],
                'revenue' => [
                    'total' => round((float) ProductOrder::where('status', 'paid')->sum('total'), 2),
                    'period' => round((float) ProductOrder::where('status', 'paid')->where('paid_at', '>=', $from)->sum('total'), 2),
                ],
            ],
            'series' => $series,
            'orders_by_status' => collect(['paid', 'pending', 'failed', 'refunded', 'cancelled'])->map(fn ($s) => ['status' => $s, 'count' => (int) ($byStatus[$s] ?? 0)])->values(),
            'payments' => $paymentRows,
            'recent_orders' => ProductOrder::with('user:id,name,email')->latest('id')->limit(6)->get()->map(fn ($o) => [
                'id' => $o->id, 'number' => $o->number, 'status' => $o->status, 'total' => $o->total, 'currency' => $o->currency,
                'customer' => $o->user?->name, 'created_at' => $o->created_at,
            ]),
            'recent_customers' => $customers()->latest('id')->limit(6)->get(['id', 'name', 'email', 'created_at', 'email_verified_at'])->map(fn ($u) => [
                'id' => $u->id, 'name' => $u->name, 'email' => $u->email, 'verified' => (bool) $u->email_verified_at, 'created_at' => $u->created_at,
            ]),
            'pdf_exports' => [
                'counts' => PdfExport::where('created_at', '>=', $from)->selectRaw('status, COUNT(*) n')->groupBy('status')->pluck('n', 'status'),
                'recent' => PdfExport::latest('id')->limit(5)->get()->map(fn ($e) => [
                    'id' => $e->id, 'scope' => $e->scope, 'status' => $e->status, 'progress' => $e->progress, 'total_products' => $e->total_products,
                    'page_count' => $e->page_count, 'created_at' => $e->created_at,
                ]),
            ],
            'campaigns' => [
                'subscribers' => $subs,
                'created' => (clone $camp)->count(),
                'sent' => (int) (clone $camp)->sum('sent_count'),
                'delivered' => (int) (clone $camp)->sum('delivered_count'),
                'failed' => (int) (clone $camp)->sum('failed_count'),
                'bounced' => (int) (clone $camp)->sum('bounced_count'),
                'recent' => EmailCampaign::latest('id')->limit(5)->get()->map(fn ($c) => [
                    'id' => $c->id, 'subject' => $c->subject, 'status' => $c->status, 'total_recipients' => $c->total_recipients,
                    'sent' => $c->sent_count, 'failed' => $c->failed_count, 'created_at' => $c->created_at,
                ]),
            ],
        ]);
    }
}
