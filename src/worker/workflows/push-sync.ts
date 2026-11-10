import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { createDatabase } from "@db/client";
import { getGitStorage } from "@worker/artifacts";
import { syncPushEvent } from "@worker/services/git-sync";

export interface PushWorkflowPayload {
  type?: string;
  source?: {
    type?: string;
    namespace?: string;
    repoName?: string;
  };
  payload?: {
    ref?: string;
    before?: string;
    after?: string;
    commits?: unknown[];
  };
  metadata?: {
    eventTimestamp?: string;
  };
}

export class PushSyncWorkflow extends WorkflowEntrypoint<
  Env,
  PushWorkflowPayload
> {
  override async run(
    event: WorkflowEvent<PushWorkflowPayload>,
    step: WorkflowStep
  ): Promise<void> {
    const result = await step.do(
      "sync Artifacts push",
      { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } },
      async () => {
        return syncPushEvent(
          createDatabase(this.env.DB),
          getGitStorage(this.env),
          this.env,
          event.payload,
          event.instanceId
        );
      }
    );
    console.log("artifacts_push_sync_result", result);
  }
}
