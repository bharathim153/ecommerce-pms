<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $prod = app()->environment('production');
        $admin = Role::firstOrCreate(['name' => 'admin'], ['label' => 'Administrator']);
        $customer = Role::firstOrCreate(['name' => 'customer'], ['label' => 'Customer']);

        $email = env('ADMIN_EMAIL', 'admin@example.com');
        $password = env('ADMIN_PASSWORD');

        if ($prod) {
            // Never ship a well-known credential. Production needs real values supplied via the environment.
            if (! $password || strlen($password) < 12 || in_array($password, ['Admin@12345', 'password', 'Password123!'], true) || str_ends_with($email, '@example.com')) {
                $this->command?->error('Refusing to seed production: set ADMIN_EMAIL (a real address) and ADMIN_PASSWORD (12+ characters, not a default) in the environment.');
                throw new \RuntimeException('Unsafe production seed credentials.');
            }
            // Create-only: re-running the seeder must not reset an existing admin's password.
            User::firstOrCreate(['email' => $email], ['name' => 'Administrator', 'password' => $password, 'role_id' => $admin->id, 'email_verified_at' => now()]);
        } else {
            User::updateOrCreate(['email' => $email], ['name' => 'Admin', 'password' => $password ?: 'Admin@12345', 'role_id' => $admin->id, 'email_verified_at' => now()]);
            User::updateOrCreate(['email' => 'customer@example.com'], ['name' => 'Demo Customer', 'password' => 'Customer@12345', 'role_id' => $customer->id, 'email_verified_at' => now()]);
        }

        foreach (['Electronics', 'Clothing', 'Home & Garden', 'Books'] as $name) {
            Category::firstOrCreate(['slug' => Str::slug($name)], ['name' => $name]);
        }
    }
}
