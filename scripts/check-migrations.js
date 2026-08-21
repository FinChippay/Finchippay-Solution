#!/usr/bin/env node

/**
 * Migration Guard:
 * Blocks destructive database changes (dropTable, dropColumn, renameColumn)
 * inside 'exports.up' to enforce the Expand/Contract pattern.
 */

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'backend', 'migrations');

if (!fs.existsSync(migrationsDir)) {
  console.log('Migrations directory not found, skipping check.');
  process.exit(0);
}

const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js'));
let hasError = false;

const destructivePatterns = [
  /dropTable(IfExists)?\s*\(/,
  /dropColumn\s*\(/,
  /renameColumn\s*\(/,
  /raw\s*\(\s*['"`]\s*DROP\s+(TABLE|COLUMN)/i,
  /raw\s*\(\s*['"`]\s*ALTER\s+TABLE\s+.*?\s+DROP\s+COLUMN/i
];

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  const content = fs.readFileSync(filePath, 'utf8');

  // We only check the exports.up function. 
  // A simple heuristic is to extract everything from 'exports.up' up to 'exports.down'
  const upMatch = content.match(/exports\.up\s*=\s*(async\s*)?function\s*\([^)]*\)\s*\{([\s\S]*?)\};?\s*(exports\.down|$)/);
  
  if (!upMatch) {
    console.error(`\u274C Migration ${file} does not have a recognizable exports.up function.`);
    hasError = true;
    continue;
  }

  const upContent = upMatch[2];

  // Also verify exports.down exists
  if (!content.includes('exports.down')) {
    console.error(`\u274C Migration ${file} is missing an exports.down function. All migrations must be reversible.`);
    hasError = true;
  }

  // Check for destructive patterns in upContent
  // But wait! If this is a "contract" migration (dropping an old column), we might want to allow it.
  // The requirement says "blocks destructive changes in a single migration." 
  // For this simple guard, we'll just flag destructive commands in exports.up.
  // If developers need to drop a table in a contract phase, they can bypass the lint with a comment, e.g. // check-migrations:disable
  if (upContent.includes('check-migrations:disable')) {
    continue;
  }

  let fileHasDestructive = false;
  for (const pattern of destructivePatterns) {
    if (pattern.test(upContent)) {
      console.error(`\u274C Destructive operation detected in exports.up of ${file}.`);
      console.error(`  Found pattern matching: ${pattern}`);
      fileHasDestructive = true;
      hasError = true;
    }
  }

  if (fileHasDestructive) {
    console.error(`  Please follow the Expand/Contract pattern. If this is a valid contract migration, add '// check-migrations:disable' in the exports.up body.`);
  }
}

if (hasError) {
  console.error('\nMigration check failed. Please fix the above errors to ensure zero-downtime deployments.');
  process.exit(1);
}

console.log('\u2705 All migrations passed the zero-downtime safety check.');
process.exit(0);
