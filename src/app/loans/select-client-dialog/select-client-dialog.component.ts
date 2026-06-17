/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Component, inject } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatDialogRef, MatDialogTitle, MatDialogContent, MatDialogActions } from '@angular/material/dialog';
import { MatAutocompleteTrigger, MatAutocomplete } from '@angular/material/autocomplete';
import { MatButton } from '@angular/material/button';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs/operators';
import { ClientsService } from 'app/clients/clients.service';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';

export interface SelectClientDialogResult {
  clientId?: number;
  createNew?: boolean;
}

@Component({
  selector: 'mifosx-select-client-dialog',
  templateUrl: './select-client-dialog.component.html',
  standalone: true,
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatAutocompleteTrigger,
    MatAutocomplete
  ]
})
export class SelectClientDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<SelectClientDialogComponent>>(MatDialogRef);
  private readonly clientsService = inject(ClientsService);

  clientSearchControl = new FormControl('');
  clientOptions: any[] = [];

  constructor() {
    this.clientSearchControl.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        filter((value) => typeof value === 'string' && value.trim().length >= 2)
      )
      .subscribe((value: string) => {
        this.clientsService.getFilteredClients('displayName', 'ASC', false, value).subscribe((data: any) => {
          this.clientOptions = data?.pageItems || [];
        });
      });
  }

  displayClient(client: any): string {
    return client?.displayName || '';
  }

  selectClient(client: any): void {
    this.dialogRef.close({ clientId: client.id } as SelectClientDialogResult);
  }

  createNewClient(): void {
    this.dialogRef.close({ createNew: true } as SelectClientDialogResult);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
