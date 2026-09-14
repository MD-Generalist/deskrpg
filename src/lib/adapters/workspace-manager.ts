import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DESKRPG_DATA_DIR = process.env.DESKRPG_DATA_DIR || path.join(os.tmpdir(), "deskrpg");

export interface WorkspacePersona {
  identity: string;
  soul: string;
}

export class WorkspaceManager {
  async ensureWorkspace(projectId: string): Promise<string> {
    const wsPath = path.join(DESKRPG_DATA_DIR, "workspaces", projectId);
    await fs.mkdir(wsPath, { recursive: true });
    return wsPath;
  }

  async writePersonaFiles(
    wsPath: string,
    adapterType: string,
    persona: WorkspacePersona,
    locale: string,
  ): Promise<void> {
    void locale;

    const fullPersona = `${persona.identity}\n\n---\n\n${persona.soul}`;

    const fileMap: Record<string, string> = {
      claude: "CLAUDE.md",
      codex: "AGENTS.md",
      opencode: "AGENTS.md",
      gemini: "GEMINI.md",
    };

    const fileName = fileMap[adapterType];
    if (!fileName) return;

    // Runtime-owned workspace content must not become a build-time file trace.
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ wsPath, fileName), fullPersona, "utf-8");
  }

  getUserAuthHome(userId: string): string {
    return path.join(DESKRPG_DATA_DIR, "users", userId);
  }

  async ensureUserAuthHome(userId: string): Promise<string> {
    const userHome = this.getUserAuthHome(userId);
    await fs.mkdir(userHome, { recursive: true });
    return userHome;
  }
}

export const workspaceManager = new WorkspaceManager();
