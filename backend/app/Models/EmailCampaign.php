<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class EmailCampaign extends Model
{
    protected $fillable = ['template_id', 'created_by', 'subject', 'body_html', 'status', 'total_recipients', 'sent_count', 'failed_count', 'delivered_count', 'bounced_count', 'skipped_count', 'started_at', 'finished_at'];

    protected function casts(): array { return ['started_at' => 'datetime', 'finished_at' => 'datetime']; }

    public function template(): BelongsTo { return $this->belongsTo(EmailTemplate::class, 'template_id'); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function logs(): HasMany { return $this->hasMany(EmailCampaignLog::class, 'campaign_id'); }
}
