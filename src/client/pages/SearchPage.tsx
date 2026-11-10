import {
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  FolderGit2,
  GitPullRequest,
  Lock,
  Search,
} from "lucide-react";
import { useDeferredValue } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useSearch } from "@/lib/queries";
import { relativeTime } from "@/lib/utils";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const deferred = useDeferredValue(query);
  const results = useSearch(deferred);
  const total =
    (results.data?.projects.length ?? 0) +
    (results.data?.issues.length ?? 0) +
    (results.data?.mergeRequests.length ?? 0);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Search</h1>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input
          autoFocus
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setParams(value ? { q: value } : {}, { replace: true });
          }}
          placeholder="Search titles, descriptions, and project names"
          className="h-11 pl-9"
          aria-label="Search"
        />
      </div>

      {query.trim().length < 2 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <p className="text-sm font-medium">Type at least two characters.</p>
          <p className="mt-1 text-[13px] text-muted">
            Search matches project names, issue titles and descriptions, and
            merge request titles and descriptions.
          </p>
        </div>
      ) : results.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((key) => (
            <div
              key={key}
              className="h-20 animate-pulse rounded-xl bg-line/30"
            />
          ))}
        </div>
      ) : results.error ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <p className="text-sm font-medium">Search failed</p>
          <p className="mt-1 text-[13px] text-muted">Try again in a moment.</p>
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <Search className="mx-auto size-6 text-faint" />
          <p className="mt-3 text-sm font-medium">
            No results for “{deferred.trim()}”
          </p>
          <p className="mt-1 text-[13px] text-muted">
            Try a shorter term or a different spelling.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {(results.data?.projects.length ?? 0) > 0 ? (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <FolderGit2 className="size-4 text-muted" />
                <h2 className="text-sm font-semibold">Projects</h2>
                <span className="font-mono text-[10px] text-faint">
                  {results.data?.projects.length}
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                <div className="divide-y divide-line">
                  {results.data?.projects.map((project) => (
                    <Link
                      key={`${project.groupSlug}/${project.slug}`}
                      to={`/groups/${project.groupSlug}/${project.slug}`}
                      className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-canvas/50"
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-muted">
                        <FolderGit2 className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium group-hover:text-accent">
                            {project.name}
                          </span>
                          <Badge tone="outline">
                            {project.groupSlug}/{project.slug}
                          </Badge>
                        </div>
                        {project.description ? (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">
                            {project.description}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[10px] text-faint">
                          {project.groupName} · updated{" "}
                          {relativeTime(project.updatedAt)}
                        </p>
                      </div>
                      <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {(results.data?.issues.length ?? 0) > 0 ? (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <CircleDot className="size-4 text-muted" />
                <h2 className="text-sm font-semibold">Issues</h2>
                <span className="font-mono text-[10px] text-faint">
                  {results.data?.issues.length}
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                <div className="divide-y divide-line">
                  {results.data?.issues.map((issue) => (
                    <Link
                      key={`${issue.groupSlug}/${issue.projectSlug}#${issue.iid}`}
                      to={`/groups/${issue.groupSlug}/${issue.projectSlug}/issues/${issue.iid}`}
                      className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-canvas/50"
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-canvas">
                        {issue.state === "opened" ? (
                          <CircleDot className="size-3.5 text-green" />
                        ) : (
                          <CheckCircle2 className="size-3.5 text-faint" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium group-hover:text-accent">
                            {issue.title}
                          </span>
                          {issue.confidential ? (
                            <Badge tone="red">
                              <Lock className="size-3" />
                              Confidential
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[10px] text-faint">
                          <span className="font-mono">
                            {issue.groupSlug}/{issue.projectSlug}#{issue.iid}
                          </span>{" "}
                          · {issue.state} · updated{" "}
                          {relativeTime(issue.updatedAt)}
                        </p>
                      </div>
                      <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {(results.data?.mergeRequests.length ?? 0) > 0 ? (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <GitPullRequest className="size-4 text-muted" />
                <h2 className="text-sm font-semibold">Merge requests</h2>
                <span className="font-mono text-[10px] text-faint">
                  {results.data?.mergeRequests.length}
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                <div className="divide-y divide-line">
                  {results.data?.mergeRequests.map((mr) => (
                    <Link
                      key={`${mr.groupSlug}/${mr.projectSlug}!${mr.iid}`}
                      to={`/groups/${mr.groupSlug}/${mr.projectSlug}/merge_requests/${mr.iid}`}
                      className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-canvas/50"
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-canvas">
                        <GitPullRequest className="size-3.5 text-green" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium group-hover:text-accent">
                            {mr.title}
                          </span>
                          <Badge
                            tone={
                              mr.state === "opened"
                                ? "green"
                                : mr.state === "merged"
                                  ? "accent"
                                  : "red"
                            }
                          >
                            {mr.state}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[10px] text-faint">
                          <span className="font-mono">
                            {mr.groupSlug}/{mr.projectSlug}!{mr.iid}
                          </span>{" "}
                          · <span className="font-mono">{mr.sourceBranch}</span>{" "}
                          → <span className="font-mono">{mr.targetBranch}</span>{" "}
                          · updated {relativeTime(mr.updatedAt)}
                        </p>
                      </div>
                      <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
