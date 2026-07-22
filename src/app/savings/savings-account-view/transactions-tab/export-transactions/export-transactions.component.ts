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
import { FormBuilder, Validators } from '@angular/forms';
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
import { exportTableToXlsx, printTable, TableCell } from 'app/core/utils/table-export.utils';
import {
  SavingsAccountTransaction,
  SavingsAccountTransactionType
} from 'app/savings/models/savings-account-transaction.model';
import { Currency } from 'app/shared/models/general.model';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';

/**
 * Export Client Savings Transactions Component
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
    MatRow
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExportTransactionsComponent implements OnInit {
  private formBuilder = inject(FormBuilder);
  private dateUtils = inject(Dates);
  private route = inject(ActivatedRoute);
  private settingsService = inject(SettingsService);
  private translateService = inject(TranslateService);
  private dateFormatPipe = inject(DateFormatPipe);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  /** Minimum date allowed. */
  minDate = new Date(2000, 0, 1);
  /** Maximum date allowed. */
  maxDate = new Date();
  /** Transactions Report Form */
  transactionsReportForm: any;
  /** Savings Account Id */
  savingsAccountId: any;
  /** Savings account currency, used for on-screen formatting. */
  currency: Currency | null = null;
  /** Full, unfiltered transaction history for this savings account. */
  allTransactions: SavingsAccountTransaction[] = [];
  /** Transactions within the selected date range. */
  filteredTransactions: SavingsAccountTransaction[] = [];
  /** Whether a date range has been submitted. */
  hasGenerated = false;

  /** Columns shown in the transactions table. */
  displayedColumns: string[] = [
    'row',
    'id',
    'date',
    'externalId',
    'transactionType',
    'debit',
    'credit',
    'balance'
  ];

  /**
   * Fetches savings account data from grandparent's `resolve`
   */
  constructor() {
    this.route.parent.parent.data
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data: { savingsAccountData: any }) => {
        this.savingsAccountId = data.savingsAccountData.id;
        this.currency = data.savingsAccountData.currency || null;
        this.allTransactions = data.savingsAccountData.transactions || [];
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
        '',
        Validators.required
      ],
      toDate: [
        '',
        Validators.required
      ]
    });
  }

  /**
   * Filters the savings account's transaction history to the selected date range.
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

  isReversed(transaction: SavingsAccountTransaction): boolean {
    return !!transaction.reversed;
  }

  isDebit(transactionType: SavingsAccountTransactionType): boolean {
    return (
      transactionType.withdrawal === true ||
      transactionType.feeDeduction === true ||
      transactionType.overdraftInterest === true ||
      transactionType.withholdTax === true
    );
  }

  transactionTypeLabel(transaction: SavingsAccountTransaction): string {
    return this.translateService.instant('labels.catalogs.' + transaction.transactionType.value);
  }

  private columnHeaders(): string[] {
    return [
      '#',
      this.translateService.instant('labels.inputs.Id'),
      this.translateService.instant('labels.inputs.Transaction Date'),
      this.translateService.instant('labels.inputs.External Id'),
      this.translateService.instant('labels.inputs.Transaction Type'),
      this.translateService.instant('labels.inputs.Debit'),
      this.translateService.instant('labels.inputs.Credit'),
      this.translateService.instant('labels.inputs.Balance')
    ];
  }

  private buildExportRows(): TableCell[][] {
    return this.filteredTransactions.map((transaction, index) => {
      const debit = this.isDebit(transaction.transactionType);
      return [
        index + 1,
        transaction.id,
        this.dateFormatPipe.transform(transaction.date),
        transaction.externalId ?? '',
        this.transactionTypeLabel(transaction),
        debit ? transaction.amount : null,
        !debit ? transaction.amount : null,
        transaction.runningBalance
      ];
    });
  }

  private exportFileName(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `Savings_${this.savingsAccountId}_Transactions_${stamp}.xlsx`;
  }

  async exportToXlsx(): Promise<void> {
    const reversedRows = this.filteredTransactions.map((transaction) => this.isReversed(transaction));
    await exportTableToXlsx(this.exportFileName(), this.columnHeaders(), this.buildExportRows(), reversedRows);
    this.cdr.detectChanges();
  }

  printTransactions(): void {
    const reversedRows = this.filteredTransactions.map((transaction) => this.isReversed(transaction));
    printTable(
      `Savings ${this.savingsAccountId} Transactions`,
      this.columnHeaders(),
      this.buildExportRows(),
      reversedRows
    );
  }
}
