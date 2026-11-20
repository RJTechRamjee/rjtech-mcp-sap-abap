# Working notes

## 2026-11-20: Team setup: local stdio server + separate skills repo, BTP removed 🚧

**Goal:** every team member sets up the MCP server once, and new skills and conventions then reach everyone automatically, with no manual `git pull`.

### Done today
- **Split into two public repos (personal account):**
  - `rjtech-mcp-sap-abap` (this repo): server code only.
  - `rjtech-sap-abap-skills` (new, sibling folder `..\rjtech-sap-abap-skills`): `skills/`, `team/conventions.md`, `team/team.yaml`, `CONTRIBUTING.md`, plus a *Validate skills* GitHub Action. All 5 skills were moved there unchanged.
- **BTP removed:** `manifest.yml`, `.cfignore`, `DEPLOY.md`, Express, the API-key auth and `start-local.cmd` are gone.
- **The server now runs over stdio and is started by the IDE:** `cmd /c npx -y https://github.com/RJTechRamjee/rjtech-mcp-sap-abap/releases/latest/download/rjtech-mcp-sap-abap.tgz`. There is no port and no API key.
- **No npm registry** (decision: the project scope rules out public npmjs). The server is shipped as **GitHub Releases** of this repo: one bundled `.mjs` (all dependencies built in) plus a `.tgz` for the npx launcher.
- **Self-update** (`server/src/updater.ts`): tested that npx caches a URL-installed launcher forever, so on start the server checks `releases/latest`, downloads a newer bundle to `%USERPROFILE%\.rjtech-mcp\server\` and hands over to it. Tested with a simulated release server: old → new hand-over, offline fallback, opt-out with `RJTECH_MCP_AUTO_UPDATE=false`.
- **Live skill sync** (`server/src/store.ts`): every 5 minutes, checks the skills repo's head commit through git's HTTP endpoint (like `git ls-remote`). **Not the REST API**, because its 60 requests/hour per IP would be exhausted by a team in one office. If the commit changed, it downloads one tarball, swaps the content without a restart, notifies Copilot (`list_changed`), and caches in `%USERPROFILE%\.rjtech-mcp\cache\`. It keeps the last good version if GitHub is down. Tested against live GitHub.
- **TypeScript vs Python:** stay with TypeScript. It's already built, ships as one file (colleagues only need Node.js), and is the reference SDK.
- **Team conventions:** `team/conventions.md` goes into the server instructions and the new `get_team_conventions` tool. `team/team.yaml` drives the ADT name guard (`objectPrefixes: [ZRJ_]`, `packagePrefixes: [ZRJ_, $]`), on top of the hard Z/Y/$ floor.
- **New tools:** `get_team_conventions`, and `skills_status(refresh?)` for troubleshooting.
- **CLI:** `setup` (asks for the SAP settings with hidden password input, writes `%USERPROFILE%\.rjtech-mcp\config.env`, tests GitHub and SAP, and prints the IDE JSON), `validate <dir>`, `--version`.
- **Releasing:** `.github/workflows/release.yml` creates release `v0.2.<run>` on every server change on main, after a smoke test of the bundle. It needs no secrets, and there are no manual version bumps. `ci.yml` runs typecheck, validate and smoke (sources and bundle).
- **Docs:** `TEAM-SETUP.md` (guide for colleagues), `HOW-IT-WORKS.md` and `CLAUDE.md` rewritten.
- **Tests:** `npm run smoke -- ..\rjtech-sap-abap-skills` passes all 14 checks for the sources and for the bundle, including live reload and path traversal. The ADT guard and `setup` were tested with piped input.

### Open / next (in this order)
- [x] Create the public GitHub repo `RJTechRamjee/rjtech-sap-abap-skills` (done by me, still empty).
- [x] Pushed `..\rjtech-sap-abap-skills` (commit 7cff6a9).
- [x] Committed and pushed this repo (9219e69). The release workflow created **v0.2.1**. Tested from the real release: npx launch, `setup`, `validate`, and serve with 5 skills synced from GitHub.
- [ ] Re-run the skills repo's *Validate skills* check (Actions tab → *Re-run jobs*): its first run came before any release existed.
- [ ] Run the `setup` command from TEAM-SETUP.md and switch my own VS Code and Eclipse to the stdio config. Delete the old `.env.local` once that works.
- [ ] Check the Eclipse Copilot MCP JSON (`type: stdio` + `command`/`args`) in a real Eclipse.
- [ ] Fill in the real `projects` and `systems` in `team/team.yaml`.
- [ ] Decide on a license (none is declared; package.json is `private`).
- [ ] Undeploy the BTP app: `cf delete rjtech-mcp-sap-abap` (it still runs the old version with the API key).
- [ ] Later: corporate proxy support, if a colleague needs it.

## 2026-10-16: BAdI skill + first ADT tools (agentic development) 🚧

**Goal:** the server should not only instruct but also **create objects in the SAP system** (agentic development), starting with enhancement spots / BAdIs.

### Done today
- **New skill `enhancement-spot-badi`** with `references/templates.md`: interface (with `if_badi_interface`), fallback class, `GET BADI` / `CALL BADI` caller behind a provider interface (testable), implementation for filter `COUNTRY = DE`, multiple-use variant, ABAP Unit, and a short "classic only" section on `ENHANCEMENT-POINT` / `ENHANCEMENT-SECTION` (not allowed in ABAP Cloud).
- **Naming:** every object starts with `ZRJ_` + type code: `ZRJ_IF_`, `ZRJ_CL_`, `ZRJ_ES_`, `ZRJ_BADI_`, `ZRJ_EI_`, `ZRJ_BI_`. Class/interface names have a max of 30 characters, so names after the prefix stay short.
- **ADT tools** (new `server/src/adt.ts` + `server/src/adtTools.ts`), calling the same REST API as Eclipse (`/sap/bc/adt`):
  - `adt_create_interface`, `adt_create_class` (create + write source + optional test classes + activate)
  - `adt_update_source`, `adt_activate` (returns errors with line numbers), `adt_read_source`, `adt_discovery`
- **Local mode only:** the tools appear only when `SAP_URL` is set (plus `SAP_USER`, `SAP_PASSWORD`, optional `SAP_CLIENT`=001, `SAP_LANGUAGE`=EN). The server then listens on 127.0.0.1 only. The BTP deployment stays skills-only with no SAP credentials.
- **Safety:** write tools only accept `Z*`/`Y*` objects in `Z*`/`Y*`/`$` packages, require a transport for non-`$` packages, and never delete.
- **Smoke test:** typecheck clean, all 8 tools register, name guard works, and the Docker trial on `localhost:50000` answers (401 with a dummy password). **No object has been created on the real system yet.**

### Decisions
- Remote BTP server cannot reach the Docker trial on the laptop; Cloud Connector + Destination only after OAuth replaces the API key.
- No guessed XML for enhancement spot (ENHS) / BAdI implementation (ENHO): their ADT format is not documented, so it gets captured from Eclipse first. Until then the skill gives the user exact wizard values for these two objects.

### Open / next
- [ ] Start locally: `$env:SAP_URL='http://localhost:50000'; $env:SAP_USER='DEVELOPER'; $env:SAP_PASSWORD='<pw>'; $env:MCP_API_KEY='<key>'; npm run dev`, add `http://127.0.0.1:3000/mcp` as a second MCP server in Eclipse/VS Code.
- [ ] Real test: let Copilot create `ZRJ_IF_DISCOUNT` + `ZRJ_CL_DISCOUNT_FALLBACK` in `$TMP` via the tools; check lock/write/activate and test-classes include.
- [ ] Capture the ENHS and ENHO create requests in Eclipse (*Window → Show View → ABAP Communication Log*), then add `adt_create_enhancement_spot` and `adt_create_badi_implementation`.
- [ ] Check the BAdI templates on the trial (exception classes, wizard field labels, C0 release option).
- [x] Moved all skills to the `ZRJ_` scheme: `ZRJ_R_`/`ZRJ_C_`/`ZRJ_I_` views, `ZRJ_BP_R_` behavior pool, `ZRJ_UI_`/`ZRJ_API_` services, `ZRJ_CL_`/`ZRJ_IF_` classes/interfaces. Tables stay `ZRJ_<NAME>` (max 16 chars).
- [x] Deployed to BTP (`cf push`, 2026-10-16): `/health` shows 5 skills, `/mcp` still returns 401 without a key. ADT tools stay off on BTP (no `SAP_URL`).
- [ ] Commit and push to GitHub.

