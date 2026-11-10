import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "./env";
import { errorResponse } from "./middleware/context";
import {
  csrfMiddleware,
  requestContext,
  requestIdMiddleware,
  securityHeaders,
  sessionMiddleware,
} from "./middleware/context";
import { mountApiRoutes } from "./routes";
import { gitProxyRoutes } from "./routes/git-proxy";
import { importProxyRoutes } from "./routes/import-proxy";
import { AppError } from "./lib/errors";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 2 * 1_024 * 1_024,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "TOO_LARGE",
              message: "Request body is too large",
            },
          },
          413
        ),
    }),
    requestIdMiddleware,
    securityHeaders,
    requestContext
  );

  app.get("/api/health", async (c) => {
    try {
      const sql = c.get("sql");
      await sql`select 1 as ok`;
      return c.json({
        ok: true,
        environment: c.env.ENVIRONMENT,
        artifacts: c.env.ARTIFACTS_FAKE === "true" ? "fake" : "live",
        time: new Date().toISOString(),
      });
    } catch (error) {
      console.error("health_check_failed", error);
      return c.json(
        { ok: false, error: { code: "DATABASE_UNAVAILABLE" } },
        503
      );
    }
  });

  // The Git smart-HTTP proxy is called by Artifacts, not by a browser, so it
  // must run before session and CSRF middleware. The opaque path token is the
  // only credential; it is short-lived and scoped to one import.
  app.route("/api/v1/import-proxy", importProxyRoutes);

  // Public clone/push URLs on the app's own domain. Git clients authenticate
  // with Artifacts tokens, not browser sessions or CSRF tokens, so this sits
  // outside the API middleware. The proxy only forwards smart-HTTP operations
  // and validates the repository path against the database.
  app.use("/git/*", requestIdMiddleware, securityHeaders, requestContext);
  app.route("/git", gitProxyRoutes);

  app.all("/api/auth/*", (c) => c.get("auth").handler(c.req.raw));

  app.use("/api/v1/*", sessionMiddleware, csrfMiddleware);
  mountApiRoutes(app);

  app.all("/api/*", (c) =>
    c.json(
      { error: { code: "NOT_FOUND", message: "API route not found" } },
      404
    )
  );

  app.onError((error, _c) => {
    if (error instanceof AppError) return errorResponse(error);
    return errorResponse(error);
  });

  return app;
}
