import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { useMe, useProjectMembers } from "@/lib/queries";
import type { Role } from "@shared/constants";
import { ROLE_LABELS, ROLES } from "@shared/constants";
import { roleTone } from "@/lib/utils";

export function ProjectMembersPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const membersQuery = useProjectMembers(groupSlug, projectSlug);
  const me = useMe();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<Role>("reporter");

  const members = membersQuery.data?.members ?? [];
  const canManage = Boolean(membersQuery.data?.canManage);

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ["project", groupSlug, projectSlug, "members"],
    });
  }

  const addMember = useMutation({
    mutationFn: () =>
      api.post(`/groups/${groupSlug}/projects/${projectSlug}/members`, {
        identifier,
        role,
      }),
    onSuccess: async () => {
      toast.success("Direct member added");
      setAddOpen(false);
      setIdentifier("");
      setRole("reporter");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateRole = useMutation({
    mutationFn: ({ userId, nextRole }: { userId: string; nextRole: Role }) =>
      api.patch(
        `/groups/${groupSlug}/projects/${projectSlug}/members/${userId}`,
        { role: nextRole }
      ),
    onSuccess: async () => {
      toast.success("Role updated");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api.delete(
        `/groups/${groupSlug}/projects/${projectSlug}/members/${userId}`
      ),
    onSuccess: async () => {
      toast.success("Direct membership removed");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">Members</h1>
        {canManage ? (
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add direct member
          </Button>
        ) : null}
      </header>

      <div className="flex items-center justify-between rounded-lg border border-line bg-canvas px-4 py-3 text-[12px] text-muted">
        <span>
          Need to change inherited access?{" "}
          <Link
            to={`/groups/${groupSlug}/members`}
            className="font-medium text-accent hover:underline"
          >
            Manage the group.
          </Link>
        </span>
        <Users className="size-4 text-faint" />
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="grid grid-cols-[minmax(0,1fr)_130px_150px] gap-3 border-b border-line bg-canvas/50 px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint sm:grid-cols-[minmax(0,1fr)_150px_170px]">
          <span>Member</span>
          <span>Effective role</span>
          <span className="text-right">Source</span>
        </div>
        {membersQuery.isLoading ? (
          <div className="divide-y divide-line">
            {[1, 2, 3].map((key) => (
              <div key={key} className="h-16 animate-pulse bg-line/20" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">
            No members have access yet.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {members.map((member) => {
              const isSelf = member.user.id === me.data?.user.id;
              const direct = member.source === "project";
              return (
                <div
                  key={member.user.id}
                  className="grid grid-cols-[minmax(0,1fr)_130px_150px] items-center gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_150px_170px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      name={member.user.name}
                      src={member.user.image}
                      className="size-8"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {member.user.name}
                        {isSelf ? (
                          <span className="ml-1.5 text-[10px] text-faint">
                            (you)
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[11px] text-faint">
                        @
                        {member.user.displayUsername ||
                          member.user.username ||
                          "user"}
                      </p>
                    </div>
                  </div>

                  {canManage && direct ? (
                    <select
                      value={member.role}
                      onChange={(event) =>
                        updateRole.mutate({
                          userId: member.user.id,
                          nextRole: event.target.value as Role,
                        })
                      }
                      disabled={updateRole.isPending}
                      className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[12px]"
                      aria-label={`Role for ${member.user.name}`}
                    >
                      {ROLES.map((value) => (
                        <option key={value} value={value}>
                          {ROLE_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone={roleTone(member.role)}>{member.role}</Badge>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <Badge tone={member.source === "both" ? "blue" : "outline"}>
                      {member.source === "group"
                        ? "group"
                        : member.source === "both"
                          ? "group + direct"
                          : "direct"}
                    </Badge>
                    {canManage && direct && !isSelf ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${member.user.name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove the direct project membership for ${member.user.name}?`
                            )
                          ) {
                            removeMember.mutate(member.user.id);
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a direct member</DialogTitle>
            <DialogDescription>
              Direct membership can raise a user's effective role above what
              they inherit from the group.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addMember.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="project-member">Username or email</Label>
              <Input
                id="project-member"
                autoFocus
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="ada or ada@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-member-role">Role</Label>
              <select
                id="project-member-role"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={addMember.isPending}
              >
                {addMember.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UserPlus className="size-4" />
                )}
                Add member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
