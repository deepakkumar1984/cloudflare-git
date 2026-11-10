import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parse } from "dotenv";
import {
  defaultPublicUrl,
  normalizeAccountId,
  normalizeAppName,
  normalizeAppUrl,
  normalizeCustomDomain,
  normalizeD1Id,
  normalizeResourceName,
  parseD1CreateId,
  readProjectConfig,
  writeProjectFiles,
  type ProjectConfig,
} from "./project-config";

type Account = { id: string; name: string };

type Whoami = {
  loggedIn?: boolean;
  accounts?: Account[];
};

type D1Row = { name?: string; uuid?: string };

const SECRET_NAMES = ["BETTER_AUTH_SECRET", "PROVIDER_TOKEN_KEY"] as const;

function wrangler(
  args: string[],
  accountId: string | null,
  options: { input?: string; inherit?: boolean; ci?: boolean } = {}
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    input: options.input,
    stdio: options.inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
      ...(options.ci ? { CI: "true" } : {}),
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = Math.min(
      ...["{", "["]
        .map((mark) => text.indexOf(mark))
        .filter((index) => index >= 0)
    );
    if (!Number.isFinite(start)) {
      throw new Error("Wrangler did not return JSON");
    }
    return JSON.parse(text.slice(start)) as T;
  }
}

function whoami(): Whoami {
  const result = wrangler(["whoami", "--json"], null);
  if (result.status !== 0) return { loggedIn: false };
  return parseJson<Whoami>(result.stdout);
}

function login(): void {
  console.log("Opening Cloudflare login…");
  const result = wrangler(["login"], null, { inherit: true });
  if (result.status !== 0) {
    throw new Error("Cloudflare login failed");
  }
}

function oauthToken(): string | null {
  try {
    const text = readFileSync(
      join(homedir(), ".config", ".wrangler", "config", "default.toml"),
      "utf8"
    );
    return text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function workersSubdomain(accountId: string): Promise<string | null> {
  const token = oauthToken();
  if (!token) return null;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    result?: { subdomain?: string };
  };
  return body.result?.subdomain || null;
}

function findDatabase(name: string, accountId: string): string | null {
  const result = wrangler(["d1", "list", "--json"], accountId);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Could not list D1 databases");
  }
  const rows = parseJson<D1Row[]>(result.stdout);
  const found = rows.find((row) => row.name === name);
  return found?.uuid ? normalizeD1Id(found.uuid) : null;
}

function createDatabase(name: string, accountId: string): string {
  const result = wrangler(["d1", "create", name], accountId);
  const combined = `${result.stdout}\n${result.stderr}`;
  const id = parseD1CreateId(combined);
  if (result.status !== 0 || !id) {
    throw new Error(combined.trim() || `Could not create D1 database ${name}`);
  }
  return id;
}

function readDevSecrets(): Record<string, string> {
  try {
    return parse(readFileSync(".dev.vars"));
  } catch {
    return {};
  }
}

function putSecret(
  name: string,
  value: string,
  accountId: string | null
): void {
  const result = wrangler(["secret", "put", name], accountId, { input: value });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Could not set secret ${name}`);
  }
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback: string
): Promise<string> {
  const hint = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${label}${hint}: `)).trim();
  return answer || fallback;
}

