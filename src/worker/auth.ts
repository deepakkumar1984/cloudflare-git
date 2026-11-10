import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import type { Database } from "@db/client";
import * as schema from "@db/schema";
import { USERNAME_RE } from "@shared/constants";
import { ensurePersonalGroup } from "@worker/services/personal-groups";

export function createAuth(db: Database, env: Env) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  if (env.PROVIDER_TOKEN_KEY && env.PROVIDER_TOKEN_KEY.length < 32) {
    throw new Error("PROVIDER_TOKEN_KEY must be at least 32 characters");
  }
  const production = (env.ENVIRONMENT as string) === "production";
  const adminEmails = new Set(
    (env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );

  return betterAuth({
    appName: "Deesha Git",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [
      ...new Set([
        env.BETTER_AUTH_URL,
        env.APP_URL,
        // Playwright starts an isolated server on 5174 during development.
        ...(production ? [] : ["http://localhost:5174"]),
      ]),
    ].filter(Boolean),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      ipAddress: {
        // Cloudflare overwrites this header at the edge.
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: production ? 10 : 50 },
        "/sign-in/username": { window: 60, max: production ? 10 : 50 },
        "/sign-up/email": { window: 60, max: production ? 5 : 50 },
      },
    },
    user: {
      additionalFields: {
        isAdmin: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        // Better Auth's default rejects dashes, which the sign-up UI allows.
        usernameValidator: (value) => USERNAME_RE.test(value),
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = String(user.email ?? "").toLowerCase();
            return {
              data: {
                ...user,
                isAdmin: adminEmails.has(email),
              },
            };
          },
          after: async (createdUser) => {
            try {
              await ensurePersonalGroup(db, createdUser as schema.User);
            } catch (error) {
              // The profile endpoint retries personal-group creation, so a
              // transient failure here should not block sign-up.
              console.error("personal_group_create_failed", error);
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
