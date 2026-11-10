import {
  CircleDot,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardActivity } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

function activityMeta(activity: DashboardActivity): {
  icon: typeof CircleDot;
  label: string;
  to: string | null;
} {
  const projectBase =
    activity.groupSlug && activity.projectSlug
      ? `/groups/${activity.groupSlug}/${activity.projectSlug}`
      : null;

  switch (activity.action) {
    case "push":
      return {
        icon: GitBranch,
        label: "pushed commits",
        to: projectBase ? `${projectBase}/repository/commits` : null,
      };
    case "issue.opened":
    case "issue.closed":
    case "issue.reopened":
    case "issue.comment":
      return {
        icon: activity.action === "issue.comment" ? MessageSquare : CircleDot,
        label:
          activity.action === "issue.opened"
            ? "opened an issue"
            : activity.action === "issue.closed"
              ? "closed an issue"
              : activity.action === "issue.comment"
                ? "commented on an issue"
                : "reopened an issue",
        to:
          projectBase && activity.targetIid
            ? `${projectBase}/issues/${activity.targetIid}`
            : null,
      };
    case "mr.opened":
    case "mr.merged":
    case "mr.closed":
    case "mr.approved":
    case "mr.reopened":
    case "mr.updated":
    case "mr.comment":
      return {
        icon: activity.action === "mr.comment" ? MessageSquare : GitPullRequest,
        label:
          activity.action === "mr.comment"
            ? "commented on a merge request"
            : activity.action === "mr.opened"
              ? "opened a merge request"
              : activity.action === "mr.merged"
                ? "merged a merge request"
                : activity.action === "mr.approved"
                  ? "reviewed a merge request"
                  : activity.action === "mr.reopened"
                    ? "reopened a merge request"
                    : activity.action === "mr.updated"
                      ? "updated a merge request"
                      : "closed a merge request",
        to:
          projectBase && activity.targetIid
            ? `${projectBase}/merge_requests/${activity.targetIid}`
            : null,
      };
    case "project.created":
    case "project.imported":
    case "project.reimported":
      return {
        icon: FolderGit2,
        label:
          activity.action === "project.imported"
            ? "imported a repository"
            : activity.action === "project.reimported"
              ? "re-imported a repository"
              : "created a project",
        to: projectBase,
      };
    case "project.import_failed":
      return {
        icon: FolderGit2,
        label: "repository import failed",
        to: projectBase,
      };
    case "group.created":
      return {
        icon: Users,
        label: "created a group",
        to: activity.groupSlug ? `/groups/${activity.groupSlug}` : null,
      };
    default:
      return {
        icon: CircleDot,
        label: activity.action.replaceAll(".", " ").replaceAll("_", " "),
        to: projectBase,
      };
  }
}

export function ActivityFeed({
  activity,
  emptyMessage = "Activity will appear here.",
  showProject = true,
}: {
  activity: DashboardActivity[];
  emptyMessage?: string;
  showProject?: boolean;
}) {
  if (activity.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[13px] text-muted">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="divide-y divide-line">
      {activity.map((item) => {
        const meta = activityMeta(item);
        const Icon = meta.icon;
        const content = (
          <>
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-muted">
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] leading-5 text-muted">
                <span className="font-medium text-ink">
                  {item.actorName || "System"}
                </span>{" "}
                {meta.label}
                {showProject && item.projectName ? (
                  <>
                    {" "}
                    in <span className="text-ink">{item.projectName}</span>
                  </>
                ) : null}
              </p>
              <p className="mt-0.5 text-[10px] text-faint">
                {relativeTime(item.createdAt)}
              </p>
            </div>
          </>
        );
        return meta.to ? (
          <Link
            key={item.id}
            to={meta.to}
            className="flex gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/70"
          >
            {content}
          </Link>
        ) : (
          <div key={item.id} className="flex gap-3 px-5 py-3.5">
            {content}
          </div>
        );
      })}
    </div>
  );
}
