# ryuuji-web

Ryuuji web app — Next.js (App Router) + TypeScript.

## Setup

Requires Node 24 (see `.nvmrc`).

```sh
nvm use          # or install Node 24 another way
npm ci
cp .env.example .env.local   # then fill in TMDB_TOKEN, RYUUJI_PASSCODE and RYUUJI_SESSION_SECRET
npm run dev
```

Open http://localhost:3000.

## Scripts

| Command             | Description                       |
| ------------------- | --------------------------------- |
| `npm run dev`       | Start the local dev server        |
| `npm run build`     | Production build                  |
| `npm start`         | Serve the production build        |
| `npm run lint`      | ESLint (Next.js config)           |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm test`          | Unit tests (Vitest)               |
| `npm run check:bundle` | Fail if server secrets appear in `.next/static` (run after `build`) |
| `node scripts/screenshots.mjs [outDir]` | Layout screenshots (Up Next, Library, search, passcode prompt, `/components`) at 375px and 1280px in light and dark, with a mocked TMDB proxy; fails on horizontal scroll. Needs a running dev server (`BASE_URL`, default `http://localhost:3000`) and `npx playwright install chromium`. Not run in CI. |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, and build on every pull request and on pushes to `main`. The build uses sentinel `TMDB_TOKEN` / `RYUUJI_PASSCODE` / `RYUUJI_SESSION_SECRET` values, then `check:bundle` fails if those values or the variable names show up in client assets.

## Design system

Tokens (spacing, radius, type, color, shadows, motion) live in `app/tokens.css`; colors use `light-dark()`, so they follow the system theme or a pinned `data-theme`. Shared components are in `components/ui/` and shown in both themes at `/components`. The theme preference (System / Light / Dark, in Settings and the desktop sidebar) is stored in `localStorage` and applied by an inline script before first paint (`lib/theme.ts`). Fonts: Inter (text) and Fraunces (display) via `next/font`. All motion is disabled under `prefers-reduced-motion`.

## Environment variables

| Name         | Description                                     |
| ------------ | ----------------------------------------------- |
| `TMDB_TOKEN` | TMDB API read access token. **Server-side only.** |
| `RYUUJI_PASSCODE` | Passcode that unlocks the TMDB proxy; at least 16 characters. **Server-side only.** |
| `RYUUJI_SESSION_SECRET` | Key that signs session cookies; at least 32 random characters (e.g. `openssl rand -base64 32`). Required when `RYUUJI_PASSCODE` is set. **Server-side only.** |
| `RYUUJI_SESSION_NOT_BEFORE` | Optional. Rejects sessions issued before this time: an ISO 8601 date-time (`2026-10-29T12:00:00Z`) or epoch seconds. |

- The server refuses to start (`register()` in `instrumentation.ts` calls `readAccessConfig` from `lib/server/config.ts`) if `RYUUJI_PASSCODE` is set but shorter than 16 characters, `RYUUJI_SESSION_SECRET` is missing or shorter than 32, or `RYUUJI_SESSION_NOT_BEFORE` does not parse. The error names the variable, never its value. With `RYUUJI_PASSCODE` unset it starts with access disabled. Routes re-check per request and fail closed with `503`.
- For local development, put them in `.env.local` (git-ignored). `.env.example` lists the required variables.
- Never prefix them with `NEXT_PUBLIC_` — that would inline it into the client bundle.
- Only read them from server code (modules under `lib/server/` import `server-only`) (Server Components, Route Handlers, Server Actions); never pass them to the browser or log them.

## TMDB proxy

The browser never talks to TMDB directly. `GET /api/tmdb/<path>` (`app/api/tmdb/[...path]/route.ts`) forwards an allow-list of TMDB v3 endpoints with the server's `TMDB_TOKEN`; the client helper `tmdbFetch` in `lib/tmdb-client.ts` calls it and throws the proxy's error message. `lib/title-mapper.ts` maps TMDB movie/show responses onto `Title` (port of the macOS `TitleMapper` and `AnimeClassifier`: anime = Animation genre and Japanese origin country or original language).

