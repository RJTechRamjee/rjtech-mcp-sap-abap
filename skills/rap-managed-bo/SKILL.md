---
name: rap-managed-bo
description: Create a managed RAP business object with draft in ABAP Cloud - database tables, root/child CDS view entities, behavior definition, behavior pool (determinations, validations, authorization), projection layer. Use when the user asks to build, scaffold or extend a RAP BO, or to add determinations, validations or actions.
---

# Managed RAP business object with draft (ABAP Cloud)

Builds a transactional business object using the RESTful ABAP Programming Model, managed scenario, UUID keys, draft enabled, `strict ( 2 )`. Full code templates for every artifact are in `references/templates.md` - load it before generating code.

## Before you start

Ask (or infer from context) and confirm with the user:
1. **Prefix and name** - e.g. `ZRJ_` + `TRAVEL`. All objects derive from it (see naming below).
2. **Entities** - root only, or root + child (composition). Fields per entity.
3. **Package** and **transport request** (ABAP Cloud: a package with ABAP language version *ABAP for Cloud Development*).
4. **Keys** - default to managed UUID keys (`sysuuid_x16`) plus a readable semantic ID filled by a determination.

## Naming (SAP recommended RAP conventions)

| Artifact | Pattern | Example |
|---|---|---|
| Active table / draft table | `Z<PFX>_<NAME>` / `Z<PFX>_<NAME>_D` | `ZRJ_TRAVEL`, `ZRJ_TRAVEL_D` |
| BO (restricted) view entity | `ZR_<PFX>_<Name>` | `ZR_RJ_Travel` |
| Projection view entity | `ZC_<PFX>_<Name>` | `ZC_RJ_Travel` |
| Behavior pool | `ZBP_R_<PFX>_<NAME>` | `ZBP_R_RJ_TRAVEL` |
| Metadata extension | same name as projection view | `ZC_RJ_Travel` |
| Service definition / binding | `ZUI_<PFX>_<NAME>` / `..._O4` | `ZUI_RJ_TRAVEL_O4` |

CDS element names are CamelCase; table fields are snake_case; associations start with `_`.

## Build order

Activate in this order. Each step depends on the previous one being active.

1. **Database tables** with client, UUID key and the five admin fields (`created_by`, `created_at`, `local_last_changed_by`, `local_last_changed_at`, `last_changed_at`) using the `abp_*` data elements. Child tables also carry the parent UUID.
2. **BO view entities** `ZR_...`: `define root view entity` for the root with `composition [0..*] of`, `define view entity` for children with `association to parent`. Activate root and children **together** (mass activation, Ctrl+Shift+F3) - they reference each other.
3. **Behavior definition** on the root view (`managed`, `strict ( 2 )`, `with draft`).
4. **Quick fixes** in the BDEF editor (Ctrl+1): create the **draft tables** and the **behavior pool**. Do not hand-write draft tables; they need the `%admin` include the quick fix generates.
5. **Behavior pool**: implement determinations, validations, `get_global_authorizations`.
6. **Projection views** `ZC_...` (`provider contract transactional_query`, redirect compositions) and the **projection BDEF** (`projection; strict ( 2 ); use draft;`).
7. Expose as OData V4 - follow the `rap-odata-v4-service` skill.

Shortcut worth offering: in ADT, right-click the table > **Generate ABAP Repository Objects** > *OData UI Service* generates steps 2-7 for a single root entity. It is a good start; add children, determinations and validations afterwards by hand.

## Rules

- **ABAP Cloud only**: no SAP tables or unreleased classes. Use released APIs (`I_Currency`, `cl_abap_context_info`, `cl_numberrange_runtime`, `xco_cp_*`). Check *API State* in ADT if unsure.
- Inside the behavior pool always use EML **`IN LOCAL MODE`** (skips authorization and feature control for the BO's own changes).
- Never `COMMIT WORK`, `ROLLBACK WORK` or direct `INSERT/UPDATE/DELETE` on BO tables in handler methods - the managed framework saves. Writing to *other* tables belongs in the saver (`additional save`).
- Read before modify: `READ ENTITIES ... WITH CORRESPONDING #( keys )`, then `MODIFY ENTITIES` with `%tky`. Use `%tky` (not `%key`) so draft and active instances stay separate.
- Determinations: `on modify` for UI feedback, `on save` for values that only matter when persisted (IDs). Validations: `on save` only, triggered by `create` and the fields they check; add each to `draft determine action Prepare`.
- Validations must fill **both** `failed-<entity>` and `reported-<entity>` and clear the state area first (append an entry with only `%tky` and `%state_area`), otherwise stale messages stay on the Fiori UI.
- Semantic IDs: `MAX( ) + 1` is fine for demos; for production use a number range object via `cl_numberrange_runtime=>number_get`.
- `etag master LocalLastChangedAt` on each entity with its own admin fields; `lock master total etag LastChangedAt` on the root.
- Keep `@AccessControl.authorizationCheck: #NOT_REQUIRED` only for prototypes; production views get a DCL role (see `cds-view-entities` skill).

## Checklist before handing over

- [ ] All objects active, no warnings in the BDEF (strict mode turns many into errors).
- [ ] Draft tables generated via quick fix and listed in BDEF.
- [ ] `field ( readonly )` for keys, semantic ID and admin fields; `field ( numbering : managed )` for UUID keys.
- [ ] Every validation is listed in `Prepare`.
- [ ] `mapping for <table>` covers every field whose CDS name differs from the table field.
- [ ] Projection BDEF re-exposes `create/update/delete`, draft actions and associations with `use`.
