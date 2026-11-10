import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { useLabels, useMilestones, useProjectMembers } from "@/lib/queries";
import type { Issue } from "@/lib/types";
import { canCreateIssue } from "@shared/permissions";
import { cn } from "@/lib/utils";
import { useProjectContext } from "./ProjectLayout";

export function NewIssuePage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const labels = useLabels(groupSlug, projectSlug);
  const milestones = useMilestones(groupSlug, projectSlug);
  const members = useProjectMembers(groupSlug, projectSlug);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState(false);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [milestoneId, setMilestoneId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [confidential, setConfidential] = useState(false);
  const base = `/groups/${groupSlug}/${projectSlug}`;

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ issue: Issue }>(
        `/groups/${groupSlug}/projects/${projectSlug}/issues`,
        {
          title,
          description,
          labelIds,
          assigneeIds,
          milestoneId: milestoneId || null,
          dueDate: dueDate || null,
          confidential,
        }
      ),
    onSuccess: async ({ issue }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["issues", groupSlug, projectSlug],
        }),
        queryClient.invalidateQueries({
          queryKey: ["board", groupSlug, projectSlug],
        }),
        queryClient.invalidateQueries({
          queryKey: ["project", groupSlug, projectSlug],
        }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      toast.success("Issue opened");
      navigate(`${base}/issues/${issue.iid}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canCreateIssue(context.project.role)) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
        <p className="text-sm font-semibold">Reporter access required</p>
        <p className="mt-1 text-[13px] text-muted">
          You can view issues but cannot open a new one.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={`${base}/issues`}>Back to issues</Link>
        </Button>
      </div>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    mutation.mutate();
  }

  const projectMembers = [
    ...new Map(
      (members.data?.members ?? []).map((member) => [
        member.user.id,
        member.user,
      ])
    ).values(),
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to={`${base}/issues`}
        className="mb-5 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Issues
      </Link>

      <header className="mb-6">
        <p className="mono-label mb-2">New issue</p>
        <h1 className="font-display text-[34px] leading-none tracking-[-0.04em]">
          Describe the work.
        </h1>
        <p className="mt-2 text-sm text-muted">
          Use markdown for detail and{" "}
          <code className="font-mono text-[11px]">- [ ]</code> for checklist
          items.
        </p>
      </header>

      <form
        onSubmit={submit}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]"
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="issue-title">Title</Label>
            <Input
              id="issue-title"
              autoFocus
              required
              maxLength={255}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Short, specific summary"
              className="text-[15px]"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                Description
              </span>
              <div className="flex rounded-md border border-line bg-canvas p-0.5">
                <button
                  type="button"
                  onClick={() => setPreview(false)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px]",
                    !preview ? "bg-surface text-ink shadow-sm" : "text-muted"
                  )}
                >
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(true)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px]",
                    preview ? "bg-surface text-ink shadow-sm" : "text-muted"
                  )}
                >
                  Preview
                </button>
              </div>
            </div>
            {preview ? (
              <div className="min-h-64 px-4 py-4">
                {description ? (
                  <Markdown>{description}</Markdown>
                ) : (
                  <p className="text-[13px] text-faint">
                    Nothing to preview yet.
                  </p>
                )}
              </div>
            ) : (
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={16}
                maxLength={100_000}
                placeholder={
                  "## Context\n\nWhat is happening?\n\n## Acceptance\n\n- [ ] First step\n- [ ] Second step"
                }
                className="min-h-64 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="mono-label mb-3">Metadata</p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="issue-milestone">Milestone</Label>
                <select
                  id="issue-milestone"
                  value={milestoneId}
                  onChange={(event) => setMilestoneId(event.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface px-2 text-[12px]"
                >
                  <option value="">None</option>
                  {(milestones.data?.milestones ?? []).map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="issue-due">Due date</Label>
                <Input
                  id="issue-due"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
              <label className="flex items-start gap-2 text-[12px] leading-5 text-muted">
                <input
                  type="checkbox"
                  checked={confidential}
                  onChange={(event) => setConfidential(event.target.checked)}
                  className="mt-1 accent-[var(--accent)]"
                />
                Confidential — visible to reporters and above.
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="mono-label mb-3">Labels</p>
            <div className="space-y-1.5">
              {(labels.data?.labels ?? []).map((label) => {
                const checked = labelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() =>
                      setLabelIds((current) =>
                        checked
                          ? current.filter((id) => id !== label.id)
                          : [...current, label.id]
                      )
                    }
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                      checked
                        ? "bg-canvas text-ink"
                        : "text-muted hover:bg-canvas/60"
                    )}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="flex-1">{label.title}</span>
                    {checked ? (
                      <Check className="size-3.5 text-accent" />
                    ) : null}
                  </button>
                );
              })}
              {(labels.data?.labels ?? []).length === 0 ? (
                <p className="text-[11px] text-faint">No labels yet.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="mono-label mb-3">Assignees</p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {projectMembers.map((member) => {
                const checked = assigneeIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() =>
                      setAssigneeIds((current) =>
                        checked
                          ? current.filter((id) => id !== member.id)
                          : [...current, member.id]
                      )
                    }
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      checked ? "bg-canvas" : "hover:bg-canvas/60"
                    )}
                  >
                    <Avatar
                      name={member.name}
                      src={member.image}
                      className="size-6"
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {member.name}
                    </span>
                    {checked ? (
                      <Check className="size-3.5 text-accent" />
                    ) : null}
                  </button>
                );
              })}
              {projectMembers.length === 0 ? (
                <p className="text-[11px] text-faint">No assignable members.</p>
              ) : null}
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={mutation.isPending || !title.trim()}
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Open issue
          </Button>
        </aside>
      </form>
    </div>
  );
}
