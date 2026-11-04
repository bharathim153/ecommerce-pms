<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmailSubscriber;
use Illuminate\Http\JsonResponse;

class UnsubscribeController extends Controller
{
    /** Lets the frontend page show who is unsubscribing (masked) without revealing the full address. */
    public function show(string $token): JsonResponse
    {
        $s = EmailSubscriber::where('unsubscribe_token', $token)->first();
        if (! $s) {
            return $this->fail('This unsubscribe link is not valid.', 404);
        }
        [$local, $domain] = explode('@', $s->email, 2) + ['', ''];

        return $this->ok(['email' => substr($local, 0, 2).str_repeat('•', max(1, strlen($local) - 2)).'@'.$domain, 'subscribed' => $s->is_subscribed]);
    }

    /** POST so link scanners / prefetchers can't unsubscribe people by merely fetching a URL. Also serves RFC 8058 one-click. */
    public function unsubscribe(string $token): JsonResponse
    {
        $s = EmailSubscriber::where('unsubscribe_token', $token)->first();
        if (! $s) {
            return $this->fail('This unsubscribe link is not valid.', 404);
        }
        if ($s->is_subscribed) {
            $s->update(['is_subscribed' => false, 'unsubscribed_at' => now()]);
        }

        return $this->ok(null, 'You have been unsubscribed.');
    }

    /** Subscriber changes their own mind (token holder only). */
    public function resubscribe(string $token): JsonResponse
    {
        $s = EmailSubscriber::where('unsubscribe_token', $token)->first();
        if (! $s) {
            return $this->fail('This link is not valid.', 404);
        }
        if (! $s->is_subscribed) {
            $s->update(['is_subscribed' => true, 'unsubscribed_at' => null, 'subscribed_at' => now()]);
        }

        return $this->ok(null, 'You are subscribed again.');
    }
}
