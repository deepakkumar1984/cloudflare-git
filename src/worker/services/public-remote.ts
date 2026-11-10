const ARTIFACTS_HOST = "artifacts.cloudflare.net";

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
