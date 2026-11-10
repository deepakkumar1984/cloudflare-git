import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
        404
      </p>
      <h1 className="mt-4 font-display text-5xl tracking-[-0.04em]">
        This page is not here.
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-6 text-muted">
        The link may be stale, or the project may be private.
      </p>
      <Button asChild variant="primary" className="mt-6">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
