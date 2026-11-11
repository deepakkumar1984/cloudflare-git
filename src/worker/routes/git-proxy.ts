import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { projects } from "@db/schema";
import { configuredAppName } from "@shared/constants";
import type { AppEnv } from "@worker/env";
import {
  BodyTooLargeError,
  capBody,
  contentLengthTooLarge,
} from "@worker/lib/limited-body";

export const gitProxyRoutes = new Hono<AppEnv>();

const NAMESPACE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const REPO_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const ARTIFACTS_HOST = "artifacts.cloudflare.net";

const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "content-length",
  "accept",
  "accept-encoding",
  "content-encoding",
  "git-protocol",
  "user-agent",
] as const;

function proxyError(
  message: string,
  status: number,
  extraHeaders?: HeadersInit
): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function artifactsRemoteUrl(remote: string | null): URL | null {
  if (!remote) return null;

  try {
    const url = new URL(remote);
    const host = url.hostname.toLowerCase();
    const isArtifacts =
      host === ARTIFACTS_HOST || host.endsWith(`.${ARTIFACTS_HOST}`);
    if (url.protocol !== "https:" || !isArtifacts) return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * A public Git remote on the app's own domain. Artifacts only exposes
 * `<account>.artifacts.cloudflare.net`, so this transparently forwards the Git
 * smart-HTTP endpoints to the project's stored Artifacts remote. Artifacts
 * tokens still authenticate every request; the proxy never mints or stores
 * credentials.
 */
async function handleGitProxy(c: Context<AppEnv>): Promise<Response> {
  const method = c.req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return proxyError("Method not allowed", 405);
  }

  const namespace = c.req.param("namespace") ?? "";
  const repoSegment = c.req.param("repo") ?? "";

  if (!NAMESPACE_RE.test(namespace) || !repoSegment.endsWith(".git")) {
    return proxyError("Not found", 404);
  }

  // Hono does not expose the unnamed trailing wildcard as a path param, so
  // derive the Git operation from the mounted path.
  const prefix = `/git/${namespace}/${repoSegment}/`;
  if (!c.req.path.startsWith(prefix)) return proxyError("Not found", 404);
  const operation = c.req.path.slice(prefix.length);
  const repoName = repoSegment.slice(0, -4);
  if (!REPO_RE.test(repoName)) return proxyError("Not found", 404);

  const supported =
    method === "POST"
      ? operation === "git-upload-pack" || operation === "git-receive-pack"
      : operation === "info/refs";
  if (!supported) return proxyError("Not found", 404);

  if (!c.req.header("authorization")) {
    return proxyError("Authentication required", 401, {
      "WWW-Authenticate": `Basic realm="${configuredAppName(c.env.APP_NAME)}"`,
    });
  }

  if (namespace !== c.env.ARTIFACTS_NAMESPACE) {
    return proxyError("Not found", 404);
  }

  const [project] = await c
    .get("db")
    .select({ remote: projects.artifactsRemote })
    .from(projects)
    .where(
      and(
        eq(projects.artifactsNamespace, namespace),
        eq(projects.artifactsRepoName, repoName)
      )
    )
    .limit(1);

  const remote = artifactsRemoteUrl(project?.remote ?? null);
  if (!remote) return proxyError("Not found", 404);

  const remotePath = remote.pathname.replace(/\/+$/, "");
  if (!remotePath.endsWith(`/${repoName}.git`)) {
    return proxyError("Not found", 404);
  }

  const requestUrl = new URL(c.req.url);
  const upstream = new URL(remote.toString());
  upstream.pathname = `${remotePath}/${operation}`;
  const service = requestUrl.searchParams.get("service");
  if (service) {
    if (service !== "git-upload-pack" && service !== "git-receive-pack") {
      return proxyError("Unsupported Git service", 400);
    }
    upstream.searchParams.set("service", service);
  }

  if (contentLengthTooLarge(c.req.raw)) {
    return proxyError("Request body is too large", 413);
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(upstream, {
      method,
      headers,
      body: method === "POST" ? capBody(c.req.raw.body) : undefined,
      redirect: "manual",
    });
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return proxyError("Request body is too large", 413);
    }
    return proxyError("Git storage is unreachable", 502);
  }

  // Stream Artifacts' response straight back. Copying the headers preserves
  // Git's advertisement/pack content types and transport encoding.
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("set-cookie");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

gitProxyRoutes.all("/:namespace/:repo/*", handleGitProxy);
