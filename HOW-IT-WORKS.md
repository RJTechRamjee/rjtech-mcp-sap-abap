# How it works

How this server turns a GitHub repo of Markdown skills into something GitHub Copilot uses,
and how changes reach the whole team without anyone pulling. For setup, see [TEAM-SETUP.md](TEAM-SETUP.md).

---

## What makes it an MCP server

MCP (Model Context Protocol) is a **standard contract between AI clients and
servers**: a fixed set of JSON-RPC messages. A program is an MCP server because it
answers those messages in the agreed format, not because of what it serves.

ABAP comparison: **MCP is to AI clients what OData is to Fiori.** Any client that
speaks the protocol can use any server. The official SDK
(`@modelcontextprotocol/sdk`) plays the role of the Gateway/RAP framework: you
declare what you offer, the framework handles the protocol.

| Class | Where | Job |
|---|---|---|
| `McpServer` | [server/src/mcp.ts](server/src/mcp.ts) | Declares what the server offers (tools, resources, instructions) |
| `StdioServerTransport` | [server/src/index.ts](server/src/index.ts) | Reads JSON-RPC from stdin and writes replies to stdout |

**Transport: stdio.** The IDE starts the server as a child process and talks to it through
stdin/stdout. There is no port, no URL and no API key: only the IDE that started the
process can talk to it. That's why the hosted BTP version and its API key are gone.

---

## Two repos, three ways things update

```
GitHub                                         Each developer's PC
──────                                         ───────────────────
rjtech-sap-abap-skills  (content)              IDE starts: npx -y <...>/releases/latest/download/rjtech-mcp-sap-abap.tgz
  skills/*/SKILL.md          ◄── every 5 min ──  MCP server
  project/conventions.md         (download only    ├─ ContentStore: current skills + conventions
  project/project.yaml + naming/  if changed)       ├─ cache:  %USERPROFILE%\.rjtech-mcp\cache\
                                                    ├─ server: %USERPROFILE%\.rjtech-mcp\server\<version>.mjs
rjtech-mcp-sap-abap  (code)                         └─ config: %USERPROFILE%\.rjtech-mcp\config.env
  push to main ─► GitHub Action ─► Release  ◄── on start ── newer release? download it and switch to it
```

| What changes | Who does it | How it reaches developers |
|---|---|---|
| A skill or `project/*` | Merge a PR in the skills repo | The server notices within about 5 minutes, while running, with no restart |
| Server code | Merge to main here | The Action creates a GitHub Release; each server switches to it on its next start |
| Personal settings (SAP password) | The `setup` command | Read at server start |

No package registry is involved: everything is downloaded from your own GitHub repos.

### Why the server updates itself

`npx` installs the launcher once and then **caches it forever**. A new file under the same URL
is ignored, which was tested. So each release bundle checks on start:

1. Ask `github.com/<server repo>/releases/latest`. GitHub redirects to the newest tag, e.g. `v0.2.17`.
2. If that's newer than anything on disk, download the one-file bundle into `%USERPROFILE%\.rjtech-mcp\server\`.
3. Run the newest bundle on disk instead of itself (hand-over). If GitHub can't be reached, use the newest one already downloaded.

### The live sync, step by step ([store.ts](server/src/store.ts))

1. Ask GitHub for the branch's head commit, the same way `git ls-remote` does. This is
   deliberately **not** the GitHub REST API, which without a login allows only 60 requests per
   hour per network address, and a team in one office shares that.
2. If the commit is the same as last time, stop.
3. Otherwise, download the repo as one compressed archive and keep the text files under
   `skills/` and `project/`. The new set replaces the old one in a single step, so the model never
   sees half an update.
4. The result is written to the disk cache. The next IDE start uses it immediately, even offline.
5. Connected clients are told that the tool and resource lists changed.

If GitHub can't be reached, the server keeps the last good version and `skills_status` shows the error.

---

## What the server offers

| MCP concept | Here | Purpose |
|---|---|---|
| **Instructions** | `buildInstructions` in [mcp.ts](server/src/mcp.ts) | Sent once at connect: project conventions, the naming topic index, "call `load_skill` before writing code", and a one-line index of all skills |
| **Tools** | `list_skills`, `load_skill(name, file?)`, `get_project_conventions(topic?)`, `skills_status` | Functions the **model decides to call on its own** |
| **ADT tools** (if SAP is configured) | `adt_create_class`, `adt_create_interface`, `adt_update_source`, `adt_activate`, `adt_read_source`, `adt_discovery`, `adt_get` | Create, change and activate objects through the same REST API Eclipse uses |
| **Resources** | `skill://<name>/<file>`, `project://conventions`, `project://naming/<topic>` | The same content as documents the user can browse and attach |

Tools work like function modules the AI can call. Resources work like files it can open.

The model reads only the **descriptions** when it decides what to call. If Copilot doesn't
pick a skill on its own, improve that skill's `description`.

---

## One conversation, step by step

Prompt in Copilot Agent mode: *"Create a managed RAP BO for Travel"*.

```
Copilot                                           MCP server (child process of the IDE)
───────                                           ─────────────────────────────────────
1. initialize                               ──►
                                            ◄──   name, version, instructions
                                                  (project conventions + skill index)
2. tools/list                               ──►
                                            ◄──   list_skills, load_skill, ... + schemas
3. tools/call load_skill rap-managed-bo     ──►
                                            ◄──   SKILL.md text
4. tools/call load_skill                    ──►
     file=references/templates.md
                                            ◄──   templates.md text
5. (with ADT) tools/call adt_create_class   ──►   name guard: ZRJ_* in ZRJ_*/$ package?
                                                  lock → write → unlock → activate in SAP
                                            ◄──   "Activated ZRJ_CL_..." or errors with line numbers
```

Key points:

- **Skills are instructions only.** Nothing in the skills repo is executed. The model in Copilot does the thinking.
- **Progressive disclosure:** the model gets a short index first, then loads a full skill, then loads `references/` files only when needed.
- **Path traversal is impossible by construction:** files are served from the in-memory map of synced files, never from a path on disk.
- **ADT guard:** write tools only accept names allowed by `project/project.yaml` (currently `ZRJ_`), and never anything outside Z*/Y*/$.
- **MCP tools are only used in Copilot Agent mode.**

---

## Server vs. MCP registry

A registry (the official one at `registry.modelcontextprotocol.io`, or GitHub's at
github.com/mcp) **doesn't run anything**. It's a catalog of metadata: the name, a description,
and how to start or reach the server. It isn't needed here: the JSON in TEAM-SETUP.md does the
same job, and a registry entry would make the server public, which this project avoids.

---

## Watch it yourself

```powershell
npm run smoke -- ..\rjtech-sap-abap-skills   # starts the server, calls every tool, tests live reload
npm run inspect                              # MCP Inspector: shows each JSON-RPC message
```
