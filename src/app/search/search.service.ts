/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

/** rxjs Imports */
import { forkJoin, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Custom Models */
import { SearchData } from './search.model';

/**
 * Search service.
 */
@Injectable({
  providedIn: 'root'
})
export class SearchService {
  private http = inject(HttpClient);

  /**
   * @param {string} query Query String
   * @param {string} resource Entity resource
   * @returns {Observable<any>} Search Results.
   */
  getSearchResults(query: string, resource: string, includeCaseVariants = false): Observable<any> {
    const queries = includeCaseVariants ? this.getCaseSearchQueries(query) : [query];

    if (queries.length === 1) {
      return this.search(queries[0], resource);
    }

    return forkJoin(queries.map((searchQuery) => this.search(searchQuery, resource))).pipe(
      map((results) =>
        this.mergeSearchResults(results.reduce<SearchData[]>((combined, result) => combined.concat(result), []))
      )
    );
  }

  private search(query: string, resource: string): Observable<SearchData[]> {
    const httpParams = new HttpParams().set('exactMatch', 'false').set('query', query).set('resource', resource);
    return this.http.get<SearchData[]>('/search', { params: httpParams });
  }

  private getCaseSearchQueries(query: string): string[] {
    const trimmedQuery = query?.trim() ?? '';
    if (!trimmedQuery) {
      return [trimmedQuery];
    }

    return Array.from(
      new Set([
        query,
        trimmedQuery,
        trimmedQuery.toLocaleLowerCase(),
        trimmedQuery.toLocaleUpperCase(),
        this.toTitleCase(trimmedQuery)
      ])
    );
  }

  private toTitleCase(query: string): string {
    return query.replace(/\S+/g, (token) => token.charAt(0).toLocaleUpperCase() + token.slice(1).toLocaleLowerCase());
  }

  private mergeSearchResults(results: SearchData[]): SearchData[] {
    const uniqueResults = new Map<string, SearchData>();

    results.forEach((result) => uniqueResults.set(this.getSearchResultKey(result), result));

    return Array.from(uniqueResults.values());
  }

  private getSearchResultKey(result: SearchData): string {
    return [
      result.entityType,
      result.entityId,
      result.entityAccountNo,
      result.entityExternalId,
      result.parentId,
      result.subEntityType
    ]
      .map((value) => value ?? '')
      .join('|');
  }
}
