/**
 * Minimal client for the ADT REST API (/sap/bc/adt), the HTTP API Eclipse ADT uses.
 * Keeps one cookie jar and CSRF token per process, and runs all calls one at a time,
 * because lock handles belong to the (stateful) session behind the cookies.
 */

export interface AdtConfig {
  url: string;
  user: string;
  password: string;
  client: string;
  language: string;
}

export type ObjectKind = "class" | "interface";

export interface AdtMessage {
  type: string;
  text: string;
  line?: number;
  object?: string;
}

export class AdtError extends Error {}

/**
 * Hard floor, whatever team.yaml says: only customer objects/packages (Z*, Y*, local $ packages).
 * No SAP or namespaced objects.
 */
const OBJECT_NAME = /^[ZY][A-Z0-9_]{1,29}$/;
const PACKAGE_NAME = /^([ZY][A-Z0-9_]{0,29}|\$[A-Z0-9_]{1,29})$/;

/** Checks a name for a write tool. `prefixes` come from team.yaml (adt.objectPrefixes) and narrow the floor further. */
export function checkObjectName(name: string, prefixes: string[] = ["Z", "Y"]): string {
  const upper = name.toUpperCase();
  if (!OBJECT_NAME.test(upper)) throw new AdtError(`Object name "${name}" must start with Z or Y and use only A-Z, 0-9, _ (max 30).`);
  if (!prefixes.some((p) => upper.startsWith(p))) {
    throw new AdtError(`Object name "${name}" must start with ${prefixes.join(" or ")} (team convention, team/team.yaml).`);
  }
  return upper;
}