## 2026-10-14: MCP server built, deployed to BTP, connected in Eclipse ✅

**Result:** the skills server runs on SAP BTP trial (Cloud Foundry) and Eclipse (GitHub Copilot, Agent mode) uses it as a remote MCP server. All planned steps are done: write skills, build server, test locally, deploy, connect a client.

### Done today
- **Server** (Node.js/TypeScript, MCP SDK 1.32, Express): stateless Streamable HTTP on `/mcp`, API-key auth (`Authorization: Bearer` or `x-api-key`), unauthenticated `/health` for CF.
  - Skills are served as resources (`skill://<name>/<file>`), and as the tools `list_skills` and `load_skill(name, file?)`.
  - A one-line skill index goes in the server instructions.
  - Replaced `gray-matter` with `yaml` to remove a vulnerable dependency; `npm audit` is clean.
- **Four skills** in `skills/`:
  - `rap-managed-bo`, with `references/templates.md` holding the full Travel/Booking code
  - `cds-view-entities`
  - `rap-odata-v4-service`, with `references/ui-annotations.md`
  - `abap-unit-rap`
- **Local test:** passed for auth (401 without a key or with a wrong key), tools, resources, path traversal blocked, and refusing to start without a key.
- **Deployed** to `https://rjtech-mcp-sap-abap.cfapps.us10-001.hana.ondemand.com/mcp` (org `ba6b127atrial`, space `dev`, region us10-001). `/health` returns 4 skills. Steps are in [DEPLOY.md](DEPLOY.md).
- **Eclipse connected** via GitHub Copilot for Eclipse: *Preferences → GitHub Copilot → MCP*, using the `servers` + `requestInit.headers` format.
- Docs: [CLAUDE.md](CLAUDE.md) (architecture, commands), [DEPLOY.md](DEPLOY.md) (deploy, key rotation, clients).

