import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { homeDir, log, USER_AGENT, type Settings } from "./config.js";
import {
  isContentPath,
  parseAgents,
  parseProject,
  parseSkills,
  readContentDir,
  type Agent,
  type ContentFiles,
  type Project,
  type Skill,
} from "./skills.js";

/** One consistent version of all skills and project settings. Replaced as a whole on every change. */
export interface Snapshot {
  files: ContentFiles;
  skills: Map<string, Skill>;
  project: Project;
  /** Copilot custom agents (agents/*.agent.md), installed into the IDEs by agents.ts. */
  agents: Agent[];
  problems: string[];
  /** Where the content came from, e.g. "github main@1a2b3c4" or "local folder". */
  source: string;
}

interface CacheFile {
  /** 3 since agents/ is synced too: older caches lack it, so they are re-downloaded once. */
  format: 3;
  repo: string;
  branch: string;
  commit: string;
  files: Record<string, string>;
}

function buildSnapshot(files: ContentFiles, source: string): Snapshot {
  const s = parseSkills(files);
  const p = parseProject(files);
  const a = parseAgents(files);
  return { files, skills: s.skills, project: p.project, agents: a.agents, problems: [...s.problems, ...p.problems, ...a.problems], source };
}

/**
 * Holds the current snapshot and keeps it up to date:
 * - github mode: every few minutes, asks GitHub for the branch's head commit the way
 *   `git ls-remote` does (git's HTTP endpoint, not the REST API, so no 60/hour limit per
 *   office IP). Only when the commit changed, it downloads one tarball of the repo.
 *   The result is cached on disk so the server starts instantly and works offline.
 * - local mode: re-reads a folder (for testing skills before pushing them).
 */
export class ContentStore {
  private snapshot: Snapshot;
  private cache?: CacheFile;
  private listeners: ((s: Snapshot) => void)[] = [];
  private timer?: NodeJS.Timeout;
  private syncing?: Promise<void>;
  lastCheck?: Date;
  lastError?: string;

  private constructor(private readonly settings: Settings, initial: Snapshot) {
    this.snapshot = initial;
  }

  get current(): Snapshot {
    return this.snapshot;
  }

  get description(): string {
    const s = this.settings;
    return s.mode === "local"
      ? `local folder ${s.localDir}`
      : `github.com/${s.repo} (branch ${s.branch}), checked every ${s.syncIntervalMs / 60_000} min`;
  }

