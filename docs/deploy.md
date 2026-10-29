# Deploying Ryuuji (LIB-421)

Runbook for the Vercel deployment. Brandon performs every step in the Vercel and GitHub dashboards;
nothing in this repo deploys, and no secret value is ever committed (only `.env.example`, with empty values).

Ryuuji is a personal, **non-commercial** app. TMDB's API terms allow that use only; keep it free, ad-free,
and keep the TMDB attribution on `/about`.

## 1. Create the Vercel project

1. In Vercel, **Add New → Project**, import the `ryuuji-web` GitHub repository. Framework preset: Next.js (auto-detected). Leave build and output settings at their defaults.
2. **Settings → Git:** production branch `main`. Every push to `main` deploys to production; every pull request gets a preview deployment.
3. **Settings → Node.js version:** 24.x (matches `.nvmrc` and `engines`).
4. **Settings → Deployment Protection:** enable Vercel Authentication for previews at least, as a layer in front of the passcode.

## 2. Require CI before anything ships

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, a production build and `check:bundle` on every PR and push to `main`.

- **GitHub → Settings → Branches → branch protection rule for `main`:** require a pull request, require the `ci` status check to pass, and require branches to be up to date.
- **Vercel:** in the project's Git settings, enable waiting for GitHub checks before promoting a deployment (Vercel's "wait for checks" / deployment checks), selecting the `ci` check, so a failing build never becomes production.

## 3. Environment variables

Add these in **Settings → Environment Variables** for both **Production** and **Preview**, each marked **Sensitive** (write-only once saved). Do not add them to Development, do not prefix them with `NEXT_PUBLIC_`, and never commit or paste them into issues or logs.

| Name | Value |
| --- | --- |
| `TMDB_TOKEN` | TMDB API read access token (v4 "API Read Access Token"). |
| `RYUUJI_PASSCODE` | The passcode you type to unlock search; **at least 16 characters**. Use a passphrase you can type on a phone. |
| `RYUUJI_SESSION_SECRET` | Signs session cookies; **at least 32 characters**. Generate locally with `openssl rand -base64 48` and paste the output; do not reuse it anywhere else. |
| `RYUUJI_SESSION_NOT_BEFORE` | Optional. Sessions issued before this time are rejected: an ISO 8601 date-time such as `2026-10-29T12:00:00Z`, or epoch seconds. Set it to now (`date -u +%Y-%m-%dT%H:%M:%SZ`) and redeploy to sign every device out. |

Use different `RYUUJI_PASSCODE` / `RYUUJI_SESSION_SECRET` values for Preview and Production if previews are shared with anyone.

Notes:

- **The server refuses to start if these are invalid.** `instrumentation.ts` validates them at startup: a passcode under 16 characters, a missing or short session secret, or an unparseable not-before time throws, naming the variable but never its value. The deployment's functions then fail; fix the variable and redeploy. With `RYUUJI_PASSCODE` unset the app starts but search and login return `503`.
- **The first deploy of signed sessions logs everyone out once.** Cookies issued before signed sessions (LIB-425) do not verify; each device re-enters the passcode once in Search.
- Changing a variable only takes effect on the next deployment (**Deployments → ⋯ → Redeploy**).
- **The token never reaches the browser.** CI builds with sentinel secret values and `npm run check:bundle` fails if any of them, or the variable names, appear in `.next/static`. To check by hand: `npm run build && npm run check:bundle`.

## 4. Post-deploy smoke test

From a machine with Node 24 and `npx playwright install chromium`, against the new deployment URL:

```sh
read -rs RYUUJI_SMOKE_PASSCODE && export RYUUJI_SMOKE_PASSCODE   # typed, not echoed, not in shell history
BASE_URL=https://<deployment-url> npm run smoke
unset RYUUJI_SMOKE_PASSCODE
```

`scripts/smoke-test.mjs` uses a fresh browser profile (your devices' libraries are untouched) and checks, in order:

1. `GET /api/tmdb/configuration` without a cookie returns `401`.
2. `/manifest.webmanifest` is reachable and names Ryuuji, `display: standalone`.
3. Logging in through Search with the passcode works (one attempt of the 10/minute limit).
4. Searching (`RYUUJI_SMOKE_QUERY`, default "Breaking Bad") and adding a show works.
5. Logging S1E1 on its detail page works, and it is still logged after a reload.
6. The service worker is registered with scope `/`.

If Deployment Protection covers the URL you test, use a protection-bypass for automation or test the production domain instead. The passcode is never printed; error output masks it.

## 5. Phone and desktop verification

**iPhone (Safari)**

1. Open the production URL, then Share → **Add to Home Screen**. The icon should be the red "R" tile, named Ryuuji.
2. Launch it from the home screen: it opens standalone (no Safari toolbar), status bar matches the theme.
3. Search, enter the passcode, add a show, and log an episode from Up Next or the title page.
4. Wait a few seconds, then turn on **Airplane Mode**, fully close the app and reopen it. Up Next, Library and the logged episode still show (from IndexedDB, with the page shell served by the service worker). Search fails gracefully while offline.
5. Turn Airplane Mode off and confirm search works again.

**Desktop Chrome / Edge**

1. Open the production URL; use the install icon in the address bar (or ⋮ → **Install Ryuuji** / Edge: **Apps → Install this site as an app**).
2. The installed app opens in its own window. Repeat steps 3–5 above, going offline with DevTools → Network → Offline (or by disconnecting Wi-Fi) and reloading.
3. DevTools → Application → Manifest shows no errors and the 192, 512 and maskable icons; Application → Service workers shows `/sw.js` activated.

## 6. Rollback

- **Instant:** Vercel → Deployments → pick the last good production deployment → ⋯ → **Promote to Production** (Instant Rollback). No rebuild; env vars are those the deployment was built with.
- **Then fix forward:** revert the offending commit on `main` via a PR (CI must pass) so the next deploy does not reintroduce it.
- **Bad env var:** fix it in Settings → Environment Variables and redeploy. If a secret leaked, rotate it: new TMDB token in TMDB settings; new `RYUUJI_SESSION_SECRET` (signs everyone out); new `RYUUJI_PASSCODE`.
- **Bad service worker:** clients pick up a fixed `/sw.js` on their next visit (it is served with `Cache-Control: no-cache`). To force-drop every cached page and asset, bump `VERSION` in `public/sw.js` and deploy. As a last resort, ship a `public/sw.js` that only calls `self.registration.unregister()`.

## 7. After the first production deploy

- Replace "TBD after first deploy" in the README with the production URL.
- Run the smoke test and the phone checks above, and note the results on LIB-421.
