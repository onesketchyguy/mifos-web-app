/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Injectable, inject } from '@angular/core';

/** rxjs Imports */
import { Observable, combineLatest, map, of, shareReplay, switchMap, tap, catchError } from 'rxjs';

/** Custom Services */
import { SystemService } from '../system.service';

/**
 * In-memory representation of the "user view" flag for registered data tables.
 *
 * `configured` is true once the backing Fineract Code exists — that is the point
 * at which the opt-in filter becomes authoritative. Until then everything is
 * shown (fail-open), so the app behaves exactly as before the first table is
 * marked.
 */
interface DatatableVisibilityState {
  /** Whether the backing Code exists (i.e. the admin has marked at least one table). */
  configured: boolean;
  /** Id of the backing Code, or null when it has not been created yet. */
  codeId: number | null;
  /** Registered table names that are marked as a user view. */
  visible: Set<string>;
  /** Registered table name → Code value id, used when un-marking a table. */
  valueIds: Map<string, number>;
}

/** Shown-everything state used before configuration and on any read failure. */
const FAIL_OPEN: DatatableVisibilityState = {
  configured: false,
  codeId: null,
  visible: new Set<string>(),
  valueIds: new Map<string, number>()
};

/**
 * Controls which registered data tables are exposed to end users as tabs on the
 * client / loan / group / center / savings screens.
 *
 * The flag is stored globally in a dedicated Fineract system Code
 * (`UserViewDatatables`) whose values are the registered table names that should
 * be visible. This keeps the setting shared across every user without any direct
 * database writes, and is fully reversible (delete the Code to reset).
 */
@Injectable({ providedIn: 'root' })
export class DatatableVisibilityService {
  private systemService = inject(SystemService);

  /** Name of the Fineract system Code that stores the user-visible table names. */
  static readonly CODE_NAME = 'UserViewDatatables';

  /**
   * Application tables whose data table tabs are shown to end users and
   * therefore honour the flag. Admin/config surfaces (products, offices) are
   * intentionally left unfiltered.
   */
  static readonly OPERATIONAL_APPTABLES: ReadonlySet<string> = new Set<string>([
    'm_client',
    'm_loan',
    'm_group',
    'm_center',
    'm_savings_account',
    'm_savings_account_transaction'
  ]);

  /** Last resolved state, kept for synchronous reads from the toggle UI. */
  private snapshot: DatatableVisibilityState = FAIL_OPEN;
  /** Shared load so every entity resolver reuses a single request per session. */
  private cache$: Observable<DatatableVisibilityState> | null = null;

  /**
   * Loads the visibility state once and caches it. Any failure — Code missing,
   * user lacking READ_CODE, server unreachable — resolves to a fail-open state
   * so tabs are never hidden because of an error.
   */
  load(): Observable<DatatableVisibilityState> {
    if (!this.cache$) {
      this.cache$ = this.fetchState().pipe(
        catchError(() => of(FAIL_OPEN)),
        tap((state) => (this.snapshot = state)),
        shareReplay(1)
      );
    }
    return this.cache$;
  }

  /** Forces the next `load()` to re-fetch from the server. */
  refresh(): Observable<DatatableVisibilityState> {
    this.cache$ = null;
    return this.load();
  }

  /**
   * Filters a stream of registered data tables down to the ones marked as a
   * user view. When the flag has never been configured the list is returned
   * intact (fail-open).
   * @param {Observable<any>} source$ Registered data tables for an entity.
   * @returns {Observable<any[]>} Only the user-visible data tables.
   */
  filterUserVisible(source$: Observable<any>): Observable<any[]> {
    return combineLatest([
      source$,
      this.load()
    ]).pipe(
      map(
        ([
          datatables,
          state
        ]) => {
          if (!state.configured) {
            return datatables || [];
          }
          return (datatables || []).filter((dataTable: any) => state.visible.has(dataTable.registeredTableName));
        }
      )
    );
  }

  /** Whether the given application table's tabs honour the user-view flag. */
  isOperational(applicationTableName: string): boolean {
    return DatatableVisibilityService.OPERATIONAL_APPTABLES.has(applicationTableName);
  }

  /**
   * Synchronous read of whether a table is explicitly marked as a user view,
   * for the toggle UI. Returns false until a table has been marked — such tables
   * still appear on end-user screens via the fail-open filter until the first
   * table is marked, at which point opt-in becomes authoritative.
   */
  isMarkedUserView(registeredTableName: string): boolean {
    return this.snapshot.visible.has(registeredTableName);
  }

  /**
   * Marks or un-marks a data table as a user view by adding / removing its name
   * as a value under the visibility Code, creating the Code on first use.
   * @param {string} registeredTableName Registered data table name.
   * @param {boolean} visible Whether the table should be shown to users.
   * @returns {Observable<any>} Emits once the change is persisted and re-loaded.
   */
  setUserVisible(registeredTableName: string, visible: boolean): Observable<any> {
    return this.load().pipe(
      switchMap((state) => {
        if (visible) {
          return this.ensureCode(state).pipe(
            switchMap((codeId) =>
              this.systemService.createCodeValue(String(codeId), {
                name: registeredTableName,
                description: 'Data table shown to users',
                position: state.visible.size + 1,
                isActive: true
              })
            )
          );
        }
        if (!state.codeId || !state.valueIds.has(registeredTableName)) {
          return of(null);
        }
        return this.systemService.deleteCodeValue(
          String(state.codeId),
          String(state.valueIds.get(registeredTableName))
        );
      }),
      switchMap((response) => this.refresh().pipe(map(() => response)))
    );
  }

  /** Resolves the backing Code id, creating the Code the first time it is needed. */
  private ensureCode(state: DatatableVisibilityState): Observable<number> {
    if (state.codeId) {
      return of(state.codeId);
    }
    return this.systemService
      .createCode({ name: DatatableVisibilityService.CODE_NAME })
      .pipe(map((response: any) => response.resourceId));
  }

  /** Reads the Code and its values, mapping them into a {@link DatatableVisibilityState}. */
  private fetchState(): Observable<DatatableVisibilityState> {
    return this.systemService.getCodes().pipe(
      switchMap((codes: any[]) => {
        const code = (codes || []).find((item: any) => item.name === DatatableVisibilityService.CODE_NAME);
        if (!code) {
          return of(FAIL_OPEN);
        }
        return this.systemService
          .getCodeValues(code.id)
          .pipe(map((values: any[]) => this.buildState(code.id, values || [])));
      })
    );
  }

  /** Builds a configured state from the Code's values. */
  private buildState(codeId: number, values: any[]): DatatableVisibilityState {
    const visible = new Set<string>();
    const valueIds = new Map<string, number>();
    values.forEach((value: any) => {
      visible.add(value.name);
      valueIds.set(value.name, value.id);
    });
    return {
      configured: true,
      codeId,
      visible,
      valueIds
    };
  }
}
