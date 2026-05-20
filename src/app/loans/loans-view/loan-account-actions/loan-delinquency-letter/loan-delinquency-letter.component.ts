/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Component, OnInit, inject } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { ClientsService } from 'app/clients/clients.service';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { LoanAccountActionsBaseComponent } from '../loan-account-actions-base.component';
import { LoanDelinquencyLetterDocxService } from './loan-delinquency-letter-docx.service';
import { DelinquencyLetterData, DelinquencyLetterType } from './loan-delinquency-letter.model';

interface DelinquencyLetterTypeOption {
  value: DelinquencyLetterType;
  labelKey: string;
}

@Component({
  selector: 'mifosx-loan-delinquency-letter',
  templateUrl: './loan-delinquency-letter.component.html',
  styleUrls: ['./loan-delinquency-letter.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    CdkTextareaAutosize,
    FaIconComponent
  ]
})
export class LoanDelinquencyLetterComponent extends LoanAccountActionsBaseComponent implements OnInit {
  private formBuilder = inject(UntypedFormBuilder);
  private clientsService = inject(ClientsService);
  private letterDocxService = inject(LoanDelinquencyLetterDocxService);

  letterForm: UntypedFormGroup;
  isLoadingClientData = false;
  previewLines: string[] = [];
  readonly letterTypes: DelinquencyLetterTypeOption[] = [
    {
      value: 'collections',
      labelKey: 'labels.inputs.Collections Letter'
    },
    {
      value: 'oneTwentyDay',
      labelKey: 'labels.inputs.120 Day Letter'
    },
    {
      value: 'maturity',
      labelKey: 'labels.inputs.Maturity Letter'
    },
    {
      value: 'final',
      labelKey: 'labels.inputs.Final Letter'
    }
  ];

  ngOnInit(): void {
    this.createLetterForm();
    this.patchLoanData(this.dataObject);
    this.loadClientData();
    this.configureConditionalValidators();

    this.letterForm.get('letterType').valueChanges.subscribe(() => {
      this.configureConditionalValidators();
      this.refreshPreview();
    });
    this.letterForm.valueChanges.subscribe(() => this.refreshPreview());
    this.refreshPreview();
  }

  get requiresMaturityDate(): boolean {
    const letterType = this.letterForm?.get('letterType')?.value;
    return letterType === 'maturity' || letterType === 'final';
  }

  get requiresDeadlineDate(): boolean {
    return this.letterForm?.get('letterType')?.value === 'final';
  }

  get showsLifeInsuranceNotice(): boolean {
    const letterType = this.letterForm?.get('letterType')?.value;
    return letterType === 'collections' || letterType === 'oneTwentyDay';
  }

  downloadLetter(): void {
    if (this.letterForm.invalid) {
      this.letterForm.markAllAsTouched();
      return;
    }

    const letterData = this.getLetterData();
    const documentBlob = this.letterDocxService.createDocx(letterData);
    this.downloadBlob(documentBlob, this.letterDocxService.buildFileName(letterData));
  }

  private createLetterForm(): void {
    const businessDate = this.coerceDate(this.settingsService.businessDate) || new Date();
    const defaultLetterType = this.getDefaultLetterType(this.dataObject, businessDate);
    const deadlineDate = this.addDays(businessDate, 30);

    this.letterForm = this.formBuilder.group({
      letterType: [
        defaultLetterType,
        Validators.required
      ],
      letterDate: [
        businessDate,
        Validators.required
      ],
      recipientName: [
        '',
        Validators.required
      ],
      greetingName: [''],
      mailingAddress: [
        '',
        Validators.required
      ],
      loanNumber: [
        '',
        Validators.required
      ],
      loanFileNumber: [''],
      pastDueAmount: [
        0,
        Validators.required
      ],
      principalBalance: [
        0,
        Validators.required
      ],
      payoffAmount: [
        0,
        Validators.required
      ],
      maturityDate: [this.getMaturityDate(this.dataObject)],
      deadlineDate: [deadlineDate],
      includeLifeInsuranceNotice: [true],
      officerName: [
        'Bucky Cochran',
        Validators.required
      ],
      officerTitle: [
        'Collections Officer',
        Validators.required
      ],
      phoneNumber: ['(541) 553-3201']
    });
  }

