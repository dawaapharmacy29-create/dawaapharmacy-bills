import fs from 'node:fs';

const appPath = 'src/App.jsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes("const InventorySuppliersCenter = lazy(() => import('./pages/InventorySuppliersCenter'));")) {
  app = app.replace(
    "const InventoryManagement = lazy(() => import('./pages/InventoryManagement'));",
    "const InventoryManagement = lazy(() => import('./pages/InventoryManagement'));\nconst InventorySuppliersCenter = lazy(() => import('./pages/InventorySuppliersCenter'));"
  );
}
if (!app.includes('path="/inventory-center"')) {
  app = app.replace(
    '<Route path="/inventory" element={<InventoryManagement />} />',
    '<Route path="/inventory" element={<InventoryManagement />} />\n    <Route path="/inventory-center" element={<InventorySuppliersCenter />} />'
  );
}
fs.writeFileSync(appPath, app);

const layoutPath = 'src/components/layout/AppLayout.jsx';
let layout = fs.readFileSync(layoutPath, 'utf8');
if (!layout.includes('{ path: "/inventory-center", label: "مركز المخزون والموردين"')) {
  layout = layout.replace(
    '{ label: "المخزون والموردون", items: [',
    '{ label: "المخزون والموردون", items: [\n        { path: "/inventory-center", label: "مركز المخزون والموردين", icon: Layers3 },'
  );
}
fs.writeFileSync(layoutPath, layout);
