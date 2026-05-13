/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Injectable } from '@angular/core';
import { OptionData } from 'app/shared/models/option-data.model';
import {
  isAccountFeatureEnabled,
  isAnyDepositAccountFeatureEnabled
} from 'app/shared/account-features/account-features.config';

@Injectable({
  providedIn: 'root'
})
export class Charges {
  public getChargeAppliesToOptions(): OptionData[] {
    return this.filterChargeAppliesToOptions([
      { id: 1, code: 'chargeAppliesTo.loan', value: 'Loan' },
      { id: 2, code: 'chargeAppliesTo.savings', value: 'Savings' },
      { id: 3, code: 'chargeAppliesTo.client', value: 'Client' },
      { id: 4, code: 'chargeAppliesTo.shares', value: 'Shares' }
    ]);
  }

  public filterChargeAppliesToOptions(options: OptionData[]): OptionData[] {
    return options.filter((option: OptionData) => {
      if (option.id === 2 || option.code === 'chargeAppliesTo.savings') {
        return isAnyDepositAccountFeatureEnabled();
      }

      if (option.id === 4 || option.code === 'chargeAppliesTo.shares') {
        return isAccountFeatureEnabled('shares');
      }

      return true;
    });
  }

  public isChargeAppliesToVisible(chargeAppliesTo: OptionData): boolean {
    return this.filterChargeAppliesToOptions([chargeAppliesTo]).length > 0;
  }
}
