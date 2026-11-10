import { createApp } from "./app";
import { createDatabase } from "@db/client";
import { getGitStorage } from "./artifacts";
import { reconcileProjectImports } from "./services/project-imports";
import { reconcileStaleProjects } from "./services/reconcile";
import { PushSyncWorkflow } from "./workflows/push-sync";

const app = createApp();

export { PushSyncWorkflow };

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const db = createDatabase(env.DB);
    try {
      await reconcileStaleProjects(db, getGitStorage(env));
      await reconcileProjectImports(db, getGitStorage(env), env);
    } catch (error) {
      console.error("scheduled_reconcile_failed", error);
    }
  },
} satisfies ExportedHandler<Env>;
