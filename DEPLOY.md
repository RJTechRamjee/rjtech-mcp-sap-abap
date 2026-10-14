# Deploying to SAP BTP trial (Cloud Foundry)

| | |
|---|---|
| App name | `rjtech-mcp-sap-abap` |
| Org / space | `ba6b127atrial` / `dev` |
| API endpoint | `https://api.cf.us10-001.hana.ondemand.com` |
| App URL | `https://rjtech-mcp-sap-abap.cfapps.us10-001.hana.ondemand.com` |
| MCP endpoint | `https://rjtech-mcp-sap-abap.cfapps.us10-001.hana.ondemand.com/mcp` |
| Health check | `https://rjtech-mcp-sap-abap.cfapps.us10-001.hana.ondemand.com/health` (no auth) |

## 1. Install the Cloud Foundry CLI (once per machine)

```powershell
winget install CloudFoundry.CLI.v8
```

Then open a **new** terminal (or restart VS Code) so the updated `PATH` is picked up. To reload `PATH` in the current PowerShell session instead:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
cf version
```

## 2. Log in

```powershell
cf login -a https://api.cf.us10-001.hana.ondemand.com
```

Use your SAP account email and password, then pick the org and space. If the account uses SSO or 2FA, use `cf login -a <endpoint> --sso` and paste the passcode.

## 3. First deployment (app does not exist yet)

The server refuses to start without `MCP_API_KEY`, and `cf set-env` only works on an existing app. So create the app without starting it, set the key, then start:

```powershell
npm run build
cf push --no-start
cf set-env rjtech-mcp-sap-abap MCP_API_KEY <your-key>
cf start rjtech-mcp-sap-abap
```

Generate a key, for example:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

Never put the key in `manifest.yml` or commit it.

## 4. Later deployments

The key stays set on the app, so just run:

```powershell
npm run deploy   # npm run build && cf push
```

Always build first: `server/dist` is uploaded as-is because CF does not install devDependencies.

## Rotating the API key

`MCP_API_KEY` accepts a comma-separated list, so you can rotate without downtime:

```powershell
cf set-env rjtech-mcp-sap-abap MCP_API_KEY "<new-key>,<old-key>"
cf restage rjtech-mcp-sap-abap
# update the clients, then remove the old key:
cf set-env rjtech-mcp-sap-abap MCP_API_KEY "<new-key>"
cf restage rjtech-mcp-sap-abap
```

## Checking and troubleshooting

```powershell
cf app rjtech-mcp-sap-abap            # state, route, memory
cf logs rjtech-mcp-sap-abap --recent  # recent logs (crashes, startup errors)
cf env rjtech-mcp-sap-abap            # shows user-provided env vars
```

`/health` should return `{"status":"ok","skills":<n>}`.

- **App stopped:** trial apps are stopped automatically (typically overnight). Restart with `cf start rjtech-mcp-sap-abap`.
- **`App '...' not found` on `cf set-env`:** the app has not been pushed yet. Follow step 3.
- **`cf` not recognized:** the CLI is not installed or the terminal predates the install. See step 1.
- **Trial expired:** extend it in the BTP cockpit. If the account is lost, everything needed to redeploy is in this repo; repeat steps 2 and 3.

## Connecting a client

VS Code (`.vscode/mcp.json`), using a prompted key so it is not stored in the file:

```json
{
  "inputs": [
    { "type": "promptString", "id": "sap-skills-api-key", "description": "API key for the SAP ABAP skills MCP server", "password": true }
  ],
  "servers": {
    "sap-abap-skills": {
      "type": "http",
      "url": "https://rjtech-mcp-sap-abap.cfapps.us10-001.hana.ondemand.com/mcp",
      "headers": { "Authorization": "Bearer ${input:sap-skills-api-key}" }
    }
  }
}
```

Eclipse (GitHub Copilot for Eclipse, Eclipse 2024-03+): Copilot icon → *Edit Preferences* → *GitHub Copilot* → *MCP*, paste, then *Apply and Close*. Use Copilot Chat in **Agent** mode. The key is stored in plain text in the Eclipse preferences.

```json
{
  "servers": {
    "sap-abap-skills": {
      "url": "https://rjtech-mcp-sap-abap.cfapps.us10-001.hana.ondemand.com/mcp",
      "requestInit": {
        "headers": { "Authorization": "Bearer <your-key>" }
      }
    }
  }
}
```

Quick manual test from PowerShell:

```powershell
$headers = @{ Authorization = "Bearer <your-key>"; Accept = "application/json, text/event-stream" }
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_skills","arguments":{}}}'
Invoke-RestMethod -Method Post -Uri https://rjtech-mcp-sap-abap.cfapps.us10-001.hana.ondemand.com/mcp -Headers $headers -ContentType "application/json" -Body $body
```
