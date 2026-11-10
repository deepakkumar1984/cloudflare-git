import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  GitBranch,
  GitFork,
  Loader2,
  Lock,
  Users,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { useGroup } from "@/lib/queries";
import type { ProjectSummary } from "@/lib/types";
import { cn, slugPreview } from "@/lib/utils";

export function NewProjectPage() {
  const { groupSlug = "" } = useParams();
  const { data, isLoading, error } = useGroup(groupSlug);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "internal">(
    "private"
  );
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ project: ProjectSummary }>(`/groups/${groupSlug}/projects`, {
        name,
        slug,
        description,
        visibility,
        defaultBranch,
      }),
    onSuccess: async ({ project }) => {
      await queryClient.invalidateQueries({ queryKey: ["group", groupSlug] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate(`/groups/${groupSlug}/${project.slug}`, { replace: true });
    },
    onError: (cause) => setSubmitError(errorMessage(cause)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    mutation.mutate();
  }

  if (isLoading) {
    return <div className="h-72 animate-pulse rounded-xl bg-line/40" />;
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <p className="text-sm font-semibold">Group not found</p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/groups">Back to groups</Link>
        </Button>
      </div>
    );
  }

  const { group } = data;
  if (!group.canCreateProject) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <Lock className="mx-auto size-6 text-faint" />
        <p className="mt-4 text-sm font-semibold">
          You cannot create projects here
        </p>
        <p className="mt-1 text-[13px] text-muted">
          Ask a group owner or maintainer for access.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={`/groups/${groupSlug}`}>Back to group</Link>
        </Button>
      </div>
    );
  }

  const internalAllowed = group.visibility === "internal";

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={`/groups/${groupSlug}`}
        className="mb-6 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        {group.name}
      </Link>

      <header className="mb-8">
        <div className="flex items-center gap-2">
          <p className="mono-label">New project</p>
          <Badge tone="outline">{group.slug}</Badge>
        </div>
        <h1 className="mt-3 font-display text-[38px] leading-none tracking-[-0.04em]">
          Start a repository.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
          The project gets an empty Cloudflare Artifacts repository, an issue
          board, and a default set of labels.
        </p>
        <Button asChild variant="ghost" size="sm" className="mt-4 -ml-3">
          <Link to={`/groups/${groupSlug}/projects/import`}>
            <GitFork className="size-4" />
            Import an existing repository instead
          </Link>
        </Button>
      </header>

      <form onSubmit={submit} className="space-y-7">
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                required
                autoFocus
                maxLength={100}
                value={name}
                onChange={(event) => {
                  const value = event.target.value;
                  setName(value);
                  if (!slugTouched) setSlug(slugPreview(value));
                }}
                placeholder="API gateway"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-slug">Project path</Label>
              <Input
                id="project-slug"
                required
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(slugPreview(event.target.value));
                }}
                className="font-mono text-[13px]"
                pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
              />
              <p className="font-mono text-[10px] text-faint">
                {group.slug}/{slug || "project"}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="default-branch">Default branch</Label>
              <div className="relative">
                <GitBranch className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                <Input
                  id="default-branch"
                  required
                  value={defaultBranch}
                  onChange={(event) => setDefaultBranch(event.target.value)}
                  className="pl-8 font-mono text-[13px]"
                />
              </div>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                rows={3}
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What does this project do?"
              />
            </div>
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Visibility</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                value: "private" as const,
                icon: Lock,
                title: "Private",
                text: "Only project and group members can view it.",
              },
              {
                value: "internal" as const,
                icon: Users,
                title: "Internal",
                text: "Any signed-in user can view it. Disabled for private groups.",
              },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={option.value === "internal" && !internalAllowed}
                onClick={() => setVisibility(option.value)}
                className={cn(
                  "rounded-xl border bg-surface p-4 text-left shadow-card transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                  visibility === option.value
                    ? "border-accent ring-2 ring-accent/15"
                    : "border-line hover:border-line-strong"
                )}
              >
                <option.icon
                  className={cn(
                    "size-4",
                    visibility === option.value ? "text-accent" : "text-muted"
                  )}
                />
                <p className="mt-3 text-[13px] font-semibold">{option.title}</p>
                <p className="mt-1 text-[12px] leading-5 text-muted">
                  {option.text}
                </p>
              </button>
            ))}
          </div>
        </fieldset>

        {submitError ? (
          <p className="rounded-md border border-red/20 bg-red-soft px-3 py-2 text-[13px] text-red">
            {submitError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-line pt-5">
          <Button asChild variant="ghost">
            <Link to={`/groups/${groupSlug}`}>Cancel</Link>
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={mutation.isPending || !name || !slug}
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Create project
          </Button>
        </div>
      </form>
    </div>
  );
}
