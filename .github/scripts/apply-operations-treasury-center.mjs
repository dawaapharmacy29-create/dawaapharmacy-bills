import fs from 'node:fs';

const appPath = 'src/App.jsx';
const layoutPath = 'src/components/layout/AppLayout.jsx';
let app = fs.readFileSync(appPath, 'utf8');
let layout = fs.readFileSync(layoutPath, 'utf8');

if (!app.includes("const OperationsTreasuryCenter = lazy(() => import('./pages/OperationsTreasuryCenter'));")) {
  app = app.replace(
    "const TreasuryCenter = lazy(() => import('./pages/TreasuryCenter'));",
    "const TreasuryCenter = lazy(() => import('./pages/TreasuryCenter'));\nconst OperationsTreasuryCenter = lazy(() => import('./pages/OperationsTreasuryCenter'));"
  );
}
if (!app.includes('path="/operations-center"')) {
  app = app.replace(
    '<Route path="/treasury" element={<TreasuryCenter />} />',
    '<Route path="/treasury" element={<TreasuryCenter />} />\n    <Route path="/operations-center" element={<OperationsTreasuryCenter />} />'
  );
}
if (!layout.includes('{ path: "/operations-center", label: "مركز التشغيل والخزنة", icon: Landmark },')) {
  layout = layout.replace(
    '{ label: "دورة الشيفت والخزنة", items: [',
    '{ label: "دورة الشيفت والخزنة", items: [\n        { path: "/operations-center", label: "مركز التشغيل والخزنة", icon: Landmark },'
  );
}

fs.writeFileSync(appPath, app);
fs.writeFileSync(layoutPath, layout);
