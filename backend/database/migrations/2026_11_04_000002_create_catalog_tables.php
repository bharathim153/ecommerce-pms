<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $t) {
            $t->id();
            $t->string('name');
            $t->string('slug')->unique();
            $t->foreignId('parent_id')->nullable()->constrained('categories')->nullOnDelete();
            $t->timestamps();
        });

        Schema::create('products', function (Blueprint $t) {
            $t->id();
            $t->foreignId('category_id')->nullable()->constrained()->nullOnDelete();
            $t->string('name');
            $t->string('slug')->unique();
            $t->string('sku', 100)->unique();
            $t->decimal('price', 12, 2);
            $t->unsignedInteger('stock')->default(0);
            $t->enum('status', ['draft', 'published', 'archived'])->default('draft')->index();
            $t->string('short_description', 500)->nullable();
            $t->longText('description')->nullable(); // sanitized HTML from TipTap
            $t->timestamps();
            $t->softDeletes();
            $t->index(['status', 'category_id']);
            $t->index('name');
        });

        Schema::create('product_images', function (Blueprint $t) {
            $t->id();
            $t->foreignId('product_id')->constrained()->cascadeOnDelete();
            $t->string('path');
            $t->string('alt')->nullable();
            $t->unsignedSmallInteger('sort_order')->default(0);
            $t->boolean('is_primary')->default(false);
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_images');
        Schema::dropIfExists('products');
        Schema::dropIfExists('categories');
    }
};
