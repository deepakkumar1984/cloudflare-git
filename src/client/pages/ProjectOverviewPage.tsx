import {
  ArrowUpRight,
  BookOpen,
  CircleDot,
  Clipboard,
  Check,
  GitBranch,
  GitFork,
  GitPullRequest,
  Loader2,
  Lock,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useProjectActivity,
  useProjectImport,
  useRepositoryReadme,
} from "@/lib/queries";
import { GIT_PROVIDER_LABELS } from "@shared/constants";
import { canCreateIssue } from "@shared/permissions";
import { useProjectContext } from "./ProjectLayout";
import { copyText, dateTime, relativeTime } from "@/lib/utils";

function Metric({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: typeof CircleDot;
  label: string;
  value: number;
  to?: string;
}) {
  const content = (
    <>
      <span className="flex size-9 items-center justify-center rounded-lg bg-canvas text-muted">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
        <p className="text-[11px] text-muted">{label}</p>
      </div>
      {to ? (
        <ArrowUpRight className="ml-auto size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
      ) : null}
    </>
  );
  const className =
    "group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card transition-colors";
  return to ? (
    <Link to={to} className={`${className} hover:border-line-strong`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function ProjectOverviewPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const { project, canReadGit } = useProjectContext();
  const queryClient = useQueryClient();
  const readme = useRepositoryReadme(groupSlug, projectSlug, canReadGit);
  const activity = useProjectActivity(groupSlug, projectSlug, 1, 12);
  const projectImport = useProjectImport(groupSlug, projectSlug);
  const [copied, setCopied] = useState(false);
  const base = `/groups/${groupSlug}/${projectSlug}`;
  const empty = project.branches === 0 && project.provisioningState === "ready";
  const imported = projectImport.data?.import ?? null;
  const importActive =
    imported?.status === "pending" || imported?.status === "importing";

  useEffect(() => {
    if (imported?.status !== "ready") return;
    void queryClient.invalidateQueries({
      queryKey: ["project", groupSlug, projectSlug],
    });
    void queryClient.invalidateQueries({
      queryKey: ["repository", groupSlug, projectSlug],
    });
  }, [imported?.status, groupSlug, projectSlug, queryClient]);

  async function copyRemote() {
    if (!project.artifactsRemote) return;
    await copyText(project.artifactsRemote);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.65fr)]">
      <div className="space-y-6">
        {imported && (importActive || imported.status === "failed") ? (
          <div className="flex items-start gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-surface text-accent">
              {importActive ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <GitFork className="size-3.5" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold">
                {importActive
                  ? `Importing from ${GIT_PROVIDER_LABELS[imported.provider]}`
                  : "Repository import failed"}
              </p>
              <p className="mt-0.5 text-[11px] leading-5 text-muted">
                {importActive
                  ? `Copying ${imported.externalRepo} into Cloudflare Artifacts. This page updates automatically.`
                  : imported.error ||
                    "Open project settings to retry the import."}
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            icon={CircleDot}
            label="Open issues"
            value={project.openIssues}
            to={`${base}/issues`}
          />
          <Metric
            icon={GitPullRequest}
            label="Open merge requests"
            value={project.openMergeRequests}
            to={`${base}/merge_requests`}
          />
          <Metric
            icon={GitBranch}
            label="Branches"
            value={project.branches}
            to={canReadGit ? `${base}/repository` : undefined}
          />
        </div>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>About this project</CardTitle>
            <Badge tone="outline">
              <Lock className="size-3" />
              {project.visibility}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-7 text-muted">
              {project.description || "No description has been added yet."}
            </p>
            <dl className="grid gap-4 border-t border-line pt-4 text-[12px] sm:grid-cols-3">
              <div>
                <dt className="text-faint">Default branch</dt>
                <dd className="mt-1 font-mono text-ink">
                  {project.defaultBranch}
                </dd>
              </div>
              <div>
                <dt className="text-faint">Created</dt>
                <dd className="mt-1 text-ink">{dateTime(project.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-faint">Last sync</dt>
                <dd className="mt-1 text-ink">
                  {project.lastSyncedAt
                    ? relativeTime(project.lastSyncedAt)
                    : "Not synced yet"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {readme.data?.readme ? (
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="size-4 text-muted" />
                {readme.data.readme.path}
              </CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link
                  to={`${base}/repository/blob${new URLSearchParams({
                    ref: project.defaultBranch,
                    path: readme.data.readme.path,
                  })
                    .toString()
                    .replace(/^/, "?")}`}
                >
                  View file
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="max-h-[36rem] overflow-y-auto">
              <Markdown>{readme.data.readme.content}</Markdown>
            </CardContent>
          </Card>
        ) : null}

        {canReadGit ? (
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Repository</CardTitle>
              <Badge
                tone={
                  project.provisioningState === "ready" ? "green" : "accent"
                }
              >
                {project.provisioningState}
              </Badge>
            </CardHeader>
            <CardContent>
              {empty ? (
                <div className="rounded-lg border border-dashed border-line bg-canvas/40 px-5 py-8 text-center">
                  <GitBranch
                    className="mx-auto size-5 text-faint"
                    strokeWidth={1.5}
                  />
                  <h3 className="mt-3 text-sm font-semibold">
                    This repository is empty
                  </h3>
                  <p className="mx-auto mt-1 max-w-md text-[13px] leading-6 text-muted">
                    Open <span className="font-medium text-ink">Clone</span> in
                    the header, generate a write credential, and push an initial
                    commit to{" "}
                    <code className="font-mono text-[11px]">
                      {project.defaultBranch}
                    </code>
                    .
                  </p>
                  <Button asChild variant="secondary" className="mt-4">
                    <Link to={`${base}/repository`}>
                      <GitBranch className="size-4" />
                      View repository
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] text-faint">Remote</p>
                    <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                        {project.artifactsRemote || "Not provisioned"}
                      </code>
                      <button
                        type="button"
                        onClick={copyRemote}
                        className="rounded p-1 text-faint hover:bg-surface hover:text-ink"
                        aria-label="Copy remote URL"
                        disabled={!project.artifactsRemote}
                      >
                        {copied ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Clipboard className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="secondary" size="sm">
                      <Link to={`${base}/repository`}>
                        <GitBranch className="size-4" />
                        Browse files
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`${base}/repository/commits`}>
                        Commit history
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <aside className="space-y-5">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ActivityFeed
              activity={activity.data?.activity ?? []}
              emptyMessage="Project activity will appear here."
              showProject={false}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {[
              ...(canCreateIssue(project.role)
                ? [
                    {
                      to: `${base}/issues/new`,
                      icon: CircleDot,
                      label: "New issue",
                      text: "Capture work or a bug",
                    },
                  ]
                : []),
              {
                to: `${base}/issues`,
                icon: CircleDot,
                label: "Issue board",
                text: "Move cards across columns",
              },
              {
                to: `${base}/merge_requests`,
                icon: GitPullRequest,
                label: "Merge requests",
                text: "Review branches and diffs",
              },
              {
                to: `${base}/members`,
                icon: Users,
                label: "Members",
                text: "See who has access",
              },
            ].map((action) => (
              <Link
                key={action.label}
                to={action.to}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-canvas"
              >
                <span className="flex size-7 items-center justify-center rounded-md border border-line bg-surface text-muted">
                  <action.icon className="size-3.5" />
                </span>
                <div>
                  <p className="text-[12px] font-medium">{action.label}</p>
                  <p className="text-[10px] text-faint">{action.text}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="rounded-xl border border-line bg-canvas/50 p-4">
          <p className="mono-label">Artifacts limits</p>
          <ul className="mt-3 space-y-2 text-[11px] leading-5 text-muted">
            <li>1 GB per repository</li>
            <li>32 MiB per file</li>
            <li>64 MiB per push</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
