import {
  Archive,
  FolderGit2,
  GitBranch,
  GitFork,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGroup } from "@/lib/queries";
import { relativeTime, roleTone } from "@/lib/utils";

export function GroupPage() {
  const { groupSlug = "" } = useParams();
  const { data, isLoading, error } = useGroup(groupSlug);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-24 animate-pulse rounded-xl bg-line/40" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((key) => (
            <div
              key={key}
              className="h-40 animate-pulse rounded-xl bg-line/40"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <Users className="mx-auto size-7 text-faint" />
        <h1 className="mt-4 text-sm font-semibold">Group not found</h1>
        <p className="mt-1 text-[13px] text-muted">
          It may be private, or the link may be wrong.
        </p>
        <Button asChild variant="secondary" className="mt-5">
          <Link to="/groups">Back to groups</Link>
        </Button>
      </div>
    );
  }

  const { group, projects } = data;

  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-3 border-b border-line pb-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {group.name}
            </h1>
            {group.archivedAt ? (
              <Badge tone="red">
                <Archive className="size-3" />
                Archived
              </Badge>
            ) : null}
            {group.personal ? <Badge tone="outline">Personal</Badge> : null}
            <span className="font-mono text-[11px] text-faint">
              {group.slug}
            </span>
            {group.role ? (
              <Badge tone={roleTone(group.role)}>{group.role}</Badge>
            ) : null}
          </div>
          {group.description ? (
            <p className="mt-1 truncate text-[13px] text-muted">
              {group.description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {group.role ? (
            <Button asChild variant="ghost" size="sm">
              <Link to={`/groups/${group.slug}/members`}>
                <Users className="size-4" />
                Members
              </Link>
            </Button>
          ) : null}
          {group.canManage ? (
            <Button asChild variant="ghost" size="sm">
              <Link to={`/groups/${group.slug}/settings`}>
                <Settings className="size-4" />
                Settings
              </Link>
            </Button>
          ) : null}
          {group.canCreateProject && !group.archivedAt ? (
            <>
              <Button asChild variant="secondary" size="sm">
                <Link to={`/groups/${group.slug}/projects/import`}>
                  <GitFork className="size-4" />
                  Import repo
                </Link>
              </Button>
              <Button asChild variant="primary" size="sm">
                <Link to={`/groups/${group.slug}/projects/new`}>
                  <Plus className="size-4" />
                  New project
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Projects</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
            {projects.length} total
          </span>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
            <FolderGit2 className="mx-auto size-7 text-faint" />
            <h3 className="mt-4 text-sm font-semibold">No projects yet</h3>
            <p className="mx-auto mt-1 max-w-sm text-[13px] leading-6 text-muted">
              Projects hold a Git repository, issues, merge requests, and
              members.
            </p>
            {group.canCreateProject && !group.archivedAt ? (
              <Button asChild variant="primary" className="mt-5">
                <Link to={`/groups/${group.slug}/projects/new`}>
                  <Plus className="size-4" />
                  Create the first project
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                to={`/groups/${group.slug}/${project.slug}`}
                className="group flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-line-strong"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-canvas text-muted">
                    <FolderGit2 className="size-4" />
                  </span>
                  <div className="flex items-center gap-1.5">
                    {project.archivedAt ? (
                      <Badge tone="red">Archived</Badge>
                    ) : null}
                    {project.provisioningState !== "ready" ? (
                      <Badge
                        tone={
                          project.provisioningState === "failed"
                            ? "red"
                            : "accent"
                        }
                      >
                        {project.provisioningState}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <h3 className="mt-4 text-[15px] font-semibold tracking-tight">
                  {project.name}
                </h3>
                <p className="mt-1 font-mono text-[10px] text-faint">
                  {group.slug}/{project.slug}
                </p>
                <p className="mt-3 line-clamp-2 min-h-10 text-[13px] leading-5 text-muted">
                  {project.description || "No description yet."}
                </p>
                <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-[11px] text-faint">
                  <span className="flex items-center gap-1.5">
                    <GitBranch className="size-3" />
                    {project.defaultBranch}
                  </span>
                  <span>Updated {relativeTime(project.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
