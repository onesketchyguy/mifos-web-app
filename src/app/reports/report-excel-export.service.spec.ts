/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

jest.mock('exceljs', () => {
  class MockWorksheet {
    views: any[];
    private rows = new Map<number, any>();
    private columns = new Map<number, any>();
    private tables = new Map<string, any>();

    constructor(_name: string, options: any) {
      this.views = options.views;
    }

    addTable(table: any): void {
      this.tables.set(table.name, table);
    }

    getTable(name: string): any {
      return this.tables.get(name);
    }

    getRow(index: number): any {
      if (!this.rows.has(index)) {
        this.rows.set(index, {});
      }
      return this.rows.get(index);
    }

    getColumn(index: number): any {
      if (!this.columns.has(index)) {
        this.columns.set(index, {});
      }
      return this.columns.get(index);
    }
  }

  class MockWorkbook {
    creator: string;
    created: Date;
    modified: Date;
    xlsx = {
      writeBuffer: jest.fn()
    };
    private worksheets = new Map<string, MockWorksheet>();

    addWorksheet(name: string, options: any): MockWorksheet {
      const worksheet = new MockWorksheet(name, options);
      this.worksheets.set(name, worksheet);
      return worksheet;
    }

    getWorksheet(name: string): MockWorksheet {
      return this.worksheets.get(name);
    }
  }

  return {
    Workbook: MockWorkbook
  };
});

import { ReportExcelExportService } from './report-excel-export.service';

describe('ReportExcelExportService', () => {
  let service: ReportExcelExportService;

  beforeEach(() => {
    service = new ReportExcelExportService();
  });

  it('builds a formatted workbook for table reports', () => {
    const workbook = service.buildWorkbook(
      [
        {
          row: [
            'Head Office',
            '37648.35'
          ]
        }
      ],
      [
        'Office/Branch',
        'Loan Amount'
      ],
      {
        columnTypes: [
          'STRING',
          'DECIMAL'
        ],
        decimalChoice: 2
      }
    );

    const worksheet = workbook.getWorksheet('Report') as any;
    const table = worksheet.getTable('ReportTable');
    const frozenView = worksheet.views[0] as {
      state: string;
      ySplit?: number;
    };

    expect(frozenView.state).toBe('frozen');
    expect(frozenView.ySplit).toBe(1);
    expect(table.style.theme).toBe('TableStyleLight15');
    expect(table.style.showRowStripes).toBe(true);
    expect(table.columns[0].filterButton).toBe(true);
    expect(worksheet.getColumn(1).width).toBeGreaterThanOrEqual(14);
    expect(worksheet.getColumn(2).numFmt).toBe('#,##0.00');
  });
});
