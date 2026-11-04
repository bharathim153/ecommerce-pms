<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ProductImageController extends Controller
{
    public const RULE = ['required', 'file', 'mimes:jpg,jpeg,png,webp,gif', 'mimetypes:image/jpeg,image/png,image/webp,image/gif', 'max:5120', 'dimensions:max_width=5000,max_height=5000'];

    public function store(Request $request, Product $product): JsonResponse
    {
        $request->validate([
            'images' => ['required', 'array', 'min:1', 'max:10'],
            'images.*' => self::RULE,
        ]);

        $hasPrimary = $product->images()->where('is_primary', true)->exists();
        $order = (int) $product->images()->max('sort_order');
        $created = [];

        foreach ($request->file('images') as $file) {
            // Server-generated name; extension derived from detected MIME, never the client's.
            $path = $file->storeAs("products/{$product->id}", Str::uuid().'.'.$file->extension(), 'public');
            $created[] = $product->images()->create([
                'path' => $path,
                'alt' => Str::limit(pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME), 200, ''),
                'sort_order' => ++$order,
                'is_primary' => ! $hasPrimary && ! $created,
            ]);
        }

        return $this->ok(
            $product->images()->get()->map(fn ($i) => $this->row($i)),
            count($created).' image(s) uploaded.',
            201
        );
    }

    public function setPrimary(Product $product, ProductImage $image): JsonResponse
    {
        abort_unless($image->product_id === $product->id, 404);
        $product->images()->update(['is_primary' => false]);
        $image->update(['is_primary' => true]);

        return $this->ok(null, 'Primary image updated.');
    }

    public function destroy(Product $product, ProductImage $image): JsonResponse
    {
        abort_unless($image->product_id === $product->id, 404);
        Storage::disk('public')->delete($image->path);
        $wasPrimary = $image->is_primary;
        $image->delete();

        if ($wasPrimary) {
            $product->images()->first()?->update(['is_primary' => true]);
        }

        return $this->ok(null, 'Image deleted.');
    }

    /** Inline image for the rich-text editor (not attached to a product). */
    public function editorUpload(Request $request): JsonResponse
    {
        $request->validate(['image' => self::RULE]);
        $file = $request->file('image');
        $path = $file->storeAs('editor', Str::uuid().'.'.$file->extension(), 'public');

        return $this->ok(['url' => Storage::disk('public')->url($path)], 'Uploaded.', 201);
    }

    private function row(ProductImage $i): array
    {
        return ['id' => $i->id, 'url' => Storage::disk('public')->url($i->path), 'alt' => $i->alt, 'is_primary' => $i->is_primary, 'sort_order' => $i->sort_order];
    }
}
