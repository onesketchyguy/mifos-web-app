/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, OnInit, ViewChild, inject } from '@angular/core';
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
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { accountFeatures } from 'app/shared/account-features/account-features.config';
import { matchesFuzzySearch, normalizeSearchText } from 'app/shared/utils/fuzzy-search.util';

/**
 * Reports component.
 */
@Component({
  selector: 'mifosx-reports',
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
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
  ]
})
export class ReportsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  /** Reports data. */
  reportsData: any;
  accountFeatures = accountFeatures;
  /** Report category filter. */
  filter: string;
  /** Columns to be displayed in reports table. */
  displayedColumns: string[] = [
    'reportName',
    'reportType',
    'reportCategory'
  ];
  /** Data source for reports table. */
  dataSource = new MatTableDataSource();

  /** Paginator for reports table. */
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  /** Sorter for reports table. */
  @ViewChild(MatSort, { static: true }) sort: MatSort;

  /**
   * Retrieves the reports data from `resolve`.
   * @param {ActivatedRoute} route Activated Route.
   * Prevents reuse of route parameter `filter`.
   * @param {Router} router: Router.
   */
  constructor() {
    this.router.routeReuseStrategy.shouldReuseRoute = () => false;
    this.route.data.subscribe((data: { reports: any }) => {
      this.reportsData = data.reports;
    });
    this.filter = this.route.snapshot.params['filter'];
  }

  /*
   *Sets and filters the reports table by category.
   */
  ngOnInit() {
    this.setReports();
    this.filterReportsByCategory();
  }

  /**
   * Switches filterPredicate if filterValue is not null.
   * @param {string} filterValue filter string for mat-table.
   */
  applyFilter(filterValue: string) {
    if (filterValue.length) {
      this.setCustomFilterPredicate();
      this.dataSource.filter = normalizeSearchText(filterValue);
    } else {
      this.filterReportsByCategory();
    }
  }

  /**
   * Initializes the data source, paginator and sorter for reports table.
   */
  setReports() {
    this.dataSource = new MatTableDataSource(this.reportsData.filter((report: any) => this.isReportVisible(report)));
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  private isReportVisible(report: any): boolean {
    if (!report.useReport) {
      return false;
    }

    const category = (report.reportCategory || '').toLowerCase();
    const reportName = (report.reportName || '').toLowerCase();
    const searchableText = `${category} ${reportName}`;

    if (!this.accountFeatures.shares && searchableText.includes('share')) {
      return false;
    }
    if (!this.accountFeatures.fixedDeposits && searchableText.includes('fixed deposit')) {
      return false;
    }
    if (!this.accountFeatures.recurringDeposits && searchableText.includes('recurring deposit')) {
      return false;
    }
    if (!this.accountFeatures.savings && searchableText.includes('saving')) {
      return false;
    }

    return true;
  }

  /**
   * Filters the data source only for report category passed in route params.
   */
  filterReportsByCategory() {
    this.dataSource.filterPredicate = (data: any, filter: string) => {
      return data.reportCategory === filter;
    };
    this.dataSource.filter = this.filter;
  }

  /**
   *  Filters Reports for filter value string and report category.
   */
  setCustomFilterPredicate() {
    this.dataSource.filterPredicate = (data: any, filter: string) => {
      const matchesText = matchesFuzzySearch(
        Object.keys(data).map((key: string) => data[key]),
        filter
      );
      const matchesCategory = !this.filter || data.reportCategory === this.filter;
      return matchesText && matchesCategory;
    };
  }

  getCategoryKey(category: string): string {
    if (!category || category === '(NULL)' || category.trim() === '') {
      return 'labels.text.withoutCategory';
    }

    if (category.startsWith('labels.text.')) {
      return category;
    }
    return 'labels.text.' + category;
  }

  cleanTranslatedCategory(translatedText: string): string {
    if (!translatedText) return '';

    return translatedText.replace(/^labels\.text\./, '').replace(/^label\.text\./, '');
  }
}
