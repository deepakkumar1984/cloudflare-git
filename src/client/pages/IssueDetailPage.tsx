import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  CircleDot,
  Clock,
  ListChecks,
  Loader2,
  Lock,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
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
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import {
  useIssue,
  useIssueNotes,
  useLabels,
  useMe,
  useMilestones,
  useProjectMembers,
} from "@/lib/queries";
import type { Issue } from "@/lib/types";
import { canComment, canDeleteNote } from "@shared/permissions";
import { extractChecklistItems } from "@shared/markdown";
import { cn, dateTime, relativeTime, shortDate } from "@/lib/utils";
import { useProjectContext } from "./ProjectLayout";

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line px-4 py-3.5 last:border-b-0">
      <p className="mono-label mb-2">{title}</p>
      {children}
    </div>
  );
}

export function IssueDetailPage() {
  const { groupSlug = "", projectSlug = "", iid = "" } = useParams();
  const issueNumber = Number(iid);
  const context = useProjectContext();
  const me = useMe();
  const queryClient = useQueryClient();
  const issueQuery = useIssue(groupSlug, projectSlug, issueNumber);
  const notesQuery = useIssueNotes(groupSlug, projectSlug, issueNumber);
  const labelsQuery = useLabels(groupSlug, projectSlug);
  const milestonesQuery = useMilestones(groupSlug, projectSlug);
  const membersQuery = useProjectMembers(groupSlug, projectSlug);
  const issue = issueQuery.data?.issue;

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLabels, setEditLabels] = useState<string[]>([]);
  const [editAssignees, setEditAssignees] = useState<string[]>([]);
  const [editMilestone, setEditMilestone] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editConfidential, setEditConfidential] = useState(false);

  const [comment, setComment] = useState("");
  const [commentPreview, setCommentPreview] = useState(false);
  const base = `/groups/${groupSlug}/${projectSlug}`;
  const apiBase = `/groups/${groupSlug}/projects/${projectSlug}`;

  useEffect(() => {
    if (!issue) return;
    setEditTitle(issue.title);
    setEditDescription(issue.description);
    setEditLabels(issue.labels.map((label) => label.id));
    setEditAssignees(issue.assignees.map((person) => person.id));
    setEditMilestone(issue.milestone?.id ?? "");
    setEditDueDate(issue.dueDate ?? "");
    setEditConfidential(issue.confidential);
  }, [issue]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["issue", groupSlug, projectSlug, issueNumber],
      }),
      queryClient.invalidateQueries({
        queryKey: ["issues", groupSlug, projectSlug],
      }),
      queryClient.invalidateQueries({
        queryKey: ["board", groupSlug, projectSlug],
      }),
      queryClient.invalidateQueries({
        queryKey: ["project", groupSlug, projectSlug],
      }),
    ]);
  }

  const update = useMutation({
    mutationFn: () =>
      api.patch<{ issue: Issue }>(`${apiBase}/issues/${issueNumber}`, {
        title: editTitle,
        description: editDescription,
        labelIds: editLabels,
        assigneeIds: editAssignees,
        milestoneId: editMilestone || null,
        dueDate: editDueDate || null,
        confidential: editConfidential,
      }),
    onSuccess: async () => {
      toast.success("Issue updated");
      setEditOpen(false);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const setState = useMutation({
    mutationFn: (next: "close" | "reopen") =>
      api.post(`${apiBase}/issues/${issueNumber}/${next}`),
    onSuccess: async (_data, next) => {
      toast.success(next === "close" ? "Issue closed" : "Issue reopened");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleChecklist = useMutation({
    mutationFn: (index: number) =>
      api.post(`${apiBase}/issues/${issueNumber}/checklist/${index}/toggle`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["issue", groupSlug, projectSlug, issueNumber],
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const addComment = useMutation({
    mutationFn: () =>
      api.post(`${apiBase}/issues/${issueNumber}/notes`, { body: comment }),
    onSuccess: async () => {
      setComment("");
      setCommentPreview(false);
      await queryClient.invalidateQueries({
        queryKey: ["issue", groupSlug, projectSlug, issueNumber, "notes"],
      });
      toast.success("Comment added");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: string) =>
      api.delete(`${apiBase}/issues/${issueNumber}/notes/${noteId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["issue", groupSlug, projectSlug, issueNumber, "notes"],
      });
      toast.success("Comment deleted");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (issueQuery.isLoading) {
    return <div className="h-96 animate-pulse rounded-xl bg-line/30" />;
  }

  if (issueQuery.error || !issue) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
        <p className="text-sm font-semibold">Issue not found</p>
        <p className="mt-1 text-[13px] text-muted">
          It may be confidential, or the link may be wrong.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={`${base}/issues`}>Back to issues</Link>
        </Button>
      </div>
    );
  }

  const checklist = extractChecklistItems(issue.description);
  const projectMembers = [
    ...new Map(
      (membersQuery.data?.members ?? []).map((member) => [
        member.user.id,
        member.user,
      ])
    ).values(),
  ];
  const canWriteComment = canComment(context.project.role);
  const viewerCanDelete = (authorId: string | null) =>
    canDeleteNote(
      context.project.role,
      Boolean(authorId && me.data?.user.id === authorId)
    );

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    addComment.mutate();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.55fr)]">
      <div className="space-y-5">
        <div>
          <Link
            to={`${base}/issues`}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Issues
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={issue.state === "opened" ? "green" : "neutral"}>
              {issue.state === "opened" ? (
                <CircleDot className="size-3" />
              ) : (
                <CheckCircle2 className="size-3" />
              )}
              {issue.state}
            </Badge>
            <span className="font-mono text-[11px] text-faint">
              #{issue.iid}
            </span>
            {issue.confidential ? (
              <Badge tone="red">
                <Lock className="size-3" />
                Confidential
              </Badge>
            ) : null}
          </div>
          <h1 className="mt-2 text-balance text-xl font-semibold leading-snug tracking-tight">
            {issue.title}
          </h1>
          <p className="mt-2 text-[12px] text-muted">
            Opened by{" "}
            <span className="font-medium text-ink">{issue.author.name}</span>{" "}
            {relativeTime(issue.createdAt)}
            {issue.closedAt ? ` · closed ${relativeTime(issue.closedAt)}` : ""}
          </p>
        </div>

        <div className="rounded-xl border border-line bg-surface shadow-card">
          <div className="border-b border-line px-5 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              Description
            </p>
          </div>
          <div className="px-5 py-5">
            {issue.description ? (
              <Markdown>{issue.description}</Markdown>
            ) : (
              <p className="text-[13px] text-faint">No description provided.</p>
            )}
          </div>
        </div>

        {checklist.length > 0 ? (
          <div className="rounded-xl border border-line bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div className="flex items-center gap-2">
                <ListChecks className="size-3.5 text-muted" />
                <p className="text-[12px] font-medium">Checklist</p>
              </div>
              <span className="font-mono text-[10px] text-faint">
                {issue.checklist.completed}/{issue.checklist.total}
              </span>
            </div>
            <div className="h-1 bg-canvas">
              <div
                className="h-full bg-green transition-[width]"
                style={{
                  width: `${issue.checklist.total ? (issue.checklist.completed / issue.checklist.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="divide-y divide-line">
              {checklist.map((item) => (
                <label
                  key={item.index}
                  className="flex cursor-pointer items-start gap-3 px-5 py-2.5 hover:bg-canvas/50"
                >
                  <input
                    type="checkbox"
                    checked={item.completed}
                    disabled={!issue.canEdit || toggleChecklist.isPending}
                    onChange={() => toggleChecklist.mutate(item.index)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span
                    className={cn(
                      "text-[13px] leading-5",
                      item.completed && "text-faint line-through"
                    )}
                  >
                    {item.text}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <section>
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="size-4 text-muted" />
            <h2 className="text-sm font-semibold">Comments</h2>
            <span className="font-mono text-[10px] text-faint">
              {notesQuery.data?.notes.length ?? 0}
            </span>
          </div>

          <div className="space-y-4">
            {(notesQuery.data?.notes ?? []).map((note) => (
              <div
                key={note.id}
                className={cn(
                  "rounded-xl border shadow-card",
                  note.system
                    ? "border-line bg-canvas/50"
                    : "border-line bg-surface"
                )}
              >
                <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                  {note.author ? (
                    <Avatar
                      name={note.author.name}
                      src={note.author.image}
                      className="size-6"
                    />
                  ) : (
                    <span className="flex size-6 items-center justify-center rounded-full bg-canvas text-[10px] text-faint">
                      S
                    </span>
                  )}
                  <span className="text-[12px] font-medium">
                    {note.author?.name || "System"}
                  </span>
                  <span className="text-[10px] text-faint">
                    {relativeTime(note.createdAt)}
                  </span>
                  {!note.system && note.author ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label="Delete comment"
                      onClick={() => {
                        if (window.confirm("Delete this comment?")) {
                          deleteNote.mutate(note.id);
                        }
                      }}
                      disabled={!viewerCanDelete(note.author.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
                <div className="px-4 py-3">
                  {note.body ? (
                    <Markdown>{note.body}</Markdown>
                  ) : (
                    <p className="text-[12px] text-faint">Empty comment</p>
                  )}
                </div>
              </div>
            ))}
            {!notesQuery.isLoading &&
            (notesQuery.data?.notes.length ?? 0) === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12px] text-muted">
                No comments yet.
              </p>
            ) : null}
          </div>

          {canWriteComment ? (
            <form
              onSubmit={submitComment}
              className="mt-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                  Add a comment
                </span>
                <div className="flex rounded-md border border-line bg-canvas p-0.5">
                  <button
                    type="button"
                    onClick={() => setCommentPreview(false)}
                    className={cn(
                      "rounded px-2 py-1 text-[11px]",
                      !commentPreview
                        ? "bg-surface text-ink shadow-sm"
                        : "text-muted"
                    )}
                  >
                    Write
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentPreview(true)}
                    className={cn(
                      "rounded px-2 py-1 text-[11px]",
                      commentPreview
                        ? "bg-surface text-ink shadow-sm"
                        : "text-muted"
                    )}
                  >
                    Preview
                  </button>
                </div>
              </div>
              {commentPreview ? (
                <div className="min-h-28 px-4 py-3">
                  {comment ? (
                    <Markdown>{comment}</Markdown>
                  ) : (
                    <p className="text-[13px] text-faint">
                      Nothing to preview.
                    </p>
                  )}
                </div>
              ) : (
                <Textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={4}
                  maxLength={100_000}
                  placeholder="Leave a comment. Markdown is supported."
                  className="min-h-28 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
              )}
              <div className="flex items-center justify-between border-t border-line bg-canvas/40 px-4 py-2">
                <span className="text-[10px] text-faint">
                  Markdown · GFM task lists
                </span>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={addComment.isPending || !comment.trim()}
                >
                  {addComment.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  Comment
                </Button>
              </div>
            </form>
          ) : null}
        </section>
      </div>

      <aside className="h-fit overflow-hidden rounded-xl border border-line bg-surface shadow-card xl:sticky xl:top-6">
        {issue.canEdit ? (
          <div className="flex gap-2 border-b border-line p-3">
            {issue.state === "opened" ? (
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => setState.mutate("close")}
                disabled={setState.isPending}
              >
                {setState.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                Close issue
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => setState.mutate("reopen")}
                disabled={setState.isPending}
              >
                <CircleDot className="size-3.5" />
                Reopen issue
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditOpen(true)}
              aria-label="Edit issue"
            >
              <Pencil className="size-3.5" />
            </Button>
          </div>
        ) : null}

        <SidebarSection title="Labels">
          {issue.labels.length === 0 ? (
            <p className="text-[11px] text-faint">No labels</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {issue.labels.map((label) => (
                <span
                  key={label.id}
                  className="rounded-full border px-2 py-0.5 text-[10px]"
                  style={{
                    borderColor: `${label.color}55`,
                    backgroundColor: `${label.color}14`,
                    color: label.color,
                  }}
                >
                  {label.title}
                </span>
              ))}
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Assignees">
          {issue.assignees.length === 0 ? (
            <p className="text-[11px] text-faint">Unassigned</p>
          ) : (
            <div className="space-y-2">
              {issue.assignees.map((person) => (
                <div key={person.id} className="flex items-center gap-2">
                  <Avatar
                    name={person.name}
                    src={person.image}
                    className="size-6"
                  />
                  <span className="truncate text-[12px]">{person.name}</span>
                </div>
              ))}
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Milestone">
          {issue.milestone ? (
            <div className="flex items-center gap-2 text-[12px]">
              <Clock className="size-3.5 text-muted" />
              {issue.milestone.title}
            </div>
          ) : (
            <p className="text-[11px] text-faint">No milestone</p>
          )}
        </SidebarSection>

        <SidebarSection title="Due date">
          {issue.dueDate ? (
            <div className="flex items-center gap-2 text-[12px]">
              <Calendar className="size-3.5 text-muted" />
              {shortDate(issue.dueDate)}
            </div>
          ) : (
            <p className="text-[11px] text-faint">No due date</p>
          )}
        </SidebarSection>

        <SidebarSection title="Details">
          <dl className="space-y-2 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="text-faint">Created</dt>
              <dd>{dateTime(issue.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-faint">Updated</dt>
              <dd>{relativeTime(issue.updatedAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-faint">Reference</dt>
              <dd className="font-mono">#{issue.iid}</dd>
            </div>
          </dl>
        </SidebarSection>
      </aside>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit issue</DialogTitle>
            <DialogDescription>
              Changes are saved immediately and appear in project activity.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={8}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-milestone">Milestone</Label>
                <select
                  id="edit-milestone"
                  value={editMilestone}
                  onChange={(event) => setEditMilestone(event.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
                >
                  <option value="">None</option>
                  {(milestonesQuery.data?.milestones ?? []).map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-due">Due date</Label>
                <Input
                  id="edit-due"
                  type="date"
                  value={editDueDate}
                  onChange={(event) => setEditDueDate(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Labels</Label>
              <div className="flex flex-wrap gap-1.5">
                {(labelsQuery.data?.labels ?? []).map((label) => {
                  const selected = editLabels.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() =>
                        setEditLabels((current) =>
                          selected
                            ? current.filter((id) => id !== label.id)
                            : [...current, label.id]
                        )
                      }
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px]",
                        selected
                          ? "border-accent bg-accent-soft text-accent-strong"
                          : "border-line text-muted"
                      )}
                    >
                      {label.title}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Assignees</Label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                {projectMembers.map((member) => {
                  const selected = editAssignees.includes(member.id);
                  return (
                    <label
                      key={member.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] hover:bg-canvas"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setEditAssignees((current) =>
                            selected
                              ? current.filter((id) => id !== member.id)
                              : [...current, member.id]
                          )
                        }
                        className="accent-[var(--accent)]"
                      />
                      {member.name}
                    </label>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={editConfidential}
                onChange={(event) => setEditConfidential(event.target.checked)}
                className="accent-[var(--accent)]"
              />
              Confidential
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={update.isPending}
              >
                {update.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
