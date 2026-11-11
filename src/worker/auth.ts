import { count } from "drizzle-orm";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { username } from "better-auth/plugins";
import type { Database } from "@db/client";
import * as schema from "@db/schema";
import {
  USERNAME_RE,
  configuredAppName,
  firstAccountMustMatchAdminList,
  grantInitialAdmin,
  isProductionEnvironment,
  publicSignupAllowed,
} from "@shared/constants";
import { ensurePersonalGroup } from "@worker/services/personal-groups";
import { resolveAppOrigin } from "@worker/services/public-remote";

export function createAuth(db: Database, env: Env, requestUrl?: string) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  const production = isProductionEnvironment(env.ENVIRONMENT);
  if (production && !env.PROVIDER_TOKEN_KEY) {
    throw new Error(
      "PROVIDER_TOKEN_KEY must be set in production. It encrypts GitHub and GitLab tokens separately from the auth secret."
    );
  }
  if (env.PROVIDER_TOKEN_KEY && env.PROVIDER_TOKEN_KEY.length < 32) {
    throw new Error("PROVIDER_TOKEN_KEY must be at least 32 characters");
  }
  const adminEmails = new Set(
    (env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );

  const origin = resolveAppOrigin(
    requestUrl,
    env.BETTER_AUTH_URL || env.APP_URL
  );
  const trustedOrigins = new Set<string>([origin]);
  for (const value of [env.BETTER_AUTH_URL, env.APP_URL]) {
    if (!value) continue;
    try {
      const configured = new URL(value).origin;
      const local =
        configured.startsWith("http://localhost") ||
        configured.startsWith("http://127.0.0.1");
      if (production && local) continue;
      trustedOrigins.add(configured);
    } catch {
      // Ignore a placeholder that is not a URL.
    }
  }
  if (!production) trustedOrigins.add("http://localhost:5174");

  return betterAuth({
    appName: configuredAppName(env.APP_NAME),
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [...trustedOrigins],
    database: drizzleAdapter(db, {
      provider: "sqlite",
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
      // D1, shared across isolates. Requires the rate_limit table.
      storage: "database",
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
            const [existing] = await db
              .select({ value: count() })
              .from(schema.user);
            const isFirst = (existing?.value ?? 0) === 0;
            if (
              !publicSignupAllowed(
                env.ENVIRONMENT,
                env.ALLOW_PUBLIC_SIGNUP,
                !isFirst
              )
            ) {
              throw APIError.from("FORBIDDEN", {
                code: "SIGNUP_CLOSED",
                message: "Sign up is closed",
              });
            }
            if (
              firstAccountMustMatchAdminList(
                env.ENVIRONMENT,
                isFirst,
                adminEmails
              ) &&
              !adminEmails.has(email)
            ) {
              throw APIError.from("FORBIDDEN", {
                code: "ADMIN_EMAIL_REQUIRED",
                message: "The first account must use an administrator email",
              });
            }
            return {
              data: {
                ...user,
                email,
                isAdmin: grantInitialAdmin(isFirst, email, adminEmails),
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
