# Working notes

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
- [ ] Trial upkeep: the app stops automatically, so restart it with `cf start rjtech-mcp-sap-abap`. Extend the trial before it expires.
