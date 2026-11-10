import { describe, expect, it, vi } from "vitest";
import { notFound } from "@worker/lib/errors";
import { errorResponse } from "@worker/middleware/context";

describe("errorResponse", () => {
  it("keeps structured AppError responses", async () => {
    const response = errorResponse(notFound("Project not found"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Project not found" },
    });
  });

  it("maps a missing Artifacts repository to an actionable 404", async () => {
    const error = Object.assign(new Error("Repository not found: p-123"), {
      code: "NOT_FOUND",
      numericCode: 10200,
      remote: true,
    });

    const response = errorResponse(error);
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("REPOSITORY_UNAVAILABLE");
    expect(body.error.message).toContain("Re-import");
  });

  it("does not leak internal error details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = errorResponse(new Error("secret implementation detail"));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    } finally {
      log.mockRestore();
    }
  });
});
