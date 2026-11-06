# Silverbed

A self-hosted image host built around a **contact-sheet workflow**: upload a roll, review it as a numbered sheet of frames, then share, tag and hand out links — or browse every public frame on the instance at the shared sheet, `/gallery`.

Full-stack TypeScript — one runtime, one process serving both the API and the UI.

```
Bun + Elysia            API, auth, image pipeline
Drizzle + Postgres      Supabase in production, embedded PGlite locally
sharp                   thumbnails, WebP previews, watermarking
Vue 3 + Vite + Tailwind UI
```

---

## Quick start

```bash
bun install
cp .env.example server/.env   # the API scripts run with server/ as their working directory
bun run seed                  # demo admin, folders, 10 sample frames, an API key
bun run build                 # build the UI into web/dist
bun run --cwd server start
```

Open <http://127.0.0.1:8787> and sign in as **admin / silverbed123**. The shared sheet at <http://127.0.0.1:8787/gallery> needs no account.

With `DATABASE_URL` empty (the `.env.example` default) the API runs on the embedded PGlite database under `data/pglite`, so a fresh clone needs no Postgres at all. Delete `data/` to start over.

For development with hot reload, run `bun run dev:api` and `bun run dev:web` in two shells — Vite proxies `/api`, `/i`, `/s` and `/image` to the API on `:8787`.

> **The embedded database is single-process.** Stop the server before running `bun run seed`, otherwise PGlite refuses to open the directory that the server holds. Production uses Postgres, where this does not apply.

---

## Features

**Uploading**
- Drag-and-drop or file picker, multi-file, instant upload queue with per-file progress
- JPEG, PNG, WebP, GIF, AVIF, TIFF, BMP, SVG
- Server-side thumbnails (WebP) and previews; EXIF-aware orientation
- Camera EXIF kept per frame — body, lens, shutter, aperture, ISO, focal length and capture time in the inspector
- Content-hash deduplication — the same bytes are stored once
- Optional watermark, per-user storage quota, max upload size
- Guest upload endpoint (off by default)

**Organising**
- Nested folders, colour-coded tags, full-text-ish search over name and description
- Access per file: public or private (`/i/...` returns 404 to anonymous visitors)
- Trash with restore and permanent delete
- Three layouts: contact sheet, tight grid, list

**The shared sheet**
- `/gallery` is open to everyone: every public frame on the instance as one contact sheet, searchable, sortable, three layouts and a lightbox
- Private frames never appear there — they stay in their owner's library
- Signed-in users get a checkbox on their own frames and a batch bar for move, tags, access and trash
- Administrators select any frame, filter by uploader, and switch to the shared trash to restore or purge; the admin console links to it ("Manage all images")

**Sharing**
- Share links over a set of files or a whole folder
- Password protection, expiry dates, download on/off, revoke
- One-click ZIP of the whole share
- Per-share view and download counters, recent-access log

**API**
- Personal API keys (`X-Access-Key`), scope-limited, shown once
- Upload, list, patch, delete, batch operations
- Open endpoints: `/api/v1/open/random` and `/api/v1/open/list` for hotlinking and galleries

**Operations**
- Admin console: overview, users, site settings, activity log, mail outbox
- Hotlink protection with an allow-list of domains
- Email via SMTP for registration and share access (console + outbox fallback in development)
- Light and dark themes, English and Chinese

---

## Configuration

Every setting is an environment variable, read from the `.env` in the process's working directory — with the bundled scripts that is **`server/.env`**. (A second `.env` at the repository root is only a mirror; nothing loads it.) `.env.example` at the root is the annotated template:

```bash
cp .env.example server/.env
```

Paths inside the file are resolved against the project root, not against `server/`, so `DATA_DIR=./data` still means `<repo>/data`.

### Database

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Any Postgres connection string. Empty → the embedded PGlite database (local development). |
| `PGLITE_DIR` | Override where the embedded database lives (default `<DATA_DIR>/pglite`). |

**Self-hosted Supabase.** Point `DATABASE_URL` at your own stack's Postgres. With the
official Docker Compose setup that is the `supabase-db` container, or Supavisor's
pooler port:

```bash
# Supavisor transaction pooler (port 6543) — what the browser/API should use
DATABASE_URL=postgresql://postgres.<tenant>:<password>@127.0.0.1:6543/postgres
# direct Postgres (port 5432), simpler for a single API instance
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/postgres
```

