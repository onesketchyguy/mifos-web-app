/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { SearchService } from './search.service';
import { SearchData } from './search.model';

describe('SearchService', () => {
  let service: SearchService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SearchService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(SearchService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('searches the exact supplied query by default', async () => {
    const resultsPromise = firstValueFrom(service.getSearchResults('john', 'clients'));

    const request = httpMock.expectOne((req) => req.url === '/search' && req.method === 'GET');
    expect(request.request.params.get('exactMatch')).toBe('false');
    expect(request.request.params.get('query')).toBe('john');
    expect(request.request.params.get('resource')).toBe('clients');

    request.flush([]);
    await expect(resultsPromise).resolves.toEqual([]);
  });

  it('searches case variants and merges duplicate global results when requested', async () => {
    const johnClient = createSearchResult(1, 'John Smith');
    const johnSavings = createSearchResult(2, 'John Savings');
    const resultsPromise = firstValueFrom(service.getSearchResults('john', 'clients', true));

    const requests = httpMock.match((req) => req.url === '/search' && req.method === 'GET');
    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.request.params.get('query'))).toEqual([
      'john',
      'JOHN',
      'John'
    ]);

    requests[0].flush([johnClient]);
    requests[1].flush([johnClient]);
    requests[2].flush([johnSavings]);

    await expect(resultsPromise).resolves.toEqual([
      johnClient,
      johnSavings
    ]);
  });
});

function createSearchResult(entityId: number, entityName: string): SearchData {
  return {
    entityId,
    entityAccountNo: `${entityId}`,
    entityExternalId: `external-${entityId}`,
    entityName,
    entityType: 'CLIENT',
    parentId: 1,
    parentName: 'Head Office',
    entityStatus: {
      id: 300,
      code: 'clientStatusType.active',
      value: 'Active'
    },
    parentType: 'OFFICE',
    subEntityType: ''
  };
}
