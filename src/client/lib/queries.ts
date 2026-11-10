import { useQuery } from "@tanstack/react-query";
import { api, qs } from "./api";
import type {
  BoardResponse,
  DashboardResponse,
  Issue,
  IssueListResponse,
  IssueNotesResponse,
  ProjectLabelsResponse,
  ProjectMilestonesResponse,
  GroupMembersResponse,
  GroupPageResponse,
  MeResponse,
  MergeRequestChangedFile,
  MergeRequestCommitsResponse,
  MergeRequestDiffResponse,
  MergeRequestListResponse,
  MergeRequestNotesResponse,
  MergeRequestPatchResponse,
  MergeRequestResponse,
  ProjectActivityResponse,
  ProjectImportResponse,
  ProjectMembersResponse,
  ProjectPageResponse,
  ProviderConnectionsResponse,
  ProviderRepositoriesResponse,
  RepositoryBlob,
  RepositoryCommit,
  RepositoryCommitList,
  RepositoryReadme,
  RepositorySummary,
  RepositoryTree,
  SearchResponse,
} from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/me"),
    staleTime: 20_000,
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardResponse>("/dashboard"),
    staleTime: 15_000,
  });
}

export function useGroup(groupSlug: string) {
  return useQuery({
    queryKey: ["group", groupSlug],
    queryFn: () => api.get<GroupPageResponse>(`/groups/${groupSlug}`),
    enabled: Boolean(groupSlug),
  });
}

export function useGroupMembers(groupSlug: string) {
  return useQuery({
    queryKey: ["group", groupSlug, "members"],
    queryFn: () =>
      api.get<GroupMembersResponse>(`/groups/${groupSlug}/members`),
    enabled: Boolean(groupSlug),
  });
}

export function useProject(groupSlug: string, projectSlug: string) {
  return useQuery({
    queryKey: ["project", groupSlug, projectSlug],
    queryFn: () =>
      api.get<ProjectPageResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}`
      ),
    enabled: Boolean(groupSlug && projectSlug),
  });
}

export function useProjectMembers(groupSlug: string, projectSlug: string) {
  return useQuery({
    queryKey: ["project", groupSlug, projectSlug, "members"],
    queryFn: () =>
      api.get<ProjectMembersResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/members`
      ),
    enabled: Boolean(groupSlug && projectSlug),
  });
}

export function useProviderConnections() {
  return useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.get<ProviderConnectionsResponse>("/integrations"),
    staleTime: 30_000,
  });
}

export function useProviderRepositories(
  provider: "github" | "gitlab",
  page: number,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["integrations", provider, "repositories", page],
    queryFn: () =>
      api.get<ProviderRepositoriesResponse>(
        `/integrations/${provider}/repositories${qs({ page })}`
      ),
    enabled,
    staleTime: 60_000,
  });
}

export function useProjectImport(
  groupSlug: string,
  projectSlug: string,
  enabled = true
) {
  return useQuery({
    queryKey: ["project", groupSlug, projectSlug, "import"],
    queryFn: () =>
      api.get<ProjectImportResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/import`
      ),
    enabled: Boolean(groupSlug && projectSlug && enabled),
    refetchInterval: (query) => {
      const status = query.state.data?.import?.status;
      return status === "pending" || status === "importing" ? 3_000 : false;
    },
  });
}

export function useRepository(groupSlug: string, projectSlug: string) {
  return useQuery({
    queryKey: ["repository", groupSlug, projectSlug],
    queryFn: () =>
      api.get<RepositorySummary>(
        `/groups/${groupSlug}/projects/${projectSlug}/repository`
      ),
    enabled: Boolean(groupSlug && projectSlug),
  });
}

export function useRepositoryTree(
  groupSlug: string,
  projectSlug: string,
  ref: string,
  path: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["repository", groupSlug, projectSlug, "tree", ref, path],
    queryFn: () =>
      api.get<RepositoryTree>(
        `/groups/${groupSlug}/projects/${projectSlug}/repository/tree${qs({ ref, path })}`
      ),
    enabled: Boolean(groupSlug && projectSlug && ref && enabled),
  });
}

export function useRepositoryBlob(
  groupSlug: string,
  projectSlug: string,
  ref: string,
  path: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["repository", groupSlug, projectSlug, "blob", ref, path],
    queryFn: () =>
      api.get<RepositoryBlob>(
        `/groups/${groupSlug}/projects/${projectSlug}/repository/blob${qs({ ref, path })}`
      ),
    enabled: Boolean(groupSlug && projectSlug && ref && path && enabled),
  });
}

export function useRepositoryCommits(
  groupSlug: string,
  projectSlug: string,
  ref: string,
  offset: number
) {
  return useQuery({
    queryKey: ["repository", groupSlug, projectSlug, "commits", ref, offset],
    queryFn: () =>
      api.get<RepositoryCommitList>(
        `/groups/${groupSlug}/projects/${projectSlug}/repository/commits${qs({ ref, limit: 30, offset })}`
      ),
    enabled: Boolean(groupSlug && projectSlug && ref),
  });
}

export function useRepositoryCommit(
  groupSlug: string,
  projectSlug: string,
  sha: string
) {
  return useQuery({
    queryKey: ["repository", groupSlug, projectSlug, "commit", sha],
    queryFn: () =>
      api.get<{ commit: RepositoryCommit }>(
        `/groups/${groupSlug}/projects/${projectSlug}/repository/commits/${sha}`
      ),
    enabled: Boolean(groupSlug && projectSlug && sha),
  });
}

export function useRepositoryReadme(
  groupSlug: string,
  projectSlug: string,
  enabled = true
) {
  return useQuery({
    queryKey: ["repository", groupSlug, projectSlug, "readme"],
    queryFn: () =>
      api.get<RepositoryReadme>(
        `/groups/${groupSlug}/projects/${projectSlug}/repository/readme`
      ),
    enabled: Boolean(groupSlug && projectSlug && enabled),
  });
}

export function useIssues(
  groupSlug: string,
  projectSlug: string,
  params: Record<string, string | number | undefined>
) {
  return useQuery({
    queryKey: ["issues", groupSlug, projectSlug, params],
    queryFn: () =>
      api.get<IssueListResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/issues${qs(params)}`
      ),
    enabled: Boolean(groupSlug && projectSlug),
  });
}

