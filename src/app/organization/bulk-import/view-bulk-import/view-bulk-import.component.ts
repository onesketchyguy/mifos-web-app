/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, HostListener, OnInit, ViewChild, inject } from '@angular/core';
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
  private readonly ivyTekPipelineRunStorageKey = 'mifosx.ivyTekImportPipelineRun';
  private readonly ivyTekImportConcurrency = 10;
  private readonly ivyTekAnnualInterestRateFrequencyType = 3;
  private readonly ivyTekPostHistoricalRepaymentsToFineract = false;
  private readonly ivyTekDefaultChargeName = 'Disbursement Charge';
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
  private ivyTekClientAddressTemplate: any = null;
  private ivyTekClientAddressTemplateUnavailable = false;
  private ivyTekLoanTribalDatatableColumns: any[] = [];

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
  /** IvyTek transaction result groups. */
  ivyTekTransactionResultGroups = [
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

  get isIvyTekImportPage(): boolean {
    return this.ivyTekImportNames.includes(this.bulkImport?.name);
  }

  get isIvyTekSpecialImportPage(): boolean {
    return this.isIvyTekImportPage;
  }

  get isIvyTekPipelineRunning(): boolean {
    return this.ivyTekImporting || this.ivyTekLoanImporting || this.ivyTekTransactionImporting;
  }

  get hasPendingIvyTekPipelineRun(): boolean {
    return this.ivyTekPipelineRun?.status === 'labels.inputs.Running' && !this.isIvyTekPipelineRunning;
  }

  get ivyTekStartStage(): string {
    return this.ivyTekImportForm?.get('startStage')?.value || 'clients';
  }

  get canUploadIvyTekPipeline(): boolean {
    return (
      this.hasIvyTekRequiredFilesForStartStage() &&
      this.ivyTekImportForm.get('targetEntity').valid &&
      this.ivyTekImportForm.get('startStage').valid &&
      (this.ivyTekStartStage === 'transactions' || this.ivyTekImportForm.get('officeId').valid) &&
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
      (this.ivyTekStartStage === 'transactions' || this.ivyTekImportForm.get('officeId').valid) &&
      this.ivyTekLoanImportForm.valid &&
      !this.isIvyTekPipelineRunning
    );
  }

  get hasIvyTekExportableResults(): boolean {
    return (
      !!this.ivyTekImportResults.length ||
      !!this.ivyTekLoanImportResults.length ||
      !!this.ivyTekTransactionImportResults.length
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
      'transactions'
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
      transactions: 'labels.heading.Stage 3 Transactions'
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
      const loanRows = this.parseCsv(await this.readFileAsText(this.ivyTekLoanFile));
      const transactionRows =
        this.ivyTekTransactionFile && (shouldRunLoans || shouldRunTransactions)
          ? this.parseCsv(await this.readFileAsText(this.ivyTekTransactionFile))
          : [];

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
        this.validateIvyTekTransactionRows(transactionRows, loanRows);
        this.finishIvyTekPipelineRun(
          this.hasIvyTekResultStatus(this.ivyTekTransactionImportResults, [
            'labels.inputs.Failed',
            'labels.inputs.Skipped'
          ])
            ? 'labels.inputs.Needs Review'
            : 'labels.inputs.Completed',
          this.hasIvyTekResultStatus(this.ivyTekTransactionImportResults, [
            'labels.inputs.Failed',
            'labels.inputs.Skipped'
          ])
            ? 'Stage 3 completed with records that need review.'
            : ''
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
    const transactionRows = this.parseCsv(await this.readFileAsText(this.ivyTekTransactionFile));
    const loanRows = this.parseCsv(await this.readFileAsText(this.ivyTekLoanFile));
    this.validateIvyTekTransactionRows(transactionRows, loanRows);
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
  private validateIvyTekTransactionRows(transactionRows: any[], loanRows: any[]) {
    this.ivyTekTransactionImporting = true;
    this.ivyTekTransactionProcessedRecords = 0;
    this.ivyTekTransactionTotalRecords = transactionRows.length;
    this.updateIvyTekPipelineRun({
      activeStage: 'labels.heading.Stage 3 Transactions',
      transactionsProcessed: this.ivyTekTransactionProcessedRecords,
      transactionsTotal: this.ivyTekTransactionTotalRecords
    });

    try {
      const bridgeRowsByLoanId = this.buildIvyTekLoanRowsById(loanRows);
      let readyCount = 0;
      let reviewCount = 0;
      let ignoredCount = 0;
      let disbursementCount = 0;

      for (const row of transactionRows) {
        const result = this.validateIvyTekTransaction(row, bridgeRowsByLoanId);
        if (result.status === 'labels.inputs.Ready') {
          readyCount += 1;
        } else if (result.historicalIgnored) {
          ignoredCount += 1;
          if (result.historicalDisbursement) {
            disbursementCount += 1;
          }
        } else {
          reviewCount += 1;
          this.ivyTekTransactionImportResults.push(result);
        }
        this.ivyTekTransactionProcessedRecords += 1;
        this.updateIvyTekPipelineRunProgress({
          transactionsProcessed: this.ivyTekTransactionProcessedRecords,
          transactionsTotal: this.ivyTekTransactionTotalRecords
        });
      }

      this.ivyTekTransactionImportResults.unshift(
        this.createIvyTekTransactionSummaryResult(
          transactionRows.length,
          readyCount,
          reviewCount,
          ignoredCount,
          disbursementCount
        )
      );
    } finally {
      this.ivyTekTransactionImporting = false;
      this.updateIvyTekPipelineRun({
        transactionsProcessed: this.ivyTekTransactionProcessedRecords,
        transactionsTotal: this.ivyTekTransactionTotalRecords
      });
    }
  }

  /**
   * Resets all IvyTek staged import results.
   */
  private resetIvyTekPipelineResults() {
    this.ivyTekPipelineError = '';
    this.ivyTekImportResults = [];
    this.ivyTekLoanImportResults = [];
    this.ivyTekTransactionImportResults = [];
    this.selectedIvyTekResult = null;
    this.ivyTekProcessedRecords = 0;
    this.ivyTekLoanProcessedRecords = 0;
    this.ivyTekTransactionProcessedRecords = 0;
    this.ivyTekTotalRecords = 0;
    this.ivyTekLoanTotalRecords = 0;
    this.ivyTekTransactionTotalRecords = 0;
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
      const mappedValueReviewMessage = this.getIvyTekLoanMappedValueReviewMessage(row, principal, balanceNow);
      result.mappedValues = this.getIvyTekLoanMappedValues(row, productName, principal, balanceNow, repayments);
      result.mappedValues = {
        ...result.mappedValues,
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
      const shouldCloseAfterDisbursement = this.shouldCloseIvyTekLoanAfterDisbursement(row, balanceNow);
      const payloadPrincipal = this.getIvyTekLoanPayloadPrincipal(
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
      const payloadLoanDate = this.getIvyTekLoanPayloadDate(row);
      const payloadInterestRatePercent = this.getIvyTekLoanPayloadInterestRatePercent(
        row,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement,
        historicalRepaymentSummary
      );
      const payloadInterestChargedFromDate = this.getIvyTekLoanInterestChargedFromDate(
        row,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement,
        historicalRepaymentSummary
      );
      result.mappedValues = {
        ...result.mappedValues,
        payloadPrincipal,
        principalSnapshotAdjustment: principalSnapshotAdjustment ?? '',
        migrationPrincipalPaid: migrationPrincipalPaid ?? '',
        payloadInterestRatePercent,
        payloadLoanDate,
        payloadInterestChargedFromDate,
        sourceLoanDate: this.getIvyTekSourceLoanDate(row),
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
      const payload = this.getIvyTekLoanPayload(
        row,
        client,
        product,
        productDetails,
        payloadPrincipal,
        repayments,
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
          const existingLifecycleMessage = await this.transitionIvyTekExistingLoanLifecycle(
            result.loanId,
            existingLoan,
            row,
            balanceNow,
            shouldApproveAndDisburse,
            payload.submittedOnDate
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
          const existingLifecycleMessage = await this.transitionIvyTekExistingLoanLifecycle(
            result.loanId,
            existingLoan,
            row,
            balanceNow,
            shouldApproveAndDisburse,
            payload.submittedOnDate
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
            payload.submittedOnDate
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
        const createdLoanDate = createdLoan.loanDate || this.getIvyTekLoanDate(row);
        if (result.loanId && shouldApproveAndDisburse) {
          await this.approveAndDisburseIvyTekLoan(result.loanId, createdLoanDate);
        }
        const migrationRepaymentMessage =
          result.loanId && shouldApproveAndDisburse && !shouldCloseAfterDisbursement
            ? await this.repayIvyTekActiveLoanToBalanceNow(
                result.loanId,
                row,
                payloadPrincipal,
                balanceNow,
                payloadInterestChargedFromDate || createdLoanDate,
                shouldApproveAndDisburse,
                shouldCloseAfterDisbursement,
                historicalRepaymentSummary
              )
            : '';
        const closeMessage = result.loanId
          ? await this.settleAndCloseIvyTekZeroBalanceLoan(result.loanId, row, balanceNow, createdLoanDate)
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
          const existingLifecycleMessage = await this.transitionIvyTekExistingLoanLifecycle(
            result.loanId,
            duplicateLoan,
            row,
            balanceNow,
            shouldApproveAndDisburse,
            payload.submittedOnDate
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
            payload.submittedOnDate
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
      this.setIvyTekLoanResultStatus(result, 'labels.inputs.Failed', this.getErrorMessage(error));
    }

    this.ivyTekLoanImportResults.push(result);
  }

  /**
   * Creates a loan, backdating the matched client's activation date when Fineract rejects the historical loan date.
   * @param {any} row IvyTek loan row.
   * @param {any} client Matched client.
   * @param {any} payload Loan payload.
   */
  private async createIvyTekLoanWithClientActivationFallback(row: any, client: any, payload: any) {
    try {
      return {
        response: await firstValueFrom(this.loansService.createLoansAccount('loans', payload)),
        activationMessage: '',
        loanDate: payload.submittedOnDate
      };
    } catch (error: any) {
      if (!this.isIvyTekClientActivationLoanDateError(error)) {
        throw error;
      }
      const activationMessage = await this.backdateIvyTekLoanClientActivation(client, row);
      const retryLoanDate = this.getIvyTekClientActivationBackdateDateText(row) || payload.submittedOnDate;
      const retryPayload = this.getIvyTekLoanPayloadWithDate(row, payload, retryLoanDate);
      return {
        response: await firstValueFrom(this.loansService.createLoansAccount('loans', retryPayload)),
        activationMessage,
        loanDate: retryLoanDate
      };
    }
  }

  /**
   * Updates a loan, backdating the matched client's activation date when Fineract rejects the historical loan date.
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
      if (!this.isIvyTekClientActivationLoanDateError(error)) {
        throw error;
      }
      const activationMessage = await this.backdateIvyTekLoanClientActivation(client, row);
      const retryLoanDate = this.getIvyTekClientActivationBackdateDateText(row) || payload.submittedOnDate;
      const retryPayload = this.getIvyTekLoanPayloadWithDate(row, payload, retryLoanDate);
      await firstValueFrom(this.loansService.updateLoansAccount('loans', loanId, retryPayload));
      return activationMessage;
    }
  }

  /**
   * Backdates the matched loan client's activation date to the historical loan date.
   * @param {any} client Matched client.
   * @param {any} row IvyTek loan row.
   */
  private async backdateIvyTekLoanClientActivation(client: any, row: any): Promise<string> {
    const clientId = this.getIvyTekClientId(client);
    const targetActivationDate = this.getIvyTekClientActivationBackdateDate(row);
    if (!clientId || !targetActivationDate) {
      return '';
    }
    return this.backdateIvyTekClientActivation(clientId, targetActivationDate);
  }

  /**
   * Backdates a client activation date when a source row proves an earlier loan relationship.
   * @param {string} clientId Client id.
   * @param {any} row IvyTek client or loan row.
   */
  private async backdateIvyTekClientActivationFromRow(clientId: string, row: any): Promise<string> {
    const targetActivationDate = this.getIvyTekClientActivationBackdateDate(row);
    if (!targetActivationDate) {
      return '';
    }
    return this.backdateIvyTekClientActivation(clientId, targetActivationDate);
  }

  /**
   * Backdates a client activation date if the current activation date is after the target date.
   * @param {string} clientId Client id.
   * @param {Date} targetActivationDate Target activation date.
   */
  private async backdateIvyTekClientActivation(clientId: string, targetActivationDate: Date): Promise<string> {
    const clientData: any = await firstValueFrom(this.clientsService.getClientDataAndTemplate(clientId));
    const safeTargetActivationDate = this.getIvyTekOfficeSafeDate(targetActivationDate, clientData);
    if (!safeTargetActivationDate) {
      return '';
    }
    const currentActivationDate = this.parseIvyTekDateValue(
      clientData?.timeline?.activatedOnDate || clientData?.activationDate || clientData?.activatedOnDate
    );
    if (currentActivationDate && safeTargetActivationDate >= currentActivationDate) {
      return '';
    }

    const currentSubmittedDate = this.parseIvyTekDateValue(
      clientData?.timeline?.submittedOnDate || clientData?.submittedOnDate
    );
    const submittedOnDate =
      this.getIvyTekOfficeSafeDate(
        currentSubmittedDate && currentSubmittedDate < safeTargetActivationDate
          ? currentSubmittedDate
          : safeTargetActivationDate,
        clientData
      ) || safeTargetActivationDate;
    const activationDateText = this.dateUtils.formatDate(safeTargetActivationDate, this.settingsService.dateFormat);
    const submittedOnDateText = this.dateUtils.formatDate(submittedOnDate, this.settingsService.dateFormat);

    await firstValueFrom(
      this.clientsService.updateClient(
        clientId,
        this.getIvyTekClientActivationUpdatePayload(clientData, submittedOnDateText, activationDateText)
      )
    );
    return `Client activation date backed up to ${activationDateText} for historical loan date.`;
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
      result.mappedValues = this.getIvyTekClientResultMappedValues(row, saveResult.clientId);
      this.setIvyTekResultStatus(result, saveResult.status);
    } catch (error: any) {
      this.setIvyTekResultStatus(result, 'labels.inputs.Failed', this.getErrorMessage(error));
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
        saveResult.clientId
      );
      this.setIvyTekResultStatus(this.selectedIvyTekResult, saveResult.status);
    } catch (error: any) {
      this.setIvyTekResultStatus(this.selectedIvyTekResult, 'labels.inputs.Failed', this.getErrorMessage(error));
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
        results: this.ivyTekTransactionImportResults
      }
    ];
    return stage === 'all' ? stages : stages.filter((stageResult: any) => stageResult.key === stage);
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
      'Status Key': result.status || '',
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
      'Status Key',
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
    const sourceHeaders = rows.flatMap((row: any) =>
      Object.keys(row).filter((key: string) => key.startsWith('source.'))
    );
    return [
      ...baseHeaders,
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
  private getIvyTekClientResultMappedValues(row: any, clientId: any) {
    const office = this.getIvyTekOfficeForRow(row);
    return {
      mifosClientId: clientId || '',
      sourceExternalId: this.getIvyTekExternalId(row),
      sourceEntityId: this.getIvyTekEntityId(row),
      sourceCompanyCode: this.getIvyTekCompanyCode(row),
      targetOfficeId: office?.id || '',
      targetOfficeName: office?.name || '',
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

    if (existingClient?.id) {
      await this.updateIvyTekClientWithMobileFallback(existingClient.id, row);
      clientId = existingClient.id;
      status = 'labels.inputs.Updated';
    } else {
      const createdClient: any = await this.createIvyTekClientWithMobileFallback(row);
      clientId = createdClient?.resourceId || createdClient?.clientId || createdClient?.id;
      status = 'labels.inputs.Created';
    }

    if (!clientId) {
      throw new Error('Client saved, but Mifos did not return a client id for the tribal data update.');
    }

    await this.upsertIvyTekClientTribalData(clientId.toString(), row);
    await this.upsertIvyTekClientIdentifiers(clientId.toString(), row);
    await this.upsertIvyTekClientAddress(clientId.toString(), row);
    return {
      status,
      clientId
    };
  }

  /**
   * Updates a client, retrying without mobileNo when the tenant requires mobile numbers to be unique.
   * @param {string} clientId Client identifier.
   * @param {any} row IvyTek CSV row.
   */
  private async updateIvyTekClientWithMobileFallback(clientId: string, row: any) {
    await this.backdateIvyTekClientActivationFromRow(clientId, row);
    const payload = this.getIvyTekClientPayload(row);
    try {
      await firstValueFrom(this.clientsService.updateClient(clientId, payload));
    } catch (error: any) {
      if (!payload.mobileNo || !this.isIvyTekDuplicateMobileNoError(error)) {
        throw error;
      }
      const retryPayload = this.getIvyTekPayloadWithoutMobileNo(payload);
      await firstValueFrom(this.clientsService.updateClient(clientId, retryPayload));
    }
  }

  /**
   * Creates a client, retrying without mobileNo when the tenant requires mobile numbers to be unique.
   * @param {any} row IvyTek CSV row.
   */
  private async createIvyTekClientWithMobileFallback(row: any) {
    const payload = this.getIvyTekClientPayload(row, true, true);
    try {
      return await firstValueFrom(this.clientsService.createClient(payload));
    } catch (error: any) {
      if (!payload.mobileNo || !this.isIvyTekDuplicateMobileNoError(error)) {
        throw error;
      }
      const retryPayload = this.getIvyTekPayloadWithoutMobileNo(payload);
      return await firstValueFrom(this.clientsService.createClient(retryPayload));
    }
  }

  /**
   * Removes mobileNo from a payload without mutating the original.
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
    if (!this.hasIvyTekDatatablePayloadValues(payload)) {
      return false;
    }

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
    return true;
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
    const columnType = column?.columnDisplayType;
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
    if (columnType === 'CODELOOKUP') {
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
    return Object.keys(payload).some((key: string) => key !== 'locale' && payload[key] !== '');
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
      return;
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
        return;
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
      }
    }
  }

  /**
   * Adds or updates a client address when the IvyTek source includes address fields.
   * @param {string} clientId Client identifier.
   * @param {any} row IvyTek CSV row.
   */
  private async upsertIvyTekClientAddress(clientId: string, row: any) {
    const addressPayload = await this.getIvyTekClientAddressPayload(row);
    if (!addressPayload) {
      return;
    }

    let existingAddresses: any[] = [];
    try {
      existingAddresses = this.normalizeIvyTekListResponse(
        await firstValueFrom(this.clientsService.getClientAddressData(clientId))
      );
    } catch (error: any) {
      if (error?.status === 404) {
        return;
      }
      throw error;
    }

    const existingAddress = existingAddresses.find((address: any) => {
      const addressTypeId = address.addressTypeId || address.addressType?.id || address.addressType;
      return addressTypeId?.toString() === addressPayload.addressTypeId.toString();
    });

    if (existingAddress) {
      await firstValueFrom(
        this.clientsService.editClientAddress(clientId, addressPayload.addressTypeId, {
          ...addressPayload,
          addressId: existingAddress.addressId || existingAddress.id
        })
      );
    } else {
      await firstValueFrom(
        this.clientsService.createClientAddress(clientId, addressPayload.addressTypeId, addressPayload)
      );
    }
  }

  /**
   * Builds a client address payload from IvyTek statement/contact address columns.
   * @param {any} row IvyTek CSV row.
   */
  private async getIvyTekClientAddressPayload(row: any) {
    const addressValues = {
      street: this.getFirstCsvValue(row, [
        'IvytekTestPkg__Statement_Street__c',
        'Statement Street',
        'MailingStreet',
        'Street',
        'Address',
        'Address Line 1',
        'address_line_1'
      ]),
      addressLine2: this.getFirstCsvValue(row, [
        'MailingAddressLine2',
        'Address Line 2',
        'address_line_2'
      ]),
      city: this.getFirstCsvValue(row, [
        'IvytekTestPkg__Statement_City__c',
        'Statement City',
        'MailingCity',
        'City',
        'city'
      ]),
      stateProvince: this.getFirstCsvValue(row, [
        'IvytekTestPkg__Statement_State_Province__c',
        'Statement State',
        'MailingState',
        'State',
        'state'
      ]),
      postalCode: this.getFirstCsvValue(row, [
        'IvytekTestPkg__Statement_PostalCode__c',
        'IvytekTestPkg__Statement_Postal_Code__c',
        'Statement Postal Code',
        'MailingPostalCode',
        'PostalCode',
        'Zip',
        'ZIP',
        'postal_code'
      ]),
      country: this.getFirstCsvValue(row, [
        'MailingCountry',
        'Country',
        'country'
      ])
    };

    if (!Object.values(addressValues).some((value: string) => !!value)) {
      return null;
    }

    const addressTemplate = await this.getIvyTekClientAddressTemplate();
    const addressTypeOptions = addressTemplate?.addressTypeIdOptions || [];
    const addressTypeId =
      this.findIvyTekOptionId(addressTypeOptions, [
        'Home',
        'Residential',
        'Permanent',
        'Mailing'
      ]) || addressTypeOptions[0]?.id;
    if (!addressTypeId) {
      return null;
    }

    const payload: any = {
      addressTypeId,
      street: addressValues.street,
      addressLine1: addressValues.street,
      addressLine2: addressValues.addressLine2,
      city: addressValues.city,
      postalCode: addressValues.postalCode,
      stateProvinceId: this.findIvyTekOptionId(addressTemplate?.stateProvinceIdOptions || [], [
        addressValues.stateProvince
      ]),
      countryId: this.findIvyTekOptionId(addressTemplate?.countryIdOptions || [], [
        addressValues.country,
        'United States',
        'USA',
        'US'
      ]),
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
   * Loads and caches the client address template.
   */
  private async getIvyTekClientAddressTemplate() {
    if (this.ivyTekClientAddressTemplate || this.ivyTekClientAddressTemplateUnavailable) {
      return this.ivyTekClientAddressTemplate;
    }
    try {
      this.ivyTekClientAddressTemplate = await firstValueFrom(this.clientsService.getClientAddressTemplate());
    } catch (error: any) {
      if (error?.status !== 404) {
        throw error;
      }
      this.ivyTekClientAddressTemplateUnavailable = true;
    }
    return this.ivyTekClientAddressTemplate;
  }

  /**
   * Builds the Fineract client payload from an IvyTek CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private getIvyTekClientPayload(row: any, isNewClient: boolean = false, includeDatatables: boolean = false) {
    const dateFormat = this.settingsService.dateFormat;
    const locale = this.settingsService.language.code;
    const importDate = this.dateUtils.formatDate(this.settingsService.businessDate, dateFormat);
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
      const activationDate = this.getIvyTekClientActivationDate(row) || importDate;
      payload.officeId = this.getIvyTekOfficeIdForRow(row);
      payload.active = true;
      payload.submittedOnDate = activationDate;
      payload.activationDate = activationDate;
    }
    if (includeDatatables && this.getIvyTekEntityId(row)) {
      payload.datatables = [
        {
          registeredTableName: this.ivyTekClientTribalDatatableName,
          data: this.getIvyTekClientTribalDataPayload(row)
        }
      ];
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
    const safeActivationDate = this.getIvyTekOfficeSafeDate(
      this.getEarliestIvyTekDate([
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
      ]),
      row
    );
    return safeActivationDate ? this.dateUtils.formatDate(safeActivationDate, this.settingsService.dateFormat) : '';
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
   * Keeps import dates within Fineract's office-opening boundary.
   * @param {Date | null} date Candidate import date.
   * @param {any} row Optional IvyTek source row.
   */
  private getIvyTekOfficeSafeDate(date: Date | null, row: any = null): Date | null {
    const officeOpeningDate = this.getIvyTekSelectedOfficeOpeningDate(row);
    return date && officeOpeningDate && date < officeOpeningDate ? officeOpeningDate : date;
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
    return message.includes('already exists') || message.includes('already registered');
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

    const option = options.find((templateOption: any) => {
      const optionNames = [
        templateOption.name,
        templateOption.value,
        templateOption.code,
        templateOption.description
      ].map((name: string) => this.normalizeIvyTekText(name));
      return optionNames.some((name: string) => normalizedNames.includes(name));
    });
    return option?.id || '';
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
        'labels.inputs.Skipped',
        'No bridge row was found for the Salesforce loan id.'
      );
    } else if (amount === null) {
      this.setIvyTekTransactionResultStatus(result, 'labels.inputs.Failed', 'Missing transaction amount.');
    } else if (result.historicalDisbursement) {
      result.historicalIgnored = true;
      this.setIvyTekTransactionResultStatus(
        result,
        'labels.inputs.Skipped',
        'Ignored because this IvyTek row is the legacy negative disbursement marker.'
      );
    } else if (!this.isIvyTekHistoricalRepaymentTransaction(row)) {
      result.historicalIgnored = true;
      this.setIvyTekTransactionResultStatus(
        result,
        'labels.inputs.Skipped',
        'Ignored because this IvyTek row is not a historical repayment.'
      );
    } else if (!result.transactionDate) {
      this.setIvyTekTransactionResultStatus(result, 'labels.inputs.Failed', 'Missing transaction date.');
    } else {
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
      row,
      status: '',
      message: ''
    };
  }

  /**
   * Creates a summary row for successful historical transaction validation.
   * @param {number} totalCount Total transaction rows.
   * @param {number} readyCount Ready transaction rows.
   * @param {number} reviewCount Transaction rows needing review.
   * @param {number} ignoredCount Non-repayment transaction rows ignored by design.
   * @param {number} disbursementCount Legacy negative disbursement marker rows.
   */
  private createIvyTekTransactionSummaryResult(
    totalCount: number,
    readyCount: number,
    reviewCount: number,
    ignoredCount: number,
    disbursementCount: number
  ) {
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
      transactionSummary: true,
      row: {},
      status: 'labels.inputs.Ready',
      message: `${readyCount} of ${totalCount} historical repayment rows are ready for review/export. ${ignoredCount} non-repayment rows were ignored by design, including ${disbursementCount} legacy negative disbursement marker rows. ${reviewCount} rows need review. Ready rows are summarized instead of listed individually to keep the import screen responsive.`
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
      this.getCsvValue(row, 'IvytekTestPkg__DatePaid__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__DateLastPaid__c') ||
      this.getCsvValue(row, 'DatePaid') ||
      this.getCsvValue(row, 'Date Last Paid') ||
      this.getCsvValue(row, 'CreatedDate');
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
   * @param {string} group IvyTek loan group.
   * @param {Map<string, any>} productsByName Loan products keyed by normalized name.
   */
  private findIvyTekLoanProductByGroup(group: string, productsByName: Map<string, any>) {
    return this.getIvyTekProductNameCandidates(group)
      .map((name: string) => productsByName.get(this.normalizeIvyTekText(name)))
      .find((product: any) => !!product?.id);
  }

  /**
   * Gets possible Mifos product names for an IvyTek loan group.
   * @param {string} group IvyTek loan group.
   */
  private getIvyTekProductNameCandidates(group: string): string[] {
    const normalizedGroup = this.normalizeIvyTekLoanGroup(group);
    const numericGroup = normalizedGroup.replace(/\D/g, '');
    const candidates = [
      this.getIvyTekProductName(group),
      this.getIvyTekProductName(normalizedGroup),
      group,
      normalizedGroup
    ];

    if (numericGroup) {
      candidates.push(`G${numericGroup}`, `G${numericGroup.padStart(3, '0')}`);
    }

    return Array.from(new Set(candidates.filter((candidate: string) => !!candidate)));
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
    const parsedSourceDate = this.parseIvyTekDate(sourceDate);
    const parsedLoanDate = this.parseIvyTekDate(loanDateText);
    if (parsedSourceDate && parsedLoanDate && parsedSourceDate < parsedLoanDate) {
      return {
        sourceDate,
        date: this.dateUtils.formatDate(parsedLoanDate, this.settingsService.dateFormat),
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
   * Checks whether historical repayment rows should drive the active loan migration.
   * @param {any} summary Historical repayment summary.
   */
  private shouldPostIvyTekHistoricalRepayments(summary: any): boolean {
    return !!summary?.count && summary.totalAmount > 0 && this.ivyTekPostHistoricalRepaymentsToFineract;
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
    await this.upsertIvyTekClientTribalData(clientId, row);
    await this.upsertIvyTekClientIdentifiers(clientId, row);
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
      this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Customer_Name_Text__c'),
      this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Customer_Name__c'),
      this.getCsvValue(contactApplication || {}, 'IvyTestPkg__Customer_Name__c'),
      this.getCsvValue(contactApplication || {}, 'IvytekTestPkg__Full_Name__c')
    ]);
    const names = this.getUniqueIvyTekIdentifiers([
      ...this.getIvyTekCustomerNameCandidates(row),
      ...contactApplicationNames,
      this.getCsvValue(borrowerContactApplication || {}, 'IvytekTestPkg__Borrower_Name_Text__c'),
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
    if (
      this.isIvyTekLoanInterestAccrualSuppressed(
        row,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement,
        historicalRepaymentSummary
      )
    ) {
      return 0;
    }

    return this.getIvyTekLoanInterestRatePercent(row);
  }

  /**
   * Gets the submitted/disbursement date sent to Fineract.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanPayloadDate(row: any): string {
    return this.getIvyTekLoanDate(row);
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
    if (
      !this.shouldUseIvyTekMigrationDateForLoan(
        row,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement,
        historicalRepaymentSummary
      )
    ) {
      return '';
    }

    return this.getIvyTekLoanInterestSnapshotStartDateText(row) || this.getIvyTekBusinessDate();
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
   * Gets the source date that represents the start of the active interest snapshot.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanInterestSnapshotStartDate(row: any): Date | null {
    const sourceDate = this.parseIvyTekDate(
      this.getCsvValue(row, 'IvytekTestPkg__LastInterestDate__c') ||
        this.getCsvValue(row, 'IvytekTestPkg__DateLastCollected__c') ||
        this.getCsvValue(row, 'IvytekTestPkg__LastRCTransDate__c')
    );
    if (!sourceDate) {
      return null;
    }

    const safeSourceDate = this.getIvyTekOfficeSafeDate(sourceDate, row) || sourceDate;
    const sourceLoanDate = this.parseIvyTekDate(
      this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c') || this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c')
    );
    const businessDate = this.settingsService.businessDate;
    const notBeforeLoanDate = sourceLoanDate && safeSourceDate < sourceLoanDate ? sourceLoanDate : safeSourceDate;
    return notBeforeLoanDate > businessDate ? businessDate : notBeforeLoanDate;
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
    return (
      shouldCloseAfterDisbursement ||
      this.shouldUseIvyTekMigrationDateForLoan(
        row,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement,
        historicalRepaymentSummary
      )
    );
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
      'Percap',
      'Per Capita',
      'Per_Capita'
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
  private getIvyTekLoanMappedValueReviewMessage(row: any, principal: number | null, balanceNow: number | null) {
    if (balanceNow === null) {
      return 'Missing IvyTek current balance. Check IvytekTestPkg__BalanceNow__c.';
    }

    const amountFinanced = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__AmtFinanced__c'));
    const requestAmount = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__RequestAmount__c'));
    if (
      amountFinanced !== null &&
      requestAmount !== null &&
      !this.areIvyTekMoneyValuesEqual(amountFinanced, requestAmount)
    ) {
      return `Principal source fields do not match. AmtFinanced is ${amountFinanced}; RequestAmount is ${requestAmount}.`;
    }

    const contractRate = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__ContractRate__c'));
    const marginRate = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__Margin_Rate__c'));
    if (contractRate !== null && marginRate !== null) {
      const contractRatePercent = contractRate > 1 ? contractRate : contractRate * 100;
      if (Math.abs(contractRatePercent - marginRate) > 0.01) {
        return `Interest rate source fields do not match. ContractRate maps to ${contractRatePercent}; Margin Rate is ${marginRate}.`;
      }
    }

    if (!principal || principal <= 0) {
      return this.getIvyTekPrincipalReviewMessage(row);
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
  private getIvyTekLoanPayloadPrincipal(
    row: any,
    principal: number | null,
    balanceNow: number | null,
    shouldApproveAndDisburse: boolean,
    shouldCloseAfterDisbursement: boolean
  ): number | null {
    if (
      shouldApproveAndDisburse &&
      !shouldCloseAfterDisbursement &&
      this.isIvyTekSourceLoanRecord(row) &&
      principal !== null &&
      balanceNow !== null &&
      balanceNow > 0 &&
      balanceNow > principal &&
      !this.areIvyTekMoneyValuesEqual(balanceNow, principal)
    ) {
      return this.roundIvyTekMoney(balanceNow);
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
    if (
      principal === null ||
      payloadPrincipal === null ||
      payloadPrincipal <= principal ||
      this.areIvyTekMoneyValuesEqual(payloadPrincipal, principal)
    ) {
      return null;
    }

    return this.roundIvyTekMoney(payloadPrincipal - principal);
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
    if (
      !shouldApproveAndDisburse ||
      shouldCloseAfterDisbursement ||
      !this.isIvyTekSourceLoanRecord(row) ||
      principal === null ||
      balanceNow === null ||
      balanceNow <= 0 ||
      principal <= balanceNow ||
      this.areIvyTekMoneyValuesEqual(principal, balanceNow)
    ) {
      return null;
    }

    return this.roundIvyTekMoney(principal - balanceNow);
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
    return (
      !!this.ivyTekLoanImportForm.get('approveAndDisburse').value &&
      this.isIvyTekSourceLoanRecord(row) &&
      !this.shouldKeepIvyTekLoanUndisbursed(balanceNow)
    );
  }

  /**
   * Keeps overpaid historical loans out of automatic disbursement until overpayment migration is explicit.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private shouldKeepIvyTekLoanUndisbursed(balanceNow: number | null) {
    return balanceNow !== null && balanceNow < 0 && !this.areIvyTekMoneyValuesEqual(balanceNow, 0);
  }

  /**
   * Checks whether a historical loan should be closed after disbursement.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private shouldCloseIvyTekLoanAfterDisbursement(row: any, balanceNow: number | null) {
    return (
      !!this.ivyTekLoanImportForm.get('approveAndDisburse').value &&
      this.isIvyTekSourceLoanRecord(row) &&
      balanceNow !== null &&
      this.areIvyTekMoneyValuesEqual(balanceNow, 0)
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
    if (shouldApproveAndDisburse) {
      if (shouldCloseAfterDisbursement) {
        return (
          `Approved, disbursed, repaid, and closed as a zero-balance historical loan. IvyTek BalanceNow is ${this.formatIvyTekNumber(balanceNow)}. ` +
          'Interest rate is set to 0 for the closeout so Fineract does not manufacture payoff interest.'
        );
      }
      const principal = this.getIvyTekLoanPrincipal(row);
      const migrationRepaymentMessage = migrationPrincipalPaid
        ? this.shouldPostIvyTekHistoricalRepayments(historicalRepaymentSummary)
          ? ` IvyTek transaction history carries ${this.formatIvyTekNumber(migrationPrincipalPaid)} of historical principal paid toward BalanceNow ${this.formatIvyTekNumber(balanceNow)}.`
          : ` A migration repayment of ${this.formatIvyTekNumber(migrationPrincipalPaid)} carries over historical principal paid and lands outstanding principal on IvyTek BalanceNow ${this.formatIvyTekNumber(balanceNow)}.`
        : '';
      const payloadPrincipalMessage =
        principal !== null &&
        payloadPrincipal !== null &&
        payloadPrincipal > principal &&
        !this.areIvyTekMoneyValuesEqual(payloadPrincipal, principal)
          ? `using IvyTek BalanceNow ${this.formatIvyTekNumber(payloadPrincipal)} as the payload principal because it is higher than IvyTek original principal ${this.formatIvyTekNumber(principal)}.`
          : `using IvyTek original principal ${this.formatIvyTekNumber(principal)} as the payload principal.`;
      const interestMessage = this.isIvyTekLoanInterestAccrualSuppressed(
        row,
        balanceNow,
        shouldApproveAndDisburse,
        shouldCloseAfterDisbursement,
        historicalRepaymentSummary
      )
        ? `Source interest rate ${this.formatIvyTekNumber(this.getIvyTekLoanInterestRatePercent(row))}% is retained in the export, while the payload rate is set to 0${
            interestChargedFromDate
              ? ` and the IvyTek interest snapshot date is recorded as ${interestChargedFromDate}`
              : ''
          } to prevent Fineract from generating schedule interest that changes the IvyTek opening balance.`
        : this.shouldPostIvyTekHistoricalRepayments(historicalRepaymentSummary)
          ? `Source interest rate ${this.formatIvyTekNumber(this.getIvyTekLoanInterestRatePercent(row))}% is sent to Fineract so the provided IvyTek payment history can drive principal and interest allocation.`
          : `Source interest rate ${this.formatIvyTekNumber(this.getIvyTekLoanInterestRatePercent(row))}% is sent to Fineract with interest charged from ${interestChargedFromDate} so interest accrues from IvyTek's last-interest snapshot date.`;
      return (
        `Approved and disbursed on ${payloadLoanDate} ${payloadPrincipalMessage}` +
        migrationRepaymentMessage +
        ' ' +
        interestMessage +
        ' ' +
        (this.shouldPostIvyTekHistoricalRepayments(historicalRepaymentSummary)
          ? 'IvyTek historical repayments are posted chronologically and then balanced against the IvyTek snapshot.'
          : 'Detailed historical transactions are validation/export only; only the controlled migration repayment is posted to set the opening balance.')
      );
    }

    if (this.ivyTekLoanImportForm.get('approveAndDisburse').value) {
      if (this.isIvyTekSourceLoanRecord(row) && this.shouldKeepIvyTekLoanUndisbursed(balanceNow)) {
        return `Created or updated without disbursement because IvyTek BalanceNow is ${this.formatIvyTekNumber(balanceNow)}. Overpaid historical loans need a separate overpayment migration rule.`;
      }
      return `Created or updated without disbursement because this row was not recognized as an IvyTek loan record. IvyTek BalanceNow is ${this.formatIvyTekNumber(balanceNow)}.`;
    }

    return 'Loan terms imported only. Approval/disbursement is disabled so historical import data does not create a Fineract balance.';
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
    loanDate: string = this.getIvyTekLoanDate(row)
  ): Promise<string> {
    if (!loanId) {
      return '';
    }

    if (!shouldApproveAndDisburse) {
      return '';
    }

    if (this.isIvyTekLoanClosed(loan)) {
      return '';
    }

    const messages: string[] = [];
    let disbursedDuringImport = false;
    try {
      if (this.isIvyTekLoanApproved(loan)) {
        await this.disburseIvyTekLoan(loanId, loanDate);
        disbursedDuringImport = true;
        messages.push(`Existing approved loan was disbursed on ${loanDate}.`);
      } else if (this.canUpdateExistingIvyTekLoan(loan)) {
        await this.approveAndDisburseIvyTekLoan(loanId, loanDate);
        disbursedDuringImport = true;
        messages.push(`Existing pending loan was approved and disbursed on ${loanDate}.`);
      }

      if (disbursedDuringImport) {
        const payloadPrincipal = this.getIvyTekLoanPayloadPrincipal(
          row,
          this.getIvyTekLoanPrincipal(row),
          balanceNow,
          shouldApproveAndDisburse,
          false
        );
        const migrationRepaymentMessage = await this.repayIvyTekActiveLoanToBalanceNow(
          loanId,
          row,
          payloadPrincipal,
          balanceNow,
          this.getIvyTekLoanInterestChargedFromDate(row, balanceNow, true, false) || loanDate
        );
        if (migrationRepaymentMessage) {
          messages.push(migrationRepaymentMessage);
        }
      }

      const closeMessage = await this.settleAndCloseIvyTekZeroBalanceLoan(loanId, row, balanceNow, loanDate);
      if (closeMessage) {
        messages.push(closeMessage);
      }
    } catch (error: any) {
      if (this.isIvyTekLoanCurrentStateError(error)) {
        return 'Existing loan state prevented automatic disbursement.';
      }
      throw error;
    }

    return this.joinIvyTekMessages(messages);
  }

  /**
   * Checks whether a loan is already disbursed or closed.
   * @param {any} loan Loan response.
   */
  private isIvyTekLoanDisbursedOrClosed(loan: any) {
    return this.isIvyTekLoanActiveOrOverpaid(loan) || this.isIvyTekLoanClosed(loan);
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
  private async approveAndDisburseIvyTekLoan(loanId: string, loanDate: string) {
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
    await this.disburseIvyTekLoan(loanId, loanDate);
  }

  /**
   * Disburses an approved IvyTek loan.
   * @param {string} loanId Mifos loan id.
   * @param {string} loanDate Loan date text.
   */
  private async disburseIvyTekLoan(loanId: string, loanDate: string) {
    const commandData = {
      dateFormat: this.settingsService.dateFormat,
      locale: this.settingsService.language.code
    };
    await firstValueFrom(
      this.loansService.executeLoanCommand(loanId, 'disburse', {
        ...commandData,
        actualDisbursementDate: loanDate
      })
    );
  }

  /**
   * Posts a single migration repayment for the exact historical principal-paid amount.
   * @param {string} loanId Mifos loan id.
   * @param {any} row IvyTek loan row.
   * @param {number | null} principal Principal amount sent to Fineract.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {string} transactionDate Migration repayment date.
   * @param {boolean} shouldApproveAndDisburse Whether the import activated the loan.
   * @param {boolean} shouldCloseAfterDisbursement Whether this zero-balance loan will be closed immediately.
   * @param {any} historicalRepaymentSummary Historical payment rows grouped for this loan.
   */
  private async repayIvyTekActiveLoanToBalanceNow(
    loanId: string,
    row: any,
    principal: number | null,
    balanceNow: number | null,
    transactionDate: string,
    shouldApproveAndDisburse: boolean = true,
    shouldCloseAfterDisbursement: boolean = false,
    historicalRepaymentSummary: any = null
  ): Promise<string> {
    if (
      this.shouldPostIvyTekHistoricalRepayments(historicalRepaymentSummary) &&
      shouldApproveAndDisburse &&
      !shouldCloseAfterDisbursement
    ) {
      return this.postIvyTekHistoricalRepaymentsToSnapshot(
        loanId,
        row,
        principal,
        balanceNow,
        historicalRepaymentSummary
      );
    }

    const sourcePrincipalPaid = this.getIvyTekActiveLoanMigrationPrincipalPaid(
      row,
      principal,
      balanceNow,
      shouldApproveAndDisburse,
      shouldCloseAfterDisbursement
    );
    if (!loanId || !sourcePrincipalPaid || balanceNow === null) {
      return '';
    }

    const loan = await this.getIvyTekLoanForLifecycle(loanId);
    if (loan && !this.isIvyTekLoanActiveOrOverpaid(loan)) {
      return '';
    }

    let transactionAmount = sourcePrincipalPaid;
    const currentPrincipalOutstanding = this.getIvyTekLoanSummaryPrincipalOutstanding(loan);
    if (currentPrincipalOutstanding !== null) {
      if (
        currentPrincipalOutstanding <= balanceNow ||
        this.areIvyTekMoneyValuesEqual(currentPrincipalOutstanding, balanceNow)
      ) {
        return '';
      }
      transactionAmount = this.roundIvyTekMoney(currentPrincipalOutstanding - balanceNow);
    }

    if (!transactionAmount || transactionAmount <= 0) {
      return '';
    }

    await firstValueFrom(
      this.loansService.submitLoanActionButton(
        loanId,
        {
          transactionDate,
          transactionAmount,
          dateFormat: this.settingsService.dateFormat,
          locale: this.settingsService.language.code,
          note: 'IvyTek import: migration repayment to carry over historical principal paid and preserve BalanceNow.'
        },
        'repayment'
      )
    );
    return `Migration repayment of ${this.formatIvyTekNumber(transactionAmount)} was posted on ${transactionDate} to carry IvyTek historical principal paid and land principal outstanding on IvyTek BalanceNow ${this.formatIvyTekNumber(balanceNow)}.`;
  }

  /**
   * Posts IvyTek payment-history rows chronologically for an active migration loan.
   * @param {string} loanId Mifos loan id.
   * @param {any} row IvyTek loan row.
   * @param {number | null} principal Principal amount sent to Fineract.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {any} summary Historical repayment summary.
   */
  private async postIvyTekHistoricalRepaymentsToSnapshot(
    loanId: string,
    row: any,
    principal: number | null,
    balanceNow: number | null,
    summary: any
  ): Promise<string> {
    if (!loanId || principal === null || balanceNow === null || !this.shouldPostIvyTekHistoricalRepayments(summary)) {
      return '';
    }

    const loan = await this.getIvyTekLoanForLifecycle(loanId);
    if (loan && !this.isIvyTekLoanActiveOrOverpaid(loan)) {
      return '';
    }

    for (const transaction of summary.rows) {
      await firstValueFrom(
        this.loansService.submitLoanActionButton(
          loanId,
          {
            transactionDate: transaction.date,
            transactionAmount: transaction.amount,
            dateFormat: this.settingsService.dateFormat,
            locale: this.settingsService.language.code,
            note: this.getIvyTekHistoricalRepaymentNote(transaction)
          },
          'repayment'
        )
      );
    }

    const interestMessage = await this.alignIvyTekLoanOutstandingInterest(
      loanId,
      row,
      summary.lastDate || this.getIvyTekBusinessDate()
    );
    const balanceMessage = await this.getIvyTekPostRepaymentBalanceMessage(loanId, row, balanceNow);
    return this.joinIvyTekMessages([
      `Posted ${summary.count} IvyTek historical repayments from ${summary.firstDate} through ${summary.lastDate} totaling ${this.formatIvyTekNumber(summary.totalAmount)} (${this.formatIvyTekNumber(summary.principalPaid)} principal, ${this.formatIvyTekNumber(summary.interestPaid)} interest from IvyTek history).`,
      interestMessage,
      balanceMessage
    ]);
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
        ? `Source payment date ${transaction.sourceDate} was before disbursement, so it was posted on ${transaction.date}.`
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

    if (currentInterest <= targetInterest || this.areIvyTekMoneyValuesEqual(currentInterest, targetInterest)) {
      return `Fineract interest outstanding is ${this.formatIvyTekNumber(currentInterest)}, matching or below IvyTek snapshot interest ${this.formatIvyTekNumber(targetInterest)}.`;
    }

    const waiverAmount = this.roundIvyTekMoney(currentInterest - targetInterest);
    await firstValueFrom(
      this.loansService.submitLoanActionButton(
        loanId,
        {
          transactionDate: this.getIvyTekInterestAlignmentDate(row, transactionDate),
          transactionAmount: waiverAmount,
          dateFormat: this.settingsService.dateFormat,
          locale: this.settingsService.language.code,
          note: 'IvyTek import: waive generated Fineract interest down to the IvyTek interest snapshot.'
        },
        'waiveinterest'
      )
    );
    return `Waived ${this.formatIvyTekNumber(waiverAmount)} of generated Fineract interest so outstanding interest lands on IvyTek snapshot ${this.formatIvyTekNumber(targetInterest)}.`;
  }

  /**
   * Gets a safe transaction date for interest alignment.
   * @param {any} row IvyTek loan row.
   * @param {string} fallbackDate Fallback transaction date.
   */
  private getIvyTekInterestAlignmentDate(row: any, fallbackDate: string): string {
    return this.getIvyTekLoanInterestSnapshotStartDateText(row) || fallbackDate || this.getIvyTekBusinessDate();
  }

  /**
   * Gets the IvyTek outstanding-interest snapshot for an active loan.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanHistoricalInterestOutstanding(row: any): number | null {
    const balanceNow = this.getIvyTekLoanBalanceNow(row);
    const payoffAmount = this.getFirstIvyTekDecimal(row, [
      'IvytekTestPkg__Payoff_Amount__c',
      'Payoff Amount',
      'PayoffAmount'
    ]);
    if (balanceNow !== null && payoffAmount !== null && payoffAmount >= balanceNow) {
      return this.roundIvyTekMoney(payoffAmount - balanceNow);
    }

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
    if (!interestParts.length) {
      return null;
    }
    return this.roundIvyTekMoney(interestParts.reduce((total: number, value: number) => total + value, 0));
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
   * Posts the payoff transaction and closes a zero-balance historical IvyTek loan.
   * @param {string} loanId Mifos loan id.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private async settleAndCloseIvyTekZeroBalanceLoan(
    loanId: string,
    row: any,
    balanceNow: number | null,
    minimumLoanDate: string = this.getIvyTekLoanDate(row)
  ): Promise<string> {
    if (!loanId || !this.shouldCloseIvyTekLoanAfterDisbursement(row, balanceNow)) {
      return '';
    }

    const closeDate = this.getIvyTekHistoricalLoanCloseDate(row, minimumLoanDate);
    const existingLoan = await this.getIvyTekLoanForLifecycle(loanId);
    if (this.isIvyTekLoanClosed(existingLoan)) {
      return 'Zero-balance historical loan was already closed.';
    }

    const payoffMessage = await this.repayIvyTekLoanForHistoricalClose(loanId, closeDate);
    const closeMessage = await this.closeIvyTekHistoricalLoan(loanId, closeDate);
    return this.joinIvyTekMessages([
      payoffMessage,
      closeMessage
    ]);
  }

  /**
   * Posts the payoff amount needed before closing a zero-balance historical loan.
   * @param {string} loanId Mifos loan id.
   * @param {string} transactionDate Payoff transaction date.
   */
  private async repayIvyTekLoanForHistoricalClose(loanId: string, transactionDate: string): Promise<string> {
    const template: any = await firstValueFrom(
      this.loansService.getLoanPrepayLoanActionTemplate(loanId, transactionDate)
    );
    const transactionAmount = this.getIvyTekLoanPayoffAmount(template);
    if (!transactionAmount || transactionAmount <= 0) {
      return 'No payoff repayment was needed before closing the zero-balance historical loan.';
    }

    await firstValueFrom(
      this.loansService.submitLoanActionButton(
        loanId,
        {
          transactionDate,
          transactionAmount,
          dateFormat: this.settingsService.dateFormat,
          locale: this.settingsService.language.code,
          note: 'IvyTek import: payoff transaction for zero-balance historical loan close.'
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
            note: 'IvyTek import: closing zero-balance historical loan.'
          },
          'close'
        )
      );
      return `Zero-balance historical loan was closed on ${transactionDate}.`;
    } catch (error: any) {
      const loan = await this.getIvyTekLoanForLifecycle(loanId);
      if (this.isIvyTekLoanClosed(loan)) {
        return `Zero-balance historical loan was already closed on or before ${transactionDate}.`;
      }
      throw error;
    }
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
      amount: this.getIvyTekLoanChargeAmount(row, principal)
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
    const source = this.ivyTekLoanImportForm.get('chargeAmountSource').value;
    if (source === 'balance_now') {
      return this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__BalanceNow__c')) || principal;
    }
    if (source === 'payoff_amount') {
      return this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__Payoff_Amount__c')) || principal;
    }
    return principal;
  }

  /**
   * Gets the mapped Mifos loan product name for an IvyTek group.
   * @param {string} group IvyTek loan group.
   */
  private getIvyTekProductName(group: string): string {
    const productMap: any = {
      '80': 'Estates Pending Loan',
      '080': 'Estates Pending Loan',
      '99': 'G099',
      '099': 'G099',
      '101': 'Personal Loan',
      '303': 'Home Construction Loan',
      '304': 'Home Modernization Loan',
      '407': 'Mobile Home and Trailer Loan',
      '408': 'G408',
      '510': 'Education Loan',
      '615': 'Business Enterprise Loan',
      '817': 'Tribal Enterprise Loan'
    };
    return productMap[group] || '';
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
    if (this.ivyTekLoanImportForm.get('preserveHistoricalDates').value) {
      const loanDate = this.parseIvyTekDate(
        this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c') || this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c')
      );
      if (loanDate) {
        return this.dateUtils.formatDate(
          this.getIvyTekOfficeSafeDate(loanDate, row) || loanDate,
          this.settingsService.dateFormat
        );
      }
    }
    return this.dateUtils.formatDate(this.settingsService.businessDate, this.settingsService.dateFormat);
  }

  /**
   * Gets the current business date in the active Mifos date format.
   */
  private getIvyTekBusinessDate(): string {
    return this.dateUtils.formatDate(this.settingsService.businessDate, this.settingsService.dateFormat);
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
    const loanDate = this.parseIvyTekDate(minimumLoanDate);
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
    const safeCloseDate =
      this.getIvyTekOfficeSafeDate(sourceCloseDate || loanDate || this.settingsService.businessDate, row) ||
      this.settingsService.businessDate;
    const closeDate = loanDate && safeCloseDate < loanDate ? loanDate : safeCloseDate;
    return this.dateUtils.formatDate(closeDate, this.settingsService.dateFormat);
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

    const fixedPaymentAmount = this.getIvyTekFixedEmiAmount(row);
    const scheduleAmount = balanceNow && balanceNow > 0 ? balanceNow : principal;
    if (fixedPaymentAmount && fixedPaymentAmount > 0 && scheduleAmount && scheduleAmount > 0) {
      return Math.max(1, Math.ceil(scheduleAmount / fixedPaymentAmount));
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
    const baseDate = this.parseIvyTekDate(loanDateText) || this.settingsService.businessDate;
    if (this.ivyTekLoanImportForm.get('preserveHistoricalDates').value && firstDueDate && firstDueDate >= baseDate) {
      return this.dateUtils.formatDate(firstDueDate, this.settingsService.dateFormat);
    }
    const defaultFirstDueDate = new Date(baseDate);
    defaultFirstDueDate.setDate(defaultFirstDueDate.getDate() + 30);
    return this.dateUtils.formatDate(defaultFirstDueDate, this.settingsService.dateFormat);
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
  private formatIvyTekNumber(value: number | null): string {
    return value === null ? '(blank)' : value.toFixed(2);
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
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
    const normalized = trimmedValue.endsWith('Z') ? `${trimmedValue.slice(0, -1)}+00:00` : trimmedValue;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Gets comparable Salesforce id keys.
   * @param {string} value Salesforce id.
   */
  private getSalesforceIdKeys(value: string): string[] {
    const compact = value.replace(/[^A-Za-z0-9]/g, '');
    const keys = [compact.toLowerCase()];
    if (compact.length >= 15) {
      keys.push(compact.substring(0, 15).toLowerCase());
    }
    return Array.from(new Set(keys.filter((key: string) => !!key)));
  }

  /**
   * Gets comparable lookup keys for Salesforce ids and legacy external ids.
   * @param {string} value Source identifier.
   */
  private getIvyTekIdentifierLookupKeys(value: string): string[] {
    const trimmed = (value || '').toString().trim();
    return this.getUniqueIvyTekIdentifiers([
      trimmed.toLowerCase(),
      ...this.getSalesforceIdKeys(trimmed)
    ]);
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

  /**
   * Reads a file as text.
   * @param {File} file File to read.
   */
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
    const rows = this.parseCsvRows(csvText);
    const headers = rows.shift()?.map((header: string) => header.replace(/^\uFEFF/, '').trim()) || [];
    return rows.map((row: string[]) =>
      headers.reduce((record: any, header: string, index: number) => {
        record[header] = row[index] || '';
        return record;
      }, {})
    );
  }

  /**
   * Parses CSV text into arrays.
   * @param {string} csvText CSV text.
   */
  private parseCsvRows(csvText: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = '';
    let quoted = false;

    for (let index = 0; index < csvText.length; index += 1) {
      const character = csvText[index];
      const nextCharacter = csvText[index + 1];

      if (character === '"' && quoted && nextCharacter === '"') {
        value += character;
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === ',' && !quoted) {
        row.push(value);
        value = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && nextCharacter === '\n') {
          index += 1;
        }
        row.push(value);
        rows.push(row);
        row = [];
        value = '';
      } else {
        value += character;
      }
    }

    if (value || row.length) {
      row.push(value);
      rows.push(row);
    }

    return rows.filter((csvRow: string[]) => csvRow.some((cell: string) => cell.trim() !== ''));
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
}
