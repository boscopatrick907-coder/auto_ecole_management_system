#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
npm run build --prefix backend
npm run build --prefix frontend
# Workers' built-in SPA handling replaces the Pages-only redirect rule.
# Keep the original public asset intact for the existing Pages deployment option,
# but remove the built copy because Wrangler parses _redirects even when listed in .assetsignore.
rm -f frontend/dist/auto-ecole-la-marseillaise-pwa/browser/_redirects
printf '_redirects\n' > frontend/dist/auto-ecole-la-marseillaise-pwa/browser/.assetsignore
