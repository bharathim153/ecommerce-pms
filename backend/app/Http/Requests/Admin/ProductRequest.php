<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // role middleware guards the route
    }

    public function rules(): array
    {
        $id = $this->route('product')?->id;

        return [
            'name' => ['required', 'string', 'max:255'],
            'sku' => ['required', 'string', 'max:100', 'regex:/^[A-Za-z0-9._\-]+$/', Rule::unique('products', 'sku')->ignore($id)],
            'price' => ['required', 'numeric', 'min:0', 'max:9999999999'],
            'stock' => ['sometimes', 'integer', 'min:0', 'max:100000000'],
            'status' => ['required', Rule::in(['draft', 'published', 'archived'])],
            'category_id' => ['nullable', 'integer', 'exists:categories,id'],
            'short_description' => ['nullable', 'string', 'max:500'],
            'description' => ['nullable', 'string', 'max:2000000'],
        ];
    }
}
