<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $users = User::with('role')
            ->when($request->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', "%{$s}%")->orWhere('email', 'like', "%{$s}%")))
            ->when($request->query('role'), fn ($q, $r) => $q->whereHas('role', fn ($q) => $q->where('name', $r)))
            ->latest('id')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return $this->ok($users);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'mfa_enabled' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        if ($user->id === $request->user()->id && ($data['is_active'] ?? true) === false) {
            return $this->fail('You cannot deactivate your own account.', 422);
        }

        $user->update($data);
        if (($data['is_active'] ?? true) === false) {
            $user->tokens()->delete();
        }

        return $this->ok($user->load('role'), 'User updated.');
    }
}
