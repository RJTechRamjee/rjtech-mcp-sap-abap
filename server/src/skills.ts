import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export interface Skill {
  /** Folder name; used in URIs and tool calls. */
  name: string;
  /** From SKILL.md frontmatter: tells the model when to use the skill. */
  description: string;
  /** SKILL.md body without frontmatter. */
  body: string;
  /** Extra files relative to the skill folder, POSIX separators (e.g. "references/naming.md"). */
  files: string[];
  dir: string;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
// Only text files are served; anything else in a skill folder is ignored.
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".abap", ".cds", ".json", ".yaml", ".yml", ".xml"]);

export function splitFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta = parseYaml(match[1]) ?? {};
  return { meta: typeof meta === "object" ? (meta as Record<string, unknown>) : {}, body: raw.slice(match[0].length) };
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...(await listFiles(path.join(dir, entry.name), rel)));
    } else if (entry.isFile() && rel !== "SKILL.md" && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      result.push(rel);
    }
  }
  return result.sort();
}

export async function loadSkills(skillsDir: string): Promise<Map<string, Skill>> {
  const skills = new Map<string, Skill>();
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(skillsDir, entry.name);
    const skillFile = path.join(dir, "SKILL.md");
    if (!(await stat(skillFile).catch(() => null))?.isFile()) continue;

    if (!NAME_PATTERN.test(entry.name)) {
      console.warn(`Skipping skill folder "${entry.name}": use lowercase letters, digits and hyphens.`);
      continue;
    }
    const { meta, body } = splitFrontmatter(await readFile(skillFile, "utf8"));
    if (meta.name && meta.name !== entry.name) {
      console.warn(`Skill "${entry.name}": frontmatter name "${meta.name}" differs from folder name; using folder name.`);
    }
    if (typeof meta.description !== "string" || !meta.description.trim()) {
      console.warn(`Skipping skill "${entry.name}": SKILL.md frontmatter needs a "description".`);
      continue;
    }
    skills.set(entry.name, {
      name: entry.name,
      description: meta.description.trim().replace(/\s+/g, " "),
      body: body.trim(),
      files: await listFiles(dir),
      dir,
    });
  }
  return skills;
}

/**
 * Reads an extra file of a skill. Only files discovered at startup can be read,
 * so "../" tricks and absolute paths are rejected by construction.
 */
export async function readSkillFile(skill: Skill, file: string): Promise<string> {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!skill.files.includes(normalized)) {
    throw new Error(`Skill "${skill.name}" has no file "${file}". Available: ${skill.files.join(", ") || "(none)"}`);
  }
  return readFile(path.join(skill.dir, ...normalized.split("/")), "utf8");
}
