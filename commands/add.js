#!/usr/bin/env node

import fs from 'fs';
import { globSync } from 'glob';
import recast from 'recast';
import babelParser from '@babel/parser';

function parseCliOptions() {
  const args = process.argv.slice(3);
  const options = {};
  args.forEach((arg) => {
    const [key, value] = arg.split('=');
    if (key === 'overwrite') {
      options.overwriteExistingIds = true;
    } else if (key === 'baseId') {
      options.baseId = value;
    } else if (key === 'files') {
      options.glob = value;
    }
  });
  return options;
}

function parseBaseId(baseId) {
  const match = baseId.match(/^(.+?)(\d+)$/);
  if (!match) throw new Error(`Invalid baseId format: ${baseId}`);
  const prefix = match[1];
  const numStr = match[2];
  const numLength = numStr.length;
  const startNumber = parseInt(numStr, 10);
  return { prefix, numLength, startNumber };
}

function extractTestIds(code, idPattern) {
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
      } else if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier'
      ) {
        calleeName = node.callee.property.name;
      }
      if (calleeName === 'it' || calleeName === 'test') {
        const firstArg = node.arguments[0];
        if (
          firstArg &&
          (firstArg.type === 'Literal' ||
            firstArg.type === 'StringLiteral' ||
            firstArg.type === 'TemplateLiteral')
        ) {
          let testTitle = '';
          if (firstArg.type === 'TemplateLiteral') {
            if (firstArg.expressions.length === 0) {
              testTitle = firstArg.quasis[0].value.raw;
            }
          } else {
            testTitle = firstArg.value;
          }
          const match = testTitle.match(idPattern);
          if (match) {
            ids.push(match[1]);
          }
        }
      }
      this.traverse(path);
    },
  });

  return ids;
}

function transformFile(filePath, config, usedIds, basePrefix, numLength, startIndex) {
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
  let localIndex = 0;

  recast.types.visit(ast, {
    visitCallExpression(path) {
      const node = path.node;
      let calleeName = null;
      if (node.callee.type === 'Identifier') {
        calleeName = node.callee.name;
      } else if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier'
      ) {
        calleeName = node.callee.property.name;
      }
      if (calleeName === 'it' || calleeName === 'test') {
        const firstArg = node.arguments[0];
        let testTitle = '';
        if (
          firstArg &&
          (firstArg.type === 'Literal' ||
            firstArg.type === 'StringLiteral' ||
            firstArg.type === 'TemplateLiteral')
        ) {
          if (firstArg.type === 'TemplateLiteral') {
            if (firstArg.expressions.length === 0) {
              testTitle = firstArg.quasis[0].value.raw;
            }
          } else {
            testTitle = firstArg.value;
          }

          const idPattern = new RegExp(`^(${basePrefix}\\d{${numLength}}):\\s*`);
          const match = testTitle.match(idPattern);
          const hasId = !!match;

          if (hasId && !config.overwriteExistingIds) {
            return this.traverse(path);
          }

          let newIdNum = startIndex + localIndex;
          let newId;
          do {
            newId = `${basePrefix}${newIdNum.toString().padStart(numLength, '0')}`;
            newIdNum++;
          } while (usedIds.has(newId));

          localIndex = newIdNum - startIndex;
          usedIds.add(newId);

          const cleanTitle = testTitle.replace(idPattern, '').trim();
          const finalTitle = `${newId}: ${cleanTitle}`;

          if (firstArg.type === 'TemplateLiteral') {
            node.arguments[0] = recast.types.builders.stringLiteral(finalTitle);
          } else {
            firstArg.value = finalTitle;
            firstArg.raw = `'${finalTitle}'`;
          }

          fileChanged = true;
        }
      }
      this.traverse(path);
    },
  });

  if (fileChanged) {
    fs.writeFileSync(filePath, recast.print(ast).code, 'utf-8');
    console.log(`✨ Updated: ${filePath}`);
  }
}

export default async function main() {
  try {
    const options = parseCliOptions();
    if (!options.baseId || !options.glob) {
      throw new Error('Missing required options: baseId and files');
    }

    const { prefix: basePrefix, numLength, startNumber } = parseBaseId(options.baseId);
    const idPattern = new RegExp(`^(${basePrefix}\\d{${numLength}}):\\s*`);
    const files = globSync(options.glob, { nodir: true });

    const usedIds = new Set();
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf-8');
      const ids = extractTestIds(code, idPattern);
      ids.forEach(id => usedIds.add(id));
    }

    for (const file of files) {
      transformFile(file, options, usedIds, basePrefix, numLength, startNumber);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}
