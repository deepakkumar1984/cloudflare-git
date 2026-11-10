import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth";
import { USERNAME_RE } from "@shared/constants";

function suggestedUsername(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 30);
}

export function SignUpPage() {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [usernameState, setUsernameState] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.data) return <Navigate to="/" replace />;

  const usernameValid = USERNAME_RE.test(username);

  async function checkUsername() {
    if (!usernameValid) {
      setUsernameState("idle");
      return;
    }
    setUsernameState("checking");
    try {
      const result = await authClient.isUsernameAvailable({ username });
      setUsernameState(
        result.data?.available === false ? "taken" : "available"
      );
    } catch {
      setUsernameState("idle");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!usernameValid) {
      setError(
        "Username must be 3–30 characters: letters, numbers, dots, dashes, underscores."
      );
      return;
    }
    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        username,
      } as Parameters<typeof authClient.signUp.email>[0]);
      if (result.error) {
        setError(result.error.message || "Could not create your account");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate("/", { replace: true });
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account."
      subtitle="Your personal group is created automatically. You can add shared groups and projects right after."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => {
              const value = event.target.value;
              setName(value);
              if (!usernameTouched) {
                setUsername(suggestedUsername(value.replace(/\s+/g, ".")));
              }
            }}
            placeholder="Ada Lovelace"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-faint">
                @
              </span>
              <Input
                id="username"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => {
                  setUsernameTouched(true);
                  setUsername(event.target.value.toLowerCase());
                  setUsernameState("idle");
                }}
                onBlur={checkUsername}
                placeholder="ada"
                className="pl-7 pr-8"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {usernameState === "checking" ? (
                  <Loader2 className="size-3.5 animate-spin text-faint" />
                ) : usernameState === "available" ? (
                  <Check className="size-3.5 text-green" />
                ) : usernameState === "taken" ? (
                  <X className="size-3.5 text-red" />
                ) : null}
              </span>
            </div>
            {usernameState === "taken" ? (
              <p className="text-[11px] text-red">That username is taken.</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                const value = event.target.value;
                setEmail(value);
                if (!usernameTouched && value.includes("@")) {
                  setUsername(suggestedUsername(value.split("@")[0] || ""));
                }
              }}
              placeholder="ada@example.com"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-password">Password</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 10 characters"
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint transition-colors hover:text-ink"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          <p className="text-[11px] text-faint">
            Email verification is disabled in this milestone. Use a real
            password manager.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red/20 bg-red-soft px-3 py-2 text-[13px] text-red"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={pending}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Create account
          {!pending ? <ArrowRight className="size-4" /> : null}
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          to="/sign-in"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
