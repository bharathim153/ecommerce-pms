<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_orders', function (Blueprint $t) {
            $t->id();
            $t->string('number', 32)->unique();
            $t->foreignId('user_id')->constrained()->restrictOnDelete();
            $t->enum('status', ['pending', 'paid', 'failed', 'cancelled', 'refunded'])->default('pending')->index();
            $t->decimal('subtotal', 12, 2);
            $t->decimal('total', 12, 2);
            $t->char('currency', 3)->default('USD');
            $t->timestamps();
            $t->index(['user_id', 'created_at']);
        });

        Schema::create('order_items', function (Blueprint $t) {
            $t->id();
            $t->foreignId('order_id')->constrained('product_orders')->cascadeOnDelete();
            $t->foreignId('product_id')->nullable()->constrained()->nullOnDelete();
            $t->string('product_name'); // snapshot
            $t->string('sku', 100);
            $t->decimal('unit_price', 12, 2);
            $t->unsignedInteger('quantity');
            $t->decimal('line_total', 12, 2);
            $t->timestamps();
        });

        Schema::create('payments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('order_id')->constrained('product_orders')->restrictOnDelete();
            $t->enum('provider', ['stripe', 'paypal']);
            $t->string('provider_reference')->nullable(); // session/intent/order id
            $t->string('provider_transaction_id')->nullable();
            $t->decimal('amount', 12, 2);
            $t->char('currency', 3)->default('USD');
            $t->enum('status', ['pending', 'succeeded', 'failed', 'refunded'])->default('pending')->index();
            $t->json('raw_payload')->nullable();
            $t->timestamps();
            $t->unique(['provider', 'provider_reference']);   // idempotency
            $t->unique(['provider', 'provider_transaction_id']); // no duplicate processing
        });

        Schema::create('webhook_events', function (Blueprint $t) {
            $t->id();
            $t->enum('provider', ['stripe', 'paypal']);
            $t->string('event_id');
            $t->string('type')->nullable();
            $t->timestamp('processed_at')->nullable();
            $t->timestamps();
            $t->unique(['provider', 'event_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_events');
        Schema::dropIfExists('payments');
        Schema::dropIfExists('order_items');
        Schema::dropIfExists('product_orders');
    }
};
