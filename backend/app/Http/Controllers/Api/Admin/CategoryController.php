<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class CategoryController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:255', 'unique:categories,name']]);
        $category = Category::create($data + ['slug' => $this->slug($data['name'])]);

        return $this->ok($category, 'Category created.', 201);
    }

    public function update(Request $request, Category $category): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:255', Rule::unique('categories', 'name')->ignore($category->id)]]);
        $category->update($data + ['slug' => $this->slug($data['name'], $category->id)]);

        return $this->ok($category, 'Category updated.');
    }

    public function destroy(Category $category): JsonResponse
    {
        $category->delete(); // products.category_id is nullOnDelete

        return $this->ok(null, 'Category deleted.');
    }

    private function slug(string $name, ?int $ignore = null): string
    {
        $base = Str::slug($name) ?: 'category';
        $slug = $base;
        $i = 2;
        while (Category::where('slug', $slug)->when($ignore, fn ($q) => $q->where('id', '!=', $ignore))->exists()) {
            $slug = $base.'-'.$i++;
        }

        return $slug;
    }
}
