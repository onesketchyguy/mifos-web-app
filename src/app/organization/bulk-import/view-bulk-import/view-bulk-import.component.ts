/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { ChangeDetectorRef, Component, HostListener, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { MatProgressBar } from '@angular/material/progress-bar';
import {
  MatAccordion,
  MatExpansionPanel,
  MatExpansionPanelDescription,
  MatExpansionPanelHeader,
  MatExpansionPanelTitle
} from '@angular/material/expansion';
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
import { UntypedFormGroup, UntypedFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

/** Custom Imports */
import { ClientsService } from 'app/clients/clients.service';
import { LegalFormId } from 'app/clients/models/legal-form.enum';
import { LoansService } from 'app/loans/loans.service';
import { ProductsService } from 'app/products/products.service';
import { SearchService } from 'app/search/search.service';
import { SettingsService } from 'app/settings/settings.service';
import { Dates } from 'app/core/utils/dates';
import { AlertService } from 'app/core/alert/alert.service';
import { SystemService } from 'app/system/system.service';
import { OrganizationService } from '../../organization.service';
import { IvyTekCsvParserService } from '../ivytek-import/ivytek-csv-parser.service';
import { IvyTekFieldMappingService } from '../ivytek-import/ivytek-field-mapping.service';
import {
  IvyTekCsvRow,
  IvyTekDatatableColumnReference,
  IvyTekSourceFileType,
  IvyTekSourceFileRows,
  IvyTekUnmappedFieldWarning
} from '../ivytek-import/ivytek-import.models';
import { BulkImports } from './bulk-imports';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatButton, MatIconButton } from '@angular/material/button';
import { FileUploadComponent } from '../../../shared/file-upload/file-upload.component';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { DateFormatPipe } from '../../../pipes/date-format.pipe';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';

/**
 * View Bulk Imports Component
 */
@Component({
  selector: 'mifosx-view-bulk-import',
  templateUrl: './view-bulk-import.component.html',
  styleUrls: ['./view-bulk-import.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    FileUploadComponent,
    MatHint,
    MatTable,
    MatSort,
    MatColumnDef,
    MatHeaderCellDef,
    MatHeaderCell,
    MatSortHeader,
    MatCellDef,
    MatCell,
    MatIconButton,
    FaIconComponent,
    MatHeaderRowDef,
    MatHeaderRow,
    MatRowDef,
    MatRow,
    MatPaginator,
    MatProgressBar,
    MatAccordion,
    MatExpansionPanel,
    MatExpansionPanelHeader,
    MatExpansionPanelTitle,
    MatExpansionPanelDescription,
    DateFormatPipe
  ]
})
export class ViewBulkImportComponent implements OnInit {
  private readonly ivyTekClientTribalDatatableName = 'Client Tribal Data';
  private readonly ivyTekLoanTribalDatatableName = 'Tribal Loan Data';
  private readonly ivyTekSqlTransactionHistoryTableName = 'm_loan_transaction';
  private readonly ivyTekPipelineRunStorageKey = 'mifosx.ivyTekImportPipelineRun';
  private readonly ivyTekImportConcurrency = 10;
  private readonly ivyTekAnnualInterestRateFrequencyType = 3;
  private readonly ivyTekStaticSnapshotImport = true;
  /**
   * History-start import (approach A): active migrated loans are re-originated at their
   * first recorded repayment date with the reconstructed opening balance and disbursed
   * natively (full amount, via transactionAmount), so Fineract generates a real
   * repayment schedule and every loan is fully serviceable. The IvyTek payment history
   * is then posted as real repayment transactions, which reduce the opening balance back
   * to BalanceNow — so principal stays exactly 1:1 while the loan can be serviced,
   * undone, and accrues interest going forward. This replaces the SQL schedule-forging
   * approach, which produced loans whose schedule could never be reconciled (the
   * repayment template 500'd and any payment tripped the multi-disburse threshold guard).
   */
  private readonly ivyTekHistoryStartImport = true;
  // History-start mode posts the IvyTek payment history as real REST repayments instead
  // of raw-inserting them via the SQL transaction stage, so the schedule reprocesses.
  private readonly ivyTekPostHistoricalRepaymentsToFineract = true;
  /**
   * Full-SQL loan import: the REST stage only creates loan shells; every balance,
   * date, schedule, and arrears value is then written directly from IvyTek source
   * truth by /api/ivytek/loan-state-sync. Fineract never computes interest or
   * arrears for migrated loans, so no date corrections or migration repayments
   * are needed on the REST path.
   *
   * Disabled for history-start mode: SQL forging cannot regenerate
   * m_loan_repayment_schedule, so a forged loan is never serviceable. Fineract must
   * own the schedule via a native disbursement instead ([[ivyTekHistoryStartImport]]).
   */
  private readonly ivyTekFullSqlLoanImport = false;
  private readonly ivyTekDefaultChargeName = '';
  private readonly ivyTekDefaultChargeAmountSource = 'amount_financed';
  private readonly ivyTekImportNames = [
    'IvyTek Import',
    'IvyTek Clients',
    'IvyTek Loans',
    'IvyTek Transactions'
  ];

  private route = inject(ActivatedRoute);
  private formBuilder = inject(UntypedFormBuilder);
  private organizationService = inject(OrganizationService);
  private clientsService = inject(ClientsService);
  private loansService = inject(LoansService);
  private productsService = inject(ProductsService);
  private searchService = inject(SearchService);
  private settingsService = inject(SettingsService);
  private dateUtils = inject(Dates);
  private alertService = inject(AlertService);
  private systemService = inject(SystemService);
  private ivyTekCsvParser = inject(IvyTekCsvParserService);
  private ivyTekFieldMapping = inject(IvyTekFieldMappingService);
  private cdr = inject(ChangeDetectorRef);
  /** Wall-clock time of the last forced progress render, used to throttle change detection. */
  private lastIvyTekProgressRenderAt = 0;
  private ivyTekClientAddressTemplate: any = null;
  private ivyTekClientAddressTemplateUnavailable = false;
  /** Fineract tenant business date fetched at import time; caps corrected loan dates. */
  private ivyTekFineractBusinessDate: Date | null = null;
  private ivyTekLoanTribalDatatableColumns: any[] = [];
  private ivyTekEntityDatatableDefinitionsByAppTable = new Map<string, any[]>();
  private ivyTekDatatableColumnsByAppTable = new Map<string, IvyTekDatatableColumnReference[]>();

  /** offices Data */
  officeData: any;
  /** staff Data */
  staffData: any;
  /** Entity Template */
  template: File;
  /** imports Data */
  importsData: any;
  /** bulk-import form. */
  bulkImportForm: UntypedFormGroup;
  /** IvyTek import form. */
  ivyTekImportForm: UntypedFormGroup;
  /** IvyTek selected result details form. */
  ivyTekResultDetailsForm: UntypedFormGroup;
  /** IvyTek CSV file. */
  ivyTekFile: File;
  /** IvyTek import processing flag. */
  ivyTekImporting = false;
  /** IvyTek import progress count. */
  ivyTekProcessedRecords = 0;
  /** IvyTek import total count. */
  ivyTekTotalRecords = 0;
  /** IvyTek import results. */
  ivyTekImportResults: any[] = [];
  /** IvyTek import pipeline error. */
  ivyTekPipelineError = '';
  /** IvyTek persisted staged import run summary. */
  ivyTekPipelineRun: any = null;
  /** Selected IvyTek import result. */
  selectedIvyTekResult: any;
  /** IvyTek retry processing flag. */
  ivyTekRetrying = false;
  /** IvyTek result groups. */
  ivyTekResultGroups = [
    {
      status: 'labels.inputs.Warning',
      title: 'labels.inputs.Warning'
    },
    {
      status: 'labels.inputs.Failed',
      title: 'labels.inputs.Failed'
    },
    {
      status: 'labels.inputs.Created',
      title: 'labels.inputs.Created'
    },
    {
      status: 'labels.inputs.Updated',
      title: 'labels.inputs.Updated'
    }
  ];
  /** IvyTek loan import form. */
  ivyTekLoanImportForm: UntypedFormGroup;
  /** Name of the directory the user selected (display only). */
  ivyTekDirectoryName = '';
  /** IvyTek loan CSV file. */
  ivyTekLoanFile: File;
  /** IvyTek application CSV file. */
  ivyTekApplicationFile: File;
  /** IvyTek contact application CSV file. */
  ivyTekLoanContactApplicationsFile: File;
  /** IvyTek loan import processing flag. */
  ivyTekLoanImporting = false;
  /** IvyTek loan import progress count. */
  ivyTekLoanProcessedRecords = 0;
  /** IvyTek loan import total count. */
  ivyTekLoanTotalRecords = 0;
  /** IvyTek loan import results. */
  ivyTekLoanImportResults: any[] = [];
  /** IvyTek loan result groups. */
  ivyTekLoanResultGroups = [
    {
      status: 'labels.inputs.Warning',
      title: 'labels.inputs.Warning'
    },
    {
      status: 'labels.inputs.Failed',
      title: 'labels.inputs.Failed'
    },
    {
      status: 'labels.inputs.Skipped',
      title: 'labels.inputs.Skipped'
    },
    {
      status: 'labels.inputs.Created',
      title: 'labels.inputs.Created'
    },
    {
      status: 'labels.inputs.Updated',
      title: 'labels.inputs.Updated'
    }
  ];
  /** IvyTek transaction history CSV file. */
  ivyTekTransactionFile: File;
  /** IvyTek transaction validation processing flag. */
  ivyTekTransactionImporting = false;
  /** IvyTek transaction validation progress count. */
  ivyTekTransactionProcessedRecords = 0;
  /** IvyTek transaction validation total count. */
  ivyTekTransactionTotalRecords = 0;
  /** IvyTek transaction validation results. */
  ivyTekTransactionImportResults: any[] = [];
  /** IvyTek transaction rows preserved for export/runbook. */
  ivyTekTransactionExportResults: any[] = [];
  /** Database connection form for the SQL import server. */
  ivyTekSqlDbForm: UntypedFormGroup;
  /** Whether the SQL import request is in flight. */
  ivyTekSqlImportRunning = false;
  /** Result returned by the SQL import server after the last run. */
  ivyTekSqlImportResult: any = null;
  /** Error message from the last SQL import attempt. */
  ivyTekSqlImportError: string | null = null;
  /** Whether the schedule-fix request is in flight. */
  ivyTekScheduleFixRunning = false;
  /** Result returned by the schedule-fix server after the last run. */
  ivyTekScheduleFixResult: any = null;
  /** Error message from the last schedule-fix attempt. */
  ivyTekScheduleFixError: string | null = null;
  /** Whether the full-SQL loan-state-sync request is in flight. */
  ivyTekLoanStateSyncRunning = false;
  /** Result returned by the loan-state-sync server after the last run. */
  ivyTekLoanStateSyncResult: any = null;
  /** Error message from the last loan-state-sync attempt. */
  ivyTekLoanStateSyncError: string | null = null;
  /** Loan CSV rows retained for the loan-state-sync step. */
  private ivyTekLoanStateSyncRows: any[] = [];
  /** Whether the interest-rate-fix request is in flight. */
  ivyTekInterestRateFixRunning = false;
  /** Result returned by the interest-rate-fix server after the last run. */
  ivyTekInterestRateFixResult: any = null;
  /** Error message from the last interest-rate-fix attempt. */
  ivyTekInterestRateFixError: string | null = null;
  /** CSV file selected for direct server-side import (bypasses Stage 3). */
  ivyTekSqlCsvFile: File | null = null;
  /** IvyTek Users CSV file (Salesforce export) for per-note user attribution. */
  ivyTekUsersFile: File | null = null;
  /** IvyTek FeedPost notes CSV file. */
  ivyTekFeedPostFile: File | null = null;
  /** Whether the FeedPost notes import request is in flight. */
  ivyTekFeedPostImportRunning = false;
  /** Result returned by the FeedPost import after the last run. */
  ivyTekFeedPostImportResult: any = null;
  /** Error message from the last FeedPost import attempt. */
  ivyTekFeedPostImportError: string | null = null;
  /** IvyTek ContentVersion attachments CSV file. */
  ivyTekContentVersionFile: File | null = null;
  /** Actual attachment files found in the ContentVersion/ subfolder. */
  ivyTekContentVersionFiles: File[] = [];
  /** Whether the ContentVersion attachment import is running. */
  ivyTekContentVersionImportRunning = false;
  /** Result from the last ContentVersion import attempt. */
  ivyTekContentVersionImportResult: any = null;
  /** Error from the last ContentVersion import attempt. */
  ivyTekContentVersionImportError: string | null = null;
  ivyTekCleanupBeforeImport = false;
  ivyTekCleanupRunning = false;
  ivyTekCleanupProcessedRecords = 0;
  ivyTekCleanupTotalRecords = 0;
  /** Whether the ContentVersion attachment upload loop is running. */
  ivyTekAttachmentImporting = false;
  /** Number of attachments uploaded so far in the current run. */
  ivyTekAttachmentProcessedRecords = 0;
  /** Total attachments to upload in the current run. */
  ivyTekAttachmentTotalRecords = 0;
  /** IvyTek reconciliation status translation key. */
  ivyTekReconciliationStatusKey = 'labels.text.Reconciliation Not Run';
  /** IvyTek reconciliation summary message. */
  ivyTekReconciliationStatusMessage = '';
  /** IvyTek transaction result groups. */
  ivyTekTransactionResultGroups = [
    {
      status: 'labels.inputs.Warning',
      title: 'labels.inputs.Warning'
    },
    {
      status: 'labels.inputs.Failed',
      title: 'labels.inputs.Failed'
    },
    {
      status: 'labels.inputs.Skipped',
      title: 'labels.inputs.Skipped'
    },
    {
      status: 'labels.inputs.Ready',
      title: 'labels.inputs.Ready'
    }
  ];
  /** array of deined bulk-imports */
  bulkImportsArray = BulkImports;
  /** bulk-import which user navigated to */
  bulkImport: any = {};
  /** Data source for imports table. */
  dataSource = new MatTableDataSource();
  /** Columns to be displayed in imports table. */
  displayedColumns: string[] = [
    'name',
    'importTime',
    'endTime',
    'completed',
    'totalRecords',
    'successCount',
    'failureCount',
    'download'
  ];
  /** Loan reconciliation results. */
  reconciliationResults: any[] = [];
  /** Columns to display in reconciliation results table. */
  reconciliationDisplayedColumns: string[] = [
    'loanId',
    'externalId',
    'clientName',
    'issue',
    'loanBalance',
    'principalOutstanding',
    'interestOutstanding'
  ];
  /** Flag indicating reconciliation is running. */
  isRunningReconciliation = false;
  /** Summary message for reconciliation results. */
  reconciliationSummary = '';

  get isIvyTekImportPage(): boolean {
    return this.ivyTekImportNames.includes(this.bulkImport?.name);
  }

  get isIvyTekSpecialImportPage(): boolean {
    return this.isIvyTekImportPage;
  }

  get isIvyTekPipelineRunning(): boolean {
    return (
      this.ivyTekImporting ||
      this.ivyTekLoanImporting ||
      this.ivyTekTransactionImporting ||
      this.ivyTekAttachmentImporting ||
      this.ivyTekCleanupRunning
    );
  }

  get hasPendingIvyTekPipelineRun(): boolean {
    return this.ivyTekPipelineRun?.status === 'labels.inputs.Running' && !this.isIvyTekPipelineRunning;
  }

  /**
   * Single source of truth for the live progress indicator shown while an IvyTek
   * import is running. Each stage used to render its own near-identical progress
   * block (clients, loans, transactions, attachment cleanup, attachment upload),
   * which meant several differently-worded bars competing for attention. This
   * collapses them into one view-model so the template renders exactly one bar,
   * always labelled with the operation actually in flight. Returns null when
   * nothing is running. `total` is 0/unknown only for the cleanup pass, which the
   * caller renders as an indeterminate bar.
   */
  get ivyTekActiveProgress(): {
    labelKey: string;
    processed: number;
    total: number;
    indeterminate: boolean;
  } | null {
    if (this.ivyTekImporting) {
      return {
        labelKey: 'labels.text.Processed IvyTek records',
        processed: this.ivyTekProcessedRecords,
        total: this.ivyTekTotalRecords,
        indeterminate: false
      };
    }
    if (this.ivyTekLoanImporting) {
      return {
        labelKey: 'labels.text.Processed IvyTek loan records',
        processed: this.ivyTekLoanProcessedRecords,
        total: this.ivyTekLoanTotalRecords,
        indeterminate: false
      };
    }
    if (this.ivyTekTransactionImporting) {
      return {
        labelKey: 'labels.text.Processed IvyTek transaction records',
        processed: this.ivyTekTransactionProcessedRecords,
        total: this.ivyTekTransactionTotalRecords,
        indeterminate: false
      };
    }
    if (this.ivyTekCleanupRunning) {
      return {
        labelKey: 'labels.text.Deleting existing IvyTek attachments',
        processed: this.ivyTekCleanupProcessedRecords,
        total: this.ivyTekCleanupTotalRecords,
        indeterminate: !this.ivyTekCleanupTotalRecords
      };
    }
    if (this.ivyTekAttachmentImporting) {
      return {
        labelKey: 'labels.text.Uploaded IvyTek attachments',
        processed: this.ivyTekAttachmentProcessedRecords,
        total: this.ivyTekAttachmentTotalRecords,
        indeterminate: false
      };
    }
    return null;
  }

  get ivyTekStartStage(): string {
    return this.ivyTekImportForm?.get('startStage')?.value || 'clients';
  }

  get canUploadIvyTekPipeline(): boolean {
    return (
      this.hasIvyTekRequiredFilesForStartStage() &&
      this.ivyTekImportForm.get('targetEntity').valid &&
      this.ivyTekImportForm.get('startStage').valid &&
      (this.ivyTekStartStage === 'transactions' ||
        this.ivyTekStartStage === 'notes' ||
        this.ivyTekStartStage === 'attachments' ||
        this.ivyTekImportForm.get('officeId').valid) &&
      this.hasIvyTekReconciliationDateForStartStage() &&
      this.ivyTekLoanImportForm.valid &&
      !this.isIvyTekPipelineRunning &&
      !this.hasPendingIvyTekPipelineRun
    );
  }

  get canRetryIvyTekPipeline(): boolean {
    return (
      this.hasIvyTekRequiredFilesForStartStage() &&
      this.ivyTekImportForm.get('targetEntity').valid &&
      this.ivyTekImportForm.get('startStage').valid &&
      (this.ivyTekStartStage === 'transactions' ||
        this.ivyTekStartStage === 'notes' ||
        this.ivyTekStartStage === 'attachments' ||
        this.ivyTekImportForm.get('officeId').valid) &&
      this.hasIvyTekReconciliationDateForStartStage() &&
      this.ivyTekLoanImportForm.valid &&
      !this.isIvyTekPipelineRunning
    );
  }

  /**
   * Checks the IvyTek export (reconciliation) date is set for stages that reconcile
   * interest to it — loan creation and the transaction import anchor accrual there.
   */
  private hasIvyTekReconciliationDateForStartStage(): boolean {
    if (this.ivyTekStartStage === 'notes' || this.ivyTekStartStage === 'attachments') {
      return true;
    }
    return !!this.getIvyTekReconciliationDateString();
  }

  get hasIvyTekExportableResults(): boolean {
    return (
      !!this.ivyTekImportResults.length ||
      !!this.ivyTekLoanImportResults.length ||
      !!this.ivyTekTransactionImportResults.length ||
      !!this.ivyTekTransactionExportResults.length
    );
  }

  get ivyTekPipelineStopped(): boolean {
    return (
      !this.isIvyTekPipelineRunning &&
      !this.ivyTekTransactionImportResults.length &&
      (this.hasIvyTekResultStatus(this.ivyTekImportResults, ['labels.inputs.Failed']) ||
        this.hasIvyTekResultStatus(this.ivyTekLoanImportResults, [
          'labels.inputs.Failed',
          'labels.inputs.Skipped'
        ]))
    );
  }

  /**
   * Checks whether the selected IvyTek start stage has its required CSV files.
   */
  private hasIvyTekRequiredFilesForStartStage(): boolean {
    if (this.ivyTekStartStage === 'attachments') {
      return !!this.ivyTekContentVersionFile;
    }
    if (this.ivyTekStartStage === 'notes') {
      return !!this.ivyTekFeedPostFile;
    }
    if (this.ivyTekStartStage === 'transactions') {
      return !!this.ivyTekLoanFile && !!this.ivyTekTransactionFile;
    }
    if (this.ivyTekStartStage === 'loans') {
      return !!this.ivyTekFile && !!this.ivyTekLoanFile && !!this.ivyTekLoanContactApplicationsFile;
    }
    return !!this.ivyTekFile && !!this.ivyTekLoanFile && !!this.ivyTekLoanContactApplicationsFile;
  }

  /**
   * Checks whether an IvyTek stage should run for the selected starting point.
   * @param {string} stage Stage key.
   */
  private shouldRunIvyTekStage(stage: string): boolean {
    const startStageIndex = this.getIvyTekStageIndex(this.ivyTekStartStage);
    const stageIndex = this.getIvyTekStageIndex(stage);
    return startStageIndex >= 0 && stageIndex >= startStageIndex;
  }

  /**
   * Gets the ordered IvyTek stage index.
   * @param {string} stage Stage key.
   */
  private getIvyTekStageIndex(stage: string): number {
    return [
      'clients',
      'loans',
      'transactions',
      'notes',
      'attachments'
    ].indexOf(stage);
  }

  /**
   * Gets the translated IvyTek stage label key.
   * @param {string} stage Stage key.
   */
  private getIvyTekStageLabel(stage: string): string {
    const labels: any = {
      clients: 'labels.heading.Stage 1 Clients',
      loans: 'labels.heading.Stage 2 Loans',
      transactions: 'labels.heading.Stage 3 Transactions',
      notes: 'labels.heading.Stage 4 Notes',
      attachments: 'labels.heading.Stage 5 Attachments'
    };
    return labels[stage] || labels.clients;
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeLeavingIvyTekImport(event: BeforeUnloadEvent) {
    if (!this.isIvyTekPipelineRunning) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  }

  @HostListener('window:storage', ['$event'])
  syncIvyTekPipelineRun(event: StorageEvent) {
    if (event.key === this.ivyTekPipelineRunStorageKey) {
      this.restoreIvyTekPipelineRun();
    }
  }

  /** Paginator for imports table. */
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  /** Sorter for imports table. */
  @ViewChild(MatSort, { static: true }) sort: MatSort;
  /** Imports table reference */
  @ViewChild('importsTable', { static: true }) importsTableRef: MatTable<Element>;

  /**
   * fetches offices and imports data from resolve
   * @param {ActivatedRoute} route ActivatedRoute
   * @param {FormBuilder} formBuilder FormBuilder
   * @param {OrganizationService} organizationService OrganizationService
   */
  constructor() {
    this.bulkImport.name = this.route.snapshot.params['import-name'];
    this.route.data.subscribe((data: any) => {
      this.officeData = data.offices;
      this.importsData = data.imports;
    });
  }

  /**
   * Gets bulk import's properties.
   */
  ngOnInit() {
    this.bulkImport = this.bulkImportsArray.find((entry) => entry.name === this.bulkImport.name);
    this.createBulkImportForm();
    this.buildDependencies();
    this.setImports();
    if (this.isIvyTekImportPage) {
      this.restoreIvyTekPipelineRun();
    }
  }

  /**
   * Creates the bulk import form.
   */
  createBulkImportForm() {
    this.bulkImportForm = this.formBuilder.group({
      officeId: [''],
      staffId: [''],
      legalForm: ['']
    });
    this.ivyTekImportForm = this.formBuilder.group({
      targetEntity: [
        'clients',
        Validators.required
      ],
      startStage: [
        'clients',
        Validators.required
      ],
      officeId: [
        '',
        Validators.required
      ],
      ivyTekExportDate: [
        '',
        Validators.required
      ]
    });
    this.ivyTekResultDetailsForm = this.formBuilder.group({
      firstName: [
        '',
        Validators.required
      ],
      middleName: [''],
      lastName: [
        '',
        Validators.required
      ],
      externalId: [
        '',
        Validators.required
      ],
      entityId: [''],
      phone: [''],
      otherPhone: [''],
      birthdate: ['']
    });
    this.ivyTekLoanImportForm = this.formBuilder.group({
      loanOfficerId: [''],
      chargeName: [this.ivyTekDefaultChargeName],
      chargeAmountSource: [
        this.ivyTekDefaultChargeAmountSource,
        Validators.required
      ],
      approveAndDisburse: [true],
      preserveHistoricalDates: [true]
    });
    this.ivyTekSqlDbForm = this.formBuilder.group({
      host: ['localhost'],
      port: [5432],
      dbname: ['fineract_default'],
      user: ['root'],
      password: ['']
    });
    this.applyFixedIvyTekImportOptions();
  }

  /**
   * Subscribe to value changes and fetches select options accordingly.
   */
  buildDependencies() {
    this.bulkImportForm.get('officeId').valueChanges.subscribe((value: any) => {
      if (this.bulkImport.formFields >= 2) {
        this.organizationService.getStaff(value).subscribe((data: any) => {
          this.staffData = data;
        });
      }
    });
    this.ivyTekImportForm.get('startStage').valueChanges.subscribe(() => {
      this.updateIvyTekOfficeValidators();
    });
    this.updateIvyTekOfficeValidators();
  }

  /**
   * Keeps the office requirement aligned with the selected IvyTek start stage.
   */
  private updateIvyTekOfficeValidators() {
    const officeControl = this.ivyTekImportForm.get('officeId');
    if (this.ivyTekStartStage === 'transactions') {
      officeControl.clearValidators();
    } else {
      officeControl.setValidators([Validators.required]);
    }
    officeControl.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Keeps single-value IvyTek import settings fixed while the UI stays focused on file selection.
   */
  private applyFixedIvyTekImportOptions() {
    this.ivyTekImportForm.patchValue(
      {
        targetEntity: 'clients',
        officeId: this.getIvyTekDefaultOfficeId()
      },
      { emitEvent: false }
    );
    this.ivyTekLoanImportForm.patchValue(
      {
        loanOfficerId: '',
        chargeName: this.ivyTekDefaultChargeName,
        chargeAmountSource: this.ivyTekDefaultChargeAmountSource,
        approveAndDisburse: true,
        preserveHistoricalDates: true
      },
      { emitEvent: false }
    );
  }

  /**
   * Gets the default WS CREDIT fallback office id.
   */
  private getIvyTekDefaultOfficeId(): any {
    const candidates = [
      '0',
      'WS CREDIT'
    ].map((value: string) => this.normalizeIvyTekOfficeLookupValue(value));
    const office = (this.officeData || []).find((officeData: any) => {
      const officeValues = [
        officeData?.externalId,
        officeData?.name,
        officeData?.displayName
      ].map((value: any) => this.normalizeIvyTekOfficeLookupValue(value));
      return officeValues.some((value: string) => candidates.includes(value));
    });
    return office?.id || this.ivyTekImportForm.get('officeId').value;
  }

  /**
   * Initializes the data source, paginator and sorter for imports table.
   */
  setImports() {
    this.dataSource = new MatTableDataSource(this.importsData);
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  /**
   * Gets bulk import's downloadable template from API.
   */
  downloadTemplate() {
    const officeId = this.bulkImportForm.get('officeId').value;
    const staffId = this.bulkImportForm.get('staffId').value;
    let legalFormType = '';
    /** Only for Client Bulk Imports */
    switch (this.bulkImportForm.get('legalForm').value) {
      case 'Person':
        legalFormType = 'CLIENTS_PERSON';
        break;
      case 'Entity':
        legalFormType = 'CLIENTS_ENTITY';
        break;
    }
    this.organizationService
      .getImportTemplate(this.bulkImport.urlSuffix, officeId, staffId, legalFormType)
      .subscribe((res: any) => {
        const contentType = res.headers.get('Content-Type');
        const blob = new Blob([res.body], { type: contentType });
        const fileOfBlob = new File([blob], 'template.xls', { type: contentType });
        window.open(window.URL.createObjectURL(fileOfBlob));
      });
  }

  /**
   * Sets file form control value.
   * @param {any} $event file change event.
   */
  onIvyTekDirectorySelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const files = Array.from(input.files);
    this.ivyTekDirectoryName = files[0]?.webkitRelativePath?.split('/')[0] ?? '';

    const csvFiles = files.filter((f) => f.name.toLowerCase().endsWith('.csv'));
    const norm = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

    const contactAppFile = csvFiles.find((f) => {
      const n = norm(f.name);
      return n.includes('contactapplication') || n.includes('contactapp');
    });
    const loanFile = csvFiles.find((f) => {
      const n = norm(f.name);
      return n.includes('loan') && !n.includes('counter') && !n.includes('projected') && !n.includes('rates');
    });
    const applicationFile = csvFiles.find((f) => {
      const n = norm(f.name);
      return n.includes('application') && !n.includes('contact') && !n.includes('checklist') && !n.includes('document');
    });
    const contactFile = csvFiles.find((f) => {
      const n = norm(f.name);
      return (
        n.includes('contact') &&
        !n.includes('ivytektestpkg') &&
        !n.includes('case') &&
        !n.includes('role') &&
        !n.includes('point') &&
        !n.includes('email') &&
        !n.includes('request')
      );
    });
    const transactionFile = csvFiles.find((f) => {
      const n = norm(f.name);
      return n.includes('transactions') && !n.includes('details');
    });
    const feedPostFile = csvFiles.find((f) => norm(f.name).includes('feedpost'));
    const usersFile = csvFiles.find((f) => {
      const n = norm(f.name);
      return (
        n === 'user' ||
        (n.startsWith('user') &&
          !n.includes('loan') &&
          !n.includes('contact') &&
          !n.includes('app') &&
          !n.includes('assistant') &&
          !n.includes('sum') &&
          !n.includes('item') &&
          !n.includes('nav'))
      );
    });
    const contentVersionCsvFile = csvFiles.find((f) => norm(f.name).includes('contentversion'));
    const contentVersionFiles = files.filter((f) => {
      const parts = f.webkitRelativePath.split('/');
      return parts.length >= 2 && parts[parts.length - 2].toLowerCase() === 'contentversion';
    });

    // Always overwrite (including with null) so stale File handles from a previous
    // directory pick don't silently return empty content when re-read.
    this.ivyTekFile = contactFile ?? null;
    this.ivyTekLoanFile = loanFile ?? null;
    this.ivyTekApplicationFile = applicationFile ?? null;
    this.ivyTekLoanContactApplicationsFile = contactAppFile ?? null;
    this.ivyTekTransactionFile = transactionFile ?? null;
    this.ivyTekSqlCsvFile = transactionFile ?? null;
    this.ivyTekFeedPostFile = feedPostFile ?? null;
    this.ivyTekUsersFile = usersFile ?? null;
    this.ivyTekContentVersionFile = contentVersionCsvFile ?? null;
    this.ivyTekContentVersionFiles = contentVersionFiles;

    this.ivyTekImportResults = [];
    this.ivyTekLoanImportResults = [];
    this.ivyTekTransactionImportResults = [];
    this.selectedIvyTekResult = null;
    this.ivyTekSqlImportResult = null;
    this.ivyTekSqlImportError = null;
    this.ivyTekFeedPostImportResult = null;
    this.ivyTekFeedPostImportError = null;
    this.ivyTekContentVersionImportResult = null;

    this.ivyTekContentVersionImportError = null;
  }

  onFileSelect($event: any) {
    if ($event.target.files.length > 0) {
      this.template = $event.target.files[0];
    }
  }

  /**
   * Sets IvyTek CSV file form control value.
   * @param {any} $event file change event.
   */
  onIvyTekFileSelect($event: any) {
    if ($event.target.files.length > 0) {
      this.ivyTekFile = $event.target.files[0];
      this.ivyTekImportResults = [];
      this.ivyTekLoanImportResults = [];
      this.selectedIvyTekResult = null;
    }
  }

  /**
   * Sets IvyTek loan CSV file form control value.
   * @param {any} $event file change event.
   */
  onIvyTekLoanFileSelect($event: any) {
    if ($event.target.files.length > 0) {
      this.ivyTekLoanFile = $event.target.files[0];
      this.ivyTekLoanImportResults = [];
      this.ivyTekTransactionImportResults = [];
    }
  }

  /**
   * Sets IvyTek applications CSV file form control value.
   * @param {any} $event file change event.
   */
  onIvyTekApplicationFileSelect($event: any) {
    if ($event.target.files.length > 0) {
      this.ivyTekApplicationFile = $event.target.files[0];
      this.ivyTekLoanImportResults = [];
    }
  }

  /**
   * Sets IvyTek contact applications CSV file form control value.
   * @param {any} $event file change event.
   */
  onIvyTekLoanContactApplicationsFileSelect($event: any) {
    if ($event.target.files.length > 0) {
      this.ivyTekLoanContactApplicationsFile = $event.target.files[0];
      this.ivyTekLoanImportResults = [];
    }
  }

  /**
   * Sets IvyTek transaction history CSV file form control value.
   * @param {any} $event file change event.
   */
  onIvyTekTransactionFileSelect($event: any) {
    if ($event.target.files.length > 0) {
      this.ivyTekTransactionFile = $event.target.files[0];
      this.ivyTekTransactionImportResults = [];
    }
  }

  /**
   * Upload excel file containing bulk import data.
   */
  uploadTemplate() {
    let legalFormType = '';
    /** Only for Client Bulk Imports */
    if (this.bulkImport.name === 'Clients') {
      if (this.template.name.toLowerCase().includes('entity')) {
        legalFormType = 'CLIENTS_ENTITY';
      } else if (this.template.name.toLowerCase().includes('person')) {
        legalFormType = 'CLIENTS_PERSON';
      }
    }
    this.organizationService
      .uploadImportDocument(this.template, this.bulkImport.urlSuffix, legalFormType)
      .subscribe(() => {});
  }

  /**
   * Reloads imports data table.
   */
  refreshDocuments() {
    this.organizationService.getImports(this.bulkImport.entityType).subscribe((data: any) => {
      this.dataSource = new MatTableDataSource(data);
      this.importsTableRef.renderRows();
    });
  }

  /**
   * Download import document.
   * @param {string} name Import Name
   * @param {any} id ImportID
   */
  downloadDocument(name: string, id: any) {
    this.organizationService.getImportDocument(id).subscribe((res: any) => {
      const contentType = res.headers.get('Content-Type');
      const blob = new Blob([res.body], { type: contentType });
      const fileOfBlob = new File([blob], name, { type: contentType });
      window.open(window.URL.createObjectURL(fileOfBlob));
    });
  }

  /**
   * Uploads IvyTek CSV data and processes the staged import.
   */
  async uploadIvyTekData() {
    this.applyFixedIvyTekImportOptions();
    if (!this.canUploadIvyTekPipeline || this.ivyTekImportForm.get('targetEntity').value !== 'clients') {
      return;
    }

    this.resetIvyTekPipelineResults();
    this.startIvyTekPipelineRun();
    const restoreAlerts = this.alertService.suppress();
    try {
      const shouldRunClients = this.shouldRunIvyTekStage('clients');
      const shouldRunLoans = this.shouldRunIvyTekStage('loans');
      const shouldRunTransactions = this.shouldRunIvyTekStage('transactions') && !!this.ivyTekTransactionFile;
      const shouldRunNotes = this.shouldRunIvyTekStage('notes') && !!this.ivyTekFeedPostFile;
      const shouldRunAttachments = this.shouldRunIvyTekStage('attachments') && !!this.ivyTekContentVersionFile;
      const contactRows =
        shouldRunClients || shouldRunLoans ? this.parseCsv(await this.readFileAsText(this.ivyTekFile)) : [];
      const applicationRows =
        (shouldRunClients || shouldRunLoans) && this.ivyTekApplicationFile
          ? this.parseCsv(await this.readFileAsText(this.ivyTekApplicationFile))
          : [];
      const contactApplicationRows =
        shouldRunClients || shouldRunLoans
          ? this.parseCsv(await this.readFileAsText(this.ivyTekLoanContactApplicationsFile))
          : [];
      const loanContactLinkRows = [
        ...applicationRows,
        ...contactApplicationRows
      ];
      const loanRows = this.ivyTekLoanFile ? this.parseCsv(await this.readFileAsText(this.ivyTekLoanFile)) : [];
      const transactionRows =
        this.ivyTekTransactionFile && (shouldRunLoans || shouldRunTransactions)
          ? this.parseCsv(await this.readFileAsText(this.ivyTekTransactionFile))
          : [];
      await this.addIvyTekPreflightWarnings([
        ...(contactRows.length
          ? [
              {
                type: 'contacts' as const,
                displayName: 'Contact CSV',
                rows: contactRows
              }
            ]
          : []),
        ...(applicationRows.length
          ? [
              {
                type: 'applications' as const,
                displayName: 'Application CSV',
                rows: applicationRows
              }
            ]
          : []),
        ...(contactApplicationRows.length
          ? [
              {
                type: 'contactApplications' as const,
                displayName: 'ContactApplication CSV',
                rows: contactApplicationRows
              }
            ]
          : []),
        {
          type: 'loans' as const,
          displayName: 'Loans CSV',
          rows: loanRows
        },
        ...(transactionRows.length
          ? [
              {
                type: 'transactions' as const,
                displayName: 'Transactions CSV',
                rows: transactionRows
              }
            ]
          : [])
      ]);

      if (shouldRunClients) {
        const clientRows = this.buildIvyTekClientRows(contactRows, loanContactLinkRows, loanRows);
        await this.uploadIvyTekClientRows(clientRows);
        if (this.hasIvyTekResultStatus(this.ivyTekImportResults, ['labels.inputs.Failed'])) {
          this.finishIvyTekPipelineRun(
            'labels.inputs.Needs Review',
            'Stage 1 completed with records that need review.'
          );
          return;
        }
      }

      if (shouldRunLoans) {
        await this.uploadIvyTekLoanRows(loanRows, contactRows, loanContactLinkRows, transactionRows);
        if (
          this.hasIvyTekResultStatus(this.ivyTekLoanImportResults, [
            'labels.inputs.Failed',
            'labels.inputs.Skipped'
          ])
        ) {
          this.finishIvyTekPipelineRun(
            'labels.inputs.Needs Review',
            'Stage 2 completed with records that need review.'
          );
          return;
        }
      }

      if (shouldRunTransactions) {
        await this.runIvyTekSqlCsvImport(true);
        // Full-SQL mode: after transactions land, write source-truth loan state
        // (dates, balances, schedule, arrears) directly into the Fineract tables.
        if (this.ivyTekFullSqlLoanImport && this.ivyTekSqlImportResult?.success) {
          await this.runIvyTekLoanStateSync(true, loanRows);
        }
        if (!shouldRunNotes && !shouldRunAttachments) {
          const transactionsOk = this.ivyTekSqlImportResult?.success && !this.ivyTekLoanStateSyncError;
          this.finishIvyTekPipelineRun(
            transactionsOk ? 'labels.inputs.Completed' : 'labels.inputs.Needs Review',
            this.joinIvyTekMessages([
              this.ivyTekSqlImportError ?? '',
              this.ivyTekLoanStateSyncError ?? ''
            ])
          );
          return;
        }
      } else if (this.ivyTekFullSqlLoanImport && shouldRunLoans) {
        await this.runIvyTekLoanStateSync(true, loanRows);
        if (this.ivyTekLoanStateSyncError && !shouldRunNotes && !shouldRunAttachments) {
          this.finishIvyTekPipelineRun('labels.inputs.Needs Review', this.ivyTekLoanStateSyncError);
          return;
        }
      }

      if (shouldRunNotes) {
        await this.runIvyTekFeedPostImport(true);
        if (!shouldRunAttachments) {
          this.finishIvyTekPipelineRun(
            this.ivyTekFeedPostImportResult?.success ? 'labels.inputs.Completed' : 'labels.inputs.Needs Review',
            this.ivyTekFeedPostImportError ?? ''
          );
          return;
        }
      }

      if (shouldRunAttachments) {
        await this.runIvyTekContentVersionImport(true);
        this.finishIvyTekPipelineRun(
          this.ivyTekContentVersionImportResult?.success ? 'labels.inputs.Completed' : 'labels.inputs.Needs Review',
          this.ivyTekContentVersionImportError ?? ''
        );
        return;
      }

      this.finishIvyTekPipelineRun('labels.inputs.Completed');
    } catch (error: any) {
      this.ivyTekPipelineError = this.getErrorMessage(error);
      this.finishIvyTekPipelineRun('labels.inputs.Failed', this.ivyTekPipelineError);
    } finally {
      restoreAlerts();
    }
  }

  /**
   * Uploads IvyTek loan CSV data and creates Mifos loan accounts.
   */
  async uploadIvyTekLoanData() {
    if (
      !this.ivyTekLoanFile ||
      !this.ivyTekFile ||
      !this.ivyTekLoanContactApplicationsFile ||
      this.ivyTekLoanImportForm.invalid
    ) {
      return;
    }

    const restoreAlerts = this.alertService.suppress();
    try {
      this.ivyTekLoanImportResults = [];
      const loanRows = this.parseCsv(await this.readFileAsText(this.ivyTekLoanFile));
      const contactRows = this.parseCsv(await this.readFileAsText(this.ivyTekFile));
      const applicationRows = this.ivyTekApplicationFile
        ? this.parseCsv(await this.readFileAsText(this.ivyTekApplicationFile))
        : [];
      const contactApplicationRows = this.parseCsv(await this.readFileAsText(this.ivyTekLoanContactApplicationsFile));
      const transactionRows = this.ivyTekTransactionFile
        ? this.parseCsv(await this.readFileAsText(this.ivyTekTransactionFile))
        : [];
      await this.addIvyTekPreflightWarnings([
        {
          type: 'contacts',
          displayName: 'Contact CSV',
          rows: contactRows
        },
        ...(applicationRows.length
          ? [
              {
                type: 'applications' as const,
                displayName: 'Application CSV',
                rows: applicationRows
              }
            ]
          : []),
        {
          type: 'contactApplications',
          displayName: 'ContactApplication CSV',
          rows: contactApplicationRows
        },
        {
          type: 'loans',
          displayName: 'Loans CSV',
          rows: loanRows
        },
        ...(transactionRows.length
          ? [
              {
                type: 'transactions' as const,
                displayName: 'Transactions CSV',
                rows: transactionRows
              }
            ]
          : [])
      ]);
      await this.uploadIvyTekLoanRows(
        loanRows,
        contactRows,
        [
          ...applicationRows,
          ...contactApplicationRows
        ],
        transactionRows
      );
    } finally {
      restoreAlerts();
    }
  }

  /**
   * Validates IvyTek transaction CSV data for the SQL-assisted legacy import.
   */
  async uploadIvyTekTransactionData() {
    if (!this.ivyTekTransactionFile || !this.ivyTekLoanFile) {
      return;
    }

    this.ivyTekTransactionImportResults = [];
    this.ivyTekTransactionExportResults = [];
    const transactionRows = this.parseCsv(await this.readFileAsText(this.ivyTekTransactionFile));
    const loanRows = this.parseCsv(await this.readFileAsText(this.ivyTekLoanFile));
    await this.addIvyTekPreflightWarnings([
      {
        type: 'loans',
        displayName: 'Loans CSV',
        rows: loanRows
      },
      {
        type: 'transactions',
        displayName: 'Transactions CSV',
        rows: transactionRows
      }
    ]);
    await this.validateIvyTekTransactionRows(transactionRows, loanRows);
  }

  /**
   * Uploads IvyTek Contact CSV data and applies it to clients.
   * @param {any[]} ivyTekRows IvyTek contact rows.
   */
  private async uploadIvyTekClientRows(ivyTekRows: any[]) {
    this.ivyTekImporting = true;
    this.ivyTekProcessedRecords = 0;
    this.ivyTekTotalRecords = ivyTekRows.length;
    this.updateIvyTekPipelineRun({
      activeStage: 'labels.heading.Stage 1 Clients',
      clientsProcessed: this.ivyTekProcessedRecords,
      clientsTotal: this.ivyTekTotalRecords
    });

    try {
      await this.processIvyTekRowsWithConcurrency(ivyTekRows, async (row: any) => {
        await this.upsertIvyTekClient(row);
        this.ivyTekProcessedRecords += 1;
        this.updateIvyTekPipelineRunProgress({
          clientsProcessed: this.ivyTekProcessedRecords,
          clientsTotal: this.ivyTekTotalRecords
        });
      });
    } finally {
      this.ivyTekImporting = false;
      this.updateIvyTekPipelineRun({
        clientsProcessed: this.ivyTekProcessedRecords,
        clientsTotal: this.ivyTekTotalRecords
      });
    }
  }

  /**
   * Uploads IvyTek loan rows and creates Mifos loan accounts.
   * @param {any[]} loanRows IvyTek loan rows.
   * @param {any[]} contactRows IvyTek contact rows.
   * @param {any[]} contactApplicationRows IvyTek contact application rows.
   * @param {any[]} transactionRows IvyTek transaction history rows.
   */
  private async uploadIvyTekLoanRows(
    loanRows: any[],
    contactRows: any[],
    contactApplicationRows: any[],
    transactionRows: any[] = []
  ) {
    this.ivyTekLoanImporting = true;
    this.ivyTekLoanProcessedRecords = 0;
    this.ivyTekLoanTotalRecords = loanRows.length;
    this.updateIvyTekPipelineRun({
      activeStage: 'labels.heading.Stage 2 Loans',
      loansProcessed: this.ivyTekLoanProcessedRecords,
      loansTotal: this.ivyTekLoanTotalRecords
    });

    try {
      await this.refreshIvyTekFineractBusinessDate();
      const productRows = await this.loadIvyTekLoanProducts();
      const productsByName = this.buildIvyTekLoanProductsByName(productRows);
      const helperRowsByLoanId = this.buildIvyTekLoanRowsById(contactRows);
      const contactApplicationsByLoanId = this.buildIvyTekContactApplicationsByLoanId(contactApplicationRows);
      const contactRowsById = this.buildIvyTekContactRowsById(contactRows);
      const contactRowsByName = this.buildIvyTekContactRowsByName(contactRows);
      const contactApplicationRowsById = this.buildIvyTekContactApplicationRowsById(contactApplicationRows);
      const transactionRowsByLoanId = this.buildIvyTekTransactionRowsByLoanId(transactionRows);
      const clientCache = new Map<string, any>();
      const syncedClientIds = new Set<string>();
      const productDetailsCache = new Map<string, any>();

      await this.processIvyTekRowsWithConcurrency(loanRows, async (row: any) => {
        await this.createIvyTekLoan(
          row,
          helperRowsByLoanId,
          contactApplicationsByLoanId,
          contactRowsById,
          contactRowsByName,
          contactApplicationRowsById,
          productsByName,
          clientCache,
          syncedClientIds,
          productDetailsCache,
          transactionRowsByLoanId
        );
        this.ivyTekLoanProcessedRecords += 1;
        this.updateIvyTekPipelineRunProgress({
          loansProcessed: this.ivyTekLoanProcessedRecords,
          loansTotal: this.ivyTekLoanTotalRecords
        });
      });
    } finally {
      this.ivyTekLoanImporting = false;
      this.updateIvyTekPipelineRun({
        loansProcessed: this.ivyTekLoanProcessedRecords,
        loansTotal: this.ivyTekLoanTotalRecords
      });
    }
  }

  /**
   * Validates IvyTek transaction rows against the staged loan rows.
   * @param {any[]} transactionRows IvyTek transaction rows.
   * @param {any[]} loanRows IvyTek loan rows.
   */
  private async validateIvyTekTransactionRows(transactionRows: any[], loanRows: any[]) {
    this.ivyTekTransactionImporting = true;
    this.ivyTekTransactionProcessedRecords = 0;
    this.ivyTekTransactionTotalRecords = transactionRows.length;
    this.ivyTekTransactionExportResults = [];
    this.updateIvyTekPipelineRun({
      activeStage: 'labels.heading.Stage 3 Transactions',
      transactionsProcessed: this.ivyTekTransactionProcessedRecords,
      transactionsTotal: this.ivyTekTransactionTotalRecords
    });

    try {
      const bridgeRowsByLoanId = this.buildIvyTekLoanRowsById(loanRows);
      const importedLoanIdsByLookupKey = this.buildIvyTekImportedLoanIdsByLookupKey();
      const loanLookupCache = new Map<string, Promise<string>>();
      let readyCount = 0;
      let reviewCount = 0;
      let ignoredCount = 0;
      let disbursementCount = 0;
      let sqlReadyCount = 0;
      let restSuppressedCount = 0;

      await this.processIvyTekRowsWithConcurrency(transactionRows, async (row: any) => {
        const result = this.validateIvyTekTransaction(row, bridgeRowsByLoanId);
        await this.stageIvyTekSqlTransactionHistory(result, importedLoanIdsByLookupKey, loanLookupCache);
        this.ivyTekTransactionExportResults.push(result);
        if (result.importedValues?.sqlTransactionHistory === 'Prepared For SQL Backend') {
          sqlReadyCount += 1;
        }
        if (result.importedValues?.restHistoricalTransaction === 'Suppressed') {
          restSuppressedCount += 1;
        }
        if (result.historicalIgnored) {
          ignoredCount += 1;
        }
        if (result.historicalDisbursement) {
          disbursementCount += 1;
        }
        if (result.status === 'labels.inputs.Ready') {
          readyCount += 1;
        } else {
          reviewCount += 1;
          this.ivyTekTransactionImportResults.push(result);
        }
        this.ivyTekTransactionProcessedRecords += 1;
        this.updateIvyTekPipelineRunProgress({
          transactionsProcessed: this.ivyTekTransactionProcessedRecords,
          transactionsTotal: this.ivyTekTransactionTotalRecords
        });
      });

      this.ivyTekTransactionImportResults.unshift(
        this.createIvyTekTransactionSummaryResult(
          transactionRows.length,
          readyCount,
          reviewCount,
          ignoredCount,
          disbursementCount,
          sqlReadyCount,
          restSuppressedCount
        )
      );
      this.ivyTekTransactionExportResults.unshift(this.ivyTekTransactionImportResults[0]);
      this.updateIvyTekReconciliationStatus();
    } finally {
      this.ivyTekTransactionImporting = false;
      this.updateIvyTekPipelineRun({
        transactionsProcessed: this.ivyTekTransactionProcessedRecords,
        transactionsTotal: this.ivyTekTransactionTotalRecords
      });
    }
  }

  /**
   * Builds Mifos loan ids keyed by every imported IvyTek loan identifier available in Stage 2 results.
   */
  private buildIvyTekImportedLoanIdsByLookupKey(): Map<string, string> {
    const loanIdsByLookupKey = new Map<string, string>();
    this.ivyTekLoanImportResults
      .filter((result: any) => !!result.loanId)
      .forEach((result: any) => {
        const loanId = result.loanId.toString();
        this.getUniqueIvyTekIdentifiers([
          result.legacyLoanId,
          result.externalId,
          result.row ? this.getIvyTekLoanExternalId(result.row) : '',
          result.row ? this.getIvyTekLegacyLoanId(result.row) : '',
          result.row ? this.getCsvValue(result.row, 'Id') : '',
          result.row ? this.getCsvValue(result.row, 'IvytekTestPkg__LoanID__c') : '',
          result.row ? this.getCsvValue(result.row, 'IvytekTestPkg__Loan__c') : ''
        ]).forEach((identifier: string) => {
          this.getIvyTekIdentifierLookupKeys(identifier).forEach((key: string) => loanIdsByLookupKey.set(key, loanId));
        });
      });
    return loanIdsByLookupKey;
  }

  /**
   * Prepares one IvyTek historical transaction row for SQL-backend insertion without mutating the loan.
   * @param {any} result IvyTek transaction result.
   * @param {Map<string, string>} importedLoanIdsByLookupKey Mifos loan ids keyed by IvyTek identifiers.
   * @param {Map<string, Promise<string>>} loanLookupCache Existing loan lookup cache.
   */
  private async stageIvyTekSqlTransactionHistory(
    result: any,
    importedLoanIdsByLookupKey: Map<string, string>,
    loanLookupCache: Map<string, Promise<string>>
  ) {
    result.importedValues = result.importedValues || {};
    result.importedValues.restHistoricalTransaction = 'Suppressed';
    result.importedValues.sqlTransactionHistoryTable = this.ivyTekSqlTransactionHistoryTableName;
    result.importedValues.sqlTransactionHistory = 'Not Attempted';

    if (result.status !== 'labels.inputs.Ready') {
      return;
    }

    const loanId = await this.getIvyTekTransactionMifosLoanId(result, importedLoanIdsByLookupKey, loanLookupCache);
    result.loanId = loanId;
    result.importedValues.sqlTransactionHistoryLoanId = loanId;
    if (!loanId) {
      this.setIvyTekTransactionResultStatus(
        result,
        'labels.inputs.Failed',
        `No imported or existing Mifos loan was found for IvyTek loan ${result.legacyLoanId || result.sfLoanId || '(blank)'}. The source transaction cannot be inserted by SQL backend until a loan id is available.`
      );
      return;
    }

    result.importedValues.sqlTransactionHistory = 'Prepared For SQL Backend';
    result.importedValues.sqlHistorySourceTransactionId = result.mappedValues.sourceTransactionId;
    result.importedValues.sqlHistorySourceExternalId = result.mappedValues.sourceExternalId;
    result.importedValues.sqlHistorySourceLoanId = result.mappedValues.sourceLoanId;
    result.importedValues.sqlHistoryLegacyLoanId = result.mappedValues.legacyLoanId;
    result.importedValues.sqlHistoryTransactionDate = result.transactionDate;
    result.importedValues.sqlHistoryAmountPaid = result.amount;
    result.importedValues.sqlHistoryPrincipalPaid = result.mappedValues.principalPaid;
    result.importedValues.sqlHistoryInterestPaid = result.mappedValues.interestPaid;
    result.importedValues.sqlHistoryPaymentType = result.mappedValues.paymentType;
    result.importedValues.sqlHistorySpecialTransCode = result.mappedValues.specialTransCode;
    result.importedValues.sqlHistoryDescription = result.mappedValues.description;
    result.importedValues.sqlHistoryVoided = this.isIvyTekVoidedTransaction(result.row) ? 'Yes' : 'No';
    result.mappedValues.sqlTransactionHistoryImport = 'Prepared For SQL Backend';
    result.mappedValues.requiresSqlImport = 'SQL backend transaction history';
    this.setIvyTekTransactionResultStatus(result, 'labels.inputs.Ready');
  }

  /** Count of SQL-ready transactions waiting to be committed. */
  get ivyTekSqlReadyTransactionCount(): number {
    return this.ivyTekTransactionExportResults.filter(
      (r: any) => r.importedValues?.sqlTransactionHistory === 'Prepared For SQL Backend'
    ).length;
  }

  /**
   * Maps a staged IvyTek export result to the payload shape expected by the SQL import server.
   */
  private mapIvyTekResultToSqlTransaction(result: any): any {
    const row = result.row || {};
    const iv = result.importedValues || {};
    const mv = result.mappedValues || {};

    const noteFields = [
      { key: 'IvytekTestPkg__Note__c', val: this.getCsvValue(row, 'source.IvytekTestPkg__Note__c') },
      { key: 'IvytekTestPkg__CurrentNote__c', val: this.getCsvValue(row, 'source.IvytekTestPkg__CurrentNote__c') },
      { key: 'IvytekTestPkg__TopOfNote__c', val: this.getCsvValue(row, 'source.IvytekTestPkg__TopOfNote__c') },
      {
        key: 'IvytekTestPkg__Next_Payment_Note__c',
        val: this.getCsvValue(row, 'source.IvytekTestPkg__Next_Payment_Note__c')
      },
      { key: 'sourceRegularNote', val: mv.sourceRegularNote || '' },
      { key: 'sourceNextPaymentNote', val: mv.sourceNextPaymentNote || '' },
      {
        key: 'IvytekTestPkg__CR_Special_Comment_Code__c',
        val: this.getCsvValue(row, 'source.IvytekTestPkg__CR_Special_Comment_Code__c')
      }
    ];
    const sourceComment = noteFields
      .filter((f: any) => f.val)
      .map((f: any) => `${f.key}: ${f.val}`)
      .join('\n');

    return {
      loanId: parseInt(iv.sqlTransactionHistoryLoanId) || null,
      sourceTransactionId: iv.sqlHistorySourceTransactionId || '',
      sourceExternalId: iv.sqlHistorySourceExternalId || '',
      sourceLoanId: iv.sqlHistorySourceLoanId || '',
      legacyLoanId: iv.sqlHistoryLegacyLoanId || '',
      transactionDate: iv.sqlHistoryTransactionDate || '',
      amount: iv.sqlHistoryAmountPaid || '',
      principal: iv.sqlHistoryPrincipalPaid || '',
      interest: iv.sqlHistoryInterestPaid || '',
      paymentType: iv.sqlHistoryPaymentType || '',
      specialCode: iv.sqlHistorySpecialTransCode || '',
      historyType: mv.sqlTransactionHistoryType || '',
      description: iv.sqlHistoryDescription || '',
      voided: iv.sqlHistoryVoided === 'Yes',
      sourceComment,
      receiptNumber: this.getCsvValue(row, 'source.IvytekTestPkg__ReceiptNumber__c') || '',
      checkNumber:
        this.getCsvValue(row, 'source.IvytekTestPkg__Check_Number__c') ||
        this.getCsvValue(row, 'source.IvytekTestPkg__CheckDisbursement__c') ||
        '',
      // Interest accrual fields so the SQL server can reconcile interest_charged_from_date
      // to the reconciliation date for legacy loans with transaction-history gaps.
      perDiemInterestRate:
        this.getCsvValue(row, 'IvytekTestPkg__Per_Diem_Interest_Rate__c') ||
        this.getCsvValue(row, 'source.IvytekTestPkg__Per_Diem_Interest_Rate__c') ||
        '',
      accruedInterestAll:
        this.getCsvValue(row, 'IvytekTestPkg__AccruedInterestAll__c') ||
        this.getCsvValue(row, 'source.IvytekTestPkg__AccruedInterestAll__c') ||
        '',
      currentDueDate:
        this.getCsvValue(row, 'IvytekTestPkg__CurrentDueDate__c') ||
        this.getCsvValue(row, 'source.IvytekTestPkg__CurrentDueDate__c') ||
        '',
      originalDisbursementDate:
        this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c') ||
        this.getCsvValue(row, 'source.IvytekTestPkg__LoanDate__c') ||
        this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c') ||
        this.getCsvValue(row, 'source.IvytekTestPkg__SetUpDate__c') ||
        ''
    };
  }

  /**
   * Calls the local SQL import server to dry-run or commit staged IvyTek transactions.
   * @param {boolean} apply Whether to commit (true) or dry-run (false).
   */
  async runIvyTekSqlImport(apply: boolean): Promise<void> {
    const transactions = this.ivyTekTransactionExportResults
      .filter((r: any) => r.importedValues?.sqlTransactionHistory === 'Prepared For SQL Backend')
      .map((r: any) => this.mapIvyTekResultToSqlTransaction(r));

    if (!transactions.length) {
      this.ivyTekSqlImportError = 'No SQL-ready transactions found. Run Stage 3 first.';
      return;
    }

    const reconciliationDate = this.getIvyTekReconciliationDateString();
    if (!reconciliationDate) {
      this.ivyTekSqlImportError =
        'Set the IvyTek Export Date first — the import reconciles interest accrual to that date.';
      return;
    }

    this.ivyTekSqlImportRunning = true;
    this.ivyTekSqlImportError = null;
    this.ivyTekSqlImportResult = null;

    try {
      const response = await fetch('/api/ivytek/sql-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db: this.ivyTekSqlDbForm.value,
          transactions,
          createdBy: 4,
          apply,
          reconciliationDate
        })
      });

      const result = await response.json();
      if (!response.ok) {
        this.ivyTekSqlImportError = result?.message || `Server error ${response.status}`;
      } else {
        this.ivyTekSqlImportResult = result;
        if (!result.success) {
          this.ivyTekSqlImportError = result.message || 'Import did not complete successfully.';
        }
      }
    } catch {
      this.ivyTekSqlImportError =
        'Could not reach the SQL import server. Make sure it started with the app (npm start).';
    } finally {
      this.ivyTekSqlImportRunning = false;
    }
  }

  onIvyTekSqlCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.ivyTekSqlCsvFile = input?.files?.[0] ?? null;
    this.ivyTekSqlImportResult = null;
    this.ivyTekSqlImportError = null;
  }

  /** Number of loans that have accrual data available for the schedule-fix step. */
  get ivyTekScheduleFixLoanCount(): number {
    return this.buildScheduleFixLoans().length;
  }

  /**
   * Builds the per-loan payload for /api/ivytek/schedule-fix by grouping staged
   * transaction results by Fineract loan ID and extracting IvyTek accrual fields.
   * One entry per loan; the transaction row with the most complete accrual data wins.
   */
  private buildScheduleFixLoans(): any[] {
    const byLoanId = new Map<number, any>();

    for (const result of this.ivyTekTransactionExportResults) {
      const iv = result.importedValues || {};
      const row = result.row || {};
      const loanId = parseInt(iv.sqlTransactionHistoryLoanId);
      if (!loanId || isNaN(loanId)) continue;

      const perDiem = this.parseIvyTekDecimal(
        this.getCsvValue(row, 'IvytekTestPkg__Per_Diem_Interest_Rate__c') ||
          this.getCsvValue(row, 'source.IvytekTestPkg__Per_Diem_Interest_Rate__c')
      );
      const accrued = this.parseIvyTekDecimal(
        this.getCsvValue(row, 'IvytekTestPkg__AccruedInterestAll__c') ||
          this.getCsvValue(row, 'source.IvytekTestPkg__AccruedInterestAll__c')
      );
      const dueDate =
        this.getCsvValue(row, 'IvytekTestPkg__CurrentDueDate__c') ||
        this.getCsvValue(row, 'source.IvytekTestPkg__CurrentDueDate__c');

      if (perDiem === null || accrued === null || !dueDate) continue;

      // Keep the most recent row for this loan (highest accrued interest = latest snapshot)
      const existing = byLoanId.get(loanId);
      if (!existing || accrued > parseFloat(existing.accruedInterestAll)) {
        const correctedDate =
          this.ivyTekSqlImportResult?.interestAccrualValidation?.find((v: any) => v.loanId === loanId)
            ?.correctedOriginationDate ?? undefined;

        byLoanId.set(loanId, {
          loanId,
          legacyLoanId: iv.sqlHistoryLegacyLoanId || '',
          accruedInterestAll: String(accrued),
          perDiemInterestRate: String(perDiem),
          currentDueDate: dueDate,
          correctedOriginationDate: correctedDate
        });
      }
    }

    return [...byLoanId.values()];
  }

  /** Calls /api/ivytek/schedule-fix to correct repayment schedules for pre-2021 legacy loans. */
  async runIvyTekScheduleFix(apply: boolean): Promise<void> {
    const loans = this.buildScheduleFixLoans();

    if (!loans.length) {
      this.ivyTekScheduleFixError =
        'No loans with accrual data found. Run Stage 3 and the SQL import first so loan IDs are resolved.';
      return;
    }

    if (!this.getIvyTekReconciliationDateString()) {
      this.ivyTekScheduleFixError =
        'Set the IvyTek Export Date first — schedule corrections reconcile interest to that date.';
      return;
    }

    this.ivyTekScheduleFixRunning = true;
    this.ivyTekScheduleFixError = null;
    this.ivyTekScheduleFixResult = null;

    try {
      const response = await fetch('/api/ivytek/schedule-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db: this.ivyTekSqlDbForm.value,
          loans,
          apply,
          reconciliationDate: this.getIvyTekReconciliationDateString()
        })
      });

      const result = await response.json();
      if (!response.ok) {
        this.ivyTekScheduleFixError = result?.message || `Server error ${response.status}`;
      } else {
        this.ivyTekScheduleFixResult = result;
        if (!result.success) {
          this.ivyTekScheduleFixError = result.message || 'Schedule fix did not complete successfully.';
        }
      }
    } catch {
      this.ivyTekScheduleFixError =
        'Could not reach the SQL import server. Make sure it started with the app (npm start).';
    } finally {
      this.ivyTekScheduleFixRunning = false;
    }
  }

  /** Number of loans ready for the full-SQL loan-state-sync step. */
  get ivyTekLoanStateSyncLoanCount(): number {
    return this.buildLoanStateSyncLoans().length;
  }

  /**
   * Retains the parsed loan CSV rows so loan-state-sync can run from the pipeline
   * or from its card without re-reading files.
   */
  private setIvyTekLoanStateSyncRows(loanRows: any[]): void {
    if (Array.isArray(loanRows) && loanRows.length) {
      this.ivyTekLoanStateSyncRows = loanRows;
    }
  }

  /**
   * Builds the per-loan source-truth payload for /api/ivytek/loan-state-sync from
   * the loan CSV rows, with paid totals aggregated from the staged transaction rows.
   */
  private buildLoanStateSyncLoans(): any[] {
    const rows = this.ivyTekLoanStateSyncRows.length
      ? this.ivyTekLoanStateSyncRows
      : this.ivyTekLoanImportResults.map((r: any) => r.row).filter(Boolean);
    if (!rows.length) {
      return [];
    }

    // Aggregate non-voided paid amounts and last payment date per legacy loan id.
    const paidByLegacyId = new Map<string, { principalPaid: number; interestPaid: number; lastDate: string }>();
    for (const result of this.ivyTekTransactionExportResults) {
      const iv = result.importedValues || {};
      const legacyId = (iv.sqlHistoryLegacyLoanId || '').toString();
      if (!legacyId || iv.sqlHistoryVoided === 'Yes') {
        continue;
      }
      const entry = paidByLegacyId.get(legacyId) || { principalPaid: 0, interestPaid: 0, lastDate: '' };
      entry.principalPaid += this.parseIvyTekDecimal((iv.sqlHistoryPrincipalPaid ?? '').toString()) || 0;
      entry.interestPaid += this.parseIvyTekDecimal((iv.sqlHistoryInterestPaid ?? '').toString()) || 0;
      const txnDate = (iv.sqlHistoryTransactionDate || '').toString();
      if (txnDate && (!entry.lastDate || txnDate > entry.lastDate)) {
        entry.lastDate = txnDate;
      }
      paidByLegacyId.set(legacyId, entry);
    }

    const loans: any[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const legacyLoanId = this.getIvyTekLegacyLoanId(row);
      if (!legacyLoanId || seen.has(legacyLoanId)) {
        continue;
      }
      seen.add(legacyLoanId);

      const balanceNow = this.getIvyTekLoanBalanceNow(row);
      const principalOriginal = this.getIvyTekLoanPrincipal(row);
      const paid = paidByLegacyId.get(legacyLoanId);
      loans.push({
        legacyLoanId,
        externalId: this.getIvyTekLoanExternalId(row),
        originationDate: this.getIvyTekSourceLoanDate(row),
        maturityDate: this.getIvyTekSourceMaturityDate(row),
        currentDueDate: this.getCsvValue(row, 'IvytekTestPkg__CurrentDueDate__c'),
        lastPaymentDate: paid?.lastDate || this.getCsvValue(row, 'IvytekTestPkg__DateLastPaid__c'),
        principalOriginal: principalOriginal ?? '',
        principalOutstanding: balanceNow ?? '',
        principalPaid: paid ? paid.principalPaid.toFixed(2) : '',
        interestPaid: paid ? paid.interestPaid.toFixed(2) : '',
        interestOutstanding: this.getCsvValue(row, 'IvytekTestPkg__AccruedInterestAll__c'),
        // Kept separate from interestOutstanding: IvyTek carries back interest in its
        // own bucket while Mifos has a single interest field, so the server adds it to
        // the FINAL outstanding only — folding it into the accrued value here would
        // corrupt the accrued÷per-diem day math that anchors the interest snapshot.
        backInterestDue:
          this.getCsvValue(row, 'IvytekTestPkg__BackInterestDue__c') ||
          this.getCsvValue(row, 'source.IvytekTestPkg__BackInterestDue__c') ||
          '',
        // Per-diem rate so the server can project accrued interest forward from the
        // reconciliation (export) date to today, instead of freezing it at export.
        // The server derives ACT/365 from the annual rate when both lookups miss.
        perDiemInterestRate:
          this.getCsvValue(row, 'IvytekTestPkg__Per_Diem_Interest_Rate__c') ||
          this.getCsvValue(row, 'source.IvytekTestPkg__Per_Diem_Interest_Rate__c') ||
          '',
        annualInterestRatePercent: this.getIvyTekLoanInterestRatePercent(row),
        amountOverdue: this.getCsvValue(row, 'IvytekTestPkg__AmtNowDueAll__c'),
        closed: this.shouldCloseIvyTekLoanAfterDisbursement(row, balanceNow),
        closedDate: this.getIvyTekHistoricalLoanCloseDate(row)
      });
    }
    return loans;
  }

  /**
   * Calls /api/ivytek/loan-state-sync to write IvyTek source truth directly into
   * m_loan, m_loan_repayment_schedule, and m_loan_arrears_aging.
   * @param {boolean} apply Whether to commit (true) or dry-run (false).
   * @param {any[]} loanRows Optional freshly parsed loan CSV rows from the pipeline.
   */
  async runIvyTekLoanStateSync(apply: boolean, loanRows: any[] = []): Promise<void> {
    this.setIvyTekLoanStateSyncRows(loanRows);
    const loans = this.buildLoanStateSyncLoans();

    if (!loans.length) {
      this.ivyTekLoanStateSyncError = 'No loan rows available. Load the loan CSV / run Stage 2 first.';
      return;
    }
    const reconciliationDate = this.getIvyTekReconciliationDateString();
    if (!reconciliationDate) {
      this.ivyTekLoanStateSyncError = 'Set the IvyTek Export Date first — loan state is reconciled to that date.';
      return;
    }

    this.ivyTekLoanStateSyncRunning = true;
    this.ivyTekLoanStateSyncError = null;
    this.ivyTekLoanStateSyncResult = null;

    try {
      // No asOfDate is sent: the server projects interest to its own wall-clock today.
      // The Fineract tenant business date is deliberately NOT used here — it lags the
      // wall clock on this instance, and IvyTek accrues by wall clock, so anchoring to
      // the business date made the projection add zero days and freeze interest.
      const response = await fetch('/api/ivytek/loan-state-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db: this.ivyTekSqlDbForm.value,
          loans,
          apply,
          createdBy: 4,
          reconciliationDate
        })
      });

      const result = await response.json();
      if (!response.ok) {
        this.ivyTekLoanStateSyncError = result?.message || `Server error ${response.status}`;
      } else {
        this.ivyTekLoanStateSyncResult = result;
        if (!result.success) {
          this.ivyTekLoanStateSyncError = result.message || 'Loan state sync did not complete successfully.';
        }
      }
    } catch {
      this.ivyTekLoanStateSyncError =
        'Could not reach the SQL import server. Make sure it started with the app (npm start).';
    } finally {
      this.ivyTekLoanStateSyncRunning = false;
    }
  }

  /** Number of loan import results that need SQL-level interest rate correction. */
  get ivyTekInterestRateFixLoanCount(): number {
    return this.buildInterestRateFixLoans().length;
  }

  /**
   * Builds the per-loan payload for /api/ivytek/interest-rate-fix by scanning loan
   * import results for entries where Stage 6 REST rate restoration failed (HTTP 403).
   */
  private buildInterestRateFixLoans(): any[] {
    const loans: any[] = [];
    for (const result of this.ivyTekLoanImportResults) {
      const vv = result.validationValues || {};
      const outcome = vv.stage6InterestRateOutcome;
      if (outcome !== 'Needs SQL/Staging' && outcome !== 'Needs Correction') {
        continue;
      }
      const loanId = Number(result.loanId);
      if (!loanId || isNaN(loanId)) {
        continue;
      }
      const annualRatePercent = parseFloat(String(vv.sourceInterestRatePercent ?? ''));
      if (isNaN(annualRatePercent) || annualRatePercent <= 0) {
        continue;
      }
      loans.push({
        loanId,
        legacyLoanId: result.mappedValues?.legacyLoanId || result.mappedValues?.sourceLoanId || '',
        annualRatePercent
      });
    }
    return loans;
  }

  /** Calls /api/ivytek/interest-rate-fix to SQL-correct the nominal interest rate for
   *  loans where Stage 6 REST restoration returned HTTP 403. */
  async runIvyTekInterestRateFix(apply: boolean): Promise<void> {
    const loans = this.buildInterestRateFixLoans();

    if (!loans.length) {
      this.ivyTekInterestRateFixError =
        'No loans with failed Stage 6 rate restoration found. Run the loan import first so results are available.';
      return;
    }

    this.ivyTekInterestRateFixRunning = true;
    this.ivyTekInterestRateFixError = null;
    this.ivyTekInterestRateFixResult = null;

    try {
      const response = await fetch('/api/ivytek/interest-rate-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db: this.ivyTekSqlDbForm.value,
          loans,
          apply
        })
      });

      const result = await response.json();
      if (!response.ok) {
        this.ivyTekInterestRateFixError = result?.message || `Server error ${response.status}`;
      } else {
        this.ivyTekInterestRateFixResult = result;
        if (!result.success) {
          this.ivyTekInterestRateFixError = result.message || 'Interest rate fix did not complete successfully.';
        }
      }
    } catch {
      this.ivyTekInterestRateFixError =
        'Could not reach the SQL import server. Make sure it started with the app (npm start).';
    } finally {
      this.ivyTekInterestRateFixRunning = false;
    }
  }

  async runIvyTekSqlCsvImport(apply: boolean): Promise<void> {
    if (!this.ivyTekSqlCsvFile) {
      this.ivyTekSqlImportError = 'Select a transaction CSV file first.';
      return;
    }

    this.ivyTekSqlImportRunning = true;
    this.ivyTekSqlImportError = null;
    this.ivyTekSqlImportResult = null;

    const [
      csvText,
      loanCsvText,
      contactCsvText,
      applicationCsvText,
      contactAppCsvText
    ] = await Promise.all([
      this.readFileAsText(this.ivyTekSqlCsvFile!),
      this.ivyTekLoanFile ? this.readFileAsText(this.ivyTekLoanFile) : Promise.resolve(null),
      this.ivyTekFile ? this.readFileAsText(this.ivyTekFile) : Promise.resolve(null),
      this.ivyTekApplicationFile ? this.readFileAsText(this.ivyTekApplicationFile) : Promise.resolve(null),
      this.ivyTekLoanContactApplicationsFile
        ? this.readFileAsText(this.ivyTekLoanContactApplicationsFile)
        : Promise.resolve(null)
    ]);

    if (!csvText || !csvText.trim()) {
      this.ivyTekSqlImportError = `Transaction file "${this.ivyTekSqlCsvFile!.name}" was read but is empty. Re-pick the directory to refresh the file reference.`;
      this.ivyTekSqlImportRunning = false;
      return;
    }

    const body = JSON.stringify({
      db: this.ivyTekSqlDbForm.value,
      apply,
      createdBy: 4,
      reconciliationDate: this.getIvyTekReconciliationDateString(),
      csvText,
      csvFileName: this.ivyTekSqlCsvFile!.name,
      csvFileSizeOnDisk: this.ivyTekSqlCsvFile!.size,
      loanCsvText,
      contactCsvText,
      applicationCsvText,
      contactAppCsvText
    });

    try {
      const response = await fetch('/api/ivytek/sql-import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const result = await response.json();
      if (!response.ok) {
        this.ivyTekSqlImportError = this.formatSqlImportError(result, response.status);
        this.ivyTekReconciliationStatusKey = 'labels.text.Reconciliation Needs Review';
      } else {
        this.ivyTekSqlImportResult = result;
        if (!result.success) {
          this.ivyTekSqlImportError = this.formatSqlImportError(result, null);
          this.ivyTekReconciliationStatusKey = 'labels.text.Reconciliation Needs Review';
        } else {
          const reviewRows = (result.reconciliation ?? []).filter((r: any) => r.status === 'Needs Review');
          this.ivyTekReconciliationStatusKey =
            reviewRows.length === 0 ? 'labels.text.Reconciliation Matched' : 'labels.text.Reconciliation Needs Review';
        }
      }
    } catch {
      this.ivyTekSqlImportError =
        'Could not reach the SQL import server. Make sure the app was started with ng serve --proxy-config proxy.conf.js.';
    } finally {
      this.ivyTekSqlImportRunning = false;
    }
  }

  /**
   * Builds the existing repayment-payload wrapper from a Stage 3 transaction result.
   * @param {any} result IvyTek transaction result.
   */
  private getIvyTekHistoricalTransactionPostWrapper(result: any) {
    return {
      row: result.row,
      date: result.transactionDate,
      sourceDate: result.transactionDate,
      dateAdjusted: false,
      amount: this.parseIvyTekDecimal(result.amount) || 0,
      principal: this.getIvyTekTransactionPrincipalPaid(result.row) || 0,
      interest: this.getIvyTekTransactionInterestPaid(result.row) || 0
    };
  }

  /**
   * Legacy REST-mode close pass retained for rollback; SQL history mode closes loans during Stage 2.
   * @param {any[]} loanRows IvyTek loan rows.
   * @param {Map<string, string>} importedLoanIdsByLookupKey Mifos loan ids keyed by IvyTek identifiers.
   * @param {Map<string, Promise<string>>} loanLookupCache Existing loan lookup cache.
   */
  private async closeIvyTekLoansAfterStage3Transactions(
    loanRows: any[],
    importedLoanIdsByLookupKey: Map<string, string>,
    loanLookupCache: Map<string, Promise<string>>
  ) {
    const summary = {
      closedCount: 0,
      alreadyClosedCount: 0,
      reviewCount: 0
    };

    await this.processIvyTekRowsWithConcurrency(loanRows, async (row: any) => {
      const balanceNow = this.getIvyTekLoanBalanceNow(row);
      if (!this.shouldCloseIvyTekLoanAfterDisbursement(row, balanceNow)) {
        return;
      }

      const loanId = await this.getIvyTekLoanRowMifosLoanId(row, importedLoanIdsByLookupKey, loanLookupCache);
      const result = this.createIvyTekStage3LoanCloseResult(row, loanId);
      this.ivyTekTransactionExportResults.push(result);
      if (!loanId) {
        summary.reviewCount += 1;
        this.ivyTekTransactionImportResults.push(result);
        return;
      }

      try {
        const message = await this.settleAndCloseIvyTekNonActiveLoan(
          loanId,
          row,
          balanceNow,
          this.getIvyTekLoanDate(row)
        );
        result.message = message || 'No close action was required.';
        result.importedValues.historicalLoanClose = message.includes('already closed') ? 'Already Closed' : 'Closed';
        if (result.importedValues.historicalLoanClose === 'Already Closed') {
          summary.alreadyClosedCount += 1;
        } else {
          summary.closedCount += 1;
        }
      } catch (error: any) {
        summary.reviewCount += 1;
        result.status = 'labels.inputs.Failed';
        result.importedValues.historicalLoanClose = 'Failed';
        result.message = `Historical transaction import finished, but the non-active loan could not be closed: ${this.getErrorMessage(error)}`;
        this.ivyTekTransactionImportResults.push(result);
      }
    });

    return summary;
  }

  /**
   * Creates a Stage 3 result row for the post-transaction close pass.
   * @param {any} row IvyTek loan row.
   * @param {string} loanId Mifos loan id.
   */
  private createIvyTekStage3LoanCloseResult(row: any, loanId: string) {
    return {
      name: this.getIvyTekCustomerNameCandidates(row)[0] || this.getCsvValue(row, 'Name') || 'Historical loan close',
      sfLoanId: this.getCsvValue(row, 'Id'),
      legacyLoanId: this.getIvyTekLegacyLoanId(row),
      externalId: this.getIvyTekLoanExternalId(row),
      loanId,
      transactionDate: this.getIvyTekHistoricalLoanCloseDate(row) || this.getIvyTekLoanDate(row),
      amount: '',
      historicalOnly: true,
      historicalIgnored: false,
      historicalDisbursement: false,
      mappedValues: {
        stage3CloseAfterTransactions: 'Yes',
        sourceLoanStatus: this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c'),
        sourceBalanceNow: this.getIvyTekLoanBalanceNow(row) ?? ''
      },
      importedValues: {
        historicalLoanClose: loanId ? 'Pending' : 'Not Attempted'
      },
      validationValues: {},
      row,
      status: loanId ? 'labels.inputs.Ready' : 'labels.inputs.Failed',
      message: loanId
        ? ''
        : `No imported or existing Mifos loan was found for non-active IvyTek loan ${this.getIvyTekLegacyLoanId(row) || this.getCsvValue(row, 'Id') || '(blank)'}.`
    };
  }

  /**
   * Gets the Mifos loan id for an IvyTek loan source row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, string>} importedLoanIdsByLookupKey Mifos loan ids keyed by IvyTek identifiers.
   * @param {Map<string, Promise<string>>} loanLookupCache Existing loan lookup cache.
   */
  private async getIvyTekLoanRowMifosLoanId(
    row: any,
    importedLoanIdsByLookupKey: Map<string, string>,
    loanLookupCache: Map<string, Promise<string>>
  ): Promise<string> {
    const importedLoanId = this.getUniqueIvyTekIdentifiers([
      this.getIvyTekLoanExternalId(row),
      this.getIvyTekLegacyLoanId(row),
      this.getCsvValue(row, 'Id'),
      this.getCsvValue(row, 'IvytekTestPkg__LoanID__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Loan__c')
    ])
      .flatMap((identifier: string) => this.getIvyTekIdentifierLookupKeys(identifier))
      .map((key: string) => importedLoanIdsByLookupKey.get(key) || '')
      .find((loanId: string) => !!loanId);
    if (importedLoanId) {
      return importedLoanId;
    }

    const externalId = this.getIvyTekLoanExternalId(row);
    const accountNo = this.getIvyTekLegacyLoanId(row);
    const cacheKey = `loan-row:${externalId}:${accountNo}`;
    if (!loanLookupCache.has(cacheKey)) {
      loanLookupCache.set(
        cacheKey,
        (async () => {
          const loan = await this.findIvyTekLoanByExternalId(externalId, accountNo);
          return this.getIvyTekLoanId(loan);
        })()
      );
    }
    return loanLookupCache.get(cacheKey) || Promise.resolve('');
  }

  /**
   * Gets the Mifos loan id that will receive an IvyTek SQL transaction-history row.
   * @param {any} result IvyTek transaction result.
   * @param {Map<string, string>} importedLoanIdsByLookupKey Mifos loan ids keyed by IvyTek identifiers.
   * @param {Map<string, Promise<string>>} loanLookupCache Existing loan lookup cache.
   */
  private async getIvyTekTransactionMifosLoanId(
    result: any,
    importedLoanIdsByLookupKey: Map<string, string>,
    loanLookupCache: Map<string, Promise<string>>
  ): Promise<string> {
    const importedLoanId = this.getUniqueIvyTekIdentifiers([
      result.legacyLoanId,
      result.externalId,
      result.sfLoanId,
      result.mappedValues?.sourceLoanId,
      result.mappedValues?.legacyLoanId
    ])
      .flatMap((identifier: string) => this.getIvyTekIdentifierLookupKeys(identifier))
      .map((key: string) => importedLoanIdsByLookupKey.get(key) || '')
      .find((loanId: string) => !!loanId);
    if (importedLoanId) {
      return importedLoanId;
    }

    const cacheKey = this.getUniqueIvyTekIdentifiers([
      result.externalId,
      result.legacyLoanId,
      result.sfLoanId
    ]).join('|');
    if (!cacheKey) {
      return '';
    }

    if (!loanLookupCache.has(cacheKey)) {
      loanLookupCache.set(
        cacheKey,
        (async () => {
          const externalIdMatch = await this.findIvyTekLoanByExternalId(result.externalId, result.legacyLoanId);
          if (externalIdMatch) {
            return this.getIvyTekLoanId(externalIdMatch);
          }
          const accountNoMatch = await this.findIvyTekLoanByExternalId('', result.legacyLoanId);
          return this.getIvyTekLoanId(accountNoMatch);
        })()
      );
    }

    return loanLookupCache.get(cacheKey) || Promise.resolve('');
  }

  /**
   * Adds warning rows for non-empty source fields that do not map to native or custom fields.
   * @param {IvyTekSourceFileRows[]} sourceFiles Uploaded IvyTek source files.
   */
  private async addIvyTekPreflightWarnings(sourceFiles: IvyTekSourceFileRows[]) {
    const [
      clientColumns,
      loanColumns
    ] = await Promise.all([
      this.getIvyTekEntityDatatableColumnReferences('m_client'),
      this.getIvyTekEntityDatatableColumnReferences('m_loan')
    ]);

    this.addIvyTekJoinPreflightWarnings(sourceFiles);

    sourceFiles.forEach((sourceFile: IvyTekSourceFileRows) => {
      const datatableColumns = sourceFile.type === 'contacts' ? clientColumns : loanColumns;
      const coverage = this.ivyTekFieldMapping.getCoverage(
        sourceFile,
        this.getIvyTekNativeMappedFields(sourceFile.type),
        datatableColumns
      );
      coverage.warnings.forEach((warning: IvyTekUnmappedFieldWarning) => {
        this.addIvyTekUnmappedFieldWarning(warning, sourceFile.type);
      });
    });
  }

  /**
   * Appends a warning result to the relevant stage.
   * @param {IvyTekUnmappedFieldWarning} warning Unmapped field warning.
   * @param {string} sourceType Source file type.
   */
  private addIvyTekUnmappedFieldWarning(warning: IvyTekUnmappedFieldWarning, sourceType: string) {
    const result = {
      name: `${warning.sourceFile}: ${warning.sourceColumn}`,
      externalId: warning.rowIdentifier,
      entityId: '',
      legacyLoanId: warning.rowIdentifier,
      row: {
        sourceFile: warning.sourceFile,
        sourceColumn: warning.sourceColumn,
        rowIdentifier: warning.rowIdentifier,
        sampleValue: warning.sampleValue
      },
      mappedValues: {},
      status: 'labels.inputs.Warning',
      message: `${warning.reason} Sample row ${warning.rowIdentifier || '(unknown)'} has value "${warning.sampleValue}".`
    };

    if (sourceType === 'contacts') {
      this.ivyTekImportResults.push(result);
    } else if (sourceType === 'transactions') {
      this.ivyTekTransactionImportResults.push(result);
      this.ivyTekTransactionExportResults.push(result);
    } else {
      this.ivyTekLoanImportResults.push(result);
    }
  }

  /**
   * Adds warnings for source rows whose historical joins cannot be resolved from the uploaded CSVs.
   * @param {IvyTekSourceFileRows[]} sourceFiles Uploaded IvyTek source files.
   */
  private addIvyTekJoinPreflightWarnings(sourceFiles: IvyTekSourceFileRows[]) {
    const rowsByType = new Map<IvyTekSourceFileType, IvyTekCsvRow[]>();
    sourceFiles.forEach((sourceFile: IvyTekSourceFileRows) => {
      rowsByType.set(sourceFile.type, sourceFile.rows);
    });
    const contactRows = rowsByType.get('contacts') || [];
    const applicationRows = rowsByType.get('applications') || [];
    const contactApplicationRows = rowsByType.get('contactApplications') || [];
    const loanRows = rowsByType.get('loans') || [];
    const transactionRows = rowsByType.get('transactions') || [];

    const contactIds = this.buildIvyTekPreflightIdentifierSet(contactRows, (row: IvyTekCsvRow) => [
      this.getIvyTekContactSourceId(row),
      this.getIvyTekContactExternalId(row),
      this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c'),
      this.getIvyTekEntityId(row)
    ]);
    const applicationIds = this.buildIvyTekPreflightIdentifierSet(applicationRows, (row: IvyTekCsvRow) => [
      this.getCsvValue(row, 'Id'),
      this.getCsvValue(row, 'IvytekTestPkg__Application__c'),
      this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c')
    ]);
    const loanIds = this.buildIvyTekPreflightIdentifierSet(loanRows, (row: IvyTekCsvRow) => [
      this.getCsvValue(row, 'Id'),
      this.getCsvValue(row, 'IvytekTestPkg__Application__c'),
      this.getIvyTekLoanExternalId(row),
      this.getIvyTekLegacyLoanId(row),
      this.getCsvValue(row, 'IvytekTestPkg__LoanID__c')
    ]);
    const contactApplicationsByLoanId = this.buildIvyTekContactApplicationsByLoanId(contactApplicationRows);

    contactApplicationRows.forEach((row: IvyTekCsvRow) => {
      const rowIdentifier = this.getIvyTekPreflightRowIdentifier(row);
      const loanIdentifier = this.getCsvValue(row, 'IvytekTestPkg__Loan__c');
      if (loanIdentifier && loanRows.length && !this.hasIvyTekPreflightIdentifier(loanIds, loanIdentifier)) {
        this.addIvyTekPreflightWarning(
          'contactApplications',
          'ContactApplication loan join',
          rowIdentifier,
          `ContactApplication ${rowIdentifier || '(unknown)'} references loan ${loanIdentifier}, but no Loans CSV row matched that identifier.`
        );
      }

      const applicationIdentifier = this.getCsvValue(row, 'IvytekTestPkg__Application__c');
      if (
        applicationIdentifier &&
        applicationRows.length &&
        !this.hasIvyTekPreflightIdentifier(applicationIds, applicationIdentifier)
      ) {
        this.addIvyTekPreflightWarning(
          'contactApplications',
          'ContactApplication application join',
          rowIdentifier,
          `ContactApplication ${rowIdentifier || '(unknown)'} references application ${applicationIdentifier}, but no Application CSV row matched that identifier.`
        );
      }

      const contactIdentifier = this.getCsvValue(row, 'IvytekTestPkg__Contact__c');
      if (
        contactIdentifier &&
        contactRows.length &&
        !this.hasIvyTekPreflightIdentifier(contactIds, contactIdentifier)
      ) {
        this.addIvyTekPreflightWarning(
          'contactApplications',
          'ContactApplication contact join',
          rowIdentifier,
          `ContactApplication ${rowIdentifier || '(unknown)'} references contact ${contactIdentifier}, but no Contact CSV row matched that identifier.`
        );
      }
    });

    if (contactApplicationRows.length) {
      loanRows.forEach((row: IvyTekCsvRow) => {
        const loanIdentifier = this.getIvyTekPreflightRowIdentifier(row);
        const hasBorrowerJoin = this.getUniqueIvyTekIdentifiers([
          this.getCsvValue(row, 'Id'),
          this.getCsvValue(row, 'IvytekTestPkg__Application__c'),
          this.getIvyTekLoanExternalId(row)
        ])
          .flatMap((identifier: string) => this.getIvyTekIdentifierLookupKeys(identifier))
          .some((key: string) => !!contactApplicationsByLoanId.get(key)?.length);
        if (!hasBorrowerJoin) {
          this.addIvyTekPreflightWarning(
            'loans',
            'Loan borrower join',
            loanIdentifier,
            `Loan ${loanIdentifier || '(unknown)'} has no borrower ContactApplication match in the uploaded CSVs. Exact client matching may be impossible for this loan.`
          );
        }
      });
    }

    transactionRows.forEach((row: IvyTekCsvRow) => {
      const rowIdentifier = this.getIvyTekPreflightRowIdentifier(row);
      const loanIdentifier = this.getIvyTekTransactionLoanId(row);
      if (!loanIdentifier) {
        this.addIvyTekPreflightWarning(
          'transactions',
          'Transaction loan join',
          rowIdentifier,
          `Transaction ${rowIdentifier || '(unknown)'} does not contain a loan identifier.`
        );
        return;
      }
      if (loanRows.length && !this.hasIvyTekPreflightIdentifier(loanIds, loanIdentifier)) {
        this.addIvyTekPreflightWarning(
          'transactions',
          'Transaction loan join',
          rowIdentifier,
          `Transaction ${rowIdentifier || '(unknown)'} references loan ${loanIdentifier}, but no Loans CSV row matched that identifier.`
        );
      }
    });
  }

  /**
   * Builds lookup keys for source identifiers.
   * @param {IvyTekCsvRow[]} rows Source rows.
   * @param {(row: IvyTekCsvRow) => string[]} identifiersForRow Identifier selector.
   */
  private buildIvyTekPreflightIdentifierSet(
    rows: IvyTekCsvRow[],
    identifiersForRow: (row: IvyTekCsvRow) => string[]
  ): Set<string> {
    const identifiers = new Set<string>();
    rows.forEach((row: IvyTekCsvRow) => {
      identifiersForRow(row).forEach((identifier: string) => {
        this.getIvyTekIdentifierLookupKeys(identifier).forEach((key: string) => identifiers.add(key));
      });
    });
    return identifiers;
  }

  /**
   * Checks whether a source identifier appears in a preflight lookup set.
   * @param {Set<string>} identifiers Lookup keys.
   * @param {string} identifier Source identifier.
   */
  private hasIvyTekPreflightIdentifier(identifiers: Set<string>, identifier: string): boolean {
    return this.getIvyTekIdentifierLookupKeys(identifier).some((key: string) => identifiers.has(key));
  }

  /**
   * Gets the most useful row identifier for preflight messages.
   * @param {IvyTekCsvRow} row Source row.
   */
  private getIvyTekPreflightRowIdentifier(row: IvyTekCsvRow): string {
    return (
      this.getIvyTekLegacyLoanId(row) ||
      this.getCsvValue(row, 'IvytekTestPkg__LoanID__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c') ||
      this.getCsvValue(row, 'Id') ||
      this.getCsvValue(row, 'Name')
    );
  }

  /**
   * Appends a preflight warning row to the relevant result set.
   * @param {IvyTekSourceFileType} sourceType Source file type.
   * @param {string} name Warning category.
   * @param {string} rowIdentifier Source row identifier.
   * @param {string} message Warning message.
   */
  private addIvyTekPreflightWarning(
    sourceType: IvyTekSourceFileType,
    name: string,
    rowIdentifier: string,
    message: string
  ) {
    const result = {
      name,
      externalId: rowIdentifier,
      entityId: '',
      legacyLoanId: rowIdentifier,
      row: {
        rowIdentifier
      },
      mappedValues: {},
      status: 'labels.inputs.Warning',
      message
    };

    if (sourceType === 'contacts') {
      this.ivyTekImportResults.push(result);
    } else if (sourceType === 'transactions') {
      this.ivyTekTransactionImportResults.push(result);
      this.ivyTekTransactionExportResults.push(result);
    } else {
      this.ivyTekLoanImportResults.push(result);
    }
  }

  /**
   * Gets source fields already handled by native payloads or hard-coded mappings.
   * @param {string} sourceType Source file type.
   */
  private getIvyTekNativeMappedFields(sourceType: string): string[] {
    const commonFields = [
      '_',
      'Id',
      'Name',
      'CreatedDate',
      'IvytekTestPkg__ExternalID__c'
    ];
    const clientFields = [
      ...commonFields,
      'FirstName',
      'First Name',
      'firstname',
      'LastName',
      'Last Name',
      'lastname',
      'MiddleName',
      'Middle Name',
      'Salutation',
      'Suffix',
      'MailingStreet',
      'MailingCity',
      'MailingState',
      'MailingStateCode',
      'MailingPostalCode',
      'MailingCountry',
      'MailingCountryCode',
      'IvytekTestPkg__Address_Type__c',
      'IvytekTestPkg__Apartment__c',
      'IvytekTestPkg__Other_Apartment__c',
      'IvytekTestPkg__City__c',
      'IvytekTestPkg__Country__c',
      'IvytekTestPkg__State__c',
      'IvytekTestPkg__Street_Direction__c',
      'IvytekTestPkg__Street_Name__c',
      'IvytekTestPkg__Street_Number__c',
      'IvytekTestPkg__Street_Type__c',
      'IvytekTestPkg__Zip__c',
      'Phone',
      'MobilePhone',
      'HomePhone',
      'OtherPhone',
      'Email',
      'Birthdate',
      'WS_EntityID__c',
      'IvytekTestPkg__SSN__c',
      'IvytekTestPkg__WorkPhone__c',
      'IvytekTestPkg__Credit_Report_Address__c',
      'IvytekTestPkg__Deceased__c',
      'IvytekTestPkg__Differently_Abled__c',
      'IvytekTestPkg__DirectDeposit__c',
      'IvytekTestPkg__Has_Opted_out_of_SMS__c',
      'IvytekTestPkg__HasOptedOutOfEmail__c',
      'HasOptedOutOfEmail',
      'DoNotCall',
      'IvytekTestPkg__LGBTQIA__c',
      'IvytekTestPkg__Race_African_or_African_American__c',
      'IvytekTestPkg__Race_American_Indian_or_Alaska_Native__c',
      'IvytekTestPkg__Race_Asian__c',
      'IvytekTestPkg__Race_Black_or_African_American__c',
      'IvytekTestPkg__Race_Caucasian__c',
      'IvytekTestPkg__Race_Multi_racial__c',
      'IvytekTestPkg__Race_Native_Hawaiian_Other_Pacific_Isl__c',
      'IvytekTestPkg__Race_White__c',
      'IvytekTestPkg__Service_Disabled_Veteran__c',
      'IvytekTestPkg__Veteran__c'
    ];
    const loanFields = [
      ...commonFields,
      'IvytekTestPkg__Customer_Name__c',
      'IvytekTestPkg__Customer_Name_Text__c',
      'IvytekTestPkg__Borrower_Name__c',
      'IvytekTestPkg__Borrower_Name_Text__c',
      'IvytekTestPkg__Application__c',
      'IvytekTestPkg__AccountStatusCode__c',
      'IvytekTestPkg__AmtFinanced__c',
      'IvytekTestPkg__RequestAmount__c',
      'IvytekTestPkg__Approved_Amount__c',
      'IvytekTestPkg__Principle__c',
      'IvytekTestPkg__BalanceNow__c',
      'IvytekTestPkg__AmtNowDueAll__c',
      'AmtNowDueAll',
      'Amount Now Due All',
      'Amount Now Due',
      'IvytekTestPkg__AccruedInterestAll__c',
      'IvytekTestPkg__BackInterestDue__c',
      'IvytekTestPkg__Deferred_Interest_Due__c',
      'IvytekTestPkg__ProjectedAccruedInterest__c',
      'IvytekTestPkg__Next_Payment_Interest_Due__c',
      'IvytekTestPkg__ContractRate__c',
      'IvytekTestPkg__Margin_Rate__c',
      'IvytekTestPkg__Per_Diem_Interest_Rate__c',
      'IvytekTestPkg__Per_Diem_Amount__c',
      'Per_Diem_Amount',
      'PerDiemAmount',
      'Per Diem Amount',
      'IvytekTestPkg__LoanDate__c',
      'IvytekTestPkg__SetUpDate__c',
      'IvytekTestPkg__MatDate__c',
      'IvytekTestPkg__FirstDueDate__c',
      'IvytekTestPkg__CurrentDueDate__c',
      'IvytekTestPkg__LastInterestDate__c',
      'IvytekTestPkg__Next_Payment_Date__c',
      'IvytekTestPkg__Paid_Out_Date__c',
      'IvytekTestPkg__StatusChangeEffDate__c',
      'IvytekTestPkg__Number_of_Payments__c',
      'IvytekTestPkg__Term__c',
      'IvytekTestPkg__Payment_Frequency__c',
      'IvytekTestPkg__Note__c',
      'IvytekTestPkg__Next_Payment_Note__c',
      'IvytekTestPkg__RunningMinDue__c',
      'IvytekTestPkg__FirstPayAmount__c',
      'IvytekTestPkg__Payoff_Amount__c',
      'IvytekTestPkg__Legacy_Loan_ID__c',
      'CompanyWS__c',
      'Company__c',
      'IvytekTestPkg__CompanyWS__c',
      'IvytekTestPkg__Company__c',
      'Mortgage_Code__c',
      'IvytekTestPkg__Mortgage_Code__c',
      'Loan_GroupWS__c',
      'IvytekTestPkg__Loan_GroupWS__c',
      'Family__c',
      'Per_Capita_WS__c',
      'PerCapita',
      'Percapita',
      'Per Capita',
      'Pension_WS__c',
      'Payroll_Deduction_WS__c',
      'IvytekTestPkg__Statement_Street__c',
      'IvytekTestPkg__Statement_City__c',
      'IvytekTestPkg__Statement_State_Province__c',
      'IvytekTestPkg__Statement_PostalCode__c',
      'IvytekTestPkg__Statement_Postal_Code__c'
    ];
    const contactApplicationFields = [
      ...commonFields,
      'IvytekTestPkg__Loan__c',
      'IvytekTestPkg__Contact__c',
      'IvytekTestPkg__Application__c',
      'IvytekTestPkg__ReferenceType__c',
      'IvytekTestPkg__Borrower_Name__c',
      'IvytekTestPkg__Borrower_Name_Text__c',
      'IvytekTestPkg__Customer_Name__c',
      'IvytekTestPkg__Customer_Name_Text__c',
      'IvytekTestPkg__Full_Name__c'
    ];
    const transactionFields = [
      ...commonFields,
      'IvytekTestPkg__LoanID__c',
      'IvytekTestPkg__Loan__c',
      'IvytekTestPkg__AmountPaid__c',
      'IvytekTestPkg__PrinciplePaid__c',
      'IvytekTestPkg__PrincipalPaid__c',
      'IvytekTestPkg__InterestPaid__c',
      'IvytekTestPkg__BackInterestPaid__c',
      'IvytekTestPkg__DeferredInterestPaid__c',
      'IvytekTestPkg__DatePaid__c',
      'IvytekTestPkg__DateLastPaid__c',
      'IvytekTestPkg__Description__c',
      'IvytekTestPkg__TypPay__c',
      'IvytekTestPkg__SpecialTransCode__c',
      'IvytekTestPkg__Voided_Transaction__c'
    ];

    if (sourceType === 'contacts') {
      return clientFields;
    }
    if (sourceType === 'contactApplications') {
      return contactApplicationFields;
    }
    if (sourceType === 'transactions') {
      return transactionFields;
    }
    return loanFields;
  }

  /**
   * Resets all IvyTek staged import results.
   */
  private resetIvyTekPipelineResults() {
    this.ivyTekPipelineError = '';
    this.ivyTekImportResults = [];
    this.ivyTekLoanImportResults = [];
    this.ivyTekTransactionImportResults = [];
    this.ivyTekTransactionExportResults = [];
    this.ivyTekReconciliationStatusKey = 'labels.text.Reconciliation Not Run';
    this.ivyTekReconciliationStatusMessage = '';
    this.selectedIvyTekResult = null;
    this.ivyTekProcessedRecords = 0;
    this.ivyTekLoanProcessedRecords = 0;
    this.ivyTekTransactionProcessedRecords = 0;
    this.ivyTekTotalRecords = 0;
    this.ivyTekLoanTotalRecords = 0;
    this.ivyTekTransactionTotalRecords = 0;
    this.ivyTekContentVersionImportResult = null;
    this.ivyTekContentVersionImportError = null;
    this.ivyTekAttachmentProcessedRecords = 0;
    this.ivyTekAttachmentTotalRecords = 0;
  }

  /**
   * Checks staged result arrays for blocking statuses.
   * @param {any[]} results Stage result array.
   * @param {string[]} statuses Status keys to find.
   */
  private hasIvyTekResultStatus(results: any[], statuses: string[]) {
    return results.some((result: any) => statuses.includes(result.status));
  }

  /**
   * Processes import rows with modest concurrency to keep large IvyTek imports moving.
   * @param {any[]} rows Import rows.
   * @param {(row: any) => Promise<void>} worker Row worker.
   */
  private async processIvyTekRowsWithConcurrency(rows: any[], worker: (row: any) => Promise<void>) {
    let nextIndex = 0;
    const workerCount = Math.min(this.ivyTekImportConcurrency, rows.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < rows.length) {
          const row = rows[nextIndex];
          nextIndex += 1;
          await worker(row);
          await this.yieldIvyTekProgressFrame();
        }
      })
    );
  }

  /**
   * Clears the stored IvyTek import run summary.
   */
  clearIvyTekPipelineRun() {
    if (this.isIvyTekPipelineRunning) {
      return;
    }
    this.ivyTekPipelineRun = null;
    this.ivyTekReconciliationStatusKey = 'labels.text.Reconciliation Not Run';
    this.ivyTekReconciliationStatusMessage = '';
    try {
      localStorage.removeItem(this.ivyTekPipelineRunStorageKey);
    } catch {
      // Ignore storage failures so the import UI can still function.
    }
  }

  /**
   * Retries the current IvyTek staged import with the files still selected in the browser.
   */
  retryIvyTekPipelineRun() {
    if (!this.canRetryIvyTekPipeline) {
      return;
    }
    this.clearIvyTekPipelineRun();
    void this.uploadIvyTekData();
  }

  /**
   * Starts a persisted IvyTek staged import run summary.
   */
  private startIvyTekPipelineRun() {
    const timestamp = new Date().toISOString();
    this.ivyTekPipelineRun = {
      status: 'labels.inputs.Running',
      activeStage: this.getIvyTekStageLabel(this.ivyTekStartStage),
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
      finishedAt: '',
      clientsProcessed: 0,
      clientsTotal: 0,
      loansProcessed: 0,
      loansTotal: 0,
      transactionsProcessed: 0,
      transactionsTotal: 0,
      reconciliationStatus: this.ivyTekReconciliationStatusKey,
      reconciliationMessage: this.ivyTekReconciliationStatusMessage,
      message: ''
    };
    this.persistIvyTekPipelineRun();
  }

  /**
   * Updates a persisted IvyTek staged import run summary.
   * @param {any} updates Partial run summary updates.
   */
  private updateIvyTekPipelineRun(updates: any) {
    if (!this.ivyTekPipelineRun) {
      return;
    }
    this.ivyTekPipelineRun = {
      ...this.ivyTekPipelineRun,
      ...updates,
      lastUpdatedAt: new Date().toISOString()
    };
    this.persistIvyTekPipelineRun();
  }

  /**
   * Throttles local storage writes while keeping visible stage progress fresh.
   * @param {any} updates Partial run summary progress updates.
   */
  private updateIvyTekPipelineRunProgress(updates: any) {
    const processed = updates.clientsProcessed || updates.loansProcessed || updates.transactionsProcessed || 0;
    const total = updates.clientsTotal || updates.loansTotal || updates.transactionsTotal || 0;
    if (processed % 25 === 0 || processed === total) {
      this.updateIvyTekPipelineRun(updates);
    }
  }

  /**
   * Lets the browser repaint the import progress bar/counter mid-stage, throttled to ~100ms.
   *
   * The import stages run as long chains of awaited (often already-resolved) promises. Awaiting
   * resolved promises only drains the microtask queue, which never yields to the browser's render
   * step — so the bound progress fields freeze until the whole stage finishes (only a real DOM event
   * such as clicking Cancel forced a repaint). Breaking the chain with a macrotask (setTimeout) lets
   * the browser paint and lets Angular's zone run change detection on the fresh counts.
   * @param {boolean} force Yield immediately, ignoring the throttle (e.g. on the final record).
   */
  private async yieldIvyTekProgressFrame(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastIvyTekProgressRenderAt < 100) {
      return;
    }
    this.lastIvyTekProgressRenderAt = now;
    this.cdr.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
  }

  /**
   * Finishes a persisted IvyTek staged import run summary.
   * @param {string} status Status translation key.
   * @param {string} message Optional status message.
   */
  private finishIvyTekPipelineRun(status: string, message: string = '') {
    if (!this.ivyTekPipelineRun) {
      return;
    }
    const timestamp = new Date().toISOString();
    this.ivyTekPipelineRun = {
      ...this.ivyTekPipelineRun,
      status,
      message,
      finishedAt: timestamp,
      lastUpdatedAt: timestamp
    };
    this.persistIvyTekPipelineRun();
  }

  /**
   * Restores a persisted IvyTek staged import run summary.
   */
  private restoreIvyTekPipelineRun() {
    try {
      const storedRun = localStorage.getItem(this.ivyTekPipelineRunStorageKey);
      this.ivyTekPipelineRun = storedRun ? JSON.parse(storedRun) : null;
      if (this.ivyTekPipelineRun?.reconciliationStatus) {
        this.ivyTekReconciliationStatusKey = this.ivyTekPipelineRun.reconciliationStatus;
        this.ivyTekReconciliationStatusMessage = this.ivyTekPipelineRun.reconciliationMessage || '';
      }
    } catch {
      this.ivyTekPipelineRun = null;
    }
  }

  /**
   * Persists the current IvyTek staged import run summary.
   */
  private persistIvyTekPipelineRun() {
    try {
      localStorage.setItem(this.ivyTekPipelineRunStorageKey, JSON.stringify(this.ivyTekPipelineRun));
    } catch {
      // Ignore storage failures so the import itself is never blocked by browser storage.
    }
  }

  /**
   * Builds import-ready client rows from contact rows and borrower contact applications.
   * @param {any[]} contactRows IvyTek contact or loan/contact helper rows.
   * @param {any[]} contactApplicationRows IvyTek contact application rows.
   * @param {any[]} loanRows IvyTek loan rows.
   */
  private buildIvyTekClientRows(contactRows: any[], contactApplicationRows: any[], loanRows: any[] = []) {
    if (contactRows.some((row: any) => this.isIvyTekContactRow(row))) {
      return this.buildIvyTekClientRowsFromContacts(contactRows, contactApplicationRows, loanRows);
    }

    return [];
  }

  /**
   * Enriches the real Contact export with stable client linkage and earliest related loan date.
   * @param {any[]} contactRows IvyTek Contact rows.
   * @param {any[]} contactApplicationRows IvyTek contact application rows.
   * @param {any[]} loanRows IvyTek loan rows.
   */
  private buildIvyTekClientRowsFromContacts(contactRows: any[], contactApplicationRows: any[], loanRows: any[]) {
    const loansById = this.buildIvyTekLoanRowsById(loanRows);
    const loanRowsByContactId = this.buildIvyTekLoanRowsByContactId(contactApplicationRows, loansById);

    return contactRows.map((contactRow: any) => {
      const contactSourceId = this.getIvyTekContactSourceId(contactRow);
      const relatedLoanRows = contactSourceId ? loanRowsByContactId.get(contactSourceId) || [] : [];
      const earliestLoanDate = this.getEarliestIvyTekDate(
        relatedLoanRows.flatMap((loanRow: any) => [
          this.getCsvValue(loanRow, 'IvytekTestPkg__LoanDate__c'),
          this.getCsvValue(loanRow, 'IvytekTestPkg__SetUpDate__c')
        ])
      );
      const officeSourceRow = this.getIvyTekOfficeSourceLoanRow(relatedLoanRows) || contactRow;
      const companyOffice = this.getIvyTekOfficeForRow(officeSourceRow);
      const safeEarliestLoanDate = this.getIvyTekOfficeSafeDate(earliestLoanDate, officeSourceRow);
      return {
        ...contactRow,
        IvyTekClientExternalID: this.getIvyTekContactExternalId(contactRow),
        IvyTekClientSourceContactID: contactSourceId,
        IvyTekClientSourceExternalID: this.getCsvValue(contactRow, 'IvytekTestPkg__ExternalID__c'),
        IvyTekClientEntityID: this.getIvyTekEntityId(contactRow),
        IvyTekClientCompanyCode: this.getIvyTekCompanyCode(officeSourceRow),
        IvyTekClientOfficeId: companyOffice?.id || '',
        IvyTekClientOfficeName: companyOffice?.name || '',
        IvyTekClientActivationDate: safeEarliestLoanDate
          ? this.dateUtils.formatDate(safeEarliestLoanDate, this.settingsService.dateFormat)
          : this.getIvyTekClientActivationDate(contactRow),
        IvyTekClientActivationDateSource: earliestLoanDate ? 'loan' : '',
        IvyTekClientRelatedExternalIDs: this.getUniqueIvyTekIdentifiers([
          contactSourceId,
          this.getCsvValue(contactRow, 'IvytekTestPkg__ExternalID__c')
        ]).join(',')
      };
    });
  }

  /**
   * Gets the loan row that should drive the office for a client with one or more related loans.
   * @param {any[]} loanRows Related IvyTek loan rows.
   */
  private getIvyTekOfficeSourceLoanRow(loanRows: any[]): any {
    return [...loanRows].sort((first: any, second: any) => {
      const firstDate = this.getEarliestIvyTekDate([
        this.getCsvValue(first, 'IvytekTestPkg__LoanDate__c'),
        this.getCsvValue(first, 'IvytekTestPkg__SetUpDate__c')
      ]);
      const secondDate = this.getEarliestIvyTekDate([
        this.getCsvValue(second, 'IvytekTestPkg__LoanDate__c'),
        this.getCsvValue(second, 'IvytekTestPkg__SetUpDate__c')
      ]);
      if (!firstDate && !secondDate) {
        return 0;
      }
      if (!firstDate) {
        return 1;
      }
      if (!secondDate) {
        return -1;
      }
      return firstDate.getTime() - secondDate.getTime();
    })[0];
  }

  /**
   * Builds related loan rows by borrower contact id.
   * @param {any[]} contactApplicationRows IvyTek contact application rows.
   * @param {Map<string, any>} loansById IvyTek loan rows keyed by Salesforce loan id.
   */
  private buildIvyTekLoanRowsByContactId(contactApplicationRows: any[], loansById: Map<string, any>) {
    const loanRowsByContactId = new Map<string, any[]>();
    contactApplicationRows
      .filter(
        (row: any) => this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__ReferenceType__c')) === 'borrower'
      )
      .forEach((contactApplication: any) => {
        const contactId = this.getCsvValue(contactApplication, 'IvytekTestPkg__Contact__c');
        const loanRow = this.getSalesforceIdKeys(this.getCsvValue(contactApplication, 'IvytekTestPkg__Loan__c'))
          .map((loanId: string) => loansById.get(loanId))
          .find((match: any) => !!match);
        if (!contactId || !loanRow) {
          return;
        }
        loanRowsByContactId.set(contactId, [
          ...(loanRowsByContactId.get(contactId) || []),
          loanRow
        ]);
      });
    return loanRowsByContactId;
  }

  /**
   * Creates one client source row per borrower contact id when the contact file is a loan-shaped helper export.
   * @param {any[]} contactRows IvyTek contact or loan/contact helper rows.
   * @param {any[]} contactApplicationRows IvyTek contact application rows.
   */
  private buildIvyTekClientRowsFromContactApplications(contactRows: any[], contactApplicationRows: any[]) {
    const helperRowsByLoanId = this.buildIvyTekLoanRowsById(contactRows);
    const clientRowsByContactId = new Map<string, any>();

    contactApplicationRows
      .filter(
        (row: any) => this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__ReferenceType__c')) === 'borrower'
      )
      .forEach((contactApplication: any) => {
        const contactId = this.getCsvValue(contactApplication, 'IvytekTestPkg__Contact__c');
        if (!contactId) {
          return;
        }

        const helperRow = this.getSalesforceIdKeys(this.getCsvValue(contactApplication, 'IvytekTestPkg__Loan__c'))
          .map((loanId: string) => helperRowsByLoanId.get(loanId))
          .find((match: any) => !!match);

        if (!helperRow) {
          return;
        }

        const clientRow = this.buildIvyTekClientRowFromLoanAndContactApplication(helperRow, contactApplication);
        const existingClientRow = clientRowsByContactId.get(contactId);
        if (existingClientRow) {
          this.mergeIvyTekClientRows(existingClientRow, clientRow);
        } else {
          clientRowsByContactId.set(contactId, clientRow);
        }
      });

    return Array.from(clientRowsByContactId.values());
  }

  /**
   * Builds a stable client row from a loan-shaped helper row and borrower contact application row.
   * @param {any} helperRow IvyTek loan/helper row.
   * @param {any} contactApplication IvyTek contact application row.
   */
  private buildIvyTekClientRowFromLoanAndContactApplication(helperRow: any, contactApplication: any) {
    const contactId = this.getCsvValue(contactApplication, 'IvytekTestPkg__Contact__c');
    const helperExternalId = this.getCsvValue(helperRow, 'IvytekTestPkg__ExternalID__c');
    const contactApplicationExternalId = this.getCsvValue(contactApplication, 'IvytekTestPkg__ExternalID__c');
    const companyOffice = this.getIvyTekOfficeForRow(helperRow);
    return {
      ...helperRow,
      IvyTekClientExternalID: contactId || helperExternalId || contactApplicationExternalId,
      IvyTekClientSourceExternalID: helperExternalId,
      IvyTekClientApplicationExternalID: contactApplicationExternalId,
      IvytekTestPkg__Borrower_Contact__c: contactId,
      IvytekTestPkg__Contact__c: contactId,
      IvytekTestPkg__ContactApplication__c: this.getCsvValue(contactApplication, 'Id'),
      IvytekTestPkg__ContactApplication_ExternalID__c: contactApplicationExternalId,
      IvyTekClientEntityID: this.getIvyTekEntityId(helperRow),
      IvyTekClientCompanyCode: this.getIvyTekCompanyCode(helperRow),
      IvyTekClientOfficeId: companyOffice?.id || '',
      IvyTekClientOfficeName: companyOffice?.name || '',
      IvyTekClientActivationDate: this.getIvyTekClientActivationDate(helperRow),
      IvyTekClientActivationDateSource: 'loan',
      IvyTekClientRelatedExternalIDs: this.getUniqueIvyTekIdentifiers([
        helperExternalId,
        contactApplicationExternalId
      ]).join(',')
    };
  }

  /**
   * Merges later loan helper rows into the one client row that will be imported.
   * @param {any} existingRow Existing client import row.
   * @param {any} nextRow Next source row for the same borrower contact.
   */
  private mergeIvyTekClientRows(existingRow: any, nextRow: any) {
    Object.keys(nextRow).forEach((key: string) => {
      if (!this.getCsvValue(existingRow, key) && this.getCsvValue(nextRow, key)) {
        existingRow[key] = nextRow[key];
      }
    });

    const earliestActivationDate = this.getEarliestIvyTekDate([
      this.getCsvValue(existingRow, 'IvyTekClientActivationDate'),
      this.getCsvValue(nextRow, 'IvyTekClientActivationDate')
    ]);
    if (earliestActivationDate) {
      existingRow.IvyTekClientActivationDate = this.dateUtils.formatDate(
        earliestActivationDate,
        this.settingsService.dateFormat
      );
    }
    if (
      this.getCsvValue(existingRow, 'IvyTekClientActivationDateSource') === 'loan' ||
      this.getCsvValue(nextRow, 'IvyTekClientActivationDateSource') === 'loan'
    ) {
      existingRow.IvyTekClientActivationDateSource = 'loan';
    }

    existingRow.IvyTekClientRelatedExternalIDs = this.getUniqueIvyTekIdentifiers([
      ...this.getCsvValue(existingRow, 'IvyTekClientRelatedExternalIDs').split(','),
      ...this.getCsvValue(nextRow, 'IvyTekClientRelatedExternalIDs').split(','),
      this.getIvyTekExternalId(nextRow),
      this.getCsvValue(nextRow, 'IvyTekClientSourceExternalID'),
      this.getCsvValue(nextRow, 'IvyTekClientApplicationExternalID')
    ]).join(',');
  }

  /**
   * Creates a Mifos loan account from an IvyTek loan CSV row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any>} helperRowsByLoanId helper rows keyed by loan id.
   * @param {Map<string, any[]>} contactApplicationsByLoanId contact application rows keyed by loan id.
   * @param {Map<string, any>} contactRowsById contact rows keyed by source/contact ids.
   * @param {Map<string, any[]>} contactRowsByName contact rows keyed by normalized names.
   * @param {Map<string, any>} contactApplicationRowsById contact application rows keyed by source id.
   * @param {Map<string, any>} productsByName loan products keyed by normalized product name.
   * @param {Map<string, any>} clientCache client lookup cache.
   * @param {Map<string, any>} productDetailsCache product details cache.
   * @param {Map<string, any[]>} transactionRowsByLoanId transaction rows keyed by Salesforce loan id.
   */
  private async createIvyTekLoan(
    row: any,
    helperRowsByLoanId: Map<string, any>,
    contactApplicationsByLoanId: Map<string, any[]>,
    contactRowsById: Map<string, any>,
    contactRowsByName: Map<string, any[]>,
    contactApplicationRowsById: Map<string, any>,
    productsByName: Map<string, any>,
    clientCache: Map<string, any>,
    syncedClientIds: Set<string>,
    productDetailsCache: Map<string, any>,
    transactionRowsByLoanId: Map<string, any[]> = new Map<string, any[]>()
  ) {
    const result = this.createIvyTekLoanResult(row);
    let payload: any = null;

    try {
      const group = this.getIvyTekLoanGroup(row);
      const product = this.findIvyTekLoanProductByGroup(group, productsByName);
      const productName = product?.name || this.getIvyTekProductName(group);
      if (!productName) {
        this.setIvyTekLoanResultStatus(
          result,
          'labels.inputs.Skipped',
          `Unmapped or review loan group: ${group || '(blank)'}`
        );
        this.ivyTekLoanImportResults.push(result);
        return;
      }
      if (!product?.id) {
        throw new Error(`Mifos loan product was not found: ${productName}`);
      }

      const principal = this.getIvyTekLoanPrincipal(row);
      const balanceNow = this.getIvyTekLoanBalanceNow(row);
      const repayments = this.getIvyTekNumberOfRepayments(row, principal, balanceNow);
      const historicalRepaymentSummary = this.getIvyTekHistoricalRepaymentSummary(
        this.getIvyTekLoanTransactionRows(row, transactionRowsByLoanId),
        this.getIvyTekLoanDate(row),
        principal
      );
      const mappedValueReviewMessage = this.getIvyTekLoanMappedValueReviewMessage(
        row,
        principal,
        balanceNow,
        repayments
      );
      result.mappedValues = this.getIvyTekLoanMappedValues(row, productName, principal, balanceNow, repayments);
      result.mappedValues = {
        ...result.mappedValues,
        ...this.getIvyTekLoanProductMappedValues(group, product),
        ...this.getIvyTekHistoricalRepaymentMappedValues(historicalRepaymentSummary)
      };
      if (mappedValueReviewMessage) {
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Skipped', mappedValueReviewMessage);
        this.ivyTekLoanImportResults.push(result);
        return;
      }

      if (!repayments || repayments <= 0) {
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Skipped', this.getIvyTekRepaymentReviewMessage(row));
        this.ivyTekLoanImportResults.push(result);
        return;
      }

      const clientSourceRowForResult = this.getIvyTekClientRowForLoan(
        row,
        helperRowsByLoanId,
        contactApplicationsByLoanId,
        contactRowsById,
        contactRowsByName,
        contactApplicationRowsById
      );
      const client = await this.ensureIvyTekLoanClient(
        row,
        helperRowsByLoanId,
        contactApplicationsByLoanId,
        contactRowsById,
        contactRowsByName,
        contactApplicationRowsById,
        clientCache,
        syncedClientIds
      );
      if (!client?.id) {
        const hasClientLookupData =
          contactRowsById.size || contactRowsByName.size || contactApplicationsByLoanId.size || helperRowsByLoanId.size;
        const missingClientMessage = hasClientLookupData
          ? 'No matching Contact row or Mifos client was found from the provided lookup data. No fallback client was created.'
          : 'No matching Mifos client was found.';
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Failed', missingClientMessage);
        this.ivyTekLoanImportResults.push(result);
        return;
      }
      result.mappedValues = {
        ...result.mappedValues,
        matchedClientId: this.getIvyTekClientId(client),
        matchedClientName: this.getIvyTekClientDisplayName(client),
        matchedClientExternalId: client?.externalId || '',
        matchedClientSourceExternalId: clientSourceRowForResult
          ? this.getIvyTekExternalId(clientSourceRowForResult)
          : '',
        matchedClientSourceContactId: this.getCsvValue(clientSourceRowForResult || {}, 'IvyTekClientSourceContactID'),
        matchedClientEntityId: clientSourceRowForResult ? this.getIvyTekEntityId(clientSourceRowForResult) : '',
        matchedClientLookupMethod: this.getIvyTekLoanClientLookupMethod(clientSourceRowForResult)
      };

      const productDetails = await this.getIvyTekLoanProductDetails(product.id, productDetailsCache);
      const shouldApproveAndDisburse = this.shouldApproveAndDisburseIvyTekLoan(row, balanceNow);
      const shouldCloseAfterDisbursement =
        this.shouldPostIvyTekTransactionsInStage3() || this.shouldUseIvyTekStaticLoanSnapshot()
          ? false
          : this.shouldCloseIvyTekLoanAfterDisbursement(row, balanceNow);
      let payloadPrincipal = this.getIvyTekLoanPayloadPrincipal(
        row,
        principal,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement
      );
      const migrationPrincipalPaid = this.getIvyTekActiveLoanMigrationPrincipalPaid(
        row,
        payloadPrincipal,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement
      );
      const principalSnapshotAdjustment = this.getIvyTekPrincipalSnapshotAdjustment(principal, payloadPrincipal);
      const originationDateCorrection = this.getIvyTekOriginationDateCorrection(row, historicalRepaymentSummary);
      let payloadLoanDate = this.getIvyTekLoanPayloadDate(row, historicalRepaymentSummary);
      let payloadInterestRatePercent = this.getIvyTekLoanPayloadInterestRatePercent(
        row,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement,
        historicalRepaymentSummary
      );
      let payloadInterestChargedFromDate = this.getIvyTekLoanInterestChargedFromDate(
        row,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement,
        historicalRepaymentSummary
      );
      const migrationTransactionDate = this.getIvyTekMigrationTransactionDate(row, payloadLoanDate);

      // History-start re-origination (approach A): override the created loan so Fineract
      // generates a native, serviceable schedule at a recent disbursement date with the
      // reconstructed opening balance. The posted payment history reduces it to BalanceNow
      // (exact 1:1). Interest is held at 0% here; go-forward interest is a follow-up pass.
      const historyStartPlan = this.getIvyTekHistoryStartPlan(
        row,
        balanceNow,
        historicalRepaymentSummary,
        principal,
        repayments,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement
      );
      let payloadRepayments: number | null = repayments;
      let historyStartDisburseAmount: number | null = null;
      if (historyStartPlan) {
        payloadPrincipal = historyStartPlan.principal;
        payloadLoanDate = historyStartPlan.disbursementDate;
        payloadRepayments = historyStartPlan.numberOfRepayments;
        payloadInterestRatePercent = 0;
        payloadInterestChargedFromDate = '';
        historyStartDisburseAmount = historyStartPlan.principal;
      }
      result.mappedValues = {
        ...result.mappedValues,
        staticSnapshotMode: this.shouldUseIvyTekStaticLoanSnapshot() ? 'Yes' : 'No',
        requiresSqlSnapshotImport: this.shouldUseIvyTekStaticLoanSnapshot()
          ? 'Static snapshot values are authoritative; Fineract engine values are diagnostic.'
          : '',
        restLifecycleSuppressed: this.shouldUseIvyTekStaticLoanSnapshot() ? 'Yes' : 'No',
        payloadPrincipal,
        principalSnapshotAdjustment: principalSnapshotAdjustment ?? '',
        migrationPrincipalPaid: migrationPrincipalPaid ?? '',
        migrationTransactionDate,
        payloadInterestRatePercent,
        payloadLoanDate,
        payloadInterestChargedFromDate,
        sourceLoanDate: this.getIvyTekSourceLoanDate(row),
        originationDateCorrection: originationDateCorrection?.note || '',
        interestAccrualSuppressed: this.isIvyTekLoanInterestAccrualSuppressed(
          row,
          balanceNow,
          shouldApproveAndDisburse,
          shouldCloseAfterDisbursement,
          historicalRepaymentSummary
        )
          ? 'Yes'
          : 'No',
        historicalCloseDate: shouldCloseAfterDisbursement ? this.getIvyTekHistoricalLoanCloseDate(row) : '',
        willCloseAfterDisbursement: shouldCloseAfterDisbursement ? 'Yes' : 'No',
        willApproveAndDisburse: shouldApproveAndDisburse ? 'Yes' : 'No'
      };
      payload = this.getIvyTekLoanPayload(
        row,
        client,
        product,
        productDetails,
        payloadPrincipal,
        payloadRepayments,
        payloadInterestRatePercent,
        payloadLoanDate,
        payloadInterestChargedFromDate
      );
      const lifecycleMessage = this.getIvyTekLoanLifecycleMessage(
        row,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement,
        payloadLoanDate,
        payloadInterestChargedFromDate,
        migrationPrincipalPaid,
        payloadPrincipal,
        historicalRepaymentSummary
      );

      const existingLoan = await this.findIvyTekLoanByExternalId(payload.externalId, payload.accountNo);
      if (existingLoan) {
        result.loanId = this.getIvyTekLoanId(existingLoan);
        if (!result.loanId) {
          throw new Error(`Existing loan was found for ${payload.externalId}, but no loan id was returned.`);
        }
        if (!this.canUpdateExistingIvyTekLoan(existingLoan)) {
          const tribalLoanDataUpdated = await this.upsertIvyTekLoanTribalData(result.loanId, row);
          this.setIvyTekLoanTribalResult(result, tribalLoanDataUpdated);
          await this.restoreIvyTekLoanInterestRateForStaticImport(result, result.loanId, row, payload, existingLoan);
          const existingLifecycleMessage = await this.transitionIvyTekExistingLoanLifecycle(
            result.loanId,
            existingLoan,
            row,
            balanceNow,
            shouldApproveAndDisburse,
            payload.submittedOnDate,
            historicalRepaymentSummary
          );
          this.setIvyTekLoanResultStatus(
            result,
            'labels.inputs.Updated',
            this.getIvyTekExistingLoanUnchangedMessage(
              existingLoan,
              this.joinIvyTekMessages([
                lifecycleMessage,
                existingLifecycleMessage
              ])
            )
          );
          await this.setIvyTekLoanImportedSnapshotResult(result, result.loanId, row, payload);
          this.ivyTekLoanImportResults.push(result);
          return;
        }
        try {
          const activationMessage = await this.updateIvyTekLoanWithClientActivationFallback(
            row,
            client,
            result.loanId,
            payload
          );
          const tribalLoanDataUpdated = await this.upsertIvyTekLoanTribalData(result.loanId, row);
          this.setIvyTekLoanTribalResult(result, tribalLoanDataUpdated);
          await this.restoreIvyTekLoanInterestRateForStaticImport(result, result.loanId, row, payload, existingLoan);
          const existingLifecycleMessage = await this.transitionIvyTekExistingLoanLifecycle(
            result.loanId,
            existingLoan,
            row,
            balanceNow,
            shouldApproveAndDisburse,
            payload.submittedOnDate,
            historicalRepaymentSummary
          );
          this.setIvyTekLoanResultStatus(
            result,
            'labels.inputs.Updated',
            this.joinIvyTekMessages([
              lifecycleMessage,
              activationMessage,
              existingLifecycleMessage
            ])
          );
        } catch (updateError: any) {
          if (!this.isIvyTekLoanCurrentStateError(updateError)) {
            throw updateError;
          }
          const tribalLoanDataUpdated = await this.upsertIvyTekLoanTribalData(result.loanId, row);
          this.setIvyTekLoanTribalResult(result, tribalLoanDataUpdated);
          const existingLifecycleMessage = await this.transitionIvyTekExistingLoanLifecycle(
            result.loanId,
            existingLoan,
            row,
            balanceNow,
            shouldApproveAndDisburse,
            payload.submittedOnDate,
            historicalRepaymentSummary
          );
          this.setIvyTekLoanResultStatus(
            result,
            'labels.inputs.Updated',
            this.getIvyTekExistingLoanUnchangedMessage(
              existingLoan,
              this.joinIvyTekMessages([
                lifecycleMessage,
                existingLifecycleMessage
              ])
            )
          );
        }
        await this.setIvyTekLoanImportedSnapshotResult(result, result.loanId, row, payload);
        this.ivyTekLoanImportResults.push(result);
        return;
      }

      try {
        const createdLoan = await this.createIvyTekLoanWithClientActivationFallback(row, client, payload);
        const response: any = createdLoan.response;
        result.loanId = response?.resourceId || response?.loanId || response?.id;
        if (result.loanId) {
          const tribalLoanDataUpdated = await this.upsertIvyTekLoanTribalData(result.loanId, row);
          this.setIvyTekLoanTribalResult(result, tribalLoanDataUpdated);
        }
        const createdLoanDate = createdLoan.loanDate || payloadLoanDate || this.getIvyTekLoanDate(row);
        if (result.loanId) {
          await this.restoreIvyTekLoanInterestRateForStaticImport(result, result.loanId, row, payload, response);
        }
        if (result.loanId && shouldApproveAndDisburse) {
          await this.approveAndDisburseIvyTekLoan(result.loanId, createdLoanDate, historyStartDisburseAmount);
        }
        // Full-SQL mode: balances, closure, and arrears come from the loan-state-sync
        // SQL step, so no REST migration repayment or settle/close is posted.
        const migrationRepaymentMessage =
          result.loanId && shouldApproveAndDisburse && !this.ivyTekFullSqlLoanImport
            ? await this.repayIvyTekActiveLoanToBalanceNow(
                result.loanId,
                row,
                balanceNow,
                this.getIvyTekMigrationTransactionDate(row, createdLoanDate),
                shouldApproveAndDisburse,
                shouldCloseAfterDisbursement,
                historicalRepaymentSummary
              )
            : '';
        const closeMessage =
          result.loanId && !this.shouldPostIvyTekTransactionsInStage3() && !this.ivyTekFullSqlLoanImport
            ? await this.settleAndCloseIvyTekNonActiveLoan(result.loanId, row, balanceNow, createdLoanDate)
            : '';
        this.setIvyTekLoanResultStatus(
          result,
          'labels.inputs.Created',
          this.joinIvyTekMessages([
            lifecycleMessage,
            createdLoan.activationMessage,
            migrationRepaymentMessage,
            closeMessage
          ])
        );
      } catch (createError: any) {
        if (!this.isIvyTekDuplicateLoanExternalIdError(createError)) {
          throw createError;
        }
        const duplicateLoan = await this.findIvyTekLoanByExternalId(payload.externalId, payload.accountNo);
        result.loanId = this.getIvyTekLoanId(duplicateLoan);
        if (!result.loanId) {
          throw createError;
        }
        try {
          const activationMessage = await this.updateIvyTekLoanWithClientActivationFallback(
            row,
            client,
            result.loanId,
            payload
          );
          const tribalLoanDataUpdated = await this.upsertIvyTekLoanTribalData(result.loanId, row);
          this.setIvyTekLoanTribalResult(result, tribalLoanDataUpdated);
          await this.restoreIvyTekLoanInterestRateForStaticImport(result, result.loanId, row, payload, duplicateLoan);
          const existingLifecycleMessage = await this.transitionIvyTekExistingLoanLifecycle(
            result.loanId,
            duplicateLoan,
            row,
            balanceNow,
            shouldApproveAndDisburse,
            payload.submittedOnDate,
            historicalRepaymentSummary
          );
          this.setIvyTekLoanResultStatus(
            result,
            'labels.inputs.Updated',
            this.joinIvyTekMessages([
              lifecycleMessage,
              activationMessage,
              existingLifecycleMessage
            ])
          );
        } catch (updateError: any) {
          if (!this.isIvyTekLoanCurrentStateError(updateError)) {
            throw updateError;
          }
          const tribalLoanDataUpdated = await this.upsertIvyTekLoanTribalData(result.loanId, row);
          this.setIvyTekLoanTribalResult(result, tribalLoanDataUpdated);
          const existingLifecycleMessage = await this.transitionIvyTekExistingLoanLifecycle(
            result.loanId,
            duplicateLoan,
            row,
            balanceNow,
            shouldApproveAndDisburse,
            payload.submittedOnDate,
            historicalRepaymentSummary
          );
          this.setIvyTekLoanResultStatus(
            result,
            'labels.inputs.Updated',
            this.getIvyTekExistingLoanUnchangedMessage(
              duplicateLoan,
              this.joinIvyTekMessages([
                lifecycleMessage,
                existingLifecycleMessage
              ])
            )
          );
        }
      }
    } catch (error: any) {
      this.setIvyTekLoanResultStatus(
        result,
        'labels.inputs.Failed',
        this.joinIvyTekMessages([
          this.getErrorMessage(error),
          this.getIvyTekLoanDateDebugSummary(row, payload, error)
        ])
      );
    }

    await this.setIvyTekLoanImportedSnapshotResult(result, result.loanId, row, payload);
    this.ivyTekLoanImportResults.push(result);
  }

  /**
   * Summarizes every date involved in a failed loan submission so date-rule
   * rejections show exactly which value Fineract refused.
   * @param {any} row IvyTek loan row.
   * @param {any} payload Loan payload built for the row (may be null on early failures).
   * @param {any} error API error — retried attempts attach the payload they sent.
   */
  private getIvyTekLoanDateDebugSummary(row: any, payload: any, error: any = null): string {
    const attempted = error?.ivyTekAttemptedPayload || payload;
    const perDiem = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__Per_Diem_Interest_Rate__c'));
    const accrued = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__AccruedInterestAll__c'));
    const daysAccrued =
      perDiem && perDiem > 0 && accrued !== null && accrued >= 0 ? Math.round(accrued / perDiem) : null;
    const parts = [
      attempted?.submittedOnDate ? `submittedOnDate=${attempted.submittedOnDate}` : '',
      attempted?.expectedDisbursementDate ? `expectedDisbursementDate=${attempted.expectedDisbursementDate}` : '',
      attempted?.repaymentsStartingFromDate ? `repaymentsStartingFromDate=${attempted.repaymentsStartingFromDate}` : '',
      attempted?.interestChargedFromDate ? `interestChargedFromDate=${attempted.interestChargedFromDate}` : '',
      error?.ivyTekAttemptedPayload ? '(dates above are from the final clamped retry)' : '',
      `sourceLoanDate=${this.getIvyTekSourceLoanDate(row) || '(none)'}`,
      `currentDueDate=${this.getCsvValue(row, 'IvytekTestPkg__CurrentDueDate__c') || '(none)'}`,
      `perDiem=${perDiem ?? '(none)'}`,
      `accruedInterestAll=${accrued ?? '(none)'}`,
      daysAccrued !== null ? `daysAccrued=${daysAccrued}` : '',
      `ivyTekExportDate=${this.getIvyTekReconciliationDateString() || '(not set)'}`,
      this.ivyTekFineractBusinessDate
        ? `serverBusinessDate=${this.dateUtils.formatDate(this.ivyTekFineractBusinessDate, this.settingsService.dateFormat)}`
        : 'serverBusinessDate=(not yet learned)'
    ].filter(Boolean);
    return `[Date debug — ${parts.join('; ')}]`;
  }

  /**
   * Creates a loan, backdating the matched client when Fineract requires the client activation date
   * to be on or before the historical IvyTek loan date.
   * @param {any} row IvyTek loan row.
   * @param {any} client Matched client.
   * @param {any} payload Loan payload.
   */
  private async createIvyTekLoanWithClientActivationFallback(row: any, client: any, payload: any) {
    try {
      return await this.createIvyTekLoanWithFutureDateFallback(row, payload);
    } catch (error: any) {
      if (!this.isIvyTekClientActivationLoanDateError(error)) {
        throw error;
      }
      let activationMessage = '';
      try {
        activationMessage = await this.backdateIvyTekLoanClientActivation(client, row, payload.submittedOnDate);
      } catch (backdateError: any) {
        // Fall through to the retry/floor path — the loan can still import on the
        // client's current activation date.
        activationMessage = `Client activation backdate failed: ${this.getErrorMessage(backdateError)}`;
      }
      try {
        const created = await this.createIvyTekLoanWithFutureDateFallback(row, payload);
        return {
          ...created,
          activationMessage: this.joinIvyTekMessages([
            activationMessage,
            created.activationMessage
          ])
        };
      } catch (retryError: any) {
        if (!this.isIvyTekClientActivationLoanDateError(retryError)) {
          throw retryError;
        }
        // Backdating could not reach the corrected loan date — raise the loan date to
        // the client's actual activation date instead so the import still completes.
        const floored = await this.getIvyTekLoanPayloadFlooredToClientActivation(row, client, payload);
        if (!floored) {
          throw retryError;
        }
        try {
          const created = await this.createIvyTekLoanWithFutureDateFallback(row, floored.payload);
          return {
            ...created,
            loanDate: created.loanDate,
            activationMessage: this.joinIvyTekMessages([
              activationMessage,
              floored.message,
              created.activationMessage
            ])
          };
        } catch (flooredError: any) {
          flooredError.ivyTekAttemptedPayload = flooredError.ivyTekAttemptedPayload || floored.payload;
          throw flooredError;
        }
      }
    }
  }

  /**
   * Rebuilds a rejected loan payload with its dates raised to the client's actual
   * activation date — the last resort when the activation date cannot be backdated
   * far enough to cover a corrected origination date.
   * @param {any} row IvyTek loan row.
   * @param {any} client Matched client.
   * @param {any} payload Rejected loan payload.
   */
  private async getIvyTekLoanPayloadFlooredToClientActivation(
    row: any,
    client: any,
    payload: any
  ): Promise<{ payload: any; message: string } | null> {
    const clientId = this.getIvyTekClientId(client);
    if (!clientId) {
      return null;
    }
    let activationDate: Date | null = null;
    try {
      const clientData: any = await firstValueFrom(this.clientsService.getClientDataAndTemplate(clientId));
      activationDate = this.parseIvyTekDateValue(
        clientData?.activationDate || clientData?.timeline?.activatedOnDate || clientData?.timeline?.submittedOnDate
      );
    } catch {
      activationDate = null;
    }
    if (!activationDate) {
      return null;
    }
    const submitted = this.parseIvyTekDate(payload.submittedOnDate);
    if (!submitted || submitted.getTime() >= activationDate.getTime()) {
      return null;
    }
    const floorText = this.dateUtils.formatDate(activationDate, this.settingsService.dateFormat);
    const floored = this.getIvyTekLoanPayloadWithDate(row, payload, floorText);
    if (floored.interestChargedFromDate) {
      const interestStart = this.parseIvyTekDate(floored.interestChargedFromDate);
      if (!interestStart || interestStart.getTime() <= activationDate.getTime()) {
        delete floored.interestChargedFromDate;
      }
    }
    Object.keys(floored).forEach((key: string) => {
      if (floored[key] === '' || floored[key] === null || floored[key] === undefined) {
        delete floored[key];
      }
    });
    return {
      payload: floored,
      message: `Client activation could not be backdated below ${floorText}; the loan was submitted on the activation date instead.`
    };
  }

  /**
   * Creates a loan, retrying once with dates clamped to the server-reported business
   * date when Fineract rejects the corrected dates as being in the future. The learned
   * date is cached so every subsequent loan in the run clamps correctly up front.
   * @param {any} row IvyTek loan row.
   * @param {any} payload Loan payload.
   */
  private async createIvyTekLoanWithFutureDateFallback(row: any, payload: any) {
    try {
      return {
        response: await firstValueFrom(this.loansService.createLoansAccount('loans', payload)),
        activationMessage: '',
        loanDate: payload.submittedOnDate
      };
    } catch (error: any) {
      if (!this.isIvyTekFutureLoanDateError(error)) {
        throw error;
      }
      const clamped = await this.getIvyTekLoanPayloadClampedToServerDate(row, payload);
      if (!clamped) {
        throw error;
      }
      try {
        return {
          response: await firstValueFrom(this.loansService.createLoansAccount('loans', clamped.payload)),
          activationMessage: clamped.message,
          loanDate: clamped.payload.submittedOnDate
        };
      } catch (clampedError: any) {
        clampedError.ivyTekAttemptedPayload = clamped.payload;
        throw clampedError;
      }
    }
  }

  /**
   * Learns the effective Fineract business date from a loan template — its default
   * expectedDisbursementDate is the server's "today" — and rebuilds the payload with
   * all dates clamped to it. Returns null when the server date cannot be determined
   * or the payload dates were not actually beyond it.
   * @param {any} row IvyTek loan row.
   * @param {any} payload Rejected loan payload.
   */
  private async getIvyTekLoanPayloadClampedToServerDate(
    row: any,
    payload: any
  ): Promise<{ payload: any; message: string } | null> {
    let serverDate: Date | null = null;
    try {
      const template: any = await firstValueFrom(
        this.loansService.getLoansAccountTemplateResource(payload.clientId, false, payload.productId)
      );
      serverDate = this.parseIvyTekDateValue(
        template?.timeline?.expectedDisbursementDate ?? template?.expectedDisbursementDate
      );
    } catch {
      serverDate = null;
    }
    if (!serverDate) {
      return null;
    }
    serverDate.setHours(0, 0, 0, 0);
    this.ivyTekFineractBusinessDate = serverDate;

    const submitted = this.parseIvyTekDate(payload.submittedOnDate);
    if (!submitted || submitted.getTime() <= serverDate.getTime()) {
      return null;
    }

    const clampedText = this.dateUtils.formatDate(serverDate, this.settingsService.dateFormat);
    const clampedPayload = this.getIvyTekLoanPayloadWithDate(row, payload, clampedText);
    if (clampedPayload.interestChargedFromDate) {
      const interestStart = this.parseIvyTekDate(clampedPayload.interestChargedFromDate);
      if (!interestStart || interestStart.getTime() >= serverDate.getTime()) {
        delete clampedPayload.interestChargedFromDate;
      }
    }
    Object.keys(clampedPayload).forEach((key: string) => {
      if (clampedPayload[key] === '' || clampedPayload[key] === null || clampedPayload[key] === undefined) {
        delete clampedPayload[key];
      }
    });
    return {
      payload: clampedPayload,
      message: `Fineract rejected ${payload.submittedOnDate} as a future date; the loan was submitted on the server business date ${clampedText} instead.`
    };
  }

  /**
   * Updates a loan, backdating the matched client when Fineract requires the client activation date
   * to be on or before the historical IvyTek loan date.
   * @param {any} row IvyTek loan row.
   * @param {any} client Matched client.
   * @param {string} loanId Mifos loan id.
   * @param {any} payload Loan payload.
   */
  private async updateIvyTekLoanWithClientActivationFallback(row: any, client: any, loanId: string, payload: any) {
    try {
      await firstValueFrom(this.loansService.updateLoansAccount('loans', loanId, payload));
      return '';
    } catch (error: any) {
      if (this.isIvyTekFutureLoanDateError(error)) {
        const clamped = await this.getIvyTekLoanPayloadClampedToServerDate(row, payload);
        if (!clamped) {
          throw error;
        }
        await firstValueFrom(this.loansService.updateLoansAccount('loans', loanId, clamped.payload));
        return clamped.message;
      }
      if (!this.isIvyTekClientActivationLoanDateError(error)) {
        throw error;
      }
      let activationMessage = '';
      try {
        activationMessage = await this.backdateIvyTekLoanClientActivation(client, row, payload.submittedOnDate);
      } catch (backdateError: any) {
        activationMessage = `Client activation backdate failed: ${this.getErrorMessage(backdateError)}`;
      }
      try {
        await firstValueFrom(this.loansService.updateLoansAccount('loans', loanId, payload));
        return activationMessage;
      } catch (retryError: any) {
        if (!this.isIvyTekClientActivationLoanDateError(retryError)) {
          throw retryError;
        }
        const floored = await this.getIvyTekLoanPayloadFlooredToClientActivation(row, client, payload);
        if (!floored) {
          throw retryError;
        }
        try {
          await firstValueFrom(this.loansService.updateLoansAccount('loans', loanId, floored.payload));
        } catch (flooredError: any) {
          flooredError.ivyTekAttemptedPayload = flooredError.ivyTekAttemptedPayload || floored.payload;
          throw flooredError;
        }
        return this.joinIvyTekMessages([
          activationMessage,
          floored.message
        ]);
      }
    }
  }

  /**
   * Backdates the matched loan client activation date from source-backed IvyTek loan dates.
   * @param {any} client Matched client.
   * @param {any} row IvyTek loan row.
   * @param {string} loanDateText The loan submission date being retried — the corrected
   *   origination date can precede every source row date, so activation must reach it.
   */
  private async backdateIvyTekLoanClientActivation(client: any, row: any, loanDateText: string = ''): Promise<string> {
    const clientId = this.getIvyTekClientId(client);
    if (!clientId) {
      throw new Error(
        'Historical IvyTek loan date is earlier than the matched Mifos client activation date, but the matched client id was not returned. Exact historical import stopped before changing loan dates.'
      );
    }
    return this.backdateIvyTekClientActivationFromRow(clientId, row, loanDateText);
  }

  /**
   * Backdates an existing client activation date from an IvyTek source row.
   * @param {string} clientId Client id.
   * @param {any} row IvyTek client or loan row.
   * @param {string} loanDateText Loan submission date the activation must not exceed.
   */
  private async backdateIvyTekClientActivationFromRow(
    clientId: string,
    row: any,
    loanDateText: string = ''
  ): Promise<string> {
    let targetActivationDate = this.getIvyTekClientActivationBackdateDate(row);
    const loanDate = loanDateText ? this.parseIvyTekDate(loanDateText) : null;
    if (loanDate && (!targetActivationDate || loanDate.getTime() < targetActivationDate.getTime())) {
      targetActivationDate = loanDate;
    }
    if (!targetActivationDate) {
      throw new Error(
        'Historical IvyTek loan date is earlier than the matched Mifos client activation date, but no source-backed IvyTek loan/setup date was available for client backdating. Exact historical import stopped before changing loan dates.'
      );
    }
    return this.backdateIvyTekClientActivation(clientId, targetActivationDate);
  }

  /**
   * Updates an existing client activation date without changing the historical loan payload.
   * @param {string} clientId Client id.
   * @param {Date} targetActivationDate Target activation date.
   */
  private async backdateIvyTekClientActivation(clientId: string, targetActivationDate: Date): Promise<string> {
    const clientData: any = await firstValueFrom(this.clientsService.getClientDataAndTemplate(clientId));
    const currentActivationDate = this.parseIvyTekDateValue(
      clientData?.activationDate || clientData?.timeline?.activatedOnDate || clientData?.timeline?.submittedOnDate
    );
    const targetActivationDateText = this.dateUtils.formatDate(targetActivationDate, this.settingsService.dateFormat);

    if (currentActivationDate && currentActivationDate.getTime() <= targetActivationDate.getTime()) {
      return `Matched Mifos client activation date ${this.dateUtils.formatDate(
        currentActivationDate,
        this.settingsService.dateFormat
      )} already supports the IvyTek historical loan date.`;
    }

    const submittedOnDate = this.dateUtils.formatDate(
      currentActivationDate && currentActivationDate.getTime() < targetActivationDate.getTime()
        ? currentActivationDate
        : targetActivationDate,
      this.settingsService.dateFormat
    );
    const payload = this.getIvyTekClientActivationUpdatePayload(clientData, submittedOnDate, targetActivationDateText);
    await firstValueFrom(this.clientsService.updateClient(clientId, payload));
    return `Backdated matched Mifos client activation date to ${targetActivationDateText} from IvyTek source loan history before retrying the exact historical loan import.`;
  }

  /**
   * Builds an update payload from existing client data while changing submitted/activation dates.
   * @param {any} clientData Client data/template response.
   * @param {string} submittedOnDate Submitted on date.
   * @param {string} activationDate Activation date.
   */
  private getIvyTekClientActivationUpdatePayload(clientData: any, submittedOnDate: string, activationDate: string) {
    const legalFormId = clientData?.legalForm?.id || clientData?.legalFormId || LegalFormId.PERSON;
    const payload: any = {
      legalFormId,
      firstname: clientData?.firstname,
      middlename: clientData?.middlename,
      lastname: clientData?.lastname,
      fullname: clientData?.fullname,
      accountNo: clientData?.accountNo,
      externalId: clientData?.externalId,
      mobileNo: clientData?.mobileNo,
      emailAddress: clientData?.emailAddress,
      dateOfBirth: this.formatIvyTekDateValue(clientData?.dateOfBirth),
      staffId: clientData?.staffId || clientData?.staff?.id,
      genderId: clientData?.gender?.id,
      isStaff: clientData?.isStaff,
      active: clientData?.active,
      clientTypeId: clientData?.clientType?.id,
      clientClassificationId: clientData?.clientClassification?.id,
      submittedOnDate,
      activationDate,
      dateFormat: this.settingsService.dateFormat,
      locale: this.settingsService.language.code
    };

    if (Number(legalFormId) === LegalFormId.ENTITY) {
      delete payload.firstname;
      delete payload.middlename;
      delete payload.lastname;
      const nonPersonDetails = clientData?.clientNonPersonDetails || {};
      payload.clientNonPersonDetails = {
        constitutionId: nonPersonDetails?.constitution?.id,
        incorpValidityTillDate: this.formatIvyTekDateValue(nonPersonDetails?.incorpValidityTillDate),
        incorpNumber: nonPersonDetails?.incorpNumber,
        mainBusinessLineId: nonPersonDetails?.mainBusinessLine?.id,
        remarks: nonPersonDetails?.remarks,
        dateFormat: this.settingsService.dateFormat,
        locale: this.settingsService.language.code
      };
    } else {
      delete payload.fullname;
      payload.clientNonPersonDetails = {};
    }

    Object.keys(payload).forEach((key: string) => {
      if (payload[key] === '' || payload[key] === null || payload[key] === undefined) {
        delete payload[key];
      }
    });
    return payload;
  }

  /**
   * Gets a client id from client response/search result shapes.
   * @param {any} client Client response.
   */
  private getIvyTekClientId(client: any): string {
    return (client?.id || client?.clientId || client?.resourceId || client?.entityId || '').toString();
  }

  /**
   * Gets a readable client name from common response shapes.
   * @param {any} client Client response.
   */
  private getIvyTekClientDisplayName(client: any): string {
    return client?.displayName || client?.fullname || client?.name || '';
  }

  /**
   * Describes the source route used to identify the loan's client.
   * @param {any} clientSourceRow Client source row derived for the loan.
   */
  private getIvyTekLoanClientLookupMethod(clientSourceRow: any): string {
    if (!clientSourceRow) {
      return 'existing-client-search';
    }
    if (this.getCsvValue(clientSourceRow, 'IvyTekClientFallback') === 'Yes') {
      return 'fallback-client';
    }
    if (this.getCsvValue(clientSourceRow, 'IvyTekClientSourceContactID')) {
      return 'contact-row';
    }
    if (this.getCsvValue(clientSourceRow, 'IvytekTestPkg__Contact__c')) {
      return 'contact-application';
    }
    return 'client-source-row';
  }

  /**
   * Gets the source-backed activation date to use for client backdating.
   * @param {any} row IvyTek client or loan row.
   */
  private getIvyTekClientActivationBackdateDate(row: any): Date | null {
    const hasLoanSource =
      this.getCsvValue(row, 'IvyTekClientActivationDateSource') === 'loan' ||
      !!this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c') ||
      !!this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c');
    if (!hasLoanSource) {
      return null;
    }
    return this.getIvyTekOfficeSafeDate(
      this.getEarliestIvyTekDate([
        this.getCsvValue(row, 'IvyTekClientActivationDate'),
        this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c'),
        this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c')
      ]),
      row
    );
  }

  /**
   * Gets the source-backed activation backdate formatted for loan retry payloads.
   * @param {any} row IvyTek client or loan row.
   */
  private getIvyTekClientActivationBackdateDateText(row: any): string {
    const targetActivationDate = this.getIvyTekClientActivationBackdateDate(row);
    return targetActivationDate ? this.dateUtils.formatDate(targetActivationDate, this.settingsService.dateFormat) : '';
  }

  /**
   * Joins import result messages without empty separators.
   * @param {string[]} messages Messages to join.
   */
  private joinIvyTekMessages(messages: string[]): string {
    return messages.filter((message: string) => !!message).join(' ');
  }

  /**
   * Creates or updates a client from an IvyTek CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private async upsertIvyTekClient(row: any) {
    const result = this.createIvyTekResult(row);

    try {
      this.validateIvyTekClientData(row);
      const saveResult = await this.saveIvyTekClientAndTribalData(row);
      result.mappedValues = this.getIvyTekClientResultMappedValues(
        row,
        saveResult.clientId,
        saveResult.customFieldDatatablesUpdated,
        saveResult.addressStatus,
        saveResult.warnings
      );
      const warningMessage = this.joinIvyTekMessages(saveResult.warnings);
      this.setIvyTekResultStatus(result, warningMessage ? 'labels.inputs.Warning' : saveResult.status, warningMessage);
    } catch (error: any) {
      this.setIvyTekResultStatus(result, 'labels.inputs.Failed', this.getIvyTekClientImportErrorMessage(error, row));
    }
    this.ivyTekImportResults.push(result);
  }

  /**
   * Selects an IvyTek import result and populates the correction form.
   * @param {any} result IvyTek import result.
   */
  selectIvyTekResult(result: any) {
    this.selectedIvyTekResult = result;
    this.ivyTekResultDetailsForm.patchValue({
      firstName: this.getIvyTekFirstName(result.row),
      middleName: this.getIvyTekMiddleName(result.row),
      lastName: this.getIvyTekLastName(result.row),
      externalId: this.getIvyTekExternalId(result.row),
      entityId: this.getIvyTekEntityId(result.row),
      phone: this.getCsvValue(result.row, 'Phone'),
      otherPhone: this.getCsvValue(result.row, 'OtherPhone'),
      birthdate: this.getCsvValue(result.row, 'Birthdate')
    });
  }

  /**
   * Retries a failed IvyTek import result after applying corrections.
   */
  async retryIvyTekResult() {
    if (!this.selectedIvyTekResult || this.ivyTekResultDetailsForm.invalid) {
      return;
    }

    this.ivyTekRetrying = true;
    const correctedRow = {
      ...this.selectedIvyTekResult.row,
      FirstName: this.ivyTekResultDetailsForm.get('firstName').value,
      MiddleName: this.ivyTekResultDetailsForm.get('middleName').value,
      LastName: this.ivyTekResultDetailsForm.get('lastName').value,
      IvyTekClientExternalID: this.ivyTekResultDetailsForm.get('externalId').value,
      IvytekTestPkg__ExternalID__c: this.ivyTekResultDetailsForm.get('externalId').value,
      WS_EntityID__c: this.ivyTekResultDetailsForm.get('entityId').value,
      Phone: this.ivyTekResultDetailsForm.get('phone').value,
      OtherPhone: this.ivyTekResultDetailsForm.get('otherPhone').value,
      Birthdate: this.ivyTekResultDetailsForm.get('birthdate').value
    };
    this.selectedIvyTekResult.row = correctedRow;
    this.selectedIvyTekResult.name = this.getIvyTekDisplayName(correctedRow);
    this.selectedIvyTekResult.externalId = this.getIvyTekExternalId(correctedRow);
    this.selectedIvyTekResult.entityId = this.getIvyTekEntityId(correctedRow);
    this.selectedIvyTekResult.message = '';

    try {
      this.validateIvyTekClientData(correctedRow);
      const saveResult = await this.saveIvyTekClientAndTribalData(correctedRow);
      this.selectedIvyTekResult.mappedValues = this.getIvyTekClientResultMappedValues(
        correctedRow,
        saveResult.clientId,
        saveResult.customFieldDatatablesUpdated,
        saveResult.addressStatus,
        saveResult.warnings
      );
      const warningMessage = this.joinIvyTekMessages(saveResult.warnings);
      this.setIvyTekResultStatus(
        this.selectedIvyTekResult,
        warningMessage ? 'labels.inputs.Warning' : saveResult.status,
        warningMessage
      );
    } catch (error: any) {
      this.setIvyTekResultStatus(
        this.selectedIvyTekResult,
        'labels.inputs.Failed',
        this.getIvyTekClientImportErrorMessage(error, correctedRow)
      );
    } finally {
      this.ivyTekRetrying = false;
    }
  }

  /**
   * Gets IvyTek import results for a status.
   * @param {string} status Result status.
   */
  getIvyTekResultsByStatus(status: string) {
    return this.ivyTekImportResults.filter((result: any) => result.status === status);
  }

  /**
   * Exports IvyTek import results to a correction-friendly CSV.
   * @param {string} stage Result stage to export.
   */
  exportIvyTekImportResults(stage: string) {
    const stageResults = this.getIvyTekExportStages(stage);
    const exportRows = stageResults.flatMap((stageResult: any) =>
      stageResult.results.map((result: any, index: number) =>
        this.getIvyTekResultExportRow(stageResult.stageName, result, index)
      )
    );

    if (!exportRows.length) {
      return;
    }

    const headers = this.getIvyTekExportHeaders(exportRows);
    const csv = this.buildIvyTekCsv(headers, exportRows);
    this.downloadIvyTekCsv(`ivytek-${stage}-results-${this.getIvyTekCsvTimestamp()}.csv`, csv);
  }

  /**
   * Exports numeric source/imported reconciliation totals from IvyTek results.
   * @param {string} stage Result stage to reconcile.
   */
  exportIvyTekReconciliationResults(stage: string = 'all') {
    const reconciliationRows = this.getIvyTekReconciliationRows(this.getIvyTekExportStages(stage));

    if (!reconciliationRows.length) {
      return;
    }

    this.updateIvyTekReconciliationStatusFromRows(reconciliationRows);

    const headers = [
      'Stage',
      'Outcome',
      'Comparison Key',
      'Source Columns',
      'Imported Columns',
      'Result Count',
      'Source Numeric Count',
      'Imported Numeric Count',
      'Source Total',
      'Imported Total',
      'Difference',
      'Compared',
      'Notes'
    ];
    const csv = this.buildIvyTekCsv(headers, reconciliationRows);
    this.downloadIvyTekCsv(`ivytek-${stage}-reconciliation-${this.getIvyTekCsvTimestamp()}.csv`, csv);
  }

  /**
   * Recalculates the visible IvyTek reconciliation status for the selected result stages.
   * @param {string} stage Result stage.
   */
  private updateIvyTekReconciliationStatus(stage: string = 'all') {
    this.updateIvyTekReconciliationStatusFromRows(this.getIvyTekReconciliationRows(this.getIvyTekExportStages(stage)));
  }

  /**
   * Updates the visible IvyTek reconciliation status from reconciliation CSV rows.
   * @param {any[]} reconciliationRows Reconciliation rows.
   */
  private updateIvyTekReconciliationStatusFromRows(reconciliationRows: any[]) {
    const summaryRow =
      reconciliationRows.find((row: any) => row['Comparison Key'] === 'FINAL_IMPORT_RESULT') || reconciliationRows[0];
    if (!summaryRow || summaryRow.Compared !== 'Yes') {
      this.ivyTekReconciliationStatusKey = 'labels.text.Reconciliation Not Run';
      this.ivyTekReconciliationStatusMessage = summaryRow?.Notes || '';
    } else if (summaryRow.Outcome === 'Success') {
      this.ivyTekReconciliationStatusKey = 'labels.text.Reconciliation Matched';
      this.ivyTekReconciliationStatusMessage = summaryRow.Notes || '';
    } else {
      this.ivyTekReconciliationStatusKey = 'labels.text.Reconciliation Needs Review';
      this.ivyTekReconciliationStatusMessage = summaryRow.Notes || '';
    }
    if (this.ivyTekPipelineRun) {
      this.ivyTekPipelineRun = {
        ...this.ivyTekPipelineRun,
        reconciliationStatus: this.ivyTekReconciliationStatusKey,
        reconciliationMessage: this.ivyTekReconciliationStatusMessage
      };
      this.persistIvyTekPipelineRun();
    }
  }

  /**
   * Gets the result stages included in a CSV export.
   * @param {string} stage Result stage.
   */
  private getIvyTekExportStages(stage: string) {
    const stages = [
      {
        key: 'clients',
        stageName: 'Stage 1 Clients',
        results: this.ivyTekImportResults
      },
      {
        key: 'loans',
        stageName: 'Stage 2 Loans',
        results: this.ivyTekLoanImportResults
      },
      {
        key: 'transactions',
        stageName: 'Stage 3 Transactions',
        results: this.ivyTekTransactionExportResults.length
          ? this.ivyTekTransactionExportResults
          : this.ivyTekTransactionImportResults
      }
    ];
    return stage === 'all' ? stages : stages.filter((stageResult: any) => stageResult.key === stage);
  }

  /**
   * Builds reconciliation rows for numeric source and imported values.
   * @param {any[]} stageResults Export stage result groups.
   */
  private getIvyTekReconciliationRows(stageResults: any[]) {
    const detailRows = stageResults.flatMap((stageResult: any) => this.getIvyTekStageReconciliationRows(stageResult));
    return [
      this.getIvyTekReconciliationSummaryRow(stageResults, detailRows),
      ...detailRows
    ];
  }

  /**
   * Builds one stage's source/imported numeric total comparison rows.
   * @param {any} stageResult Export stage result group.
   */
  private getIvyTekStageReconciliationRows(stageResult: any) {
    const totalsByKey = new Map<string, any>();

    stageResult.results.forEach((result: any, index: number) => {
      const exportRow = this.getIvyTekResultExportRow(stageResult.stageName, result, index);
      Object.keys(exportRow)
        .sort()
        .forEach((header: string) => {
          const side = this.getIvyTekReconciliationSide(header);
          if (!side) {
            return;
          }

          const numericValue = this.getIvyTekReconciliationNumericValue(header, exportRow[header]);
          if (numericValue === null) {
            return;
          }

          const comparisonKey = this.getIvyTekReconciliationColumnKey(header);
          if (!comparisonKey) {
            return;
          }

          const total = totalsByKey.get(comparisonKey) || {
            stageName: stageResult.stageName,
            comparisonKey,
            sourceColumns: new Set<string>(),
            importedColumns: new Set<string>(),
            resultCount: stageResult.results.length,
            sourceNumericCount: 0,
            importedNumericCount: 0,
            sourceTotal: 0,
            importedTotal: 0,
            sourceResultIndexes: new Set<number>(),
            importedResultIndexes: new Set<number>()
          };
          const columns = side === 'source' ? total.sourceColumns : total.importedColumns;
          columns.add(this.getIvyTekReconciliationFieldName(header));
          const resultIndexes = side === 'source' ? total.sourceResultIndexes : total.importedResultIndexes;
          if (!this.isIvyTekReconciliationAdditiveKey(comparisonKey, side) && resultIndexes.has(index)) {
            totalsByKey.set(comparisonKey, total);
            return;
          }
          resultIndexes.add(index);
          if (side === 'source') {
            total.sourceNumericCount += 1;
            total.sourceTotal = this.roundIvyTekReconciliationTotal(total.sourceTotal + numericValue);
          } else {
            total.importedNumericCount += 1;
            total.importedTotal = this.roundIvyTekReconciliationTotal(total.importedTotal + numericValue);
          }
          totalsByKey.set(comparisonKey, total);
        });
    });

    return Array.from(totalsByKey.values())
      .sort((first: any, second: any) => first.comparisonKey.localeCompare(second.comparisonKey))
      .map((total: any) => this.getIvyTekReconciliationExportRow(total));
  }

  /**
   * Builds one reconciliation CSV row.
   * @param {any} total Aggregated total bucket.
   */
  private getIvyTekReconciliationExportRow(total: any) {
    const hasSourceTotal = total.sourceNumericCount > 0;
    const hasImportedTotal = total.importedNumericCount > 0;
    const difference =
      hasSourceTotal && hasImportedTotal
        ? this.roundIvyTekReconciliationTotal(total.importedTotal - total.sourceTotal)
        : null;
    const outcome = this.getIvyTekReconciliationOutcome(hasSourceTotal, hasImportedTotal, difference);
    return {
      Stage: total.stageName,
      Outcome: outcome,
      'Comparison Key': total.comparisonKey,
      'Source Columns': Array.from(total.sourceColumns).sort().join('; '),
      'Imported Columns': Array.from(total.importedColumns).sort().join('; '),
      'Result Count': total.resultCount,
      'Source Numeric Count': total.sourceNumericCount || '',
      'Imported Numeric Count': total.importedNumericCount || '',
      'Source Total': hasSourceTotal ? this.formatIvyTekReconciliationNumber(total.sourceTotal) : '',
      'Imported Total': hasImportedTotal ? this.formatIvyTekReconciliationNumber(total.importedTotal) : '',
      Difference: difference === null ? '' : this.formatIvyTekReconciliationNumber(difference),
      Compared: hasSourceTotal && hasImportedTotal ? 'Yes' : 'No',
      Notes: this.getIvyTekReconciliationNotes(hasSourceTotal, hasImportedTotal, difference)
    };
  }

  /**
   * Builds the final reconciliation verdict row for the selected import result stages.
   * @param {any[]} stageResults Export stage result groups.
   * @param {any[]} detailRows Reconciliation detail rows.
   */
  private getIvyTekReconciliationSummaryRow(stageResults: any[], detailRows: any[]) {
    const totalResults = stageResults.reduce(
      (count: number, stageResult: any) => count + (stageResult.results?.length || 0),
      0
    );
    const comparedRows = detailRows.filter((row: any) => row.Compared === 'Yes');
    const differenceRows = detailRows.filter((row: any) => row.Outcome === 'Difference');
    const sourceOnlyRows = detailRows.filter(
      (row: any) => row.Outcome === 'Source Only' && this.hasIvyTekReconciliationNonZeroTotal(row, 'Source Total')
    );
    const importedOnlyRows = detailRows.filter(
      (row: any) => row.Outcome === 'Imported Only' && this.hasIvyTekReconciliationNonZeroTotal(row, 'Imported Total')
    );
    const outcome =
      detailRows.length &&
      comparedRows.length &&
      !differenceRows.length &&
      !sourceOnlyRows.length &&
      !importedOnlyRows.length
        ? 'Success'
        : 'Failure';
    const notes = detailRows.length
      ? `Export reconciliation compared ${comparedRows.length} numeric totals across ${totalResults} import results. Differences: ${differenceRows.length}. Nonzero source-only totals: ${sourceOnlyRows.length}. Nonzero imported-only totals: ${importedOnlyRows.length}. Final SQL transaction proof is written by the SQL backend loader reconciliation CSV.`
      : `No numeric source/imported totals were available across ${totalResults} import results. Export reconciliation could not prove the prepared import matched IvyTek.`;

    return {
      Stage: 'All Stages',
      Outcome: outcome,
      'Comparison Key': 'FINAL_IMPORT_RESULT',
      'Source Columns': '',
      'Imported Columns': '',
      'Result Count': totalResults,
      'Source Numeric Count': '',
      'Imported Numeric Count': '',
      'Source Total': '',
      'Imported Total': '',
      Difference: '',
      Compared: comparedRows.length ? 'Yes' : 'No',
      Notes: notes
    };
  }

  /**
   * Gets the reconciliation row outcome.
   * @param {boolean} hasSourceTotal Whether a source total exists.
   * @param {boolean} hasImportedTotal Whether an imported total exists.
   * @param {number | null} difference Imported minus source total.
   */
  private getIvyTekReconciliationOutcome(
    hasSourceTotal: boolean,
    hasImportedTotal: boolean,
    difference: number | null
  ) {
    if (hasSourceTotal && hasImportedTotal) {
      return Math.abs(difference || 0) <= 0.005 ? 'Matched' : 'Difference';
    }
    if (hasSourceTotal) {
      return 'Source Only';
    }
    return 'Imported Only';
  }

  /**
   * Checks whether a reconciliation total column has a non-zero value.
   * @param {any} row Reconciliation export row.
   * @param {string} column Total column name.
   */
  private hasIvyTekReconciliationNonZeroTotal(row: any, column: string) {
    const value = this.parseIvyTekDecimal(row[column]);
    return value !== null && Math.abs(value) > 0.005;
  }

  /**
   * Gets the reconciliation value side represented by an export column.
   * @param {string} header Export column header.
   */
  private getIvyTekReconciliationSide(header: string): string {
    if (header.startsWith('source.')) {
      return 'source';
    }
    if (header.startsWith('imported.')) {
      return 'imported';
    }
    return '';
  }

  /**
   * Gets a normalized key for comparing source and imported columns.
   * @param {string} header Export column header.
   */
  private getIvyTekReconciliationColumnKey(header: string) {
    const side = this.getIvyTekReconciliationSide(header);
    const fieldName = this.getIvyTekReconciliationFieldName(header)
      .replace(/^IvytekTestPkg__/i, '')
      .replace(/^IvyTestPkg__/i, '')
      .replace(/__c$/i, '');
    const normalized = this.normalizeIvyTekText(fieldName);
    const sourceAliases: { [key: string]: string } = {
      accruedinterestall: 'interestoutstanding',
      backinterestdue: 'interestoutstanding',
      balancenow: 'principaloutstanding',
      deferredinterestdue: 'interestoutstanding'
    };
    const importedAliases: { [key: string]: string } = {
      interestoutstanding: 'interestoutstanding',
      principaloutstanding: 'principaloutstanding'
    };
    const aliases: { [key: string]: string } = {
      amtnowdueall: 'amountnowdueall',
      amountnowdueall: 'amountnowdueall',
      amtfinanced: 'principal',
      approvedamount: 'principal',
      requestamount: 'principal',
      payloadprincipal: 'principal',
      snapshotprincipaloutstanding: 'principaloutstanding',
      originalprincipal: 'principal',
      principle: 'principal',
      principlepaid: 'principalpaid',
      backinterestpaid: 'interestpaid',
      deferredinterestpaid: 'interestpaid',
      componenttotal: 'amountpaid',
      contractrate: 'contractratedecimal',
      marginrate: 'interestratepercent',
      contractratepercent: 'interestratepercent',
      payloadinterestratepercent: 'interestratepercent',
      interestoutstanding: 'interestoutstanding',
      feechargesoutstanding: 'feesoutstanding',
      feesoutstanding: 'feesoutstanding',
      penaltychargesoutstanding: 'penaltiesoutstanding',
      penaltiesoutstanding: 'penaltiesoutstanding',
      historicaltransactionamountpaid: 'amountpaid',
      historicaltransactionprincipalpaid: 'principalpaid',
      historicaltransactioninterestpaid: 'interestpaid',
      selectedamount: 'amountpaid',
      sqlhistoryamountpaid: 'amountpaid',
      sqlhistoryinterestpaid: 'interestpaid',
      sqlhistoryprincipalpaid: 'principalpaid',
      numberofpayments: 'numberofrepayments',
      term: 'numberofrepayments',
      percapita: 'percap',
      percapitaws: 'percap',
      percapws: 'percap',
      tribalpercap: 'percap',
      payrolldeductionws: 'tribalpayroll',
      pensionws: 'tribalpension'
    };
    if (side === 'source' && sourceAliases[normalized]) {
      return sourceAliases[normalized];
    }
    if (side === 'imported' && importedAliases[normalized]) {
      return importedAliases[normalized];
    }
    return aliases[normalized] || normalized;
  }

  /**
   * Checks whether same-key source/import columns should be summed instead of deduplicated per result.
   * @param {string} comparisonKey Reconciliation comparison key.
   * @param {string} side Reconciliation side.
   */
  private isIvyTekReconciliationAdditiveKey(comparisonKey: string, side: string) {
    return side === 'source' && [
        'interestoutstanding',
        'interestpaid'
      ].includes(comparisonKey);
  }

  /**
   * Gets the source field name from an export header.
   * @param {string} header Export column header.
   */
  private getIvyTekReconciliationFieldName(header: string) {
    return header.replace(/^(source|mapped|imported)\./, '');
  }

  /**
   * Parses a numeric reconciliation value from a CSV export cell.
   * @param {string} header Export column header.
   * @param {any} value Export cell value.
   */
  private getIvyTekReconciliationNumericValue(header: string, value: any): number | null {
    if (this.isIvyTekReconciliationExcludedColumn(header)) {
      return null;
    }

    const text = this.getIvyTekExportCellValue(value).toString().trim();
    if (!text || this.isNullLikeCsvValue(text)) {
      return null;
    }

    const normalized = text
      .replace(/^\((.+)\)$/, '-$1')
      .replace(/[$,%]/g, '')
      .replace(/,/g, '')
      .trim();
    if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Checks whether a column should be excluded from numeric reconciliation totals.
   * @param {string} header Export column header.
   */
  private isIvyTekReconciliationExcludedColumn(header: string) {
    const side = this.getIvyTekReconciliationSide(header);
    const normalized = this.normalizeIvyTekText(this.getIvyTekReconciliationFieldName(header));
    if (side === 'imported' && [
        'balancenow',
        'currentbalance',
        'fineractaccountstatus',
        'fineractbalancenow',
        'fineractfeechargesoutstanding',
        'fineractinterestoutstanding',
        'fineractpenaltychargesoutstanding',
        'fineractprincipaloutstanding',
        'fineracttotaloutstanding',
        'snapshotstoragemode',
        'totaloutstanding'
      ].includes(normalized)) {
      return true;
    }
    const excludedExactNames = [
      'deceased',
      'directdeposit',
      'donotcall',
      'donotemail',
      'donotmail',
      'donotphone',
      'donottext',
      'hasoptedoutoffax',
      'hasoptedoutofemail',
      'hasoptedoutofsms',
      'isdeleted',
      'lgbtqia',
      'differentlyabled',
      'bipoc',
      'raceamericanindianoralaskanative',
      'raceasian',
      'raceblackorafricanamerican',
      'racecaucasian',
      'racemultiracial',
      'racenativehawaiianotherpacificisl',
      'racewhite',
      'rowidentifier',
      'samplevalue',
      'warningcount',
      'historicaltransactioncount',
      'historicaltransactionignoredcount',
      'historicaldisbursementtransactioncount',
      'historicaltransactionamountpaid',
      'historicaltransactionprincipalpaid',
      'historicaltransactioninterestpaid',
      'repaymentevery'
    ];
    const excludedTokens = [
      'accountid',
      'accountno',
      'address',
      'apartment',
      'birthdate',
      'city',
      'clientid',
      'code',
      'contactapplication',
      'contactid',
      'country',
      'created',
      'date',
      'description',
      'document',
      'email',
      'entityid',
      'externalid',
      'frequency',
      'group',
      'checknumber',
      'legacyloanid',
      'loanid',
      'lookupmethod',
      'message',
      'mobile',
      'modified',
      'name',
      'note',
      'officeid',
      'ownerid',
      'paymentprocessingtype',
      'phone',
      'postal',
      'recordtypeid',
      'salutation',
      'salesforceloanid',
      'sfloanid',
      'ssn',
      'stage',
      'state',
      'status',
      'street',
      'suffix',
      'type',
      'zip'
    ];
    return (
      normalized === 'id' ||
      excludedExactNames.includes(normalized) ||
      excludedTokens.some((token: string) => normalized.includes(token))
    );
  }

  /**
   * Rounds reconciliation totals without forcing cents on rates/counts.
   * @param {number} value Total value.
   */
  private roundIvyTekReconciliationTotal(value: number) {
    return Math.round((value + Number.EPSILON) * 1000000) / 1000000;
  }

  /**
   * Formats reconciliation totals without unnecessary trailing zeroes.
   * @param {number} value Total value.
   */
  private formatIvyTekReconciliationNumber(value: number) {
    return this.roundIvyTekReconciliationTotal(value)
      .toFixed(6)
      .replace(/\.?0+$/, '');
  }

  /**
   * Gets a short reconciliation note for unmatched or different total sides.
   * @param {boolean} hasSourceTotal Whether a source total exists.
   * @param {boolean} hasImportedTotal Whether an imported total exists.
   * @param {number | null} difference Imported minus source total.
   */
  private getIvyTekReconciliationNotes(hasSourceTotal: boolean, hasImportedTotal: boolean, difference: number | null) {
    if (hasSourceTotal && hasImportedTotal) {
      if (Math.abs(difference || 0) > 0.005) {
        return `Imported total differs from source by ${this.formatIvyTekReconciliationNumber(difference || 0)}.`;
      }
      return '';
    }
    if (hasSourceTotal) {
      return 'No imported numeric counterpart was found for this source total.';
    }
    return 'No source numeric counterpart was found for this imported total.';
  }

  /**
   * Builds one CSV row from an IvyTek result and its source row.
   * @param {string} stageName Import stage name.
   * @param {any} result IvyTek result.
   * @param {number} index Result index.
   */
  private getIvyTekResultExportRow(stageName: string, result: any, index: number) {
    const exportRow: any = {
      'Import Started At': this.ivyTekPipelineRun?.startedAt || '',
      'Import Last Updated At': this.ivyTekPipelineRun?.lastUpdatedAt || '',
      Stage: stageName,
      'Result Number': index + 1,
      Status: this.getIvyTekExportStatus(result.status),
      Message: result.message || '',
      Name: result.name || '',
      'External ID': result.externalId || '',
      'Entity ID': result.entityId || '',
      'Legacy Loan ID': result.legacyLoanId || '',
      'Mifos Loan ID': result.loanId || '',
      'Salesforce Loan ID': result.sfLoanId || '',
      'Transaction Date': result.transactionDate || '',
      Amount: result.amount || '',
      'Historical Only': result.historicalOnly ? 'Yes' : ''
    };

    Object.keys(result.mappedValues || {}).forEach((key: string) => {
      exportRow[`mapped.${key}`] = result.mappedValues[key];
    });
    Object.keys(result.importedValues || {}).forEach((key: string) => {
      exportRow[`imported.${key}`] = result.importedValues[key];
    });
    Object.keys(result.validationValues || {}).forEach((key: string) => {
      exportRow[`validation.${key}`] = result.validationValues[key];
    });
    Object.keys(result.row || {}).forEach((key: string) => {
      exportRow[`source.${key}`] = result.row[key];
    });
    return exportRow;
  }

  /**
   * Gets ordered CSV headers for result export rows.
   * @param {any[]} rows CSV rows.
   */
  private getIvyTekExportHeaders(rows: any[]) {
    const baseHeaders = [
      'Import Started At',
      'Import Last Updated At',
      'Stage',
      'Result Number',
      'Status',
      'Message',
      'Name',
      'External ID',
      'Entity ID',
      'Legacy Loan ID',
      'Mifos Loan ID',
      'Salesforce Loan ID',
      'Transaction Date',
      'Amount',
      'Historical Only'
    ];
    const mappedHeaders = rows.flatMap((row: any) =>
      Object.keys(row).filter((key: string) => key.startsWith('mapped.'))
    );
    const importedHeaders = rows.flatMap((row: any) =>
      Object.keys(row).filter((key: string) => key.startsWith('imported.'))
    );
    const validationHeaders = rows.flatMap((row: any) =>
      Object.keys(row).filter((key: string) => key.startsWith('validation.'))
    );
    const sourceHeaders = rows.flatMap((row: any) =>
      Object.keys(row).filter((key: string) => key.startsWith('source.'))
    );
    return [
      ...baseHeaders,
      ...Array.from(new Set(importedHeaders)).sort(),
      ...Array.from(new Set(validationHeaders)).sort(),
      ...Array.from(new Set(mappedHeaders)).sort(),
      ...Array.from(new Set(sourceHeaders)).sort()
    ];
  }

  /**
   * Builds CSV text from rows.
   * @param {string[]} headers CSV headers.
   * @param {any[]} rows CSV rows.
   */
  private buildIvyTekCsv(headers: string[], rows: any[]) {
    return [
      headers.map((header: string) => this.escapeIvyTekCsvValue(header)).join(','),
      ...rows.map((row: any) =>
        headers.map((header: string) => this.escapeIvyTekCsvValue(this.getIvyTekExportCellValue(row[header]))).join(',')
      )
    ].join('\r\n');
  }

  /**
   * Downloads CSV text in the browser.
   * @param {string} filename CSV filename.
   * @param {string} csv CSV text.
   */
  private downloadIvyTekCsv(filename: string, csv: string) {
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
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

  /**
   * Gets a readable status value from a translation key.
   * @param {string} status Status key.
   */
  private getIvyTekExportStatus(status: string) {
    return (status || '').replace(/^labels\.(inputs|heading|buttons|text)\./, '');
  }

  /**
   * Gets a CSV-safe primitive value.
   * @param {any} value Cell value.
   */
  private getIvyTekExportCellValue(value: any) {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return typeof value === 'object' ? JSON.stringify(value) : value;
  }

  /**
   * Escapes one CSV value.
   * @param {any} value Cell value.
   */
  private escapeIvyTekCsvValue(value: any) {
    const text = (value ?? '').toString();
    const escapedText = text.replace(/"/g, '""');
    return /[",\r\n]/.test(escapedText) || /^\s|\s$/.test(escapedText) ? `"${escapedText}"` : escapedText;
  }

  /**
   * Gets a compact timestamp for CSV filenames.
   */
  private getIvyTekCsvTimestamp() {
    return new Date().toISOString().replace(/\D/g, '').substring(0, 14);
  }

  /**
   * Creates an IvyTek result view model from a CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private createIvyTekResult(row: any) {
    return {
      name: this.getIvyTekDisplayName(row),
      externalId: this.getIvyTekExternalId(row),
      entityId: this.getIvyTekEntityId(row),
      row,
      mappedValues: {},
      status: '',
      message: ''
    };
  }

  /**
   * Gets mapped client values for review and CSV export.
   * @param {any} row IvyTek client row.
   * @param {any} clientId Mifos client id returned by the write operation.
   */
  private getIvyTekClientResultMappedValues(
    row: any,
    clientId: any,
    customFieldDatatablesUpdated: number = 0,
    addressStatus: string = '',
    warnings: string[] = []
  ) {
    const office = this.getIvyTekOfficeForRow(row);
    return {
      mifosClientId: clientId || '',
      sourceExternalId: this.getIvyTekExternalId(row),
      sourceEntityId: this.getIvyTekEntityId(row),
      sourceCompanyCode: this.getIvyTekCompanyCode(row),
      sourceMobileNo: this.getIvyTekClientPhone(row),
      targetOfficeId: office?.id || '',
      targetOfficeName: office?.name || '',
      customFieldDatatablesUpdated,
      addressStatus,
      warningCount: warnings.length || '',
      tribalEntityIdWritten: this.getIvyTekEntityId(row) ? 'Yes' : 'No'
    };
  }

  /**
   * Updates an IvyTek result status.
   * @param {any} result IvyTek result.
   * @param {string} status Status translation key.
   * @param {string} message Optional failure message.
   */
  private setIvyTekResultStatus(result: any, status: string, message: string = '') {
    result.status = status;
    result.message = message;
  }

  /**
   * Adds source context to client import failures that Fineract reports too generically.
   * @param {any} error API or runtime error.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekClientImportErrorMessage(error: any, row: any): string {
    const message = this.getErrorMessage(error);
    if (!message.toLowerCase().includes('office opening date')) {
      return message;
    }
    const office = this.getIvyTekOfficeForRow(row);
    return `${message} Source activation date: "${this.getIvyTekClientActivationDate(row)}" from "${
      this.getCsvValue(row, 'IvyTekClientActivationDateSource') || 'unknown'
    }". Target office: "${office?.name || this.getCsvValue(row, 'IvyTekClientOfficeName') || '(unknown)'}" (${
      office?.id || this.getCsvValue(row, 'IvyTekClientOfficeId') || 'no id'
    }). Exact historical date was not changed; import is blocked until Mifos can store a client activation date before that office opening date.`;
  }

  /**
   * Finds a client by external identifier.
   * @param {string} externalId External identifier.
   */
  private async findClientByExternalId(externalId: string) {
    if (!externalId) {
      return null;
    }
    try {
      return await firstValueFrom(this.clientsService.getClientByExternalId(externalId));
    } catch (error: any) {
      if (error?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Finds an existing client by the preferred IvyTek external id or the prior contact-id fallback.
   * @param {any} row IvyTek CSV row.
   */
  private async findExistingIvyTekClient(row: any) {
    const identifiers = this.getUniqueIvyTekIdentifiers([
      this.getIvyTekExternalId(row),
      this.getCsvValue(row, 'IvyTekClientSourceExternalID'),
      this.getCsvValue(row, 'IvyTekClientSourceContactID'),
      this.getCsvValue(row, 'IvyTekClientApplicationExternalID'),
      ...this.getCsvValue(row, 'IvyTekClientRelatedExternalIDs').split(','),
      this.getCsvValue(row, 'source_contact_id'),
      this.getCsvValue(row, 'sf_contact_id'),
      this.getCsvValue(row, 'ContactId'),
      this.getCsvValue(row, 'ContactID'),
      this.getCsvValue(row, 'AccountId'),
      this.getCsvValue(row, 'IvytekTestPkg__Contact__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Borrower_Contact__c')
    ]);

    for (const identifier of identifiers) {
      const client = await this.findClientByExternalId(identifier);
      if (client) {
        return client;
      }
    }
    return null;
  }

  /**
   * Saves the Mifos client and IvyTek tribal datatable value from one CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private async saveIvyTekClientAndTribalData(row: any): Promise<any> {
    const existingClient: any = await this.findExistingIvyTekClient(row);
    let clientId: any;
    let status: string;
    const warnings: string[] = [];

    if (existingClient?.id) {
      const clientWarning = await this.updateIvyTekClientWithMobileFallback(existingClient.id, row);
      if (clientWarning) {
        warnings.push(clientWarning);
      }
      clientId = existingClient.id;
      status = 'labels.inputs.Updated';
    } else {
      const createResult: any = await this.createIvyTekClientWithMobileFallback(row);
      const createdClient = createResult.response;
      if (createResult.warning) {
        warnings.push(createResult.warning);
      }
      clientId = createdClient?.resourceId || createdClient?.clientId || createdClient?.id;
      status = 'labels.inputs.Created';
    }

    if (!clientId) {
      throw new Error('Client saved, but Mifos did not return a client id for the tribal data update.');
    }

    warnings.push(...(await this.upsertIvyTekClientIdentifiers(clientId.toString(), row)));
    const addressStatus = await this.upsertIvyTekClientAddress(clientId.toString(), row);
    if (addressStatus.warning) {
      warnings.push(addressStatus.warning);
    }
    const customFieldDatatablesUpdated = 0;
    return {
      status,
      clientId,
      customFieldDatatablesUpdated,
      addressStatus: addressStatus.status,
      warnings
    };
  }

  /**
   * Updates a client without dropping source mobile numbers to satisfy tenant uniqueness rules.
   * @param {string} clientId Client identifier.
   * @param {any} row IvyTek CSV row.
   */
  private async updateIvyTekClientWithMobileFallback(clientId: string, row: any): Promise<string> {
    const payload = this.getIvyTekClientPayload(row);
    try {
      await firstValueFrom(this.clientsService.updateClient(clientId, payload));
      return '';
    } catch (error: any) {
      if (payload.mobileNo && this.isIvyTekDuplicateMobileNoError(error)) {
        const retryPayload = this.getIvyTekPayloadWithoutMobileNo(payload);
        await firstValueFrom(this.clientsService.updateClient(clientId, retryPayload));
        return `Duplicate mobile number ${payload.mobileNo} cannot be stored in the unique Mifos mobile field. The client was imported and the source mobile number is preserved in the result export for controlled staging/custom-field mapping.`;
      }
      throw error;
    }
  }

  /**
   * Creates a client without dropping source mobile numbers to satisfy tenant uniqueness rules.
   * @param {any} row IvyTek CSV row.
   */
  private async createIvyTekClientWithMobileFallback(row: any) {
    const payload = this.getIvyTekClientPayload(row, true, true);
    try {
      return {
        response: await firstValueFrom(this.clientsService.createClient(payload)),
        warning: ''
      };
    } catch (error: any) {
      if (payload.mobileNo && this.isIvyTekDuplicateMobileNoError(error)) {
        const retryPayload = this.getIvyTekPayloadWithoutMobileNo(payload);
        return {
          response: await firstValueFrom(this.clientsService.createClient(retryPayload)),
          warning: `Duplicate mobile number ${payload.mobileNo} cannot be stored in the unique Mifos mobile field. The client was imported and the source mobile number is preserved in the result export for controlled staging/custom-field mapping.`
        };
      }
      throw error;
    }
  }

  /**
   * Removes mobileNo from a payload without mutating the original when Fineract uniqueness blocks exact REST storage.
   * @param {any} payload Client payload.
   */
  private getIvyTekPayloadWithoutMobileNo(payload: any) {
    const retryPayload = { ...payload };
    delete retryPayload.mobileNo;
    return retryPayload;
  }

  /**
   * Checks whether Fineract rejected the client because mobileNo already exists.
   * @param {any} error API error.
   */
  private isIvyTekDuplicateMobileNoError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return message.includes('mobileno') && message.includes('already exists');
  }

  /**
   * Adds or updates the Client Tribal Data datatable entry.
   * @param {string} clientId Client identifier.
   * @param {any} row IvyTek CSV row.
   */
  private async upsertIvyTekClientTribalData(clientId: string, row: any) {
    const entityId = this.getIvyTekEntityId(row);
    if (!entityId) {
      return;
    }

    const payload = this.getIvyTekClientTribalDataPayload(row);
    try {
      await firstValueFrom(
        this.clientsService.addClientDatatableEntry(clientId, this.ivyTekClientTribalDatatableName, payload)
      );
    } catch (error: any) {
      if (!this.isIvyTekDatatableAlreadyExistsError(error)) {
        throw error;
      }
      await firstValueFrom(
        this.clientsService.editClientDatatableEntry(clientId, this.ivyTekClientTribalDatatableName, payload)
      );
    }
  }

  /**
   * Builds the Client Tribal Data payload from an IvyTek CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekClientTribalDataPayload(row: any) {
    return {
      EntityID: this.getIvyTekEntityId(row),
      locale: this.settingsService.language.code
    };
  }

  /**
   * Adds or updates the Tribal Loan Data datatable entry.
   * @param {string} loanId Loan identifier.
   * @param {any} row IvyTek loan row.
   */
  private async upsertIvyTekLoanTribalData(loanId: string, row: any): Promise<boolean> {
    const columns = await this.getIvyTekLoanTribalDatatableColumns(null);
    const payload = this.getIvyTekLoanTribalDataPayload(row, columns);
    let tribalDataUpdated = false;

    if (this.hasIvyTekDatatablePayloadValues(payload)) {
      try {
        await firstValueFrom(
          this.loansService.addLoanDatatableEntry(loanId, this.ivyTekLoanTribalDatatableName, payload)
        );
      } catch (error: any) {
        if (!this.isIvyTekDatatableAlreadyExistsError(error)) {
          throw error;
        }
        await firstValueFrom(
          this.loansService.editLoanDatatableEntry(loanId, this.ivyTekLoanTribalDatatableName, payload)
        );
      }
      tribalDataUpdated = true;
    }

    await this.upsertIvyTekMappedCustomFields('m_loan', loanId, row, [this.ivyTekLoanTribalDatatableName]);
    return tribalDataUpdated;
  }

  /**
   * Loads an existing Tribal Loan Data entry for a loan.
   * @param {string} loanId Loan identifier.
   */
  private async getIvyTekLoanTribalDatatable(loanId: string): Promise<any> {
    try {
      const datatable: any = await firstValueFrom(
        this.loansService.getLoanDatatable(loanId, this.ivyTekLoanTribalDatatableName)
      );
      this.cacheIvyTekLoanTribalDatatableColumns(datatable);
      return datatable;
    } catch (error: any) {
      if (error?.status !== 404) {
        throw error;
      }
      return null;
    }
  }

  /**
   * Gets Tribal Loan Data columns from the current row response or loan datatable metadata.
   * @param {any} datatable Current loan datatable response.
   */
  private async getIvyTekLoanTribalDatatableColumns(datatable: any): Promise<any[]> {
    const datatableColumns = this.getIvyTekDatatableColumns(datatable);
    if (datatableColumns.length) {
      this.ivyTekLoanTribalDatatableColumns = datatableColumns;
      return datatableColumns;
    }

    if (this.ivyTekLoanTribalDatatableColumns.length) {
      return this.ivyTekLoanTribalDatatableColumns;
    }

    try {
      const tribalDatatable: any = await firstValueFrom(
        this.systemService.getDataTable(this.ivyTekLoanTribalDatatableName)
      );
      this.ivyTekLoanTribalDatatableColumns = this.getIvyTekDatatableColumns(tribalDatatable);
    } catch (error: any) {
      if (error?.status !== 404) {
        throw error;
      }
      const datatables = this.normalizeIvyTekListResponse(await firstValueFrom(this.loansService.getLoanDataTables()));
      const tribalDatatable = datatables.find(
        (table: any) =>
          this.normalizeIvyTekText(table.registeredTableName || table.name) ===
          this.normalizeIvyTekText(this.ivyTekLoanTribalDatatableName)
      );
      this.ivyTekLoanTribalDatatableColumns = this.getIvyTekDatatableColumns(tribalDatatable);
    }

    return this.ivyTekLoanTribalDatatableColumns;
  }

  /**
   * Caches Tribal Loan Data column metadata when it is returned with an entry.
   * @param {any} datatable Datatable response.
   */
  private cacheIvyTekLoanTribalDatatableColumns(datatable: any) {
    const columns = this.getIvyTekDatatableColumns(datatable);
    if (columns.length) {
      this.ivyTekLoanTribalDatatableColumns = columns;
    }
  }

  /**
   * Normalizes supported datatable column response shapes.
   * @param {any} datatable Datatable response or definition.
   */
  private getIvyTekDatatableColumns(datatable: any): any[] {
    return datatable?.columnHeaders || datatable?.columnHeaderData || datatable?.columns || [];
  }

  /**
   * Loads datatable definitions for an app table so IvyTek source fields can map to configured custom fields.
   * @param {string} appTable Fineract app table name.
   */
  private async getIvyTekEntityDatatableDefinitions(appTable: string): Promise<any[]> {
    if (this.ivyTekEntityDatatableDefinitionsByAppTable.has(appTable)) {
      return this.ivyTekEntityDatatableDefinitionsByAppTable.get(appTable) || [];
    }

    let datatables: any[] = [];
    try {
      datatables = this.normalizeIvyTekListResponse(
        await firstValueFrom(this.systemService.getEntityDatatables(appTable))
      );
    } catch {
      try {
        datatables =
          appTable === 'm_client'
            ? this.normalizeIvyTekListResponse(await firstValueFrom(this.clientsService.getClientDatatables()))
            : this.normalizeIvyTekListResponse(await firstValueFrom(this.loansService.getLoanDataTables()));
      } catch {
        datatables = [];
      }
    }

    const definitions = await Promise.all(
      datatables.map(async (datatable: any) => {
        const datatableName = this.getIvyTekDatatableName(datatable);
        if (!datatableName) {
          return datatable;
        }
        try {
          return await firstValueFrom(this.systemService.getDataTable(datatableName));
        } catch {
          return datatable;
        }
      })
    );
    this.ivyTekEntityDatatableDefinitionsByAppTable.set(appTable, definitions);
    return definitions;
  }

  /**
   * Gets all custom-field column references configured for an entity.
   * @param {string} appTable Fineract app table name.
   */
  private async getIvyTekEntityDatatableColumnReferences(appTable: string): Promise<IvyTekDatatableColumnReference[]> {
    if (this.ivyTekDatatableColumnsByAppTable.has(appTable)) {
      return this.ivyTekDatatableColumnsByAppTable.get(appTable) || [];
    }

    const definitions = await this.getIvyTekEntityDatatableDefinitions(appTable);
    const columns = definitions.flatMap((datatable: any) =>
      this.getIvyTekDatatableColumns(datatable)
        .filter((column: any) => !this.isIvyTekSystemDatatableColumn(column))
        .map((column: any) => ({
          tableName: this.getIvyTekDatatableName(datatable),
          columnName: column.columnName || column.name,
          columnDisplayType: column.columnDisplayType || column.type,
          displayName: column.displayName || column.name
        }))
    );
    this.ivyTekDatatableColumnsByAppTable.set(appTable, columns);
    return columns;
  }

  /**
   * Gets a datatable's registered table name from supported response shapes.
   * @param {any} datatable Datatable metadata.
   */
  private getIvyTekDatatableName(datatable: any): string {
    return datatable?.registeredTableName || datatable?.datatableName || datatable?.name || '';
  }

  /**
   * Checks whether a datatable column is Fineract metadata rather than a custom field.
   * @param {any} column Datatable column metadata.
   */
  private isIvyTekSystemDatatableColumn(column: any): boolean {
    return [
      'id',
      'client_id',
      'loan_id',
      'created_at',
      'updated_at'
    ].includes((column?.columnName || column?.name || '').toString());
  }

  /**
   * Upserts any source fields that match configured custom-field columns on the entity.
   * @param {string} appTable Fineract app table name.
   * @param {string} entityId Entity id.
   * @param {any} row IvyTek source row.
   * @param {string[]} excludedTableNames Datatables handled by specialized mappers.
   */
  private async upsertIvyTekMappedCustomFields(
    appTable: string,
    entityId: string,
    row: any,
    excludedTableNames: string[] = []
  ): Promise<number> {
    if (!entityId) {
      return 0;
    }

    const definitions = await this.getIvyTekEntityDatatableDefinitions(appTable);
    let updatedTables = 0;
    for (const datatable of definitions) {
      const datatableName = this.getIvyTekDatatableName(datatable);
      if (
        !datatableName ||
        excludedTableNames
          .map((tableName: string) => this.normalizeIvyTekText(tableName))
          .includes(this.normalizeIvyTekText(datatableName))
      ) {
        continue;
      }

      // Multi-row datatables (first column is 'id') cannot be generically upserted
      // without a row ID — skip them to avoid 404 errors on update attempts.
      const allColumns = this.getIvyTekDatatableColumns(datatable);
      if (allColumns.length > 0 && (allColumns[0].columnName || allColumns[0].name) === 'id') {
        continue;
      }

      const payload = this.getIvyTekMappedCustomFieldPayload(row, datatable);
      if (!this.hasIvyTekDatatablePayloadValues(payload)) {
        continue;
      }

      await this.upsertIvyTekEntityDatatableEntry(appTable, entityId, datatableName, payload);
      updatedTables += 1;
    }
    return updatedTables;
  }

  /**
   * Builds a datatable payload by exact normalized source-column to custom-field-column matching.
   * @param {any} row IvyTek source row.
   * @param {any} datatable Datatable metadata.
   */
  private getIvyTekMappedCustomFieldPayload(row: any, datatable: any) {
    const payload: any = {
      locale: this.settingsService.language.code
    };
    let hasDateValue = false;
    this.getIvyTekDatatableColumns(datatable)
      .filter((column: any) => !this.isIvyTekSystemDatatableColumn(column))
      .forEach((column: any) => {
        const sourceValue = this.getIvyTekSourceValueForDatatableColumn(row, column);
        if (sourceValue === '') {
          return;
        }
        const payloadValue = this.getIvyTekDatatablePayloadValue(column, sourceValue, [sourceValue]);
        if (payloadValue === null || payloadValue === undefined || payloadValue === '') {
          return;
        }
        payload[column.columnName || column.name] = payloadValue;
        const columnType = (column.columnDisplayType || column.type || '').toString().toUpperCase();
        if ([
            'DATE',
            'DATETIME'
          ].includes(columnType)) {
          hasDateValue = true;
        }
      });
    if (hasDateValue) {
      payload.dateFormat = this.settingsService.dateFormat;
    }
    return payload;
  }

  /**
   * Finds a source row value whose column name matches a datatable custom field.
   * @param {any} row IvyTek source row.
   * @param {any} column Datatable column metadata.
   */
  private getIvyTekSourceValueForDatatableColumn(row: any, column: any): string {
    const candidateColumnNames = this.getIvyTekDatatableColumnNames(column).map((name: string) =>
      this.ivyTekFieldMapping.normalize(name)
    );
    const sourceColumn = Object.keys(row || {}).find((key: string) =>
      candidateColumnNames.includes(this.ivyTekFieldMapping.normalize(key))
    );
    return sourceColumn ? this.getCsvValue(row, sourceColumn) : '';
  }

  /**
   * Adds or edits a matched custom-field datatable row.
   * @param {string} appTable Fineract app table name.
   * @param {string} entityId Entity id.
   * @param {string} datatableName Datatable name.
   * @param {any} payload Datatable payload.
   */
  private async upsertIvyTekEntityDatatableEntry(
    appTable: string,
    entityId: string,
    datatableName: string,
    payload: any
  ) {
    try {
      if (appTable === 'm_client') {
        await firstValueFrom(this.clientsService.addClientDatatableEntry(entityId, datatableName, payload));
      } else {
        await firstValueFrom(this.loansService.addLoanDatatableEntry(entityId, datatableName, payload));
      }
    } catch (error: any) {
      if (!this.isIvyTekDatatableAlreadyExistsError(error)) {
        throw error;
      }
      if (appTable === 'm_client') {
        await firstValueFrom(this.clientsService.editClientDatatableEntry(entityId, datatableName, payload));
      } else {
        await firstValueFrom(this.loansService.editLoanDatatableEntry(entityId, datatableName, payload));
      }
    }
  }

  /**
   * Builds the Tribal Loan Data payload from an IvyTek loan row.
   * @param {any} row IvyTek loan row.
   * @param {any[]} columns Tribal Loan Data column metadata.
   */
  private getIvyTekLoanTribalDataPayload(row: any, columns: any[]) {
    const payload: any = {
      locale: this.settingsService.language.code
    };
    const relation = this.getIvyTekLoanRelation(row);
    const mortgageCode = this.getIvyTekLoanMortgageCode(row);
    const loanGroup = this.getIvyTekLoanGroup(row);
    const percap = this.getIvyTekLoanPercap(row);
    const pension = this.getIvyTekLoanPension(row);
    const payroll = this.getIvyTekLoanPayroll(row);

    this.setIvyTekDatatablePayloadValue(
      payload,
      columns,
      [
        'Relation',
        'Family'
      ],
      relation
    );
    this.setIvyTekDatatablePayloadValue(
      payload,
      columns,
      [
        'Mortgage code',
        'Mortgage Code'
      ],
      mortgageCode,
      [
        mortgageCode
      ]
    );
    this.setIvyTekDatatablePayloadValue(
      payload,
      columns,
      [
        'Loan group',
        'Loan Group'
      ],
      loanGroup,
      [
        loanGroup,
        this.getIvyTekProductName(this.normalizeIvyTekLoanGroup(loanGroup))
      ]
    );
    this.setIvyTekDatatablePayloadValue(
      payload,
      columns,
      [
        'Percap',
        'Per Capita'
      ],
      percap
    );
    this.setIvyTekDatatablePayloadValue(payload, columns, ['Pension'], pension);
    this.setIvyTekDatatablePayloadValue(payload, columns, ['Payroll'], payroll);
    if (columns.length) {
      this.setIvyTekDatatablePayloadValue(
        payload,
        columns,
        [
          'Contract Rate',
          'ContractRate'
        ],
        this.getIvyTekLoanContractRateDecimal(row)
      );
      this.setIvyTekDatatablePayloadValue(
        payload,
        columns,
        [
          'Current Payment Processing Type',
          'Payment Processing Type'
        ],
        this.getCsvValue(row, 'IvytekTestPkg__CurrentPaymentProcessingType__c')
      );
      this.setIvyTekDatatablePayloadValue(
        payload,
        columns,
        [
          'Delinquent Amount',
          'Delinquent Amount All'
        ],
        this.getFirstIvyTekDecimal(row, [
          'IvytekTestPkg__DelinquentAmountAll__c',
          'Delinquent Amount All',
          'DelinquentAmountAll'
        ])
      );
      this.setIvyTekDatatablePayloadValue(
        payload,
        columns,
        [
          'Last Interest Date',
          'LastInterestDate'
        ],
        this.getCsvValue(row, 'IvytekTestPkg__LastInterestDate__c')
      );
      this.setIvyTekDatatablePayloadValue(
        payload,
        columns,
        [
          'Loan Date',
          'Origination Date'
        ],
        this.getIvyTekSourceLoanDate(row)
      );
      this.setIvyTekDatatablePayloadValue(
        payload,
        columns,
        [
          'Maturity Date',
          'Mat Date'
        ],
        this.getIvyTekSourceMaturityDate(row)
      );
      this.setIvyTekDatatablePayloadValue(
        payload,
        columns,
        [
          'Next Payment Date',
          'NextPaymentDate'
        ],
        this.getCsvValue(row, 'IvytekTestPkg__Next_Payment_Date__c')
      );
      this.setIvyTekDatatablePayloadValue(
        payload,
        columns,
        [
          'Next Payment Note',
          'NextPaymentNote'
        ],
        this.getCsvValue(row, 'IvytekTestPkg__Next_Payment_Note__c')
      );
      this.setIvyTekDatatablePayloadValue(
        payload,
        columns,
        [
          'Note',
          'Regular Payment Amount'
        ],
        this.getCsvValue(row, 'IvytekTestPkg__Note__c')
      );
    }

    return payload;
  }

  /**
   * Adds a source value to a datatable payload when the target column can accept it.
   * @param {any} payload Datatable payload.
   * @param {any[]} columns Datatable columns.
   * @param {string[]} labels Candidate target labels.
   * @param {any} value Source value.
   * @param {string[]} codeLookupCandidates Candidate code lookup labels.
   */
  private setIvyTekDatatablePayloadValue(
    payload: any,
    columns: any[],
    labels: string[],
    value: any,
    codeLookupCandidates: string[] = []
  ) {
    const column = this.findIvyTekDatatableColumn(columns, labels);
    if (!column && columns.length) {
      return;
    }

    const columnName = column?.columnName || labels[0];
    const payloadValue = this.getIvyTekDatatablePayloadValue(column, value, codeLookupCandidates);
    if (payloadValue === null || payloadValue === undefined || payloadValue === '') {
      return;
    }
    payload[columnName] = payloadValue;
  }

  /**
   * Finds a datatable column by its storage name or displayed input name.
   * @param {any[]} columns Datatable columns.
   * @param {string[]} labels Candidate labels.
   */
  private findIvyTekDatatableColumn(columns: any[], labels: string[]) {
    const normalizedLabels = labels
      .map((label: string) => this.normalizeIvyTekText(label))
      .filter((label: string) => !!label);
    return columns.find((column: any) => {
      const columnNames = this.getIvyTekDatatableColumnNames(column).map((name: string) =>
        this.normalizeIvyTekText(name)
      );
      return columnNames.some((name: string) => normalizedLabels.includes(name));
    });
  }

  /**
   * Gets candidate names for a datatable column.
   * @param {any} column Datatable column.
   */
  private getIvyTekDatatableColumnNames(column: any): string[] {
    const columnName = column?.columnName || '';
    const names = [
      columnName,
      column?.displayName || '',
      column?.name || ''
    ];
    if (columnName.includes('_cd_')) {
      const parts = columnName.split('_cd_');
      names.push(parts[0], parts[1]);
    }
    if (columnName.includes('_')) {
      names.push(columnName.replace(/_/g, ' '));
    }
    return Array.from(new Set(names.filter((name: string) => !!name)));
  }

  /**
   * Coerces a CSV value into the value expected by a datatable column.
   * @param {any} column Datatable column.
   * @param {any} value Source value.
   * @param {string[]} codeLookupCandidates Candidate code lookup labels.
   */
  private getIvyTekDatatablePayloadValue(column: any, value: any, codeLookupCandidates: string[] = []) {
    const columnType = (column?.columnDisplayType || column?.type || '').toString().toUpperCase();
    if (value === null || value === undefined || value === '') {
      return '';
    }

    if (columnType === 'INTEGER') {
      return this.parseIvyTekInteger(value.toString());
    }
    if (columnType === 'DECIMAL' || columnType === 'NUMBER') {
      return this.parseIvyTekDecimal(value.toString());
    }
    if (columnType === 'BOOLEAN') {
      return this.parseIvyTekBoolean(value);
    }
    if (columnType === 'DATE' || columnType === 'DATETIME') {
      return this.formatIvyTekDateValue(value);
    }
    if (columnType === 'CODELOOKUP' || columnType === 'DROPDOWN') {
      return this.getIvyTekDatatableCodeLookupId(column, [
        value.toString(),
        ...codeLookupCandidates
      ]);
    }

    return value;
  }

  /**
   * Finds a code lookup id from configured datatable column values.
   * @param {any} column Datatable column.
   * @param {string[]} candidates Candidate source labels or codes.
   */
  private getIvyTekDatatableCodeLookupId(column: any, candidates: string[]) {
    const values = column?.columnValues || [];
    const normalizedCandidates = candidates
      .map((candidate: string) => candidate?.toString() || '')
      .filter((candidate: string) => !!candidate)
      .map((candidate: string) => ({
        raw: candidate,
        normalized: this.normalizeIvyTekText(candidate)
      }))
      .filter((candidate: any) => !!candidate.normalized);
    if (!values.length || !normalizedCandidates.length) {
      return '';
    }

    const exactMatch = values.find((option: any) => {
      const optionNames = this.getIvyTekCodeLookupOptionNames(option).map((name: string) =>
        this.normalizeIvyTekText(name)
      );
      return (
        normalizedCandidates.some((candidate: any) => option?.id?.toString() === candidate.raw) ||
        optionNames.some((name: string) => normalizedCandidates.some((candidate: any) => name === candidate.normalized))
      );
    });
    if (exactMatch?.id !== undefined && exactMatch?.id !== null) {
      return exactMatch.id;
    }

    const looseMatch = values.find((option: any) => {
      const optionNames = this.getIvyTekCodeLookupOptionNames(option).map((name: string) =>
        this.normalizeIvyTekText(name)
      );
      return optionNames.some((name: string) =>
        normalizedCandidates.some((candidate: any) => {
          const canUseLooseMatch = /^\d+$/.test(candidate.normalized)
            ? candidate.normalized.length >= 3
            : candidate.normalized.length >= 2;
          return canUseLooseMatch && name.includes(candidate.normalized);
        })
      );
    });
    return looseMatch?.id !== undefined && looseMatch?.id !== null ? looseMatch.id : '';
  }

  /**
   * Gets candidate names from a code lookup option.
   * @param {any} option Code lookup option.
   */
  private getIvyTekCodeLookupOptionNames(option: any): string[] {
    return [
      option?.value,
      option?.name,
      option?.code,
      option?.description
    ].filter((name: string) => !!name);
  }

  /**
   * Checks whether a datatable payload has real field values beyond locale metadata.
   * @param {any} payload Datatable payload.
   */
  private hasIvyTekDatatablePayloadValues(payload: any) {
    return Object.keys(payload).some(
      (key: string) => ![
          'locale',
          'dateFormat'
        ].includes(key) && payload[key] !== ''
    );
  }

  /**
   * Checks whether an add datatable request failed because the row already exists.
   * @param {any} error API error.
   */
  private isIvyTekDatatableAlreadyExistsError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return [
        400,
        403,
        409
      ].includes(
        error?.status
      ) && (message.includes('already exists') || message.includes('already registered') || message.includes('duplicate') || message.includes('data integrity'));
  }

  /**
   * Adds SSN and tribal entity identifiers when matching document types are configured.
   * @param {string} clientId Client identifier.
   * @param {any} row IvyTek CSV row.
   */
  private async upsertIvyTekClientIdentifiers(clientId: string, row: any) {
    const warnings: string[] = [];
    const identifierCandidates = [
      {
        value: this.getIvyTekEntityId(row),
        documentTypeNames: [
          'Entity ID',
          'EntityID',
          'Tribal Entity Number',
          'Tribal Entity ID',
          'Tribal ID'
        ],
        description: 'Tribal Entity Number'
      },
      {
        value: this.getIvyTekSsn(row),
        documentTypeNames: [
          'SSN',
          'Social Security Number',
          'Social Security'
        ],
        description: 'SSN'
      }
    ].filter((candidate: any) => !!candidate.value);

    if (!identifierCandidates.length) {
      return warnings;
    }

    let existingIdentifiers: any[] = [];
    let identifierTemplate: any = null;
    try {
      const [
        existingIdentifiersResponse,
        identifierTemplateResponse
      ] = await Promise.all([
        firstValueFrom(this.clientsService.getClientIdentifiers(clientId)),
        firstValueFrom(this.clientsService.getClientIdentifierTemplate(clientId))
      ]);
      existingIdentifiers = this.normalizeIvyTekListResponse(existingIdentifiersResponse);
      identifierTemplate = identifierTemplateResponse;
    } catch (error: any) {
      if (error?.status === 404) {
        return warnings;
      }
      throw error;
    }

    for (const candidate of identifierCandidates) {
      const documentType = this.findIvyTekDocumentType(
        identifierTemplate?.allowedDocumentTypes || [],
        candidate.documentTypeNames
      );
      if (!documentType?.id || this.hasIvyTekClientIdentifier(existingIdentifiers, documentType.id, candidate.value)) {
        continue;
      }

      try {
        const response: any = await firstValueFrom(
          this.clientsService.addClientIdentifier(clientId, {
            documentTypeId: documentType.id,
            status: 'Active',
            documentKey: candidate.value,
            description: candidate.description
          })
        );
        existingIdentifiers.push({
          id: response?.resourceId,
          documentType,
          documentKey: candidate.value
        });
      } catch (error: any) {
        if (!this.isIvyTekDuplicateIdentifierError(error)) {
          throw error;
        }
        warnings.push(
          `Skipped duplicate ${candidate.description} identifier ${candidate.value}. Mifos already has this identifier on another client, so this client was imported without adding the duplicate identifier.`
        );
      }
    }
    return warnings;
  }

  /**
   * Adds or updates a client address when the IvyTek source includes address fields.
   * @param {string} clientId Client identifier.
   * @param {any} row IvyTek CSV row.
   */
  private async upsertIvyTekClientAddress(clientId: string, row: any) {
    try {
      const addressPayload = await this.getIvyTekClientAddressPayload(row);
      if (!addressPayload) {
        const hasAddressSource = this.hasIvyTekClientAddressSource(row);
        return {
          status: hasAddressSource ? 'Needs staging' : 'No source address',
          warning: hasAddressSource
            ? `IvyTek address source values exist, but no Mifos client address payload could be built. ${this.getIvyTekAddressSourceSummary(row)} Source address values are preserved in the result export for controlled staging.`
            : ''
        };
      }

      let existingAddresses: any[] = [];
      try {
        existingAddresses = this.normalizeIvyTekListResponse(
          await firstValueFrom(this.clientsService.getClientAddressData(clientId))
        );
      } catch (error: any) {
        if (error?.status === 404) {
          return {
            status: 'Needs staging',
            warning:
              'Mifos client address API/template is not available for this tenant. Source address values are preserved in the result export for controlled staging.'
          };
        }
        throw error;
      }

      const existingAddress = existingAddresses.find((address: any) => {
        const addressTypeId = address.addressTypeId || address.addressType?.id || address.addressType;
        return addressTypeId?.toString() === addressPayload.addressTypeId.toString();
      });

      if (existingAddress) {
        await firstValueFrom(
          this.clientsService.editClientAddress(
            clientId,
            addressPayload.addressTypeId,
            this.getIvyTekClientAddressRequestPayload({
              ...addressPayload,
              addressId: existingAddress.addressId || existingAddress.id
            })
          )
        );
        return {
          status: 'Updated',
          warning: ''
        };
      }

      await firstValueFrom(
        this.clientsService.createClientAddress(
          clientId,
          addressPayload.addressTypeId,
          this.getIvyTekClientAddressRequestPayload(addressPayload)
        )
      );
      return {
        status: 'Created',
        warning: ''
      };
    } catch (error: any) {
      if (!this.hasIvyTekClientAddressSource(row)) {
        throw error;
      }
      return {
        status: 'Needs staging',
        warning: `IvyTek address was not written to m_client_address. ${this.getErrorMessage(error)} ${this.getIvyTekAddressSourceSummary(row)} Source address values are preserved in the result export for controlled staging.`
      };
    }
  }

  /**
   * Builds a client address payload from IvyTek statement/contact address columns.
   * @param {any} row IvyTek CSV row.
   */
  private async getIvyTekClientAddressPayload(row: any) {
    const street = this.getFirstCsvValue(row, [
      'IvytekTestPkg__Statement_Street__c',
      'Statement Street',
      'MailingStreet',
      'Street',
      'Address',
      'Address Line 1',
      'address_line_1'
    ]);
    const addressValues = {
      street: street || this.buildIvyTekStreetAddress(row),
      addressLine2: this.getFirstCsvValue(row, [
        'IvytekTestPkg__Apartment__c',
        'IvytekTestPkg__Other_Apartment__c',
        'MailingAddressLine2',
        'Address Line 2',
        'address_line_2'
      ]),
      city: this.getFirstCsvValue(row, [
        'IvytekTestPkg__Statement_City__c',
        'Statement City',
        'MailingCity',
        'IvytekTestPkg__City__c',
        'City',
        'city'
      ]),
      stateProvince: this.getFirstCsvValue(row, [
        'IvytekTestPkg__Statement_State_Province__c',
        'Statement State',
        'MailingState',
        'MailingStateCode',
        'IvytekTestPkg__State__c',
        'State',
        'state'
      ]),
      postalCode: this.getFirstCsvValue(row, [
        'IvytekTestPkg__Statement_PostalCode__c',
        'IvytekTestPkg__Statement_Postal_Code__c',
        'Statement Postal Code',
        'MailingPostalCode',
        'IvytekTestPkg__Zip__c',
        'PostalCode',
        'Zip',
        'ZIP',
        'postal_code'
      ]),
      country: this.getFirstCsvValue(row, [
        'MailingCountryCode',
        'IvytekTestPkg__Statement_Country__c',
        'Statement Country',
        'MailingCountry',
        'IvytekTestPkg__Country__c',
        'Country',
        'country'
      ])
    };

    if (!this.hasIvyTekClientAddressSource(row)) {
      return null;
    }

    const addressTemplate = await this.getIvyTekClientAddressTemplate();
    const addressTypeOptions = addressTemplate?.addressTypeIdOptions || [];
    const addressType = this.getFirstCsvValue(row, [
      'IvytekTestPkg__Address_Type__c',
      'IvytekTestPkg__Credit_Report_Address__c',
      'IvytekTestPkg__Statement_Address_Type__c',
      'Address Type',
      'address_type'
    ]);
    const addressTypeCandidates = this.getIvyTekAddressTypeCandidates();
    const addressTypeId = this.findIvyTekOptionId(addressTypeOptions, addressTypeCandidates);
    if (!addressTypeId) {
      if (!addressTypeOptions.length) {
        throw new Error(
          `Mifos client address template and ADDRESS_TYPE code values returned no address type options. The importer cannot create m_client_address through REST because the address API requires an address type id in the type query parameter. Configure a Mifos address type code value named Mailing, or route these preserved address values through controlled staging SQL. ${this.getIvyTekAddressTemplateShapeSummary(
            addressTemplate
          )}`
        );
      }
      throw new Error(
        `Unable to map IvyTek address type to a Mifos client address type. ${this.getIvyTekAddressOptionErrorDetails(
          addressType,
          addressTypeCandidates,
          addressTypeOptions,
          'address type'
        )}`
      );
    }
    const stateProvinceCandidates = [
      addressValues.stateProvince,
      this.getCsvValue(row, 'MailingState'),
      this.getCsvValue(row, 'MailingStateCode')
    ];
    const stateProvinceOptions = addressTemplate?.stateProvinceIdOptions || [];
    const stateProvinceId = this.findIvyTekOptionId(stateProvinceOptions, stateProvinceCandidates);
    if (addressValues.stateProvince && stateProvinceOptions.length && !stateProvinceId) {
      throw new Error(
        `Unable to map IvyTek address state/province to Mifos. ${this.getIvyTekAddressOptionErrorDetails(
          addressValues.stateProvince,
          stateProvinceCandidates,
          stateProvinceOptions,
          'state/province'
        )}`
      );
    }
    const countryCandidates = [
      addressValues.country,
      this.getCsvValue(row, 'MailingCountry'),
      this.getCsvValue(row, 'MailingCountryCode')
    ];
    const countryOptions = addressTemplate?.countryIdOptions || [];
    const countryId = this.findIvyTekOptionId(countryOptions, countryCandidates);
    if (addressValues.country && countryOptions.length && !countryId) {
      throw new Error(
        `Unable to map IvyTek address country to Mifos. ${this.getIvyTekAddressOptionErrorDetails(
          addressValues.country,
          countryCandidates,
          countryOptions,
          'country'
        )}`
      );
    }

    const payload: any = {
      addressTypeId,
      street: addressValues.street,
      addressLine1: addressValues.street,
      addressLine2: addressValues.addressLine2,
      city: addressValues.city,
      postalCode: addressValues.postalCode,
      stateProvinceId,
      countryId,
      isActive: true
    };

    Object.keys(payload).forEach((key: string) => {
      if (payload[key] === '' || payload[key] === null || payload[key] === undefined) {
        delete payload[key];
      }
    });
    return payload;
  }

  /**
   * Removes route-only and tenant-disabled fields before sending an address body to Fineract.
   * @param {any} addressPayload Address payload with route metadata.
   */
  private getIvyTekClientAddressRequestPayload(addressPayload: any) {
    const requestPayload = {
      ...addressPayload
    };
    delete requestPayload.addressTypeId;
    delete requestPayload.street;
    return requestPayload;
  }

  /**
   * Builds a street line from IvyTek's component address fields when no complete street line exists.
   * @param {any} row IvyTek CSV row.
   */
  private buildIvyTekStreetAddress(row: any) {
    return [
      this.getCsvValue(row, 'IvytekTestPkg__Street_Number__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Street_Direction__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Street_Name__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Street_Type__c')
    ]
      .filter((value: string) => !!value)
      .join(' ');
  }

  /**
   * Gets Mifos address type names for IvyTek mailing addresses.
   */
  private getIvyTekAddressTypeCandidates(): string[] {
    const candidates = [
      'Mailing',
      'Mailing Address',
      'Mail',
      'Mail Address'
    ];
    return Array.from(new Set(candidates.filter((candidate: string) => !!candidate)));
  }

  /**
   * Describes option matching failures with source values and tenant option names.
   * @param {string} sourceValue Source value that failed to map.
   * @param {string[]} candidates Candidate names attempted.
   * @param {any[]} options Available Mifos options.
   * @param {string} optionLabel Option label for the message.
   */
  private getIvyTekAddressOptionErrorDetails(
    sourceValue: string,
    candidates: string[],
    options: any[],
    optionLabel: string
  ) {
    const candidateText = candidates.filter((candidate: string) => !!candidate).join(', ') || 'none';
    return `Source ${optionLabel} value: "${sourceValue || '(blank)'}". Candidates tried: ${candidateText}. Available Mifos ${optionLabel} options: ${this.getIvyTekOptionListForMessage(options)}.`;
  }

  /**
   * Summarizes populated IvyTek address source fields for warning rows.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekAddressSourceSummary(row: any) {
    const sourceFields = [
      'IvytekTestPkg__Address_Type__c',
      'IvytekTestPkg__Credit_Report_Address__c',
      'MailingStreet',
      'MailingCity',
      'MailingState',
      'MailingStateCode',
      'MailingPostalCode',
      'MailingCountry',
      'MailingCountryCode',
      'IvytekTestPkg__Street_Number__c',
      'IvytekTestPkg__Street_Direction__c',
      'IvytekTestPkg__Street_Name__c',
      'IvytekTestPkg__Street_Type__c',
      'IvytekTestPkg__Apartment__c',
      'IvytekTestPkg__City__c',
      'IvytekTestPkg__State__c',
      'IvytekTestPkg__Zip__c',
      'IvytekTestPkg__Country__c'
    ]
      .map((field: string) => {
        const value = this.getCsvValue(row, field);
        return value ? `${field}="${value}"` : '';
      })
      .filter((field: string) => !!field);
    return `Address source fields: ${sourceFields.length ? sourceFields.join('; ') : 'none populated'}.`;
  }

  /**
   * Checks whether the source row carries address data that must be preserved.
   * @param {any} row IvyTek CSV row.
   */
  private hasIvyTekClientAddressSource(row: any) {
    return [
      'IvytekTestPkg__Statement_Street__c',
      'Statement Street',
      'MailingStreet',
      'Street',
      'Address',
      'Address Line 1',
      'address_line_1',
      'IvytekTestPkg__Street_Number__c',
      'IvytekTestPkg__Street_Direction__c',
      'IvytekTestPkg__Street_Name__c',
      'IvytekTestPkg__Street_Type__c',
      'IvytekTestPkg__Apartment__c',
      'IvytekTestPkg__Other_Apartment__c',
      'MailingAddressLine2',
      'Address Line 2',
      'address_line_2',
      'IvytekTestPkg__Statement_City__c',
      'Statement City',
      'MailingCity',
      'IvytekTestPkg__City__c',
      'City',
      'city',
      'IvytekTestPkg__Statement_State_Province__c',
      'Statement State',
      'MailingState',
      'MailingStateCode',
      'IvytekTestPkg__State__c',
      'State',
      'state',
      'IvytekTestPkg__Statement_PostalCode__c',
      'IvytekTestPkg__Statement_Postal_Code__c',
      'Statement Postal Code',
      'MailingPostalCode',
      'IvytekTestPkg__Zip__c',
      'PostalCode',
      'Zip',
      'ZIP',
      'postal_code'
    ].some((key: string) => !!this.getCsvValue(row, key));
  }

  /**
   * Loads and caches the client address template.
   */
  private async getIvyTekClientAddressTemplate() {
    if (this.ivyTekClientAddressTemplate || this.ivyTekClientAddressTemplateUnavailable) {
      return this.ivyTekClientAddressTemplate;
    }
    try {
      this.ivyTekClientAddressTemplate = this.normalizeIvyTekClientAddressTemplate(
        await firstValueFrom(this.clientsService.getClientAddressTemplate())
      );
      if (!this.ivyTekClientAddressTemplate.addressTypeIdOptions.length) {
        this.ivyTekClientAddressTemplate.addressTypeIdOptions = await this.getIvyTekAddressTypeCodeValueOptions();
      }
    } catch (error: any) {
      if (error?.status !== 404) {
        throw error;
      }
      this.ivyTekClientAddressTemplateUnavailable = true;
    }
    return this.ivyTekClientAddressTemplate;
  }

  /**
   * Loads address type code values directly when the address template omits them.
   */
  private async getIvyTekAddressTypeCodeValueOptions(): Promise<any[]> {
    try {
      const codes = this.normalizeIvyTekListResponse(await firstValueFrom(this.systemService.getCodes()));
      const addressTypeCode = codes.find((code: any) => {
        const names = [
          code?.name,
          code?.codeName,
          code?.systemDefinedName,
          code?.displayName
        ].map((name: string) => this.normalizeIvyTekText(name));
        return names.some((name: string) =>
          [
            'addresstype',
            'address type',
            'address_type'
          ]
            .map((candidate: string) => this.normalizeIvyTekText(candidate))
            .includes(name)
        );
      });
      if (!addressTypeCode?.id) {
        return [];
      }
      return this.normalizeIvyTekListResponse(
        await firstValueFrom(this.systemService.getCodeValues(addressTypeCode.id))
      )
        .filter((codeValue: any) => codeValue?.isActive !== false)
        .map((codeValue: any) => ({
          ...codeValue,
          name: codeValue.name || codeValue.value || codeValue.label
        }));
    } catch {
      return [];
    }
  }

  /**
   * Normalizes known Fineract address template shapes into the option names the importer uses.
   * @param {any} rawTemplate Raw address template response.
   */
  private normalizeIvyTekClientAddressTemplate(rawTemplate: any) {
    const template = rawTemplate || {};
    return {
      ...template,
      addressTypeIdOptions: this.getFirstIvyTekNestedArray(template, [
        'addressTypeIdOptions',
        'addressTypeOptions',
        'addressTypeOptionsData'
      ]),
      stateProvinceIdOptions: this.getFirstIvyTekNestedArray(template, [
        'stateProvinceIdOptions',
        'stateProvinceOptions',
        'stateOptions',
        'stateIdOptions'
      ]),
      countryIdOptions: this.getFirstIvyTekNestedArray(template, [
        'countryIdOptions',
        'countryOptions',
        'countryOptionsData'
      ]),
      rawTemplateKeys: this.getIvyTekObjectKeysForMessage(template)
    };
  }

  /**
   * Finds the first nested array for one of the expected template option keys.
   * @param {any} source Object to search.
   * @param {string[]} keys Candidate option keys.
   */
  private getFirstIvyTekNestedArray(source: any, keys: string[]): any[] {
    const queue = [source];
    const visited = new Set<any>();
    let emptyCandidate: any[] = [];
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const key of keys) {
        if (Array.isArray(current[key])) {
          if (current[key].length) {
            return current[key];
          }
          emptyCandidate = current[key];
        }
      }
      Object.keys(current).forEach((key: string) => {
        const value = current[key];
        if (value && typeof value === 'object') {
          if (Array.isArray(value)) {
            value.forEach((item: any) => queue.push(item));
          } else {
            queue.push(value);
          }
        }
      });
    }
    return emptyCandidate;
  }

  /**
   * Summarizes the address template response shape for diagnostics.
   * @param {any} addressTemplate Normalized address template.
   */
  private getIvyTekAddressTemplateShapeSummary(addressTemplate: any) {
    const rawTemplateKeys = addressTemplate?.rawTemplateKeys || this.getIvyTekObjectKeysForMessage(addressTemplate);
    return `Address template keys seen: ${rawTemplateKeys || 'none'}.`;
  }

  /**
   * Gets top-level keys from an object for diagnostics.
   * @param {any} value Object to summarize.
   */
  private getIvyTekObjectKeysForMessage(value: any) {
    if (!value || typeof value !== 'object') {
      return '';
    }
    return Object.keys(value).join(', ');
  }

  /**
   * Builds the Fineract client payload from an IvyTek CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekClientPayload(row: any, isNewClient: boolean = false, includeDatatables: boolean = false) {
    const dateFormat = this.settingsService.dateFormat;
    const locale = this.settingsService.language.code;
    const payload: any = {
      legalFormId: LegalFormId.PERSON,
      firstname: this.getIvyTekFirstName(row),
      middlename: this.getIvyTekMiddleName(row),
      lastname: this.getIvyTekLastName(row),
      externalId: this.getIvyTekExternalId(row),
      mobileNo: this.getIvyTekClientPhone(row),
      emailAddress: this.getIvyTekClientEmail(row),
      dateFormat,
      locale
    };
    if (isNewClient) {
      const activationDate = this.getIvyTekClientActivationDate(row);
      if (!activationDate) {
        throw new Error(
          'Missing historical client activation/submission date. Exact IvyTek import will not use the current business date as a fallback.'
        );
      }
      payload.officeId = this.getIvyTekOfficeIdForRow(row);
      payload.active = true;
      payload.submittedOnDate = activationDate;
      payload.activationDate = activationDate;
    }
    const birthdate = this.getIvyTekClientBirthdate(row);
    if (birthdate) {
      payload.dateOfBirth = birthdate;
    }
    Object.keys(payload).forEach((key: string) => {
      if (payload[key] === '') {
        delete payload[key];
      }
    });
    return payload;
  }

  /**
   * Gets the IvyTek external identifier from a CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekExternalId(row: any): string {
    if (this.isIvyTekContactRow(row)) {
      return this.getIvyTekContactExternalId(row);
    }

    return (
      this.getCsvValue(row, 'IvyTekClientExternalID') ||
      this.getCsvValue(row, 'Client ExternalID') ||
      this.getCsvValue(row, 'Lookup Client ExternalID') ||
      this.getCsvValue(row, 'IvytekTestPkg__Contact__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__Borrower_Contact__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c') ||
      this.getCsvValue(row, 'external_id') ||
      this.getCsvValue(row, 'sf_contact_id') ||
      this.getCsvValue(row, 'Id')
    );
  }

  /**
   * Checks whether a row came from the real Salesforce Contact export.
   * @param {any} row IvyTek CSV row.
   */
  private isIvyTekContactRow(row: any): boolean {
    const hasContactName =
      !!this.getCsvValue(row, 'FirstName') ||
      !!this.getCsvValue(row, 'LastName') ||
      !!this.getCsvValue(row, 'First Name') ||
      !!this.getCsvValue(row, 'Last Name') ||
      !!this.getCsvValue(row, 'firstname') ||
      !!this.getCsvValue(row, 'lastname');
    const hasContactIdentifier =
      !!this.getIvyTekContactSourceId(row) ||
      !!this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c') ||
      !!this.getCsvValue(row, 'external_id');
    return (
      this.getCsvValue(row, '_') === '[Contact]' ||
      (hasContactName &&
        hasContactIdentifier &&
        (!!this.getIvyTekEntityId(row) ||
          !!this.getCsvValue(row, 'Birthdate') ||
          !!this.getCsvValue(row, 'Phone') ||
          !!this.getCsvValue(row, 'OtherPhone')))
    );
  }

  /**
   * Gets the contact's Salesforce/source identifier without using it as the Mifos external id.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekContactSourceId(row: any): string {
    return this.getFirstCsvValue(row, [
      'IvyTekClientSourceContactID',
      'source_contact_id',
      'sf_contact_id',
      'Id',
      'ContactId',
      'ContactID',
      'AccountId'
    ]);
  }

  /**
   * Gets the Mifos client external id for a real Contact export.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekContactExternalId(row: any): string {
    return (
      this.getFirstCsvValue(row, [
        'IvyTekClientExternalID',
        'IvytekTestPkg__ExternalID__c',
        'external_id',
        'ExternalID',
        'External ID'
      ]) || this.getIvyTekContactSourceId(row)
    );
  }

  /**
   * Gets a client phone number from common IvyTek/contact columns.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekClientPhone(row: any): string {
    return (
      [
        'Phone',
        'MobilePhone',
        'HomePhone',
        'OtherPhone',
        'phone',
        'mobile_no',
        'mobile_phone',
        'IvytekTestPkg__CellPhone__c',
        'IvytekTestPkg__WorkPhone__c',
        'IvytekTestPkg__Phone__c',
        'IvytekTestPkg__MobilePhone__c'
      ]
        .map((key: string) => this.getCsvValue(row, key))
        .find((phone: string) => this.isIvyTekUsablePhoneNumber(phone)) || ''
    );
  }

  /**
   * Checks if a phone value is worth sending as mobileNo.
   * @param {string} value Phone value.
   */
  private isIvyTekUsablePhoneNumber(value: string): boolean {
    const digits = (value || '').replace(/\D/g, '');
    return digits.length >= 7 && !/^0+$/.test(digits);
  }

  /**
   * Gets a client email address from common IvyTek/contact columns.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekClientEmail(row: any): string {
    return this.getFirstCsvValue(row, [
      'Email',
      'EmailAddress',
      'email',
      'email_address',
      'IvytekTestPkg__Email__c'
    ]);
  }

  /**
   * Gets the client birthdate in the active Mifos date format.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekClientBirthdate(row: any): string {
    const birthdate = this.parseIvyTekDate(
      this.getFirstCsvValue(row, [
        'Birthdate',
        'Birth Date',
        'Date of Birth',
        'DOB',
        'birthdate',
        'date_of_birth',
        'PersonBirthdate',
        'IvytekTestPkg__Birthdate__c',
        'IvytekTestPkg__DOB__c',
        'IvytekTestPkg__Date_of_Birth__c'
      ])
    );
    return birthdate ? this.dateUtils.formatDate(birthdate, this.settingsService.dateFormat) : '';
  }

  /**
   * Gets the client activation date from an explicit value or earliest related loan date.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekClientActivationDate(row: any): string {
    const activationDate = this.getEarliestIvyTekDate([
      this.getCsvValue(row, 'IvyTekClientActivationDate'),
      this.getCsvValue(row, 'Client Activation Date'),
      this.getCsvValue(row, 'Client ActivationDate'),
      this.getCsvValue(row, 'activation_date'),
      this.getCsvValue(row, 'submittedon_date'),
      this.getCsvValue(row, 'Submitted On*'),
      this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c'),
      this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c'),
      this.getCsvValue(row, 'CreatedDate'),
      this.getCsvValue(row, 'created_on_utc')
    ]);
    return activationDate ? this.dateUtils.formatDate(activationDate, this.settingsService.dateFormat) : '';
  }

  /**
   * Gets the selected office opening date.
   * @param {any} row Optional IvyTek source row.
   */
  private getIvyTekSelectedOfficeOpeningDate(row: any = null): Date | null {
    return this.parseIvyTekDateValue(this.getIvyTekOfficeForRow(row)?.openingDate);
  }

  /**
   * Gets the office id that should own an imported IvyTek client.
   * @param {any} row IvyTek source row.
   */
  private getIvyTekOfficeIdForRow(row: any): any {
    const office = this.getIvyTekOfficeForRow(row);
    if (office?.id) {
      return office.id;
    }

    const companyCode = this.getIvyTekCompanyCode(row);
    if (companyCode) {
      throw new Error(
        `No Mifos office found for IvyTek company code "${companyCode}". Add an office with external ID ${companyCode} or name COMPANY ${companyCode}.`
      );
    }

    return this.ivyTekImportForm.get('officeId').value;
  }

  /**
   * Gets the office that should own an imported IvyTek client.
   * @param {any} row IvyTek source row.
   */
  private getIvyTekOfficeForRow(row: any = null): any {
    const explicitOffice = this.getIvyTekExplicitOffice(row);
    if (explicitOffice) {
      return explicitOffice;
    }

    const companyOffice = this.getIvyTekCompanyOffice(row);
    if (companyOffice || this.getIvyTekCompanyCode(row)) {
      return companyOffice;
    }

    return this.getIvyTekSelectedOffice();
  }

  /**
   * Gets an already-resolved office from a row or Fineract client response.
   * @param {any} row IvyTek source row or Fineract client data.
   */
  private getIvyTekExplicitOffice(row: any = null): any {
    const officeId =
      row?.officeId ||
      row?.office?.id ||
      row?.officeData?.id ||
      this.getCsvValue(row || {}, 'IvyTekClientOfficeId') ||
      this.getCsvValue(row || {}, 'officeId');
    if (!officeId) {
      return null;
    }

    return (
      (this.officeData || []).find((office: any) => office.id?.toString() === officeId.toString()) || {
        id: officeId,
        name:
          row?.officeName ||
          row?.office?.name ||
          row?.officeData?.name ||
          this.getCsvValue(row || {}, 'IvyTekClientOfficeName'),
        openingDate: row?.officeOpeningDate || row?.office?.openingDate || row?.officeData?.openingDate
      }
    );
  }

  /**
   * Gets the fallback office selected on the IvyTek import form.
   */
  private getIvyTekSelectedOffice(): any {
    const officeId = this.ivyTekImportForm.get('officeId').value;
    return (this.officeData || []).find((office: any) => office.id?.toString() === officeId?.toString());
  }

  /**
   * Finds a company office by IvyTek company code.
   * @param {any} row IvyTek source row.
   */
  private getIvyTekCompanyOffice(row: any = null): any {
    const companyCode = this.getIvyTekCompanyCode(row);
    if (!companyCode) {
      return null;
    }

    const normalizedCandidates = this.getUniqueIvyTekIdentifiers([
      companyCode,
      `COMPANY ${companyCode}`,
      `COMPANY${companyCode}`,
      companyCode === '0' ? 'WS CREDIT' : ''
    ]).map((candidate: string) => this.normalizeIvyTekOfficeLookupValue(candidate));

    return (this.officeData || []).find((office: any) => {
      const officeValues = [
        office?.externalId,
        office?.name,
        office?.displayName
      ].map((value: any) => this.normalizeIvyTekOfficeLookupValue(value));
      return officeValues.some((value: string) => normalizedCandidates.includes(value));
    });
  }

  /**
   * Normalizes an office lookup value.
   * @param {any} value Raw office lookup value.
   */
  private normalizeIvyTekOfficeLookupValue(value: any): string {
    return (value ?? '').toString().trim().replace(/\s+/g, '').toLowerCase();
  }

  /**
   * Returns source dates unchanged so historical imports never clamp to office-opening dates.
   * @param {Date | null} date Candidate import date.
   * @param {any} row Optional IvyTek source row.
   */
  private getIvyTekOfficeSafeDate(date: Date | null, row: any = null): Date | null {
    return date;
  }

  /**
   * Gets the earliest valid date from candidate values.
   * @param {string[]} values Date values.
   */
  private getEarliestIvyTekDate(values: string[]): Date | null {
    return values.reduce((earliestDate: Date | null, value: string) => {
      const parsedDate = this.parseIvyTekDate(value);
      if (!parsedDate) {
        return earliestDate;
      }
      return !earliestDate || parsedDate < earliestDate ? parsedDate : earliestDate;
    }, null);
  }

  /**
   * Gets the IvyTek tribal entity identifier from a CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekEntityId(row: any): string {
    return (
      this.getFirstIvyTekValidEntityId(row, [
        'IvyTekClientEntityID',
        'WS_EntityID__c',
        'source.WS_EntityID__c',
        'WS EntityID',
        'WS Entity ID',
        'IvytekTestPkg__WS_EntityID__c',
        'IvytekTestPkg__WS_Entity_ID__c',
        'matched_contact_entity_id',
        'EntityID',
        'entityid',
        'Entity Id',
        'entity_id',
        'client_entity_id',
        'Tribal Entity ID',
        'TribalEntityID'
      ]) || this.getIvyTekEntityIdFromName(row)
    );
  }

  /**
   * Gets the first value that fits the Client Tribal Data EntityID column.
   * @param {any} row IvyTek CSV row.
   * @param {string[]} keys Candidate CSV field keys.
   */
  private getFirstIvyTekValidEntityId(row: any, keys: string[]): string {
    for (const key of keys) {
      const entityId = this.normalizeIvyTekEntityId(this.getCsvValue(row, key));
      if (entityId) {
        return entityId;
      }
    }
    return '';
  }

  /**
   * Gets the tribal entity id from helper names like "Jane Doe(123)".
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekEntityIdFromName(row: any): string {
    return this.getFirstIvyTekValidEntityId(row, [
      'Client/Group Name*',
      'Client Name',
      'template_client_name',
      'written_client_group_name_col_C',
      'written_helper_client_name_col_AR'
    ]);
  }

  /**
   * Normalizes a candidate tribal entity id and rejects long IvyTek hash/external id values.
   * @param {string} value Candidate entity id.
   */
  private normalizeIvyTekEntityId(value: string): string {
    if (!value) {
      return '';
    }
    const cleanedValue = value.replace(/\.0+$/, '');
    const parenthesizedEntityId = cleanedValue.match(/\((\d{1,10})\)\s*$/);
    if (parenthesizedEntityId) {
      return parenthesizedEntityId[1];
    }
    return /^[A-Za-z0-9-]{1,10}$/.test(cleanedValue) ? cleanedValue : '';
  }

  /**
   * Gets a valid SSN from common IvyTek/contact columns.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekSsn(row: any): string {
    const ssn = this.getFirstCsvValue(row, [
      'SSN',
      'Social Security Number',
      'SocialSecurityNumber',
      'TaxID',
      'TIN',
      'IvytekTestPkg__SSN__c',
      'IvytekTestPkg__Social_Security_Number__c'
    ]);
    const digits = ssn.replace(/\D/g, '');
    if (digits.length !== 9 || /^0+$/.test(digits)) {
      return '';
    }
    return ssn;
  }

  /**
   * Finds a document type by likely names.
   * @param {any[]} documentTypes Allowed document types.
   * @param {string[]} names Candidate names.
   */
  private findIvyTekDocumentType(documentTypes: any[], names: string[]) {
    const normalizedNames = names.map((name: string) => this.normalizeIvyTekText(name));
    return documentTypes.find((documentType: any) => {
      const documentTypeNames = [
        documentType.name,
        documentType.value,
        documentType.code
      ].map((name: string) => this.normalizeIvyTekText(name));
      return documentTypeNames.some((name: string) => normalizedNames.includes(name));
    });
  }

  /**
   * Checks if a client identifier already exists.
   * @param {any[]} identifiers Existing identifiers.
   * @param {any} documentTypeId Document type id.
   * @param {string} documentKey Document key.
   */
  private hasIvyTekClientIdentifier(identifiers: any[], documentTypeId: any, documentKey: string) {
    const normalizedDocumentKey = this.normalizeIvyTekText(documentKey);
    return identifiers.some((identifier: any) => {
      const identifierDocumentTypeId = identifier.documentTypeId || identifier.documentType?.id;
      return (
        identifierDocumentTypeId?.toString() === documentTypeId.toString() &&
        this.normalizeIvyTekText(identifier.documentKey) === normalizedDocumentKey
      );
    });
  }

  /**
   * Checks whether an identifier add failed because it already exists.
   * @param {any} error API error.
   */
  private isIvyTekDuplicateIdentifierError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      message.includes('already exists') ||
      message.includes('already registered') ||
      message.includes('already has') ||
      message.includes('unique key')
    );
  }

  /**
   * Finds an option id by likely names.
   * @param {any[]} options Template options.
   * @param {string[]} names Candidate names.
   */
  private findIvyTekOptionId(options: any[], names: string[]) {
    const normalizedNames = names
      .map((name: string) => this.normalizeIvyTekText(name))
      .filter((name: string) => !!name);
    if (!normalizedNames.length) {
      return options[0]?.id || '';
    }

    const exactOption = options.find((templateOption: any) => {
      const optionNames = [
        templateOption.name,
        templateOption.value,
        templateOption.code,
        templateOption.description
      ].map((name: string) => this.normalizeIvyTekText(name));
      return optionNames.some((name: string) => normalizedNames.includes(name));
    });
    if (exactOption?.id !== undefined && exactOption?.id !== null) {
      return exactOption.id;
    }

    const looseOption = options.find((templateOption: any) => {
      const optionNames = [
        templateOption.name,
        templateOption.value,
        templateOption.code,
        templateOption.description
      ]
        .map((name: string) => this.normalizeIvyTekText(name))
        .filter((name: string) => !!name);
      return optionNames.some((optionName: string) =>
        normalizedNames.some((candidate: string) => {
          const canUseLooseMatch = /^\d+$/.test(candidate) ? candidate.length >= 3 : candidate.length >= 3;
          return canUseLooseMatch && (optionName.includes(candidate) || candidate.includes(optionName));
        })
      );
    });
    return looseOption?.id !== undefined && looseOption?.id !== null ? looseOption.id : '';
  }

  /**
   * Formats Mifos option names for diagnostics.
   * @param {any[]} options Template options.
   */
  private getIvyTekOptionListForMessage(options: any[]) {
    if (!options?.length) {
      return 'none returned by template';
    }
    return options
      .map((option: any) => {
        const names = [
          option.name,
          option.value,
          option.code,
          option.description
        ].filter((name: string) => !!name);
        return names.length ? `${option.id ?? '(no id)'}:${names.join('/')}` : `${option.id ?? '(no id)'}`;
      })
      .join(', ');
  }

  /**
   * Gets the display name from a CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekDisplayName(row: any): string {
    return [
      this.getIvyTekFirstName(row),
      this.getIvyTekMiddleName(row),
      this.getIvyTekLastName(row)
    ]
      .filter((namePart: string) => !!namePart)
      .join(' ');
  }

  /**
   * Gets the IvyTek first name from direct contact fields or a full-name helper field.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekFirstName(row: any): string {
    return (
      this.getFirstCsvValue(row, [
        'FirstName',
        'First Name',
        'firstname',
        'first_name',
        'IvytekTestPkg__First_Name__c',
        'IvytekTestPkg__ACH_First_Name__c'
      ]) || this.getIvyTekParsedName(row).firstName
    );
  }

  /**
   * Gets the IvyTek middle name from direct contact fields or a full-name helper field.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekMiddleName(row: any): string {
    return (
      this.getFirstCsvValue(row, [
        'MiddleName',
        'Middle Name',
        'middlename',
        'middle_name',
        'IvytekTestPkg__Middle_Name__c'
      ]) || this.getIvyTekParsedName(row).middleName
    );
  }

  /**
   * Gets the IvyTek last name, preserving the Salesforce suffix from the legacy import mapping.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekLastName(row: any): string {
    const lastName =
      this.getFirstCsvValue(row, [
        'LastName',
        'Last Name',
        'lastname',
        'last_name',
        'IvytekTestPkg__Last_Name__c',
        'IvytekTestPkg__ACH_Last_Name__c'
      ]) || this.getIvyTekParsedName(row).lastName;
    return [
      lastName,
      this.getCsvValue(row, 'Suffix')
    ]
      .filter((namePart: string) => !!namePart)
      .join(' ');
  }

  /**
   * Gets a parsed name from IvyTek full-name helper fields.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekParsedName(row: any) {
    const fullName = this.getIvyTekFullName(row);
    if (!fullName) {
      return { firstName: '', middleName: '', lastName: '' };
    }

    if (fullName.includes(',')) {
      const [
        lastName,
        givenNames = ''
      ] = fullName.split(',', 2).map((namePart: string) => namePart.trim());
      const givenNameParts = givenNames.split(/\s+/).filter((namePart: string) => !!namePart);
      return {
        firstName: givenNameParts.shift() || '',
        middleName: givenNameParts.join(' '),
        lastName
      };
    }

    const nameParts = fullName.split(/\s+/).filter((namePart: string) => !!namePart);
    if (nameParts.length === 1) {
      return { firstName: nameParts[0], middleName: '', lastName: '' };
    }

    const firstName = nameParts.shift() || '';
    const lastName = nameParts.pop() || '';
    return {
      firstName,
      middleName: nameParts.join(' '),
      lastName
    };
  }

  /**
   * Gets a full client name from IvyTek helper fields.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekFullName(row: any): string {
    const helperName = this.getIvyTekCustomerNameCandidates(row)[0];
    if (helperName) {
      return helperName;
    }

    const salesforceName = this.getCsvValue(row, 'Name');
    return /^(CA|Contract)-\d+$/i.test(salesforceName) ? '' : salesforceName;
  }

  /**
   * Gets borrower/customer name candidates from the IvyTek loan and application exports.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekCustomerNameCandidates(row: any): string[] {
    return this.getUniqueIvyTekIdentifiers([
      this.getCsvValue(row, 'IvytekTestPkg__Customer_Name_Text__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Customer_Name__c'),
      this.getCsvValue(row, 'IvyTestPkg__Customer_Name__c'),
      this.getCsvValue(row, 'Customer_Name_Text__c'),
      this.getCsvValue(row, 'Customer_Name__c'),
      this.getCsvValue(row, 'Customer Name Text'),
      this.getCsvValue(row, 'Customer Name'),
      this.getCsvValue(row, 'customer_name'),
      this.getCsvValue(row, 'IvytekTestPkg__Borrower_Name_Text__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Borrower_Name__c'),
      this.getCsvValue(row, 'Borrower_Name_Text__c'),
      this.getCsvValue(row, 'Borrower_Name__c'),
      this.getCsvValue(row, 'Borrower Name Text'),
      this.getCsvValue(row, 'Borrower Name')
    ]);
  }

  /**
   * Checks whether a CSV row has enough data to become a client payload.
   * @param {any} row IvyTek CSV row.
   */
  private validateIvyTekClientData(row: any) {
    if (!this.getIvyTekExternalId(row)) {
      throw new Error('IvyTek External ID is required. Check IvytekTestPkg__ExternalID__c, sf_contact_id, or Id.');
    }
    if (!this.getIvyTekFirstName(row)) {
      throw new Error('First name is required.');
    }
    if (!this.getIvyTekLastName(row)) {
      throw new Error('Last name is required.');
    }
  }

  /**
   * Gets IvyTek loan import results for a status.
   * @param {string} status Result status.
   */
  getIvyTekLoanResultsByStatus(status: string) {
    return this.ivyTekLoanImportResults.filter((result: any) => result.status === status);
  }

  /**
   * Creates an IvyTek loan result view model.
   * @param {any} row IvyTek loan row.
   */
  private createIvyTekLoanResult(row: any) {
    return {
      name: this.getIvyTekCustomerNameCandidates(row)[0] || this.getCsvValue(row, 'Name'),
      externalId: this.getIvyTekLoanExternalId(row),
      legacyLoanId: this.getIvyTekLegacyLoanId(row),
      row,
      loanId: '',
      mappedValues: {},
      importedValues: {} as any,
      validationValues: {} as any,
      status: '',
      message: ''
    };
  }

  /**
   * Records whether Tribal Loan Data was written for a loan result.
   * @param {any} result IvyTek loan result.
   * @param {boolean} updated Whether the datatable was saved.
   */
  private setIvyTekLoanTribalResult(result: any, updated: boolean) {
    result.mappedValues = {
      ...result.mappedValues,
      tribalLoanData: updated ? 'Updated' : ''
    };
  }

  /**
   * Updates an IvyTek loan result status.
   * @param {any} result IvyTek loan result.
   * @param {string} status Status translation key.
   * @param {string} message Optional failure message.
   */
  private setIvyTekLoanResultStatus(result: any, status: string, message: string = '') {
    result.status = status;
    result.message = message;
  }

  /**
   * Gets IvyTek transaction import results for a status.
   * @param {string} status Result status.
   */
  getIvyTekTransactionResultsByStatus(status: string) {
    return this.ivyTekTransactionImportResults.filter((result: any) => result.status === status);
  }

  /**
   * Gets the display count for a transaction result group.
   * @param {string} status Result status.
   */
  getIvyTekTransactionResultGroupCount(status: string) {
    if (status !== 'labels.inputs.Ready') {
      return this.getIvyTekTransactionResultsByStatus(status).length;
    }
    const summary = this.ivyTekTransactionImportResults.find((result: any) => result.transactionSummary);
    return summary?.readyCount ?? this.getIvyTekTransactionResultsByStatus(status).length;
  }

  /**
   * Validates one IvyTek transaction row against the loan source bridge.
   * @param {any} row IvyTek transaction row.
   * @param {Map<string, any>} bridgeRowsByLoanId loan source bridge rows keyed by Salesforce loan id.
   */
  public validateIvyTekTransaction(row: any, bridgeRowsByLoanId: Map<string, any>) {
    const result = this.createIvyTekTransactionResult(row, bridgeRowsByLoanId);
    const amount = this.parseIvyTekDecimal(result.amount);

    if (!result.sfLoanId && !result.legacyLoanId) {
      this.setIvyTekTransactionResultStatus(result, 'labels.inputs.Failed', 'Missing loan id.');
    } else if (!result.legacyLoanId) {
      this.setIvyTekTransactionResultStatus(
        result,
        this.shouldUseIvyTekStaticLoanSnapshot() ? 'labels.inputs.Failed' : 'labels.inputs.Skipped',
        'No bridge row was found for the Salesforce loan id.'
      );
    } else {
      result.historicalIgnored = !this.isIvyTekHistoricalRepaymentTransaction(row);
      if (amount === null) {
        result.validationValues.sqlHistoryAmountWarning =
          'Missing transaction amount; the raw source row is still preserved for SQL history import.';
      }
      if (!result.transactionDate) {
        result.validationValues.sqlHistoryDateWarning =
          'Missing transaction date; the raw source row is still preserved for SQL history import.';
      }
      this.setIvyTekTransactionResultStatus(result, 'labels.inputs.Ready');
    }

    return result;
  }

  /**
   * Creates an IvyTek transaction result view model.
   * @param {any} row IvyTek transaction row.
   * @param {Map<string, any>} bridgeRowsByLoanId loan source bridge rows keyed by Salesforce loan id.
   */
  private createIvyTekTransactionResult(row: any, bridgeRowsByLoanId: Map<string, any>) {
    const sfLoanId = this.getIvyTekTransactionLoanId(row);
    const bridgeRow = this.getSalesforceIdKeys(sfLoanId)
      .map((loanId: string) => bridgeRowsByLoanId.get(loanId))
      .find((match: any) => !!match);
    const legacyLoanId = this.getIvyTekLegacyLoanId(bridgeRow || row);
    const bridgePrincipal = this.getIvyTekLoanPrincipal(bridgeRow || {});

    return {
      name:
        this.getCsvValue(row, 'Name') ||
        this.getCsvValue(row, 'legacy_history_id') ||
        this.getCsvValue(row, 'legacy_description') ||
        this.getCsvValue(row, 'IvytekTestPkg__Description__c'),
      sfLoanId,
      legacyLoanId,
      externalId: legacyLoanId ? `loan_${legacyLoanId}` : '',
      transactionDate: this.getIvyTekTransactionDate(row),
      amount: this.getIvyTekTransactionAmount(row),
      historicalOnly: true,
      historicalIgnored: false,
      historicalDisbursement: this.isIvyTekHistoricalDisbursementTransaction(row, bridgePrincipal),
      mappedValues: this.getIvyTekTransactionMappedValues(row, bridgeRow),
      importedValues: {} as any,
      validationValues: {} as any,
      row,
      status: '',
      message: ''
    };
  }

  /**
   * Gets transaction values preserved for historical import/export.
   * @param {any} row IvyTek transaction row.
   * @param {any} bridgeRow Matched loan bridge row.
   */
  private getIvyTekTransactionMappedValues(row: any, bridgeRow: any) {
    const isHistoricalRepayment = this.isIvyTekHistoricalRepaymentTransaction(row);
    const isHistoricalDisbursement = this.isIvyTekHistoricalDisbursementTransaction(
      row,
      this.getIvyTekLoanPrincipal(bridgeRow || {})
    );
    return {
      sourceTransactionId: this.getCsvValue(row, 'Id'),
      sourceExternalId: this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c'),
      sourceLoanId: this.getIvyTekTransactionLoanId(row),
      legacyLoanId: this.getIvyTekLegacyLoanId(bridgeRow || row),
      transactionDate: this.getIvyTekTransactionDate(row),
      amountPaid: this.getIvyTekTransactionAmount(row),
      principalPaid: this.getIvyTekTransactionPrincipalPaid(row) ?? '',
      interestPaid: this.getIvyTekTransactionInterestPaid(row) ?? '',
      paymentType: this.resolveIvyTekMifosPaymentType(
        this.getCsvValue(row, 'IvytekTestPkg__TypPay__c'),
        this.getCsvValue(row, 'IvytekTestPkg__Description__c')
      ),
      specialTransCode: this.getCsvValue(row, 'IvytekTestPkg__SpecialTransCode__c'),
      description: this.getCsvValue(row, 'IvytekTestPkg__Description__c'),
      restHistoricalImport: 'No - SQL backend history import',
      sqlTransactionHistoryImport: 'Pending SQL backend load',
      sqlTransactionHistoryTable: this.ivyTekSqlTransactionHistoryTableName,
      sqlTransactionHistoryType: isHistoricalRepayment
        ? 'Repayment history'
        : isHistoricalDisbursement
          ? 'Legacy disbursement marker'
          : 'Source transaction history',
      requiresSqlImport: 'SQL backend transaction history',
      restSkipReason: this.getIvyTekHistoricalTransactionSkipReason(row, bridgeRow)
    };
  }

  /**
   * Gets the reason a transaction is stored as static history instead of a live Fineract transaction.
   * @param {any} row IvyTek transaction row.
   * @param {any} bridgeRow Matched loan bridge row.
   */
  private getIvyTekStaticTransactionHistoryReason(row: any, bridgeRow: any) {
    if (this.isIvyTekHistoricalDisbursementTransaction(row, this.getIvyTekLoanPrincipal(bridgeRow || {}))) {
      return 'Stored as static IvyTek transaction history; the Mifos loan disbursement command represents the live disbursement.';
    }
    if (this.isIvyTekHistoricalRepaymentTransaction(row)) {
      return 'Stored as static IvyTek transaction history instead of posting through Fineract repayment automation.';
    }
    return 'Stored as static IvyTek transaction history for audit; not posted as a live Fineract repayment.';
  }

  /**
   * Creates a summary row for successful historical transaction validation.
   * @param {number} totalCount Total transaction rows.
   * @param {number} readyCount Ready transaction rows.
   * @param {number} reviewCount Transaction rows needing review.
   * @param {number} ignoredCount Non-repayment transaction rows preserved as SQL history.
   * @param {number} disbursementCount Legacy negative disbursement marker rows.
   */
  private createIvyTekTransactionSummaryResult(
    totalCount: number,
    readyCount: number,
    reviewCount: number,
    ignoredCount: number,
    disbursementCount: number,
    sqlReadyCount: number = 0,
    restSuppressedCount: number = 0
  ) {
    const readyMessage = `${readyCount} of ${totalCount} transaction rows were prepared for SQL-backend transaction history import; ${sqlReadyCount} rows have a matched Mifos loan id.`;
    const postingMessage = `${restSuppressedCount} rows were not posted through REST, so Fineract repayment/disbursement automation cannot change loan balances. ${ignoredCount} non-repayment or marker rows are still preserved as SQL history, including ${disbursementCount} legacy negative disbursement marker rows.`;
    return {
      name: 'Historical transaction validation summary',
      sfLoanId: '',
      legacyLoanId: '',
      externalId: '',
      transactionDate: '',
      amount: readyCount.toString(),
      historicalOnly: true,
      totalCount,
      readyCount,
      reviewCount,
      sqlReadyCount,
      restSuppressedCount,
      transactionSummary: true,
      row: {},
      status: 'labels.inputs.Ready',
      message: `${readyMessage} ${postingMessage} ${reviewCount} rows need manual review before exact historical import. Ready rows are summarized on screen but exported individually.`
    };
  }

  /**
   * Updates an IvyTek transaction result status.
   * @param {any} result IvyTek transaction result.
   * @param {string} status Status translation key.
   * @param {string} message Optional failure message.
   */
  private setIvyTekTransactionResultStatus(result: any, status: string, message: string = '') {
    result.status = status;
    result.message = message;
  }

  /**
   * Gets the Salesforce loan id from an IvyTek transaction row.
   * @param {any} row IvyTek transaction row.
   */
  private getIvyTekTransactionLoanId(row: any): string {
    return (
      this.getCsvValue(row, 'sf_loan_id') ||
      this.getCsvValue(row, 'IvytekTestPkg__LoanID__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__Loan__c') ||
      this.getCsvValue(row, 'loan_id')
    );
  }

  /**
   * Gets the transaction date from common IvyTek transaction staging columns.
   * @param {any} row IvyTek transaction row.
   */
  private getIvyTekTransactionDate(row: any): string {
    return this.getIvyTekTransactionPaymentDate(row);
  }

  /**
   * Gets the payment/effective date from common IvyTek transaction staging columns.
   * @param {any} row IvyTek transaction row.
   */
  private getIvyTekTransactionPaymentDate(row: any): string {
    const rawDate =
      this.getCsvValue(row, 'transaction_date') ||
      this.getCsvValue(row, 'IvytekTestPkg__Transaction_Date__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__Day_Paid__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__DayPaid__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__DayPosted__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__DatePaid__c') ||
      this.getCsvValue(row, 'DatePaid') ||
      this.getCsvValue(row, 'Date Paid') ||
      this.getCsvValue(row, 'IvytekTestPkg__DateLastPaid__c') ||
      this.getCsvValue(row, 'Date Last Paid');
    return this.formatIvyTekDateValue(rawDate) || rawDate;
  }

  /**
   * Gets the selected transaction amount from common IvyTek transaction staging columns.
   * @param {any} row IvyTek transaction row.
   */
  private getIvyTekTransactionAmount(row: any): string {
    return (
      this.getCsvValue(row, 'selected_amount') ||
      this.getCsvValue(row, 'amount_paid') ||
      this.getCsvValue(row, 'component_total') ||
      this.getCsvValue(row, 'IvytekTestPkg__AmountPaid__c')
    );
  }

  /**
   * Gets the principal component from IvyTek transaction history.
   * @param {any} row IvyTek transaction row.
   */
  private getIvyTekTransactionPrincipalPaid(row: any): number | null {
    return this.getFirstIvyTekDecimal(row, [
      'principal_paid',
      'principle_paid',
      'IvytekTestPkg__PrinciplePaid__c',
      'IvytekTestPkg__PrincipalPaid__c',
      'Principal Paid',
      'Principle Paid'
    ]);
  }

  /**
   * Gets the interest component from IvyTek transaction history.
   * @param {any} row IvyTek transaction row.
   */
  private getIvyTekTransactionInterestPaid(row: any): number | null {
    const interestFields = [
      [
        'interest_paid',
        'IvytekTestPkg__InterestPaid__c',
        'Interest Paid'
      ],
      [
        'back_interest_paid',
        'IvytekTestPkg__BackInterestPaid__c',
        'Back Interest Paid'
      ],
      [
        'deferred_interest_paid',
        'IvytekTestPkg__DeferredInterestPaid__c',
        'Deferred Interest Paid'
      ]
    ];
    const values = interestFields
      .map((fields: string[]) => this.getFirstIvyTekDecimal(row, fields))
      .filter((value: number | null) => value !== null) as number[];
    if (!values.length) {
      return null;
    }
    return this.roundIvyTekMoney(values.reduce((total: number, value: number) => total + value, 0));
  }

  /**
   * Checks whether an IvyTek transaction row should be ignored.
   * @param {any} row IvyTek transaction row.
   */
  private isIvyTekVoidedTransaction(row: any): boolean {
    return (
      this.parseIvyTekBoolean(this.getCsvValue(row, 'IvytekTestPkg__Voided_Transaction__c')) === true ||
      this.parseIvyTekBoolean(this.getCsvValue(row, 'Voided')) === true ||
      this.parseIvyTekBoolean(this.getCsvValue(row, 'voided')) === true ||
      this.parseIvyTekBoolean(this.getCsvValue(row, 'reversed')) === true ||
      this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__TypPay__c')) === 'void' ||
      this.getCsvValue(row, 'IvytekTestPkg__SpecialTransCode__c') === '2'
    );
  }

  /**
   * Checks whether an IvyTek transaction row is a repayment row that should be posted.
   * @param {any} row IvyTek transaction row.
   */
  private isIvyTekHistoricalRepaymentTransaction(row: any): boolean {
    const amount = this.parseIvyTekDecimal(this.getIvyTekTransactionAmount(row));
    if (amount === null || amount <= 0 || this.isIvyTekVoidedTransaction(row)) {
      return false;
    }

    const paymentType = this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__TypPay__c'));
    const specialCode = this.getCsvValue(row, 'IvytekTestPkg__SpecialTransCode__c');
    const ignoredPaymentTypes = [
      'informational',
      'charge',
      'bookaccruedinterest'
    ];
    const ignoredSpecialCodes = [
      '1',
      '99'
    ];
    return !ignoredPaymentTypes.includes(paymentType) && !ignoredSpecialCodes.includes(specialCode);
  }

  /**
   * Explains why a transaction row will not be posted through the repayment REST command.
   * @param {any} row IvyTek transaction row.
   * @param {any} bridgeRow Matched loan bridge row.
   */
  private getIvyTekHistoricalTransactionSkipReason(row: any, bridgeRow: any): string {
    if (this.isIvyTekHistoricalRepaymentTransaction(row)) {
      return '';
    }

    const amount = this.parseIvyTekDecimal(this.getIvyTekTransactionAmount(row));
    const bridgePrincipal = this.getIvyTekLoanPrincipal(bridgeRow || {});
    const paymentType = this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__TypPay__c'));
    const specialCode = this.getCsvValue(row, 'IvytekTestPkg__SpecialTransCode__c');

    if (amount === null) {
      return 'Missing transaction amount; no exact REST transaction can be posted.';
    }
    if (this.isIvyTekVoidedTransaction(row)) {
      return 'Voided or reversed IvyTek row; preserved for audit and not posted as historical repayment.';
    }
    if (this.isIvyTekHistoricalDisbursementTransaction(row, bridgePrincipal)) {
      return 'Legacy negative disbursement marker; the Mifos loan disbursement command creates the disbursement transaction.';
    }
    if (amount < 0) {
      return 'Negative non-disbursement transaction; preserved for review because REST repayment cannot post a negative historical payment.';
    }
    if (amount === 0) {
      return 'Zero-amount transaction row; preserved for audit and not posted as historical repayment.';
    }
    if (paymentType === 'informational') {
      return 'Informational IvyTek row; preserved for audit and not posted as historical repayment.';
    }
    if (paymentType === 'charge') {
      return 'Charge row; preserved for review because loan charges must be mapped separately from repayment posting.';
    }
    if (paymentType === 'bookaccruedinterest') {
      return 'Book accrued interest row; preserved for review because generated Mifos interest is aligned from the loan snapshot.';
    }
    if (specialCode === '1') {
      return 'Special transaction code 1 is not a repayment command; preserved for review.';
    }
    if (specialCode === '99') {
      return 'Special transaction code 99 is informational/non-posting history; preserved for audit.';
    }
    return 'Not classified as a positive historical repayment command; preserved for review.';
  }

  /**
   * Checks whether an IvyTek transaction row is the legacy negative disbursement marker.
   * @param {any} row IvyTek transaction row.
   * @param {number | null} principal IvyTek loan principal.
   */
  private isIvyTekHistoricalDisbursementTransaction(row: any, principal: number | null = null): boolean {
    const amount = this.parseIvyTekDecimal(this.getIvyTekTransactionAmount(row));
    return (
      amount !== null && amount < 0 && principal !== null && this.areIvyTekMoneyValuesEqual(Math.abs(amount), principal)
    );
  }

  /**
   * Builds loan products by normalized product name.
   * @param {any[]} products Loan product rows.
   */
  private buildIvyTekLoanProductsByName(products: any[]): Map<string, any> {
    const productsByName = new Map<string, any>();
    products.forEach((product: any) => {
      [
        product.name,
        product.shortName,
        product.externalId
      ].forEach((name: string) => {
        const key = this.normalizeIvyTekText(name);
        if (key) {
          productsByName.set(key, product);
        }
      });
    });
    return productsByName;
  }

  /**
   * Finds the configured Mifos product for an IvyTek loan group.
   * Always returns the Personal Loan product regardless of group.
   * @param {string} group IvyTek loan group.
   * @param {Map<string, any>} productsByName Loan products keyed by normalized name.
   */
  private findIvyTekLoanProductByGroup(group: string, productsByName: Map<string, any>) {
    return productsByName.get(this.normalizeIvyTekText('Personal Loan')) || null;
  }

  /**
   * Gets possible Mifos product names for an IvyTek loan group.
   * @param {string} group IvyTek loan group.
   */
  private getIvyTekProductNameCandidates(group: string): string[] {
    const normalizedGroup = this.normalizeIvyTekLoanGroup(group);
    const numericGroup = this.getIvyTekLoanGroupNumber(normalizedGroup);
    const paddedNumericGroup = this.getIvyTekLoanGroupDigits(normalizedGroup).padStart(3, '0');
    const candidates = [
      this.getIvyTekProductLookupOverride(normalizedGroup),
      this.getIvyTekProductName(group),
      this.getIvyTekProductName(normalizedGroup),
      group,
      normalizedGroup
    ];

    if (numericGroup) {
      candidates.push(
        numericGroup,
        paddedNumericGroup,
        `G${numericGroup}`,
        `G${paddedNumericGroup}`,
        `P${numericGroup}`,
        `P${paddedNumericGroup}`,
        `M${numericGroup}`,
        `M${paddedNumericGroup}`,
        ...this.getIvyTekProductExternalIdCandidates(group)
      );
    }

    return Array.from(new Set(candidates.filter((candidate: string) => !!candidate)));
  }

  /**
   * Gets generated Mifos product external ids for an IvyTek loan group.
   * @param {string} group IvyTek loan group.
   */
  private getIvyTekProductExternalIdCandidates(group: string): string[] {
    const normalizedGroup = this.normalizeIvyTekLoanGroup(group);
    const groupDigits = this.getIvyTekLoanGroupDigits(normalizedGroup);
    const groupNumber = this.getIvyTekLoanGroupNumber(normalizedGroup);
    if (!groupNumber) {
      return [];
    }

    const groupValues = Array.from(
      new Set(
        [
          groupDigits.padStart(3, '0'),
          groupNumber
        ].filter((value: string) => !!value)
      )
    );
    const productNames = this.getUniqueIvyTekIdentifiers([
      this.getIvyTekProductName(group),
      this.getIvyTekProductName(normalizedGroup)
    ]);

    return productNames.flatMap((productName: string) =>
      this.getIvyTekProductExternalIdSlugs(productName).flatMap((slug: string) =>
        groupValues.map((groupValue: string) => `product_${slug}_${groupValue}`)
      )
    );
  }

  /**
   * Gets generated external-id slugs for a product name.
   * @param {string} productName Mifos product name.
   */
  private getIvyTekProductExternalIdSlugs(productName: string): string[] {
    const slugs = [
      this.slugIvyTekProductExternalId(productName),
      this.slugIvyTekProductExternalId(productName.replace(/\bloan\b/gi, ' '))
    ];
    return Array.from(new Set(slugs.filter((slug: string) => !!slug)));
  }

  /**
   * Converts a product name into the product external-id slug style used by the import.
   * @param {string} value Product name.
   */
  private slugIvyTekProductExternalId(value: string): string {
    return (value || '')
      .toString()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Finds one product whose configured field contains the same numeric group value.
   * @param {string} groupNumber Normalized IvyTek loan group number.
   * @param {any[]} products Loan products.
   * @param {string[]} fields Product fields to inspect.
   */
  private findIvyTekLoanProductByNumericValue(groupNumber: string, products: any[], fields: string[]) {
    const matches = products.filter((product: any) =>
      fields.some((field: string) => this.getIvyTekProductNumericValues(product?.[field]).includes(groupNumber))
    );
    return matches.length === 1 ? matches[0] : matches.find((product: any) => !!product?.id) || null;
  }

  /**
   * Gets normalized numeric values embedded in a product field.
   * @param {string} value Product field value.
   */
  private getIvyTekProductNumericValues(value: string): string[] {
    const rawValue = (value || '').toString().trim();
    const values = [
      this.getIvyTekLoanGroupNumber(rawValue),
      rawValue.length > 1 ? this.getIvyTekLoanGroupNumber(rawValue.substring(1)) : ''
    ];
    const numericTokens = rawValue.match(/\d+/g) || [];
    values.push(...numericTokens.map((token: string) => this.getIvyTekLoanGroupNumber(token)));
    return Array.from(new Set(values.filter((numericValue: string) => !!numericValue)));
  }

  /**
   * Gets the numeric loan group digits without leading-zero normalization.
   * @param {string} value Source loan group value.
   */
  private getIvyTekLoanGroupDigits(value: string): string {
    return (value || '').toString().replace(/\D/g, '');
  }

  /**
   * Gets the normalized numeric loan group value used for product matching.
   * @param {string} value Source loan group or product field value.
   */
  private getIvyTekLoanGroupNumber(value: string): string {
    const digits = this.getIvyTekLoanGroupDigits(value);
    if (!digits) {
      return '';
    }
    const normalizedNumber = Number(digits);
    return Number.isFinite(normalizedNumber) ? normalizedNumber.toString() : digits.replace(/^0+/, '') || '0';
  }

  /**
   * Gets selected loan-product metadata for result export and review.
   * @param {string} group IvyTek loan group.
   * @param {any} product Matched Mifos loan product.
   */
  private getIvyTekLoanProductMappedValues(group: string, product: any) {
    return {
      productId: product?.id || '',
      productShortName: product?.shortName || '',
      productExternalId: product?.externalId || '',
      productMatchGroupNumber: this.getIvyTekLoanGroupNumber(group),
      productMatchMethod: this.getIvyTekLoanProductMatchMethod(group, product)
    };
  }

  /**
   * Describes how a product matched the IvyTek loan group.
   * @param {string} group IvyTek loan group.
   * @param {any} product Matched Mifos loan product.
   */
  private getIvyTekLoanProductMatchMethod(group: string, product: any): string {
    if (!product) {
      return '';
    }
    const directCandidates = this.getIvyTekProductNameCandidates(group).map((candidate: string) =>
      this.normalizeIvyTekText(candidate)
    );
    if (directCandidates.includes(this.normalizeIvyTekText(product.externalId))) {
      return 'Product external ID';
    }
    if (directCandidates.includes(this.normalizeIvyTekText(product.shortName))) {
      return 'Product short name';
    }
    if (directCandidates.includes(this.normalizeIvyTekText(product.name))) {
      return 'Product name';
    }
    const groupNumber = this.getIvyTekLoanGroupNumber(group);
    if (this.getIvyTekProductNumericValues(product.shortName).includes(groupNumber)) {
      return 'Numeric short-name match';
    }
    if (this.getIvyTekProductNumericValues(product.externalId).includes(groupNumber)) {
      return 'Numeric external-id match';
    }
    if (this.getIvyTekProductNumericValues(product.name).includes(groupNumber)) {
      return 'Numeric product-name match';
    }
    return 'Matched product';
  }

  /**
   * Loads loan products across Fineract versions.
   */
  private async loadIvyTekLoanProducts(): Promise<any[]> {
    try {
      return this.normalizeIvyTekListResponse(await firstValueFrom(this.productsService.getLoanProductsBasicDetails()));
    } catch (error: any) {
      if (error?.status !== 404) {
        throw error;
      }
      return this.normalizeIvyTekListResponse(
        await firstValueFrom(this.productsService.getLoanProducts('loanproducts'))
      );
    }
  }

  /**
   * Gets configured charge option rows from a loan product response.
   * @param {any} productDetails Loan product details response.
   */
  private getIvyTekProductChargeOptions(productDetails: any): any[] {
    return [
      ...(productDetails?.chargeOptions || []),
      ...(productDetails?.charges || [])
    ];
  }

  /**
   * Normalizes Fineract list response shapes.
   * @param {any} response API response.
   */
  private normalizeIvyTekListResponse(response: any): any[] {
    if (Array.isArray(response)) {
      return response;
    }
    if (Array.isArray(response?.pageItems)) {
      return response.pageItems;
    }
    if (Array.isArray(response?.content)) {
      return response.content;
    }
    return [];
  }

  /**
   * Builds source rows by Salesforce loan id.
   * @param {any[]} rows CSV rows.
   */
  private buildIvyTekLoanRowsById(rows: any[]): Map<string, any> {
    const rowsById = new Map<string, any>();
    rows.forEach((row: any) => {
      [
        this.getCsvValue(row, 'Id'),
        this.getCsvValue(row, 'sf_loan_id'),
        this.getCsvValue(row, 'IvytekTestPkg__LoanID__c'),
        this.getCsvValue(row, 'IvytekTestPkg__Loan__c')
      ].forEach((sourceId: string) => {
        this.getSalesforceIdKeys(sourceId).forEach((id: string) => rowsById.set(id, row));
      });
    });
    return rowsById;
  }

  /**
   * Builds IvyTek transaction history rows by Salesforce loan id.
   * @param {any[]} rows IvyTek transaction rows.
   */
  private buildIvyTekTransactionRowsByLoanId(rows: any[]): Map<string, any[]> {
    const rowsByLoanId = new Map<string, any[]>();
    rows.forEach((row: any) => {
      this.getSalesforceIdKeys(this.getIvyTekTransactionLoanId(row)).forEach((loanId: string) => {
        const loanRows = rowsByLoanId.get(loanId) || [];
        loanRows.push(row);
        rowsByLoanId.set(loanId, loanRows);
      });
    });
    return rowsByLoanId;
  }

  /**
   * Gets transaction history rows for a source loan row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any[]>} transactionRowsByLoanId Transaction rows keyed by Salesforce loan id.
   */
  private getIvyTekLoanTransactionRows(row: any, transactionRowsByLoanId: Map<string, any[]>): any[] {
    const rows: any[] = [];
    this.getSalesforceIdKeys(this.getCsvValue(row, 'Id')).forEach((loanId: string) => {
      rows.push(...(transactionRowsByLoanId.get(loanId) || []));
    });
    return Array.from(new Set(rows));
  }

  /**
   * Builds payment totals from IvyTek transaction history.
   * @param {any[]} transactionRows IvyTek transaction rows for one loan.
   * @param {string} loanDateText Loan date in the active Mifos date format.
   */
  private getIvyTekHistoricalRepaymentSummary(
    transactionRows: any[],
    loanDateText: string = '',
    principal: number | null = null
  ) {
    const disbursementRows = transactionRows.filter((row: any) =>
      this.isIvyTekHistoricalDisbursementTransaction(row, principal)
    );
    const rows = transactionRows
      .filter((row: any) => this.isIvyTekHistoricalRepaymentTransaction(row))
      .map((row: any) => ({
        row,
        ...this.getIvyTekHistoricalRepaymentPostDate(row, loanDateText),
        amount: this.parseIvyTekDecimal(this.getIvyTekTransactionAmount(row)) || 0,
        principal: this.getIvyTekTransactionPrincipalPaid(row) || 0,
        interest: this.getIvyTekTransactionInterestPaid(row) || 0
      }))
      .filter((transaction: any) => transaction.amount > 0 && !!transaction.date)
      .sort((first: any, second: any) => {
        const firstDate = this.parseIvyTekDate(first.date)?.getTime() || 0;
        const secondDate = this.parseIvyTekDate(second.date)?.getTime() || 0;
        return (
          firstDate - secondDate ||
          this.getCsvValue(first.row, 'CreatedDate').localeCompare(this.getCsvValue(second.row, 'CreatedDate')) ||
          this.getCsvValue(first.row, 'Name').localeCompare(this.getCsvValue(second.row, 'Name'))
        );
      });

    const summary = rows.reduce(
      (totals: any, transaction: any) => {
        totals.totalAmount = this.roundIvyTekMoney(totals.totalAmount + transaction.amount);
        totals.principalPaid = this.roundIvyTekMoney(totals.principalPaid + transaction.principal);
        totals.interestPaid = this.roundIvyTekMoney(totals.interestPaid + transaction.interest);
        return totals;
      },
      {
        rows,
        count: rows.length,
        totalAmount: 0,
        principalPaid: 0,
        interestPaid: 0,
        disbursementCount: disbursementRows.length,
        ignoredCount: transactionRows.length - rows.length
      }
    );
    summary.firstDate = rows[0]?.date || '';
    summary.lastDate = rows[rows.length - 1]?.date || '';
    summary.adjustedDateCount = rows.filter((row: any) => row.dateAdjusted).length;
    return summary;
  }

  /**
   * Gets the Fineract-safe posting date for a historical repayment.
   * @param {any} row IvyTek transaction row.
   * @param {string} loanDateText Loan date in the active Mifos date format.
   */
  private getIvyTekHistoricalRepaymentPostDate(row: any, loanDateText: string = '') {
    const sourceDate = this.getIvyTekTransactionPaymentDate(row);
    const sourceDateValue = this.parseIvyTekDate(sourceDate);
    const loanDateValue = this.parseIvyTekDate(loanDateText);
    if (sourceDateValue && loanDateValue && sourceDateValue < loanDateValue) {
      return {
        sourceDate,
        date: loanDateText,
        dateAdjusted: true
      };
    }
    return {
      sourceDate,
      date: sourceDate,
      dateAdjusted: false
    };
  }

  /**
   * Gets mapped historical repayment totals for review and CSV export.
   * @param {any} summary Historical repayment summary.
   */
  private getIvyTekHistoricalRepaymentMappedValues(summary: any) {
    return {
      historicalTransactionCount: summary?.count || '',
      historicalTransactionAmountPaid: summary?.count ? summary.totalAmount : '',
      historicalTransactionPrincipalPaid: summary?.count ? summary.principalPaid : '',
      historicalTransactionInterestPaid: summary?.count ? summary.interestPaid : '',
      historicalTransactionFirstDate: summary?.firstDate || '',
      historicalTransactionLastDate: summary?.lastDate || '',
      historicalDisbursementTransactionCount: summary?.disbursementCount || '',
      historicalTransactionIgnoredCount: summary?.ignoredCount || '',
      historicalTransactionDateAdjustments: summary?.adjustedDateCount || ''
    };
  }

  /**
   * Checks whether IvyTek source snapshots should be treated as static imported truth.
   */
  private shouldUseIvyTekStaticLoanSnapshot(): boolean {
    return this.ivyTekStaticSnapshotImport;
  }

  /**
   * Checks whether Stage 3 should post IvyTek historical repayment rows as Fineract loan transactions.
   */
  private shouldPostIvyTekTransactionsInStage3(): boolean {
    return false;
  }

  /**
   * Checks whether historical repayment rows should drive the active loan migration.
   * @param {any} summary Historical repayment summary.
   */
  private shouldPostIvyTekHistoricalRepayments(summary: any): boolean {
    return (
      (this.ivyTekHistoryStartImport || !this.shouldUseIvyTekStaticLoanSnapshot()) &&
      !!summary?.count &&
      summary.totalAmount > 0 &&
      this.ivyTekPostHistoricalRepaymentsToFineract
    );
  }

  /**
   * Builds source Contact rows by every stable contact identifier available.
   * @param {any[]} rows Contact CSV rows.
   */
  private buildIvyTekContactRowsById(rows: any[]): Map<string, any> {
    const rowsById = new Map<string, any>();
    rows
      .filter((row: any) => this.isIvyTekContactRow(row))
      .forEach((row: any) => {
        [
          this.getIvyTekContactSourceId(row),
          this.getIvyTekContactExternalId(row),
          this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c'),
          this.getIvyTekEntityId(row)
        ].forEach((identifier: string) => {
          this.getIvyTekIdentifierLookupKeys(identifier).forEach((key: string) => rowsById.set(key, row));
        });
      });
    return rowsById;
  }

  /**
   * Builds source Contact rows by strict and middle-initial-tolerant name keys.
   * @param {any[]} rows Contact CSV rows.
   */
  private buildIvyTekContactRowsByName(rows: any[]): Map<string, any[]> {
    const rowsByName = new Map<string, any[]>();
    rows
      .filter((row: any) => this.isIvyTekContactRow(row))
      .forEach((row: any) => {
        const name = this.getIvyTekDisplayName(row);
        [
          `exact:${this.normalizeIvyTekSourceContactName(name)}`,
          `strict:${this.normalizeIvyTekName(name)}`,
          `loose:${this.normalizeIvyTekNameWithoutMiddleInitials(name)}`
        ].forEach((key: string) => {
          if (!key.split(':')[1]) {
            return;
          }
          rowsByName.set(key, [
            ...(rowsByName.get(key) || []),
            row
          ]);
        });
      });
    return rowsByName;
  }

  /**
   * Builds contact application rows by source id.
   * @param {any[]} rows Contact application rows.
   */
  private buildIvyTekContactApplicationRowsById(rows: any[]): Map<string, any> {
    const rowsById = new Map<string, any>();
    rows.forEach((row: any) => {
      [
        this.getCsvValue(row, 'Id'),
        this.getCsvValue(row, 'IvytekTestPkg__ContactApplication__c'),
        this.getCsvValue(row, 'ContactApplicationId'),
        this.getCsvValue(row, 'ContactApplicationID')
      ].forEach((identifier: string) => {
        this.getIvyTekIdentifierLookupKeys(identifier).forEach((key: string) => rowsById.set(key, row));
      });
    });
    return rowsById;
  }

  /**
   * Builds Borrower contact applications by loan, application, and external ids.
   * @param {any[]} rows Contact application rows.
   */
  private buildIvyTekContactApplicationsByLoanId(rows: any[]): Map<string, any[]> {
    const rowsByLoanId = new Map<string, any[]>();
    rows
      .filter((row: any) => {
        const referenceType = this.normalizeIvyTekText(
          this.getCsvValue(row, 'IvytekTestPkg__ReferenceType__c') || this.getCsvValue(row, 'ReferenceType')
        );
        return !referenceType || referenceType === 'borrower';
      })
      .forEach((row: any) => {
        [
          this.getCsvValue(row, 'IvytekTestPkg__Loan__c'),
          this.getCsvValue(row, 'IvytekTestPkg__Application__c'),
          this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c'),
          this.getCsvValue(row, 'Id')
        ].forEach((identifier: string) => {
          this.getIvyTekIdentifierLookupKeys(identifier).forEach((loanId: string) => {
            rowsByLoanId.set(loanId, [
              ...(rowsByLoanId.get(loanId) || []),
              row
            ]);
          });
        });
      });
    return rowsByLoanId;
  }

  /**
   * Finds or creates the borrower client needed by a loan import row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any>} helperRowsByLoanId helper rows keyed by loan id.
   * @param {Map<string, any[]>} contactApplicationsByLoanId contact application rows keyed by loan id.
   * @param {Map<string, any>} contactRowsById contact rows keyed by source/contact ids.
   * @param {Map<string, any[]>} contactRowsByName contact rows keyed by normalized names.
   * @param {Map<string, any>} contactApplicationRowsById contact application rows keyed by source id.
   * @param {Map<string, any>} clientCache client lookup cache.
   */
  private async ensureIvyTekLoanClient(
    row: any,
    helperRowsByLoanId: Map<string, any>,
    contactApplicationsByLoanId: Map<string, any[]>,
    contactRowsById: Map<string, any>,
    contactRowsByName: Map<string, any[]>,
    contactApplicationRowsById: Map<string, any>,
    clientCache: Map<string, any>,
    syncedClientIds: Set<string>
  ) {
    const existingClient = await this.findIvyTekLoanClient(
      row,
      helperRowsByLoanId,
      contactApplicationsByLoanId,
      contactRowsById,
      contactRowsByName,
      contactApplicationRowsById,
      clientCache
    );
    if (existingClient?.id) {
      await this.syncIvyTekExistingLoanClientData(
        existingClient.id.toString(),
        this.getIvyTekClientRowForLoan(
          row,
          helperRowsByLoanId,
          contactApplicationsByLoanId,
          contactRowsById,
          contactRowsByName,
          contactApplicationRowsById
        ),
        syncedClientIds
      );
      return existingClient;
    }

    const clientSourceRow = this.getIvyTekClientRowForLoan(
      row,
      helperRowsByLoanId,
      contactApplicationsByLoanId,
      contactRowsById,
      contactRowsByName,
      contactApplicationRowsById
    );
    if (!clientSourceRow) {
      return null;
    }

    this.validateIvyTekClientData(clientSourceRow);
    const cacheKey = `create:${this.getIvyTekExternalId(clientSourceRow) || this.normalizeIvyTekName(this.getIvyTekDisplayName(clientSourceRow))}`;
    if (clientCache.has(cacheKey)) {
      return await clientCache.get(cacheKey);
    }

    const clientPromise = this.saveIvyTekClientAndTribalData(clientSourceRow).then(async () => {
      clientCache.clear();
      return (
        (await this.findIvyTekClientByExternalId(this.getIvyTekExternalId(clientSourceRow), clientCache)) ||
        this.findExistingIvyTekClient(clientSourceRow)
      );
    });
    clientCache.set(cacheKey, clientPromise);
    return await clientPromise;
  }

  /**
   * Ensures existing clients touched during a loan-only import still receive IvyTek tribal data.
   * @param {string} clientId Client id.
   * @param {any} row IvyTek client source row.
   * @param {Set<string>} syncedClientIds Client ids already synced during this stage.
   */
  private async syncIvyTekExistingLoanClientData(clientId: string, row: any, syncedClientIds: Set<string>) {
    if (!clientId || syncedClientIds.has(clientId)) {
      return;
    }
    syncedClientIds.add(clientId);
    await this.upsertIvyTekClientIdentifiers(clientId, row);
    await this.upsertIvyTekClientAddress(clientId, row);
  }

  /**
   * Builds the best available client source row for a loan row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any>} helperRowsByLoanId helper rows keyed by loan id.
   * @param {Map<string, any[]>} contactApplicationsByLoanId contact application rows keyed by loan id.
   * @param {Map<string, any>} contactRowsById contact rows keyed by source/contact ids.
   * @param {Map<string, any[]>} contactRowsByName contact rows keyed by normalized names.
   * @param {Map<string, any>} contactApplicationRowsById contact application rows keyed by source id.
   */
  private getIvyTekClientRowForLoan(
    row: any,
    helperRowsByLoanId: Map<string, any>,
    contactApplicationsByLoanId: Map<string, any[]>,
    contactRowsById: Map<string, any>,
    contactRowsByName: Map<string, any[]>,
    contactApplicationRowsById: Map<string, any>
  ) {
    const contactApplications = this.getIvyTekContactApplicationsForLoan(row, contactApplicationsByLoanId);
    const contactApplication = this.getIvyTekBorrowerContactApplication(
      contactApplications,
      contactApplicationRowsById
    );
    const helperRow = this.getIvyTekHelperRowForLoan(row, helperRowsByLoanId);
    const matchedContactRow = this.findIvyTekContactRowForLoan(
      row,
      contactApplications,
      contactRowsById,
      contactRowsByName,
      contactApplicationRowsById
    );

    if (matchedContactRow) {
      return this.buildIvyTekClientRowFromContactAndLoan(matchedContactRow, helperRow || row, contactApplication);
    }

    if (
      !this.hasIvyTekRealContactLookupRows(contactRowsById, contactRowsByName) &&
      contactApplication &&
      (helperRow || row) &&
      this.getCsvValue(contactApplication, 'IvytekTestPkg__Contact__c')
    ) {
      return this.buildIvyTekClientRowFromLoanAndContactApplication(helperRow || row, contactApplication);
    }

    return null;
  }

  /**
   * Checks whether the import has authoritative Contact rows available.
   * @param {Map<string, any>} contactRowsById Contact rows keyed by identifiers.
   * @param {Map<string, any[]>} contactRowsByName Contact rows keyed by normalized names.
   */
  private hasIvyTekRealContactLookupRows(
    contactRowsById: Map<string, any>,
    contactRowsByName: Map<string, any[]>
  ): boolean {
    return contactRowsById.size > 0 || contactRowsByName.size > 0;
  }

  /**
   * Gets the helper row that matches a loan row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any>} helperRowsByLoanId helper rows keyed by loan id.
   */
  private getIvyTekHelperRowForLoan(row: any, helperRowsByLoanId: Map<string, any>) {
    return this.getUniqueIvyTekIdentifiers([
      this.getCsvValue(row, 'Id'),
      this.getCsvValue(row, 'IvytekTestPkg__Application__c'),
      this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c')
    ])
      .flatMap((identifier: string) => this.getIvyTekIdentifierLookupKeys(identifier))
      .map((key: string) => helperRowsByLoanId.get(key))
      .find((match: any) => !!match);
  }

  /**
   * Gets all contact/application bridge rows that can describe a loan's borrower.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any[]>} contactApplicationsByLoanId contact application rows keyed by loan id.
   */
  private getIvyTekContactApplicationsForLoan(row: any, contactApplicationsByLoanId: Map<string, any[]>) {
    const matches: any[] = [];
    const seenRows = new Set<any>();
    this.getUniqueIvyTekIdentifiers([
      this.getCsvValue(row, 'Id'),
      this.getCsvValue(row, 'IvytekTestPkg__Application__c'),
      this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c')
    ])
      .flatMap((identifier: string) => this.getIvyTekIdentifierLookupKeys(identifier))
      .forEach((key: string) => {
        (contactApplicationsByLoanId.get(key) || []).forEach((match: any) => {
          if (!seenRows.has(match)) {
            seenRows.add(match);
            matches.push(match);
          }
        });
      });
    return matches;
  }

  /**
   * Gets a borrower contact application row, following application rows to their borrower bridge when available.
   * @param {any[]} contactApplications Contact/application rows found for the loan.
   * @param {Map<string, any>} contactApplicationRowsById contact application rows keyed by source id.
   */
  private getIvyTekBorrowerContactApplication(
    contactApplications: any[],
    contactApplicationRowsById: Map<string, any>
  ) {
    for (const contactApplication of contactApplications) {
      const directContactId = this.getCsvValue(contactApplication, 'IvytekTestPkg__Contact__c');
      if (directContactId) {
        return contactApplication;
      }

      const borrowerContactApplicationId = this.getCsvValue(contactApplication, 'IvytekTestPkg__BorrowerContApp__c');
      const linkedContactApplication = this.findIvyTekContactApplicationByIdentifier(
        borrowerContactApplicationId,
        contactApplicationRowsById
      );
      if (linkedContactApplication && this.getCsvValue(linkedContactApplication, 'IvytekTestPkg__Contact__c')) {
        return linkedContactApplication;
      }
    }

    return contactApplications.find((contactApplication: any) => !!contactApplication) || null;
  }

  /**
   * Finds a contact application row by a Salesforce-style source id.
   * @param {string} identifier Contact application id.
   * @param {Map<string, any>} contactApplicationRowsById contact application rows keyed by source id.
   */
  private findIvyTekContactApplicationByIdentifier(identifier: string, contactApplicationRowsById: Map<string, any>) {
    return this.getIvyTekIdentifierLookupKeys(identifier)
      .map((key: string) => contactApplicationRowsById.get(key))
      .find((match: any) => !!match);
  }

  /**
   * Finds the real Contact row for a loan before falling back to client creation from loan-only data.
   * @param {any} row IvyTek loan row.
   * @param {any[]} contactApplications Contact/application rows found for the loan.
   * @param {Map<string, any>} contactRowsById contact rows keyed by source/contact ids.
   * @param {Map<string, any[]>} contactRowsByName contact rows keyed by normalized names.
   * @param {Map<string, any>} contactApplicationRowsById contact application rows keyed by source id.
   */
  private findIvyTekContactRowForLoan(
    row: any,
    contactApplications: any[],
    contactRowsById: Map<string, any>,
    contactRowsByName: Map<string, any[]>,
    contactApplicationRowsById: Map<string, any>
  ) {
    const borrowerContactApplication = this.getIvyTekBorrowerContactApplication(
      contactApplications,
      contactApplicationRowsById
    );
    const contactIdentifiers = this.getUniqueIvyTekIdentifiers([
      ...contactApplications.flatMap((contactApplication: any) => [
        this.getCsvValue(contactApplication, 'IvytekTestPkg__Contact__c'),
        this.getCsvValue(contactApplication, 'IvytekTestPkg__Borrower_Contact__c'),
        this.getCsvValue(contactApplication, 'ContactId'),
        this.getCsvValue(contactApplication, 'ContactID')
      ]),
      this.getCsvValue(borrowerContactApplication || {}, 'IvytekTestPkg__Contact__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Contact__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Borrower_Contact__c')
    ]);

    for (const identifier of contactIdentifiers) {
      const contactRow = this.findIvyTekContactRowByIdentifier(identifier, contactRowsById);
      if (contactRow) {
        return contactRow;
      }
    }

    const contactExternalIdentifiers = this.getUniqueIvyTekIdentifiers([
      this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Account__c'),
      this.getCsvValue(row, 'IvytekTestPkg__CR_Joint_Contact__c')
    ]);
    for (const identifier of contactExternalIdentifiers) {
      const contactRow = this.findIvyTekContactRowByIdentifier(identifier, contactRowsById);
      if (contactRow) {
        return contactRow;
      }
    }

    const contactApplicationNames = contactApplications.flatMap((contactApplication: any) => [
      this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Borrower_Name_Text__c'),
      this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Borrower_Name__c'),
      this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Customer_Name_Text__c'),
      this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Customer_Name__c'),
      this.getCsvValue(contactApplication || {}, 'IvyTestPkg__Customer_Name__c'),
      this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Full_Name__c')
    ]);
    const names = this.getUniqueIvyTekIdentifiers([
      ...this.getIvyTekCustomerNameCandidates(row),
      ...contactApplicationNames,
      this.getCsvValue(borrowerContactApplication || {}, 'IvytekTestPkg__Borrower_Name_Text__c'),
      this.getCsvValue(borrowerContactApplication || {}, 'IvytekTestPkg__Borrower_Name__c'),
      this.getCsvValue(borrowerContactApplication || {}, 'IvytekTestPkg__Customer_Name_Text__c'),
      this.getCsvValue(borrowerContactApplication || {}, 'IvytekTestPkg__Customer_Name__c'),
      this.getCsvValue(borrowerContactApplication || {}, 'IvyTestPkg__Customer_Name__c'),
      this.getCsvValue(borrowerContactApplication || {}, 'IvytekTestPkg__Full_Name__c'),
      this.getIvyTekDisplayName(row)
    ]);
    for (const name of names) {
      const contactRow = this.findIvyTekContactRowByName(name, contactRowsByName);
      if (contactRow) {
        return contactRow;
      }
    }

    return null;
  }

  /**
   * Finds a real Contact row by any comparable id key.
   * @param {string} identifier Contact identifier.
   * @param {Map<string, any>} contactRowsById contact rows keyed by source/contact ids.
   */
  private findIvyTekContactRowByIdentifier(identifier: string, contactRowsById: Map<string, any>) {
    return this.getIvyTekIdentifierLookupKeys(identifier)
      .map((key: string) => contactRowsById.get(key))
      .find((match: any) => !!match);
  }

  /**
   * Finds a uniquely matching Contact row by name, tolerating missing middle initials.
   * @param {string} name Borrower name.
   * @param {Map<string, any[]>} contactRowsByName contact rows keyed by normalized names.
   */
  private findIvyTekContactRowByName(name: string, contactRowsByName: Map<string, any[]>) {
    const exactMatches = contactRowsByName.get(`exact:${this.normalizeIvyTekSourceContactName(name)}`) || [];
    if (exactMatches.length === 1) {
      return exactMatches[0];
    }

    const strictMatches = contactRowsByName.get(`strict:${this.normalizeIvyTekName(name)}`) || [];
    if (strictMatches.length === 1) {
      return strictMatches[0];
    }

    const looseMatches = contactRowsByName.get(`loose:${this.normalizeIvyTekNameWithoutMiddleInitials(name)}`) || [];
    return looseMatches.length === 1 ? looseMatches[0] : null;
  }

  /**
   * Builds a client source row from the real Contact row and the loan that needs it.
   * @param {any} contactRow IvyTek Contact row.
   * @param {any} loanRow IvyTek loan row.
   * @param {any} contactApplication Contact application or application bridge row.
   */
  private buildIvyTekClientRowFromContactAndLoan(contactRow: any, loanRow: any, contactApplication: any = null) {
    const contactSourceId = this.getIvyTekContactSourceId(contactRow);
    const contactExternalId = this.getIvyTekContactExternalId(contactRow);
    const companyOffice = this.getIvyTekOfficeForRow(loanRow);
    const contactApplicationExternalId = this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Contact__c')
      ? this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__ExternalID__c')
      : '';
    const loanDate = this.getIvyTekOfficeSafeDate(
      this.getEarliestIvyTekDate([
        this.getCsvValue(loanRow, 'IvytekTestPkg__LoanDate__c'),
        this.getCsvValue(loanRow, 'IvytekTestPkg__SetUpDate__c')
      ]),
      loanRow
    );
    const activationDate = loanDate
      ? this.dateUtils.formatDate(loanDate, this.settingsService.dateFormat)
      : this.getIvyTekClientActivationDate(contactRow);

    return {
      ...loanRow,
      ...contactRow,
      IvytekTestPkg__Loan__c: this.getCsvValue(loanRow, 'Id'),
      IvytekTestPkg__Application__c:
        this.getCsvValue(loanRow, 'IvytekTestPkg__Application__c') ||
        this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Application__c'),
      IvytekTestPkg__Borrower_Contact__c: contactSourceId,
      IvytekTestPkg__Contact__c: contactSourceId,
      IvytekTestPkg__ContactApplication__c: this.getCsvValue(contactApplication || {}, 'Id'),
      IvytekTestPkg__ContactApplication_ExternalID__c: contactApplicationExternalId,
      IvyTekClientExternalID: contactExternalId,
      IvyTekClientSourceContactID: contactSourceId,
      IvyTekClientSourceExternalID: this.getCsvValue(contactRow, 'IvytekTestPkg__ExternalID__c') || contactExternalId,
      IvyTekClientApplicationExternalID: contactApplicationExternalId,
      IvyTekClientLoanExternalID: this.getIvyTekLoanExternalId(loanRow),
      IvyTekClientEntityID: this.getIvyTekEntityId(contactRow),
      IvyTekClientCompanyCode: this.getIvyTekCompanyCode(loanRow),
      IvyTekClientOfficeId: companyOffice?.id || '',
      IvyTekClientOfficeName: companyOffice?.name || '',
      IvyTekClientActivationDate: activationDate,
      IvyTekClientActivationDateSource: loanDate ? 'loan' : '',
      IvyTekClientRelatedExternalIDs: this.getUniqueIvyTekIdentifiers([
        contactSourceId,
        contactExternalId,
        this.getCsvValue(contactRow, 'IvytekTestPkg__ExternalID__c'),
        this.getCsvValue(contactApplication || {}, 'Id'),
        contactApplicationExternalId
      ]).join(',')
    };
  }

  /**
   * Builds a deterministic fallback client row so production loan imports reach full coverage.
   * @param {any} row IvyTek loan row.
   * @param {any} helperRow Optional helper row.
   * @param {any} contactApplication Optional contact/application row.
   */
  private buildIvyTekFallbackClientRowFromLoan(row: any, helperRow: any = null, contactApplication: any = null) {
    const sourceRow = helperRow || row;
    const fallbackExternalId = this.getIvyTekFallbackClientExternalId(row);
    const companyOffice = this.getIvyTekOfficeForRow(sourceRow);
    return {
      ...sourceRow,
      IvyTekClientExternalID: fallbackExternalId,
      IvyTekClientSourceExternalID: this.getCsvValue(sourceRow, 'IvytekTestPkg__ExternalID__c'),
      IvyTekClientApplicationExternalID: this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__ExternalID__c'),
      IvyTekClientFallback: 'Yes',
      IvyTekClientFallbackReason: 'No definitive Contact row or existing Mifos client matched this loan.',
      IvyTekClientLoanExternalID: this.getIvyTekLoanExternalId(row),
      IvyTekClientCompanyCode: this.getIvyTekCompanyCode(sourceRow),
      IvyTekClientOfficeId: companyOffice?.id || '',
      IvyTekClientOfficeName: companyOffice?.name || '',
      IvyTekClientActivationDate: this.getIvyTekClientActivationDate(sourceRow),
      IvyTekClientActivationDateSource: 'loan',
      IvyTekClientRelatedExternalIDs: this.getUniqueIvyTekIdentifiers([
        fallbackExternalId,
        this.getCsvValue(sourceRow, 'Id'),
        this.getCsvValue(sourceRow, 'IvytekTestPkg__ExternalID__c'),
        this.getCsvValue(sourceRow, 'IvytekTestPkg__Application__c'),
        this.getCsvValue(contactApplication || {}, 'Id'),
        this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__ExternalID__c')
      ]).join(',')
    };
  }

  /**
   * Gets a loan-scoped fallback client external id.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekFallbackClientExternalId(row: any): string {
    const legacyLoanId = this.getIvyTekLegacyLoanId(row);
    const sourceLoanId = this.getCsvValue(row, 'Id') || this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c');
    return `ivytek_fallback_client_${legacyLoanId || sourceLoanId}`;
  }

  /**
   * Gets every external id candidate that can identify a client row.
   * @param {any} row IvyTek client source row.
   */
  private getIvyTekClientLookupIdentifiers(row: any): string[] {
    return this.getUniqueIvyTekIdentifiers([
      this.getIvyTekExternalId(row),
      this.getCsvValue(row, 'IvyTekClientSourceExternalID'),
      this.getCsvValue(row, 'IvyTekClientSourceContactID'),
      this.getCsvValue(row, 'IvyTekClientApplicationExternalID'),
      ...this.getCsvValue(row, 'IvyTekClientRelatedExternalIDs').split(','),
      this.getCsvValue(row, 'source_contact_id'),
      this.getCsvValue(row, 'sf_contact_id'),
      this.getCsvValue(row, 'ContactId'),
      this.getCsvValue(row, 'ContactID'),
      this.getCsvValue(row, 'AccountId'),
      this.getCsvValue(row, 'IvytekTestPkg__Contact__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Borrower_Contact__c')
    ]);
  }

  /**
   * Finds the Mifos client for an IvyTek loan row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any>} helperRowsByLoanId helper rows keyed by loan id.
   * @param {Map<string, any[]>} contactApplicationsByLoanId contact application rows keyed by loan id.
   * @param {Map<string, any>} contactRowsById contact rows keyed by source/contact ids.
   * @param {Map<string, any[]>} contactRowsByName contact rows keyed by normalized names.
   * @param {Map<string, any>} contactApplicationRowsById contact application rows keyed by source id.
   * @param {Map<string, any>} clientCache client lookup cache.
   */
  private async findIvyTekLoanClient(
    row: any,
    helperRowsByLoanId: Map<string, any>,
    contactApplicationsByLoanId: Map<string, any[]>,
    contactRowsById: Map<string, any>,
    contactRowsByName: Map<string, any[]>,
    contactApplicationRowsById: Map<string, any>,
    clientCache: Map<string, any>
  ) {
    const contactApplications = this.getIvyTekContactApplicationsForLoan(row, contactApplicationsByLoanId);
    const helperRow = this.getIvyTekHelperRowForLoan(row, helperRowsByLoanId);
    const matchedContactRow = this.findIvyTekContactRowForLoan(
      row,
      contactApplications,
      contactRowsById,
      contactRowsByName,
      contactApplicationRowsById
    );
    const matchedClientRow = matchedContactRow
      ? this.buildIvyTekClientRowFromContactAndLoan(
          matchedContactRow,
          helperRow || row,
          this.getIvyTekBorrowerContactApplication(contactApplications, contactApplicationRowsById)
        )
      : null;
    const hasRealContactRows = this.hasIvyTekRealContactLookupRows(contactRowsById, contactRowsByName);

    const identifiers = this.getUniqueIvyTekIdentifiers([
      ...(matchedClientRow ? this.getIvyTekClientLookupIdentifiers(matchedClientRow) : []),
      ...contactApplications.flatMap((contactApplication: any) => {
        const contactId = this.getCsvValue(contactApplication, 'IvytekTestPkg__Contact__c');
        return [
          contactId,
          contactId ? this.getCsvValue(contactApplication, 'IvytekTestPkg__ExternalID__c') : ''
        ];
      }),
      ...(matchedClientRow || hasRealContactRows ? [] : [
            this.getIvyTekExternalId(row),
            this.getIvyTekExternalId(helperRow || {})
          ])
    ]);

    for (const identifier of identifiers) {
      const clientByExternalId = await this.findIvyTekClientByExternalId(identifier, clientCache);
      if (clientByExternalId) {
        return clientByExternalId;
      }
    }

    const exactNames = this.getUniqueIvyTekIdentifiers([
      matchedClientRow ? this.getIvyTekDisplayName(matchedClientRow) : '',
      matchedContactRow ? this.getIvyTekDisplayName(matchedContactRow) : '',
      ...this.getIvyTekCustomerNameCandidates(helperRow || {}),
      ...this.getIvyTekCustomerNameCandidates(row)
    ]);

    for (const name of exactNames) {
      const clientByExactName = await this.findIvyTekClientByExactSourceName(name, clientCache);
      if (clientByExactName) {
        return clientByExactName;
      }
    }

    for (const name of exactNames) {
      const clientByLooseName = await this.findIvyTekClientByLooseSourceName(name, clientCache);
      if (clientByLooseName) {
        return clientByLooseName;
      }
    }

    const names = hasRealContactRows ? [] : exactNames.filter((name: string) => !!name);

    for (const name of names) {
      const clientByName = await this.findIvyTekClientByStrictName(name, clientCache);
      if (clientByName) {
        return clientByName;
      }
    }

    return hasRealContactRows ? null : this.findIvyTekClientByExternalId(this.getIvyTekExternalId(row), clientCache);
  }

  /**
   * Finds a client by external id with local caching.
   * @param {string} externalId External id.
   * @param {Map<string, any>} clientCache Client cache.
   */
  private async findIvyTekClientByExternalId(externalId: string, clientCache: Map<string, any>) {
    const cacheKey = `external:${externalId}`;
    if (!externalId) {
      return null;
    }
    if (clientCache.has(cacheKey)) {
      return clientCache.get(cacheKey);
    }
    const client = await this.findClientByExternalId(externalId);
    clientCache.set(cacheKey, client);
    return client;
  }

  /**
   * Finds one client by an exact source-name key that preserves Jr/Sr/III style suffixes.
   * @param {string} name Client name.
   * @param {Map<string, any>} clientCache Client cache.
   */
  private async findIvyTekClientByExactSourceName(name: string, clientCache: Map<string, any>) {
    const sourceName = this.normalizeIvyTekSourceContactName(name);
    const cacheKey = `exact-name:${sourceName}`;
    if (!sourceName) {
      return null;
    }
    if (clientCache.has(cacheKey)) {
      return clientCache.get(cacheKey);
    }

    const candidates = await this.searchIvyTekClientsByText(name, 10);
    const matches = candidates.filter((client: any) => {
      const clientName = client.displayName || client.fullname || client.name || '';
      return this.normalizeIvyTekSourceContactName(clientName) === sourceName;
    });
    const client = matches.length === 1 ? matches[0] : null;
    clientCache.set(cacheKey, client);
    return client;
  }

  /**
   * Finds one client by borrower name while tolerating missing middle initials.
   * @param {string} name Client name.
   * @param {Map<string, any>} clientCache Client cache.
   */
  private async findIvyTekClientByLooseSourceName(name: string, clientCache: Map<string, any>) {
    const looseName = this.normalizeIvyTekNameWithoutMiddleInitials(name);
    const cacheKey = `loose-name:${looseName}`;
    if (!looseName) {
      return null;
    }
    if (clientCache.has(cacheKey)) {
      return clientCache.get(cacheKey);
    }

    const candidates = await this.searchIvyTekClientsByNameTerms(name);
    const uniqueMatches = new Map<string, any>();
    candidates
      .filter((client: any) => {
        const clientName = client.displayName || client.fullname || client.name || '';
        return this.normalizeIvyTekNameWithoutMiddleInitials(clientName) === looseName;
      })
      .forEach((client: any) => {
        const matchKey = (client.id || client.clientId || client.entityId || client.externalId || '').toString();
        uniqueMatches.set(matchKey || this.normalizeIvyTekSourceContactName(client.displayName || ''), client);
      });

    const client = uniqueMatches.size === 1 ? Array.from(uniqueMatches.values())[0] : null;
    clientCache.set(cacheKey, client);
    return client;
  }

  /**
   * Searches clients by full name and last-name terms for high-confidence matching.
   * @param {string} name Source name.
   */
  private async searchIvyTekClientsByNameTerms(name: string): Promise<any[]> {
    const searchTerms = this.getIvyTekNameSearchTerms(name);
    const seen = new Set<string>();
    const results: any[] = [];

    for (const searchTerm of searchTerms) {
      const candidates = await this.searchIvyTekClientsByText(searchTerm, 25);
      candidates.forEach((client: any) => {
        const clientKey = (client.id || client.clientId || client.entityId || client.externalId || '').toString();
        const key = clientKey || this.normalizeIvyTekSourceContactName(client.displayName || client.fullname || '');
        if (!key || seen.has(key)) {
          return;
        }
        seen.add(key);
        results.push(client);
      });
    }

    return results;
  }

  /**
   * Searches clients by text and falls back to the regular client list endpoint when v2 search misses.
   * @param {string} searchTerm Client search term.
   * @param {number} pageSize Maximum number of clients to request.
   */
  private async searchIvyTekClientsByText(searchTerm: string, pageSize: number): Promise<any[]> {
    if (!searchTerm) {
      return [];
    }

    const searchTerms = this.getIvyTekClientSearchTerms(searchTerm);
    const primarySearchTerm = searchTerms[0];
    try {
      const searchResponse: any = await firstValueFrom(
        this.clientsService.searchByText(primarySearchTerm, 0, pageSize)
      );
      const candidates = this.normalizeIvyTekListResponse(searchResponse);
      if (candidates.length) {
        return candidates;
      }
    } catch {
      // Fall through to the expanded search variants; the backend search can be case-sensitive.
    }

    const searchCandidates = await this.searchIvyTekClientTermVariants(searchTerms.slice(1), pageSize, (term: string) =>
      this.clientsService.searchByText(term, 0, pageSize)
    );
    if (searchCandidates.length) {
      return searchCandidates;
    }

    return this.searchIvyTekClientTermVariants(searchTerms, pageSize, (term: string) =>
      this.clientsService.getFilteredClients('displayName', 'ASC', false, term)
    );
  }

  /**
   * Searches client term variants and de-duplicates results.
   * @param {string[]} searchTerms Search term variants.
   * @param {number} pageSize Maximum number of results.
   * @param {(term: string) => any} requestFactory Request factory.
   */
  private async searchIvyTekClientTermVariants(
    searchTerms: string[],
    pageSize: number,
    requestFactory: (term: string) => any
  ): Promise<any[]> {
    const clientsByKey = new Map<string, any>();
    for (const term of searchTerms) {
      try {
        const response: any = await firstValueFrom(requestFactory(term));
        this.normalizeIvyTekListResponse(response).forEach((client: any) => {
          const key = this.getIvyTekClientId(client) || client?.externalId || client?.displayName || '';
          if (key && !clientsByKey.has(key)) {
            clientsByKey.set(key, client);
          }
        });
      } catch {
        // Keep trying the remaining variants.
      }
      if (clientsByKey.size >= pageSize) {
        break;
      }
    }
    return Array.from(clientsByKey.values()).slice(0, pageSize);
  }

  /**
   * Gets case variants for backend client search.
   * @param {string} searchTerm Search term.
   */
  private getIvyTekClientSearchTerms(searchTerm: string): string[] {
    const trimmedTerm = searchTerm.trim();
    const titleCaseTerm = trimmedTerm.toLowerCase().replace(/\b\p{L}/gu, (letter: string) => letter.toUpperCase());
    return this.getUniqueIvyTekIdentifiers([
      trimmedTerm,
      trimmedTerm.toUpperCase(),
      trimmedTerm.toLowerCase(),
      titleCaseTerm
    ]);
  }

  /**
   * Gets conservative search terms for a source client name.
   * @param {string} name Source name.
   */
  private getIvyTekNameSearchTerms(name: string): string[] {
    const normalizedName = (name || '').toString().trim();
    const tokens = normalizedName
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^A-Za-z0-9, ]+/g, ' ')
      .split(/[,\s]+/)
      .filter((token: string) => !!token && !/^\d+$/.test(token));
    const lastMeaningfulToken = [...tokens].reverse().find(
      (token: string) => token.length > 1 && ![
          'jr',
          'sr',
          'ii',
          'iii',
          'iv',
          'v'
        ].includes(token.toLowerCase())
    );

    return this.getUniqueIvyTekIdentifiers([
      normalizedName,
      lastMeaningfulToken || ''
    ]);
  }

  /**
   * Finds a client by strict normalized name.
   * @param {string} name Client name.
   * @param {Map<string, any>} clientCache Client cache.
   */
  private async findIvyTekClientByStrictName(name: string, clientCache: Map<string, any>) {
    const cacheKey = `name:${this.normalizeIvyTekName(name)}`;
    if (clientCache.has(cacheKey)) {
      return clientCache.get(cacheKey);
    }

    const candidates = await this.searchIvyTekClientsByText(name, 10);
    const sourceName = this.normalizeIvyTekName(name);
    const matches = candidates.filter((client: any) => {
      const clientName = client.displayName || client.fullname || client.name || '';
      return this.normalizeIvyTekName(clientName) === sourceName;
    });
    const client = matches.length === 1 ? matches[0] : null;
    clientCache.set(cacheKey, client);
    return client;
  }

  /**
   * Gets product details with local caching.
   * @param {any} productId Product id.
   * @param {Map<string, any>} productDetailsCache Product details cache.
   */
  private async getIvyTekLoanProductDetails(productId: any, productDetailsCache: Map<string, any>) {
    const cacheKey = productId.toString();
    if (!productDetailsCache.has(cacheKey)) {
      const productDetails = await firstValueFrom(this.productsService.getLoanProduct('loanproducts', cacheKey, false));
      productDetailsCache.set(cacheKey, productDetails);
    }
    return productDetailsCache.get(cacheKey);
  }

  /**
   * Finds an existing loan by external id, falling back to global search for older Fineract versions.
   * @param {string} externalId Loan external id.
   * @param {string} accountNo Loan account number.
   */
  private async findIvyTekLoanByExternalId(externalId: string, accountNo: string = '') {
    if (externalId) {
      try {
        return await firstValueFrom(this.loansService.getLoanByExternalId(externalId));
      } catch (error: any) {
        if (error?.status !== 404) {
          throw error;
        }
      }
    }

    const searchQuery = externalId || accountNo;
    if (!searchQuery) {
      return null;
    }

    try {
      const searchResults = this.normalizeIvyTekListResponse(
        await firstValueFrom(this.searchService.getSearchResults(searchQuery, 'loans'))
      );
      return (
        searchResults.find((result: any) => {
          const entityType = this.normalizeIvyTekText(result.entityType || result.type);
          return (
            entityType === 'loan' &&
            (result.entityExternalId === externalId ||
              result.externalId === externalId ||
              result.entityAccountNo === accountNo ||
              result.accountNo === accountNo)
          );
        }) || null
      );
    } catch (error: any) {
      if (error?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Gets the loan id from loan detail or search result shapes.
   * @param {any} loan Existing loan response.
   */
  private getIvyTekLoanId(loan: any): string {
    return (loan?.id || loan?.loanId || loan?.resourceId || loan?.entityId || '').toString();
  }

  /**
   * Checks whether loan creation failed because the external id already exists.
   * @param {any} error API error.
   */
  private isIvyTekDuplicateLoanExternalIdError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return message.includes('loan with externalid is already registered') || message.includes('externalid is already');
  }

  /**
   * Checks whether loan creation failed because the client activation date is after the loan date.
   * @param {any} error API error.
   */
  private isIvyTekClientActivationLoanDateError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      message.includes('loan is submitted cannot be earlier') ||
      message.includes('submitted cannot be earlier') ||
      message.includes("submitted date cannot be earlier than client's activation date") ||
      message.includes("loan is submitted cannot be earlier than client's activation date")
    );
  }

  /**
   * Checks whether Fineract rejected a loan because a submitted/approval/disbursal
   * date is after the tenant business date.
   * @param {any} error API error.
   */
  private isIvyTekFutureLoanDateError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return message.includes('cannot be in the future');
  }

  /**
   * Checks whether Fineract rejected a loan update because the account is no longer editable.
   * @param {any} error API error.
   */
  private isIvyTekLoanCurrentStateError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return message.includes('cannot be modified in its current state');
  }

  /**
   * Checks whether an existing loan can accept a normal loan application update.
   * @param {any} loan Existing loan response.
   */
  private canUpdateExistingIvyTekLoan(loan: any) {
    const status = loan?.status || {};
    const statusText = this.normalizeIvyTekText(status.value || status.code || status);
    if (status.active || status.approved || status.overpaid || status.closed || status.closedObligationsMet) {
      return false;
    }
    return (
      status.pendingApproval ||
      status.submittedAndPendingApproval ||
      statusText.includes('submitted') ||
      statusText.includes('pendingapproval')
    );
  }

  /**
   * Builds a result message for existing loans that Fineract will not modify.
   * @param {any} loan Existing loan response.
   * @param {string} lifecycleMessage Lifecycle import note.
   */
  private getIvyTekExistingLoanUnchangedMessage(loan: any, lifecycleMessage: string) {
    const status = loan?.status?.value || loan?.status?.code || 'current state';
    return [
      `Existing loan was found in ${status}; terms were left unchanged because Fineract does not allow normal loan edits in that state.`,
      lifecycleMessage
    ]
      .filter((message: string) => !!message)
      .join(' ');
  }

  /**
   * Gets the original IvyTek loan amount.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanPrincipal(row: any): number | null {
    return this.getFirstIvyTekPositiveDecimal(row, [
      'IvytekTestPkg__AmtFinanced__c',
      'IvytekTestPkg__RequestAmount__c',
      'IvytekTestPkg__Approved_Amount__c',
      'IvytekTestPkg__Principle__c'
    ]);
  }

  /**
   * Gets the IvyTek current balance snapshot.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanBalanceNow(row: any): number | null {
    return this.getFirstIvyTekDecimal(row, [
      'IvytekTestPkg__BalanceNow__c',
      'BalanceNow',
      'Balance Now',
      'Current Balance'
    ]);
  }

  /**
   * Gets the annual interest rate percentage from IvyTek rate fields.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanInterestRatePercent(row: any): number {
    const contractRatePercent = this.getIvyTekLoanContractRatePercent(row);
    if (contractRatePercent !== null) {
      return contractRatePercent;
    }

    const marginRate = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__Margin_Rate__c'));
    if (marginRate !== null) {
      return marginRate;
    }

    const perDiemRate = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__Per_Diem_Interest_Rate__c'));
    return perDiemRate !== null ? perDiemRate * 365 * 100 : 0;
  }

  /**
   * Gets IvyTek's raw contract-rate decimal.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanContractRateDecimal(row: any): number | null {
    return this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__ContractRate__c'));
  }

  /**
   * Converts IvyTek's 0-1 contract-rate scale into Fineract's percentage scale.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanContractRatePercent(row: any): number | null {
    const contractRate = this.getIvyTekLoanContractRateDecimal(row);
    if (contractRate === null) {
      return null;
    }
    return contractRate > 1 ? contractRate : contractRate * 100;
  }

  /**
   * Gets the rate sent to Fineract for a migration snapshot loan.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether import should activate loans.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   * @param {any} historicalRepaymentSummary Historical payment rows grouped for this loan.
   */
  private getIvyTekLoanPayloadInterestRatePercent(
    row: any,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean,
    historicalRepaymentSummary: any = null
  ): number {
    if (this.shouldUseIvyTekStaticLoanSnapshot()) {
      return 0;
    }
    return this.getIvyTekLoanInterestRatePercent(row);
  }

  /**
   * Gets the submitted/disbursement date sent to Fineract, corrected so interest
   * reconciles to the IvyTek export date.
   * @param {any} row IvyTek loan row.
   * @param {any} historicalRepaymentSummary Historical payment rows grouped for this loan.
   */
  private getIvyTekLoanPayloadDate(row: any, historicalRepaymentSummary: any = null): string {
    const correction = this.getIvyTekOriginationDateCorrection(row, historicalRepaymentSummary);
    if (correction) {
      return this.dateUtils.formatDate(correction.correctedDate, this.settingsService.dateFormat);
    }
    return this.getIvyTekLoanDate(row);
  }

  /**
   * Calculates the corrected origination date so that interest accrued from origination
   * to the IvyTek export (reconciliation) date equals the IvyTek-reported AccruedInterestAll:
   *   days_accrued = AccruedInterestAll / Per_Diem_Interest_Rate
   *   corrected origination = reconciliation date - days_accrued
   *
   * Fineract computes interest from the loan's origination date, so loans older than the
   * transaction-history window (February 2021) otherwise accrue phantom interest across
   * every day since the true origination. The origination moves backward when the accrual
   * window predates the recorded loan date, and forward when the loan has no repayment
   * history to pin it (never-paid legacy loans). Loans with repayment history keep their
   * source origination — interestChargedFromDate carries the reconciliation there.
   * Returns null when no correction applies.
   * @param {any} row IvyTek loan row.
   * @param {any} historicalRepaymentSummary Historical payment rows grouped for this loan.
   */
  private getIvyTekOriginationDateCorrection(
    row: any,
    historicalRepaymentSummary: any = null
  ): { correctedDate: Date; daysAccrued: number; note: string } | null {
    // Full-SQL mode: the loan-state-sync step writes true dates/balances directly,
    // so loans are created with plain source dates and never date-corrected.
    if (this.ivyTekFullSqlLoanImport) {
      return null;
    }
    const perDiem = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__Per_Diem_Interest_Rate__c'));
    const accrued = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__AccruedInterestAll__c'));
    const anchorDate =
      this.getIvyTekReconciliationDate() ||
      this.parseIvyTekDate(this.getCsvValue(row, 'IvytekTestPkg__CurrentDueDate__c'));
    const sourceLoanDate = this.parseIvyTekDate(this.getIvyTekSourceLoanDate(row));

    if (!perDiem || perDiem <= 0 || !accrued || accrued <= 0 || !anchorDate || !sourceLoanDate) {
      return null;
    }

    const daysAccrued = Math.round(accrued / perDiem);
    let accrualStart = new Date(anchorDate);
    accrualStart.setDate(accrualStart.getDate() - daysAccrued);
    // IvyTek computes AccruedInterestAll from origination dates stored without century
    // digits, so ancient results (e.g. year 0094) are Y2K artifacts — window them back
    // into 19xx/20xx. Anything still outside a sane range means corrupt accrual data.
    accrualStart = this.applyIvyTekCenturyWindow(accrualStart);
    if (isNaN(accrualStart.getTime()) || accrualStart.getFullYear() < 1900) {
      return null;
    }

    const describe = (direction: string, correctedDate: Date) =>
      `Origination ${direction}: ${this.dateUtils.formatDate(sourceLoanDate, this.settingsService.dateFormat)} -> ` +
      `${this.dateUtils.formatDate(correctedDate, this.settingsService.dateFormat)} so ${daysAccrued} accrual day(s) ` +
      `at ${perDiem}/day reconcile to ${accrued} outstanding interest on ` +
      `${this.dateUtils.formatDate(anchorDate, this.settingsService.dateFormat)}`;

    if (accrualStart.getTime() < sourceLoanDate.getTime()) {
      return { correctedDate: accrualStart, daysAccrued, note: describe('moved back', accrualStart) };
    }

    // Forward moves only when no repayment history pins the origination date.
    if (historicalRepaymentSummary?.count) {
      return null;
    }
    // Fineract rejects loans submitted after the tenant business date ("cannot be in
    // the future"), so cap the forward move there. Loans with near-zero accrued
    // interest compute an accrual start at the export date, which can pass it.
    const correctedDate = this.clampIvyTekDateToBusinessDate(accrualStart);
    if (correctedDate.getTime() <= sourceLoanDate.getTime()) {
      return null;
    }
    return { correctedDate, daysAccrued, note: describe('moved forward', correctedDate) };
  }

  /**
   * Fetches the authoritative tenant business date from Fineract before the loan
   * stage runs. Loan submission dates after it are rejected with "cannot be in the
   * future", and the locally cached copy is not reliable when the instance's
   * business date lags behind the wall clock.
   */
  private async refreshIvyTekFineractBusinessDate(): Promise<void> {
    try {
      const response: any = await firstValueFrom(this.systemService.getBusinessDate(SettingsService.businessDateType));
      this.ivyTekFineractBusinessDate = this.parseIvyTekDateValue(response?.date);
    } catch {
      // Business date feature disabled or endpoint unavailable — fall back to today.
      this.ivyTekFineractBusinessDate = null;
    }
  }

  /**
   * Clamps a date to the latest date Fineract accepts for loan submission — the
   * tenant business date when available, otherwise today.
   * @param {Date} date Candidate date.
   */
  private clampIvyTekDateToBusinessDate(date: Date): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let maxDate = today;
    const businessDate = this.ivyTekFineractBusinessDate || this.settingsService.businessDate;
    if (businessDate instanceof Date && !isNaN(businessDate.getTime())) {
      const normalized = new Date(businessDate);
      normalized.setHours(0, 0, 0, 0);
      if (normalized.getTime() < maxDate.getTime()) {
        maxDate = normalized;
      }
    }
    return date.getTime() > maxDate.getTime() ? maxDate : date;
  }

  /**
   * Gets the interest start date sent to Fineract for migration snapshots.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether import should activate loans.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   * @param {any} historicalRepaymentSummary Historical payment rows grouped for this loan.
   */
  private getIvyTekLoanInterestChargedFromDate(
    row: any,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean,
    historicalRepaymentSummary: any = null
  ): string {
    // Full-SQL mode: the loan-state-sync step rebuilds the schedule from source
    // truth, so no interest start date is sent at creation.
    if (this.ivyTekFullSqlLoanImport) {
      return '';
    }
    // Sent in static snapshot mode too: the loan is created at 0% but the source rate
    // is restored via REST while the loan is still pending, so the schedule Fineract
    // generates at disbursement uses the real rate AND this charged-from date.
    //
    // Same math as the interest-start correction in scripts/sql-import-server.js:
    // days_accrued = AccruedInterestAll / Per_Diem_Interest_Rate; start = reconciliation date - days_accrued.
    // AccruedInterestAll is a snapshot as of the IvyTek export (reconciliation) date, so the accrual
    // window is anchored there — NOT at CurrentDueDate (stale for delinquent loans) and NOT clamped
    // back to the earliest transaction (which made Fineract accrue phantom interest across the whole
    // pre-February-2021 history gap). Run at loan-creation time so Fineract never generates a schedule
    // that accrues interest for every day since the true (decades-old) origination date.
    const perDiem = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__Per_Diem_Interest_Rate__c'));
    const accrued = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__AccruedInterestAll__c'));
    const anchorDate =
      this.getIvyTekReconciliationDate() ||
      this.parseIvyTekDate(this.getCsvValue(row, 'IvytekTestPkg__CurrentDueDate__c'));
    // The loan is created with the corrected origination date, so floor against that.
    const correction = this.getIvyTekOriginationDateCorrection(row, historicalRepaymentSummary);
    const loanDate = correction?.correctedDate ?? this.parseIvyTekDate(this.getIvyTekSourceLoanDate(row));

    if (!perDiem || perDiem <= 0 || accrued === null || accrued < 0 || !anchorDate || !loanDate) {
      return '';
    }

    const daysAccrued = Math.round(accrued / perDiem);
    let interestStartDate = new Date(anchorDate);
    interestStartDate.setDate(interestStartDate.getDate() - daysAccrued);
    // Window Y2K artifacts (source data computed from century-less origination dates).
    interestStartDate = this.applyIvyTekCenturyWindow(interestStartDate);
    if (isNaN(interestStartDate.getTime()) || interestStartDate.getFullYear() < 1900) {
      return '';
    }
    // Fineract rejects dates after the tenant business date.
    interestStartDate = this.clampIvyTekDateToBusinessDate(interestStartDate);

    // The schedule cannot generate interest past maturity; for loans that matured
    // before the accrual start, placing the start at maturity yields (near) zero
    // schedule interest instead of a full term of phantom interest.
    const maturityDate = this.parseIvyTekDate(this.getIvyTekSourceMaturityDate(row));
    if (maturityDate && interestStartDate.getTime() > maturityDate.getTime()) {
      interestStartDate = maturityDate;
    }

    // interestChargedFromDate cannot precede the loan's disbursement date; an empty value
    // means Fineract charges interest from disbursement, which is the earliest allowed start.
    if (interestStartDate.getTime() <= loanDate.getTime()) {
      return '';
    }

    return this.dateUtils.formatDate(interestStartDate, this.settingsService.dateFormat);
  }

  /**
   * Gets the IvyTek export date — the date source balances are reconciled to.
   */
  private getIvyTekReconciliationDate(): Date | null {
    return this.parseIvyTekDate(this.getIvyTekReconciliationDateString());
  }

  /**
   * Gets the IvyTek export date as the raw YYYY-MM-DD form value for server requests.
   */
  private getIvyTekReconciliationDateString(): string {
    return (this.ivyTekImportForm.get('ivyTekExportDate')?.value || '').toString().trim();
  }

  /**
   * Gets the source date that represents the start of the active interest snapshot.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanInterestSnapshotStartDateText(row: any): string {
    const interestStartDate = this.getIvyTekLoanInterestSnapshotStartDate(row);
    return interestStartDate ? this.dateUtils.formatDate(interestStartDate, this.settingsService.dateFormat) : '';
  }

  /**
   * Gets the migration transaction date used for balance-setting adjustments.
   * Floored at the fallback (disbursement) date — a corrected origination date can land
   * after the IvyTek snapshot date, and Fineract rejects repayments before disbursement.
   * @param {any} row IvyTek loan row.
   * @param {string} fallbackDate Fallback transaction date (the loan's payload date).
   */
  private getIvyTekMigrationTransactionDate(row: any, fallbackDate: string = ''): string {
    const snapshotText = this.getIvyTekLoanInterestSnapshotStartDateText(row);
    if (!snapshotText) {
      return fallbackDate;
    }
    let snapshotDate = this.getIvyTekLoanInterestSnapshotStartDate(row);
    const loanDate = this.parseIvyTekDate(fallbackDate);
    if (snapshotDate && loanDate && snapshotDate.getTime() < loanDate.getTime()) {
      return fallbackDate;
    }
    // Transactions after the tenant business date are rejected as future-dated.
    if (snapshotDate) {
      snapshotDate = this.clampIvyTekDateToBusinessDate(snapshotDate);
      return this.dateUtils.formatDate(snapshotDate, this.settingsService.dateFormat);
    }
    return snapshotText;
  }

  /**
   * Gets the source date that represents the start of the active interest snapshot.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanInterestSnapshotStartDate(row: any): Date | null {
    return this.parseIvyTekDate(
      this.getCsvValue(row, 'IvytekTestPkg__LastInterestDate__c') ||
        this.getCsvValue(row, 'IvytekTestPkg__DateLastCollected__c') ||
        this.getCsvValue(row, 'IvytekTestPkg__LastRCTransDate__c')
    );
  }

  /**
   * Checks whether an active snapshot should defer interest charging to the migration date.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether import should activate loans.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   * @param {any} historicalRepaymentSummary Historical payment rows grouped for this loan.
   */
  private shouldUseIvyTekMigrationDateForLoan(
    row: any,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean,
    historicalRepaymentSummary: any = null
  ) {
    return (
      shouldApproveAndDisburse &&
      this.isIvyTekSourceLoanRecord(row) &&
      balanceNow !== null &&
      balanceNow > 0 &&
      !shouldCloseAfterDisbursement &&
      !this.shouldPostIvyTekHistoricalRepayments(historicalRepaymentSummary)
    );
  }

  /**
   * Checks whether Fineract should avoid generating historical accrued interest for this migration snapshot.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether import should activate loans.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   * @param {any} historicalRepaymentSummary Historical payment rows grouped for this loan.
   */
  private isIvyTekLoanInterestAccrualSuppressed(
    row: any,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean,
    historicalRepaymentSummary: any = null
  ) {
    return this.shouldUseIvyTekStaticLoanSnapshot();
  }

  /**
   * Gets the fixed payment amount from IvyTek note/payment fields.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekFixedEmiAmount(row: any): number | null {
    return this.getFirstIvyTekPositiveDecimal(row, [
      'IvytekTestPkg__Note__c',
      'IvytekTestPkg__Next_Payment_Note__c',
      'IvytekTestPkg__RunningMinDue__c',
      'IvytekTestPkg__FirstPayAmount__c'
    ]);
  }

  /**
   * Gets the IvyTek company code from source fields.
   * @param {any} row IvyTek source row.
   */
  private getIvyTekCompanyCode(row: any): string {
    const rawCompany = this.getFirstCsvValue(row, [
      'IvyTekClientCompanyCode',
      'CompanyWS__c',
      'Company__c',
      'IvytekTestPkg__CompanyWS__c',
      'IvytekTestPkg__Company__c',
      'IvytekTestPkg__Company_WS__c',
      'Company',
      'Company WS'
    ]);
    const leadingCompanyNumber = rawCompany.match(/\d+/)?.[0] || '';
    const parsedCompanyNumber = this.parseIvyTekInteger(leadingCompanyNumber);
    return parsedCompanyNumber !== null ? parsedCompanyNumber.toString() : rawCompany.trim();
  }

  /**
   * Gets whether Tribal Loan Data Relation should be checked.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanRelation(row: any): boolean | null {
    const relation = this.parseIvyTekBoolean(
      this.getFirstCsvValue(row, [
        'Family__c',
        'IvytekTestPkg__Family__c',
        'Relation',
        'Family',
        'Family WS'
      ])
    );
    if (relation !== null) {
      return relation;
    }

    const company = this.getFirstCsvValue(row, [
      'CompanyWS__c',
      'Company__c',
      'IvytekTestPkg__CompanyWS__c',
      'IvytekTestPkg__Company__c',
      'IvytekTestPkg__Company_WS__c'
    ]);
    return company.toLowerCase().includes('family') ? true : null;
  }

  /**
   * Gets the Tribal Loan Data mortgage code value.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanMortgageCode(row: any): string {
    return this.getFirstCsvValue(row, [
      'Mortgage_Code__c',
      'IvytekTestPkg__Mortgage_Code__c',
      'Mortgage Code',
      'MortgageCode',
      'Mortgage_Code'
    ]);
  }

  /**
   * Gets the Tribal Loan Data loan group value.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanGroup(row: any): string {
    return this.normalizeIvyTekLoanGroup(
      this.getFirstCsvValue(row, [
        'Loan_GroupWS__c',
        'IvytekTestPkg__Loan_GroupWS__c',
        'IvytekTestPkg__Loan_Group_WS__c',
        'Loan_Group__c',
        'IvytekTestPkg__Loan_Group__c',
        'Loan Group',
        'LoanGroup',
        'Loan_Group'
      ])
    );
  }

  /**
   * Gets the Tribal Loan Data per-capita deduction amount.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanPercap(row: any): number | null {
    return this.getFirstIvyTekDecimal(row, [
      'Per_Capita_WS__c',
      'IvytekTestPkg__Per_Capita_WS__c',
      'PerCap_WS__c',
      'Percap_WS__c',
      'PerCapita',
      'Percapita',
      'Percap',
      'Per Capita',
      'Per_Capita'
    ]);
  }

  /**
   * Gets the IvyTek per-diem amount, which is distinct from per-capita.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanPerDiemAmount(row: any): number | null {
    return this.getFirstIvyTekDecimal(row, [
      'IvytekTestPkg__Per_Diem_Amount__c',
      'Per_Diem_Amount',
      'PerDiemAmount',
      'Per Diem Amount'
    ]);
  }

  /**
   * Gets the Tribal Loan Data pension deduction amount.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanPension(row: any): number | null {
    return this.getFirstIvyTekDecimal(row, [
      'Pension_WS__c',
      'IvytekTestPkg__Pension_WS__c',
      'Pension__c',
      'Pension'
    ]);
  }

  /**
   * Gets the Tribal Loan Data payroll deduction amount.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanPayroll(row: any): number | null {
    return this.getFirstIvyTekDecimal(row, [
      'Payroll_Deduction_WS__c',
      'IvytekTestPkg__Payroll_Deduction_WS__c',
      'Payroll_WS__c',
      'Payroll__c',
      'Payroll Deduction',
      'Payroll'
    ]);
  }

  /**
   * Gets the IvyTek total amount due snapshot value.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanAmountNowDueAll(row: any): number | null {
    return this.getFirstIvyTekDecimal(row, [
      'IvytekTestPkg__AmtNowDueAll__c',
      'AmtNowDueAll',
      'Amount Now Due All',
      'Amount Now Due'
    ]);
  }

  /**
   * Gets mapped loan values for review and CSV export.
   * @param {any} row IvyTek loan row.
   * @param {string} productName Mifos loan product name.
   * @param {number | null} principal Original principal amount.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {number | null} repayments Number of repayments.
   */
  private getIvyTekLoanMappedValues(
    row: any,
    productName: string,
    principal: number | null,
    balanceNow: number | null,
    repayments: number | null
  ) {
    const frequency = this.getIvyTekRepaymentFrequency(row);
    const relation = this.getIvyTekLoanRelation(row);
    const office = this.getIvyTekOfficeForRow(row);
    return {
      customerName: this.getIvyTekCustomerNameCandidates(row)[0],
      accountNo: this.getIvyTekLegacyLoanId(row),
      productName,
      accountStatus: this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c'),
      originalPrincipal: principal ?? '',
      balanceNow: balanceNow ?? '',
      snapshotPrincipalOutstanding: balanceNow ?? '',
      amountNowDueAll: this.getIvyTekLoanAmountNowDueAll(row) ?? '',
      requiresSqlSnapshotImport: '',
      restLifecycleSuppressed: 'No',
      contractRateDecimal: this.getIvyTekLoanContractRateDecimal(row) ?? '',
      contractRatePercent: this.getIvyTekLoanContractRatePercent(row) ?? '',
      interestRatePercent: this.getIvyTekLoanInterestRatePercent(row),
      interestRateFrequencyType: 'Per year',
      accruedInterestAll:
        this.getFirstIvyTekDecimal(row, [
          'IvytekTestPkg__AccruedInterestAll__c',
          'Accrued Interest',
          'AccruedInterestAll'
        ]) ?? '',
      backInterestDue:
        this.getFirstIvyTekDecimal(row, [
          'IvytekTestPkg__BackInterestDue__c',
          'Back Interest Due',
          'BackInterestDue'
        ]) ?? '',
      deferredInterestDue:
        this.getFirstIvyTekDecimal(row, [
          'IvytekTestPkg__Deferred_Interest_Due__c',
          'Deferred Interest Due',
          'DeferredInterestDue'
        ]) ?? '',
      projectedAccruedInterest:
        this.getFirstIvyTekDecimal(row, [
          'IvytekTestPkg__ProjectedAccruedInterest__c',
          'Calculated Interest',
          'Projected Accrued Interest',
          'ProjectedAccruedInterest'
        ]) ?? '',
      nextPaymentInterestDue:
        this.getFirstIvyTekDecimal(row, [
          'IvytekTestPkg__Next_Payment_Interest_Due__c',
          'Next Payment Interest Due',
          'NextPaymentInterestDue'
        ]) ?? '',
      numberOfRepayments: repayments ?? '',
      repaymentEvery: frequency.every,
      repaymentFrequencyType: frequency.label,
      fixedPaymentAmount: this.getIvyTekFixedEmiAmount(row) ?? '',
      currentPaymentProcessingType: this.getCsvValue(row, 'IvytekTestPkg__CurrentPaymentProcessingType__c'),
      delinquentAmountAll:
        this.getFirstIvyTekDecimal(row, [
          'IvytekTestPkg__DelinquentAmountAll__c',
          'Delinquent Amount All',
          'DelinquentAmountAll'
        ]) ?? '',
      sourceLastInterestDate: this.getCsvValue(row, 'IvytekTestPkg__LastInterestDate__c'),
      sourceLoanDate: this.getIvyTekSourceLoanDate(row),
      sourceMaturityDate: this.getIvyTekSourceMaturityDate(row),
      sourceNextPaymentDate: this.getCsvValue(row, 'IvytekTestPkg__Next_Payment_Date__c'),
      sourceNextPaymentNote: this.getCsvValue(row, 'IvytekTestPkg__Next_Payment_Note__c'),
      sourceRegularNote: this.getCsvValue(row, 'IvytekTestPkg__Note__c'),
      sourceCompanyCode: this.getIvyTekCompanyCode(row),
      companyOfficeId: office?.id || '',
      companyOfficeName: office?.name || '',
      tribalRelation: relation === null ? '' : relation ? 'Yes' : 'No',
      tribalMortgageCode: this.getIvyTekLoanMortgageCode(row),
      tribalLoanGroup: this.getIvyTekLoanGroup(row),
      perDiemAmount: this.getIvyTekLoanPerDiemAmount(row) ?? '',
      tribalPercap: this.getIvyTekLoanPercap(row) ?? '',
      tribalPension: this.getIvyTekLoanPension(row) ?? '',
      tribalPayroll: this.getIvyTekLoanPayroll(row) ?? ''
    };
  }

  /**
   * Validates source fields used by loan payload mapping.
   * @param {any} row IvyTek loan row.
   * @param {number | null} principal Original principal amount.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private getIvyTekLoanMappedValueReviewMessage(
    row: any,
    principal: number | null,
    balanceNow: number | null,
    repayments: number | null = null
  ) {
    if (balanceNow === null) {
      return 'Missing IvyTek current balance. Check IvytekTestPkg__BalanceNow__c.';
    }

    if (!this.getIvyTekLoanDate(row)) {
      return 'Missing historical loan date. Exact IvyTek import will not use the current business date as a fallback.';
    }

    if (!principal || principal <= 0) {
      return this.getIvyTekPrincipalReviewMessage(row);
    }

    const repaymentCountReviewMessage = this.getIvyTekRepaymentCountReviewMessage(row, repayments);
    if (repaymentCountReviewMessage) {
      return repaymentCountReviewMessage;
    }

    return '';
  }

  /**
   * Flags an implausible repayment count by cross-checking it against the
   * IvyTek-reported maturity date. Number_of_Payments__c/Term__c for old
   * legacy loans is unreliable (e.g. 730 read as 730 monthly installments,
   * producing a 61-year schedule) — when a maturity date disagrees sharply
   * with the source count, send the loan to review instead of importing
   * a schedule that runs decades past the loan's actual term.
   * @param {any} row IvyTek loan row.
   * @param {number | null} repayments Repayment count resolved from the source row.
   */
  private getIvyTekRepaymentCountReviewMessage(row: any, repayments: number | null): string {
    if (!repayments || repayments <= 0) {
      return '';
    }

    const loanDate = this.parseIvyTekDate(this.getIvyTekSourceLoanDate(row));
    const maturityDate = this.parseIvyTekDate(this.getIvyTekSourceMaturityDate(row));
    if (!loanDate || !maturityDate || maturityDate.getTime() <= loanDate.getTime()) {
      // No maturity date to cross-check against — fall back to an absolute sanity cap
      // (600 periods covers a 50-year monthly loan, far beyond any real product here).
      if (repayments > 600) {
        return (
          `Implausible repayment count (${repayments}) with no maturity date to verify it against. ` +
          `Checked IvytekTestPkg__MatDate__c/MaturityDate__c.`
        );
      }
      return '';
    }

    const frequency = this.getIvyTekRepaymentFrequency(row);
    const totalDays = Math.round((maturityDate.getTime() - loanDate.getTime()) / (24 * 60 * 60 * 1000));

    // "Semi Monthly" (twice a month) is not recognized by getIvyTekRepaymentFrequency() — it falls
    // through to monthly — so the derived count would be half the real value and every semi-monthly
    // loan would be falsely flagged. Detect it directly from the source field and use 15.2 days/period.
    const rawPaymentFrequency = (this.getCsvValue(row, 'IvytekTestPkg__Payment_Frequency__c') || '').toLowerCase();
    const isSemiMonthly = rawPaymentFrequency.includes('semi');
    const frequencyLabel = isSemiMonthly ? 'semi-monthly' : frequency.label.toLowerCase();
    const periodDays = isSemiMonthly ? 15.2 : frequency.type === 1 ? frequency.every * 7 : frequency.every * 30.4;

    const maturityDerivedRepayments = Math.max(1, Math.round(totalDays / periodDays));

    if (repayments > maturityDerivedRepayments * 2 && repayments - maturityDerivedRepayments > 6) {
      return (
        `Repayment count (${repayments}) is far larger than the ${maturityDerivedRepayments} ${frequencyLabel} ` +
        `installments implied by the loan date (${this.getIvyTekSourceLoanDate(row)}) and maturity date ` +
        `(${this.getIvyTekSourceMaturityDate(row)}). Verify IvytekTestPkg__Number_of_Payments__c/Term__c before importing.`
      );
    }

    return '';
  }

  /**
   * Checks money values with cent-level tolerance.
   * @param {number} first First value.
   * @param {number} second Second value.
   */
  private areIvyTekMoneyValuesEqual(first: number, second: number) {
    return Math.abs(first - second) < 0.005;
  }

  /**
   * Rounds an IvyTek money value to cents before sending it to Fineract.
   * @param {number} value Money value.
   */
  private roundIvyTekMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  /**
   * Gets the principal amount sent to Fineract for an IvyTek loan snapshot.
   * @param {any} row IvyTek loan row.
   * @param {number | null} principal IvyTek original principal amount.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether the importer will activate the loan.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   */
  /**
   * Builds the history-start re-origination plan for a migrated loan (approach A).
   *
   * Active loans with recorded IvyTek payment history are re-originated at their first
   * recorded repayment date with the reconstructed opening balance (BalanceNow + total
   * amount paid since), disbursed in full so Fineract generates a native, serviceable
   * schedule. Posting the payment history then reduces the balance back to BalanceNow,
   * keeping principal exactly 1:1. Loans without usable history — and non-active loans
   * that will be paid off and closed — disburse at the recent reconciliation date rather
   * than the decades-old origination, which would otherwise make interest recalculation
   * recompute the whole gap and hang servicing. Returns null when no native disbursement
   * applies (history-start mode off, or the loan is not being disbursed).
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current principal outstanding.
   * @param {any} historicalRepaymentSummary Grouped IvyTek payment history for this loan.
   * @param {number | null} originalPrincipal IvyTek original principal amount.
   * @param {number | null} sourceRepayments IvyTek number of payments.
   * @param {boolean} shouldApproveAndDisburse Whether the import activates this loan.
   * @param {boolean} shouldCloseAfterDisbursement Whether this loan is closed after disbursement.
   */
  private getIvyTekHistoryStartPlan(
    row: any,
    balanceNow: number | null,
    historicalRepaymentSummary: any,
    originalPrincipal: number | null,
    sourceRepayments: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean
  ): { principal: number; disbursementDate: string; numberOfRepayments: number } | null {
    if (!this.ivyTekHistoryStartImport || !shouldApproveAndDisburse) {
      return null;
    }

    const frequency = this.getIvyTekRepaymentFrequency(row);
    const reconciliationDate = this.parseIvyTekDate(this.getIvyTekReconciliationDateString()) || new Date();
    const format = (date: Date) => this.dateUtils.formatDate(date, this.settingsService.dateFormat);
    const hasHistory =
      !!historicalRepaymentSummary?.count &&
      historicalRepaymentSummary.totalAmount > 0 &&
      !!historicalRepaymentSummary.firstDate;

    if (hasHistory && !shouldCloseAfterDisbursement) {
      const openingBalance = this.roundIvyTekMoney((balanceNow ?? 0) + historicalRepaymentSummary.totalAmount);
      const firstDate = this.parseIvyTekDate(historicalRepaymentSummary.firstDate);
      const disbursementDate = firstDate ? new Date(firstDate) : new Date(reconciliationDate);
      // Anchor the disbursement one repayment period before the first payment so the
      // schedule's first instalment lines up with it and there is no empty gap to recompute.
      if (firstDate) {
        if (frequency.type === 1) {
          disbursementDate.setDate(disbursementDate.getDate() - 7 * frequency.every);
        } else {
          disbursementDate.setMonth(disbursementDate.getMonth() - frequency.every);
        }
      }
      // Size the schedule to span the recorded payment history (disbursement -> last
      // payment) plus a small go-forward buffer, so every payment lands on an instalment
      // without inflating the schedule. The previous balanceNow/median payoff estimate
      // produced 200-300 instalment schedules on large-balance loans, and each of a loan's
      // (up to 100+) reprocessing repayment posts scales with schedule length — the measured
      // cause of the overnight import only reaching a third. The closing interest reschedule
      // sets the true remaining term.
      const lastDate = this.parseIvyTekDate(historicalRepaymentSummary.lastDate);
      let spanPeriods = historicalRepaymentSummary.count;
      if (firstDate && lastDate && lastDate.getTime() > firstDate.getTime()) {
        if (frequency.type === 1) {
          spanPeriods = Math.round((lastDate.getTime() - firstDate.getTime()) / (7 * frequency.every * 86400000)) + 1;
        } else {
          const months =
            (lastDate.getFullYear() - firstDate.getFullYear()) * 12 + (lastDate.getMonth() - firstDate.getMonth());
          spanPeriods = Math.round(months / frequency.every) + 1;
        }
      }
      const numberOfRepayments = Math.max(spanPeriods, 1) + 6;
      if (openingBalance > 0) {
        return { principal: openingBalance, disbursementDate: format(disbursementDate), numberOfRepayments };
      }
    }

    const openingBalance = shouldCloseAfterDisbursement
      ? (originalPrincipal ?? balanceNow)
      : (balanceNow ?? originalPrincipal);
    if (openingBalance === null || openingBalance <= 0) {
      return null;
    }
    const numberOfRepayments = sourceRepayments || historicalRepaymentSummary?.count || 12;
    return {
      principal: this.roundIvyTekMoney(openingBalance),
      disbursementDate: format(reconciliationDate),
      numberOfRepayments
    };
  }

  /**
   * Gets a loan's approved/disbursable principal for a native (full) disbursement amount.
   * @param {any} loan Loan account response.
   */
  private getIvyTekApprovedPrincipal(loan: any): number | null {
    const value =
      loan?.approvedPrincipal ?? loan?.principal ?? loan?.proposedPrincipal ?? loan?.summary?.principalDisbursed;
    return value === undefined || value === null ? null : this.parseIvyTekDecimal(value.toString());
  }

  private getIvyTekLoanPayloadPrincipal(
    row: any,
    principal: number | null,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean
  ): number | null {
    if (
      this.shouldUseIvyTekStaticLoanSnapshot() &&
      shouldApproveAndDisburse &&
      !shouldCloseAfterDisbursement &&
      balanceNow !== null &&
      balanceNow > 0
    ) {
      return balanceNow;
    }
    return principal;
  }

  /**
   * Gets the amount added to principal so an active snapshot can carry BalanceNow.
   * @param {number | null} principal IvyTek original principal amount.
   * @param {number | null} payloadPrincipal Principal amount sent to Fineract.
   */
  private getIvyTekPrincipalSnapshotAdjustment(
    principal: number | null,
    payloadPrincipal: number | null
  ): number | null {
    return null;
  }

  /**
   * Gets the source principal already paid on an active IvyTek snapshot loan.
   * @param {any} row IvyTek loan row.
   * @param {number | null} principal Principal amount sent to Fineract.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether the importer will activate the loan.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   */
  private getIvyTekActiveLoanMigrationPrincipalPaid(
    row: any,
    principal: number | null,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean
  ): number | null {
    return null;
  }

  /**
   * Gets the current principal outstanding from a loan account response.
   * @param {any} loan Loan account response.
   */
  private getIvyTekLoanSummaryPrincipalOutstanding(loan: any): number | null {
    const values = [
      loan?.summary?.principalOutstanding,
      loan?.summary?.totalPrincipalOutstanding,
      loan?.summary?.outstandingPrincipal,
      loan?.summary?.principalBalance,
      loan?.repaymentSchedule?.totalPrincipalOutstanding,
      loan?.repaymentSchedule?.totalOutstandingPrincipal,
      loan?.principalOutstanding
    ];
    const parsedValue = values
      .map((value: any) => this.parseIvyTekDecimal((value ?? '').toString()))
      .find((value: number | null) => value !== null);
    return parsedValue ?? null;
  }

  /**
   * Stores actual post-import Mifos loan summary values for reconciliation.
   * @param {any} result IvyTek loan result.
   * @param {string} loanId Mifos loan id.
   */
  private async setIvyTekLoanImportedSnapshotResult(result: any, loanId: string, row: any = null, payload: any = null) {
    if (!loanId) {
      return;
    }

    const loan = await this.getIvyTekLoanForLifecycle(loanId);
    if (!loan) {
      if (this.shouldUseIvyTekStaticLoanSnapshot() && row) {
        const importedValues = this.getIvyTekStaticLoanImportedSnapshotValues(row, {});
        result.importedValues = {
          ...result.importedValues,
          ...importedValues,
          snapshotReadStatus: 'Unavailable'
        };
        this.setIvyTekLoanSnapshotValidationResult(result, row, importedValues);
        await this.restoreIvyTekLoanInterestRateForStaticImport(result, loanId, row, payload, null);
        return;
      }
      result.importedValues = {
        ...result.importedValues,
        snapshotReadStatus: 'Unavailable'
      };
      return;
    }

    const importedValues = this.getIvyTekLoanImportedSnapshotValues(loan, row);
    result.importedValues = {
      ...result.importedValues,
      ...importedValues
    };
    this.setIvyTekLoanSnapshotValidationResult(result, row || result.row, importedValues);
    await this.restoreIvyTekLoanInterestRateForStaticImport(result, loanId, row || result.row, payload, loan);
  }

  /**
   * Restores the real IvyTek interest rate during static import while REST can still edit loan terms.
   * @param {any} result IvyTek loan result.
   * @param {string} loanId Mifos loan id.
   * @param {any} row IvyTek loan row.
   * @param {any} payload Original loan payload.
   * @param {any} loan Loan response read before rate restoration.
   */
  private async restoreIvyTekLoanInterestRateForStaticImport(
    result: any,
    loanId: string,
    row: any,
    payload: any,
    loan: any
  ) {
    if (
      !this.shouldUseIvyTekStaticLoanSnapshot() ||
      this.ivyTekHistoryStartImport ||
      !row ||
      !payload ||
      result.status === 'labels.inputs.Failed'
    ) {
      return;
    }

    const sourceInterestRatePercent = this.getIvyTekLoanInterestRatePercent(row);
    const payloadInterestRatePercent = this.parseIvyTekDecimal((payload.interestRatePerPeriod ?? '').toString());
    const preStage6InterestRatePercent = this.getIvyTekLoanAccountInterestRatePercent(loan);
    let postStage6InterestRatePercent = preStage6InterestRatePercent;
    let outcome = 'Matched';
    let correctionAction = '';
    let restorationMethod = 'Already Matched';

    try {
      if (!this.areIvyTekRateValuesEqual(preStage6InterestRatePercent, sourceInterestRatePercent)) {
        const ratePayload = this.getIvyTekLoanPayloadWithInterestRate(payload, sourceInterestRatePercent);
        await firstValueFrom(this.loansService.updateLoansAccount('loans', loanId, ratePayload));
        restorationMethod = 'REST';
        const updatedLoan = await this.getIvyTekLoanForLifecycle(loanId);
        postStage6InterestRatePercent = this.getIvyTekLoanAccountInterestRatePercent(updatedLoan);
      }

      if (!this.areIvyTekRateValuesEqual(postStage6InterestRatePercent, sourceInterestRatePercent)) {
        outcome = 'Needs Correction';
        correctionAction =
          'Fineract accepted the rate update, but the loan read-back did not match IvyTek. Route this loan through controlled SQL/staging rate correction.';
      }
    } catch (error: any) {
      outcome = 'Needs SQL/Staging';
      restorationMethod = 'REST Failed';
      correctionAction = `REST could not restore the IvyTek rate after static snapshot validation: ${this.getErrorMessage(error)}. Route this loan through controlled SQL/staging rate correction without changing historical balances.`;
    }

    this.setIvyTekLoanInterestRateRestorationResult(result, {
      outcome,
      sourceInterestRatePercent,
      payloadInterestRatePercent,
      preStage6InterestRatePercent,
      postStage6InterestRatePercent,
      restorationMethod,
      correctionAction
    });
  }

  /**
   * Records Stage 6 interest-rate restoration diagnostics.
   * @param {any} result IvyTek loan result.
   * @param {any} values Stage 6 values.
   */
  private setIvyTekLoanInterestRateRestorationResult(result: any, values: any) {
    const difference = this.getIvyTekRateDifference(
      values.postStage6InterestRatePercent,
      values.sourceInterestRatePercent
    );
    result.validationValues = {
      ...result.validationValues,
      stage6InterestRateStage: 'Stage 6 Interest Rate Restoration',
      stage6InterestRateOutcome: values.outcome,
      sourceInterestRatePercent: values.sourceInterestRatePercent,
      temporaryPayloadInterestRatePercent: values.payloadInterestRatePercent ?? '',
      preStage6InterestRatePercent: values.preStage6InterestRatePercent ?? '',
      postStage6InterestRatePercent: values.postStage6InterestRatePercent ?? '',
      interestRateDifference: difference ?? '',
      interestRateRestorationMethod: values.restorationMethod,
      interestRateCorrectionAction: values.correctionAction
    };
    result.mappedValues = {
      ...result.mappedValues,
      finalInterestRatePercent: values.sourceInterestRatePercent,
      finalInterestRateRestoration: values.outcome
    };

    const message = this.getIvyTekLoanInterestRateRestorationMessage(result.validationValues);
    if (message) {
      this.setIvyTekLoanResultStatus(
        result,
        values.outcome === 'Matched' ? result.status : 'labels.inputs.Warning',
        this.joinIvyTekMessages([
          result.message,
          message
        ])
      );
    }
  }

  /**
   * Builds a readable Stage 6 interest-rate restoration message.
   * @param {any} validationValues Stage 6 validation values.
   */
  private getIvyTekLoanInterestRateRestorationMessage(validationValues: any): string {
    if (!validationValues?.stage6InterestRateOutcome) {
      return '';
    }
    if (validationValues.stage6InterestRateOutcome === 'Matched') {
      return `Stage 6 interest rate restoration matched: loan rate is ${this.formatIvyTekRatePercent(validationValues.sourceInterestRatePercent)}%.`;
    }
    return `Stage 6 interest rate restoration needs correction: IvyTek rate ${this.formatIvyTekRatePercent(validationValues.sourceInterestRatePercent)}%, Mifos read-back ${this.formatIvyTekRatePercent(validationValues.postStage6InterestRatePercent)}%. ${validationValues.interestRateCorrectionAction}`;
  }

  /**
   * Creates an otherwise identical loan payload with the final IvyTek interest rate.
   * @param {any} payload Original loan payload.
   * @param {number} interestRatePercent IvyTek source annual interest rate percentage.
   */
  private getIvyTekLoanPayloadWithInterestRate(payload: any, interestRatePercent: number) {
    return {
      ...payload,
      interestRatePerPeriod: interestRatePercent,
      interestRateFrequencyType: this.ivyTekAnnualInterestRateFrequencyType,
      dateFormat: this.settingsService.dateFormat,
      locale: this.settingsService.language.code
    };
  }

  /**
   * Builds actual imported Mifos loan values used by reconciliation.
   * @param {any} loan Mifos loan response.
   */
  private getIvyTekLoanImportedSnapshotValues(loan: any, row: any = null) {
    const principalOutstanding = this.getIvyTekLoanSummaryPrincipalOutstanding(loan);
    const interestOutstanding = this.getIvyTekLoanSummaryInterestOutstanding(loan);
    const feesOutstanding = this.getIvyTekLoanSummaryFeesOutstanding(loan);
    const penaltiesOutstanding = this.getIvyTekLoanSummaryPenaltiesOutstanding(loan);
    const totalOutstanding = this.getIvyTekLoanSummaryTotalOutstanding(
      loan,
      principalOutstanding,
      interestOutstanding,
      feesOutstanding,
      penaltiesOutstanding
    );
    const liveValues = {
      accountStatus: this.getIvyTekLoanStatusLabel(loan),
      balanceNow: totalOutstanding ?? '',
      totalOutstanding: totalOutstanding ?? '',
      principalOutstanding: principalOutstanding ?? '',
      interestOutstanding: interestOutstanding ?? '',
      feeChargesOutstanding: feesOutstanding ?? '',
      penaltyChargesOutstanding: penaltiesOutstanding ?? ''
    };

    if (this.shouldUseIvyTekStaticLoanSnapshot() && row) {
      return this.getIvyTekStaticLoanImportedSnapshotValues(row, liveValues);
    }

    return liveValues;
  }

  /**
   * Builds imported values from IvyTek static snapshots while preserving Fineract live values for audit.
   * @param {any} row IvyTek loan row.
   * @param {any} liveValues Fineract-calculated values read from the loan account.
   */
  private getIvyTekStaticLoanImportedSnapshotValues(row: any, liveValues: any) {
    const sourcePrincipalOutstanding = this.getIvyTekLoanBalanceNow(row);
    const sourceInterestOutstanding = this.getIvyTekLoanHistoricalInterestOutstanding(row);
    const sourceDerivedTotalOutstanding =
      sourcePrincipalOutstanding !== null && sourceInterestOutstanding !== null
        ? this.roundIvyTekMoney(sourcePrincipalOutstanding + sourceInterestOutstanding)
        : sourcePrincipalOutstanding;

    return {
      snapshotStorageMode: 'Static IvyTek source snapshot',
      accountStatus: this.getIvyTekStaticLoanStatusLabel(row),
      balanceNow: sourceDerivedTotalOutstanding ?? '',
      totalOutstanding: sourceDerivedTotalOutstanding ?? '',
      principalOutstanding: sourcePrincipalOutstanding ?? '',
      interestOutstanding: sourceInterestOutstanding ?? '',
      feeChargesOutstanding: '',
      penaltyChargesOutstanding: '',
      fineractAccountStatus: liveValues.accountStatus,
      fineractBalanceNow: liveValues.balanceNow,
      fineractTotalOutstanding: liveValues.totalOutstanding,
      fineractPrincipalOutstanding: liveValues.principalOutstanding,
      fineractInterestOutstanding: liveValues.interestOutstanding,
      fineractFeeChargesOutstanding: liveValues.feeChargesOutstanding,
      fineractPenaltyChargesOutstanding: liveValues.penaltyChargesOutstanding
    };
  }

  /**
   * Gets the IvyTek account status label to use in static snapshot mode.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekStaticLoanStatusLabel(row: any): string {
    return this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c') || 'Static Snapshot';
  }

  /**
   * Stores strict stage validation values after a loan has been imported and read back from Mifos.
   * @param {any} result IvyTek loan import result.
   * @param {any} row IvyTek loan row.
   * @param {any} importedValues Actual Mifos loan values.
   */
  private setIvyTekLoanSnapshotValidationResult(result: any, row: any, importedValues: any) {
    if (!row) {
      return;
    }

    const validationValues = this.getIvyTekLoanSnapshotValidationValues(row, importedValues);
    result.validationValues = {
      ...result.validationValues,
      ...validationValues
    };

    const validationMessage = this.getIvyTekLoanSnapshotValidationMessage(validationValues);
    if (validationMessage && result.status !== 'labels.inputs.Failed') {
      this.setIvyTekLoanResultStatus(
        result,
        validationValues.outcome === 'Matched' ? result.status : 'labels.inputs.Warning',
        this.joinIvyTekMessages([
          result.message,
          validationMessage
        ])
      );
    }
  }

  /**
   * Builds post-import validation values for the active/closed IvyTek loan snapshot.
   * @param {any} row IvyTek loan row.
   * @param {any} importedValues Actual Mifos loan values.
   */
  private getIvyTekLoanSnapshotValidationValues(row: any, importedValues: any) {
    const sourcePrincipalOutstanding = this.getIvyTekLoanBalanceNow(row);
    const sourceInterestOutstanding = this.getIvyTekLoanHistoricalInterestOutstanding(row);
    const sourceDerivedTotalOutstanding =
      sourcePrincipalOutstanding !== null && sourceInterestOutstanding !== null
        ? this.roundIvyTekMoney(sourcePrincipalOutstanding + sourceInterestOutstanding)
        : null;
    const importedPrincipalOutstanding = this.parseIvyTekDecimal(
      (importedValues.principalOutstanding ?? '').toString()
    );
    const importedInterestOutstanding = this.parseIvyTekDecimal((importedValues.interestOutstanding ?? '').toString());
    const importedTotalOutstanding = this.parseIvyTekDecimal((importedValues.totalOutstanding ?? '').toString());
    const staticSnapshotMode = this.shouldUseIvyTekStaticLoanSnapshot();
    const shouldCloseAfterDisbursement = this.shouldCloseIvyTekLoanAfterDisbursement(row, sourcePrincipalOutstanding);
    const expectedLifecycleStatus = staticSnapshotMode
      ? this.getIvyTekExpectedFineractLifecycleStatus(row, sourcePrincipalOutstanding)
      : shouldCloseAfterDisbursement
        ? 'Closed'
        : 'Active';
    const importedLifecycleStatus = staticSnapshotMode
      ? importedValues.fineractAccountStatus || ''
      : importedValues.accountStatus || '';
    const principalDifference = this.getIvyTekMoneyDifference(importedPrincipalOutstanding, sourcePrincipalOutstanding);
    const interestDifference = this.getIvyTekMoneyDifference(importedInterestOutstanding, sourceInterestOutstanding);
    const totalDifference = this.getIvyTekMoneyDifference(importedTotalOutstanding, sourceDerivedTotalOutstanding);
    const principalMatches = this.isIvyTekValidationMatch(importedPrincipalOutstanding, sourcePrincipalOutstanding);
    const interestMatches = this.isIvyTekValidationMatch(importedInterestOutstanding, sourceInterestOutstanding);
    const totalMatches = this.isIvyTekValidationMatch(importedTotalOutstanding, sourceDerivedTotalOutstanding);
    const lifecycleStatusMatches = this.doesIvyTekImportedLoanStatusMatchExpected(
      importedLifecycleStatus,
      expectedLifecycleStatus
    );
    const corrections = [
      principalMatches ? '' : 'Principal snapshot correction required',
      interestMatches ? '' : 'Interest snapshot correction or waiver required',
      totalMatches ? '' : 'Total outstanding correction required',
      lifecycleStatusMatches ? '' : 'Lifecycle status correction required'
    ].filter((message: string) => !!message);

    return {
      stage: 'Stage 4 Balance Validation',
      outcome: corrections.length ? 'Needs Correction' : 'Matched',
      sourceBalanceNowPrincipal: sourcePrincipalOutstanding ?? '',
      sourceInterestOutstanding: sourceInterestOutstanding ?? '',
      sourceDerivedTotalOutstanding: sourceDerivedTotalOutstanding ?? '',
      importedPrincipalOutstanding: importedPrincipalOutstanding ?? '',
      importedInterestOutstanding: importedInterestOutstanding ?? '',
      importedTotalOutstanding: importedTotalOutstanding ?? '',
      staticSnapshotMode: staticSnapshotMode ? 'Yes' : 'No',
      principalDifference: principalDifference ?? '',
      interestDifference: interestDifference ?? '',
      totalDifference: totalDifference ?? '',
      expectedLifecycleStatus,
      importedLifecycleStatus,
      lifecycleStatusMatches: lifecycleStatusMatches ? 'Yes' : 'No',
      correctionAction: corrections.join('; ')
    };
  }

  /**
   * Gets imported-minus-source money difference when both values exist.
   * @param {number | null} importedValue Imported Mifos value.
   * @param {number | null} sourceValue IvyTek source value.
   */
  private getIvyTekMoneyDifference(importedValue: number | null, sourceValue: number | null): number | null {
    if (importedValue === null || sourceValue === null) {
      return null;
    }
    return this.roundIvyTekMoney(importedValue - sourceValue);
  }

  /**
   * Gets a high-precision imported-minus-source rate difference.
   * @param {number | null} importedValue Imported Mifos rate.
   * @param {number | null} sourceValue IvyTek source rate.
   */
  private getIvyTekRateDifference(importedValue: number | null, sourceValue: number | null): number | null {
    if (importedValue === null || sourceValue === null) {
      return null;
    }
    return Math.round((importedValue - sourceValue + Number.EPSILON) * 1000000) / 1000000;
  }

  /**
   * Checks if a source/imported validation pair matches at cent level.
   * @param {number | null} importedValue Imported Mifos value.
   * @param {number | null} sourceValue IvyTek source value.
   */
  private isIvyTekValidationMatch(importedValue: number | null, sourceValue: number | null): boolean {
    if (importedValue === null || sourceValue === null) {
      return importedValue === null && sourceValue === null;
    }
    return this.areIvyTekMoneyValuesEqual(importedValue, sourceValue);
  }

  /**
   * Checks if two interest-rate values match without cent rounding.
   * @param {number | null} first First rate.
   * @param {number | null} second Second rate.
   */
  private areIvyTekRateValuesEqual(first: number | null, second: number | null): boolean {
    if (first === null || second === null) {
      return first === null && second === null;
    }
    return Math.abs(first - second) < 0.000001;
  }

  /**
   * Gets the loan interest rate percentage from a Mifos loan response.
   * @param {any} loan Loan response.
   */
  private getIvyTekLoanAccountInterestRatePercent(loan: any): number | null {
    const values = [
      loan?.interestRatePerPeriod,
      loan?.annualNominalInterestRate,
      loan?.nominalAnnualInterestRate,
      loan?.nominalInterestRatePerPeriod,
      loan?.interestRate,
      loan?.summary?.interestRatePerPeriod,
      loan?.timeline?.interestRatePerPeriod
    ];
    const parsedValue = values
      .map((value: any) => this.parseIvyTekDecimal((value ?? '').toString()))
      .find((value: number | null) => value !== null);
    return parsedValue ?? null;
  }

  /**
   * Formats an interest rate without cent-style rounding.
   * @param {number | null} value Rate percentage.
   */
  private formatIvyTekRatePercent(value: any): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '(blank)';
    }
    return value.toFixed(6).replace(/\.?0+$/, '');
  }

  /**
   * Checks whether the imported Mifos loan lifecycle status matches the IvyTek expected final state.
   * @param {string} importedStatus Actual Mifos status label.
   * @param {string} expectedStatus Expected final status.
   */
  private doesIvyTekImportedLoanStatusMatchExpected(importedStatus: string, expectedStatus: string): boolean {
    const normalizedStatus = this.normalizeIvyTekText(importedStatus);
    if (!expectedStatus) {
      return !normalizedStatus;
    }
    if (expectedStatus === 'Active') {
      return [
        'active',
        'current'
      ].includes(normalizedStatus);
    }
    if (expectedStatus === 'Submitted and pending approval') {
      return normalizedStatus.includes('submitted') || normalizedStatus.includes('pendingapproval');
    }
    return normalizedStatus.includes('closed');
  }

  /**
   * Gets a readable snapshot validation message for the result row.
   * @param {any} validationValues Validation values.
   */
  private getIvyTekLoanSnapshotValidationMessage(validationValues: any): string {
    if (!validationValues?.outcome) {
      return '';
    }
    if (validationValues.outcome === 'Matched') {
      if (validationValues.staticSnapshotMode === 'Yes') {
        return 'Stage 4 static snapshot validation matched: IvyTek BalanceNow and interest were imported as static source values; Fineract-generated balances are diagnostic only.';
      }
      return 'Stage 4 balance validation matched: IvyTek BalanceNow was validated as principal outstanding, not Mifos total outstanding.';
    }
    if (validationValues.staticSnapshotMode === 'Yes') {
      return `Stage 4 static snapshot validation needs correction: IvyTek BalanceNow principal ${this.formatIvyTekNumber(validationValues.sourceBalanceNowPrincipal)} vs static imported principal ${this.formatIvyTekNumber(validationValues.importedPrincipalOutstanding)}; IvyTek interest snapshot ${this.formatIvyTekNumber(validationValues.sourceInterestOutstanding)} vs static imported interest ${this.formatIvyTekNumber(validationValues.importedInterestOutstanding)}. ${validationValues.correctionAction}.`;
    }
    return `Stage 4 balance validation needs correction: IvyTek BalanceNow principal ${this.formatIvyTekNumber(validationValues.sourceBalanceNowPrincipal)} vs Mifos principal ${this.formatIvyTekNumber(validationValues.importedPrincipalOutstanding)}; IvyTek interest snapshot ${this.formatIvyTekNumber(validationValues.sourceInterestOutstanding)} vs Mifos interest ${this.formatIvyTekNumber(validationValues.importedInterestOutstanding)}; expected lifecycle ${validationValues.expectedLifecycleStatus}, Mifos status ${validationValues.importedLifecycleStatus || '(blank)'}. ${validationValues.correctionAction}.`;
  }

  /**
   * Gets actual total outstanding/current balance from a Mifos loan response.
   * @param {any} loan Mifos loan response.
   * @param {number | null} principalOutstanding Principal outstanding fallback part.
   * @param {number | null} interestOutstanding Interest outstanding fallback part.
   * @param {number | null} feesOutstanding Fees outstanding fallback part.
   * @param {number | null} penaltiesOutstanding Penalties outstanding fallback part.
   */
  private getIvyTekLoanSummaryTotalOutstanding(
    loan: any,
    principalOutstanding: number | null = null,
    interestOutstanding: number | null = null,
    feesOutstanding: number | null = null,
    penaltiesOutstanding: number | null = null
  ): number | null {
    const values = [
      loan?.summary?.totalOutstanding,
      loan?.summary?.totalOutstandingBalance,
      loan?.summary?.outstandingBalance,
      loan?.summary?.loanBalance,
      loan?.repaymentSchedule?.totalOutstanding,
      loan?.repaymentSchedule?.totalOutstandingBalance,
      loan?.totalOutstanding,
      loan?.totalOutstandingBalance,
      loan?.outstandingBalance
    ];
    const parsedValue = values
      .map((value: any) => this.parseIvyTekDecimal((value ?? '').toString()))
      .find((value: number | null) => value !== null);
    if (parsedValue !== undefined) {
      return parsedValue;
    }

    const parts = [
      principalOutstanding,
      interestOutstanding,
      feesOutstanding,
      penaltiesOutstanding
    ].filter((value: number | null) => value !== null) as number[];
    if (!parts.length) {
      return null;
    }
    return this.roundIvyTekMoney(parts.reduce((total: number, value: number) => total + value, 0));
  }

  /**
   * Gets actual fee charges outstanding from a Mifos loan response.
   * @param {any} loan Mifos loan response.
   */
  private getIvyTekLoanSummaryFeesOutstanding(loan: any): number | null {
    const values = [
      loan?.summary?.feeChargesOutstanding,
      loan?.summary?.feesOutstanding,
      loan?.summary?.feeOutstanding,
      loan?.summary?.totalFeeChargesOutstanding,
      loan?.repaymentSchedule?.totalFeeChargesOutstanding,
      loan?.repaymentSchedule?.totalFeesOutstanding,
      loan?.feeChargesOutstanding
    ];
    const parsedValue = values
      .map((value: any) => this.parseIvyTekDecimal((value ?? '').toString()))
      .find((value: number | null) => value !== null);
    return parsedValue ?? null;
  }

  /**
   * Gets actual penalty charges outstanding from a Mifos loan response.
   * @param {any} loan Mifos loan response.
   */
  private getIvyTekLoanSummaryPenaltiesOutstanding(loan: any): number | null {
    const values = [
      loan?.summary?.penaltyChargesOutstanding,
      loan?.summary?.penaltiesOutstanding,
      loan?.summary?.penaltyOutstanding,
      loan?.summary?.totalPenaltyChargesOutstanding,
      loan?.repaymentSchedule?.totalPenaltyChargesOutstanding,
      loan?.repaymentSchedule?.totalPenaltiesOutstanding,
      loan?.penaltyChargesOutstanding
    ];
    const parsedValue = values
      .map((value: any) => this.parseIvyTekDecimal((value ?? '').toString()))
      .find((value: number | null) => value !== null);
    return parsedValue ?? null;
  }

  /**
   * Checks whether a loan row represents a paid-out historical loan.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private isIvyTekPaidOutLoan(row: any, balanceNow: number | null) {
    const accountStatus = this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c'));
    return [
        'paidout',
        'closed'
      ].includes(
        accountStatus
      ) || (!!this.getCsvValue(row, 'IvytekTestPkg__Paid_Out_Date__c') && (balanceNow || 0) <= 0);
  }

  /**
   * Determines whether a source loan row should be approved and disbursed.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private shouldApproveAndDisburseIvyTekLoan(row: any, balanceNow: number | null) {
    if (this.shouldUseIvyTekStaticLoanSnapshot()) {
      const accountStatus = this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c'));
      return (
        this.isIvyTekSourceLoanRecord(row) &&
        balanceNow !== null &&
        !!accountStatus &&
        !this.isIvyTekPendingDisbursalLoanStatus(accountStatus)
      );
    }
    return this.isIvyTekSourceLoanRecord(row) && balanceNow !== null;
  }

  /**
   * Checks whether a historical loan should be closed after disbursement.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private shouldCloseIvyTekLoanAfterDisbursement(row: any, balanceNow: number | null) {
    if (this.shouldUseIvyTekStaticLoanSnapshot()) {
      const accountStatus = this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c'));
      return (
        this.isIvyTekSourceLoanRecord(row) &&
        balanceNow !== null &&
        !!accountStatus &&
        !this.isIvyTekActiveLoanStatus(accountStatus) &&
        !this.isIvyTekPendingDisbursalLoanStatus(accountStatus)
      );
    }
    const accountStatus = this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c'));
    if (!accountStatus) {
      return this.isIvyTekPaidOutLoan(row, balanceNow);
    }
    return !this.isIvyTekActiveLoanStatus(accountStatus);
  }

  /**
   * Gets the final Fineract lifecycle status expected from the IvyTek account status.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private getIvyTekExpectedFineractLifecycleStatus(row: any, balanceNow: number | null): string {
    const accountStatus = this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c'));
    if (!accountStatus || !this.isIvyTekSourceLoanRecord(row) || balanceNow === null) {
      return '';
    }
    if (this.isIvyTekPendingDisbursalLoanStatus(accountStatus)) {
      return 'Submitted and pending approval';
    }
    return this.isIvyTekActiveLoanStatus(accountStatus) ? 'Active' : 'Closed';
  }

  /**
   * Checks whether the IvyTek account status should remain active after import.
   * @param {string} accountStatus Normalized IvyTek account status.
   */
  private isIvyTekActiveLoanStatus(accountStatus: string) {
    return [
      'active',
      'current'
    ].includes(accountStatus);
  }

  /**
   * Checks whether the IvyTek source status intentionally represents a pending, not-yet-disbursed loan.
   * @param {string} accountStatus Normalized IvyTek account status.
   */
  private isIvyTekPendingDisbursalLoanStatus(accountStatus: string) {
    return (
      accountStatus.includes('pending') ||
      accountStatus.includes('awaiting') ||
      accountStatus.includes('approval') ||
      accountStatus.includes('disbursal') ||
      accountStatus.includes('disbursement')
    );
  }

  /**
   * Checks whether the row came from the IvyTek loan object rather than an application staging row.
   * @param {any} row IvyTek loan row.
   */
  private isIvyTekSourceLoanRecord(row: any) {
    return (
      this.getCsvValue(row, '_') === '[IvytekTestPkg__Loan__c]' ||
      !!this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c') ||
      !!this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c')
    );
  }

  /**
   * Gets lifecycle handling note for loan import results.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether the importer will activate the loan.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   * @param {string} payloadLoanDate Date sent to Fineract for submission/disbursement.
   * @param {string} interestChargedFromDate Optional interest start date sent to Fineract.
   * @param {number | null} migrationPrincipalPaid Source principal already paid before migration.
   * @param {number | null} payloadPrincipal Principal amount sent to Fineract.
   */
  private getIvyTekLoanLifecycleMessage(
    row: any,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean,
    payloadLoanDate: string,
    interestChargedFromDate: string = '',
    migrationPrincipalPaid: number | null = null,
    payloadPrincipal: number | null = null,
    historicalRepaymentSummary: any = null
  ) {
    if (this.isIvyTekSourceLoanRecord(row) && balanceNow !== null) {
      if (this.shouldUseIvyTekStaticLoanSnapshot()) {
        const accountStatus = this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c'));
        const transactionMessage = historicalRepaymentSummary?.count
          ? `${historicalRepaymentSummary.count} IvyTek repayment rows are preserved as static history and are not posted through Fineract repayment automation.`
          : 'No positive IvyTek repayment rows were available in the transaction file.';
        return this.joinIvyTekMessages([
          'Static snapshot mode: IvyTek source values are imported as the historical truth; Fineract-generated balances are diagnostic only.',
          this.isIvyTekPendingDisbursalLoanStatus(accountStatus)
            ? `IvyTek status ${this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c') || '(blank)'} is pending disbursal, so the loan will remain pending.`
            : shouldCloseAfterDisbursement
              ? `IvyTek status ${this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c') || '(blank)'} is not Active, so the Mifos loan shell will be approved, disbursed, paid off, and closed.`
              : `A Mifos loan shell will be approved and disbursed for the active IvyTek principal snapshot ${this.formatIvyTekNumber(balanceNow)}.`,
          transactionMessage
        ]);
      }
      const messages = [
        `Loan was approved and disbursed on IvyTek loan date ${payloadLoanDate}.`,
        this.shouldPostIvyTekHistoricalRepayments(historicalRepaymentSummary)
          ? `${historicalRepaymentSummary.count} IvyTek repayment transactions will be posted with their source payment dates.`
          : 'No positive IvyTek repayment transactions were available for REST posting.',
        shouldCloseAfterDisbursement
          ? `IvyTek status ${this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c') || '(blank)'} is not Active, so the loan will be closed after historical repayments.`
          : `IvyTek BalanceNow ${this.formatIvyTekNumber(balanceNow)} remains the active-loan snapshot for reconciliation.`
      ];
      return this.joinIvyTekMessages(messages);
    }

    return 'Loan terms imported from IvyTek source values and moved through the REST lifecycle with IvyTek dates.';
  }

  /**
   * Builds the loan account payload for Fineract.
   * @param {any} row IvyTek loan row.
   * @param {any} client Mifos client.
   * @param {any} product Loan product.
   * @param {any} productDetails Loan product details.
   * @param {number} principal Principal amount.
   * @param {number} repayments Number of repayments.
   * @param {number} interestRatePercent Annual interest rate sent to Fineract.
   * @param {string} loanDate Loan date sent to Fineract.
   * @param {string} interestChargedFromDate Optional interest start date sent to Fineract.
   */
  private getIvyTekLoanPayload(
    row: any,
    client: any,
    product: any,
    productDetails: any,
    principal: number,
    repayments: number,
    interestRatePercent: number,
    loanDate: string = this.getIvyTekLoanDate(row),
    interestChargedFromDate: string = ''
  ) {
    const dateFormat = this.settingsService.dateFormat;
    const locale = this.settingsService.language.code;
    const frequency = this.getIvyTekRepaymentFrequency(row);
    const loanExternalId = this.getIvyTekLoanExternalId(row);
    const loanOfficerId = this.parseIvyTekInteger(this.ivyTekLoanImportForm.get('loanOfficerId').value);

    const payload: any = {
      clientId: client.id,
      productId: product.id,
      loanType: 'individual',
      submittedOnDate: loanDate,
      expectedDisbursementDate: loanDate,
      repaymentsStartingFromDate: this.getIvyTekFirstRepaymentDate(row, loanDate),
      principal,
      loanTermFrequency: repayments * frequency.every,
      loanTermFrequencyType: frequency.type,
      numberOfRepayments: repayments,
      repaymentEvery: frequency.every,
      repaymentFrequencyType: frequency.type,
      interestRatePerPeriod: interestRatePercent,
      interestRateFrequencyType: this.ivyTekAnnualInterestRateFrequencyType,
      amortizationType: productDetails?.amortizationType?.id || 1,
      interestType: productDetails?.interestType?.id || 1,
      interestCalculationPeriodType: productDetails?.interestCalculationPeriodType?.id || 0,
      transactionProcessingStrategyCode:
        productDetails?.transactionProcessingStrategyCode || 'principal-interest-penalties-fees-order-strategy',
      accountNo: this.getIvyTekLegacyLoanId(row),
      externalId: loanExternalId,
      dateFormat,
      locale
    };

    if (loanOfficerId) {
      payload.loanOfficerId = loanOfficerId;
    }
    if (interestChargedFromDate) {
      payload.interestChargedFromDate = interestChargedFromDate;
    }

    const charge = this.getIvyTekLoanCharge(row, productDetails, principal);
    if (charge) {
      payload.charges = [charge];
    }

    Object.keys(payload).forEach((key: string) => {
      if (payload[key] === '' || payload[key] === null || payload[key] === undefined) {
        delete payload[key];
      }
    });
    return payload;
  }

  /**
   * Replaces loan submission dates on a payload for client activation-date fallback.
   * @param {any} row IvyTek loan row.
   * @param {any} payload Original loan payload.
   * @param {string} loanDate Replacement loan date.
   */
  private getIvyTekLoanPayloadWithDate(row: any, payload: any, loanDate: string) {
    return {
      ...payload,
      submittedOnDate: loanDate,
      expectedDisbursementDate: loanDate,
      repaymentsStartingFromDate: this.getIvyTekFirstRepaymentDate(row, loanDate)
    };
  }

  /**
   * Moves an existing pending/approved IvyTek loan to disbursed when the import is configured to do so.
   * @param {string} loanId Mifos loan id.
   * @param {any} loan Existing loan response.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether import should activate loans.
   * @param {string} loanDate Loan date to use for approval/disbursement.
   */
  private async transitionIvyTekExistingLoanLifecycle(
    loanId: string,
    loan: any,
    row: any,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    loanDate: string = this.getIvyTekLoanDate(row),
    historicalRepaymentSummary: any = null
  ): Promise<string> {
    if (!loanId || !shouldApproveAndDisburse) {
      return '';
    }

    if (this.shouldUseIvyTekStaticLoanSnapshot()) {
      return this.transitionIvyTekStaticExistingLoanLifecycle(loanId, loan, row, balanceNow, loanDate);
    }

    const messages: string[] = [];
    let loanForLifecycle = (await this.getIvyTekLoanForLifecycle(loanId)) || loan;
    if (this.isIvyTekLoanClosed(loanForLifecycle)) {
      return 'Existing loan was already closed.';
    }

    if (!this.isIvyTekLoanActiveOrOverpaid(loanForLifecycle)) {
      if (this.isIvyTekLoanApproved(loanForLifecycle)) {
        await this.disburseIvyTekLoan(loanId, loanDate, this.getIvyTekApprovedPrincipal(loanForLifecycle));
        messages.push(`Existing approved loan was disbursed on ${loanDate}.`);
      } else if (this.canUpdateExistingIvyTekLoan(loanForLifecycle)) {
        await this.approveAndDisburseIvyTekLoan(loanId, loanDate, this.getIvyTekApprovedPrincipal(loanForLifecycle));
        messages.push(`Existing pending loan was approved and disbursed on ${loanDate}.`);
      } else {
        return 'Existing loan state prevented automatic approval/disbursement.';
      }
    }

    messages.push(
      await this.repayIvyTekActiveLoanToBalanceNow(
        loanId,
        row,
        balanceNow,
        this.getIvyTekMigrationTransactionDate(row, loanDate),
        shouldApproveAndDisburse,
        this.shouldCloseIvyTekLoanAfterDisbursement(row, balanceNow),
        historicalRepaymentSummary
      )
    );
    if (!this.shouldPostIvyTekTransactionsInStage3()) {
      messages.push(await this.settleAndCloseIvyTekNonActiveLoan(loanId, row, balanceNow, loanDate));
    }
    return this.joinIvyTekMessages(messages);
  }

  /**
   * Moves an existing static-snapshot loan to the final IvyTek lifecycle without posting repayment history.
   * @param {string} loanId Mifos loan id.
   * @param {any} loan Existing loan response.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {string} loanDate Loan date to use for approval/disbursement.
   */
  private async transitionIvyTekStaticExistingLoanLifecycle(
    loanId: string,
    loan: any,
    row: any,
    balanceNow: number | null,
    loanDate: string
  ): Promise<string> {
    const messages: string[] = [];
    let loanForLifecycle = (await this.getIvyTekLoanForLifecycle(loanId)) || loan;
    if (this.isIvyTekLoanClosed(loanForLifecycle)) {
      return 'Existing loan was already closed.';
    }

    if (!this.isIvyTekLoanActiveOrOverpaid(loanForLifecycle)) {
      if (this.isIvyTekLoanApproved(loanForLifecycle)) {
        await this.disburseIvyTekLoan(loanId, loanDate, this.getIvyTekApprovedPrincipal(loanForLifecycle));
        messages.push(`Existing approved loan was disbursed on ${loanDate}.`);
      } else if (this.canUpdateExistingIvyTekLoan(loanForLifecycle)) {
        await this.approveAndDisburseIvyTekLoan(loanId, loanDate, this.getIvyTekApprovedPrincipal(loanForLifecycle));
        messages.push(`Existing pending loan was approved and disbursed on ${loanDate}.`);
      } else {
        return 'Existing loan state prevented automatic approval/disbursement.';
      }
      loanForLifecycle = await this.getIvyTekLoanForLifecycle(loanId);
    }

    if (!this.shouldPostIvyTekTransactionsInStage3()) {
      messages.push(await this.settleAndCloseIvyTekNonActiveLoan(loanId, row, balanceNow, loanDate));
    }
    return this.joinIvyTekMessages(messages);
  }

  /**
   * Checks whether a loan is closed.
   * @param {any} loan Loan response.
   */
  private isIvyTekLoanClosed(loan: any) {
    const status = loan?.status || {};
    const statusText = this.normalizeIvyTekText(status.value || status.code || status);
    return status.closed || status.closedObligationsMet || statusText.includes('closed');
  }

  /**
   * Checks whether a loan is active or overpaid.
   * @param {any} loan Loan response.
   */
  private isIvyTekLoanActiveOrOverpaid(loan: any) {
    const status = loan?.status || {};
    const statusText = this.normalizeIvyTekText(status.value || status.code || status);
    return status.active || status.overpaid || statusText.includes('active') || statusText.includes('overpaid');
  }

  /**
   * Checks whether a loan is approved but not yet disbursed.
   * @param {any} loan Loan response.
   */
  private isIvyTekLoanApproved(loan: any) {
    const status = loan?.status || {};
    const statusText = this.normalizeIvyTekText(status.value || status.code || status);
    return status.approved || statusText.includes('approved');
  }

  /**
   * Approves and disburses a newly created IvyTek loan.
   * @param {string} loanId Mifos loan id.
   * @param {string} loanDate Loan date text.
   */
  private async approveAndDisburseIvyTekLoan(loanId: string, loanDate: string, disburseAmount: number | null = null) {
    const commandData = {
      dateFormat: this.settingsService.dateFormat,
      locale: this.settingsService.language.code
    };
    await firstValueFrom(
      this.loansService.executeLoanCommand(loanId, 'approve', {
        ...commandData,
        approvedOnDate: loanDate
      })
    );
    await this.disburseIvyTekLoan(loanId, loanDate, disburseAmount);
  }

  /**
   * Disburses an approved IvyTek loan.
   * @param {string} loanId Mifos loan id.
   * @param {string} loanDate Loan date text.
   */
  private async disburseIvyTekLoan(loanId: string, loanDate: string, disburseAmount: number | null = null) {
    const commandData: any = {
      actualDisbursementDate: loanDate,
      dateFormat: this.settingsService.dateFormat,
      locale: this.settingsService.language.code
    };
    // Multi-disburse products disburse $0 unless the amount is specified, which leaves the
    // loan Overpaid on the first repayment; a native full disbursement is required for the
    // loan to be serviceable (see [[ivyTekHistoryStartImport]]).
    if (disburseAmount !== null && disburseAmount > 0) {
      commandData.transactionAmount = disburseAmount;
    }
    await firstValueFrom(this.loansService.executeLoanCommand(loanId, 'disburse', commandData));
  }

  /**
   * Posts a single migration repayment for the exact historical principal-paid amount.
   * @param {string} loanId Mifos loan id.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {string} transactionDate Migration repayment date.
   * @param {boolean} shouldApproveAndDisburse Whether the import activated the loan.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   * @param {any} historicalRepaymentSummary Historical payment rows grouped for this loan.
   */
  private async repayIvyTekActiveLoanToBalanceNow(
    loanId: string,
    row: any,
    balanceNow: number | null,
    transactionDate: string,
    shouldApproveAndDisburse: boolean = true,
    shouldCloseAfterDisbursement: boolean = false,
    historicalRepaymentSummary: any = null
  ): Promise<string> {
    if (!loanId || !shouldApproveAndDisburse) {
      return '';
    }

    if (this.shouldUseIvyTekStaticLoanSnapshot() && !this.ivyTekHistoryStartImport) {
      return '';
    }

    const messages: string[] = [];
    if (this.shouldPostIvyTekHistoricalRepayments(historicalRepaymentSummary)) {
      messages.push(await this.postIvyTekHistoricalRepaymentsToSnapshot(loanId, historicalRepaymentSummary));
      if (!shouldCloseAfterDisbursement && balanceNow !== null) {
        messages.push(await this.alignIvyTekLoanOutstandingInterest(loanId, row, transactionDate));
        messages.push(await this.getIvyTekPostRepaymentBalanceMessage(loanId, row, balanceNow));
      }
      return this.joinIvyTekMessages(messages);
    }

    return balanceNow === null
      ? ''
      : `No positive IvyTek repayment rows were available to post against BalanceNow ${this.formatIvyTekNumber(balanceNow)}.`;
  }

  /**
   * Posts IvyTek payment-history rows chronologically for an active migration loan.
   * @param {string} loanId Mifos loan id.
   * @param {any} summary Historical repayment summary.
   */
  private async postIvyTekHistoricalRepaymentsToSnapshot(loanId: string, summary: any): Promise<string> {
    if (!loanId || !summary?.count) {
      return '';
    }

    let postedCount = 0;
    let skippedDuplicateCount = 0;
    let postedAmount = 0;
    for (const transaction of summary.rows) {
      const payload = this.getIvyTekHistoricalRepaymentPayload(transaction);
      try {
        await firstValueFrom(this.loansService.submitLoanActionButton(loanId, payload, 'repayment'));
        postedCount += 1;
        postedAmount = this.roundIvyTekMoney(postedAmount + transaction.amount);
      } catch (error: any) {
        if (!this.isIvyTekDuplicateTransactionError(error)) {
          throw error;
        }
        skippedDuplicateCount += 1;
      }
    }

    return this.joinIvyTekMessages([
      `Posted ${postedCount} IvyTek historical repayments totaling ${this.formatIvyTekNumber(postedAmount)}.`,
      skippedDuplicateCount
        ? `Skipped ${skippedDuplicateCount} duplicate repayment transactions with external IDs already registered in Mifos. If this follows an earlier IvyTek test run, reset or reverse that run before judging reconciliation because those duplicates may already be attached to another loan.`
        : ''
    ]);
  }

  /**
   * Builds the REST payload for a single IvyTek historical repayment.
   * @param {any} transaction Historical repayment wrapper.
   */
  private getIvyTekHistoricalRepaymentPayload(transaction: any) {
    const payload: any = {
      transactionDate: transaction.date,
      transactionAmount: transaction.amount,
      dateFormat: this.settingsService.dateFormat,
      locale: this.settingsService.language.code,
      note: this.getIvyTekHistoricalRepaymentNote(transaction)
    };
    const externalId = this.getIvyTekHistoricalTransactionExternalId(transaction.row);
    if (externalId) {
      payload.externalId = externalId;
    }
    return payload;
  }

  /**
   * Gets a stable Mifos transaction external id from IvyTek source identifiers.
   * @param {any} row IvyTek transaction row.
   */
  private getIvyTekHistoricalTransactionExternalId(row: any): string {
    const sourceId = this.getFirstCsvValue(row, [
      'Id',
      'IvytekTestPkg__ExternalID__c',
      'legacy_history_id',
      'Name'
    ]);
    return sourceId ? `ivytek-txn-${sourceId}` : '';
  }

  /**
   * Checks whether a historical repayment failed because it was already posted.
   * @param {any} error API error.
   */
  private isIvyTekDuplicateTransactionError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      (message.includes('externalid') && (message.includes('already') || message.includes('duplicate'))) ||
      message.includes('transaction with externalid is already registered') ||
      message.includes('value.must.be.unique') ||
      message.includes('already exists') ||
      message.includes('already registered')
    );
  }

  /**
   * Builds a note for a posted historical repayment.
   * @param {any} transaction Historical repayment row wrapper.
   */
  private getIvyTekHistoricalRepaymentNote(transaction: any): string {
    const sourceName = this.getCsvValue(transaction.row, 'Name');
    return this.joinIvyTekMessages([
      `IvyTek import: historical repayment${sourceName ? ` ${sourceName}` : ''}.`,
      transaction.dateAdjusted
        ? `Source payment date ${transaction.sourceDate} is before disbursement; posted on ${transaction.date}.`
        : '',
      `Source split: ${this.formatIvyTekNumber(transaction.principal)} principal, ${this.formatIvyTekNumber(transaction.interest)} interest.`
    ]);
  }

  /**
   * Waives generated Fineract interest when it exceeds the IvyTek interest snapshot.
   * @param {string} loanId Mifos loan id.
   * @param {any} row IvyTek loan row.
   * @param {string} transactionDate Waiver transaction date.
   */
  private async alignIvyTekLoanOutstandingInterest(loanId: string, row: any, transactionDate: string): Promise<string> {
    const targetInterest = this.getIvyTekLoanHistoricalInterestOutstanding(row);
    if (targetInterest === null) {
      return '';
    }

    const loan = await this.getIvyTekLoanForLifecycle(loanId);
    const currentInterest = this.getIvyTekLoanSummaryInterestOutstanding(loan);
    if (currentInterest === null) {
      return '';
    }

    if (this.areIvyTekMoneyValuesEqual(currentInterest, targetInterest)) {
      return `Fineract interest outstanding landed on IvyTek snapshot ${this.formatIvyTekNumber(targetInterest)}.`;
    }

    if (currentInterest < targetInterest) {
      return `Review interest allocation: Fineract interest outstanding is ${this.formatIvyTekNumber(currentInterest)}, below IvyTek snapshot interest ${this.formatIvyTekNumber(targetInterest)}.`;
    }

    const waiverAmount = this.roundIvyTekMoney(currentInterest - targetInterest);
    if (!waiverAmount || waiverAmount <= 0) {
      return `Review interest allocation: Fineract interest outstanding is ${this.formatIvyTekNumber(currentInterest)}, above IvyTek snapshot interest ${this.formatIvyTekNumber(targetInterest)}, but no positive waiver amount could be calculated.`;
    }

    const waiverDate = this.getIvyTekInterestAlignmentDate(row, transactionDate);
    try {
      await this.postIvyTekInterestWaiver(loanId, row, waiverAmount, waiverDate);
    } catch (error: any) {
      if (!this.isIvyTekDuplicateTransactionError(error)) {
        return `Review interest allocation: Fineract interest outstanding is ${this.formatIvyTekNumber(currentInterest)}, above IvyTek snapshot interest ${this.formatIvyTekNumber(targetInterest)}. Interest waiver of ${this.formatIvyTekNumber(waiverAmount)} on ${waiverDate} failed: ${this.getErrorMessage(error)}`;
      }
    }

    const updatedLoan = await this.getIvyTekLoanForLifecycle(loanId);
    const updatedInterest = this.getIvyTekLoanSummaryInterestOutstanding(updatedLoan);
    if (updatedInterest !== null && this.areIvyTekMoneyValuesEqual(updatedInterest, targetInterest)) {
      return `Waived generated Mifos interest of ${this.formatIvyTekNumber(waiverAmount)} on ${waiverDate}; interest outstanding now matches IvyTek snapshot ${this.formatIvyTekNumber(targetInterest)}.`;
    }

    return `Waived generated Mifos interest of ${this.formatIvyTekNumber(waiverAmount)} on ${waiverDate}, but interest outstanding is ${this.formatIvyTekNumber(updatedInterest)} instead of IvyTek snapshot ${this.formatIvyTekNumber(targetInterest)}.`;
  }

  /**
   * Posts a controlled migration waiver for generated Mifos interest above the IvyTek snapshot.
   * @param {string} loanId Mifos loan id.
   * @param {any} row IvyTek loan row.
   * @param {number} waiverAmount Excess interest to waive.
   * @param {string} waiverDate Waiver transaction date.
   */
  private async postIvyTekInterestWaiver(loanId: string, row: any, waiverAmount: number, waiverDate: string) {
    await firstValueFrom(
      this.loansService.submitLoanActionButton(
        loanId,
        {
          transactionDate: waiverDate,
          transactionAmount: waiverAmount,
          externalId: this.getIvyTekInterestWaiverExternalId(row, loanId),
          dateFormat: this.settingsService.dateFormat,
          locale: this.settingsService.language.code,
          note: `IvyTek import: migration interest waiver to align generated Mifos interest with IvyTek interest snapshot. Waived generated interest only; source IvyTek interest was preserved.`
        },
        'waiveinterest'
      )
    );
  }

  /**
   * Gets a stable external id for the generated-interest waiver transaction.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekInterestWaiverExternalId(row: any, loanId: string): string {
    const sourceId =
      this.getIvyTekLegacyLoanId(row) || this.getIvyTekLoanExternalId(row) || this.getCsvValue(row, 'Id');
    return `ivytek-interest-waiver-${sourceId || loanId}`;
  }

  /**
   * Gets a safe transaction date for interest alignment.
   * @param {any} row IvyTek loan row.
   * @param {string} fallbackDate Fallback transaction date.
   */
  private getIvyTekInterestAlignmentDate(row: any, fallbackDate: string): string {
    return this.getIvyTekLoanInterestSnapshotStartDateText(row) || fallbackDate;
  }

  /**
   * Gets the IvyTek outstanding-interest snapshot for an active loan.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanHistoricalInterestOutstanding(row: any): number | null {
    const interestParts = [
      this.getFirstIvyTekDecimal(row, [
        'IvytekTestPkg__AccruedInterestAll__c',
        'Accrued Interest',
        'AccruedInterestAll'
      ]),
      this.getFirstIvyTekDecimal(row, [
        'IvytekTestPkg__BackInterestDue__c',
        'Back Interest Due',
        'BackInterestDue'
      ]),
      this.getFirstIvyTekDecimal(row, [
        'IvytekTestPkg__Deferred_Interest_Due__c',
        'Deferred Interest Due',
        'DeferredInterestDue'
      ])
    ].filter((value: number | null) => value !== null) as number[];
    if (interestParts.length) {
      return this.roundIvyTekMoney(interestParts.reduce((total: number, value: number) => total + value, 0));
    }

    const balanceNow = this.getIvyTekLoanBalanceNow(row);
    const payoffAmount = this.getFirstIvyTekDecimal(row, [
      'IvytekTestPkg__Payoff_Amount__c',
      'Payoff Amount',
      'PayoffAmount'
    ]);
    if (balanceNow !== null && payoffAmount !== null && payoffAmount >= balanceNow) {
      return this.roundIvyTekMoney(payoffAmount - balanceNow);
    }
    return null;
  }

  /**
   * Gets current interest outstanding from a Fineract loan response.
   * @param {any} loan Loan account response.
   */
  private getIvyTekLoanSummaryInterestOutstanding(loan: any): number | null {
    const values = [
      loan?.summary?.interestOutstanding,
      loan?.summary?.totalInterestOutstanding,
      loan?.summary?.outstandingInterest,
      loan?.repaymentSchedule?.totalInterestOutstanding,
      loan?.repaymentSchedule?.totalOutstandingInterest,
      loan?.interestOutstanding
    ];
    const parsedValue = values
      .map((value: any) => this.parseIvyTekDecimal((value ?? '').toString()))
      .find((value: number | null) => value !== null);
    return parsedValue ?? null;
  }

  /**
   * Reports whether Fineract principal landed on IvyTek BalanceNow after historical payments.
   * @param {string} loanId Mifos loan id.
   * @param {any} row IvyTek loan row.
   * @param {number} balanceNow IvyTek current balance.
   */
  private async getIvyTekPostRepaymentBalanceMessage(loanId: string, row: any, balanceNow: number): Promise<string> {
    const loan = await this.getIvyTekLoanForLifecycle(loanId);
    const currentPrincipalOutstanding = this.getIvyTekLoanSummaryPrincipalOutstanding(loan);
    if (currentPrincipalOutstanding === null) {
      return '';
    }
    if (this.areIvyTekMoneyValuesEqual(currentPrincipalOutstanding, balanceNow)) {
      return `Principal outstanding landed on IvyTek BalanceNow ${this.formatIvyTekNumber(balanceNow)}.`;
    }
    return `Review principal allocation: Fineract principal outstanding is ${this.formatIvyTekNumber(currentPrincipalOutstanding)}, while IvyTek BalanceNow is ${this.formatIvyTekNumber(balanceNow)}.`;
  }

  /**
   * Posts the payoff transaction and closes a non-active historical IvyTek loan.
   * @param {string} loanId Mifos loan id.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private async settleAndCloseIvyTekNonActiveLoan(
    loanId: string,
    row: any,
    balanceNow: number | null,
    minimumLoanDate: string = this.getIvyTekLoanDate(row)
  ): Promise<string> {
    if (!loanId || !this.shouldCloseIvyTekLoanAfterDisbursement(row, balanceNow)) {
      return '';
    }

    const closeDate = this.getIvyTekHistoricalLoanCloseDate(row, minimumLoanDate) || minimumLoanDate;
    const existingLoan = await this.getIvyTekLoanForLifecycle(loanId);
    if (this.isIvyTekLoanClosed(existingLoan)) {
      return 'Non-active historical loan was already closed.';
    }

    const activationMessage = await this.ensureIvyTekLoanActiveForHistoricalClose(loanId, minimumLoanDate);
    const activeLoan = await this.getIvyTekLoanForLifecycle(loanId);
    if (this.isIvyTekLoanClosed(activeLoan)) {
      return this.joinIvyTekMessages([
        activationMessage,
        'Non-active historical loan was already closed.'
      ]);
    }
    if (!this.isIvyTekLoanActiveOrOverpaid(activeLoan)) {
      throw new Error(
        `Cannot close historical IvyTek loan until it is active. Current Mifos loan status is ${this.getIvyTekLoanStatusLabel(activeLoan)}.`
      );
    }

    const payoffMessage = await this.repayIvyTekLoanForHistoricalClose(loanId, closeDate);
    const closeMessage = await this.closeIvyTekHistoricalLoan(loanId, closeDate);
    return this.joinIvyTekMessages([
      activationMessage,
      payoffMessage,
      closeMessage
    ]);
  }

  /**
   * Ensures a historical loan is disbursed before the importer attempts to close it.
   * @param {string} loanId Mifos loan id.
   * @param {string} loanDate Historical loan date.
   */
  private async ensureIvyTekLoanActiveForHistoricalClose(loanId: string, loanDate: string): Promise<string> {
    const loan = await this.getIvyTekLoanForLifecycle(loanId);
    if (!loan || this.isIvyTekLoanActiveOrOverpaid(loan) || this.isIvyTekLoanClosed(loan)) {
      return '';
    }

    if (this.isIvyTekLoanApproved(loan)) {
      await this.disburseIvyTekLoan(loanId, loanDate, this.getIvyTekApprovedPrincipal(loan));
      return `Historical loan was disbursed on ${loanDate} before close.`;
    }

    if (this.canUpdateExistingIvyTekLoan(loan)) {
      await this.approveAndDisburseIvyTekLoan(loanId, loanDate, this.getIvyTekApprovedPrincipal(loan));
      return `Historical loan was approved and disbursed on ${loanDate} before close.`;
    }

    throw new Error(
      `Cannot close historical IvyTek loan until it is active. Current Mifos loan status is ${this.getIvyTekLoanStatusLabel(loan)}.`
    );
  }

  /**
   * Posts the payoff amount needed before closing a non-active historical loan.
   * @param {string} loanId Mifos loan id.
   * @param {string} transactionDate Payoff transaction date.
   */
  private async repayIvyTekLoanForHistoricalClose(loanId: string, transactionDate: string): Promise<string> {
    const template: any = await firstValueFrom(
      this.loansService.getLoanPrepayLoanActionTemplate(loanId, transactionDate)
    );
    const transactionAmount = this.getIvyTekLoanPayoffAmount(template);
    if (!transactionAmount || transactionAmount <= 0) {
      return 'No payoff repayment was needed before closing the historical loan.';
    }

    await firstValueFrom(
      this.loansService.submitLoanActionButton(
        loanId,
        {
          transactionDate,
          transactionAmount,
          dateFormat: this.settingsService.dateFormat,
          locale: this.settingsService.language.code,
          note: 'IvyTek import: final historical payoff needed before closing this non-active IvyTek loan.'
        },
        'repayment'
      )
    );
    return `Historical payoff repayment of ${this.formatIvyTekNumber(transactionAmount)} was posted on ${transactionDate}.`;
  }

  /**
   * Closes a historical loan after its payoff transaction.
   * @param {string} loanId Mifos loan id.
   * @param {string} transactionDate Close transaction date.
   */
  private async closeIvyTekHistoricalLoan(loanId: string, transactionDate: string): Promise<string> {
    try {
      await firstValueFrom(
        this.loansService.submitLoanActionButton(
          loanId,
          {
            transactionDate,
            dateFormat: this.settingsService.dateFormat,
            locale: this.settingsService.language.code,
            note: 'IvyTek import: closing non-active historical loan.'
          },
          'close'
        )
      );
      return `Historical loan was closed on ${transactionDate}.`;
    } catch (error: any) {
      const loan = await this.getIvyTekLoanForLifecycle(loanId);
      if (this.isIvyTekLoanClosed(loan)) {
        return `Historical loan was already closed on or before ${transactionDate}.`;
      }
      if (this.isIvyTekCloseLoanNotActiveError(error)) {
        return `Historical loan was no longer active after payoff on ${transactionDate}; Mifos rejected a second close command.`;
      }
      throw error;
    }
  }

  /**
   * Checks whether Mifos rejected close because the payoff already moved the loan out of Active.
   * @param {any} error API error.
   */
  private isIvyTekCloseLoanNotActiveError(error: any) {
    const message = this.getErrorMessage(error).toLowerCase();
    return message.includes('closing loan account is not allowed') && message.includes('loan account is not active');
  }

  /**
   * Gets a readable loan status from Fineract response shapes.
   * @param {any} loan Loan response.
   */
  private getIvyTekLoanStatusLabel(loan: any): string {
    const status = loan?.status || {};
    if (typeof status === 'string') {
      return status || 'unknown';
    }
    return status.value || status.code || 'unknown';
  }

  /**
   * Gets a loan response for lifecycle checks.
   * @param {string} loanId Mifos loan id.
   */
  private async getIvyTekLoanForLifecycle(loanId: string) {
    try {
      return await firstValueFrom(this.loansService.getLoanAccountResource(loanId, 'all'));
    } catch {
      return null;
    }
  }

  /**
   * Gets the payoff amount from a repayment/prepay template.
   * @param {any} template Loan transaction template.
   */
  private getIvyTekLoanPayoffAmount(template: any): number | null {
    return (
      [
        template?.amount,
        template?.transactionAmount,
        template?.totalOutstanding,
        template?.totalOutstandingBalance,
        template?.summary?.totalOutstanding,
        template?.summary?.totalOutstandingBalance,
        template?.repaymentSchedule?.totalOutstanding,
        template?.repaymentSchedule?.totalOutstandingBalance
      ]
        .map((value: any) => this.parseIvyTekDecimal((value ?? '').toString()))
        .find((value: number | null) => !!value && value > 0) || null
    );
  }

  /**
   * Gets the configured disbursement charge payload when the product exposes the charge.
   * @param {any} row IvyTek loan row.
   * @param {any} productDetails Loan product details.
   * @param {number} principal Principal amount.
   */
  private getIvyTekLoanCharge(row: any, productDetails: any, principal: number) {
    const chargeName = this.ivyTekLoanImportForm.get('chargeName').value;
    if (!chargeName) {
      return null;
    }
    const chargeAmount = this.getIvyTekLoanChargeAmount(row, principal);
    if (!chargeAmount || chargeAmount <= 0) {
      return null;
    }
    const balanceNow = this.getIvyTekLoanBalanceNow(row);
    if (
      this.shouldSkipIvyTekLoanChargeForActiveSnapshot(
        row,
        balanceNow,
        this.shouldApproveAndDisburseIvyTekLoan(row, balanceNow),
        this.shouldCloseIvyTekLoanAfterDisbursement(row, balanceNow)
      )
    ) {
      return null;
    }
    const chargeOptions = this.getIvyTekProductChargeOptions(productDetails);
    const charge = chargeOptions.find(
      (option: any) =>
        this.normalizeIvyTekText(option.name || option.chargeName) === this.normalizeIvyTekText(chargeName)
    );
    if (!charge?.id && !charge?.chargeId) {
      return null;
    }
    return {
      chargeId: charge.chargeId || charge.id,
      amount: chargeAmount
    };
  }

  /**
   * Avoids creating synthetic fees on active migration snapshots.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether the import will activate the loan.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   */
  private shouldSkipIvyTekLoanChargeForActiveSnapshot(
    row: any,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean
  ): boolean {
    return this.shouldUseIvyTekMigrationDateForLoan(
      row,
      balanceNow,
      shouldApproveAndDisburse,
      shouldCloseAfterDisbursement
    );
  }

  /**
   * Gets charge amount from the selected source.
   * @param {any} row IvyTek loan row.
   * @param {number} principal Principal amount.
   */
  private getIvyTekLoanChargeAmount(row: any, principal: number) {
    return this.getFirstIvyTekPositiveDecimal(row, [
      'IvytekTestPkg__ChargeAmount__c',
      'IvytekTestPkg__FeeAmount__c',
      'IvytekTestPkg__Fees__c',
      'IvytekTestPkg__TotalFees__c',
      'IvytekTestPkg__OriginationFee__c',
      'Charge Amount',
      'Fee Amount',
      'Fees',
      'Total Fees',
      'Origination Fee'
    ]);
  }

  /**
   * Gets the mapped Mifos loan product name for an IvyTek group.
   * @param {string} group IvyTek loan group.
   */
  private getIvyTekProductName(group: string): string {
    return 'Personal Loan';
  }

  /**
   * Gets the Mifos product name override for product lookup purposes.
   * Some groups (e.g. code 80 / Estates Pending) share a product with another
   * group but keep their own loan group in the datatable.
   * @param {string} group Normalized IvyTek loan group.
   */
  private getIvyTekProductLookupOverride(group: string): string {
    return 'Personal Loan';
  }

  /**
   * Gets the generated loan external id.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanExternalId(row: any): string {
    const legacyLoanId = this.getIvyTekLegacyLoanId(row);
    const fallback = this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c');
    return legacyLoanId || fallback ? `loan_${legacyLoanId || fallback}` : '';
  }

  /**
   * Gets the IvyTek legacy loan id that should become the Mifos loan account number.
   * @param {any} row IvyTek loan or transaction bridge row.
   */
  private getIvyTekLegacyLoanId(row: any): string {
    return (
      this.getCsvValue(row, 'ws_loan_id') ||
      this.getCsvValue(row, 'WS_LOAN_ID') ||
      this.getCsvValue(row, 'wsLoanId') ||
      this.getCsvValue(row, 'WS_Loan_ID__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__WS_Loan_ID__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__Legacy_Loan_ID__c') ||
      this.getCsvValue(row, 'legacy_id') ||
      this.getCsvValue(row, 'legacy_loan_number') ||
      this.getCsvValue(row, 'LoanAccountNumber')
    );
  }

  /**
   * Gets loan date in the active Mifos date format.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanDate(row: any): string {
    const loanDate = this.parseIvyTekDate(
      this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c') || this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c')
    );
    if (loanDate) {
      return this.dateUtils.formatDate(loanDate, this.settingsService.dateFormat);
    }
    return '';
  }

  /**
   * Gets the raw IvyTek source loan date for result review/export.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekSourceLoanDate(row: any): string {
    return this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c') || this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c');
  }

  /**
   * Gets the raw IvyTek maturity date for result review/export.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekSourceMaturityDate(row: any): string {
    return (
      this.getCsvValue(row, 'IvytekTestPkg__MatDate__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__MaturityDate__c') ||
      this.getCsvValue(row, 'Maturity Date') ||
      this.getCsvValue(row, 'MatDate')
    );
  }

  /**
   * Gets the historical payoff/close date for a zero-balance IvyTek loan.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekHistoricalLoanCloseDate(row: any, minimumLoanDate: string = this.getIvyTekLoanDate(row)): string {
    const sourceCloseDate = this.parseIvyTekDate(
      this.getFirstCsvValue(row, [
        'IvytekTestPkg__Paid_Out_Date__c',
        'IvytekTestPkg__PaidOutDate__c',
        'Paid_Out_Date__c',
        'Paid Out Date',
        'IvytekTestPkg__DateStatusChanged__c',
        'IvytekTestPkg__StatusChangeEffDate__c',
        'DateStatusChanged',
        'Status Change Effective Date'
      ])
    );
    return sourceCloseDate ? this.dateUtils.formatDate(sourceCloseDate, this.settingsService.dateFormat) : '';
  }

  /**
   * Gets a positive repayment count from IvyTek payment count or term fields.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekNumberOfRepayments(
    row: any,
    principal: number | null = null,
    balanceNow: number | null = null
  ): number | null {
    const sourceRepayments = this.getFirstIvyTekPositiveInteger(row, [
      'IvytekTestPkg__Number_of_Payments__c',
      'IvytekTestPkg__NumberOfPayments__c',
      'Number_of_Payments__c',
      'Number of Payments',
      '# of Repayments*',
      '# of Repayments',
      'number_of_payments',
      'IvytekTestPkg__Term__c',
      'Term',
      'Loan Term*',
      'Loan Term',
      'term'
    ]);
    if (sourceRepayments) {
      return sourceRepayments;
    }

    return null;
  }

  /**
   * Builds a review message for missing repayment counts.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekRepaymentReviewMessage(row: any): string {
    const numberOfPayments =
      this.getCsvValue(row, 'IvytekTestPkg__Number_of_Payments__c') ||
      this.getCsvValue(row, '# of Repayments*') ||
      '(blank)';
    const term = this.getCsvValue(row, 'IvytekTestPkg__Term__c') || this.getCsvValue(row, 'Loan Term*') || '(blank)';
    return `Missing or zero number of payments. Checked IvyTek Number of Payments (${numberOfPayments}) and Term (${term}). Fineract requires this value to build the repayment schedule.`;
  }

  /**
   * Builds a review message for missing principal values.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekPrincipalReviewMessage(row: any): string {
    const amountFinanced = this.getCsvValue(row, 'IvytekTestPkg__AmtFinanced__c') || '(blank)';
    const requestAmount = this.getCsvValue(row, 'IvytekTestPkg__RequestAmount__c') || '(blank)';
    const principle = this.getCsvValue(row, 'IvytekTestPkg__Principle__c') || '(blank)';
    return `Missing or zero principal amount. Checked IvyTek AmtFinanced (${amountFinanced}), RequestAmount (${requestAmount}), and Principle (${principle}).`;
  }

  /**
   * Gets the first positive decimal from candidate CSV fields.
   * @param {any} row CSV row.
   * @param {string[]} keys Candidate CSV fields.
   */
  private getFirstIvyTekPositiveDecimal(row: any, keys: string[]): number | null {
    for (const key of keys) {
      const value = this.parseIvyTekDecimal(this.getCsvValue(row, key));
      if (value && value > 0) {
        return value;
      }
    }
    return null;
  }

  /**
   * Gets the first decimal from candidate CSV fields.
   * @param {any} row CSV row.
   * @param {string[]} keys Candidate CSV fields.
   */
  private getFirstIvyTekDecimal(row: any, keys: string[]): number | null {
    for (const key of keys) {
      const rawValue = this.getCsvValue(row, key);
      if (rawValue === '') {
        continue;
      }
      const value = this.parseIvyTekDecimal(rawValue);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }

  /**
   * Gets the first positive integer from candidate CSV fields.
   * @param {any} row CSV row.
   * @param {string[]} keys Candidate CSV fields.
   */
  private getFirstIvyTekPositiveInteger(row: any, keys: string[]): number | null {
    for (const key of keys) {
      const value = this.parseIvyTekInteger(this.getCsvValue(row, key));
      if (value && value > 0) {
        return value;
      }
    }
    return null;
  }

  /**
   * Gets unique non-empty IvyTek identifiers in lookup order.
   * @param {string[]} identifiers Candidate identifiers.
   */
  private getUniqueIvyTekIdentifiers(identifiers: string[]): string[] {
    return Array.from(
      new Set(
        identifiers
          .map((identifier: string) => (identifier || '').toString().trim())
          .filter((identifier: string) => !!identifier)
      )
    );
  }

  /**
   * Gets first repayment date in the active Mifos date format.
   * @param {any} row IvyTek loan row.
   * @param {string} loanDateText Loan date text.
   */
  private getIvyTekFirstRepaymentDate(row: any, loanDateText: string): string {
    const firstDueDate = this.parseIvyTekDate(this.getCsvValue(row, 'IvytekTestPkg__FirstDueDate__c'));
    if (!firstDueDate) {
      return '';
    }
    // A corrected origination date can land after the source first due date; Fineract
    // rejects repayments starting on/before disbursement, so omit the field and let
    // the schedule start from the disbursement date instead.
    const loanDate = this.parseIvyTekDate(loanDateText);
    if (loanDate && firstDueDate.getTime() <= loanDate.getTime()) {
      return '';
    }
    return this.dateUtils.formatDate(firstDueDate, this.settingsService.dateFormat);
  }

  /**
   * Gets repayment frequency values for Fineract.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekRepaymentFrequency(row: any) {
    const paymentFrequency = this.getCsvValue(row, 'IvytekTestPkg__Payment_Frequency__c').toLowerCase();
    if (paymentFrequency === 'weekly') {
      return { every: 1, type: 1, label: 'Weekly' };
    }
    if ([
        'bi-weekly',
        'biweekly',
        'bi weekly'
      ].includes(paymentFrequency)) {
      return { every: 2, type: 1, label: 'Bi-weekly' };
    }
    return { every: 1, type: 2, label: 'Monthly' };
  }

  /**
   * Normalizes IvyTek loan group values.
   * @param {string} value Raw group value.
   */
  private normalizeIvyTekLoanGroup(value: string): string {
    const normalizedNumber = this.parseIvyTekDecimal(value);
    if (normalizedNumber !== null && Number.isInteger(normalizedNumber)) {
      return normalizedNumber.toString();
    }
    return value;
  }

  /**
   * Parses an IvyTek decimal value.
   * @param {string} value Raw value.
   */
  private parseIvyTekDecimal(value: string): number | null {
    const normalized = value.replace(/[$,]/g, '').trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Parses an IvyTek integer value.
   * @param {string} value Raw value.
   */
  private parseIvyTekInteger(value: string): number | null {
    const parsed = this.parseIvyTekDecimal(value);
    return parsed === null ? null : Math.trunc(parsed);
  }

  /**
   * Parses common boolean values from CSV or API data.
   * @param {any} value Raw value.
   */
  private parseIvyTekBoolean(value: any): boolean | null {
    if (value === true || value === false) {
      return value;
    }
    const normalized = (value ?? '').toString().trim().toLowerCase();
    if ([
        'true',
        'yes',
        'y',
        '1'
      ].includes(normalized)) {
      return true;
    }
    if ([
        'false',
        'no',
        'n',
        '0'
      ].includes(normalized)) {
      return false;
    }
    return null;
  }

  /**
   * Formats a number for concise import result messages.
   * @param {number | null} value Numeric value.
   */
  private formatIvyTekNumber(value: any): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '(blank)';
  }

  /**
   * Formats a CSV or Fineract date value using the active tenant date format.
   * @param {any} value Raw date value.
   */
  private formatIvyTekDateValue(value: any): string {
    const date = this.parseIvyTekDateValue(value);
    return date ? this.dateUtils.formatDate(date, this.settingsService.dateFormat) : '';
  }

  /**
   * Parses date values returned either from CSV text or Fineract date arrays.
   * @param {any} value Raw date value.
   */
  private parseIvyTekDateValue(value: any): Date | null {
    if (value instanceof Date) {
      return value;
    }
    if (Array.isArray(value) && value.length >= 3) {
      return new Date(value[0], value[1] - 1, value[2]);
    }
    return value ? this.parseIvyTekDate(value.toString()) : null;
  }

  /**
   * Parses common IvyTek date values.
   * @param {string} value Raw value.
   */
  private parseIvyTekDate(value: string): Date | null {
    if (!value) {
      return null;
    }
    const trimmedValue = value.toString().trim();
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedValue);
    if (dateOnlyMatch) {
      const [
        ,
        year,
        month,
        day
      ] = dateOnlyMatch;
      let yearNumber = Number(year);
      if (yearNumber < 100) {
        yearNumber += yearNumber >= 50 ? 1900 : 2000;
      }
      const parsedDate = new Date(yearNumber, Number(month) - 1, Number(day));
      parsedDate.setFullYear(yearNumber);
      return parsedDate;
    }
    const normalized = trimmedValue.endsWith('Z') ? `${trimmedValue.slice(0, -1)}+00:00` : trimmedValue;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : this.applyIvyTekCenturyWindow(parsed);
  }

  /**
   * Applies the two-digit-year (Y2K) window to parsed dates. IvyTek exports carry
   * dates without century digits, and some parse paths keep them as literal
   * first-century years (e.g. 0094) — window them to 19xx/20xx.
   * @param {Date} date Parsed date.
   */
  private applyIvyTekCenturyWindow(date: Date): Date {
    const year = date.getFullYear();
    if (year >= 0 && year < 100) {
      const windowed = new Date(date);
      windowed.setFullYear(year + (year >= 50 ? 1900 : 2000));
      return windowed;
    }
    return date;
  }

  /**
   * Gets comparable Salesforce id keys.
   * @param {string} value Salesforce id.
   */
  private getSalesforceIdKeys(value: string): string[] {
    const compact = (value || '').toString().replace(/[^A-Za-z0-9]/g, '');
    const keys = [compact];
    if (compact.length === 18) {
      // Salesforce 15-character IDs are case-sensitive; lowercasing that form can merge different loans.
      keys.push(compact.toLowerCase(), compact.substring(0, 15));
    } else if (compact.length < 15) {
      keys.push(compact.toLowerCase());
    } else if (compact.length > 18) {
      keys.push(compact.toLowerCase());
    }
    return Array.from(new Set(keys.filter((key: string) => !!key)));
  }

  /**
   * Gets comparable lookup keys for Salesforce ids and legacy external ids.
   * @param {string} value Source identifier.
   */
  private getIvyTekIdentifierLookupKeys(value: string): string[] {
    const trimmed = (value || '').toString().trim();
    const compact = trimmed.replace(/[^A-Za-z0-9]/g, '');
    const isSalesforceId = compact.length === 15 || compact.length === 18;
    return this.getUniqueIvyTekIdentifiers([
      trimmed,
      isSalesforceId ? '' : trimmed.toLowerCase(),
      ...this.getSalesforceIdKeys(trimmed)
    ]);
  }

  /**
   * Maps a raw IvyTek payment type value (or description fallback) to the canonical Mifos payment type name.
   * Checks TypPay__c first, then Description__c, so that "Pension payment" → PENSION even when the type field is blank.
   */
  private resolveIvyTekMifosPaymentType(typPay: string, description: string): string {
    const mifosPaymentTypes: Array<{ name: string; keys: string[] }> = [
      { name: 'PENSION', keys: [
          'pension',
          'pensionpayment'
        ] },
      { name: 'PAYROLL', keys: [
          'payroll',
          'payrollpayment'
        ] },
      { name: 'PERCAPITA', keys: [
          'percapita',
          'percapitapayment',
          'per capita',
          'percapitapay',
          'percap'
        ] },
      { name: 'REFUND', keys: [
          'refund',
          'repaymentadjustmentrefund'
        ] },
      { name: 'REG PAYMENT', keys: [
          'regpayment',
          'repaymentadjustmentchargeback',
          'regularpayment'
        ] }
    ];

    const normalize = (v: string) =>
      (v || '')
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
    const candidates = [
      typPay,
      description
    ]
      .map(normalize)
      .filter(Boolean);

    for (const candidate of candidates) {
      const match = mifosPaymentTypes.find((pt) => pt.keys.some((k) => candidate.includes(k) || k.includes(candidate)));
      if (match) {
        return match.name;
      }
    }

    return 'REG PMNT';
  }

  /**
   * Normalizes text for dictionary matching.
   * @param {string} value Raw text.
   */
  private normalizeIvyTekText(value: string): string {
    return (value || '')
      .toString()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '');
  }

  /**
   * Normalizes names using the same conservative strategy as the handoff script.
   * @param {string} value Raw name.
   */
  private normalizeIvyTekName(value: string): string {
    return (value || '')
      .toString()
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9, ]+/g, ' ')
      .split(/[,\s]+/)
      .filter(
        (token: string) => !!token && ![
            'jr',
            'sr',
            'ii',
            'iii',
            'iv',
            'v'
          ].includes(token) && !/^\d+$/.test(token)
      )
      .sort()
      .join('');
  }

  /**
   * Normalizes source Contact names while preserving suffixes that distinguish related people.
   * @param {string} value Raw name.
   */
  private normalizeIvyTekSourceContactName(value: string): string {
    return (value || '')
      .toString()
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9, ]+/g, ' ')
      .split(/[,\s]+/)
      .filter((token: string) => !!token && !/^\d+$/.test(token))
      .sort()
      .join('');
  }

  /**
   * Normalizes names while ignoring middle initials for source-file-only borrower matching.
   * @param {string} value Raw name.
   */
  private normalizeIvyTekNameWithoutMiddleInitials(value: string): string {
    return (value || '')
      .toString()
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9, ]+/g, ' ')
      .split(/[,\s]+/)
      .filter(
        (token: string) => !!token && token.length > 1 && ![
            'jr',
            'sr',
            'ii',
            'iii',
            'iv',
            'v'
          ].includes(token) && !/^\d+$/.test(token)
      )
      .sort()
      .join('');
  }

  /**
   * Gets the most useful message from a failed API response.
   * @param {any} error API or runtime error.
   */
  private formatSqlImportError(result: any, httpStatus: number | null): string {
    const base =
      result?.message || (httpStatus ? `Server error ${httpStatus}` : 'Import did not complete successfully.');
    const pg = result?.error;
    if (!pg) return base;
    const extras = [
      pg.pgCode ? `PG ${pg.pgCode}` : null,
      pg.pgDetail ? `Detail: ${pg.pgDetail}` : null,
      pg.pgHint ? `Hint: ${pg.pgHint}` : null,
      pg.pgPosition ? `Position: ${pg.pgPosition}` : null,
      pg.pgTable ? `Table: ${pg.pgTable}` : null,
      pg.pgColumn ? `Column: ${pg.pgColumn}` : null,
      pg.pgConstraint ? `Constraint: ${pg.pgConstraint}` : null,
      pg.pgWhere ? `Where: ${pg.pgWhere}` : null
    ]
      .filter(Boolean)
      .join(' | ');
    return extras ? `${base} — ${extras}` : base;
  }

  private getErrorMessage(error: any): string {
    const errorBody = error?.error;
    const messages = [
      errorBody?.defaultUserMessage,
      errorBody?.developerMessage,
      ...(errorBody?.errors || []).map(
        (apiError: any) => apiError?.defaultUserMessage || apiError?.developerMessage || apiError?.parameterName
      ),
      typeof errorBody === 'string' ? errorBody : '',
      error?.message,
      error?.status ? `HTTP ${error.status}${error.statusText ? ` ${error.statusText}` : ''}` : ''
    ].filter((message: string) => !!message);

    return Array.from(new Set(messages)).join(' ') || 'Unable to import this IvyTek record.';
  }

  onIvyTekFeedPostFileSelect($event: any): void {
    if ($event.target.files.length > 0) {
      this.ivyTekFeedPostFile = $event.target.files[0];
      this.ivyTekFeedPostImportResult = null;
      this.ivyTekFeedPostImportError = null;
    }
  }

  async runIvyTekFeedPostImport(apply: boolean): Promise<void> {
    if (!this.ivyTekFeedPostFile) {
      this.ivyTekFeedPostImportError = 'Select a FeedPost CSV file first.';
      return;
    }

    this.ivyTekFeedPostImportRunning = true;
    this.ivyTekFeedPostImportError = null;
    this.ivyTekFeedPostImportResult = null;

    try {
      const [
        feedPostCsvText,
        loanCsvText,
        salesforceUsersCsvText
      ] = await Promise.all([
        this.readFileAsText(this.ivyTekFeedPostFile),
        this.ivyTekLoanFile ? this.readFileAsText(this.ivyTekLoanFile) : Promise.resolve(null),
        this.ivyTekUsersFile ? this.readFileAsText(this.ivyTekUsersFile) : Promise.resolve(null)
      ]);

      if (!feedPostCsvText || !feedPostCsvText.trim()) {
        this.ivyTekFeedPostImportError = `FeedPost file "${this.ivyTekFeedPostFile.name}" was read but is empty. Re-pick the directory to refresh the file reference.`;
        this.ivyTekFeedPostImportRunning = false;
        return;
      }

      const response = await fetch('/api/ivytek/feedpost-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db: this.ivyTekSqlDbForm.value,
          feedPostCsvText,
          loanCsvText,
          salesforceUsersCsvText,
          createdBy: 4,
          apply
        })
      });
      const result = await response.json();
      if (!response.ok) {
        this.ivyTekFeedPostImportError = this.formatSqlImportError(result, response.status);
      } else {
        this.ivyTekFeedPostImportResult = result;
        if (!result.success) {
          this.ivyTekFeedPostImportError = this.formatSqlImportError(result, null);
        }
      }
    } catch {
      this.ivyTekFeedPostImportError =
        'Could not reach the SQL import server. Make sure the app was started with ng serve --proxy-config proxy.conf.js.';
    } finally {
      this.ivyTekFeedPostImportRunning = false;
    }
  }

  onIvyTekContentVersionFileSelect($event: any): void {
    if ($event.target.files.length > 0) {
      this.ivyTekContentVersionFile = $event.target.files[0];
      this.ivyTekContentVersionImportResult = null;
      this.ivyTekContentVersionImportError = null;
    }
  }

  async runIvyTekContentVersionImport(apply: boolean): Promise<void> {
    if (!this.ivyTekContentVersionFile) {
      this.ivyTekContentVersionImportError = 'Select a ContentVersion CSV file first.';
      return;
    }

    this.ivyTekContentVersionImportRunning = true;
    this.ivyTekContentVersionImportError = null;
    this.ivyTekContentVersionImportResult = null;

    try {
      const [
        contentVersionCsvText,
        loanCsvText
      ] = await Promise.all([
        this.readFileAsText(this.ivyTekContentVersionFile),
        this.ivyTekLoanFile ? this.readFileAsText(this.ivyTekLoanFile) : Promise.resolve(null)
      ]);

      if (!contentVersionCsvText?.trim()) {
        this.ivyTekContentVersionImportError = `ContentVersion file "${this.ivyTekContentVersionFile.name}" was read but is empty. Re-pick the directory to refresh the file reference.`;
        this.ivyTekContentVersionImportRunning = false;
        return;
      }

      const resolveResponse = await fetch('/api/ivytek/content-version-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db: this.ivyTekSqlDbForm.value,
          contentVersionCsvText,
          loanCsvText
        })
      });
      const resolveResult = await resolveResponse.json();
      if (!resolveResponse.ok || !resolveResult.success) {
        this.ivyTekContentVersionImportError =
          resolveResult.message || 'Failed to resolve ContentVersion records to loans.';
        this.ivyTekContentVersionImportRunning = false;
        return;
      }

      const records: {
        versionId: string;
        contentDocumentId: string;
        loanId: number;
        title: string;
        fileType: string;
      }[] = resolveResult.records;
      if (!records.length) {
        this.ivyTekContentVersionImportError = 'No ContentVersion records could be matched to a loan.';
        this.ivyTekContentVersionImportRunning = false;
        return;
      }

      let uploaded = 0;
      let skipped = 0;
      let failed = 0;
      const uploadErrors: string[] = [];

      if (apply && this.ivyTekCleanupBeforeImport) {
        this.ivyTekCleanupRunning = true;
        this.ivyTekCleanupProcessedRecords = 0;
        this.ivyTekCleanupTotalRecords = 0;

        // Fetch all loan document lists in parallel
        const uniqueLoanIds = [...new Set(records.map((r: any) => r.loanId))];
        const docLists = await Promise.all(
          uniqueLoanIds.map((loanId) =>
            firstValueFrom(this.loansService.getLoanDocuments(loanId)).catch(() => [] as any[])
          )
        );

        // Collect all IvyTek-tagged docs across all loans
        const docsToDelete: { loanId: number; id: number }[] = [];
        docLists.forEach((docs: any[], i: number) => {
          (docs || [])
            .filter(
              (d: any) => typeof d.description === 'string' && d.description.startsWith('IvyTek ContentVersion import:')
            )
            .forEach((d: any) => docsToDelete.push({ loanId: uniqueLoanIds[i], id: d.id }));
        });

        this.ivyTekCleanupTotalRecords = docsToDelete.length;
        await this.runConcurrent(
          docsToDelete.map((doc) => async () => {
            await firstValueFrom(this.loansService.deleteLoanDocument(doc.loanId, doc.id)).catch(() => {});
            this.ivyTekCleanupProcessedRecords++;
          }),
          10
        );
        this.ivyTekCleanupRunning = false;
      }

      if (apply) {
        this.ivyTekAttachmentImporting = true;
        this.ivyTekAttachmentProcessedRecords = 0;
        this.ivyTekAttachmentTotalRecords = records.length;

        // Build a filename → File map for O(1) lookup
        const fileMap = new Map<string, File>();
        for (const f of this.ivyTekContentVersionFiles) {
          fileMap.set(f.name, f);
        }

        await this.runConcurrent(
          records.map((record: any) => async () => {
            const fileId = record.versionId || record.contentDocumentId;
            const file = fileMap.get(fileId) ?? [...fileMap.values()].find((f) => f.name.startsWith(fileId + '.'));

            if (!file) {
              skipped++;
              uploadErrors.push(`No file found in ContentVersion/ subfolder for Id ${fileId}`);
              this.ivyTekAttachmentProcessedRecords++;
              return;
            }

            try {
              const docName = record.title || fileId;
              const fileExt = record.fileType ? record.fileType.toLowerCase().replace(/^\./, '') : '';
              const ext = fileExt ? `.${fileExt}` : '';
              const safeFileName = `${docName.replace(/[/\\:*?"<>|]/g, '_')}${ext}`;
              const mimeType = this.ivyTekMimeTypeForExt(fileExt) || file.type || 'application/octet-stream';
              const typedFile = new File([file], safeFileName, { type: mimeType });
              const formData = new FormData();
              formData.append('name', docName);
              formData.append('file', typedFile);
              formData.append('description', `IvyTek ContentVersion import: ${record.contentDocumentId || fileId}`);
              await firstValueFrom(this.loansService.loadLoanDocument(record.loanId, formData));
              uploaded++;
            } catch (err: any) {
              failed++;
              uploadErrors.push(
                `Upload failed for ${fileId}: ${err?.error?.errors?.[0]?.defaultUserMessage || err?.message || 'Unknown error'}`
              );
            }
            this.ivyTekAttachmentProcessedRecords++;
          }),
          8
        );
        this.ivyTekAttachmentImporting = false;
      }

      const success = failed === 0;
      this.ivyTekContentVersionImportResult = {
        success,
        message: apply
          ? `Uploaded ${uploaded} attachment(s), skipped ${skipped} (no file found), failed ${failed}.`
          : `Dry run: ${records.length} attachment(s) ready. Re-run with Apply to upload.`,
        uploaded,
        skipped,
        failed,
        warnings: [
          ...(resolveResult.warnings || []),
          ...uploadErrors
        ],
        reconciliation: [
          { metric: 'Resolved Records', source: records.length, database: '-', difference: '-', status: 'Info' },
          { metric: 'Uploaded This Run', source: '-', database: uploaded, difference: '-', status: 'Info' },
          {
            metric: 'Skipped (no file)',
            source: '-',
            database: skipped,
            difference: '-',
            status: skipped > 0 ? 'Needs Review' : 'Info'
          },
          {
            metric: 'Failed Uploads',
            source: '-',
            database: failed,
            difference: '-',
            status: failed > 0 ? 'Needs Review' : 'Info'
          }
        ]
      };

      if (!success) {
        this.ivyTekContentVersionImportError = `${failed} upload(s) failed. See warnings for details.`;
      }
    } catch {
      this.ivyTekContentVersionImportError =
        'Could not reach the SQL import server. Make sure the app was started with ng serve --proxy-config proxy.conf.js.';
    } finally {
      this.ivyTekAttachmentImporting = false;
      this.ivyTekContentVersionImportRunning = false;
    }
  }

  /**
   * Reads a file as text.
   * @param {File} file File to read.
   */
  private async runConcurrent(tasks: (() => Promise<void>)[], concurrency: number): Promise<void> {
    let index = 0;
    const worker = async () => {
      while (index < tasks.length) {
        await tasks[index++]();
        await this.yieldIvyTekProgressFrame();
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  }

  private ivyTekMimeTypeForExt(ext: string): string {
    const map: Record<string, string> = {
      pdf: 'application/pdf',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      bmp: 'image/bmp',
      webp: 'image/webp',
      tif: 'image/tiff',
      tiff: 'image/tiff',
      svg: 'image/svg+xml',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      csv: 'text/csv',
      zip: 'application/zip',
      msg: 'application/vnd.ms-outlook'
    };
    return map[ext] || '';
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  /**
   * Parses CSV text into row objects.
   * @param {string} csvText CSV text.
   */
  private parseCsv(csvText: string): any[] {
    return this.ivyTekCsvParser.parse(csvText);
  }

  /**
   * Parses CSV text into arrays.
   * @param {string} csvText CSV text.
   */
  private parseCsvRows(csvText: string): string[][] {
    return this.ivyTekCsvParser.parseRows(csvText);
  }

  /**
   * Gets and trims a CSV field value.
   * @param {any} row CSV row.
   * @param {string} key CSV field key.
   */
  private getCsvValue(row: any, key: string): string {
    const value = (row?.[key] ?? '').toString().trim();
    return this.isNullLikeCsvValue(value) ? '' : value;
  }

  /**
   * Checks whether a CSV value is a placeholder for an empty value.
   * @param {string} value CSV field value.
   */
  private isNullLikeCsvValue(value: string): boolean {
    return [
      'null',
      'undefined',
      'none',
      'n/a',
      'na'
    ].includes(value.toLowerCase());
  }

  /**
   * Gets the first non-empty CSV field value from a list of possible keys.
   * @param {any} row CSV row.
   * @param {string[]} keys CSV field keys.
   */
  private getFirstCsvValue(row: any, keys: string[]): string {
    return keys.map((key: string) => this.getCsvValue(row, key)).find((value: string) => !!value) || '';
  }

  /**
   * Runs reconciliation on loans as of the export date to check their state before import.
   */
  async runPreImportReconciliation() {
    this.isRunningReconciliation = true;
    this.reconciliationResults = [];

    try {
      const exportDateStr = this.ivyTekImportForm.get('ivyTekExportDate')?.value;
      if (!exportDateStr) {
        this.reconciliationSummary = 'Please select an export date first.';
        return;
      }

      const exportDate = new Date(exportDateStr);
      const issues: any[] = [];
      const loansResponse = await firstValueFrom(this.loansService.getLoans(0, 10000));
      const loans = loansResponse.pageItems || [];

      for (const loan of loans) {
        const loanId = loan.id;
        const externalId = loan.externalId || '-';
        const clientName = loan.clientName || '-';

        // Calculate balance as of the export date by summing transactions up to that date
        const balanceAsOfDate = await this.calculateBalanceAsOfDate(loanId, exportDate);

        const loanBalance = (balanceAsOfDate.totalOutstanding || 0).toFixed(2);
        const principalOutstanding = (balanceAsOfDate.principalOutstanding || 0).toFixed(2);
        const interestOutstanding = (balanceAsOfDate.interestOutstanding || 0).toFixed(2);

        // Flag loans with potential issues
        const potentialIssues = [];

        // Check for zero or very low total balance (might indicate closed loans or issues)
        if (balanceAsOfDate.totalOutstanding > 0.005) {
          // Loan has an outstanding balance - check components
          if (balanceAsOfDate.principalOutstanding < 0.005 && balanceAsOfDate.interestOutstanding > 0.005) {
            potentialIssues.push('Interest without principal');
          }
        }

        // Add loan details to results for review
        if (potentialIssues.length > 0 || balanceAsOfDate.totalOutstanding > 0.005) {
          issues.push({
            loanId,
            externalId,
            clientName,
            issue: potentialIssues.length > 0 ? potentialIssues.join(', ') : 'Active loan',
            loanBalance,
            principalOutstanding,
            interestOutstanding
          });
        }
      }

      this.reconciliationResults = issues;
      const exportDateFormatted = new Date(exportDate).toLocaleDateString();
      this.reconciliationSummary = `Scanned ${loans.length} loans as of ${exportDateFormatted}. Found ${issues.length} loans with active balances or issues.`;
    } catch (error: any) {
      this.reconciliationSummary = `Reconciliation failed: ${this.getErrorMessage(error)}`;
    } finally {
      this.isRunningReconciliation = false;
    }
  }

  /**
   * Calculates the loan balance as of a specific date by summing transactions up to that date.
   */
  private async calculateBalanceAsOfDate(
    loanId: number,
    asOfDate: Date
  ): Promise<{ totalOutstanding: number; principalOutstanding: number; interestOutstanding: number }> {
    try {
      const detailsResponse = await firstValueFrom(this.loansService.getLoansAccountAndTemplateResource(loanId));
      const details = detailsResponse;

      // Get all transactions for the loan
      const transactions = details.loanScheduleItemData || details.repaymentSchedule || [];
      const loanTransactions = details.loanTransactions || [];

      // Filter transactions to only those on or before the export date
      const relevantTransactions = loanTransactions.filter((txn: any) => {
        const txnDate = new Date(txn.date);
        return txnDate <= asOfDate;
      });

      // Start with the principal and calculate remaining balances
      const principal = Number(details.principal) || 0;
      let principalPaid = 0;
      let interestPaid = 0;

      // Sum up all principal and interest payments made up to the export date
      for (const txn of relevantTransactions) {
        if (txn.type?.value === 'DISBURSEMENT') {
          // Disbursements don't reduce balance
          continue;
        }
        principalPaid += Number(txn.principalPortion) || 0;
        interestPaid += Number(txn.interestPortion) || 0;
      }

      // Calculate outstanding balances
      const principalOutstanding = Math.max(0, principal - principalPaid);
      const interestOutstanding = Math.max(0, (Number(details.interestAccrued) || 0) - interestPaid);

      return {
        totalOutstanding: principalOutstanding + interestOutstanding,
        principalOutstanding,
        interestOutstanding
      };
    } catch (error) {
      // Fallback to returning zero if we can't calculate
      return {
        totalOutstanding: 0,
        principalOutstanding: 0,
        interestOutstanding: 0
      };
    }
  }

  /**
   * Exports loan reconciliation results to CSV.
   */
  exportReconciliationResults() {
    if (!this.reconciliationResults.length) {
      return;
    }

    const headers = [
      'Loan ID',
      'External ID',
      'Client',
      'Issue',
      'Loan Balance',
      'Principal Outstanding',
      'Interest Outstanding'
    ];

    const rows = this.reconciliationResults.map((item: any) => ({
      'Loan ID': item.loanId,
      'External ID': item.externalId,
      Client: item.clientName,
      Issue: item.issue,
      'Loan Balance': item.loanBalance,
      'Principal Outstanding': item.principalOutstanding,
      'Interest Outstanding': item.interestOutstanding
    }));

    const csv = this.buildIvyTekCsv(headers, rows);
    this.downloadIvyTekCsv(`loan-reconciliation-${this.getIvyTekCsvTimestamp()}.csv`, csv);
  }
}
