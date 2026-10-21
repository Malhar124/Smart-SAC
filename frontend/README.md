# Smart SAC web app

The React frontend. Setup, features and the full stack are described in the [main README](../README.md).

```bash
npm install
cp .env.example .env.local    # VITE_API_BASE_URL=http://localhost:8000/api/v1
npm run dev                   # http://localhost:5173
```

| Script | |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit, component and page tests (Vitest + Testing Library) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run build` | Production build in `dist/` |

Settings (`.env.example`): `VITE_API_BASE_URL`, `VITE_APP_TIMEZONE` (must match the backend's `APP_TIMEZONE`), and optional `VITE_SENTRY_DSN` and `VITE_SITE_URL` (absolute URL for link previews).

Code layout: `src/pages` has one file per screen, loaded on demand; `src/components` holds shared UI (`components/ui` are the shadcn/ui primitives in use); `src/context` has auth and live updates; `src/lib` has the API client, form schemas, formatting and types. Page tests render with `renderPage` from `src/test/render.tsx`.
