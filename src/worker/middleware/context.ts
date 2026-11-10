import type { MiddlewareHandler } from "hono";
import { createDatabase } from "@db/client";
import { isArtifactsErrorCode } from "@worker/artifacts/types";
import { createAuth } from "@worker/auth";
import type { AppEnv } from "@worker/env";
import { AppError, forbidden } from "@worker/lib/errors";

export const requestIdMiddleware: MiddlewareHandler<AppEnv> = async (
  c,
  next
) => {
  const incoming = c.req.header("x-request-id");
  const requestId =
    incoming && /^[A-Za-z0-9._-]{1,100}$/.test(incoming)
      ? incoming
      : crypto.randomUUID();
  c.header("x-request-id", requestId);
  await next();
};

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  if ((c.env.ENVIRONMENT as string) === "production") {
    c.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "worker-src 'self'",
        "manifest-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    );
  }
};

export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = createDatabase(c.env.DB);
  c.set("db", db);
  c.set("auth", createAuth(db, c.env));
  await next();
};

export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.get("auth");
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  c.set("session", session);
  await next();
};

export const csrfMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await next();
    return;
  }

  const origin = c.req.header("origin");
  if (origin) {
    let expected: string;
    try {
      expected = new URL(c.req.url).origin;
    } catch {
      throw forbidden("Invalid request origin");
    }
    if (origin !== expected) throw forbidden("Cross-origin request rejected");
  }

  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite === "cross-site")
    throw forbidden("Cross-site request rejected");

  await next();
};

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const retryAfter =
      error.details &&
      typeof error.details === "object" &&
      "retryAfterSeconds" in error.details &&
      typeof error.details.retryAfterSeconds === "number"
        ? error.details.retryAfterSeconds
        : null;
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      {
        status: error.status,
        headers:
          retryAfter === null
            ? undefined
            : { "Retry-After": String(retryAfter) },
      }
    );
  }

  // A project can reference an Artifacts repository that no longer exists
  // (for example an imported project created in fake mode, or a repository
  // deleted outside the app). Surface an actionable error instead of a 500.
  if (isArtifactsErrorCode(error, "NOT_FOUND")) {
    return Response.json(
      {
        error: {
          code: "REPOSITORY_UNAVAILABLE",
          message:
            "The Cloudflare Artifacts repository is missing. Re-import this project from its settings to restore the source.",
        },
      },
      { status: 404 }
    );
  }

  console.error("unhandled_request_error", error);
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    },
    { status: 500 }
  );
}
