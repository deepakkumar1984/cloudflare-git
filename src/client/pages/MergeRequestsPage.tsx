import {
  CheckCircle2,
  CircleDot,
  GitPullRequest,
  MessageSquare,
  Plus,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe, useMergeRequests } from "@/lib/queries";
import type { MergeRequestSummary } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";
import { useProjectContext } from "./ProjectLayout";

const stateOptions = [
  { value: "opened", label: "Open", icon: CircleDot },
  { value: "merged", label: "Merged", icon: GitPullRequest },
  { value: "closed", label: "Closed", icon: XCircle },
  { value: "all", label: "All", icon: GitPullRequest },
] as const;

function StateIcon({ state }: { state: MergeRequestSummary["state"] }) {
  if (state === "merged") {
    return <GitPullRequest className="size-3.5 text-accent" />;
  }
  if (state === "closed") {
    return <XCircle className="size-3.5 text-red" />;
  }
  return <CircleDot className="size-3.5 text-green" />;
}

export function MergeRequestsPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const me = useMe();
  const [state, setState] = useState("opened");
  const [query, setQuery] = useState("");
  const [reviewer, setReviewer] = useState("");
  const deferredQuery = useDeferredValue(query);
  const base = `/groups/${groupSlug}/${projectSlug}`;
  const mergeRequests = useMergeRequests(groupSlug, projectSlug, {
    state,
    q: deferredQuery || undefined,
    reviewer: reviewer || undefined,
    perPage: 40,
  });

  const total = mergeRequests.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          Merge requests
          <span className="ml-2 font-normal text-faint">
            {total} {state === "all" ? "total" : state}
          </span>
        </h1>
        {context.canWriteGit ? (
          <Button asChild variant="primary" size="sm">
            <Link to={`${base}/merge_requests/new`}>
              <Plus className="size-4" />
              New merge request
            </Link>
          </Button>
        ) : null}
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 shadow-card lg:flex-row lg:items-center">
        <div className="flex rounded-lg border border-line bg-canvas p-0.5">
          {stateOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setState(option.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                state === option.value
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              )}
            >
              <option.icon className="size-3.5" />
              {option.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search merge requests"
            className="pl-8"
            aria-label="Search merge requests"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (!me.data) return;
            setReviewer((current) =>
              current === me.data.user.id ? "" : me.data.user.id
            );
          }}
          className={cn(
            "flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-[12px] font-medium transition-colors",
            reviewer
              ? "border-accent/30 bg-accent-soft text-accent-strong"
              : "border-line text-muted hover:text-ink"
          )}
        >
          <Users className="size-3.5" />
          Requested for me
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {mergeRequests.isLoading ? (
          <div className="divide-y divide-line">
            {[1, 2, 3, 4].map((key) => (
              <div key={key} className="h-[72px] animate-pulse bg-line/15" />
            ))}
          </div>
        ) : mergeRequests.error ? (
          <p className="px-5 py-16 text-center text-[13px] text-muted">
            Could not load merge requests.
          </p>
        ) : (mergeRequests.data?.mergeRequests.length ?? 0) === 0 ? (
          <div className="px-5 py-16 text-center">
            <GitPullRequest className="mx-auto size-6 text-faint" />
            <p className="mt-3 text-sm font-medium">No merge requests here</p>
            <p className="mt-1 text-[13px] text-muted">
              Open a branch, push it, then start a review.
            </p>
            {context.canWriteGit ? (
              <Button asChild variant="secondary" size="sm" className="mt-4">
                <Link to={`${base}/merge_requests/new`}>New merge request</Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-line">
            {mergeRequests.data?.mergeRequests.map((mr) => (
              <div
                key={mr.id}
                className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-canvas/50"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                    mr.state === "opened"
                      ? "border-green/25 bg-green-soft"
                      : "border-line bg-canvas"
                  )}
                >
                  <StateIcon state={mr.state} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`${base}/merge_requests/${mr.iid}`}
                      className="text-[13px] font-medium text-ink hover:text-accent"
                    >
                      {mr.title}
                    </Link>
                    {mr.draft ? <Badge tone="neutral">Draft</Badge> : null}
                    {mr.mergeDetection === "manual" ? (
                      <Badge tone="accent">Manually merged</Badge>
                    ) : null}
                    {mr.mergeDetection === "heuristic" ? (
                      <Badge tone="accent">Heuristic merge</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-faint">
                    <span className="font-mono">!{mr.iid}</span>
                    <span>·</span>
                    <span className="font-mono">
                      {mr.sourceBranch} → {mr.targetBranch}
                    </span>
                    <span>·</span>
                    <span>
                      opened {relativeTime(mr.createdAt)} by {mr.author.name}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden items-center gap-1 text-[10px] text-faint sm:flex">
                    <MessageSquare className="size-3" />
                    {mr.reviewers.length}
                  </span>
                  <span className="hidden items-center gap-1 text-[10px] text-faint sm:flex">
                    <CheckCircle2 className="size-3 text-green" />
                    {mr.approvalCount}
                  </span>
                  <div className="flex -space-x-1.5">
                    {mr.reviewers.slice(0, 3).map((reviewer) => (
                      <Avatar
                        key={reviewer.id}
                        name={reviewer.name}
                        src={reviewer.image}
                        className="size-6 border-2 border-surface"
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
