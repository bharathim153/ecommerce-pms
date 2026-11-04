<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Generated links (signed verification URLs, webhooks) must use https whenever the app is served over it.
        if (str_starts_with((string) config('app.url'), 'https://')) {
            URL::forceScheme('https');
        }

        // Throttle is per chunk-job: (emails/min) / (emails per chunk) jobs per minute, shared by every worker.
        RateLimiter::for('campaign-mail', fn () => Limit::perMinute(max(1, (int) ceil(config('campaigns.emails_per_minute') / max(1, config('campaigns.chunk_size'))))));

        ResetPassword::createUrlUsing(fn ($user, string $token) => rtrim(config('app.frontend_url'), '/')
            .'/reset-password?token='.$token.'&email='.urlencode($user->email));
    }
}
