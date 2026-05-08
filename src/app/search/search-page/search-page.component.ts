/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, ViewChild, inject } from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
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
import { Router, ActivatedRoute } from '@angular/router';
import { SearchData } from '../search.model';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { ClientsService } from 'app/clients/clients.service';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

/**
 * Search Page Component
 */
@Component({
  selector: 'mifosx-search-page',
  templateUrl: './search-page.component.html',
  styleUrls: ['./search-page.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    MatTable,
    MatColumnDef,
    MatHeaderCellDef,
    MatHeaderCell,
    MatCellDef,
    MatCell,
    MatHeaderRowDef,
    MatHeaderRow,
    MatRowDef,
    MatRow,
    MatPaginator
  ]
})
export class SearchPageComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private clientsService = inject(ClientsService);
  private readonly entityIdColumnNames = [
    'EntityID',
    'Entity Id',
    'entity_id'
  ];
  private readonly clientBackedEntityTypes = [
    'CLIENT',
    'CLIENTIDENTIFIER',
    'LOAN'
  ];

  /** Flags if number of search results exceed 200 */
  overload: boolean;
  /** Datasource for loans disbursal table */
  dataSource: MatTableDataSource<SearchData>;
  /** Displayed Columns for serach results */
  displayedColumns: string[] = [
    'displayName',
    'entityIdNumber',
    'loanOfficer'
  ];
  /** Paginator for the table */
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;

  hasResults = false;

  /**
   * @param {ActivatedRoute} route Activated Route
   * @param {Router} router Router
   */
  constructor() {
    this.route.data.subscribe((data: { searchResults: any }) => {
      const hiddenEntityTypes = [
        'SAVING',
        'SHARE'
      ];
      const searchResults = data.searchResults.filter(
        (result: SearchData) => !hiddenEntityTypes.includes(result.entityType)
      );
      this.overload = searchResults.length > 200 ? true : false;
      const visibleResults = this.overload ? searchResults.slice(0, 200) : searchResults;
      this.dataSource = new MatTableDataSource(visibleResults);
      this.dataSource.paginator = this.paginator;
      this.hasResults = visibleResults.length > 0;
      this.loadSearchResultDetails(visibleResults);
    });
  }

  getSearchEntityId(entity: SearchData): string | number {
    return entity.entityNumber ?? '';
  }

  getSearchDisplayName(entity: SearchData): string {
    return entity.entityName;
  }

  getSearchLoanOfficer(entity: SearchData): string {
    return entity.loanOfficer || '';
  }

  private loadSearchResultDetails(searchResults: SearchData[]): void {
    const clientResults = searchResults.filter((result: SearchData) => !!this.getClientIdForSearchResult(result));

    if (clientResults.length === 0) {
      return;
    }

    this.clientsService
      .getClientDatatables()
      .pipe(catchError(() => of([])))
      .subscribe((clientDatatables: any[]) => {
        const datatableNames = (clientDatatables || [])
          .map((datatable: any) => datatable.registeredTableName)
          .filter((datatableName: string) => !!datatableName);

        const searchResultDetailRequests = clientResults.map((result: SearchData) =>
          this.getSearchResultDetails(result, datatableNames)
        );

        forkJoin(searchResultDetailRequests).subscribe(
          (searchResultDetails: Array<{ entityIdNumber: string | number | null; loanOfficer: string }>) => {
            searchResultDetails.forEach(
              (searchResultDetail: { entityIdNumber: string | number | null; loanOfficer: string }, index: number) => {
                if (searchResultDetail.entityIdNumber !== null) {
                  clientResults[index].entityNumber = searchResultDetail.entityIdNumber;
                }
                clientResults[index].loanOfficer = searchResultDetail.loanOfficer;
              }
            );
            this.dataSource.data = [...this.dataSource.data];
          }
        );
      });
  }

  private getSearchResultDetails(
    result: SearchData,
    datatableNames: string[]
  ): Observable<{ entityIdNumber: string | number | null; loanOfficer: string }> {
    const clientId = this.getClientIdForSearchResult(result);
    return forkJoin({
      entityIdNumber: this.getClientEntityId(clientId, datatableNames),
      loanOfficer: this.getSearchResultLoanOfficer(result, clientId)
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
      this.clientsService.getClientDatatable(clientId, datatableName).pipe(catchError(() => of(null)))
    );

    return forkJoin(datatableRequests).pipe(
      map((datatables: any[]) => this.getFirstDatatableColumnValue(datatables, this.entityIdColumnNames)),
      catchError(() => of(null))
    );
  }

  private getSearchResultLoanOfficer(result: SearchData, clientId: string | null): Observable<string> {
    const existingLoanOfficer = this.getLoanOfficerValue(result);
    if (existingLoanOfficer || !clientId) {
      return of(existingLoanOfficer);
    }

    return this.clientsService.getClientData(clientId).pipe(
      map((clientData: any) => this.getLoanOfficerValue(clientData)),
      catchError(() => of(''))
    );
  }

  private getLoanOfficerValue(value: any): string {
    const loanOfficer = value?.loanOfficer;
    const staff = value?.staff;
    if (typeof loanOfficer === 'string') {
      return loanOfficer;
    }
    if (typeof staff === 'string') {
      return staff;
    }
    return (
      value?.loanOfficerName ||
      value?.staffName ||
      value?.staffDisplayName ||
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

  private getClientIdForSearchResult(result: SearchData): string | null {
    if (!this.clientBackedEntityTypes.includes(result.entityType)) {
      return null;
    }

    return (result.entityType === 'CLIENT' ? result.entityId : result.parentId)?.toString() || null;
  }

  private normalizeColumnName(columnName: string): string {
    return (columnName || '').replace(/[_\s-]/g, '').toLowerCase();
  }

  /**
   * Returns link to entity view page.
   * @param {any} entity Entity
   */
  navigate(entity: SearchData) {
    switch (entity.entityType) {
      case 'CLIENT':
        this.router.navigate([
          'clients',
          entity.entityId,
          'general'
        ]);
        break;
      case 'CLIENTIDENTIFIER':
        this.router.navigate([
          'clients',
          entity.parentId,
          'general'
        ]);
        break;
      case 'CENTER':
        this.router.navigate([
          'centers',
          entity.entityId
        ]);
        break;
      case 'GROUP':
        this.router.navigate([
          'groups',
          entity.entityId
        ]);
        break;
      case 'SHARE':
        this.router.navigate([
          'clients',
          entity.parentId,
          'shares-accounts',
          entity.entityId
        ]);
        break;
      case 'SAVING':
        if (entity.subEntityType === 'depositAccountType.recurringDeposit') {
          this.router.navigate([
            'clients',
            entity.parentId,
            'recurring-deposits-accounts',
            entity.entityId,
            'transactions'
          ]);
        } else if (entity.subEntityType === 'depositAccountType.fixedDeposit') {
          this.router.navigate([
            'clients',
            entity.parentId,
            'fixed-deposits-accounts',
            entity.entityId,
            'transactions'
          ]);
        } else if (entity.subEntityType === 'depositAccountType.savingsDeposit') {
          this.router.navigate([
            'clients',
            entity.parentId,
            'savings-accounts',
            entity.entityId,
            'transactions'
          ]);
        }
        break;
      case 'LOAN':
        this.router.navigate([
          'clients',
          entity.parentId,
          'loans-accounts',
          entity.entityId,
          'general'
        ]);
        break;
    }
  }
}
