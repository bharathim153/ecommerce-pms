<?php

namespace App\Jobs;

use App\Mail\CampaignMail;
use App\Models\EmailCampaign;
use App\Models\EmailCampaignLog;
use App\Services\Campaigns\CampaignRenderer;
use Illuminate\Bus\Batchable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Sends one slice of a campaign. Safe to run twice: each recipient is claimed with an atomic
 * queued -> sending update, so a duplicate or retried job can never email the same person again.
 */
class SendCampaignChunk implements ShouldQueue
{
    use Batchable, Queueable;

    /** Rate-limit releases must not burn attempts, so cap by exceptions + a deadline instead. */
    public int $tries = 0;
    public int $maxExceptions = 3;
    public int $timeout = 300;

    /** @param int[] $logIds */
    public function __construct(public int $campaignId, public array $logIds) {}

    public function retryUntil(): \DateTimeInterface
    {
        return now()->addHours(12);
    }

    public function middleware(): array
    {
        return [new RateLimited('campaign-mail')];
    }

    public function handle(CampaignRenderer $renderer): void
    {
        $campaign = EmailCampaign::find($this->campaignId);
        if (! $campaign) {
            return;
        }

        $logs = EmailCampaignLog::with('subscriber')->whereIn('id', $this->logIds)->get();

        foreach ($logs as $log) {
            // Cancelled mid-flight: stop everything not yet claimed.
            if ($campaign->fresh()->status === 'cancelled') {
                $this->skip($log, 'campaign cancelled');
                continue;
            }

            // Atomic claim. 0 rows = someone else already handled it (duplicate job / retry).
            if (EmailCampaignLog::whereKey($log->id)->where('status', 'queued')->update(['status' => 'sending']) !== 1) {
                continue;
            }

            $sub = $log->subscriber;
            // Opt-out wins even if it happened after the campaign was queued.
            if (! $sub || ! $sub->is_subscribed || $sub->bounced_at) {
                $this->skip($log, 'unsubscribed or undeliverable before send', claimed: true);
                continue;
            }

            try {
                $sent = Mail::to($sub->email)->send(new CampaignMail(
                    $renderer->renderSubject($campaign->subject, $sub),
                    $renderer->render($campaign->body_html, $sub),
                    $sub->unsubscribe_token,
                ));
                $log->update([
                    'status' => 'sent', 'sent_at' => now(),
                    'provider_message_id' => $sent ? trim($sent->getMessageId(), '<>') : null,
                ]);
                EmailCampaign::whereKey($campaign->id)->increment('sent_count');
            } catch (Throwable $e) {
                $log->update(['status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 500)]);
                EmailCampaign::whereKey($campaign->id)->increment('failed_count');
            }
        }
    }

    private function skip(EmailCampaignLog $log, string $why, bool $claimed = false): void
    {
        $q = EmailCampaignLog::whereKey($log->id)->whereIn('status', $claimed ? ['sending'] : ['queued']);
        if ($q->update(['status' => 'skipped', 'error' => $why])) {
            EmailCampaign::whereKey($this->campaignId)->increment('skipped_count');
        }
    }

    /** Worker died / exceptions exhausted: do not leave rows stuck in 'sending'. */
    public function failed(Throwable $e): void
    {
        $n = EmailCampaignLog::whereIn('id', $this->logIds)->where('status', 'sending')
            ->update(['status' => 'failed', 'error' => 'interrupted: '.mb_substr($e->getMessage(), 0, 200)]);
        if ($n) {
            EmailCampaign::whereKey($this->campaignId)->increment('failed_count', $n);
        }
    }
}