Only the Postgres connection is used — the API speaks plain SQL through Drizzle and
does not depend on PostgREST or Storage. The schema is created on boot, so an empty
database is all it needs.

> **Pooler note.** Port 6543 runs in transaction mode, which cannot use prepared
> statements. The client is already configured with `prepare: false`; if you point at
> 6543 and see `prepared statement "s1" already exists`, that means a custom fork
> re-enabled preparation somewhere.

**Local.** With `DATABASE_URL` empty the server runs an embedded PGlite database under
`DATA_DIR/pglite`. No Docker, no Postgres install.

### Auth

Three modes, chosen with `AUTH_MODE`:

| Mode | Behaviour |
| --- | --- |
| `local` (default) | This app issues its own HS256 JWTs and stores scrypt password hashes. |
| `supabase` | Only Supabase access tokens are accepted. |
| `both` | Local accounts **and** Supabase tokens — recommended for a self-hosted migration. |

In `supabase` and `both`, tokens are verified and unknown accounts are provisioned
locally on first sight with `provider="supabase"`. Admin rights always come from the
local `users.role` column, never from the token, so a Supabase `role: "authenticated"`
user can never escalate.

Two token shapes are supported:

```bash
# 1. HS256 shared secret — the JWT_SECRET of your Supabase stack
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long

# 2. RS256/ES256 via JWKS — newer stacks sign asymmetrically
SUPABASE_URL=http://127.0.0.1:8000
# optional, defaults to <SUPABASE_URL>/auth/v1/.well-known/jwks.json
SUPABASE_JWKS_URL=
```

Keys are cached for 10 minutes and re-fetched automatically when an unknown `kid`
appears, so rotating signing keys does not require a restart.

**Letting GoTrue own the passwords.** Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then:

```bash
SUPABASE_PASSWORD_LOGIN=true
```

Sign-in then proxies the password grant to GoTrue, and registration creates the account
in Supabase. Two consequences worth knowing before you flip it:

- Sign-in is by **email address**, because that is GoTrue's identifier. Existing
  local-only accounts can no longer sign in by password.
- If your project requires email confirmation, registration returns
  `pendingConfirmation` and the user must confirm before signing in.

Leave it `false` to keep passwords in this app while still accepting Supabase tokens
from other clients — the `both` mode default.

GitHub and Google sign-in work in both modes when client IDs are present — the buttons stay hidden otherwise:

```bash
GITHUB_CLIENT_ID=...      # callback: <PUBLIC_BASE_URL>/api/v1/oauth/github/callback
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...      # callback: <PUBLIC_BASE_URL>/api/v1/oauth/google/callback
GOOGLE_CLIENT_SECRET=...
```

### Storage

`STORAGE_DRIVER=local` writes to `<DATA_DIR>/uploads` and serves through `/i/:key`.

`STORAGE_DRIVER=s3` talks to any S3-compatible service — AWS, Cloudflare R2, MinIO, OSS:

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=http://127.0.0.1:9000     # omit for AWS
S3_REGION=auto
S3_BUCKET=silverbed
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_PUBLIC_URL=                        # public origin for the bucket (CDN / r2.dev)
```

With `S3_PUBLIC_URL` set, asset routes stop proxying bytes: public frames 302 to the bucket, private frames 302 to a five-minute signed URL. Direct uploads (`/uploads/sign` + `/files/import`) are offered whenever the driver can presign a PUT.

### Mail

Without `SMTP_HOST` every message is printed to the console **and** recorded in the admin outbox, so nothing is lost in development. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` for real delivery.

### Other

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Listen address |
| `PUBLIC_BASE_URL` | `http://localhost:8787` | Origin used when building absolute URLs |
| `DATA_DIR` | `./data` | Uploads and the embedded database (resolved against the project root) |
| `WEB_DIST` | `../web/dist` | Built UI served by the API |
| `JWT_SECRET` | dev value | **Change in production** |
| `MAX_UPLOAD_MB` | `32` | Per-file limit |
| `GUEST_UPLOAD` | `false` | Allow anonymous uploads |
| `RATE_LIMIT` | `true` | Per-IP throttling on auth and upload; set `false` for automated test runs |
| `ALLOW_ORIGIN` | `*` | CORS origin |