### Learned
- `cf set-env` only works once the app exists. For the first deploy, run `cf push --no-start`, then `cf set-env`, then `cf start`.
- CF does not install devDependencies, so build locally before every push (`npm run deploy` does both).
- Eclipse stores the API key in plain text in its preferences. VS Code prompts for it instead (`promptString` input).
- MCP tools are only used in Copilot **Agent** mode.

### Open / next
- [x] Commit and push today's work to GitHub.
- [ ] **Check the skill templates on the Docker ABAP trial system:** activate the RAP and CDS code, and check that `cl_botd_*` test-double classes exist on that release.
- [ ] Add the server to the **user-level** VS Code MCP config so every workspace gets it.
- [ ] Check whether Copilot picks skills **without** naming them in the prompt. If not, improve the skill descriptions.
- [ ] More skills (ideas: number ranges, actions/feature control, Integration Suite iFlow consuming an OData V4 API).
- [ ] Later: replace the API key with **OAuth via BTP XSUAA**.
- [ ] Later: publish to the **official MCP Registry** (it feeds GitHub's registry at `api.mcp.github.com`). A registry only lists metadata (name, description, URL); the BTP app stays the actual server. Do this only once the server has a stable (non-trial) host and OAuth, because a public entry is hard to undo and every user would otherwise need our API key. Steps: add `server.json` with a `remotes` entry (`streamable-http` + URL, `Authorization` header marked secret), name `io.github.RJTechRamjee/rjtech-mcp-sap-abap`, then `mcp-publisher login github` and `mcp-publisher publish`. Not needed for personal use, since the Eclipse/VS Code JSON config already works.
- [ ] Trial upkeep: the app stops automatically, so restart it with `cf start rjtech-mcp-sap-abap`. Extend the trial before it expires.
