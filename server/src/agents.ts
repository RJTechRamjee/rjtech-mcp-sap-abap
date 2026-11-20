import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { homeDir, log } from "./config.js";
import type { Agent } from "./skills.js";

/**
 * Installs the skills repo's Copilot custom agents (agents/<name>.agent.md) into the IDEs, so a
 * change in the repo reaches every developer like a skill does. Only files named
 * "rjtech-<name>.agent.md" are written or removed; other agents in those folders are never touched.
 *
 * - VS Code reads user-level agents from ~/.copilot/agents/.
 * - Eclipse only reads .github/agents/ inside a project of its workspace. The server keeps a small
 *   project for that in ~/.rjtech-mcp/eclipse/rjtech-copilot/, which each developer imports once.
 */

export const FILE_PREFIX = "rjtech-";
export const ECLIPSE_PROJECT = "rjtech-copilot";

export interface AgentTargets {
  /** Folder for VS Code user-level agents. */
  vscode: string;
  /** The Eclipse helper project folder (its .github/agents/ gets the agents). */
  eclipseProject: string;
}

export function agentTargets(env = process.env): AgentTargets {
  return {
    vscode: env.RJTECH_MCP_VSCODE_AGENTS_DIR ?? path.join(os.homedir(), ".copilot", "agents"),
    eclipseProject: path.join(homeDir, "eclipse", ECLIPSE_PROJECT),
  };
}

/** RJTECH_MCP_INSTALL_AGENTS=false turns installing off, e.g. for developers who manage agents themselves. */
export const agentInstallEnabled = (env = process.env) => env.RJTECH_MCP_INSTALL_AGENTS !== "false";

const MANAGED_NOTE =
  "<!-- Installed by the rjtech-mcp-sap-abap server from the skills repo (agents/). Local edits are overwritten; change the repo instead. -->";

/** Adds the "managed" note right after the frontmatter, so the frontmatter stays first in the file. */
function withNote(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
  if (!match) return `${MANAGED_NOTE}\n\n${raw}`;
  return `${match[0]}${MANAGED_NOTE}\n${raw.slice(match[0].length)}`;
}

const ECLIPSE_DOT_PROJECT = `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
\t<name>${ECLIPSE_PROJECT}</name>
\t<comment>Copilot agents for SAP ABAP, kept up to date by the rjtech-mcp-sap-abap server. Do not edit.</comment>
\t<projects>
\t</projects>
\t<buildSpec>
\t</buildSpec>
\t<natures>
\t</natures>
</projectDescription>
`;

const ECLIPSE_README = `# ${ECLIPSE_PROJECT}

This Eclipse project is created and updated by the rjtech-mcp-sap-abap MCP server.
It only exists so GitHub Copilot in Eclipse finds the project's custom agents in
.github/agents/. Import it once (File > Import > General > Existing Projects into Workspace)
and don't edit it: changes come from the skills repo.
`;

/** Writes a file only when its content changed. Returns true if it wrote. */
async function writeIfChanged(file: string, text: string): Promise<boolean> {
  const current = await readFile(file, "utf8").catch(() => undefined);
  if (current === text) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
  return true;
}

/** Makes <dir> hold exactly one rjtech-<name>.agent.md per agent; returns the number of files changed. */
async function syncFolder(dir: string, agents: Agent[]): Promise<number> {
  let changed = 0;
  const wanted = new Map(agents.map((a) => [`${FILE_PREFIX}${a.name}.agent.md`, withNote(a.raw)]));
  for (const [file, text] of wanted) if (await writeIfChanged(path.join(dir, file), text)) changed++;
  const existing = await readdir(dir).catch(() => [] as string[]);
  for (const file of existing) {
    if (file.startsWith(FILE_PREFIX) && file.endsWith(".agent.md") && !wanted.has(file)) {
      await rm(path.join(dir, file), { force: true });
      changed++;
    }
  }
  return changed;
}

/**
 * Brings both IDE locations in line with the current agents. Never throws: a failure here must
 * not stop the MCP server, so problems are logged and returned.
 */
export async function installAgents(agents: Agent[], targets = agentTargets()): Promise<string[]> {
  const problems: string[] = [];
  const run = async (what: string, fn: () => Promise<number>) => {
    try {
      const n = await fn();
      if (n) log(`Agents: ${n} file(s) updated for ${what}.`);
    } catch (err) {
      problems.push(`Could not install agents for ${what}: ${(err as Error).message}`);
      log(problems[problems.length - 1]);
    }
  };
  await run(`VS Code (${targets.vscode})`, () => syncFolder(targets.vscode, agents));
  await run(`Eclipse (${targets.eclipseProject})`, async () => {
    let n = 0;
    if (await writeIfChanged(path.join(targets.eclipseProject, ".project"), ECLIPSE_DOT_PROJECT)) n++;
    if (await writeIfChanged(path.join(targets.eclipseProject, "README.md"), ECLIPSE_README)) n++;
    return n + (await syncFolder(path.join(targets.eclipseProject, ".github", "agents"), agents));
  });
  return problems;
}
