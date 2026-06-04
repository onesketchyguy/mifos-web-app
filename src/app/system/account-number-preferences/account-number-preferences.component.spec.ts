/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { AccountNumberPreferencesComponent } from './account-number-preferences.component';

describe('AccountNumberPreferencesComponent', () => {
  let component: AccountNumberPreferencesComponent;
  let fixture: ComponentFixture<AccountNumberPreferencesComponent>;

  const accountNumberPreferences = [
    {
      id: 1,
      accountType: { value: 'Loan' }
    },
    {
      id: 2,
      accountType: { value: 'Savings' }
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountNumberPreferencesComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { data: of({ accountNumberPreferences }) } }]
    })
      .overrideComponent(AccountNumberPreferencesComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(AccountNumberPreferencesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('fuzzy filters account type values with the custom predicate', () => {
    component.applyFilter('laon');

    expect(component.dataSource.filteredData).toEqual([accountNumberPreferences[0]]);
  });
});
