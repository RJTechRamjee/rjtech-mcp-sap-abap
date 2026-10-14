# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A remote MCP server that serves SAP ABAP Agent Skills (`skills/<name>/SKILL.md` folders) over Streamable HTTP, so the same skills can be used from VS Code and Eclipse (ADT) in any workspace. It is hosted on SAP BTP trial (Cloud Foundry). Skills are instructions only; nothing in them is executed on the server.

## Commands

- `npm run dev` runs the TypeScript sources with auto-reload (tsx).
- `npm run build` compiles `server/src` to `server/dist`. `npm run typecheck` checks types without emitting.
- `npm start` runs the compiled server.
- `npm run inspect` opens the MCP Inspector to call the tools by hand.
- `npm run deploy` builds, then runs `cf push`. The compiled `server/dist` is uploaded because CF does not install devDependencies, so always build before pushing.

There is no test suite. To verify a change, start the server (`MCP_API_KEY=<key> npm run dev`) and POST JSON-RPC to `/mcp` with headers `Accept: application/json, text/event-stream` and `Authorization: Bearer <key>` or `x-api-key: <key>`, e.g. `tools/call` for `list_skills` and `load_skill`.

Environment: `MCP_API_KEY` (required, comma-separated list allowed for rotation), `MCP_AUTH_DISABLED=true` (local only; the server otherwise refuses to start without a key), `PORT` (default 3000, set by CF), `SKILLS_DIR` (default `<repo>/skills`). On CF, set the key with `cf set-env`, never in `manifest.yml`.

## Architecture

- `server/src/skills.ts` reads all skills once at startup into memory. A folder counts as a skill if it has `SKILL.md` with a YAML frontmatter `description`; the folder name (lowercase, digits, hyphens) is the skill name. Extra text files in the folder (e.g. `references/*.md`) are listed and served too. `readSkillFile` only serves files found at startup, which is what blocks path traversal. Changing skills requires a restart or redeploy.
- `server/src/mcp.ts` builds the MCP server: the server `instructions` hold a one-line index of all skills; each file is a resource at `skill://<name>/<path>`; the tools are `list_skills` and `load_skill(name, file?)`. This is progressive disclosure: the model sees the index, loads a `SKILL.md` on demand, then loads `references/` files only when needed.
- `server/src/index.ts` is the Express app. Transport is **stateless** Streamable HTTP: a new `McpServer` and transport per POST, no session IDs, so any CF instance or restart can serve any request. GET/DELETE on `/mcp` return 405. `/health` is unauthenticated for the CF health check.
- `server/src/auth.ts` checks the API key using constant-time comparison of SHA-256 digests. OAuth (BTP XSUAA) is a planned replacement.

## Writing skills

Each `SKILL.md` starts with frontmatter `name` (equal to the folder name) and `description`. The description is what the model uses to pick the skill, so say what it does *and* when to use it. Keep `SKILL.md` focused on workflow and rules, and move long code templates into `references/`. Skills target ABAP Cloud (released APIs only), RAP with `strict ( 2 )`, CDS view entities and OData V4. Skills point to each other by name (e.g. `rap-managed-bo` points to `rap-odata-v4-service`), so keep names stable.

## BTP trial notes

Trial CF apps are stopped automatically, so restart them with `cf start rjtech-mcp-sap-abap`. The trial account expires unless extended. Everything needed to redeploy lives in this repo. Step-by-step deploy, first-push and key-rotation instructions are in `DEPLOY.md`.
