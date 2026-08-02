import fs from 'node:fs';

const appPath = 'src/App.jsx';
let app = fs.readFileSync(appPath, 'utf8');

if (!app.includes("const QualityReviewCenter = lazy(() => import('./pages/QualityReviewCenter'));")) {
  app = app.replace(
    "const InvoiceQualityCenter = lazy(() => import('./pages/InvoiceQualityCenter'));",
    "const InvoiceQualityCenter = lazy(() => import('./pages/InvoiceQualityCenter'));\nconst QualityReviewCenter = lazy(() => import('./pages/QualityReviewCenter'));"
  );
}

if (!app.includes('path="/quality-center"')) {
  app = app.replace(
    '<Route path="/invoices/quality" element={<InvoiceQualityCenter />} />',
    '<Route path="/invoices/quality" element={<InvoiceQualityCenter />} />\n    <Route path="/quality-center" element={<QualityReviewCenter />} />'
  );
}

fs.writeFileSync(appPath, app);

const layoutPath = 'src/components/layout/AppLayout.jsx';
let layout = fs.readFileSync(layoutPath, 'utf8');

if (!layout.includes('path: "/quality-center"')) {
  layout = layout.replace(
    '{ label: "متابعة الجودة", items: [',
    '{ label: "متابعة الجودة", items: [\n        { path: "/quality-center", label: "مركز المراجعة والجودة", icon: ClipboardList },'
  );
}

fs.writeFileSync(layoutPath, layout);
