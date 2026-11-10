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
    "relative flex h-11 shrink-0 items-center gap-1.5 px-3 text-[12px] font-medium text-muted transition-colors hover:text-ink",
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
    <div className="space-y-0">
      <header className="border-b border-line pb-0">
        <div className="flex flex-col justify-between gap-4 pb-5 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
              <Link
                to={`/groups/${group.slug}`}
                className="font-mono text-muted transition-colors hover:text-ink"
              >
                {group.slug}
              </Link>
              <span>/</span>
              <span className="font-mono">{project.slug}</span>
              <Lock className="ml-1 size-3" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-[36px] leading-none tracking-[-0.04em]">
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
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted">
              {project.description || "No description yet."}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
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

        <nav className="-mb-px flex items-center gap-1 overflow-x-auto">
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
        <div className="mt-5 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 text-[12px] leading-6 text-accent-strong">
          <span className="font-semibold">Demo Artifacts mode.</span> Repository
          contents are generated locally in memory. Set{" "}
          <code className="font-mono">ARTIFACTS_FAKE=false</code> and restart to
          use real source code.
        </div>
      ) : null}

      {me.data &&
      !me.data.artifactsFake &&
      project.artifactsRemote?.includes("fake-artifacts.local") ? (
        <div className="mt-5 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 text-[12px] leading-6 text-accent-strong">
          <span className="font-semibold">
            This repository came from demo mode.
          </span>{" "}
          Its contents were never fetched from the provider. Open{" "}
          <Link to="settings" className="font-medium underline">
            Project settings
          </Link>{" "}
          and re-import with a depth such as 1 to load the real source.
        </div>
      ) : null}

      {project.provisioningState !== "ready" ? (
        <div className="mt-5 flex flex-col justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 sm:flex-row sm:items-center">
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
        <div className="mt-5 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-[13px] text-red">
          This project is archived and read-only. Unarchive it from settings to
          make changes.
        </div>
      ) : null}

      <div className="pt-6">
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
