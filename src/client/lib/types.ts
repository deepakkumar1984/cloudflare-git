import type { GitProvider, Role, Visibility } from "@shared/constants";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  username: string | null;
  displayUsername: string | null;
  isAdmin: boolean;
  createdAt: string;
}

export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: Visibility;
  personal: boolean;
  archivedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  role: Role | null;
}

export interface MeResponse {
  user: CurrentUser;
  artifactsFake: boolean;
  groups: GroupSummary[];
}

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: Visibility;
  defaultBranch: string;
  provisioningState: "pending" | "ready" | "failed";
  provisioningError?: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  role: Role | null;
  canWrite: boolean;
  canAdmin: boolean;
}

export interface GroupProject {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: Visibility;
  defaultBranch: string;
  provisioningState: "pending" | "ready" | "failed";
  archivedAt: string | null;
  updatedAt: string;
  role: Role | null;
}

export interface GroupPageResponse {
  group: GroupSummary & {
    canManage: boolean;
    canCreateProject: boolean;
  };
  projects: GroupProject[];
}

export interface ProjectPageResponse {
  group: {
    id: string;
    slug: string;
    name: string;
    visibility: Visibility;
    archivedAt: string | null;
  };
  project: ProjectSummary & {
    artifactsRemote: string | null;
    openIssues: number;
    openMergeRequests: number;
    branches: number;
  };
  canManageSettings: boolean;
  canManageMembers: boolean;
  canArchive: boolean;
  canReadGit: boolean;
  canWriteGit: boolean;
  latestImport: ProjectImportSummary | null;
}

export interface DashboardIssue {
  iid: number;
  title: string;
  state: "opened" | "closed";
  updatedAt: string;
  projectSlug: string;
  projectName: string;
  groupSlug: string;
  confidential: boolean;
}

export interface DashboardMr {
  iid: number;
  title: string;
  state: "opened" | "merged" | "closed";
  updatedAt: string;
  projectSlug: string;
  projectName: string;
  groupSlug: string;
}

export interface DashboardProject {
  slug: string;
  name: string;
  description: string;
  updatedAt: string;
  groupSlug: string;
  groupName: string;
}

export interface DashboardActivity {
  id: string;
  action: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  targetIid: number | null;
  projectSlug: string | null;
  projectName: string | null;
  groupSlug: string | null;
  actorName: string | null;
  actorUsername: string | null;
}

export interface DashboardResponse {
  assignedIssues: DashboardIssue[];
  reviewRequests: DashboardMr[];
  recentProjects: DashboardProject[];
  activity: DashboardActivity[];
}

export interface MemberUser {
  id: string;
  name: string;
  username: string | null;
  displayUsername: string | null;
  email: string;
  image: string | null;
}

export interface Member {
  user: MemberUser;
  role: Role;
  source?: "group" | "project" | "both";
  createdAt?: string;
}

export interface GroupMembersResponse {
  members: Member[];
  canManage: boolean;
}

export interface ProjectMembersResponse {
  members: Member[];
  canManage: boolean;
}

export interface CloneCredentials {
  remote: string;
  username: string;
  token: string;
  scope: "read" | "write";
  expiresAt: string;
}

export interface ProviderConnection {
  provider: GitProvider;
  username: string;
  name: string | null;
  externalUserId: string;
  connectedAt: string;
}

export interface ProviderConnectionsResponse {
  connections: ProviderConnection[];
}

export interface ProviderRepository {
  id: string;
  path: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  remoteUrl: string;
  webUrl: string;
  updatedAt: string | null;
}

export interface ProviderRepositoriesResponse {
  repositories: ProviderRepository[];
  hasMore: boolean;
  page: number;
}

export type ProjectImportStatus = "pending" | "importing" | "ready" | "failed";

