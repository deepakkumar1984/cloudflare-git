# Cloudflare Git

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/deepakkumar1984/cloudflare-git)

A GitLab-style collaboration app built on Cloudflare Workers, D1, and
Artifacts. D1 stores groups, projects, issues, reviews, and permissions.
Artifacts stores the Git objects and refs. Worker name, D1 database, Artifacts
namespace, app name, and public URL are chosen when you run `npm run setup`.

## What is in Milestone 1

- Email + username + password auth, sessions, personal groups
- Groups and projects with private/internal visibility
- Five-level roles: guest, reporter, developer, maintainer, owner
- Repository browser: branches, trees, blobs, raw downloads, commits, README
- Clone/push with short-lived read or write Artifacts credentials, optionally
  through the app's own custom domain via a streaming Git proxy
- Issues, comments, markdown checklists, labels, milestones
- Label-backed issue boards with drag-and-drop moves
- Merge requests: create, review, approve/request changes, discussions,
  changed-file metadata, lazy per-file diffs, commit list
- Merge detection after pushes (fast-forward, merge commit, squash/rebase
  heuristic, manual maintainer fallback)
- GitHub/GitLab repository import with a personal access token, repo picker,
  private-repository proxy, and manual re-import
- Permission-aware dashboard, project activity, and global search

There is deliberately **no server-side merge**. Users merge locally and push;
the app detects the result. There are also no protected branches, CI, forks,
wikis, notifications, or anonymous/public access in M1.

## Architecture

```text
Browser ──HTTP──> Worker (React SPA + Hono API) ──D1──> SQLite metadata
                              │
                              └── Artifacts binding ──> Git objects / tokens

Git client ──HTTPS──> app Git proxy (Worker) ──> Artifacts remote
                     (short-lived Artifacts token)

Push ──> Workflow ──┐
Cron ───────────────┼──> sync service (lease + idempotent) ──> D1
Page refresh ───────┘
```

- **D1** (binding `DB`) is the source of truth for collaboration metadata.
  `npm run setup` creates or reuses the database and points local dev, E2E,
  and deploy at that remote database. Git objects stay in Artifacts.
- **Artifacts** is the source of truth for Git objects and refs.
- A projection of refs/commits in D1 powers repository browsing, MR diffs,
  merge detection, and activity.
- GitHub/GitLab imports use Artifacts' native import for public remotes and a
  short-lived, authenticated Git smart-HTTP proxy for private remotes.
- Clone and push URLs on the app's own domain are handled by a second, narrow
  Git smart-HTTP proxy (`/git/*`) that streams to the project's Artifacts
  remote. Artifacts does not support custom hostnames, so this proxy is what
  lets your public hostname replace the
  `<account>.artifacts.cloudflare.net` remote. The direct Artifacts remote
  remains valid.
- The Workflow event trigger is the fast path. Cron reconciliation and the
  repository **Refresh** action are the fallback paths. The sync service is
  transport-agnostic.
- Local development uses an in-memory fake Artifacts adapter by default.
  `ARTIFACTS_FAKE=false` switches to the real binding; this has been validated
  against a live Artifacts remote (repo creation, token minting, clone/push,
  `listServerRefs`, tree/blob reads, diffs, and merge detection).
- Local development, E2E, and the deployed Worker all use the remote D1
  database (`remote: true` on the `DB` binding). Vitest uses an in-memory
  database so the suite can clear tables without touching the shared one.

## Stack

- Cloudflare Workers, `@cloudflare/vite-plugin`, Hono, Zod
- React 19, React Router 7, TanStack Query, Tailwind CSS 4
- Drizzle ORM on Cloudflare D1 (SQLite)
- Better Auth (email/password + username plugin)
- Cloudflare Workflows + cron triggers
- Vitest, Playwright, Miniflare (local D1)

## Local setup

Prerequisites: Node 24+, npm, and a Wrangler-authenticated Cloudflare account
with Artifacts access if you want to use the real storage. Docker is not required.

```bash
npm install
npm run setup
cp .dev.vars.example .dev.vars
```

`npm run setup` checks `wrangler whoami`, opens `wrangler login` if needed, and
asks for the worker name, app name, D1 database name, Artifacts namespace,
optional custom domain, and public URL. It creates the D1 database when that
name does not already exist, then rewrites `wrangler.jsonc` and writes
`.cloudflare-git.json`. The committed `wrangler.jsonc` is only a template with
a placeholder database id. After setup, your copy contains your account id and
database id. Do not commit that copy. `.cloudflare-git.json` is gitignored.
Run setup again to change them.

