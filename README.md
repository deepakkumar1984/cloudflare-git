# Deesha Git

A GitLab-style collaboration app built on Cloudflare Workers and Cloudflare
Artifacts. PostgreSQL stores groups, projects, issues, reviews, and permissions;
Artifacts stores the Git objects and refs.

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
Deesha detects the result. There are also no protected branches, CI, forks,
wikis, notifications, or anonymous/public access in M1.

## Architecture

```text
Browser ──HTTP──> Worker (React SPA + Hono API) ──Hyperdrive──> PostgreSQL
                              │
                              └── Artifacts binding ──> Git objects / tokens

Git client ──HTTPS──> app Git proxy (Worker) ──> Artifacts remote
                     (short-lived Artifacts token)

Push ──> Workflow ──┐
Cron ───────────────┼──> sync service (lease + idempotent) ──> PostgreSQL
Page refresh ───────┘
```

- **PostgreSQL** is the source of truth for collaboration data.
- **Artifacts** is the source of truth for Git objects and refs.
- A projection of refs/commits in Postgres powers repository browsing, MR diffs,
  merge detection, and activity.
- GitHub/GitLab imports use Artifacts' native import for public remotes and a
  short-lived, authenticated Git smart-HTTP proxy for private remotes.
- Clone and push URLs on the app's own domain are handled by a second, narrow
  Git smart-HTTP proxy (`/git/*`) that streams to the project's Artifacts
  remote. Artifacts does not support custom hostnames, so this proxy is what
  lets `git.deesha.tech` replace the `<account>.artifacts.cloudflare.net`
  remote. The direct Artifacts remote remains valid.
- The Workflow event trigger is the fast path. Cron reconciliation and the
  repository **Refresh** action are the fallback paths. The sync service is
  transport-agnostic.
- Local development uses an in-memory fake Artifacts adapter by default.
  `ARTIFACTS_FAKE=false` switches to the real binding; this has been validated
  against a live Artifacts remote (repo creation, token minting, clone/push,
  `listServerRefs`, tree/blob reads, diffs, and merge detection).
- The same managed PostgreSQL database is used for local development and the
  deployed Worker. Local development runs through Wrangler's Hyperdrive
  emulation; `scripts/dev.ts` points it at `DATABASE_URL` from `.dev.vars`.
  Deployments use the Hyperdrive binding. Tests and Playwright use isolated
  Docker databases and never touch the managed database.

## Stack

- Cloudflare Workers, `@cloudflare/vite-plugin`, Hono, Zod
- React 19, React Router 7, TanStack Query, Tailwind CSS 4
- Drizzle ORM + `postgres.js` through Cloudflare Hyperdrive
- Better Auth (email/password + username plugin)
- Cloudflare Workflows + cron triggers
- Vitest, Playwright (UI checks), Docker PostgreSQL

## Local setup

Prerequisites: Node 24+, Docker, npm, and a Wrangler-authenticated Cloudflare
account with Artifacts access if you want to use the real storage.

```bash
npm install
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars` with the managed database connection string and secrets:

```dotenv
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=prefer
BETTER_AUTH_SECRET=<openssl rand -base64 32>
PROVIDER_TOKEN_KEY=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:5173
ADMIN_EMAILS=you@example.com
ARTIFACTS_FAKE=true
# Optional, defaults to https://gitlab.com:
# GITLAB_BASE_URL=https://gitlab.com
# Local-only provider demo mode; never enable in production:
# GIT_PROVIDERS_FAKE=true
```

Then apply migrations to the managed database and start the app:

```bash
npm run db:migrate
npm run dev
```

The npm `dev` script runs Wrangler's local Hyperdrive emulation against
`DATABASE_URL`. Deployed Workers use the Hyperdrive binding configured in
`wrangler.jsonc`. The Docker `db` service is no longer required for app
development; `db:test:up` is only for the isolated test database.

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
  because they share the database. Rotating it requires reconnecting accounts.
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

The app is served on `https://git.deesha.tech`. The custom hostname lives in the
top-level `routes` block in `wrangler.jsonc` and requires the `deesha.tech` zone
to be active on the same Cloudflare account. Wrangler creates the DNS record and
certificate on deploy.

`npm run deploy` also injects the production runtime values, overriding the
local defaults in `wrangler.jsonc`:

```bash
APP_URL=https://git.deesha.tech
BETTER_AUTH_URL=https://git.deesha.tech
ENVIRONMENT=production
```

If the domain changes, update both `routes[0].pattern` and those `--var` values
in the `deploy` script, then redeploy.

