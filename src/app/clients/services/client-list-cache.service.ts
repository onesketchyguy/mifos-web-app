/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Injectable } from '@angular/core';

export interface ClientCacheEntry {
  timestamp: number;
  totalRows: number;
  clients: any[];
}

@Injectable({ providedIn: 'root' })
export class ClientListCacheService {
  private readonly TTL_MS = 10 * 60 * 1000;
  private readonly PREFIX = 'mifos_clients_v1_';

  pageKey(filterText: string, page: number, size: number): string {
    return `page_${filterText}_${page}_${size}`;
  }

  fullKey(filterText: string): string {
    return `full_${filterText}`;
  }

  get(key: string): ClientCacheEntry | null {
    try {
      const raw = localStorage.getItem(this.PREFIX + key);
      return raw ? (JSON.parse(raw) as ClientCacheEntry) : null;
    } catch {
      return null;
    }
  }

  set(key: string, clients: any[], totalRows: number): void {
    try {
      const entry: ClientCacheEntry = { timestamp: Date.now(), totalRows, clients };
      localStorage.setItem(this.PREFIX + key, JSON.stringify(entry));
    } catch {
      // Silently ignore QuotaExceededError or unavailable storage
    }
  }

  isStale(entry: ClientCacheEntry): boolean {
    return Date.now() - entry.timestamp > this.TTL_MS;
  }

  invalidate(key: string): void {
    try {
      localStorage.removeItem(this.PREFIX + key);
    } catch {}
  }
}
