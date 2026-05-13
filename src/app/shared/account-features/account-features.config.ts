/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { environment } from 'environments/environment';

export type AccountFeature = 'savings' | 'fixedDeposits' | 'recurringDeposits' | 'shares' | 'checking';

export const accountFeatures: Record<AccountFeature, boolean> = {
  savings: environment.accountFeatures?.savings === true,
  fixedDeposits: environment.accountFeatures?.fixedDeposits === true,
  recurringDeposits: environment.accountFeatures?.recurringDeposits === true,
  shares: environment.accountFeatures?.shares === true,
  checking: environment.accountFeatures?.checking === true
};

export function isAccountFeatureEnabled(feature: AccountFeature): boolean {
  return accountFeatures[feature];
}

export function isAnyDepositAccountFeatureEnabled(): boolean {
  return (
    accountFeatures.savings ||
    accountFeatures.fixedDeposits ||
    accountFeatures.recurringDeposits ||
    accountFeatures.checking
  );
}

export function isAnyNonLoanAccountFeatureEnabled(): boolean {
  return Object.values(accountFeatures).some(Boolean);
}
