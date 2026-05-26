/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, ViewChild, inject } from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
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
import { Router, ActivatedRoute } from '@angular/router';
import { SearchData } from '../search.model';
import { ExternalIdentifierComponent } from '../../shared/external-identifier/external-identifier.component';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { accountFeatures } from 'app/shared/account-features/account-features.config';

/**
 * Search Page Component
 */
@Component({
  selector: 'mifosx-search-page',
  templateUrl: './search-page.component.html',
  styleUrls: ['./search-page.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    MatTable,
    MatColumnDef,
    MatHeaderCellDef,
    MatHeaderCell,
    MatCellDef,
    MatCell,
    ExternalIdentifierComponent,
    MatIconButton,
    MatTooltip,
    FaIconComponent,
    MatHeaderRowDef,
    MatHeaderRow,
    MatRowDef,
    MatRow,
    MatPaginator
  ]
})
export class SearchPageComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  accountFeatures = accountFeatures;

  /** Flags if number of search results exceed 200 */
  overload: boolean;
  /** Datasource for loans disbursal table */
  dataSource: MatTableDataSource<SearchData>;
  /** Displayed Columns for serach results */
  displayedColumns: string[] = [
    'entityType',
    'entityName',
    'entityAccount',
    'externalId',
    'parentType',
    'parentName',
    'details'
  ];
  /** Paginator for the table */
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;

  hasResults = false;

  /**
   * @param {ActivatedRoute} route Activated Route
   * @param {Router} router Router
   */
  constructor() {
    this.route.data.subscribe((data: { searchResults: any }) => {
      const searchResults = data.searchResults.filter((result: SearchData) => this.isSearchResultVisible(result));
      this.overload = searchResults.length > 200 ? true : false;
      const visibleResults = this.overload ? searchResults.slice(0, 200) : searchResults;
      this.dataSource = new MatTableDataSource(visibleResults);
      this.dataSource.paginator = this.paginator;
      this.hasResults = visibleResults.length > 0;
    });
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

  /**
   * Returns link to entity view page.
   * @param {any} entity Entity
   */
  navigate(entity: SearchData) {
    switch (entity.entityType) {
      case 'CLIENT':
        this.router.navigate([
          'clients',
          entity.entityId,
          'general'
        ]);
        break;
      case 'CLIENTIDENTIFIER':
        this.router.navigate([
          'clients',
          entity.parentId,
          'general'
        ]);
        break;
      case 'CENTER':
        this.router.navigate([
          'centers',
          entity.entityId
        ]);
        break;
      case 'GROUP':
        this.router.navigate([
          'groups',
          entity.entityId
        ]);
        break;
      case 'SHARE':
        if (!this.accountFeatures.shares) {
          break;
        }
        this.router.navigate([
          'clients',
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
            'clients',
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
            'clients',
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
            'clients',
            entity.parentId,
            'savings-accounts',
            entity.entityId,
            'transactions'
          ]);
        }
        break;
      case 'LOAN':
        this.router.navigate([
          'clients',
          entity.parentId,
          'loans-accounts',
          entity.entityId,
          'general'
        ]);
        break;
    }
  }
}
