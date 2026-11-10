import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  importProxySessions,
  projectImports,
  type ImportProxySession,
} from "@db/schema";
import {
  IMPORT_PROXY_MAX_REQUESTS_PER_MINUTE,
  type GitProvider,
} from "@shared/constants";
import type { AppEnv } from "@worker/env";
import { consumeRateLimit } from "@worker/lib/rate-limit";
import { providerGitAuthorization } from "@worker/services/git-providers";
import {
  decryptProviderToken,
  providerTokenSecret,
} from "@worker/services/token-vault";

export const importProxyRoutes = new Hono<AppEnv>();

const TOKEN_RE = /^deesha_import_[A-Za-z0-9_-]{43}$/;

function proxyError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function proxySession(
  db: AppEnv["Variables"]["db"],
  tokenHash: string
): Promise<
  | {
      session: ImportProxySession;
      importStatus: string;
    }
  | undefined
> {
  return db
    .select({
      session: importProxySessions,
      importStatus: projectImports.status,
    })
    .from(importProxySessions)
    .innerJoin(
      projectImports,
      eq(importProxySessions.projectImportId, projectImports.id)
    )
    .where(
      and(
        eq(importProxySessions.tokenHash, tokenHash),
        isNull(importProxySessions.revokedAt),
        gt(importProxySessions.expiresAt, new Date())
      )
    )
    .limit(1)
    .then((rows) => rows[0]);
}

async function handleProxy(c: Context<AppEnv>) {
  const rawToken = c.req.param("token");
  if (!rawToken || !TOKEN_RE.test(rawToken)) {
    return proxyError("Not found", 404);
  }

  const limit = consumeRateLimit(
    `import-proxy:${rawToken.slice(-20)}`,
    IMPORT_PROXY_MAX_REQUESTS_PER_MINUTE,
    60_000
  );
  if (!limit.allowed) {
    return proxyError("Too many requests", 429);
  }

  const db = c.get("db");
  const tokenHash = await sha256Hex(rawToken);
  const row = await proxySession(db, tokenHash);
  if (
    !row ||
    (row.importStatus !== "pending" && row.importStatus !== "importing")
  ) {
    return proxyError("Not found", 404);
  }

  const method = c.req.method.toUpperCase();
  const prefix = `/api/v1/import-proxy/${rawToken}/`;
  const pathname = new URL(c.req.url).pathname;
  if (!pathname.startsWith(prefix)) return proxyError("Not found", 404);
  const subpath = pathname.slice(prefix.length);

  let operation: "info/refs" | "git-upload-pack";
  if (
    method === "GET" &&
    (subpath === "repo.git/info/refs" || subpath === "info/refs")
  ) {
    const service = c.req.query("service");
    if (service !== "git-upload-pack") {
      return proxyError("Unsupported Git service", 400);
    }
    operation = "info/refs";
  } else if (
    method === "POST" &&
    (subpath === "repo.git/git-upload-pack" || subpath === "git-upload-pack")
  ) {
    operation = "git-upload-pack";
  } else {
    return proxyError("Unsupported Git operation", 404);
  }

  let providerToken: string;
  try {
    providerToken = await decryptProviderToken(
      providerTokenSecret(c.env),
      row.session.encryptedToken
    );
  } catch {
    return proxyError("Import credentials are unavailable", 401);
  }

  const base = new URL(row.session.gitBaseUrl);
  const repoPath = row.session.externalRepo
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const upstream = new URL(`${base.origin}/${repoPath}.git/${operation}`);
  if (operation === "info/refs") {
    upstream.searchParams.set("service", "git-upload-pack");
  }
  if (upstream.origin !== base.origin) {
    return proxyError("Invalid upstream", 400);
  }

  const headers = new Headers({
    Authorization: providerGitAuthorization(
      row.session.provider as GitProvider,
      providerToken
    ),
    "User-Agent": "Deesha-Git-Import-Proxy",
  });
  for (const name of ["accept", "content-type", "git-protocol"]) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(upstream, {
      method,
      headers,
      body: method === "POST" ? await c.req.arrayBuffer() : undefined,
      redirect: "follow",
    });
  } catch {
    return proxyError("Git provider unreachable", 502);
  }

  const responseHeaders = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  const contentType = response.headers.get("content-type");
  if (contentType) responseHeaders.set("Content-Type", contentType);

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

importProxyRoutes.on(["GET", "POST"], "/:token/*", handleProxy);
importProxyRoutes.on(["GET", "POST"], "/:token", handleProxy);
