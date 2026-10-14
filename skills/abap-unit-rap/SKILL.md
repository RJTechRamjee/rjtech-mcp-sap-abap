---
name: abap-unit-rap
description: Write ABAP Unit tests for ABAP Cloud code - plain classes, CDS view entities (CDS test double framework), and RAP business objects (behavior handler methods and end-to-end EML tests with SQL test doubles). Use when the user asks for unit tests, test doubles, test coverage, or to make RAP determinations/validations testable.
---

# ABAP Unit for ABAP Cloud, CDS and RAP

## General rules

- Test classes: `FOR TESTING RISK LEVEL HARMLESS DURATION SHORT`, local class names `ltc_<what>`, test methods describe behavior (`reject_missing_currency`, `fill_travel_id_on_create`).
- Arrange - Act - Assert in each method; one behavior per test method.
- Assertions via `cl_abap_unit_assert`: `assert_equals( act = ... exp = ... )`, `assert_initial`, `assert_not_initial`, `assert_true`, `fail( msg = ... )`. Always pass `msg` for non-obvious checks.
- Never depend on existing database content. Replace table/view access with test doubles; insert exactly the data the test needs.
- Shared expensive setup goes in `class_setup` / `class_teardown` (static); per-test reset in `setup` / `teardown`.
- Run with Ctrl+Shift+F10 in ADT; coverage with Ctrl+Shift+F11.

## 1. Plain classes: inject dependencies

Design for testability: depend on an interface, pass it in the constructor (or a setter used only by tests), and use a local test double class implementing that interface in the test include. In ABAP Cloud, `cl_abap_testdouble=>create( 'ZIF_...' )` creates doubles for interfaces when hand-written ones get tedious.

## 2. CDS view entities: CDS test double framework

Tests the view logic (joins, case expressions, aggregations) by redirecting its data sources to doubles.

```abap
CLASS ltc_travel_customer DEFINITION FINAL FOR TESTING
  RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    CLASS-DATA environment TYPE REF TO if_cds_test_environment.
    CLASS-METHODS class_setup.
    CLASS-METHODS class_teardown.
    METHODS setup.
    METHODS status_criticality_accepted FOR TESTING.
ENDCLASS.

CLASS ltc_travel_customer IMPLEMENTATION.
  METHOD class_setup.
    environment = cl_cds_test_environment=>create( i_for_entity = 'ZI_RJ_TRAVELCUSTOMER' ).
  ENDMETHOD.

  METHOD class_teardown.
    environment->destroy( ).
  ENDMETHOD.

  METHOD setup.
    environment->clear_doubles( ).
  ENDMETHOD.

  METHOD status_criticality_accepted.
    DATA travels TYPE STANDARD TABLE OF zrj_travel WITH EMPTY KEY.
    travels = VALUE #( ( travel_uuid = cl_system_uuid=>create_uuid_x16_static( )
                         travel_id = '00000001' overall_status = 'A' currency_code = 'EUR' ) ).
    environment->insert_test_data( i_data = travels ).

    SELECT FROM zi_rj_travelcustomer FIELDS TravelID, StatusCriticality INTO TABLE @DATA(result).

    cl_abap_unit_assert=>assert_equals( act = lines( result ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = result[ 1 ]-StatusCriticality exp = 3
                                        msg = 'Accepted travel must be green' ).
  ENDMETHOD.
ENDCLASS.
```

The test class can live in any class's test include (common: a dedicated test class `ZCL_RJ_TRAVEL_CDS_TEST` with only test code).

## 3. RAP: unit-test a handler method directly

Handler classes are local and private, so the test class must be a friend and created with the special `FOR TESTING` syntax.

In the behavior pool **Local Types**, before the handler definition:

```abap
CLASS ltc_travel DEFINITION DEFERRED FOR TESTING.
CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler FRIENDS ltc_travel.
```

In the **Test Classes** include:

