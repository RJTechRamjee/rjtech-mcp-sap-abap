import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Folder of the installed package (or the repo checkout when run from source). */
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Per-user folder for settings and the skills cache. Never inside a repo. */
export const homeDir = process.env.RJTECH_MCP_HOME ?? path.join(os.homedir(), ".rjtech-mcp");
export const configFile = path.join(homeDir, "config.env");

/**
 * The GitHub repo the skills and team conventions come from (separate from this server repo).
 * Override with SKILLS_REPO, e.g. if the repo moves to an organization.
 */
export const DEFAULT_REPO = "RJTechRamjee/rjtech-sap-abap-skills";

/**
 * Loads ~/.rjtech-mcp/config.env into process.env. Variables already set (e.g. by the
 * IDE's MCP config "env" block) win over the file.
 */
export function loadUserConfig(): void {
  if (existsSync(configFile)) process.loadEnvFile(configFile);
}

export interface Settings {
  /** "github": sync from the repo; "local": read a folder (for skill authors). */
  mode: "github" | "local";
  repo: string;
  branch: string;
  token?: string;
  syncIntervalMs: number;
  /** Local mode: a checkout of the skills repo (folder that contains skills/ and team/). */
  localDir: string;
}

export function readSettings(env = process.env): Settings {
  const localDir = path.resolve(env.LOCAL_CONTENT_DIR ?? ".");
  const minutes = Number(env.SKILLS_SYNC_MINUTES ?? 5);
  return {
    mode: env.LOCAL_CONTENT_DIR ? "local" : "github",
    repo: env.SKILLS_REPO ?? DEFAULT_REPO,
    branch: env.SKILLS_BRANCH ?? "main",
    token: env.GITHUB_TOKEN || undefined,
    // Local mode re-reads the folder often so authors see edits almost immediately.
    syncIntervalMs: env.LOCAL_CONTENT_DIR ? 10_000 : Math.max(1, Number.isFinite(minutes) ? minutes : 5) * 60_000,
    localDir,
  };
}

/** Generic client name for requests to GitHub. */
export const USER_AGENT = "sap-abap-skills-mcp";

/** Logs go to stderr: stdout carries the MCP protocol in stdio mode. */
export const log = (...args: unknown[]) => console.error("[rjtech-mcp]", ...args);
