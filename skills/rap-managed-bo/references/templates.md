# Templates: managed RAP BO with draft (Travel / Booking)

Replace `RJ` / `rj` with the user's prefix and adjust fields. Order follows the build order in SKILL.md.

## 1. Database tables

```abap
@EndUserText.label : 'Travel'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zrj_travel {
  key client            : abap.clnt not null;
  key travel_uuid       : sysuuid_x16 not null;
  travel_id             : abap.numc(8);
  description           : abap.char(256);
  begin_date            : abap.dats;
  end_date              : abap.dats;
  @Semantics.amount.currencyCode : 'zrj_travel.currency_code'
  total_price           : abap.curr(16,2);
  currency_code         : abap.cuky;
  overall_status        : abap.char(1);
  created_by            : abp_creation_user;
  created_at            : abp_creation_tstmpl;
  local_last_changed_by : abp_locinst_lastchange_user;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
  last_changed_at       : abp_lastchange_tstmpl;
}
```

```abap
@EndUserText.label : 'Booking'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zrj_booking {
  key client            : abap.clnt not null;
  key booking_uuid      : sysuuid_x16 not null;
  parent_uuid           : sysuuid_x16;
  booking_id            : abap.numc(4);
  booking_date          : abap.dats;
  @Semantics.amount.currencyCode : 'zrj_booking.currency_code'
  flight_price          : abap.curr(16,2);
  currency_code         : abap.cuky;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
```

## 2. BO view entities

```abap
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Travel - BO view'
define root view entity ZR_RJ_Travel
  as select from zrj_travel
  composition [0..*] of ZR_RJ_Booking as _Booking
{
  key travel_uuid           as TravelUUID,
      travel_id             as TravelID,
      description           as Description,
      begin_date            as BeginDate,
      end_date              as EndDate,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      total_price           as TotalPrice,
      currency_code         as CurrencyCode,
      overall_status        as OverallStatus,
      @Semantics.user.createdBy: true
      created_by            as CreatedBy,
      @Semantics.systemDateTime.createdAt: true
      created_at            as CreatedAt,
      @Semantics.user.localInstanceLastChangedBy: true
      local_last_changed_by as LocalLastChangedBy,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt,
      @Semantics.systemDateTime.lastChangedAt: true
      last_changed_at       as LastChangedAt,

      _Booking
}
```

```abap
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Booking - BO view'
define view entity ZR_RJ_Booking
  as select from zrj_booking
  association to parent ZR_RJ_Travel as _Travel on $projection.TravelUUID = _Travel.TravelUUID
{
  key booking_uuid          as BookingUUID,
      parent_uuid           as TravelUUID,
      booking_id            as BookingID,
      booking_date          as BookingDate,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      flight_price          as FlightPrice,
      currency_code         as CurrencyCode,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt,

      _Travel
}
```

## 3. Behavior definition (`ZR_RJ_Travel`)

```abap
managed implementation in class zbp_r_rj_travel unique;
strict ( 2 );
with draft;

define behavior for ZR_RJ_Travel alias Travel
persistent table zrj_travel
draft table zrj_travel_d
etag master LocalLastChangedAt
lock master total etag LastChangedAt
authorization master ( global )
{
  field ( readonly ) TravelUUID, TravelID, CreatedBy, CreatedAt,
                     LocalLastChangedBy, LocalLastChangedAt, LastChangedAt;
  field ( numbering : managed ) TravelUUID;
  field ( mandatory ) CurrencyCode;

  create;
  update;
  delete;

  association _Booking { create; with draft; }

  determination setTravelID on save { create; }
  validation validateCurrency on save { create; field CurrencyCode; }
  validation validateDates on save { create; field BeginDate, EndDate; }

  draft action Edit;
  draft action Activate optimized;
  draft action Discard;
  draft action Resume;
  draft determine action Prepare
  {
    validation validateCurrency;
    validation validateDates;
  }

  mapping for zrj_travel
  {
    TravelUUID         = travel_uuid;
    TravelID           = travel_id;
    Description        = description;
    BeginDate          = begin_date;
    EndDate            = end_date;
    TotalPrice         = total_price;
    CurrencyCode       = currency_code;
    OverallStatus      = overall_status;
    CreatedBy          = created_by;
    CreatedAt          = created_at;
    LocalLastChangedBy = local_last_changed_by;
    LocalLastChangedAt = local_last_changed_at;
    LastChangedAt      = last_changed_at;
  }
}

define behavior for ZR_RJ_Booking alias Booking
persistent table zrj_booking
draft table zrj_booking_d
etag master LocalLastChangedAt
lock dependent by _Travel
authorization dependent by _Travel
{
  field ( readonly ) BookingUUID, TravelUUID, LocalLastChangedAt;
  field ( numbering : managed ) BookingUUID;

  update;
  delete;

  association _Travel { with draft; }

  mapping for zrj_booking
  {
    BookingUUID        = booking_uuid;
    TravelUUID         = parent_uuid;
    BookingID          = booking_id;
    BookingDate        = booking_date;
    FlightPrice        = flight_price;
    CurrencyCode       = currency_code;
    LocalLastChangedAt = local_last_changed_at;
  }
}
```

