---
name: cds-view-entities
description: Write ABAP CDS view entities for ABAP Cloud - modern syntax, associations, joins, parameters, amounts/quantities, text and value-help annotations, access control (DCL), and use of released SAP APIs. Use when the user asks to create, review, fix or refactor CDS views, or hits CDS activation errors.
---

# ABAP CDS view entities (ABAP Cloud)

## Hard rules

- Always `define view entity` (or `define root view entity`). Never the obsolete DDIC-based `define view` with `@AbapCatalog.sqlViewName`.
- In ABAP Cloud, select only from **own** tables/views or **released** SAP CDS views (C1 contract, e.g. `I_Currency`, `I_Country`, `I_UnitOfMeasure`, `I_CalendarDate`). SAP database tables (`T001`, `MARA`, ...) are not allowed. When unsure, tell the user to check *Properties > API State* in ADT or search the released objects list.
- Element names in CamelCase with an alias (`travel_id as TravelID`). Association names start with `_` and are exposed in the element list so consumers can follow them.
- Every amount field needs `@Semantics.amount.currencyCode: '<CurrencyElement>'`; every quantity needs `@Semantics.quantity.unitOfMeasure: '<UnitElement>'`. The reference element must be in the same view. Missing references are activation errors in view entities.
- `@AccessControl.authorizationCheck`: `#CHECK` with a DCL role for anything productive; `#NOT_REQUIRED` only for prototypes or views without sensitive data. `#MANDATORY` forces a role to exist.
- Add `@Metadata.allowExtensions: true` on views that get UI annotations via metadata extensions - keep UI annotations out of the view itself.

## Header template

```abap
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Travel with customer data'
@Metadata.allowExtensions: true
@ObjectModel.usageType: { serviceQuality: #B, sizeCategory: #M, dataClass: #TRANSACTIONAL }
define view entity ZI_RJ_TravelCustomer
  as select from zrj_travel as Travel
  association [1..1] to I_Currency as _Currency on $projection.CurrencyCode = _Currency.Currency
{
  ...
}
```

## Associations vs. joins

- Prefer **associations**: they are only joined when a consumer uses them (path expression or `$expand`), and they document relationships.
- Always give the cardinality explicitly: `[0..1]`, `[1..1]`, `[0..*]`. A to-many association used in a path expression in the element list multiplies rows - avoid that or aggregate.
- Use the alias and `$projection` in ON conditions: `on $projection.CustomerID = _Customer.CustomerID`.
- Path expressions with filter: `_Text[1: Language = $session.system_language].Description as StatusText`.
- Use a `join` only when you always need the data and want to filter on it.

## Useful expressions

```abap
cast( travel_id as abap.char(10) )                              as TravelIDText,
concat_with_space( first_name, last_name, 1 )                   as FullName,
case overall_status
  when 'A' then 3   -- positive / green
  when 'X' then 1   -- negative / red
  else 2            -- critical / yellow
end                                                             as StatusCriticality,
dats_days_between( begin_date, end_date )                       as DurationDays,
$session.system_date                                            as Today,
currency_conversion( amount => total_price, source_currency => currency_code,
                     target_currency => cast( 'EUR' as abap.cuky ),
                     exchange_rate_date => $session.system_date ) as TotalPriceEUR
```

Parameters:

```abap
define view entity ZI_RJ_TravelOnDate
  with parameters
    P_KeyDate : abap.dats
  as select from zrj_travel
{
  key travel_uuid as TravelUUID,
      travel_id   as TravelID
}
where begin_date <= $parameters.P_KeyDate
  and end_date   >= $parameters.P_KeyDate
```

Aggregation: every non-aggregated element must be in `group by`; aggregated amounts still need the currency reference, so group by the currency too.

## Texts and value helps

- Text view: `@ObjectModel.dataCategory: #TEXT`, key includes a language field annotated `@Semantics.language: true`, text field `@Semantics.text: true`.
- In the main view: `@ObjectModel.text.association: '_Text'` on the code field, or `@ObjectModel.text.element: ['StatusText']` with a denormalized text field.
- Value help on a field (usually in the projection view):
  `@Consumption.valueHelpDefinition: [{ entity: { name: 'I_CurrencyStdVH', element: 'Currency' } }]`.
  Prefer SAP's released `*StdVH` views; for own value helps create a small view entity with `@ObjectModel.resultSet.sizeCategory: #XS` for dropdowns.

## Access control (DCL)

Same name as the view. Simple patterns:

```abap
@EndUserText.label: 'Access control for ZI_RJ_TravelCustomer'
@MappingRole: true
define role ZI_RJ_TravelCustomer {
  grant select on ZI_RJ_TravelCustomer
    where CreatedBy = aspect user;
}
```

Authorization object based (create the authorization object and field first):

```abap
grant select on ZI_RJ_TravelCustomer
  where ( CurrencyCode ) = aspect pfcg_auth( ZRJ_CURR, ZRJ_CURR, ACTVT = '03' );
```

Projection views can inherit: `grant select on ZC_RJ_Travel where inheriting conditions from entity ZR_RJ_Travel;`

## Layering (VDM)

- `ZI_` interface/basic views: one per table, clean names, associations, no consumer-specific logic.
- `ZR_` RAP BO views: the transactional model (see `rap-managed-bo` skill).
- `ZC_` consumption/projection views: shape data for one app or API (search, value helps, UI annotations via metadata extension).

## Common activation errors

| Error | Fix |
|---|---|
| Reference to currency/unit missing | Add `@Semantics.amount.currencyCode` / `quantity.unitOfMeasure` and expose the reference field |
| Use of ... is not permitted (ABAP Cloud) | Object not released - find the released successor (`I_*` view) |
| Element in GROUP BY missing | Add every non-aggregated element to `group by` |
| Association ... cardinality / target not exposed | Expose `_Assoc` in the element list and fix the ON condition fields via `$projection` |
| Mutual dependency between root and child | Mass activate both (Ctrl+Shift+F3) |

Before handing over: preview with **F8** (Data Preview) and run the ATC check on the package.
