// Minimal guardrail: fails if secrets look like they leaked into the frontend or the repo.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const problems = [];
const SECRET_NAMES = /VITE_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ACCOUNT|REFRESH|SESSION|API_HASH|AI_API_KEY|ENCRYPTION)/;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.firebase'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|json|env|md)$/.test(e.name) || e.name.startsWith('.env')) check(p);
  }
}
function check(p) {
  const rel = path.relative(root, p);
  if (/(^|\/)\.env(\.[a-z]+)?$/.test(rel) && !rel.endsWith('.example')) problems.push(`${rel}: real .env file present (must not be committed)`);
  if (rel.startsWith('scripts/')) return;
  const txt = fs.readFileSync(p, 'utf8');
  if (SECRET_NAMES.test(txt) && !rel.endsWith('.md')) problems.push(`${rel}: secret-looking VITE_ variable`);
  if (/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(txt)) problems.push(`${rel}: private key material`);
}
walk(root);
if (problems.length) { console.error('Secret check failed:\n' + problems.join('\n')); process.exit(1); }
console.log('Secret check passed.');
