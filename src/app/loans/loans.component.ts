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
    'borrower',
    'currentDueDate',
    'balanceNow',
    'amountNowDue',
    'projectedAccruedInterest',
    'interestRate',
    'amountLast',
    'maturityDate',
    'daysLate'
  ];

  /** Sorter for loans table. */
  sort: MatSort;

  /**
   * Sets the sorter when the table is rendered.
   */
  @ViewChild(MatSort)
  set matSort(sort: MatSort) {
    this.sort = sort;
    this.dataSource.sort = this.sort;
  }

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
    this.dataSource.sortingDataAccessor = (loan: any, column: string) => {
      return this.getSortValue(loan, column);
    };
    this.dataSource.filterPredicate = (loan: any, filter: string) => {
      const searchData = [
        this.getLoanIdentifier(loan),
        this.getBorrowerName(loan),
        this.getCurrentDueDate(loan),
        this.getBalanceNow(loan),
        this.getAmountNowDue(loan),
        this.getProjectedAccruedInterest(loan),
        this.getInterestRate(loan),
        this.getAmountLast(loan),
        this.getMaturityDate(loan),
        this.getDaysLate(loan)
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
   * Returns the loan identifier displayed in the list.
   * @param {any} loan Loan data.
   * @returns {string | number} Loan identifier.
   */
  getLoanIdentifier(loan: any): string | number {
    return loan.accountNo || loan.externalId || loan.id || '';
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
  getBalanceNow(loan: any): number | undefined {
    return (
      loan.balanceNow ??
      loan.loanBalance ??
      loan.totalOutstanding ??
      loan.outstandingBalance ??
      loan.summary?.totalOutstanding ??
      loan.summary?.totalExpectedRepayment
    );
  }

  /**
   * Returns the current due date from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {any} Current due date.
   */
  getCurrentDueDate(loan: any): any {
    return (
      loan.currentDueDate ||
      loan.nextDueDate ||
      loan.nextRepaymentDate ||
      loan.dueDate ||
      loan.summary?.overdueSinceDate
    );
  }

  /**
   * Returns amount currently due from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {number | undefined} Amount now due.
   */
  getAmountNowDue(loan: any): number | undefined {
    return loan.amountNowDue ?? loan.totalOverdue ?? loan.amountInArrears ?? loan.summary?.totalOverdue;
  }

  /**
   * Returns projected accrued interest from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {number | undefined} Projected accrued interest.
   */
  getProjectedAccruedInterest(loan: any): number | undefined {
    return (
      loan.projectedAccruedInterest ??
      loan.projectedAccruedInterestAmount ??
      loan.accruedInterest ??
      loan.summary?.interestOutstanding
    );
  }

  /**
   * Returns interest rate from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {number | undefined} Interest rate.
   */
  getInterestRate(loan: any): number | undefined {
    return loan.interestRate ?? loan.annualInterestRate ?? loan.interestRatePerPeriod;
  }

  /**
   * Returns last amount from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {number | undefined} Last amount.
   */
  getAmountLast(loan: any): number | undefined {
    return loan.amountLast ?? loan.lastPaymentAmount ?? loan.lastRepaymentAmount ?? loan.lastTransactionAmount;
  }

  /**
   * Returns maturity date from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {any} Maturity date.
   */
  getMaturityDate(loan: any): any {
    return loan.maturityDate || loan.timeline?.expectedMaturityDate || loan.timeline?.actualMaturityDate;
  }

  /**
   * Returns days late from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {number | undefined} Days late.
   */
  getDaysLate(loan: any): number | undefined {
    const daysLate = loan.daysLate ?? loan.delinquent?.delinquentDays ?? loan.delinquent?.pastDueDays;
    if (daysLate !== undefined && daysLate !== null) {
      return daysLate;
    }

    const overdueSinceDate = loan.summary?.overdueSinceDate;
    const overdueSinceTime = this.getDateSortValue(overdueSinceDate);
    if (!overdueSinceTime) {
      return undefined;
    }

    return Math.max(Math.floor((Date.now() - overdueSinceTime) / 86400000), 0);
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
    if (this.sort) {
      this.dataSource.sort = this.sort;
    }
  }

  private getSortValue(loan: any, column: string): string | number {
    switch (column) {
      case 'loanId':
        return this.normalizeString(this.getLoanIdentifier(loan));
      case 'borrower':
        return this.normalizeString(this.getBorrowerName(loan));
      case 'currentDueDate':
        return this.getDateSortValue(this.getCurrentDueDate(loan));
      case 'balanceNow':
        return this.getBalanceNow(loan) || 0;
      case 'amountNowDue':
        return this.getAmountNowDue(loan) || 0;
      case 'projectedAccruedInterest':
        return this.getProjectedAccruedInterest(loan) || 0;
      case 'interestRate':
        return this.getInterestRate(loan) || 0;
      case 'amountLast':
        return this.getAmountLast(loan) || 0;
      case 'maturityDate':
        return this.getDateSortValue(this.getMaturityDate(loan));
      case 'daysLate':
        return this.getDaysLate(loan) || 0;
      default:
        return this.normalizeString(loan[column]);
    }
  }

  private normalizeString(value: any): string {
    return value === undefined || value === null ? '' : value.toString().toLowerCase();
  }

  private getDateSortValue(value: any): number {
    if (!value) {
      return 0;
    }

    if (Array.isArray(value)) {
      const [
        year,
        month,
        day
      ] = value;
      return new Date(year, month - 1, day).getTime();
    }

    return new Date(value).getTime() || 0;
  }
}
