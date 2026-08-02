import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function update(file, transform) {
  const full = path.join(root, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`No change: ${file}`);
    return;
  }
  fs.writeFileSync(full, after);
  console.log(`Updated: ${file}`);
}

update('src/api/base44Client.js', (text) => {
  if (!text.includes("@/lib/invoiceWorkflowStatus")) {
    text = `import { getCanonicalWorkflowStatus } from '@/lib/invoiceWorkflowStatus';\n${text}`;
  }
  text = text.replace(
    /const sliced = rows\.slice\(0, Number\(limit \|\| rows\.length\)\);/,
    "const sliced = rows.slice(0, Number(limit || rows.length)).map((row) => ({ ...row, workflow_status: getCanonicalWorkflowStatus(row) }));"
  );
  return text;
});

update('src/pages/Dashboard.jsx', (text) => {
  text = text.replace(
    /const pending = invoices\.filter\(\(invoice\) => invoice\.status === [\"']انتظار المراجعة[\"']\)\.length;/,
    "const pending = invoices.filter((invoice) => invoice.workflow_status === 'submitted').length;"
  );
  return text;
});

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(entry.name)) {
      const before = fs.readFileSync(full, 'utf8');
      const after = before
        .replace(/invoice\.status === [\"']انتظار المراجعة[\"']/g, "invoice.workflow_status === 'submitted'")
        .replace(/[\"']انتظار المراجعة[\"'] === invoice\.status/g, "invoice.workflow_status === 'submitted'");
      if (after !== before) {
        fs.writeFileSync(full, after);
        console.log(`Normalized legacy status check: ${path.relative(root, full)}`);
      }
    }
  }
}

walk(path.join(root, 'src'));

// Trigger marker: 2026-08-02 unified invoice repair.
