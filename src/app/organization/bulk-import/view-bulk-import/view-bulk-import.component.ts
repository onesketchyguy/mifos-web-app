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
import { MatCheckbox } from '@angular/material/checkbox';
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
    MatCheckbox,
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
  private readonly ivyTekPipelineRunStorageKey = 'mifosx.ivyTekImportPipelineRun';
  private readonly ivyTekImportConcurrency = 5;
  private readonly ivyTekAnnualInterestRateFrequencyType = 3;
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
  private ivyTekClientAddressTemplate: any = null;
  private ivyTekClientAddressTemplateUnavailable = false;

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

  get canUploadIvyTekPipeline(): boolean {
    return (
      !!this.ivyTekFile &&
      !!this.ivyTekLoanFile &&
      !!this.ivyTekLoanContactApplicationsFile &&
      !!this.ivyTekTransactionFile &&
      this.ivyTekImportForm.valid &&
      this.ivyTekLoanImportForm.valid &&
      !this.isIvyTekPipelineRunning &&
      !this.hasPendingIvyTekPipelineRun
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
      chargeName: [''],
      chargeAmountSource: [
        'amount_financed',
        Validators.required
      ],
      approveAndDisburse: [false],
      preserveHistoricalDates: [false]
    });
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
    if (!this.canUploadIvyTekPipeline || this.ivyTekImportForm.get('targetEntity').value !== 'clients') {
      return;
    }

    this.resetIvyTekPipelineResults();
    this.startIvyTekPipelineRun();
    try {
      const contactRows = this.parseCsv(await this.readFileAsText(this.ivyTekFile));
      const contactApplicationRows = this.parseCsv(await this.readFileAsText(this.ivyTekLoanContactApplicationsFile));
      const loanRows = this.parseCsv(await this.readFileAsText(this.ivyTekLoanFile));
      const clientRows = this.buildIvyTekClientRows(contactRows, contactApplicationRows, loanRows);
      await this.uploadIvyTekClientRows(clientRows);
      if (this.hasIvyTekResultStatus(this.ivyTekImportResults, ['labels.inputs.Failed'])) {
        this.finishIvyTekPipelineRun('labels.inputs.Needs Review', 'Stage 1 completed with records that need review.');
        return;
      }

      await this.uploadIvyTekLoanRows(loanRows, contactRows, contactApplicationRows);
      if (
        this.hasIvyTekResultStatus(this.ivyTekLoanImportResults, [
          'labels.inputs.Failed',
          'labels.inputs.Skipped'
        ])
      ) {
        this.finishIvyTekPipelineRun('labels.inputs.Needs Review', 'Stage 2 completed with records that need review.');
        return;
      }

      const transactionRows = this.parseCsv(await this.readFileAsText(this.ivyTekTransactionFile));
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
    } catch (error: any) {
      this.ivyTekPipelineError = this.getErrorMessage(error);
      this.finishIvyTekPipelineRun('labels.inputs.Failed', this.ivyTekPipelineError);
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

    this.ivyTekLoanImportResults = [];
    const loanRows = this.parseCsv(await this.readFileAsText(this.ivyTekLoanFile));
    const contactRows = this.parseCsv(await this.readFileAsText(this.ivyTekFile));
    const contactApplicationRows = this.parseCsv(await this.readFileAsText(this.ivyTekLoanContactApplicationsFile));
    await this.uploadIvyTekLoanRows(loanRows, contactRows, contactApplicationRows);
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
   */
  private async uploadIvyTekLoanRows(loanRows: any[], contactRows: any[], contactApplicationRows: any[]) {
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
      const clientCache = new Map<string, any>();
      const productDetailsCache = new Map<string, any>();

      await this.processIvyTekRowsWithConcurrency(loanRows, async (row: any) => {
        await this.createIvyTekLoan(
          row,
          helperRowsByLoanId,
          contactApplicationsByLoanId,
          productsByName,
          clientCache,
          productDetailsCache
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

      for (const row of transactionRows) {
        this.validateIvyTekTransaction(row, bridgeRowsByLoanId);
        this.ivyTekTransactionProcessedRecords += 1;
        this.updateIvyTekPipelineRunProgress({
          transactionsProcessed: this.ivyTekTransactionProcessedRecords,
          transactionsTotal: this.ivyTekTransactionTotalRecords
        });
      }
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
   * Starts a persisted IvyTek staged import run summary.
   */
  private startIvyTekPipelineRun() {
    const timestamp = new Date().toISOString();
    this.ivyTekPipelineRun = {
      status: 'labels.inputs.Running',
      activeStage: 'labels.heading.Stage 1 Clients',
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

    const linkedRows = this.buildIvyTekClientRowsFromContactApplications(contactRows, contactApplicationRows);
    if (linkedRows.length) {
      return linkedRows;
    }
    return contactRows;
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
      const relatedLoanRows = loanRowsByContactId.get(this.getCsvValue(contactRow, 'Id')) || [];
      const earliestLoanDate = this.getEarliestIvyTekDate(
        relatedLoanRows.flatMap((loanRow: any) => [
          this.getCsvValue(loanRow, 'IvytekTestPkg__LoanDate__c'),
          this.getCsvValue(loanRow, 'IvytekTestPkg__SetUpDate__c')
        ])
      );
      return {
        ...contactRow,
        IvyTekClientExternalID: this.getCsvValue(contactRow, 'Id'),
        IvyTekClientSourceExternalID: this.getCsvValue(contactRow, 'IvytekTestPkg__ExternalID__c'),
        IvyTekClientEntityID: this.getIvyTekEntityId(contactRow),
        IvyTekClientActivationDate: earliestLoanDate
          ? this.dateUtils.formatDate(earliestLoanDate, this.settingsService.dateFormat)
          : this.getIvyTekClientActivationDate(contactRow)
      };
    });
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
      IvyTekClientActivationDate: this.getIvyTekClientActivationDate(helperRow),
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
   * @param {Map<string, any>} productsByName loan products keyed by normalized product name.
   * @param {Map<string, any>} clientCache client lookup cache.
   * @param {Map<string, any>} productDetailsCache product details cache.
   */
  private async createIvyTekLoan(
    row: any,
    helperRowsByLoanId: Map<string, any>,
    contactApplicationsByLoanId: Map<string, any[]>,
    productsByName: Map<string, any>,
    clientCache: Map<string, any>,
    productDetailsCache: Map<string, any>
  ) {
    const result = this.createIvyTekLoanResult(row);

    try {
      const group = this.normalizeIvyTekLoanGroup(this.getCsvValue(row, 'Loan_GroupWS__c'));
      const productName = this.getIvyTekProductName(group);
      if (!productName) {
        this.setIvyTekLoanResultStatus(
          result,
          'labels.inputs.Skipped',
          `Unmapped or review loan group: ${group || '(blank)'}`
        );
        this.ivyTekLoanImportResults.push(result);
        return;
      }

      const principal = this.getIvyTekLoanPrincipal(row);
      const balanceNow = this.getIvyTekLoanBalanceNow(row);
      const repayments = this.getIvyTekNumberOfRepayments(row);
      const mappedValueReviewMessage = this.getIvyTekLoanMappedValueReviewMessage(row, principal, balanceNow);
      result.mappedValues = this.getIvyTekLoanMappedValues(row, productName, principal, balanceNow, repayments);
      if (mappedValueReviewMessage) {
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Skipped', mappedValueReviewMessage);
        this.ivyTekLoanImportResults.push(result);
        return;
      }

      const product = productsByName.get(this.normalizeIvyTekText(productName));
      if (!product?.id) {
        throw new Error(`Mifos loan product was not found: ${productName}`);
      }

      const client = await this.ensureIvyTekLoanClient(
        row,
        helperRowsByLoanId,
        contactApplicationsByLoanId,
        clientCache
      );
      if (!client?.id) {
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Skipped', 'No matching Mifos client was found.');
        this.ivyTekLoanImportResults.push(result);
        return;
      }

      if (!principal || principal <= 0) {
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Skipped', this.getIvyTekPrincipalReviewMessage(row));
        this.ivyTekLoanImportResults.push(result);
        return;
      }

      if (!repayments || repayments <= 0) {
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Skipped', this.getIvyTekRepaymentReviewMessage(row));
        this.ivyTekLoanImportResults.push(result);
        return;
      }

      const productDetails = await this.getIvyTekLoanProductDetails(product.id, productDetailsCache);
      const shouldApproveAndDisburse = this.shouldApproveAndDisburseIvyTekLoan(row, balanceNow);
      const payloadPrincipal = shouldApproveAndDisburse && balanceNow && balanceNow > 0 ? balanceNow : principal;
      result.mappedValues = {
        ...result.mappedValues,
        payloadPrincipal,
        willApproveAndDisburse: shouldApproveAndDisburse ? 'Yes' : 'No'
      };
      const payload = this.getIvyTekLoanPayload(row, client, product, productDetails, payloadPrincipal, repayments);
      const lifecycleMessage = this.getIvyTekLoanLifecycleMessage(row, balanceNow, shouldApproveAndDisburse);

      const existingLoan = await this.findIvyTekLoanByExternalId(payload.externalId, payload.accountNo);
      if (existingLoan) {
        result.loanId = this.getIvyTekLoanId(existingLoan);
        if (!result.loanId) {
          throw new Error(`Existing loan was found for ${payload.externalId}, but no loan id was returned.`);
        }
        await firstValueFrom(this.loansService.updateLoansAccount('loans', result.loanId, payload));
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Updated', lifecycleMessage);
        this.ivyTekLoanImportResults.push(result);
        return;
      }

      try {
        const response: any = await firstValueFrom(this.loansService.createLoansAccount('loans', payload));
        result.loanId = response?.resourceId || response?.loanId || response?.id;
        if (result.loanId && shouldApproveAndDisburse) {
          await this.approveAndDisburseIvyTekLoan(result.loanId, this.getIvyTekLoanDate(row));
        }
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Created', lifecycleMessage);
      } catch (createError: any) {
        if (this.isIvyTekClientActivationLoanDateError(createError)) {
          const adjustedLoanDate = this.dateUtils.formatDate(
            this.settingsService.businessDate,
            this.settingsService.dateFormat
          );
          const adjustedPayload = this.getIvyTekLoanPayloadWithDate(row, payload, adjustedLoanDate);
          const response: any = await firstValueFrom(this.loansService.createLoansAccount('loans', adjustedPayload));
          result.loanId = response?.resourceId || response?.loanId || response?.id;
          if (result.loanId && shouldApproveAndDisburse) {
            await this.approveAndDisburseIvyTekLoan(result.loanId, adjustedLoanDate);
          }
          this.setIvyTekLoanResultStatus(
            result,
            'labels.inputs.Created',
            [
              lifecycleMessage,
              'Created with the current business date because the matched client was already active after the historical loan date.'
            ]
              .filter((message: string) => !!message)
              .join(' ')
          );
          this.ivyTekLoanImportResults.push(result);
          return;
        }
        if (!this.isIvyTekDuplicateLoanExternalIdError(createError)) {
          throw createError;
        }
        const duplicateLoan = await this.findIvyTekLoanByExternalId(payload.externalId, payload.accountNo);
        result.loanId = this.getIvyTekLoanId(duplicateLoan);
        if (!result.loanId) {
          throw createError;
        }
        await firstValueFrom(this.loansService.updateLoansAccount('loans', result.loanId, payload));
        this.setIvyTekLoanResultStatus(result, 'labels.inputs.Updated', lifecycleMessage);
      }
    } catch (error: any) {
      this.setIvyTekLoanResultStatus(result, 'labels.inputs.Failed', this.getErrorMessage(error));
    }

    this.ivyTekLoanImportResults.push(result);
  }

  /**
   * Creates or updates a client from an IvyTek CSV row.
   * @param {any} row IvyTek CSV row.
   */
  private async upsertIvyTekClient(row: any) {
    const result = this.createIvyTekResult(row);

    try {
      this.validateIvyTekClientData(row);
      const status = await this.saveIvyTekClientAndTribalData(row);
      this.setIvyTekResultStatus(result, status);
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
      const status = await this.saveIvyTekClientAndTribalData(correctedRow);
      this.setIvyTekResultStatus(this.selectedIvyTekResult, status);
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
      status: '',
      message: ''
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
      this.getCsvValue(row, 'IvyTekClientApplicationExternalID'),
      this.getCsvValue(row, 'sf_contact_id'),
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
  private async saveIvyTekClientAndTribalData(row: any): Promise<string> {
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
    return status;
  }

  /**
   * Updates a client, retrying without mobileNo when the tenant requires mobile numbers to be unique.
   * @param {string} clientId Client identifier.
   * @param {any} row IvyTek CSV row.
   */
  private async updateIvyTekClientWithMobileFallback(clientId: string, row: any) {
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

    let datatable: any = null;
    try {
      datatable = await firstValueFrom(
        this.clientsService.getClientDatatable(clientId, this.ivyTekClientTribalDatatableName)
      );
    } catch (error: any) {
      if (error?.status !== 404) {
        throw error;
      }
    }

    const payload = this.getIvyTekClientTribalDataPayload(row);
    if (datatable?.data?.length) {
      await firstValueFrom(
        this.clientsService.editClientDatatableEntry(clientId, this.ivyTekClientTribalDatatableName, payload)
      );
    } else {
      await firstValueFrom(
        this.clientsService.addClientDatatableEntry(clientId, this.ivyTekClientTribalDatatableName, payload)
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
      payload.officeId = this.ivyTekImportForm.get('officeId').value;
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
      return this.getCsvValue(row, 'IvyTekClientExternalID') || this.getCsvValue(row, 'Id');
    }

    return (
      this.getCsvValue(row, 'IvyTekClientExternalID') ||
      this.getCsvValue(row, 'Client ExternalID') ||
      this.getCsvValue(row, 'Lookup Client ExternalID') ||
      this.getCsvValue(row, 'IvytekTestPkg__Contact__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__Borrower_Contact__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c') ||
      this.getCsvValue(row, 'sf_contact_id') ||
      this.getCsvValue(row, 'Id')
    );
  }

  /**
   * Checks whether a row came from the real Salesforce Contact export.
   * @param {any} row IvyTek CSV row.
   */
  private isIvyTekContactRow(row: any): boolean {
    return (
      this.getCsvValue(row, '_') === '[Contact]' ||
      (!!this.getCsvValue(row, 'WS_EntityID__c') &&
        (!!this.getCsvValue(row, 'FirstName') || !!this.getCsvValue(row, 'LastName')) &&
        !!this.getCsvValue(row, 'Id'))
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
      this.getCsvValue(row, 'Submitted On*'),
      this.getCsvValue(row, 'IvytekTestPkg__LoanDate__c'),
      this.getCsvValue(row, 'IvytekTestPkg__SetUpDate__c'),
      this.getCsvValue(row, 'CreatedDate')
    ]);
    return activationDate ? this.dateUtils.formatDate(activationDate, this.settingsService.dateFormat) : '';
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
        'WS Entity ID',
        'IvytekTestPkg__WS_EntityID__c',
        'IvytekTestPkg__WS_Entity_ID__c',
        'matched_contact_entity_id',
        'EntityID',
        'Entity Id',
        'entity_id',
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
    const parenthesizedEntityId = value.match(/\((\d{1,10})\)\s*$/);
    if (parenthesizedEntityId) {
      return parenthesizedEntityId[1];
    }
    return /^[A-Za-z0-9-]{1,10}$/.test(value) ? value : '';
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
    return `${this.getIvyTekFirstName(row)} ${this.getIvyTekLastName(row)}`.trim();
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
    const helperName = this.getFirstCsvValue(row, [
      'IvytekTestPkg__Customer_Name_Text__c',
      'Customer_Name_Text__c',
      'customer_name'
    ]);
    if (helperName) {
      return helperName;
    }

    const salesforceName = this.getCsvValue(row, 'Name');
    return /^(CA|Contract)-\d+$/i.test(salesforceName) ? '' : salesforceName;
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
      name: this.getCsvValue(row, 'IvytekTestPkg__Customer_Name_Text__c') || this.getCsvValue(row, 'Name'),
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
   * Validates one IvyTek transaction row against the loan source bridge.
   * @param {any} row IvyTek transaction row.
   * @param {Map<string, any>} bridgeRowsByLoanId loan source bridge rows keyed by Salesforce loan id.
   */
  public validateIvyTekTransaction(row: any, bridgeRowsByLoanId: Map<string, any>) {
    const result = this.createIvyTekTransactionResult(row, bridgeRowsByLoanId);

    if (!result.sfLoanId && !result.legacyLoanId) {
      this.setIvyTekTransactionResultStatus(result, 'labels.inputs.Failed', 'Missing loan id.');
    } else if (!result.legacyLoanId) {
      this.setIvyTekTransactionResultStatus(
        result,
        'labels.inputs.Skipped',
        'No bridge row was found for the Salesforce loan id.'
      );
    } else if (!result.transactionDate) {
      this.setIvyTekTransactionResultStatus(result, 'labels.inputs.Failed', 'Missing transaction date.');
    } else if (!result.amount) {
      this.setIvyTekTransactionResultStatus(result, 'labels.inputs.Failed', 'Missing transaction amount.');
    } else {
      this.setIvyTekTransactionResultStatus(result, 'labels.inputs.Ready');
    }

    this.ivyTekTransactionImportResults.push(result);
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
      row,
      status: '',
      message: ''
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
    return (
      this.getCsvValue(row, 'transaction_date') ||
      this.getCsvValue(row, 'IvytekTestPkg__Transaction_Date__c') ||
      this.getCsvValue(row, 'CreatedDate')
    );
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
   * Builds loan products by normalized product name.
   * @param {any[]} products Loan product rows.
   */
  private buildIvyTekLoanProductsByName(products: any[]): Map<string, any> {
    const productsByName = new Map<string, any>();
    products.forEach((product: any) => {
      productsByName.set(this.normalizeIvyTekText(product.name), product);
    });
    return productsByName;
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
   * Builds Borrower contact applications by loan id.
   * @param {any[]} rows Contact application rows.
   */
  private buildIvyTekContactApplicationsByLoanId(rows: any[]): Map<string, any[]> {
    const rowsByLoanId = new Map<string, any[]>();
    rows
      .filter(
        (row: any) => this.normalizeIvyTekText(this.getCsvValue(row, 'IvytekTestPkg__ReferenceType__c')) === 'borrower'
      )
      .forEach((row: any) => {
        this.getSalesforceIdKeys(this.getCsvValue(row, 'IvytekTestPkg__Loan__c')).forEach((loanId: string) => {
          rowsByLoanId.set(loanId, [
            ...(rowsByLoanId.get(loanId) || []),
            row
          ]);
        });
      });
    return rowsByLoanId;
  }

  /**
   * Finds or creates the borrower client needed by a loan import row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any>} helperRowsByLoanId helper rows keyed by loan id.
   * @param {Map<string, any[]>} contactApplicationsByLoanId contact application rows keyed by loan id.
   * @param {Map<string, any>} clientCache client lookup cache.
   */
  private async ensureIvyTekLoanClient(
    row: any,
    helperRowsByLoanId: Map<string, any>,
    contactApplicationsByLoanId: Map<string, any[]>,
    clientCache: Map<string, any>
  ) {
    const existingClient = await this.findIvyTekLoanClient(
      row,
      helperRowsByLoanId,
      contactApplicationsByLoanId,
      clientCache
    );
    if (existingClient?.id) {
      return existingClient;
    }

    const clientSourceRow = this.getIvyTekClientRowForLoan(row, helperRowsByLoanId, contactApplicationsByLoanId);
    if (!clientSourceRow) {
      return null;
    }

    this.validateIvyTekClientData(clientSourceRow);
    const cacheKey = `create:${this.getIvyTekExternalId(clientSourceRow) || this.normalizeIvyTekName(this.getIvyTekDisplayName(clientSourceRow))}`;
    if (clientCache.has(cacheKey)) {
      return await clientCache.get(cacheKey);
    }

    const clientPromise = this.saveIvyTekClientAndTribalData(clientSourceRow).then(() => {
      clientCache.clear();
      return this.findIvyTekLoanClient(row, helperRowsByLoanId, contactApplicationsByLoanId, clientCache);
    });
    clientCache.set(cacheKey, clientPromise);
    return await clientPromise;
  }

  /**
   * Builds the best available client source row for a loan row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any>} helperRowsByLoanId helper rows keyed by loan id.
   * @param {Map<string, any[]>} contactApplicationsByLoanId contact application rows keyed by loan id.
   */
  private getIvyTekClientRowForLoan(
    row: any,
    helperRowsByLoanId: Map<string, any>,
    contactApplicationsByLoanId: Map<string, any[]>
  ) {
    const loanKeys = this.getSalesforceIdKeys(this.getCsvValue(row, 'Id'));
    const contactApplication = loanKeys
      .flatMap((loanId: string) => contactApplicationsByLoanId.get(loanId) || [])
      .find((match: any) => !!match);
    const helperRow = loanKeys.map((loanId: string) => helperRowsByLoanId.get(loanId)).find((match: any) => !!match);

    if (contactApplication && (helperRow || row)) {
      return this.buildIvyTekClientRowFromLoanAndContactApplication(helperRow || row, contactApplication);
    }

    return {
      ...row,
      IvyTekClientActivationDate: this.getIvyTekClientActivationDate(row)
    };
  }

  /**
   * Finds the Mifos client for an IvyTek loan row.
   * @param {any} row IvyTek loan row.
   * @param {Map<string, any>} helperRowsByLoanId helper rows keyed by loan id.
   * @param {Map<string, any[]>} contactApplicationsByLoanId contact application rows keyed by loan id.
   * @param {Map<string, any>} clientCache client lookup cache.
   */
  private async findIvyTekLoanClient(
    row: any,
    helperRowsByLoanId: Map<string, any>,
    contactApplicationsByLoanId: Map<string, any[]>,
    clientCache: Map<string, any>
  ) {
    const sourceLoanId = this.getCsvValue(row, 'Id');
    const loanKeys = this.getSalesforceIdKeys(sourceLoanId);
    const contactApplications = loanKeys.flatMap((loanId: string) => contactApplicationsByLoanId.get(loanId) || []);
    const helperRow = loanKeys.map((loanId: string) => helperRowsByLoanId.get(loanId)).find((match: any) => !!match);

    const identifiers = this.getUniqueIvyTekIdentifiers([
      ...contactApplications.flatMap((contactApplication: any) => [
        this.getCsvValue(contactApplication, 'IvytekTestPkg__ExternalID__c'),
        this.getCsvValue(contactApplication, 'IvytekTestPkg__Contact__c')
      ]),
      this.getIvyTekExternalId(row),
      this.getIvyTekExternalId(helperRow || {})
    ]);

    for (const identifier of identifiers) {
      const clientByExternalId = await this.findIvyTekClientByExternalId(identifier, clientCache);
      if (clientByExternalId) {
        return clientByExternalId;
      }
    }

    const names = [
      this.getCsvValue(helperRow || {}, 'IvytekTestPkg__Customer_Name_Text__c'),
      this.getCsvValue(row, 'IvytekTestPkg__Customer_Name_Text__c')
    ].filter((name: string) => !!name);

    for (const name of names) {
      const clientByName = await this.findIvyTekClientByStrictName(name, clientCache);
      if (clientByName) {
        return clientByName;
      }
    }

    return this.findIvyTekClientByExternalId(this.getIvyTekExternalId(row), clientCache);
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
   * Finds a client by strict normalized name.
   * @param {string} name Client name.
   * @param {Map<string, any>} clientCache Client cache.
   */
  private async findIvyTekClientByStrictName(name: string, clientCache: Map<string, any>) {
    const cacheKey = `name:${this.normalizeIvyTekName(name)}`;
    if (clientCache.has(cacheKey)) {
      return clientCache.get(cacheKey);
    }

    const searchResponse: any = await firstValueFrom(this.clientsService.searchByText(name, 0, 10));
    const candidates = searchResponse?.pageItems || searchResponse?.content || searchResponse || [];
    const sourceName = this.normalizeIvyTekName(name);
    const matches = (Array.isArray(candidates) ? candidates : []).filter((client: any) => {
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
    return this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__BalanceNow__c'));
  }

  /**
   * Gets the annual interest rate percentage from IvyTek rate fields.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekLoanInterestRatePercent(row: any): number {
    const contractRate = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__ContractRate__c'));
    if (contractRate !== null) {
      return contractRate > 1 ? contractRate : contractRate * 100;
    }

    const marginRate = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__Margin_Rate__c'));
    if (marginRate !== null) {
      return marginRate;
    }

    const perDiemRate = this.parseIvyTekDecimal(this.getCsvValue(row, 'IvytekTestPkg__Per_Diem_Interest_Rate__c'));
    return perDiemRate !== null ? perDiemRate * 365 * 100 : 0;
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
    return {
      accountNo: this.getIvyTekLegacyLoanId(row),
      productName,
      accountStatus: this.getCsvValue(row, 'IvytekTestPkg__AccountStatusCode__c'),
      originalPrincipal: principal ?? '',
      balanceNow: balanceNow ?? '',
      interestRatePercent: this.getIvyTekLoanInterestRatePercent(row),
      interestRateFrequencyType: 'Per year',
      numberOfRepayments: repayments ?? '',
      repaymentEvery: frequency.every,
      repaymentFrequencyType: frequency.label,
      fixedPaymentAmount: this.getIvyTekFixedEmiAmount(row) ?? ''
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
   * Determines whether a loan can be activated without contradicting the IvyTek balance snapshot.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   */
  private shouldApproveAndDisburseIvyTekLoan(row: any, balanceNow: number | null) {
    return (
      !!this.ivyTekLoanImportForm.get('approveAndDisburse').value &&
      !!balanceNow &&
      balanceNow > 0 &&
      !this.isIvyTekPaidOutLoan(row, balanceNow)
    );
  }

  /**
   * Gets lifecycle handling note for loan import results.
   * @param {any} row IvyTek loan row.
   * @param {number | null} balanceNow IvyTek current balance.
   * @param {boolean} shouldApproveAndDisburse Whether the importer will activate the loan.
   */
  private getIvyTekLoanLifecycleMessage(row: any, balanceNow: number | null, shouldApproveAndDisburse: boolean) {
    if (shouldApproveAndDisburse) {
      return `Activated using IvyTek BalanceNow ${this.formatIvyTekNumber(balanceNow)} as the payload principal. Historical transactions are validation/export only and are not posted to the loan account.`;
    }

    if (this.ivyTekLoanImportForm.get('approveAndDisburse').value) {
      return `Created or updated without disbursement because IvyTek BalanceNow is ${this.formatIvyTekNumber(balanceNow)} or the account is paid out/closed. Historical transactions are validation/export only and are not posted to the loan account.`;
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
   */
  private getIvyTekLoanPayload(
    row: any,
    client: any,
    product: any,
    productDetails: any,
    principal: number,
    repayments: number
  ) {
    const dateFormat = this.settingsService.dateFormat;
    const locale = this.settingsService.language.code;
    const loanDate = this.getIvyTekLoanDate(row);
    const frequency = this.getIvyTekRepaymentFrequency(row);
    const rate = this.getIvyTekLoanInterestRatePercent(row);
    const fixedEmiAmount = this.getIvyTekFixedEmiAmount(row);
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
      interestRatePerPeriod: rate,
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

    if (fixedEmiAmount) {
      payload.fixedEmiAmount = fixedEmiAmount;
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
    await firstValueFrom(
      this.loansService.executeLoanCommand(loanId, 'disburse', {
        ...commandData,
        actualDisbursementDate: loanDate
      })
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
    const chargeOptions = [
      ...(productDetails?.chargeOptions || []),
      ...(productDetails?.charges || [])
    ];
    const charge = chargeOptions.find(
      (option: any) => this.normalizeIvyTekText(option.name) === this.normalizeIvyTekText(chargeName)
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
      '101': 'Personal Loan',
      '303': 'Home Construction Loan',
      '304': 'Home Modernization Loan',
      '407': 'Mobile Home and Trailer Loan',
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
        return this.dateUtils.formatDate(loanDate, this.settingsService.dateFormat);
      }
    }
    return this.dateUtils.formatDate(this.settingsService.businessDate, this.settingsService.dateFormat);
  }

  /**
   * Gets a positive repayment count from IvyTek payment count or term fields.
   * @param {any} row IvyTek loan row.
   */
  private getIvyTekNumberOfRepayments(row: any): number | null {
    return this.getFirstIvyTekPositiveInteger(row, [
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
    return Array.from(new Set(identifiers.filter((identifier: string) => !!identifier)));
  }

  /**
   * Gets first repayment date in the active Mifos date format.
   * @param {any} row IvyTek loan row.
   * @param {string} loanDateText Loan date text.
   */
  private getIvyTekFirstRepaymentDate(row: any, loanDateText: string): string {
    const firstDueDate = this.parseIvyTekDate(this.getCsvValue(row, 'IvytekTestPkg__FirstDueDate__c'));
    if (this.ivyTekLoanImportForm.get('preserveHistoricalDates').value && firstDueDate) {
      return this.dateUtils.formatDate(firstDueDate, this.settingsService.dateFormat);
    }
    const baseDate = this.parseIvyTekDate(loanDateText) || this.settingsService.businessDate;
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
   * Formats a number for concise import result messages.
   * @param {number | null} value Numeric value.
   */
  private formatIvyTekNumber(value: number | null): string {
    return value === null ? '(blank)' : value.toFixed(2);
  }

  /**
   * Parses common IvyTek date values.
   * @param {string} value Raw value.
   */
  private parseIvyTekDate(value: string): Date | null {
    if (!value) {
      return null;
    }
    const normalized = value.replace('Z', '+00:00');
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
