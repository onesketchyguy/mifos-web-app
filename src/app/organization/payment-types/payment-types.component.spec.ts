/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { PaymentTypesComponent } from './payment-types.component';
import { OrganizationService } from '../organization.service';

describe('PaymentTypesComponent', () => {
  let component: PaymentTypesComponent;
  let fixture: ComponentFixture<PaymentTypesComponent>;

  const paymentTypes = [
    {
      id: 1,
      name: 'John Cash',
      description: 'Cash payment'
    },
    {
      id: 2,
      name: 'Maria Transfer',
      description: 'Bank transfer'
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentTypesComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { data: of({ paymentTypes }) } },
        { provide: OrganizationService, useValue: {} },
        { provide: MatDialog, useValue: { open: jest.fn() } }
      ]
    })
      .overrideComponent(PaymentTypesComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(PaymentTypesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('fuzzy filters default table data source rows', () => {
    component.applyFilter('jhon');

    expect(component.dataSource.filteredData).toEqual([paymentTypes[0]]);
  });
});
