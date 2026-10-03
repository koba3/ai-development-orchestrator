import type { ProjectRouteResult } from "./project.types.js";

export interface RoutingInput {
  text: string;
  context: {
    workspaceId?: string;
    channelId?: string;
  };
}

export interface ProjectRouting {
  resolve(input: RoutingInput): ProjectRouteResult;
}