export function checkPackageName(name: string, prefixes: string[] = ["Z", "Y", "$"]): string {
  const upper = name.toUpperCase();
  if (!PACKAGE_NAME.test(upper)) throw new AdtError(`Package "${name}" must start with Z, Y or $.`);
  if (!prefixes.some((p) => upper.startsWith(p))) {
    throw new AdtError(`Package "${name}" must start with ${prefixes.join(" or ")} (team convention, team/team.yaml).`);
  }
  return upper;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const xmlUnescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function objectUrl(kind: ObjectKind, name: string): string {
  const segment = kind === "class" ? "classes" : "interfaces";
  return `/sap/bc/adt/oo/${segment}/${encodeURIComponent(name.toLowerCase())}`;
}

export class AdtClient {
  private cookies = new Map<string, string>();
  private csrfToken = "";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: AdtConfig) {}

  get systemUrl(): string {
    return this.config.url;
  }

  /** Runs `fn` after all previously queued ADT work has finished. */
  serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(
    method: string,
    path: string,
    options: { query?: Record<string, string | undefined>; body?: string; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; text: string; headers: Headers }> {
    const url = new URL(path, this.config.url);
    url.searchParams.set("sap-client", this.config.client);
    url.searchParams.set("sap-language", this.config.language);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v) url.searchParams.set(k, v);

    const headers: Record<string, string> = {
      Authorization: "Basic " + Buffer.from(`${this.config.user}:${this.config.password}`).toString("base64"),
      "x-csrf-token": this.csrfToken || "fetch",
      "X-sap-adt-sessiontype": "stateful",
      Accept: "*/*",
      ...options.headers,
    };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");

    const res = await fetch(url, { method, headers, body: options.body, redirect: "manual" });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const token = res.headers.get("x-csrf-token");
    if (token && token.toLowerCase() !== "required") this.csrfToken = token;
    return { status: res.status, text: await res.text(), headers: res.headers };
  }

  /** Sends a request; on a CSRF failure fetches a fresh token once and retries. Throws on HTTP errors. */
  async request(
    method: string,
    path: string,
    options: { query?: Record<string, string | undefined>; body?: string; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; text: string; headers: Headers }> {
    if (!this.csrfToken && method !== "GET") await this.send("GET", "/sap/bc/adt/discovery");
    let res = await this.send(method, path, options);
    if (res.status === 403 && res.headers.get("x-csrf-token")?.toLowerCase() === "required") {
      this.csrfToken = "";
      await this.send("GET", "/sap/bc/adt/discovery");
      res = await this.send(method, path, options);
    }
    if (res.status === 401) throw new AdtError("SAP rejected the user or password (HTTP 401). Check SAP_USER / SAP_PASSWORD.");
    if (res.status >= 400) throw new AdtError(`${method} ${path} failed (HTTP ${res.status}): ${exceptionText(res.text)}`);
    return res;
  }

  async lock(objUrl: string): Promise<string> {
    const res = await this.request("POST", objUrl, {
      query: { _action: "LOCK", accessMode: "MODIFY" },
      headers: { Accept: "application/*,application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result" },
    });
    const handle = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(res.text)?.[1];
    if (!handle) throw new AdtError(`Could not lock ${objUrl}: no lock handle in the response.`);
    return xmlUnescape(handle);
  }

  async unlock(objUrl: string, lockHandle: string): Promise<void> {
    await this.request("POST", objUrl, { query: { _action: "UNLOCK", lockHandle } });
  }

  async create(kind: ObjectKind, name: string, description: string, pkg: string, transport?: string): Promise<void> {
    const common =
      `xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${xmlEscape(name)}" ` +
      `adtcore:description="${xmlEscape(description.slice(0, 60))}" adtcore:language="${this.config.language}" ` +
      `adtcore:masterLanguage="${this.config.language}" adtcore:responsible="${xmlEscape(this.config.user.toUpperCase())}"`;
    const packageRef = `<adtcore:packageRef adtcore:name="${xmlEscape(pkg)}"/>`;
    const body =
      kind === "class"
        ? `<?xml version="1.0" encoding="UTF-8"?><class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" ${common} adtcore:type="CLAS/OC" class:final="true" class:visibility="public">${packageRef}<class:superClassRef/></class:abapClass>`
        : `<?xml version="1.0" encoding="UTF-8"?><intf:abapInterface xmlns:intf="http://www.sap.com/adt/oo/interfaces" ${common} adtcore:type="INTF/OI">${packageRef}</intf:abapInterface>`;
    const collection = kind === "class" ? "/sap/bc/adt/oo/classes" : "/sap/bc/adt/oo/interfaces";
    await this.request("POST", collection, {
      query: { corrNr: transport },
      body,
      headers: { "Content-Type": "application/*" },
    });
  }

  /** Writes the main source (and for classes optionally the test classes include). Locks and unlocks around it. */
  async writeSource(kind: ObjectKind, name: string, source: string, transport?: string, testClasses?: string): Promise<void> {
    const objUrl = objectUrl(kind, name);
    const lockHandle = await this.lock(objUrl);
    try {
      await this.request("PUT", `${objUrl}/source/main`, {
        query: { lockHandle, corrNr: transport },
        body: source,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
      if (kind === "class" && testClasses) {
        await this.ensureTestInclude(objUrl, lockHandle, transport);
        await this.request("PUT", `${objUrl}/includes/testclasses`, {
          query: { lockHandle, corrNr: transport },
          body: testClasses,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    } finally {
      await this.unlock(objUrl, lockHandle).catch(() => undefined);
    }
  }

  private async ensureTestInclude(objUrl: string, lockHandle: string, transport?: string): Promise<void> {
    try {
      await this.request("GET", `${objUrl}/includes/testclasses`, { headers: { Accept: "text/plain" } });
      return;
    } catch {
      // Not there yet: create it below.
    }
    await this.request("POST", `${objUrl}/includes`, {
      query: { lockHandle, corrNr: transport },
      body: `<?xml version="1.0" encoding="UTF-8"?><class:abapClassInclude xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="dummy" class:includeType="testclasses"/>`,
      headers: { "Content-Type": "application/*" },
    });
  }

  async readSource(kind: ObjectKind, name: string, include: "main" | "testclasses" = "main"): Promise<string> {
    const objUrl = objectUrl(kind, name);
    const path = include === "main" ? `${objUrl}/source/main` : `${objUrl}/includes/testclasses`;
    return (await this.request("GET", path, { headers: { Accept: "text/plain" } })).text;
  }

  /** Activates the objects together and returns the checker messages. `ok` is false if any error remains. */
  async activate(objects: { kind: ObjectKind; name: string }[]): Promise<{ ok: boolean; messages: AdtMessage[] }> {
    const refs = objects
      .map(({ kind, name }) => `<adtcore:objectReference adtcore:uri="${objectUrl(kind, name)}" adtcore:name="${xmlEscape(name)}"/>`)
      .join("");
    const res = await this.request("POST", "/sap/bc/adt/activation", {
      query: { method: "activate", preauditRequested: "true" },
      body: `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">${refs}</adtcore:objectReferences>`,
      headers: { "Content-Type": "application/xml", Accept: "application/xml" },
    });
    const messages = parseMessages(res.text);
    const notExecuted = /activationExecuted="false"/.test(res.text);
    return { ok: !notExecuted && !messages.some((m) => m.type === "E" || m.type === "A"), messages };
  }

  /** Lists ADT collections from the discovery document, optionally filtered by a text in href, title or media type. */
  async discovery(filter?: string): Promise<{ href: string; title: string; accept: string[] }[]> {
    const res = await this.request("GET", "/sap/bc/adt/discovery", { headers: { Accept: "application/atomsvc+xml" } });
    const result: { href: string; title: string; accept: string[] }[] = [];
    for (const m of res.text.matchAll(/<app:collection\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/app:collection>/g)) {
      const title = /<atom:title>([^<]*)<\/atom:title>/.exec(m[2])?.[1] ?? "";
      const accept = [...m[2].matchAll(/<app:accept>([^<]*)<\/app:accept>/g)].map((a) => a[1]);
      const entry = { href: xmlUnescape(m[1]), title: xmlUnescape(title), accept };
      if (!filter || JSON.stringify(entry).toLowerCase().includes(filter.toLowerCase())) result.push(entry);
    }
    return result;
  }
}

function exceptionText(body: string): string {
  const msg = /<message[^>]*>([\s\S]*?)<\/message>/.exec(body)?.[1];
  return msg ? xmlUnescape(msg.trim()) : body.slice(0, 500);
}

function parseMessages(body: string): AdtMessage[] {
  const messages: AdtMessage[] = [];
  for (const m of body.matchAll(/<msg\b([^>]*)>([\s\S]*?)<\/msg>/g)) {
    const attr = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(m[1])?.[1];
    const text = [...m[2].matchAll(/<txt>([\s\S]*?)<\/txt>/g)].map((t) => xmlUnescape(t[1])).join(" ");
    const line = /#start=(\d+)/.exec(attr("href") ?? "")?.[1];
    messages.push({
      type: attr("type") ?? "?",
      text,
      line: line ? Number(line) : undefined,
      object: attr("objDescr") ? xmlUnescape(attr("objDescr")!) : undefined,
    });
  }
  return messages;
}

/** Reads SAP_* environment variables. Returns undefined when ADT tools are not configured. */
export function adtConfigFromEnv(env = process.env): AdtConfig | undefined {
  if (!env.SAP_URL) return undefined;
  if (!env.SAP_USER || !env.SAP_PASSWORD) {
    throw new Error("SAP_URL is set but SAP_USER or SAP_PASSWORD is missing.");
  }
  return {
    url: env.SAP_URL.replace(/\/+$/, ""),
    user: env.SAP_USER,
    password: env.SAP_PASSWORD,
    client: env.SAP_CLIENT ?? "001",
    language: (env.SAP_LANGUAGE ?? "EN").toUpperCase(),
  };
}
