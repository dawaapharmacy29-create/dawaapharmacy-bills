import fs from 'node:fs';

function replaceOnce(file, find, replacement) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(replacement)) return;
  if (!content.includes(find)) throw new Error(`Pattern not found in ${file}`);
  fs.writeFileSync(file, content.replace(find, replacement));
}

replaceOnce(
  'src/App.jsx',
  "const DailyTasksCenter = lazy(() => import('./pages/DailyTasksCenter'));",
  "const DailyTasksCenter = lazy(() => import('./pages/DailyTasksCenter'));\nconst UnifiedInvoiceCenter = lazy(() => import('./pages/UnifiedInvoiceCenter'));"
);
replaceOnce(
  'src/App.jsx',
  '    <Route path="/invoices/new" element={<QuickInvoiceEntry />} />',
  '    <Route path="/invoice-center" element={<UnifiedInvoiceCenter />} />\n    <Route path="/invoices/new" element={<QuickInvoiceEntry />} />'
);
replaceOnce(
  'src/components/layout/AppLayout.jsx',
  '      { label: "الفواتير", items: [',
  '      { label: "الفواتير", items: [\n        { path: "/invoice-center", label: "مركز الفواتير الموحد", icon: Layers3 },'
);
replaceOnce(
  'src/components/layout/AppLayout.jsx',
  '  { path: "/invoices/new", label: "فاتورة جديدة", icon: FilePlus2 },',
  '  { path: "/invoice-center", label: "مركز الفواتير", icon: Layers3 },\n  { path: "/invoices/new", label: "فاتورة جديدة", icon: FilePlus2 },'
);

console.log('Unified invoice center integrated.');
