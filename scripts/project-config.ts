import { readFileSync, writeFileSync } from "node:fs";

export const PROJECT_CONFIG_FILE = ".cloudflare-git.json";
export const WRANGLER_CONFIG_FILE = "wrangler.jsonc";
export const COMPATIBILITY_DATE = "2026-11-10";

export type ProjectConfig = {
  workerName: string;
  appName: string;
  d1Name: string;
  d1Id: string;
  artifactsNamespace: string;
  /** Public origin used by `npm run deploy`. Local dev keeps localhost. */
  appUrl: string;
  customDomain: string | null;
  accountId: string | null;
};

const RESOURCE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

export function normalizeResourceName(value: string, label: string): string {
  const name = value.trim().toLowerCase();
  if (!RESOURCE_NAME.test(name)) {
    throw new Error(
      `${label} must use lowercase letters, numbers, and hyphens, and must not start or end with a hyphen`
    );
  }
  return name;
}

export function normalizeAppName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 40) {
    throw new Error("App name must be 1–40 characters");
  }
  if (
    [...name].some(
      (char) => char.charCodeAt(0) < 32 || char === '"' || char === "\\"
    )
  ) {
    throw new Error("App name cannot contain quotes or control characters");
  }
  return name;
}

export function normalizeCustomDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return null;
  if (
    domain.includes("://") ||
    domain.includes("/") ||
    !HOST_NAME.test(domain)
  ) {
    throw new Error(
      "Custom domain must be a hostname such as git.example.com, without a scheme or path"
    );
  }
  return domain;
}

export function normalizeAppUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("App URL must be an http(s) origin");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "App URL must be an origin, without a user, query, or hash"
    );
  }
  if (url.pathname !== "/") {
    throw new Error("App URL must not include a path");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("App URL must start with https://");
  }
  if (url.protocol === "http:" && url.hostname !== "localhost") {
    throw new Error("Only localhost may use http://");
  }
  return url.origin;
}

export function normalizeAccountId(
  value: string | null | undefined
): string | null {
  const id = value?.trim() ?? "";
  if (!id) return null;
  if (!ACCOUNT_ID.test(id))
    throw new Error("Cloudflare account id is not valid");
  return id;
}

export function normalizeD1Id(value: string): string {
  const id = value.trim().toLowerCase();
  if (!UUID.test(id)) throw new Error("D1 database id must be a UUID");
  return id;
}

export function defaultPublicUrl(
  workerName: string,
  customDomain: string | null,
  workersSubdomain: string | null
): string {
  if (customDomain) return `https://${customDomain}`;
  if (workersSubdomain) {
    return `https://${workerName}.${workersSubdomain}.workers.dev`;
  }
  return "";
}

export function parseD1CreateId(output: string): string | null {
  const matches = output.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
  );
  return matches?.at(-1)?.toLowerCase() ?? null;
}

export function workflowName(workerName: string): string {
  return `${workerName}-push-sync`;
}

export function wranglerConfigObject(
  config: ProjectConfig
): Record<string, unknown> {
  const syncName = workflowName(config.workerName);
  const object: Record<string, unknown> = {
    $schema: "node_modules/wrangler/config-schema.json",
    name: config.workerName,
  };
  if (config.accountId) object.account_id = config.accountId;
  object.main = "./src/worker/index.ts";
  object.compatibility_date = COMPATIBILITY_DATE;
  object.compatibility_flags = ["nodejs_compat"];
  object.upload_source_maps = true;
  object.workers_dev = true;
  object.preview_urls = true;
  object.assets = {
    not_found_handling: "single-page-application",
    run_worker_first: ["/api/*", "/git/*"],
  };
  if (config.customDomain) {
    object.routes = [{ pattern: config.customDomain, custom_domain: true }];
  }
  object.vars = {
    APP_NAME: config.appName,
    APP_URL: "http://localhost:5173",
    ARTIFACTS_NAMESPACE: config.artifactsNamespace,
    ENVIRONMENT: "development",
  };
  object.artifacts = [
    {
      binding: "ARTIFACTS",
      namespace: config.artifactsNamespace,
      remote: true,
    },
  ];
  object.d1_databases = [
    {
      binding: "DB",
      database_name: config.d1Name,
      database_id: config.d1Id,
      migrations_dir: "src/db/migrations",
      remote: true,
    },
  ];
  object.workflows = [
    {
      name: syncName,
      binding: "PUSH_SYNC",
      class_name: "PushSyncWorkflow",
    },
  ];
  object.triggers = {
    crons: ["*/10 * * * *"],
    events: [
      {
        type: "cf.artifacts.repo.pushed",
        filter: { namespace: config.artifactsNamespace },
        targets: [{ type: "workflow", workflow_name: syncName }],
      },
    ],
  };
  object.observability = {
    enabled: true,
    logs: { enabled: true, invocation_logs: true },
  };
  return object;
}

export function renderWranglerConfig(config: ProjectConfig): string {
  return `${JSON.stringify(wranglerConfigObject(config), null, 2)}\n`;
}

export function readProjectConfig(
  file = PROJECT_CONFIG_FILE
): ProjectConfig | null {
  try {
    const parsed = JSON.parse(
      readFileSync(file, "utf8")
    ) as Partial<ProjectConfig>;
    if (
      !parsed.workerName ||
      !parsed.d1Name ||
      !parsed.d1Id ||
      !parsed.appName
    ) {
      return null;
    }
    return {
      workerName: normalizeResourceName(parsed.workerName, "Worker name"),
      appName: normalizeAppName(parsed.appName),
      d1Name: normalizeResourceName(parsed.d1Name, "D1 database name"),
      d1Id: normalizeD1Id(parsed.d1Id),
      artifactsNamespace: normalizeResourceName(
        parsed.artifactsNamespace || parsed.workerName,
        "Artifacts namespace"
      ),
      appUrl: parsed.appUrl ? normalizeAppUrl(parsed.appUrl) : "",
      customDomain: normalizeCustomDomain(parsed.customDomain ?? ""),
      accountId: normalizeAccountId(parsed.accountId),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export function writeProjectFiles(config: ProjectConfig): void {
  writeFileSync(PROJECT_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  writeFileSync(WRANGLER_CONFIG_FILE, renderWranglerConfig(config));
}
