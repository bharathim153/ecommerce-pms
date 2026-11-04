<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $t) {
            $t->id();
            $t->string('name', 50)->unique(); // admin, customer
            $t->string('label', 100);
            $t->timestamps();
        });

        Schema::table('users', function (Blueprint $t) {
            $t->foreignId('role_id')->nullable()->after('id')->constrained('roles')->restrictOnDelete();
            $t->string('phone', 30)->nullable();
            $t->boolean('mfa_enabled')->default(false);
            $t->boolean('is_active')->default(true)->index();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $t) {
            $t->dropConstrainedForeignId('role_id');
            $t->dropColumn(['phone', 'mfa_enabled', 'is_active']);
        });
        Schema::dropIfExists('roles');
    }
};
