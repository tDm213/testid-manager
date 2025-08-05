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
    throw new Error("❌ Both 'baseId' and 'files' must be specified. Example:\n  npx testid-manager clean baseId=e2e-001 files=\"tests/**/*.ts\"");
  }

  return parsed;
}

function getIdPrefix(baseId) {
  const match = baseId.match(/^(.*?)(\d+)$/);
  if (!match) {
    throw new Error("❌ baseId must end with a number (e.g., e2e-001, test99)");
  }
  return match[1]; // Just the prefix
}

function transformFile(filePath, prefix) {
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

  let fileChanged = false;

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
          if (idRegex.test(testTitle)) {
            const newTitle = testTitle.replace(idRegex, '');
            console.log(`🧹 Removing ID from: "${testTitle}" → "${newTitle}"`);

            const newTitleLiteral = recast.types.builders.stringLiteral(newTitle);
            node.arguments[0] = newTitleLiteral;
            fileChanged = true;
          }
        }
      }

      this.traverse(path);
    },
  });

  if (fileChanged) {
    const output = recast.print(ast).code;
    fs.writeFileSync(filePath, output, 'utf-8');
    console.log(`✨ Cleaned file: ${filePath}`);
  } else {
    console.log(`⚪ No IDs matched in file: ${filePath}`);
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const { baseId, files } = parseArgs(args);
    const prefix = getIdPrefix(baseId);

    const matchedFiles = globSync(files, { nodir: true });

    if (matchedFiles.length === 0) {
      console.log('No files matched the pattern.');
      return;
    }

    matchedFiles.forEach((filePath) => {
      transformFile(filePath, prefix);
    });

  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
  }
}

export default main;
