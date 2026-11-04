#!/usr/bin/env bash
set -euo pipefail
cd /var/www/html

# Refuse to boot misconfigured rather than run insecurely.
: "${APP_KEY:?APP_KEY is required. Generate one with: php artisan key:generate --show}"
: "${APP_URL:?APP_URL is required (the public https URL of this API)}"
: "${FRONTEND_URL:?FRONTEND_URL is required (the exact origin of the website, no trailing slash)}"
: "${DB_HOST:?DB_HOST is required}" "${DB_DATABASE:?DB_DATABASE is required}" "${DB_USERNAME:?DB_USERNAME is required}"
: "${ADMIN_EMAIL:?ADMIN_EMAIL is required for the first seed (use a real address, not @example.com)}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required for the first seed (12+ characters)}"
export DB_CONNECTION="${DB_CONNECTION:-mysql}" DB_PORT="${DB_PORT:-3306}"

# Wait for MySQL (managed databases can start slower than the app).
for i in $(seq 1 30); do
  php -r 'try { new PDO("mysql:host=".getenv("DB_HOST").";port=".getenv("DB_PORT").";dbname=".getenv("DB_DATABASE"), getenv("DB_USERNAME"), getenv("DB_PASSWORD")); exit(0); } catch (Throwable $e) { fwrite(STDERR, $e->getMessage()."\n"); exit(1); }' && break
  echo "waiting for database ($i/30)..."; sleep 2
  [ "$i" = 30 ] && { echo "database never became reachable" >&2; exit 1; }
done

php artisan migrate --force
php artisan db:seed --force          # create-only in production: never resets an existing admin
php artisan storage:link --force >/dev/null 2>&1 || true
chown -R www-data:www-data storage bootstrap/cache
php artisan config:cache && php artisan route:cache && php artisan event:cache

# Render the nginx config with the platform-assigned port.
envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf
nginx -t

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/pms.conf
