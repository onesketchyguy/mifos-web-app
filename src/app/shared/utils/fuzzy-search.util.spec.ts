/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { MatTableDataSource } from '@angular/material/table';

import { applyFuzzyTableFilter, matchesFuzzySearch } from './fuzzy-search.util';

describe('fuzzy search utilities', () => {
  it('matches text regardless of case', () => {
    expect(matchesFuzzySearch('LOAN', 'loan')).toBe(true);
    expect(matchesFuzzySearch('loan', 'LOAN')).toBe(true);
  });

  it('matches close transposed misspellings', () => {
    expect(matchesFuzzySearch('John', 'Jhon')).toBe(true);
  });

  it('requires each query token to match searchable text', () => {
    expect(
      matchesFuzzySearch(
        [
          'John Smith',
          'Savings Account'
        ],
        'john sav'
      )
    ).toBe(true);
    expect(
      matchesFuzzySearch(
        [
          'John Smith',
          'Savings Account'
        ],
        'john loan'
      )
    ).toBe(false);
  });

  it('keeps numeric tokens precise', () => {
    expect(matchesFuzzySearch('Account 12345', '123')).toBe(true);
    expect(matchesFuzzySearch('Account 12345', '12346')).toBe(false);
  });

  it('treats empty queries as matches', () => {
    expect(matchesFuzzySearch('Loan Account', '')).toBe(true);
    expect(matchesFuzzySearch('Loan Account', null)).toBe(true);
  });

  it('applies fuzzy filtering to Material table data sources', () => {
    const dataSource = new MatTableDataSource([
      { name: 'John Smith', accountType: 'Savings' },
      { name: 'Maria Garcia', accountType: 'Loan' }
    ]);

    applyFuzzyTableFilter(dataSource, 'jhon');

    expect(dataSource.filteredData).toEqual([{ name: 'John Smith', accountType: 'Savings' }]);
  });
});
