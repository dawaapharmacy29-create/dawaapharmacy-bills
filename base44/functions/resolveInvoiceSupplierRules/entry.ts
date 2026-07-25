import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const BRANCH_SHUKRI = "دواء شكري";
const BRANCH_SHAMI = "دواء الشامي";
const VALID_BRANCHES = [BRANCH_SHUKRI, BRANCH_SHAMI];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      supplier_id,
      branch,
      current_purchase_category,
      purchase_category_source,
      current_transaction_type,
      invoice_date,
      preserve_manual_override = true,
    } = body;

    if (!supplier_id) return Response.json({ error: 'supplier_id is required' }, { status: 400 });
    if (!branch) return Response.json({ error: 'branch is required' }, { status: 400 });

    // Fetch supplier
    const supplier = await base44.asServiceRole.entities.Supplier.get(supplier_id);
    if (!supplier) {
      return Response.json({
        requires_review: true,
        review_reason: 'invalid_supplier_id',
        warning_message: 'معرف المورد غير صالح أو غير موجود',
        resolved_purchase_category: current_purchase_category || 'unclassified',
        resolved_purchase_category_source: purchase_category_source || 'manual',
        resolved_transaction_type: current_transaction_type || 'external_purchase',
        source_branch: '',
        destination_branch: '',
        requires_manual_category: false,
      });
    }

    // =====================================================
    // STEP 1: Preserve manual override (highest priority)
    // =====================================================
    const isManualOverride = purchase_category_source === 'manual';
    const shouldPreserveManual = isManualOverride && preserve_manual_override;

    // =====================================================
    // STEP 2: Resolve transaction_type (internal transfer detection)
    // =====================================================
    let resolved_transaction_type = 'external_purchase';
    let source_branch = '';
    let destination_branch = '';
    let transaction_review = false;
    let transaction_review_reason = '';

    if (supplier.supplier_type === 'internal_branch') {
      const linkedBranch = supplier.linked_branch || '';

      if (!linkedBranch) {
        // Internal branch supplier without linked_branch
        transaction_review = true;
        transaction_review_reason = 'internal_supplier_without_linked_branch';
        resolved_transaction_type = current_transaction_type || 'external_purchase';
      } else if (linkedBranch === branch) {
        // Source and destination are the same branch — NOT an internal transfer
        transaction_review = true;
        transaction_review_reason = 'source_equals_destination';
        resolved_transaction_type = 'external_purchase';
        source_branch = '';
        destination_branch = '';
      } else {
        // Valid internal transfer: source = linked_branch, destination = invoice branch
        resolved_transaction_type = 'internal_transfer';
        source_branch = linkedBranch;
        destination_branch = branch;
      }
    } else {
      // External supplier
      resolved_transaction_type = 'external_purchase';
    }

    // =====================================================
    // STEP 3: Resolve purchase_category (supplier default)
    // =====================================================
    let resolved_purchase_category = current_purchase_category || 'unclassified';
    let resolved_purchase_category_source = purchase_category_source || 'manual';
    let requires_manual_category = false;

    if (shouldPreserveManual) {
      // Keep manual override — do not change
      // resolved_purchase_category stays as current
    } else {
      const supplierCat = supplier.default_purchase_category || 'none';

      if (supplierCat === 'medicines') {
        resolved_purchase_category = 'medicines';
        resolved_purchase_category_source = 'supplier_default';
      } else if (supplierCat === 'supplies_accessories') {
        resolved_purchase_category = 'supplies_accessories';
        resolved_purchase_category_source = 'supplier_default';
      } else if (supplierCat === 'mixed') {
        // Mixed supplier — require manual selection
        requires_manual_category = true;
        // Don't force a category; keep current or unclassified
        if (!current_purchase_category || current_purchase_category === 'unclassified') {
          resolved_purchase_category = 'unclassified';
          resolved_purchase_category_source = 'manual';
        } else {
          // User already selected — keep it
          resolved_purchase_category = current_purchase_category;
          resolved_purchase_category_source = purchase_category_source || 'manual';
        }
      } else {
        // 'none' — leave unclassified
        resolved_purchase_category = 'unclassified';
        resolved_purchase_category_source = purchase_category_source || 'manual';
      }
    }

    // =====================================================
    // STEP 4: Build warning messages
    // =====================================================
    let warning_message = '';
    let requires_review = false;
    let review_reason = '';

    if (transaction_review) {
      requires_review = true;
      review_reason = transaction_review_reason;
      if (transaction_review_reason === 'source_equals_destination') {
        warning_message = 'تحتاج مراجعة — المصدر والمستلم نفس الفرع';
      } else if (transaction_review_reason === 'internal_supplier_without_linked_branch') {
        warning_message = 'تحتاج مراجعة — مورد داخلي بدون فرع مرتبط';
      }
    }

    if (requires_manual_category) {
      warning_message = warning_message
        ? warning_message + ' | المورد مختلط — يجب اختيار تصنيف الفاتورة يدويًا'
        : 'المورد مختلط — يجب اختيار تصنيف الفاتورة يدويًا (أدوية أو مستلزمات وإكسسوار)';
    }

    // =====================================================
    // STEP 5: Build info message for auto-detected internal transfer
    // =====================================================
    let auto_transfer_message = '';
    if (resolved_transaction_type === 'internal_transfer' && source_branch && destination_branch) {
      auto_transfer_message = `تم تحديد العملية تلقائيًا كتحويل داخلي من ${source_branch} إلى ${destination_branch}`;
    }

    return Response.json({
      supplier_id: supplier_id,
      supplier_name: supplier.name,
      supplier_type: supplier.supplier_type,
      supplier_linked_branch: supplier.linked_branch || '',
      supplier_default_category: supplier.default_purchase_category || 'none',
      supplier_default_payment: supplier.default_payment_method || 'none',

      resolved_purchase_category,
      resolved_purchase_category_source,
      resolved_transaction_type,
      source_branch,
      destination_branch,

      requires_manual_category,
      requires_review,
      review_reason,
      warning_message,
      auto_transfer_message,

      manual_override_preserved: shouldPreserveManual,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});