  private patchLoanData(loanData: any): void {
    if (!loanData) {
      return;
    }

    const loanNumber = String(loanData.accountNo || loanData.externalId || loanData.id || this.loanId || '');
    const recipientName = loanData.clientName || loanData.client?.displayName || loanData.group?.name || '';
    const pastDueAmount = this.getPastDueAmount(loanData);
    const principalBalance = this.toNumber(loanData.summary?.principalOutstanding ?? loanData.principal);
    const payoffAmount = this.toNumber(
      loanData.summary?.totalOutstanding ?? loanData.totalOutstanding ?? pastDueAmount
    );

    this.letterForm.patchValue(
      {
        recipientName,
        greetingName: this.extractGreetingName(recipientName),
        loanNumber,
        loanFileNumber: this.getLoanFileNumber(loanNumber),
        pastDueAmount,
        principalBalance,
        payoffAmount,
        maturityDate: this.getMaturityDate(loanData)
      },
      { emitEvent: false }
    );
  }

  private loadClientData(): void {
    const clientId = this.dataObject?.clientId || this.dataObject?.client?.id;
    if (!clientId) {
      return;
    }

    this.isLoadingClientData = true;
    forkJoin({
      client: this.clientsService.getClientData(String(clientId)).pipe(catchError(() => of(null))),
      addresses: this.clientsService.getClientAddressData(String(clientId)).pipe(catchError(() => of([])))
    })
      .pipe(finalize(() => (this.isLoadingClientData = false)))
      .subscribe(({ client, addresses }: { client: any; addresses: any[] }) => {
        const recipientName = client?.displayName || this.letterForm.get('recipientName').value;
        const mailingAddress = this.formatMailingAddress(addresses);
        this.letterForm.patchValue(
          {
            recipientName,
            greetingName: this.extractGreetingName(recipientName),
            mailingAddress: mailingAddress || this.letterForm.get('mailingAddress').value
          },
          { emitEvent: false }
        );
        this.refreshPreview();
      });
  }

  private configureConditionalValidators(): void {
    const maturityDateControl = this.letterForm.get('maturityDate');
    const deadlineDateControl = this.letterForm.get('deadlineDate');

    if (this.requiresMaturityDate) {
      maturityDateControl.setValidators(Validators.required);
    } else {
      maturityDateControl.clearValidators();
    }

    if (this.requiresDeadlineDate) {
      deadlineDateControl.setValidators(Validators.required);
    } else {
      deadlineDateControl.clearValidators();
    }

    maturityDateControl.updateValueAndValidity({ emitEvent: false });
    deadlineDateControl.updateValueAndValidity({ emitEvent: false });
  }

  private refreshPreview(): void {
    if (!this.letterForm) {
      return;
    }
    this.previewLines = this.letterDocxService.buildPreviewLines(this.getLetterData());
  }

  private getLetterData(): DelinquencyLetterData {
    const formValue = this.letterForm.value;
    return {
      letterType: formValue.letterType,
      letterDate: this.coerceDate(formValue.letterDate),
      recipientName: this.toTrimmedString(formValue.recipientName),
      greetingName: this.toTrimmedString(formValue.greetingName),
      mailingAddress: this.toTrimmedString(formValue.mailingAddress),
      loanNumber: this.toTrimmedString(formValue.loanNumber),
      loanFileNumber: this.toTrimmedString(formValue.loanFileNumber),
      pastDueAmount: this.toNumber(formValue.pastDueAmount),
      principalBalance: this.toNumber(formValue.principalBalance),
      payoffAmount: this.toNumber(formValue.payoffAmount),
      maturityDate: this.coerceDate(formValue.maturityDate),
      deadlineDate: this.coerceDate(formValue.deadlineDate),
      officerName: this.toTrimmedString(formValue.officerName),
      officerTitle: this.toTrimmedString(formValue.officerTitle),
      phoneNumber: this.toTrimmedString(formValue.phoneNumber),
      includeLifeInsuranceNotice: formValue.includeLifeInsuranceNotice === true,
      currencyCode: this.dataObject?.currency?.code || 'USD'
    };
  }

