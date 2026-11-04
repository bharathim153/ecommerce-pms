<?php

return [
    // Recipients handled per queue job.
    'chunk_size' => (int) env('CAMPAIGN_CHUNK_SIZE', 25),
    // Global send-rate ceiling across all workers (provider limits / warm-up).
    'emails_per_minute' => (int) env('CAMPAIGN_EMAILS_PER_MINUTE', 600),
    // CAN-SPAM / GDPR: every marketing email must identify the sender and carry an unsubscribe link.
    'footer_address' => env('CAMPAIGN_FOOTER_ADDRESS', 'Your Company, 123 Main Street, City, Country'),
    'mailgun_signing_key' => env('MAILGUN_WEBHOOK_SIGNING_KEY'),
    'max_import_rows' => 20000,
];