---

## Deployment

### Docker

```bash
docker compose up -d --build
```

The volume `silverbed-data` holds uploads and the database. To try S3 storage against a local MinIO:

```bash
docker compose --profile s3 up -d
# then set STORAGE_DRIVER=s3 and S3_ENDPOINT=http://minio:9000
```

### Bare metal

```bash
bun install
bun run build
cd server && NODE_ENV=production PORT=8080 bun src/index.ts
```

Serve it behind a reverse proxy. The process serves `index.html` for unknown paths so client-side routing works; no separate static server is needed.

### Vercel (no server of your own)

| Piece | Runs on |
| --- | --- |
| UI | `web/dist` on Vercel's CDN |
| API | one Node function (`api/handler.ts`) for `/api/v1`, `/i`, `/image`, `/s`, `/open` |
| Database | Neon Postgres via `DATABASE_URL` |
| Images | a Cloudflare R2 bucket via the S3 driver |

1. **Bucket.** Create an R2 bucket and attach a public domain (`https://cdn.example.com`). Then add a CORS rule under *Settings → CORS Policy* — without it the browser's preflight fails and direct uploads die with "CORS Missing Allow Origin":

```json
[
  {
    "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:8787", "http://127.0.0.1:8787"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`S3_ENDPOINT` is the account-level URL (`https://<account>.r2.cloudflarestorage.com`) — no bucket, no trailing slash. A trailing `/<bucket>` is tolerated and stripped.
2. **Database.** Create a Neon project and use its pooled connection string (`?sslmode=require`).
3. **Project.** Import the repo in Vercel — `vercel.json` already sets the build command, the static output directory and the rewrites.
4. **Environment.**

```bash
DATABASE_URL=postgresql://…neon.tech/silverbed?sslmode=require
JWT_SECRET=<32+ random characters>
PUBLIC_BASE_URL=https://your-app.vercel.app
AUTH_MODE=local
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=silverbed
S3_ACCESS_KEY=…
S3_SECRET_KEY=…
S3_PUBLIC_URL=https://cdn.example.com
```

5. Deploy, then open `/setup` to create the first admin.

**Uploads.** Function request bodies cap at 4.5 MB, so the browser asks `POST /api/v1/uploads/sign` for a presigned PUT, sends the file straight to R2, then calls `POST /api/v1/files/import` — the function downloads the object only to build the thumbnail and preview.

**Serving.** `/i/<id>.<ext>` answers with a 302 to the bucket: the public CDN URL for public frames, a short-lived signed URL for private ones. Image bytes never pass through the function.

**Limits worth knowing.** Share ZIP downloads are assembled in the function and therefore cap at ~4.5 MB on Vercel — download large shares file by file. The embedded PGlite database cannot run in a serverless function, so `DATABASE_URL` is mandatory there. To verify the Node path locally, build the function bundle and run it under plain Node:

```bash
bun run build:node
DATABASE_URL= DATA_DIR=$PWD/.tmp-node/data node server/test/node-runner.mjs ./.tmp-node/handler.cjs
```

---

## API

Base path `/api/v1`. Responses are `{ "code": 0, "data": … }`; errors are `{ "code": "…", "message": "…" }` with a matching HTTP status.

