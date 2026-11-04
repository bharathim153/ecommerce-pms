# Production image for the Laravel API: nginx + PHP-FPM + queue worker (PDF exports, email campaigns) in one container.
# Build context = this folder (backend/).  Listens on $PORT (default 8080).
FROM php:8.3-fpm-bookworm

ENV DEBIAN_FRONTEND=noninteractive COMPOSER_ALLOW_SUPERUSER=1 PORT=8080

# nginx + supervisor to run the processes; chromium + poppler for PDF export; fonts so PDF text renders.
RUN apt-get update && apt-get install -y --no-install-recommends \
      nginx supervisor gettext-base ca-certificates curl unzip git \
      chromium poppler-utils fonts-liberation fonts-dejavu-core \
      libpng-dev libjpeg-dev libwebp-dev libfreetype6-dev libzip-dev libicu-dev \
 && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
 && docker-php-ext-install -j"$(nproc)" pdo_mysql gd zip intl bcmath opcache pcntl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY docker/php.ini /usr/local/etc/php/conf.d/90-pms.ini
COPY docker/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker/supervisord.conf /etc/supervisor/conf.d/pms.conf

WORKDIR /var/www/html

# Dependencies first so this layer is cached until composer.json/lock change.
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

COPY . .
RUN composer dump-autoload --no-dev --optimize --no-interaction \
 && php artisan package:discover --ansi \
 && mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs storage/app/public storage/app/private bootstrap/cache \
 && chown -R www-data:www-data storage bootstrap/cache

# Chromium is what the PDF renderer drives (it already passes --no-sandbox for container use).
ENV PDF_CHROME_PATH=/usr/bin/chromium PDF_MERGE_BINARY=/usr/bin/pdfunite PDF_INFO_BINARY=/usr/bin/pdfinfo \
    APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr TRUSTED_PROXIES=*

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080
# Uploads and generated PDFs live in storage/app: MOUNT A PERSISTENT VOLUME AT /var/www/html/storage/app
# (done in the host's settings; the VOLUME keyword is intentionally not used because Railway rejects it).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fs "http://127.0.0.1:${PORT}/up" || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
