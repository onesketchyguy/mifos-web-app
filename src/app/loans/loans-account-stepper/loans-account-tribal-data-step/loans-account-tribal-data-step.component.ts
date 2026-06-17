/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Component, OnInit, inject } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatStepperPrevious, MatStepperNext } from '@angular/material/stepper';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { SettingsService } from 'app/settings/settings.service';
import { SystemService } from 'app/system/system.service';

@Component({
  selector: 'mifosx-loans-account-tribal-data-step',
  templateUrl: './loans-account-tribal-data-step.component.html',
  styleUrls: ['./loans-account-tribal-data-step.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    MatCheckbox,
    MatStepperPrevious,
    FaIconComponent,
    MatStepperNext
  ]
})
export class LoansAccountTribalDataStepComponent implements OnInit {
  private formBuilder = inject(UntypedFormBuilder);
  private systemService = inject(SystemService);
  private settingsService = inject(SettingsService);

  tribalDataForm: UntypedFormGroup;

  mortgageCodeOptions: any[] = [];
  loanGroupOptions: any[] = [];

  private columnMap: Record<string, any> = {};

  private readonly fieldCandidates: Record<string, string[]> = {
    mortgageCode: [
      'Mortgage code',
      'Mortgage Code',
      'MortgageCode'
    ],
    loanGroup: [
      'Loan group',
      'Loan Group',
      'LoanGroup'
    ],
    relation: [
      'Relation',
      'Family'
    ],
    percap: [
      'Percap',
      'Per Capita',
      'Per_Capita'
    ],
    payroll: [
      'Payroll',
      'Payroll Deduction'
    ],
    pension: ['Pension']
  };

  ngOnInit(): void {
    this.tribalDataForm = this.formBuilder.group({
      mortgageCode: [''],
      loanGroup: [
        '',
        Validators.required
      ],
      relation: [false],
      percap: [null],
      payroll: [null],
      pension: [null]
    });

    this.loadDatatableDefinition();
  }

  private loadDatatableDefinition(): void {
    this.systemService.getDataTable('Tribal Loan Data').subscribe({
      next: (definition: any) => {
        const columns: any[] = definition.columnHeaderData || definition.columns || [];
        for (const [
          fieldName,
          candidates
        ] of Object.entries(this.fieldCandidates)) {
          const column = this.findColumn(columns, candidates);
          if (column) {
            this.columnMap[fieldName] = column;
          }
        }
        this.mortgageCodeOptions = this.columnMap['mortgageCode']?.columnValues || [];
        this.loanGroupOptions = this.columnMap['loanGroup']?.columnValues || [];
      }
    });
  }

  private findColumn(columns: any[], names: string[]): any {
    const normalized = names.map((n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, ''));
    return columns.find((col: any) => {
      const colDisplay = (col.columnDisplayName || col.columnName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const strippedName = col.columnName?.includes('_cd_')
        ? col.columnName
            .split('_cd_')[0]
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
        : colDisplay;
      return normalized.includes(colDisplay) || normalized.includes(strippedName);
    });
  }

  private getColumnName(fieldName: string): string {
    return this.columnMap[fieldName]?.columnName || this.fieldCandidates[fieldName][0];
  }

  get payload(): any {
    const values = this.tribalDataForm.value;
    const data: any = { locale: this.settingsService.language.code };

    if (values.mortgageCode) {
      data[this.getColumnName('mortgageCode')] = values.mortgageCode;
    }
    if (values.loanGroup) {
      data[this.getColumnName('loanGroup')] = values.loanGroup;
    }
    data[this.getColumnName('relation')] = !!values.relation;
    if (values.percap != null && values.percap !== '') {
      data[this.getColumnName('percap')] = Number(values.percap);
    }
    if (values.payroll != null && values.payroll !== '') {
      data[this.getColumnName('payroll')] = Number(values.payroll);
    }
    if (values.pension != null && values.pension !== '') {
      data[this.getColumnName('pension')] = Number(values.pension);
    }

    return data;
  }
}
