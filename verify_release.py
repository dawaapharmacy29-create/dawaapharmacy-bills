from pathlib import Path
import json

root = Path(__file__).parent
required_pages = [
    'src/pages/DataReviewCenter.jsx',
    'src/pages/BranchSettlements.jsx',
    'src/pages/PurchaseWorkflowCenter.jsx',
    'src/pages/TeamMergeCenter.jsx',
]
required_entities = [
    'SupplierPayment.jsonc', 'Return.jsonc', 'TeamMember.jsonc',
    'ReplenishmentOrder.jsonc', 'PurchaseInvoice.jsonc', 'TargetGoal.jsonc'
]

missing = [p for p in required_pages if not (root / p).exists()]
for name in required_entities:
    path = root / 'base44/entities' / name
    if not path.exists():
        missing.append(str(path.relative_to(root)))
        continue
    json.loads(path.read_text(encoding='utf-8'))

app = (root / 'src/App.jsx').read_text(encoding='utf-8')
for route in ['/data-review', '/branch-settlements', '/purchase-workflow', '/team-merge']:
    if route not in app:
        missing.append(f'route:{route}')

if missing:
    raise SystemExit('Missing or invalid: ' + ', '.join(missing))
print('Release structure and Base44 entity schemas are valid.')
