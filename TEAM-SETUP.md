# Team setup: SAP ABAP skills in Copilot

This gives GitHub Copilot (VS Code or Eclipse ADT) the team's ABAP skills and naming
conventions. Optionally, it also lets Copilot create and activate classes and interfaces
in your SAP system.

**You do this once.** After that, everything updates by itself:

- **Skills and conventions** come from the [rjtech-sap-abap-skills](https://github.com/RJTechRamjee/rjtech-sap-abap-skills) repo. The server checks for changes every 5 minutes, even while your IDE is open.
- **The server itself** checks for a newer [release](https://github.com/RJTechRamjee/rjtech-mcp-sap-abap/releases) each time your IDE starts it, and switches to it.

You never need to clone or pull a repo, and you don't need a GitHub or npm account.

## What runs where

```
Your PC
├── VS Code / Eclipse ── starts ──► MCP server (Node.js, runs only while the IDE is open)
│                                     ├── on start: newer server release? ──► GitHub Releases
│                                     ├── every 5 min: new skills? ─────────► GitHub skills repo
│                                     └── optional: ADT REST API ───────────► your SAP system
└── %USERPROFILE%\.rjtech-mcp\
    ├── config.env    your personal settings (SAP password); never shared
    ├── server\       the latest server version (one file)
    └── cache\        last downloaded skills, so it also works offline
```

## 1. Install Node.js (once)

You need Node.js 20.12 or newer. Check in PowerShell:

```powershell
node -v
```

If it's missing or older, install the LTS version, then open a **new** terminal:

```powershell
winget install OpenJS.NodeJS.LTS
```

## 2. Run the setup (once, takes about 2 minutes)

```powershell
npx -y https://github.com/RJTechRamjee/rjtech-mcp-sap-abap/releases/latest/download/rjtech-mcp-sap-abap.tgz setup
```

This downloads the server from this repo's GitHub Releases (nothing comes from the public npm
registry) and starts the setup.

It asks the following:

| Question | What to enter |
|---|---|
| Connect the ADT tools to an SAP system? | `y` if Copilot should create objects in your SAP system. `n` for skills only. |
| SAP system URL | The URL Eclipse uses for your system, e.g. `http://localhost:50000` for the Docker ABAP trial |
| SAP user / password | Your SAP logon. The password is not shown while you type. |
| SAP client / language | e.g. `001` / `EN` |
| GitHub token | Leave empty. The skills repo is public. |

Setup saves everything to `%USERPROFILE%\.rjtech-mcp\config.env`, checks GitHub and your SAP
system, and prints the IDE configuration for step 3.

To change anything later (for example a new SAP password), run the same command again.

> The SAP password is stored in plain text in that file, inside your Windows user profile.
> Don't copy the file to shared drives or into a repo.

## 3. Add the server to your IDE (once)

### VS Code

1. Press `Ctrl+Shift+P` and run **MCP: Open User Configuration**. Using the *user* configuration means it works in every workspace.
2. Merge this into the file. If a `servers` block already exists, add only the `sap-abap-skills` entry.

```json
{
  "servers": {
    "sap-abap-skills": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "https://github.com/RJTechRamjee/rjtech-mcp-sap-abap/releases/latest/download/rjtech-mcp-sap-abap.tgz"]
    }
  }
}
```

3. Save. Click **Start** above the entry if VS Code doesn't start it by itself.

### Eclipse (GitHub Copilot for Eclipse)

1. Click the Copilot icon, then **Edit Preferences → GitHub Copilot → MCP**.
2. Merge the same JSON into the **Server Configurations** field, then click **Apply and Close**.

> On macOS or Linux, use `"command": "npx"` and drop `"/c"` from `args`.

## 4. Check that it works

1. Open Copilot Chat and switch to **Agent** mode. MCP tools are not used in Ask or Edit mode.
2. Ask: *"Call skills_status"*. You should see `Skills: 5 (...)` and `Last error: none`. If you connected SAP, you should also see `ADT: <your SAP URL>`.
3. Try a real task, e.g. *"Create a managed RAP BO for a Travel table"*. Copilot should load the `rap-managed-bo` skill and use names like `ZRJ_CA_DMO_R_Travel` (module + submodule after `ZRJ_`).

## 5. Use the ABAP Developer agent

The server installs a Copilot custom agent, **ABAP Developer**, which always works from the
project's skills and conventions. Use it for ABAP work instead of the default agent; the default
agent may pick other skills or search your files for "standards". The agent comes from the
skills repo and updates by itself.

> Keep the server name `sap-abap-skills` in the IDE configuration from step 3. The agent
> finds the server's tools by that name.

**VS Code:** after the server has run once, open Copilot Chat and pick **ABAP Developer** in
the agent dropdown (where *Agent* / *Ask* / *Edit* are). If it isn't listed, reload the window
(`Ctrl+Shift+P` → **Developer: Reload Window**).

**Eclipse:** Eclipse only finds agents inside a project of your workspace, so the server keeps
a small project for it. Import it once:

1. **File → Import → General → Existing Projects into Workspace**.
2. Root directory: `%USERPROFILE%\.rjtech-mcp\eclipse\rjtech-copilot`. Don't tick *Copy projects
   into workspace*, so the project keeps receiving updates.
3. **Finish**. Then pick **ABAP Developer** in the Copilot Chat agent picker.

Custom agents in Copilot for Eclipse are still in preview. If the agent doesn't show up, use
Agent mode and start with *"Use the sap-abap-skills server: call get_project_conventions"*.

## Day-to-day

- **New or changed skills** arrive within about 5 minutes. For an immediate check, ask Copilot to *"call skills_status with refresh true"*.
- **A new server version** arrives the next time your IDE starts the MCP server. To get it straight away, restart the IDE, or restart the server from the MCP view in VS Code. `skills_status` shows the running version.
- **Want to add or improve a skill?** See [CONTRIBUTING.md](https://github.com/RJTechRamjee/rjtech-sap-abap-skills/blob/main/CONTRIBUTING.md) in the skills repo.

## What Copilot can and cannot do in SAP

When the ADT tools are connected:

- Copilot can create, update, read and activate **classes and interfaces**. It cannot delete anything.
- Names must follow the project prefix (currently `ZRJ_`) in a project package or a `$` package. Anything else is refused.
- Transportable packages need a transport request, and Copilot asks you for it.
- Other object types (CDS, BDEF, tables, BAdI implementations) aren't covered yet. For those, Copilot writes the code and you create the object in ADT.

## Troubleshooting

| Problem | Fix |
|---|---|
| Server doesn't start / "npx is not recognized" | Node.js isn't installed, or the IDE was opened before the install. Restart the IDE (on Windows, sign out and back in if needed). |
| `skills_status` shows a GitHub error | Check your internet connection. The server keeps using the cached skills meanwhile. Corporate proxies aren't supported yet, so tell the maintainer if you are behind one. |
| "SAP rejected the user or password (HTTP 401)" | Run the setup again with the right password. |
| "Cannot reach the SAP system" | Start the SAP system (Docker), or check the URL in the setup. |
| Copilot ignores the skills | Use the **ABAP Developer** agent (step 5). Check that the server shows as running in the IDE's MCP view. |
| ABAP Developer agent is missing | `skills_status` shows where the agent was installed and any problem. VS Code: reload the window. Eclipse: import the helper project (step 5). |
| ABAP Developer has no SAP/skills tools | The server's name in your IDE configuration must be `sap-abap-skills`. |
| A new server version misbehaves | Add `RJTECH_MCP_AUTO_UPDATE="false"` to `config.env` and tell the maintainer. To go back a version, also delete the newest file in `%USERPROFILE%\.rjtech-mcp\server\`. |
| Start from scratch | Delete the `%USERPROFILE%\.rjtech-mcp` folder and run the setup again. |
