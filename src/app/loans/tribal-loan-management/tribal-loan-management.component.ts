/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, ViewChild, inject } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';

/** Angular Material Imports */
import { MatDialog } from '@angular/material/dialog';
import { MatCard, MatCardActions, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import {
  MatColumnDef,
  MatHeaderCellDef,
  MatHeaderCell,
  MatCellDef,
  MatCell,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import { MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatIcon } from '@angular/material/icon';

/** Custom Services */
import {
  TribalLoanData,
  TribalLoanPaymentsService,
  TribalPaymentSource
} from '../services/tribal-loan-payments.service';

/** Custom Imports */
import { FormatNumberPipe } from 'app/pipes/format-number.pipe';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { SelectLoanDialogComponent, SelectLoanDialogResult } from '../select-loan-dialog/select-loan-dialog.component';
import { ReportExcelExportService } from 'app/reports/report-excel-export.service';

/**
 * Tribal loan management component.
 * User picks a source, clicks Load, and loans stream in one-by-one as datatables resolve.
 * Sorting is provided by MatSort. Summary totals appear at both top and bottom.
 */
@Component({
  selector: 'mifosx-tribal-loan-management',
  templateUrl: './tribal-loan-management.component.html',
  styleUrls: ['./tribal-loan-management.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    FormatNumberPipe,
    MatCard,
    MatCardActions,
    MatCardContent,
    MatCardHeader,
    MatCardTitle,
    MatCell,
    MatCellDef,
    MatColumnDef,
    MatHeaderCell,
    MatHeaderCellDef,
    MatHeaderRow,
    MatHeaderRowDef,
    MatIcon,
    MatProgressBar,
    MatRow,
    MatRowDef,
    MatSortModule,
    MatTable
  ]
})
export class TribalLoanManagementComponent {
  private readonly tribalLoanPaymentsService = inject(TribalLoanPaymentsService);
  private readonly reportExportService = inject(ReportExcelExportService);
  private readonly fb = inject(UntypedFormBuilder);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  sourceForm: UntypedFormGroup = this.fb.group({
    paymentSource: [
      null,
      Validators.required
    ],
    statusFilter: ['active']
  });

  isLoading = false;
  dataLoaded = false;
  loadError: string | null = null;

  private allTribalLoanData: TribalLoanData[] = [];
  private percapLoans: TribalLoanData[] = [];
  private pensionLoans: TribalLoanData[] = [];
  private payrollLoans: TribalLoanData[] = [];

  readonly dataSource = new MatTableDataSource<TribalLoanData>([]);
  readonly displayColumns = [
    'loanId',
    'borrowerName',
    'status',
    'amount',
    'balanceNow'
  ];

  /** Wire sort to datasource whenever the table renders (it's inside an @if). */
  @ViewChild(MatSort) set matSort(sort: MatSort) {
    if (sort) {
      this.dataSource.sort = sort;
    }
  }

  constructor() {
    this.dataSource.sortingDataAccessor = (loan: TribalLoanData, column: string): string | number => {
      switch (column) {
        case 'amount':
          return loan[this.selectedSource!] ?? 0;
        case 'balanceNow':
          return loan.balanceNow ?? 0;
        default:
          return (loan as any)[column] ?? '';
      }
    };

    // Instant source/status switching — no new API call needed since data is cached.
    this.sourceForm.get('paymentSource')?.valueChanges.subscribe(() => {
      if (this.dataLoaded) {
        this.updateDataSource();
      }
    });
    this.sourceForm.get('statusFilter')?.valueChanges.subscribe(() => {
      if (this.dataLoaded) {
        this.rebuildFilteredLists();
      }
    });
  }

  get selectedSource(): TribalPaymentSource | null {
    return this.sourceForm.value.paymentSource || null;
  }

  get statusFilter(): 'active' | 'inactive' | 'both' {
    return this.sourceForm.value.statusFilter || 'active';
  }

  private loanMatchesStatusFilter(loan: TribalLoanData): boolean {
    if (this.statusFilter === 'both') {
      return true;
    }
    return this.statusFilter === 'active' ? loan.isActive : !loan.isActive;
  }

  get currentLoans(): TribalLoanData[] {
    switch (this.selectedSource) {
      case 'percap':
        return this.percapLoans;
      case 'pension':
        return this.pensionLoans;
      case 'payroll':
        return this.payrollLoans;
      default:
        return [];
    }
  }

  get currentTotal(): number {
    const source = this.selectedSource;
    if (!source) {
      return 0;
    }
    return this.currentLoans.reduce((sum: number, loan: TribalLoanData) => sum + (loan[source] ?? 0), 0);
  }

  get canLoad(): boolean {
    return this.sourceForm.valid && !this.isLoading;
  }

  loadData(): void {
    if (!this.canLoad) {
      return;
    }

    this.isLoading = true;
    this.loadError = null;
    this.dataLoaded = true; // show table skeleton + summary immediately
    this.allTribalLoanData = [];
    this.percapLoans = [];
    this.pensionLoans = [];
    this.payrollLoans = [];
    this.dataSource.data = [];

    this.tribalLoanPaymentsService.streamTribalLoanData().subscribe({
      next: (loan: TribalLoanData) => {
        this.allTribalLoanData.push(loan);
        this.addLoanToFilteredLists(loan);
      },
      error: (err: any) => {
        this.loadError = err?.message || 'Failed to load tribal loan data.';
        this.isLoading = false;
      },
      complete: () => {
        this.isLoading = false;
      }
    });
  }

  private addLoanToFilteredLists(loan: TribalLoanData): void {
    if (!this.loanMatchesStatusFilter(loan)) {
      return;
    }

    let belongsToCurrentSource = false;
    const source = this.selectedSource;

    if (loan.percap !== null && loan.percap > 0) {
      this.percapLoans.push(loan);
      if (source === 'percap') {
        belongsToCurrentSource = true;
      }
    }
    if (loan.pension !== null && loan.pension > 0) {
      this.pensionLoans.push(loan);
      if (source === 'pension') {
        belongsToCurrentSource = true;
      }
    }
    if (loan.payroll !== null && loan.payroll > 0) {
      this.payrollLoans.push(loan);
      if (source === 'payroll') {
        belongsToCurrentSource = true;
      }
    }

    if (belongsToCurrentSource) {
      this.updateDataSource();
    }
  }

  private rebuildFilteredLists(): void {
    this.percapLoans = [];
    this.pensionLoans = [];
    this.payrollLoans = [];
    for (const loan of this.allTribalLoanData) {
      if (!this.loanMatchesStatusFilter(loan)) {
        continue;
      }
      if (loan.percap !== null && loan.percap > 0) {
        this.percapLoans.push(loan);
      }
      if (loan.pension !== null && loan.pension > 0) {
        this.pensionLoans.push(loan);
      }
      if (loan.payroll !== null && loan.payroll > 0) {
        this.payrollLoans.push(loan);
      }
    }
    this.updateDataSource();
  }

  private updateDataSource(): void {
    this.dataSource.data = [...this.currentLoans];
  }

  onAmountChange(loan: TribalLoanData, event: Event): void {
    const source = this.selectedSource!;
    const input = event.target as HTMLInputElement;
    const value = Number.parseFloat(input.value);
    const newAmount = Number.isFinite(value) && value >= 0 ? value : 0;

    loan[source] = newAmount;

    this.tribalLoanPaymentsService.updateTribalLoanField(loan, { [source]: newAmount }).subscribe({
      error: (err: any) => console.error('[TribalLoanManagement] Failed to save field:', err)
    });

    if (newAmount === 0) {
      this.removeFromCurrentList(loan);
    }
  }

  private removeFromCurrentList(loan: TribalLoanData): void {
    const source = this.selectedSource;
    if (source === 'percap') {
      this.percapLoans = this.percapLoans.filter((l: TribalLoanData) => l.loanId !== loan.loanId);
    } else if (source === 'pension') {
      this.pensionLoans = this.pensionLoans.filter((l: TribalLoanData) => l.loanId !== loan.loanId);
    } else if (source === 'payroll') {
      this.payrollLoans = this.payrollLoans.filter((l: TribalLoanData) => l.loanId !== loan.loanId);
    }
    this.updateDataSource();
  }

  openAddLoanDialog(): void {
    const source = this.selectedSource!;
    const dialogRef = this.dialog.open(SelectLoanDialogComponent, {
      width: '480px',
      data: { loans: this.allTribalLoanData, selectedSource: source }
    });

    dialogRef.afterClosed().subscribe((result: SelectLoanDialogResult | undefined) => {
      if (!result?.loan || !(result.amount > 0)) {
        return;
      }

      const loan = result.loan;
      loan[source] = result.amount;

      this.tribalLoanPaymentsService.updateTribalLoanField(loan, { [source]: result.amount }).subscribe({
        error: (err: any) => console.error('[TribalLoanManagement] Failed to save field:', err)
      });

      const alreadyInList = this.currentLoans.some((l: TribalLoanData) => l.loanId === loan.loanId);
      if (!alreadyInList) {
        if (source === 'percap') {
          this.percapLoans = [
            ...this.percapLoans,
            loan
          ];
        } else if (source === 'pension') {
          this.pensionLoans = [
            ...this.pensionLoans,
            loan
          ];
        } else {
          this.payrollLoans = [
            ...this.payrollLoans,
            loan
          ];
        }
        this.updateDataSource();
      }
    });
  }

  async exportReport(): Promise<void> {
    const source = this.selectedSource!;
    const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);

    const columns = [
      'Loan ID',
      'Borrower Name',
      'Status',
      'Balance Now',
      `${sourceLabel} Amount`,
      'Refund Amount',
      'Pays Off'
    ];
    const columnTypes = [
      '',
      '',
      '',
      'DECIMAL',
      'DECIMAL',
      'DECIMAL',
      ''
    ];

    const sort = this.dataSource.sort;
    const orderedLoans = sort ? this.dataSource.sortData(this.dataSource.filteredData, sort) : this.currentLoans;

    const reportData = orderedLoans.map((loan: TribalLoanData) => {
      const payment = loan[source] ?? 0;
      const balance = loan.balanceNow ?? 0;
      const refund = Math.max(0, payment - balance);
      return {
        row: [
          loan.loanId,
          loan.borrowerName,
          loan.status,
          balance,
          payment,
          refund,
          payment >= balance ? 'Yes' : 'No'
        ]
      };
    });

    const reportName = `Tribal ${sourceLabel} Report ${new Date().toISOString().slice(0, 10)}`;
    await this.reportExportService.exportTableReport(reportName, reportData, columns, { columnTypes });
  }

  cancel(): void {
    this.router.navigate(['/accounting']);
  }
}
