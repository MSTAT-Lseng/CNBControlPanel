/**
 * Static architecture & policy verifier for CNBControlPanel.
 * Checks:
 *  1. Strict 5-service import isolation matrix across all src/ files.
 *  2. Zero runtime imports in src/contracts/.
 *  3. English-only comments across all .ts/.tsx files in src/.
 *  4. No RefreshControl in the main tab screens & no Liquid Glass libraries outside NativeTabs.
 */

import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = path.join(PROJECT_ROOT, 'src');

const ALLOWED_LAYERS = {
  contracts: new Set(['contracts']),
  app: new Set(['contracts', 'ui', 'app']),
  ui: new Set(['contracts', 'ui', 'exchange']),
  storage: new Set(['contracts', 'storage']),
  parser: new Set(['contracts', 'parser']),
  'workspace-parser': new Set(['contracts', 'workspace-parser']),
  exchange: new Set(['contracts', 'storage', 'parser', 'workspace-parser', 'exchange']),
};

function walkFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function classifyFileLayer(filePath) {
  const rel = path.relative(SRC_ROOT, filePath).replace(/\\/g, '/');
  if (rel.startsWith('contracts/')) return 'contracts';
  if (rel.startsWith('app/')) return 'app';
  if (rel.startsWith('services/ui/')) return 'ui';
  if (rel.startsWith('services/storage/')) return 'storage';
  if (rel.startsWith('services/parser/')) return 'parser';
  if (rel.startsWith('services/workspace-parser/')) return 'workspace-parser';
  if (rel.startsWith('services/exchange/')) return 'exchange';
  return 'unknown';
}

function resolveImportLayer(fromFile, specifier) {
  let targetRel = null;
  if (specifier.startsWith('@/')) {
    targetRel = specifier.slice(2);
  } else if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(fromFile), specifier);
    targetRel = path.relative(SRC_ROOT, resolved).replace(/\\/g, '/');
  } else {
    return null;
  }

  if (targetRel === 'contracts' || targetRel.startsWith('contracts/')) return 'contracts';
  if (targetRel === 'app' || targetRel.startsWith('app/')) return 'app';
  if (targetRel === 'services/ui' || targetRel.startsWith('services/ui/')) return 'ui';
  if (targetRel === 'services/storage' || targetRel.startsWith('services/storage/')) return 'storage';
  if (targetRel === 'services/parser' || targetRel.startsWith('services/parser/')) return 'parser';
  if (targetRel === 'services/workspace-parser' || targetRel.startsWith('services/workspace-parser/')) {
    return 'workspace-parser';
  }
  if (targetRel === 'services/exchange' || targetRel.startsWith('services/exchange/')) return 'exchange';
  return 'unknown';
}

function stripComments(sourceText) {
  return sourceText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function extractImports(sourceText) {
  const cleanCode = stripComments(sourceText);
  const specs = [];
  const importRegex = /(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g;
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const regex of [importRegex, sideEffectRegex, requireRegex]) {
    let match;
    while ((match = regex.exec(cleanCode)) !== null) {
      specs.push({ specifier: match[1], statement: match[0] });
    }
  }
  return specs;
}

function findNonAsciiComments(sourceText) {
  const issues = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let commentBuffer = '';
  let line = 1;
  let commentStartLine = 1;

  for (let i = 0; i < sourceText.length; i++) {
    const ch = sourceText[i];
    const next = sourceText[i + 1] ?? '';

    if (ch === '\n') {
      if (inLineComment) {
        if (/[^\x00-\x7F]/.test(commentBuffer)) {
          issues.push({ line: commentStartLine, snippet: commentBuffer.trim() });
        }
        inLineComment = false;
        commentBuffer = '';
      }
      line += 1;
      continue;
    }

    if (inLineComment) {
      commentBuffer += ch;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        if (/[^\x00-\x7F]/.test(commentBuffer)) {
          issues.push({ line: commentStartLine, snippet: commentBuffer.trim() });
        }
        inBlockComment = false;
        commentBuffer = '';
        i += 1;
      } else {
        commentBuffer += ch;
      }
      continue;
    }

    if (inSingleQuote) {
      if (ch === '\\') i += 1;
      else if (ch === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inDoubleQuote = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') i += 1;
      else if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      commentStartLine = line;
      commentBuffer = '';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      commentStartLine = line;
      commentBuffer = '';
      i += 1;
      continue;
    }

    if (ch === "'") inSingleQuote = true;
    else if (ch === '"') inDoubleQuote = true;
    else if (ch === '`') inTemplate = true;
  }

  return issues;
}

const files = walkFiles(SRC_ROOT);
const errors = [];

for (const file of files) {
  const rel = path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  const layer = classifyFileLayer(file);

  if (layer === 'unknown') {
    errors.push(`[LAYER] File outside recognized service boundaries: ${rel}`);
    continue;
  }

  const imports = extractImports(content);
  for (const { specifier, statement } of imports) {
    if (specifier === 'expo-glass-effect' || specifier === 'expo-blur') {
      errors.push(`[UI-POLICY] Forbidden glass/blur dependency "${specifier}" in ${rel}`);
    }

    if (layer === 'contracts') {
      if (!/^(import|export)\s+type\b/.test(statement.trim())) {
        errors.push(`[CONTRACTS] Non-type import/export in contracts layer (${rel}): ${statement}`);
      }
    }

    const targetLayer = resolveImportLayer(file, specifier);
    if (targetLayer !== null) {
      const allowed = ALLOWED_LAYERS[layer];
      if (!allowed.has(targetLayer)) {
        errors.push(
          `[BOUNDARY] ${layer} (${rel}) is forbidden from importing ${targetLayer} ("${specifier}")`,
        );
      }
    }
  }

  if (rel.includes('src/services/ui/screens/') && /RefreshControl/.test(content)) {
    errors.push(`[UI-POLICY] RefreshControl is forbidden in tab screens (${rel})`);
  }

  const commentIssues = findNonAsciiComments(content);
  for (const issue of commentIssues) {
    errors.push(
      `[COMMENT-LANG] Non-ASCII (non-English) comment in ${rel}:${issue.line} -> "${issue.snippet.slice(0, 60)}"`,
    );
  }
}

if (errors.length > 0) {
  console.error('Boundary and policy verification FAILED:\n');
  for (const err of errors) {
    console.error(' - ' + err);
  }
  process.exit(1);
}

console.log(
  `Boundary & policy check PASSED (${files.length} source files verified: 0 boundary leaks, 0 non-English comments).`,
);
