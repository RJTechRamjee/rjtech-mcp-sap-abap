import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Content = every synced text file, keyed by its repo path with "/" separators,
 * e.g. "skills/rap-managed-bo/SKILL.md" or "team/team.yaml".
 * The same shape comes from GitHub, the disk cache or a local folder.
 */
export type ContentFiles = Map<string, string>;

export interface Skill {
  /** Folder name; used in URIs and tool calls. */
  name: string;
  /** From SKILL.md frontmatter: tells the model when to use the skill. */
  description: string;
  /** SKILL.md body without frontmatter. */
  body: string;
  /** Extra files relative to the skill folder (e.g. "references/naming.md"). */
  files: string[];
}

export const CONTENT_ROOTS = ["skills/", "team/"];
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
// Only text files are served; anything else is ignored.
export const TEXT_EXTENSIONS = new Set([".md", ".txt", ".abap", ".cds", ".json", ".yaml", ".yml", ".xml"]);

export const isContentPath = (p: string) =>
  CONTENT_ROOTS.some((root) => p.startsWith(root)) &&
  !p.split("/").some((seg) => seg.startsWith(".")) &&
  TEXT_EXTENSIONS.has(path.posix.extname(p).toLowerCase());

export function splitFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta = parseYaml(match[1]) ?? {};
  return { meta: typeof meta === "object" ? (meta as Record<string, unknown>) : {}, body: raw.slice(match[0].length) };
}

/** Builds the skills from content files. Problems are returned, not thrown, so one bad skill never blocks the rest. */
export function parseSkills(files: ContentFiles): { skills: Map<string, Skill>; problems: string[] } {
  const skills = new Map<string, Skill>();
  const problems: string[] = [];
  const folders = new Set<string>();
  for (const p of files.keys()) {
    const parts = p.split("/");
    if (parts[0] === "skills" && parts.length >= 3) folders.add(parts[1]);
  }

  for (const name of [...folders].sort()) {
    const raw = files.get(`skills/${name}/SKILL.md`);
    if (raw === undefined) {
      problems.push(`Folder "skills/${name}" has no SKILL.md.`);
      continue;
    }
    if (!NAME_PATTERN.test(name)) {
      problems.push(`Skill folder "${name}": use lowercase letters, digits and hyphens.`);
      continue;
    }
    let parsed: ReturnType<typeof splitFrontmatter>;
    try {
      parsed = splitFrontmatter(raw);
    } catch (err) {
      problems.push(`Skill "${name}": invalid YAML frontmatter (${(err as Error).message}).`);
      continue;
    }
    const { meta, body } = parsed;
    if (meta.name !== name) {
      problems.push(`Skill "${name}": frontmatter name should be "${name}" (found "${meta.name ?? ""}").`);
    }
    if (typeof meta.description !== "string" || !meta.description.trim()) {
      problems.push(`Skill "${name}": SKILL.md frontmatter needs a "description"; skill skipped.`);
      continue;
    }
    const prefix = `skills/${name}/`;
    skills.set(name, {
      name,
      description: meta.description.trim().replace(/\s+/g, " "),
      body: body.trim(),
      files: [...files.keys()]
        .filter((p) => p.startsWith(prefix) && p !== `${prefix}SKILL.md`)
        .map((p) => p.slice(prefix.length))
        .sort(),
    });
  }
  return { skills, problems };
}

/** Extra files can only be read if they are in the content map, so "../" tricks cannot reach the disk. */
export function readSkillFile(files: ContentFiles, skill: Skill, file: string): string {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  const text = skill.files.includes(normalized) ? files.get(`skills/${skill.name}/${normalized}`) : undefined;
  if (text === undefined) {
    throw new Error(`Skill "${skill.name}" has no file "${file}". Available: ${skill.files.join(", ") || "(none)"}`);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Team settings: team/team.yaml (machine-readable) and team/conventions.md (for the model)

const prefixList = z.array(z.string().min(1)).min(1);

const teamSchema = z
  .object({
    team: z.string().optional(),
    adt: z
      .object({
        /** Write tools accept only object names starting with one of these. */
        objectPrefixes: prefixList.optional(),
        /** Write tools accept only packages starting with one of these. */
        packagePrefixes: prefixList.optional(),
      })
      .optional(),
  })
  .passthrough();

export interface Team {
  /** team/conventions.md body, or "" if missing. */
  conventions: string;
  /** team/team.yaml as text (shown to the model as-is), or "". */
  yaml: string;
  objectPrefixes: string[];
  packagePrefixes: string[];
}

const DEFAULT_OBJECT_PREFIXES = ["Z", "Y"];
const DEFAULT_PACKAGE_PREFIXES = ["Z", "Y", "$"];

export function parseTeam(files: ContentFiles): { team: Team; problems: string[] } {
  const problems: string[] = [];
  const yamlText = files.get("team/team.yaml") ?? "";
  const conventionsRaw = files.get("team/conventions.md") ?? "";
  let adt: z.infer<typeof teamSchema>["adt"];
  if (yamlText) {
    try {
      const result = teamSchema.safeParse(parseYaml(yamlText) ?? {});
      if (result.success) adt = result.data.adt;
      else problems.push(`team/team.yaml: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    } catch (err) {
      problems.push(`team/team.yaml: invalid YAML (${(err as Error).message}).`);
    }
  }
  const upper = (list: string[] | undefined, fallback: string[]) => (list ?? fallback).map((p) => p.toUpperCase());
  return {
    team: {
      conventions: splitFrontmatter(conventionsRaw).body.trim(),
      yaml: yamlText.trim(),
      objectPrefixes: upper(adt?.objectPrefixes, DEFAULT_OBJECT_PREFIXES),
      packagePrefixes: upper(adt?.packagePrefixes, DEFAULT_PACKAGE_PREFIXES),
    },
    problems,
  };
}

/** Reads skills/ and team/ from a folder on disk (repo checkout or the installed package). */
export async function readContentDir(baseDir: string): Promise<ContentFiles> {
  const files: ContentFiles = new Map();
  async function walk(dir: string, rel: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // folder missing: nothing to add
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel);
      else if (entry.isFile() && isContentPath(childRel)) {
        files.set(childRel, (await readFile(path.join(dir, entry.name), "utf8")).replace(/\r\n/g, "\n"));
      }
    }
  }
  for (const root of CONTENT_ROOTS) {
    const name = root.slice(0, -1);
    await walk(path.join(baseDir, name), name);
  }
  return files;
}
