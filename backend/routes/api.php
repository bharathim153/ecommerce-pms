<?php

use App\Http\Controllers\Api\Admin\CategoryController;
use App\Http\Controllers\Api\Admin\CampaignController;
use App\Http\Controllers\Api\Admin\DashboardController;
use App\Http\Controllers\Api\Admin\EmailTemplateController;
use App\Http\Controllers\Api\Admin\OrderAdminController;
use App\Http\Controllers\Api\Admin\PaymentSettingsController;
use App\Http\Controllers\Api\Admin\PdfExportController;
use App\Http\Controllers\Api\Admin\ProductController;
use App\Http\Controllers\Api\Admin\ProductImageController;
use App\Http\Controllers\Api\Admin\SubscriberController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CatalogController;
use App\Http\Controllers\Api\MailgunWebhookController;
use App\Http\Controllers\Api\UnsubscribeController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\WebhookController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::middleware('throttle:10,1')->group(function () {
        Route::post('register', [AuthController::class, 'register']);
        Route::post('login', [AuthController::class, 'login']);
        Route::post('mfa/verify', [AuthController::class, 'verifyMfa']);
        Route::post('mfa/resend', [AuthController::class, 'resendMfa']);
        Route::post('forgot-password', [AuthController::class, 'forgotPassword']);
        Route::post('reset-password', [AuthController::class, 'resetPassword']);
    });

    Route::get('email/verify/{id}/{hash}', [AuthController::class, 'verifyEmail'])
        ->middleware('signed')->name('verification.verify');

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('me', [AuthController::class, 'me']);
        Route::post('logout', [AuthController::class, 'logout']);
        Route::patch('mfa', [AuthController::class, 'updateMfa']);
        Route::patch('profile', [AuthController::class, 'updateProfile']);
        Route::put('password', [AuthController::class, 'changePassword'])->middleware('throttle:6,1');
        Route::get('marketing', [AuthController::class, 'marketing']);
        Route::patch('marketing', [AuthController::class, 'updateMarketing']);
        Route::post('email/resend', [AuthController::class, 'resendVerification'])->middleware('throttle:3,1');
    });
});

Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function () {
    Route::get('users', [UserController::class, 'index']);
    Route::patch('users/{user}', [UserController::class, 'update']);
});

// Public storefront
Route::middleware('throttle:120,1')->group(function () {
    Route::get('categories', [CatalogController::class, 'categories']);
    Route::get('products', [CatalogController::class, 'index']);
    Route::get('products/{slug}', [CatalogController::class, 'show']);
});

// Gateway callbacks: no auth, authenticity comes from signature verification inside the controller.
Route::post('webhooks/stripe', [WebhookController::class, 'stripe']);
Route::post('webhooks/paypal', [WebhookController::class, 'paypal']);

Route::post('webhooks/mailgun', [MailgunWebhookController::class, 'handle']);

// Public unsubscribe (token is the credential). POST-only for state changes.
Route::middleware('throttle:30,1')->group(function () {
    Route::get('unsubscribe/{token}', [UnsubscribeController::class, 'show']);
    Route::post('unsubscribe/{token}', [UnsubscribeController::class, 'unsubscribe']);
    Route::post('resubscribe/{token}', [UnsubscribeController::class, 'resubscribe']);
});

Route::get('payment-methods', [OrderController::class, 'methods']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('orders', [OrderController::class, 'index']);
    Route::post('orders', [OrderController::class, 'store'])->middleware('throttle:20,1');
    Route::get('orders/{order}', [OrderController::class, 'show']);
    Route::post('orders/{order}/pay/stripe', [PaymentController::class, 'stripeCheckout'])->middleware('throttle:10,1');
    Route::post('orders/{order}/stripe/confirm', [PaymentController::class, 'stripeConfirm'])->middleware('throttle:30,1');
    Route::post('orders/{order}/pay/paypal', [PaymentController::class, 'paypalCreate'])->middleware('throttle:10,1');
    Route::post('orders/{order}/paypal/capture', [PaymentController::class, 'paypalCapture'])->middleware('throttle:30,1');
});

Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function () {
    Route::get('email/subscribers/export', [SubscriberController::class, 'export']);
    Route::post('email/subscribers/import', [SubscriberController::class, 'import'])->middleware('throttle:10,1');
    Route::apiResource('email/subscribers', SubscriberController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::post('email/preview', [EmailTemplateController::class, 'preview']);
    Route::apiResource('email/templates', EmailTemplateController::class)->parameters(['templates' => 'template']);
    Route::get('email/campaigns/recipients', [CampaignController::class, 'recipients']);
    Route::post('email/campaigns/{campaign}/send', [CampaignController::class, 'send'])->middleware('throttle:6,1');
    Route::post('email/campaigns/{campaign}/cancel', [CampaignController::class, 'cancel']);
    Route::post('email/campaigns/{campaign}/test', [CampaignController::class, 'test'])->middleware('throttle:10,1');
    Route::get('email/campaigns/{campaign}/logs', [CampaignController::class, 'logs']);
    Route::apiResource('email/campaigns', CampaignController::class)->except(['edit', 'create']);
    Route::get('dashboard', [DashboardController::class, 'show']);
    Route::get('payment-settings', [PaymentSettingsController::class, 'show']);
    Route::put('payment-settings', [PaymentSettingsController::class, 'update']);
    Route::get('orders', [OrderAdminController::class, 'index']);
    Route::get('orders/{order}', [OrderAdminController::class, 'show']);
    Route::apiResource('products', ProductController::class);
    Route::post('products/{product}/images', [ProductImageController::class, 'store']);
    Route::patch('products/{product}/images/{image}/primary', [ProductImageController::class, 'setPrimary']);
    Route::delete('products/{product}/images/{image}', [ProductImageController::class, 'destroy']);
    Route::post('uploads/image', [ProductImageController::class, 'editorUpload']);
    Route::get('pdf-exports', [PdfExportController::class, 'index']);
    Route::post('pdf-exports', [PdfExportController::class, 'store'])->middleware('throttle:10,1');
    Route::get('pdf-exports/{pdfExport}', [PdfExportController::class, 'show']);
    Route::get('pdf-exports/{pdfExport}/download', [PdfExportController::class, 'download']);
    Route::post('pdf-exports/{pdfExport}/retry', [PdfExportController::class, 'retry']);
    Route::delete('pdf-exports/{pdfExport}', [PdfExportController::class, 'destroy']);
    Route::apiResource('categories', CategoryController::class)->only(['store', 'update', 'destroy']);
});
