import fs from 'node:fs';

const appPath = 'src/App.jsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes("const AdminSettingsCenter = lazy(() => import('./pages/AdminSettingsCenter'));")) {
  app = app.replace(
    "const TeamMergeCenter = lazy(() => import('./pages/TeamMergeCenter'));",
    "const TeamMergeCenter = lazy(() => import('./pages/TeamMergeCenter'));\nconst AdminSettingsCenter = lazy(() => import('./pages/AdminSettingsCenter'));"
  );
}
if (!app.includes('path="/admin-center"')) {
  app = app.replace(
    '<Route path="/team-members" element={<TeamMembers />} />',
    '<Route path="/team-members" element={<TeamMembers />} />\n    <Route path="/admin-center" element={<RoleRouteGuard adminOnly><AdminSettingsCenter /></RoleRouteGuard>} />'
  );
}
fs.writeFileSync(appPath, app);

const layoutPath = 'src/components/layout/AppLayout.jsx';
let layout = fs.readFileSync(layoutPath, 'utf8');
if (!layout.includes('path: "/admin-center"')) {
  layout = layout.replace(
    '{ label: "المستخدمون", items: [',
    '{ label: "المستخدمون", items: [\n        { path: "/admin-center", label: "مركز الإدارة والإعدادات", icon: ShieldCheck, adminOnly: true },'
  );
}
fs.writeFileSync(layoutPath, layout);
