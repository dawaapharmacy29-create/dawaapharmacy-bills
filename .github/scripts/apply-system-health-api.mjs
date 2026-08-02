import fs from 'node:fs';

const file = 'src/api/base44Client.js';
const content = fs.readFileSync(file, 'utf8');
const marker = "export const base44ReviewApi = {";
const addition = "export const systemHealthApi = {\n  sync: () => callSecureRpc('app_system_sync_health'),\n};\n\n";
if (!content.includes(marker)) throw new Error('base44ReviewApi marker not found');
if (!content.includes('export const systemHealthApi')) {
  fs.writeFileSync(file, content.replace(marker, addition + marker));
}
console.log('System health API patch applied safely.');
