/**
 * End-to-end check: starts the server over stdio (like an IDE does) and calls every skills tool.
 *
 *   npm run smoke -- <path-to-skills-repo-checkout>     local mode, also tests live reload
 *   npm run smoke                                        GitHub mode (needs network)
 *
 * Uses a temporary settings folder, so your own config.env and cache are not touched.
 */
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

const contentArg = process.argv[2];
const tmp = await mkdtemp(path.join(os.tmpdir(), "rjtech-mcp-smoke-"));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");

let contentDir: string | undefined;
if (contentArg) {
  // Work on a copy so the live-reload test can add a skill without touching the real repo.
  contentDir = path.join(tmp, "content");
  await cp(path.resolve(contentArg), contentDir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git`) });
}

const env: Record<string, string> = { ...(process.env as Record<string, string>), RJTECH_MCP_HOME: path.join(tmp, "home") };
delete env.SAP_URL;
if (contentDir) env.LOCAL_CONTENT_DIR = contentDir;
else delete env.LOCAL_CONTENT_DIR;

// SMOKE_BUNDLE=1 tests the release bundle (dist/) instead of the sources; self-update is off.
const bundle = process.env.SMOKE_BUNDLE === "1";
if (bundle) env.RJTECH_MCP_AUTO_UPDATE = "false";
console.log(`Testing ${bundle ? "the release bundle" : "the sources"}`);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: bundle ? [path.resolve("dist/rjtech-mcp-sap-abap.mjs")] : ["--import", "tsx", path.resolve("server/src/index.ts")],
  env,
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "1" });
let toolsChanged = 0;
client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
  toolsChanged++;
});

try {
  await client.connect(transport);
  const instructions = client.getInstructions() ?? "";
  check(instructions.includes("## Team conventions") && instructions.includes("ZRJ_"), "instructions contain team conventions");
  check(instructions.includes("rap-managed-bo"), "instructions contain the skill index");

  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check(
    JSON.stringify(tools) === JSON.stringify(["get_team_conventions", "list_skills", "load_skill", "skills_status"]),
    `tools without SAP: ${tools.join(", ")}`,
  );

  const skills = JSON.parse(textOf(await client.callTool({ name: "list_skills", arguments: {} }))) as { name: string; files: string[] }[];
  check(skills.length >= 5, `list_skills returns ${skills.length} skills`);

  const bo = textOf(await client.callTool({ name: "load_skill", arguments: { name: "rap-managed-bo" } }));
  check(bo.startsWith("# Skill: rap-managed-bo") && bo.includes("references/templates.md"), "load_skill returns SKILL.md with extra files");

  const tpl = textOf(await client.callTool({ name: "load_skill", arguments: { name: "rap-managed-bo", file: "references/templates.md" } }));
  check(tpl.includes("define root view entity"), "load_skill returns a reference file");

  const trav = await client.callTool({ name: "load_skill", arguments: { name: "rap-managed-bo", file: "../../team/team.yaml" } });
  check(trav.isError === true, "path traversal is refused");

  const conv = textOf(await client.callTool({ name: "get_team_conventions", arguments: {} }));
  check(conv.includes("ZRJ_<TYPE>_<NAME>") && conv.includes("objectPrefixes"), "get_team_conventions returns conventions and team.yaml");

  const resources = (await client.listResources()).resources;
  check(resources.some((r) => r.uri === "skill://rap-managed-bo/references/templates.md"), `resources/list has ${resources.length} entries`);
  const res = await client.readResource({ uri: "skill://rap-managed-bo/references/templates.md" });
  check(String((res.contents[0] as { text?: string }).text).includes("define root view entity"), "resources/read of a nested file works");

  const status = textOf(await client.callTool({ name: "skills_status", arguments: { refresh: true } }));
  console.log(status.replace(/^/gm, "      "));
  check(/Last error: none/.test(status), "skills_status reports no sync error");

  if (contentDir) {
    await mkdir(path.join(contentDir, "skills", "smoke-test-skill"), { recursive: true });
    await writeFile(
      path.join(contentDir, "skills", "smoke-test-skill", "SKILL.md"),
      "---\nname: smoke-test-skill\ndescription: Added while the server runs.\n---\nHello from the new skill.\n",
    );
    console.log("      (waiting up to 15 s for the live reload...)");
    let found = false;
    for (let i = 0; i < 15 && !found; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      found = textOf(await client.callTool({ name: "list_skills", arguments: {} })).includes("smoke-test-skill");
    }
    check(found, "a new skill appears without restarting the server");
    check(toolsChanged > 0, "client is notified (tools/list_changed)");
    const desc = (await client.listTools()).tools.find((t) => t.name === "load_skill")?.description ?? "";
    check(desc.includes("smoke-test-skill"), "load_skill description lists the new skill");
  }
} catch (err) {
  failures++;
  console.error("FAIL ", err);
} finally {
  await client.close().catch(() => undefined);
  await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
