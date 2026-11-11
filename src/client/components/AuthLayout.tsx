import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  GitPullRequest,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAppName } from "@/lib/meta";

function ReviewPreview() {
  return (
    <div className="mt-12 max-w-md rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-full border border-[#6dc79b]/30 bg-[#6dc79b]/10 text-[#6dc79b]">
          <GitPullRequest className="size-3.5" />
        </span>
        <span className="text-[13px] font-medium text-[#f4eee4]">
          Add webhook retry with backoff
        </span>
        <span className="ml-auto rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-[#aaa398]">
          !42
        </span>
      </div>
      <div className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-[#aaa398]">
        <GitBranch className="size-3" />
        feature/retries
        <ArrowRight className="size-3 text-[#8a847a]" />
        main
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3.5">
        <span className="flex items-center gap-1.5 text-[12px] text-[#c9bfb1]">
          <CheckCircle2 className="size-3.5 text-[#6dc79b]" />2 approvals
        </span>
        <span className="font-mono text-[11px] tabular-nums">
          <span className="text-[#6dc79b]">+48</span>{" "}
          <span className="text-[#f08d83]">−12</span>
        </span>
      </div>
    </div>
  );
}

export function AuthLayout({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
  const appName = useAppName();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <aside className="relative hidden overflow-hidden bg-[#1b1712] p-10 text-[#f4eee4] lg:flex lg:flex-col">
        <Link to="/" className="relative flex items-center gap-2.5">
          <img src="/mark.svg" alt="" className="size-9 rounded-[10px]" />
          <span className="font-display text-2xl font-semibold tracking-[-0.03em]">
            {appName}
          </span>
        </Link>

        <div className="relative my-auto max-w-xl py-16">
          <p className="mb-5 font-mono text-[12px] text-[#ef9d55]">
            Code · Issues · Reviews
          </p>
          <h1 className="text-balance font-display text-5xl leading-[1.05] tracking-[-0.03em] xl:text-6xl">
            A quieter place to move work forward.
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-7 text-[#c9bfb1]">
            Groups, projects, issues, and merge requests on top of Git storage
            that lives on Cloudflare Artifacts.
          </p>

          <ReviewPreview />
        </div>

        <p className="relative font-mono text-[11px] text-[#81766a]">
          Built on Cloudflare Workers · Artifacts · D1
        </p>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <img src="/mark.svg" alt="" className="size-9 rounded-[10px]" />
            <span className="font-display text-2xl font-semibold tracking-[-0.03em]">
              {appName}
            </span>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-[34px] leading-tight tracking-[-0.03em] text-ink">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
