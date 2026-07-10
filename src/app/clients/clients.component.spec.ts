/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DatePipe } from '@angular/common';
import { of } from 'rxjs';
import { ClientsComponent, DEBOUNCE_MS } from './clients.component';
import { ClientsService } from './clients.service';
import { AuthenticationService } from 'app/core/authentication/authentication.service';
import { TranslateModule } from '@ngx-translate/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faCog, faDownload, faPlus, faStop } from '@fortawesome/free-solid-svg-icons';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { SearchService } from 'app/search/search.service';

describe('ClientsComponent — debounce search', () => {
  let component: ClientsComponent;
  let fixture: ComponentFixture<ClientsComponent>;
  let clientsService: jest.Mocked<ClientsService>;
  let searchService: jest.Mocked<SearchService>;

  const emptyPage = { content: [] as any[], totalElements: 0, numberOfElements: 0 };

  beforeEach(async () => {
    jest.useFakeTimers();

    clientsService = {
      searchByText: jest.fn(() => of(emptyPage)),
      getClientData: jest.fn((clientId: string) => of({ id: Number(clientId), displayName: `Client ${clientId}` })),
      getClientDatatables: jest.fn(() => of([])),
      getClientListReport: jest.fn(() => of([]))
    } as any;
    searchService = {
      getSearchResults: jest.fn(() => of([]))
    } as any;

    const authService = { getCredentials: jest.fn(() => ({ permissions: ['ALL_FUNCTIONS'] })) } as any;

    await TestBed.configureTestingModule({
      imports: [
        ClientsComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: ClientsService, useValue: clientsService },
        { provide: SearchService, useValue: searchService },
        { provide: AuthenticationService, useValue: authService },
        DatePipe,
        provideAnimationsAsync(),
        provideRouter([])
      ]
    }).compileComponents();

    TestBed.inject(FaIconLibrary).addIcons(faCog, faDownload, faPlus, faStop);

    fixture = TestBed.createComponent(ClientsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Reset call count from ngOnInit (preloadClients may trigger a call)
    clientsService.searchByText.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should not search before 500 ms have elapsed', () => {
    component.onSearchInput('amara');
    jest.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(clientsService.searchByText).not.toHaveBeenCalled();
  });

  it('should search after 500 ms pause', () => {
    component.onSearchInput('amara');
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(clientsService.searchByText).toHaveBeenCalledTimes(1);
    expect(clientsService.searchByText).toHaveBeenCalledWith('amara', 0, expect.any(Number), '', '');
  });

  it('should reset the timer on rapid typing and fire only once', () => {
    component.onSearchInput('k');
    jest.advanceTimersByTime(200);
    component.onSearchInput('ka');
    jest.advanceTimersByTime(200);
    component.onSearchInput('kwame');
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(clientsService.searchByText).toHaveBeenCalledTimes(1);
    expect(clientsService.searchByText).toHaveBeenCalledWith('kwame', 0, expect.any(Number), '', '');
  });

  it('should ignore duplicate consecutive values', () => {
    component.onSearchInput('agaba');
    jest.advanceTimersByTime(DEBOUNCE_MS);
    component.onSearchInput('agaba');
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(clientsService.searchByText).toHaveBeenCalledTimes(1);
  });

  it('should search immediately when Enter is pressed', () => {
    component.search('bob');
    expect(clientsService.searchByText).toHaveBeenCalledTimes(1);
    expect(clientsService.searchByText).toHaveBeenCalledWith('bob', 0, expect.any(Number), '', '');
  });

  it('should merge global client search results when paginated client search returns no results', () => {
    searchService.getSearchResults.mockReturnValueOnce(
      of([
        {
          entityType: 'CLIENT',
          entityId: 7
        },
        {
          entityType: 'CLIENTIDENTIFIER',
          parentId: 8
        }
      ] as any[])
    );
    clientsService.getClientData.mockImplementation((clientId: string) =>
      of({ id: Number(clientId), displayName: clientId === '7' ? 'John Smith' : 'Jane Smith' })
    );

    component.search('jhon');

    expect(searchService.getSearchResults).toHaveBeenCalledWith('jhon', 'clients,clientIdentifiers', true);
    expect(component.dataSource.data.map((client: any) => client.displayName)).toEqual([
      'John Smith',
      'Jane Smith'
    ]);
    expect(component.totalRows).toBe(2);
  });

  it('should merge global client search results when paginated client search returns partial results', () => {
    clientsService.searchByText.mockReturnValueOnce(
      of({
        content: [{ id: 6, displayName: 'Jane Smith' }],
        totalElements: 1,
        numberOfElements: 1
      })
    );
    searchService.getSearchResults.mockReturnValueOnce(
      of([
        {
          entityType: 'CLIENT',
          entityId: 6
        },
        {
          entityType: 'CLIENT',
          entityId: 7
        }
      ] as any[])
    );
    clientsService.getClientData.mockImplementation((clientId: string) =>
      of({ id: Number(clientId), displayName: clientId === '7' ? 'John Smith' : 'Jane Smith' })
    );

    component.search('jhon');

    expect(searchService.getSearchResults).toHaveBeenCalledWith('jhon', 'clients,clientIdentifiers', true);
    expect(clientsService.getClientData).toHaveBeenCalledWith('7');
    expect(component.dataSource.data.map((client: any) => client.displayName)).toEqual([
      'Jane Smith',
      'John Smith'
    ]);
    expect(component.totalRows).toBe(2);
  });

  it('should not fire a second request when Enter is pressed while debounce is pending', () => {
    component.onSearchInput('kofi');
    jest.advanceTimersByTime(200);
    component.search('kofi');
    expect(clientsService.searchByText).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(clientsService.searchByText).toHaveBeenCalledTimes(1);
  });

  it('should search correctly with non-ASCII characters', () => {
    component.onSearchInput('مريم');
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(clientsService.searchByText).toHaveBeenCalledTimes(1);
    expect(clientsService.searchByText).toHaveBeenCalledWith('مريم', 0, expect.any(Number), '', '');
  });

  it('should not search during IME composition but should search on compositionend', () => {
    const inputEl: HTMLInputElement = fixture.nativeElement.querySelector('input[matInput]');

    inputEl.dispatchEvent(new CompositionEvent('compositionstart'));
    fixture.detectChanges();

    // Partial composition — input fires but should be suppressed
    inputEl.value = 'مر';
    inputEl.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(clientsService.searchByText).not.toHaveBeenCalled();

    // Composition ends with final value
    inputEl.value = 'مريم';
    inputEl.dispatchEvent(new CompositionEvent('compositionend'));
    fixture.detectChanges();

    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(clientsService.searchByText).toHaveBeenCalledTimes(1);
    expect(clientsService.searchByText).toHaveBeenCalledWith('مريم', 0, expect.any(Number), '', '');
  });

  it('should not fire debounced search after component is destroyed', () => {
    component.onSearchInput('carol');
    component.ngOnDestroy();
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(clientsService.searchByText).not.toHaveBeenCalled();
  });

  it('should alphabetize by name locally across all pages instead of using the server sort', () => {
    component.dataSource.data = [
      { id: 2, displayName: 'Zeinab Diallo' },
      { id: 1, displayName: 'Amara Toure' }
    ];
    component.totalRows = 2;

    component.sortChanged({ active: 'displayName', direction: 'asc' });

    expect(component.dataSource.data.map((client: any) => client.displayName)).toEqual([
      'Amara Toure',
      'Zeinab Diallo'
    ]);
    expect(component.localSort).toBe(true);
    // Must not fall through to the server-side sort, which ignores displayName.
    expect(clientsService.searchByText).not.toHaveBeenCalledWith('', 0, expect.any(Number), 'displayName', 'asc');
  });
});
