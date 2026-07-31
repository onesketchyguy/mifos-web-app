/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Injectable, inject } from '@angular/core';

/** rxjs Imports */
import { Observable } from 'rxjs';

/** Custom Services */
import { ClientsService } from '../clients.service';
import { DatatableVisibilityService } from 'app/system/manage-data-tables/datatable-visibility.service';

/**
 * Client datatables resolver.
 */
@Injectable()
export class ClientDatatablesResolver {
  private clientsService = inject(ClientsService);
  private datatableVisibility = inject(DatatableVisibilityService);

  /**
   * Returns the Client datatables filtered to the ones marked as a user view.
   * @returns {Observable<any>}
   */
  resolve(): Observable<any> {
    return this.datatableVisibility.filterUserVisible(this.clientsService.getClientDatatables());
  }
}
