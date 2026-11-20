import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { homeDir, log, USER_AGENT } from "./config.js";

/**
 * Self-update without any package registry.
 *
 * Every release of the server repo carries the whole server as one file (ASSET, dependencies
 * bundled in). On start, the running server asks GitHub which release is the latest (the
 * redirect of /releases/latest, so no API rate limit), downloads a newer bundle once into
 * ~/.rjtech-mcp/server/<version>.mjs, and hands over to the newest bundle on disk.
 * Whatever version the IDE launched (npx caches it forever) therefore always delegates to
 * the latest release.
 */
export const SERVER_REPO = process.env.SERVER_REPO ?? "RJTechRamjee/rjtech-mcp-sap-abap";
export const ASSET = "rjtech-mcp-sap-abap.mjs";
/** What the IDE runs. npx installs it once; after that the server updates itself (see below). */
export const LAUNCH_URL = `https://github.com/${SERVER_REPO}/releases/latest/download/rjtech-mcp-sap-abap.tgz`;
/** Base of the release URLs. Overridable only so the updater can be tested against a local server. */
const releasesBase = () => process.env.RJTECH_MCP_RELEASES_URL ?? `https://github.com/${SERVER_REPO}/releases`;
const serverDir = path.join(homeDir, "server");
const VERSION_FILE = /^(\d+\.\d+\.\d+)\.mjs$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Latest release version from the redirect of github.com/<repo>/releases/latest, or undefined if there is none. */
export async function latestReleaseVersion(): Promise<string | undefined> {
  const res = await fetch(`${releasesBase()}/latest`, {
    method: "HEAD",
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(4_000),
  });
  return /\/releases\/tag\/v?(\d+\.\d+\.\d+)$/.exec(res.headers.get("location") ?? "")?.[1];
}

async function download(version: string): Promise<string> {
  const url = `${releasesBase()}/download/v${version}/${ASSET}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`download of v${version} failed (HTTP ${res.status})`);
  const code = await res.text();
  if (!code.includes("rjtech-mcp-sap-abap")) throw new Error(`v${version} download does not look like the server bundle`);
  await mkdir(serverDir, { recursive: true });
  const file = path.join(serverDir, `${version}.mjs`);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, code, "utf8");
  await rename(tmp, file); // atomic: another IDE window never runs a half-written file
  return file;
}

/**
 * Returns the bundle file to hand over to, or undefined to keep running this version.
 * Never throws: offline or GitHub trouble just means "run what we have".
 */
export async function findNewerServer(ownVersion: string): Promise<{ file: string; version: string } | undefined> {
  let best = ownVersion;
  let bestFile: string | undefined;
  const local = await readdir(serverDir).catch(() => [] as string[]);
  for (const f of local) {
    const v = VERSION_FILE.exec(f)?.[1];
    if (v && compareVersions(v, best) > 0) {
      best = v;
      bestFile = path.join(serverDir, f);
    }
  }
  try {
    const latest = await latestReleaseVersion();
    if (latest && compareVersions(latest, best) > 0) {
      log(`Downloading server v${latest}...`);
      bestFile = await download(latest);
      best = latest;
    }
  } catch (err) {
    log(`Update check skipped (${(err as Error).message}); using v${best}.`);
  }
  // Keep only the newest two bundles.
  const keep = local
    .map((f) => VERSION_FILE.exec(f)?.[1])
    .filter((v): v is string => Boolean(v))
    .concat(best)
    .sort(compareVersions)
    .slice(-2);
  for (const f of local) {
    const v = VERSION_FILE.exec(f)?.[1];
    if (v && !keep.includes(v)) await rm(path.join(serverDir, f), { force: true }).catch(() => undefined);
  }
  return bestFile ? { file: bestFile, version: best } : undefined;
}
