import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock,
  Copy,
  FileDiff,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { Markdown } from "@/components/Markdown";
import { useAppName } from "@/lib/meta";
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
  useMe,
  useMergeRequest,
  useMergeRequestCommits,
  useMergeRequestDiff,
  useMergeRequestNotes,
  useMergeRequestPatch,
  useMilestones,
  useProjectMembers,
  useRepository,
} from "@/lib/queries";
import type {
  MergeRequest,
  MergeRequestChangedFile,
  MergeRequestFilePatch,
  MergeRequestResponse,
} from "@/lib/types";
import { canComment, canDeleteNote } from "@shared/permissions";
import { cn, copyText, dateTime, relativeTime } from "@/lib/utils";
import { useProjectContext } from "./ProjectLayout";

type Tab = "overview" | "commits" | "changes";

const detectionLabels: Record<MergeRequest["mergeDetection"], string | null> = {
  none: null,
  fast_forward: "Fast-forward merge",
  merge_commit: "Merge commit",
  heuristic: "Heuristic merge detection",
  manual: "Marked merged manually",
};

const statusLetter: Record<MergeRequestChangedFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

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

function StateBadge({ mr }: { mr: MergeRequest }) {
  if (mr.state === "merged") {
    return (
      <Badge tone="accent">
        <GitMerge className="size-3" />
        Merged
      </Badge>
    );
  }
  if (mr.state === "closed") {
    return (
      <Badge tone="red">
        <XCircle className="size-3" />
        Closed
      </Badge>
    );
  }
  return (
    <Badge tone="green">
      <CircleDot className="size-3" />
      Open
    </Badge>
  );
}

function reviewerTone(state: string): "green" | "red" | "neutral" {
  if (state === "approved") return "green";
  if (state === "changes_requested") return "red";
  return "neutral";
}

function reviewerLabel(state: string): string {
  if (state === "approved") return "Approved";
  if (state === "changes_requested") return "Changes requested";
  return "Pending";
}

