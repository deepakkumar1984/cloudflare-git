import type { Context } from "hono";
import type { ZodType } from "zod";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, "BAD_REQUEST", message, details);
}

export function unauthorized(message = "Sign in required"): AppError {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(
  message = "You do not have access to this resource"
): AppError {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(message = "Not found"): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflict(message: string): AppError {
  return new AppError(409, "CONFLICT", message);
}

const UNIQUE_TARGETS: Record<string, string> = {
  groups_slug_uq: "groups.slug",
  projects_group_slug_uq: "projects.group_id, projects.slug",
  group_members_group_user_uq: "group_members.group_id, group_members.user_id",
  project_members_project_user_uq:
    "project_members.project_id, project_members.user_id",
  labels_project_title_uq: "labels.project_id, labels.title",
  milestones_project_title_uq: "milestones.project_id, milestones.title",
  project_imports_active_uq: "project_imports.project_id",
};

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as {
      message?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (typeof record.code === "string") parts.push(record.code);
    if (typeof record.message === "string") parts.push(record.message);
    current = record.cause;
  }
  return parts.join("\n");
}

export function isUniqueViolation(
  error: unknown,
  constraint?: string
): boolean {
  const text = errorText(error);
  const unique =
    text.includes("UNIQUE constraint failed") ||
    text.includes("SQLITE_CONSTRAINT") ||
    text.includes("23505");
  if (!unique) return false;
  if (!constraint) return true;
  const target = (UNIQUE_TARGETS[constraint] ?? constraint).replaceAll(" ", "");
  return text.replaceAll(" ", "").includes(target) || text.includes(constraint);
}

export function tooLarge(message: string): AppError {
  return new AppError(413, "TOO_LARGE", message);
}

export function tooManyRequests(
  message = "Too many requests. Try again shortly.",
  retryAfterSeconds?: number
): AppError {
  return new AppError(
    429,
    "RATE_LIMITED",
    message,
    retryAfterSeconds === undefined ? undefined : { retryAfterSeconds }
  );
}

export async function readJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Invalid request body",
      parsed.error.issues
    );
  }
  return parsed.data;
}

export function readQuery<T>(c: Context, schema: ZodType<T>): T {
  const input = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Invalid query parameters",
      parsed.error.issues
    );
  }
  return parsed.data;
}