For a scripted run, set `CLOUDFLARE_GIT_APP_URL` and any of
`CLOUDFLARE_GIT_WORKER_NAME`, `CLOUDFLARE_GIT_APP_NAME`,
`CLOUDFLARE_GIT_D1_NAME`, `CLOUDFLARE_GIT_ARTIFACTS_NAMESPACE`, and
`CLOUDFLARE_GIT_CUSTOM_DOMAIN`.

Fill `.dev.vars` with secrets:

```dotenv
BETTER_AUTH_SECRET=<openssl rand -base64 32>
PROVIDER_TOKEN_KEY=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:5173
ENVIRONMENT=development
ADMIN_EMAILS=you@example.com
ARTIFACTS_FAKE=true
# Optional, defaults to https://gitlab.com:
# GITLAB_BASE_URL=https://gitlab.com
# Local-only provider demo mode; never enable in production:
# GIT_PROVIDERS_FAKE=true
```

`npm run dev` applies migrations to the remote D1 database from `wrangler.jsonc`
and starts Vite. That is the same database the deployed Worker uses. The app
name shown in the UI comes from the `APP_NAME` var (`GET /api/meta`).

```bash
npm run dev
```

Open <http://localhost:5173>, create an account, and create a group/project.
Emails listed in `ADMIN_EMAILS` are promoted to admin on account creation; an
admin bypasses membership checks.

### Fake repository data

With `ARTIFACTS_FAKE=true`, repositories are in memory and reset when the Worker
reloads. Seed the current project with demo files and branches:

```bash
# While signed in via the browser, use the returned session cookie:
curl -X POST -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"branch":"feature/demo","baseBranch":"main"}' \
  http://localhost:5173/api/v1/groups/GROUP/PROJECT/repository/dev-seed
```

Call it once without a body to seed the default branch, then with a branch name
to create a child branch for merge-request testing. The endpoint is only
available when `ENVIRONMENT=development` and `ARTIFACTS_FAKE=true`.

### GitHub/GitLab import

Open a group and choose **Import repo**, or visit
`/groups/GROUP/projects/import`.

- **Repository URL + Public** needs no token. Paste a GitHub or GitLab HTTPS URL
  and Artifacts imports the public remote directly.
- **Repository URL + Private** uses the current user’s saved provider token and
  the import proxy.
- **Browse connected repos** lets you connect a provider once, list repositories,
  and select one.
- GitHub.com: classic tokens with `repo`, or fine-grained tokens with
  **Contents: Read**. GitHub Enterprise is not supported in this milestone.
- GitLab.com or self-hosted GitLab via `GITLAB_BASE_URL`: tokens with
  `read_api` and `read_repository`.
- Tokens are stored encrypted under `PROVIDER_TOKEN_KEY` per user and provider.
  You do **not** need to paste a token for every import; it is reused for
  listing, imports, and re-imports until disconnected. Plaintext tokens are
  never returned by the API or stored in logs.
- Keep `PROVIDER_TOKEN_KEY` identical across local and deployed environments
  when they share imported credentials. Rotating it requires reconnecting accounts.
- Private repositories are fetched through a short-lived, repo-scoped Worker
  proxy because the Artifacts import API has no credential parameter. The
  proxy URL contains a random one-time import capability, allows only
  `git-upload-pack`, expires after 30 minutes, and is removed when the import
  finishes. It requires a public HTTPS `APP_URL` when using real Artifacts.
- Import is a **one-time copy**, not a continuous mirror. Re-import from project
  settings replaces the repository contents and remote, closes open merge
  requests, revokes clone credentials, and requires users to re-clone. Public
  imports can be re-imported without a token; private imports use the stored
  token.
- Large repositories may exceed the Artifacts import memory budget when the
  full history is requested; the import fails with a `MEMORY_LIMIT` error.
  **History depth defaults to `1`** in the import and re-import forms. A
  shallow import still contains the complete source tree; increase the depth
  only when you need more commit history and the repository is small enough.
- Imported projects created while `ARTIFACTS_FAKE=true` contain placeholder
  demo files. After switching to `ARTIFACTS_FAKE=false`, open project settings
  and re-import to fetch the real source; the project page also shows a warning
  when its remote is a fake repository.
