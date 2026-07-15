/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Component, OnInit, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Dates } from 'app/core/utils/dates';
import {
  EditableRepaymentSchedule,
  EditablePeriod,
  ScheduleChangeRecord,
  RepaymentScheduleEditEvent
} from 'app/loans/models/loan-account.model';
import { ConfirmationDialogComponent } from 'app/shared/confirmation-dialog/confirmation-dialog.component';
import { FormDialogComponent } from 'app/shared/form-dialog/form-dialog.component';
import { FormfieldBase } from 'app/shared/form-dialog/formfield/model/formfield-base';
import { InputBase } from 'app/shared/form-dialog/formfield/model/input-base';
import { SelectBase } from 'app/shared/form-dialog/formfield/model/select-base';
import { RepaymentScheduleTabComponent } from '../../repayment-schedule-tab/repayment-schedule-tab.component';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { LoanAccountActionsBaseComponent } from '../loan-account-actions-base.component';

@Component({
  selector: 'mifosx-edit-repayment-schedule',
  templateUrl: './edit-repayment-schedule.component.html',
  styleUrls: ['./edit-repayment-schedule.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    RepaymentScheduleTabComponent
  ]
})
export class EditRepaymentScheduleComponent extends LoanAccountActionsBaseComponent implements OnInit {
  private dialog = inject(MatDialog);
  private dateUtils = inject(Dates);
  private translateService = inject(TranslateService);

  /** Indicates If the Schedule has been changed */
  wasChanged = false;
  /** Indicates If the Schedule has been validated */
  wasValidated = false;
  /** Stores the Repayment Schedule data */
  repaymentScheduleDetails: EditableRepaymentSchedule | null = null;
  /** Stores the Installments changed */
  repaymentScheduleChanges: Record<string, ScheduleChangeRecord> = {};
  /** Stores each installment's due date as it was when the schedule was first loaded, keyed by period number */
  private originalDueDates: Record<number, string> = {};

  constructor() {
    super();
    this.getRepaymentSchedule();
  }

  ngOnInit(): void {
    this.repaymentScheduleChanges = {};
  }

  getRepaymentSchedule(): void {
    this.loanService.getLoanAccountResource(this.loanId, 'repaymentSchedule').subscribe({
      next: (response: { repaymentSchedule: EditableRepaymentSchedule }) => {
        this.repaymentScheduleDetails = response.repaymentSchedule;
        this.originalDueDates = {};
        this.repaymentScheduleDetails.periods.forEach((period: EditablePeriod) => {
          if (period.period) {
            this.originalDueDates[period.period] = this.dateUtils.formatDate(
              period.dueDate,
              this.settingsService.dateFormat
            );
          }
        });
      },
      error: (err) => {
        console.error('Failed to load repayment schedule:', err);
      }
    });
  }

  /** Builds the from/to period select options shared by the amount and date pattern dialogs. */
  private buildPeriodOptions(): Array<{ idx: number; dueDate: string }> {
    const periods: Array<{ idx: number; dueDate: string }> = [];
    this.repaymentScheduleDetails?.periods.forEach((period: EditablePeriod) => {
      if (period.period) {
        periods.push({
          idx: period.period,
          dueDate: this.dateUtils.formatDate(period.dueDate, this.settingsService.dateFormat)
        });
      }
    });
    return periods;
  }

  /** Fineract rejects any installmentAmount entry — even an unchanged one — for the final installment. */
  private isLastPeriod(period: EditablePeriod): boolean {
    return !!period.period && period.period + 1 >= (this.repaymentScheduleDetails?.periods.length ?? 0);
  }

  /** Handles a single-installment edit (date and/or amount) emitted by the schedule table. */
  onEditPeriod(event: RepaymentScheduleEditEvent): void {
    const key = this.originalDueDates[event.period];
    if (!key) {
      return;
    }
    const isLastPeriod = event.period + 1 >= (this.repaymentScheduleDetails?.periods.length ?? 0);
    this.repaymentScheduleChanges[key] = {
      ...this.repaymentScheduleChanges[key],
      dueDate: key,
      ...(isLastPeriod ? {} : { installmentAmount: event.installmentAmount }),
      ...(event.modifiedDueDate ? { modifiedDueDate: event.modifiedDueDate } : {})
    };
    this.wasChanged = true;
  }

