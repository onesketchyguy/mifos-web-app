/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { IvyTekCsvParserService } from './ivytek-csv-parser.service';

describe('IvyTekCsvParserService', () => {
  let service: IvyTekCsvParserService;

  beforeEach(() => {
    service = new IvyTekCsvParserService();
  });

  it('parses quoted values and preserves source cell text', () => {
    const rows = service.parse('Id,Name,Note\r\n1,"Doe, Jane"," paid ""as-is"" "\r\n');

    expect(rows).toEqual([
      {
        Id: '1',
        Name: 'Doe, Jane',
        Note: ' paid "as-is" '
      }
    ]);
  });

  it('ignores empty trailing rows', () => {
    const rows = service.parse('Id,Amount\n1,10\n,\n');

    expect(rows).toEqual([
      {
        Id: '1',
        Amount: '10'
      }
    ]);
  });
});
