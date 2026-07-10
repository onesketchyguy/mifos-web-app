/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Injectable, inject } from '@angular/core';

/** rxjs Imports */
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

/** Custom Services */
import { ClientsService } from '../clients.service';

export interface ClientListSummary {
  entityIdNumber: string | number | null;
  loanOfficer: string;
  activeBalance: number | null;
  overdueBalance: number | null;
  daysInArrears: number | null;
  activeLoansCount: number | null;
}

/**
 * Caches the ClientListSummary report (one row of list metrics per client),
 * so the clients list fills its computed columns from a single query instead
 * of several requests per row. Emits null when the report is unavailable so
 * callers can fall back to per-client requests.
 */
@Injectable({ providedIn: 'root' })
export class ClientSummaryReportService {
  private clientsService = inject(ClientsService);

  private readonly TTL_MS = 10 * 60 * 1000;
  private summaries$: Observable<Map<number, ClientListSummary> | null> | null = null;
  private fetchedAt = 0;

  getSummaries(): Observable<Map<number, ClientListSummary> | null> {
    if (!this.summaries$ || Date.now() - this.fetchedAt > this.TTL_MS) {
      this.fetchedAt = Date.now();
      this.summaries$ = this.clientsService.getClientListReport().pipe(
        map((rows: any) => {
          const summaries = new Map<number, ClientListSummary>();
          (Array.isArray(rows) ? rows : []).forEach((row: any) => {
            summaries.set(Number(row.id), {
              entityIdNumber: row.entityIdNumber ?? null,
              loanOfficer: row.loanOfficer || '',
              activeBalance: this.toNumber(row.activeBalance),
              overdueBalance: this.toNumber(row.overdueBalance),
              daysInArrears: this.toNumber(row.daysInArrears),
              activeLoansCount: this.toNumber(row.activeLoansCount)
            });
          });
          return summaries;
        }),
        catchError(() => {
          this.summaries$ = null;
          return of(null);
        }),
        shareReplay(1)
      );
    }
    return this.summaries$;
  }

  /** Drops the cached report so the next read refetches (e.g. after a merge/close). */
  invalidate(): void {
    this.summaries$ = null;
  }

  private toNumber(value: any): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    return isNaN(parsed) ? null : parsed;
  }
}