Authenticate with `Authorization: Bearer <jwt>` or, for headless uploads, `X-Access-Key: <key>`. `/gallery` and the `/open/*` endpoints are readable without a token; everything else expects one.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/meta` | Site name, totals, enabled providers |
| `GET` | `/setup/status` · `POST` `/install` | First-run wizard |
| `POST` | `/auth/login` · `/auth/register` | Credentials → JWT |
| `GET` | `/auth/me` · `PATCH` `/auth/profile` · `POST` `/auth/password` | Account |
| `GET` | `/files` | List; `page`, `pageSize`, `scope`, `folderId`, `access`, `q`, `tag`, `sort` |
| `POST` | `/files/upload` | Multipart upload (`files`, optional `folderId`, `tags`, `access`) |
| `GET` `PATCH` `DELETE` | `/files/:id` | Read, rename/retag/move, trash |
| `POST` | `/files/:id/restore` | Restore from trash |
| `POST` | `/files/batch` | `move`, `delete`, `restore`, `access`, `tag` over `ids` |
| `GET` | `/files/stats` · `/stats/overview` | Per-user and dashboard numbers |
| `GET` | `/gallery` | Shared public sheet; `page`, `pageSize`, `q`, `sort`, `owner`, `mine`, `scope=trash` (admins) |
| `POST` | `/gallery/batch` | Same actions over `ids`; your own frames, or any frame as an admin |
| `GET` | `/gallery/owners` · `/gallery/owners/:id/folders` | Uploaders with public frames, and their folders (admin/self) |
| `GET` `POST` | `/folders` | Folder tree and creation |
| `GET` `POST` | `/tags` | Tags |
| `GET` `POST` | `/shares` | Share management |
| `GET` | `/public/shares/:token` | Resolve a share (supports `?t=<password>`) |
| `POST` | `/public/shares/:token/unlock` · `/report` | Password unlock, access log |
| `GET` `POST` `DELETE` | `/keys` | API keys |
| `GET` | `/admin/overview` · `/users` · `/settings` · `/activity` · `/mail` | Admin |
| `GET` | `/open/random` · `/open/list` | Public, unauthenticated reads |

Public asset routes sit outside `/api`:

```
/i/<id>.<ext>              original
/i/<id>.thumb.webp         thumbnail
/i/<id>.preview.webp       preview
/image/<id>                HTML page with Open Graph tags
/s/<token>                 share page
/s/<token>/download        ZIP of the share
```

### Upload from the command line

```bash
curl -X POST https://your.host/api/v1/files/upload \
  -H "X-Access-Key: sb_xxx" \
  -F "files=@photo.jpg" \
  -F "tags=landscape,select"
```

---

## Tests

```bash
bun run --cwd server test           # 66 end-to-end HTTP checks; 53 on a seeded instance (server must be running)
bun run --cwd server test:ui        # 34 browser checks, screenshots into .ui-shots/
bun run --cwd server test:supabase  # 17 Supabase auth checks, self-contained
bun run test:direct             # 13 direct-upload checks (needs bucket storage)
bun run typecheck                # tsc + vue-tsc
```

`test:supabase` needs no Supabase instance: it boots a minimal GoTrue stand-in that
signs real RS256 tokens, then asserts that the API accepts them, rejects tampered and
forged ones, provisions users correctly, and never grants admin from a token claim.

The browser suite needs a Playwright Chromium. The headless shell is enough and a
fraction of the download:

```bash
PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers bunx playwright install chromium --only-shell
export PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers   # same directory, or Playwright falls back to ~
```

The suite signs in as `admin / silverbed123` unless `UI_USER` / `UI_PASS` say otherwise,
so run it against a seeded instance.

`test:direct` needs a bucket: point `STORAGE_DRIVER=s3` at one (or at `node server/test/fake-s3.mjs`, a throwaway in-memory endpoint) and it walks sign → PUT → import → 302, including private frames and `?dl=1`.

Both suites run against a live instance. Reset to a clean state with:

```bash
rm -rf data && bun run seed
```

---

## Layout

```
api/
  handler.ts            Vercel function entry (web-standard fetch handler)
vercel.json             build, static output and rewrites for Vercel
server/
  src/
    config.ts            environment → typed config
    db/                  schema, connection, settings, seed
    lib/                 ids, jwt, password hashing, zip
    services/            storage drivers, image pipeline, auth, mail, activity
    routes/              one module per resource
    index.ts             app assembly and static hosting
  test/e2e.ts            API end-to-end suite
  test/ui.ts             browser smoke suite
web/
  src/
    components/          FrameTile, Lightbox, InspectorPanel, SideRail…
    views/               library, gallery, upload, stats, shares, keys, settings, admin
    styles/tokens.css    design tokens

```

## Design

The UI avoids the usual "AI dashboard" look — no gradient hero, no floating rounded cards, no drop shadows. It borrows from a darkroom contact sheet: hairline rules, frame numbers in mono, metadata set in IBM Plex Mono against Archivo for the interface, and a single safelight-orange accent reserved for actions, selection and destructive controls. The home page shows the live sheet of real uploads rather than marketing copy.

Tokens live in `web/src/styles/tokens.css`; every colour is a CSS variable with a light and a dark value.

## License

MIT
