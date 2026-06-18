/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports. */
import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatSort, Sort, MatSortHeader } from '@angular/material/sort';
import {
  MatTableDataSource,
  MatTable,
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
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

/** rxjs Imports */
import { forkJoin, from, Observable, of, Subject, Subscription } from 'rxjs';
import {
  catchError,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  map,
  mergeMap,
  switchMap,
  takeUntil
} from 'rxjs/operators';

/** Custom Services */
import { environment } from '../../environments/environment';
import { ClientsService } from './clients.service';
import { ClientListCacheService } from './services/client-list-cache.service';
import { Dates } from 'app/core/utils/dates';
import { SettingsService } from 'app/settings/settings.service';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { MatProgressBar } from '@angular/material/progress-bar';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { SearchService } from 'app/search/search.service';

export const DEBOUNCE_MS = 500;

@Component({
  selector: 'mifosx-clients',
  templateUrl: './clients.component.html',
  styleUrls: ['./clients.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    MatCheckbox,
    FaIconComponent,
    MatProgressBar,
    MatProgressSpinner,
    MatTable,
    MatSort,
    MatColumnDef,
    MatHeaderCellDef,
    MatHeaderCell,
    MatSortHeader,
    MatCellDef,
    MatCell,
    MatHeaderRowDef,
    MatHeaderRow,
    MatRowDef,
    MatRow,
    MatPaginator,
    MatIconButton,
    MatIcon
  ]
})
export class ClientsComponent implements OnInit, OnDestroy {
  private clientService = inject(ClientsService);
  private formBuilder = inject(UntypedFormBuilder);
  private searchService = inject(SearchService);
  private dateUtils = inject(Dates);
  private settingsService = inject(SettingsService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  private clientCache = inject(ClientListCacheService);

  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  private clientsRequestSub: Subscription | null = null;
  private entityIdsRequestSub: Subscription | null = null;
  private isComposing = false;
  private readonly entityIdColumnNames = [
    'EntityID',
    'Entity Id',
    'entity_id'
  ];

  /** Returns true if client data masking is enabled */
  get hideClientData(): boolean {
    return environment.complianceHideClientData;
  }

  /** Mask a client name */
  maskName(name: string): string {
    if (!name) return '';
    return name
      .split(' ')
      .map((part) => (part.length > 1 ? part[0] + '*'.repeat(part.length - 1) : part))
      .join(' ');
  }

  /** Check if a specific client row is loading its details */
  isClientLoading(clientId: number): boolean {
    return this.loadingClientIds.has(clientId);
  }

  @ViewChild('showClosedAccounts') showClosedAccounts: MatCheckbox;

  displayedColumns = [
    'displayName',
    'entityIdNumber',
    'activeBalance',
    'overdueBalance',
    'daysInArrears',
    'activeLoansCount'
  ];
  dataSource: MatTableDataSource<any> = new MatTableDataSource();
  duplicateClientGroups: Array<{ name: string; clients: any[]; primaryClient: any }> = [];
  showAdvancedOptions = false;
  duplicateMergeForm: UntypedFormGroup;
  duplicateMergeClosureReasons: any[] = [];
  duplicateMergeTemplateLoading = false;
  duplicateMergeTemplateLoaded = false;
  mergingClientIds: number[] = [];

  existsClientsToFilter = false;
  notExistsClientsToFilter = false;

  totalRows: number;
  isLoading = false;
  localSort = false;
  loadingClientIds = new Set<number>();

  pageSize = 50;
  currentPage = 0;
  filterText = '';

  sortAttribute = '';
  sortDirection = '';

  @ViewChild(MatPaginator) paginator: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;

  ngOnInit() {
    this.createDuplicateMergeForm();
    this.searchInput$
      .pipe(debounceTime(DEBOUNCE_MS), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((value) => {
        if (value !== this.filterText) {
          this.search(value);
        }
      });

    if (environment.preloadClients) {
      this.getClients();
    }
  }

  createDuplicateMergeForm(): void {
    this.duplicateMergeForm = this.formBuilder.group({
      closureReasonId: [
        '',
        Validators.required
      ],
      confirmDestructiveMerge: [
        false,
        Validators.requiredTrue
      ]
    });
  }

  ngOnDestroy() {
    this.clientsRequestSub?.unsubscribe();
    this.entityIdsRequestSub?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(value: string) {
    if (this.isComposing) return;
    this.searchInput$.next(value);
  }

  onCompositionStart(): void {
    this.isComposing = true;
  }

  onCompositionEnd(value: string): void {
    this.isComposing = false;
    this.searchInput$.next(value);
  }

  /**
   * Searches server for query and resource.
   */
  search(value: string) {
    this.filterText = value;
    if (this.paginator?.pageIndex !== 0) {
      this.resetPaginator();
      return;
    }
    this.getClients();
  }

  private getClients() {
    this.localSort = false;
    this.dataSource.paginator = null;
    this.clientsRequestSub?.unsubscribe();
    this.entityIdsRequestSub?.unsubscribe();

    const cacheKey = this.clientCache.pageKey(this.filterText, this.currentPage, this.pageSize);
    const cached = this.clientCache.get(cacheKey);

    if (cached) {
      this.dataSource.data = cached.clients;
      this.totalRows = cached.totalRows;
      this.existsClientsToFilter = cached.clients.length > 0;
      this.notExistsClientsToFilter = !this.existsClientsToFilter;
      this.refreshDuplicateClientGroups();
      if (!this.clientCache.isStale(cached)) {
        return;
      }
      // Stale: show cached, refresh in background without loading spinner
    } else {
      this.isLoading = true;
    }

    this.clientsRequestSub = this.clientService
      .searchByText(this.filterText, this.currentPage, this.pageSize, this.sortAttribute, this.sortDirection)
      .pipe(
        switchMap((data: any) => {
          const clients = data.content || [];
          if (!this.filterText.trim()) {
            return of({
              data,
              clients
            });
          }

          return this.getGlobalClientSearchResults(this.filterText, clients).pipe(
            map((globalClients: any[]) => {
              const mergedClients = this.mergeClientSearchResults(clients, globalClients);
              return {
                data: {
                  ...data,
                  totalElements: Math.max(data.totalElements || 0, mergedClients.length),
                  numberOfElements: mergedClients.length
                },
                clients: mergedClients
              };
            })
          );
        })
      )
      .subscribe(
        ({ data, clients }: { data: any; clients: any[] }) => {
          this.dataSource.data = clients;
          this.refreshDuplicateClientGroups();

          this.totalRows = data.totalElements;

          this.existsClientsToFilter = data.numberOfElements > 0;
          this.notExistsClientsToFilter = !this.existsClientsToFilter;
          this.isLoading = false;
          this.loadClientRowDetails(clients, undefined, cacheKey);
        },
        (error: any) => {
          this.isLoading = false;
        }
      );
  }

  private getGlobalClientSearchResults(query: string, existingClients: any[] = []): Observable<any[]> {
    const existingClientIds = this.getClientIds(existingClients);
    return this.searchService.getSearchResults(query, 'clients,clientIdentifiers', true).pipe(
      map((searchResults: any[]) =>
        this.getClientIdsFromSearchResults(searchResults)
          .filter((clientId: string) => !existingClientIds.has(clientId))
          .slice(0, this.pageSize)
      ),
      switchMap((clientIds: string[]) => {
        if (!clientIds.length) {
          return of([]);
        }

        return forkJoin(
          clientIds.map((clientId: string) =>
            this.clientService.getClientData(clientId).pipe(catchError(() => of(null)))
          )
        );
      }),
      map((clients: any[]) => clients.filter((client: any) => !!client)),
      catchError(() => of([]))
    );
  }

  private getClientIdsFromSearchResults(searchResults: any[]): string[] {
    const clientIds = new Set<string>();

    (searchResults || []).forEach((result: any) => {
      const entityType = (result.entityType || '').toUpperCase().replace(/[_\s-]/g, '');
      const clientId =
        entityType === 'CLIENTIDENTIFIER' ? result.parentId : entityType === 'CLIENT' ? result.entityId : null;
      if (clientId) {
        clientIds.add(clientId.toString());
      }
    });

    return Array.from(clientIds);
  }

  private mergeClientSearchResults(clients: any[], globalClients: any[]): any[] {
    const clientsById = new Map<string, any>();

    [
      ...clients,
      ...globalClients
    ].forEach((client: any) => {
      const clientId = this.getClientId(client);
      clientsById.set(clientId || `client-${clientsById.size}`, client);
    });

    return Array.from(clientsById.values());
  }

  private getClientIds(clients: any[]): Set<string> {
    return new Set(clients.map((client: any) => this.getClientId(client)).filter((clientId: string) => !!clientId));
  }

  private getClientId(client: any): string {
    return (client?.id || client?.clientId || client?.entityId || '').toString();
  }

  private loadClientRowDetails(clients: any[], sortEvent?: Sort, cacheKey?: string): void {
    this.entityIdsRequestSub?.unsubscribe();

    if (clients.length === 0) {
      this.isLoading = false;
      return;
    }

    this.loadingClientIds = new Set(clients.map((client: any) => client.id));

    this.entityIdsRequestSub = forkJoin(clients.map((client: any) => this.getClientRowDetails(client)))
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (
          clientDetails: Array<{
            entityIdNumber: string | number | null;
            loanOfficer: string;
            activeBalance: number | null;
            overdueBalance: number | null;
            daysInArrears: number | null;
            activeLoansCount: number | null;
          }>
        ) => {
          const enrichedClients = clients.map((client: any, index: number) => ({
            ...client,
            entityIdNumber: clientDetails[index].entityIdNumber,
            loanOfficer: clientDetails[index].loanOfficer,
            activeBalance: clientDetails[index].activeBalance,
            overdueBalance: clientDetails[index].overdueBalance,
            daysInArrears: clientDetails[index].daysInArrears,
            activeLoansCount: clientDetails[index].activeLoansCount
          }));
          this.dataSource.data = enrichedClients;
          if (cacheKey) {
            this.clientCache.set(cacheKey, enrichedClients, this.totalRows);
          }
          this.loadingClientIds.clear();
          this.refreshDuplicateClientGroups();
          if (sortEvent) {
            this.applyLocalSort(sortEvent);
            this.localSort = true;
            this.dataSource.paginator = this.paginator;
          }
          this.isLoading = false;
        }
      );
  }

  private applyLocalSort(event: Sort): void {
    this.dataSource.data = [...this.dataSource.data].sort(this.makeSortComparator(event));
  }

  toggleAdvancedOptions(): void {
    this.showAdvancedOptions = !this.showAdvancedOptions;
    if (this.showAdvancedOptions) {
      this.loadDuplicateMergeTemplate();
    }
  }

  private loadDuplicateMergeTemplate(): void {
    if (this.duplicateMergeTemplateLoaded || this.duplicateMergeTemplateLoading) {
      return;
    }
    this.duplicateMergeTemplateLoading = true;
    this.clientService.getClientCommandTemplate('close').subscribe({
      next: (templateData: any) => {
        this.duplicateMergeClosureReasons = templateData?.narrations || [];
        this.duplicateMergeTemplateLoaded = true;
        this.duplicateMergeTemplateLoading = false;
      },
      error: () => {
        this.duplicateMergeTemplateLoading = false;
      }
    });
  }

  private refreshDuplicateClientGroups(): void {
    const groups = new Map<string, any[]>();
    this.dataSource.data.forEach((client: any) => {
      const normalizedName = this.normalizeClientName(client.displayName);
      if (!normalizedName) {
        return;
      }
      const group = groups.get(normalizedName) || [];
      group.push(client);
      groups.set(normalizedName, group);
    });

    this.duplicateClientGroups = Array.from(groups.values())
      .filter((clients: any[]) => clients.length > 1)
      .map((clients: any[]) => ({
        name: clients[0].displayName,
        clients,
        primaryClient: this.getPrimaryDuplicateClientCandidate(clients)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private normalizeClientName(name: string): string {
    return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private getPrimaryDuplicateClientCandidate(clients: any[]): any {
    return [...clients].sort((a: any, b: any) => {
      const aHasEntityId = a.entityIdNumber ? 1 : 0;
      const bHasEntityId = b.entityIdNumber ? 1 : 0;
      if (aHasEntityId !== bHasEntityId) {
        return bHasEntityId - aHasEntityId;
      }
      return (a.id || 0) - (b.id || 0);
    })[0];
  }

  isPrimaryDuplicateClient(group: any, client: any): boolean {
    return group.primaryClient?.id === client.id;
  }

  isMergingDuplicateClient(client: any): boolean {
    return this.mergingClientIds.includes(client.id);
  }

  mergeDuplicateClient(group: any, client: any): void {
    if (
      this.isPrimaryDuplicateClient(group, client) ||
      this.duplicateMergeForm.invalid ||
      this.isMergingDuplicateClient(client)
    ) {
      return;
    }

    const dateFormat = this.settingsService.dateFormat;
    const data = {
      closureDate: this.dateUtils.formatDate(this.settingsService.businessDate, dateFormat),
      closureReasonId: this.duplicateMergeForm.get('closureReasonId').value,
      dateFormat,
      locale: this.settingsService.language.code
    };

    this.mergingClientIds = [
      ...this.mergingClientIds,
      client.id
    ];
    this.clientService.executeClientCommand(client.id.toString(), 'close', data).subscribe({
      next: () => {
        this.mergingClientIds = this.mergingClientIds.filter((clientId: number) => clientId !== client.id);
        this.snackBar.open(
          this.translateService.instant('labels.text.Duplicate client merged into primary candidate.'),
          this.translateService.instant('labels.buttons.Close'),
          { duration: 3000 }
        );
        this.getClients();
      },
      error: () => {
        this.mergingClientIds = this.mergingClientIds.filter((clientId: number) => clientId !== client.id);
      }
    });
  }

  private getClientRowDetails(client: any): Observable<{
    entityIdNumber: string | number | null;
    loanOfficer: string;
    activeBalance: number | null;
    overdueBalance: number | null;
    daysInArrears: number | null;
    activeLoansCount: number | null;
  }> {
    const clientId = client.id?.toString();
    if (!clientId) {
      return forkJoin({
        entityIdNumber: of(null),
        loanOfficer: this.getClientLoanOfficer(client),
        activeBalance: of(null),
        overdueBalance: of(null),
        daysInArrears: of(null),
        activeLoansCount: of(null)
      });
    }

    const loanMetrics$ = this.clientService.getClientLoans(clientId).pipe(
      switchMap((data: any) => {
        const allLoans: any[] = data?.pageItems || data?.content || [];
        const activeLoans = allLoans.filter((loan: any) => {
          const status = loan?.status;
          if (!status) return false;
          if (typeof status === 'string') return status.toLowerCase() === 'active';
          if (typeof status === 'object') return status?.value?.toLowerCase() === 'active' || status?.active === true;
          return false;
        });
        const activeBalance = activeLoans.reduce(
          (sum: number, l: any) => sum + (l.loanBalance ?? l.summary?.totalOutstanding ?? l.totalOutstanding ?? 0),
          0
        );
        const overdueBalance = activeLoans.reduce(
          (sum: number, l: any) => sum + (l.amountInArrears ?? l.totalOverdue ?? l.summary?.totalOverdue ?? 0),
          0
        );
        const activeLoansCount = activeLoans.length;

        // Try to get days from the list response first (works when delinquency module is active)
        const daysFromList = activeLoans.reduce(
          (max: number, l: any) => Math.max(max, this.getLoanDaysInArrears(l)),
          0
        );
        if (daysFromList > 0) {
          return of({ activeBalance, overdueBalance, daysInArrears: daysFromList, activeLoansCount });
        }

        // Fall back to per-loan detail calls for in-arrears loans
        const inArrearsLoans = activeLoans.filter((l: any) => l.inArrears === true);
        if (!inArrearsLoans.length) {
          return of({ activeBalance, overdueBalance, daysInArrears: 0, activeLoansCount });
        }

        return forkJoin(
          inArrearsLoans.map((loan: any) =>
            this.clientService.getLoanDetails(loan.id.toString()).pipe(
              map((detail: any) => this.getLoanDaysInArrears(detail)),
              catchError(() => of(0 as number))
            )
          )
        ).pipe(
          map((days: number[]) => ({
            activeBalance,
            overdueBalance,
            daysInArrears: days.reduce((max, d) => Math.max(max, d), 0),
            activeLoansCount
          }))
        );
      }),
      catchError(() => of({ activeBalance: null, overdueBalance: null, daysInArrears: null, activeLoansCount: null }))
    );

    return forkJoin({
      entityIdNumber: this.getClientEntityId(clientId),
      loanOfficer: this.getClientLoanOfficer(client),
      loanMetrics: loanMetrics$
    }).pipe(
      map(({ loanMetrics, ...rest }) => ({ ...rest, ...loanMetrics })),
      catchError(() =>
        forkJoin({
          entityIdNumber: this.getClientEntityId(clientId),
          loanOfficer: this.getClientLoanOfficer(client),
          activeBalance: of(null) as Observable<number | null>,
          overdueBalance: of(null) as Observable<number | null>,
          daysInArrears: of(null) as Observable<number | null>,
          activeLoansCount: of(null) as Observable<number | null>
        })
      )
    );
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

  private getClientEntityId(clientId: string | null | undefined): Observable<string | number | null> {
    if (!clientId) {
      return of(null);
    }

    return (this.clientService.getClientIdentifiers(clientId) as Observable<any[]>).pipe(
      map((identifiers: any[]) => {
        const normalizedNames = this.entityIdColumnNames.map((n: string) => this.normalizeColumnName(n));
        const match = (identifiers || []).find((identifier: any) =>
          normalizedNames.includes(this.normalizeColumnName(identifier?.documentType?.name))
        );
        return match?.documentKey ?? null;
      }),
      catchError(() => of(null))
    );
  }

  private getClientLoanOfficer(client: any): Observable<string> {
    const existingLoanOfficer = this.getLoanOfficerValue(client);
    if (existingLoanOfficer || !client?.id) {
      return of(existingLoanOfficer);
    }

    return this.clientService.getClientData(client.id.toString()).pipe(
      map((clientData: any) => this.getLoanOfficerValue(clientData)),
      catchError(() => of(''))
    );
  }

  private getLoanOfficerValue(client: any): string {
    const loanOfficer = client?.loanOfficer;
    const staff = client?.staff;
    if (typeof loanOfficer === 'string') {
      return loanOfficer;
    }
    if (typeof staff === 'string') {
      return staff;
    }
    return (
      client?.loanOfficerName ||
      client?.staffName ||
      client?.staffDisplayName ||
      loanOfficer?.displayName ||
      staff?.displayName ||
      ''
    );
  }

  private normalizeColumnName(columnName: string): string {
    return (columnName || '').replace(/[_\s-]/g, '').toLowerCase();
  }

  pageChanged(event: PageEvent) {
    this.pageSize = event.pageSize;
    if (this.localSort) {
      return;
    }
    this.currentPage = event.pageIndex;
    this.getClients();
  }

  sortChanged(event: Sort) {
    const clientSideColumns = [
      'activeBalance',
      'overdueBalance',
      'entityIdNumber',
      'daysInArrears',
      'activeLoansCount'
    ];
    if (clientSideColumns.includes(event.active)) {
      if (event.direction === '') {
        return;
      }
      if (this.localSort) {
        this.applyLocalSort(event);
      } else {
        this.loadAllClientsAndSort(event);
      }
      return;
    }
    if (event.direction === '') {
      this.sortDirection = '';
      this.sortAttribute = '';
    } else {
      this.sortAttribute = event.active;
      this.sortDirection = event.direction;
    }
    this.resetPaginator();
    this.getClients();
  }

  private loadAllClientsAndSort(sortEvent: Sort): void {
    const fullCacheKey = this.clientCache.fullKey(this.filterText);
    const cached = this.clientCache.get(fullCacheKey);
    const sortFn = this.makeSortComparator(sortEvent);

    if (cached) {
      this.dataSource.data = [...cached.clients].sort(sortFn);
      this.totalRows = cached.totalRows;
      this.localSort = true;
      this.dataSource.paginator = this.paginator;
      if (!this.clientCache.isStale(cached)) {
        return;
      }
      // Stale: show cached sorted, refresh all clients in background
      this.clientsRequestSub?.unsubscribe();
      this.entityIdsRequestSub?.unsubscribe();
      const enriched = [...cached.clients];
      const loadedIds = new Set<number>(enriched.map((c: any) => c.id));
      this.runPageByPageLoad(sortFn, fullCacheKey, false, enriched, loadedIds, true);
      return;
    }

    // No cache: seed with current page, load rest with loading indicator
    this.isLoading = true;
    this.clientsRequestSub?.unsubscribe();
    this.entityIdsRequestSub?.unsubscribe();

    const enriched: any[] = [...this.dataSource.data];
    const loadedIds = new Set<number>(enriched.map((c: any) => c.id));
    this.dataSource.data = [...enriched].sort(sortFn);
    this.localSort = true;
    this.dataSource.paginator = this.paginator;

    this.runPageByPageLoad(sortFn, fullCacheKey, true, enriched, loadedIds, false);
  }

  private runPageByPageLoad(
    sortFn: (a: any, b: any) => number,
    cacheKey: string,
    showLoading: boolean,
    enriched: any[],
    loadedIds: Set<number>,
    refreshExisting: boolean
  ): void {
    const totalPages = Math.ceil((this.totalRows || 0) / this.pageSize);
    const pages = Array.from({ length: totalPages }, (_, i) => i).filter((p) =>
      showLoading ? p !== this.currentPage : true
    );

    if (pages.length === 0) {
      if (showLoading) {
        this.isLoading = false;
        this.clientCache.set(cacheKey, enriched, this.totalRows);
      }
      return;
    }

    this.entityIdsRequestSub = from(pages)
      .pipe(
        concatMap((page) =>
          this.clientService.searchByText(this.filterText, page, this.pageSize, '', '').pipe(
            switchMap((data: any) => {
              const pageClients: any[] = data.content || [];
              if (refreshExisting) {
                // Background refresh: re-fetch details for ALL clients, add truly new ones to enriched
                pageClients.forEach((c: any) => {
                  if (!loadedIds.has(c.id)) {
                    loadedIds.add(c.id);
                    enriched.push({ ...c });
                  }
                });
                return from(pageClients).pipe(
                  mergeMap(
                    (client: any) =>
                      this.getClientRowDetails(client).pipe(
                        map((details) => ({ client, details })),
                        catchError(() => of({ client, details: null }))
                      ),
                    20
                  )
                );
              } else {
                // Initial load: only fetch details for clients not yet in enriched
                const newClients = pageClients.filter((c: any) => {
                  if (!loadedIds.has(c.id)) {
                    loadedIds.add(c.id);
                    enriched.push({ ...c });
                    return true;
                  }
                  return false;
                });
                return from(newClients).pipe(
                  mergeMap(
                    (client: any) =>
                      this.getClientRowDetails(client).pipe(
                        map((details) => ({ client, details })),
                        catchError(() => of({ client, details: null }))
                      ),
                    20
                  )
                );
              }
            }),
            catchError(() => of(null))
          )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (result: any) => {
          if (!result) return;
          const { client, details } = result;
          const idx = enriched.findIndex((c: any) => c.id === client.id);
          if (idx !== -1 && details) enriched[idx] = { ...enriched[idx], ...details };
          this.dataSource.data = [...enriched].sort(sortFn);
        },
        complete: () => {
          if (showLoading) this.isLoading = false;
          this.clientCache.set(cacheKey, [...enriched], this.totalRows);
        }
      });
  }

  private makeSortComparator(event: Sort): (a: any, b: any) => number {
    const dir = event.direction === 'asc' ? 1 : -1;
    return (a: any, b: any) => {
      const aRaw = a[event.active] ?? 0;
      const bRaw = b[event.active] ?? 0;
      if (typeof aRaw === 'number' && typeof bRaw === 'number') return (aRaw - bRaw) * dir;
      return String(aRaw).localeCompare(String(bRaw)) * dir;
    };
  }

  private resetPaginator() {
    this.currentPage = 0;
    this.paginator.firstPage();
  }
}
