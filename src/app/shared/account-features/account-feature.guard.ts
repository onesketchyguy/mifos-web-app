/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router, UrlTree } from '@angular/router';
import { AccountFeature, isAccountFeatureEnabled } from './account-features.config';

function accountFeatureGuard(feature: AccountFeature): boolean | UrlTree {
  if (isAccountFeatureEnabled(feature)) {
    return true;
  }

  return inject(Router).createUrlTree(['/home']);
}

export const savingsAccountFeatureCanActivateGuard: CanActivateFn = () => accountFeatureGuard('savings');
export const fixedDepositAccountFeatureCanActivateGuard: CanActivateFn = () => accountFeatureGuard('fixedDeposits');
export const recurringDepositAccountFeatureCanActivateGuard: CanActivateFn = () =>
  accountFeatureGuard('recurringDeposits');
export const sharesAccountFeatureCanActivateGuard: CanActivateFn = () => accountFeatureGuard('shares');

export const savingsAccountFeatureCanMatchGuard: CanMatchFn = () => accountFeatureGuard('savings');
export const fixedDepositAccountFeatureCanMatchGuard: CanMatchFn = () => accountFeatureGuard('fixedDeposits');
export const recurringDepositAccountFeatureCanMatchGuard: CanMatchFn = () => accountFeatureGuard('recurringDeposits');
export const sharesAccountFeatureCanMatchGuard: CanMatchFn = () => accountFeatureGuard('shares');