async function askValid<T>(
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback: string,
  normalize: (value: string) => T
): Promise<T> {
  for (;;) {
    try {
      return normalize(await ask(rl, label, fallback));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }
}

async function confirm(
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallbackYes: boolean
): Promise<boolean> {
  const answer = (
    await rl.question(`${label} [${fallbackYes ? "Y/n" : "y/N"}]: `)
  )
    .trim()
    .toLowerCase();
  if (!answer) return fallbackYes;
  return answer === "y" || answer === "yes";
}

function nonInteractiveConfig(
  current: ProjectConfig | null,
  accountId: string
): ProjectConfig | null {
  const appUrl = process.env.CLOUDFLARE_GIT_APP_URL?.trim();
  if (!appUrl) return null;
  const workerName = normalizeResourceName(
    process.env.CLOUDFLARE_GIT_WORKER_NAME ||
      current?.workerName ||
      "cloudflare-git",
    "Worker name"
  );
  const customDomain = normalizeCustomDomain(
    process.env.CLOUDFLARE_GIT_CUSTOM_DOMAIN ?? current?.customDomain ?? ""
  );
  return {
    workerName,
    appName: normalizeAppName(
      process.env.CLOUDFLARE_GIT_APP_NAME ||
        current?.appName ||
        "Cloudflare Git"
    ),
    d1Name: normalizeResourceName(
      process.env.CLOUDFLARE_GIT_D1_NAME || current?.d1Name || workerName,
      "D1 database name"
    ),
    d1Id: "",
    artifactsNamespace: normalizeResourceName(
      process.env.CLOUDFLARE_GIT_ARTIFACTS_NAMESPACE ||
        current?.artifactsNamespace ||
        workerName,
      "Artifacts namespace"
    ),
    appUrl: normalizeAppUrl(appUrl),
    customDomain,
    accountId: normalizeAccountId(
      process.env.CLOUDFLARE_GIT_ACCOUNT_ID || accountId
    ),
  };
}

async function promptConfig(
  current: ProjectConfig | null,
  account: Account,
  subdomain: string | null
): Promise<ProjectConfig> {
  const rl = createInterface({ input, output });
  try {
    console.log(`Using Cloudflare account ${account.name}`);
    const workerName = await askValid(
      rl,
      "Worker name",
      current?.workerName || "cloudflare-git",
      (value) => normalizeResourceName(value, "Worker name")
    );
    const appName = await askValid(
      rl,
      "App name",
      current?.appName || "Cloudflare Git",
      normalizeAppName
    );
    const d1Name = await askValid(
      rl,
      "D1 database name",
      current?.d1Name || workerName,
      (value) => normalizeResourceName(value, "D1 database name")
    );
    const artifactsNamespace = await askValid(
      rl,
      "Artifacts namespace",
      current?.artifactsNamespace || workerName,
      (value) => normalizeResourceName(value, "Artifacts namespace")
    );
    const customDomain = await askValid(
      rl,
      "Custom domain (blank to skip)",
      current?.customDomain ?? "",
      normalizeCustomDomain
    );
    const suggested =
      current?.appUrl || defaultPublicUrl(workerName, customDomain, subdomain);
    const appUrl = await askValid(
      rl,
      "Public app URL",
      suggested,
      normalizeAppUrl
    );
    return {
      workerName,
      appName,
      d1Name,
      d1Id: "",
      artifactsNamespace,
      appUrl,
      customDomain,
      accountId: account.id,
    };
  } finally {
    rl.close();
  }
}

function resolveDatabase(config: ProjectConfig): ProjectConfig {
  const accountId = config.accountId ?? "";
  const existing = findDatabase(config.d1Name, accountId);
  if (existing) {
    console.log(`Using D1 database ${config.d1Name}`);
    return { ...config, d1Id: existing };
  }
  console.log(`Creating D1 database ${config.d1Name}`);
  return { ...config, d1Id: createDatabase(config.d1Name, accountId) };
}

function applyMigrations(accountId: string | null, interactive: boolean): void {
  const result = wrangler(
    ["d1", "migrations", "apply", "DB", "--remote"],
    accountId,
    { inherit: true, ci: !interactive }
  );
  if (result.status !== 0) process.exit(result.status);
}

function deploy(): void {
  const result = spawnSync("npx", ["tsx", "scripts/deploy.ts"], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function uploadSecrets(accountId: string | null): void {
  const secrets = readDevSecrets();
  const present = SECRET_NAMES.filter((name) => secrets[name]);
  if (present.length === 0) {
    console.log("No secrets in .dev.vars. Set them with wrangler secret put.");
    return;
  }
  for (const name of present) {
    const value = secrets[name];
    if (!value) continue;
    console.log(`Setting ${name}`);
    putSecret(name, value, accountId);
  }
}

async function main(): Promise<void> {
  let session = whoami();
  if (!session.loggedIn || !session.accounts?.length) {
    login();
    session = whoami();
  }
  const accounts = session.accounts ?? [];
  if (!session.loggedIn || accounts.length === 0) {
    throw new Error("Wrangler is not logged in to Cloudflare");
  }

  let account = accounts[0];
  if (!account) throw new Error("No Cloudflare account is available");
  if (accounts.length > 1 && !process.env.CLOUDFLARE_GIT_APP_URL) {
    const rl = createInterface({ input, output });
    try {
      accounts.forEach((item, index) => {
        console.log(`${index + 1}. ${item.name}`);
      });
      const choice = await ask(rl, "Account number", "1");
      const selected = accounts[Number(choice) - 1];
      if (!selected) throw new Error("Choose an account from the list");
      account = selected;
    } finally {
      rl.close();
    }
  }

  const current = readProjectConfig();
  const interactive = !process.env.CLOUDFLARE_GIT_APP_URL;
  const prompted = interactive
    ? await promptConfig(current, account, await workersSubdomain(account.id))
    : nonInteractiveConfig(current, account.id);
  if (!prompted)
    throw new Error("Set CLOUDFLARE_GIT_APP_URL for a scripted setup");

  const config = resolveDatabase(prompted);
  writeProjectFiles(config);
  console.log("Wrote wrangler.jsonc and .cloudflare-git.json");
  console.log("Both files are gitignored. Do not commit them.");

  const apply = interactive
    ? await (async () => {
        const rl = createInterface({ input, output });
        try {
          return await confirm(rl, "Apply remote D1 migrations now?", true);
        } finally {
          rl.close();
        }
      })()
    : process.env.CLOUDFLARE_GIT_APPLY_MIGRATIONS !== "0";
  if (apply) applyMigrations(config.accountId, interactive);

  const shouldDeploy = interactive
    ? await (async () => {
        const rl = createInterface({ input, output });
        try {
          return await confirm(rl, "Deploy the Worker now?", false);
        } finally {
          rl.close();
        }
      })()
    : process.env.CLOUDFLARE_GIT_DEPLOY === "1";
  if (!shouldDeploy) {
    console.log(
      "Next: npm run dev, then npm run deploy when you want it live."
    );
    return;
  }

  deploy();
  const upload = interactive
    ? await (async () => {
        const rl = createInterface({ input, output });
        try {
          return await confirm(
            rl,
            "Copy BETTER_AUTH_SECRET and PROVIDER_TOKEN_KEY from .dev.vars to the Worker?",
            true
          );
        } finally {
          rl.close();
        }
      })()
    : process.env.CLOUDFLARE_GIT_UPLOAD_SECRETS === "1";
  if (upload) uploadSecrets(config.accountId);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
