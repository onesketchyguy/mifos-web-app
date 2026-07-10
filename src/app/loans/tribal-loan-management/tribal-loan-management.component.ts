/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, DestroyRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';

/** rxjs Imports */
import { bufferTime, filter } from 'rxjs/operators';

/** Angular Material Imports */
import { MatDialog } from '@angular/material/dialog';
import { MatCard, MatCardActions, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import {
  MatColumnDef,
  MatHeaderCellDef,
  MatHeaderCell,
  MatCellDef,
  MatCell,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import { MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatIcon } from '@angular/material/icon';

/** Custom Services */
import { OrganizationService } from 'app/organization/organization.service';
import { SettingsService } from 'app/settings/settings.service';
import {
  TribalLoanData,
  TribalLoanPaymentsService,
  TribalLoanPaymentSubmissionResult,
  TribalPaymentSource
} from '../services/tribal-loan-payments.service';

/** Custom Imports */
import { FormatNumberPipe } from 'app/pipes/format-number.pipe';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { SelectLoanDialogComponent, SelectLoanDialogResult } from '../select-loan-dialog/select-loan-dialog.component';
import { ReportExcelExportService } from 'app/reports/report-excel-export.service';

/**
 * Tribal loan management component.
 * User picks a source, clicks Load, and loans stream in as datatables resolve.
 * Amounts can be edited inline, loans added via dialog, and the resulting
 * payments posted as repayment transactions directly from this screen.
 */
@Component({
  selector: 'mifosx-tribal-loan-management',
  templateUrl: './tribal-loan-management.component.html',
  styleUrls: ['./tribal-loan-management.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    CdkTextareaAutosize,
    FormatNumberPipe,
    MatCard,
    MatCardActions,
    MatCardContent,
    MatCardHeader,
    MatCardTitle,
    MatCell,
    MatCellDef,
    MatColumnDef,
    MatHeaderCell,
    MatHeaderCellDef,
    MatHeaderRow,
    MatHeaderRowDef,
    MatIcon,
    MatProgressBar,
    MatRow,
    MatRowDef,
    MatSortModule,
    MatTable
  ]
})
export class TribalLoanManagementComponent implements OnInit {
  private readonly tribalLoanPaymentsService = inject(TribalLoanPaymentsService);
  private readonly reportExportService = inject(ReportExcelExportService);
  private readonly organizationService = inject(OrganizationService);
  private readonly settingsService = inject(SettingsService);
  private readonly fb = inject(UntypedFormBuilder);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  /** How often streamed loans are flushed to the table while loading. */
  private readonly streamRenderIntervalMs = 250;

  sourceForm: UntypedFormGroup = this.fb.group({
    paymentSource: [
      null,
      Validators.required
    ],
    statusFilter: ['active']
  });

  /** Minimum transaction date. */
  minDate = new Date(2000, 0, 1);
  /** Maximum transaction date. */
  maxDate = this.settingsService.businessDate;

  /** Posting form — transaction details plus the validation gate for submitting. */
  paymentForm: UntypedFormGroup = this.fb.group({
    transactionDate: [
      this.settingsService.businessDate,
      Validators.required
    ],
    paymentTypeId: [''],
    note: [''],
    validated: [
      false,
      Validators.requiredTrue
    ]
  });

  isLoading = false;
  dataLoaded = false;
  loadError: string | null = null;
  /** Whether the loans table is collapsed. Collapsed by default so the posting card stays reachable. */
  isTableCollapsed = true;

  /** Payment types for repayment transaction payloads. */
  paymentTypes: any[] = [];
  /** Submitted payment results. */
  submissionResults: TribalLoanPaymentSubmissionResult[] = [];
  /** Loading flag for the submit action. */
  isSubmittingPayments = false;
  /** Loading flag for the submission report export. */
  isExportingSubmissionReport = false;
  /** Submission error. */
  submitError: string | null = null;

  private allTribalLoanData: TribalLoanData[] = [];
  /** loanId → allTribalLoanData index, for upserting streamed rows (cached rows re-emit verified). */
  private tribalLoanIndexById = new Map<string, number>();
  private percapLoans: TribalLoanData[] = [];
  private pensionLoans: TribalLoanData[] = [];
  private payrollLoans: TribalLoanData[] = [];

  readonly dataSource = new MatTableDataSource<TribalLoanData>([]);
  readonly searchControl = new FormControl('');
  readonly displayColumns = [
    'loanId',
    'borrowerName',
    'status',
    'amount',
    'balanceNow'
  ];
  /** Columns displayed for submission results. */
  readonly submissionDisplayColumns = [
    'loanId',
    'borrowerName',
    'transactionAmount',
    'result',
    'transactionId',
    'errorMessage'
  ];

  /** Wire sort to datasource whenever the table renders (it's inside an @if). */
  @ViewChild(MatSort) set matSort(sort: MatSort) {
    if (sort) {
      this.dataSource.sort = sort;
    }
  }

  constructor() {
    this.dataSource.sortingDataAccessor = (loan: TribalLoanData, column: string): string | number => {
      switch (column) {
        case 'amount':
          return loan[this.selectedSource!] ?? 0;
        case 'balanceNow':
          return loan.balanceNow ?? 0;
        default:
          return (loan as any)[column] ?? '';
      }
    };

    this.dataSource.filterPredicate = (loan: TribalLoanData, filterTerm: string): boolean => {
      if (!filterTerm) {
        return true;
      }
      return loan.borrowerName.toLowerCase().includes(filterTerm) || loan.accountNo.toLowerCase().includes(filterTerm);
    };

    this.searchControl.valueChanges.subscribe((term: string | null) => {
      this.dataSource.filter = (term || '').trim().toLowerCase();
      // Searching implies wanting to see the matching rows.
      if (this.dataSource.filter) {
        this.isTableCollapsed = false;
      }
    });

    // Instant source/status switching — no new API call needed since data is cached.
    this.sourceForm.get('paymentSource')?.valueChanges.subscribe(() => {
      this.submissionResults = [];
      this.resetValidation();
      if (this.dataLoaded) {
        this.updateDataSource();
      }
    });
    this.sourceForm.get('statusFilter')?.valueChanges.subscribe(() => {
      if (this.dataLoaded) {
        this.rebuildFilteredLists();
      }
    });
  }

  ngOnInit(): void {
    this.loadPaymentTypes();
    [
      'transactionDate',
      'paymentTypeId',
      'note'
    ].forEach((controlName: string) => {
      this.paymentForm.controls[controlName].valueChanges.subscribe(() => this.resetValidation());
    });
  }

  // Read the controls directly: the form group's aggregate .value is not yet
  // recalculated when a child control's valueChanges fires, so reading
  // sourceForm.value here lags one change behind inside those handlers.
  get selectedSource(): TribalPaymentSource | null {
    return this.sourceForm.get('paymentSource')?.value || null;
  }

  get statusFilter(): 'active' | 'inactive' | 'both' {
    return this.sourceForm.get('statusFilter')?.value || 'active';
  }

  private loanMatchesStatusFilter(loan: TribalLoanData): boolean {
    if (this.statusFilter === 'both') {
      return true;
    }
    return this.statusFilter === 'active' ? loan.isActive : !loan.isActive;
  }

  get currentLoans(): TribalLoanData[] {
    switch (this.selectedSource) {
      case 'percap':
        return this.percapLoans;
      case 'pension':
        return this.pensionLoans;
      case 'payroll':
        return this.payrollLoans;
      default:
        return [];
    }
  }

  get currentTotal(): number {
    const source = this.selectedSource;
    if (!source) {
      return 0;
    }
    return this.currentLoans.reduce((sum: number, loan: TribalLoanData) => sum + (loan[source] ?? 0), 0);
  }

  get canLoad(): boolean {
    return this.sourceForm.valid && !this.isLoading;
  }

  loadData(): void {
    if (!this.canLoad) {
      return;
    }

    this.isLoading = true;
    this.loadError = null;
    this.dataLoaded = true; // show table skeleton + summary immediately
    this.allTribalLoanData = [];
    this.tribalLoanIndexById.clear();
    this.percapLoans = [];
    this.pensionLoans = [];
    this.payrollLoans = [];
    this.dataSource.data = [];
    this.searchControl.setValue('', { emitEvent: false });
    this.dataSource.filter = '';
    this.submissionResults = [];
    this.submitError = null;
    this.resetValidation();

    // Buffer streamed loans and render in batches: assigning dataSource.data per
    // loan re-renders the whole table each time, which made large loads crawl.
    // Cached rows arrive in the first batch (flagged fromCache), then live data
    // re-emits each loan; upserting by loanId replaces them with verified rows.
    this.tribalLoanPaymentsService
      .streamTribalLoanData()
      .pipe(
        bufferTime(this.streamRenderIntervalMs),
        filter((loans: TribalLoanData[]) => loans.length > 0),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (loans: TribalLoanData[]) => {
          for (const loan of loans) {
            this.upsertTribalLoanData(loan);
          }
          this.rebuildFilteredLists();
        },
        error: (err: any) => {
          this.loadError = err?.message || 'Failed to load tribal loan data.';
          this.dropUnverifiedCachedLoans();
          this.isLoading = false;
        },
        complete: () => {
          this.dropUnverifiedCachedLoans();
          this.isLoading = false;
        }
      });
  }

  /** Adds or replaces a streamed loan in the full list, keyed by loanId. */
  private upsertTribalLoanData(loan: TribalLoanData): void {
    const existingIndex = this.tribalLoanIndexById.get(loan.loanId);
    if (existingIndex === undefined) {
      this.tribalLoanIndexById.set(loan.loanId, this.allTribalLoanData.length);
      this.allTribalLoanData.push(loan);
    } else {
      this.allTribalLoanData[existingIndex] = loan;
    }
  }

  /**
   * Removes cached rows the live data never confirmed (their loans no longer
   * exist or lost their tribal data), so stale amounts cannot be posted.
   */
  private dropUnverifiedCachedLoans(): void {
    if (!this.allTribalLoanData.some((loan: TribalLoanData) => loan.fromCache)) {
      return;
    }
    this.allTribalLoanData = this.allTribalLoanData.filter((loan: TribalLoanData) => !loan.fromCache);
    this.tribalLoanIndexById.clear();
    this.allTribalLoanData.forEach((loan: TribalLoanData, index: number) => {
      this.tribalLoanIndexById.set(loan.loanId, index);
    });
    this.rebuildFilteredLists();
  }

  /** Whether any displayed rows are still cached and awaiting verification. */
  get hasUnverifiedRows(): boolean {
    return this.isLoading && this.allTribalLoanData.some((loan: TribalLoanData) => loan.fromCache);
  }

  /** Adds a loan to the per-source lists. */
  private addLoanToFilteredLists(loan: TribalLoanData): void {
    if (!this.loanMatchesStatusFilter(loan)) {
      return;
    }

    if (loan.percap !== null && loan.percap > 0) {
      this.percapLoans.push(loan);
    }
    if (loan.pension !== null && loan.pension > 0) {
      this.pensionLoans.push(loan);
    }
    if (loan.payroll !== null && loan.payroll > 0) {
      this.payrollLoans.push(loan);
    }
  }

  private rebuildFilteredLists(): void {
    this.percapLoans = [];
    this.pensionLoans = [];
    this.payrollLoans = [];
    for (const loan of this.allTribalLoanData) {
      this.addLoanToFilteredLists(loan);
    }
    this.updateDataSource();
  }

  private updateDataSource(): void {
    this.dataSource.data = [...this.currentLoans];
  }

  toggleTable(): void {
    this.isTableCollapsed = !this.isTableCollapsed;
  }

  onAmountChange(loan: TribalLoanData, event: Event): void {
    const source = this.selectedSource!;
    const input = event.target as HTMLInputElement;
    const value = Number.parseFloat(input.value);
    const newAmount = Number.isFinite(value) && value >= 0 ? value : 0;

    loan[source] = newAmount;
    this.resetValidation();

    this.tribalLoanPaymentsService.updateTribalLoanField(loan, { [source]: newAmount }).subscribe({
      error: (err: any) => console.error('[TribalLoanManagement] Failed to save field:', err)
    });

    if (newAmount === 0) {
      this.removeFromCurrentList(loan);
    }
  }

  private removeFromCurrentList(loan: TribalLoanData): void {
    const source = this.selectedSource;
    if (source === 'percap') {
      this.percapLoans = this.percapLoans.filter((l: TribalLoanData) => l.loanId !== loan.loanId);
    } else if (source === 'pension') {
      this.pensionLoans = this.pensionLoans.filter((l: TribalLoanData) => l.loanId !== loan.loanId);
    } else if (source === 'payroll') {
      this.payrollLoans = this.payrollLoans.filter((l: TribalLoanData) => l.loanId !== loan.loanId);
    }
    this.updateDataSource();
  }

  openAddLoanDialog(): void {
    const source = this.selectedSource!;
    const dialogRef = this.dialog.open(SelectLoanDialogComponent, {
      width: '480px',
      data: { loans: this.allTribalLoanData, selectedSource: source }
    });

    dialogRef.afterClosed().subscribe((result: SelectLoanDialogResult | undefined) => {
      if (!result?.loan || !(result.amount > 0)) {
        return;
      }

      const loan = result.loan;
      loan[source] = result.amount;
      this.resetValidation();

      this.tribalLoanPaymentsService.updateTribalLoanField(loan, { [source]: result.amount }).subscribe({
        error: (err: any) => console.error('[TribalLoanManagement] Failed to save field:', err)
      });

      const alreadyInList = this.currentLoans.some((l: TribalLoanData) => l.loanId === loan.loanId);
      if (!alreadyInList) {
        if (source === 'percap') {
          this.percapLoans = [
            ...this.percapLoans,
            loan
          ];
        } else if (source === 'pension') {
          this.pensionLoans = [
            ...this.pensionLoans,
            loan
          ];
        } else {
          this.payrollLoans = [
            ...this.payrollLoans,
            loan
          ];
        }
        this.updateDataSource();
      }
    });
  }

  /**
   * Loads available payment types for the posting form.
   */
  private loadPaymentTypes(): void {
    this.organizationService.getPaymentTypes().subscribe({
      next: (paymentTypes: any) => {
        const rows: any[] = Array.isArray(paymentTypes) ? paymentTypes : paymentTypes?.pageItems || [];
        this.paymentTypes = rows
          .filter((paymentType: any) => paymentType.isActive !== false && paymentType.active !== false)
          .sort(
            (first: any, second: any) =>
              (first.position ?? Number.MAX_SAFE_INTEGER) - (second.position ?? Number.MAX_SAFE_INTEGER)
          );
      },
      error: () => {
        this.paymentTypes = [];
      }
    });
  }

  /** Active loans with a positive amount for the selected source — what Post Payments will submit. */
  get postableLoans(): TribalLoanData[] {
    const source = this.selectedSource;
    if (!source) {
      return [];
    }
    return this.allTribalLoanData.filter((loan: TribalLoanData) => loan.isActive && (loan[source] ?? 0) > 0);
  }

  get postableTotal(): number {
    const source = this.selectedSource;
    if (!source) {
      return 0;
    }
    return this.postableLoans.reduce((sum: number, loan: TribalLoanData) => sum + (loan[source] ?? 0), 0);
  }

  get canPostPayments(): boolean {
    return (
      this.dataLoaded &&
      !this.isLoading &&
      !this.isSubmittingPayments &&
      this.postableLoans.length > 0 &&
      this.paymentForm.valid
    );
  }

  /**
   * Posts a repayment transaction for every active loan with a positive
   * amount for the selected source.
   */
  postPayments(): void {
    if (!this.canPostPayments) {
      return;
    }

    const source = this.selectedSource!;
    const payments = this.tribalLoanPaymentsService.createPayments(this.allTribalLoanData, source);

    this.submissionResults = [];
    this.submitError = null;
    this.isSubmittingPayments = true;

    this.tribalLoanPaymentsService
      .submitPayments(payments, {
        transactionDate: this.paymentForm.value.transactionDate,
        paymentTypeId: this.paymentForm.value.paymentTypeId,
        note: this.paymentForm.value.note
      })
      .subscribe({
        next: (results: TribalLoanPaymentSubmissionResult[]) => {
          this.submissionResults = results;
          this.isSubmittingPayments = false;
          this.resetValidation();
        },
        error: (error: any) => {
          this.submitError = this.getErrorMessage(error);
          this.isSubmittingPayments = false;
        }
      });
  }

  get successfulSubmissionResults(): TribalLoanPaymentSubmissionResult[] {
    return this.submissionResults.filter((result: TribalLoanPaymentSubmissionResult) => result.success);
  }

  get failedSubmissionResults(): TribalLoanPaymentSubmissionResult[] {
    return this.submissionResults.filter((result: TribalLoanPaymentSubmissionResult) => !result.success);
  }

  get submittedPaymentTotal(): number {
    return this.successfulSubmissionResults.reduce(
      (total: number, result: TribalLoanPaymentSubmissionResult) => total + result.payment.transactionAmount,
      0
    );
  }

  private get selectedSourceLabel(): string {
    const source = this.selectedSource || 'percap';
    return source.charAt(0).toUpperCase() + source.slice(1);
  }

  async exportReport(): Promise<void> {
    const source = this.selectedSource!;
    const sourceLabel = this.selectedSourceLabel;

    const columns = [
      'Account No',
      'Borrower Name',
      'Status',
      'Balance Now',
      `${sourceLabel} Amount`,
      'Refund Amount',
      'Pays Off'
    ];
    const columnTypes = [
      '',
      '',
      '',
      'DECIMAL',
      'DECIMAL',
      'DECIMAL',
      ''
    ];

    const sort = this.dataSource.sort;
    const orderedLoans = sort ? this.dataSource.sortData(this.dataSource.filteredData, sort) : this.currentLoans;

    const reportData = orderedLoans.map((loan: TribalLoanData) => {
      const payment = loan[source] ?? 0;
      const balance = loan.balanceNow ?? 0;
      const refund = Math.max(0, payment - balance);
      return {
        row: [
          loan.accountNo,
          loan.borrowerName,
          loan.status,
          balance,
          payment,
          refund,
          payment >= balance ? 'Yes' : 'No'
        ]
      };
    });

    const reportName = `Tribal ${sourceLabel} Report ${new Date().toISOString().slice(0, 10)}`;
    await this.reportExportService.exportTableReport(reportName, reportData, columns, { columnTypes });
  }

  async exportSubmissionReport(): Promise<void> {
    if (!this.submissionResults.length || this.isExportingSubmissionReport) {
      return;
    }

    const columns = [
      'Account No',
      'Borrower Name',
      'Amount',
      'Result',
      'Transaction Id',
      'Error',
      'Transaction Date',
      'Payment Type',
      'Note'
    ];
    const columnTypes = [
      '',
      '',
      'DECIMAL',
      '',
      '',
      '',
      '',
      '',
      ''
    ];

    const transactionDate = this.getTransactionDateForExport();
    const paymentTypeName = this.getSelectedPaymentTypeName();
    const note = this.paymentForm.value.note || '';

    const reportData = this.submissionResults.map((result: TribalLoanPaymentSubmissionResult) => ({
      row: [
        result.payment.accountNo || result.payment.externalId || result.payment.loanId,
        result.payment.borrowerName,
        result.payment.transactionAmount,
        result.success ? 'Successful' : 'Failed',
        result.transactionId || '',
        result.errorMessage || '',
        transactionDate,
        paymentTypeName,
        note
      ]
    }));

    const reportName = `Tribal ${this.selectedSourceLabel} Submission Report ${new Date().toISOString().slice(0, 10)}`;
    this.isExportingSubmissionReport = true;
    try {
      await this.reportExportService.exportTableReport(reportName, reportData, columns, { columnTypes });
    } finally {
      this.isExportingSubmissionReport = false;
    }
  }

  getResultIdentifier(result: TribalLoanPaymentSubmissionResult): string {
    return result.payment.accountNo || result.payment.externalId || result.payment.loanId;
  }

  private getSelectedPaymentTypeName(): string {
    const paymentTypeId = this.paymentForm.value.paymentTypeId;
    if (paymentTypeId === undefined || paymentTypeId === null || paymentTypeId === '') {
      return 'None';
    }
    const paymentType = this.paymentTypes.find((entry: any) => `${entry.id}` === `${paymentTypeId}`);
    return paymentType?.name || 'None';
  }

  private getTransactionDateForExport(): string {
    const transactionDate = this.paymentForm.value.transactionDate;
    if (transactionDate instanceof Date) {
      return transactionDate.toISOString().substring(0, 10);
    }
    return transactionDate || '';
  }

  private resetValidation(): void {
    if (this.paymentForm.controls.validated.value) {
      this.paymentForm.controls.validated.setValue(false, { emitEvent: false });
    }
  }

  private getErrorMessage(error: any): string {
    return error?.error?.defaultUserMessage || error?.error?.message || error?.message || 'Unable to submit payments.';
  }

  cancel(): void {
    this.router.navigate(['/accounting']);
  }
}
