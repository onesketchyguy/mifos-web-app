/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Injectable } from '@angular/core';

import * as ExcelJS from 'exceljs';
import { sanitizeCsvValue } from 'app/core/utils/csv.utils';

export interface ReportExcelExportOptions {
  columnTypes?: string[];
  decimalChoice?: string | number;
}

@Injectable({
  providedIn: 'root'
})
export class ReportExcelExportService {
  private readonly workbookMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  private readonly fallbackFileName = 'report';
  private readonly minColumnWidth = 10;
  private readonly maxColumnWidth = 45;
  private readonly widthPadding = 2;

  async exportTableReport(
    reportName: string,
    reportData: any[],
    displayedColumns: string[],
    options: ReportExcelExportOptions = {}
  ): Promise<void> {
    const workbook = this.buildWorkbook(reportData, displayedColumns, options);
    const buffer = await workbook.xlsx.writeBuffer();
    this.downloadBuffer(buffer as BlobPart, this.getFileName(reportName));
  }

  buildWorkbook(
    reportData: any[],
    displayedColumns: string[],
    options: ReportExcelExportOptions = {}
  ): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Mifos X Web App';
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet('Report', {
      views: [
        {
          state: 'frozen',
          ySplit: 1
        }
      ],
      properties: {
        defaultRowHeight: 18
      },
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0
      }
    });
    const columns = this.getUniqueColumnNames(displayedColumns);
    const rows = this.getTableRows(reportData, columns.length, options.columnTypes);

    if (columns.length === 0) {
      return workbook;
    }

    worksheet.addTable({
      name: 'ReportTable',
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: {
        theme: 'TableStyleLight15',
        showRowStripes: true,
        showColumnStripes: false
      },
      columns: columns.map((column) => ({
        name: sanitizeCsvValue(column),
        filterButton: true
      })),
      rows
    });

    this.applyWorksheetFormatting(worksheet, columns, rows, options);

    return workbook;
  }

  private getTableRows(reportData: any[], columnCount: number, columnTypes: string[] = []): any[][] {
    return reportData.map((entry: any) => {
      const values = Array.isArray(entry.row) ? entry.row : [];
      return Array.from({ length: columnCount }, (_value: unknown, index: number) =>
        this.getCellValue(values[index], columnTypes[index])
      );
    });
  }

  private getCellValue(value: any, columnType?: string): string | number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (this.isNumericColumn(columnType)) {
      const numberValue = this.toNumber(value);
      return numberValue === null ? sanitizeCsvValue(value) : numberValue;
    }
    // Formula-injection guard: spreadsheet apps can execute cell text starting with =+-@ as a formula.
    return sanitizeCsvValue(value);
  }

  private applyWorksheetFormatting(
    worksheet: ExcelJS.Worksheet,
    columns: string[],
    rows: any[][],
    options: ReportExcelExportOptions
  ): void {
    const headerRow = worksheet.getRow(1);
    headerRow.height = 22;
    headerRow.font = {
      bold: true
    };
    headerRow.alignment = {
      vertical: 'middle',
      wrapText: true
    };

    columns.forEach((column: string, index: number) => {
      const worksheetColumn = worksheet.getColumn(index + 1);
      worksheetColumn.width = this.getColumnWidth(column, rows, index);
      worksheetColumn.alignment = {
        vertical: 'middle'
      };

      if (this.isNumericColumn(options.columnTypes?.[index])) {
        worksheetColumn.numFmt = this.getNumericFormat(options.columnTypes?.[index], options.decimalChoice);
      }
    });
  }

  private getColumnWidth(column: string, rows: any[][], columnIndex: number): number {
    const columnLength = rows.reduce((maxLength: number, row: any[]) => {
      const value = row[columnIndex];
      const cellLength = value === null || value === undefined ? 0 : String(value).length;
      return Math.max(maxLength, cellLength);
    }, column.length);

    return Math.min(Math.max(columnLength + this.widthPadding, this.minColumnWidth), this.maxColumnWidth);
  }

  private getUniqueColumnNames(displayedColumns: string[]): string[] {
    const columnCounts = new Map<string, number>();
    return displayedColumns.map((column: string, index: number) => {
      const baseColumnName = column || `Column ${index + 1}`;
      const columnCount = (columnCounts.get(baseColumnName) ?? 0) + 1;
      columnCounts.set(baseColumnName, columnCount);
      return columnCount === 1 ? baseColumnName : `${baseColumnName}_${columnCount}`;
    });
  }

  private isNumericColumn(columnType?: string): boolean {
    return [
      'DECIMAL',
      'INTEGER',
      'NUMBER'
    ].includes((columnType ?? '').toUpperCase());
  }

  private getNumericFormat(columnType?: string, decimalChoice: string | number = 2): string {
    if ((columnType ?? '').toUpperCase() === 'INTEGER') {
      return '#,##0';
    }

    const decimals = Number(decimalChoice);
    const decimalPlaces = Number.isInteger(decimals) && decimals >= 0 ? decimals : 2;
    return decimalPlaces === 0 ? '#,##0' : `#,##0.${'0'.repeat(decimalPlaces)}`;
  }

  private toNumber(value: any): number | null {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '')) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private getFileName(reportName: string): string {
    const sanitizedName = reportName
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    return `${sanitizedName || this.fallbackFileName}.xlsx`;
  }

  private downloadBuffer(buffer: BlobPart, fileName: string): void {
    const blob = new Blob([buffer], { type: this.workbookMimeType });
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    setTimeout(() => {
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(url);
    }, 0);
  }
}
