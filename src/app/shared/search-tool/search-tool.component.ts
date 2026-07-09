/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { UntypedFormControl } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';

/** rxjs Imports */
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

/**
 * Search Tool Component
 *
 * Always-visible global search field in the toolbar, styled like the other
 * toolbar form fields. Type a query and press enter (or click the search
 * icon) to search across all resources; results can be narrowed by type on
 * the search results page.
 */
@Component({
  selector: 'mifosx-search-tool',
  templateUrl: './search-tool.component.html',
  styleUrls: ['./search-tool.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    FaIconComponent,
    MatIconButton,
    MatTooltip
  ]
})
export class SearchToolComponent implements OnDestroy {
  private router = inject(Router);

  /** Query Form Control */
  query = new UntypedFormControl('');
  /** All searchable resources. Results are filtered by type on the search page. */
  private readonly resource = 'clients,clientIdentifiers,groups,loans';
  /** Router events subscription, used to keep the input in sync with the search page. */
  private routerSubscription: Subscription;

  @ViewChild('searchInput') searchInput: ElementRef<HTMLInputElement>;

  constructor() {
    this.syncQueryFromUrl(this.router.url);
    this.routerSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => this.syncQueryFromUrl(event.urlAfterRedirects));
  }

  ngOnDestroy() {
    this.routerSubscription.unsubscribe();
  }

  /** Focuses the search input so clicking anywhere on the pill starts typing. */
  focusInput() {
    this.searchInput?.nativeElement.focus();
  }

  /**
   * Searches server for query across all resources.
   */
  search() {
    const query = (this.query.value || '').trim();
    if (!query) {
      this.focusInput();
      return;
    }
    this.router.navigate(['/search'], { queryParams: { query, resource: this.resource } });
  }

  /** Clears the query and refocuses the input. */
  clear() {
    this.query.setValue('');
    this.focusInput();
  }

  /** Mirrors the active search query into the input when on the search page. */
  private syncQueryFromUrl(url: string) {
    if (!url.startsWith('/search')) {
      return;
    }
    const queryParam = this.router.parseUrl(url).queryParams['query'] || '';
    if (queryParam !== this.query.value) {
      this.query.setValue(queryParam);
    }
  }
}
