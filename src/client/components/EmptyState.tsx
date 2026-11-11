import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-14 text-center",
        className
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full border border-line bg-canvas text-muted">
        <Icon className="size-5" strokeWidth={1.5} />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-ink">{title}</h3>
      {description ? (
        <div className="mt-1.5 max-w-sm text-[13px] leading-6 text-muted">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
