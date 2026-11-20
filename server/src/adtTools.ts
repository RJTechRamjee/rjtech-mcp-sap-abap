import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AdtClient, AdtError, checkObjectName, checkPackageName, type AdtMessage, type ObjectKind } from "./adt.js";
import type { Project } from "./skills.js";

const kindSchema = z.enum(["class", "interface"]).describe("Object type");
const transportSchema = z
  .string()
  .regex(/^[A-Z0-9]{3}K\d{6}$/i, "Transport request looks like A4HK900123")
  .optional()
  .describe("Transport request, e.g. A4HK900123. Not needed for $ packages such as $TMP.");

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const failure = (t: string) => ({ isError: true, ...text(t) });

function formatMessages(messages: AdtMessage[]): string {
  return messages
    .map((m) => `[${m.type}]${m.object ? ` ${m.object}` : ""}${m.line ? ` line ${m.line}` : ""}: ${m.text}`)
    .join("\n");
}

async function activationReport(adt: AdtClient, objects: { kind: ObjectKind; name: string }[]): Promise<{ ok: boolean; report: string }> {
  const { ok, messages } = await adt.activate(objects);
  const names = objects.map((o) => o.name).join(", ");
  const head = ok ? `Activated ${names}.` : `Activation of ${names} FAILED. Fix the errors and call adt_update_source.`;
  return { ok, report: messages.length ? `${head}\n${formatMessages(messages)}` : head };
}

/** Wraps a tool handler: serializes ADT calls and turns errors into MCP tool errors. */
function guarded<A>(adt: AdtClient, fn: (args: A) => Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }>) {
  return async (args: A) => {
    try {
      return await adt.serialize(() => fn(args));
    } catch (err) {
      if (err instanceof AdtError) return failure(err.message);
      if (err instanceof TypeError) return failure(`Cannot reach the SAP system: ${(err.cause as Error)?.message ?? err.message}`);
      throw err;
    }
  };
}

