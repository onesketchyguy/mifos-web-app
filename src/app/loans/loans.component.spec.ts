/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { LoansComponent } from './loans.component';
import { LoansService } from './loans.service';
import { OrganizationService } from 'app/organization/organization.service';
import { SearchService } from 'app/search/search.service';
import { SettingsService } from 'app/settings/settings.service';

describe('LoansComponent search filtering', () => {
  let component: LoansComponent;
  let loansService: jest.Mocked<LoansService>;
  let searchService: jest.Mocked<SearchService>;

  const rawLoan = {
    id: 42,
    accountNo: 'LN-42',
    status: {
      value: 'Active'
    }
  };

  beforeEach(() => {
    loansService = {
      getLoans: jest.fn(() =>
        of({
          pageItems: [rawLoan],
          totalFilteredRecords: 1
        })
      ),
      getLoanAccountAssociationDetails: jest.fn(() => of(rawLoan))
    } as any;
    searchService = {
      getSearchResults: jest.fn(() => of([]))
    } as any;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({
              loansData: {
                pageItems: [rawLoan],
                totalFilteredRecords: 1
              }
            })
          }
        },
        {
          provide: Router,
          useValue: {
            navigate: jest.fn()
          }
        },
        {
          provide: LoansService,
          useValue: loansService
        },
        {
          provide: SearchService,
          useValue: searchService
        },
        {
          provide: OrganizationService,
          useValue: {
            getOffices: jest.fn(() => of([]))
          }
        },
        {
          provide: SettingsService,
          useValue: {}
        }
      ]
    });

    component = TestBed.runInInjectionContext(() => new LoansComponent());
    component.ngOnInit();
  });

  it('matches loans returned by global search when raw loan fields do not match the text query', () => {
    searchService.getSearchResults.mockReturnValueOnce(
      of([
        {
          entityType: 'LOAN',
          entityId: 42,
          entityAccountNo: 'LN-42'
        }
      ] as any[])
    );

    component.applyFilter('jhon');

    expect(searchService.getSearchResults).toHaveBeenCalledWith('jhon', 'loans', true);
    expect(component.loans).toEqual([rawLoan]);
    expect(component.totalRecords).toBe(1);
  });

  it('does not keep loans when neither local fuzzy search nor global search matches', () => {
    component.applyFilter('jhon');

    expect(component.loans).toEqual([]);
    expect(component.totalRecords).toBe(0);
  });
});
