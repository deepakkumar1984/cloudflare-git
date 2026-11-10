import { Loader2 } from "lucide-react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { authClient } from "@/lib/auth";
import { useAppName } from "@/lib/meta";
import { BoardPage } from "@/pages/BoardPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { GroupMembersPage } from "@/pages/GroupMembersPage";
import { GroupPage } from "@/pages/GroupPage";
import { GroupSettingsPage } from "@/pages/GroupSettingsPage";
import { IssueDetailPage } from "@/pages/IssueDetailPage";
import { IssuesPage } from "@/pages/IssuesPage";
import { LabelsPage } from "@/pages/LabelsPage";
import { MergeRequestDetailPage } from "@/pages/MergeRequestDetailPage";
import { MergeRequestsPage } from "@/pages/MergeRequestsPage";
import { MilestonesPage } from "@/pages/MilestonesPage";
import { NewIssuePage } from "@/pages/NewIssuePage";
import { NewMergeRequestPage } from "@/pages/NewMergeRequestPage";
import { GroupsPage } from "@/pages/GroupsPage";
import { ImportProjectPage } from "@/pages/ImportProjectPage";
import { NewGroupPage } from "@/pages/NewGroupPage";
import { NewProjectPage } from "@/pages/NewProjectPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ProjectLayout } from "@/pages/ProjectLayout";
import { ProjectMembersPage } from "@/pages/ProjectMembersPage";
import { ProjectOverviewPage } from "@/pages/ProjectOverviewPage";
import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import { RepositoryBlobPage } from "@/pages/RepositoryBlobPage";
import { RepositoryCommitPage } from "@/pages/RepositoryCommitPage";
import { RepositoryCommitsPage } from "@/pages/RepositoryCommitsPage";
import { RepositoryPage } from "@/pages/RepositoryPage";
import { SearchPage } from "@/pages/SearchPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SignInPage } from "@/pages/SignInPage";
import { SignUpPage } from "@/pages/SignUpPage";

function AuthLoading() {
  const appName = useAppName();
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-3 text-muted">
        <img src="/mark.svg" alt="" className="size-8 rounded-lg" />
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Opening {appName}…</span>
      </div>
    </div>
  );
}

function RequireAuth() {
  const session = authClient.useSession();
  const location = useLocation();

  if (session.isPending) return <AuthLoading />;
  if (!session.data) {
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{
          from: { pathname: location.pathname, search: location.search },
        }}
      />
    );
  }
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="groups/new" element={<NewGroupPage />} />
          <Route path="groups/:groupSlug" element={<GroupPage />} />
          <Route
            path="groups/:groupSlug/members"
            element={<GroupMembersPage />}
          />
          <Route
            path="groups/:groupSlug/settings"
            element={<GroupSettingsPage />}
          />
          <Route
            path="groups/:groupSlug/projects/new"
            element={<NewProjectPage />}
          />
          <Route
            path="groups/:groupSlug/projects/import"
            element={<ImportProjectPage />}
          />
          <Route
            path="groups/:groupSlug/:projectSlug"
            element={<ProjectLayout />}
          >
            <Route index element={<ProjectOverviewPage />} />
            <Route path="repository" element={<RepositoryPage />} />
            <Route path="repository/blob" element={<RepositoryBlobPage />} />
            <Route
              path="repository/commits"
              element={<RepositoryCommitsPage />}
            />
            <Route
              path="repository/commits/:sha"
              element={<RepositoryCommitPage />}
            />
            <Route path="issues" element={<IssuesPage />} />
            <Route path="issues/new" element={<NewIssuePage />} />
            <Route path="issues/:iid" element={<IssueDetailPage />} />
            <Route path="boards" element={<BoardPage />} />
            <Route path="labels" element={<LabelsPage />} />
            <Route path="milestones" element={<MilestonesPage />} />
            <Route path="merge_requests" element={<MergeRequestsPage />} />
            <Route
              path="merge_requests/new"
              element={<NewMergeRequestPage />}
            />
            <Route
              path="merge_requests/:iid"
              element={<MergeRequestDetailPage />}
            />
            <Route path="members" element={<ProjectMembersPage />} />
            <Route path="settings" element={<ProjectSettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route path="search" element={<SearchPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
