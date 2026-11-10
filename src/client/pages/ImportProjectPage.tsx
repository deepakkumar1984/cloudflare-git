import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  GitFork,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Search,
  Unplug,
  Users,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import {
  useGroup,
  useMe,
  useProviderConnections,
  useProviderRepositories,
} from "@/lib/queries";
import type {
  ProjectImportCreatedResponse,
  ProviderConnection,
  ProviderRepository,
} from "@/lib/types";
import { GIT_PROVIDER_LABELS, type GitProvider } from "@shared/constants";
import { cn, relativeTime, slugPreview } from "@/lib/utils";

const TOKEN_HELP: Record<GitProvider, string> = {
  github:
    "Use a classic token with the repo scope, or a fine-grained token with Contents: Read access.",
  gitlab:
    "Use a personal access token with read_api and read_repository scopes.",
};

function providerDescription(provider: GitProvider): string {
  return provider === "github"
    ? "Connect a GitHub account to list repositories and import private or public projects."
    : "Connect a GitLab account to list projects, including nested groups, and import them.";
}

interface ParsedImportUrl {
  provider: GitProvider | null;
  displayPath: string;
  repoName: string;
}

function parseImportUrl(value: string): ParsedImportUrl | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  let segments: string[];
  try {
    segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (segments.length < 2 || segments.includes("-")) return null;
  const provider: GitProvider | null =
    url.hostname === "github.com"
      ? "github"
      : url.hostname === "gitlab.com"
        ? "gitlab"
        : null;
  if (provider === "github" && segments.length !== 2) return null;
  const repoName = segments.at(-1)!.replace(/\.git$/i, "");
  if (!repoName) return null;
  segments[segments.length - 1] = repoName;
  return {
    provider,
    displayPath: segments.join("/"),
    repoName,
  };
}

