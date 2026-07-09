/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, OnDestroy, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

/** rxjs Imports */
import { forkJoin, from, of, Subject } from 'rxjs';
import { catchError, map, mergeMap, switchMap, takeUntil } from 'rxjs/operators';

/** Custom Services and Models */
import { SearchData } from '../search.model';
import { ClientsService } from 'app/clients/clients.service';
import { LoansService } from 'app/loans/loans.service';
import { ExternalIdentifierComponent } from '../../shared/external-identifier/external-identifier.component';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { accountFeatures } from 'app/shared/account-features/account-features.config';

/** Client search result enriched with the same figures as the client list page. */
interface ClientResult {
  clientId: number;
  name: string;
  accountNo: string;
  status: string;
  entityIdNumber: string | number | null;
  activeLoansCount: number | null;
  activeBalance: number | null;
  overdueBalance: number | null;
  daysInArrears: number | null;
  enrichmentQueued: boolean;
  entity: SearchData;
}

/** Loan search result enriched with the same figures as the loan list page. */
interface LoanResult {
  loanId: number;
  accountNo: string;
  borrowerName: string;
  productName: string;
  status: string;
  balance: number | null;
  amountDue: number | null;
  interestRate: number | null;
  daysLate: number | null;
  maturityDate: any;
  enrichmentQueued: boolean;
  entity: SearchData;
}

/** Group, center, savings or share result displayed without enrichment. */
interface GenericResult {
  name: string;
  accountNo: string;
  externalId: string;
  parentName: string;
  status: string;
  entity: SearchData;
}

interface GenericSection {
  key: string;
  label: string;
  parentLabel: string;
  rows: GenericResult[];
}

/** Number of rows shown per section initially / added per "Show more" click. */
const INITIAL_ROWS = 10;
const ROWS_INCREMENT = 25;

/**
 * Search Page Component
 *
 * Displays global search results grouped by entity type, with columns
 * tailored to each type and financial figures loaded in the background.
 */