/** Registers the ADT tools that create and change objects in the connected SAP system. */
export function registerAdtTools(server: McpServer, adt: AdtClient, project: () => Project): void {
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  const read = { readOnlyHint: true, openWorldHint: true };
  // Read the prefixes on every call so a project.yaml change applies without a restart.
  const objName = (n: string) => checkObjectName(n, project().objectPrefixes);
  const pkgName = (n: string) => checkPackageName(n, project().packagePrefixes);

  for (const kind of ["interface", "class"] as const) {
    server.registerTool(
      `adt_create_${kind}`,
      {
        title: `Create ABAP ${kind}`,
        description:
          `Creates a global ABAP ${kind} in the connected SAP system, writes its source and activates it. ` +
          `Only names and packages allowed by the project conventions (see get_project_conventions). Fails if the ${kind} already exists; use adt_update_source then.` +
          (kind === "class" ? " Pass testClasses to fill the local test classes include (ABAP Unit)." : ""),
        inputSchema: {
          name: z.string().describe(kind === "class" ? "e.g. ZRJ_SD_PRC_CL_DISCOUNT_DE" : "e.g. ZRJ_SD_PRC_IF_DISCOUNT"),
          description: z.string().max(60).describe("Short text, max 60 characters"),
          package: z.string().describe("Package, e.g. ZRJ_SD_PRC or $TMP"),
          transport: transportSchema,
          source: z.string().describe(`Full source code of the ${kind}`),
          ...(kind === "class"
            ? { testClasses: z.string().optional().describe("Optional source of the test classes include") }
            : {}),
          activate: z.boolean().default(true).describe("Activate after writing (default true)"),
        },
        annotations: write,
      },
      guarded(adt, async (args: {
        name: string; description: string; package: string; transport?: string;
        source: string; testClasses?: string; activate: boolean;
      }) => {
        const name = objName(args.name);
        const pkg = pkgName(args.package);
        if (!pkg.startsWith("$") && !args.transport) {
          return failure(`Package ${pkg} is transportable; pass a transport request.`);
        }
        await adt.create(kind, name, args.description, pkg, args.transport);
        await adt.writeSource(kind, name, args.source, args.transport, args.testClasses);
        if (!args.activate) return text(`Created ${kind} ${name} in ${pkg} (inactive).`);
        const { ok, report } = await activationReport(adt, [{ kind, name }]);
        return { isError: !ok, ...text(`Created ${kind} ${name} in ${pkg}.\n${report}`) };
      }),
    );
  }

  server.registerTool(
    "adt_update_source",
    {
      title: "Update ABAP source",
      description:
        "Replaces the full source of an existing Z*/Y* class or interface (and optionally the class test classes include), then activates it. Read the current source with adt_read_source first.",
      inputSchema: {
        kind: kindSchema,
        name: z.string(),
        source: z.string().describe("Complete new source (not a diff)"),
        testClasses: z.string().optional().describe("Classes only: complete new test classes include"),
        transport: transportSchema,
        activate: z.boolean().default(true),
      },
      annotations: write,
    },
    guarded(adt, async (args: { kind: ObjectKind; name: string; source: string; testClasses?: string; transport?: string; activate: boolean }) => {
      const name = objName(args.name);
      await adt.writeSource(args.kind, name, args.source, args.transport, args.testClasses);
      if (!args.activate) return text(`Updated ${args.kind} ${name} (inactive).`);
      const { ok, report } = await activationReport(adt, [{ kind: args.kind, name }]);
      return { isError: !ok, ...text(`Updated ${args.kind} ${name}.\n${report}`) };
    }),
  );

  server.registerTool(
    "adt_activate",
    {
      title: "Activate ABAP objects",
      description:
        "Activates several classes/interfaces together (mass activation), e.g. objects that reference each other. Returns errors and warnings with line numbers.",
      inputSchema: {
        objects: z.array(z.object({ kind: kindSchema, name: z.string() })).min(1),
      },
      annotations: { ...write, idempotentHint: true },
    },
    guarded(adt, async ({ objects }: { objects: { kind: ObjectKind; name: string }[] }) => {
      const checked = objects.map((o) => ({ kind: o.kind, name: objName(o.name) }));
      const { ok, report } = await activationReport(adt, checked);
      return { isError: !ok, ...text(report) };
    }),
  );

  server.registerTool(
    "adt_read_source",
    {
      title: "Read ABAP source",
      description: "Reads the source of a class or interface from the SAP system (any name, read only).",
      inputSchema: {
        kind: kindSchema,
        name: z.string(),
        include: z.enum(["main", "testclasses"]).default("main").describe("Classes: main source or test classes include"),
      },
      annotations: read,
    },
    guarded(adt, async ({ kind, name, include }: { kind: ObjectKind; name: string; include: "main" | "testclasses" }) =>
      text(await adt.readSource(kind, name.toUpperCase(), include)),
    ),
  );

  server.registerTool(
    "adt_discovery",
    {
      title: "ADT discovery",
      description:
        "Lists the ADT REST collections the SAP system offers (URL, title, accepted media types). Use a filter such as 'enhancement' to check which object types the system supports.",
      inputSchema: { filter: z.string().optional() },
      annotations: read,
    },
    guarded(adt, async ({ filter }: { filter?: string }) => text(JSON.stringify(await adt.discovery(filter), null, 2))),
  );

  server.registerTool(
    "adt_get",
    {
      title: "ADT GET (raw)",
      description:
        "Read-only: sends a GET to any ADT URL under /sap/bc/adt/ and returns the raw response (XML or text), e.g. the metadata of an existing enhancement spot. Use it to inspect object formats the other tools do not cover.",
      inputSchema: {
        path: z.string().regex(/^\/sap\/bc\/adt\/[^?#]*$/, "Must start with /sap/bc/adt/ and have no query string"),
        accept: z.string().default("*/*").describe("Accept header, e.g. application/xml"),
      },
      annotations: read,
    },
    guarded(adt, async ({ path, accept }: { path: string; accept: string }) => {
      if (path.includes("..")) return failure("Path must not contain '..'.");
      const res = await adt.request("GET", path, { headers: { Accept: accept } });
      return text(`Content-Type: ${res.headers.get("content-type") ?? "?"}\n\n${res.text.slice(0, 50_000)}`);
    }),
  );
}
