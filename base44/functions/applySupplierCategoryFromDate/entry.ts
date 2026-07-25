import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const START_DATE = "2026-07-15";
const BATCH_SIZE = 500;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (user.role !== 'admin' && user.role !== 'manager') {
      return Response.json({ error: 'Forbidden: requires admin or manager role' }, { status: 403 });
    }

    const body = await req.json();
    const {
      supplier_id,
      category,
      start_date = START_DATE,
      manual_invoice_policy = "skip_manual",
      confirmed = false
    } = body;

    if (!supplier_id) return Response.json({ error: 'supplier_id is required' }, { status: 400 });
    if (!['medicines', 'supplies_accessories'].includes(category)) {
      return Response.json({ error: 'Invalid category. Must be medicines or supplies_accessories' }, { status: 400 });
    }
    if (!['skip_manual', 'override_all'].includes(manual_invoice_policy)) {
      return Response.json({ error: 'Invalid manual_invoice_policy' }, { status: 400 });
    }

    // Enforce minimum start_date
    const effectiveStartDate = start_date < START_DATE ? START_DATE : start_date;

    // Verify supplier
    const supplier = await base44.asServiceRole.entities.Supplier.get(supplier_id);
    if (!supplier) return Response.json({ error: 'Supplier not found' }, { status: 404 });
    if (supplier.default_purchase_category !== category) {
      return Response.json({
        error: `Supplier category mismatch. Supplier is "${supplier.default_purchase_category}" but requested "${category}"`
      }, { status: 400 });
    }

    // Fetch all invoices for this supplier (paginate)
    let allInvoices = [];
    let page = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.PurchaseInvoice.filter(
        { supplier_id: supplier_id },
        "-invoice_date",
        BATCH_SIZE,
        page * BATCH_SIZE
      );
      allInvoices = [...allInvoices, ...batch];
      if (batch.length < BATCH_SIZE) break;
      page++;
    }

    // Filter by date: invoice_date >= start_date
    const eligible = allInvoices.filter(inv => {
      const d = inv.invoice_date || '';
      return d >= effectiveStartDate;
    });

    // Calculate stats
    const totalValue = eligible.reduce((s, i) => s + (i.total_value || 0), 0);
    const medicinesCount = eligible.filter(i => (i.purchase_category || 'unclassified') === 'medicines').length;
    const suppliesCount = eligible.filter(i => i.purchase_category === 'supplies_accessories').length;
    const unclassifiedCount = eligible.filter(i => !i.purchase_category || i.purchase_category === 'unclassified').length;
    const manualCount = eligible.filter(i => i.purchase_category_source === 'manual').length;

    // Determine which invoices will change
    const toChange = eligible.filter(inv => {
      if (inv.purchase_category_source === 'manual' && manual_invoice_policy === 'skip_manual') return false;
      return (inv.purchase_category || 'unclassified') !== category;
    });

    const willChangeCount = toChange.length;
    const willChangeValue = toChange.reduce((s, i) => s + (i.total_value || 0), 0);

    // Manual preserved (manual invoices that won't change because policy = skip_manual)
    const manualPreserved = eligible.filter(inv =>
      inv.purchase_category_source === 'manual' &&
      manual_invoice_policy === 'skip_manual' &&
      (inv.purchase_category || 'unclassified') !== category
    ).length;

    // Manual that will be overridden
    const manualOverridden = eligible.filter(inv =>
      inv.purchase_category_source === 'manual' &&
      manual_invoice_policy === 'override_all' &&
      (inv.purchase_category || 'unclassified') !== category
    ).length;

    // Branch distribution of toChange
    const branchDist = {};
    toChange.forEach(inv => {
      const b = inv.branch || 'غير محدد';
      branchDist[b] = (branchDist[b] || 0) + 1;
    });

    // Date range
    const dates = toChange.map(i => i.invoice_date).filter(Boolean).sort();
    const oldestDate = dates[0] || null;
    const newestDate = dates[dates.length - 1] || null;

    const preview = {
      supplier_name: supplier.name,
      supplier_category: supplier.default_purchase_category,
      target_category: category,
      start_date: effectiveStartDate,
      total_invoices: eligible.length,
      total_value: totalValue,
      medicines_count: medicinesCount,
      supplies_count: suppliesCount,
      unclassified_count: unclassifiedCount,
      manual_count: manualCount,
      will_change_count: willChangeCount,
      will_change_value: willChangeValue,
      branch_distribution: branchDist,
      oldest_invoice_date: oldestDate,
      newest_invoice_date: newestDate,
      manual_preserved_count: manualPreserved,
      manual_overridden_count: manualOverridden,
      manual_policy: manual_invoice_policy,
    };

    if (!confirmed) {
      return Response.json({ preview, applied: false });
    }

    // === APPLY ===
    const batchId = `backfill-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    let updatedCount = 0;
    const updateIds = toChange.map(i => i.id);

    for (let start = 0; start < updateIds.length; start += BATCH_SIZE) {
      const batchIds = updateIds.slice(start, start + BATCH_SIZE);
      const updates = batchIds.map(id => ({
        id,
        purchase_category: category,
        purchase_category_source: 'supplier_backfill',
      }));
      await base44.asServiceRole.entities.PurchaseInvoice.bulkUpdate(updates);
      updatedCount += batchIds.length;
    }

    // Log activity
    const categoryLabel = category === 'medicines' ? 'أدوية' : 'مستلزمات وإكسسوار';
    try {
      await base44.asServiceRole.entities.ActivityLog.create({
        action_type: 'bulk_update',
        entity_type: 'supplier',
        entity_id: supplier_id,
        entity_label: supplier.name,
        user_email: user.email || '',
        user_name: user.full_name || '',
        details: `تطبيق رجعي لتصنيف "${categoryLabel}" على ${updatedCount} فاتورة من ${effectiveStartDate} | قيمة: ${willChangeValue} | فواتير يدوية محفوظة: ${manualPreserved} | فواتير يدوية مستبدلة: ${manualOverridden} | Batch: ${batchId}`,
      });
    } catch (e) {
      // silent fail for logging
    }

    return Response.json({
      applied: true,
      batch_id: batchId,
      updated_count: updatedCount,
      total_value: willChangeValue,
      manual_preserved: manualPreserved,
      manual_overridden: manualOverridden,
      supplier_name: supplier.name,
      category,
      category_label: categoryLabel,
      start_date: effectiveStartDate,
      performed_by: user.full_name || user.email,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});