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
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
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

/** rxjs Imports */
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

/** Custom Services */
import { LoansService } from './loans.service';
import { SettingsService } from 'app/settings/settings.service';
import { OrganizationService } from 'app/organization/organization.service';

/** Custom Dialog */
import {
  SelectClientDialogComponent,
  SelectClientDialogResult
} from './select-client-dialog/select-client-dialog.component';

/** Custom Imports */
import { FormatNumberPipe } from '../pipes/format-number.pipe';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { matchesFuzzySearch, normalizeSearchText } from 'app/shared/utils/fuzzy-search.util';
import { SearchData } from 'app/search/search.model';
import { SearchService } from 'app/search/search.service';

interface LoanFilterOption {
  value: string;
  label: string;
}

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
    MatIcon,
    MatProgressSpinner,
    FormatNumberPipe
  ]
})
export class LoansComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private loansService = inject(LoansService);
  private searchService = inject(SearchService);
  private settingsService = inject(SettingsService);
  private organizationService = inject(OrganizationService);
  private dialog = inject(MatDialog);

  /** Loans data. */
  loans: any[] = [];
  /** Full loan index used for filtered pagination. */
  allLoans: any[] = [];
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
    'daysLate',
    'company'
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
  /** Current loan enrichment request id. */
  enrichmentRequest = 0;
  /** Current filter index request id. */
  filterRequest = 0;
  /** Whether full loan index is loaded for filters. */
  allLoansLoaded = false;
  /** Track which loan IDs are currently being enriched. */
  loadingLoanIds = new Set<string>();
  /** Raw text query used for API-backed search fallbacks. */
  textFilterQuery = '';
  /** Text filter value. */
  textFilter = '';
  /** Status filter value. */
  statusFilter = '';
  /** Company filter value. */
  companyFilter = '';
  /** Loan status filter options. */
  statusOptions: string[] = [];
  /** Loan company filter options. */
  companyOptions: LoanFilterOption[] = [];
  /** Office lookup values from m_office. */
  officeOptions: LoanFilterOption[] = [];
  /** Office names by office id. */
  officeNameById = new Map<string, string>();
  /** Loan ids returned by global search for the active text filter. */
  globalLoanSearchIds = new Set<string>();
  /** Loan account numbers returned by global search for the active text filter. */
  globalLoanSearchAccountNumbers = new Set<string>();
  /** Loan external ids returned by global search for the active text filter. */
  globalLoanSearchExternalIds = new Set<string>();

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
    this.loadOfficeOptions();
    this.dataSource.sortingDataAccessor = (loan: any, column: string) => {
      return this.getSortValue(loan, column);
    };
    this.dataSource.filterPredicate = (loan: any, filter: string) => {
      const filters = JSON.parse(filter || '{}');
      return this.matchesLoanFilters(loan, filters);
    };
  }

  /**
   * Filters data in loans table based on passed value.
   * @param {string} filterValue Value to filter data.
   */
  applyFilter(filterValue: string = '') {
    this.textFilterQuery = filterValue;
    this.textFilter = normalizeSearchText(filterValue);
    this.currentPage = 0;
    this.applyLoanFilters();
  }

  /**
   * Filters data in loans table based on selected status.
   * @param {string} status Status filter.
   */
  applyStatusFilter(status: string = '') {
    this.statusFilter = status;
    this.currentPage = 0;
    this.applyLoanFilters();
  }

  /**
   * Filters data in loans table based on selected company.
   * @param {string} company Company filter.
   */
  applyCompanyFilter(company: string = '') {
    this.companyFilter = company;
    this.currentPage = 0;
    this.applyLoanFilters();
  }

  /**
   * Handles paginator page changes.
   * @param {PageEvent} event Page event.
   */
  changePaging(event: PageEvent) {
    this.currentPage = event.pageIndex;
    this.pageSize = event.pageSize;
    if (this.hasActiveFilters()) {
      this.applyFilteredLoans();
    } else {
      this.getLoans();
    }
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
   * Check if a specific loan is being enriched.
   * @param loanId Loan ID to check.
   * @returns true if the loan is currently being enriched.
   */
  isLoanLoading(loanId: string | number): boolean {
    return this.loadingLoanIds.has(loanId.toString());
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
   * Returns loan status display value.
   * @param {any} loan Loan data.
   * @returns {string} Loan status.
   */
  getLoanStatus(loan: any): string {
    return loan.status?.value || loan.status?.code || '';
  }

  /**
   * Returns company or office display value.
   * @param {any} loan Loan data.
   * @returns {string} Loan company.
   */
  getLoanCompany(loan: any): string {
    const officeValue = this.getLoanCompanyFilterValue(loan);
    return (
      this.officeNameById.get(officeValue) ||
      this.getAttributeDisplayValue(loan.m_office) ||
      this.getAttributeDisplayValue(loan.attributes?.m_office) ||
      this.getAttributeDisplayValue(loan.datatables?.m_office) ||
      this.getAttributeDisplayValue(loan.dataTables?.m_office) ||
      loan.companyName ||
      loan.company?.name ||
      loan.clientOfficeName ||
      loan.officeName ||
      loan.office?.name ||
      loan.group?.officeName ||
      ''
    );
  }

  /**
   * Returns the company or office filter value.
   * @param {any} loan Loan data.
   * @returns {string} Loan company filter value.
   */
  getLoanCompanyFilterValue(loan: any): string {
    return this.normalizeOptionValue(
      this.getAttributeFilterValue(loan.m_office) ||
        this.getAttributeFilterValue(loan.attributes?.m_office) ||
        this.getAttributeFilterValue(loan.datatables?.m_office) ||
        this.getAttributeFilterValue(loan.dataTables?.m_office) ||
        loan.officeId ||
        loan.clientOfficeId ||
        loan.group?.officeId ||
        loan.office?.id ||
        loan.companyId ||
        loan.company?.id ||
        loan.companyName ||
        loan.clientOfficeName ||
        loan.officeName ||
        loan.office?.name ||
        loan.group?.officeName ||
        ''
    );
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
      loan.summary?.totalOutstanding ??
      loan.loanBalance ??
      loan.totalOutstanding ??
      loan.outstandingBalance ??
      loan.summary?.totalExpectedRepayment
    );
  }

  /**
   * Returns the current due date from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {any} Current due date.
   */
  getCurrentDueDate(loan: any): any {
    const duePeriods = this.getOutstandingSchedulePeriods(loan);
    const currentDuePeriod = duePeriods.find((period: any) => this.getDateSortValue(period.dueDate) <= this.getToday());
    return (
      loan.currentDueDate ||
      loan.nextDueDate ||
      loan.nextRepaymentDate ||
      loan.dueDate ||
      loan.summary?.overdueSinceDate ||
      currentDuePeriod?.dueDate ||
      duePeriods[0]?.dueDate
    );
  }

  /**
   * Returns amount currently due from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {number | undefined} Amount now due.
   */
  getAmountNowDue(loan: any): number | undefined {
    return (
      loan.amountNowDue ??
      loan.summary?.totalOverdue ??
      loan.totalOverdue ??
      loan.amountInArrears ??
      this.getOutstandingDueAmount(loan)
    );
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
      loan.summary?.interestOverdue ??
      loan.summary?.interestOutstanding ??
      this.getOutstandingPeriodTotal(loan, [
        'interestOutstanding',
        'interestDue'
      ])
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
    const lastPayment = this.getLastPaymentTransaction(loan);
    return loan.amountLast ?? loan.lastPaymentAmount ?? loan.lastRepaymentAmount ?? lastPayment?.amount;
  }

  /**
   * Returns maturity date from available loan list fields.
   * @param {any} loan Loan data.
   * @returns {any} Maturity date.
   */
  getMaturityDate(loan: any): any {
    return (
      loan.maturityDate ||
      loan.timeline?.expectedMaturityDate ||
      loan.timeline?.actualMaturityDate ||
      loan.repaymentSchedule?.periods?.[loan.repaymentSchedule.periods.length - 1]?.dueDate
    );
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

    const overduePeriod = this.getOutstandingSchedulePeriods(loan).find(
      (period: any) => this.getDateSortValue(period.dueDate) < this.getToday()
    );
    const overdueSinceDate = loan.summary?.overdueSinceDate || overduePeriod?.dueDate;
    const overdueSinceTime = this.getDateSortValue(overdueSinceDate);
    if (!overdueSinceTime) {
      return undefined;
    }

    return Math.max(Math.floor((Date.now() - overdueSinceTime) / 86400000), 0);
  }

  /**
   * Opens the client selection dialog to begin a new loan creation flow.
   * Navigates to loan creation under the selected client, or to client
   * creation with a return flag so the user lands on loan creation after.
   */
  addNewLoan(): void {
    const dialogRef = this.dialog.open(SelectClientDialogComponent, { width: '480px' });
    dialogRef.afterClosed().subscribe((result: SelectClientDialogResult | undefined) => {
      if (!result) {
        return;
      }
      if (result.createNew) {
        this.router.navigate(['/clients/create'], { queryParams: { returnToLoan: true } });
      } else if (result.clientId) {
        this.router.navigate([
          '/clients',
          result.clientId,
          'loans-accounts',
          'create'
        ]);
      }
    });
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
    const enrichmentRequest = ++this.enrichmentRequest;
    this.loans = loansData?.pageItems || [];
    this.totalRecords = loansData?.totalFilteredRecords || this.loans.length;
    this.dataSource.data = this.loans;
    if (this.sort) {
      this.dataSource.sort = this.sort;
    }
    this.updateFilterOptions();
    this.enrichLoans(enrichmentRequest);
  }

  private enrichLoans(enrichmentRequest: number) {
    if (!this.loans.length) {
      return;
    }

    this.loadingLoanIds = new Set(this.loans.map((loan: any) => loan.id.toString()));

    forkJoin(
      this.loans.map((loan: any) =>
        this.loansService.getLoanAccountAssociationDetails(loan.id).pipe(
          map((loanDetails: any) => ({
            ...loan,
            ...loanDetails
          })),
          catchError(() => of(loan))
        )
      )
    ).subscribe((loans: any[]) => {
      if (enrichmentRequest !== this.enrichmentRequest) {
        return;
      }
      this.loans = loans;
      this.dataSource.data = this.loans;
      this.loadingLoanIds.clear();
      if (this.sort) {
        this.dataSource.sort = this.sort;
      }
      this.updateFilterOptions();
    });
  }

  private getSortValue(loan: any, column: string): string | number {
    switch (column) {
      case 'loanId':
        return this.normalizeString(this.getLoanIdentifier(loan));
      case 'borrower':
        return this.normalizeString(this.getBorrowerName(loan));
      case 'status':
        return this.normalizeString(this.getLoanStatus(loan));
      case 'company':
        return this.normalizeString(this.getLoanCompany(loan));
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

  private loadOfficeOptions() {
    this.organizationService.getOffices().subscribe((officesData: any) => {
      const offices = officesData?.pageItems || officesData || [];
      this.officeOptions = this.getUniqueFilterOptions(
        offices.map((office: any) => ({
          value: this.normalizeOptionValue(office.id || office.officeId || office.name),
          label: office.name || office.displayName || office.officeName || office.id?.toString() || ''
        }))
      );
      this.officeNameById = new Map(
        this.officeOptions.map((office: LoanFilterOption) => [
          office.value,
          office.label
        ])
      );
      this.updateFilterOptions();
    });
  }

  private getAttributeDisplayValue(value: any): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (Array.isArray(value)) {
      return value.map((entry: any) => this.getAttributeDisplayValue(entry)).find((entry: string) => entry) || '';
    }

    if (typeof value === 'object') {
      return (
        value.displayName || value.name || value.officeName || value.label || value.value || value.id?.toString() || ''
      );
    }

    return value.toString();
  }

  private getAttributeFilterValue(value: any): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (Array.isArray(value)) {
      return value.map((entry: any) => this.getAttributeFilterValue(entry)).find((entry: string) => entry) || '';
    }

    if (typeof value === 'object') {
      return (
        value.id?.toString() ||
        value.officeId?.toString() ||
        value.value?.toString() ||
        value.name ||
        value.displayName ||
        value.officeName ||
        ''
      );
    }

    return value.toString();
  }

  private applyLoanFilters() {
    const filterRequest = ++this.filterRequest;
    if (!this.hasActiveFilters()) {
      this.clearGlobalLoanSearchResults();
      this.getLoans();
      return;
    }

    const limit = Math.max(this.totalRecords, this.pageSize);
    const loansRequest = this.allLoansLoaded
      ? of(this.allLoans)
      : this.loansService.getLoans(0, limit).pipe(map((loansData: any) => loansData?.pageItems || []));
    const globalSearchRequest = this.textFilterQuery.trim()
      ? this.searchService.getSearchResults(this.textFilterQuery, 'loans', true).pipe(catchError(() => of([])))
      : of([]);

    forkJoin([
      loansRequest,
      globalSearchRequest
    ]).subscribe(
      ([
        loans,
        searchResults
      ]: [
        any[],
        SearchData[]
      ]) => {
        if (filterRequest !== this.filterRequest) {
          return;
        }
        this.allLoans = loans;
        this.allLoansLoaded = true;
        this.setGlobalLoanSearchResults(searchResults);
        this.updateFilterOptions(this.allLoans);
        this.applyFilteredLoans();
      }
    );
  }

  private applyFilteredLoans() {
    const filteredLoans = this.allLoans.filter((loan: any) =>
      this.matchesLoanFilters(loan, {
        search: this.textFilter,
        status: this.statusFilter,
        company: this.companyFilter
      })
    );
    this.totalRecords = filteredLoans.length;
    this.loans = filteredLoans.slice(this.currentPage * this.pageSize, (this.currentPage + 1) * this.pageSize);
    this.dataSource.data = this.loans;
    if (this.sort) {
      this.dataSource.sort = this.sort;
    }
    this.enrichLoans(++this.enrichmentRequest);
  }

  private hasActiveFilters(): boolean {
    return Boolean(this.textFilter || this.statusFilter || this.companyFilter);
  }

  private matchesLoanFilters(loan: any, filters: any): boolean {
    const searchData = [
      this.getLoanIdentifier(loan),
      this.getBorrowerName(loan),
      this.getLoanStatus(loan),
      this.getLoanCompany(loan),
      this.getCurrentDueDate(loan),
      this.getBalanceNow(loan),
      this.getAmountNowDue(loan),
      this.getProjectedAccruedInterest(loan),
      this.getInterestRate(loan),
      this.getAmountLast(loan),
      this.getMaturityDate(loan),
      this.getDaysLate(loan)
    ];
    const matchesText =
      !filters.search || matchesFuzzySearch(searchData, filters.search) || this.matchesGlobalLoanSearchResult(loan);
    const matchesStatus = !filters.status || this.getLoanStatus(loan) === filters.status;
    const matchesCompany =
      !filters.company ||
      this.getLoanCompanyFilterValue(loan) === filters.company ||
      this.normalizeString(this.getLoanCompany(loan)) ===
        this.normalizeString(this.getCompanyOptionLabel(filters.company));
    return matchesText && matchesStatus && matchesCompany;
  }

  private updateFilterOptions(loans: any[] = this.allLoansLoaded ? this.allLoans : this.loans) {
    this.statusOptions = this.getUniqueOptions(loans.map((loan: any) => this.getLoanStatus(loan)));
    const loanCompanyOptions = this.getUniqueFilterOptions(
      loans.map((loan: any) => {
        const value = this.getLoanCompanyFilterValue(loan);
        return {
          value: value,
          label: this.getLoanCompany(loan) || this.getCompanyOptionLabel(value)
        };
      })
    );
    this.companyOptions = this.officeOptions.length ? this.officeOptions : loanCompanyOptions;
  }

  private getUniqueOptions(options: string[]): string[] {
    return Array.from(new Set(options.filter((option: string) => option))).sort((first: string, second: string) =>
      first.localeCompare(second)
    );
  }

  private getUniqueFilterOptions(options: LoanFilterOption[]): LoanFilterOption[] {
    const optionMap = new Map<string, LoanFilterOption>();
    options
      .filter((option: LoanFilterOption) => option.value && option.label)
      .forEach((option: LoanFilterOption) => {
        optionMap.set(option.value, option);
      });
    return Array.from(optionMap.values()).sort((first: LoanFilterOption, second: LoanFilterOption) =>
      first.label.localeCompare(second.label)
    );
  }

  private normalizeOptionValue(value: any): string {
    return value === undefined || value === null ? '' : value.toString();
  }

  private getCompanyOptionLabel(value: string): string {
    return this.companyOptions.find((option: LoanFilterOption) => option.value === value)?.label || '';
  }

  private setGlobalLoanSearchResults(searchResults: SearchData[]) {
    this.clearGlobalLoanSearchResults();

    (searchResults || []).forEach((result: SearchData) => {
      if ((result.entityType || '').toUpperCase() !== 'LOAN') {
        return;
      }

      this.addSearchKey(this.globalLoanSearchIds, result.entityId);
      this.addSearchKey(this.globalLoanSearchAccountNumbers, result.entityAccountNo);
      this.addSearchKey(this.globalLoanSearchExternalIds, result.entityExternalId);
    });
  }

  private clearGlobalLoanSearchResults() {
    this.globalLoanSearchIds.clear();
    this.globalLoanSearchAccountNumbers.clear();
    this.globalLoanSearchExternalIds.clear();
  }

  private matchesGlobalLoanSearchResult(loan: any): boolean {
    return (
      this.globalLoanSearchIds.has(this.normalizeSearchKey(loan.id)) ||
      this.globalLoanSearchAccountNumbers.has(this.normalizeSearchKey(loan.accountNo)) ||
      this.globalLoanSearchAccountNumbers.has(this.normalizeSearchKey(this.getLoanIdentifier(loan))) ||
      this.globalLoanSearchExternalIds.has(this.normalizeSearchKey(loan.externalId))
    );
  }

  private addSearchKey(searchKeys: Set<string>, value: any) {
    const searchKey = this.normalizeSearchKey(value);
    if (searchKey) {
      searchKeys.add(searchKey);
    }
  }

  private normalizeSearchKey(value: any): string {
    return value === undefined || value === null ? '' : value.toString().trim().toLowerCase();
  }

  private getOutstandingSchedulePeriods(loan: any): any[] {
    return (loan.repaymentSchedule?.periods || [])
      .filter((period: any) => period.dueDate && !period.complete && this.getPeriodOutstanding(period) > 0)
      .sort((firstPeriod: any, secondPeriod: any) => {
        return this.getDateSortValue(firstPeriod.dueDate) - this.getDateSortValue(secondPeriod.dueDate);
      });
  }

  private getOutstandingDueAmount(loan: any): number | undefined {
    const today = this.getToday();
    const total = this.getOutstandingSchedulePeriods(loan)
      .filter((period: any) => this.getDateSortValue(period.dueDate) <= today)
      .reduce((amountDue: number, period: any) => amountDue + this.getPeriodOutstanding(period), 0);
    return total || undefined;
  }

  private getPeriodOutstanding(period: any): number {
    if (period.totalOutstandingForPeriod !== undefined && period.totalOutstandingForPeriod !== null) {
      return period.totalOutstandingForPeriod;
    }

    const outstandingBreakdown =
      (period.principalOutstanding || 0) +
      (period.interestOutstanding || 0) +
      (period.feeChargesOutstanding || 0) +
      (period.penaltyChargesOutstanding || 0);

    return outstandingBreakdown || period.totalDueForPeriod || 0;
  }

  private getOutstandingPeriodTotal(loan: any, fields: string[]): number | undefined {
    const total = this.getOutstandingSchedulePeriods(loan).reduce((outstandingTotal: number, period: any) => {
      return (
        outstandingTotal +
        fields.reduce((fieldTotal: number, field: string) => {
          return fieldTotal + (period[field] || 0);
        }, 0)
      );
    }, 0);
    return total || undefined;
  }

  private getLastPaymentTransaction(loan: any): any {
    return (loan.transactions || [])
      .filter((transaction: any) => {
        const transactionType = transaction.type?.value || '';
        return (
          !transaction.manuallyReversed &&
          !transaction.reversed &&
          (transaction.type?.repayment || /repayment|payment|refund/i.test(transactionType))
        );
      })
      .sort((firstTransaction: any, secondTransaction: any) => {
        return (
          this.getDateSortValue(secondTransaction.date) - this.getDateSortValue(firstTransaction.date) ||
          (secondTransaction.id || 0) - (firstTransaction.id || 0)
        );
      })[0];
  }

  private getToday(): number {
    return this.getDateSortValue(this.settingsService.businessDate || new Date());
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
