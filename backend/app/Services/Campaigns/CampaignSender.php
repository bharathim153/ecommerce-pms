<?php

namespace App\Services\Campaigns;

use App\Jobs\SendCampaignChunk;
use App\Models\EmailCampaign;
use App\Models\EmailCampaignLog;
use App\Models\EmailSubscriber;
use Illuminate\Bus\Batch;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;

class CampaignSender
{
    public static function eligible()
    {
        return EmailSubscriber::query()->where('is_subscribed', true)->whereNull('bounced_at');
    }

    /**
     * Draft -> sending exactly once. The compare-and-swap UPDATE means a double click, a second admin
     * or a retried request cannot start the same campaign twice.
     *
     * @return int|null recipient count, or null if the campaign was not in draft (already launched)
     */
    public function launch(EmailCampaign $campaign): ?int
    {
        $claimed = EmailCampaign::whereKey($campaign->id)->where('status', 'draft')
            ->update(['status' => 'sending', 'started_at' => now()]);
        if ($claimed !== 1) {
            return null;
        }

        // One log row per recipient, created up front. UNIQUE(campaign, subscriber) is the last line of defence.
        $total = 0;
        self::eligible()->select('id')->chunkById(1000, function ($subs) use ($campaign, &$total) {
            $now = now();
            $rows = $subs->map(fn ($s) => ['campaign_id' => $campaign->id, 'subscriber_id' => $s->id, 'status' => 'queued', 'created_at' => $now, 'updated_at' => $now])->all();
            $total += DB::table('email_campaign_logs')->insertOrIgnore($rows);
        });

        EmailCampaign::whereKey($campaign->id)->update(['total_recipients' => $total]);

        if ($total === 0) {
            $this->finish($campaign->id);

            return 0;
        }

        $jobs = [];
        EmailCampaignLog::where('campaign_id', $campaign->id)->select('id')->orderBy('id')
            ->chunkById((int) config('campaigns.chunk_size'), function ($logs) use ($campaign, &$jobs) {
                $jobs[] = new SendCampaignChunk($campaign->id, $logs->pluck('id')->all());
            });

        $id = $campaign->id;
        Bus::batch($jobs)->name("campaign-{$id}")->allowFailures()
            ->finally(function (Batch $batch) use ($id) {
                \App\Services\Campaigns\CampaignSender::finishStatic($id);
            })->dispatch();

        return $total;
    }

    public static function finishStatic(int $campaignId): void
    {
        (new self)->finish($campaignId);
    }

    public function finish(int $campaignId): void
    {
        $c = EmailCampaign::find($campaignId);
        if (! $c || in_array($c->status, ['completed', 'failed'], true)) {
            return;
        }
        $pending = EmailCampaignLog::where('campaign_id', $campaignId)->whereIn('status', ['queued', 'sending'])->count();
        if ($pending > 0 && $c->status !== 'cancelled') {
            // Batch ended with unsent rows (a chunk job failed hard). Surface it instead of claiming success.
            EmailCampaignLog::where('campaign_id', $campaignId)->whereIn('status', ['queued', 'sending'])
                ->update(['status' => 'failed', 'error' => 'not sent: worker job failed']);
            EmailCampaign::whereKey($campaignId)->increment('failed_count', $pending);
        }
        $c->refresh();
        $status = $c->status === 'cancelled' ? 'cancelled' : (($c->total_recipients > 0 && $c->sent_count === 0) ? 'failed' : 'completed');
        $c->update(['status' => $status, 'finished_at' => now()]);
    }
}
