/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export type IvyTekSourceFileType = 'contacts' | 'applications' | 'contactApplications' | 'loans' | 'transactions';

export interface IvyTekCsvRow {
  [key: string]: string;
}

export interface IvyTekSourceFileRows {
  type: IvyTekSourceFileType;
  displayName: string;
  rows: IvyTekCsvRow[];
}

export interface IvyTekDatatableColumnReference {
  tableName: string;
  columnName: string;
  columnDisplayType?: string;
  displayName?: string;
}

export interface IvyTekUnmappedFieldWarning {
  sourceFile: string;
  sourceColumn: string;
  rowIdentifier: string;
  sampleValue: string;
  reason: string;
}

export interface IvyTekFieldCoverage {
  mappedColumns: string[];
  warningColumns: string[];
  warnings: IvyTekUnmappedFieldWarning[];
}
