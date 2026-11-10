import { Construction } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function PlaceholderPage({
  title,
  description,
  backTo = "/",
}: {
  title: string;
  description: string;
  backTo?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-20 text-center">
      <Construction className="mx-auto size-7 text-faint" />
      <h1 className="mt-4 text-sm font-semibold">{title}</h1>
      <p className="mx-auto mt-1 max-w-md text-[13px] leading-6 text-muted">
        {description}
      </p>
      <Button asChild variant="secondary" className="mt-5">
        <Link to={backTo}>Back</Link>
      </Button>
    </div>
  );
}
