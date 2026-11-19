# Deploy a phone-accessible staging app

Prepared 17 November 2026. This package is not a completed live deployment. Cloudflare `wrangler whoami` reports no authenticated account in the current Codex environment. No remote database or R2 bindings are configured here; the retained development environment uses disposable loopback PostgreSQL and cannot serve as a hosted database.

## Deployment layout

`backend/wrangler.staging.toml` deploys the Angular static assets and tenant API together as `driving-schools-staging`, with `/api/*` handled by the Worker first and other routes served as an SPA. This gives the phone browser one HTTPS origin for the app and secure auth cookies. It is separate from the existing `driving-schools-api` configuration and does not overwrite that Worker.

Build from the repository root:

```sh
bash scripts/build-staging.sh
XDG_CONFIG_HOME=/workspace/.config ./backend/node_modules/.bin/wrangler deploy --config backend/wrangler.staging.toml --dry-run
```

The build writes a generated `.assetsignore` that excludes the Pages-specific `_redirects` asset. The Worker uses `not_found_handling = "single-page-application"` instead. This avoids an infinite-redirect warning while retaining the existing Pages option.

The configured dry-run bundle passes. A local workerd smoke test passes API health/config and the root/nested SPA routes. This does not verify login, remote database connectivity or file uploads.

## Emmanuel — prerequisites before publishing a usable staging environment

1. Authenticate the intended Cloudflare account. Use a supported Cloudflare login or a properly scoped `CLOUDFLARE_API_TOKEN` in secure environment settings; select the account with `CLOUDFLARE_ACCOUNT_ID`. Do not paste tokens into chat or commit them. The current environment's network settings must also allow `api.cloudflare.com`, the resulting staging hostname, and the intended external services.
2. Prepare a disposable Neon staging branch and apply the updated tenant migration. Create separate restricted application and identity LOGIN roles. Use their TLS connection URLs as Worker `DATABASE_URL` and `AUTH_DATABASE_URL`; keep the owner/migration connection out of request bindings.
3. Configure a strong `BETTER_AUTH_SECRET` and private Ed25519 PKCS#8 `OFFLINE_PRIVATE_KEY_PEM` in the Worker. Do not reuse generated local development material for a public staging service.
4. Set `BETTER_AUTH_URL` and `TRUSTED_ORIGINS` to the actual HTTPS staging origin. Configure a real Turnstile site/key pair for that host if signup is enabled. These are distinct from the local development fallback.
5. Configure private `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, scoped bucket credentials and exact-origin CORS with PUT/GET/HEAD plus `Content-Type`/`If-None-Match`. Optional recovery-email bindings are `AUTH_EMAIL_WEBHOOK` and `AUTH_EMAIL_TOKEN`.
6. Bootstrap only a synthetic pilot school and test users on the disposable branch unless the owner explicitly approves another dataset. Do not run the seed/importer on an existing school database as a shortcut.

Once authenticated and configured, publish with:

```sh
./backend/node_modules/.bin/wrangler deploy --config backend/wrangler.staging.toml
```

Use Cloudflare's secure Worker bindings interface or Wrangler's secret commands for values. Neither the script nor the manifest contains secret values. If the Worker must first exist to configure its secrets or confirm its hostname, provision it as incomplete staging and do not represent login/material functions as ready until the bindings and smoke checks pass.

## Verification before sharing the link as a working app

- Actual public `/api/health` and `/api/config` return expected JSON over HTTPS, and deep SPA links render correctly.
- Real catalogue, login/cookie, school membership, and signed lease work from a phone browser.
- Admin upload → draft preview → publish → entitled student download works against the private staging bucket; cross-school/student access is denied.
- Confirm database isolation, secrets, synthetic data and expected unavailable-provider states. Record the exact deployed commit and URL.

No public deployment URL exists as a result of preparing this document. Publishing the Codex development environment does not deploy this application.