@Component({
  selector: 'mifosx-search-page',
  templateUrl: './search-page.component.html',
  styleUrls: ['./search-page.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    ExternalIdentifierComponent,
    MatProgressSpinner,
    FormatNumberPipe
  ]
})
export class SearchPageComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private clientsService = inject(ClientsService);
  private loansService = inject(LoansService);
  accountFeatures = accountFeatures;

  /** Active search query, shown in the header. */
  query = '';
  /** Flags if number of search results exceed 200 */
  overload = false;
  /** Total visible results across all sections. */
  totalResults = 0;
  /** Active entity type filter chip. */
  activeFilter = 'all';

  clientResults: ClientResult[] = [];
  loanResults: LoanResult[] = [];
  genericSections: GenericSection[] = [];

  /** Visible row count per section key. */
  visibleRows: { [key: string]: number } = {};
  /** Client ids whose financial figures are still loading. */
  loadingClientIds = new Set<number>();
  /** Loan ids whose financial figures are still loading. */
  loadingLoanIds = new Set<number>();

  private destroy$ = new Subject<void>();

  constructor() {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.query = params['query'] || '';
    });
    this.route.data.pipe(takeUntil(this.destroy$)).subscribe((data: { searchResults: any }) => {
      const searchResults = data.searchResults.filter((result: SearchData) => this.isSearchResultVisible(result));
      this.overload = searchResults.length > 200;
      this.buildSections(this.overload ? searchResults.slice(0, 200) : searchResults);
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get hasResults(): boolean {
    return this.totalResults > 0;
  }

  /** Filter chips: 'all' plus one per non-empty section. */
  get filters(): { key: string; label: string; count: number }[] {
    const chips = [
      { key: 'all', label: 'All', count: this.totalResults }];
    if (this.clientResults.length) {
      chips.push({ key: 'clients', label: 'Clients', count: this.clientResults.length });
    }
    if (this.loanResults.length) {
      chips.push({ key: 'loans', label: 'Loans', count: this.loanResults.length });
    }
    this.genericSections.forEach((section) => {
      chips.push({ key: section.key, label: section.label, count: section.rows.length });
    });
    return chips;
  }

  setFilter(key: string) {
    this.activeFilter = key;
  }

  isSectionVisible(key: string): boolean {
    return this.activeFilter === 'all' || this.activeFilter === key;
  }

  visibleClientResults(): ClientResult[] {
    return this.clientResults.slice(0, this.visibleRows['clients']);
  }

  visibleLoanResults(): LoanResult[] {
    return this.loanResults.slice(0, this.visibleRows['loans']);
  }

  visibleGenericRows(section: GenericSection): GenericResult[] {
    return section.rows.slice(0, this.visibleRows[section.key]);
  }

  hiddenRowCount(key: string, total: number): number {
    return Math.max(total - (this.visibleRows[key] || 0), 0);
  }

  showMore(key: string) {
    this.visibleRows[key] = (this.visibleRows[key] || 0) + ROWS_INCREMENT;
    if (key === 'clients') {
      this.enrichVisibleClients();
    } else if (key === 'loans') {
      this.enrichVisibleLoans();
    }
  }

  isClientLoading(clientId: number): boolean {
    return this.loadingClientIds.has(clientId);
  }

  isLoanLoading(loanId: number): boolean {
    return this.loadingLoanIds.has(loanId);
  }

  /** Maps an entity status to a colored chip class. */
  statusClass(status: string): string {
    const value = (status || '').toLowerCase();
    if (!value) {
      return 'status-chip unknown';
    }
    if (value.includes('overdue')) {
      return 'status-chip overdue';
    }
    if (value.includes('active')) {
      return 'status-chip active';
    }
    if (value.includes('pending')) {
      return 'status-chip pending';
    }
    if (value.includes('approved')) {
      return 'status-chip approved';
    }
    if (value.includes('overpaid')) {
      return 'status-chip overpaid';
    }
    if (
      value.includes('closed') ||
      value.includes('inactive') ||
      value.includes('rejected') ||
      value.includes('withdrawn')
    ) {
      return 'status-chip closed';
    }
    return 'status-chip unknown';
  }

  viewClient(client: ClientResult) {
    this.router.navigate([
      '/clients',
      client.clientId,
      'general'
    ]);
  }

  viewLoan(loan: LoanResult) {
    this.router.navigate([
      '/clients',
      loan.entity.parentId,
      'loans-accounts',
      loan.loanId,
      'general'
    ]);
  }

  viewLoanBorrower(loan: LoanResult, event: Event) {
    event.stopPropagation();
    if (loan.entity.parentId) {
      this.router.navigate([
        '/clients',
        loan.entity.parentId,
        'general'
      ]);
    }
  }

  /**
   * Returns link to entity view page.
   * @param {any} entity Entity
   */
  navigate(entity: SearchData) {
    switch (entity.entityType) {
      case 'CENTER':
        this.router.navigate([
          '/centers',
          entity.entityId
        ]);
        break;
      case 'GROUP':
        this.router.navigate([
          '/groups',
          entity.entityId
        ]);
        break;
      case 'SHARE':
        if (!this.accountFeatures.shares) {
          break;
        }
        this.router.navigate([
          '/clients',
          entity.parentId,
          'shares-accounts',
          entity.entityId
        ]);
        break;
      case 'SAVING':
        if (entity.subEntityType === 'depositAccountType.recurringDeposit') {
          if (!this.accountFeatures.recurringDeposits) {
            break;
          }
          this.router.navigate([
            '/clients',
            entity.parentId,
            'recurring-deposits-accounts',
            entity.entityId,
            'transactions'
          ]);
        } else if (entity.subEntityType === 'depositAccountType.fixedDeposit') {
          if (!this.accountFeatures.fixedDeposits) {
            break;
          }
          this.router.navigate([
            '/clients',
            entity.parentId,
            'fixed-deposits-accounts',
            entity.entityId,
            'transactions'
          ]);
        } else if (entity.subEntityType === 'depositAccountType.savingsDeposit') {
          if (!this.accountFeatures.savings) {
            break;
          }
          this.router.navigate([
            '/clients',
            entity.parentId,
            'savings-accounts',
            entity.entityId,
            'transactions'
          ]);
        }
        break;
    }
  }

  private isSearchResultVisible(result: SearchData): boolean {
    if (result.entityType === 'SHARE') {
      return this.accountFeatures.shares;
    }

    if (result.entityType === 'SAVING') {
      if (result.subEntityType === 'depositAccountType.recurringDeposit') {
        return this.accountFeatures.recurringDeposits;
      }
      if (result.subEntityType === 'depositAccountType.fixedDeposit') {
        return this.accountFeatures.fixedDeposits;
      }
      return this.accountFeatures.savings;
    }

    return true;
  }

  private buildSections(results: SearchData[]) {
    const clientsById = new Map<number, ClientResult>();
    this.loanResults = [];
    const generic: { [key: string]: GenericResult[] } = { groups: [], centers: [], savings: [], shares: [] };

    results.forEach((result) => {
      switch (result.entityType) {
        case 'CLIENT':
        case 'CLIENTIDENTIFIER': {
          const isIdentifier = result.entityType === 'CLIENTIDENTIFIER';
          const clientId = isIdentifier ? result.parentId : result.entityId;
          if (!clientId) {
            break;
          }
          const existing = clientsById.get(clientId);
          // Prefer the CLIENT entry over one derived from a matched identifier
          if (existing && !isIdentifier) {
            clientsById.set(clientId, { ...existing, ...this.buildClientResult(result, clientId, false) });
          } else if (!existing) {
            clientsById.set(clientId, this.buildClientResult(result, clientId, isIdentifier));
          }
          break;
        }
        case 'LOAN':
          this.loanResults.push({
            loanId: result.entityId,
            accountNo: result.entityAccountNo || result.entityName || '',
            borrowerName: result.parentName || '',
            productName: '',
            status: result.entityStatus?.value || '',
            balance: null,
            amountDue: null,
            interestRate: null,
            daysLate: null,
            maturityDate: null,
            enrichmentQueued: false,
            entity: result
          });
          break;
        case 'GROUP':
          generic['groups'].push(this.buildGenericResult(result));
          break;
        case 'CENTER':
          generic['centers'].push(this.buildGenericResult(result));
          break;
        case 'SAVING':
          generic['savings'].push(this.buildGenericResult(result));
          break;
        case 'SHARE':
          generic['shares'].push(this.buildGenericResult(result));
          break;
      }
    });

    this.clientResults = Array.from(clientsById.values());
    this.genericSections = [
      { key: 'groups', label: 'Groups', parentLabel: 'Office', rows: generic['groups'] },
      { key: 'centers', label: 'Centers', parentLabel: 'Office', rows: generic['centers'] },
      { key: 'savings', label: 'Savings', parentLabel: 'Client Name', rows: generic['savings'] },
      { key: 'shares', label: 'Shares', parentLabel: 'Client Name', rows: generic['shares'] }
    ].filter((section) => section.rows.length > 0);

    this.updateTotalResults();

    this.activeFilter = 'all';
    this.visibleRows = { clients: INITIAL_ROWS, loans: INITIAL_ROWS };
    this.genericSections.forEach((section) => (this.visibleRows[section.key] = INITIAL_ROWS));
    this.loadingClientIds.clear();
    this.loadingLoanIds.clear();

    this.enrichVisibleClients();
    this.enrichVisibleLoans();
  }

  private buildClientResult(result: SearchData, clientId: number, fromIdentifier: boolean): ClientResult {
    return {
      clientId,
      name: (fromIdentifier ? result.parentName : result.entityName) || result.entityName || '',
      accountNo: fromIdentifier ? '' : result.entityAccountNo || '',
      status: result.entityStatus?.value || '',
      entityIdNumber: null,
      activeLoansCount: null,
      activeBalance: null,
      overdueBalance: null,
      daysInArrears: null,
      enrichmentQueued: false,
      entity: result
    };
  }

  private buildGenericResult(result: SearchData): GenericResult {
    return {
      name: result.entityName || '',
      accountNo: result.entityAccountNo || '',
      externalId: result.entityExternalId || '',
      parentName: result.parentName || '',
      status: result.entityStatus?.value || '',
      entity: result
    };
  }

  /** Loads loan portfolio figures for visible client rows, like the client list page. */
  private enrichVisibleClients() {
    const pending = this.visibleClientResults().filter((client) => !client.enrichmentQueued);
    if (!pending.length) {
      return;
    }
    pending.forEach((client) => {
      client.enrichmentQueued = true;
      this.loadingClientIds.add(client.clientId);
    });

    from(pending)
      .pipe(
        mergeMap(
          (client) =>
            forkJoin({
              clientData: client.accountNo
                ? of(null)
                : this.clientsService.getClientData(client.clientId.toString()).pipe(catchError(() => of(null))),
              identifiers: this.clientsService
                .getClientIdentifiers(client.clientId.toString())
                .pipe(catchError(() => of(null))),
              loansData: this.clientsService.getClientLoans(client.clientId.toString()).pipe(catchError(() => of(null)))
            }).pipe(
              switchMap((details) =>
                this.getClientDaysInArrears(details.loansData).pipe(
                  map((daysInArrears) => ({ client, details, daysInArrears }))
                )
              )
            ),
          8
        ),
        takeUntil(this.destroy$)
      )
      .subscribe(({ client, details, daysInArrears }) => {
        this.applyClientDetails(client, details.clientData, details.loansData, details.identifiers, daysInArrears);
        this.loadingClientIds.delete(client.clientId);
      });
  }

  private applyClientDetails(
    client: ClientResult,
    clientData: any,
    loansData: any,
    identifiers: any,
    daysInArrears: number | null
  ) {
    if (clientData) {
      client.name = clientData.displayName || client.name;
      client.accountNo = clientData.accountNo || client.accountNo;
      client.status = clientData.status?.value || client.status;
    }

    client.entityIdNumber = this.getEntityIdNumber(identifiers);
    client.daysInArrears = daysInArrears;

    if (!loansData) {
      return;
    }
    const allLoans: any[] = loansData?.pageItems || loansData?.content || [];
    const activeLoans = this.getActiveLoans(loansData);
    client.activeLoansCount = activeLoans.length;
    client.activeBalance = activeLoans.reduce(
      (sum: number, loan: any) =>
        sum + (loan.loanBalance ?? loan.summary?.totalOutstanding ?? loan.totalOutstanding ?? 0),
      0
    );
    client.overdueBalance = activeLoans.reduce(
      (sum: number, loan: any) => sum + (loan.amountInArrears ?? loan.totalOverdue ?? loan.summary?.totalOverdue ?? 0),
      0
    );

    this.addClientLoans(client, allLoans);
  }

  /** Finds the client's EntityID identifier, like the client list page. */
  private getEntityIdNumber(identifiers: any): string | number | null {
    const match = ((identifiers as any[]) || []).find(
      (identifier: any) => this.normalizeColumnName(identifier?.documentType?.name) === 'entityid'
    );
    return match?.documentKey ?? null;
  }

  private normalizeColumnName(columnName: string): string {
    return (columnName || '').replace(/[_\s-]/g, '').toLowerCase();
  }

  private getActiveLoans(loansData: any): any[] {
    const allLoans: any[] = loansData?.pageItems || loansData?.content || [];
    return allLoans.filter((loan: any) => {
      const status = loan?.status;
      if (!status) return false;
      if (typeof status === 'string') return status.toLowerCase() === 'active';
      if (typeof status === 'object') return status?.value?.toLowerCase() === 'active' || status?.active === true;
      return false;
    });
  }

  /** Resolves days in arrears from loan list fields, falling back to loan details, like the client list page. */
  private getClientDaysInArrears(loansData: any) {
    if (!loansData) {
      return of(null as number | null);
    }
    const activeLoans = this.getActiveLoans(loansData);
    const daysFromList = activeLoans.reduce(
      (max: number, loan: any) => Math.max(max, this.getLoanDaysInArrears(loan)),
      0
    );
    if (daysFromList > 0) {
      return of(daysFromList as number | null);
    }

    const inArrearsLoans = activeLoans.filter((loan: any) => loan.inArrears === true);
    if (!inArrearsLoans.length) {
      return of(0 as number | null);
    }

    return forkJoin(
      inArrearsLoans.map((loan: any) =>
        this.clientsService.getLoanDetails(loan.id.toString()).pipe(
          map((detail: any) => this.getLoanDaysInArrears(detail)),
          catchError(() => of(0 as number))
        )
      )
    ).pipe(map((days: number[]) => days.reduce((max, d) => Math.max(max, d), 0) as number | null));
  }

  private getLoanDaysInArrears(loanDetail: any): number {
    const direct =
      loanDetail?.pastDueDays ??
      loanDetail?.daysLate ??
      loanDetail?.delinquent?.delinquentDays ??
      loanDetail?.delinquent?.pastDueDays ??
      loanDetail?.summary?.pastDueDays ??
      loanDetail?.summary?.numberOfDaysInArrears;
    if (direct != null) {
      return direct as number;
    }
    const overdueSince = loanDetail?.summary?.overdueSinceDate;
    if (!overdueSince) {
      return 0;
    }
    const date = Array.isArray(overdueSince)
      ? new Date(overdueSince[0], overdueSince[1] - 1, overdueSince[2])
      : new Date(overdueSince);
    return Math.max(Math.floor((Date.now() - date.getTime()) / 86400000), 0);
  }

  /** Surfaces a matched client's loans in the loans section, so name searches also find their loans. */
  private addClientLoans(client: ClientResult, loans: any[]) {
    const existingLoanIds = new Set(this.loanResults.map((loan) => loan.loanId));
    let added = false;

    loans.forEach((loan: any) => {
      if (!loan?.id || existingLoanIds.has(loan.id)) {
        return;
      }
      existingLoanIds.add(loan.id);
      this.loanResults.push({
        loanId: loan.id,
        accountNo: loan.accountNo || loan.externalId || loan.id.toString(),
        borrowerName: client.name,
        productName: loan.productName || '',
        status: typeof loan.status === 'string' ? loan.status : loan.status?.value || '',
        balance: loan.loanBalance ?? loan.summary?.totalOutstanding ?? null,
        amountDue: loan.amountInArrears ?? loan.summary?.totalOverdue ?? null,
        interestRate: loan.annualInterestRate ?? loan.interestRatePerPeriod ?? null,
        daysLate: null,
        maturityDate: null,
        enrichmentQueued: false,
        entity: {
          entityId: loan.id,
          entityAccountNo: loan.accountNo,
          entityExternalId: loan.externalId,
          entityName: loan.accountNo,
          entityType: 'LOAN',
          parentId: client.clientId,
          parentName: client.name,
          entityStatus: typeof loan.status === 'object' ? loan.status : null,
          parentType: 'client',
          subEntityType: ''
        } as SearchData
      });
      added = true;
    });

    if (added) {
      this.updateTotalResults();
      this.enrichVisibleLoans();
    }
  }

  private updateTotalResults() {
    this.totalResults =
      this.clientResults.length +
      this.loanResults.length +
      this.genericSections.reduce((total, section) => total + section.rows.length, 0);
  }

  /** Loads account figures for visible loan rows, like the loan list page. */
  private enrichVisibleLoans() {
    const pending = this.visibleLoanResults().filter((loan) => !loan.enrichmentQueued);
    if (!pending.length) {
      return;
    }
    pending.forEach((loan) => {
      loan.enrichmentQueued = true;
      this.loadingLoanIds.add(loan.loanId);
    });

    from(pending)
      .pipe(
        mergeMap(
          (loan) =>
            this.loansService.getLoanAccountAssociationDetails(loan.loanId.toString()).pipe(
              catchError(() => of(null)),
              map((details) => ({ loan, details }))
            ),
          8
        ),
        takeUntil(this.destroy$)
      )
      .subscribe(({ loan, details }) => {
        this.applyLoanDetails(loan, details);
        this.loadingLoanIds.delete(loan.loanId);
      });
  }

  private applyLoanDetails(loan: LoanResult, details: any) {
    if (!details) {
      return;
    }
    loan.accountNo = details.accountNo || loan.accountNo;
    loan.borrowerName = details.clientName || details.group?.name || loan.borrowerName;
    loan.productName = details.loanProductName || '';
    loan.status = details.status?.value || loan.status;
    loan.balance = details.summary?.totalOutstanding ?? details.totalOutstanding ?? null;
    loan.amountDue = details.summary?.totalOverdue ?? details.totalOverdue ?? details.amountInArrears ?? 0;
    loan.interestRate = details.annualInterestRate ?? details.interestRatePerPeriod ?? null;
    loan.daysLate = this.getLoanDaysLate(details);
    loan.maturityDate = details.timeline?.expectedMaturityDate || details.timeline?.actualMaturityDate || null;
  }

  private getLoanDaysLate(details: any): number | null {
    const daysLate = details.daysLate ?? details.delinquent?.delinquentDays ?? details.delinquent?.pastDueDays;
    if (daysLate !== undefined && daysLate !== null) {
      return daysLate;
    }
    const overdueSince = details.summary?.overdueSinceDate;
    if (!overdueSince) {
      return null;
    }
    const date = Array.isArray(overdueSince)
      ? new Date(overdueSince[0], overdueSince[1] - 1, overdueSince[2])
      : new Date(overdueSince);
    return Math.max(Math.floor((Date.now() - date.getTime()) / 86400000), 0);
  }
}
