import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth";
import { useMe } from "@/lib/queries";
import { ThemeToggle } from "@/components/ThemeToggle";

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-line bg-canvas px-3 py-2 text-[12px] text-muted">
      {children}
    </p>
  );
}

export function SettingsPage() {
  const { data } = useMe();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profilePending, setProfilePending] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordPending, setPasswordPending] = useState(false);

  useEffect(() => {
    if (!data) return;
    setName(data.user.name);
    setUsername(data.user.username || "");
  }, [data]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setProfilePending(true);
    setProfileMessage(null);
    setProfileError(null);
    try {
      const result = await authClient.updateUser({
        name: name.trim(),
        username: username.trim(),
      });
      if (result.error) {
        setProfileError(result.error.message || "Could not save profile");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setProfileMessage("Profile updated.");
    } catch {
      setProfileError("Could not reach the server.");
    } finally {
      setProfilePending(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordPending(true);
    setPasswordMessage(null);
    setPasswordError(null);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setPasswordError(result.error.message || "Could not change password");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMessage("Password changed. Other sessions were signed out.");
    } catch {
      setPasswordError("Could not reach the server.");
    } finally {
      setPasswordPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <header>
        <p className="mono-label mb-3">Settings</p>
        <h1 className="font-display text-[38px] leading-none tracking-[-0.04em]">
          Your account.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
          Identity, password, and display preferences for this instance.
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-canvas text-muted">
            <UserRound className="size-4" />
          </span>
          <div>
            <CardTitle>Profile</CardTitle>
            <p className="mt-0.5 text-[12px] text-muted">
              How your name appears across projects.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-username">Username</Label>
                <Input
                  id="profile-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={data?.user.email || ""} disabled />
            </div>
            {profileMessage ? (
              <p className="text-[12px] text-green">{profileMessage}</p>
            ) : null}
            {profileError ? (
              <p className="text-[12px] text-red">{profileError}</p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={profilePending}>
                {profilePending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Save profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-canvas text-muted">
            <LockKeyhole className="size-4" />
          </span>
          <div>
            <CardTitle>Password</CardTitle>
            <p className="mt-0.5 text-[12px] text-muted">
              Changing your password signs out other sessions.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="next-password">New password</Label>
                <Input
                  id="next-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </div>
            </div>
            {passwordMessage ? (
              <p className="text-[12px] text-green">{passwordMessage}</p>
            ) : null}
            {passwordError ? (
              <p className="text-[12px] text-red">{passwordError}</p>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="secondary"
                disabled={passwordPending}
              >
                {passwordPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Change password
              </Button>
            </div>
          </form>
          <div className="mt-4">
            <Notice>
              Password reset email is not configured in this milestone. If you
              lose this password, an operator must reset it directly.
            </Notice>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-canvas text-muted">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <CardTitle>Security & appearance</CardTitle>
            <p className="mt-0.5 text-[12px] text-muted">
              Session and theme preferences.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">Signed in as</span>
            <Badge tone={data?.user.isAdmin ? "accent" : "outline"}>
              {data?.user.isAdmin ? "admin" : "member"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">Theme</span>
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
