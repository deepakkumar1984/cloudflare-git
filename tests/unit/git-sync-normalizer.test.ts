import { describe, expect, it } from "vitest";
import { normalizePushEvent } from "@worker/services/git-sync";

const commit = {
  id: "c".repeat(40),
  message: "Change things",
  author: { name: "A", email: "a@example.com" },
  committer: { name: "C", email: "c@example.com" },
  timestamp: "2026-01-01T10:00:00.000Z",
  parents: ["a".repeat(40)],
};

const innerPayload = {
  type: "cf.artifacts.repo.pushed",
  ref: "refs/heads/main",
  before: "a".repeat(40),
  after: "b".repeat(40),
  commits: [commit],
  commitsTruncated: true,
  source: { namespace: "deesha-git", repoName: "p-abc123" },
  metadata: { eventTimestamp: "2026-01-02T00:00:00.000Z" },
};

describe("normalizePushEvent", () => {
  it("normalizes the full Artifacts event envelope", () => {
    const event = normalizePushEvent({
      ...innerPayload,
      payload: {
        ref: innerPayload.ref,
        before: innerPayload.before,
        after: innerPayload.after,
        commits: innerPayload.commits,
      },
    });
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      namespace: "deesha-git",
      repoName: "p-abc123",
      ref: "refs/heads/main",
      before: "a".repeat(40),
      after: "b".repeat(40),
      commitsTruncated: true,
    });
    expect(event?.commits[0]).toMatchObject({
      hash: "c".repeat(40),
      message: "Change things",
      author: { name: "A", email: "a@example.com" },
      committer: { name: "C", email: "c@example.com" },
      parents: ["a".repeat(40)],
    });
    expect(event?.commits[0]?.authoredAt.toISOString()).toBe(
      "2026-01-01T10:00:00.000Z"
    );
    expect(event?.eventTimestamp.toISOString()).toBe(
      "2026-01-02T00:00:00.000Z"
    );
  });

  it("accepts an inner payload without an outer type", () => {
    const event = normalizePushEvent({
      repoName: "p-abc123",
      ref: "refs/heads/feature",
      before: "a".repeat(40),
      after: "b".repeat(40),
      commits: [commit],
    });
    expect(event?.repoName).toBe("p-abc123");
    expect(event?.ref).toBe("refs/heads/feature");
    expect(event?.namespace).toBeNull();
  });

  it("accepts a Workflow event that wraps the Artifacts event", () => {
    const event = normalizePushEvent({
      payload: {
        ...innerPayload,
        payload: {
          ref: innerPayload.ref,
          after: innerPayload.after,
        },
      },
    });
    expect(event?.repoName).toBe("p-abc123");
    expect(event?.ref).toBe("refs/heads/main");
  });

  it("rejects payloads without a repo, ref, or after SHA", () => {
    expect(normalizePushEvent({})).toBeNull();
    expect(normalizePushEvent(null)).toBeNull();
    expect(
      normalizePushEvent({ repoName: "p-abc", ref: "refs/heads/main" })
    ).toBeNull();
  });

  it("falls back to the current time for invalid timestamps", () => {
    const event = normalizePushEvent({
      ...innerPayload,
      metadata: { eventTimestamp: "not-a-date" },
    });
    expect(event).not.toBeNull();
    expect(Date.now() - event!.eventTimestamp.getTime()).toBeLessThan(5_000);
  });
});
