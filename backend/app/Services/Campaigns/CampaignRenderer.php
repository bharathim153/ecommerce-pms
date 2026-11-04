<?php

namespace App\Services\Campaigns;

use App\Models\EmailSubscriber;

class CampaignRenderer
{
    public function unsubscribePage(string $token): string
    {
        return rtrim(config('app.frontend_url'), '/').'/unsubscribe?token='.$token;
    }

    /** RFC 8058 one-click endpoint (POST), used by mail clients' native unsubscribe button. */
    public function oneClickUrl(string $token): string
    {
        return url('/api/unsubscribe/'.$token);
    }

    /**
     * Merge tags + a mandatory compliance footer. $subscriber null = preview/test with sample data.
     */
    public function render(string $bodyHtml, ?EmailSubscriber $subscriber): string
    {
        $name = $subscriber?->name ?: 'there';
        $email = $subscriber?->email ?? 'subscriber@example.com';
        $unsub = $subscriber ? $this->unsubscribePage($subscriber->unsubscribe_token) : '#preview-unsubscribe';

        $body = strtr($bodyHtml, [
            '{{name}}' => e($name),
            '{{email}}' => e($email),
            '{{app_name}}' => e(config('app.name')),
            '{{unsubscribe_url}}' => e($unsub),
        ]);

        $address = e(config('campaigns.footer_address'));
        $footer = '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font:12px/1.5 Arial,sans-serif;color:#64748b;text-align:center">'
            .'<p style="margin:0 0 6px">You are receiving this email because you subscribed to updates from '.e(config('app.name')).'.</p>'
            .'<p style="margin:0 0 6px"><a href="'.e($unsub).'" style="color:#4f46e5">Unsubscribe</a> at any time.</p>'
            .'<p style="margin:0">'.$address.'</p></div>';

        return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
            .'<body style="margin:0;padding:0;background:#f1f5f9"><div style="max-width:640px;margin:0 auto;padding:24px;background:#ffffff;font:15px/1.6 Arial,sans-serif;color:#0f172a">'
            .$body.$footer.'</div></body></html>';
    }

    public function renderSubject(string $subject, ?EmailSubscriber $subscriber): string
    {
        return str_replace('{{name}}', $subscriber?->name ?: 'there', $subject);
    }
}
