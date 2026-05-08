/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports. */
import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatSort, Sort, MatSortHeader } from '@angular/material/sort';
import {
  MatTableDataSource,
  MatTable,
  MatColumnDef,
  MatHeaderCellDef,
  MatHeaderCell,
  MatCellDef,
  MatCell,
  MatHeaderRowDef,
  MatHeaderRow,
  MatRowDef,
  MatRow
} from '@angular/material/table';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

/** rxjs Imports */
import { forkJoin, Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap, takeUntil } from 'rxjs/operators';

/** Custom Services */
import { environment } from '../../environments/environment';
import { ClientsService } from './clients.service';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { MatProgressBar } from '@angular/material/progress-bar';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';

export const DEBOUNCE_MS = 500;

@Component({
  selector: 'mifosx-clients',
  templateUrl: './clients.component.html',
  styleUrls: ['./clients.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    MatCheckbox,
    FaIconComponent,
    MatProgressBar,
    MatTable,
    MatSort,
    MatColumnDef,
    MatHeaderCellDef,
    MatHeaderCell,
    MatSortHeader,
    MatCellDef,
    MatCell,
    MatHeaderRowDef,
    MatHeaderRow,
    MatRowDef,
    MatRow,
    MatPaginator,
    MatIconButton,
    MatIcon
  ]
})
export class ClientsComponent implements OnInit, OnDestroy {
  private clientService = inject(ClientsService);

  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  private clientsRequestSub: Subscription | null = null;
  private entityIdsRequestSub: Subscription | null = null;
  private isComposing = false;
  private readonly entityIdColumnNames = [
    'EntityID',
    'Entity Id',
    'entity_id'
  ];

  /** Returns true if client data masking is enabled */
  get hideClientData(): boolean {
    return environment.complianceHideClientData;
  }

  /** Mask a client name */
  maskName(name: string): string {
    if (!name) return '';
    return name
      .split(' ')
      .map((part) => (part.length > 1 ? part[0] + '*'.repeat(part.length - 1) : part))
      .join(' ');
  }

  @ViewChild('showClosedAccounts') showClosedAccounts: MatCheckbox;

  displayedColumns = [
    'displayName',
    'entityIdNumber',
    'loanOfficer'
  ];
  dataSource: MatTableDataSource<any> = new MatTableDataSource();

  existsClientsToFilter = false;
  notExistsClientsToFilter = false;

  totalRows: number;
  isLoading = false;

  pageSize = 50;
  currentPage = 0;
  filterText = '';

  sortAttribute = '';
  sortDirection = '';

  @ViewChild(MatPaginator) paginator: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;

