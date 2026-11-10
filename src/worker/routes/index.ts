import type { Hono } from "hono";
import type { AppEnv } from "@worker/env";
import { boardRoutes } from "./boards";
import { groupRoutes } from "./groups";
import { integrationRoutes } from "./integrations";
import { issueRoutes } from "./issues";
import { labelRoutes } from "./labels";
import { milestoneRoutes } from "./milestones";
import { meRoutes } from "./me";
import { mergeRequestRoutes } from "./merge-requests";
import { projectImportRoutes } from "./project-imports";
import { projectRoutes } from "./projects";
import { repositoryRoutes } from "./repository";
import { searchRoutes } from "./search";

const routeModules = [
  meRoutes,
  groupRoutes,
  integrationRoutes,
  projectImportRoutes,
  projectRoutes,
  repositoryRoutes,
  issueRoutes,
  mergeRequestRoutes,
  boardRoutes,
  labelRoutes,
  milestoneRoutes,
  searchRoutes,
];

export function mountApiRoutes(app: Hono<AppEnv>): void {
  for (const routes of routeModules) {
    app.route("/api/v1", routes);
  }
}
