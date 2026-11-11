import { readFileSync } from "node:fs";

const config = readFileSync("wrangler.jsonc", "utf8");

const failures: string[] = [];
if (/"ENVIRONMENT"\s*:\s*"development"/.test(config)) {
  failures.push("ENVIRONMENT=development is set in wrangler.jsonc");
}
if (/"ARTIFACTS_FAKE"\s*:\s*"true"/.test(config)) {
  failures.push("ARTIFACTS_FAKE=true is set in wrangler.jsonc");
}
if (/"GIT_PROVIDERS_FAKE"\s*:\s*"true"/.test(config)) {
  failures.push("GIT_PROVIDERS_FAKE=true is set in wrangler.jsonc");
}
if (/"preview_urls"\s*:\s*true/.test(config)) {
  failures.push(
    "preview_urls is enabled. Previews share this Worker's D1 database and secrets."
  );
}

if (failures.length > 0) {
  console.error("Refusing to deploy:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
