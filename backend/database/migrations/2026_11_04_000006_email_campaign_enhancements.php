<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 'sending' = claimed by a worker (atomic claim prevents double sends); 'skipped' = unsubscribed/cancelled before send.
        DB::statement("ALTER TABLE email_campaign_logs MODIFY status ENUM('queued','sending','sent','delivered','failed','bounced','skipped') NOT NULL DEFAULT 'queued'");

        Schema::table('email_subscribers', function (Blueprint $t) {
            $t->timestamp('bounced_at')->nullable()->after('unsubscribed_at');
            $t->string('source', 30)->default('manual')->after('bounced_at'); // manual|import|signup|account
        });

        Schema::table('email_campaign_logs', function (Blueprint $t) {
            $t->timestamp('delivered_at')->nullable()->after('sent_at');
            $t->index('provider_message_id');
        });

        Schema::table('email_campaigns', function (Blueprint $t) {
            $t->unsignedInteger('delivered_count')->default(0)->after('failed_count');
            $t->unsignedInteger('bounced_count')->default(0)->after('delivered_count');
            $t->unsignedInteger('skipped_count')->default(0)->after('bounced_count');
        });
    }

    public function down(): void
    {
        Schema::table('email_campaigns', fn (Blueprint $t) => $t->dropColumn(['delivered_count', 'bounced_count', 'skipped_count']));
        Schema::table('email_campaign_logs', function (Blueprint $t) {
            $t->dropIndex(['provider_message_id']);
            $t->dropColumn('delivered_at');
        });
        Schema::table('email_subscribers', fn (Blueprint $t) => $t->dropColumn(['bounced_at', 'source']));
        DB::statement("ALTER TABLE email_campaign_logs MODIFY status ENUM('queued','sent','delivered','failed','bounced') NOT NULL DEFAULT 'queued'");
    }
};
