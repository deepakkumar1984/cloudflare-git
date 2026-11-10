import { Hono } from "hono";
import {
  gitProviderSchema,
  providerConnectSchema,
  providerRepositoriesQuerySchema,
} from "@shared/schemas";
import type { AppEnv } from "@worker/env";
import {
  notFound,
  readJson,
  readQuery,
  tooManyRequests,
} from "@worker/lib/errors";
import { assertAuthenticated } from "@worker/services/access";
import { consumeRateLimit } from "@worker/lib/rate-limit";
import {
  listProviderRepositories,
  type ProviderEnv,
  validateProviderToken,
} from "@worker/services/git-providers";
import {
  connectionSummary,
  listProviderConnections,
  removeProviderConnection,
  requireProviderConnection,
  saveProviderConnection,
} from "@worker/services/provider-connections";
import { providerTokenSecret } from "@worker/services/token-vault";

export const integrationRoutes = new Hono<AppEnv>();

function parseProvider(value: string | undefined) {
  const parsed = gitProviderSchema.safeParse(value);
  if (!parsed.success) throw notFound("Git provider not found");
  return parsed.data;
}

integrationRoutes.get("/integrations", async (c) => {
  const session = assertAuthenticated(c);
  const connections = await listProviderConnections(
    c.get("db"),
    session.user.id
  );
  return c.json({ connections });
});

integrationRoutes.post("/integrations/:provider/connect", async (c) => {
  const session = assertAuthenticated(c);
  const provider = parseProvider(c.req.param("provider"));
  const input = await readJson(c, providerConnectSchema);
  const rate = consumeRateLimit(
    `provider-connect:${session.user.id}:${provider}`,
    10,
    60_000
  );
  if (!rate.allowed) {
    throw tooManyRequests(
      "Too many connection attempts. Wait a minute and try again.",
      rate.retryAfterSeconds
    );
  }

  const env = c.env as ProviderEnv;
  const identity = await validateProviderToken(provider, input.token, env);
  const connection = await saveProviderConnection(
    c.get("db"),
    providerTokenSecret(c.env),
    session.user.id,
    provider,
    input.token,
    identity,
    c.req.header("cf-connecting-ip")
  );
  return c.json({ connection: connectionSummary(connection) }, 201);
});

integrationRoutes.delete("/integrations/:provider", async (c) => {
  const session = assertAuthenticated(c);
  const provider = parseProvider(c.req.param("provider"));
  const removed = await removeProviderConnection(
    c.get("db"),
    session.user.id,
    provider,
    c.req.header("cf-connecting-ip")
  );
  if (!removed) throw notFound("Connection not found");
  return c.body(null, 204);
});

integrationRoutes.get("/integrations/:provider/repositories", async (c) => {
  const session = assertAuthenticated(c);
  const provider = parseProvider(c.req.param("provider"));
  const query = readQuery(c, providerRepositoriesQuerySchema);
  const rate = consumeRateLimit(
    `provider-repositories:${session.user.id}:${provider}`,
    60,
    60_000
  );
  if (!rate.allowed) {
    throw tooManyRequests(
      "Too many repository requests. Wait a minute and try again.",
      rate.retryAfterSeconds
    );
  }

  const { token } = await requireProviderConnection(
    c.get("db"),
    providerTokenSecret(c.env),
    session.user.id,
    provider
  );
  const page = await listProviderRepositories(
    provider,
    token,
    c.env as ProviderEnv,
    query.page
  );
  c.header("Cache-Control", "no-store");
  return c.json({ ...page, page: query.page });
});
