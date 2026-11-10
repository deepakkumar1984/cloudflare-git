import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth";
import { useMe } from "@/lib/queries";
import type { GroupSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ThemeToggle } from "./ThemeToggle";

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-canvas hover:text-ink",
    isActive && "bg-canvas text-ink"
  );
}

function GroupLink({
  group,
  onNavigate,
}: {
  group: GroupSummary;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={`/groups/${group.slug}`}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-canvas hover:text-ink",
          isActive && "bg-canvas text-ink"
        )
      }
      title={group.name}
    >
      {group.personal ? (
        <UserRound className="size-3.5 shrink-0 text-faint" />
      ) : (
        <Users className="size-3.5 shrink-0 text-faint" />
      )}
      <span className="truncate">{group.name}</span>
      {group.role === "owner" ? (
        <span className="ml-auto size-1.5 rounded-full bg-accent/70" />
      ) : null}
    </NavLink>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { data, isLoading } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const groups = data?.groups ?? [];
  const user = data?.user;

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    navigate("/sign-in", { replace: true });
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 px-5 pb-4 pt-5">
        <NavLink
          to="/"
          className="flex items-center gap-2"
          onClick={onNavigate}
        >
          <img src="/mark.svg" alt="" className="size-8 rounded-[9px]" />
          <span className="font-display text-[22px] font-semibold leading-none tracking-[-0.03em] text-ink">
            Deesha
          </span>
          <span className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
            git
          </span>
        </NavLink>
      </div>

      <div className="px-3">
        <NavLink to="/" end className={navClass} onClick={onNavigate}>
          <LayoutDashboard className="size-4" />
          Dashboard
        </NavLink>
        <NavLink to="/groups" className={navClass} onClick={onNavigate}>
          <Users className="size-4" />
          Groups
        </NavLink>
        <NavLink to="/search" className={navClass} onClick={onNavigate}>
          <Search className="size-4" />
          Search
          <span className="ml-auto rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint">
            /
          </span>
        </NavLink>
      </div>

      <div className="mt-6 flex items-center justify-between px-5">
        <span className="mono-label">Your groups</span>
        <NavLink
          to="/groups/new"
          onClick={onNavigate}
          className="rounded p-1 text-faint transition-colors hover:bg-canvas hover:text-ink"
          title="New group"
        >
          <Plus className="size-3.5" />
        </NavLink>
      </div>

      <div className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {isLoading
          ? [1, 2, 3].map((key) => (
              <div
                key={key}
                className="mx-2.5 my-2 h-5 animate-pulse rounded bg-line/60"
              />
            ))
          : groups.map((group) => (
              <GroupLink key={group.id} group={group} onNavigate={onNavigate} />
            ))}
        {!isLoading && groups.length === 0 ? (
          <p className="px-2.5 py-2 text-xs leading-5 text-faint">
            Create a group to start organizing projects.
          </p>
        ) : null}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-center gap-1 px-1 pb-2">
          <ThemeToggle />
          <NavLink
            to="/settings"
            onClick={onNavigate}
            className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            <Settings className="size-3.5" />
            Settings
          </NavLink>
        </div>

        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-line hover:bg-canvas">
                <Avatar name={user.name} src={user.image} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {user.name}
                  </p>
                  <p className="truncate text-[11px] text-faint">
                    @{user.displayUsername || user.username || "user"}
                  </p>
                </div>
                <ChevronsUpDown className="size-3.5 text-faint" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56">
              <DropdownMenuLabel>Signed in as {user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <NavLink to="/settings" onClick={onNavigate}>
                  <Settings className="size-4" />
                  Account settings
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={signOut}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="h-12 animate-pulse rounded-lg bg-line/50" />
        )}
      </div>
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-line lg:block">
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur-lg lg:hidden">
          <button
            className="rounded-md p-2 text-muted hover:bg-surface hover:text-ink"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <NavLink to="/" className="flex items-center gap-2">
            <img src="/mark.svg" alt="" className="size-7 rounded-lg" />
            <span className="font-display text-lg font-semibold tracking-tight">
              Deesha
            </span>
          </NavLink>
          <ThemeToggle />
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              className="absolute inset-0 bg-[#0d0b08]/50 backdrop-blur-[2px]"
              onClick={closeMobile}
              aria-label="Close navigation"
            />
            <div className="absolute inset-y-0 left-0 w-[280px] border-r border-line bg-surface shadow-2xl">
              <button
                className="absolute right-3 top-4 z-10 rounded-md p-2 text-muted hover:bg-canvas hover:text-ink"
                onClick={closeMobile}
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </button>
              <SidebarContent onNavigate={closeMobile} />
            </div>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
