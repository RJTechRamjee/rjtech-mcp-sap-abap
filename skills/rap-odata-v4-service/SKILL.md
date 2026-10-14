---
name: rap-odata-v4-service
description: Expose a RAP business object as an OData V4 service - service definition, service binding (UI vs Web API), Fiori elements UI annotations in metadata extensions, publishing, preview and testing with OData URLs, and consumption from SAP Integration Suite. Use when the user asks to publish/expose a RAP BO, build a Fiori elements list report/object page, or call the service externally.
---

# OData V4 service for a RAP BO

Prerequisite: an active projection layer (`ZC_` views + projection BDEF). See the `rap-managed-bo` skill. UI annotation templates are in `references/ui-annotations.md`.

## 1. Choose the binding type

| Use case | Binding type | Notes |
|---|---|---|
| Fiori elements app (List Report / Object Page) | **OData V4 - UI** | Draft supported; name `ZUI_<PFX>_<NAME>_O4` |
| API for other systems, Integration Suite, scripts | **OData V4 - Web API** | No UI annotations needed; name `ZAPI_<PFX>_<NAME>_O4`. Prefer a separate projection without `use draft` for APIs so consumers get simple create/update semantics |

One service definition can be used by several bindings, but UI and API usually need different projections - keep them separate.

## 2. Service definition

```abap
@EndUserText.label: 'Travel UI service'
define service ZUI_RJ_TRAVEL {
  expose ZC_RJ_Travel  as Travel;
  expose ZC_RJ_Booking as Booking;
}
```

- Expose every entity reachable through compositions (child entities too), plus value-help views that are not released SAP views.
- The alias (`as Travel`) becomes the OData entity set name - keep it stable, consumers depend on it.

## 3. Service binding

1. New > Service Binding, binding type as above, service definition `ZUI_RJ_TRAVEL`.
2. Activate, then press **Publish** in the binding editor. (On an on-premise / ABAP Platform trial system the local publish works the same; if it fails, check the service group in transaction `/IWFND/V4_ADMIN`.)
3. Select the root entity and click **Preview** to open the Fiori elements preview.

## 4. UI annotations (metadata extension)

- Create a metadata extension with the **same name** as the projection view: `@Metadata.layer: #CORE` (or `#CUSTOMER` for customer extensions of SAP views).
- The projection view needs `@Metadata.allowExtensions: true`.
- Minimum for a usable list report: `@UI.headerInfo`, `@UI.lineItem` on list columns, `@UI.selectionField` for filters, `@UI.facet` + `@UI.identification` for the object page, `#LINEITEM_REFERENCE` facet with `targetElement: '_Child'` for child tables.
- Hide technical fields (UUIDs, etags) with `@UI.hidden: true`.
- Actions appear as buttons only when annotated: `@UI.lineItem: [{ type: #FOR_ACTION, dataAction: 'acceptTravel', label: 'Accept' }]` (and the same in `@UI.identification` for the object page).
- Status colours: add a `...Criticality` element (1 red, 2 yellow, 3 green) and reference it with `criticality: 'StatusCriticality'`.
- Search needs `@Search.searchable: true` on the projection view and `@Search.defaultSearchElement: true` on fields.

## 5. Test with plain OData

Take the service URL from the binding editor (do not construct it by hand), then:

| Purpose | Request |
|---|---|
| Metadata | `GET <service-url>/$metadata` |
| List | `GET <service-url>/Travel?$top=10&$select=TravelID,Description` |
| With children | `GET <service-url>/Travel?$expand=_Booking` |
| Single draft-enabled instance | `GET <service-url>/Travel(TravelUUID=<uuid>,IsActiveEntity=true)` |
| Create (Web API, no draft) | `POST <service-url>/Travel` with JSON body; send `X-CSRF-Token` fetched with `GET` + header `X-CSRF-Token: Fetch` |
| Update | `PATCH` with `If-Match: <etag>` from the previous `GET` |

Draft-enabled services create drafts on `POST` and need `Activate` (`POST .../Travel(...,IsActiveEntity=false)/<namespace>.Activate`) - another reason to give APIs a projection without draft.

## 6. External consumption (Integration Suite, other systems)

- **SAP BTP ABAP environment / S/4HANA Cloud**: create a *communication scenario* (inbound, add the Web API service binding's service), then in the Fiori launchpad create a *communication system*, *communication user* and *communication arrangement*. The arrangement shows the final URL. Integration Suite calls it with Basic auth (communication user) or OAuth client credentials.
- **ABAP Platform (on-premise, incl. Docker trial)**: the service is reachable directly after publishing; authenticate with a normal user, and expose it through Cloud Connector when Integration Suite runs on BTP.
- In Integration Suite, use the **OData receiver adapter** (version V4), import `$metadata` to generate the query, and handle CSRF for modifying calls (the adapter does this automatically).

## Checklist

- [ ] Service definition exposes all composition children and custom value-help views.
- [ ] Binding published; preview opens and lists data.
- [ ] Metadata extension active; technical fields hidden; header info set.
- [ ] Actions annotated in both `lineItem` and `identification` if needed on both pages.
- [ ] For APIs: Web API binding on a non-draft projection, documented entity set names.
