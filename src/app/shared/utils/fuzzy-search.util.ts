/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { MatTableDataSource } from '@angular/material/table';

const MAX_OBJECT_DEPTH = 2;

/**
 * Normalizes a search value for case-insensitive matching while preserving
 * punctuation for callers that pass the value to server-side filters.
 * @param value Search value.
 * @returns Normalized search text.
 */
export function normalizeSearchText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Checks whether a query fuzzily matches one or more searchable values.
 * @param values Searchable values.
 * @param query Search query.
 * @returns True if the query matches.
 */
export function matchesFuzzySearch(values: unknown[] | unknown, query: unknown): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const searchableText = collectSearchValues(values).map(normalizeSearchText).join(' ');
  if (searchableText.includes(normalizedQuery)) {
    return true;
  }

  const searchableTokens = tokenizeSearchText(searchableText);
  const queryTokens = tokenizeSearchText(normalizedQuery);
  if (!queryTokens.length) {
    return true;
  }

  return queryTokens.every((queryToken: string) => matchesSearchToken(searchableText, searchableTokens, queryToken));
}

/**
 * Creates a fuzzy filter predicate for Angular Material table data sources.
 * @param extractor Optional row value extractor.
 * @returns MatTableDataSource filter predicate.
 */
export function createFuzzyFilterPredicate<T>(
  extractor?: (row: T) => unknown[] | unknown
): (data: T, filter: string) => boolean {
  return (data: T, filter: string) => matchesFuzzySearch(extractor ? extractor(data) : data, filter);
}

/**
 * Applies the default fuzzy filter predicate and filter value to a table.
 * @param dataSource Table data source.
 * @param filterValue Filter value.
 */
export function applyFuzzyTableFilter<T>(dataSource: MatTableDataSource<T>, filterValue: unknown): void {
  dataSource.filterPredicate = createFuzzyFilterPredicate<T>();
  dataSource.filter = normalizeSearchText(filterValue);
}

function collectSearchValues(value: unknown, depth: number = 0, seen: WeakSet<object> = new WeakSet()): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry: unknown) => collectSearchValues(entry, depth, seen));
  }

  if (value instanceof Date) {
    return [value.toISOString()];
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return [];
    }
    if (depth >= MAX_OBJECT_DEPTH) {
      return [];
    }
    seen.add(value);
    return Object.values(value).flatMap((entry: unknown) => collectSearchValues(entry, depth + 1, seen));
  }

  return [String(value)];
}

function tokenizeSearchText(value: string): string[] {
  return normalizeSearchText(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token: string) => token.length > 0);
}

function matchesSearchToken(searchableText: string, searchableTokens: string[], queryToken: string): boolean {
  if (searchableText.includes(queryToken)) {
    return true;
  }

  if (containsDigit(queryToken)) {
    return false;
  }

  const maxDistance = getMaxEditDistance(queryToken);
  if (!maxDistance) {
    return false;
  }

  return searchableTokens.some((searchableToken: string) => {
    return (
      !containsDigit(searchableToken) &&
      Math.abs(searchableToken.length - queryToken.length) <= maxDistance &&
      getDamerauLevenshteinDistance(queryToken, searchableToken, maxDistance) <= maxDistance
    );
  });
}

function containsDigit(value: string): boolean {
  return /\d/.test(value);
}

function getMaxEditDistance(value: string): number {
  if (value.length < 3) {
    return 0;
  }

  return value.length <= 5 ? 1 : 2;
}

function getDamerauLevenshteinDistance(source: string, target: string, maxDistance: number): number {
  if (Math.abs(source.length - target.length) > maxDistance) {
    return maxDistance + 1;
  }

  const previousPreviousRow: number[] = [];
  let previousRow = Array.from({ length: target.length + 1 }, (_: unknown, index: number) => index);
  let currentRow: number[] = [];

  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex++) {
    currentRow = [sourceIndex];
    let rowMinimum = currentRow[0];

    for (let targetIndex = 1; targetIndex <= target.length; targetIndex++) {
      const substitutionCost = source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      let distance = Math.min(
        currentRow[targetIndex - 1] + 1,
        previousRow[targetIndex] + 1,
        previousRow[targetIndex - 1] + substitutionCost
      );

      if (
        sourceIndex > 1 &&
        targetIndex > 1 &&
        source[sourceIndex - 1] === target[targetIndex - 2] &&
        source[sourceIndex - 2] === target[targetIndex - 1]
      ) {
        distance = Math.min(distance, previousPreviousRow[targetIndex - 2] + 1);
      }

      currentRow[targetIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    previousPreviousRow.splice(0, previousPreviousRow.length, ...previousRow);
    previousRow = currentRow;
  }

  return currentRow[target.length];
}
