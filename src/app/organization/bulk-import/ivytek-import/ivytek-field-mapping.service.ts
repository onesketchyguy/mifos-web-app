/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Injectable } from '@angular/core';

import {
  IvyTekCsvRow,
  IvyTekDatatableColumnReference,
  IvyTekFieldCoverage,
  IvyTekSourceFileRows,
  IvyTekUnmappedFieldWarning
} from './ivytek-import.models';

/**
 * Builds field coverage warnings for source columns that are not mapped to native or custom fields.
 */
@Injectable({
  providedIn: 'root'
})
export class IvyTekFieldMappingService {
  private readonly systemSourceColumns = new Set([
    '_',
    'Id',
    'Name',
    'IsDeleted',
    'OwnerId',
    'CreatedDate',
    'CreatedById',
    'LastModifiedDate',
    'LastModifiedById',
    'SystemModstamp',
    'LastActivityDate',
    'RecordTypeId'
  ]);

  getCoverage(
    sourceFile: IvyTekSourceFileRows,
    nativeFields: string[],
    datatableColumns: IvyTekDatatableColumnReference[]
  ): IvyTekFieldCoverage {
    const mappedKeys = new Set([
      ...nativeFields.map((field: string) => this.normalize(field)),
      ...datatableColumns.flatMap((column: IvyTekDatatableColumnReference) => [
          column.columnName,
          column.displayName
        ].map((field: string) => this.normalize(field)))
    ]);
    const headers = this.getHeaders(sourceFile.rows);
    const mappedColumns: string[] = [];
    const warnings: IvyTekUnmappedFieldWarning[] = [];

    headers.forEach((header: string) => {
      if (this.isMappedHeader(header, mappedKeys)) {
        mappedColumns.push(header);
        return;
      }

      if (this.isConstantValueColumn(sourceFile.rows, header)) {
        return;
      }

      const sample = this.getFirstNonEmptySample(sourceFile.rows, header);
      if (!sample) {
        return;
      }

      warnings.push({
        sourceFile: sourceFile.displayName,
        sourceColumn: header,
        rowIdentifier: this.getRowIdentifier(sample.row),
        sampleValue: sample.value,
        reason: 'No native Mifos field or configured custom field matched this IvyTek source column.'
      });
    });

    return {
      mappedColumns,
      warningColumns: warnings.map((warning: IvyTekUnmappedFieldWarning) => warning.sourceColumn),
      warnings
    };
  }

  normalize(value: string): string {
    return (value || '')
      .toString()
      .toLowerCase()
      .replace(/__c$/i, '')
      .replace(/^ivytektestpkg__/, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '');
  }

  private getHeaders(rows: IvyTekCsvRow[]): string[] {
    const headers = rows.flatMap((row: IvyTekCsvRow) => Object.keys(row));
    return Array.from(new Set(headers));
  }

  private isMappedHeader(header: string, mappedKeys: Set<string>): boolean {
    return this.systemSourceColumns.has(header) || mappedKeys.has(this.normalize(header));
  }

  private isConstantValueColumn(rows: IvyTekCsvRow[], header: string): boolean {
    if (rows.length < 2) {
      return false;
    }

    const values = rows.map((row: IvyTekCsvRow) => this.getCsvValue(row, header));
    return values.every((value: string) => !!value) && new Set(values).size === 1;
  }

  private getFirstNonEmptySample(rows: IvyTekCsvRow[], header: string): { row: IvyTekCsvRow; value: string } | null {
    const row = rows.find((sourceRow: IvyTekCsvRow) => !!this.getCsvValue(sourceRow, header));
    return row
      ? {
          row,
          value: this.getCsvValue(row, header)
        }
      : null;
  }

  private getRowIdentifier(row: IvyTekCsvRow): string {
    return (
      this.getCsvValue(row, 'IvytekTestPkg__Legacy_Loan_ID__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__LoanID__c') ||
      this.getCsvValue(row, 'IvytekTestPkg__ExternalID__c') ||
      this.getCsvValue(row, 'Id') ||
      this.getCsvValue(row, 'Name')
    );
  }

  private getCsvValue(row: IvyTekCsvRow, key: string): string {
    const value = (row?.[key] ?? '').toString().trim();
    return [
      'null',
      'undefined',
      '#n/a',
      'n/a'
    ].includes(value.toLowerCase()) ? '' : value;
  }
}
