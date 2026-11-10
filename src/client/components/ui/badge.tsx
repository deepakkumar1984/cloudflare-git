import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5",
  {
    variants: {
      tone: {
        neutral: "border-line bg-canvas text-muted",
        accent: "border-accent/25 bg-accent-soft text-accent-strong",
        green: "border-green/20 bg-green-soft text-green",
        red: "border-red/20 bg-red-soft text-red",
        blue: "border-blue/20 bg-blue-soft text-blue",
        outline: "border-line-strong bg-transparent text-muted",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