Artifacts has no custom-domain support: the real remote is always
`https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<namespace>/<repo>.git`. The
API therefore rewrites clone URLs to `https://git.deesha.tech/git/...`, and the
Worker's proxy forwards them:

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
npm run db:test:up
npm test
npm run typecheck
npm run lint
```

Integration tests use the Docker database on port `55433` by default and refuse
to run against any other host/port/database name. They apply migrations and
truncate all public tables between tests. `TEST_DATABASE_URL` may override the
default only if it still points at a `localhost:55433` database ending in
`_test`. Tests never touch the managed app database. `npm test` runs unit tests
and integration tests sequentially.

The Playwright smoke test drives the real UI: signup, group/project setup,
provider-import page rendering, branch seeding, merge-request creation, review
approval, diff viewing, and issue close/reopen. It starts its own dev server on
port `5174` against the isolated Docker test database (never the managed app
database) and creates random users and slugs. The E2E server always runs with
`ARTIFACTS_FAKE=true` so tests never call the real Artifacts or GitHub APIs,
even when the developer's `.dev.vars` uses live storage; the wrapper generates
a temporary `.dev.vars.e2e` (mode `0600`, removed on shutdown) and selects it
with `CLOUDFLARE_ENV=e2e`.

```bash
npm run db:test:up
npx playwright install chromium
npm run test:e2e
```

Set `PLAYWRIGHT_CHROME_PATH=/path/to/chrome` to use a system browser instead.

### Useful scripts

| Command               | Purpose                                |
| --------------------- | -------------------------------------- |
| `npm run dev`         | Vite dev server + Worker               |
| `npm run dev:e2e`     | Dev server forced to fake Artifacts    |
| `npm run build`       | Production build into `dist/`          |
| `npm run typecheck`   | `tsc --noEmit`                         |
| `npm run lint`        | oxlint                                 |
| `npm test`            | Vitest unit + integration suite        |
| `npm run db:generate` | Generate a Drizzle migration           |
| `npm run db:migrate`  | Apply migrations                       |
| `npm run db:reset`    | Destructive local-only reset + migrate |
| `npm run db:studio`   | Drizzle Studio                         |

## Configuration and deployment

1. **Create the production database and Hyperdrive config.** Caching should be
   disabled initially so reads are immediately consistent with writes:

   ```bash
   npx wrangler hyperdrive create deesha-git-db \
     --caching-disabled \
     --connection-string="postgres://USER:PASSWORD@HOST:5432/DB"
   ```

   Put the returned ID into `wrangler.jsonc` (`hyperdrive[0].id`). Keep the
   local connection string for local development.

2. **Apply migrations directly to the managed database before deploying.** Do
   not use Hyperdrive for migrations:

   ```bash
   DATABASE_URL="postgres://..." npx drizzle-kit migrate
   ```

3. **Set production secrets.** The `deploy` script injects the production
   `APP_URL`, `BETTER_AUTH_URL`, and `ENVIRONMENT` values, so the local defaults
   in `wrangler.jsonc` do not leak into the deployment. `APP_URL` must be the
   public HTTPS origin, including for the private-import proxy and Git proxy.
   Then:

   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put PROVIDER_TOKEN_KEY
   npx wrangler secret put ADMIN_EMAILS
   npm run deploy
   ```

   Use the same `PROVIDER_TOKEN_KEY` value as local development. If it is
   missing, the app falls back to `BETTER_AUTH_SECRET`; connections encrypted
   with a different auth secret will fail to decrypt.

   Do not set `DATABASE_URL` as a production secret; deployed Workers use the
   Hyperdrive binding. Do not deploy with `ARTIFACTS_FAKE=true` or
   `GIT_PROVIDERS_FAKE=true`. The real binding requires the `ARTIFACTS` binding
   and namespace configured in `wrangler.jsonc`. Set `GITLAB_BASE_URL` as a
   Worker var only when importing from a self-hosted GitLab instance.

4. **Verify the deployed pipeline.** Confirm `/api/health` and the SPA load on
   the custom domain. Create a project, mint a write credential from Clone, clone
   and push through the `https://git.deesha.tech/git/...` URL, and confirm the
   repository page updates. Check the Workflow instance and the cron
   reconciliation fallback. Merge a branch locally, push the target branch, and
   confirm the MR is marked merged.

### Environment separation

Use different Artifacts namespaces, Hyperdrive configs, PostgreSQL databases,
and Workers for staging and production. The event trigger filters by namespace,
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
