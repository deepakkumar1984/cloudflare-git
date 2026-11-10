import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { useRepository, useRepositoryCommits } from "@/lib/queries";
import type { RepositoryCommit } from "@/lib/types";
import { dateTime, relativeTime } from "@/lib/utils";
import { useProjectContext } from "./ProjectLayout";

function CommitRow({
  commit,
  groupSlug,
  projectSlug,
  first,
}: {
  commit: RepositoryCommit;
  groupSlug: string;
  projectSlug: string;
  first: boolean;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className="flex w-4 shrink-0 justify-center">
        <span
          className={
            first
              ? "mt-1.5 size-2 rounded-full bg-accent"
              : "mt-1.5 size-2 rounded-full bg-line-strong"
          }
        />
      </div>
      <div className="min-w-0 flex-1">
        <Link
          to={`/groups/${groupSlug}/${projectSlug}/repository/commits/${commit.hash}`}
          className="line-clamp-1 text-[13px] font-medium text-ink hover:text-accent"
        >
          {commit.message.split("\n")[0]}
        </Link>
        <p className="mt-0.5 text-[11px] text-faint">
          {commit.author.name} · {relativeTime(commit.committedAt)}
        </p>
      </div>
      <span className="hidden shrink-0 font-mono text-[10px] text-faint sm:block">
        {commit.hash.slice(0, 8)}
      </span>
    </div>
  );
}

export function RepositoryCommitsPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const queryClient = useQueryClient();
  const summary = useRepository(groupSlug, projectSlug);
  const ref =
    searchParams.get("ref") ||
    summary.data?.defaultBranch ||
    context.project.defaultBranch;
  const commits = useRepositoryCommits(groupSlug, projectSlug, ref, offset);

  const refresh = useMutation({
    mutationFn: () =>
      api.post(
        `/groups/${groupSlug}/projects/${projectSlug}/repository/refresh`
      ),
    onSuccess: async () => {
      toast.success("Refs refreshed");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["repository", groupSlug, projectSlug],
        }),
        queryClient.invalidateQueries({
          queryKey: ["project", groupSlug, projectSlug],
        }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <GitBranch className="size-3.5 text-faint" />
          <select
            value={ref}
            onChange={(event) => {
              setOffset(0);
              setSearchParams({ ref: event.target.value });
            }}
            className="h-8 rounded-md border border-line bg-surface px-2 font-mono text-[11px]"
            aria-label="Branch"
          >
            {(summary.data?.branches ?? []).map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
          <Badge tone="outline">{context.project.name}</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button asChild variant="ghost" size="sm">
            <Link
              to={`/groups/${groupSlug}/${projectSlug}/repository?ref=${encodeURIComponent(ref)}`}
            >
              Files
            </Link>
          </Button>
          {context.canManageSettings ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              aria-label="Refresh refs"
            >
              {refresh.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {commits.isLoading ? (
          <div className="divide-y divide-line">
            {[1, 2, 3, 4, 5].map((key) => (
              <div key={key} className="h-16 animate-pulse bg-line/15" />
            ))}
          </div>
        ) : commits.error ? (
          <p className="px-5 py-14 text-center text-[13px] text-muted">
            Could not load commits. Refresh refs and try again.
          </p>
        ) : commits.data?.commits.length === 0 ? (
          <p className="px-5 py-14 text-center text-[13px] text-muted">
            No commits on this branch yet.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {commits.data?.commits.map((commit, index) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
                groupSlug={groupSlug}
                projectSlug={projectSlug}
                first={index === 0 && offset === 0}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-line bg-canvas/40 px-4 py-2.5">
          <span className="text-[11px] text-faint">
            {offset > 0 ? `Offset ${offset}` : "Newest first"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setOffset(Math.max(0, offset - 30))}
              disabled={offset === 0}
              aria-label="Newer commits"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setOffset(offset + 30)}
              disabled={!commits.data?.hasMore}
              aria-label="Older commits"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {commits.data?.commits[0] ? (
        <p className="text-center text-[10px] text-faint">
          Head {commits.data.commits[0].hash.slice(0, 10)} ·{" "}
          {dateTime(commits.data.commits[0].committedAt)}
        </p>
      ) : null}
    </div>
  );
}
