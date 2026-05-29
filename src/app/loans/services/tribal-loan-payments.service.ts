/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Injectable, inject } from '@angular/core';

/** rxjs Imports */
import { forkJoin, from, Observable, of } from 'rxjs';
import { catchError, map, mergeMap, switchMap, toArray } from 'rxjs/operators';

/** Custom Services */
import { Dates } from 'app/core/utils/dates';
import { SettingsService } from 'app/settings/settings.service';
import { LoansService } from '../loans.service';

export type TribalPaymentSource = 'percap' | 'pension' | 'payroll';

export type TribalLoanPaymentSkipReason = 'inactiveLoan' | 'missingTribalData' | 'missingPaymentAmount';

export interface TribalLoanData {
  loan: any;
  loanId: string;
  accountNo: string;
  externalId: string;
  borrowerName: string;
  status: string;
  isActive: boolean;
  balanceNow: number | null;
  hasTribalData: boolean;
  dataFields: Record<string, any>;
  percap: number | null;
  pension: number | null;
  payroll: number | null;
  skipReason?: TribalLoanPaymentSkipReason;
}

export interface TribalLoanPayment {
  loanId: string;
  accountNo: string;
  externalId: string;
  borrowerName: string;
  status: string;
  balanceNow: number | null;
  paymentSource: TribalPaymentSource;
  transactionAmount: number;
  percap: number | null;
  pension: number | null;
  payroll: number | null;
  dataFields: Record<string, any>;
}

export interface TribalLoanPaymentPreview {
  paymentSource: TribalPaymentSource;
  loansScanned: number;
  loansWithTribalData: number;
  transactionCount: number;
  transactionTotal: number;
  sourceTotals: Record<TribalPaymentSource, number>;
  payments: TribalLoanPayment[];
  skippedLoans: TribalLoanData[];
}

export interface TribalLoanPaymentSubmitOptions {
  transactionDate: Date | string;
  paymentTypeId?: number | string;
  note?: string;
}

export interface TribalLoanPaymentSubmissionResult {
  index: number;
  payment: TribalLoanPayment;
  success: boolean;
  resourceId?: number;
  transactionId?: number;
  errorMessage?: string;
}

/**
 * Tribal loan payments service.
 */
@Injectable({
  providedIn: 'root'
})
export class TribalLoanPaymentsService {
  private readonly loansPageSize = 200;
  private readonly loanDatatableConcurrency = 8;
  private readonly paymentSubmissionConcurrency = 4;
  private readonly tribalLoanDatatableName = 'Tribal Loan Data';

  private loansService = inject(LoansService);
  private settingsService = inject(SettingsService);
  private dateUtils = inject(Dates);

  /**
   * Fetches every loan, reads its Tribal Loan Data datatable row, and builds a payment preview.
   * @param {TribalPaymentSource} paymentSource Selected Tribal payment field.
   * @returns {Observable<TribalLoanPaymentPreview>} Tribal payment preview.
   */
  getTribalLoanPaymentPreview(paymentSource: TribalPaymentSource): Observable<TribalLoanPaymentPreview> {
    return this.getAllTribalLoanData().pipe(
      map((tribalLoanData: TribalLoanData[]) => this.createPaymentPreview(tribalLoanData, paymentSource))
    );
  }

  /**
   * Fetches all loans and their Tribal Loan Data datatable fields.
   * @returns {Observable<TribalLoanData[]>} Tribal loan data list.
   */
  getAllTribalLoanData(): Observable<TribalLoanData[]> {
    return this.getAllLoans().pipe(
      switchMap((loans: any[]) =>
        from(loans).pipe(
          mergeMap((loan: any) => this.getTribalLoanData(loan), this.loanDatatableConcurrency),
          toArray()
        )
      )
    );
  }

  /**
   * Posts a repayment transaction to each loan in the preview.
   * @param {TribalLoanPayment[]} payments Payments to submit.
   * @param {TribalLoanPaymentSubmitOptions} options Transaction options.
   * @returns {Observable<TribalLoanPaymentSubmissionResult[]>} Submission results.
   */
  submitPayments(
    payments: TribalLoanPayment[],
    options: TribalLoanPaymentSubmitOptions
  ): Observable<TribalLoanPaymentSubmissionResult[]> {
    return from(payments).pipe(
      mergeMap(
        (payment: TribalLoanPayment, index: number) =>
          this.submitPayment(payment, options, index).pipe(
            catchError((error: any) =>
              of({
                index,
                payment,
                success: false,
                errorMessage: this.getErrorMessage(error)
              })
            )
          ),
        this.paymentSubmissionConcurrency
      ),
      toArray(),
      map((results: TribalLoanPaymentSubmissionResult[]) =>
        results.sort((first: TribalLoanPaymentSubmissionResult, second: TribalLoanPaymentSubmissionResult) => {
          return first.index - second.index;
        })
      )
    );
  }

