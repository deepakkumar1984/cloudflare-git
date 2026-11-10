import { FolderGit2, Lock, Plus, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/lib/queries";
import { roleTone } from "@/lib/utils";

export function GroupsPage() {
  const { data, isLoading } = useMe();
  const [query, setQuery] = useState("");
  const groups = data?.groups ?? [];

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return groups;
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(value) ||
        group.slug.toLowerCase().includes(value)
    );
  }, [groups, query]);

  return (
    <div className="space-y-7">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mono-label mb-3">Groups</p>
          <h1 className="font-display text-[38px] leading-none tracking-[-0.04em]">
            Where work is organized.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Every project belongs to a group. Groups carry membership and roles
            down into their projects.
          </p>
        </div>
        <Button asChild variant="primary">
          <Link to="/groups/new">
            <Plus className="size-4" />
            New group
          </Link>
        </Button>
      </header>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter your groups"
          className="pl-8"
          aria-label="Filter groups"
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((key) => (
            <div
              key={key}
              className="h-44 animate-pulse rounded-xl bg-line/40"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <Users className="mx-auto size-7 text-faint" />
          <h2 className="mt-4 text-sm font-semibold">
            {query ? "No matching groups" : "No groups yet"}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-6 text-muted">
            {query
              ? "Try a shorter name or slug."
              : "Create a group for a team, a client, or an area of work. Your personal group is already available for solo projects."}
          </p>
          {!query ? (
            <Button asChild variant="primary" className="mt-5">
              <Link to="/groups/new">
                <Plus className="size-4" />
                Create a group
              </Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((group) => (
            <Link
              key={group.id}
              to={`/groups/${group.slug}`}
              className="group flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-canvas">
                  {group.personal ? (
                    <Users className="size-4 text-muted" />
                  ) : (
                    <FolderGit2 className="size-4 text-muted" />
                  )}
                </span>
                <div className="flex items-center gap-1.5">
                  {group.personal ? (
                    <Badge tone="outline">Personal</Badge>
                  ) : null}
                  {group.role ? (
                    <Badge tone={roleTone(group.role)}>{group.role}</Badge>
                  ) : (
                    <Badge tone="outline">Read only</Badge>
                  )}
                </div>
              </div>
              <h2 className="mt-4 text-[15px] font-semibold tracking-tight">
                {group.name}
              </h2>
              <p className="mt-1 font-mono text-[10px] text-faint">
                {group.slug}
              </p>
              <p className="mt-3 line-clamp-2 min-h-10 text-[13px] leading-5 text-muted">
                {group.description || "No description yet."}
              </p>
              <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-[11px] text-faint">
                <span className="flex items-center gap-1.5">
                  <Lock className="size-3" />
                  {group.visibility}
                </span>
                <span className="opacity-0 transition-opacity group-hover:opacity-100">
                  Open group →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
