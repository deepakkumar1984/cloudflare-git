import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ListChecks,
  Plus,
  Search,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useIssues,
  useLabels,
  useMilestones,
  useProjectMembers,
} from "@/lib/queries";
import { canCreateIssue } from "@shared/permissions";
import { cn, relativeTime } from "@/lib/utils";
import { useProjectContext } from "./ProjectLayout";

function StateTabs({
  state,
  onChange,
}: {
  state: string;
  onChange: (value: string) => void;
}) {
  const options = [
    { value: "opened", label: "Open", icon: CircleDot },
    { value: "closed", label: "Closed", icon: CheckCircle2 },
    { value: "all", label: "All", icon: ListChecks },
  ];
  return (
    <div className="flex rounded-lg border border-line bg-canvas p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
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
  );
}

export function IssuesPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const [state, setState] = useState("opened");
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [assignee, setAssignee] = useState("");
  const [milestone, setMilestone] = useState("");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const base = `/groups/${groupSlug}/${projectSlug}`;

  const issues = useIssues(groupSlug, projectSlug, {
    state,
    q: deferredQuery || undefined,
    label: label || undefined,
    assignee: assignee || undefined,
    milestone: milestone || undefined,
    page,
    perPage: 25,
  });
  const labels = useLabels(groupSlug, projectSlug);
  const milestones = useMilestones(groupSlug, projectSlug);
  const members = useProjectMembers(groupSlug, projectSlug);

  const total = issues.data?.total ?? 0;
  const perPage = issues.data?.perPage ?? 25;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const canCreate = canCreateIssue(context.project.role);

  function resetPage() {
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          Issues
          <span className="ml-2 font-normal text-faint">
            {total} {state === "all" ? "total" : state}
          </span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to={`${base}/boards`}>Board</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to={`${base}/labels`}>Labels</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to={`${base}/milestones`}>Milestones</Link>
          </Button>
          {canCreate ? (
            <Button asChild variant="primary" size="sm">
              <Link to={`${base}/issues/new`}>
                <Plus className="size-4" />
                New issue
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 shadow-card lg:flex-row lg:items-center">
        <StateTabs
          state={state}
          onChange={(value) => {
            setState(value);
            resetPage();
          }}
        />
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              resetPage();
            }}
            placeholder="Search issue titles and descriptions"
            className="pl-8"
            aria-label="Search issues"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              resetPage();
            }}
            className="h-9 rounded-md border border-line bg-surface px-2 text-[12px] text-muted"
            aria-label="Filter by label"
          >
            <option value="">All labels</option>
            {(labels.data?.labels ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <select
            value={assignee}
            onChange={(event) => {
              setAssignee(event.target.value);
              resetPage();
            }}
            className="h-9 rounded-md border border-line bg-surface px-2 text-[12px] text-muted"
            aria-label="Filter by assignee"
          >
            <option value="">Anyone</option>
            {[
              ...new Set(
                (members.data?.members ?? []).map((member) => member.user.id)
              ),
            ].map((userId) => {
              const member = members.data?.members.find(
                (item) => item.user.id === userId
              );
              return member ? (
                <option key={userId} value={userId}>
                  {member.user.name}
                </option>
              ) : null;
            })}
          </select>
          <select
            value={milestone}
            onChange={(event) => {
              setMilestone(event.target.value);
              resetPage();
            }}
            className="h-9 rounded-md border border-line bg-surface px-2 text-[12px] text-muted"
            aria-label="Filter by milestone"
          >
            <option value="">All milestones</option>
            {(milestones.data?.milestones ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {issues.isLoading ? (
          <div className="divide-y divide-line">
            {[1, 2, 3, 4, 5].map((key) => (
              <div key={key} className="h-16 animate-pulse bg-line/15" />
            ))}
          </div>
        ) : issues.error ? (
          <p className="px-5 py-16 text-center text-[13px] text-muted">
            Could not load issues.
          </p>
        ) : issues.data?.issues.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <CircleDot className="mx-auto size-6 text-faint" />
            <p className="mt-3 text-sm font-medium">
              No issues match these filters
            </p>
            <p className="mt-1 text-[13px] text-muted">
              Clear filters or open a new issue.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {issues.data?.issues.map((issue) => (
              <div
                key={issue.id}
                className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-canvas/50"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                    issue.state === "opened"
                      ? "border-green/25 bg-green-soft text-green"
                      : "border-line bg-canvas text-faint"
                  )}
                >
                  {issue.state === "opened" ? (
                    <CircleDot className="size-3.5" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`${base}/issues/${issue.iid}`}
                      className="text-[13px] font-medium text-ink hover:text-accent"
                    >
                      {issue.title}
                    </Link>
                    {issue.confidential ? (
                      <Badge tone="red">Confidential</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                    <span className="font-mono">#{issue.iid}</span>
                    <span>
                      opened {relativeTime(issue.createdAt)} by{" "}
                      {issue.author.name}
                    </span>
                    {issue.milestone ? (
                      <span className="text-blue">{issue.milestone.title}</span>
                    ) : null}
                    {issue.checklist.total > 0 ? (
                      <span className="flex items-center gap-1">
                        <ListChecks className="size-3" />
                        {issue.checklist.completed}/{issue.checklist.total}
                      </span>
                    ) : null}
                  </div>
                  {issue.labels.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {issue.labels.map((item) => (
                        <span
                          key={item.id}
                          className="rounded-full border px-2 py-0.5 text-[11px]"
                          style={{
                            borderColor: `${item.color}55`,
                            backgroundColor: `${item.color}14`,
                            color: item.color,
                          }}
                        >
                          {item.title}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="hidden items-center gap-2 sm:flex">
                  {issue.assignees.slice(0, 3).map((person) => (
                    <Avatar
                      key={person.id}
                      name={person.name}
                      src={person.image}
                      className="size-6"
                    />
                  ))}
                  <span className="w-24 shrink-0 whitespace-nowrap text-right text-[11px] text-faint">
                    {relativeTime(issue.updatedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-line bg-canvas/40 px-4 py-2.5">
          <span className="text-[11px] text-faint">
            Page {page} of {pages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPage(Math.min(pages, page + 1))}
              disabled={page >= pages}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
