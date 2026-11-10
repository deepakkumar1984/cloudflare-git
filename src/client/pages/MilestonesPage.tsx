import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  CircleDot,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
import { useMilestones } from "@/lib/queries";
import type { ProjectMilestone } from "@/lib/types";
import { canManageMilestones } from "@shared/permissions";
import { shortDate } from "@/lib/utils";
import { useProjectContext } from "./ProjectLayout";

export function MilestonesPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const queryClient = useQueryClient();
  const milestones = useMilestones(groupSlug, projectSlug);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectMilestone | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [state, setState] = useState<"active" | "closed">("active");
  const base = `/groups/${groupSlug}/${projectSlug}`;
  const apiBase = `/groups/${groupSlug}/projects/${projectSlug}`;
  const canManage = canManageMilestones(context.project.role);

  function openCreate() {
    setEditing(null);
    setTitle("");
    setDescription("");
    setDueDate("");
    setState("active");
    setDialogOpen(true);
  }

  function openEdit(milestone: ProjectMilestone) {
    setEditing(milestone);
    setTitle(milestone.title);
    setDescription(milestone.description);
    setDueDate(milestone.dueDate ?? "");
    setState(milestone.state);
    setDialogOpen(true);
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["milestones", groupSlug, projectSlug],
      }),
      queryClient.invalidateQueries({
        queryKey: ["issues", groupSlug, projectSlug],
      }),
    ]);
  }

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.patch(`${apiBase}/milestones/${editing.id}`, {
            title,
            description,
            dueDate: dueDate || null,
            state,
          })
        : api.post(`${apiBase}/milestones`, {
            title,
            description,
            dueDate: dueDate || null,
          }),
    onSuccess: async () => {
      toast.success(editing ? "Milestone updated" : "Milestone created");
      setDialogOpen(false);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${apiBase}/milestones/${id}`),
    onSuccess: async () => {
      toast.success("Milestone deleted");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          <Link to={`${base}/issues`} className="text-muted hover:text-ink">
            Issues
          </Link>
          <span className="mx-1.5 text-faint">/</span>
          Milestones
        </h1>
        {canManage ? (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="size-4" />
            New milestone
          </Button>
        ) : null}
      </header>

      {milestones.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((key) => (
            <div
              key={key}
              className="h-40 animate-pulse rounded-xl bg-line/30"
            />
          ))}
        </div>
      ) : (milestones.data?.milestones.length ?? 0) === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <CircleDot className="mx-auto size-6 text-faint" />
          <p className="mt-3 text-sm font-medium">No milestones yet</p>
          <p className="mt-1 text-[13px] text-muted">
            Milestones give issues a shared target date.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {milestones.data?.milestones.map((milestone) => {
            const progress = milestone.stats.total
              ? (milestone.stats.closed / milestone.stats.total) * 100
              : 0;
            return (
              <div
                key={milestone.id}
                className="rounded-xl border border-line bg-surface p-5 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-semibold">
                        {milestone.title}
                      </h2>
                      <Badge
                        tone={
                          milestone.state === "active" ? "green" : "neutral"
                        }
                      >
                        {milestone.state}
                      </Badge>
                    </div>
                    {milestone.description ? (
                      <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">
                        {milestone.description}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(milestone)}
                        aria-label={`Edit ${milestone.title}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete "${milestone.title}"? Issues keep their history but lose the milestone.`
                            )
                          ) {
                            remove.mutate(milestone.id);
                          }
                        }}
                        aria-label={`Delete ${milestone.title}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-[10px] text-faint">
                    <span>
                      {milestone.stats.closed}/{milestone.stats.total} issues
                      closed
                    </span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas">
                    <div
                      className="h-full rounded-full bg-green transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3 border-t border-line pt-3 text-[11px] text-faint">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="size-3" />
                    {milestone.dueDate
                      ? shortDate(milestone.dueDate)
                      : "No due date"}
                  </span>
                  <span>·</span>
                  <span>{milestone.stats.open} open</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit milestone" : "New milestone"}
            </DialogTitle>
            <DialogDescription>
              Issues can be assigned to one milestone at a time.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="milestone-title">Title</Label>
              <Input
                id="milestone-title"
                autoFocus
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="v1.0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="milestone-description">Description</Label>
              <Textarea
                id="milestone-description"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="milestone-due">Due date</Label>
                <Input
                  id="milestone-due"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
              {editing ? (
                <div className="space-y-1.5">
                  <Label htmlFor="milestone-state">State</Label>
                  <select
                    id="milestone-state"
                    value={state}
                    onChange={(event) =>
                      setState(event.target.value as "active" | "closed")
                    }
                    className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              ) : null}
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
                {editing ? "Save milestone" : "Create milestone"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
