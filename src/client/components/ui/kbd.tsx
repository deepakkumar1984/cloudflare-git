import type * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={cn("kbd", className)} {...props} />;
}
