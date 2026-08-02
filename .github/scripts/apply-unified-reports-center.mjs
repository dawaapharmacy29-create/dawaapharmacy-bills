import fs from 'node:fs';

const appPath = 'src/App.jsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes("const UnifiedReportsCenter = lazy(() => import('./pages/UnifiedReportsCenter'));")) {
  app = app.replace(
    "const DailyTasksCenter = lazy(() => import('./pages/DailyTasksCenter'));",
    "const DailyTasksCenter = lazy(() => import('./pages/DailyTasksCenter'));\nconst UnifiedReportsCenter = lazy(() => import('./pages/UnifiedReportsCenter'));"
  );
}
if (!app.includes('path="/reports-center"')) {
  app = app.replace(
    '<Route path="/daily-tasks" element={<DailyTasksCenter />} />',
    '<Route path="/daily-tasks" element={<DailyTasksCenter />} />\n    <Route path="/reports-center" element={<UnifiedReportsCenter />} />'
  );
}
fs.writeFileSync(appPath, app);

const layoutPath = 'src/components/layout/AppLayout.jsx';
let layout = fs.readFileSync(layoutPath, 'utf8');
if (!layout.includes('{ path: "/reports-center", label: "مركز التقارير"')) {
  layout = layout.replace(
    '{ path: "/reports", label: "التقارير الإجمالية", icon: BarChart2 },',
    '{ path: "/reports-center", label: "مركز التقارير", icon: BarChart3 },\n        { path: "/reports", label: "التقارير الإجمالية", icon: BarChart2 },'
  );
}
fs.writeFileSync(layoutPath, layout);
console.log('Unified reports center integrated.');
