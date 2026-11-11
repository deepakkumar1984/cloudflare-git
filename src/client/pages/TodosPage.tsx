import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Check,
  CircleDot,
  GitPullRequest,
  Inbox,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { useTodos } from "@/lib/queries";
import type { Todo } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";

function todoText(todo: Todo): string {
  const ref =
    todo.targetType === "issue" ? `#${todo.targetIid}` : `!${todo.targetIid}`;
  const kind = todo.targetType === "issue" ? "issue" : "merge request";
  switch (todo.action) {
    case "assigned":
      return `assigned you to ${kind} ${ref}`;
    case "review_requested":
      return `requested your review on ${kind} ${ref}`;
    case "mentioned":
      return `mentioned you in a comment on ${kind} ${ref}`;
  }
}

function todoLink(todo: Todo): string {
  const section = todo.targetType === "issue" ? "issues" : "merge_requests";
  return `/groups/${todo.project.groupSlug}/${todo.project.slug}/${section}/${todo.targetIid}`;
}

function TodoIcon({ todo }: { todo: Todo }) {
  if (todo.action === "mentioned") return <AtSign className="size-3.5" />;
  if (todo.targetType === "merge_request")
    return <GitPullRequest className="size-3.5" />;
  return <CircleDot className="size-3.5" />;
}

export function TodosPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const todos = useTodos(tab);
  const list = todos.data?.todos ?? [];
  const pendingCount = todos.data?.pendingCount ?? 0;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["todos"] });
  }

  const setState = useMutation({
    mutationFn: ({ id, state }: { id: string; state: "done" | "pending" }) =>
      api.post(`/todos/${id}/${state}`),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const doneAll = useMutation({
    mutationFn: () => api.post("/todos/done-all"),
    onSuccess: async () => {
      toast.success("All to-dos marked done");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          To do
          <span className="ml-2 font-normal text-faint">
            {pendingCount} pending
          </span>
        </h1>
        {tab === "pending" && pendingCount > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => doneAll.mutate()}
            disabled={doneAll.isPending}
          >
            {doneAll.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Mark all done
          </Button>
        ) : null}
      </header>

      <div className="flex rounded-lg border border-line bg-canvas p-0.5">
        {(
          [
            ["pending", "Pending"],
            ["done", "Done"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
              tab === value
                ? "bg-surface text-ink shadow-sm"
                : "text-muted hover:text-ink"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {todos.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((key) => (
            <div
              key={key}
              className="h-16 animate-pulse rounded-xl bg-line/30"
            />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={tab === "pending" ? "Nothing to do" : "No completed to-dos"}
          description={
            tab === "pending"
              ? "Assignments, review requests, and mentions will show up here."
              : "To-dos you mark done will appear here."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="divide-y divide-line">
            {list.map((todo) => (
              <div
                key={todo.id}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-canvas/50"
              >
                {todo.actor ? (
                  <Avatar
                    name={todo.actor.name}
                    src={todo.actor.image}
                    className="size-8 shrink-0"
                  />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-faint">
                    <TodoIcon todo={todo} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-muted">
                    <span className="font-medium text-ink">
                      {todo.actor?.name ?? "Someone"}
                    </span>{" "}
                    {todoText(todo)}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-faint">
                    <Link
                      to={todoLink(todo)}
                      className="font-medium text-muted hover:text-accent"
                    >
                      {todo.project.name}
                    </Link>{" "}
                    · {relativeTime(todo.createdAt)}
                  </p>
                </div>
                <Link
                  to={todoLink(todo)}
                  className="hidden shrink-0 items-center gap-1 font-mono text-[11px] text-faint hover:text-ink sm:flex"
                >
                  <TodoIcon todo={todo} />
                  {todo.targetType === "issue" ? "#" : "!"}
                  {todo.targetIid}
                </Link>
                {todo.state === "pending" ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Mark done"
                    title="Mark done"
                    disabled={setState.isPending}
                    onClick={() =>
                      setState.mutate({ id: todo.id, state: "done" })
                    }
                  >
                    <Check className="size-4" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Restore to-do"
                    title="Restore"
                    disabled={setState.isPending}
                    onClick={() =>
                      setState.mutate({ id: todo.id, state: "pending" })
                    }
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
