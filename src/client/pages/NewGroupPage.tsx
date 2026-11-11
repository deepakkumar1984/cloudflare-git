import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Lock, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import type { GroupSummary } from "@/lib/types";
import { cn, slugPreview } from "@/lib/utils";

export function NewGroupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "internal">(
    "private"
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ group: GroupSummary }>("/groups", {
        name,
        slug,
        description,
        visibility,
      }),
    onSuccess: async ({ group }) => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate(`/groups/${group.slug}`, { replace: true });
    },
    onError: (cause) => setError(errorMessage(cause)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/groups"
        className="mb-6 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        All groups
      </Link>

      <h1 className="mb-6 text-lg font-semibold tracking-tight">New group</h1>

      <form onSubmit={submit} className="space-y-7">
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="group-name">Group name</Label>
              <Input
                id="group-name"
                required
                autoFocus
                maxLength={100}
                value={name}
                onChange={(event) => {
                  const value = event.target.value;
                  setName(value);
                  if (!slugTouched) setSlug(slugPreview(value));
                }}
                placeholder="Platform team"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="group-slug">Path</Label>
              <div className="flex h-9 w-full items-center rounded-md border border-line bg-surface px-3 shadow-sm transition-colors hover:border-line-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                <span className="shrink-0 font-mono text-[12px] text-faint">
                  /groups/
                </span>
                <input
                  id="group-slug"
                  required
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(slugPreview(event.target.value));
                  }}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-faint"
                  placeholder="platform"
                  pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
                />
              </div>
              <p className="text-[11px] text-faint">
                Lowercase letters, numbers, and hyphens.
              </p>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="group-description">Description</Label>
              <Textarea
                id="group-description"
                rows={3}
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What belongs in this group?"
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
                text: "Only group members can see the group and its projects.",
              },
              {
                value: "internal" as const,
                icon: Users,
                title: "Internal",
                text: "Any signed-in user can view the group, but only members can write.",
              },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setVisibility(option.value)}
                className={cn(
                  "rounded-xl border bg-surface p-4 text-left shadow-card transition-colors",
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

        {error ? (
          <p className="rounded-md border border-red/20 bg-red-soft px-3 py-2 text-[13px] text-red">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-line pt-5">
          <Button asChild variant="ghost">
            <Link to="/groups">Cancel</Link>
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={mutation.isPending || !name || !slug}
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Create group
          </Button>
        </div>
      </form>
    </div>
  );
}
