# rjtech-mcp-sap-abap

A local MCP server that gives GitHub Copilot (VS Code, Eclipse ADT) the project's SAP ABAP
skills and naming conventions, with optional ADT tools that create and activate classes
and interfaces in your SAP system.

Two repos:

| Repo | Contains | Changes reach developers |
|---|---|---|
| **rjtech-mcp-sap-abap** (this one) | The server code | Released as a GitHub Release on merge; each server updates itself on its next start |
| [**rjtech-sap-abap-skills**](https://github.com/RJTechRamjee/rjtech-sap-abap-skills) | Skills, `project/conventions.md`, `project/naming/`, `project/project.yaml` | Synced live, within about 5 minutes, with no restart |

- **Setting it up (each developer, once):** [TEAM-SETUP.md](TEAM-SETUP.md)
- **How it works:** [HOW-IT-WORKS.md](HOW-IT-WORKS.md)
- **Adding skills:** [CONTRIBUTING.md in the skills repo](https://github.com/RJTechRamjee/rjtech-sap-abap-skills/blob/main/CONTRIBUTING.md)
- **Progress notes:** [WORKING-NOTES.md](WORKING-NOTES.md)
