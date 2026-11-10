import {
  ArrowUpRight,
  CircleDot,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Plus,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDashboard, useMe } from "@/lib/queries";
import type { DashboardActivity } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function activityMeta(activity: DashboardActivity): {
  icon: typeof CircleDot;
  label: string;
  to: string | null;
} {
  const projectBase =
    activity.groupSlug && activity.projectSlug
      ? `/groups/${activity.groupSlug}/${activity.projectSlug}`
      : null;

  switch (activity.action) {
    case "push":
      return {
        icon: GitBranch,
        label: "pushed commits",
        to: projectBase ? `${projectBase}/repository/commits` : null,
      };
    case "issue.opened":
    case "issue.closed":
    case "issue.reopened":
    case "issue.comment":
      return {
        icon: activity.action === "issue.comment" ? MessageSquare : CircleDot,
        label:
          activity.action === "issue.opened"
            ? "opened an issue"
            : activity.action === "issue.closed"
              ? "closed an issue"
              : activity.action === "issue.comment"
                ? "commented on an issue"
                : "reopened an issue",
        to:
          projectBase && activity.targetIid
            ? `${projectBase}/issues/${activity.targetIid}`
            : null,
      };
    case "mr.opened":
    case "mr.merged":
    case "mr.closed":
    case "mr.approved":
    case "mr.comment":
      return {
        icon: activity.action === "mr.comment" ? MessageSquare : GitPullRequest,
        label:
          activity.action === "mr.comment"
            ? "commented on a merge request"
            : activity.action === "mr.opened"
              ? "opened a merge request"
              : activity.action === "mr.merged"
                ? "merged a merge request"
                : activity.action === "mr.approved"
                  ? "approved a merge request"
                  : "closed a merge request",
        to:
          projectBase && activity.targetIid
            ? `${projectBase}/merge_requests/${activity.targetIid}`
            : null,
      };
    case "project.created":
      return {
        icon: FolderGit2,
        label: "created a project",
        to: projectBase,
      };
    case "group.created":
      return {
        icon: Users,
        label: "created a group",
        to: activity.groupSlug ? `/groups/${activity.groupSlug}` : null,
      };
    default:
      return {
        icon: CircleDot,
        label: activity.action.replaceAll(".", " ").replaceAll("_", " "),
        to: projectBase,
      };
  }
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-7 text-center text-[13px] text-muted">
      {children}
    </div>
  );
}