function FilePatchView({ patch }: { patch: MergeRequestFilePatch }) {
  if (patch.binary) {
    return (
      <div className="rounded-xl border border-line bg-surface px-5 py-10 text-center">
        <FileDiff className="mx-auto size-5 text-faint" />
        <p className="mt-2 text-[13px] font-medium">Binary file</p>
        <p className="mt-1 text-[11px] text-muted">
          Binary patches are not rendered in the browser.
        </p>
      </div>
    );
  }
  if (patch.tooLarge) {
    return (
      <div className="rounded-xl border border-line bg-surface px-5 py-10 text-center">
        <AlertTriangle className="mx-auto size-5 text-accent" />
        <p className="mt-2 text-[13px] font-medium">
          File is too large to display
        </p>
        <p className="mt-1 text-[11px] text-muted">
          Open the file in your local checkout to review it.
        </p>
      </div>
    );
  }
  if (patch.hunks.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface px-5 py-10 text-center">
        <p className="text-[13px] text-muted">No textual changes to show.</p>
      </div>
    );
  }

  return (
    <div className="diff-view">
      {patch.hunks.map((hunk, hunkIndex) => {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        return (
          <div key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
            <div className="diff-line bg-canvas px-3 py-1 text-[11px] text-faint">
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
              {hunk.newLines} @@
            </div>
            {hunk.lines.map((line, lineIndex) => {
              const prefix = line[0];
              const content = line.slice(1);
              const oldNumber =
                prefix === "+" || prefix === "\\" ? "" : oldLine;
              const newNumber =
                prefix === "-" || prefix === "\\" ? "" : newLine;
              if (prefix === "+") newLine += 1;
              else if (prefix === "-") oldLine += 1;
              else if (prefix === " ") {
                oldLine += 1;
                newLine += 1;
              }
              return (
                <div
                  key={lineIndex}
                  className={cn(
                    "diff-line",
                    prefix === "+" && "diff-line-add",
                    prefix === "-" && "diff-line-del",
                    prefix === "\\" && "text-faint"
                  )}
                >
                  <span className="diff-gutter">{oldNumber}</span>
                  <span className="diff-gutter">{newNumber}</span>
                  <span className="diff-code">
                    {prefix}
                    {content}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function MergeRequestDetailPage() {
  const confirm = useConfirm();
  const { groupSlug = "", projectSlug = "", iid = "" } = useParams();
  const iidNumber = Number(iid);
  const context = useProjectContext();
  const me = useMe();
  const appName = useAppName();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: Tab =
    rawTab === "commits" || rawTab === "changes" ? rawTab : "overview";
  const base = `/groups/${groupSlug}/${projectSlug}`;
  const apiBase = `/groups/${groupSlug}/projects/${projectSlug}`;

  const mrQuery = useMergeRequest(groupSlug, projectSlug, iidNumber);
  const mr = mrQuery.data?.mergeRequest;
  const notesQuery = useMergeRequestNotes(groupSlug, projectSlug, iidNumber);
  const diffQuery = useMergeRequestDiff(
    groupSlug,
    projectSlug,
    iidNumber,
    tab === "changes"
  );
  const commitsQuery = useMergeRequestCommits(
    groupSlug,
    projectSlug,
    iidNumber,
    tab === "commits"
  );
  const repository = useRepository(groupSlug, projectSlug);
  const milestones = useMilestones(groupSlug, projectSlug);
  const members = useProjectMembers(groupSlug, projectSlug);

  const files = diffQuery.data?.files ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedFile =
    files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const patchQuery = useMergeRequestPatch(
    groupSlug,
    projectSlug,
    iidNumber,
    selectedFile
  );

  const [comment, setComment] = useState("");
  const [commentPreview, setCommentPreview] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editReviewers, setEditReviewers] = useState<string[]>([]);
  const [editAssignees, setEditAssignees] = useState<string[]>([]);
  const [editMilestone, setEditMilestone] = useState("");

  async function refreshReview() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["merge_request", groupSlug, projectSlug, iidNumber],
      }),
      queryClient.invalidateQueries({
        queryKey: ["merge_requests", groupSlug, projectSlug],
      }),
      queryClient.invalidateQueries({
        queryKey: ["project", groupSlug, projectSlug],
      }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  }

  const review = useMutation({
    mutationFn: (state: "approved" | "changes_requested") =>
      api.post<MergeRequestResponse>(
        `${apiBase}/merge_requests/${iidNumber}/review`,
        { state }
      ),
    onSuccess: async (_response, state) => {
      toast.success(
        state === "approved" ? "Review approved" : "Changes requested"
      );
      await refreshReview();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const setState = useMutation({
    mutationFn: (next: "close" | "reopen") =>
      api.post<MergeRequestResponse>(
        `${apiBase}/merge_requests/${iidNumber}/${next}`
      ),
    onSuccess: async (_response, next) => {
      toast.success(
        next === "close" ? "Merge request closed" : "Merge request reopened"
      );
      await refreshReview();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const markMerged = useMutation({
    mutationFn: () =>
      api.post<MergeRequestResponse>(
        `${apiBase}/merge_requests/${iidNumber}/mark_merged`
      ),
    onSuccess: async () => {
      toast.success("Marked as merged");
      await Promise.all([
        refreshReview(),
        queryClient.invalidateQueries({
          queryKey: [
            "merge_request",
            groupSlug,
            projectSlug,
            iidNumber,
            "notes",
          ],
        }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const addComment = useMutation({
    mutationFn: () =>
      api.post(`${apiBase}/merge_requests/${iidNumber}/notes`, {
        body: comment,
      }),
    onSuccess: async () => {
      setComment("");
      setCommentPreview(false);
      await queryClient.invalidateQueries({
        queryKey: ["merge_request", groupSlug, projectSlug, iidNumber, "notes"],
      });
      toast.success("Comment added");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: string) =>
      api.delete(`${apiBase}/merge_requests/${iidNumber}/notes/${noteId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["merge_request", groupSlug, projectSlug, iidNumber, "notes"],
      });
      toast.success("Comment deleted");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = useMutation({
    mutationFn: () =>
      api.patch<MergeRequestResponse>(
        `${apiBase}/merge_requests/${iidNumber}`,
        {
          title: editTitle,
          description: editDescription,
          targetBranch: editTarget,
          reviewerIds: editReviewers,
          assigneeIds: editAssignees,
          milestoneId: editMilestone || null,
        }
      ),
    onSuccess: async () => {
      toast.success("Merge request updated");
      setEditOpen(false);
      await Promise.all([
        refreshReview(),
        queryClient.invalidateQueries({
          queryKey: [
            "merge_request",
            groupSlug,
            projectSlug,
            iidNumber,
            "diff",
          ],
        }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function setTab(next: Tab) {
    if (next === "overview") setSearchParams({});
    else setSearchParams({ tab: next });
  }

  function openEdit() {
    if (!mr) return;
    setEditTitle(mr.title);
    setEditDescription(mr.description);
    setEditTarget(mr.targetBranch);
    setEditReviewers(mr.reviewers.map((reviewer) => reviewer.id));
    setEditAssignees(mr.assignees.map((person) => person.id));
    setEditMilestone(mr.milestone?.id ?? "");
    setEditOpen(true);
  }

  if (mrQuery.isLoading) {
    return <div className="h-96 animate-pulse rounded-xl bg-line/30" />;
  }

  if (mrQuery.error || !mr) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
        <GitPullRequest className="mx-auto size-7 text-faint" />
        <p className="mt-3 text-sm font-semibold">Merge request not found</p>
        <p className="mt-1 text-[13px] text-muted">
          The link may be wrong, or you may not have access.
        </p>
        <Button asChild variant="secondary" size="sm" className="mt-4">
          <Link to={`${base}/merge_requests`}>Back to merge requests</Link>
        </Button>
      </div>
    );
  }

  const viewerReview = mr.reviewers.find(
    (reviewer) => reviewer.id === me.data?.user.id
  );
  const canWriteComment = canComment(context.project.role);
  const mergeCommands = [
    "git fetch origin",
    `git checkout ${mr.targetBranch}`,
    `git merge --no-ff origin/${mr.sourceBranch}`,
    `git push origin ${mr.targetBranch}`,
  ].join("\n");

  return (
    <div className="space-y-5">
      <div>
        <Link
          to={`${base}/merge_requests`}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Merge requests
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StateBadge mr={mr} />
          <span className="font-mono text-[11px] text-faint">!{mr.iid}</span>
          {mr.draft ? <Badge tone="neutral">Draft</Badge> : null}
          {detectionLabels[mr.mergeDetection] ? (
            <Badge tone="outline">{detectionLabels[mr.mergeDetection]}</Badge>
          ) : null}
          {!mr.sourceBranchExists && mr.state === "opened" ? (
            <Badge tone="red">Source branch deleted</Badge>
          ) : null}
        </div>
        <h1 className="mt-2 text-balance text-xl font-semibold leading-snug tracking-tight">
          {mr.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <Avatar
              name={mr.author.name}
              src={mr.author.image}
              className="size-5"
            />
            <span className="font-medium text-ink">{mr.author.name}</span>
          </span>
          <span>wants to merge</span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-0.5 font-mono text-[11px]">
            <GitBranch className="size-3" />
            {mr.sourceBranch}
            <ArrowRight className="size-3 text-faint" />
            {mr.targetBranch}
          </span>
          <span>opened {relativeTime(mr.createdAt)}</span>
        </div>
      </div>

      <div className="flex gap-1 border-b border-line">
        {(
          [
            ["overview", "Overview", MessageSquare],
            ["commits", "Commits", GitCommit],
            ["changes", "Changes", FileDiff],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "relative flex h-10 items-center gap-1.5 px-3 text-[12px] font-medium text-muted transition-colors hover:text-ink",
              tab === value &&
                "text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent"
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {value === "commits" && commitsQuery.data ? (
              <span className="font-mono text-[10px] text-faint">
                {commitsQuery.data.commits.length}
              </span>
            ) : null}
            {value === "changes" && diffQuery.data ? (
              <span className="font-mono text-[10px] text-faint">
                {diffQuery.data.files.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.55fr)]">
        <div className="min-w-0 space-y-5">
          {tab === "overview" ? (
            <>
              <div className="rounded-xl border border-line bg-surface shadow-card">
                <div className="border-b border-line px-5 py-3">
                  <p className="mono-label">Description</p>
                </div>
                <div className="px-5 py-5">
                  {mr.description ? (
                    <Markdown>{mr.description}</Markdown>
                  ) : (
                    <p className="text-[13px] text-faint">
                      No description provided.
                    </p>
                  )}
                </div>
              </div>

              <section>
                <div className="mb-3 flex items-center gap-2">
                  <MessageSquare className="size-4 text-muted" />
                  <h2 className="text-sm font-semibold">Discussion</h2>
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
                            disabled={
                              !canDeleteNote(
                                context.project.role,
                                me.data?.user.id === note.author.id
                              )
                            }
                            onClick={() => {
                              void confirm({
                                title: "Delete this comment?",
                                description:
                                  "The comment is removed from the merge request.",
                                confirmLabel: "Delete comment",
                                tone: "danger",
                              }).then((accepted) => {
                                if (accepted) deleteNote.mutate(note.id);
                              });
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                      <div className="px-4 py-3">
                        <Markdown>{note.body}</Markdown>
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
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault();
                      if (comment.trim()) addComment.mutate();
                    }}
                    className="mt-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card"
                  >
                    <div className="flex items-center justify-between border-b border-line px-4 py-2">
                      <span className="mono-label">Review discussion</span>
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
                        placeholder="Discuss the change. Markdown is supported."
                        className="min-h-28 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                      />
                    )}
                    <div className="flex items-center justify-between border-t border-line bg-canvas/40 px-4 py-2">
                      <span className="text-[10px] text-faint">
                        Markdown · task lists supported
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
            </>
          ) : null}

          {tab === "commits" ? (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              {commitsQuery.isLoading ? (
                <div className="divide-y divide-line">
                  {[1, 2, 3].map((key) => (
                    <div key={key} className="h-16 animate-pulse bg-line/15" />
                  ))}
                </div>
              ) : commitsQuery.error ? (
                <p className="px-5 py-16 text-center text-[13px] text-muted">
                  Could not load commits.
                </p>
              ) : (commitsQuery.data?.commits.length ?? 0) === 0 ? (
                <div className="px-5 py-16 text-center">
                  <GitCommit className="mx-auto size-6 text-faint" />
                  <p className="mt-3 text-sm font-medium">No commits ahead</p>
                  <p className="mt-1 text-[13px] text-muted">
                    Push the source branch to make commits available here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {commitsQuery.data?.commits.map((commit) => (
                    <div
                      key={commit.hash}
                      className="flex items-start gap-3 px-4 py-3.5"
                    >
                      <GitCommit className="mt-0.5 size-4 shrink-0 text-faint" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[13px] font-medium">
                          {commit.message.split("\n")[0]}
                        </p>
                        <p className="mt-0.5 text-[11px] text-faint">
                          {commit.author.name} ·{" "}
                          {relativeTime(commit.committedAt)}
                        </p>
                      </div>
                      <Link
                        to={`${base}/repository/commits/${commit.hash}`}
                        className="shrink-0 rounded-md border border-line px-2 py-1 font-mono text-[10px] text-muted hover:text-ink"
                      >
                        {commit.hash.slice(0, 8)}
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {tab === "changes" ? (
            <div className="space-y-4">
              {diffQuery.data?.baseOutdated ? (
                <div className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2.5 text-[12px] text-accent-strong">
                  <AlertTriangle className="mt-0.5 size-3.5" />
                  The comparison base may be outdated. The app compares from the
                  target branch tip when a merge base is not available.
                </div>
              ) : null}
              {diffQuery.data?.truncated ? (
                <div className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2.5 text-[12px] text-accent-strong">
                  <AlertTriangle className="mt-0.5 size-3.5" />
                  This diff is truncated. Only the first changed files are
                  shown.
                </div>
              ) : null}

              {diffQuery.isLoading ? (
                <div className="h-80 animate-pulse rounded-xl bg-line/30" />
              ) : diffQuery.error ? (
                <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
                  <p className="text-sm font-semibold">
                    Could not compute the diff
                  </p>
                  <p className="mt-1 text-[13px] text-muted">
                    The source branch may have been deleted or not synced yet.
                  </p>
                </div>
              ) : files.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
                  <FileDiff className="mx-auto size-6 text-faint" />
                  <p className="mt-3 text-sm font-medium">No changed files</p>
                  <p className="mt-1 text-[13px] text-muted">
                    The source branch matches its merge base.
                  </p>
                </div>
              ) : (
                <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(200px,0.55fr)_minmax(0,1.45fr)]">
                  <div className="h-fit overflow-hidden rounded-xl border border-line bg-surface shadow-card lg:sticky lg:top-6">
                    <div className="border-b border-line px-3 py-2">
                      <p className="mono-label">
                        {files.length} changed file
                        {files.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="max-h-[65vh] overflow-y-auto p-1.5">
                      {files.map((file) => {
                        const active = selectedFile?.path === file.path;
                        return (
                          <button
                            key={`${file.oldPath}-${file.path}`}
                            type="button"
                            onClick={() => setSelectedPath(file.path)}
                            className={cn(
                              "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                              active
                                ? "bg-accent-soft text-accent-strong"
                                : "text-muted hover:bg-canvas hover:text-ink"
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 font-mono text-[10px] font-semibold",
                                file.status === "added" && "text-green",
                                file.status === "deleted" && "text-red",
                                file.status === "renamed" && "text-blue",
                                file.status === "modified" && "text-accent"
                              )}
                            >
                              {statusLetter[file.status]}
                            </span>
                            <span className="min-w-0 break-all font-mono text-[11px] leading-4">
                              {file.oldPath && file.oldPath !== file.path ? (
                                <>
                                  <span className="text-faint">
                                    {file.oldPath} →{" "}
                                  </span>
                                  {file.path}
                                </>
                              ) : (
                                file.path
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="min-w-0">
                    {selectedFile ? (
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-all font-mono text-[12px] font-medium">
                            {selectedFile.path}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-faint">
                            {selectedFile.status}
                          </p>
                        </div>
                        {patchQuery.data ? (
                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <span className="text-green">
                              +{patchQuery.data.patch.additions}
                            </span>
                            <span className="text-red">
                              −{patchQuery.data.patch.deletions}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {patchQuery.isLoading ? (
                      <div className="h-64 animate-pulse rounded-xl bg-line/30" />
                    ) : patchQuery.error ? (
                      <div className="rounded-xl border border-dashed border-line px-5 py-12 text-center text-[13px] text-muted">
                        {errorMessage(patchQuery.error)}
                      </div>
                    ) : patchQuery.data ? (
                      <FilePatchView patch={patchQuery.data.patch} />
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <aside className="h-fit space-y-4 xl:sticky xl:top-6">
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            {mr.state === "opened" ? (
              <div className="space-y-3 border-b border-line p-3">
                {mr.canReview ? (
                  <>
                    <div className="flex gap-2">
                      <Button
                        variant={
                          viewerReview?.state === "approved"
                            ? "secondary"
                            : "primary"
                        }
                        size="sm"
                        className="flex-1"
                        disabled={review.isPending}
                        onClick={() => review.mutate("approved")}
                      >
                        {review.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-3.5" />
                        )}
                        {viewerReview?.state === "approved"
                          ? "Approved"
                          : "Approve"}
                      </Button>
                      <Button
                        variant={
                          viewerReview?.state === "changes_requested"
                            ? "danger"
                            : "secondary"
                        }
                        size="sm"
                        className="flex-1"
                        disabled={review.isPending}
                        onClick={() => review.mutate("changes_requested")}
                      >
                        <XCircle className="size-3.5" />
                        Request changes
                      </Button>
                    </div>
                    <p className="text-[10px] text-faint">
                      Your review:{" "}
                      <span className="font-medium text-muted">
                        {viewerReview
                          ? reviewerLabel(viewerReview.state)
                          : "not submitted"}
                      </span>
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] leading-5 text-muted">
                    {mr.author.id === me.data?.user.id
                      ? "You cannot review your own merge request."
                      : "Developer access is required to review."}
                  </p>
                )}
              </div>
            ) : null}

            <div className="flex gap-2 border-b border-line p-3">
              {mr.canEdit ? (
                <>
                  {mr.state === "opened" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      disabled={setState.isPending}
                      onClick={() => setState.mutate("close")}
                    >
                      <XCircle className="size-3.5" />
                      Close
                    </Button>
                  ) : mr.state === "closed" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      disabled={setState.isPending}
                      onClick={() => setState.mutate("reopen")}
                    >
                      <CircleDot className="size-3.5" />
                      Reopen
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={openEdit}
                    aria-label="Edit merge request"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </>
              ) : null}
              {mr.canMarkMerged ? (
                <Button
                  variant={mr.state === "opened" ? "primary" : "secondary"}
                  size="sm"
                  className="flex-1"
                  disabled={markMerged.isPending}
                  onClick={() => {
                    void confirm({
                      title: "Mark this merge request as merged?",
                      description:
                        "Use this after the change has been merged and pushed locally. The app does not merge the branches itself.",
                      confirmLabel: "Mark merged",
                    }).then((accepted) => {
                      if (accepted) markMerged.mutate();
                    });
                  }}
                >
                  {markMerged.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <GitMerge className="size-3.5" />
                  )}
                  Mark merged
                </Button>
              ) : null}
            </div>

            {mr.state === "opened" ? (
              <div className="border-b border-line p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="mono-label">Merge locally</p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy merge commands"
                    onClick={() => {
                      void copyText(mergeCommands).then(() =>
                        toast.success("Commands copied")
                      );
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[10px] leading-5 text-muted">
                  {mergeCommands}
                </pre>
                <p className="mt-2 text-[10px] leading-4 text-faint">
                  There is no server-side merge. Push the target branch and{" "}
                  {appName} detects fast-forward and merge-commit results.
                </p>
              </div>
            ) : mr.state === "merged" ? (
              <div className="border-b border-line p-4">
                <div className="flex items-center gap-2 text-[12px]">
                  <GitMerge className="size-3.5 text-accent" />
                  <span className="font-medium">Merged</span>
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  {detectionLabels[mr.mergeDetection] ?? "Merge detected"} ·{" "}
                  {relativeTime(mr.mergedAt)}
                </p>
                {mr.mergeCommitSha ? (
                  <Link
                    to={`${base}/repository/commits/${mr.mergeCommitSha}`}
                    className="mt-2 inline-block rounded-md border border-line px-2 py-1 font-mono text-[10px] text-muted hover:text-ink"
                  >
                    {mr.mergeCommitSha.slice(0, 10)}
                  </Link>
                ) : null}
              </div>
            ) : null}

            <SidebarSection title="Reviewers">
              {mr.reviewers.length === 0 ? (
                <p className="text-[11px] text-faint">No reviewers requested</p>
              ) : (
                <div className="space-y-2">
                  {mr.reviewers.map((reviewer) => (
                    <div key={reviewer.id} className="flex items-center gap-2">
                      <Avatar
                        name={reviewer.name}
                        src={reviewer.image}
                        className="size-6"
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px]">
                        {reviewer.name}
                      </span>
                      <Badge tone={reviewerTone(reviewer.state)}>
                        {reviewerLabel(reviewer.state)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-faint">
                <CheckCircle2 className="size-3 text-green" />
                {mr.approvalCount} approval{mr.approvalCount === 1 ? "" : "s"}{" "}
                on current head
              </div>
            </SidebarSection>

            <SidebarSection title="Assignees">
              {mr.assignees.length === 0 ? (
                <p className="text-[11px] text-faint">Unassigned</p>
              ) : (
                <div className="space-y-2">
                  {mr.assignees.map((person) => (
                    <div key={person.id} className="flex items-center gap-2">
                      <Avatar
                        name={person.name}
                        src={person.image}
                        className="size-6"
                      />
                      <span className="truncate text-[12px]">
                        {person.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SidebarSection>

            <SidebarSection title="Milestone">
              {mr.milestone ? (
                <div className="flex items-center gap-2 text-[12px]">
                  <Clock className="size-3.5 text-muted" />
                  {mr.milestone.title}
                </div>
              ) : (
                <p className="text-[11px] text-faint">No milestone</p>
              )}
            </SidebarSection>

            <SidebarSection title="Details">
              <dl className="space-y-2 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-faint">Source</dt>
                  <dd className="truncate font-mono">{mr.sourceBranch}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-faint">Target</dt>
                  <dd className="truncate font-mono">{mr.targetBranch}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-faint">Created</dt>
                  <dd>{dateTime(mr.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-faint">Updated</dt>
                  <dd>{relativeTime(mr.updatedAt)}</dd>
                </div>
                {mr.headSha ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Head</dt>
                    <dd className="font-mono">{mr.headSha.slice(0, 8)}</dd>
                  </div>
                ) : null}
                {mr.baseSha ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Base</dt>
                    <dd className="font-mono">{mr.baseSha.slice(0, 8)}</dd>
                  </div>
                ) : null}
              </dl>
            </SidebarSection>
          </div>
        </aside>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit merge request</DialogTitle>
            <DialogDescription>
              Changing reviewers or the target branch resets existing approvals.
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
              <Label htmlFor="mr-edit-title">Title</Label>
              <Input
                id="mr-edit-title"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mr-edit-description">Description</Label>
              <Textarea
                id="mr-edit-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={7}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mr-edit-target">Target branch</Label>
                <select
                  id="mr-edit-target"
                  value={editTarget}
                  onChange={(event) => setEditTarget(event.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface px-3 font-mono text-[12px]"
                >
                  {(repository.data?.branches ?? []).map((branch) => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mr-edit-milestone">Milestone</Label>
                <select
                  id="mr-edit-milestone"
                  value={editMilestone}
                  onChange={(event) => setEditMilestone(event.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
                >
                  <option value="">None</option>
                  {(milestones.data?.milestones ?? []).map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Users className="size-3.5 text-muted" />
                  <Label>Reviewers</Label>
                </div>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                  {(members.data?.members ?? [])
                    .filter((member) => member.user.id !== mr.author.id)
                    .map((member) => {
                      const selected = editReviewers.includes(member.user.id);
                      return (
                        <label
                          key={member.user.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-canvas"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              setEditReviewers((current) =>
                                selected
                                  ? current.filter(
                                      (id) => id !== member.user.id
                                    )
                                  : [...current, member.user.id]
                              )
                            }
                            className="accent-[var(--accent)]"
                          />
                          <Avatar
                            name={member.user.name}
                            src={member.user.image}
                            className="size-5"
                          />
                          <span className="truncate">{member.user.name}</span>
                        </label>
                      );
                    })}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Assignees</Label>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                  {(members.data?.members ?? []).map((member) => {
                    const selected = editAssignees.includes(member.user.id);
                    return (
                      <label
                        key={member.user.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-canvas"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            setEditAssignees((current) =>
                              selected
                                ? current.filter((id) => id !== member.user.id)
                                : [...current, member.user.id]
                            )
                          }
                          className="accent-[var(--accent)]"
                        />
                        <Avatar
                          name={member.user.name}
                          src={member.user.image}
                          className="size-5"
                        />
                        <span className="truncate">{member.user.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

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
                disabled={update.isPending || !editTitle.trim()}
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
