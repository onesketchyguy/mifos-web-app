/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Component, OnInit, inject } from '@angular/core';
import {
  MatDialogRef,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions,
  MatDialogClose
} from '@angular/material/dialog';
import { MatProgressBar } from '@angular/material/progress-bar';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { AlertService } from 'app/core/alert/alert.service';

export interface BulkDeleteDbConfig {
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;
  keepClients: boolean;
}

@Component({
  selector: 'mifosx-bulk-delete-dialog',
  templateUrl: './bulk-delete-dialog.component.html',
  styleUrls: ['./bulk-delete-dialog.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatProgressBar
  ]
})
export class BulkDeleteDialogComponent implements OnInit {
  dialogRef = inject<MatDialogRef<BulkDeleteDialogComponent>>(MatDialogRef);
  private fb = inject(UntypedFormBuilder);
  private alertService = inject(AlertService);

  form: UntypedFormGroup;
  confirmText = '';
  keepClients = false;
  running = false;
  statusMessage = '';

  ngOnInit() {
    this.form = this.fb.group({
      host: [
        'localhost',
        Validators.required
      ],
      port: [
        5432,
        Validators.required
      ],
      dbname: [
        'fineract_default',
        Validators.required
      ],
      user: [
        'root',
        Validators.required
      ],
      password: [
        '',
        Validators.required
      ],
      keepClients: [false],
      confirmText: ['']
    });

    this.form.get('confirmText')!.valueChanges.subscribe((val: string) => {
      this.confirmText = val ?? '';
    });

    this.form.get('keepClients')!.valueChanges.subscribe((val: boolean) => {
      this.keepClients = !!val;
    });
  }

  get isValid(): boolean {
    return this.form?.valid && this.confirmText === 'DELETE';
  }

  confirm() {
    if (!this.isValid || this.running) {
      return;
    }
    const { host, port, dbname, user, password, keepClients } = this.form.value;
    this.runDelete({ host, port: Number(port), dbname, user, password, keepClients: !!keepClients });
  }

  private async runDelete(config: BulkDeleteDbConfig) {
    this.running = true;
    this.statusMessage = 'Running SQL bulk delete…';

    const { keepClients, ...db } = config;

    try {
      const response = await fetch('/api/ivytek/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db, keepClients })
      });
      const result: any = await response.json();

      if (response.ok && result.success) {
        this.alertService.alert({
          type: 'Bulk Delete Complete',
          message: result.message ?? `Truncated ${result.truncated?.length ?? 0} table(s).`
        });
      } else {
        this.alertService.alert({
          type: 'Bulk Delete Failed',
          message: result.message ?? 'Bulk delete failed.'
        });
      }
    } catch (err: any) {
      this.alertService.alert({
        type: 'Bulk Delete Failed',
        message: `An error occurred during bulk delete: ${err?.message ?? 'Unknown error'}`
      });
    } finally {
      this.running = false;
      this.statusMessage = '';
      this.dialogRef.close();
    }
  }
}
