import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  GitBranch,
  GitPullRequest,
  Loader2,
  Users,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import {
  useMe,
  useMilestones,
  useProjectMembers,
  useRepository,
} from "@/lib/queries";
import type { MergeRequestResponse } from "@/lib/types";
import { useProjectContext } from "./ProjectLayout";

export function NewMergeRequestPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const me = useMe();
  const repository = useRepository(groupSlug, projectSlug);
  const members = useProjectMembers(groupSlug, projectSlug);
  const milestones = useMilestones(groupSlug, projectSlug);
  const base = `/groups/${groupSlug}/${projectSlug}`;
  const apiBase = `/groups/${groupSlug}/projects/${projectSlug}`;

  const branches = repository.data?.branches ?? [];
  const [sourceBranch, setSourceBranch] = useState(
    searchParams.get("source") ?? ""
  );
  const [targetBranch, setTargetBranch] = useState(
    searchParams.get("target") ?? context.project.defaultBranch
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [milestoneId, setMilestoneId] = useState("");
  const [draft, setDraft] = useState(false);

  useEffect(() => {
    if (sourceBranch) return;
    if (branches.length === 0) return;
    const candidate = branches.find(
      (branch) => branch.name !== context.project.defaultBranch
    );
    setSourceBranch(candidate?.name ?? branches[0]!.name);
  }, [branches, context.project.defaultBranch, sourceBranch]);

  useEffect(() => {
    if (targetBranch) return;
    setTargetBranch(context.project.defaultBranch);
  }, [context.project.defaultBranch, targetBranch]);

  useEffect(() => {
    if (sourceBranch && sourceBranch === targetBranch) {
      const candidate = branches.find((branch) => branch.name !== targetBranch);
      if (candidate) setSourceBranch(candidate.name);
    }
    // Only correct the initial collision; a user can still swap both selects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches.length]);

  const membersById = new Map(
    (members.data?.members ?? []).map((member) => [member.user.id, member.user])
  );
  const memberOptions = [...membersById.values()];
  const reviewerOptions = memberOptions.filter(
    (person) => person.id !== me.data?.user.id
  );

  const create = useMutation({
    mutationFn: () =>
      api.post<MergeRequestResponse>(`${apiBase}/merge_requests`, {
        title,
        description,
        sourceBranch,
        targetBranch,
        reviewerIds,
        assigneeIds,
        milestoneId: milestoneId || null,
        draft,
      }),
    onSuccess: (response) => {
      toast.success("Merge request opened");
      navigate(`${base}/merge_requests/${response.mergeRequest.iid}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!sourceBranch || !targetBranch) {
      toast.error("Choose both branches");
      return;
    }
    if (sourceBranch === targetBranch) {
      toast.error("Source and target branches must differ");
      return;
    }
    create.mutate();
  }

  const sourceAvailable = branches.some(
    (branch) => branch.name === sourceBranch
  );
  const targetAvailable = branches.some(
    (branch) => branch.name === targetBranch
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link
          to={`${base}/merge_requests`}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Merge requests
        </Link>
        <h1 className="mt-3 text-lg font-semibold tracking-tight">
          New merge request
        </h1>
      </div>

      {repository.isLoading ? (
        <div className="h-72 animate-pulse rounded-xl bg-line/30" />
      ) : branches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-14 text-center">
          <GitBranch className="mx-auto size-6 text-faint" />
          <p className="mt-3 text-sm font-semibold">No branches synced yet</p>
          <p className="mt-1 text-[13px] text-muted">
            Push a branch before opening a merge request.
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-4">
            <Link to={`${base}/repository`}>Open repository</Link>
          </Button>
        </div>
      ) : branches.length === 1 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-14 text-center">
          <GitPullRequest className="mx-auto size-6 text-faint" />
          <p className="mt-3 text-sm font-semibold">Only one branch exists</p>
          <p className="mt-1 text-[13px] text-muted">
            Push a feature branch before opening a merge request.
          </p>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="overflow-hidden rounded-xl border border-line bg-surface shadow-card"
        >
          <div className="grid gap-4 border-b border-line bg-canvas/40 p-5 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="source-branch">Source branch</Label>
              <select
                id="source-branch"
                value={sourceBranch}
                onChange={(event) => setSourceBranch(event.target.value)}
                className="h-9 w-full rounded-md border border-line bg-surface px-3 font-mono text-[12px]"
                required
              >
                <option value="">Choose a branch</option>
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="hidden pb-2 text-faint sm:block">
              <ArrowRight className="size-4" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="target-branch">Target branch</Label>
              <select
                id="target-branch"
                value={targetBranch}
                onChange={(event) => setTargetBranch(event.target.value)}
                className="h-9 w-full rounded-md border border-line bg-surface px-3 font-mono text-[12px]"
                required
              >
                <option value="">Choose a branch</option>
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            {!sourceAvailable ||
            !targetAvailable ||
            sourceBranch === targetBranch ? (
              <p className="text-[11px] text-red sm:col-span-3">
                Choose two different, existing branches.
              </p>
            ) : null}
          </div>

          <div className="space-y-5 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="mr-title">Title</Label>
              <Input
                id="mr-title"
                autoFocus
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Add the thing you built"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mr-description">Description</Label>
              <Textarea
                id="mr-description"
                rows={8}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What changed, why it changed, and what reviewers should look at. Markdown is supported."
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Users className="size-3.5 text-muted" />
                  <Label>Reviewers</Label>
                </div>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                  {reviewerOptions.length === 0 ? (
                    <p className="px-1 py-2 text-[11px] text-faint">
                      No other project members yet.
                    </p>
                  ) : (
                    reviewerOptions.map((person) => {
                      const selected = reviewerIds.includes(person.id);
                      return (
                        <label
                          key={person.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-[12px] hover:bg-canvas"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              setReviewerIds((current) =>
                                selected
                                  ? current.filter((id) => id !== person.id)
                                  : [...current, person.id]
                              )
                            }
                            className="accent-[var(--accent)]"
                          />
                          <Avatar
                            name={person.name}
                            src={person.image}
                            className="size-5"
                          />
                          <span className="truncate">{person.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Assignees</Label>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                  {memberOptions.length === 0 ? (
                    <p className="px-1 py-2 text-[11px] text-faint">
                      No project members yet.
                    </p>
                  ) : (
                    memberOptions.map((person) => {
                      const selected = assigneeIds.includes(person.id);
                      return (
                        <label
                          key={person.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-[12px] hover:bg-canvas"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              setAssigneeIds((current) =>
                                selected
                                  ? current.filter((id) => id !== person.id)
                                  : [...current, person.id]
                              )
                            }
                            className="accent-[var(--accent)]"
                          />
                          <Avatar
                            name={person.name}
                            src={person.image}
                            className="size-5"
                          />
                          <span className="truncate">{person.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mr-milestone">Milestone</Label>
                <select
                  id="mr-milestone"
                  value={milestoneId}
                  onChange={(event) => setMilestoneId(event.target.value)}
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
              <label className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={draft}
                  onChange={(event) => setDraft(event.target.checked)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="block text-[12px] font-medium">
                    Mark as draft
                  </span>
                  <span className="mt-0.5 block text-[11px] text-faint">
                    Reviewers can still comment; merge detection is unaffected.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-line bg-canvas/30 px-5 py-3">
            <p className="hidden text-[11px] text-faint sm:block">
              Markdown · Reviews are advisory in this milestone.
            </p>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button asChild variant="ghost" size="sm">
                <Link to={`${base}/merge_requests`}>Cancel</Link>
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  create.isPending ||
                  !title.trim() ||
                  !sourceBranch ||
                  !targetBranch ||
                  sourceBranch === targetBranch
                }
              >
                {create.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <GitPullRequest className="size-4" />
                )}
                Open merge request
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
