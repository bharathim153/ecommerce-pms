<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $t) {
            $t->string('key', 100)->primary();
            $t->text('value')->nullable();
            $t->boolean('is_secret')->default(false);
            $t->timestamps();
        });

        Schema::table('product_orders', function (Blueprint $t) {
            $t->timestamp('paid_at')->nullable()->after('currency');
            $t->string('payment_note')->nullable()->after('paid_at'); // e.g. amount-mismatch flags
        });
    }

    public function down(): void
    {
        Schema::table('product_orders', fn (Blueprint $t) => $t->dropColumn(['paid_at', 'payment_note']));
        Schema::dropIfExists('settings');
    }
};
