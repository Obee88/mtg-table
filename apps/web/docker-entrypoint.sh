#!/bin/sh
# Render runtime config from env so one image serves any domain.
set -eu
: "${API_URL:?API_URL must be set}"
printf 'window.__APP_CONFIG__ = { apiUrl: "%s" };\n' "$API_URL" > /usr/share/nginx/html/config.js
exec nginx -g 'daemon off;'
