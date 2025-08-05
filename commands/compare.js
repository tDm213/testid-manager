#!/usr/bin/env node

import fs from 'fs';
import { globSync } from 'glob';
import recast from 'recast';
import babelParser from '@babel/parser';

function parseArgs(args) {
  const parsed = {
    baseId: null,
    files: null,
  };

  args.forEach(arg => {
    const [key, value] = arg.split('=');
    if (key === 'baseId') parsed.baseId = value;
    if (key === 'files') parsed.files = value;
  });

  if (!parsed.baseId || !parsed.files) {
    throw new Error("❌ Both 'baseId' and 'files' must be specified. Example:\n  npx testid-manager compare baseId=e2e-001 files=\"tests/**/*.ts\"");
  }

  return parsed;
}

function getIdPrefix(baseId) {
  const match = baseId.match(/^(.*?)(\d+)$/);
  if (!match) {
    throw new Error("❌ baseId must end with a number (e.g., e2e-001, test99)");
  }
  return {
    prefix: match[1],
    padding: match[2].length,
  };
}

function extractIdsFromFile(filePath, prefix) {
  const code = fs.readFileSync(filePath, 'utf-8');

  const ast = recast.parse(code, {
    parser: {
      parse(source) {
        return babelParser.parse(source, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript'],
        });
      },
    },
  });

  const ids = [];

  recast.types.visit(ast, {
    visitCallExpression(path) {
      const node = path.node;
      let calleeName = null;

      if (node.callee.type === 'Identifier') {
        calleeName = node.callee.name;
      } else if (node.callee.type === 'MemberExpression' &&
                 node.callee.property.type === 'Identifier') {
        calleeName = node.callee.property.name;
      }

      if (calleeName === 'it' || calleeName === 'test') {
        const firstArg = node.arguments[0];
        if (!firstArg || !firstArg.value) return false;

        let testTitle = null;
        if (firstArg.type === 'Literal' || firstArg.type === 'StringLiteral') {
          testTitle = firstArg.value;
        } else if (firstArg.type === 'TemplateLiteral' && firstArg.expressions.length === 0) {
          testTitle = firstArg.quasis[0].value.raw;
        }

        if (typeof testTitle === 'string') {
          const idRegex = new RegExp(`^${prefix}(\\d+):\\s*`);
          const match = testTitle.match(idRegex);
          if (match) {
            const number = parseInt(match[1], 10);
            ids.push({
              number,
              full: `${prefix}${match[1]}`,
            });
          }
        }
      }

      this.traverse(path);
    },
  });

  return ids;
}

function compareIds(idObjects, baseNumber = 1) {
  const numbers = idObjects.map(id => id.number);
  const fullMap = new Map();

  idObjects.forEach(id => {
    const count = fullMap.get(id.full) || 0;
    fullMap.set(id.full, count + 1);
  });

  const duplicates = [...fullMap.entries()]
    .filter(([, count]) => count > 1)
    .map(([fullId]) => fullId);

  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const missing = [];

  for (let i = baseNumber; i <= sorted[sorted.length - 1]; i++) {
    if (!sorted.includes(i)) {
      missing.push(i);
    }
  }

  return { missing, duplicates };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const { baseId, files } = parseArgs(args);
    const { prefix, padding } = getIdPrefix(baseId);

    const matchedFiles = globSync(files, { nodir: true });

    if (matchedFiles.length === 0) {
      console.log('No files matched the pattern.');
      return;
    }

    const allIds = [];

    matchedFiles.forEach((filePath) => {
      const ids = extractIdsFromFile(filePath, prefix);
      allIds.push(...ids);
    });

    const { missing, duplicates } = compareIds(allIds);

    console.log(`🔍 Found ${allIds.length} total IDs`);
    console.log(`📛 Duplicate IDs: ${duplicates.length > 0 ? duplicates.join(', ') : 'None'}`);
    console.log(`🚫 Missing IDs: ${missing.length > 0 ? missing.map(n => `${prefix}${String(n).padStart(padding, '0')}`).join(', ') : 'None'}`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
  }
}

export default main;
