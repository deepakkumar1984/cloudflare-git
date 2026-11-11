import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  GitBranch,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { useProjectImport } from "@/lib/queries";
import { GIT_PROVIDER_LABELS } from "@shared/constants";
import type { ProjectImportSummary } from "@/lib/types";
import { useProjectContext } from "./ProjectLayout";

export function ProjectSettingsPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const data = useProjectContext();
  const queryClient = useQueryClient();
  const project = data.project;
  const projectImport = useProjectImport(groupSlug, projectSlug);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [visibility, setVisibility] = useState<"private" | "internal">(
    project.visibility
  );
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch);
  const [reimportBranch, setReimportBranch] = useState("");
  const [reimportDepth, setReimportDepth] = useState("1");

  useEffect(() => {
    const latest = projectImport.data?.import;
    if (latest) {
      setReimportDepth(latest.depth ? String(latest.depth) : "1");
    }
    // Only reset the field when the import identity changes, so polling does
    // not overwrite a depth the user is editing.
  }, [projectImport.data?.import?.id]);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setVisibility(project.visibility);
    setDefaultBranch(project.defaultBranch);
  }, [project]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["project", groupSlug, projectSlug],
      }),
      queryClient.invalidateQueries({ queryKey: ["group", groupSlug] }),
    ]);
  }

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/groups/${groupSlug}/projects/${projectSlug}`, {
        name,
        description,
        visibility,
        defaultBranch,
      }),
    onSuccess: async () => {
      toast.success("Project updated");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const archive = useMutation({
    mutationFn: () =>
      api.post(`/groups/${groupSlug}/projects/${projectSlug}/archive`),
    onSuccess: async () => {
      toast.success("Project archived");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () =>
      api.delete(`/groups/${groupSlug}/projects/${projectSlug}`),
    onSuccess: async () => {
      toast.success("Project deleted");
      await queryClient.invalidateQueries({ queryKey: ["group", groupSlug] });
      navigate(`/groups/${groupSlug}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const unarchive = useMutation({
    mutationFn: () =>
      api.post(`/groups/${groupSlug}/projects/${projectSlug}/unarchive`),
    onSuccess: async () => {
      toast.success("Project restored");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useEffect(() => {
    if (projectImport.data?.import?.status !== "ready") return;
    void queryClient.invalidateQueries({
      queryKey: ["project", groupSlug, projectSlug],
    });
    void queryClient.invalidateQueries({
      queryKey: ["repository", groupSlug, projectSlug],
    });
    // Refresh once when the import completes; the status is the trigger.
  }, [projectImport.data?.import?.status, groupSlug, projectSlug, queryClient]);

  const refreshRefs = useMutation({
    mutationFn: () =>
      api.post(
        `/groups/${groupSlug}/projects/${projectSlug}/repository/refresh`
      ),
    onSuccess: async () => {
      toast.success("Refs refreshed from Artifacts");
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: ["repository", groupSlug, projectSlug],
        }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const reimport = useMutation({
    mutationFn: () =>
      api.post<{ import: ProjectImportSummary }>(
        `/groups/${groupSlug}/projects/${projectSlug}/import/retry`,
        {
          ...(reimportBranch.trim() ? { branch: reimportBranch.trim() } : {}),
          ...(reimportDepth.trim() ? { depth: Number(reimportDepth) } : {}),
        }
      ),
    onSuccess: async () => {
      toast.success("Re-import started");
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: ["project", groupSlug, projectSlug, "import"],
        }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const imported = projectImport.data?.import ?? null;
  const importActive =
    imported?.status === "pending" || imported?.status === "importing";

  if (!data.canManageSettings) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <ShieldAlert className="mx-auto size-6 text-faint" />
        <p className="mt-4 text-sm font-semibold">Maintainer access required</p>
        <p className="mt-1 text-[13px] text-muted">
          Ask a project owner or group owner for access.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={`/groups/${groupSlug}/${projectSlug}`}>
            Back to project
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <h1 className="text-lg font-semibold tracking-tight">Project settings</h1>

      {project.archivedAt ? (
        <div className="rounded-lg border border-red/20 bg-red-soft px-4 py-3 text-[13px] text-red">
          This project is archived and read-only.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-path">Path</Label>
              <Input
                id="project-path"
                value={`${groupSlug}/${projectSlug}`}
                disabled
                className="font-mono"
              />
              <p className="text-[11px] text-faint">
                Project paths cannot be changed in this milestone.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="project-visibility">Visibility</Label>
                <select
                  id="project-visibility"
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(event.target.value as "private" | "internal")
                  }
                  className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
                >
                  <option value="private">Private</option>
                  <option
                    value="internal"
                    disabled={data.group.visibility === "private"}
                  >
                    Internal
                  </option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="default-branch">Default branch</Label>
                <div className="relative">
                  <GitBranch className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                  <Input
                    id="default-branch"
                    value={defaultBranch}
                    onChange={(event) => setDefaultBranch(event.target.value)}
                    className="pl-8 font-mono text-[13px]"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={save.isPending}>
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Repository</CardTitle>
          <Badge
            tone={project.provisioningState === "ready" ? "green" : "accent"}
          >
            {project.provisioningState}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-line bg-canvas px-3 py-2">
            <p className="text-[10px] text-faint">Remote</p>
            <code className="mt-1 block break-all font-mono text-[11px] text-muted">
              {project.artifactsRemote || "Not provisioned"}
            </code>
          </div>
          <p className="text-[12px] leading-6 text-muted">
            Repository names and storage are managed by Cloudflare Artifacts.
            Renaming the project does not move the repository.
          </p>
        </CardContent>
      </Card>

      {imported ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Provider import</CardTitle>
              <p className="mt-1 text-[12px] leading-5 text-muted">
                {GIT_PROVIDER_LABELS[imported.provider]} ·{" "}
                <span className="font-mono">{imported.externalRepo}</span>
              </p>
            </div>
            <Badge
              tone={
                imported.status === "ready"
                  ? "green"
                  : imported.status === "failed"
                    ? "red"
                    : "accent"
              }
            >
              {imported.status}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-[12px] text-muted sm:grid-cols-3">
              <div className="rounded-lg border border-line bg-canvas px-3 py-2">
                <p className="text-[10px] text-faint">Access</p>
                <p className="mt-1">
                  {imported.repositoryPrivate ? "Private" : "Public"}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-canvas px-3 py-2">
                <p className="text-[10px] text-faint">Branch</p>
                <p className="mt-1 font-mono">
                  {imported.branch || "All refs"}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-canvas px-3 py-2">
                <p className="text-[10px] text-faint">History depth</p>
                <p className="mt-1 font-mono">
                  {imported.depth ? `${imported.depth} commits` : "Full"}
                </p>
              </div>
            </div>

            {imported.error ? (
              <p className="rounded-lg border border-red-soft bg-red-soft px-3 py-2 text-[12px] leading-5 text-red">
                {imported.error}
              </p>
            ) : null}

            {importActive ? (
              <p className="flex items-center gap-2 text-[12px] text-muted">
                <Loader2 className="size-3.5 animate-spin" />
                Importing repository history. This page updates automatically.
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reimport-branch">Branch (optional)</Label>
                <Input
                  id="reimport-branch"
                  value={reimportBranch}
                  onChange={(event) => setReimportBranch(event.target.value)}
                  placeholder={imported.branch || "Provider default"}
                  className="font-mono text-[12px]"
                  disabled={importActive}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reimport-depth">History depth</Label>
                <Input
                  id="reimport-depth"
                  type="number"
                  min={1}
                  max={10_000}
                  value={reimportDepth}
                  onChange={(event) => setReimportDepth(event.target.value)}
                  placeholder="1"
                  disabled={importActive}
                />
                <p className="text-[10px] text-faint">
                  Defaults to 1. Full history can exceed the Artifacts import
                  memory limit.
                </p>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
              <p className="max-w-lg text-[12px] leading-6 text-muted">
                Re-importing replaces the repository with a fresh copy, closes
                open merge requests, revokes clone credentials, and changes the
                Git remote. Re-clone after it completes.
              </p>
              <Button
                type="button"
                variant="secondary"
                disabled={
                  reimport.isPending ||
                  importActive ||
                  !projectImport.data?.canReimport
                }
                onClick={() => {
                  void confirm({
                    title: "Re-import this repository?",
                    description:
                      "This replaces the repository with a fresh copy, closes open merge requests, revokes clone credentials, and changes the Git remote. Re-clone after it finishes.",
                    confirmLabel: "Re-import",
                    tone: "danger",
                  }).then((accepted) => {
                    if (accepted) reimport.mutate();
                  });
                }}
              >
                {reimport.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Re-import from provider
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {project.provisioningState === "ready" ? (
        <Card className="border-red/40 bg-red-soft/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red">
              <AlertTriangle className="size-4" />
              Refresh refs
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <p className="text-[13px] leading-6 text-red">
              Re-reads every branch and tag from Artifacts and rewrites the
              cached ref list. Refs that no longer exist are marked deleted, and
              open merge requests can change state. Use this only when the
              repository view is stale.
            </p>
            <Button
              variant="danger"
              className="shrink-0"
              disabled={refreshRefs.isPending}
              onClick={() => {
                void confirm({
                  title: "Refresh refs from Artifacts?",
                  description:
                    "The cached branch and tag list is rewritten. Missing refs are marked deleted, and open merge requests may change state.",
                  confirmLabel: "Refresh refs",
                  tone: "danger",
                }).then((accepted) => {
                  if (accepted) refreshRefs.mutate();
                });
              }}
            >
              {refreshRefs.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh refs
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Archive</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-[13px] leading-6 text-muted">
            Archiving makes the project read-only. The Git repository and all
            collaboration data are retained.
          </p>
          {project.archivedAt ? (
            <Button
              variant="secondary"
              onClick={() => unarchive.mutate()}
              disabled={unarchive.isPending}
            >
              {unarchive.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArchiveRestore className="size-4" />
              )}
              Restore project
            </Button>
          ) : (
            <Button
              variant="danger"
              onClick={() => {
                void confirm({
                  title: "Archive this project?",
                  description:
                    "The project becomes read-only. The Git repository and collaboration data stay.",
                  confirmLabel: "Archive project",
                  tone: "danger",
                }).then((accepted) => {
                  if (accepted) archive.mutate();
                });
              }}
              disabled={archive.isPending}
            >
              {archive.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Archive className="size-4" />
              )}
              Archive project
            </Button>
          )}
        </CardContent>
      </Card>

      {data.canArchive ? (
        <Card className="border-red/30">
          <CardHeader>
            <CardTitle className="text-red">Delete project</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <p className="text-[13px] leading-6 text-muted">
              Permanently deletes this project, its issues and merge requests,
              and the Git repository. Clone credentials stop working.
            </p>
            <Button
              variant="danger"
              className="shrink-0"
              disabled={remove.isPending}
              onClick={() => {
                void confirm({
                  title: `Delete ${project.name}?`,
                  description:
                    "This cannot be undone. The project path and the Git history stored here are removed.",
                  confirmLabel: "Delete project",
                  tone: "danger",
                  match: project.slug,
                }).then((accepted) => {
                  if (accepted) remove.mutate();
                });
              }}
            >
              {remove.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete project
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
