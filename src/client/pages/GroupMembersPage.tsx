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
import { useGroup, useGroupMembers } from "@/lib/queries";
import type { Role } from "@shared/constants";
import { ROLE_LABELS, ROLES } from "@shared/constants";
import { roleTone } from "@/lib/utils";
import { useMe } from "@/lib/queries";

export function GroupMembersPage() {
  const { groupSlug = "" } = useParams();
  const groupQuery = useGroup(groupSlug);
  const membersQuery = useGroupMembers(groupSlug);
  const me = useMe();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<Role>("reporter");

  const group = groupQuery.data?.group;
  const members = membersQuery.data?.members ?? [];
  const canManage = Boolean(membersQuery.data?.canManage);
  const personal = Boolean(group?.personal);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["group", groupSlug, "members"],
      }),
      queryClient.invalidateQueries({ queryKey: ["group", groupSlug] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
    ]);
  }

  const addMember = useMutation({
    mutationFn: () =>
      api.post(`/groups/${groupSlug}/members`, { identifier, role }),
    onSuccess: async () => {
      toast.success("Member added");
      setAddOpen(false);
      setIdentifier("");
      setRole("reporter");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateRole = useMutation({
    mutationFn: ({ userId, nextRole }: { userId: string; nextRole: Role }) =>
      api.patch(`/groups/${groupSlug}/members/${userId}`, { role: nextRole }),
    onSuccess: async () => {
      toast.success("Role updated");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/groups/${groupSlug}/members/${userId}`),
    onSuccess: async () => {
      toast.success("Member removed");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!groupQuery.isLoading && !group) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
        <p className="text-sm font-semibold">Group not found</p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/groups">Back to groups</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          <Link
            to={`/groups/${groupSlug}`}
            className="text-muted hover:text-ink"
          >
            {group?.name || groupSlug}
          </Link>
          <span className="mx-1.5 text-faint">/</span>
          Members
        </h1>
        {canManage && !personal ? (
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add member
          </Button>
        ) : null}
      </header>

      {personal ? (
        <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-[12px] text-muted">
          This is a personal group. Its membership is fixed to you.
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="grid grid-cols-[minmax(0,1fr)_130px_110px] gap-3 border-b border-line bg-canvas/50 px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint sm:grid-cols-[minmax(0,1fr)_160px_120px]">
          <span>Member</span>
          <span>Role</span>
          <span className="text-right">Actions</span>
        </div>
        {membersQuery.isLoading ? (
          <div className="divide-y divide-line">
            {[1, 2, 3].map((key) => (
              <div key={key} className="h-16 animate-pulse bg-line/20" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Users className="mx-auto size-5 text-faint" />
            <p className="mt-3 text-sm font-medium">No members</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {members.map((member) => {
              const isSelf = member.user.id === me.data?.user.id;
              return (
                <div
                  key={member.user.id}
                  className="grid grid-cols-[minmax(0,1fr)_130px_110px] items-center gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_160px_120px]"
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
                        @{member.user.displayUsername || member.user.username} ·{" "}
                        {member.user.email}
                      </p>
                    </div>
                  </div>

                  {canManage && !personal ? (
                    <select
                      value={member.role}
                      onChange={(event) =>
                        updateRole.mutate({
                          userId: member.user.id,
                          nextRole: event.target.value as Role,
                        })
                      }
                      disabled={updateRole.isPending}
                      className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[12px] text-ink"
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

                  <div className="flex justify-end">
                    {canManage && !personal && !isSelf ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${member.user.name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove ${member.user.name} from this group?`
                            )
                          ) {
                            removeMember.mutate(member.user.id);
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : (
                      <span className="text-[11px] text-faint">
                        {isSelf ? "You" : "—"}
                      </span>
                    )}
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
            <DialogTitle>Add a member</DialogTitle>
            <DialogDescription>
              The user must already have an account. Search by exact username or
              email address.
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
              <Label htmlFor="member-identifier">Username or email</Label>
              <Input
                id="member-identifier"
                autoFocus
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="ada or ada@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-role">Role</Label>
              <select
                id="member-role"
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
