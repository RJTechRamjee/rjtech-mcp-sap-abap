#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AdtClient, adtConfigFromEnv } from "./adt.js";
import { agentInstallEnabled, agentTargets, installAgents } from "./agents.js";
import { configFile, loadUserConfig, log, packageRoot, readSettings } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { runSetup } from "./setup.js";
import { PROJECT_CONVENTIONS, PROJECT_YAML, parseAgents, parseProject, parseSkills, readContentDir } from "./skills.js";
import { ContentStore } from "./store.js";
import { findNewerServer } from "./updater.js";

/** Set by the release build (scripts/bundle.mjs). Undefined when running from source. */
declare const __RJTECH_VERSION__: string | undefined;
const bundled = typeof __RJTECH_VERSION__ === "string";
const version: string = bundled
  ? (__RJTECH_VERSION__ as string)
  : JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;
const [command, arg] = process.argv.slice(2);

if (!(await handOverToNewerVersion())) await main();

/**
 * Release bundles check for a newer release first and, if there is one, run it instead
 * (see updater.ts). Source runs (development) never update themselves.
 */
async function handOverToNewerVersion(): Promise<boolean> {
  loadUserConfig();
  const env = process.env;
  if (!bundled || command === "--version" || env.RJTECH_MCP_HANDED_OVER || env.RJTECH_MCP_AUTO_UPDATE === "false") return false;
  const newer = await findNewerServer(version);
  if (!newer) return false;
  env.RJTECH_MCP_HANDED_OVER = version;
  log(`v${version} -> starting v${newer.version}`);
  try {
    await import(pathToFileURL(newer.file).href);
    return true;
  } catch (err) {
    log(`v${newer.version} failed to start (${(err as Error).message}); falling back to v${version}.`);
    return false;
  }
}

async function main() {
  switch (command) {
    case undefined:
    case "serve":
      await serve();
      break;
    case "setup":
      await runSetup(version);
      break;
    case "validate":
      process.exitCode = await validate(arg ?? ".");
      break;
    case "--version":
    case "-v":
      console.log(version);
      break;
    default:
      console.log(
        [
          `rjtech-mcp-sap-abap ${version}`,
          "",
          "  (no command)       start the MCP server on stdio (your IDE does this)",
          "  setup              create or update your settings in " + configFile,
          "  validate [dir]     check a skills repo checkout (skills/, project/, agents/) for problems",
          "  --version          print the version",
        ].join("\n"),
      );
  }
}

/** Runs the MCP server over stdio. The IDE starts this process and talks to it via stdin/stdout. */
async function serve() {
  loadUserConfig();
  const settings = readSettings();
  const adtConfig = adtConfigFromEnv();
  const adt = adtConfig ? new AdtClient(adtConfig) : undefined;

  const store = await ContentStore.start(settings);
  const s = store.current;
  log(`v${version}: ${s.skills.size} skill(s) from ${s.source}; syncing from ${store.description}.`);
  log(adt ? `ADT tools on for ${adtConfig!.url} (client ${adtConfig!.client}).` : "ADT tools off (SAP_URL not set).");

  // Copilot custom agents from the skills repo: install now and after every content change.
  const targets = agentTargets();
  let agentProblems: string[] = [];
  const agentsOn = agentInstallEnabled();
  const syncAgents = async () => {
    if (agentsOn) agentProblems = await installAgents(store.current.agents, targets);
  };
  await syncAgents();
  store.onChange(() => void syncAgents());
  const agentStatus = () =>
    !agentsOn
      ? "Agents: install off (RJTECH_MCP_INSTALL_AGENTS=false)"
      : [
          `Agents: ${store.current.agents.map((a) => a.name).join(", ") || "(none)"}`,
          `  VS Code: ${targets.vscode}`,
          `  Eclipse project: ${targets.eclipseProject}`,
          ...agentProblems.map((p) => `  Problem: ${p}`),
        ].join("\n");

  const server = createMcpServer(store, version, adt, agentStatus);
  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    store.stop();
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  // The IDE closes stdin when it stops the server.
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Checks a skills repo checkout. Used by the skills repo's GitHub Action and by authors before pushing. */
async function validate(dir: string): Promise<number> {
  const files = await readContentDir(path.resolve(dir));
  const { skills, problems } = parseSkills(files);
  const project = parseProject(files);
  const agents = parseAgents(files);
  const all = [...problems, ...project.problems, ...agents.problems];
  if (!files.has(PROJECT_CONVENTIONS)) all.push(`${PROJECT_CONVENTIONS} is missing.`);
  if (!files.has(PROJECT_YAML)) all.push(`${PROJECT_YAML} is missing.`);
  if (skills.size === 0) all.push(`No skills found under ${path.resolve(dir, "skills")}.`);

  console.log(`Skills (${skills.size}): ${[...skills.keys()].join(", ") || "-"}`);
  console.log(`Agents (${agents.agents.length}): ${agents.agents.map((a) => a.name).join(", ") || "-"}`);
  console.log(`ADT write rules: objects ${project.project.objectPrefixes.join("/")}*, packages ${project.project.packagePrefixes.join("/")}*`);
  if (all.length) {
    console.log(`\n${all.length} problem(s):`);
    for (const p of all) console.log(`  - ${p}`);
    return 1;
  }
  console.log("\nOK");
  return 0;
}
