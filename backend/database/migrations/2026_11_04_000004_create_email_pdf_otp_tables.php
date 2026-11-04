<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('otp_verifications', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->enum('purpose', ['login', 'email_verify', 'password_reset'])->default('login');
            $t->string('code_hash');
            $t->unsignedTinyInteger('attempts')->default(0);
            $t->timestamp('expires_at');
            $t->timestamp('consumed_at')->nullable();
            $t->timestamp('last_sent_at')->nullable();
            $t->timestamps();
            $t->index(['user_id', 'purpose', 'expires_at']);
        });

        Schema::create('pdf_exports', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->enum('scope', ['selected', 'all']);
            $t->json('product_ids')->nullable();
            $t->enum('status', ['queued', 'processing', 'completed', 'failed'])->default('queued')->index();
            $t->unsignedInteger('total_products')->default(0);
            $t->unsignedInteger('processed_products')->default(0);
            $t->unsignedTinyInteger('progress')->default(0);
            $t->unsignedInteger('page_count')->nullable();
            $t->string('file_path')->nullable();
            $t->text('error')->nullable();
            $t->timestamp('started_at')->nullable();
            $t->timestamp('finished_at')->nullable();
            $t->timestamps();
        });

        Schema::create('email_templates', function (Blueprint $t) {
            $t->id();
            $t->string('name');
            $t->string('subject');
            $t->longText('body_html');
            $t->timestamps();
        });

        Schema::create('email_subscribers', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $t->string('email')->unique();
            $t->string('name')->nullable();
            $t->boolean('is_subscribed')->default(true)->index();
            $t->string('unsubscribe_token', 64)->unique();
            $t->timestamp('subscribed_at')->nullable();
            $t->timestamp('unsubscribed_at')->nullable();
            $t->timestamps();
        });

        Schema::create('email_campaigns', function (Blueprint $t) {
            $t->id();
            $t->foreignId('template_id')->nullable()->constrained('email_templates')->nullOnDelete();
            $t->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $t->string('subject');
            $t->longText('body_html'); // snapshot at send time
            $t->enum('status', ['draft', 'sending', 'completed', 'failed', 'cancelled'])->default('draft')->index();
            $t->unsignedInteger('total_recipients')->default(0);
            $t->unsignedInteger('sent_count')->default(0);
            $t->unsignedInteger('failed_count')->default(0);
            $t->timestamp('started_at')->nullable();
            $t->timestamp('finished_at')->nullable();
            $t->timestamps();
        });

        Schema::create('email_campaign_logs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('campaign_id')->constrained('email_campaigns')->cascadeOnDelete();
            $t->foreignId('subscriber_id')->constrained('email_subscribers')->cascadeOnDelete();
            $t->enum('status', ['queued', 'sent', 'delivered', 'failed', 'bounced'])->default('queued')->index();
            $t->string('provider_message_id')->nullable();
            $t->text('error')->nullable();
            $t->timestamp('sent_at')->nullable();
            $t->timestamps();
            $t->unique(['campaign_id', 'subscriber_id']); // prevents duplicate sends
        });
    }

    public function down(): void
    {
        foreach (['email_campaign_logs','email_campaigns','email_subscribers','email_templates','pdf_exports','otp_verifications'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
