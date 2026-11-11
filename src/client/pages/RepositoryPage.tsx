import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Database,
  File,
  FileArchive,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  GitBranch,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import {
  useProject,
  useRepository,
  useRepositoryReadme,
  useRepositoryTree,
} from "@/lib/queries";
import { relativeTime } from "@/lib/utils";

function FileGlyph({ name, directory }: { name: string; directory: boolean }) {
  if (directory) return <Folder className="size-4 text-accent" />;
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (extension === "json") return <FileJson className="size-4 text-blue" />;
  if (
    ["ts", "tsx", "js", "jsx", "css", "html", "py", "go", "rs"].includes(
      extension || ""
    )
  ) {
    return <FileCode2 className="size-4 text-green" />;
  }
  if (["md", "markdown", "txt"].includes(extension || "")) {
    return <FileText className="size-4 text-muted" />;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension || "")) {
    return <ImageIcon className="size-4 text-blue" />;
  }
  if (["zip", "gz", "tar", "rar"].includes(extension || "")) {
    return <FileArchive className="size-4 text-muted" />;
  }
  return <File className="size-4 text-muted" />;
}

export function RepositoryPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const projectQuery = useProject(groupSlug, projectSlug);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const summary = useRepository(groupSlug, projectSlug);

  const branch =
    searchParams.get("ref") ||
    summary.data?.defaultBranch ||
    projectQuery.data?.project.defaultBranch ||
    "main";
  const path = searchParams.get("path") || "";
  const tree = useRepositoryTree(
    groupSlug,
    projectSlug,
    branch,
    path,
    Boolean(summary.data && !summary.data.isEmpty)
  );
  const readme = useRepositoryReadme(groupSlug, projectSlug);

  function setLocation(nextPath: string, nextBranch = branch) {
    const params = new URLSearchParams();
    params.set("ref", nextBranch);
    if (nextPath) params.set("path", nextPath);
    setSearchParams(params);
  }

  async function invalidateRepo() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["repository", groupSlug, projectSlug],
      }),
      queryClient.invalidateQueries({
        queryKey: ["project", groupSlug, projectSlug],
      }),
    ]);
  }

  const seed = useMutation({
    mutationFn: () =>
      api.post(
        `/groups/${groupSlug}/projects/${projectSlug}/repository/dev-seed`
      ),
    onSuccess: async () => {
      toast.success("Demo repository created");
      await invalidateRepo();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const segments = path.split("/").filter(Boolean);
  const latest = tree.data?.commit;

  if (summary.isLoading) {
    return <div className="h-80 animate-pulse rounded-xl bg-line/30" />;
  }

  if (summary.error) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
        <p className="text-sm font-semibold">Could not load the repository</p>
        <p className="mt-1 text-[13px] text-muted">
          Check that repository setup succeeded.
        </p>
      </div>
    );
  }

  const repo = summary.data;
  if (!repo || repo.isEmpty) {
    return (
      <EmptyState
        icon={GitBranch}
        title="This repository is empty"
        description={
          <>
            Push a first commit to{" "}
            <code className="font-mono text-ink">
              {repo?.defaultBranch || "main"}
            </code>{" "}
            using a write credential from the Clone dialog.
          </>
        }
        action={
          import.meta.env.DEV ? (
            <Button
              variant="secondary"
              onClick={() => seed.mutate()}
              disabled={seed.isPending}
            >
              {seed.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Database className="size-4" />
              )}
              Load demo files
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.6fr)]">
      <div className="space-y-5">
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-3.5 shrink-0 text-faint" />
              <select
                value={branch}
                onChange={(event) => setLocation("", event.target.value)}
                className="h-8 max-w-44 rounded-md border border-line bg-surface px-2 font-mono text-[11px]"
                aria-label="Branch"
              >
                {repo.branches.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
              <span className="hidden truncate font-mono text-[10px] text-faint sm:inline">
                {repo.branches
                  .find((item) => item.name === branch)
                  ?.sha.slice(0, 8)}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <Button asChild variant="ghost" size="sm">
                <Link
                  to={`/groups/${groupSlug}/${projectSlug}/releases?tab=tags`}
                >
                  Tags
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link
                  to={`/groups/${groupSlug}/${projectSlug}/repository/commits?ref=${encodeURIComponent(branch)}`}
                >
                  Commits
                </Link>
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-b border-line bg-canvas/40 px-4 py-2 font-mono text-[11px] text-muted">
            <button
              type="button"
              onClick={() => setLocation("")}
              className="rounded px-1.5 py-0.5 hover:bg-surface hover:text-ink"
            >
              {projectQuery.data?.project.name || projectSlug}
            </button>
            {segments.map((segment, index) => (
              <span
                key={`${segment}-${index}`}
                className="flex items-center gap-1"
              >
                <ChevronRight className="size-3 text-faint" />
                <button
                  type="button"
                  onClick={() =>
                    setLocation(segments.slice(0, index + 1).join("/"))
                  }
                  className="rounded px-1.5 py-0.5 hover:bg-surface hover:text-ink"
                >
                  {segment}
                </button>
              </span>
            ))}
          </div>

          {tree.isLoading ? (
            <div className="divide-y divide-line">
              {[1, 2, 3, 4].map((key) => (
                <div key={key} className="h-11 animate-pulse bg-line/15" />
              ))}
            </div>
          ) : tree.error ? (
            <div className="px-5 py-12 text-center text-[13px] text-muted">
              This path could not be loaded.
            </div>
          ) : (
            <div className="divide-y divide-line">
              {tree.data?.truncated ? (
                <p className="border-b border-line bg-accent-soft px-4 py-2 text-[11px] text-accent-strong">
                  This directory has more entries than can be listed at once.
                  The first {tree.data.entries.length} are shown.
                </p>
              ) : null}
              {tree.data?.entries.length === 0 ? (
                <p className="px-5 py-10 text-center text-[13px] text-muted">
                  This directory is empty.
                </p>
              ) : (
                tree.data?.entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() =>
                      entry.type === "tree"
                        ? setLocation(entry.path)
                        : navigate(
                            `/groups/${groupSlug}/${projectSlug}/repository/blob?ref=${encodeURIComponent(branch)}&path=${encodeURIComponent(entry.path)}`
                          )
                    }
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-canvas/60"
                  >
                    <FileGlyph
                      name={entry.name}
                      directory={entry.type === "tree"}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {entry.name}
                    </span>
                    <span className="hidden font-mono text-[10px] text-faint sm:inline">
                      {entry.hash.slice(0, 7)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {latest ? (
            <div className="flex items-center gap-3 border-t border-line bg-canvas/40 px-4 py-2.5">
              <span className="font-mono text-[10px] text-faint">
                {latest.hash.slice(0, 8)}
              </span>
              <Link
                to={`/groups/${groupSlug}/${projectSlug}/repository/commits/${latest.hash}`}
                className="min-w-0 flex-1 truncate text-[11px] text-muted hover:text-ink"
              >
                {latest.message.split("\n")[0]}
              </Link>
              <span className="hidden text-[10px] text-faint sm:block">
                {latest.author.name} · {relativeTime(latest.authoredAt)}
              </span>
            </div>
          ) : null}
        </div>

        {!path && readme.data?.readme ? (
          <div className="rounded-xl border border-line bg-surface px-6 py-6 shadow-card">
            <div className="mb-4 flex items-center gap-2 border-b border-line pb-3">
              <FileText className="size-3.5 text-muted" />
              <span className="font-mono text-[11px] text-muted">
                {readme.data.readme.path}
              </span>
            </div>
            <Markdown>{readme.data.readme.content}</Markdown>
          </div>
        ) : null}
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="mono-label">Remote</p>
          <code className="mt-2 block break-all font-mono text-[10px] leading-5 text-muted">
            {repo.remote || "Not provisioned"}
          </code>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <span className="text-[11px] text-faint">Branches</span>
            <Badge tone="outline">{repo.branches.length}</Badge>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-canvas/50 p-4">
          <p className="mono-label">Push access</p>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            Credentials are branch-unrestricted. There is no branch protection
            in this milestone.
          </p>
        </div>
      </aside>
    </div>
  );
}
