import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Content = every synced text file, keyed by its repo path with "/" separators,
 * e.g. "skills/rap-managed-bo/SKILL.md" or "project/project.yaml".
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

export const CONTENT_ROOTS = ["skills/", "project/"];
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
// Project settings: project/project.yaml (machine-readable), project/conventions.md (core rules,
// always shown to the model) and project/naming/<topic>.md (detailed naming rules, loaded on demand)

const prefixList = z.array(z.string().min(1)).min(1);
/** Module and submodule codes go into object names (ZRJ_<MOD>_<SUB>_...), so keep them short. */
const moduleCode = z.string().regex(/^[A-Z]{2,3}$/, "use 2-3 upper-case letters");

// project.yaml is checked in two independent parts, so a mistake in the module list can
// never switch the ADT write guard back to the looser defaults.
const adtSchema = z
  .object({
    project: z.string().optional(),
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

const modulesSchema = z
  .object({
    modules: z
      .record(moduleCode, z.object({ name: z.string().min(1), submodules: z.record(moduleCode, z.string().min(1)) }).passthrough())
      .optional(),
    applications: z
      .array(z.object({ name: z.string().min(1), module: z.string().optional(), submodule: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    // An application may only use module/submodule codes that are defined under modules.
    for (const [i, app] of (data.applications ?? []).entries()) {
      if (app.module === undefined && app.submodule === undefined) continue;
      const mod = app.module === undefined ? undefined : data.modules?.[app.module];
      if (!mod) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["applications", i, "module"], message: `"${app.module ?? ""}" is not defined under modules` });
      } else if (app.submodule === undefined || !(app.submodule in mod.submodules)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["applications", i, "submodule"],
          message: `"${app.submodule ?? ""}" is not a submodule of ${app.module}`,
        });
      }
    }
  });

/** A detailed naming file, project/naming/<name>.md, loaded on demand via get_project_conventions(topic). */
export interface NamingTopic {
  name: string;
  /** From frontmatter: tells the model when to load the topic. */
  description: string;
  body: string;
}

export interface Project {
  /** project/conventions.md body, or "" if missing. Always part of the server instructions. */
  conventions: string;
  /** project/naming/*.md, sorted by name. */
  topics: NamingTopic[];
  /** project/project.yaml as text (shown to the model as-is), or "". */
  yaml: string;
  objectPrefixes: string[];
  packagePrefixes: string[];
}

const DEFAULT_OBJECT_PREFIXES = ["Z", "Y"];
const DEFAULT_PACKAGE_PREFIXES = ["Z", "Y", "$"];
export const PROJECT_YAML = "project/project.yaml";
export const PROJECT_CONVENTIONS = "project/conventions.md";
const NAMING_FILE = /^project\/naming\/([^/]+)\.md$/;

export function parseProject(files: ContentFiles): { project: Project; problems: string[] } {
  const problems: string[] = [];
  const yamlText = files.get(PROJECT_YAML) ?? "";
  const conventionsRaw = files.get(PROJECT_CONVENTIONS) ?? "";
  let adt: z.infer<typeof adtSchema>["adt"];
  const report = (error: z.ZodError) =>
    problems.push(`${PROJECT_YAML}: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  if (yamlText) {
    try {
      const data: unknown = parseYaml(yamlText) ?? {};
      const adtResult = adtSchema.safeParse(data);
      if (adtResult.success) adt = adtResult.data.adt;
      else report(adtResult.error);
      const modulesResult = modulesSchema.safeParse(data);
      if (!modulesResult.success) report(modulesResult.error);
    } catch (err) {
      problems.push(`${PROJECT_YAML}: invalid YAML (${(err as Error).message}).`);
    }
  }
  const topics: NamingTopic[] = [];
  for (const [p, raw] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const match = NAMING_FILE.exec(p);
    if (!match) continue;
    const name = match[1];
    if (!NAME_PATTERN.test(name)) {
      problems.push(`${p}: use lowercase letters, digits and hyphens in the file name.`);
      continue;
    }
    let parsed: ReturnType<typeof splitFrontmatter>;
    try {
      parsed = splitFrontmatter(raw);
    } catch (err) {
      problems.push(`${p}: invalid YAML frontmatter (${(err as Error).message}).`);
      continue;
    }
    const description = parsed.meta.description;
    if (typeof description !== "string" || !description.trim()) {
      problems.push(`${p}: frontmatter needs a "description"; topic skipped.`);
      continue;
    }
    topics.push({ name, description: description.trim().replace(/\s+/g, " "), body: parsed.body.trim() });
  }
  const upper = (list: string[] | undefined, fallback: string[]) => (list ?? fallback).map((p) => p.toUpperCase());
  return {
    project: {
      conventions: splitFrontmatter(conventionsRaw).body.trim(),
      topics,
      yaml: yamlText.trim(),
      objectPrefixes: upper(adt?.objectPrefixes, DEFAULT_OBJECT_PREFIXES),
      packagePrefixes: upper(adt?.packagePrefixes, DEFAULT_PACKAGE_PREFIXES),
    },
    problems,
  };
}

/** Reads skills/ and project/ from a folder on disk (repo checkout or the installed package). */
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
