export interface ProjectRepository {
  mode: "local";
  localPath: string;
  remoteRepository: string;
}

export interface Project {
  projectId: string;
  name: string;
  repository: ProjectRepository;
}
