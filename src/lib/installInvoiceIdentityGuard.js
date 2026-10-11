import { base44, performanceApi } from '@/api/base44Client';
import { dedupeBconnectGateRows, dedupeInvoiceRowsByStableId } from '@/lib/invoiceIdentityGuard';

const INSTALL_FLAG = Symbol.for('dawaa.invoiceIdentityGuard.v1');

if (!base44[INSTALL_FLAG]) {
  const originalEntities = base44.entities;

  base44.entities = new Proxy(originalEntities, {
    get(target, entity) {
      const client = Reflect.get(target, entity);
      if (String(entity) !== 'PurchaseInvoice' || !client) return client;

      return {
        ...client,
        list: async (...args) => dedupeInvoiceRowsByStableId(await client.list(...args)),
        filter: async (...args) => dedupeInvoiceRowsByStableId(await client.filter(...args)),
      };
    },
  });

  const originalBconnectInvoiceNumbers = performanceApi.bconnectInvoiceNumbers.bind(performanceApi);
  performanceApi.bconnectInvoiceNumbers = async (...args) => (
    dedupeBconnectGateRows(await originalBconnectInvoiceNumbers(...args))
  );

  Object.defineProperty(base44, INSTALL_FLAG, { value: true });
}
