import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
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
import { useConfirm } from "@/components/ConfirmDialog";
import { api, errorMessage } from "@/lib/api";
import { useBoard, useLabels } from "@/lib/queries";
import type { BoardIssue, BoardList } from "@/lib/types";
import { canCreateIssue } from "@shared/permissions";
import { cn, relativeTime } from "@/lib/utils";
import { useProjectContext } from "./ProjectLayout";

function Card({
  issue,
  groupSlug,
  projectSlug,
  draggable,
  onDragStart,
}: {
  issue: BoardIssue;
  groupSlug: string;
  projectSlug: string;
  draggable: boolean;
  onDragStart: (issue: BoardIssue) => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", issue.id);
        onDragStart(issue);
      }}
      className="group rounded-lg border border-line bg-surface p-3 shadow-sm transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-card"
    >
      <div className="flex items-start gap-2">
        <GripVertical
          className={cn(
            "mt-0.5 size-3.5 shrink-0 text-faint",
            draggable ? "cursor-grab opacity-60" : "opacity-0"
          )}
        />
        <div className="min-w-0 flex-1">
          <Link
            to={`/groups/${groupSlug}/${projectSlug}/issues/${issue.iid}`}
            className="line-clamp-2 text-[12px] font-medium leading-5 text-ink hover:text-accent"
          >
            {issue.title}
          </Link>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {issue.labels.slice(0, 3).map((label) => (
              <span
                key={label.id}
                className="rounded-full px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: `${label.color}18`,
                  color: label.color,
                }}
              >
                {label.title}
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex -space-x-1">
              {issue.assignees.slice(0, 3).map((person) => (
                <Avatar
                  key={person.id}
                  name={person.name}
                  src={person.image}
                  className="size-5 border-2 border-surface"
                />
              ))}
            </div>
            <span className="text-[10px] text-faint">
              #{issue.iid} · {relativeTime(issue.updatedAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BoardPage() {
  const confirm = useConfirm();
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const queryClient = useQueryClient();
  const board = useBoard(groupSlug, projectSlug);
  const labels = useLabels(groupSlug, projectSlug);
  const [dragging, setDragging] = useState<BoardIssue | null>(null);
  const [overList, setOverList] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [columnName, setColumnName] = useState("");
  const [columnLabel, setColumnLabel] = useState("");
  const base = `/groups/${groupSlug}/${projectSlug}`;
  const apiBase = `/groups/${groupSlug}/projects/${projectSlug}`;
  const canMove = canCreateIssue(context.project.role);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["board", groupSlug, projectSlug],
      }),
      queryClient.invalidateQueries({
        queryKey: ["issues", groupSlug, projectSlug],
      }),
    ]);
  }

  const move = useMutation({
    mutationFn: ({ iid, boardListId }: { iid: number; boardListId: string }) =>
      api.post(`${apiBase}/issues/${iid}/move`, { boardListId }),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const addColumn = useMutation({
    mutationFn: () =>
      api.post(`${apiBase}/boards/lists`, {
        name: columnName,
        labelId: columnLabel,
      }),
    onSuccess: async () => {
      toast.success("Board column created");
      setAddOpen(false);
      setColumnName("");
      setColumnLabel("");
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: ["labels", groupSlug, projectSlug],
        }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeColumn = useMutation({
    mutationFn: (listId: string) =>
      api.delete(`${apiBase}/boards/lists/${listId}`),
    onSuccess: async () => {
      toast.success("Board column removed");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (board.isLoading) {
    return <div className="h-80 animate-pulse rounded-xl bg-line/30" />;
  }

  if (board.error || !board.data) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
        <p className="text-sm font-semibold">Could not load the board</p>
      </div>
    );
  }

  const usedLabels = new Set(board.data.lists.map((list) => list.label.id));
  const availableLabels = (labels.data?.labels ?? []).filter(
    (label) => !usedLabels.has(label.id)
  );

  function drop(list: BoardList) {
    if (!dragging) return;
    if (list.issues.some((issue) => issue.id === dragging.id)) return;
    move.mutate({ iid: dragging.iid, boardListId: list.id });
    setDragging(null);
    setOverList(null);
  }

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">Board</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to={`${base}/issues`}>List view</Link>
          </Button>
          {canMove ? (
            <Button asChild variant="secondary" size="sm">
              <Link to={`${base}/issues/new`}>
                <Plus className="size-4" />
                New issue
              </Link>
            </Button>
          ) : null}
          {board.data.canManage ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="size-4" />
              Column
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-auto pb-2">
        <div className="flex h-full min-h-[24rem] gap-3">
          {board.data.lists.map((list) => (
            <div
              key={list.id}
              onDragOver={(event) => {
                event.preventDefault();
                setOverList(list.id);
              }}
              onDragLeave={() => setOverList(null)}
              onDrop={(event) => {
                event.preventDefault();
                drop(list);
              }}
              className={cn(
                "flex w-[290px] shrink-0 flex-col rounded-xl border bg-canvas/40 transition-colors",
                overList === list.id
                  ? "border-accent/40 bg-accent-soft/40"
                  : "border-line"
              )}
            >
              <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: list.label.color }}
                />
                <span className="text-[12px] font-semibold">{list.name}</span>
                <Badge tone="outline" className="ml-auto">
                  {list.issues.length}
                </Badge>
                {board.data.canManage ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${list.name} column`}
                    onClick={() => {
                      void confirm({
                        title: `Remove the ${list.name} column?`,
                        description:
                          "Issues stay in the project. They leave this column.",
                        confirmLabel: "Remove column",
                        tone: "danger",
                      }).then((accepted) => {
                        if (accepted) removeColumn.mutate(list.id);
                      });
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                ) : null}
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
                {list.issues.map((issue) => (
                  <Card
                    key={issue.id}
                    issue={issue}
                    groupSlug={groupSlug}
                    projectSlug={projectSlug}
                    draggable={canMove}
                    onDragStart={setDragging}
                  />
                ))}
                {list.issues.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-[11px] text-faint">
                    Drop an issue here
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {board.data.unlisted.length > 0 ? (
            <div className="flex w-[290px] shrink-0 flex-col rounded-xl border border-dashed border-line bg-surface/40">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <span className="size-2.5 rounded-full bg-faint" />
                <span className="text-[12px] font-semibold">No column</span>
                <Badge tone="outline" className="ml-auto">
                  {board.data.unlisted.length}
                </Badge>
              </div>
              <div className="flex-1 space-y-2 p-2.5">
                {board.data.unlisted.map((issue) => (
                  <Card
                    key={issue.id}
                    issue={issue}
                    groupSlug={groupSlug}
                    projectSlug={projectSlug}
                    draggable={false}
                    onDragStart={setDragging}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a board column</DialogTitle>
            <DialogDescription>
              A column is backed by a label. Moving a card swaps the board
              labels on the issue.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addColumn.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="column-name">Column name</Label>
              <Input
                id="column-name"
                value={columnName}
                onChange={(event) => setColumnName(event.target.value)}
                placeholder="Review"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="column-label">Label</Label>
              <select
                id="column-label"
                value={columnLabel}
                onChange={(event) => setColumnLabel(event.target.value)}
                className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
                required
              >
                <option value="">Choose a label</option>
                {availableLabels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.title}
                  </option>
                ))}
              </select>
              {availableLabels.length === 0 ? (
                <p className="text-[11px] text-faint">
                  Every label already has a column. Create a label first.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={addColumn.isPending || !columnName || !columnLabel}
              >
                {addColumn.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Add column
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
