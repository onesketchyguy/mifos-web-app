/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CdkDragDrop, moveItemInArray, CdkDropList, CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { Subject, merge } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

/** Custom Services */
import { SettingsService } from './settings.service';
import { AlertService } from 'app/core/alert/alert.service';
import { TranslateService } from '@ngx-translate/core';
import {
  MatAccordion,
  MatExpansionPanel,
  MatExpansionPanelHeader,
  MatExpansionPanelTitle
} from '@angular/material/expansion';
import { FileUploadComponent } from '../shared/file-upload/file-upload.component';
import { ThemePickerComponent } from '../shared/theme-picker/theme-picker.component';
import { LanguageSelectorComponent } from '../shared/language-selector/language-selector.component';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { STANDALONE_SHARED_IMPORTS } from 'app/standalone-shared.module';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { MainNavItem, mainNavItems, defaultMainNavItemIds } from 'app/core/shell/sidenav/main-nav-items';

/**
 * Settings component.
 */
@Component({
  selector: 'mifosx-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  imports: [
    ...STANDALONE_SHARED_IMPORTS,
    MatAccordion,
    MatExpansionPanel,
    MatExpansionPanelHeader,
    MatExpansionPanelTitle,
    FileUploadComponent,
    ThemePickerComponent,
    LanguageSelectorComponent,
    MatSlideToggleModule,
    MatIconButton,
    MatTooltip,
    FaIconComponent,
    CdkDropList,
    CdkDrag,
    CdkDragHandle
  ]
})
export class SettingsComponent implements OnInit, OnDestroy {
  private settingsService = inject(SettingsService);
  private alertService = inject(AlertService);
  private translateService = inject(TranslateService);
  private destroy$ = new Subject<void>();

  hasChanges = false;

  /** Date formats. */
  dateFormats: string[] = [
    'dd MMMM yyyy',
    'dd/MM/yyyy',
    'dd/MMMM/yyyy',
    'dd-MM-yyyy',
    'dd-MMMM-yyyy',
    'dd-MM-yy',
    'MM/dd/yyyy',
    'MMMM-dd-yyyy',
    'MMMM dd yyyy',
    'MMMM/dd/yyyy',
    'MM-dd-yy',
    'yyyy-MM-dd'
  ];
  datetimeFormats: string[] = [
    // All date formats with HH:mm:ss (seconds)
    'dd MMMM yyyy HH:mm:ss',
    'dd/MMMM/yyyy HH:mm:ss',
    'dd-MMMM-yyyy HH:mm:ss',
    'dd-MM-yy HH:mm:ss',
    'MMMM-dd-yyyy HH:mm:ss',
    'MMMM dd yyyy HH:mm:ss',
    'MMMM/dd/yyyy HH:mm:ss',
    'MM-dd-yy HH:mm:ss',
    'yyyy-MM-dd HH:mm:ss',
    // All date formats with HH:mm (no seconds)
    'dd MMMM yyyy HH:mm',
    'dd/MMMM/yyyy HH:mm',
    'dd-MMMM-yyyy HH:mm',
    'dd-MM-yy HH:mm',
    'MMMM-dd-yyyy HH:mm',
    'MMMM dd yyyy HH:mm',
    'MMMM/dd/yyyy HH:mm',
    'MM-dd-yy HH:mm',
    'yyyy-MM-dd HH:mm'
  ];
  /** Decimals. */
  decimals: string[] = [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8'
  ];
  /** Placeholder for fonts. */
  fonts: any;

  /** Date Format Setting */
  dateFormat = new FormControl('');
  /** Datetime Format Setting */
  datetimeFormat = new FormControl('');
  /** Decimals to Display Setting */
  decimalsToDisplay = new FormControl('');
  /** Show Configuration Wizard toggle */
  showConfigWizard = new FormControl(true);
  /** Customize Main Items toggle */
  customizeMainItems = new FormControl(false);
  /** Control for the Add Menu Item select */
  addMenuItemControl = new FormControl<MainNavItem | null>(null);
  /** Ordered Main Items the user has selected for the sidebar */
  selectedMainItems: MainNavItem[] = [];

