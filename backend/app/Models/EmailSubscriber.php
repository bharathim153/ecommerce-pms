<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmailSubscriber extends Model
{
    protected $fillable = ['user_id', 'email', 'name', 'is_subscribed', 'unsubscribe_token', 'subscribed_at', 'unsubscribed_at', 'bounced_at', 'source'];

    protected function casts(): array
    {
        return ['is_subscribed' => 'boolean', 'subscribed_at' => 'datetime', 'unsubscribed_at' => 'datetime', 'bounced_at' => 'datetime'];
    }

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
