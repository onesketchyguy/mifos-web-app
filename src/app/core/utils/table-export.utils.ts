/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as ExcelJS from 'exceljs';
import { sanitizeCsvValue } from './csv.utils';

export type TableCell = string | number | null;

function escapeHtml(value: any): string {
  return value === undefined || value === null
    ? ''
    : value
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const MIN_COLUMN_WIDTH = 10;
const MAX_COLUMN_WIDTH = 45;
const COLUMN_WIDTH_PADDING = 2;

function columnWidth(header: string, rows: TableCell[][], columnIndex: number): number {
  const longest = rows.reduce((maxLength, row) => {
    const value = row[columnIndex];
    const cellLength = value === null || value === undefined ? 0 : String(value).length;
    return Math.max(maxLength, cellLength);
  }, header.length);
  return Math.min(Math.max(longest + COLUMN_WIDTH_PADDING, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
}

/**
 * Writes a table to an .xlsx file as a real Excel Table object (striped rows, filter
 * buttons, frozen header, auto-sized/numeric-formatted columns) and triggers a browser
 * download — matches the look of this app's report exports (`report-excel-export.service.ts`).
 * Numeric cells are kept as real numbers (sortable/summable in Excel); everything else is
 * run through `sanitizeCsvValue` to prevent formula-injection.
 */
export async function exportTableToXlsx(
  fileName: string,
  headers: string[],
  rows: TableCell[][],
  reversedRows?: boolean[]
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mifos X Web App';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Transactions', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  const isNumericColumn = headers.map((_, columnIndex) => rows.some((row) => typeof row[columnIndex] === 'number'));
  const tableRows = rows.map((row) =>
    row.map((cell) => (typeof cell === 'number' ? cell : cell === null ? null : sanitizeCsvValue(cell)))
  );

  worksheet.addTable({
    name: 'TransactionsTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: {
      theme: 'TableStyleLight15',
      showRowStripes: true,
      showColumnStripes: false
    },
    columns: headers.map((header) => ({ name: sanitizeCsvValue(header), filterButton: true })),
    rows: tableRows
  });

  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', wrapText: true };

  headers.forEach((header, index) => {
    const column = worksheet.getColumn(index + 1);
    column.width = columnWidth(header, rows, index);
    column.alignment = { vertical: 'middle' };
    if (isNumericColumn[index]) {
      column.numFmt = '#,##0.00';
    }
  });

  reversedRows?.forEach((reversed, index) => {
    if (reversed) {
      worksheet.getRow(index + 2).font = { strike: true, color: { argb: 'FFFF0000' } };
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Opens a new window with a self-contained, printable HTML table and triggers the print dialog.
 */
export function printTable(title: string, headers: string[], rows: TableCell[][], reversedRows?: boolean[]): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    return;
  }

  const tableHeaders = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const tableRows = rows
    .map((row, index) => {
      const cells = row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('');
      const rowClass = reversedRows?.[index] ? ' class="reversed"' : '';
      return `<tr${rowClass}>${cells}</tr>`;
    })
    .join('');

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body {
            color: #212121;
            font-family: Arial, sans-serif;
            margin: 24px;
          }

          h1 {
            font-size: 20px;
            font-weight: 500;
            margin: 0 0 16px;
          }

          table {
            border-collapse: collapse;
            width: 100%;
          }

          th,
          td {
            border: 1px solid #d6d6d6;
            font-size: 12px;
            padding: 8px;
            text-align: left;
            vertical-align: top;
          }

          th {
            background: #f5f5f5;
            font-weight: 600;
          }

          .reversed {
            text-decoration: line-through;
            color: red;
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <table>
          <thead>
            <tr>${tableHeaders}</tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
