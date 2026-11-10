import { ArrowLeft, GitCommitHorizontal, GitMerge } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { dateTime } from "@/lib/utils";
import { useRepositoryCommit } from "@/lib/queries";
import { useProjectContext } from "./ProjectLayout";

export function RepositoryCommitPage() {
  const { groupSlug = "", projectSlug = "", sha = "" } = useParams();
  const context = useProjectContext();
  const commit = useRepositoryCommit(groupSlug, projectSlug, sha);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        to={`/groups/${groupSlug}/${projectSlug}/repository/commits`}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Commit history
      </Link>

      {commit.isLoading ? (
        <div className="h-72 animate-pulse rounded-xl bg-line/30" />
      ) : commit.error || !commit.data ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <p className="text-sm font-semibold">Commit not found</p>
        </div>
      ) : (
        <>
          <header className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas text-muted">
                {commit.data.commit.parents.length > 1 ? (
                  <GitMerge className="size-4" />
                ) : (
                  <GitCommitHorizontal className="size-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className="whitespace-pre-wrap text-[15px] font-semibold leading-6 text-ink">
                  {commit.data.commit.message}
                </p>
                <p className="mt-2 text-[12px] text-muted">
                  <span className="font-medium text-ink">
                    {commit.data.commit.author.name}
                  </span>{" "}
                  &lt;{commit.data.commit.author.email}&gt; committed{" "}
                  {dateTime(commit.data.commit.committedAt)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Badge tone="outline">
                <span className="font-mono">{commit.data.commit.hash}</span>
              </Badge>
              <span className="text-[11px] text-faint">
                {context.project.name}
              </span>
            </div>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <p className="mono-label">Parents</p>
              {commit.data.commit.parents.length === 0 ? (
                <p className="mt-2 text-[12px] text-muted">Root commit</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {commit.data.commit.parents.map((parent) => (
                    <Link
                      key={parent}
                      to={`/groups/${groupSlug}/${projectSlug}/repository/commits/${parent}`}
                      className="block truncate font-mono text-[11px] text-accent hover:underline"
                    >
                      {parent}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <p className="mono-label">Committer</p>
              <p className="mt-2 text-[12px] text-ink">
                {commit.data.commit.committer.name}
              </p>
              <p className="font-mono text-[10px] text-faint">
                {commit.data.commit.committer.email}
              </p>
              <p className="mt-2 text-[10px] text-faint">
                Authored {dateTime(commit.data.commit.authoredAt)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-canvas/50 p-4 text-[12px] leading-6 text-muted">
            Diffs for individual commits are not enabled in this milestone. Open
            a merge request or compare branches from the command line.
          </div>
        </>
      )}
    </div>
  );
}
