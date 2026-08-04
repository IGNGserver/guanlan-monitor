import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentLocalConfig } from "@dsc/shared";
import { writeJsonAtomically } from "./atomic-json.js";

export class LocalConfigStore {
  readonly filePath: string;

  constructor(userDataPath: string, private readonly legacyPaths: string[] = []) {
    this.filePath = path.join(userDataPath, "agent-ui.config.json");
  }

  async migrateIfNeeded(): Promise<void> {
    try {
      await access(this.filePath);
      return;
    } catch {
      // Continue with the legacy search below.
    }

    for (const legacyPath of this.legacyPaths) {
      try {
        await access(legacyPath);
        await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
        await copyFile(legacyPath, this.filePath);
        return;
      } catch {
        // A missing legacy location is expected on first run.
      }
    }
  }

  async read(): Promise<AgentLocalConfig | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as AgentLocalConfig;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "EACCES") return null;
      throw error;
    }
  }

  async write(config: AgentLocalConfig): Promise<void> {
    await writeJsonAtomically(this.filePath, config);
  }
}
