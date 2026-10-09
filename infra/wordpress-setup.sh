#!/usr/bin/env bash
# Richtet die lokale WordPress-Instanz einmalig ein (idempotent): Installation auf Deutsch,
# sprechende Permalinks, Plugin aktiv. Das Admin-Passwort wird zufällig erzeugt und nur in
# infra/.wordpress-admin abgelegt (git-ignoriert); es erscheint nicht in der Ausgabe.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f infra/docker-compose.wordpress.yml)
wp() { "${COMPOSE[@]}" run --rm -T cli wp "$@"; }
CREDENTIALS=infra/.wordpress-admin

if ! wp core is-installed >/dev/null 2>&1; then
  PASSWORD="$(openssl rand -base64 24)"
  wp core install \
    --url=http://localhost:8080 \
    --title='FW Booking Testseite' \
    --admin_user=admin \
    --admin_password="$PASSWORD" \
    --admin_email=admin@example.test \
    --skip-email >/dev/null
  umask 077
  printf 'Benutzer: admin\nPasswort: %s\n' "$PASSWORD" >"$CREDENTIALS"
  echo "WordPress installiert; Zugang in $CREDENTIALS"
fi

wp language core install de_DE --activate >/dev/null 2>&1 || echo 'Hinweis: Sprachpaket de_DE nicht geladen'
wp rewrite structure '/%postname%/' --hard >/dev/null
wp plugin activate fw-booking
echo 'WordPress läuft unter http://localhost:8080 (Admin: http://localhost:8080/wp-admin/)'