export function ImportProjectPage() {
  const { groupSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useGroup(groupSlug);
  const me = useMe();
  const connections = useProviderConnections();

  const [sourceMode, setSourceMode] = useState<"url" | "browse">("url");
  const [provider, setProvider] = useState<GitProvider>("github");
  const [token, setToken] = useState("");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ProviderRepository | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [repositoryVisibility, setRepositoryVisibility] = useState<
    "public" | "private"
  >("public");
  const [urlToken, setUrlToken] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "internal">(
    "private"
  );
  const [branch, setBranch] = useState("");
  // Full-history imports of large repositories can exceed the Artifacts
  // import memory budget, so shallow is the safe default.
  const [depth, setDepth] = useState("1");
  const parsedUrl = parseImportUrl(sourceUrl);
  const urlProvider = parsedUrl?.provider ?? null;
  const urlConnection = connections.data?.connections.find(
    (item) => item.provider === urlProvider
  );
  const canEditProject =
    sourceMode === "browse" ? Boolean(selected) : Boolean(parsedUrl);
  const canSubmit =
    canEditProject &&
    (sourceMode === "browse" ||
      repositoryVisibility === "public" ||
      Boolean(urlProvider && urlConnection));

  const connection = connections.data?.connections.find(
    (item) => item.provider === provider
  );
  const repositories = useProviderRepositories(
    provider,
    page,
    sourceMode === "browse" && Boolean(connection)
  );

  const connect = useMutation({
    mutationFn: () =>
      api.post<{ connection: ProviderConnection }>(
        `/integrations/${provider}/connect`,
        { token }
      ),
    onSuccess: async () => {
      setToken("");
      setPage(1);
      toast.success(`${GIT_PROVIDER_LABELS[provider]} connected`);
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (cause) => toast.error(errorMessage(cause)),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete(`/integrations/${provider}`),
    onSuccess: async () => {
      setSelected(null);
      setPage(1);
      toast.success(`${GIT_PROVIDER_LABELS[provider]} disconnected`);
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (cause) => toast.error(errorMessage(cause)),
  });

  const connectUrlProvider = useMutation({
    mutationFn: () => {
      if (!urlProvider) {
        throw new Error("Use a github.com or gitlab.com URL to connect");
      }
      return api.post<{ connection: ProviderConnection }>(
        `/integrations/${urlProvider}/connect`,
        { token: urlToken }
      );
    },
    onSuccess: async () => {
      setUrlToken("");
      toast.success("Provider connected");
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (cause) => toast.error(errorMessage(cause)),
  });

  const importRepo = useMutation({
    mutationFn: () => {
      const parsedDepth = depth.trim() ? Number(depth) : undefined;
      const common = {
        name,
        slug,
        description,
        visibility,
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        ...(parsedDepth ? { depth: parsedDepth } : {}),
      };
      if (sourceMode === "url") {
        if (!parsedUrl) throw new Error("Enter a valid repository URL first");
        return api.post<ProjectImportCreatedResponse>(
          `/groups/${groupSlug}/projects/import/url`,
          {
            ...common,
            sourceUrl: sourceUrl.trim(),
            repositoryVisibility,
          }
        );
      }
      if (!selected) throw new Error("Select a repository first");
      return api.post<ProjectImportCreatedResponse>(
        `/groups/${groupSlug}/projects/import`,
        {
          ...common,
          provider,
          externalRepo: selected.path,
        }
      );
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["group", groupSlug] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      if (result.import.status === "failed") {
        toast.error(result.import.error || "Repository import failed");
      } else {
        toast.success("Repository import started");
      }
      navigate(`/groups/${groupSlug}/${result.project.slug}`, {
        replace: true,
      });
    },
    onError: (cause) => toast.error(errorMessage(cause)),
  });

  function chooseSourceMode(mode: "url" | "browse") {
    setSourceMode(mode);
    if (mode === "url" && parsedUrl && !slugTouched) {
      setName(parsedUrl.repoName);
      setSlug(slugPreview(parsedUrl.repoName));
    }
  }

  function updateSourceUrl(value: string) {
    setSourceUrl(value);
    const parsed = parseImportUrl(value);
    if (parsed && !slugTouched) {
      setName(parsed.repoName);
      setSlug(slugPreview(parsed.repoName));
    }
  }

  function chooseProvider(next: GitProvider) {
    setProvider(next);
    setSelected(null);
    setFilter("");
    setPage(1);
  }

  function selectRepository(repository: ProviderRepository) {
    setSelected(repository);
    setName(repository.name);
    setSlug(slugPreview(repository.name));
    setSlugTouched(false);
    setBranch("");
    setDescription("");
    setDepth("1");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      toast.error(
        sourceMode === "url"
          ? "Enter a valid repository URL and choose access"
          : "Select a repository first"
      );
      return;
    }
    importRepo.mutate();
  }

  if (isLoading) {
    return <div className="h-72 animate-pulse rounded-xl bg-line/40" />;
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <p className="text-sm font-semibold">Group not found</p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/groups">Back to groups</Link>
        </Button>
      </div>
    );
  }

  const { group } = data;
  if (!group.canCreateProject) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <Lock className="mx-auto size-6 text-faint" />
        <p className="mt-4 text-sm font-semibold">
          You cannot import projects here
        </p>
        <p className="mt-1 text-[13px] text-muted">
          Ask a group owner or maintainer for access.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={`/groups/${groupSlug}`}>Back to group</Link>
        </Button>
      </div>
    );
  }

  if (group.archivedAt) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <GitFork className="mx-auto size-6 text-faint" />
        <p className="mt-4 text-sm font-semibold">This group is archived</p>
        <p className="mt-1 text-[13px] text-muted">
          Unarchive the group before importing a repository.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={`/groups/${groupSlug}`}>Back to group</Link>
        </Button>
      </div>
    );
  }

  const internalAllowed = group.visibility === "internal";
  const visibleRepositories = (repositories.data?.repositories ?? []).filter(
    (repository) => {
      const needle = filter.trim().toLowerCase();
      return (
        needle.length === 0 ||
        repository.path.toLowerCase().includes(needle) ||
        repository.name.toLowerCase().includes(needle)
      );
    }
  );
  const detailSource =
    sourceMode === "browse" ? selected?.path : parsedUrl?.displayPath;

  const projectDetailsCard = (
    <Card className="h-fit lg:sticky lg:top-6">
      <CardHeader>
        <CardTitle>Project details</CardTitle>
        <p className="mt-1 text-[12px] leading-5 text-muted">
          {detailSource
            ? `Importing ${detailSource}.`
            : "Choose a repository or paste a URL to continue."}
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="import-name">Project name</Label>
            <Input
              id="import-name"
              required
              maxLength={100}
              disabled={!canEditProject}
              value={name}
              onChange={(event) => {
                const value = event.target.value;
                setName(value);
                if (!slugTouched) setSlug(slugPreview(value));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-slug">Project path</Label>
            <Input
              id="import-slug"
              required
              disabled={!canEditProject}
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(slugPreview(event.target.value));
              }}
              className="font-mono text-[13px]"
              pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
            />
            <p className="font-mono text-[10px] text-faint">
              {group.slug}/{slug || "project"}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-description">Description</Label>
            <Textarea
              id="import-description"
              rows={3}
              maxLength={2000}
              disabled={!canEditProject}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What does this project do?"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="import-branch">Branch (optional)</Label>
              <Input
                id="import-branch"
                disabled={!canEditProject}
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder={
                  (sourceMode === "browse" ? selected?.defaultBranch : null) ||
                  "all refs"
                }
                className="font-mono text-[12px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="import-depth">History depth</Label>
              <Input
                id="import-depth"
                type="number"
                min={1}
                max={10_000}
                disabled={!canEditProject}
                value={depth}
                onChange={(event) => setDepth(event.target.value)}
                placeholder="1"
              />
              <p className="text-[10px] text-faint">
                Defaults to 1 (full source tree, single commit). Full history
                can exceed the Artifacts import memory limit.
              </p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[12px] font-semibold">Visibility</legend>
            {[
              {
                value: "private" as const,
                icon: Lock,
                label: "Private",
              },
              {
                value: "internal" as const,
                icon: Users,
                label: "Internal",
              },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={
                  !canEditProject ||
                  (option.value === "internal" && !internalAllowed)
                }
                onClick={() => setVisibility(option.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12px] transition-colors disabled:opacity-45",
                  visibility === option.value
                    ? "border-accent bg-accent/5 text-ink"
                    : "border-line text-muted hover:border-line-strong"
                )}
              >
                <option.icon className="size-3.5" />
                {option.label}
              </button>
            ))}
          </fieldset>

          {selected?.private ||
          (sourceMode === "url" && repositoryVisibility === "private") ? (
            <p className="rounded-md border border-line bg-canvas px-3 py-2 text-[11px] leading-5 text-muted">
              Private repositories are fetched through a short-lived,
              repository-scoped import proxy.
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={!canSubmit || importRepo.isPending}
          >
            {importRepo.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GitFork className="size-4" />
            )}
            Import repository
          </Button>
        </form>
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to={`/groups/${groupSlug}`}
        className="mb-6 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        {group.name}
      </Link>

      <h1 className="mb-6 text-lg font-semibold tracking-tight">
        Import repository
        <span className="ml-2 font-normal text-faint">{group.slug}</span>
      </h1>

      {me.data?.artifactsFake ? (
        <div className="mb-6 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 text-[12px] leading-6 text-accent-strong">
          <span className="font-semibold">Demo Artifacts mode.</span> Imports
          create local placeholder files, not the provider repository’s real
          source. Set <code className="font-mono">ARTIFACTS_FAKE=false</code>{" "}
          and re-import to fetch the actual code.
        </div>
      ) : null}

      <div className="mb-6 flex w-fit rounded-lg border border-line bg-canvas p-1">
        {[
          { value: "url" as const, label: "Repository URL" },
          { value: "browse" as const, label: "Browse connected repos" },
        ].map((mode) => (
          <button
            key={mode.value}
            type="button"
            onClick={() => chooseSourceMode(mode.value)}
            className={cn(
              "rounded-md px-4 py-1.5 text-[12px] font-medium transition-colors",
              sourceMode === mode.value
                ? "bg-surface text-ink shadow-card"
                : "text-muted hover:text-ink"
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {sourceMode === "browse" ? (
        <div className="mb-6 flex w-fit rounded-lg border border-line bg-canvas p-1">
          {(["github", "gitlab"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => chooseProvider(item)}
              className={cn(
                "rounded-md px-4 py-1.5 text-[12px] font-medium transition-colors",
                provider === item
                  ? "bg-surface text-ink shadow-card"
                  : "text-muted hover:text-ink"
              )}
            >
              {GIT_PROVIDER_LABELS[item]}
            </button>
          ))}
        </div>
      ) : null}

      {sourceMode === "browse" ? (
        connections.isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-line/40" />
        ) : connection ? (
          <Card className="mb-6">
            <CardContent className="flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-green-soft text-green">
                  <GitFork className="size-4" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold">
                    {GIT_PROVIDER_LABELS[provider]} connected as{" "}
                    <span className="font-mono">@{connection.username}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint">
                    Token encrypted at rest. It is never shown again.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Disconnect ${GIT_PROVIDER_LABELS[provider]}? Existing imports are not affected.`
                    )
                  ) {
                    disconnect.mutate();
                  }
                }}
              >
                {disconnect.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Unplug className="size-3.5" />
                )}
                Disconnect
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Connect {GIT_PROVIDER_LABELS[provider]}</CardTitle>
              <p className="mt-1 text-[12px] leading-5 text-muted">
                {providerDescription(provider)} Tokens are stored encrypted and
                reused for repository listing, imports, and re-imports; you do
                not need to paste one again until you disconnect.
              </p>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  connect.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="provider-token">Personal access token</Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                    <Input
                      id="provider-token"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      required
                      minLength={8}
                      maxLength={4096}
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="Paste a read-only token"
                      className="pl-8 font-mono text-[12px]"
                    />
                  </div>
                  <p className="text-[11px] leading-5 text-faint">
                    {TOKEN_HELP[provider]}
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={connect.isPending || token.trim().length < 8}
                  >
                    {connect.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Connect {GIT_PROVIDER_LABELS[provider]}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )
      ) : null}

      {sourceMode === "url" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Repository URL</CardTitle>
              <p className="mt-1 text-[12px] leading-5 text-muted">
                Paste a GitHub or GitLab HTTPS URL. Public repositories do not
                need a token; private repositories use your connected account.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="source-url">Repository URL</Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                  <Input
                    id="source-url"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={sourceUrl}
                    onChange={(event) => updateSourceUrl(event.target.value)}
                    placeholder="https://github.com/owner/repository"
                    className="pl-8 font-mono text-[12px]"
                  />
                </div>
                {sourceUrl.trim() && !parsedUrl ? (
                  <p className="text-[11px] leading-5 text-red">
                    Enter a valid HTTPS repository URL, not a file or branch
                    URL.
                  </p>
                ) : null}
                {parsedUrl ? (
                  <p className="font-mono text-[10px] text-faint">
                    {parsedUrl.displayPath}
                  </p>
                ) : null}
              </div>

              <fieldset className="space-y-2">
                <legend className="text-[12px] font-semibold">
                  Repository access
                </legend>
                {[
                  {
                    value: "public" as const,
                    icon: Globe,
                    title: "Public",
                    description:
                      "No token needed. Artifacts imports the public remote.",
                  },
                  {
                    value: "private" as const,
                    icon: Lock,
                    title: "Private",
                    description:
                      "Requires a stored provider token and secure proxy.",
                  },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRepositoryVisibility(option.value)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      repositoryVisibility === option.value
                        ? "border-accent bg-accent/5"
                        : "border-line hover:border-line-strong"
                    )}
                  >
                    <option.icon className="mt-0.5 size-3.5 text-muted" />
                    <span>
                      <span className="block text-[12px] font-semibold">
                        {option.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-5 text-muted">
                        {option.description}
                      </span>
                    </span>
                  </button>
                ))}
              </fieldset>

              {repositoryVisibility === "private" ? (
                !parsedUrl ? (
                  <p className="rounded-md border border-line bg-canvas px-3 py-2 text-[11px] leading-5 text-muted">
                    Paste a valid repository URL to use a private import.
                  </p>
                ) : !urlProvider ? (
                  <p className="rounded-md border border-line bg-canvas px-3 py-2 text-[11px] leading-5 text-muted">
                    Private URL imports currently support github.com and
                    gitlab.com. Connect through Browse for a self-hosted GitLab
                    instance.
                  </p>
                ) : urlConnection ? (
                  <div className="flex items-center gap-3 rounded-lg border border-green/20 bg-green-soft px-3 py-2.5">
                    <GitFork className="size-4 text-green" />
                    <div>
                      <p className="text-[12px] font-semibold">
                        {GIT_PROVIDER_LABELS[urlProvider]} connected as{" "}
                        <span className="font-mono">
                          @{urlConnection.username}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-faint">
                        This stored token will be reused for future imports.
                      </p>
                    </div>
                  </div>
                ) : (
                  <form
                    className="space-y-3 rounded-lg border border-line bg-canvas/60 p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      connectUrlProvider.mutate();
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="url-provider-token">
                        {GIT_PROVIDER_LABELS[urlProvider]} personal access token
                      </Label>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                        <Input
                          id="url-provider-token"
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          required
                          minLength={8}
                          maxLength={4096}
                          value={urlToken}
                          onChange={(event) => setUrlToken(event.target.value)}
                          placeholder="Paste a read-only token"
                          className="pl-8 font-mono text-[12px]"
                        />
                      </div>
                      <p className="text-[11px] leading-5 text-faint">
                        {TOKEN_HELP[urlProvider]} Stored encrypted and reused;
                        you do not need to paste it for every import.
                      </p>
                    </div>
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={
                        connectUrlProvider.isPending ||
                        urlToken.trim().length < 8
                      }
                    >
                      {connectUrlProvider.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      Connect {GIT_PROVIDER_LABELS[urlProvider]}
                    </Button>
                  </form>
                )
              ) : (
                <p className="rounded-md border border-green/20 bg-green-soft px-3 py-2 text-[11px] leading-5 text-green">
                  Public import: no personal access token required.
                </p>
              )}
            </CardContent>
          </Card>
          {projectDetailsCard}
        </div>
      ) : null}

      {sourceMode === "browse" && connection ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Repositories</CardTitle>
                <p className="mt-1 text-[12px] text-muted">
                  Repositories your token can read.
                </p>
              </div>
              <div className="relative w-48">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                <Input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter…"
                  className="h-8 pl-8 text-[12px]"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {repositories.isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((key) => (
                    <div
                      key={key}
                      className="h-16 animate-pulse rounded-lg bg-line/30"
                    />
                  ))}
                </div>
              ) : repositories.error ? (
                <p className="rounded-lg border border-red-soft bg-red-soft px-3 py-2 text-[12px] text-red">
                  {errorMessage(repositories.error)}
                </p>
              ) : visibleRepositories.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center">
                  <GitFork className="mx-auto size-5 text-faint" />
                  <p className="mt-2 text-[12px] text-muted">
                    No repositories match this view.
                  </p>
                </div>
              ) : (
                visibleRepositories.map((repository) => (
                  <button
                    key={`${repository.id}:${repository.path}`}
                    type="button"
                    onClick={() => selectRepository(repository)}
                    className={cn(
                      "w-full rounded-lg border bg-surface p-3 text-left transition-colors",
                      selected?.id === repository.id
                        ? "border-accent ring-2 ring-accent/15"
                        : "border-line hover:border-line-strong"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold">
                          {repository.path}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-faint">
                          <span className="flex items-center gap-1">
                            {repository.private ? (
                              <Lock className="size-3" />
                            ) : (
                              <Globe className="size-3" />
                            )}
                            {repository.private ? "Private" : "Public"}
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <GitBranch className="size-3" />
                            {repository.defaultBranch}
                          </span>
                          {repository.updatedAt ? (
                            <>
                              <span>·</span>
                              <span>
                                updated {relativeTime(repository.updatedAt)}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}

              <div className="flex items-center justify-between border-t border-line pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1 || repositories.isFetching}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                  Previous
                </Button>
                <span className="font-mono text-[10px] text-faint">
                  Page {page}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={
                    !repositories.data?.hasMore || repositories.isFetching
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {projectDetailsCard}
        </div>
      ) : null}
    </div>
  );
}
