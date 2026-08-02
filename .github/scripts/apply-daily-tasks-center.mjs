import fs from 'node:fs';

function replaceOnce(file, find, replacement) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes(find)) throw new Error(`Pattern not found in ${file}`);
  fs.writeFileSync(file, content.replace(find, replacement));
}

const app = 'src/App.jsx';
replaceOnce(
  app,
  "const Dashboard = lazy(() => import('./pages/Dashboard'));",
  "const Dashboard = lazy(() => import('./pages/Dashboard'));\nconst DailyTasksCenter = lazy(() => import('./pages/DailyTasksCenter'));"
);
replaceOnce(
  app,
  '<Route path="/dashboard/advanced" element={<Dashboard />} />',
  '<Route path="/dashboard/advanced" element={<Dashboard />} />\n    <Route path="/daily-tasks" element={<DailyTasksCenter />} />'
);

const layout = 'src/components/layout/AppLayout.jsx';
replaceOnce(
  layout,
  '{ path: "/", label: "الرئيسية", icon: LayoutDashboard },',
  '{ path: "/", label: "الرئيسية", icon: LayoutDashboard },\n        { path: "/daily-tasks", label: "مهام اليوم", icon: ListChecks },'
);
replaceOnce(
  layout,
  '{ path: "/", label: "الرئيسية", icon: LayoutDashboard },\n  { path: "/invoices/new", label: "فاتورة جديدة", icon: FilePlus2 },',
  '{ path: "/", label: "الرئيسية", icon: LayoutDashboard },\n  { path: "/daily-tasks", label: "مهام اليوم", icon: ListChecks },\n  { path: "/invoices/new", label: "فاتورة جديدة", icon: FilePlus2 },'
);

console.log('Daily tasks center integrated.');
