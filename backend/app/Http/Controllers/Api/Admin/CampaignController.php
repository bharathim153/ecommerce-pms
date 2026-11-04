<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Mail\CampaignMail;
use App\Models\EmailCampaign;
use App\Models\EmailCampaignLog;
use App\Models\EmailTemplate;
use App\Services\Campaigns\CampaignRenderer;
use App\Services\Campaigns\CampaignSender;
use App\Services\HtmlSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;

class CampaignController extends Controller
{
    public function __construct(private HtmlSanitizer $sanitizer, private CampaignRenderer $renderer, private CampaignSender $sender) {}

    public function index(Request $request): JsonResponse
    {
        $page = EmailCampaign::with('creator:id,name')->latest('id')->paginate(min((int) $request->query('per_page', 15), 100));

        return $this->ok(['items' => collect($page->items())->map(fn ($c) => $this->row($c)), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]]);
    }

    public function show(EmailCampaign $campaign): JsonResponse
    {
        return $this->ok($this->row($campaign->load('creator:id,name'), true));
    }

    public function store(Request $request): JsonResponse
    {
        $d = $request->validate([
            'template_id' => ['nullable', 'integer', 'exists:email_templates,id'],
            'subject' => ['required_without:template_id', 'nullable', 'string', 'max:255'],
            'body_html' => ['required_without:template_id', 'nullable', 'string', 'max:500000'],
        ]);
        $tpl = ! empty($d['template_id']) ? EmailTemplate::find($d['template_id']) : null;

        $campaign = EmailCampaign::create([
            'template_id' => $tpl?->id,
            'created_by' => $request->user()->id,
            'subject' => $d['subject'] ?? $tpl->subject,
            'body_html' => $this->sanitizer->cleanEmail($d['body_html'] ?? $tpl->body_html),
            'status' => 'draft',
        ]);

        return $this->ok($this->row($campaign, true), 'Campaign draft created.', 201);
    }

    public function update(Request $request, EmailCampaign $campaign): JsonResponse
    {
        if ($campaign->status !== 'draft') {
            return $this->fail('Only drafts can be edited.', 409);
        }
        $d = $request->validate(['subject' => ['required', 'string', 'max:255'], 'body_html' => ['required', 'string', 'max:500000']]);
        $campaign->update(['subject' => $d['subject'], 'body_html' => $this->sanitizer->cleanEmail($d['body_html'])]);

        return $this->ok($this->row($campaign->fresh(), true), 'Draft saved.');
    }

    public function destroy(EmailCampaign $campaign): JsonResponse
    {
        if ($campaign->status === 'sending') {
            return $this->fail('Cancel the campaign before deleting it.', 409);
        }
        $campaign->delete();

        return $this->ok(null, 'Campaign deleted.');
    }

    /** Sends one copy to the admin's own address only (never to arbitrary recipients). */
    public function test(Request $request, EmailCampaign $campaign): JsonResponse
    {
        Mail::to($request->user()->email)->send(new CampaignMail('[TEST] '.$this->renderer->renderSubject($campaign->subject, null), $this->renderer->render($campaign->body_html, null)));

        return $this->ok(null, 'Test email sent to '.$request->user()->email.'.');
    }

    public function recipients(): JsonResponse
    {
        return $this->ok(['eligible' => CampaignSender::eligible()->count()]);
    }

    public function send(Request $request, EmailCampaign $campaign): JsonResponse
    {
        $request->validate(['confirm' => ['accepted']], ['confirm.accepted' => 'Confirmation is required to send a campaign.']);

        if (trim(strip_tags($campaign->body_html)) === '' && ! str_contains($campaign->body_html, '<img')) {
            return $this->fail('The campaign has no content.', 422);
        }

        $total = $this->sender->launch($campaign);
        if ($total === null) {
            return $this->fail('This campaign has already been sent or is being sent.', 409);
        }

        return $this->ok($this->row($campaign->fresh(), true), $total === 0 ? 'No eligible subscribers.' : "Sending to {$total} subscribers.", 202);
    }

    public function cancel(EmailCampaign $campaign): JsonResponse
    {
        if (EmailCampaign::whereKey($campaign->id)->where('status', 'sending')->update(['status' => 'cancelled']) !== 1) {
            return $this->fail('Only a campaign that is sending can be cancelled.', 409);
        }

        return $this->ok($this->row($campaign->fresh(), true), 'Campaign cancelled. Unsent emails will be skipped.');
    }

    public function logs(Request $request, EmailCampaign $campaign): JsonResponse
    {
        $page = EmailCampaignLog::with('subscriber:id,email,name')->where('campaign_id', $campaign->id)
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->orderBy('id')->paginate(min((int) $request->query('per_page', 25), 100));

        return $this->ok([
            'items' => collect($page->items())->map(fn ($l) => ['id' => $l->id, 'email' => $l->subscriber?->email, 'status' => $l->status, 'error' => $l->error, 'sent_at' => $l->sent_at, 'delivered_at' => $l->delivered_at]),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    private function row(EmailCampaign $c, bool $full = false): array
    {
        $byStatus = EmailCampaignLog::where('campaign_id', $c->id)->selectRaw('status, count(*) n')->groupBy('status')->pluck('n', 'status');
        $row = [
            'id' => $c->id, 'subject' => $c->subject, 'status' => $c->status, 'template_id' => $c->template_id,
            'total_recipients' => $c->total_recipients,
            'counts' => [
                'queued' => (int) (($byStatus['queued'] ?? 0) + ($byStatus['sending'] ?? 0)),
                'sent' => (int) (($byStatus['sent'] ?? 0) + ($byStatus['delivered'] ?? 0) + ($byStatus['bounced'] ?? 0)),
                'delivered' => (int) ($byStatus['delivered'] ?? 0),
                'failed' => (int) ($byStatus['failed'] ?? 0),
                'bounced' => (int) ($byStatus['bounced'] ?? 0),
                'skipped' => (int) ($byStatus['skipped'] ?? 0),
            ],
            'created_by' => $c->creator?->name, 'started_at' => $c->started_at, 'finished_at' => $c->finished_at, 'created_at' => $c->created_at,
        ];

        return $full ? $row + ['body_html' => $c->body_html] : $row;
    }
}
