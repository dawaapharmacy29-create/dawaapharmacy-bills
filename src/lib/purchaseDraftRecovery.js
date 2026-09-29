const text = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const productKey = (row = {}) => {
  const code = text(row.product_code);
  if (code) return `code:${code}`;
  return `name:${text(row.product_name)}`;
};

function canonicalPlanRows(rows = []) {
  return (rows || [])
    .filter((row) => number(row.buy_quantity) > 0)
    .map((row) => ({
      key: productKey(row),
      quantity: number(row.buy_quantity),
      unitCost: number(row.unit_cost),
    }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.quantity - b.quantity || a.unitCost - b.unitCost);
}

function canonicalOrderRows(order = {}) {
  return (order?.items || [])
    .filter((row) => number(row.approved_quantity) > 0)
    .map((row) => ({
      key: productKey(row),
      quantity: number(row.approved_quantity),
      unitCost: number(row.expected_unit_cost),
    }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.quantity - b.quantity || a.unitCost - b.unitCost);
}

export function orderMatchesPurchasePlan(order, planRows = [], { quantityTolerance = 1e-6, costTolerance = 0.01 } = {}) {
  const expected = canonicalPlanRows(planRows);
  const actual = canonicalOrderRows(order);
  if (!expected.length || expected.length !== actual.length) return false;

  return expected.every((row, index) => {
    const other = actual[index];
    return row.key === other.key
      && Math.abs(row.quantity - other.quantity) <= quantityTolerance
      && Math.abs(row.unitCost - other.unitCost) <= costTolerance;
  });
}
