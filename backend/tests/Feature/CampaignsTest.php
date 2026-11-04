<?php

namespace Tests\Feature;

use App\Jobs\SendCampaignChunk;
use App\Mail\CampaignMail;
use App\Models\EmailCampaign;
use App\Models\EmailCampaignLog;
use App\Models\EmailSubscriber;
use App\Models\Role;
use App\Models\User;
use App\Services\Campaigns\CampaignRenderer;
use Illuminate\Bus\PendingBatch;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

class CampaignsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        EmailCampaignLog::query()->delete();
        EmailCampaign::query()->delete();
        EmailSubscriber::query()->delete(); // rolled back at the end of each test
        config(['campaigns.mailgun_signing_key' => 'mg-signing-key', 'campaigns.chunk_size' => 25]);
    }

    private function admin(): User { return User::where('email', 'admin@example.com')->first(); }

    private function sub(string $email, array $o = []): EmailSubscriber
    {
        return EmailSubscriber::create($o + ['email' => $email, 'name' => Str::before($email, '@'), 'is_subscribed' => true, 'unsubscribe_token' => Str::random(48), 'subscribed_at' => now(), 'source' => 'manual']);
    }

    private function draft(string $body = '<p>Hello {{name}}</p>'): EmailCampaign
    {
        return EmailCampaign::create(['created_by' => $this->admin()->id, 'subject' => 'Sale, {{name}}!', 'body_html' => $body, 'status' => 'draft']);
    }

    /** Run every queued chunk job by hand (Bus is faked so nothing runs automatically). */
    private function runBatch(): void
    {
        $jobs = [];
        Bus::assertBatched(function (PendingBatch $b) use (&$jobs) { $jobs = $b->jobs->all(); return true; });
        foreach ($jobs as $j) { $j->handle(app(CampaignRenderer::class)); }
    }

    // ---------- templates ----------

    public function test_template_html_is_sanitised_and_preview_matches_what_is_sent(): void
    {
        $r = $this->actingAs($this->admin(), 'sanctum')->postJson('/api/admin/email/templates', [
            'name' => 'Welcome', 'subject' => 'Hi {{name}}',
            'body_html' => '<h1 style="color:#c00">Big news</h1><script>alert(1)</script><a href="javascript:evil()">x</a><img src="https://x.test/a.png" onerror="e()"><table><tr><td style="padding:8px">cell</td></tr></table>',
        ])->assertCreated();
        $html = $r->json('data.body_html');
        $this->assertStringNotContainsString('<script', $html);
        $this->assertStringNotContainsString('javascript:', $html);
        $this->assertStringNotContainsString('onerror', $html);
        $this->assertStringContainsString('color:#c00', $html);
        $this->assertStringContainsString('<table', $html);

        $p = $this->actingAs($this->admin(), 'sanctum')->postJson('/api/admin/email/preview', ['subject' => 'Hi {{name}}', 'body_html' => 'Dear {{name}} <p>{{unsubscribe_url}}</p>'])->assertOk();
        $this->assertSame('Hi there', $p->json('data.subject'));
        $this->assertStringContainsString('Unsubscribe', $p->json('data.html'), 'compliance footer is always present');
        $this->assertStringContainsString(config('campaigns.footer_address'), $p->json('data.html'));
    }

    public function test_only_admins_can_manage_email(): void
    {
        $c = User::factory()->create(['role_id' => Role::where('name', 'customer')->value('id')]);
        foreach (['templates', 'subscribers', 'campaigns'] as $p) {
            $this->actingAs($c, 'sanctum')->getJson("/api/admin/email/$p")->assertForbidden();
        }
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/admin/email/campaigns')->assertUnauthorized();
    }

    // ---------- subscribers ----------

    public function test_adding_a_subscriber_requires_consent_and_never_resubscribes_an_optout(): void
    {
        $a = $this->actingAs($this->admin(), 'sanctum');
        $a->postJson('/api/admin/email/subscribers', ['email' => 'new@example.com'])->assertStatus(422);
        $a->postJson('/api/admin/email/subscribers', ['email' => 'New@Example.com', 'consent_confirmed' => true])->assertCreated();
        $this->assertTrue(EmailSubscriber::where('email', 'new@example.com')->exists(), 'emails are normalised to lowercase');
        $a->postJson('/api/admin/email/subscribers', ['email' => 'new@example.com', 'consent_confirmed' => true])->assertStatus(409);

        $out = $this->sub('out@example.com', ['is_subscribed' => false, 'unsubscribed_at' => now()]);
        $a->postJson('/api/admin/email/subscribers', ['email' => 'out@example.com', 'consent_confirmed' => true])->assertStatus(409);
        $a->patchJson("/api/admin/email/subscribers/{$out->id}", ['is_subscribed' => true])->assertStatus(422);
        $this->assertFalse($out->fresh()->is_subscribed);
    }

    public function test_csv_import_validates_dedupes_and_does_not_touch_existing_or_unsubscribed(): void
    {
        $this->sub('exists@example.com');
        $this->sub('optout@example.com', ['is_subscribed' => false, 'unsubscribed_at' => now()]);
        $csv = "email,name\nfresh1@example.com,Fresh One\nFRESH1@example.com,Dup\nnot-an-email,Bad\nexists@example.com,Existing\noptout@example.com,Optout\nfresh2@example.com\n\n";
        $file = UploadedFile::fake()->createWithContent('list.csv', $csv);

        $this->actingAs($this->admin(), 'sanctum')->postJson('/api/admin/email/subscribers/import', ['file' => $file])->assertStatus(422); // no consent
        $r = $this->actingAs($this->admin(), 'sanctum')->post('/api/admin/email/subscribers/import', ['file' => UploadedFile::fake()->createWithContent('list.csv', $csv), 'consent_confirmed' => '1'], ['Accept' => 'application/json'])->assertOk();

        $this->assertSame(['added' => 2, 'already_exists' => 2, 'invalid' => 1, 'duplicate_in_file' => 1], $r->json('data'));
        $this->assertFalse(EmailSubscriber::where('email', 'optout@example.com')->first()->is_subscribed, 'import must not re-opt-in');
        $this->assertSame('import', EmailSubscriber::where('email', 'fresh2@example.com')->value('source'));
    }

    public function test_csv_export_neutralises_formula_injection(): void
    {
        $this->sub('x@example.com', ['name' => '=HYPERLINK("http://evil","click")']);
        $res = $this->actingAs($this->admin(), 'sanctum')->get('/api/admin/email/subscribers/export')->assertOk();
        $body = $res->streamedContent();
        $this->assertStringContainsString("'=HYPERLINK", $body);
        $this->assertStringNotContainsString(',=HYPERLINK', $body);
        $this->assertStringContainsString('email,name,status', $body);
    }

    // ---------- sending ----------

    public function test_campaign_sends_only_to_eligible_once_with_unsubscribe_headers(): void
    {
        Mail::fake();
        foreach (['a', 'b', 'c'] as $n) { $this->sub("$n@example.com"); }
        $this->sub('unsub@example.com', ['is_subscribed' => false, 'unsubscribed_at' => now()]);
        $this->sub('bounced@example.com', ['bounced_at' => now()]);
        $c = $this->draft();

        $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/send", [])->assertStatus(422); // confirmation required
        $this->assertSame('draft', $c->fresh()->status);

        $r = $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/send", ['confirm' => true])->assertStatus(202);
        $this->assertSame(3, $r->json('data.total_recipients'));
        Mail::assertSent(CampaignMail::class, 3);
        Mail::assertNotSent(CampaignMail::class, fn ($m) => $m->hasTo('unsub@example.com') || $m->hasTo('bounced@example.com'));
        Mail::assertSent(CampaignMail::class, fn (CampaignMail $m) => $m->hasTo('a@example.com') && str_contains($m->htmlBody, 'Hello a') && str_contains($m->htmlBody, '/unsubscribe?token=') && $m->unsubscribeToken !== null);

        $c->refresh();
        $this->assertSame('completed', $c->status);
        $this->assertSame(3, $c->sent_count);
        $this->assertSame(3, EmailCampaignLog::where('campaign_id', $c->id)->where('status', 'sent')->count());

        // second click / second admin / retried request
        $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/send", ['confirm' => true])->assertStatus(409);
        Mail::assertSent(CampaignMail::class, 3);
    }

    public function test_mail_headers_include_one_click_list_unsubscribe(): void
    {
        $s = $this->sub('h@example.com');
        $m = new CampaignMail('Subj', '<p>x</p>', $s->unsubscribe_token);
        $m->build();
        $symfony = null;
        foreach ($m->callbacks as $cb) { $symfony ??= new \Symfony\Component\Mime\Email(); $cb($symfony); }
        $this->assertStringContainsString('/api/unsubscribe/'.$s->unsubscribe_token, $symfony->getHeaders()->get('List-Unsubscribe')->getBodyAsString());
        $this->assertSame('List-Unsubscribe=One-Click', $symfony->getHeaders()->get('List-Unsubscribe-Post')->getBodyAsString());
    }

    public function test_large_list_is_split_into_batched_chunk_jobs_and_nothing_is_sent_synchronously(): void
    {
        Mail::fake();
        Bus::fake();
        $rows = [];
        for ($i = 0; $i < 1000; $i++) {
            $rows[] = ['email' => "bulk$i@example.com", 'name' => "B$i", 'is_subscribed' => 1, 'unsubscribe_token' => Str::random(48), 'subscribed_at' => now(), 'source' => 'import', 'created_at' => now(), 'updated_at' => now()];
        }
        foreach (array_chunk($rows, 500) as $ch) { \DB::table('email_subscribers')->insert($ch); }
        $c = $this->draft();

        $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/send", ['confirm' => true])->assertStatus(202);

        Mail::assertNothingSent(); // the HTTP request only enqueues
        Bus::assertBatched(fn (PendingBatch $b) => $b->jobs->count() === 40 && $b->jobs->every(fn ($j) => $j instanceof SendCampaignChunk && count($j->logIds) === 25));
        $this->assertSame(1000, EmailCampaignLog::where('campaign_id', $c->id)->where('status', 'queued')->count());
    }

    public function test_unsubscribe_after_queueing_is_respected_and_a_rerun_chunk_cannot_double_send(): void
    {
        Mail::fake();
        Bus::fake();
        $keep = $this->sub('keep@example.com');
        $late = $this->sub('late@example.com');
        $c = $this->draft();
        $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/send", ['confirm' => true])->assertStatus(202);

        $this->postJson('/api/unsubscribe/'.$late->unsubscribe_token)->assertOk(); // clicks unsubscribe while emails are still queued

        $this->runBatch();
        $this->runBatch(); // duplicate delivery of the same jobs (at-least-once queues)

        Mail::assertSent(CampaignMail::class, 1);
        Mail::assertSent(CampaignMail::class, fn ($m) => $m->hasTo('keep@example.com'));
        $this->assertSame('skipped', EmailCampaignLog::where('subscriber_id', $late->id)->value('status'));
        $this->assertSame(1, $c->fresh()->skipped_count);
        $this->assertSame(1, $c->fresh()->sent_count);
    }

    public function test_cancel_skips_unsent_emails(): void
    {
        Mail::fake();
        Bus::fake();
        $this->sub('one@example.com');
        $c = $this->draft();
        $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/send", ['confirm' => true])->assertStatus(202);
        $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/cancel")->assertOk();
        $this->runBatch();
        Mail::assertNothingSent();
        $this->assertSame('skipped', EmailCampaignLog::where('campaign_id', $c->id)->value('status'));
        $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/cancel")->assertStatus(409);
    }

    public function test_send_failure_is_recorded_per_recipient_and_others_still_go_out(): void
    {
        $this->sub('ok@example.com');
        $this->sub('boom@example.com');
        Mail::shouldReceive('to')->andReturnUsing(function ($email) {
            $m = \Mockery::mock();
            $m->shouldReceive('send')->andReturnUsing(fn () => $email === 'boom@example.com' ? throw new \RuntimeException('550 mailbox unavailable') : null);

            return $m;
        });
        $c = $this->draft();
        $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/send", ['confirm' => true])->assertStatus(202);

        $c->refresh();
        $this->assertSame(1, $c->sent_count);
        $this->assertSame(1, $c->failed_count);
        $this->assertSame('completed', $c->status);
        $this->assertStringContainsString('550', EmailCampaignLog::where('status', 'failed')->value('error'));
    }

    public function test_only_drafts_can_be_edited_and_empty_campaigns_are_refused(): void
    {
        $c = $this->draft('<p> </p>');
        $this->actingAs($this->admin(), 'sanctum')->postJson("/api/admin/email/campaigns/{$c->id}/send", ['confirm' => true])->assertStatus(422);
        $c->update(['status' => 'completed']);
        $this->actingAs($this->admin(), 'sanctum')->putJson("/api/admin/email/campaigns/{$c->id}", ['subject' => 'x', 'body_html' => '<p>y</p>'])->assertStatus(409);
    }

    // ---------- unsubscribe + preferences ----------

    public function test_public_unsubscribe_is_post_only_masked_and_reversible_by_the_subscriber(): void
    {
        $s = $this->sub('alice@example.com');
        $this->getJson('/api/unsubscribe/'.$s->unsubscribe_token)->assertOk()->assertJsonPath('data.email', 'al•••@example.com')->assertJsonPath('data.subscribed', true);
        $this->assertTrue($s->fresh()->is_subscribed, 'a GET (link scanner / prefetch) must not unsubscribe');
        $this->postJson('/api/unsubscribe/'.$s->unsubscribe_token)->assertOk();
        $this->assertFalse($s->fresh()->is_subscribed);
        $this->assertNotNull($s->fresh()->unsubscribed_at);
        $this->postJson('/api/unsubscribe/'.$s->unsubscribe_token)->assertOk(); // idempotent
        $this->postJson('/api/unsubscribe/nope')->assertNotFound();
        $this->postJson('/api/resubscribe/'.$s->unsubscribe_token)->assertOk();
        $this->assertTrue($s->fresh()->is_subscribed);
    }

    public function test_signup_consent_is_explicit_and_account_toggle_works(): void
    {
        $base = ['name' => 'Opt In', 'password' => 'Passw0rdX', 'password_confirmation' => 'Passw0rdX'];
        $this->postJson('/api/auth/register', $base + ['email' => 'no@consent.test'])->assertCreated();
        $this->assertFalse(EmailSubscriber::where('email', 'no@consent.test')->exists(), 'no consent, no subscription');

        $r = $this->postJson('/api/auth/register', $base + ['email' => 'yes@consent.test', 'marketing_opt_in' => true])->assertCreated();
        $sub = EmailSubscriber::where('email', 'yes@consent.test')->first();
        $this->assertTrue($sub->is_subscribed);
        $this->assertSame('signup', $sub->source);
        $this->assertNotNull($sub->user_id);

        $token = $r->json('data.token');
        $this->withToken($token)->getJson('/api/auth/marketing')->assertJsonPath('data.subscribed', true);
        $this->withToken($token)->patchJson('/api/auth/marketing', ['subscribed' => false])->assertOk();
        $this->assertFalse($sub->fresh()->is_subscribed);
        $this->withToken($token)->patchJson('/api/auth/marketing', ['subscribed' => true])->assertOk();
        $this->assertTrue($sub->fresh()->is_subscribed);
    }

    // ---------- Mailgun delivery feedback ----------

    private function mg(string $event, string $msgId, array $extra = [], ?string $key = null): \Illuminate\Testing\TestResponse
    {
        $ts = (string) time();
        $tok = Str::random(40);

        return $this->postJson('/api/webhooks/mailgun', [
            'signature' => ['timestamp' => $ts, 'token' => $tok, 'signature' => hash_hmac('sha256', $ts.$tok, $key ?? 'mg-signing-key')],
            'event-data' => ['event' => $event, 'message' => ['headers' => ['message-id' => $msgId]]] + $extra,
        ]);
    }

    private function sentLog(): array
    {
        $s = $this->sub('mg@example.com');
        $c = $this->draft();
        $c->update(['status' => 'completed', 'total_recipients' => 1, 'sent_count' => 1]);
        $log = EmailCampaignLog::create(['campaign_id' => $c->id, 'subscriber_id' => $s->id, 'status' => 'sent', 'provider_message_id' => 'abc123@mg.test', 'sent_at' => now()]);

        return [$c, $s, $log];
    }

    public function test_mailgun_webhook_requires_valid_signature(): void
    {
        [, , $log] = $this->sentLog();
        $this->mg('delivered', 'abc123@mg.test', [], 'wrong-key')->assertStatus(400);
        $this->assertSame('sent', $log->fresh()->status);
        $this->postJson('/api/webhooks/mailgun', ['event-data' => ['event' => 'delivered']])->assertStatus(400);
    }

    public function test_mailgun_delivered_bounce_and_complaint_update_logs_and_subscribers(): void
    {
        [$c, $s, $log] = $this->sentLog();

        $this->mg('delivered', '<abc123@mg.test>')->assertOk()->assertJsonPath('data.result', 'delivered');
        $this->assertSame('delivered', $log->fresh()->status);
        $this->mg('delivered', 'abc123@mg.test'); // replay
        $this->assertSame(1, $c->fresh()->delivered_count);

        $this->mg('failed', 'abc123@mg.test', ['severity' => 'temporary'])->assertJsonPath('data.result', 'ignored');
        $this->assertSame('delivered', $log->fresh()->status);

        $this->mg('failed', 'abc123@mg.test', ['severity' => 'permanent', 'delivery-status' => ['description' => 'No such user']])->assertJsonPath('data.result', 'bounced');
        $this->assertSame('bounced', $log->fresh()->status);
        $this->assertNotNull($s->fresh()->bounced_at, 'hard bounce suppresses future sends');

        $other = $this->sub('spam@example.com');
        $c2 = $this->draft();
        EmailCampaignLog::create(['campaign_id' => $c2->id, 'subscriber_id' => $other->id, 'status' => 'delivered', 'provider_message_id' => 'zzz@mg.test']);
        $this->mg('complained', 'zzz@mg.test')->assertOk();
        $this->assertFalse($other->fresh()->is_subscribed);

        $this->mg('delivered', 'unknown@mg.test')->assertOk()->assertJsonPath('data.result', 'unknown_message');
    }

    public function test_rate_limiter_is_derived_from_emails_per_minute(): void
    {
        config(['campaigns.emails_per_minute' => 600, 'campaigns.chunk_size' => 25]);
        $limit = \Illuminate\Support\Facades\RateLimiter::limiter('campaign-mail')();
        $this->assertSame(24, $limit->maxAttempts, '600 emails/min / 25 per chunk = 24 chunk jobs/min');
    }
}
