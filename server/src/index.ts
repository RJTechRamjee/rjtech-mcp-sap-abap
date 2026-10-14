import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { apiKeyAuth } from "./auth.js";
import { createMcpServer } from "./mcp.js";
import { loadSkills } from "./skills.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsDir = process.env.SKILLS_DIR ?? path.join(repoRoot, "skills");
const port = Number(process.env.PORT ?? 3000);
const apiKeys = process.env.MCP_API_KEY ?? "";
const authDisabled = process.env.MCP_AUTH_DISABLED === "true";

if (!apiKeys && !authDisabled) {
  console.error("MCP_API_KEY is not set. Set it, or set MCP_AUTH_DISABLED=true for local testing only.");
  process.exit(1);
}

const skills = await loadSkills(skillsDir);
console.log(`Loaded ${skills.size} skill(s) from ${skillsDir}: ${[...skills.keys()].join(", ")}`);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Unauthenticated so Cloud Foundry's HTTP health check can reach it.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", skills: skills.size });
});

if (authDisabled) {
  console.warn("WARNING: API key auth is disabled. Never run like this on a public URL.");
} else {
  app.use("/mcp", apiKeyAuth(apiKeys));
}

// Stateless Streamable HTTP: a fresh server and transport per request, so any
// instance can answer any request and app restarts lose nothing.
app.post("/mcp", async (req, res) => {
  const server = createMcpServer(skills);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Stateless mode has no server-initiated stream (GET) or session to end (DELETE).
app.all("/mcp", (_req, res) => {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
});

app.listen(port, () => {
  console.log(`MCP server listening on http://localhost:${port}/mcp`);
});
