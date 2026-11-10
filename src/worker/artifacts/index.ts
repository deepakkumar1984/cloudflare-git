import { getFakeGitStorage } from "./fake-storage";
import type { GitStorage } from "./types";
import { WorkerGitStorage } from "./worker-storage";

export function getGitStorage(env: Env): GitStorage {
  if (env.ARTIFACTS_FAKE === "true") {
    return getFakeGitStorage();
  }
  return new WorkerGitStorage(env.ARTIFACTS);
}

export * from "./types";