export function DashboardPage() {
  const me = useMe();
  const dashboard = useDashboard();
  const data = dashboard.data;
  const groups = me.data?.groups ?? [];
  const personal = groups.find((group) => group.personal);
  const recentProjects = data?.recentProjects ?? [];
  const assigned = data?.assignedIssues ?? [];
  const reviews = data?.reviewRequests ?? [];
  const activity = data?.activity ?? [];

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mono-label mb-3">Workspace overview</p>
          <h1 className="font-display text-[38px] leading-none tracking-[-0.04em] text-ink sm:text-[44px]">
            {greeting()}, {me.data?.user.name?.split(" ")[0] || "there"}.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Your open work, recent projects, and what changed across the groups
            you belong to.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {personal ? (
            <Button asChild variant="secondary">
              <Link to={`/groups/${personal.slug}/projects/new`}>
                <Plus className="size-4" />
                New project
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="primary">
            <Link to="/groups/new">
              <Users className="size-4" />
              New group
            </Link>
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card sm:grid-cols-4 sm:divide-x">
        {[
          { label: "Assigned issues", value: assigned.length, tone: "accent" },
          { label: "Review requests", value: reviews.length, tone: "blue" },
          {
            label: "Recent projects",
            value: recentProjects.length,
            tone: "green",
          },
          { label: "Groups", value: groups.length, tone: "neutral" },
        ].map((stat) => (
          <div key={stat.label} className="px-5 py-4 sm:py-5">
            <p className="mono-label">{stat.label}</p>
            <p
              className={cn(
                "mt-2 font-display text-3xl tabular-nums tracking-[-0.04em]",
                stat.tone === "accent" && "text-accent",
                stat.tone === "blue" && "text-blue",
                stat.tone === "green" && "text-green"
              )}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">My work</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                {assigned.length + reviews.length} open
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              {assigned.length === 0 && reviews.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm font-medium text-ink">
                    Nothing assigned to you.
                  </p>
                  <p className="mt-1 text-[13px] text-muted">
                    Issues and review requests assigned to you will show up
                    here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {assigned.map((issue) => (
                    <Link
                      key={`issue-${issue.groupSlug}-${issue.projectSlug}-${issue.iid}`}
                      to={`/groups/${issue.groupSlug}/${issue.projectSlug}/issues/${issue.iid}`}
                      className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/70"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                        <CircleDot className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">
                          {issue.title}
                        </p>
                        <p className="truncate text-[11px] text-faint">
                          {issue.groupSlug}/{issue.projectSlug} · #{issue.iid}
                        </p>
                      </div>
                      <span className="hidden text-[11px] text-faint sm:block">
                        {relativeTime(issue.updatedAt)}
                      </span>
                      <ArrowUpRight className="size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  ))}
                  {reviews.map((mr) => (
                    <Link
                      key={`mr-${mr.groupSlug}-${mr.projectSlug}-${mr.iid}`}
                      to={`/groups/${mr.groupSlug}/${mr.projectSlug}/merge_requests/${mr.iid}`}
                      className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/70"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-soft text-blue">
                        <GitPullRequest className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">
                          {mr.title}
                        </p>
                        <p className="truncate text-[11px] text-faint">
                          Review requested · {mr.groupSlug}/{mr.projectSlug} · !
                          {mr.iid}
                        </p>
                      </div>
                      <span className="hidden text-[11px] text-faint sm:block">
                        {relativeTime(mr.updatedAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">
                Recent projects
              </h2>
              <Link
                to="/groups"
                className="text-[11px] font-medium text-accent hover:underline"
              >
                Browse groups
              </Link>
            </div>
            {dashboard.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {[1, 2, 3, 4].map((key) => (
                  <div
                    key={key}
                    className="h-28 animate-pulse rounded-xl bg-line/40"
                  />
                ))}
              </div>
            ) : recentProjects.length === 0 ? (
              <EmptyLine>
                No projects yet.{" "}
                {personal ? (
                  <Link
                    to={`/groups/${personal.slug}/projects/new`}
                    className="font-medium text-accent hover:underline"
                  >
                    Create your first project
                  </Link>
                ) : null}
              </EmptyLine>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {recentProjects.map((project) => (
                  <Link
                    key={`${project.groupSlug}/${project.slug}`}
                    to={`/groups/${project.groupSlug}/${project.slug}`}
                    className="group rounded-xl border border-line bg-surface p-4 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-line-strong"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-canvas text-muted">
                        <FolderGit2 className="size-4" />
                      </span>
                      <ArrowUpRight className="size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <p className="mt-4 truncate text-sm font-semibold text-ink">
                      {project.name}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-faint">
                      {project.groupSlug}/{project.slug}
                    </p>
                    <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-muted">
                      {project.description || "No description yet."}
                    </p>
                    <p className="mt-3 text-[10px] text-faint">
                      Updated {relativeTime(project.updatedAt)}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Activity</CardTitle>
              <Badge tone="outline">Live</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {activity.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-muted">
                  Activity across your projects will appear here.
                </p>
              ) : (
                <div className="divide-y divide-line">
                  {activity.map((item) => {
                    const meta = activityMeta(item);
                    const Icon = meta.icon;
                    const content = (
                      <>
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-muted">
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[12px] leading-5 text-muted">
                            <span className="font-medium text-ink">
                              {item.actorName || "System"}
                            </span>{" "}
                            {meta.label}
                            {item.projectName ? (
                              <>
                                {" "}
                                in{" "}
                                <span className="text-ink">
                                  {item.projectName}
                                </span>
                              </>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-[10px] text-faint">
                            {relativeTime(item.createdAt)}
                          </p>
                        </div>
                      </>
                    );
                    return meta.to ? (
                      <Link
                        key={item.id}
                        to={meta.to}
                        className="flex gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/70"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div key={item.id} className="flex gap-3 px-5 py-3.5">
                        {content}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-line bg-canvas/60 px-5 py-4">
              <p className="mono-label">Your groups</p>
            </div>
            <CardContent className="space-y-1 p-2">
              {groups.slice(0, 6).map((group) => (
                <Link
                  key={group.id}
                  to={`/groups/${group.slug}`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-canvas"
                >
                  <div className="flex size-8 items-center justify-center rounded-lg border border-line bg-surface">
                    {group.personal ? (
                      <Users className="size-3.5 text-faint" />
                    ) : (
                      <FolderGit2 className="size-3.5 text-faint" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {group.name}
                    </p>
                    <p className="truncate font-mono text-[10px] text-faint">
                      {group.slug}
                    </p>
                  </div>
                  {group.role ? (
                    <Badge tone={group.role === "owner" ? "accent" : "neutral"}>
                      {group.role}
                    </Badge>
                  ) : null}
                </Link>
              ))}
              {groups.length === 0 ? (
                <p className="px-3 py-5 text-center text-[12px] text-muted">
                  No groups yet.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
