# MyVault Web

A companion web app for the MyVault Android app — a personal knowledge vault with workspaces, nested folders, notes, a block-based rich-text editor, and an Islamic corpus section.

## Run & Operate

- `PORT=18899 BASE_PATH=/ pnpm --filter @workspace/myvault-web run dev` — run the web app (or use the "MyVault Web" workflow)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React 19 + Vite 7, Wouter (routing), TanStack Query v5
- UI: shadcn/ui + Tailwind CSS v4, Lucide icons, date-fns
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle) for API; Vite for web

## Where things live

- `artifacts/myvault-web/src/` — React web app
  - `pages/` — Home, Folders, FolderDetail, NoteDetail, Search, Tags, KnowledgeTags, Library, Settings
  - `components/layout.tsx` — sidebar + mobile nav
  - `lib/providers.tsx` — ThemeProvider, WorkspaceProvider, AccentProvider
  - `mocks/data.ts` — rich mock dataset (9 personal folders, 4 Islamic folders, 16+ notes)
  - `mocks/mockFetcher.ts` — window.fetch interceptor for all /api/* routes
- `lib/api-spec/openapi.yaml` — source-of-truth OpenAPI spec
- `lib/api-client-react/src/generated/` — generated hooks, Zod schemas
- `artifacts/api-server/src/` — Express API (not yet wired to DB)

## Architecture decisions

- **Mock-first**: All data comes from `mockFetcher.ts` (overrides `window.fetch`). Real API connection requires swapping in `DATABASE_URL` and enabling the api-server routes.
- **Two workspaces**: `personal` and `islamic_corpus` — toggled in the sidebar; mock data returns different folder/note sets per workspace.
- **Contract-first API**: OpenAPI spec lives in `lib/api-spec`, Orval generates React Query hooks. Server validates with Zod schemas from the same spec.
- **Workflow env**: The "MyVault Web" workflow must set `PORT=18899 BASE_PATH=/` inline (artifact.toml env vars only apply to the artifact proxy system, not Replit workflow runner).

## Product

- **Home** — greeting, workspace stats, pinned & recent notes
- **Folders** — nested folder tree with create/navigate
- **Folder detail** — notes list, create note inline
- **Note detail** — block-based editor (paragraph, heading, list, code, quote, divider), title autosave, version history panel, tag display
- **Search** — debounced full-text search across notes and attachments
- **Tags** — browse all tags, filter notes by tag
- **Knowledge tags** — Islamic corpus semantic tags (Quran, Hadith, Fiqh, etc.)
- **Library** — attached documents (PDFs, images) with search
- **Settings** — theme toggle (light/dark/system), accent color picker

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Workflow must include `PORT=18899 BASE_PATH=/` in the run command — env vars in artifact.toml `[services.env]` are not propagated to the Replit workflow runner.
- Generated query key helpers (`getGetNoteQueryKey`, `getListNotesQueryKey`, etc.) must be passed explicitly as `queryKey` when using `{ query: { enabled: ... } }` options — the generated types require it.
- Optional fields from the OpenAPI spec (`isPinned`, `tagNames`, `orderIndex`, `noteCount`) are typed as `T | undefined` — always use `?? defaultValue` when consuming them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
