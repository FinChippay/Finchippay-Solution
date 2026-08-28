const fs = require('fs');
const path = require('path');

const enPath = path.join(__dirname, '..', 'frontend', 'public', 'locales', 'en', 'common.json');
const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
const usedKeys = new Set();
const hardcoded = [];

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) { scanDir(fp); continue; }
    if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) continue;
    const content = fs.readFileSync(fp, 'utf-8');
    const tMatches = content.match(/t\(['"]([^'"]+)['"]\)/g);
    if (tMatches) tMatches.forEach(m => {
      const key = m.match(/t\(['"]([^'"]+)['"]\)/)[1];
      usedKeys.add(key);
    });
  }
}

function getMissingKeys(obj, prefix) {
  const missing = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? prefix + '.' + k : k;
    if (typeof v === 'object' && v !== null) missing.push(...getMissingKeys(v, fullKey));
    else if (!usedKeys.has(fullKey)) missing.push(fullKey);
  }
  return missing;
}

scanDir(path.join(__dirname, '..', 'frontend'));
const missing = getMissingKeys(en, '');
console.log('=== Unused translation keys ===');
missing.forEach(k => console.log('  ' + k));
console.log('\nUsed keys: ' + usedKeys.size + ' | Unused: ' + missing.length);
process.exit(missing.length > 10 ? 1 : 0);