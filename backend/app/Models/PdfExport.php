<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PdfExport extends Model
{
    protected $fillable = ['user_id', 'scope', 'product_ids', 'status', 'total_products', 'processed_products', 'progress', 'page_count', 'file_path', 'error', 'started_at', 'finished_at'];

    protected function casts(): array
    {
        return ['product_ids' => 'array', 'started_at' => 'datetime', 'finished_at' => 'datetime'];
    }

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