  private getAllLoans(): Observable<any[]> {
    return this.loansService.getLoans(0, this.loansPageSize).pipe(
      switchMap((firstPage: any) => {
        const firstPageLoans = this.normalizeLoanPage(firstPage);
        const totalRecords = firstPage?.totalFilteredRecords || firstPageLoans.length;
        const pageRequests: Observable<any[]>[] = [];

        for (let offset = this.loansPageSize; offset < totalRecords; offset += this.loansPageSize) {
          pageRequests.push(
            this.loansService
              .getLoans(offset, this.loansPageSize)
              .pipe(map((loanPage: any) => this.normalizeLoanPage(loanPage)))
          );
        }

        if (!pageRequests.length) {
          return of(firstPageLoans);
        }

        return forkJoin(pageRequests).pipe(map((loanPages: any[][]) => firstPageLoans.concat(...loanPages)));
      })
    );
  }

  private normalizeLoanPage(loanPage: any): any[] {
    if (Array.isArray(loanPage)) {
      return loanPage;
    }
    return loanPage?.pageItems || [];
  }

  private getTribalLoanData(loan: any): Observable<TribalLoanData> {
    return this.loansService.getLoanDatatable(loan.id, this.tribalLoanDatatableName).pipe(
      map((datatable: any) => this.mapTribalLoanData(loan, datatable)),
      catchError(() => of(this.mapTribalLoanData(loan, null)))
    );
  }

  private mapTribalLoanData(loan: any, datatable: any): TribalLoanData {
    const dataFields = this.getDatatableFields(datatable);
    const hasTribalData = Object.keys(dataFields).length > 0;
    const tribalLoanData: TribalLoanData = {
      loan,
      loanId: loan.id?.toString() || '',
      accountNo: loan.accountNo || '',
      externalId: loan.externalId || '',
      borrowerName: loan.clientName || loan.group?.name || loan.groupName || '',
      status: loan.status?.value || loan.status?.code || '',
      isActive: this.isActiveLoan(loan),
      balanceNow: this.parseDecimal(
        loan.balanceNow ??
          loan.summary?.totalOutstanding ??
          loan.loanBalance ??
          loan.totalOutstanding ??
          loan.outstandingBalance
      ),
      hasTribalData,
      dataFields,
      percap: this.getPaymentAmount(dataFields, [
        'Percap',
        'Per Capita',
        'Per_Capita',
        'Per_Capita_WS__c'
      ]),
      pension: this.getPaymentAmount(dataFields, [
        'Pension',
        'Pension_WS__c',
        'Pension__c'
      ]),
      payroll: this.getPaymentAmount(dataFields, [
        'Payroll',
        'Payroll Deduction',
        'Payroll_Deduction_WS__c',
        'Payroll_WS__c',
        'Payroll__c'
      ])
    };

    if (!tribalLoanData.isActive) {
      tribalLoanData.skipReason = 'inactiveLoan';
    } else if (!tribalLoanData.hasTribalData) {
      tribalLoanData.skipReason = 'missingTribalData';
    }

    return tribalLoanData;
  }

  private createPaymentPreview(
    tribalLoanData: TribalLoanData[],
    paymentSource: TribalPaymentSource
  ): TribalLoanPaymentPreview {
    const sourceTotals = this.getSourceTotals(tribalLoanData);
    const payments: TribalLoanPayment[] = [];
    const skippedLoans: TribalLoanData[] = [];

    tribalLoanData.forEach((loanData: TribalLoanData) => {
      const transactionAmount = loanData[paymentSource];
      if (loanData.skipReason) {
        skippedLoans.push(loanData);
        return;
      }
      if (!transactionAmount || transactionAmount <= 0) {
        skippedLoans.push({
          ...loanData,
          skipReason: 'missingPaymentAmount'
        });
        return;
      }

      payments.push({
        loanId: loanData.loanId,
        accountNo: loanData.accountNo,
        externalId: loanData.externalId,
        borrowerName: loanData.borrowerName,
        status: loanData.status,
        balanceNow: loanData.balanceNow,
        paymentSource,
        transactionAmount,
        percap: loanData.percap,
        pension: loanData.pension,
        payroll: loanData.payroll,
        dataFields: loanData.dataFields
      });
    });

    return {
      paymentSource,
      loansScanned: tribalLoanData.length,
      loansWithTribalData: tribalLoanData.filter((loanData: TribalLoanData) => loanData.hasTribalData).length,
      transactionCount: payments.length,
      transactionTotal: this.sumPayments(payments),
      sourceTotals,
      payments,
      skippedLoans
    };
  }

