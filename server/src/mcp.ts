import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AdtClient } from "./adt.js";
import { registerAdtTools } from "./adtTools.js";
import { readSkillFile } from "./skills.js";
import type { ContentStore, Snapshot } from "./store.js";

const SERVER_NAME = "rjtech-sap-abap-skills";

const skillIndex = (s: Snapshot) => [...s.skills.values()].map((k) => `- ${k.name}: ${k.description}`).join("\n") || "(none)";
const topicIndex = (s: Snapshot) => s.project.topics.map((t) => `- ${t.name}: ${t.description}`).join("\n") || "(none)";

function buildInstructions(s: Snapshot, adt?: AdtClient): string {
  const adtLines = adt
    ? [
        `ADT tools (adt_*) are connected to the SAP system ${adt.systemUrl}. Use them to create, read, update and activate classes and interfaces.`,
        "Confirm package, transport and object names with the user before the first write. If activation fails, fix the code and call adt_update_source.",
      ]
    : ["Skills contain instructions only; no SAP system is connected (ADT tools are off)."];
  return [
    "This server provides the project's Agent Skills for SAP ABAP development (RAP, CDS, OData V4, ABAP Unit, BAdIs).",
    "When a task matches a skill, call load_skill with its name BEFORE writing code, then follow its instructions.",
    "Skills may reference extra files; load them with load_skill(name, file) only when needed.",
    "Project conventions (below, and via get_project_conventions) override names and examples in individual skills.",
    "Before naming ABAP objects, variables, types or parameters, call get_project_conventions with the matching naming topic.",
    "Skills are updated centrally while you work; list_skills always returns the current list.",
    ...adtLines,
    "",
    "## Project conventions",
    s.project.conventions || "(none defined)",
    "",
    "## Naming topics (load with get_project_conventions topic=...)",
    topicIndex(s),
    "",
    "## Available skills",
    skillIndex(s),
  ].join("\n");
}

const loadSkillDescription = (s: Snapshot) =>
  "Returns the full instructions of a skill (its SKILL.md). Pass `file` to load one of the skill's extra files instead, e.g. a reference listed by list_skills.\n\nCurrent skills:\n" +
  skillIndex(s);

const mimeFor = (file: string) => (file.endsWith(".md") ? "text/markdown" : file.endsWith(".json") ? "application/json" : "text/plain");
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/**
 * Builds the MCP server. Every handler reads store.current, so a sync is visible on the
 * next call. The skill index in the load_skill description and the resource list are
 * refreshed when the store changes (clients are told via list_changed notifications).
 */
