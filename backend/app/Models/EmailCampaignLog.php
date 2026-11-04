<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmailCampaignLog extends Model
{
    protected $fillable = ['campaign_id', 'subscriber_id', 'status', 'provider_message_id', 'error', 'sent_at', 'delivered_at'];

    protected function casts(): array { return ['sent_at' => 'datetime', 'delivered_at' => 'datetime']; }

    public function campaign(): BelongsTo { return $this->belongsTo(EmailCampaign::class, 'campaign_id'); }
    public function subscriber(): BelongsTo { return $this->belongsTo(EmailSubscriber::class, 'subscriber_id'); }
}
