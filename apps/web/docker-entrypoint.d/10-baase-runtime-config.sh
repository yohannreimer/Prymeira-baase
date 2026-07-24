#!/bin/sh
set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > /usr/share/nginx/html/baase-runtime-config.js <<EOF
window.__BAASE_RUNTIME_CONFIG__ = {
  VITE_BAASE_AUTH_MODE: "$(json_escape "${VITE_BAASE_AUTH_MODE:-account}")",
  VITE_CLERK_PUBLISHABLE_KEY: "$(json_escape "${VITE_CLERK_PUBLISHABLE_KEY:-}")",
  VITE_PRYMEIRA_ACCOUNT_API_URL: "$(json_escape "${VITE_PRYMEIRA_ACCOUNT_API_URL:-https://hub.prymeiradigital.com.br/api}")",
  VITE_PRYMEIRA_HUB_URL: "$(json_escape "${VITE_PRYMEIRA_HUB_URL:-https://hub.prymeiradigital.com.br}")",
  VITE_PRYMEIRA_PRODUCT_KEY: "$(json_escape "${VITE_PRYMEIRA_PRODUCT_KEY:-base}")",
  VITE_GLITCHTIP_DSN: "$(json_escape "${VITE_GLITCHTIP_DSN:-}")",
  VITE_BAASE_ENVIRONMENT: "$(json_escape "${VITE_BAASE_ENVIRONMENT:-development}")",
  VITE_BAASE_RELEASE: "$(json_escape "${VITE_BAASE_RELEASE:-local}")",
  VITE_GLITCHTIP_TRACES_SAMPLE_RATE: "$(json_escape "${VITE_GLITCHTIP_TRACES_SAMPLE_RATE:-0}")"
};
EOF
