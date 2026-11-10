import { useMutation } from "@tanstack/react-query";
import { Check, Clipboard, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api";
import type { CloneCredentials } from "@/lib/types";
import { cn, copyText, dateTime } from "@/lib/utils";

type Scope = "read" | "write";

function CodeRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-muted">{label}</p>
      <div className="flex items-start gap-2 rounded-lg border border-line bg-[#1b1712] p-3 text-[#f4eee4]">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded p-1 text-[#b9ad9e] transition-colors hover:bg-white/10 hover:text-white"
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Clipboard className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

export function CloneDialog({
  open,
  onOpenChange,
  groupSlug,
  projectSlug,
  defaultBranch,
  canWrite,
  ready,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupSlug: string;
  projectSlug: string;
  defaultBranch: string;
  canWrite: boolean;
  ready: boolean;
}) {
  const [scope, setScope] = useState<Scope>("read");
  const [credentials, setCredentials] = useState<CloneCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCredentials(null);
      setError(null);
      setScope("read");
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<CloneCredentials>(
        `/groups/${groupSlug}/projects/${projectSlug}/clone_credentials`,
        { scope }
      ),
    onSuccess: (data) => {
      setCredentials(data);
      setError(null);
    },
    onError: (cause) => setError(errorMessage(cause)),
  });

  const token = credentials?.token;
  const remote = credentials?.remote;
  const cloneCommand = token
    ? `git -c http.extraHeader="Authorization: Bearer ${token}" clone ${remote}`
    : "";
  const pushCommand = token
    ? `git -c http.extraHeader="Authorization: Bearer ${token}" push -u origin ${defaultBranch}`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Clone & push</DialogTitle>
          <DialogDescription>
            Credentials are created only when you ask for them, expire after 30
            minutes, and are shown once. Never commit or share a token.
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <div className="rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-[13px] text-accent-strong">
            The repository is not ready yet. Retry provisioning from the project
            banner first.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-canvas p-1">
              <button
                type="button"
                onClick={() => setScope("read")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                  scope === "read"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-muted hover:text-ink"
                )}
              >
                Read only
              </button>
              <button
                type="button"
                onClick={() => setScope("write")}
                disabled={!canWrite}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  scope === "write"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-muted hover:text-ink"
                )}
              >
                Read & write
              </button>
            </div>

            {!credentials ? (
              <div className="rounded-lg border border-line bg-canvas/60 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface">
                    <KeyRound className="size-4 text-accent" />
                  </span>
                  <div>
                    <p className="text-[13px] font-medium">
                      Generate a short-lived credential
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-muted">
                      {scope === "write"
                        ? "Write credentials can push to any branch, including the default branch."
                        : "Read credentials can clone, fetch, and pull."}
                    </p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  className="mt-4"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <KeyRound className="size-4" />
                  )}
                  Generate credential
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <Badge
                    tone={credentials.scope === "write" ? "accent" : "neutral"}
                  >
                    {credentials.scope}
                  </Badge>
                  <span>Expires {dateTime(credentials.expiresAt)}</span>
                </div>

                <CodeRow
                  label={
                    scope === "write" ? "Push to an existing checkout" : "Clone"
                  }
                  value={scope === "write" ? pushCommand : cloneCommand}
                />
                <CodeRow label="Remote" value={remote ?? ""} />

                <div className="flex items-start gap-2 rounded-lg border border-red/20 bg-red-soft px-3 py-2.5 text-[12px] leading-5 text-red">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                  <p>
                    This token is visible in the command. Keep it out of shell
                    history if the machine is shared, and close this dialog when
                    you are done.
                  </p>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCredentials(null);
                    mutation.mutate();
                  }}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Generate another
                </Button>
              </div>
            )}

            {error ? (
              <p className="rounded-md border border-red/20 bg-red-soft px-3 py-2 text-[12px] text-red">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