export function useIssue(groupSlug: string, projectSlug: string, iid: number) {
  return useQuery({
    queryKey: ["issue", groupSlug, projectSlug, iid],
    queryFn: () =>
      api.get<{ issue: Issue }>(
        `/groups/${groupSlug}/projects/${projectSlug}/issues/${iid}`
      ),
    enabled: Boolean(groupSlug && projectSlug && iid),
  });
}

export function useIssueNotes(
  groupSlug: string,
  projectSlug: string,
  iid: number
) {
  return useQuery({
    queryKey: ["issue", groupSlug, projectSlug, iid, "notes"],
    queryFn: () =>
      api.get<IssueNotesResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/issues/${iid}/notes`
      ),
    enabled: Boolean(groupSlug && projectSlug && iid),
  });
}

export function useLabels(groupSlug: string, projectSlug: string) {
  return useQuery({
    queryKey: ["labels", groupSlug, projectSlug],
    queryFn: () =>
      api.get<ProjectLabelsResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/labels`
      ),
    enabled: Boolean(groupSlug && projectSlug),
  });
}

export function useMilestones(groupSlug: string, projectSlug: string) {
  return useQuery({
    queryKey: ["milestones", groupSlug, projectSlug],
    queryFn: () =>
      api.get<ProjectMilestonesResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/milestones`
      ),
    enabled: Boolean(groupSlug && projectSlug),
  });
}

export function useBoard(groupSlug: string, projectSlug: string) {
  return useQuery({
    queryKey: ["board", groupSlug, projectSlug],
    queryFn: () =>
      api.get<BoardResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/boards`
      ),
    enabled: Boolean(groupSlug && projectSlug),
  });
}

export function useMergeRequests(
  groupSlug: string,
  projectSlug: string,
  params: Record<string, string | number | undefined>
) {
  return useQuery({
    queryKey: ["merge_requests", groupSlug, projectSlug, params],
    queryFn: () =>
      api.get<MergeRequestListResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/merge_requests${qs(params)}`
      ),
    enabled: Boolean(groupSlug && projectSlug),
  });
}

export function useMergeRequest(
  groupSlug: string,
  projectSlug: string,
  iid: number
) {
  return useQuery({
    queryKey: ["merge_request", groupSlug, projectSlug, iid],
    queryFn: () =>
      api.get<MergeRequestResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/merge_requests/${iid}`
      ),
    enabled: Boolean(groupSlug && projectSlug && iid),
  });
}

export function useMergeRequestNotes(
  groupSlug: string,
  projectSlug: string,
  iid: number
) {
  return useQuery({
    queryKey: ["merge_request", groupSlug, projectSlug, iid, "notes"],
    queryFn: () =>
      api.get<MergeRequestNotesResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/merge_requests/${iid}/notes`
      ),
    enabled: Boolean(groupSlug && projectSlug && iid),
  });
}

export function useMergeRequestDiff(
  groupSlug: string,
  projectSlug: string,
  iid: number,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["merge_request", groupSlug, projectSlug, iid, "diff"],
    queryFn: () =>
      api.get<MergeRequestDiffResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/merge_requests/${iid}/diff`
      ),
    enabled: Boolean(groupSlug && projectSlug && iid && enabled),
  });
}

export function useMergeRequestPatch(
  groupSlug: string,
  projectSlug: string,
  iid: number,
  file: MergeRequestChangedFile | null
) {
  return useQuery({
    queryKey: [
      "merge_request",
      groupSlug,
      projectSlug,
      iid,
      "patch",
      file?.path,
      file?.oldPath,
    ],
    queryFn: () =>
      api.get<MergeRequestPatchResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/merge_requests/${iid}/diff/file${qs(
          {
            path: file?.path,
            oldPath:
              file?.oldPath && file.oldPath !== file.path
                ? file.oldPath
                : undefined,
          }
        )}`
      ),
    enabled: Boolean(groupSlug && projectSlug && iid && file),
  });
}

export function useMergeRequestCommits(
  groupSlug: string,
  projectSlug: string,
  iid: number,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["merge_request", groupSlug, projectSlug, iid, "commits"],
    queryFn: () =>
      api.get<MergeRequestCommitsResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/merge_requests/${iid}/commits`
      ),
    enabled: Boolean(groupSlug && projectSlug && iid && enabled),
  });
}

export function useProjectActivity(
  groupSlug: string,
  projectSlug: string,
  page = 1,
  perPage = 20
) {
  return useQuery({
    queryKey: ["activity", groupSlug, projectSlug, page, perPage],
    queryFn: () =>
      api.get<ProjectActivityResponse>(
        `/groups/${groupSlug}/projects/${projectSlug}/activity${qs({ page, perPage })}`
      ),
    enabled: Boolean(groupSlug && projectSlug),
  });
}

export function useSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", trimmed],
    queryFn: () =>
      api.get<SearchResponse>(`/search${qs({ q: trimmed, limit: 20 })}`),
    enabled: trimmed.length >= 2,
    staleTime: 10_000,
  });
}