export interface ProjectImportSummary {
  id: string;
  provider: GitProvider;
  externalRepo: string;
  branch: string | null;
  depth: number | null;
  repositoryPrivate: boolean;
  status: ProjectImportStatus;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ProjectImportResponse {
  import: ProjectImportSummary | null;
  canReimport: boolean;
}

export interface ProjectImportCreatedResponse {
  project: ProjectSummary;
  import: ProjectImportSummary;
}

export interface RepositoryBranch {
  name: string;
  sha: string;
  updatedAt: string;
  commit: {
    hash: string;
    message: string;
    author: { name: string; email: string };
    committedAt: string;
  } | null;
}

export interface RepositorySummary {
  defaultBranch: string;
  provisioningState: "pending" | "ready" | "failed";
  remote: string | null;
  branches: RepositoryBranch[];
  isEmpty: boolean;
}

export interface RepositoryTreeEntry {
  name: string;
  path: string;
  type: "tree" | "file";
  mode: string;
  hash: string;
}

export interface RepositoryTree {
  ref: string;
  sha: string;
  path: string;
  truncated: boolean;
  entries: RepositoryTreeEntry[];
  commit: {
    hash: string;
    message: string;
    authoredAt: string;
    author: { name: string; email: string };
  };
}

export interface RepositoryBlob {
  ref: string;
  sha: string;
  commit: string;
  path: string;
  hash: string;
  mode: string;
  size: number;
  mime: string;
  binary: boolean;
  text: string | null;
}

export interface RepositoryCommit {
  hash: string;
  message: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  parents: string[];
  authoredAt: string;
  committedAt: string;
}

export interface RepositoryCommitList {
  ref: string;
  commits: RepositoryCommit[];
  hasMore: boolean;
}

export interface RepositoryReadme {
  readme: { path: string; content: string } | null;
}

export interface IssueLabel {
  id: string;
  title: string;
  color: string;
}

export interface IssueMilestone {
  id: string;
  title: string;
  state: string;
}

export interface Issue {
  id: string;
  iid: number;
  title: string;
  description: string;
  state: "opened" | "closed";
  confidential: boolean;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: MemberUser;
  milestone: IssueMilestone | null;
  labels: IssueLabel[];
  assignees: MemberUser[];
  checklist: { total: number; completed: number };
  canEdit: boolean;
}

export interface IssueListResponse {
  issues: Issue[];
  total: number;
  page: number;
  perPage: number;
}

export interface Note {
  id: string;
  body: string;
  system: boolean;
  createdAt: string;
  updatedAt: string;
  author: MemberUser | null;
}

export interface IssueNotesResponse {
  notes: Note[];
}

export interface ProjectLabel extends IssueLabel {
  projectId: string;
  description: string;
  openIssues: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectLabelsResponse {
  labels: ProjectLabel[];
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  dueDate: string | null;
  state: "active" | "closed";
  stats: { total: number; closed: number; open: number };
}

export interface ProjectMilestonesResponse {
  milestones: ProjectMilestone[];
}

export interface BoardIssue {
  id: string;
  iid: number;
  title: string;
  confidential: boolean;
  updatedAt: string;
  labels: IssueLabel[];
  assignees: MemberUser[];
}

export interface BoardList {
  id: string;
  name: string;
  position: number;
  label: IssueLabel;
  issues: BoardIssue[];
}

export interface BoardResponse {
  board: { id: string; name: string };
  lists: BoardList[];
  unlisted: BoardIssue[];
  canManage: boolean;
}

export type MergeRequestState = "opened" | "merged" | "closed";

export interface MergeRequestSummary {
  id: string;
  iid: number;
  title: string;
  state: MergeRequestState;
  draft: boolean;
  sourceBranch: string;
  targetBranch: string;
  mergeDetection:
    | "none"
    | "fast_forward"
    | "merge_commit"
    | "heuristic"
    | "manual";
  createdAt: string;
  updatedAt: string;
  author: MemberUser;
  milestone: IssueMilestone | null;
  reviewers: Array<MemberUser & { state: string }>;
  approvalCount: number;
}

export interface MergeRequestListResponse {
  mergeRequests: MergeRequestSummary[];
  total: number;
  page: number;
  perPage: number;
}

export interface MergeRequestReviewer extends MemberUser {
  state: "pending" | "approved" | "changes_requested";
  requestedAt: string;
  reviewedAt: string | null;
}

export interface MergeRequest {
  id: string;
  iid: number;
  title: string;
  description: string;
  state: MergeRequestState;
  draft: boolean;
  sourceBranch: string;
  targetBranch: string;
  baseSha: string | null;
  headSha: string | null;
  targetSha: string | null;
  sourceSha: string | null;
  currentTargetSha: string | null;
  sourceBranchExists: boolean;
  mergeCommitSha: string | null;
  mergeDetection:
    | "none"
    | "fast_forward"
    | "merge_commit"
    | "heuristic"
    | "manual";
  mergedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: MemberUser;
  milestone: IssueMilestone | null;
  assignees: MemberUser[];
  reviewers: MergeRequestReviewer[];
  approvalCount: number;
  canEdit: boolean;
  canReview: boolean;
  canMarkMerged: boolean;
  approvalFromViewer: boolean;
}

export interface MergeRequestResponse {
  mergeRequest: MergeRequest;
}

export interface MergeRequestNote extends Note {}

export interface MergeRequestNotesResponse {
  notes: MergeRequestNote[];
}

export interface MergeRequestCommit {
  hash: string;
  message: string;
  author: { name: string; email: string };
  committedAt: string;
}

export interface MergeRequestCommitsResponse {
  commits: MergeRequestCommit[];
}

export interface MergeRequestChangedFile {
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed";
  hash: string;
  oldHash: string | null;
}

export interface MergeRequestDiffResponse {
  baseSha: string;
  headSha: string;
  targetSha: string;
  baseOutdated: boolean;
  files: MergeRequestChangedFile[];
  truncated: boolean;
  state: MergeRequestState;
}

export interface MergeRequestPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface MergeRequestFilePatch {
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed";
  binary: boolean;
  tooLarge: boolean;
  additions: number;
  deletions: number;
  hunks: MergeRequestPatchHunk[];
}

export interface MergeRequestPatchResponse {
  patch: MergeRequestFilePatch;
}

export interface SearchProjectResult {
  slug: string;
  name: string;
  description: string;
  updatedAt: string;
  groupSlug: string;
  groupName: string;
}

export interface SearchIssueResult {
  iid: number;
  title: string;
  state: "opened" | "closed";
  updatedAt: string;
  confidential: boolean;
  projectSlug: string;
  projectName: string;
  groupSlug: string;
  groupName: string;
}

export interface SearchMergeRequestResult {
  iid: number;
  title: string;
  state: "opened" | "merged" | "closed";
  updatedAt: string;
  sourceBranch: string;
  targetBranch: string;
  projectSlug: string;
  projectName: string;
  groupSlug: string;
  groupName: string;
}

export interface SearchResponse {
  query: string;
  projects: SearchProjectResult[];
  issues: SearchIssueResult[];
  mergeRequests: SearchMergeRequestResult[];
}

export interface ProjectActivityResponse {
  activity: DashboardActivity[];
  total: number;
  page: number;
  perPage: number;
}
