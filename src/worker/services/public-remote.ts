const ARTIFACTS_HOST = "artifacts.cloudflare.net";

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * The hostname the user actually opened. A Cloudflare deploy does not know
 * its workers.dev or custom-domain origin until a request arrives, so that
 * request wins over the localhost default in wrangler.jsonc.
 */
export function resolveAppOrigin(
  requestUrl: string | undefined,
  configuredUrl?: string
): string {
  return (
    originOf(requestUrl) ?? originOf(configuredUrl) ?? "http://localhost:5173"
  );
}

/**
 * Artifacts remotes cannot use a custom domain: the remote is always served
 * from `<account>.artifacts.cloudflare.net`. When the app has a public origin,
 * present clone URLs on that origin instead; the Worker's Git proxy forwards
 * them to the Artifacts remote. Fake/local remotes are left untouched.
 */
export function publicGitRemote(
  remote: string | null,
  appUrl: string
): string | null {
  if (!remote) return remote;

  try {
    const source = new URL(remote);
    const host = source.hostname.toLowerCase();
    const isArtifacts =
      host === ARTIFACTS_HOST || host.endsWith(`.${ARTIFACTS_HOST}`);
    if (source.protocol !== "https:" || !isArtifacts) return remote;

    const origin = new URL(appUrl).origin;
    return `${origin}${source.pathname}`;
  } catch {
    return remote;
  }
}
