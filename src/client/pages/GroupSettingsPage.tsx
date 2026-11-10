import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  Lock,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { useGroup } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function GroupSettingsPage() {
  const { groupSlug = "" } = useParams();
  const groupQuery = useGroup(groupSlug);
  const queryClient = useQueryClient();
  const group = groupQuery.data?.group;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "internal">(
    "private"
  );

  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setDescription(group.description);
    setVisibility(group.visibility);
  }, [group]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["group", groupSlug] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
    ]);
  }

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/groups/${groupSlug}`, { name, description, visibility }),
    onSuccess: async () => {
      toast.success("Group updated");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const archive = useMutation({
    mutationFn: () => api.post(`/groups/${groupSlug}/archive`),
    onSuccess: async () => {
      toast.success("Group archived");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const unarchive = useMutation({
    mutationFn: () => api.post(`/groups/${groupSlug}/unarchive`),
    onSuccess: async () => {
      toast.success("Group restored");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (groupQuery.isLoading) {
    return <div className="h-72 animate-pulse rounded-xl bg-line/40" />;
  }

  if (!group) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <p className="text-sm font-semibold">Group not found</p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/groups">Back to groups</Link>
        </Button>
      </div>
    );
  }

  if (!group.canManage) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <ShieldAlert className="mx-auto size-6 text-faint" />
        <p className="mt-4 text-sm font-semibold">Owner access required</p>
        <p className="mt-1 text-[13px] text-muted">
          Only group owners can change these settings.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={`/groups/${groupSlug}`}>Back to group</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link
          to={`/groups/${groupSlug}`}
          className="font-mono text-[11px] text-muted hover:text-ink"
        >
          {groupSlug}
        </Link>
        <h1 className="mt-2 font-display text-[36px] leading-none tracking-[-0.04em]">
          Group settings
        </h1>
        <p className="mt-2 text-sm text-muted">
          Paths stay stable; display names can change freely.
        </p>
      </header>

      {group.archivedAt ? (
        <div className="rounded-lg border border-red/20 bg-red-soft px-4 py-3 text-[13px] text-red">
          This group is archived. Restore it to make changes to its projects.
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
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-path">Path</Label>
              <Input
                id="group-path"
                value={group.slug}
                disabled
                className="font-mono"
              />
              <p className="text-[11px] text-faint">
                Group paths cannot be changed in this milestone.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-description">Description</Label>
              <Textarea
                id="group-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label>Visibility</Label>
              <div className="flex gap-2">
                {[
                  { value: "private" as const, label: "Private" },
                  { value: "internal" as const, label: "Internal" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={group.personal && option.value === "internal"}
                    onClick={() => setVisibility(option.value)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      visibility === option.value
                        ? "border-accent bg-accent-soft text-accent-strong"
                        : "border-line bg-surface text-muted hover:text-ink"
                    )}
                  >
                    <Lock className="size-3.5" />
                    {option.label}
                  </button>
                ))}
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

      {!group.personal ? (
        <Card>
          <CardHeader>
            <CardTitle>Archive</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-[13px] leading-6 text-muted">
                Archived groups and their projects become read-only. Nothing is
                deleted.
              </p>
            </div>
            {group.archivedAt ? (
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
                Restore group
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={() => {
                  if (
                    window.confirm(
                      "Archive this group? Projects will become read-only."
                    )
                  ) {
                    archive.mutate();
                  }
                }}
                disabled={archive.isPending}
              >
                {archive.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Archive className="size-4" />
                )}
                Archive group
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-[12px] text-muted">
          <Badge tone="outline" className="mr-2">
            Personal
          </Badge>
          Your personal group cannot be archived or shared with other members.
        </div>
      )}
    </div>
  );
}
