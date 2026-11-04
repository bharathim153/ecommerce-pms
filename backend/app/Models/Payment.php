<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    protected $fillable = ['order_id', 'provider', 'provider_reference', 'provider_transaction_id', 'amount', 'currency', 'status', 'raw_payload'];

    protected function casts(): array { return ['raw_payload' => 'array']; }

    public function order(): BelongsTo { return $this->belongsTo(ProductOrder::class, 'order_id'); }
}
