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

export function isUniqueViolation(
  error: unknown,
  constraint?: string
): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    constraint_name?: unknown;
    constraint?: unknown;
    message?: unknown;
  };
  if (candidate.code !== "23505") return false;
  if (!constraint) return true;
  return (
    candidate.constraint_name === constraint ||
    candidate.constraint === constraint ||
    (typeof candidate.message === "string" &&
      candidate.message.includes(constraint))
  );
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
