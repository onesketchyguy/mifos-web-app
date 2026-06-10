/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

jest.mock('exceljs', () => ({
  Workbook: class MockWorkbook {}
}));

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AlertService } from 'app/core/alert/alert.service';
import { Dates } from 'app/core/utils/dates';
import { SettingsService } from 'app/settings/settings.service';

import { ReportExcelExportService } from '../report-excel-export.service';
import { ReportsService } from '../reports.service';
import { ReportParameter } from '../common-models/report-parameter.model';
import { RunReportComponent } from './run-report.component';

describe('RunReportComponent report parameters', () => {
  let component: RunReportComponent;
  let reportsService: jest.Mocked<ReportsService>;

  beforeEach(() => {
    reportsService = {
      getSelectOptions: jest.fn(() => of([]))
    } as any;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              params: {
                name: 'Active Loans Details'
              }
            },
            queryParams: of({
              type: 'Table',
              id: 1
            }),
            data: of({
              reportParameters: [],
              configurations: {
                globalConfiguration: []
              }
            })
          }
        },
        {
          provide: ReportsService,
          useValue: reportsService
        },
        {
          provide: SettingsService,
          useValue: {}
        },
        {
          provide: AlertService,
          useValue: {}
        },
        {
          provide: TranslateService,
          useValue: {}
        },
        {
          provide: Dates,
          useValue: {}
        },
        {
          provide: ReportExcelExportService,
          useValue: {}
        }
      ]
    });

    component = TestBed.runInInjectionContext(() => new RunReportComponent());
  });

  it('exposes loan product selectors when their currency parent is not in the report', () => {
    const officeParameter = new ReportParameter([
      'OfficeIdSelectOne',
      'officeId',
      'Office',
      'select',
      'number',
      '0',
      'Y',
      null,
      null
    ]);
    const loanProductParameter = new ReportParameter([
      'loanProductIdSelectAll',
      'loanProductId',
      'Product',
      'select',
      'number',
      '0',
      null,
      'Y',
      'currencyIdSelectAll'
    ]);

    component.paramData = [
      officeParameter,
      loanProductParameter
    ];

    component.createRunReportForm();

    expect(component.reportForm.contains('loanProductIdSelectAll')).toBe(true);
    expect(reportsService.getSelectOptions).toHaveBeenCalledWith('loanProductIdSelectAll?R_currencyId=-1');
  });

  it('keeps child selectors dependent when their parent is present', () => {
    const currencyParameter = new ReportParameter([
      'currencyIdSelectAll',
      'currencyId',
      'Currency',
      'select',
      'number',
      '0',
      null,
      'Y',
      null
    ]);
    const loanProductParameter = new ReportParameter([
      'loanProductIdSelectAll',
      'loanProductId',
      'Product',
      'select',
      'number',
      '0',
      null,
      'Y',
      'currencyIdSelectAll'
    ]);

    component.paramData = [
      currencyParameter,
      loanProductParameter
    ];

    component.createRunReportForm();

    expect(component.reportForm.contains('currencyIdSelectAll')).toBe(true);
    expect(component.reportForm.contains('loanProductIdSelectAll')).toBe(false);
    expect(currencyParameter.childParameters).toContain(loanProductParameter);
    expect(reportsService.getSelectOptions).not.toHaveBeenCalledWith('loanProductIdSelectAll?R_currencyId=-1');
  });
});