  /**
   * Bulk-assigns a semi-monthly (or any two-day-of-month) date pattern across a range of
   * installments, alternating between two day-of-month values and clamping to the last real
   * day of each installment's own month (e.g. day 31 in April becomes April 30).
   */
  applyDatePattern(): void {
    if (!this.repaymentScheduleDetails) {
      return;
    }

    const periods = this.buildPeriodOptions();
    const formfields: FormfieldBase[] = [
      new SelectBase({
        controlName: 'fromPeriod',
        label: 'From Date',
        value: '',
        options: { label: 'dueDate', value: 'idx', data: periods },
        required: true
      }),
      new SelectBase({
        controlName: 'toPeriod',
        label: 'To Date',
        value: '',
        options: { label: 'dueDate', value: 'idx', data: periods },
        required: true
      }),
      new InputBase({
        controlName: 'firstDay',
        label: 'First Due Day of Month',
        value: '',
        type: 'number',
        min: 1,
        max: 31,
        required: true
      }),
      new InputBase({
        controlName: 'secondDay',
        label: 'Second Due Day of Month',
        value: '',
        type: 'number',
        min: 1,
        max: 31,
        required: true
      })
    ];
    const data = {
      title: 'Date Pattern',
      formfields: formfields
    };
    const addDialogRef = this.dialog.open(FormDialogComponent, { data, width: '50rem' });
    addDialogRef
      .afterClosed()
      .subscribe(
        (response: {
          data?: { value?: { fromPeriod: number; toPeriod: number; firstDay: number; secondDay: number } };
        }) => {
          const value = response?.data?.value;
          if (!value || !this.repaymentScheduleDetails) {
            return;
          }
          const { fromPeriod, toPeriod, firstDay, secondDay } = value;
          const dateFormat = this.settingsService.dateFormat;
          // Consecutive in-range installments are paired into the same month (firstDay, then
          // secondDay) and the month only advances after each completed pair — anchoring every
          // installment to its own pre-existing month independently would preserve the base
          // schedule's original spacing instead of producing a true twice-a-month cadence.
          let useFirstDay = true;
          let cursorYear: number = null;
          let cursorMonth: number = null;

          this.repaymentScheduleDetails.periods.forEach((period: EditablePeriod) => {
            if (!period.period || period.period < fromPeriod || period.period > toPeriod) {
              return;
            }
            if (cursorYear === null || cursorMonth === null) {
              const anchor = this.dateUtils.parseDate(period.modifiedDueDate ?? period.dueDate);
              cursorYear = anchor.getFullYear();
              cursorMonth = anchor.getMonth() + 1;
            }

            const desiredDay = useFirstDay ? firstDay : secondDay;
            const clampedDay = Math.min(desiredDay, this.dateUtils.daysInMonth(cursorYear, cursorMonth));
            const newDate = new Date(cursorYear, cursorMonth - 1, clampedDay);

            if (!useFirstDay) {
              cursorMonth += 1;
              if (cursorMonth > 12) {
                cursorMonth = 1;
                cursorYear += 1;
              }
            }
            useFirstDay = !useFirstDay;

            const existing = this.dateUtils.parseDate(period.modifiedDueDate ?? period.dueDate);
            if (this.dateUtils.formatDate(newDate, dateFormat) === this.dateUtils.formatDate(existing, dateFormat)) {
              return;
            }

            period.modifiedDueDate = newDate;
            const key = this.originalDueDates[period.period];
            this.repaymentScheduleChanges[key] = {
              ...this.repaymentScheduleChanges[key],
              dueDate: key,
              modifiedDueDate: this.dateUtils.formatDate(newDate, dateFormat),
              ...(this.isLastPeriod(period) ? {} : { installmentAmount: period.totalDueForPeriod })
            };
            this.wasChanged = true;
          });
        }
      );
  }

