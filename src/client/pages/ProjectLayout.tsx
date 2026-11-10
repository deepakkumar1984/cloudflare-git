import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  CircleDot,
  GitBranch,
  GitPullRequest,
  Loader2,
  Lock,
  Settings,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { CloneDialog } from "@/components/CloneDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { useMe, useProject, useProjectImport } from "@/lib/queries";
import type { ProjectPageResponse } from "@/lib/types";
import { cn, roleTone } from "@/lib/utils";

export function useProjectContext(): ProjectPageResponse {
  return useOutletContext<ProjectPageResponse>();
}

function tabClass({ isActive }: { isActive: boolean }) {
  return cn(
    "relative flex h-9 shrink-0 items-center gap-1.5 px-3 text-[12px] font-medium text-muted transition-colors hover:text-ink",
    isActive &&
      "text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent"
  );
}

export function ProjectLayout() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const { data, isLoading, error } = useProject(groupSlug, projectSlug);
  const me = useMe();
  const projectImport = useProjectImport(groupSlug, projectSlug);
  const latestImport = projectImport.data?.import ?? data?.latestImport ?? null;
  const importActive =
    latestImport?.status === "pending" || latestImport?.status === "importing";
  const [cloneOpen, setCloneOpen] = useState(false);
  const queryClient = useQueryClient();
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (latestImport?.status !== "ready") return;
    void queryClient.invalidateQueries({
      queryKey: ["project", groupSlug, projectSlug],
    });
  }, [latestImport?.status, groupSlug, projectSlug, queryClient]);

  const retry = useMutation({
    mutationFn: () =>
      latestImport
        ? api.post(
            `/groups/${groupSlug}/projects/${projectSlug}/import/retry`,
            {
              // A failed full-history import is usually an Artifacts memory
              // limit; retry shallow unless the user chose another depth.
              depth: latestImport.depth ?? 1,
            }
          )
        : api.post(`/groups/${groupSlug}/projects/${projectSlug}/provision`),
    onSuccess: async () => {
      setRetryError(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["project", groupSlug, projectSlug],
        }),
        queryClient.invalidateQueries({
          queryKey: ["project", groupSlug, projectSlug, "import"],
        }),
      ]);
    },
    onError: (cause) => setRetryError(errorMessage(cause)),
  });

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-28 animate-pulse rounded-xl bg-line/40" />
        <div className="h-11 animate-pulse rounded-lg bg-line/30" />
        <div className="h-64 animate-pulse rounded-xl bg-line/30" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <Lock className="mx-auto size-7 text-faint" />
        <h1 className="mt-4 text-sm font-semibold">Project not found</h1>
        <p className="mt-1 text-[13px] text-muted">
          It may be private, archived, or the link may be wrong.
        </p>
        <Button asChild variant="secondary" className="mt-5">
          <Link to="/groups">Back to groups</Link>
        </Button>
      </div>
    );
  }

  const { project, group } = data;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to={`/groups/${group.slug}`}
              className="max-w-[34%] truncate text-[13px] text-muted transition-colors hover:text-ink"
            >
              {group.slug}
            </Link>
            <span className="text-faint">/</span>
            <h1 className="min-w-0 truncate text-[15px] font-semibold tracking-tight">
              {project.name}
            </h1>
            {project.archivedAt ? (
              <Badge tone="red">
                <Archive className="size-3" />
                Archived
              </Badge>
            ) : null}
            {project.role ? (
              <Badge tone={roleTone(project.role)}>{project.role}</Badge>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {data.canReadGit ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCloneOpen(true)}
              >
                <GitBranch className="size-4" />
                Clone
              </Button>
            ) : null}
            {data.canManageSettings ? (
              <Button asChild variant="ghost" size="sm">
                <Link to={`/groups/${group.slug}/${project.slug}/settings`}>
                  <Settings className="size-4" />
                  Settings
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        <nav className="flex items-center gap-0.5 overflow-x-auto px-2">
          <NavLink to="." end className={tabClass}>
            Overview
          </NavLink>
          {data.canReadGit ? (
            <NavLink to="repository" className={tabClass}>
              Repository
            </NavLink>
          ) : null}
          <NavLink to="issues" className={tabClass}>
            <CircleDot className="size-3.5" />
            Issues
            <span className="font-mono text-[10px] text-faint">
              {data.project.openIssues}
            </span>
          </NavLink>
          <NavLink to="boards" className={tabClass}>
            Board
          </NavLink>
          <NavLink to="merge_requests" className={tabClass}>
            <GitPullRequest className="size-3.5" />
            Merge requests
            <span className="font-mono text-[10px] text-faint">
              {data.project.openMergeRequests}
            </span>
          </NavLink>
          <NavLink to="members" className={tabClass}>
            <Users className="size-3.5" />
            Members
          </NavLink>
        </nav>
      </header>

      {me.data?.artifactsFake ? (
        <p className="mx-4 mt-3 rounded-md border border-accent/25 bg-accent-soft px-3 py-2 text-[12px] text-accent-strong">
          Demo Artifacts mode. Files are generated in memory.
        </p>
      ) : null}

      {me.data &&
      !me.data.artifactsFake &&
      project.artifactsRemote?.includes("fake-artifacts.local") ? (
        <p className="mx-4 mt-3 rounded-md border border-accent/25 bg-accent-soft px-3 py-2 text-[12px] text-accent-strong">
          This repository was created in demo mode.{" "}
          <Link to="settings" className="font-medium underline">
            Re-import from settings
          </Link>{" "}
          to load the real source.
        </p>
      ) : null}

      {project.provisioningState !== "ready" ? (
        <div className="mx-4 mt-3 flex flex-col justify-between gap-3 rounded-md border border-accent/25 bg-accent-soft px-3 py-2 sm:flex-row sm:items-center">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 text-accent" />
            <div>
              <p className="text-[13px] font-medium text-accent-strong">
                {importActive
                  ? "Importing repository"
                  : latestImport?.status === "failed"
                    ? "Repository import failed"
                    : project.provisioningState === "failed"
                      ? "Repository setup failed"
                      : "Repository is being prepared"}
              </p>
              <p className="mt-0.5 text-[12px] leading-5 text-accent-strong/80">
                {importActive
                  ? `Copying ${latestImport!.externalRepo} from the provider. This page updates automatically.`
                  : latestImport?.status === "failed"
                    ? latestImport.error ||
                      "The provider import did not complete."
                    : project.provisioningError ||
                      "Creating the Cloudflare Artifacts repository."}
              </p>
              {retryError ? (
                <p className="mt-1 text-[11px] text-red">{retryError}</p>
              ) : null}
            </div>
          </div>
          {data.canManageSettings && !importActive ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
            >
              {retry.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {latestImport ? "Retry import" : "Retry setup"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {project.archivedAt ? (
        <p className="mx-4 mt-3 rounded-md border border-red/20 bg-red-soft px-3 py-2 text-[12px] text-red">
          Archived and read-only. Unarchive it from settings to make changes.
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        <Outlet context={data} />
      </div>

      <CloneDialog
        open={cloneOpen}
        onOpenChange={setCloneOpen}
        groupSlug={groupSlug}
        projectSlug={projectSlug}
        defaultBranch={project.defaultBranch}
        canWrite={data.canWriteGit}
        ready={project.provisioningState === "ready"}
      />
    </div>
  );
}