export function createMcpServer(store: ContentStore, version: string, adt?: AdtClient, agentStatus?: () => string): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version },
    { instructions: buildInstructions(store.current, adt), capabilities: { tools: { listChanged: true }, resources: { listChanged: true } } },
  );
  if (adt) registerAdtTools(server, adt, () => store.current.project);

  server.registerResource(
    "skill-files",
    new ResourceTemplate("skill://{skill}/{+file}", {
      list: async () => ({
        resources: [...store.current.skills.values()].flatMap((k) => [
          { uri: `skill://${k.name}/SKILL.md`, name: k.name, description: k.description, mimeType: "text/markdown" },
          ...k.files.map((f) => ({ uri: `skill://${k.name}/${f}`, name: `${k.name}: ${f}`, mimeType: mimeFor(f) })),
        ]),
      }),
    }),
    { title: "Skill files", description: "SKILL.md and reference files of each skill" },
    async (uri, vars) => {
      const s = store.current;
      const skill = s.skills.get(String(vars.skill));
      if (!skill) throw new Error(`Unknown skill "${vars.skill}".`);
      const file = String(vars.file);
      const body = file === "SKILL.md" ? skill.body : readSkillFile(s.files, skill, file);
      return { contents: [{ uri: uri.href, mimeType: mimeFor(file), text: body }] };
    },
  );

  server.registerResource(
    "project-conventions",
    "project://conventions",
    { title: "Project conventions", description: "Core conventions, naming topics, applications and packages of the project", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: conventionsText(store.current) }] }),
  );

  server.registerResource(
    "project-naming",
    new ResourceTemplate("project://naming/{topic}", {
      list: async () => ({
        resources: store.current.project.topics.map((t) => ({
          uri: `project://naming/${t.name}`,
          name: `naming: ${t.name}`,
          description: t.description,
          mimeType: "text/markdown",
        })),
      }),
    }),
    { title: "Naming conventions", description: "Detailed naming rules of the project, one document per topic" },
    async (uri, vars) => {
      const topic = store.current.project.topics.find((t) => t.name === String(vars.topic));
      if (!topic) throw new Error(`Unknown naming topic "${vars.topic}".`);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: topic.body }] };
    },
  );

  server.registerTool(
    "list_skills",
    {
      title: "List skills",
      description: "Lists the available SAP ABAP skills with their descriptions and extra files (always the latest synced list).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const list = [...store.current.skills.values()].map(({ name, description, files }) => ({ name, description, files }));
      return text(JSON.stringify(list, null, 2));
    },
  );

  const loadSkill = server.registerTool(
    "load_skill",
    {
      title: "Load skill",
      description: loadSkillDescription(store.current),
      inputSchema: {
        name: z.string().describe("Skill name, e.g. rap-managed-bo"),
        file: z.string().optional().describe("Optional extra file path inside the skill, e.g. references/templates.md"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name, file }) => {
      const s = store.current;
      const skill = s.skills.get(name);
      if (!skill) return { isError: true, ...text(`Unknown skill "${name}". Available: ${[...s.skills.keys()].join(", ")}`) };
      if (!file || file === "SKILL.md") {
        const extras = skill.files.length
          ? `\n\n---\nExtra files (load with load_skill name="${skill.name}" file="..."): ${skill.files.join(", ")}`
          : "";
        const conv = s.project.conventions ? "\n\nProject conventions override names in this skill (see get_project_conventions)." : "";
        return text(`# Skill: ${skill.name}\n\n${skill.body}${extras}${conv}`);
      }
      try {
        return text(readSkillFile(s.files, skill, file));
      } catch (err) {
        return { isError: true, ...text((err as Error).message) };
      }
    },
  );

  server.registerTool(
    "get_project_conventions",
    {
      title: "Get project conventions",
      description:
        "Without `topic`: returns the project's core conventions, the list of naming topics and project.yaml (applications, packages, ADT prefixes). " +
        "With `topic`: returns that topic's detailed naming rules. Call it before naming or creating ABAP objects, variables, types or parameters.",
      inputSchema: {
        topic: z.string().optional().describe("Naming topic, e.g. global-objects, rap-cds or local-definitions"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic }) => {
      const s = store.current;
      if (!topic) return text(conventionsText(s));
      const found = s.project.topics.find((t) => t.name === topic);
      if (!found) {
        const names = s.project.topics.map((t) => t.name).join(", ") || "(none)";
        return { isError: true, ...text(`Unknown naming topic "${topic}". Available: ${names}`) };
      }
      return text(`# Naming: ${found.name}\n\n${found.body}`);
    },
  );

  server.registerTool(
    "skills_status",
    {
      title: "Skills sync status",
      description: "Shows where the skills come from, which version is loaded, when it was last checked and any content problems. Use it to troubleshoot.",
      inputSchema: { refresh: z.boolean().default(false).describe("Check GitHub for updates now") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ refresh }) => {
      if (refresh) await store.sync();
      const s = store.current;
      return text(
        [
          `Server version: ${version}`,
          `Source: ${store.description}`,
          `Loaded: ${s.source}`,
          `Skills: ${s.skills.size} (${[...s.skills.keys()].join(", ")})`,
          `Last check: ${store.lastCheck?.toISOString() ?? "never"}`,
          `Last error: ${store.lastError ?? "none"}`,
          `ADT: ${adt ? adt.systemUrl : "off"}`,
          agentStatus?.() ?? `Agents: ${s.agents.map((a) => a.name).join(", ") || "(none)"} (not installed by this process)`,
          `Write tools allow objects ${s.project.objectPrefixes.join("/")}* in packages ${s.project.packagePrefixes.join("/")}*`,
          s.problems.length ? `Content problems:\n- ${s.problems.join("\n- ")}` : "Content problems: none",
        ].join("\n"),
      );
    },
  );

  const unsubscribe = store.onChange((s) => {
    loadSkill.update({ description: loadSkillDescription(s) }); // also sends tools/list_changed
    if (server.isConnected()) server.sendResourceListChanged();
  });
  const close = server.close.bind(server);
  server.close = async () => {
    unsubscribe();
    await close();
  };
  return server;
}

function conventionsText(s: Snapshot): string {
  return [
    s.project.conventions || "No project/conventions.md in the skills repo.",
    "",
    "## Naming topics (load with get_project_conventions topic=...)",
    topicIndex(s),
    "",
    "## project.yaml",
    "```yaml",
    s.project.yaml || "# (no project/project.yaml)",
    "```",
  ].join("\n");
}
