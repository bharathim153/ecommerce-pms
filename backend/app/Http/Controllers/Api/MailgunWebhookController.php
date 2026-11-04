<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmailCampaign;
use App\Models\EmailCampaignLog;
use App\Models\EmailSubscriber;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Delivery feedback from Mailgun: delivered / permanent bounce / spam complaint. */
class MailgunWebhookController extends Controller
{
    public function handle(Request $request): JsonResponse
    {
        $key = config('campaigns.mailgun_signing_key');
        $sig = $request->input('signature', []);
        $ts = (string) ($sig['timestamp'] ?? '');
        $token = (string) ($sig['token'] ?? '');

        $valid = $key && $ts !== '' && $token !== ''
            && hash_equals(hash_hmac('sha256', $ts.$token, $key), (string) ($sig['signature'] ?? ''))
            && abs(time() - (int) $ts) < 600;
        if (! $valid) {
            return $this->fail('Invalid signature.', 400);
        }

        $e = $request->input('event-data', []);
        $messageId = trim((string) ($e['message']['headers']['message-id'] ?? ''), '<> ');
        $log = $messageId ? EmailCampaignLog::where('provider_message_id', $messageId)->first() : null;
        if (! $log) {
            return $this->ok(['result' => 'unknown_message']); // 200 so Mailgun doesn't retry forever
        }

        $event = $e['event'] ?? '';
        $result = 'ignored';

        if ($event === 'delivered' && $log->status === 'sent') {
            $log->update(['status' => 'delivered', 'delivered_at' => now()]);
            EmailCampaign::whereKey($log->campaign_id)->increment('delivered_count');
            $result = 'delivered';
        } elseif ($event === 'failed' && ($e['severity'] ?? '') === 'permanent' && in_array($log->status, ['sent', 'delivered'], true)) {
            $log->update(['status' => 'bounced', 'error' => mb_substr((string) ($e['delivery-status']['description'] ?? 'bounced'), 0, 500)]);
            EmailCampaign::whereKey($log->campaign_id)->increment('bounced_count');
            EmailSubscriber::whereKey($log->subscriber_id)->update(['bounced_at' => now()]); // never mail a hard bounce again
            $result = 'bounced';
        } elseif ($event === 'complained') {
            EmailSubscriber::whereKey($log->subscriber_id)->update(['is_subscribed' => false, 'unsubscribed_at' => now()]);
            $result = 'complaint_unsubscribed';
        }

        return $this->ok(['result' => $result]);
    }
}
