import fs from 'node:fs';

function replaceOnce(file, find, replacement) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes(find)) throw new Error(`Pattern not found in ${file}: ${find.slice(0, 80)}`);
  fs.writeFileSync(file, content.replace(find, replacement));
}

const app = 'src/App.jsx';
replaceOnce(
  app,
  "import AppErrorBoundary from './components/system/AppErrorBoundary';",
  "import AppErrorBoundary from './components/system/AppErrorBoundary';\nimport RoleRouteGuard from './components/auth/RoleRouteGuard';"
);

const adminRoutes = [
  ['<Route path="/system-status" element={<SystemStatus />} />', '<Route path="/system-status" element={<RoleRouteGuard adminOnly><SystemStatus /></RoleRouteGuard>} />'],
  ['<Route path="/user-management" element={<UserManagement />} />', '<Route path="/user-management" element={<RoleRouteGuard adminOnly><UserManagement /></RoleRouteGuard>} />'],
  ['<Route path="/doctor-account-coverage" element={<DoctorAccountCoverage />} />', '<Route path="/doctor-account-coverage" element={<RoleRouteGuard adminOnly><DoctorAccountCoverage /></RoleRouteGuard>} />'],
  ['<Route path="/team-merge" element={<TeamMergeCenter />} />', '<Route path="/team-merge" element={<RoleRouteGuard adminOnly><TeamMergeCenter /></RoleRouteGuard>} />'],
  ['<Route path="/treasury-operations" element={<TreasuryOperations />} />', '<Route path="/treasury-operations" element={<RoleRouteGuard adminOnly><TreasuryOperations /></RoleRouteGuard>} />'],
  ['<Route path="/purchase-operations-review" element={<PurchaseOperationsReview />} />', '<Route path="/purchase-operations-review" element={<RoleRouteGuard adminOnly><PurchaseOperationsReview /></RoleRouteGuard>} />'],
  ['<Route path="/security-audit" element={<SecurityAuditPage />} />', '<Route path="/security-audit" element={<RoleRouteGuard adminOnly><SecurityAuditPage /></RoleRouteGuard>} />'],
  ['<Route path="/supplier-rules-backfill" element={<SupplierRulesBackfill />} />', '<Route path="/supplier-rules-backfill" element={<RoleRouteGuard adminOnly><SupplierRulesBackfill /></RoleRouteGuard>} />'],
  ['<Route path="/data-review" element={<DataReviewCenter />} />', '<Route path="/data-review" element={<RoleRouteGuard adminOnly><DataReviewCenter /></RoleRouteGuard>} />'],
  ['<Route path="/base44-sync-review" element={<Base44SyncReview />} />', '<Route path="/base44-sync-review" element={<RoleRouteGuard adminOnly><Base44SyncReview /></RoleRouteGuard>} />'],
  ['<Route path="/branch-settlements" element={<BranchSettlements />} />', '<Route path="/branch-settlements" element={<RoleRouteGuard adminOnly><BranchSettlements /></RoleRouteGuard>} />'],
];
for (const [find, replacement] of adminRoutes) replaceOnce(app, find, replacement);
replaceOnce(
  app,
  '<Route path="/treasury/shift-review" element={<ShiftTreasuryReview />} />',
  '<Route path="/treasury/shift-review" element={<RoleRouteGuard managerOnly><ShiftTreasuryReview /></RoleRouteGuard>} />'
);

const syncPage = 'src/pages/Base44SyncReview.jsx';
replaceOnce(
  syncPage,
  'سجلات مالية (شيفت، دفعات موردين، فواتير شراء) جاية من Base44 ومنتظرة مراجعتك قبل أي اعتماد.',
  'مراقبة الفروقات والاستثناءات الواردة من Base44 إلى Supabase. فواتير الشراء العادية تُطبّق تلقائيًا، بينما الحذف والتعارضات الحساسة تتوقف للمراجعة الآمنة.'
);
replaceOnce(
  syncPage,
  'هذه الشاشة للمراجعة والتوثيق فقط — تحديد الحالة هنا لا يدخل أو يعدّل أي سجل مالي في النظام تلقائيًا. لو السجل محتاج يتضاف فعليًا، لازم يتراجع ويتسجل يدويًا في الشاشة المناسبة (تسليم الشيفت، دفعات الموردين، فواتير الشراء) لحد ما نبني آلية اعتماد تلقائي منفصلة لاحقًا.',
  'المزامنة الرسمية تعمل في اتجاه واحد فقط: Base44 ← المصدر التشغيلي، ثم Supabase/Vercel للمراجعة والتحليل. التغييرات لا تُرسل من Vercel إلى Base44. الحذف والتعارضات لا تُطبق تلقائيًا حفاظًا على البيانات.'
);

console.log('Safe platform hardening patch applied and ready for build verification.');
