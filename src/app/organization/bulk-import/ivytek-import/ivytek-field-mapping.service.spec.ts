/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { IvyTekFieldMappingService } from './ivytek-field-mapping.service';

describe('IvyTekFieldMappingService', () => {
  let service: IvyTekFieldMappingService;

  beforeEach(() => {
    service = new IvyTekFieldMappingService();
  });

  it('does not warn when a source field maps to a native field or custom field', () => {
    const coverage = service.getCoverage(
      {
        type: 'loans',
        displayName: 'Loans CSV',
        rows: [
          {
            Id: 'a0r1',
            IvytekTestPkg__Legacy_Loan_ID__c: '711501',
            IvytekTestPkg__BalanceNow__c: '235.78',
            IvytekTestPkg__Mortgage_Code__c: 'M0'
          }
        ]
      },
      [
        'IvytekTestPkg__Legacy_Loan_ID__c',
        'IvytekTestPkg__BalanceNow__c'
      ],
      [
        {
          tableName: 'Tribal Loan Data',
          columnName: 'Mortgage Code'
        }
      ]
    );

    expect(coverage.warnings).toEqual([]);
    expect(coverage.mappedColumns).toContain('IvytekTestPkg__BalanceNow__c');
    expect(coverage.mappedColumns).toContain('IvytekTestPkg__Mortgage_Code__c');
  });

  it('warns for non-empty source fields that have no mapping', () => {
    const coverage = service.getCoverage(
      {
        type: 'contacts',
        displayName: 'Contact CSV',
        rows: [
          {
            Id: '0031',
            FirstName: 'Jane',
            IvytekTestPkg__Unmapped__c: 'value'
          }
        ]
      },
      ['FirstName'],
      []
    );

    expect(coverage.warnings).toEqual([
      {
        sourceFile: 'Contact CSV',
        sourceColumn: 'IvytekTestPkg__Unmapped__c',
        rowIdentifier: '0031',
        sampleValue: 'value',
        reason: 'No native Mifos field or configured custom field matched this IvyTek source column.'
      }
    ]);
  });

  it('does not warn for null-like placeholder values', () => {
    const coverage = service.getCoverage(
      {
        type: 'contacts',
        displayName: 'Contact CSV',
        rows: [
          {
            Id: '0031',
            IvytekTestPkg__Optional__c: 'N/A'
          }
        ]
      },
      [],
      []
    );

    expect(coverage.warnings).toEqual([]);
  });

  it('does not warn for source columns with the same value in every row', () => {
    const coverage = service.getCoverage(
      {
        type: 'contacts',
        displayName: 'Contact CSV',
        rows: [
          {
            Id: '0031',
            IvytekTestPkg__DirectDeposit__c: 'false'
          },
          {
            Id: '0032',
            IvytekTestPkg__DirectDeposit__c: 'false'
          }
        ]
      },
      [],
      []
    );

    expect(coverage.warnings).toEqual([]);
  });
});
