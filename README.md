# ryuuji-web

Ryuuji web app — Next.js (App Router) + TypeScript.

## Setup

Requires Node 24 (see `.nvmrc`).

```sh
nvm use          # or install Node 24 another way
npm ci
cp .env.example .env.local   # then fill in TMDB_TOKEN
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

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, and build on every pull request and on pushes to `main`.

## Environment variables

| Name         | Description                                     |
| ------------ | ----------------------------------------------- |
| `TMDB_TOKEN` | TMDB API read access token. **Server-side only.** |

- For local development, put it in `.env.local` (git-ignored). `.env.example` lists the required variables.
- Never prefix it with `NEXT_PUBLIC_` — that would inline it into the client bundle.
- Only read it from server code (Server Components, Route Handlers, Server Actions); never pass it to the browser.