  private getDefaultLetterType(loanData: any, businessDate: Date): DelinquencyLetterType {
    const maturityDate = this.getMaturityDate(loanData);
    if (maturityDate && maturityDate < businessDate) {
      return 'maturity';
    }

    const daysPastDue = this.toNumber(loanData?.delinquent?.pastDueDays ?? loanData?.delinquent?.delinquentDays);
    return daysPastDue >= 120 ? 'oneTwentyDay' : 'collections';
  }

  private getPastDueAmount(loanData: any): number {
    return this.toNumber(
      loanData?.delinquent?.delinquentAmount ??
        loanData?.summary?.totalOverdue ??
        this.getOverdueScheduleAmount(loanData)
    );
  }

  private getOverdueScheduleAmount(loanData: any): number {
    const periods = loanData?.repaymentSchedule?.periods;
    if (!Array.isArray(periods)) {
      return 0;
    }

    const today = Date.now();
    return periods.reduce((total: number, period: any) => {
      const dueDate = this.coerceDate(period.dueDate);
      if (!dueDate || period.complete || dueDate.getTime() > today) {
        return total;
      }
      return total + this.toNumber(period.totalOverdue ?? period.totalOutstandingForPeriod);
    }, 0);
  }

  private getMaturityDate(loanData: any): Date | null {
    return this.coerceDate(
      loanData?.maturityDate ||
        loanData?.timeline?.expectedMaturityDate ||
        loanData?.timeline?.actualMaturityDate ||
        loanData?.repaymentSchedule?.periods?.[loanData.repaymentSchedule.periods.length - 1]?.dueDate
    );
  }

  private formatMailingAddress(addresses: any[]): string {
    if (!Array.isArray(addresses) || !addresses.length) {
      return '';
    }

    const selectedAddress = this.selectMailingAddress(addresses);
    const streetLines = [
      selectedAddress.street,
      selectedAddress.addressLine1,
      selectedAddress.addressLine2,
      selectedAddress.addressLine3,
      selectedAddress.townVillage
    ]
      .map((value: any) => this.toTrimmedString(value))
      .filter((value: string) => value.length > 0);
    const state = this.toTrimmedString(
      selectedAddress.stateProvince || selectedAddress.stateName || selectedAddress.stateProvinceName
    );
    const city = this.toTrimmedString(selectedAddress.city);
    const postalCode = this.toTrimmedString(selectedAddress.postalCode);
    const cityLine = [
      city,
      [
        state,
        postalCode
      ]
        .filter((value: string) => value.length > 0)
        .join(' ')
    ]
      .filter((value: string) => value.length > 0)
      .join(', ');

    return [
      ...streetLines,
      cityLine
    ]
      .filter((value: string) => value.length > 0)
      .join('\n');
  }

  private selectMailingAddress(addresses: any[]): any {
    return (
      addresses.find((address: any) => this.isMailingAddress(address) && address.isActive) ||
      addresses.find((address: any) => this.isMailingAddress(address)) ||
      addresses.find((address: any) => address.isActive) ||
      addresses[0]
    );
  }

  private isMailingAddress(address: any): boolean {
    const addressType = this.toTrimmedString(address?.addressType || address?.addressTypeName).toLowerCase();
    return addressType.includes('mail') || addressType.includes('postal');
  }

  private getLoanFileNumber(loanNumber: string): string {
    const parts = loanNumber.split('-').filter((part: string) => part.length > 0);
    return parts.length ? parts[parts.length - 1] : loanNumber;
  }

  private extractGreetingName(recipientName: string): string {
    return this.toTrimmedString(recipientName).split(/\s+/)[0] || this.toTrimmedString(recipientName);
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private coerceDate(value: any): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    if (Array.isArray(value) && value.length >= 3) {
      return new Date(Number(value[0]), Number(value[1]) - 1, Number(value[2]));
    }
    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  private toNumber(value: any): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  private toTrimmedString(value: any): string {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = filename;
    downloadLink.click();
    URL.revokeObjectURL(objectUrl);
  }
}
