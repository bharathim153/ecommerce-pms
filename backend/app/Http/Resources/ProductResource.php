<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

/** @mixin \App\Models\Product */
class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $images = $this->whenLoaded('images', fn () => $this->images->map(fn ($i) => [
            'id' => $i->id,
            'url' => Storage::disk('public')->url($i->path),
            'alt' => $i->alt,
            'is_primary' => $i->is_primary,
            'sort_order' => $i->sort_order,
        ])->values());

        $primary = $this->relationLoaded('images')
            ? ($this->images->firstWhere('is_primary', true) ?? $this->images->first())
            : null;

        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'sku' => $this->sku,
            'price' => $this->price,
            'stock' => $this->stock,
            'status' => $this->status,
            'short_description' => $this->short_description,
            'description' => $this->when($request->routeIs('*.show', '*.store', '*.update') || $request->boolean('with_description'), $this->description),
            'category' => $this->whenLoaded('category', fn () => $this->category ? ['id' => $this->category->id, 'name' => $this->category->name, 'slug' => $this->category->slug] : null),
            'category_id' => $this->category_id,
            'images' => $images,
            'primary_image' => $primary ? Storage::disk('public')->url($primary->path) : null,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
