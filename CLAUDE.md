# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local MCP server (stdio) that each developer's IDE (VS Code, Eclipse ADT with GitHub Copilot) starts via `npx -y https://github.com/RJTechRamjee/rjtech-mcp-sap-abap/releases/latest/download/rjtech-mcp-sap-abap.tgz`. There is deliberately **no npm registry**: the project scope rules out public npmjs. npx caches that launcher forever, so the server updates itself from GitHub Releases (see `updater.ts`). It serves SAP ABAP Agent Skills and project conventions that it syncs live from a **separate public repo**, `RJTechRamjee/rjtech-sap-abap-skills` (`skills/<name>/SKILL.md`, `project/conventions.md`, `project/naming/<topic>.md`, `project/project.yaml`). With SAP settings, it also offers ADT tools that create, update and activate classes and interfaces. There is no hosted server any more: the BTP deployment was removed on 2026-11-20.

## Commands

- `npm run dev` runs the server from source on stdio. It's only useful when started by an MCP client: `.vscode/mcp.json` does this against `../rjtech-sap-abap-skills`.
- `npm run setup` runs the interactive per-user setup (same as `npx rjtech-mcp-sap-abap setup`).
- `npm run validate -- <skills-repo-dir>` checks a skills repo checkout. The skills repo's CI runs the same check through the published package.
- `npm run smoke -- <skills-repo-dir>` is the end-to-end test: it spawns the server over stdio and checks every tool, resources, path traversal and live reload. Without an argument it syncs from GitHub. It uses a temp `RJTECH_MCP_HOME`, so it doesn't touch the user's config.
- `npm run build` bundles everything, dependencies included, into **one file**, `dist/rjtech-mcp-sap-abap.mjs` (esbuild, `scripts/bundle.mjs`, version injected as `__RJTECH_VERSION__`). All npm deps are devDependencies for that reason. `SMOKE_BUNDLE=1 npm run smoke -- <dir>` tests the bundle.
- `npm run typecheck`, `npm run inspect` (MCP Inspector over stdio).
- Releasing: `.github/workflows/release.yml` creates GitHub Release `v<major>.<minor>.<run number>` on every push to `main` that touches `server/**`, `scripts/bundle.mjs` or `package*.json`. It attaches the `.mjs` (for self-update) and a `.tgz` (for the npx launcher), after a smoke test of the bundle. It needs no secrets. Bump major/minor in package.json by hand only for breaking changes.

## Configuration

Settings come from env vars, which win, then from `%USERPROFILE%\.rjtech-mcp\config.env` (written by `setup`). The settings folder can be moved with `RJTECH_MCP_HOME`.

- Skills: `SKILLS_REPO` (default `RJTechRamjee/rjtech-sap-abap-skills`, defined as `DEFAULT_REPO` in `config.ts`), `SKILLS_BRANCH` (main), `SKILLS_SYNC_MINUTES` (5), `GITHUB_TOKEN` (optional for a public repo; raises the rate limit), `LOCAL_CONTENT_DIR` (read a local checkout instead of GitHub, re-read every 10 s; for skill authors).
- Updates: `RJTECH_MCP_AUTO_UPDATE=false` turns self-update off. `SERVER_REPO` sets where releases come from. `RJTECH_MCP_RELEASES_URL` exists only for testing the updater against a local server.
- ADT: `SAP_URL` turns the tools on, together with `SAP_USER`, `SAP_PASSWORD`, `SAP_CLIENT` (001) and `SAP_LANGUAGE` (EN).

## Architecture

- `server/src/index.ts`: the CLI (`serve` is the default, plus `setup`, `validate`, `--version`). `serve` connects `StdioServerTransport`. **stdout is the protocol**, so all logging goes to stderr (`log()` in `config.ts`). Never use `console.log` on the serve path.
- `server/src/updater.ts`: release bundles (not source runs) check `github.com/<repo>/releases/latest` via its redirect, which isn't the REST API and so has no rate limit. They download a newer `.mjs` into `~/.rjtech-mcp/server/<version>.mjs` and `import()` the newest one on disk, with `RJTECH_MCP_HANDED_OVER` set to stop loops. The two newest bundles are kept. Failures fall back to the running version.
- `server/src/store.ts`: `ContentStore` holds one immutable `Snapshot` (files, skills, project, problems) and replaces it whole. In GitHub mode it gets the head commit from `github.com/<repo>.git/info/refs?service=git-upload-pack` (what `git ls-remote` uses). **Avoid the REST API**: unauthenticated it allows 60 requests/hour per IP, which a team behind one office IP would exhaust. Only when the commit changes does it download one tarball from codeload, extracted by `extractContent` (a small tar reader). The cache lives in `~/.rjtech-mcp/cache/<repo>@<branch>.json` (atomic write). On startup it uses the cache, or waits up to 8 s for a first sync. A failed sync keeps the last good snapshot.
- `server/src/skills.ts`: pure parsing from a `ContentFiles` map (repo path to text). A skill is `skills/<name>/SKILL.md` with a frontmatter `description`. Only text files under `skills/` and `project/` are kept (`isContentPath`). `readSkillFile` reads only from the map, which is what blocks path traversal. `parseProject` reads `project/project.yaml` (zod schema; `adt.objectPrefixes` and `adt.packagePrefixes`), `project/conventions.md` and the naming topics `project/naming/<topic>.md` (frontmatter `description` required).
- `server/src/mcp.ts`: one `McpServer` per process. Handlers read `store.current` on each call. On a store change, the `load_skill` description (which holds the skill index) is updated, which sends `tools/list_changed`, and `resources/list_changed` is sent. The server instructions (conventions + index) are fixed per session. The tools are `list_skills`, `load_skill(name, file?)`, `get_project_conventions(topic?)` and `skills_status(refresh?)`. There is one resource template, `skill://{skill}/{+file}`, and one resource, `project://conventions` plus the template `project://naming/{topic}`.
- `server/src/adt.ts` / `adtTools.ts`: the ADT REST client (basic auth, cookies, CSRF, stateful session, lock/write/unlock, activation, all calls serialized). Write tools check names against the project prefixes on every call, on top of a hard Z/Y/$ floor in `checkObjectName`/`checkPackageName`. They never delete. Enhancement spots and BAdI implementations have no tool yet: their XML must first be captured from Eclipse's ABAP Communication Log.
- `server/src/setup.ts`: prompts (with hidden input for secrets), writes `config.env`, tests GitHub and SAP, and prints the IDE JSON.

## Skills

Skills live in the skills repo, not here. Rules for writing them are in that repo's `CONTRIBUTING.md`: frontmatter `name` equals the folder name, the `description` says what the skill does and when to use it, and it targets ABAP Cloud, RAP `strict ( 2 )`, CDS view entities and OData V4. Project naming (`ZRJ_<MOD>_<SUB>_<TYPE>_<NAME>`, module codes in `project.yaml` `modules`, checked by validate) lives in `project/conventions.md` (core, always in the instructions) and `project/naming/*.md` (topics `global-objects`, `rap-cds`, `local-definitions`, loaded on demand), and overrides individual skills.
