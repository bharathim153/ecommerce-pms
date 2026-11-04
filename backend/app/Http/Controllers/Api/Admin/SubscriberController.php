<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\EmailSubscriber;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class SubscriberController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = EmailSubscriber::query()
            ->when($request->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('email', 'like', '%'.addcslashes($s, '%_\\').'%')->orWhere('name', 'like', '%'.addcslashes($s, '%_\\').'%')))
            ->when($request->query('status') === 'subscribed', fn ($q) => $q->where('is_subscribed', true)->whereNull('bounced_at'))
            ->when($request->query('status') === 'unsubscribed', fn ($q) => $q->where('is_subscribed', false))
            ->when($request->query('status') === 'bounced', fn ($q) => $q->whereNotNull('bounced_at'));

        $page = $q->latest('id')->paginate(min((int) $request->query('per_page', 20), 100));
        $stats = [
            'subscribed' => EmailSubscriber::where('is_subscribed', true)->whereNull('bounced_at')->count(),
            'unsubscribed' => EmailSubscriber::where('is_subscribed', false)->count(),
            'bounced' => EmailSubscriber::whereNotNull('bounced_at')->count(),
        ];

        return $this->ok(['items' => $page->items(), 'stats' => $stats, 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]]);
    }

    public function store(Request $request): JsonResponse
    {
        $d = $request->validate([
            'email' => ['required', 'email:rfc', 'max:255'],
            'name' => ['nullable', 'string', 'max:255'],
            'consent_confirmed' => ['accepted'],
        ], ['consent_confirmed.accepted' => 'Confirm that this person agreed to receive marketing email.']);

        $email = Str::lower($d['email']);
        $existing = EmailSubscriber::where('email', $email)->first();
        if ($existing) {
            // An admin must never silently re-subscribe someone who opted out.
            return $this->fail($existing->is_subscribed ? 'This email is already subscribed.' : 'This person unsubscribed and can only opt back in themselves.', 409);
        }

        return $this->ok($this->make($email, $d['name'] ?? null, 'manual'), 'Subscriber added.', 201);
    }

    /** Admins may unsubscribe someone; re-subscribing is deliberately not offered. */
    public function update(Request $request, EmailSubscriber $subscriber): JsonResponse
    {
        $d = $request->validate(['name' => ['sometimes', 'nullable', 'string', 'max:255'], 'is_subscribed' => ['sometimes', 'boolean']]);
        if (array_key_exists('is_subscribed', $d)) {
            if ($d['is_subscribed'] && ! $subscriber->is_subscribed) {
                return $this->fail('Only the subscriber can opt back in.', 422);
            }
            if (! $d['is_subscribed'] && $subscriber->is_subscribed) {
                $d['unsubscribed_at'] = now();
            }
        }
        $subscriber->update($d);

        return $this->ok($subscriber->fresh(), 'Subscriber updated.');
    }

    public function destroy(EmailSubscriber $subscriber): JsonResponse
    {
        $subscriber->delete();

        return $this->ok(null, 'Subscriber deleted.');
    }

    /**
     * CSV: first column email (header optional), second optional name.
     * Existing rows are never touched, so an import can't re-subscribe someone who opted out.
     */
    public function import(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'mimes:csv,txt', 'max:5120'],
            'consent_confirmed' => ['accepted'],
        ], ['consent_confirmed.accepted' => 'Confirm that everyone in this file agreed to receive marketing email.']);

        $fh = fopen($request->file('file')->getRealPath(), 'r');
        $stats = ['added' => 0, 'already_exists' => 0, 'invalid' => 0, 'duplicate_in_file' => 0];
        $seen = [];
        $batch = [];
        $rows = 0;
        $first = true;

        while (($row = fgetcsv($fh)) !== false) {
            if ($row === [null] || $row === []) {
                continue;
            }
            $email = Str::lower(trim((string) ($row[0] ?? '')));
            if ($first) {
                $first = false;
                if (in_array($email, ['email', 'e-mail', 'email address'], true)) {
                    continue; // header row
                }
            }
            if (++$rows > config('campaigns.max_import_rows')) {
                fclose($fh);

                return $this->fail('File has more than '.config('campaigns.max_import_rows').' rows. Split it and import in parts.', 422);
            }
            if (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) {
                $stats['invalid']++;
                continue;
            }
            if (isset($seen[$email])) {
                $stats['duplicate_in_file']++;
                continue;
            }
            $seen[$email] = true;
            $batch[$email] = mb_substr(trim((string) ($row[1] ?? '')), 0, 255) ?: null;
        }
        fclose($fh);

        foreach (array_chunk($batch, 1000, true) as $chunk) {
            $existing = EmailSubscriber::whereIn('email', array_keys($chunk))->pluck('email')->all();
            $stats['already_exists'] += count($existing);
            $now = now();
            $rowsToInsert = [];
            foreach ($chunk as $email => $name) {
                if (in_array($email, $existing, true)) {
                    continue;
                }
                $rowsToInsert[] = ['email' => $email, 'name' => $name, 'is_subscribed' => true, 'unsubscribe_token' => Str::random(48), 'subscribed_at' => $now, 'source' => 'import', 'created_at' => $now, 'updated_at' => $now];
            }
            if ($rowsToInsert) {
                $stats['added'] += DB::table('email_subscribers')->insertOrIgnore($rowsToInsert);
            }
        }

        return $this->ok($stats, "Import finished: {$stats['added']} added.");
    }

    public function export(Request $request): StreamedResponse
    {
        $status = $request->query('status');

        return response()->streamDownload(function () use ($status) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['email', 'name', 'status', 'subscribed_at', 'unsubscribed_at', 'source']);
            EmailSubscriber::query()
                ->when($status === 'subscribed', fn ($q) => $q->where('is_subscribed', true)->whereNull('bounced_at'))
                ->when($status === 'unsubscribed', fn ($q) => $q->where('is_subscribed', false))
                ->orderBy('id')->chunkById(2000, function ($rows) use ($out) {
                    foreach ($rows as $s) {
                        fputcsv($out, array_map([self::class, 'csvSafe'], [
                            $s->email, $s->name, $s->bounced_at ? 'bounced' : ($s->is_subscribed ? 'subscribed' : 'unsubscribed'),
                            $s->subscribed_at?->toDateTimeString(), $s->unsubscribed_at?->toDateTimeString(), $s->source,
                        ]));
                    }
                });
            fclose($out);
        }, 'subscribers-'.now()->format('Ymd').'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** Neutralise spreadsheet formula injection (=, +, -, @) in exported cells. */
    public static function csvSafe(?string $v): ?string
    {
        return ($v !== null && $v !== '' && str_contains('=+-@', $v[0])) ? "'".$v : $v;
    }

    public static function make(string $email, ?string $name, string $source, ?int $userId = null): EmailSubscriber
    {
        return EmailSubscriber::create([
            'user_id' => $userId, 'email' => $email, 'name' => $name, 'is_subscribed' => true,
            'unsubscribe_token' => Str::random(48), 'subscribed_at' => now(), 'source' => $source,
        ]);
    }
}
