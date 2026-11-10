import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultPublicUrl,
  normalizeAppName,
  normalizeAppUrl,
  normalizeCustomDomain,
  normalizeResourceName,
  parseD1CreateId,
  renderWranglerConfig,
  workflowName,
  type ProjectConfig,
} from "../../scripts/project-config";

const config: ProjectConfig = {
  workerName: "cloudflare-git",
  appName: "Cloudflare Git",
  d1Name: "cloudflare-git",
  d1Id: "00000000-0000-0000-0000-000000000000",
  artifactsNamespace: "cloudflare-git",
  appUrl: "https://git.example.com",
  customDomain: null,
  accountId: null,
};

describe("project config", () => {
  it("writes a remote D1 binding and no custom domain by default", () => {
    const rendered = JSON.parse(renderWranglerConfig(config)) as {
      name: string;
      account_id?: string;
      routes?: unknown;
      d1_databases: Array<{ remote: boolean; database_name: string }>;
      artifacts: Array<{ remote: boolean; namespace: string }>;
      workflows: Array<{ name: string }>;
      vars: {
        APP_NAME: string;
        APP_URL: string;
        BETTER_AUTH_URL: string;
        ADMIN_EMAILS: string;
      };
    };
    expect(rendered.name).toBe("cloudflare-git");
    expect(rendered.account_id).toBeUndefined();
    expect(rendered.routes).toBeUndefined();
    expect(rendered.d1_databases[0]?.remote).toBe(true);
    expect(rendered.d1_databases[0]?.database_name).toBe("cloudflare-git");
    expect(rendered.artifacts[0]?.remote).toBe(true);
    expect(rendered.workflows[0]?.name).toBe(workflowName("cloudflare-git"));
    expect(rendered.vars.APP_NAME).toBe("Cloudflare Git");
    expect(rendered.vars.APP_URL).toBe("http://localhost:5173");
    expect(rendered.vars.BETTER_AUTH_URL).toBe("http://localhost:5173");
    expect(rendered.vars.ADMIN_EMAILS).toBe("");
    expect("ENVIRONMENT" in rendered.vars).toBe(false);
    const example = readFileSync("wrangler.example.jsonc", "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/,(\s*[}\]])/g, "$1");
    expect(JSON.parse(example)).toEqual(
      JSON.parse(renderWranglerConfig(config))
    );
  });

  it("adds the account and custom domain when they are set", () => {
    const rendered = JSON.parse(
      renderWranglerConfig({
        ...config,
        accountId: "a".repeat(32),
        customDomain: "git.example.com",
      })
    ) as {
      account_id: string;
      routes: Array<{ pattern: string; custom_domain: boolean }>;
    };
    expect(rendered.account_id).toBe("a".repeat(32));
    expect(rendered.routes[0]).toEqual({
      pattern: "git.example.com",
      custom_domain: true,
    });
  });

  it("rejects names and URLs that cannot be deployed", () => {
    expect(() => normalizeResourceName("Git Name", "Worker name")).toThrow(
      /lowercase/
    );
    expect(() => normalizeAppName("")).toThrow(/1–40/);
    expect(() => normalizeAppUrl("http://git.example.com")).toThrow(
      /localhost/
    );
    expect(() => normalizeCustomDomain("https://git.example.com")).toThrow(
      /hostname/
    );
  });

  it("suggests the public URL from the domain or workers.dev subdomain", () => {
    expect(defaultPublicUrl("cloudflare-git", "git.example.com", "acct")).toBe(
      "https://git.example.com"
    );
    expect(defaultPublicUrl("cloudflare-git", null, "acct")).toBe(
      "https://cloudflare-git.acct.workers.dev"
    );
    expect(defaultPublicUrl("cloudflare-git", null, null)).toBe("");
  });

  it("reads the database id from wrangler create output", () => {
    expect(
      parseD1CreateId('database_id = "11111111-2222-4333-8444-555555555555"\n')
    ).toBe("11111111-2222-4333-8444-555555555555");
  });
});
