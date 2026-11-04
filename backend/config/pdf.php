<?php

return [
    // Headless Chrome/Chromium used to render HTML chunks to PDF.
    'chrome_binary' => env('PDF_CHROME_PATH', 'google-chrome'),
    // poppler-utils binaries (merge + page counting). Low-memory, streaming-friendly.
    'merge_binary' => env('PDF_MERGE_BINARY', 'pdfunite'),
    'info_binary' => env('PDF_INFO_BINARY', 'pdfinfo'),

    // Products rendered per Chrome invocation. Keeps memory flat for any export size.
    'chunk_size' => (int) env('PDF_CHUNK_SIZE', 20),
    // Seconds allowed for one Chrome render.
    'chunk_timeout' => (int) env('PDF_CHUNK_TIMEOUT', 300),
    // Whole-job timeout (queue worker --timeout must be larger).
    'job_timeout' => (int) env('PDF_JOB_TIMEOUT', 7200),
    // Images wider than this are downscaled before embedding (keeps PDF size sane).
    'max_image_width' => (int) env('PDF_MAX_IMAGE_WIDTH', 1000),
    'max_active_per_user' => 3,
    'disk' => 'local', // storage/app/private
    'directory' => 'exports',
];
