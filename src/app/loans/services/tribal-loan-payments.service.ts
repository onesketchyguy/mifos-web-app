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
import { concat, forkJoin, from, Observable, of } from 'rxjs';
import { catchError, map, mergeMap, switchMap, tap, toArray } from 'rxjs/operators';

/** Custom Services */
import { Dates } from 'app/core/utils/dates';
import { SettingsService } from 'app/settings/settings.service';
import { LoansService } from '../loans.service';

export type TribalPaymentSource = 'percap' | 'pension' | 'payroll';

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
  /** True while this row comes from the local cache and has not been re-verified against the server. */
  fromCache?: boolean;
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
  private readonly loanDatatableConcurrency = 20;
  private readonly paymentSubmissionConcurrency = 4;
  private readonly tribalLoanDatatableName = 'Tribal Loan Data';
  private readonly tribalLoanCacheKey = 'mifosXTribalLoanDataCache';
  private readonly tribalLoanCacheVersion = 1;

  private loansService = inject(LoansService);
  private settingsService = inject(SettingsService);
  private dateUtils = inject(Dates);

  /**
   * Fetches all loans and their Tribal Loan Data datatable fields, emitting each
   * loan as soon as it is resolved.
   *
   * Rows cached from the previous load are emitted first (flagged `fromCache`)
   * so the screen has an instant basis to render, then live data re-emits every
   * loan: cached rows get verified/replaced and remaining loans are scanned for
   * additions. Consumers must upsert by loanId and drop rows still flagged
   * `fromCache` when the stream completes (their loans no longer exist).
   *
   * Live data loads in a single query via the TribalLoanData report (registered
   * by scripts/register-list-reports.sql) and falls back to per-loan datatable
   * reads — cached loans verified first — when the report is not registered.
   * @returns {Observable<TribalLoanData>} Stream of individual tribal loan data items.
   */
  streamTribalLoanData(): Observable<TribalLoanData> {
    const cachedLoans = this.readTribalLoanCache();
    const verifiedLoans: TribalLoanData[] = [];
    const liveLoans$ = this.loansService.getTribalLoanDataReport().pipe(
      switchMap((reportRows: any[]) => from(reportRows.map((reportRow: any) => this.mapTribalReportRow(reportRow)))),
      catchError(() => {
        this.warnReportFallback();
        return this.streamTribalLoanDataPerLoan(cachedLoans);
      }),
      tap({
        next: (loanData: TribalLoanData) => verifiedLoans.push(loanData),
        complete: () => this.writeTribalLoanCache(verifiedLoans)
      })
    );
    return concat(from(cachedLoans), liveLoans$);
  }

  private warnReportFallback(): void {
    console.warn(
      '[IvyTek] TribalLoanData report unavailable; falling back to one datatable request per loan. ' +
        'Register it with scripts/register-list-reports.sql to load this screen in a single query.'
    );
  }

  /**
   * Per-loan fallback for streamTribalLoanData (one datatable request per loan).
   * Loans that were cached are verified first so the rows already on screen are
   * accurate before the scan for additional tribal data reaches the rest.
   */
  private streamTribalLoanDataPerLoan(cachedLoans: TribalLoanData[]): Observable<TribalLoanData> {
    const cachedLoanIds = new Set(cachedLoans.map((loanData: TribalLoanData) => loanData.loanId));
    return this.getAllLoans().pipe(
      switchMap((loans: any[]) => {
        const cachedFirst = [
          ...loans.filter((loan: any) => cachedLoanIds.has(`${loan.id}`)),
          ...loans.filter((loan: any) => !cachedLoanIds.has(`${loan.id}`))
        ];
        return from(cachedFirst).pipe(
          mergeMap((loan: any) => this.getTribalLoanData(loan), this.loanDatatableConcurrency)
        );
      })
    );
  }

  /** Reads the cached tribal loan rows saved by the previous completed load. */
  private readTribalLoanCache(): TribalLoanData[] {
    try {
      const cache = JSON.parse(localStorage.getItem(this.tribalLoanCacheKey) || 'null');
      if (
        cache?.version !== this.tribalLoanCacheVersion ||
        cache?.server !== this.getTribalLoanCacheScope() ||
        !Array.isArray(cache.loans)
      ) {
        return [];
      }
      return cache.loans.map(
        (cachedLoan: any): TribalLoanData => ({
          ...cachedLoan,
          loan: {
            id: cachedLoan.loanId,
            accountNo: cachedLoan.accountNo,
            externalId: cachedLoan.externalId,
            clientName: cachedLoan.borrowerName,
            status: { value: cachedLoan.status, active: cachedLoan.isActive },
            balanceNow: cachedLoan.balanceNow
          },
          fromCache: true
        })
      );
    } catch {
      return [];
    }
  }

  /** Saves the loans with tribal data from a completed load as the next load's basis. */
  private writeTribalLoanCache(loans: TribalLoanData[]): void {
    try {
      localStorage.setItem(
        this.tribalLoanCacheKey,
        JSON.stringify({
          version: this.tribalLoanCacheVersion,
          server: this.getTribalLoanCacheScope(),
          savedAt: new Date().toISOString(),
          loans: loans
            .filter((loanData: TribalLoanData) => loanData.hasTribalData)
            .map((loanData: TribalLoanData) => this.getTribalLoanCacheEntry(loanData))
        })
      );
    } catch {
      // Cache writes (private browsing, quota) must never break the screen.
    }
  }

  /** Updates a single loan's cache entry after an edit, so it survives navigation. */
  private patchTribalLoanCache(loanData: TribalLoanData): void {
    try {
      const cache = JSON.parse(localStorage.getItem(this.tribalLoanCacheKey) || 'null');
      if (
        cache?.version !== this.tribalLoanCacheVersion ||
        cache?.server !== this.getTribalLoanCacheScope() ||
        !Array.isArray(cache.loans)
      ) {
        return;
      }
      const cacheEntry = this.getTribalLoanCacheEntry(loanData);
      const entryIndex = cache.loans.findIndex((cachedLoan: any) => cachedLoan.loanId === loanData.loanId);
      if (entryIndex >= 0) {
        cache.loans[entryIndex] = cacheEntry;
      } else {
        cache.loans.push(cacheEntry);
      }
      localStorage.setItem(this.tribalLoanCacheKey, JSON.stringify(cache));
    } catch {
      // Cache writes (private browsing, quota) must never break the screen.
    }
  }

  /** Strips the transient fields from a loan before persisting it. */
  private getTribalLoanCacheEntry(loanData: TribalLoanData): any {
    const { loan, fromCache, ...cacheEntry } = loanData;
    return cacheEntry;
  }

  /** Cache entries are only valid for the server + tenant they were loaded from. */
  private getTribalLoanCacheScope(): string {
    return `${this.settingsService.serverUrl}|${this.settingsService.tenantIdentifier}`;
  }

  /**
   * Maps a TribalLoanData report row (one loan plus its datatable row as JSON)
   * to the same shape the per-loan path produces.
   */
  private mapTribalReportRow(reportRow: any): TribalLoanData {
    const loan = {
      id: reportRow.id,
      accountNo: reportRow.accountNo,
      externalId: reportRow.externalId,
      clientName: reportRow.borrowerName,
      status: { value: reportRow.status, active: `${reportRow.active}` === 'true' },
      balanceNow: reportRow.balanceNow
    };
    return this.mapTribalLoanData(loan, this.parseReportTribalData(reportRow.tribalData));
  }

  /** Parses the JSON datatable row returned by the report into a datatable-like shape. */
  private parseReportTribalData(tribalData: any): any {
    let fields = tribalData;
    if (typeof tribalData === 'string') {
      try {
        fields = JSON.parse(tribalData);
      } catch {
        return null;
      }
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return null;
    }

    const row = Object.keys(fields).reduce((dataFields: Record<string, any>, fieldName: string) => {
      if (!this.isSystemDatatableColumn(fieldName)) {
        dataFields[fieldName] = fields[fieldName];
      }
      return dataFields;
    }, {});
    return { row };
  }

  /**
   * Saves updated percap/pension/payroll values back to the Tribal Loan Data datatable.
   * Uses PUT when the datatable row already exists, POST when it does not.
   * @param {TribalLoanData} tribalLoanData Loan data object (provides loanId and hasTribalData flag).
   * @param {Partial<Record<TribalPaymentSource, number | null>>} updatedFields Fields to update.
   * @returns {Observable<any>}
   */
  updateTribalLoanField(
    tribalLoanData: TribalLoanData,
    updatedFields: Partial<Record<TribalPaymentSource, number | null>>
  ): Observable<any> {
    const payload: Record<string, any> = {
      ...tribalLoanData.dataFields,
      locale: this.settingsService.language.code,
      dateFormat: this.settingsService.dateFormat
    };
    const appliedFields: Record<string, any> = {};

    for (const [
      source,
      value
    ] of Object.entries(updatedFields) as [TribalPaymentSource, number | null][]) {
      const fieldName = this.findDataFieldName(tribalLoanData.dataFields, source);
      if (fieldName) {
        payload[fieldName] = value ?? 0;
        appliedFields[fieldName] = value ?? 0;
      }
    }

    const persistSavedFields = tap(() => {
      Object.assign(tribalLoanData.dataFields, appliedFields);
      this.patchTribalLoanCache(tribalLoanData);
    });

    if (tribalLoanData.hasTribalData) {
      return this.loansService
        .editLoanDatatableEntry(tribalLoanData.loanId, this.tribalLoanDatatableName, payload)
        .pipe(persistSavedFields);
    }
    return this.loansService.addLoanDatatableEntry(tribalLoanData.loanId, this.tribalLoanDatatableName, payload).pipe(
      tap(() => {
        tribalLoanData.hasTribalData = true;
      }),
      persistSavedFields
    );
  }

  /**
   * Finds the actual datatable field name for a given payment source.
   */
  private findDataFieldName(dataFields: Record<string, any>, source: TribalPaymentSource): string | undefined {
    const candidateMap: Record<TribalPaymentSource, string[]> = {
      percap: [
        'Percap',
        'Per Capita',
        'Per_Capita',
        'Per_Capita_WS__c'
      ],
      pension: [
        'Pension',
        'Pension_WS__c',
        'Pension__c'
      ],
      payroll: [
        'Payroll',
        'Payroll Deduction',
        'Payroll_Deduction_WS__c',
        'Payroll_WS__c',
        'Payroll__c'
      ]
    };
    const candidates = candidateMap[source].map((c: string) => this.normalizeKey(c));
    return Object.keys(dataFields).find((key: string) => candidates.includes(this.normalizeKey(key)));
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

    return tribalLoanData;
  }

  /**
   * Builds the repayment transactions to post: one per active loan with a
   * positive amount for the selected payment source.
   * @param {TribalLoanData[]} tribalLoanData Loaded tribal loan data.
   * @param {TribalPaymentSource} paymentSource Selected Tribal payment field.
   * @returns {TribalLoanPayment[]} Payments ready for submitPayments.
   */
  createPayments(tribalLoanData: TribalLoanData[], paymentSource: TribalPaymentSource): TribalLoanPayment[] {
    return tribalLoanData
      .filter((loanData: TribalLoanData) => loanData.isActive && (loanData[paymentSource] ?? 0) > 0)
      .map((loanData: TribalLoanData) => ({
        loanId: loanData.loanId,
        accountNo: loanData.accountNo,
        externalId: loanData.externalId,
        borrowerName: loanData.borrowerName,
        status: loanData.status,
        balanceNow: loanData.balanceNow,
        paymentSource,
        transactionAmount: loanData[paymentSource] as number,
        percap: loanData.percap,
        pension: loanData.pension,
        payroll: loanData.payroll,
        dataFields: loanData.dataFields
      }));
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
      })),
      tap((result: TribalLoanPaymentSubmissionResult) => {
        if (options.note && result.transactionId) {
          this.loansService.saveTransactionNote(payment.loanId, String(result.transactionId), options.note).subscribe({
            next: (r) => {
              if (!r?.success) console.error('[IvyTek] Transaction note save failed:', r?.message);
            },
            error: (err) => console.error('[IvyTek] Transaction note save error:', err)
          });
        }
      })
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
