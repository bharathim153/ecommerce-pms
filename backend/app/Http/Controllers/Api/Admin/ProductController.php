<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use App\Services\HtmlSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ProductController extends Controller
{
    private const SORTABLE = ['id', 'name', 'sku', 'price', 'stock', 'status', 'created_at', 'updated_at'];

    public function __construct(private HtmlSanitizer $sanitizer) {}

    public function index(Request $request): JsonResponse
    {
        $sort = in_array($request->query('sort'), self::SORTABLE, true) ? $request->query('sort') : 'id';
        $dir = $request->query('direction') === 'asc' ? 'asc' : 'desc';

        $page = Product::query()->with(['category', 'images'])
            ->when($request->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q
                ->where('name', 'like', '%'.addcslashes($s, '%_\\').'%')
                ->orWhere('sku', 'like', '%'.addcslashes($s, '%_\\').'%')))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->query('category_id'), fn ($q, $c) => $q->where('category_id', $c))
            ->orderBy($sort, $dir)
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return $this->ok([
            'items' => ProductResource::collection($page->items()),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    public function show(Product $product): JsonResponse
    {
        return $this->ok(new ProductResource($product->load(['category', 'images'])));
    }

    public function store(ProductRequest $request): JsonResponse
    {
        $data = $this->payload($request);
        $data['slug'] = $this->uniqueSlug($data['name']);

        $product = Product::create($data);

        return $this->ok(new ProductResource($product->load(['category', 'images'])), 'Product created.', 201);
    }

    public function update(ProductRequest $request, Product $product): JsonResponse
    {
        $product->update($this->payload($request));

        return $this->ok(new ProductResource($product->fresh(['category', 'images'])), 'Product updated.');
    }

    public function destroy(Product $product): JsonResponse
    {
        foreach ($product->images as $img) {
            Storage::disk('public')->delete($img->path);
        }
        $product->images()->delete();
        $product->delete();

        return $this->ok(null, 'Product deleted.');
    }

    private function payload(ProductRequest $request): array
    {
        $data = $request->validated();
        $data['description'] = $this->sanitizer->clean($data['description'] ?? null);

        return $data;
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'product';
        $slug = $base;
        $i = 2;
        while (Product::withTrashed()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$i++;
        }

        return $slug;
    }
}