  private getDatatableFields(datatable: any): Record<string, any> {
    const columns = datatable?.columnHeaders || datatable?.columnHeaderData || datatable?.columns || [];
    const row = datatable?.data?.[0]?.row || datatable?.data?.[0] || datatable?.row;
    if (!row) {
      return {};
    }

    if (!Array.isArray(row) && typeof row === 'object') {
      return { ...row };
    }

    return columns.reduce((fields: Record<string, any>, column: any, index: number) => {
      const columnName = column.displayName || column.name || column.columnName;
      if (columnName && !this.isSystemDatatableColumn(column.columnName || columnName)) {
        fields[columnName] = row[index];
      }
      return fields;
    }, {});
  }

  private isSystemDatatableColumn(columnName: string): boolean {
    return [
      'id',
      'loan_id',
      'created_at',
      'updated_at'
    ].includes((columnName || '').toLowerCase());
  }

  private getPaymentAmount(dataFields: Record<string, any>, candidateNames: string[]): number | null {
    const normalizedCandidateNames = candidateNames.map((candidateName: string) => this.normalizeKey(candidateName));
    const dataFieldName = Object.keys(dataFields).find((fieldName: string) =>
      normalizedCandidateNames.includes(this.normalizeKey(fieldName))
    );
    return dataFieldName ? this.parseDecimal(dataFields[dataFieldName]) : null;
  }

  private getSourceTotals(tribalLoanData: TribalLoanData[]): Record<TribalPaymentSource, number> {
    return {
      percap: this.sumSource(tribalLoanData, 'percap'),
      pension: this.sumSource(tribalLoanData, 'pension'),
      payroll: this.sumSource(tribalLoanData, 'payroll')
    };
  }

  private sumSource(tribalLoanData: TribalLoanData[], paymentSource: TribalPaymentSource): number {
    return tribalLoanData.reduce((total: number, loanData: TribalLoanData) => {
      const amount = loanData.isActive ? loanData[paymentSource] : 0;
      return total + (amount && amount > 0 ? amount : 0);
    }, 0);
  }

  private sumPayments(payments: TribalLoanPayment[]): number {
    return payments.reduce((total: number, payment: TribalLoanPayment) => total + payment.transactionAmount, 0);
  }

  private submitPayment(
    payment: TribalLoanPayment,
    options: TribalLoanPaymentSubmitOptions,
    index: number
  ): Observable<TribalLoanPaymentSubmissionResult> {
    const payload = this.getPaymentPayload(payment, options);
    return this.loansService.submitLoanActionButton(payment.loanId, payload, 'repayment').pipe(
      map((response: any) => ({
        index,
        payment,
        success: true,
        resourceId: response?.resourceId,
        transactionId: response?.resourceId || response?.transactionId || response?.changes?.transactionId
      }))
    );
  }

  private getPaymentPayload(payment: TribalLoanPayment, options: TribalLoanPaymentSubmitOptions): any {
    const dateFormat = this.settingsService.dateFormat;
    const transactionDate =
      options.transactionDate instanceof Date
        ? this.dateUtils.formatDate(options.transactionDate, dateFormat)
        : options.transactionDate;
    const payload: any = {
      transactionDate,
      transactionAmount: payment.transactionAmount,
      dateFormat,
      locale: this.settingsService.language.code
    };

    if (options.paymentTypeId) {
      payload.paymentTypeId = options.paymentTypeId;
    }
    if (options.note) {
      payload.note = options.note;
    }

    return payload;
  }

  private isActiveLoan(loan: any): boolean {
    if (loan.status?.active !== undefined) {
      return !!loan.status.active;
    }

    const status = `${loan.status?.code || ''} ${loan.status?.value || ''}`.toLowerCase();
    if (!status) {
      return true;
    }

    return status.includes('active') && !status.includes('inactive');
  }

  private parseDecimal(value: any): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    const parsed = Number.parseFloat(
      value
        .toString()
        .replace(/[$,%\s]/g, '')
        .replace(/,/g, '')
    );
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeKey(value: string): string {
    return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private getErrorMessage(error: any): string {
    const errors = error?.error?.errors;
    if (Array.isArray(errors) && errors.length) {
      return errors
        .map((entry: any) => entry.defaultUserMessage || entry.userMessageGlobalisationCode || entry.message)
        .filter((message: string) => !!message)
        .join(' ');
    }

    return (
      error?.error?.defaultUserMessage ||
      error?.error?.message ||
      error?.message ||
      'Unable to submit payment transaction.'
    );
  }
}