- `GIT_PROVIDERS_FAKE=true` is honored only outside production and is intended
  for local/E2E demos. It lists fixed demo repositories and accepts any token of
  at least eight characters.

### Custom domain and clone URLs

Leave the custom domain blank in setup to serve the Worker on
`https://<worker-name>.<account-subdomain>.workers.dev`. To use your own
hostname, enter it during setup. The zone must already be on the same
Cloudflare account. Wrangler creates the DNS record and certificate on deploy.

The [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
button clones this repository into your Git account and provisions the Worker,
D1 database, and workflow. `ENVIRONMENT` defaults to `production`. Before it
deploys, set `APP_URL` to the public https origin and set `BETTER_AUTH_URL` to
that same origin.

`npm run deploy` applies remote D1 migrations for the `DB` binding, then runs
`wrangler deploy` with the vars in `wrangler.jsonc`. When you deploy from
`npm run setup`, that step instead reads `.cloudflare-git.json` and overrides
the local defaults for that deployment:

```text
APP_URL=<public origin from setup>
BETTER_AUTH_URL=<same origin>
APP_NAME=<app name from setup>
ENVIRONMENT=production
```

Local `wrangler.jsonc` keeps `APP_URL=http://localhost:5173`. `ENVIRONMENT` in
that file is `production`, and `.dev.vars` sets `ENVIRONMENT=development` for
`npm run dev`. Run `npm run setup` again when the public URL or domain changes.

Artifacts has no custom-domain support: the real remote is always
`https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<namespace>/<repo>.git`. The
API rewrites clone URLs onto the public app origin, and the Worker's proxy
forwards them:

- Only the Git smart-HTTP operations (`info/refs`, `git-upload-pack`,
  `git-receive-pack`) are accepted; the namespace and repository must exist in
  the app database.
- The user's Artifacts token is passed through unchanged. The proxy never mints
  or stores credentials, and only forwards a small allowlist of Git headers —
  browser cookies and origin headers are dropped.
- Request and response bodies stream through the Worker. Artifacts' per-push cap
  is 64 MiB, below the 100 MB request-body limit for Free/Pro zones; very large
  or very slow clones still consume Worker and proxy time.
- Direct clone/push using the underlying `artifacts.cloudflare.net` remote keeps
  working with the same token, which is useful for troubleshooting.

### Tests

```bash
npm test
npm run typecheck
npm run lint
```

Integration tests boot an in-memory Miniflare D1 database, apply
`src/db/migrations`, and delete every application table between tests. They
do not open the remote database, because each test clears every table.
`npm test` runs unit tests and integration tests sequentially.

Search queries are trimmed to 48 UTF-8 bytes before `LIKE`, because D1 rejects
patterns longer than 50 bytes. `%` and `_` in the query still act as wildcards.
SQLite `LIKE` is case-insensitive for ASCII only. Bulk inserts are chunked so
a statement stays under D1's 100 bound parameters. D1 has no interactive
transactions; multi-row writes use `db.batch`, which is atomic. An IID can be
skipped if the insert after allocation fails.

The Playwright smoke test drives the real UI: signup, group/project setup,
provider-import page rendering, branch seeding, merge-request creation, review
approval, diff viewing, and issue close/reopen. It starts its own dev server on
port `5174` against the remote D1 database and creates random users and slugs
there. The E2E server always runs with `ARTIFACTS_FAKE=true` so tests never
call the real Artifacts or GitHub APIs, even when the developer's `.dev.vars`
uses live storage; the wrapper generates a temporary `.dev.vars.e2e` (mode
`0600`, removed on shutdown) and selects it with `CLOUDFLARE_ENV=e2e`.

```bash
npx playwright install chromium
npm run test:e2e
```

Set `PLAYWRIGHT_CHROME_PATH=/path/to/chrome` to use a system browser instead.

### Useful scripts

| Command               | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `npm run setup`       | Log in to Cloudflare and write local config |
| `npm run dev`         | Apply remote D1 migrations and start Vite   |
| `npm run dev:e2e`     | Dev server forced to fake Artifacts         |
| `npm run build`       | Production build into `dist/`               |
| `npm run typecheck`   | `tsc --noEmit`                              |
| `npm run lint`        | oxlint                                      |
| `npm test`            | Vitest unit + integration suite             |
| `npm run db:generate` | Generate a Drizzle SQLite migration         |
| `npm run db:migrate`  | Apply migrations to remote D1               |
| `npm run deploy`      | Migrate remote D1 and run `wrangler deploy` |
| `npm run db:studio`   | Drizzle Studio                              |

## Configuration and deployment

1. **Run `npm run setup`.** It selects the logged-in Cloudflare account, then
   asks for the worker name (default `cloudflare-git`), the app name shown in
   the UI (default `Cloudflare Git`), the D1 database name, the Artifacts
   namespace, an optional custom domain, and the public URL. Binding name stays
   `DB`. Do not enable D1 read replication. Setup reuses a database with the
   same name and creates one otherwise.

2. **Apply migrations** to that remote database. Setup can do this, and
   `npm run dev` does it again. There is no separate local copy.

   ```bash
   npm run db:migrate
   ```

   Backups: `npx wrangler d1 export <database-name> --remote --output backup.sql`.
   D1 Time Travel can restore a remote database to an earlier bookmark. Git
   objects are not in that export; they stay in the Artifacts namespace from
   setup.

3. **Set production secrets, then deploy.** Use the Deploy to Cloudflare button,
   or set `APP_URL` and `BETTER_AUTH_URL` to the public https origin before
   `npm run deploy`. `ENVIRONMENT` is already `production`. `APP_URL` must be
   that public origin, including for the private-import proxy and Git proxy.
   Setup can deploy with those overrides and copy secrets from `.dev.vars`, or
   you can do it yourself:

   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put PROVIDER_TOKEN_KEY
   npx wrangler secret put ADMIN_EMAILS
   npm run deploy
   ```

   `wrangler secret put` publishes a Worker version. Use the same
   `PROVIDER_TOKEN_KEY` value as local development. If it is missing, the app
   falls back to `BETTER_AUTH_SECRET`; connections encrypted with a different
   auth secret will fail to decrypt.

   Do not deploy with `ARTIFACTS_FAKE=true` or `GIT_PROVIDERS_FAKE=true`. The
   real binding requires the `ARTIFACTS` binding and namespace configured in
   `wrangler.jsonc`. Set `GITLAB_BASE_URL` as a Worker var only when importing
   from a self-hosted GitLab instance.

4. **Verify the deployed pipeline.** Confirm `/api/health` and the SPA load on
   the public URL. Create a project, mint a write credential from Clone, clone
   and push through `https://<your-host>/git/...`, and confirm the repository
   page updates. Check the Workflow instance and the cron reconciliation
   fallback. Merge a branch locally, push the target branch, and confirm the
   MR is marked merged.

### Environment separation

Use different Artifacts namespaces, D1 databases, and Workers for staging and
production. The event trigger filters by namespace,
so do not share a namespace between environments.

## Roles

Effective project role is the maximum of direct project membership, inherited
group membership, and admin bypass.

| Action                                                      | Minimum role |
| ----------------------------------------------------------- | ------------ |
| View project, issues, MRs, comment                          | guest        |
| Clone / mint read token, create issue, move board card      | reporter     |
| Push / write token, create MR, review/approve               | developer    |
| Manage labels, milestones, boards, settings, mark MR merged | maintainer   |
| Manage members, archive project/group, change visibility    | owner        |

Private projects are invisible without a role. Internal projects are visible to
authenticated users. Confidential issues require reporter access or higher.

## Security notes

- Git credentials are short-lived and displayed once; only Artifacts token IDs
  are stored, never plaintext tokens.
- Raw repository files are always served as attachments with `nosniff` and a
  sandboxed CSP so user-controlled HTML/SVG is never rendered same-origin.
- Markdown is rendered through `react-markdown` + `rehype-sanitize`; raw HTML is
  not enabled.
- Unsafe API methods enforce same-origin checks. Better Auth handles sessions in
  HttpOnly, SameSite=Lax cookies.
- Provider tokens are encrypted at rest with AES-GCM under
  `PROVIDER_TOKEN_KEY`; the API returns only connection metadata. The import
  proxy exposes a random, short-lived capability
  in its URL to Artifacts, so treat proxy URLs as secrets and do not add request
  URL logging that captures path segments without redaction.
- Artifacts cannot enforce protected branches: any developer with a write token
  can push any branch, including the default branch. This is a documented M1
  limitation, not an app bug.
- M1 does not include email verification or password reset. Treat it as an
  internal/controlled-use release until those are added.

## License

[MIT](LICENSE)
