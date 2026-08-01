const fs = require('fs');
const path = 'src/lib/purchasePlanning.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing snippet: ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
`const toNumber = (value) => {\n  const parsed = Number(value || 0);\n  return Number.isFinite(parsed) ? parsed : 0;\n};`,
`const toNumber = (value) => {\n  const parsed = Number(value || 0);\n  return Number.isFinite(parsed) ? parsed : 0;\n};\n\nfunction discountPercent(item = {}) {\n  const value = toNumber(item.expected_discount);\n  return value > 0 ? Math.min(100, value) : 20;\n}\n\nfunction netPurchasePrice(item = {}) {\n  const publicPrice = Math.max(0, toNumber(item.expected_unit_cost || item.last_purchase_price));\n  return publicPrice * (1 - (discountPercent(item) / 100));\n}`,
'number helper');

replaceOnce(
`    calculation_method: 'unified_final_coverage_v4',`,
`    expected_discount: toNumber(row.expected_discount) > 0 ? Math.min(100, toNumber(row.expected_discount)) : 20,\n    calculation_method: 'unified_final_coverage_v5_discounted',`,
'default discount');

source = source.replaceAll(
`Math.max(0, toNumber(item.expected_unit_cost || item.last_purchase_price))`,
`netPurchasePrice(item)`
);
source = source.replaceAll(
`distribution_method: 'proportional_restructure_v2'`,
`distribution_method: 'proportional_restructure_discounted_v3'`
);
source = source.replaceAll(
`budget_distribution_method: 'proportional_restructure_v2'`,
`budget_distribution_method: 'proportional_restructure_discounted_v3'`
);

fs.writeFileSync(path, source);
console.log('Discount-aware purchase planning applied.');
