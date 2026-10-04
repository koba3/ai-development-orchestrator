import type { Project } from "../project/project.js";
import type { ProjectCatalogFile, ProjectRoute, ProjectRouteFailureReason, WorkspaceConfig } from "../routing/project.types.js";
import type { ProjectRouting } from "../routing/routing.js";
import type { AgentRole, InputSource, OrchestrationInput, ProjectAgentLink } from "./orchestration.types.js";

export type OrchestrationFailureReason = ProjectRouteFailureReason | "input-unavailable";

export type OrchestrationConnection =
  | {
      ok: true;
      input: InputSource;
      project: Project;
      route: ProjectRoute;
      agents: ProjectAgentLink[];
    }
  | { ok: false; reason: OrchestrationFailureReason; message: string };

const FALLBACK_EXAMPLE = "#questoon";

export class Orchestration {
  private inputs: InputSource[];
  private links: ProjectAgentLink[];

  constructor(
    private catalog: ProjectCatalogFile,
    private readonly routing: ProjectRouting,
  ) {
    this.inputs = catalog.inputs ?? deriveSlackInputs(catalog.workspaces);
    this.links = catalog.agentLinks ?? deriveCodingLinks(catalog.projects);
  }

  replace(catalog: ProjectCatalogFile): void {
    this.catalog = catalog;
    this.inputs = catalog.inputs ?? deriveSlackInputs(catalog.workspaces);
    this.links = catalog.agentLinks ?? deriveCodingLinks(catalog.projects);
  }

  inputSources(): readonly InputSource[] {
    return this.inputs;
  }

  project(projectId: string): Project | null {
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

  connect(input: OrchestrationInput): OrchestrationConnection {
    const source = this.inputs.find((item) => matchesSource(item, input));
    if (!source) {
      return { ok: false, reason: "input-unavailable", message: specifyProject(FALLBACK_EXAMPLE) };
    }
    const routed = this.routing.resolve({
      text: input.text,
      context: {
        workspaceId: input.context.workspaceId,
        channelId: input.context.channelId,
      },
    });
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

function matchesSource(source: InputSource, input: OrchestrationInput): boolean {
  if (!source.enabled || source.type !== input.inputType) {
    return false;
  }
  if (input.inputSourceId.length > 0 && input.inputSourceId === source.id) {
    return true;
  }
  const entries = Object.entries(source.connection);
  if (entries.length === 0) {
    return false;
  }
  return entries.every(([key, value]) => readConnectionValue(input, key) === value);
}

function readConnectionValue(input: OrchestrationInput, key: string): string | undefined {
  const fromContext = input.context[key as keyof OrchestrationInput["context"]];
  if (typeof fromContext === "string" && fromContext.length > 0) {
    return fromContext;
  }
  const metadata = input.metadata[key];
  return typeof metadata === "string" && metadata.length > 0 ? metadata : undefined;
}

function deriveSlackInputs(workspaces: ProjectCatalogFile["workspaces"]): InputSource[] {
  return Object.entries(workspaces).map(([key, workspace]) => slackInput(key, workspace));
}

function slackInput(key: string, workspace: WorkspaceConfig): InputSource {
  return {
    id: `slack-${key}`,
    type: "slack",
    name: workspace.name,
    enabled: true,
    connection: { workspaceId: workspace.id },
  };
}

function deriveCodingLinks(projects: ProjectCatalogFile["projects"]): ProjectAgentLink[] {
  return Object.keys(projects).map((projectId) => ({ projectId, role: "coding", agent: "claude" }));
}

function specifyProject(example: string): string {
  return `対象プロジェクトを指定してください。\n例: ${example}`;
}