After saving, use the quick fixes on `draft table zrj_travel_d` / `zrj_booking_d` (creates draft tables) and on the `implementation in class` line (creates the behavior pool).

## 4. Behavior pool - local handler class (`ZBP_R_RJ_TRAVEL`, Local Types)

```abap
CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Travel RESULT result.
    METHODS setTravelID FOR DETERMINE ON SAVE
      IMPORTING keys FOR Travel~setTravelID.
    METHODS validateCurrency FOR VALIDATE ON SAVE
      IMPORTING keys FOR Travel~validateCurrency.
    METHODS validateDates FOR VALIDATE ON SAVE
      IMPORTING keys FOR Travel~validateDates.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.

  METHOD get_global_authorizations.
    " Replace with AUTHORITY-CHECK on a custom authorization object for production.
    IF requested_authorizations-%create = if_abap_behv=>mk-on.
      result-%create = if_abap_behv=>auth-allowed.
    ENDIF.
    IF requested_authorizations-%update = if_abap_behv=>mk-on.
      result-%update = if_abap_behv=>auth-allowed.
    ENDIF.
    IF requested_authorizations-%delete = if_abap_behv=>mk-on.
      result-%delete = if_abap_behv=>auth-allowed.
    ENDIF.
  ENDMETHOD.

  METHOD setTravelID.
    READ ENTITIES OF zr_rj_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( TravelID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    DELETE travels WHERE TravelID IS NOT INITIAL.
    CHECK travels IS NOT INITIAL.

    " Demo only - use cl_numberrange_runtime=>number_get in production.
    SELECT SINGLE FROM zrj_travel FIELDS MAX( travel_id ) INTO @DATA(max_travel_id).

    MODIFY ENTITIES OF zr_rj_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( TravelID )
        WITH VALUE #( FOR travel IN travels INDEX INTO i
                      ( %tky     = travel-%tky
                        TravelID = max_travel_id + i ) ).
  ENDMETHOD.

  METHOD validateCurrency.
    READ ENTITIES OF zr_rj_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT travels INTO DATA(travel).
      " Clear messages from earlier runs.
      APPEND VALUE #( %tky = travel-%tky %state_area = 'VALIDATE_CURRENCY' ) TO reported-travel.

      IF travel-CurrencyCode IS INITIAL.
        APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
        APPEND VALUE #( %tky        = travel-%tky
                        %state_area = 'VALIDATE_CURRENCY'
                        %msg        = new_message_with_text(
                                        severity = if_abap_behv_message=>severity-error
                                        text     = 'Currency is required' )
                        %element-CurrencyCode = if_abap_behv=>mk-on ) TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD validateDates.
    READ ENTITIES OF zr_rj_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( BeginDate EndDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT travels INTO DATA(travel).
      APPEND VALUE #( %tky = travel-%tky %state_area = 'VALIDATE_DATES' ) TO reported-travel.

      IF travel-EndDate < travel-BeginDate.
        APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
        APPEND VALUE #( %tky        = travel-%tky
                        %state_area = 'VALIDATE_DATES'
                        %msg        = new_message_with_text(
                                        severity = if_abap_behv_message=>severity-error
                                        text     = 'End date must not be before begin date' )
                        %element-BeginDate = if_abap_behv=>mk-on
                        %element-EndDate   = if_abap_behv=>mk-on ) TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
```

For production messages, create a message class and use `new_message( id = 'ZRJ_TRAVEL' number = '001' severity = ... v1 = ... )` instead of `new_message_with_text`.

## 5. Projection views

```abap
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Travel - projection'
@Metadata.allowExtensions: true
@Search.searchable: true
define root view entity ZC_RJ_Travel
  provider contract transactional_query
  as projection on ZR_RJ_Travel
{
  key TravelUUID,
      @Search.defaultSearchElement: true
      TravelID,
      @Search.defaultSearchElement: true
      Description,
      BeginDate,
      EndDate,
      TotalPrice,
      @Consumption.valueHelpDefinition: [{ entity: { name: 'I_CurrencyStdVH', element: 'Currency' } }]
      CurrencyCode,
      OverallStatus,
      CreatedBy,
      CreatedAt,
      LocalLastChangedBy,
      LocalLastChangedAt,
      LastChangedAt,

      _Booking : redirected to composition child ZC_RJ_Booking
}
```

```abap
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Booking - projection'
@Metadata.allowExtensions: true
define view entity ZC_RJ_Booking
  as projection on ZR_RJ_Booking
{
  key BookingUUID,
      TravelUUID,
      BookingID,
      BookingDate,
      FlightPrice,
      CurrencyCode,
      LocalLastChangedAt,

      _Travel : redirected to parent ZC_RJ_Travel
}
```

## 6. Projection behavior definition (`ZC_RJ_Travel`)

```abap
projection;
strict ( 2 );
use draft;

define behavior for ZC_RJ_Travel alias Travel
use etag
{
  use create;
  use update;
  use delete;

  use action Edit;
  use action Activate;
  use action Discard;
  use action Resume;
  use action Prepare;

  use association _Booking { create; with draft; }
}

define behavior for ZC_RJ_Booking alias Booking
use etag
{
  use update;
  use delete;

  use association _Travel { with draft; }
}
```
