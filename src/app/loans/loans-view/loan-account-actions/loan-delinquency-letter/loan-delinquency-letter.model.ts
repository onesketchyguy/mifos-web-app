/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export type DelinquencyLetterType = 'collections' | 'oneTwentyDay' | 'maturity' | 'final';

export interface DelinquencyLetterData {
  letterType: DelinquencyLetterType;
  letterDate: Date | null;
  recipientName: string;
  greetingName: string;
  mailingAddress: string;
  loanNumber: string;
  loanFileNumber: string;
  pastDueAmount: number;
  principalBalance: number;
  payoffAmount: number;
  maturityDate: Date | null;
  deadlineDate: Date | null;
  officerName: string;
  officerTitle: string;
  phoneNumber: string;
  includeLifeInsuranceNotice: boolean;
  currencyCode: string;
}

export interface DelinquencyLetterParagraph {
  text: string;
  alignment?: 'left' | 'center';
  bold?: boolean;
  highlight?: boolean;
  spacingAfter?: number;
}
