import { ROLE_RANK, type Role, type Visibility } from "./constants";

export function roleRank(role: Role | null | undefined): number {
  return role ? ROLE_RANK[role] : 0;
}

export function maxRole(...roles: Array<Role | null | undefined>): Role | null {
  let best: Role | null = null;
  for (const role of roles) {
    if (role && (!best || ROLE_RANK[role] > ROLE_RANK[best])) best = role;
  }
  return best;
}

export function atLeast(
  role: Role | null | undefined,
  minimum: Role
): role is Role {
  return roleRank(role) >= ROLE_RANK[minimum];
}

export function effectiveRole(input: {
  projectRole?: Role | null;
  groupRole?: Role | null;
  isAdmin?: boolean;
}): Role | null {
  if (input.isAdmin) return "owner";
  return maxRole(input.projectRole, input.groupRole);
}

export function canViewProject(
  role: Role | null,
  visibility: Visibility,
  authenticated: boolean
): boolean {
  if (role) return true;
  return visibility === "internal" && authenticated;
}

export function canViewCode(role: Role | null): boolean {
  return atLeast(role, "reporter");
}

export function canComment(role: Role | null): boolean {
  return atLeast(role, "guest");
}

export function canCreateIssue(role: Role | null): boolean {
  return atLeast(role, "reporter");
}

export function canEditIssue(role: Role | null, isAuthor: boolean): boolean {
  if (atLeast(role, "developer")) return true;
  return isAuthor && atLeast(role, "reporter");
}

export function canViewConfidential(role: Role | null): boolean {
  return atLeast(role, "reporter");
}

export function canReadGit(role: Role | null): boolean {
  return atLeast(role, "reporter");
}

export function canWriteGit(role: Role | null): boolean {
  return atLeast(role, "developer");
}

export function canCreateMergeRequest(role: Role | null): boolean {
  return atLeast(role, "developer");
}

export function canReview(role: Role | null): boolean {
  return atLeast(role, "developer");
}

export function canManageLabels(role: Role | null): boolean {
  return atLeast(role, "maintainer");
}

export function canManageMilestones(role: Role | null): boolean {
  return atLeast(role, "maintainer");
}

export function canManageBoard(role: Role | null): boolean {
  return atLeast(role, "maintainer");
}

export function canManageReleases(role: Role | null): boolean {
  return atLeast(role, "maintainer");
}

export function canManageProjectSettings(role: Role | null): boolean {
  return atLeast(role, "maintainer");
}

export function canManageProjectMembers(role: Role | null): boolean {
  return atLeast(role, "owner");
}

export function canArchiveProject(role: Role | null): boolean {
  return atLeast(role, "owner");
}

export function canCreateProject(role: Role | null): boolean {
  return atLeast(role, "maintainer");
}

export function canManageGroup(role: Role | null): boolean {
  return atLeast(role, "owner");
}

export function canManageGroupMembers(role: Role | null): boolean {
  return atLeast(role, "owner");
}

export function canMarkMerged(role: Role | null): boolean {
  return atLeast(role, "maintainer");
}

export function canDeleteNote(role: Role | null, isAuthor: boolean): boolean {
  return atLeast(role, "maintainer") || (isAuthor && atLeast(role, "guest"));
}
