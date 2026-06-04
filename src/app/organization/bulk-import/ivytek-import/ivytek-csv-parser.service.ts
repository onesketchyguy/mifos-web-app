/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Injectable } from '@angular/core';

import { IvyTekCsvRow } from './ivytek-import.models';

/**
 * Parses IvyTek CSV exports without coercing source cell values.
 */
@Injectable({
  providedIn: 'root'
})
export class IvyTekCsvParserService {
  parse(csvText: string): IvyTekCsvRow[] {
    const rows = this.parseRows(csvText);
    const headers = rows.shift()?.map((header: string) => header.replace(/^\uFEFF/, '').trim()) || [];
    return rows.map((row: string[]) =>
      headers.reduce((record: IvyTekCsvRow, header: string, index: number) => {
        record[header] = row[index] || '';
        return record;
      }, {})
    );
  }

  parseRows(csvText: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = '';
    let quoted = false;

    for (let index = 0; index < csvText.length; index += 1) {
      const character = csvText[index];
      const nextCharacter = csvText[index + 1];

      if (character === '"' && quoted && nextCharacter === '"') {
        value += character;
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === ',' && !quoted) {
        row.push(value);
        value = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && nextCharacter === '\n') {
          index += 1;
        }
        row.push(value);
        rows.push(row);
        row = [];
        value = '';
      } else {
        value += character;
      }
    }

    if (value || row.length) {
      row.push(value);
      rows.push(row);
    }

    return rows.filter((csvRow: string[]) => csvRow.some((cell: string) => cell.trim() !== ''));
  }
}
