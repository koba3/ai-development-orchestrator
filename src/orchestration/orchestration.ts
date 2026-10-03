import { ProjectRouter } from "../routing/project-router.js";
import type {
  ProjectCatalogFile,
  ProjectRepositoryConfig,
  ProjectRoute,
  ProjectRouteFailureReason,
  WorkspaceConfig,
} from "../routing/project.types.js";
import type { AgentRole, ProjectAgentLink, SlackInputSource } from "./orchestration.types.js";

export interface ProjectDefinition {
  projectId: string;
  name: string;
  repository: ProjectRepositoryConfig;
}

export type OrchestrationFailureReason = ProjectRouteFailureReason | "input-unavailable";

export type OrchestrationConnection =
  | {
      ok: true;
      input: SlackInputSource;
      project: ProjectDefinition;
      route: ProjectRoute;
      agents: ProjectAgentLink[];
    }
  | { ok: false; reason: OrchestrationFailureReason; message: string };

const FALLBACK_EXAMPLE = "#questoon";

export class Orchestration {
  private readonly router: ProjectRouter;
  private readonly inputs: SlackInputSource[];
  private readonly links: ProjectAgentLink[];

  constructor(private readonly catalog: ProjectCatalogFile) {
    this.router = new ProjectRouter(catalog);
    this.inputs = catalog.inputs ?? deriveSlackInputs(catalog.workspaces);
    this.links = catalog.agentLinks ?? deriveCodingLinks(catalog.projects);
  }

  inputSources(): readonly SlackInputSource[] {
    return this.inputs;
  }

  project(projectId: string): ProjectDefinition | null {
    const config = this.catalog.projects[projectId];
    if (!config) {
      return null;
    }
    return { projectId, name: config.name, repository: config.repository };
  }

  agentsFor(projectId: string): ProjectAgentLink[] {
    return this.links.filter((link) => link.projectId === projectId);
  }

  agentFor(projectId: string, role: AgentRole): ProjectAgentLink | null {
    return this.links.find((link) => link.projectId === projectId && link.role === role) ?? null;
  }

  localPathFor(projectId: string): string | null {
    return this.router.localPathFor(projectId);
  }

  connectSlack(input: { workspaceId: string; channelId: string; text: string }): OrchestrationConnection {
    const source = this.inputs.find((item) => item.enabled && item.workspaceId === input.workspaceId);
    if (!source) {
      return { ok: false, reason: "input-unavailable", message: specifyProject(FALLBACK_EXAMPLE) };
    }
    const routed = this.router.resolve(input);
    if (!routed.ok) {
      return routed;
    }
    const project = this.project(routed.route.projectId);
    if (!project) {
      return { ok: false, reason: "unresolved", message: specifyProject(FALLBACK_EXAMPLE) };
    }
    return {
      ok: true,
      input: source,
      project,
      route: routed.route,
      agents: this.agentsFor(project.projectId),
    };
  }
}

function deriveSlackInputs(workspaces: ProjectCatalogFile["workspaces"]): SlackInputSource[] {
  return Object.entries(workspaces).map(([key, workspace]) => slackInput(key, workspace));
}

function slackInput(key: string, workspace: WorkspaceConfig): SlackInputSource {
  return {
    id: `slack-${key}`,
    type: "slack",
    name: workspace.name,
    enabled: true,
    workspaceId: workspace.id,
  };
}

function deriveCodingLinks(projects: ProjectCatalogFile["projects"]): ProjectAgentLink[] {
  return Object.keys(projects).map((projectId) => ({ projectId, role: "coding", agent: "claude" }));
}

function specifyProject(example: string): string {
  return `対象プロジェクトを指定してください。\n例: ${example}`;
}