  onChange(fn: (s: Snapshot) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  /** Loads the best content available right now (disk cache, else a first download), then keeps syncing. */
  static async start(settings: Settings): Promise<ContentStore> {
    if (settings.mode === "local") {
      const store = new ContentStore(settings, buildSnapshot(await readContentDir(settings.localDir), "local folder"));
      store.schedule();
      return store;
    }
    const cache = await readCache(settings);
    const initial = cache
      ? buildSnapshot(new Map(Object.entries(cache.files)), `github ${settings.branch}@${cache.commit.slice(0, 7)} (cached)`)
      : buildSnapshot(new Map(), "not synced yet");
    const store = new ContentStore(settings, initial);
    store.cache = cache;
    const first = store.sync();
    // With a cache, sync in the background so the IDE never waits on the network.
    // Without one (first run), wait briefly so the model sees the skills from the start.
    if (!cache) await Promise.race([first, new Promise((r) => setTimeout(r, 8_000).unref())]);
    store.schedule();
    return store;
  }

  private schedule() {
    this.timer = setInterval(() => void this.sync(), this.settings.syncIntervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Checks for new content now. Concurrent calls share one run. */
  sync(): Promise<void> {
    this.syncing ??= this.runSync().finally(() => (this.syncing = undefined));
    return this.syncing;
  }

  private async runSync(): Promise<void> {
    this.lastCheck = new Date();
    try {
      if (this.settings.mode === "local") {
        const files = await readContentDir(this.settings.localDir);
        if (!sameFiles(files, this.snapshot.files)) this.publish(buildSnapshot(files, "local folder"));
      } else {
        await this.syncGithub();
      }
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error).message;
      log(`Sync failed, keeping the current skills: ${this.lastError}`);
    }
  }

  private async syncGithub(): Promise<void> {
    const { repo, branch } = this.settings;
    const commit = await this.headCommit();
    if (this.cache && commit === this.cache.commit) return;

    const files = await this.downloadTarball(commit);
    this.cache = { format: 3, repo, branch, commit, files: Object.fromEntries(files) };
    await writeCache(this.settings, this.cache);
    const snapshot = buildSnapshot(files, `github ${branch}@${commit.slice(0, 7)}`);
    this.publish(snapshot);
    log(`Synced ${snapshot.skills.size} skill(s) from ${repo}@${commit.slice(0, 7)}.`);
  }

  /** The branch's head commit, via git's smart-HTTP ref advertisement (what `git ls-remote` uses). */
  private async headCommit(): Promise<string> {
    const { repo, branch, token } = this.settings;
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (token) headers.Authorization = `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    const res = await fetch(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 404
          ? `Repo ${repo} not found (HTTP ${res.status}). Check SKILLS_REPO; a private repo needs GITHUB_TOKEN.`
          : `GitHub returned HTTP ${res.status} for ${repo}.`,
      );
    }
    const refs = await res.text();
    const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sha = new RegExp(`([0-9a-f]{40}) refs/heads/${escaped}(?:\\u0000|\\n)`).exec(refs)?.[1];
    if (!sha) throw new Error(`Branch "${branch}" not found in ${repo}.`);
    return sha;
  }

  private async downloadTarball(commit: string): Promise<ContentFiles> {
    const { repo, token } = this.settings;
    // Public: codeload (no API limit). With a token: the API endpoint, which redirects to codeload.
    const url = token ? `https://api.github.com/repos/${repo}/tarball/${commit}` : `https://codeload.github.com/${repo}/tar.gz/${commit}`;
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Download of ${repo}@${commit.slice(0, 7)} failed (HTTP ${res.status}).`);
    return extractContent(gunzipSync(Buffer.from(await res.arrayBuffer())));
  }

  private publish(snapshot: Snapshot) {
    this.snapshot = snapshot;
    for (const p of snapshot.problems) log(`Content problem: ${p}`);
    for (const l of this.listeners) {
      try {
        l(snapshot);
      } catch (err) {
        log("Change listener failed:", err);
      }
    }
  }
}

/**
 * Reads the text files under skills/, project/ and agents/ from an (uncompressed) tar archive as GitHub
 * produces it: one top folder "<owner>-<repo>-<sha>/", ustar headers, pax headers for long names.
 */
export function extractContent(tar: Buffer): ContentFiles {
  const files: ContentFiles = new Map();
  const str = (start: number, len: number) => tar.subarray(start, start + len).toString("utf8").replace(/\0.*$/s, "");
  let paxPath: string | undefined;
  for (let off = 0; off + 512 <= tar.length; ) {
    if (tar[off] === 0) break; // end-of-archive marker
    const size = parseInt(str(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[off + 156] || 48);
    const prefix = str(off + 345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${str(off, 100)}` : str(off, 100));
    const data = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;

    if (type === "x") {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"))?.[1];
      continue;
    }
    paxPath = undefined;
    if (type !== "0" && type !== "7") continue; // only regular files
    const rel = name.split("/").slice(1).join("/"); // drop "<owner>-<repo>-<sha>/"
    if (isContentPath(rel)) files.set(rel, data.toString("utf8").replace(/\r\n/g, "\n"));
  }
  return files;
}

function sameFiles(a: ContentFiles, b: ContentFiles): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

const cachePath = (s: Settings) => path.join(homeDir, "cache", `${s.repo.replace(/[^A-Za-z0-9._-]/g, "_")}@${s.branch.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);

async function readCache(s: Settings): Promise<CacheFile | undefined> {
  try {
    const cache = JSON.parse(await readFile(cachePath(s), "utf8")) as CacheFile;
    return cache.format === 3 && cache.repo === s.repo && cache.branch === s.branch ? cache : undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(s: Settings, cache: CacheFile): Promise<void> {
  const file = cachePath(s);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    // Write then rename, so another IDE window never reads a half-written file.
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(cache), "utf8");
    await rename(tmp, file);
  } catch (err) {
    log(`Could not write the skills cache (${(err as Error).message}); continuing without it.`);
  }
}
