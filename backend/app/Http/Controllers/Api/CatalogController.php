<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProductResource;
use App\Models\Category;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Public, read-only storefront endpoints. Only published products are exposed. */
class CatalogController extends Controller
{
    public function categories(): JsonResponse
    {
        return $this->ok(Category::withCount(['products' => fn ($q) => $q->published()])->orderBy('name')->get());
    }

    public function index(Request $request): JsonResponse
    {
        $sort = match ($request->query('sort')) {
            'price_asc' => ['price', 'asc'],
            'price_desc' => ['price', 'desc'],
            'name' => ['name', 'asc'],
            default => ['id', 'desc'],
        };

        $page = Product::published()->with(['category', 'images'])
            ->when($request->query('search'), fn ($q, $s) => $q->where('name', 'like', '%'.addcslashes($s, '%_\\').'%'))
            ->when($request->query('category'), fn ($q, $c) => $q->whereHas('category', fn ($q) => $q->where('slug', $c)))
            ->when($request->query('min_price'), fn ($q, $v) => $q->where('price', '>=', $v))
            ->when($request->query('max_price'), fn ($q, $v) => $q->where('price', '<=', $v))
            ->orderBy(...$sort)
            ->paginate(min((int) $request->query('per_page', 12), 48));

        return $this->ok([
            'items' => ProductResource::collection($page->items()),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    public function show(string $slug): JsonResponse
    {
        $product = Product::published()->with(['category', 'images'])->where('slug', $slug)->firstOrFail();

        request()->merge(['with_description' => true]);

        return $this->ok(new ProductResource($product));
    }
}
