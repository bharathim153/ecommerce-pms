<?php

use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Behind a TLS-terminating proxy (Railway, Render, nginx, a load balancer) the app must trust X-Forwarded-* to know
        // the request was HTTPS; otherwise signed email links and HSTS break. Set TRUSTED_PROXIES='*' (or a comma list of IPs).
        $middleware->trustProxies(at: env('TRUSTED_PROXIES') === '*' ? '*' : (env('TRUSTED_PROXIES') ? array_map('trim', explode(',', env('TRUSTED_PROXIES'))) : null));
        $middleware->alias(['role' => EnsureRole::class]);
        $middleware->appendToGroup('api', SecurityHeaders::class);
        // Authorise BEFORE route-model binding, otherwise a non-admin could tell which record ids exist (404 vs 403).
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: EnsureRole::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['success' => false, 'message' => 'Unauthenticated.'], 401);
            }
        });
    })->create();
