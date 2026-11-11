import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitCommit, Loader2, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
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
import { useReleases, useRepositoryTags } from "@/lib/queries";
import type { Release } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";
import { useProjectContext } from "./ProjectLayout";

export function ReleasesPage() {
  const confirm = useConfirm();
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "tags" ? "tags" : "releases";
  const base = `/groups/${groupSlug}/${projectSlug}`;
  const apiBase = `/groups/${groupSlug}/projects/${projectSlug}`;

  const releases = useReleases(groupSlug, projectSlug);
  const tags = useRepositoryTags(groupSlug, projectSlug, context.canReadGit);
  const canManage = Boolean(releases.data?.canManage);
  const canReadGit = context.canReadGit;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Release | null>(null);
  const [tagName, setTagName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState(false);

  const releaseList = releases.data?.releases ?? [];
  const tagList = tags.data?.tags ?? [];
  const releasedTags = new Set(releaseList.map((r) => r.tagName));
  const availableTags = tagList.filter((t) => !releasedTags.has(t.name));

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["releases", groupSlug, projectSlug],
      }),
      queryClient.invalidateQueries({
        queryKey: ["project", groupSlug, projectSlug],
      }),
    ]);
  }

  function openCreate(preselect = "") {
    setEditing(null);
    setTagName(preselect);
    setTitle(preselect);
    setDescription("");
    setPreview(false);
    setDialogOpen(true);
  }

  function openEdit(release: Release) {
    setEditing(release);
    setTagName(release.tagName);
    setTitle(release.title);
    setDescription(release.description);
    setPreview(false);
    setDialogOpen(true);
  }

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.patch(`${apiBase}/releases/${editing.id}`, { title, description })
        : api.post(`${apiBase}/releases`, { tagName, title, description }),
    onSuccess: async () => {
      toast.success(editing ? "Release updated" : "Release published");
      setDialogOpen(false);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${apiBase}/releases/${id}`),
    onSuccess: async () => {
      toast.success("Release deleted");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || (!editing && !tagName)) return;
    save.mutate();
  }

  function setTab(next: "releases" | "tags") {
    setSearchParams(next === "tags" ? { tab: "tags" } : {});
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          Releases
          <span className="ml-2 font-normal text-faint">
            {releaseList.length} total
          </span>
        </h1>
        {canManage ? (
          <Button variant="primary" size="sm" onClick={() => openCreate()}>
            <Plus className="size-4" />
            New release
          </Button>
        ) : null}
      </header>

      <div className="flex rounded-lg border border-line bg-canvas p-0.5">
        {(
          [
            ["releases", "Releases"],
            ["tags", "Tags"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            disabled={value === "tags" && !canReadGit}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              tab === value
                ? "bg-surface text-ink shadow-sm"
                : "text-muted hover:text-ink"
            )}
          >
            <Tag className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "releases" ? (
        releases.isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((key) => (
              <div
                key={key}
                className="h-32 animate-pulse rounded-xl bg-line/30"
              />
            ))}
          </div>
        ) : releaseList.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="No releases yet"
            description="A release pairs a Git tag with notes about what shipped. Push a tag, then publish a release for it."
            action={
              canManage ? (
                <Button variant="primary" onClick={() => openCreate()}>
                  <Plus className="size-4" />
                  New release
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="space-y-4">
            {releaseList.map((release) => (
              <article
                key={release.id}
                className="rounded-xl border border-line bg-surface shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
                  <Badge tone="accent">
                    <Tag className="size-3" />
                    <span className="font-mono">{release.tagName}</span>
                  </Badge>
                  <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
                    {release.title}
                  </h2>
                  {!release.tag.exists ? (
                    <Badge tone="red">Tag deleted</Badge>
                  ) : null}
                  {canManage ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${release.title}`}
                        onClick={() => openEdit(release)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${release.title}`}
                        onClick={() => {
                          void confirm({
                            title: `Delete ${release.title}?`,
                            description:
                              "The release notes are removed. The Git tag itself is untouched.",
                            confirmLabel: "Delete release",
                            tone: "danger",
                          }).then((accepted) => {
                            if (accepted) remove.mutate(release.id);
                          });
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                    {release.author ? (
                      <span className="flex items-center gap-1.5">
                        <Avatar
                          name={release.author.name}
                          src={release.author.image}
                          className="size-5"
                        />
                        <span className="font-medium text-ink">
                          {release.author.name}
                        </span>
                      </span>
                    ) : null}
                    <span>released {relativeTime(release.createdAt)}</span>
                    {release.tag.sha ? (
                      <Link
                        to={`${base}/repository/commits/${release.tag.sha}`}
                        className="flex items-center gap-1 font-mono text-[11px] text-muted hover:text-ink"
                      >
                        <GitCommit className="size-3" />
                        {release.tag.sha.slice(0, 8)}
                      </Link>
                    ) : null}
                  </div>
                  {release.description ? (
                    <div className="mt-3 border-t border-line pt-3">
                      <Markdown>{release.description}</Markdown>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )
      ) : !canReadGit ? (
        <EmptyState
          icon={Tag}
          title="Reporter access required"
          description="Tags are repository metadata. Ask for reporter access to browse them."
        />
      ) : tags.isLoading ? (
        <div className="h-48 animate-pulse rounded-xl bg-line/30" />
      ) : tagList.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No tags yet"
          description={
            <>
              Push a tag from your checkout, then refresh the repository:
              <code className="mt-2 block rounded-md border border-line bg-canvas px-3 py-2 text-left font-mono text-[11px] text-ink">
                git tag v1.0.0
                <br />
                git push origin v1.0.0
              </code>
            </>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="divide-y divide-line">
            {tagList.map((tag) => {
              const released = releasedTags.has(tag.name);
              return (
                <div
                  key={tag.name}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                >
                  <span className="flex items-center gap-2 font-mono text-[13px] font-medium text-ink">
                    <Tag className="size-3.5 text-faint" />
                    {tag.name}
                  </span>
                  <div className="min-w-0 flex-1">
                    {tag.commit ? (
                      <>
                        <p className="truncate text-[12px] text-muted">
                          {tag.commit.message.split("\n")[0]}
                        </p>
                        <p className="mt-0.5 text-[11px] text-faint">
                          {tag.commit.author.name} ·{" "}
                          {relativeTime(tag.commit.committedAt)}
                        </p>
                      </>
                    ) : (
                      <p className="text-[12px] text-faint">
                        Commit not synced yet
                      </p>
                    )}
                  </div>
                  {tag.commit ? (
                    <Link
                      to={`${base}/repository/commits/${tag.sha}`}
                      className="shrink-0 rounded-md border border-line px-2 py-1 font-mono text-[10px] text-muted hover:text-ink"
                    >
                      {tag.sha.slice(0, 8)}
                    </Link>
                  ) : null}
                  {released ? (
                    <Badge tone="green">Released</Badge>
                  ) : canManage ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openCreate(tag.name)}
                    >
                      <Plus className="size-3.5" />
                      Create release
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit release" : "New release"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the title and notes for this release."
                : "Pick a synced tag and describe what shipped."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {!editing ? (
              <div className="space-y-1.5">
                <Label htmlFor="release-tag">Tag</Label>
                <select
                  id="release-tag"
                  value={tagName}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTagName(value);
                    if (!title.trim()) setTitle(value);
                  }}
                  className="h-9 w-full rounded-md border border-line bg-surface px-3 font-mono text-[12px]"
                  required
                >
                  <option value="">Choose a tag</option>
                  {availableTags.map((tag) => (
                    <option key={tag.name} value={tag.name}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                {availableTags.length === 0 ? (
                  <p className="text-[11px] text-faint">
                    Every synced tag already has a release. Push a new tag
                    first.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Label>Tag</Label>
                <Badge tone="accent">
                  <Tag className="size-3" />
                  <span className="font-mono">{editing.tagName}</span>
                </Badge>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="release-title">Title</Label>
              <Input
                id="release-title"
                autoFocus
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="v1.0.0 — first public release"
              />
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <span className="mono-label">Notes</span>
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
                <div className="min-h-40 px-4 py-3">
                  {description ? (
                    <Markdown>{description}</Markdown>
                  ) : (
                    <p className="text-[13px] text-faint">
                      Nothing to preview.
                    </p>
                  )}
                </div>
              ) : (
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={8}
                  maxLength={100_000}
                  placeholder={
                    "## Highlights\n\n- What shipped\n\n## Fixes\n\n- [ ] …"
                  }
                  className="min-h-40 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
              )}
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
                disabled={
                  save.isPending || !title.trim() || (!editing && !tagName)
                }
              >
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {editing ? "Save release" : "Publish release"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