| Endpoint | Allowed query params | Cached |
| --- | --- | --- |
| `search/movie`, `search/tv` | `query`, `page`, `language`, `include_adult`, `year`, `primary_release_year`, `first_air_date_year` | 10 min |
| `discover/tv` | `page`, `language`, `include_adult`, `sort_by`, `first_air_date.gte/.lte`, `with_genres`, `without_genres`, `with_origin_country`, `with_original_language` | 10 min |
| `movie/{id}` | `language` | 24 h |
| `tv/{id}` | `language`, `append_to_response=season/N,…` (max 20) | 24 h |
| `tv/{id}/season/{n}` | `language` | 24 h |
| `movie/{id}/watch/providers`, `tv/{id}/watch/providers` | none | 24 h |
| `configuration` | none | 24 h |

- Any other path is `404`. Ids must be numeric; unknown, repeated, or malformed params are `400`. `language` defaults to `en-US`.
- Missing `TMDB_TOKEN` → `503 {"error":"TMDB not configured"}`. TMDB `404` becomes `404 {"error":"Not found"}`; other upstream errors become `502 {"error":"TMDB returned an error (HTTP n)"}`. Upstream error bodies and headers are never passed through.
- Upstream fetches use `redirect: "error"`, so the bearer token is never sent to a redirect target; a redirect becomes `502 {"error":"Could not reach TMDB"}`.
- **Caching:** upstream fetches use Next's data cache (`next.revalidate`, durations above), and responses carry `Cache-Control: private, max-age=<same>`. TMDB's terms forbid caching their data for more than 6 months; keep any future cache well under that.
- **Rate limiting:** 60 requests/minute per client IP (fixed window; 10/minute for `POST /api/session`, counting right and wrong passcodes). Over the limit → `429 {"error":"Too many requests, try again in N seconds"}` with `Retry-After`. The client IP is the first entry of `x-vercel-forwarded-for` (set by Vercel; clients cannot spoof it), then `x-forwarded-for`, then `x-real-ip`. Each limiter tracks at most 10,000 keys and drops the least recently seen one past that (a `Map` in insertion order, with each key deleted and re-inserted on every hit, so trimming never scans the table). The counters live in memory, so they are per server instance and reset on cold starts — best-effort only, not a hard guarantee.

### Passcode access

The app is single-user, so the proxy is gated by a passcode rather than accounts.

- `POST /api/session` with `{"passcode": "…"}` compares it in constant time (both sides are SHA-256 hashed to equal lengths, then compared with `timingSafeEqual`) and, on success, sets the `ryuuji_session` cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, 30 days). Wrong passcode → `401`.
- The cookie is `v1.<issued-at, epoch seconds>.<signature>`, where the signature is an HMAC-SHA256 keyed by `RYUUJI_SESSION_SECRET` over the version, issued-at time and passcode. The proxy checks the signature with `timingSafeEqual`, then rejects sessions older than `SESSION_MAX_AGE` (30 days, enforced on the server whatever the browser keeps), issued more than a minute in the future, or issued before `RYUUJI_SESSION_NOT_BEFORE`. Without a valid cookie it returns `401`.
- **Revoking sessions:** set `RYUUJI_SESSION_NOT_BEFORE` to the current time (e.g. `date -u +%Y-%m-%dT%H:%M:%SZ`) and redeploy to sign out every session issued before then. Rotating `RYUUJI_SESSION_SECRET` (or `RYUUJI_PASSCODE`) invalidates all existing sessions.
- If `RYUUJI_PASSCODE` is unset or the access config is invalid, the proxy and login return `503 {"error":"Access not configured"}` (fail closed).
- For the deployment (LIB-421), enable Vercel Deployment Protection as an additional layer in front of the passcode.

### TMDB terms

- Ryuuji uses TMDB for non-commercial purposes only.
- Attribution belongs to the UI (LIB-421): show the TMDB logo less prominently than the app's own branding, with the notice "This product uses the TMDB API but is not endorsed or certified by TMDB."
- Watch provider data comes from JustWatch; any UI showing it (LIB-421) must credit JustWatch.
- Do not cache TMDB data for more than 6 months.
