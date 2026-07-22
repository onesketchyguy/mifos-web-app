/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  MatTable,
  MatColumnDef,
  MatCellDef,
  MatCell,
  MatHeaderCellDef,
  MatHeaderCell,
  MatHeaderRowDef,
  MatHeaderRow,
  MatRowDef,
  MatRow
} from '@angular/material/table';
import { TranslateService } from '@ngx-translate/core';

/** Custom Services */
import { Dates } from 'app/core/utils/dates';
import { SettingsService } from 'app/settings/settings.service';
import { DateFormatPipe } from 'app/pipes/date-format.pipe';
import { FormatNumberPipe } from 'app/pipes/format-number.pipe';
import { exportTableToXlsx, printTable, TableCell } from 'app/core/utils/table-export.utils';
import { LoanTransaction } from 'app/products/loan-products/models/loan-account.model';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';

/**
 * Export Client Loans Transactions Component
 */
@Component({
  selector: 'mifosx-export-transactions',
  templateUrl: './export-transactions.component.html',
  styleUrls: ['./export-transactions.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    FaIconComponent,
    MatTable,
    MatColumnDef,
    MatCellDef,
    MatCell,
    MatHeaderCellDef,
    MatHeaderCell,
    MatHeaderRowDef,
    MatHeaderRow,
    MatRowDef,
    MatRow,
    FormatNumberPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExportTransactionsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private formBuilder = inject(UntypedFormBuilder);
  private dateUtils = inject(Dates);
  private route = inject(ActivatedRoute);
  private settingsService = inject(SettingsService);
  private translateService = inject(TranslateService);
  private dateFormatPipe = inject(DateFormatPipe);
  private cdr = inject(ChangeDetectorRef);

  /** Minimum date allowed. */
  minDate = new Date(2000, 0, 1);
  /** Maximum date allowed. */
  maxDate = new Date();
  /** Transactions Report Form */
  transactionsReportForm: any;
  /** Loans Account Id */
  loansAccountId: any;
  /** Loan origination date, used as the default `From Date`. */
  loanOriginationDate: Date;
  /** Full, unfiltered transaction history for this loan. */
  allTransactions: LoanTransaction[] = [];
  /** Transactions within the selected date range. */
  filteredTransactions: LoanTransaction[] = [];
  /** Whether a date range has been submitted. */
  hasGenerated = false;

  /** Columns shown in the transactions table. */
  displayedColumns: string[] = [
    'row',
    'id',
    'externalId',
    'date',
    'transactionType',
    'amount',
    'principal',
    'interest',
    'fee',
    'penalties',
    'loanBalance'
  ];

  /**
   * Fetches loans account data from grandparent's `resolve`
   */
  constructor() {
    this.route.parent.parent.data
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data: { loanDetailsData: any }) => {
        this.loansAccountId = data.loanDetailsData.id;
        this.allTransactions = data.loanDetailsData.transactions || [];
        const originationDate =
          data.loanDetailsData.timeline?.actualDisbursementDate || data.loanDetailsData.timeline?.submittedOnDate;
        if (originationDate) {
          this.loanOriginationDate = this.dateUtils.parseDate(originationDate);
        }
      });
  }

  ngOnInit() {
    this.maxDate = this.settingsService.businessDate;
    this.createTransactionsReportForm();
  }

  /**
   * Creates the transactions report form.
   */
  createTransactionsReportForm() {
    this.transactionsReportForm = this.formBuilder.group({
      fromDate: [
        this.loanOriginationDate || '',
        Validators.required
      ],
      toDate: [
        this.settingsService.businessDate,
        Validators.required
      ]
    });
  }

  /**
   * Filters the loan's transaction history to the selected date range.
   */
  generate(): void {
    if (!this.transactionsReportForm.valid) {
      return;
    }
    const fromDate: Date = this.transactionsReportForm.value.fromDate;
    const toDate: Date = this.transactionsReportForm.value.toDate;
    this.filteredTransactions = this.allTransactions
      .filter((transaction) => {
        const transactionDate = this.dateUtils.parseDate(transaction.date);
        return !this.dateUtils.isBefore(transactionDate, fromDate) && !this.dateUtils.isAfter(transactionDate, toDate);
      })
      .sort((a, b) => this.dateUtils.parseDate(a.date).getTime() - this.dateUtils.parseDate(b.date).getTime());
    this.hasGenerated = true;
    this.cdr.markForCheck();
  }

  isReversed(transaction: LoanTransaction): boolean {
    return !!(transaction.manuallyReversed || transaction.reversed);
  }

  transactionTypeLabel(transaction: LoanTransaction): string {
    if (transaction.type.repayment && transaction.paymentDetailData?.paymentType?.name) {
      return transaction.paymentDetailData.paymentType.name;
    }
    return this.translateService.instant('labels.catalogs.' + transaction.type.value);
  }

  private columnHeaders(): string[] {
    return [
      '#',
      this.translateService.instant('labels.inputs.Id'),
      this.translateService.instant('labels.inputs.External Id'),
      this.translateService.instant('labels.inputs.Transaction Date'),
      this.translateService.instant('labels.inputs.Transaction Type'),
      this.translateService.instant('labels.inputs.Amount'),
      this.translateService.instant('labels.inputs.Principal'),
      this.translateService.instant('labels.inputs.Interest'),
      this.translateService.instant('labels.inputs.Fees'),
      this.translateService.instant('labels.inputs.Penalties'),
      this.translateService.instant('labels.inputs.Loan Balance')
    ];
  }

  private buildExportRows(): TableCell[][] {
    return this.filteredTransactions.map((transaction, index) => [
      index + 1,
      transaction.id,
      transaction.externalId ?? '',
      this.dateFormatPipe.transform(transaction.date),
      this.transactionTypeLabel(transaction),
      transaction.amount,
      transaction.principalPortion,
      transaction.interestPortion,
      transaction.feeChargesPortion,
      transaction.penaltyChargesPortion,
      transaction.outstandingLoanBalance
    ]);
  }

  private exportFileName(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `Loan_${this.loansAccountId}_Transactions_${stamp}.xlsx`;
  }

  async exportToXlsx(): Promise<void> {
    const reversedRows = this.filteredTransactions.map((transaction) => this.isReversed(transaction));
    await exportTableToXlsx(this.exportFileName(), this.columnHeaders(), this.buildExportRows(), reversedRows);
    this.cdr.detectChanges();
  }

  printTransactions(): void {
    const reversedRows = this.filteredTransactions.map((transaction) => this.isReversed(transaction));
    printTable(`Loan ${this.loansAccountId} Transactions`, this.columnHeaders(), this.buildExportRows(), reversedRows);
  }
}
