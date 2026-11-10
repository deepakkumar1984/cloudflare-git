import { ChevronRight, Download, FileWarning, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRepositoryBlob } from "@/lib/queries";
import { useProjectContext } from "./ProjectLayout";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function RepositoryBlobPage() {
  const { groupSlug = "", projectSlug = "" } = useParams();
  const context = useProjectContext();
  const [searchParams] = useSearchParams();
  const ref =
    searchParams.get("ref") || context.project.defaultBranch || "main";
  const path = searchParams.get("path") || "";
  const blob = useRepositoryBlob(
    groupSlug,
    projectSlug,
    ref,
    path,
    Boolean(path)
  );
  const [preview, setPreview] = useState(false);

  const segments = path.split("/").filter(Boolean);
  const isMarkdown = /\.(md|markdown)$/i.test(path);
  const rawUrl = `/api/v1/groups/${groupSlug}/projects/${projectSlug}/repository/raw?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted">
        <Link
          to={`/groups/${groupSlug}/${projectSlug}/repository?ref=${encodeURIComponent(ref)}`}
          className="rounded px-1.5 py-0.5 hover:bg-canvas hover:text-ink"
        >
          {context.project.name}
        </Link>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const segmentPath = segments.slice(0, index + 1).join("/");
          return (
            <span
              key={`${segment}-${index}`}
              className="flex items-center gap-1"
            >
              <ChevronRight className="size-3 text-faint" />
              {isLast ? (
                <span className="px-1.5 py-0.5 text-ink">{segment}</span>
              ) : (
                <Link
                  to={`/groups/${groupSlug}/${projectSlug}/repository?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(segmentPath)}`}
                  className="rounded px-1.5 py-0.5 hover:bg-canvas hover:text-ink"
                >
                  {segment}
                </Link>
              )}
            </span>
          );
        })}
      </div>

      {blob.isLoading ? (
        <div className="h-80 animate-pulse rounded-xl bg-line/30" />
      ) : blob.error ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <FileWarning className="mx-auto size-6 text-faint" />
          <p className="mt-4 text-sm font-semibold">
            This file cannot be displayed
          </p>
          <p className="mt-1 text-[13px] text-muted">
            It may be too large for inline viewing, or the path no longer
            exists.
          </p>
          <Button asChild variant="secondary" className="mt-4">
            <a href={rawUrl}>
              <Download className="size-4" />
              Download raw file
            </a>
          </Button>
        </div>
      ) : blob.data ? (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] font-medium text-ink">
                {segments.at(-1)}
              </span>
              <Badge tone="outline">{formatBytes(blob.data.size)}</Badge>
              <span className="hidden font-mono text-[10px] text-faint sm:inline">
                {blob.data.mode}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {isMarkdown ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreview((value) => !value)}
                >
                  {preview ? "View source" : "Preview"}
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <a href={rawUrl}>
                  <Download className="size-3.5" />
                  Raw
                </a>
              </Button>
            </div>
          </div>

          {blob.data.binary ? (
            <div className="px-6 py-14 text-center">
              <FileWarning className="mx-auto size-6 text-faint" />
              <p className="mt-3 text-sm font-medium">Binary file</p>
              <p className="mt-1 text-[12px] text-muted">
                {blob.data.mime} · {formatBytes(blob.data.size)}
              </p>
              <Button asChild variant="secondary" className="mt-4">
                <a href={rawUrl}>
                  <Download className="size-4" />
                  Download
                </a>
              </Button>
            </div>
          ) : preview && isMarkdown ? (
            <div className="px-6 py-6">
              <Markdown>{blob.data.text || ""}</Markdown>
            </div>
          ) : (
            <div className="code-view max-h-[70vh]">
              <table>
                <tbody>
                  {(blob.data.text || "").split("\n").map((line, index) => (
                    <tr key={index}>
                      <td className="line-number">{index + 1}</td>
                      <td className="line-code">{line || " "}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line bg-canvas/40 px-4 py-2 font-mono text-[10px] text-faint">
            <span>{blob.data.sha.slice(0, 12)}</span>
            <span>{blob.data.mime}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-20 text-muted">
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
    </div>
  );
}
