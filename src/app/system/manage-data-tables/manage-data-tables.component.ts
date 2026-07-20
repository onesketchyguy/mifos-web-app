/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  TemplateRef,
  ElementRef,
  ViewChild,
  AfterViewInit,
  inject
} from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort, MatSortHeader } from '@angular/material/sort';
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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

/** rxjs Imports */
import { of } from 'rxjs';

/** Custom Services */
import { PopoverService } from '../../configuration-wizard/popover/popover.service';
import { ConfigurationWizardService } from '../../configuration-wizard/configuration-wizard.service';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { accountFeatures } from 'app/shared/account-features/account-features.config';
import { applyFuzzyTableFilter } from 'app/shared/utils/fuzzy-search.util';

/**
 * Manage Data Tables component.
 */
@Component({
  selector: 'mifosx-manage-data-tables',
  templateUrl: './manage-data-tables.component.html',
  styleUrls: ['./manage-data-tables.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    FaIconComponent,
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
    MatPaginator
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ManageDataTablesComponent implements OnInit, AfterViewInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private configurationWizardService = inject(ConfigurationWizardService);
  private popoverService = inject(PopoverService);

  /** Data table data. */
  dataTableData: any;
  /** Columns to be displayed in manage data tables table. */
  displayedColumns: string[] = [
    'registeredTableName',
    'applicationTableName',
    'entitySubType'
  ];
  /** Data source for manage data tables table. */
  dataSource: MatTableDataSource<any>;
  accountFeatures = accountFeatures;

  /** Paginator for manage data tables table. */
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  /** Sorter for manage data tables table. */
  @ViewChild(MatSort, { static: true }) sort: MatSort;

  /* Reference of create datatables button */
  @ViewChild('createDatatableRef') createDatatableRef: ElementRef<any>;
  /* Template for popover on create datatables button */
  @ViewChild('templateCreateDatatableRef') templateCreateDatatableRef: TemplateRef<any>;
  /* Reference of list of datatables */
  @ViewChild('datatablesList') datatablesList: ElementRef<any>;
  /* Template for popover on list of datatables */
  @ViewChild('templateDatatablesList') templateDatatablesList: TemplateRef<any>;

  /**
   * Retrieves the data tables data from `resolve`.
   * @param {ActivatedRoute} route Activated Route.
   * @param {Router} router Router.
   * @param {ConfigurationWizardService} configurationWizardService ConfigurationWizard Service.
   * @param {PopoverService} popoverService PopoverService.
   */
  constructor() {
    this.route.data.subscribe((data: { dataTables: any }) => {
      this.dataTableData = data.dataTables;
    });
  }

  /**
   * Filters data in manage data tables table based on passed value.
   * @param {string} filterValue Value to filter data.
   */
  applyFilter(filterValue: string) {
    applyFuzzyTableFilter(this.dataSource, filterValue);
  }

  /**
   * Sets the manage data tables table.
   */
  ngOnInit() {
    this.setDataTables();
  }

  /**
   * Initializes the data source, paginator and sorter for manage data tables table.
   */
  setDataTables() {
    this.dataSource = new MatTableDataSource(
      this.dataTableData.filter((dataTable: any) => this.isDataTableVisible(dataTable))
    );
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  private isDataTableVisible(dataTable: any): boolean {
    const applicationTableName = dataTable.applicationTableName;
    const entitySubType = (dataTable.entitySubType || '').toLowerCase();

    if (applicationTableName === 'm_share_product') {
      return this.accountFeatures.shares;
    }

    if (
      applicationTableName === 'm_savings_account' ||
      applicationTableName === 'm_savings_account_transaction' ||
      applicationTableName === 'm_savings_product'
    ) {
      if (entitySubType.includes('fixed deposit')) {
        return this.accountFeatures.fixedDeposits;
      }

      if (entitySubType.includes('recurring deposit')) {
        return this.accountFeatures.recurringDeposits;
      }

      if (entitySubType.includes('saving')) {
        return this.accountFeatures.savings;
      }

      return (
        this.accountFeatures.savings || this.accountFeatures.fixedDeposits || this.accountFeatures.recurringDeposits
      );
    }

    return true;
  }

  /**
   * Popover function
   * @param template TemplateRef<any>.
   * @param target HTMLElement | ElementRef<any>.
   * @param position String.
   * @param backdrop Boolean.
   */
  showPopover(
    template: TemplateRef<any>,
    target: HTMLElement | ElementRef<any>,
    position: string,
    backdrop: boolean
  ): void {
    setTimeout(() => this.popoverService.open(template, target, position, backdrop, {}), 200);
  }

  /**
   * To show popover.
   */
  ngAfterViewInit() {
    if (this.configurationWizardService.showDatatablesPage) {
      setTimeout(() => {
        this.showPopover(this.templateCreateDatatableRef, this.createDatatableRef.nativeElement, 'bottom', true);
      });
    }
    if (this.configurationWizardService.showDatatablesList) {
      setTimeout(() => {
        this.showPopover(this.templateDatatablesList, this.datatablesList.nativeElement, 'top', true);
      });
    }
  }

  /**
   * Next Step (Create data tables Page) Configuration Wizard.
   */
  nextStep() {
    this.configurationWizardService.showDatatablesPage = false;
    this.configurationWizardService.showDatatablesList = false;
    this.configurationWizardService.showDatatablesForm = true;
    this.router.navigate(['/system/data-tables/create']);
  }

  /**
   * Previous Step (Manage Datables system Page) Configuration Wizard.
   */
  previousStep() {
    this.configurationWizardService.showDatatablesPage = false;
    this.configurationWizardService.showDatatablesList = false;
    this.configurationWizardService.showDatatables = true;
    this.router.navigate(['/system']);
  }
}
