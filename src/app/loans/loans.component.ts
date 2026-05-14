/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import {
  MatTable,
  MatTableDataSource,
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

/** Custom Services */
import { LoansService } from './loans.service';

/** Custom Imports */
import { FormatNumberPipe } from '../pipes/format-number.pipe';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';

/**
 * Loans component.
 */
@Component({
  selector: 'mifosx-loans',
  templateUrl: './loans.component.html',
  styleUrls: ['./loans.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    RouterLink,
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
    MatPaginator,
    MatSort,
    MatSortHeader,
    FormatNumberPipe
  ]
})
export class LoansComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private loansService = inject(LoansService);

  /** Loans data. */
  loans: any[] = [];
  /** Data source for loans table. */
  dataSource = new MatTableDataSource<any>([]);
  /** Columns to be displayed in loans table. */
  displayedColumns: string[] = [
    'loanId',
    'accountNo',
    'borrower',
    'loanProduct',
    'principal',
    'balance',
    'status'
  ];

  /** Sorter for loans table. */
  @ViewChild(MatSort, { static: true }) sort: MatSort;

  /** Current page index. */
  currentPage = 0;
  /** Page size. */
  pageSize = 100;
  /** Total filtered records. */
  totalRecords = 0;

  /**
   * Retrieves the loans data from `resolve`.
   */
  constructor() {
    this.route.data.subscribe((data: { loansData: any }) => {
      this.setLoans(data.loansData);
    });
  }

  /**
   * Initializes sorting and filtering for the loans table.
   */
  ngOnInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.sortingDataAccessor = (loan: any, column: string) => {
      switch (column) {
        case 'borrower':
          return this.getBorrowerName(loan);
        case 'loanProduct':
          return loan.loanProductName;
        case 'balance':
          return this.getLoanBalance(loan) || 0;
        case 'status':
          return loan.status?.value;
        default:
          return loan[column];
      }
    };
    this.dataSource.filterPredicate = (loan: any, filter: string) => {
      const searchData = [
        loan.id,
        loan.accountNo,
        this.getBorrowerName(loan),
        loan.loanProductName,
        loan.status?.value,
        loan.status?.code,
        loan.clientOfficeName,
        loan.group?.name
      ]
        .filter((value: any) => value !== undefined && value !== null)
        .join(' ')
        .toLowerCase();
      return searchData.includes(filter);
    };
  }

  /**
   * Filters data in loans table based on passed value.
   * @param {string} filterValue Value to filter data.
   */
  applyFilter(filterValue: string = '') {
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  /**
   * Handles paginator page changes.
   * @param {PageEvent} event Page event.
   */
  changePaging(event: PageEvent) {
    this.currentPage = event.pageIndex;
    this.pageSize = event.pageSize;
    this.getLoans();
  }

  /**
   * Retrieves loans for the current page.
   */
  getLoans() {
    this.loansService.getLoans(this.currentPage * this.pageSize, this.pageSize).subscribe((loansData: any) => {
      this.setLoans(loansData);
    });
  }

  /**
   * Returns borrower display name for client or group loans.
   * @param {any} loan Loan data.
   * @returns {string} Borrower name.
   */
  getBorrowerName(loan: any): string {
    return loan.clientName || loan.group?.name || loan.groupName || '';
  }

  /**
   * Returns borrower route for client or group loans.
   * @param {any} loan Loan data.
   * @returns {any[]} Borrower route.
   */
  getBorrowerRoute(loan: any): any[] {
    if (loan.clientId) {
      return [
        '/clients',
        loan.clientId,
        'general'
      ];
    }
    if (loan.group?.id || loan.groupId) {
      return [
        '/groups',
        loan.group?.id || loan.groupId,
        'general'
      ];
    }
    return [];
  }

  /**
   * Returns outstanding balance from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {number | undefined} Loan balance.
   */
  getLoanBalance(loan: any): number | undefined {
    return (
      loan.loanBalance ??
      loan.totalOutstanding ??
      loan.outstandingBalance ??
      loan.summary?.totalOutstanding ??
      loan.summary?.totalExpectedRepayment
    );
  }

  /**
   * Navigates to the loan account view.
   * @param {any} loan Loan data.
   */
  viewLoan(loan: any) {
    this.router.navigate([
      '/loans',
      loan.id,
      'general'
    ]);
  }

  private setLoans(loansData: any) {
    this.loans = loansData?.pageItems || [];
    this.totalRecords = loansData?.totalFilteredRecords || this.loans.length;
    this.dataSource.data = this.loans;
    this.dataSource.sort = this.sort;
  }
}
