import {
  ArrowUpRight,
  GitBranch,
  GitPullRequest,
  CircleDot,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function AuthLayout({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <aside className="relative hidden overflow-hidden bg-[#1b1712] p-10 text-[#f4eee4] lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(244,238,228,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(244,238,228,.16) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage:
              "radial-gradient(circle at 30% 40%, black, transparent 72%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-24 size-80 rounded-full bg-[#bd5d18]/20 blur-3xl"
        />

        <Link to="/" className="relative flex items-center gap-2.5">
          <img src="/mark.svg" alt="" className="size-9 rounded-[10px]" />
          <span className="font-display text-2xl font-semibold tracking-[-0.03em]">
            Deesha
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#b8ab9b]">
            git
          </span>
        </Link>

        <div className="relative my-auto max-w-xl py-16">
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#ef9d55]">
            Code · Issues · Reviews
          </p>
          <h1 className="text-balance font-display text-5xl leading-[1.03] tracking-[-0.035em] xl:text-6xl">
            A quieter place to move work forward.
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-7 text-[#c9bfb1]">
            Groups, projects, issues, and merge requests on top of Git storage
            that lives on Cloudflare Artifacts.
          </p>

          <div className="mt-12 grid max-w-lg grid-cols-2 gap-3">
            {[
              { icon: GitBranch, label: "Git-native", value: "clone · push" },
              { icon: CircleDot, label: "Issues", value: "boards · tasks" },
              {
                icon: GitPullRequest,
                label: "Reviews",
                value: "diffs · approvals",
              },
              { icon: ArrowUpRight, label: "Activity", value: "one timeline" },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3.5"
              >
                <item.icon className="mb-3 size-4 text-[#ef9d55]" />
                <p className="text-[13px] font-medium">{item.label}</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#8f8578]">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative font-mono text-[10px] uppercase tracking-[0.16em] text-[#81766a]">
          Built on Cloudflare Workers · Artifacts · Hyperdrive
        </p>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <img src="/mark.svg" alt="" className="size-9 rounded-[10px]" />
            <span className="font-display text-2xl font-semibold tracking-[-0.03em]">
              Deesha
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
              git
            </span>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-[34px] leading-tight tracking-[-0.035em] text-ink">
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
