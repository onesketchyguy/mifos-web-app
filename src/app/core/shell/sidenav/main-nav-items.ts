/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export interface MainNavItem {
  /** Stable identifier, persisted in the user's sidebar configuration. */
  id: string;
  /** Full translation key for the menu label. */
  label: string;
  /** Full translation key for the tooltip. */
  tooltip: string;
  /** Registered FontAwesome icon name. */
  icon: string;
  /** Route to navigate to. Omitted for action items. */
  path?: string;
  /** Component action instead of navigation. */
  action?: 'keyboardShortcuts' | 'help';
  /** Permission(s) required to see the item. */
  permission?: string | string[];
  /** Only shown when the remittance feature is enabled. */
  requiresRemittance?: boolean;
  /** Only shown when the CB ILD feature is enabled. */
  requiresCbIld?: boolean;
}

/**
 * Catalog of every item that can appear in the sidebar's Main Items
 * section. Users pick and order these via Settings > Main Items.
 */
export const mainNavItems: MainNavItem[] = [
  {
    id: 'dashboard',
    label: 'labels.menus.Dashboard',
    tooltip: 'tooltips.Dashboard',
    icon: 'tachometer-alt',
    path: '/dashboard'
  },
  {
    id: 'reporting-dashboard',
    label: 'labels.menus.Reporting Dashboard',
    tooltip: 'tooltips.Reporting Dashboard',
    icon: 'file-alt',
    path: '/reporting-dashboard',
    requiresCbIld: true
  },
  {
    id: 'navigation',
    label: 'labels.menus.Navigation',
    tooltip: 'tooltips.Navigation',
    icon: 'location-arrow',
    path: '/navigation',
    permission: 'READ_CLIENT'
  },
  {
    id: 'checker-inbox',
    label: 'labels.menus.Checker Inbox and Tasks',
    tooltip: 'tooltips.Checker Inbox and Tasks',
    icon: 'check',
    path: '/checker-inbox-and-tasks/checker-inbox',
    permission: [
      'READ_MAKERCHECKER',
      'APPROVE_LOAN'
    ]
  },
  {
    id: 'collection-sheet',
    label: 'labels.menus.Collection Sheet',
    tooltip: 'labels.menus.Collection Sheet',
    icon: 'tasks',
    path: '/collections/collection-sheet',
    permission: 'READ_COLLECTIONSHEET'
  },
  {
    id: 'individual-collection-sheet',
    label: 'labels.menus.Individual Collection Sheet',
    tooltip: 'tooltips.Individual Collection Sheet',
    icon: 'tasks',
    path: '/collections/individual-collection-sheet',
    permission: 'READ_COLLECTIONSHEET'
  },
  {
    id: 'remittances',
    label: 'labels.menus.Remittances',
    tooltip: 'tooltips.Process Remittance',
    icon: 'money-bill-wave',
    path: '/remittances/process',
    requiresRemittance: true
  },
  {
    id: 'notifications',
    label: 'labels.menus.Notifications',
    tooltip: 'tooltips.Notifications',
    icon: 'bell',
    path: '/notifications',
    permission: 'READ_NOTIFICATION'
  },
  {
    id: 'frequent-postings',
    label: 'labels.menus.Frequent Postings',
    tooltip: 'tooltips.Frequent Postings',
    icon: 'sync',
    path: '/accounting/journal-entries/frequent-postings',
    permission: 'CREATE_JOURNALENTRY'
  },
  {
    id: 'create-journal-entry',
    label: 'labels.menus.Create Journal Entry',
    tooltip: 'tooltips.Create Journal Entry',
    icon: 'plus',
    path: '/accounting/journal-entries/create',
    permission: 'CREATE_JOURNALENTRY'
  },
  {
    id: 'chart-of-accounts',
    label: 'labels.menus.Chart of Accounts',
    tooltip: 'tooltips.Chart Of Accounts',
    icon: 'sitemap',
    path: '/accounting/chart-of-accounts',
    permission: 'READ_GLACCOUNT'
  },
  {
    id: 'keyboard-shortcuts',
    label: 'labels.menus.Keyboard Shortcuts',
    tooltip: 'tooltips.Keyboard Shortcuts',
    icon: 'keyboard',
    action: 'keyboardShortcuts'
  },
  {
    id: 'help',
    label: 'labels.menus.Help',
    tooltip: 'tooltips.Help',
    icon: 'question-circle',
    action: 'help'
  },
  {
    id: 'loans',
    label: 'labels.menus.Loans',
    tooltip: 'labels.menus.Loans',
    icon: 'hand-holding-usd',
    path: '/loans',
    permission: 'READ_LOAN'
  },
  {
    id: 'clients',
    label: 'labels.menus.Clients',
    tooltip: 'labels.menus.Clients',
    icon: 'user',
    path: '/clients',
    permission: 'READ_CLIENT'
  },
  {
    id: 'groups',
    label: 'labels.menus.Groups',
    tooltip: 'labels.menus.Groups',
    icon: 'users',
    path: '/groups',
    permission: 'READ_GROUP'
  },
  {
    id: 'centers',
    label: 'labels.menus.Centers',
    tooltip: 'labels.menus.Centers',
    icon: 'building',
    path: '/centers',
    permission: 'READ_CENTER'
  },
  {
    id: 'accounting',
    label: 'labels.menus.Accounting',
    tooltip: 'labels.menus.Accounting',
    icon: 'money-bill-alt',
    path: '/accounting'
  },
  {
    id: 'reports',
    label: 'labels.menus.Reports',
    tooltip: 'labels.menus.Reports',
    icon: 'chart-bar',
    path: '/reports'
  },
  {
    id: 'organization',
    label: 'labels.menus.Organization',
    tooltip: 'labels.menus.Organization',
    icon: 'id-badge',
    path: '/organization'
  },
  {
    id: 'system',
    label: 'labels.menus.System',
    tooltip: 'labels.menus.System',
    icon: 'cog',
    path: '/system'
  },
  {
    id: 'products',
    label: 'labels.menus.Products',
    tooltip: 'labels.menus.Products',
    icon: 'book',
    path: '/products'
  },
  {
    id: 'templates',
    label: 'labels.menus.Templates',
    tooltip: 'labels.menus.Templates',
    icon: 'address-card',
    path: '/templates'
  }
];

/** Default Main Items selection — mirrors the original hardcoded sidebar. */
export const defaultMainNavItemIds: string[] = [
  'dashboard',
  'reporting-dashboard',
  'navigation',
  'checker-inbox',
  'collection-sheet',
  'individual-collection-sheet',
  'remittances',
  'notifications',
  'frequent-postings',
  'create-journal-entry',
  'chart-of-accounts',
  'keyboard-shortcuts',
  'help'
];