  ngOnInit() {
    this.searchInput$
      .pipe(debounceTime(DEBOUNCE_MS), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((value) => {
        if (value !== this.filterText) {
          this.search(value);
        }
      });

    if (environment.preloadClients) {
      this.getClients();
    }
  }

  ngOnDestroy() {
    this.clientsRequestSub?.unsubscribe();
    this.entityIdsRequestSub?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(value: string) {
    if (this.isComposing) return;
    this.searchInput$.next(value);
  }

  onCompositionStart(): void {
    this.isComposing = true;
  }

  onCompositionEnd(value: string): void {
    this.isComposing = false;
    this.searchInput$.next(value);
  }

  /**
   * Searches server for query and resource.
   */
  search(value: string) {
    this.filterText = value;
    if (this.paginator?.pageIndex !== 0) {
      this.resetPaginator();
      return;
    }
    this.getClients();
  }

  private getClients() {
    this.clientsRequestSub?.unsubscribe();
    this.entityIdsRequestSub?.unsubscribe();
    this.isLoading = true;
    this.clientsRequestSub = this.clientService
      .searchByText(this.filterText, this.currentPage, this.pageSize, this.sortAttribute, this.sortDirection)
      .subscribe(
        (data: any) => {
          const clients = data.content || [];
          this.dataSource.data = clients;

          this.totalRows = data.totalElements;

          this.existsClientsToFilter = data.numberOfElements > 0;
          this.notExistsClientsToFilter = !this.existsClientsToFilter;
          this.isLoading = false;
          this.loadClientRowDetails(clients);
        },
        (error: any) => {
          this.isLoading = false;
        }
      );
  }

  getLoanOfficer(client: any): string {
    return this.getLoanOfficerValue(client);
  }

  private loadClientRowDetails(clients: any[]): void {
    this.entityIdsRequestSub?.unsubscribe();

    if (clients.length === 0) {
      return;
    }

    this.entityIdsRequestSub = this.clientService
      .getClientDatatables()
      .pipe(
        catchError(() => of([])),
        switchMap((clientDatatables: any[]) => {
          const datatableNames = (clientDatatables || [])
            .map((datatable: any) => datatable.registeredTableName)
            .filter((datatableName: string) => !!datatableName);

          const clientDetailsRequests = clients.map((client: any) => this.getClientRowDetails(client, datatableNames));
          return forkJoin(clientDetailsRequests);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((clientDetails: Array<{ entityIdNumber: string | number | null; loanOfficer: string }>) => {
        this.dataSource.data = clients.map((client: any, index: number) => ({
          ...client,
          entityIdNumber: clientDetails[index].entityIdNumber,
          loanOfficer: clientDetails[index].loanOfficer
        }));
      });
  }

  private getClientRowDetails(
    client: any,
    datatableNames: string[]
  ): Observable<{ entityIdNumber: string | number | null; loanOfficer: string }> {
    return forkJoin({
      entityIdNumber: this.getClientEntityId(client.id?.toString(), datatableNames),
      loanOfficer: this.getClientLoanOfficer(client)
    });
  }

  private getClientEntityId(
    clientId: string | null | undefined,
    datatableNames: string[]
  ): Observable<string | number | null> {
    if (!clientId || datatableNames.length === 0) {
      return of(null);
    }

    const datatableRequests = datatableNames.map((datatableName: string) =>
      this.clientService.getClientDatatable(clientId, datatableName).pipe(catchError(() => of(null)))
    );

    return forkJoin(datatableRequests).pipe(
      map((datatables: any[]) => this.getFirstDatatableColumnValue(datatables, this.entityIdColumnNames)),
      catchError(() => of(null))
    );
  }

  private getClientLoanOfficer(client: any): Observable<string> {
    const existingLoanOfficer = this.getLoanOfficerValue(client);
    if (existingLoanOfficer || !client?.id) {
      return of(existingLoanOfficer);
    }

    return this.clientService.getClientData(client.id.toString()).pipe(
      map((clientData: any) => this.getLoanOfficerValue(clientData)),
      catchError(() => of(''))
    );
  }

  private getLoanOfficerValue(client: any): string {
    const loanOfficer = client?.loanOfficer;
    const staff = client?.staff;
    if (typeof loanOfficer === 'string') {
      return loanOfficer;
    }
    if (typeof staff === 'string') {
      return staff;
    }
    return (
      client?.loanOfficerName ||
      client?.staffName ||
      client?.staffDisplayName ||
      loanOfficer?.displayName ||
      staff?.displayName ||
      ''
    );
  }

  private getFirstDatatableColumnValue(datatables: any[], columnNames: string[]): string | number | null {
    for (const datatable of datatables) {
      const columnValue = this.getDatatableColumnValue(datatable, columnNames);
      if (columnValue !== null) {
        return columnValue;
      }
    }
    return null;
  }

  private getDatatableColumnValue(datatable: any, columnNames: string[]): string | number | null {
    const row = datatable?.data?.[0]?.row;
    const columnHeaders = datatable?.columnHeaders || [];
    if (!row || columnHeaders.length === 0) {
      return null;
    }

    const normalizedColumnNames = columnNames.map((columnName: string) => this.normalizeColumnName(columnName));
    const columnIndex = columnHeaders.findIndex((columnHeader: any) =>
      normalizedColumnNames.includes(this.normalizeColumnName(columnHeader?.columnName))
    );

    if (columnIndex === -1) {
      return null;
    }

    const value = row[columnIndex];
    return value === undefined || value === null || value === '' ? null : value;
  }

  private normalizeColumnName(columnName: string): string {
    return (columnName || '').replace(/[_\s-]/g, '').toLowerCase();
  }

  pageChanged(event: PageEvent) {
    this.pageSize = event.pageSize;
    this.currentPage = event.pageIndex;
    this.getClients();
  }

  sortChanged(event: Sort) {
    if (event.direction === '') {
      this.sortDirection = '';
      this.sortAttribute = '';
    } else {
      this.sortAttribute = event.active;
      this.sortDirection = event.direction;
    }
    this.resetPaginator();
    this.getClients();
  }

  private resetPaginator() {
    this.currentPage = 0;
    this.paginator.firstPage();
  }
}
