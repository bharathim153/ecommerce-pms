<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = ['role_id', 'name', 'email', 'password', 'phone', 'mfa_enabled', 'is_active'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'mfa_enabled' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function role(): BelongsTo { return $this->belongsTo(Role::class); }
    public function orders(): HasMany { return $this->hasMany(ProductOrder::class); }
    public function otpVerifications(): HasMany { return $this->hasMany(OtpVerification::class); }
    public function pdfExports(): HasMany { return $this->hasMany(PdfExport::class); }

    public function isAdmin(): bool { return $this->role?->name === 'admin'; }
}
