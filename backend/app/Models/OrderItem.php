<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderItem extends Model
{
    protected $fillable = ['order_id', 'product_id', 'product_name', 'sku', 'unit_price', 'quantity', 'line_total'];

    public function order(): BelongsTo { return $this->belongsTo(ProductOrder::class, 'order_id'); }
    public function product(): BelongsTo { return $this->belongsTo(Product::class); }
}
