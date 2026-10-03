import { spawn } from "node:child_process";

export type CommandPresence = "missing" | "ok" | "failed";

export interface AgentProbes {
  commandExists(command: string): Promise<boolean>;
  commandStatus(command: string, args: string[]): Promise<CommandPresence>;
}

const STATUS_TIMEOUT_MS = 10_000;

export function defaultAgentProbes(): AgentProbes {
  return {
    async commandExists(command: string) {
      return (await commandPresence("which", [command])) === "ok";
    },
    async commandStatus(command: string, args: string[]) {
      return commandPresence(command, args);
    },
  };
}

function commandPresence(command: string, args: string[]): Promise<CommandPresence> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve("failed");
    }, STATUS_TIMEOUT_MS);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(error.code === "ENOENT" ? "missing" : "failed");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? "ok" : "failed");
    });
  });
}
