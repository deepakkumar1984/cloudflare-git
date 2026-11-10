import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { useLabels } from "@/lib/queries";
import type { ProjectLabel } from "@/lib/types";
import { canManageLabels } from "@shared/permissions";
import { useProjectContext } from "./ProjectLayout";

export function LabelsPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const queryClient = useQueryClient();
  const labels = useLabels(groupSlug, projectSlug);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectLabel | null>(null);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#bd5d18");
  const [description, setDescription] = useState("");
  const base = `/groups/${groupSlug}/${projectSlug}`;
  const apiBase = `/groups/${groupSlug}/projects/${projectSlug}`;
  const canManage = canManageLabels(context.project.role);

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ["labels", groupSlug, projectSlug],
    });
  }

  function openCreate() {
    setEditing(null);
    setTitle("");
    setColor("#bd5d18");
    setDescription("");
    setDialogOpen(true);
  }

  function openEdit(label: ProjectLabel) {
    setEditing(label);
    setTitle(label.title);
    setColor(label.color);
    setDescription(label.description);
    setDialogOpen(true);
  }

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.patch(`${apiBase}/labels/${editing.id}`, {
            title,
            color,
            description,
          })
        : api.post(`${apiBase}/labels`, { title, color, description }),
    onSuccess: async () => {
      toast.success(editing ? "Label updated" : "Label created");
      setDialogOpen(false);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${apiBase}/labels/${id}`),
    onSuccess: async () => {
      toast.success("Label deleted");
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: ["board", groupSlug, projectSlug],
        }),
        queryClient.invalidateQueries({
          queryKey: ["issues", groupSlug, projectSlug],
        }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link
            to={`${base}/issues`}
            className="font-mono text-[11px] text-muted hover:text-ink"
          >
            Issues
          </Link>
          <h1 className="mt-2 font-display text-[34px] leading-none tracking-[-0.04em]">
            Labels
          </h1>
          <p className="mt-2 text-sm text-muted">
            Labels organize issues and can back board columns.
          </p>
        </div>
        {canManage ? (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="size-4" />
            New label
          </Button>
        ) : null}
      </header>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {labels.isLoading ? (
          <div className="divide-y divide-line">
            {[1, 2, 3].map((key) => (
              <div key={key} className="h-16 animate-pulse bg-line/15" />
            ))}
          </div>
        ) : (labels.data?.labels.length ?? 0) === 0 ? (
          <div className="px-5 py-16 text-center">
            <Tag className="mx-auto size-6 text-faint" />
            <p className="mt-3 text-sm font-medium">No labels yet</p>
            <p className="mt-1 text-[13px] text-muted">
              Labels make issues easier to scan and boards easier to arrange.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {labels.data?.labels.map((label) => (
              <div
                key={label.id}
                className="flex items-center gap-3 px-5 py-3.5"
              >
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">
                      {label.title}
                    </span>
                    <Badge tone="outline">{label.openIssues} open</Badge>
                  </div>
                  {label.description ? (
                    <p className="mt-0.5 truncate text-[11px] text-faint">
                      {label.description}
                    </p>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(label)}
                      aria-label={`Edit ${label.title}`}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete "${label.title}"? It will be removed from issues and board columns.`
                          )
                        ) {
                          remove.mutate(label.id);
                        }
                      }}
                      aria-label={`Delete ${label.title}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit label" : "New label"}</DialogTitle>
            <DialogDescription>
              Keep names short. The color is used in issue lists and boards.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_90px]">
              <div className="space-y-1.5">
                <Label htmlFor="label-name">Name</Label>
                <Input
                  id="label-name"
                  autoFocus
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="needs-review"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="label-color">Color</Label>
                <input
                  id="label-color"
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface p-1"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label-description">Description</Label>
              <Textarea
                id="label-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2">
              <span
                className="rounded-full px-2 py-0.5 text-[11px]"
                style={{ backgroundColor: `${color}18`, color }}
              >
                {title || "label preview"}
              </span>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={save.isPending || !title.trim()}
              >
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {editing ? "Save label" : "Create label"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
