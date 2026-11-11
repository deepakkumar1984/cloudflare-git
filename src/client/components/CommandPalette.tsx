import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Bell,
  CircleDot,
  Clock,
  Columns3,
  CornerDownLeft,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  ListChecks,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Tag,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMe, useSearch } from "@/lib/queries";
import { getTheme, toggleTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Kbd } from "./ui/kbd";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  to?: string;
  run?: () => void;
  keywords?: string;
}

interface Section {
  title: string;
  items: CommandItem[];
}

function projectContext(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "groups" || parts.length < 3) return null;
  const section = parts[2]!;
  if (
    section === "members" ||
    section === "settings" ||
    section === "projects"
  ) {
    return null;
  }
  return { groupSlug: parts[1]!, projectSlug: section };
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim().toLowerCase();
  const search = useSearch(query);

  const project = projectContext(location.pathname);
  const groups = me.data?.groups ?? [];

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const sections = useMemo<Section[]>(() => {
    const result: Section[] = [];
    const matches = (item: CommandItem) =>
      !trimmed ||
      item.label.toLowerCase().includes(trimmed) ||
      item.keywords?.toLowerCase().includes(trimmed) ||
      item.hint?.toLowerCase().includes(trimmed);

    const actions: CommandItem[] = [
      {
        id: "nav-dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        to: "/",
        keywords: "home overview",
      },
      {
        id: "nav-groups",
        label: "Groups",
        icon: Users,
        to: "/groups",
        keywords: "teams",
      },
      {
        id: "nav-search",
        label: "Search",
        icon: Search,
        to: "/search",
        keywords: "find",
      },
      {
        id: "nav-todos",
        label: "To do",
        icon: Bell,
        to: "/todos",
        keywords: "notifications mentions assigned review inbox",
      },
      {
        id: "nav-settings",
        label: "Account settings",
        icon: Settings,
        to: "/settings",
        keywords: "profile password theme",
      },
      {
        id: "new-group",
        label: "New group",
        icon: Plus,
        to: "/groups/new",
        keywords: "create team",
      },
      {
        id: "toggle-theme",
        label:
          getTheme() === "dark"
            ? "Switch to light theme"
            : "Switch to dark theme",
        icon: getTheme() === "dark" ? Sun : Moon,
        run: () => toggleTheme(),
        keywords: "dark light appearance mode",
      },
    ];

    if (project) {
      const base = `/groups/${project.groupSlug}/${project.projectSlug}`;
      actions.unshift(
        {
          id: "p-new-issue",
          label: "New issue",
          icon: CircleDot,
          to: `${base}/issues/new`,
          keywords: "create bug task",
        },
        {
          id: "p-new-mr",
          label: "New merge request",
          icon: GitPullRequest,
          to: `${base}/merge_requests/new`,
          keywords: "create review pr",
        },
        {
          id: "p-overview",
          label: "Project overview",
          icon: FolderGit2,
          to: base,
          keywords: "home",
        },
        {
          id: "p-repo",
          label: "Repository",
          icon: GitBranch,
          to: `${base}/repository`,
          keywords: "files code browse",
        },
        {
          id: "p-issues",
          label: "Issues",
          icon: CircleDot,
          to: `${base}/issues`,
          keywords: "bugs tasks",
        },
        {
          id: "p-board",
          label: "Board",
          icon: Columns3,
          to: `${base}/boards`,
          keywords: "kanban",
        },
        {
          id: "p-mrs",
          label: "Merge requests",
          icon: GitPullRequest,
          to: `${base}/merge_requests`,
          keywords: "reviews pr",
        },
        {
          id: "p-labels",
          label: "Labels",
          icon: Tag,
          to: `${base}/labels`,
          keywords: "tags",
        },
        {
          id: "p-milestones",
          label: "Milestones",
          icon: Clock,
          to: `${base}/milestones`,
          keywords: "deadline",
        },
        {
          id: "p-releases",
          label: "Releases",
          icon: Tag,
          to: `${base}/releases`,
          keywords: "tags versions changelog shipped",
        },
        {
          id: "p-tags",
          label: "Tags",
          icon: Tag,
          to: `${base}/releases?tab=tags`,
          keywords: "versions git",
        },
        {
          id: "p-members",
          label: "Members",
          icon: UserRound,
          to: `${base}/members`,
          keywords: "people access",
        },
        {
          id: "p-settings",
          label: "Project settings",
          icon: Settings,
          to: `${base}/settings`,
          keywords: "configure",
        }
      );
    }

    const filteredActions = actions.filter(matches);
    if (filteredActions.length)
      result.push({ title: "Actions", items: filteredActions });

    const groupItems: CommandItem[] = groups
      .map((group) => ({
        id: `group-${group.id}`,
        label: group.name,
        hint: group.slug,
        icon: group.personal ? UserRound : Users,
        to: `/groups/${group.slug}`,
        keywords: group.slug,
      }))
      .filter(matches);
    if (groupItems.length) result.push({ title: "Groups", items: groupItems });

    if (trimmed.length >= 2 && search.data) {
      const projects: CommandItem[] = search.data.projects.map((p) => ({
        id: `sp-${p.groupSlug}-${p.slug}`,
        label: p.name,
        hint: `${p.groupSlug}/${p.slug}`,
        icon: FolderGit2,
        to: `/groups/${p.groupSlug}/${p.slug}`,
      }));
      const issues: CommandItem[] = search.data.issues.map((i) => ({
        id: `si-${i.groupSlug}-${i.projectSlug}-${i.iid}`,
        label: i.title,
        hint: `${i.projectSlug}#${i.iid}`,
        icon: CircleDot,
        to: `/groups/${i.groupSlug}/${i.projectSlug}/issues/${i.iid}`,
      }));
      const mrs: CommandItem[] = search.data.mergeRequests.map((m) => ({
        id: `sm-${m.groupSlug}-${m.projectSlug}-${m.iid}`,
        label: m.title,
        hint: `${m.projectSlug}!${m.iid}`,
        icon: GitPullRequest,
        to: `/groups/${m.groupSlug}/${m.projectSlug}/merge_requests/${m.iid}`,
      }));
      if (projects.length) result.push({ title: "Projects", items: projects });
      if (issues.length) result.push({ title: "Issues", items: issues });
      if (mrs.length) result.push({ title: "Merge requests", items: mrs });
    }

    return result;
  }, [trimmed, project, groups, search.data]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => {
    setActive(0);
  }, [trimmed]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function select(item: CommandItem) {
    onOpenChange(false);
    if (item.run) item.run();
    if (item.to) navigate(item.to);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = flat[active];
      if (item) select(item);
    }
  }

  let cursor = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-overlay-in fixed inset-0 z-50 bg-[#0d0b08]/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="animate-dialog-in fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl focus:outline-none"
          onKeyDown={onKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">
            Command palette
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search pages, projects, issues, and merge requests
          </DialogPrimitive.Description>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search or jump to…"
              className="h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
              aria-label="Command palette search"
            />
            <Kbd>esc</Kbd>
          </div>

          <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
            {flat.length === 0 ? (
              <p className="px-3 py-10 text-center text-[13px] text-muted">
                {trimmed.length >= 2 && search.isLoading
                  ? "Searching…"
                  : "No matches. Try a different term."}
              </p>
            ) : (
              sections.map((section) => (
                <div key={section.title} className="mb-1 last:mb-0">
                  <p className="mono-label px-3 pb-1 pt-2">{section.title}</p>
                  {section.items.map((item) => {
                    cursor += 1;
                    const index = cursor;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-index={index}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => select(item)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                          active === index ? "bg-canvas text-ink" : "text-muted"
                        )}
                      >
                        <Icon className="size-4 shrink-0 text-faint" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                          {item.label}
                        </span>
                        {item.hint ? (
                          <span className="shrink-0 font-mono text-[11px] text-faint">
                            {item.hint}
                          </span>
                        ) : null}
                        {active === index ? (
                          <CornerDownLeft className="size-3.5 shrink-0 text-faint" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-line bg-canvas/50 px-4 py-2 text-[11px] text-faint">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              open
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <ListChecks className="size-3.5" />
              {project ? project.projectSlug : "All projects"}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
