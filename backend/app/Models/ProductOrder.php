<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ProductOrder extends Model
{
    protected $fillable = ['number', 'user_id', 'status', 'subtotal', 'total', 'currency', 'paid_at', 'payment_note'];

    protected function casts(): array
    {
        return ['paid_at' => 'datetime'];
    }

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function items(): HasMany { return $this->hasMany(OrderItem::class, 'order_id'); }
    public function payments(): HasMany { return $this->hasMany(Payment::class, 'order_id'); }
}
