import { and, eq } from "drizzle-orm";
import type { Database } from "@db/client";
import { providerConnections, type ProviderConnection } from "@db/schema";
import { GIT_PROVIDER_LABELS, type GitProvider } from "@shared/constants";
import type { ProviderIdentity } from "./git-providers";
import { decryptProviderToken, encryptProviderToken } from "./token-vault";
import { conflict } from "@worker/lib/errors";
import { recordAudit } from "./events";

export interface ProviderConnectionSummary {
  provider: GitProvider;
  username: string;
  name: string | null;
  externalUserId: string;
  connectedAt: Date;
}

export function connectionSummary(
  connection: ProviderConnection
): ProviderConnectionSummary {
  return {
    provider: connection.provider,
    username: connection.externalUsername,
    name: connection.externalName,
    externalUserId: connection.externalUserId,
    connectedAt: connection.createdAt,
  };
}

export async function saveProviderConnection(
  db: Database,
  secret: string,
  userId: string,
  provider: GitProvider,
  token: string,
  identity: ProviderIdentity,
  ipAddress?: string | null
): Promise<ProviderConnection> {
  const encryptedToken = await encryptProviderToken(secret, token);
  const [connection] = await db
    .insert(providerConnections)
    .values({
      userId,
      provider,
      encryptedToken,
      externalUserId: identity.id,
      externalUsername: identity.username,
      externalName: identity.name,
    })
    .onConflictDoUpdate({
      target: [providerConnections.userId, providerConnections.provider],
      set: {
        encryptedToken,
        externalUserId: identity.id,
        externalUsername: identity.username,
        externalName: identity.name,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!connection) throw new Error("Could not save provider connection");

  await recordAudit(db, {
    actorId: userId,
    action: "provider.connected",
    detail: {
      provider,
      externalUserId: identity.id,
      externalUsername: identity.username,
    },
    ipAddress,
  });
  return connection;
}

export async function getProviderConnection(
  db: Database,
  userId: string,
  provider: GitProvider
): Promise<ProviderConnection | null> {
  const [connection] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.provider, provider)
      )
    )
    .limit(1);
  return connection ?? null;
}

export async function requireProviderConnection(
  db: Database,
  secret: string,
  userId: string,
  provider: GitProvider
): Promise<{ connection: ProviderConnection; token: string }> {
  const connection = await getProviderConnection(db, userId, provider);
  if (!connection) {
    throw conflict(
      `Connect your ${GIT_PROVIDER_LABELS[provider]} account first`
    );
  }
  const token = await decryptProviderToken(secret, connection.encryptedToken);
  return { connection, token };
}

export async function optionalProviderConnectionToken(
  db: Database,
  secret: string,
  userId: string,
  provider: GitProvider
): Promise<string | null> {
  const connection = await getProviderConnection(db, userId, provider);
  if (!connection) return null;
  return decryptProviderToken(secret, connection.encryptedToken);
}

export async function listProviderConnections(
  db: Database,
  userId: string
): Promise<ProviderConnectionSummary[]> {
  const rows = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.userId, userId))
    .orderBy(providerConnections.provider);
  return rows.map(connectionSummary);
}

export async function removeProviderConnection(
  db: Database,
  userId: string,
  provider: GitProvider,
  ipAddress?: string | null
): Promise<boolean> {
  const deleted = await db
    .delete(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.provider, provider)
      )
    )
    .returning({ id: providerConnections.id });
  if (deleted.length === 0) return false;
  await recordAudit(db, {
    actorId: userId,
    action: "provider.disconnected",
    detail: { provider },
    ipAddress,
  });
  return true;
}
