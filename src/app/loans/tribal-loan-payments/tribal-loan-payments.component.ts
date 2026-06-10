/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { Component, OnInit, inject } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import type * as ExcelJS from 'exceljs';

/** Angular Material Imports */
import { MatCard, MatCardActions, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import { MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatTable } from '@angular/material/table';
import { MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';

/** Custom Services */
import { OrganizationService } from 'app/organization/organization.service';
import { SettingsService } from 'app/settings/settings.service';
import {
  TribalLoanData,
  TribalLoanPayment,
  TribalLoanPaymentPreview,
  TribalLoanPaymentsService,
  TribalLoanPaymentSubmissionResult,
  TribalPaymentSource
} from '../services/tribal-loan-payments.service';

/** Custom Imports */
import { FormatNumberPipe } from 'app/pipes/format-number.pipe';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';

type ExcelColumnType = 'text' | 'number' | 'integer';

interface ExcelReportTable {
  worksheetName: string;
  tableName: string;
  columns: string[];
  rows: any[][];
  columnTypes?: ExcelColumnType[];
}

/**
 * Tribal loan payments component.
 */
@Component({
  selector: 'mifosx-tribal-loan-payments',
  templateUrl: './tribal-loan-payments.component.html',
  styleUrls: ['./tribal-loan-payments.component.scss'],
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
    MatDivider,
    MatHeaderCell,
    MatHeaderCellDef,
    MatHeaderRow,
    MatHeaderRowDef,
    MatIcon,
    MatProgressBar,
    MatRow,
    MatRowDef,
    MatTable
  ]
})
export class TribalLoanPaymentsComponent implements OnInit {
  private formBuilder = inject(UntypedFormBuilder);
  private organizationService = inject(OrganizationService);
  private router = inject(Router);
  private settingsService = inject(SettingsService);
  private tribalLoanPaymentsService = inject(TribalLoanPaymentsService);

  /** Minimum transaction date. */
  minDate = new Date(2000, 0, 1);
  /** Maximum transaction date. */
  maxDate = this.settingsService.businessDate;
  /** Tribal payment form. */
  tribalPaymentForm: UntypedFormGroup = this.formBuilder.group({
    paymentSource: [
      'percap',
      Validators.required
    ],
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
  /** Payment types for repayment transaction payloads. */
  paymentTypes: any[] = [];
  /** Generated payment preview. */
  preview: TribalLoanPaymentPreview | null = null;
  /** Submitted payment results. */
  submissionResults: TribalLoanPaymentSubmissionResult[] = [];
  /** Loading flag for the preview. */
  isLoadingPreview = false;
  /** Loading flag for the submit action. */
  isSubmittingPayments = false;
  /** Loading flag for the preview export. */
  isExportingPreview = false;
  /** Loading flag for the submission report export. */
  isExportingSubmissionReport = false;
  /** Whether the preview export was triggered. */
  previewExportComplete = false;
  /** Whether the submission report export was triggered. */
  submissionReportExportComplete = false;
  /** Preview loading error. */
  previewError = '';

  /** Columns displayed for the payment preview. */
  previewDisplayedColumns: string[] = [
    'loanId',
    'borrowerName',
    'status',
    'percap',
    'pension',
    'payroll',
    'transactionAmount',
    'balanceNow',
    'transactionDate'
  ];
  /** Columns displayed for skipped loan details. */
  skippedDisplayedColumns: string[] = [
    'loanId',
    'borrowerName',
    'status',
    'percap',
    'pension',
    'payroll',
    'reason'
  ];
  /** Columns displayed for submission results. */
  submissionDisplayedColumns: string[] = [
    'loanId',
    'borrowerName',
    'transactionAmount',
    'status',
    'transactionId',
    'errorMessage'
  ];

  /**
   * Initializes payment type data and preview validation reset behavior.
   */
  ngOnInit(): void {
    this.loadPaymentTypes();
    this.tribalPaymentForm.controls.paymentSource.valueChanges.subscribe(() => {
      this.preview = null;
      this.submissionResults = [];
      this.resetValidation();
    });
    [
      'transactionDate',
      'paymentTypeId',
      'note'
    ].forEach((controlName: string) => {
      this.tribalPaymentForm.controls[controlName].valueChanges.subscribe(() => this.resetValidation());
    });
  }

  /**
   * Loads available payment types.
   */
  loadPaymentTypes(): void {
    this.organizationService.getPaymentTypes().subscribe({
      next: (paymentTypesResponse: any) => {
        this.paymentTypes = this.normalizePaymentTypes(paymentTypesResponse);
      },
      error: () => {
        this.paymentTypes = [];
      }
    });
  }

  /**
   * Generates the Tribal loan payment preview.
   */
  generatePreview(): void {
    if (!this.canGeneratePreview || this.isLoadingPreview) {
      return;
    }

    this.preview = null;
    this.submissionResults = [];
    this.previewError = '';
    this.previewExportComplete = false;
    this.submissionReportExportComplete = false;
    this.resetValidation();
    this.isLoadingPreview = true;

    this.tribalLoanPaymentsService.getTribalLoanPaymentPreview(this.tribalPaymentForm.value.paymentSource).subscribe({
      next: (preview: TribalLoanPaymentPreview) => {
        this.preview = preview;
        this.isLoadingPreview = false;
      },
      error: (error: any) => {
        this.previewError = this.getErrorMessage(error);
        this.isLoadingPreview = false;
      }
    });
  }

  /**
   * Submits the generated Tribal loan payments.
   */
  submitPayments(): void {
    if (!this.canSubmitPayments || !this.preview || this.isSubmittingPayments) {
      return;
    }

    this.submissionResults = [];
    this.submissionReportExportComplete = false;
    this.isSubmittingPayments = true;
    this.tribalLoanPaymentsService
      .submitPayments(this.preview.payments, {
        transactionDate: this.tribalPaymentForm.value.transactionDate,
        paymentTypeId: this.tribalPaymentForm.value.paymentTypeId,
        note: this.tribalPaymentForm.value.note
      })
      .subscribe({
        next: (results: TribalLoanPaymentSubmissionResult[]) => {
          this.submissionResults = results;
          this.isSubmittingPayments = false;
        },
        error: (error: any) => {
          this.previewError = this.getErrorMessage(error);
          this.isSubmittingPayments = false;
        }
      });
  }

  /**
   * Returns whether the preview can be generated.
   */
  get canGeneratePreview(): boolean {
    return this.tribalPaymentForm.controls.paymentSource.valid && this.tribalPaymentForm.controls.transactionDate.valid;
  }

  /**
   * Returns whether payments can be submitted.
   */
  get canSubmitPayments(): boolean {
    return !!this.preview?.payments.length && this.tribalPaymentForm.valid && !this.isSubmittingPayments;
  }

  /**
   * Returns successful submission results.
   */
  get successfulSubmissionResults(): TribalLoanPaymentSubmissionResult[] {
    return this.submissionResults.filter((result: TribalLoanPaymentSubmissionResult) => result.success);
  }

  /**
   * Returns failed submission results.
   */
  get failedSubmissionResults(): TribalLoanPaymentSubmissionResult[] {
    return this.submissionResults.filter((result: TribalLoanPaymentSubmissionResult) => !result.success);
  }

  /**
   * Returns submitted payment total.
   */
  get submittedPaymentTotal(): number {
    return this.successfulSubmissionResults.reduce(
      (total: number, result: TribalLoanPaymentSubmissionResult) => total + result.payment.transactionAmount,
      0
    );
  }

  /**
   * Returns a payment identifier for display.
   * @param {TribalLoanPayment} payment Payment row.
   * @returns {string} Loan identifier.
   */
  getPaymentIdentifier(payment: TribalLoanPayment): string {
    return payment.accountNo || payment.externalId || payment.loanId;
  }

  /**
   * Returns a skipped loan identifier for display.
   * @param {TribalLoanData} loanData Skipped loan row.
   * @returns {string} Loan identifier.
   */
  getSkippedLoanIdentifier(loanData: TribalLoanData): string {
    return loanData.accountNo || loanData.externalId || loanData.loanId;
  }

  /**
   * Returns a Tribal payment source label translation key.
   * @param {TribalPaymentSource} paymentSource Payment source.
   * @returns {string} Translation key.
   */
  getPaymentSourceLabel(paymentSource: TribalPaymentSource): string {
    switch (paymentSource) {
      case 'pension':
        return 'labels.inputs.Pension';
      case 'payroll':
        return 'labels.inputs.Payroll';
      default:
        return 'labels.inputs.Percap';
    }
  }

  /**
   * Exports the generated payment preview to an Excel workbook.
   */
  exportPreview(): void {
    if (!this.preview || this.isExportingPreview) {
      return;
    }

    this.isExportingPreview = true;
    this.previewExportComplete = false;

    setTimeout(() => {
      this.exportPreviewWorkbook()
        .then(() => {
          this.previewExportComplete = true;
          this.clearPreviewExportComplete();
        })
        .catch((error: any) => {
          this.previewError = this.getErrorMessage(error);
        })
        .finally(() => {
          this.isExportingPreview = false;
        });
    });
  }

  private async exportPreviewWorkbook(): Promise<void> {
    if (!this.preview) {
      return;
    }

    await this.downloadExcelWorkbook(
      `tribal-loan-payment-preview-${this.getExportTimestamp()}.xlsx`,
      this.getPreviewExcelTables(this.preview)
    );
  }

  /**
   * Exports the submitted payment report to an Excel workbook.
   */
  exportSubmissionReport(): void {
    if (!this.submissionResults.length || this.isExportingSubmissionReport) {
      return;
    }

    this.isExportingSubmissionReport = true;
    this.submissionReportExportComplete = false;

    setTimeout(() => {
      this.exportSubmissionReportWorkbook()
        .then(() => {
          this.submissionReportExportComplete = true;
          this.clearSubmissionReportExportComplete();
        })
        .catch((error: any) => {
          this.previewError = this.getErrorMessage(error);
        })
        .finally(() => {
          this.isExportingSubmissionReport = false;
        });
    });
  }

  private async exportSubmissionReportWorkbook(): Promise<void> {
    await this.downloadExcelWorkbook(
      `tribal-loan-payment-submission-report-${this.getExportTimestamp()}.xlsx`,
      this.getSubmissionReportExcelTables()
    );
  }

  private getPreviewExcelTables(preview: TribalLoanPaymentPreview): ExcelReportTable[] {
    return [
      this.getReportDetailsTable('Tribal Loan Payment Preview', preview.paymentSource),
      {
        worksheetName: 'Summary',
        tableName: 'PreviewSummary',
        columns: [
          'Metric',
          'Value'
        ],
        rows: [
          [
            'Total Records',
            preview.loansScanned
          ],
          [
            'Tribal Data Records',
            preview.loansWithTribalData
          ],
          [
            'Transactions',
            preview.transactionCount
          ],
          [
            'Skipped',
            preview.skippedLoans.length
          ],
          [
            'Percap Total',
            preview.sourceTotals.percap
          ],
          [
            'Pension Total',
            preview.sourceTotals.pension
          ],
          [
            'Payroll Total',
            preview.sourceTotals.payroll
          ],
          [
            'Transaction Total',
            preview.transactionTotal
          ]
        ],
        columnTypes: [
          'text',
          'number'
        ]
      },
      {
        worksheetName: 'Payments',
        tableName: 'PreviewPayments',
        columns: [
          'Loan Id',
          'Borrower Name',
          'Loan Status',
          'Percap',
          'Pension',
          'Payroll',
          'Amount',
          'Balance Now',
          'Transaction Date',
          'Payment Source',
          'Payment Type',
          'Note'
        ],
        rows: preview.payments.map((payment: TribalLoanPayment) => [
          this.getPaymentIdentifier(payment),
          payment.borrowerName,
          payment.status,
          payment.percap,
          payment.pension,
          payment.payroll,
          payment.transactionAmount,
          payment.balanceNow,
          this.getTransactionDateForExport(),
          this.getPaymentSourceText(preview.paymentSource),
          this.getSelectedPaymentTypeName(),
          this.tribalPaymentForm.value.note || ''
        ]),
        columnTypes: [
          'text',
          'text',
          'text',
          'number',
          'number',
          'number',
          'number',
          'number',
          'text',
          'text',
          'text',
          'text'
        ]
      },
      {
        worksheetName: 'Skipped Loans',
        tableName: 'SkippedLoans',
        columns: [
          'Loan Id',
          'Borrower Name',
          'Loan Status',
          'Percap',
          'Pension',
          'Payroll',
          'Reason'
        ],
        rows: preview.skippedLoans.map((loanData: TribalLoanData) => [
          this.getSkippedLoanIdentifier(loanData),
          loanData.borrowerName,
          loanData.status,
          loanData.percap,
          loanData.pension,
          loanData.payroll,
          this.getSkippedReasonText(loanData)
        ]),
        columnTypes: [
          'text',
          'text',
          'text',
          'number',
          'number',
          'number',
          'text'
        ]
      }
    ];
  }

  private getSubmissionReportExcelTables(): ExcelReportTable[] {
    const paymentSource = this.preview ? this.preview.paymentSource : this.tribalPaymentForm.value.paymentSource;

    return [
      this.getReportDetailsTable('Tribal Loan Payment Submission Report', paymentSource),
      {
        worksheetName: 'Summary',
        tableName: 'SubmissionSummary',
        columns: [
          'Metric',
          'Value'
        ],
        rows: [
          [
            'Submitted Records',
            this.submissionResults.length
          ],
          [
            'Successful Transactions',
            this.successfulSubmissionResults.length
          ],
          [
            'Failed Transactions',
            this.failedSubmissionResults.length
          ],
          [
            'Attempted Transaction Total',
            this.getAttemptedSubmissionTotal()
          ],
          [
            'Successful Transaction Total',
            this.submittedPaymentTotal
          ]
        ],
        columnTypes: [
          'text',
          'number'
        ]
      },
      {
        worksheetName: 'Submission Results',
        tableName: 'SubmissionResults',
        columns: [
          'Loan Id',
          'Borrower Name',
          'Loan Status',
          'Percap',
          'Pension',
          'Payroll',
          'Amount',
          'Balance Now',
          'Transaction Date',
          'Payment Source',
          'Payment Type',
          'Result',
          'Transaction Id',
          'Error',
          'Note'
        ],
        rows: this.submissionResults.map((result: TribalLoanPaymentSubmissionResult) => [
          this.getPaymentIdentifier(result.payment),
          result.payment.borrowerName,
          result.payment.status,
          result.payment.percap,
          result.payment.pension,
          result.payment.payroll,
          result.payment.transactionAmount,
          result.payment.balanceNow,
          this.getTransactionDateForExport(),
          this.getPaymentSourceText(paymentSource),
          this.getSelectedPaymentTypeName(),
          result.success ? 'Successful' : 'Failed',
          result.transactionId || '',
          result.errorMessage || '',
          this.tribalPaymentForm.value.note || ''
        ]),
        columnTypes: [
          'text',
          'text',
          'text',
          'number',
          'number',
          'number',
          'number',
          'number',
          'text',
          'text',
          'text',
          'text',
          'text',
          'text',
          'text'
        ]
      }
    ];
  }

  private getReportDetailsTable(reportName: string, paymentSource: TribalPaymentSource): ExcelReportTable {
    return {
      worksheetName: 'Report Details',
      tableName: 'ReportDetails',
      columns: [
        'Field',
        'Value'
      ],
      rows: [
        [
          'Report',
          reportName
        ],
        [
          'Payment Source',
          this.getPaymentSourceText(paymentSource)
        ],
        [
          'Transaction Date',
          this.getTransactionDateForExport()
        ],
        [
          'Payment Type',
          this.getSelectedPaymentTypeName()
        ],
        [
          'Note',
          this.tribalPaymentForm.value.note || ''
        ],
        [
          'Generated At',
          new Date().toISOString()
        ]
      ],
      columnTypes: [
        'text',
        'text'
      ]
    };
  }

  private getAttemptedSubmissionTotal(): number {
    return this.submissionResults.reduce(
      (total: number, result: TribalLoanPaymentSubmissionResult) => total + result.payment.transactionAmount,
      0
    );
  }

  /**
   * Returns the payment field amount from a preview row.
   * @param {TribalLoanPayment} payment Payment row.
   * @param {TribalPaymentSource} paymentSource Payment source.
   * @returns {number | null} Payment field amount.
   */
  getTribalFieldAmount(payment: TribalLoanPayment, paymentSource: TribalPaymentSource): number | null {
    return payment[paymentSource];
  }

  /**
   * Returns the payment field amount from a skipped row.
   * @param {TribalLoanData} loanData Skipped loan row.
   * @param {TribalPaymentSource} paymentSource Payment source.
   * @returns {number | null} Payment field amount.
   */
  getSkippedFieldAmount(loanData: TribalLoanData, paymentSource: TribalPaymentSource): number | null {
    return loanData[paymentSource];
  }

  private clearPreviewExportComplete(): void {
    setTimeout(() => {
      this.previewExportComplete = false;
    }, 4000);
  }

  private clearSubmissionReportExportComplete(): void {
    setTimeout(() => {
      this.submissionReportExportComplete = false;
    }, 4000);
  }

  /**
   * Navigates back to the loan list.
   */
  cancel(): void {
    this.router.navigate(['/loans']);
  }

  private resetValidation(): void {
    if (this.tribalPaymentForm.controls.validated.value) {
      this.tribalPaymentForm.controls.validated.setValue(false, { emitEvent: false });
    }
  }

  private normalizePaymentTypes(paymentTypesResponse: any): any[] {
    const paymentTypes = this.getPaymentTypeRows(paymentTypesResponse)
      .map((paymentType: any) => ({
        ...paymentType,
        id: paymentType.id ?? paymentType.paymentTypeId ?? paymentType.value,
        name:
          paymentType.name ||
          paymentType.paymentTypeName ||
          paymentType.label ||
          paymentType.codeName ||
          paymentType.code ||
          paymentType.value,
        position: this.parsePaymentTypePosition(paymentType.position)
      }))
      .filter(
        (paymentType: any) =>
          paymentType.id !== undefined && !!paymentType.name && this.isActivePaymentType(paymentType)
      );

    return this.deduplicatePaymentTypes(paymentTypes).sort(
      (firstPaymentType: any, secondPaymentType: any) =>
        this.getPaymentTypeSortValue(firstPaymentType) - this.getPaymentTypeSortValue(secondPaymentType) ||
        firstPaymentType.name.localeCompare(secondPaymentType.name)
    );
  }

  private getPaymentTypeRows(paymentTypesResponse: any): any[] {
    if (Array.isArray(paymentTypesResponse)) {
      return paymentTypesResponse;
    }

    return this.getBestPaymentTypeRows(paymentTypesResponse);
  }

  private getBestPaymentTypeRows(paymentTypesResponse: any): any[] {
    const paymentTypeRows = this.collectPaymentTypeRows(paymentTypesResponse);

    if (!paymentTypeRows.length) {
      return [];
    }

    return paymentTypeRows.sort(
      (firstPaymentTypes: any[], secondPaymentTypes: any[]) =>
        this.scorePaymentTypeRows(secondPaymentTypes) - this.scorePaymentTypeRows(firstPaymentTypes)
    )[0];
  }

  private collectPaymentTypeRows(value: any): any[][] {
    if (!value || typeof value !== 'object') {
      return [];
    }

    if (Array.isArray(value)) {
      const objectRows = value.filter((entry: any) => entry && typeof entry === 'object');
      const nestedRows = value.flatMap((entry: any) => this.collectPaymentTypeRows(entry));

      if (objectRows.length) {
        return [
          objectRows,
          ...nestedRows
        ];
      }

      return nestedRows;
    }

    return Object.keys(value).flatMap((key: string) => this.collectPaymentTypeRows(value[key]));
  }

  private scorePaymentTypeRows(paymentTypes: any[]): number {
    return paymentTypes.reduce(
      (score: number, paymentType: any) => score + this.scorePaymentType(paymentType),
      paymentTypes.length
    );
  }

  private scorePaymentType(paymentType: any): number {
    let score = 0;

    if (paymentType.name) {
      score += 4;
    }
    if (paymentType.position !== undefined) {
      score += 3;
    }
    if (paymentType.isCashPayment !== undefined) {
      score += 3;
    }
    if (paymentType.isSystemDefined !== undefined) {
      score += 2;
    }
    if (paymentType.description !== undefined) {
      score += 1;
    }
    if (paymentType.id !== undefined || paymentType.paymentTypeId !== undefined) {
      score += 1;
    }

    return score;
  }

  private parsePaymentTypePosition(position: any): number | null {
    const parsedPosition = Number(position);
    return Number.isFinite(parsedPosition) ? parsedPosition : null;
  }

  private getPaymentTypeSortValue(paymentType: any): number {
    return paymentType.position === null || paymentType.position === undefined
      ? Number.MAX_SAFE_INTEGER
      : paymentType.position;
  }

  private isActivePaymentType(paymentType: any): boolean {
    if (paymentType.isActive !== undefined) {
      return !!paymentType.isActive;
    }

    if (paymentType.active !== undefined) {
      return !!paymentType.active;
    }

    return true;
  }

  private deduplicatePaymentTypes(paymentTypes: any[]): any[] {
    const seenPaymentTypeIds = new Set<string>();

    return paymentTypes.filter((paymentType: any) => {
      const paymentTypeId = `${paymentType.id}`;

      if (seenPaymentTypeIds.has(paymentTypeId)) {
        return false;
      }

      seenPaymentTypeIds.add(paymentTypeId);
      return true;
    });
  }

  private getPaymentSourceText(paymentSource: TribalPaymentSource): string {
    switch (paymentSource) {
      case 'pension':
        return 'Pension';
      case 'payroll':
        return 'Payroll';
      default:
        return 'Percap';
    }
  }

  private getSkippedReasonText(loanData: TribalLoanData): string {
    switch (loanData.skipReason) {
      case 'inactiveLoan':
        return 'Inactive loan';
      case 'missingTribalData':
        return 'Missing Tribal Loan Data';
      case 'missingPaymentAmount':
        return 'Missing selected payment amount';
      default:
        return 'Skipped';
    }
  }

  private getSelectedPaymentTypeName(): string {
    const paymentTypeId = this.tribalPaymentForm.value.paymentTypeId;
    if (paymentTypeId === undefined || paymentTypeId === null || paymentTypeId === '') {
      return 'None';
    }
    const paymentType = this.paymentTypes.find((entry: any) => `${entry.id}` === `${paymentTypeId}`);
    return paymentType?.name || 'None';
  }

  private getTransactionDateForExport(): string {
    const transactionDate = this.tribalPaymentForm.value.transactionDate;
    if (transactionDate instanceof Date) {
      return transactionDate.toISOString().substring(0, 10);
    }
    return transactionDate || '';
  }

  private async downloadExcelWorkbook(filename: string, reportTables: ExcelReportTable[]): Promise<void> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Mifos X Web App';
    workbook.created = new Date();
    workbook.modified = new Date();

    reportTables.forEach((reportTable: ExcelReportTable, index: number) => {
      this.addExcelTableWorksheet(workbook, reportTable, index);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    this.downloadBlob(filename, blob);
  }

  private addExcelTableWorksheet(workbook: ExcelJS.Workbook, reportTable: ExcelReportTable, index: number): void {
    const worksheet = workbook.addWorksheet(this.getExcelWorksheetName(reportTable.worksheetName, index), {
      views: [
        {
          state: 'frozen',
          ySplit: 1
        }
      ],
      properties: {
        defaultRowHeight: 18
      },
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0
      }
    });
    const rows = this.getExcelTableRows(reportTable);

    worksheet.addTable({
      name: this.getExcelTableName(reportTable.tableName, index),
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: {
        theme: 'TableStyleLight15',
        showRowStripes: true,
        showColumnStripes: false
      },
      columns: reportTable.columns.map((column: string) => ({
        name: column,
        filterButton: true
      })),
      rows
    });

    this.applyExcelWorksheetFormatting(worksheet, reportTable.columns, rows, reportTable.columnTypes || []);
  }

  private getExcelTableRows(reportTable: ExcelReportTable): any[][] {
    const rows = reportTable.rows.length ? reportTable.rows : [
          [
            'No records',
            ...Array.from({ length: Math.max(reportTable.columns.length - 1, 0) }, (): null => null)
          ]
        ];

    return rows.map((row: any[]) =>
      Array.from({ length: reportTable.columns.length }, (_value: unknown, index: number) =>
        this.getExcelCellValue(row[index], reportTable.columnTypes?.[index])
      )
    );
  }

  private applyExcelWorksheetFormatting(
    worksheet: ExcelJS.Worksheet,
    columns: string[],
    rows: any[][],
    columnTypes: ExcelColumnType[]
  ): void {
    const headerRow = worksheet.getRow(1);
    headerRow.height = 22;
    headerRow.font = {
      bold: true
    };
    headerRow.alignment = {
      vertical: 'middle',
      wrapText: true
    };

    columns.forEach((column: string, index: number) => {
      const worksheetColumn = worksheet.getColumn(index + 1);
      worksheetColumn.width = this.getExcelColumnWidth(column, rows, index);
      worksheetColumn.alignment = {
        vertical: 'middle',
        wrapText: true
      };

      if (this.isExcelNumericColumn(columnTypes[index])) {
        worksheetColumn.numFmt = columnTypes[index] === 'integer' ? '#,##0' : '#,##0.00';
      }
    });
  }

  private getExcelColumnWidth(column: string, rows: any[][], columnIndex: number): number {
    const columnLength = rows.reduce((maxLength: number, row: any[]) => {
      const value = row[columnIndex];
      const cellLength = value === null || value === undefined ? 0 : `${value}`.length;
      return Math.max(maxLength, cellLength);
    }, column.length);

    return Math.min(Math.max(columnLength + 2, 10), 45);
  }

  private getExcelCellValue(value: any, columnType: ExcelColumnType = 'text'): string | number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (this.isExcelNumericColumn(columnType)) {
      const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '')) : Number(value);
      return Number.isFinite(numberValue) ? numberValue : null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return typeof value === 'object' ? JSON.stringify(value) : value;
  }

  private isExcelNumericColumn(columnType?: ExcelColumnType): boolean {
    return columnType === 'number' || columnType === 'integer';
  }

  private getExcelWorksheetName(worksheetName: string, index: number): string {
    const sanitizedWorksheetName = worksheetName.replace(/[\\/*?:[\]]/g, ' ').trim();
    return (sanitizedWorksheetName || `Sheet ${index + 1}`).substring(0, 31);
  }

  private getExcelTableName(tableName: string, index: number): string {
    const sanitizedTableName = tableName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, 'ReportTable_');
    return `${sanitizedTableName || 'ReportTable'}_${index + 1}`.substring(0, 255);
  }

  private downloadBlob(filename: string, blob: Blob): void {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private getExportTimestamp(): string {
    return new Date().toISOString().replace(/\D/g, '').substring(0, 14);
  }

  private getErrorMessage(error: any): string {
    return error?.error?.defaultUserMessage || error?.error?.message || error?.message || '';
  }
}
