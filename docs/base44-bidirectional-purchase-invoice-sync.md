# مزامنة فواتير Base44 وSupabase ثنائية الاتجاه

تم تجهيز Supabase ليستقبل Webhook Base44 الحالي، ويعيد تغييرات Vercel إلى Base44 من خلال Outbox آمنة.

## 1. سحب تغييرات Vercel من داخل Backend Function في Base44

يجب تشغيل هذا المنطق من Server Function أو Automation داخل Base44 فقط. لا تضع سر المزامنة في كود الواجهة.

```js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const BASE44_SYNC_SECRET = process.env.BASE44_SYNC_SECRET;

async function rpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result?.ok === false) throw new Error(result?.error || result?.message || `HTTP ${response.status}`);
  return result.data;
}

export async function syncInvoiceChangesToBase44(base44) {
  const events = await rpc('base44_pull_outbox', {
    p_secret: BASE44_SYNC_SECRET,
    p_limit: 100,
  });

  const results = [];
  for (const event of events || []) {
    try {
      if (event.entity_name !== 'PurchaseInvoice') throw new Error('unsupported_entity');
      if (event.operation === 'delete') {
        // الحذف لا ينفذ تلقائيًا؛ يراجع يدويًا.
        throw new Error('delete_requires_review');
      }
      await base44.entities.PurchaseInvoice.update(event.record_id, event.payload);
      results.push({ id: event.id, ok: true });
    } catch (error) {
      results.push({ id: event.id, ok: false, error: error?.message || String(error) });
    }
  }

  if (results.length) {
    await rpc('base44_ack_outbox', {
      p_secret: BASE44_SYNC_SECRET,
      p_results: results,
    });
  }
  return { processed: results.length, results };
}
```

شغّل الوظيفة كل دقيقة أو بعد كل عملية مراجعة. أعلى تكرار مطلوب هنا دقيقة واحدة داخل Base44، بينما Supabase يعيد المحاولة تلقائيًا للعمليات الفاشلة.

## 2. Snapshot كامل دوري

شغّل Snapshot كامل مرة كل ساعة، أو مرة يوميًا كحد أدنى، لإصلاح أي Webhook ضاع.

```js
export async function sendFullPurchaseInvoiceSnapshot(base44) {
  const snapshotId = crypto.randomUUID();
  const pageSize = 250;
  let offset = 0;
  let batchNumber = 1;

  while (true) {
    const rows = await base44.entities.PurchaseInvoice.list('-updated_date', pageSize, offset);
    const isLast = !rows || rows.length < pageSize;

    await rpc('base44_submit_purchase_invoice_snapshot_batch', {
      p_secret: BASE44_SYNC_SECRET,
      p_snapshot_id: snapshotId,
      p_batch_number: batchNumber,
      p_is_last: isLast,
      p_records: rows || [],
    });

    if (isLast) break;
    offset += pageSize;
    batchNumber += 1;
  }

  return { snapshotId, batches: batchNumber };
}
```

## 3. قواعد منع التكرار والتعارض

- كل حدث له `payload_hash` ويُسجل مرة واحدة.
- إعادة المحاولة تتم تدريجيًا حتى 10 مرات.
- الحذف لا يُنفذ تلقائيًا.
- أي فاتورة تختفي من Snapshot الكامل تدخل قائمة تعارضات للمراجعة.
- تغييرات Vercel التي تُعاد إلى Base44 وترجع عبر Webhook لا تُنشئ حلقة لا نهائية طالما القيم لم تتغير.

## 4. الحالات الموحدة

| Vercel / Supabase | Base44 |
|---|---|
| draft | مسودة |
| submitted | انتظار المراجعة |
| reviewed | تمت المراجعة |
| returned | مرتجعة للتصحيح |
| approved | يتم الحفظ |

## 5. الداشبورد

لضمان تطابق العدد والقيمة 100%، يجب أن يعتمد تطبيق Base44 على نفس القواعد:

- الفترة من `invoice_date` وليس `created_date`.
- طرح `returned_value`.
- استبعاد `transaction_type = internal_transfer`.
- تطبيق `net_purchase_mode` وقواعد الموردين المستبعدين.
- استخدام الحالة الموحدة أعلاه.

أفضل ضمان نهائي هو عرض مؤشرات Base44 من RPC `unified_purchase_invoice_metrics` بدل إعادة حسابها داخل Base44 بقواعد مختلفة.