```abap
CLASS ltc_travel DEFINITION FINAL FOR TESTING
  RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    CLASS-DATA sql_environment TYPE REF TO if_osql_test_environment.
    DATA cut TYPE REF TO lhc_travel.
    CLASS-METHODS class_setup.
    CLASS-METHODS class_teardown.
    METHODS setup.
    METHODS teardown.
    METHODS reject_missing_currency FOR TESTING.
ENDCLASS.

CLASS ltc_travel IMPLEMENTATION.
  METHOD class_setup.
    sql_environment = cl_osql_test_environment=>create( i_dependency_list = VALUE #( ( 'ZRJ_TRAVEL' ) ) ).
  ENDMETHOD.

  METHOD class_teardown.
    sql_environment->destroy( ).
  ENDMETHOD.

  METHOD setup.
    CREATE OBJECT cut FOR TESTING.
  ENDMETHOD.

  METHOD teardown.
    ROLLBACK ENTITIES.
    sql_environment->clear_doubles( ).
  ENDMETHOD.

  METHOD reject_missing_currency.
    DATA(uuid) = cl_system_uuid=>create_uuid_x16_static( ).
    sql_environment->insert_test_data(
      i_data = VALUE zrj_travel_t( ( travel_uuid = uuid currency_code = '' ) ) ).

    DATA failed   TYPE RESPONSE FOR FAILED LATE zr_rj_travel.
    DATA reported TYPE RESPONSE FOR REPORTED LATE zr_rj_travel.

    cut->validatecurrency( EXPORTING keys     = VALUE #( ( TravelUUID = uuid ) )
                           CHANGING  failed   = failed
                                     reported = reported ).

    cl_abap_unit_assert=>assert_equals( act = lines( failed-travel ) exp = 1 ).
  ENDMETHOD.
ENDCLASS.
```

Notes:
- `zrj_travel_t` stands for a table type of `zrj_travel`; declare a local one (`TYPES zrj_travel_t TYPE STANDARD TABLE OF zrj_travel WITH EMPTY KEY.`) if none exists.
- Validations/determinations read via EML `IN LOCAL MODE`; with the SQL double they read the inserted active rows. Draft tables are separate - add `ZRJ_TRAVEL_D` to the dependency list when testing draft instances (`%is_draft = if_abap_behv=>mk-on`).
- To isolate a handler from its own BO completely, SAP provides `cl_botd_txbufdbl_bo_test_env` (transactional buffer double) and `cl_botd_mockemlapi_bo_test_env` (EML API mock). Use them when the SQL-double approach gets complicated; check their availability on the user's release.

## 4. RAP: end-to-end EML test

Tests the whole BO (determinations, validations, save) through its public EML API. Put it in a separate global test class, not the behavior pool.

```abap
METHOD create_fills_travel_id.
  MODIFY ENTITIES OF zr_rj_travel
    ENTITY Travel
      CREATE FIELDS ( Description CurrencyCode BeginDate EndDate )
      WITH VALUE #( ( %cid = 'T1' Description = 'Unit test' CurrencyCode = 'EUR'
                      BeginDate = '20270101' EndDate = '20270110' ) )
    MAPPED DATA(mapped)
    FAILED DATA(failed)
    REPORTED DATA(reported).
  cl_abap_unit_assert=>assert_initial( failed ).

  COMMIT ENTITIES RESPONSE OF zr_rj_travel
    FAILED DATA(commit_failed)
    REPORTED DATA(commit_reported).
  cl_abap_unit_assert=>assert_initial( commit_failed ).

  READ ENTITIES OF zr_rj_travel
    ENTITY Travel FIELDS ( TravelID ) WITH VALUE #( ( TravelUUID = mapped-travel[ 1 ]-TravelUUID ) )
    RESULT DATA(travels).
  cl_abap_unit_assert=>assert_not_initial( travels[ 1 ]-TravelID ).
ENDMETHOD.
```

Requirements: `cl_osql_test_environment` doubles for every table the BO writes (active and draft tables, plus anything read in determinations), created in `class_setup`; `ROLLBACK ENTITIES` and `clear_doubles( )` in `teardown`. `COMMIT ENTITIES` writes into the doubles, never into real tables.

For a negative test, send invalid data and assert `commit_failed-travel` is not initial and `commit_reported-travel` contains the expected message.

## Checklist

- [ ] No test reads or writes real table content.
- [ ] Every validation has a positive and a negative test; every determination a test that checks the filled value.
- [ ] Tests run green in any order (no shared state between methods).
- [ ] Test classes pass ATC.
