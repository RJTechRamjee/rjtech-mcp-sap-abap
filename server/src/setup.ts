import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { AdtClient } from "./adt.js";
import { configFile, DEFAULT_REPO, homeDir, readSettings } from "./config.js";
import { ContentStore } from "./store.js";
import { LAUNCH_URL } from "./updater.js";

/** Settings the setup asks for, in this order. */
const KEYS = ["SAP_URL", "SAP_USER", "SAP_PASSWORD", "SAP_CLIENT", "SAP_LANGUAGE", "GITHUB_TOKEN", "SKILLS_REPO"] as const;

/**
 * One-time (or repeat) setup: asks for the per-developer settings, writes them to
 * ~/.rjtech-mcp/config.env, tests GitHub and SAP, and prints the IDE config to paste.
 */
export async function runSetup(version: string): Promise<void> {
  console.log(`SAP ABAP skills MCP server ${version}: setup`);
  console.log(`Settings file: ${configFile}`);
  console.log("Press Enter to keep the value in [brackets].\n");

  const current = await readEnvFile(configFile);
  const values: Record<string, string> = { ...current };
  const prompt = createPrompter();
  const { ask, hidden } = prompt;

  try {
    const useAdt = (await ask("Connect the ADT tools to an SAP system so Copilot can create objects? (y/n)", current.SAP_URL ? "y" : "n"))
      .toLowerCase()
      .startsWith("y");
    if (useAdt) {
      values.SAP_URL = (await ask("  SAP system URL (Docker trial: http://localhost:50000)", current.SAP_URL ?? "http://localhost:50000")).replace(/\/+$/, "");
      values.SAP_USER = await ask("  SAP user", current.SAP_USER ?? "DEVELOPER");
      const pw = await hidden(`  SAP password${current.SAP_PASSWORD ? " [keep current]" : ""}: `);
      if (pw) values.SAP_PASSWORD = pw;
      values.SAP_CLIENT = await ask("  SAP client", current.SAP_CLIENT ?? "001");
      values.SAP_LANGUAGE = (await ask("  Logon language", current.SAP_LANGUAGE ?? "EN")).toUpperCase();
    } else {
      for (const k of ["SAP_URL", "SAP_USER", "SAP_PASSWORD", "SAP_CLIENT", "SAP_LANGUAGE"]) delete values[k];
    }
    console.log("\nThe skills repo is public, so a GitHub token is optional (it only raises GitHub's rate limit).");
    const token = await hidden(`GitHub token (optional)${current.GITHUB_TOKEN ? " [keep current, '-' to remove]" : ""}: `);
    if (token === "-") delete values.GITHUB_TOKEN;
    else if (token) values.GITHUB_TOKEN = token;
  } finally {
    prompt.close();
  }

  if (useAdtMissingPassword(values)) {
    console.log("\nNo SAP password given; ADT tools will stay off until you run setup again.");
    delete values.SAP_URL;
  }

  await mkdir(homeDir, { recursive: true });
  await writeFile(configFile, renderEnvFile(values), { encoding: "utf8", mode: 0o600 });
  console.log(`\nSaved ${configFile}`);

  // Tests use exactly what the server will use.
  const env = { ...process.env, ...values };
  const settings = readSettings({ ...env, LOCAL_CONTENT_DIR: undefined });
  process.stdout.write(`Checking skills repo github.com/${settings.repo} ... `);
  const store = await ContentStore.start(settings);
  await store.sync();
  store.stop();
  console.log(store.lastError ? `FAILED: ${store.lastError}` : `OK, ${store.current.skills.size} skill(s)`);

  if (values.SAP_URL) {
    process.stdout.write(`Checking SAP system ${values.SAP_URL} ... `);
    try {
      const adt = new AdtClient({
        url: values.SAP_URL,
        user: values.SAP_USER,
        password: values.SAP_PASSWORD,
        client: values.SAP_CLIENT ?? "001",
        language: values.SAP_LANGUAGE ?? "EN",
      });
      await adt.discovery("classes");
      console.log("OK");
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}${err instanceof TypeError ? " (is the system running?)" : ""}`);
    }
  }

  console.log(ideSnippets());
}

const useAdtMissingPassword = (v: Record<string, string>) => Boolean(v.SAP_URL && !v.SAP_PASSWORD);

function ideSnippets(): string {
  const args = ["/c", "npx", "-y", LAUNCH_URL];
  const vscode = { servers: { "sap-abap-skills": { type: "stdio", command: "cmd", args } } };
  const eclipse = { servers: { "sap-abap-skills": { type: "stdio", command: "cmd", args } } };
  return [
    "",
    "Next: add the server to your IDE once (details in TEAM-SETUP.md).",
    "",
    "VS Code: Command Palette > 'MCP: Open User Configuration', then merge in:",
    JSON.stringify(vscode, null, 2),
    "",
    "Eclipse (GitHub Copilot): Preferences > GitHub Copilot > MCP, then merge in:",
    JSON.stringify(eclipse, null, 2),
    "",
    "Restart the IDE (or the MCP server) and use Copilot Chat in Agent mode.",
  ].join("\n");
}

/**
 * One line reader for all prompts. Lines are consumed through an async iterator, which buffers
 * them, so piped input works too. For secrets, the terminal echo is muted while typing.
 */
function createPrompter() {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  // Ctrl+C in terminal mode arrives on the interface, not as a process signal.
  rl.on("SIGINT", () => {
    process.stdout.write("\nCancelled; nothing was saved.\n");
    process.exit(130);
  });
  const lines = rl[Symbol.asyncIterator]();
  const next = async () => {
    const r = await lines.next();
    return r.done ? "" : String(r.value).trim();
  };
  return {
    ask: async (q: string, def = "") => {
      process.stdout.write(def ? `${q} [${def}]: ` : `${q}: `);
      return (await next()) || def;
    },
    hidden: async (q: string) => {
      process.stdout.write(q);
      muted = true;
      try {
        return await next();
      } finally {
        muted = false;
        process.stdout.write("\n");
      }
    },
    close: () => rl.close(),
  };
}

async function readEnvFile(file: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(file, "utf8"));
  } catch {
    return {};
  }
}

/** Minimal parser for the file this setup writes (KEY=value, optionally quoted). */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'" || q === "`") && v.endsWith(q) && v.length >= 2) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function quote(v: string): string {
  // Node's env-file parser accepts ", ' or ` quotes; pick one the value doesn't contain.
  const q = ['"', "'", "`"].find((c) => !v.includes(c)) ?? '"';
  return `${q}${v}${q}`;
}

function renderEnvFile(values: Record<string, string>): string {
  const lines = [
    "# Settings for the SAP ABAP skills MCP server. Written by the server's `setup` command.",
    "# Personal: contains your SAP password. Never commit or share this file.",
    "",
  ];
  const ordered = [...KEYS, ...Object.keys(values).filter((k) => !(KEYS as readonly string[]).includes(k))];
  for (const k of ordered) {
    if (values[k] === undefined || values[k] === "") continue;
    if (k === "SKILLS_REPO" && values[k] === DEFAULT_REPO) continue;
    lines.push(`${k}=${quote(values[k])}`);
  }
  return lines.join("\n") + "\n";
}
