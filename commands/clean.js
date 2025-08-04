#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import recast from 'recast';
import babelParser from '@babel/parser';

function resolveConfig(cliOptions = {}) {
  return {
    baseId: cliOptions.baseId || '0001',
    glob: cliOptions.files || 'tests/**/*.@(ts|js)',
  };
}

function parseBaseId(baseId) {
  const match = baseId.match(/^([A-Za-z]*)(\d+)$/);
  if (!match) {
    throw new Error('baseId must be alphanumeric like "C001", "T1001", etc.');
  }
  return { prefix: match[1], numberLength: match[2].length };
}

function cleanFile(filePath, prefix, numberLength) {
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
      const callee = node.callee;
      const isTest = callee.type === 'Identifier' && (callee.name === 'it' || callee.name === 'test');

      if (isTest) {
        const firstArg = node.arguments[0];
        if (!firstArg) return false;

        let title = '';
        if (firstArg.type === 'TemplateLiteral' && firstArg.expressions.length === 0) {
          title = firstArg.quasis[0].value.raw;
        } else if (firstArg.type === 'StringLiteral' || firstArg.type === 'Literal') {
          title = firstArg.value;
        } else {
          return false;
        }

        const idRegex = new RegExp(`^${prefix}(\\d{${numberLength}}):\\s*`);
        const match = title.match(idRegex);

        if (match) {
          const cleanedTitle = title.replace(idRegex, '').trim();

          console.log(`🧹 Removed ID from: "${title}" → "${cleanedTitle}"`);

          if (firstArg.type === 'TemplateLiteral') {
            node.arguments[0] = recast.types.builders.stringLiteral(cleanedTitle);
          } else {
            firstArg.value = cleanedTitle;
            firstArg.raw = `"${cleanedTitle}"`;
          }

          fileChanged = true;
        }
      }

      this.traverse(path);
    }
  });

  if (fileChanged) {
    const output = recast.print(ast).code;
    fs.writeFileSync(filePath, output, 'utf-8');
    console.log(`✅ Cleaned: ${filePath}`);
  } else {
    console.log(`⚪ Skipped (no matching IDs): ${filePath}`);
  }
}

export default async function main(cliOptions = {}) {
  try {
    const config = resolveConfig(cliOptions);
    const { prefix, numberLength } = parseBaseId(config.baseId);

    const files = globSync(config.glob, { absolute: false, nodir: true });
    if (files.length === 0) {
      console.log('No files matched.');
      return;
    }

    for (const file of files) {
      cleanFile(file, prefix, numberLength);
    }

  } catch (err) {
    console.error('❌ Error in clean:', err.message);
  }
}