  applyPattern(): void {
    if (!this.repaymentScheduleDetails) {
      return;
    }

    const periods = this.buildPeriodOptions();
    const formfields: FormfieldBase[] = [
      new SelectBase({
        controlName: 'fromPeriod',
        label: 'From Date',
        value: '',
        options: { label: 'dueDate', value: 'idx', data: periods },
        required: true
      }),
      new SelectBase({
        controlName: 'toPeriod',
        label: 'To Date',
        value: '',
        options: { label: 'dueDate', value: 'idx', data: periods },
        required: true
      }),
      new InputBase({
        controlName: 'amount',
        label: 'Installment Amount',
        value: '',
        type: 'number',
        required: true
      })
    ];
    const data = {
      title: 'Pattern Update',
      formfields: formfields
    };
    const addDialogRef = this.dialog.open(FormDialogComponent, { data });
    addDialogRef
      .afterClosed()
      .subscribe((response: { data?: { value?: { fromPeriod: number; toPeriod: number; amount: number } } }) => {
        if (response.data?.value && this.repaymentScheduleDetails) {
          const fromPeriod = response.data.value.fromPeriod;
          const toPeriod = response.data.value.toPeriod;
          const amount = response.data.value.amount;
          const periodsVariation: EditablePeriod[] = [];
          this.repaymentScheduleDetails.periods.forEach((period: EditablePeriod) => {
            if (
              period.period &&
              fromPeriod <= period.period &&
              toPeriod >= period.period &&
              !this.isLastPeriod(period)
            ) {
              if (period.totalDueForPeriod !== amount) {
                period.totalDueForPeriod = amount;
                const dueDate = this.originalDueDates[period.period];
                this.repaymentScheduleChanges[dueDate] = {
                  ...this.repaymentScheduleChanges[dueDate],
                  dueDate: dueDate,
                  installmentAmount: amount
                };
                this.wasChanged = true;
                period.changed = true;
              }
            }
            periodsVariation.push(period);
          });
          this.repaymentScheduleDetails.periods = periodsVariation;
        }
      });
  }

  reset(): void {
    const recoverScheduleDialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        heading: this.translateService.instant('labels.heading.Recover Original Schedule'),
        dialogContext: this.translateService.instant(
          'labels.dialogContext.Are you sure you want recover the Original Schedule'
        )
      }
    });
    recoverScheduleDialogRef.afterClosed().subscribe((responseConfirmation: { confirm?: boolean }) => {
      if (responseConfirmation.confirm) {
        this.loanService.applyCommandLoanScheduleVariations(this.loanId, 'deleteVariations', {}).subscribe({
          next: () => {
            this.getRepaymentSchedule();
            this.repaymentScheduleChanges = {};
            this.wasChanged = false;
            this.wasValidated = false;
          },
          error: (err) => {
            console.error('Failed to delete schedule variations:', err);
          }
        });
      }
    });
  }

  validate(): void {
    if (!this.repaymentScheduleDetails) {
      return;
    }

    this.loanService
      .applyCommandLoanScheduleVariations(this.loanId, 'calculateLoanSchedule', this.getPayload())
      .subscribe({
        next: (response: EditableRepaymentSchedule) => {
          if (this.repaymentScheduleDetails) {
            this.repaymentScheduleDetails.periods = [];
            response.periods.forEach((period: EditablePeriod) => {
              period.changed = true;
              this.repaymentScheduleDetails!.periods.push(period);
              this.wasValidated = true;
            });
          }
        },
        error: (err) => {
          console.error('Failed to calculate loan schedule:', err);
        }
      });
  }

  submit(): void {
    this.loanService.applyCommandLoanScheduleVariations(this.loanId, 'addVariations', this.getPayload()).subscribe({
      next: () => {
        this.gotoLoanView('repayment-schedule');
      },
      error: (err) => {
        console.error('Failed to add schedule variations:', err);
      }
    });
  }

  private getPayload(): {
    exceptions: { modifiedinstallments: ScheduleChangeRecord[] };
    dateFormat: string;
    locale: string;
  } {
    const modifiedinstallments: ScheduleChangeRecord[] = [];
    Object.keys(this.repaymentScheduleChanges).forEach((key: string) => {
      modifiedinstallments.push(this.repaymentScheduleChanges[key]);
    });
    const dateFormat = this.settingsService.dateFormat;
    const locale = this.settingsService.language.code;
    return {
      exceptions: {
        modifiedinstallments
      },
      dateFormat,
      locale
    };
  }
}
