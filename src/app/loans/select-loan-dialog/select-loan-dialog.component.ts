/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Component, inject } from '@angular/core';
import { FormControl } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { TribalLoanData, TribalPaymentSource } from '../services/tribal-loan-payments.service';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';

export interface SelectLoanDialogData {
  loans: TribalLoanData[];
  selectedSource: TribalPaymentSource;
}

export interface SelectLoanDialogResult {
  loan: TribalLoanData;
  amount: number;
}

@Component({
  selector: 'mifosx-select-loan-dialog',
  templateUrl: './select-loan-dialog.component.html',
  styleUrls: ['./select-loan-dialog.component.scss'],
  standalone: true,
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatListModule
  ]
})
export class SelectLoanDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<SelectLoanDialogComponent>>(MatDialogRef);
  readonly data = inject<SelectLoanDialogData>(MAT_DIALOG_DATA);

  searchControl = new FormControl('');
  selectedLoan: TribalLoanData | null = null;
  amount: number | null = null;

  get filteredLoans(): TribalLoanData[] {
    const term = (this.searchControl.value || '').toLowerCase().trim();
    if (!term) {
      return this.data.loans;
    }
    return this.data.loans.filter(
      (loan: TribalLoanData) =>
        loan.borrowerName.toLowerCase().includes(term) || loan.accountNo.toLowerCase().includes(term)
    );
  }

  get sourceLabel(): string {
    switch (this.data.selectedSource) {
      case 'percap':
        return 'Percap';
      case 'pension':
        return 'Pension';
      case 'payroll':
        return 'Payroll';
    }
  }

  get canConfirm(): boolean {
    return this.selectedLoan !== null && this.amount !== null && this.amount > 0;
  }

  pickLoan(loan: TribalLoanData): void {
    this.selectedLoan = loan;
    this.amount = loan[this.data.selectedSource] ?? null;
  }

  back(): void {
    this.selectedLoan = null;
    this.amount = null;
  }

  onAmountInput(event: Event): void {
    const value = Number.parseFloat((event.target as HTMLInputElement).value);
    this.amount = Number.isFinite(value) && value > 0 ? value : null;
  }

  confirm(): void {
    if (!this.canConfirm) {
      return;
    }
    this.dialogRef.close({ loan: this.selectedLoan!, amount: this.amount! } as SelectLoanDialogResult);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
