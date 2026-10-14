import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readSkillFile, type Skill } from "./skills.js";

const SERVER_NAME = "rjtech-sap-abap-skills";
const SERVER_VERSION = "0.1.0";

function buildInstructions(skills: Map<string, Skill>): string {
  const index = [...skills.values()].map((s) => `- ${s.name}: ${s.description}`).join("\n");
  return [
    "This server provides Agent Skills for SAP ABAP Cloud development (RAP, CDS, OData V4, ABAP Unit).",
    "When a task matches a skill below, call load_skill with its name BEFORE writing code, then follow its instructions.",
    "Skills may reference extra files; load them with load_skill(name, file) only when needed.",
    "Skills contain instructions only; nothing is executed on this server.",
    "",
    "Available skills:",
    index || "(none)",
  ].join("\n");
}

const uriFor = (skill: string, file = "SKILL.md") => `skill://${skill}/${file}`;

function mimeFor(file: string): string {
  return file.endsWith(".md") ? "text/markdown" : file.endsWith(".json") ? "application/json" : "text/plain";
}

/** Builds a fresh MCP server. Called per request because the HTTP transport runs stateless. */
export function createMcpServer(skills: Map<string, Skill>): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: buildInstructions(skills) },
  );

  for (const skill of skills.values()) {
    server.registerResource(
      `${skill.name}`,
      uriFor(skill.name),
      { title: skill.name, description: skill.description, mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: skill.body }] }),
    );
    for (const file of skill.files) {
      server.registerResource(
        `${skill.name}/${file}`,
        uriFor(skill.name, file),
        { title: `${skill.name}: ${file}`, mimeType: mimeFor(file) },
        async (uri) => ({ contents: [{ uri: uri.href, mimeType: mimeFor(file), text: await readSkillFile(skill, file) }] }),
      );
    }
  }

  server.registerTool(
    "list_skills",
    {
      title: "List skills",
      description: "Lists the available SAP ABAP skills with their descriptions and extra files.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const list = [...skills.values()].map(({ name, description, files }) => ({ name, description, files }));
      return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
    },
  );

  server.registerTool(
    "load_skill",
    {
      title: "Load skill",
      description:
        "Returns the full instructions of a skill (its SKILL.md). Pass `file` to load one of the skill's extra files instead, e.g. a reference document listed by list_skills.",
      inputSchema: {
        name: z.string().describe("Skill name, e.g. rap-managed-bo"),
        file: z.string().optional().describe("Optional extra file path inside the skill, e.g. references/naming.md"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name, file }) => {
      const skill = skills.get(name);
      if (!skill) {
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown skill "${name}". Available: ${[...skills.keys()].join(", ")}` }],
        };
      }
      if (!file || file === "SKILL.md") {
        const extras = skill.files.length
          ? `\n\n---\nExtra files (load with load_skill name="${skill.name}" file="..."): ${skill.files.join(", ")}`
          : "";
        return { content: [{ type: "text", text: `# Skill: ${skill.name}\n\n${skill.body}${extras}` }] };
      }
      try {
        return { content: [{ type: "text", text: await readSkillFile(skill, file) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
      }
    },
  );

  return server;
}