  private initialValues: {
    dateFormat: string;
    datetimeFormat: string;
    decimals: string;
    showConfigWizard: boolean;
    sidebarMainItems: string[] | null;
  };

  ngOnInit() {
    this.initialValues = {
      dateFormat: this.settingsService.dateFormat,
      datetimeFormat: this.settingsService.datetimeFormat,
      decimals: this.settingsService.decimals,
      showConfigWizard: this.settingsService.showConfigWizard,
      sidebarMainItems: this.settingsService.sidebarMainItems
    };
    this.dateFormat.patchValue(this.initialValues.dateFormat, { emitEvent: false });
    this.datetimeFormat.patchValue(this.initialValues.datetimeFormat, { emitEvent: false });
    this.decimalsToDisplay.patchValue(this.initialValues.decimals, { emitEvent: false });
    this.showConfigWizard.patchValue(this.initialValues.showConfigWizard, { emitEvent: false });
    this.customizeMainItems.patchValue(this.initialValues.sidebarMainItems !== null, { emitEvent: false });
    this.selectedMainItems = (this.initialValues.sidebarMainItems ?? defaultMainNavItemIds)
      .map((id: string) => mainNavItems.find((item) => item.id === id))
      .filter((item): item is MainNavItem => !!item);
    this.trackChanges();
  }

  trackChanges(): void {
    merge(
      this.dateFormat.valueChanges,
      this.datetimeFormat.valueChanges,
      this.decimalsToDisplay.valueChanges,
      this.showConfigWizard.valueChanges,
      this.customizeMainItems.valueChanges
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.hasChanges = this.hasFormChanged();
      });
  }

  private hasFormChanged(): boolean {
    return (
      (this.dateFormat.value ?? '') !== this.initialValues.dateFormat ||
      (this.datetimeFormat.value ?? '') !== this.initialValues.datetimeFormat ||
      (this.decimalsToDisplay.value ?? '') !== this.initialValues.decimals ||
      (this.showConfigWizard.value ?? true) !== this.initialValues.showConfigWizard ||
      JSON.stringify(this.currentMainItemIds()) !== JSON.stringify(this.initialValues.sidebarMainItems)
    );
  }

  /** Menu items not yet selected, offered in the Add Menu Item select. */
  get availableMainItems(): MainNavItem[] {
    return mainNavItems.filter((option) => !this.selectedMainItems.some((item) => item.id === option.id));
  }

  addMenuItem(item: MainNavItem | null): void {
    if (!item) {
      return;
    }
    this.selectedMainItems.push(item);
    this.addMenuItemControl.reset(null, { emitEvent: false });
    this.hasChanges = this.hasFormChanged();
  }

  removeMenuItem(index: number): void {
    this.selectedMainItems.splice(index, 1);
    this.hasChanges = this.hasFormChanged();
  }

  dropMenuItem(event: CdkDragDrop<MainNavItem[]>): void {
    moveItemInArray(this.selectedMainItems, event.previousIndex, event.currentIndex);
    this.hasChanges = this.hasFormChanged();
  }

  private currentMainItemIds(): string[] | null {
    return this.customizeMainItems.value ? this.selectedMainItems.map((item) => item.id) : null;
  }

  submit(): void {
    this.settingsService.setDateFormat(this.dateFormat.value ?? this.initialValues.dateFormat);
    this.settingsService.setDatetimeFormat(this.datetimeFormat.value ?? this.initialValues.datetimeFormat);
    this.settingsService.setDecimalToDisplay(this.decimalsToDisplay.value ?? this.initialValues.decimals);
    this.settingsService.setShowConfigWizard(this.showConfigWizard.value ?? this.initialValues.showConfigWizard);
    this.settingsService.setSidebarMainItems(this.currentMainItemIds());
    this.initialValues = {
      dateFormat: this.dateFormat.value ?? '',
      datetimeFormat: this.datetimeFormat.value ?? '',
      decimals: this.decimalsToDisplay.value ?? '',
      showConfigWizard: this.showConfigWizard.value ?? true,
      sidebarMainItems: this.currentMainItemIds()
    };
    this.hasChanges = false;
    this.alertService.alert({
      type: 'Settings Update',
      message: this.translateService.instant('labels.text.Settings saved successfully')
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
