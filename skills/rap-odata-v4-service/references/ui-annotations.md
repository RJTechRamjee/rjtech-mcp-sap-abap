# Metadata extension templates (Fiori elements, OData V4)

## Root entity: list report + object page

```abap
@Metadata.layer: #CORE
@UI: {
  headerInfo: {
    typeName: 'Travel',
    typeNamePlural: 'Travels',
    title:       { type: #STANDARD, value: 'TravelID' },
    description: { type: #STANDARD, value: 'Description' }
  },
  presentationVariant: [{ sortOrder: [{ by: 'TravelID', direction: #DESC }], visualizations: [{ type: #AS_LINEITEM }] }]
}
annotate entity ZC_RJ_Travel with
{
  @UI.facet: [
    { id: 'TravelHeader', purpose: #HEADER, type: #DATAPOINT_REFERENCE, targetQualifier: 'Status', position: 10 },
    { id: 'Travel',   purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: 'Travel',   position: 10 },
    { id: 'Bookings', purpose: #STANDARD, type: #LINEITEM_REFERENCE,       label: 'Bookings', position: 20,
      targetElement: '_Booking' }
  ]

  @UI.hidden: true
  TravelUUID;

  @UI: { lineItem:       [{ position: 10, importance: #HIGH }],
         identification: [{ position: 10 }],
         selectionField: [{ position: 10 }] }
  TravelID;

  @UI: { lineItem:       [{ position: 20, importance: #HIGH }],
         identification: [{ position: 20 }] }
  Description;

  @UI: { lineItem:       [{ position: 30 }],
         identification: [{ position: 30 }],
         selectionField: [{ position: 20 }] }
  BeginDate;

  @UI: { lineItem:       [{ position: 40 }],
         identification: [{ position: 40 }] }
  EndDate;

  @UI: { lineItem:       [{ position: 50 }],
         identification: [{ position: 50 }] }
  TotalPrice;

  @UI: { selectionField: [{ position: 30 }] }
  CurrencyCode;

  @UI: {
    lineItem: [
      { position: 60, criticality: 'StatusCriticality', importance: #HIGH },
      { type: #FOR_ACTION, dataAction: 'acceptTravel', label: 'Accept' }
    ],
    identification: [
      { position: 60, criticality: 'StatusCriticality' },
      { type: #FOR_ACTION, dataAction: 'acceptTravel', label: 'Accept' }
    ],
    dataPoint: { qualifier: 'Status', title: 'Status', criticality: 'StatusCriticality' }
  }
  OverallStatus;

  @UI.hidden: true
  LocalLastChangedAt;

  @UI.hidden: true
  LastChangedAt;
}
```

Notes:
- `StatusCriticality` must be an element of the projection view (e.g. a `case` expression in the BO view).
- `acceptTravel` must exist as an action in the BDEF and be re-exposed in the projection BDEF with `use action acceptTravel;`. Remove those annotation entries if there is no such action.
- `#DATAPOINT_REFERENCE` in the header shows the status prominently on the object page.

## Child entity: table on the object page + its own object page

```abap
@Metadata.layer: #CORE
@UI: {
  headerInfo: {
    typeName: 'Booking',
    typeNamePlural: 'Bookings',
    title: { type: #STANDARD, value: 'BookingID' }
  }
}
annotate entity ZC_RJ_Booking with
{
  @UI.facet: [
    { id: 'Booking', purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: 'Booking', position: 10 }
  ]

  @UI.hidden: true
  BookingUUID;

  @UI.hidden: true
  TravelUUID;

  @UI: { lineItem: [{ position: 10 }], identification: [{ position: 10 }] }
  BookingID;

  @UI: { lineItem: [{ position: 20 }], identification: [{ position: 20 }] }
  BookingDate;

  @UI: { lineItem: [{ position: 30 }], identification: [{ position: 30 }] }
  FlightPrice;

  @UI.hidden: true
  LocalLastChangedAt;
}
```

## Field groups (several sections on the object page)

```abap
@UI.facet: [
  { id: 'General', purpose: #STANDARD, type: #COLLECTION, label: 'General', position: 10 },
  { id: 'Basic',  parentId: 'General', type: #FIELDGROUP_REFERENCE, targetQualifier: 'Basic',  label: 'Basic data', position: 10 },
  { id: 'Prices', parentId: 'General', type: #FIELDGROUP_REFERENCE, targetQualifier: 'Prices', label: 'Prices',     position: 20 }
]

@UI.fieldGroup: [{ qualifier: 'Basic', position: 10 }]
Description;

@UI.fieldGroup: [{ qualifier: 'Prices', position: 10 }]
TotalPrice;
```
