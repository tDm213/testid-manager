#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { globSync } from 'glob';
import recast from "recast";
import babelParser from "@babel/parser";

const CONFIG_FILES = [
  'testIdInjector.config.json',
  path.join('cypress', 'testIdInjector.config.json'),
  path.join('playwright', 'testIdInjector.config.json'),
];

function loadConfigFile() {
  for (const configFile of CONFIG_FILES) {
    const configPath = path.resolve(process.cwd(), configFile);
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      console.log(`✅ Loaded config from: ${configFile}`);
      return JSON.parse(raw);
    }
  }
  return null;
}

function resolveConfig(cliOptions = {}) {
  const fileConfig = loadConfigFile() || {};
  const merged = {
    baseId: cliOptions.baseId || fileConfig.baseId || '0001',
    overwriteExistingIds: cliOptions.overwrite ?? fileConfig.overwriteExistingIds ?? false,
    glob: cliOptions.files || fileConfig.glob || 'tests/**/*.@(ts|js)'
  };

  if (typeof merged.overwriteExistingIds === 'string') {
    merged.overwriteExistingIds = merged.overwriteExistingIds === 'true';
  }

  return merged;
}

function parseBaseId(baseId) {
  const match = baseId.match(/^([A-Za-z]*)(\d+)$/);
  if (!match) {
    throw new Error('baseId must be alphanumeric like "C001", "T1001", etc.');
  }
  return { prefix: match[1], baseNumber: parseInt(match[2], 10), numberLength: match[2].length };
}

function parseTestIdsFromFile(filePath, config) {
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

  const foundIds = [];

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
        }

        const idRegex = new RegExp(`^(${config.prefix})(\\d{${config.numberLength}}):\\s*`);
        const match = title.match(idRegex);

        if (match) {
          foundIds.push({
            id: match[1] + match[2],
            title,
            file: filePath,
            loc: node.loc ? node.loc.start : null
          });
        }
      }

      this.traverse(path);
    }
  });

  return foundIds;
}

function transformFile(filePath, config, usedIds, baseNumber) {
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
  let localInc = 0;

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

        const idRegex = new RegExp(`^(${config.prefix})(\\d{${config.numberLength}}):\\s*`);
        const match = title.match(idRegex);
        const hasId = !!match;

        if (hasId && !config.overwriteExistingIds) {
          console.log(`  Skipping (existing ID): ${title}`);
        } else {
          let nextId;
          let newBase = baseNumber + localInc;
          do {
            const padded = newBase.toString().padStart(config.numberLength, '0');
            nextId = `${config.prefix}${padded}`;
            newBase++;
          } while (usedIds.has(nextId));

          const newTitleRaw = title.replace(idRegex, '').trim();
          const finalTitle = `${nextId}: ${newTitleRaw}`;
          usedIds.add(nextId);
          localInc = newBase - baseNumber;

          console.log(`  Updating test title to: ${finalTitle}`);

          if (firstArg.type === 'TemplateLiteral') {
            node.arguments[0] = recast.types.builders.stringLiteral(finalTitle);
          } else {
            firstArg.value = finalTitle;
            firstArg.raw = `"${finalTitle}"`;
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
    console.log(`✨ Updated file: ${filePath}`);
  } else {
    console.log(`⚪ No changes: ${filePath}`);
  }

  return localInc;
}

export default async function main(cliOptions = {}) {
  try {
    const config = resolveConfig(cliOptions);
    const { prefix, baseNumber, numberLength } = parseBaseId(config.baseId);
    config.prefix = prefix;
    config.baseNumber = baseNumber;
    config.numberLength = numberLength;

    console.log('Config:', config);

    const files = globSync(config.glob, { absolute: false, nodir: true });
    if (files.length === 0) {
      console.log('No files matched.');
      return;
    }

    // Parse all existing IDs
    const idOccurrences = {};
    files.forEach((file) => {
      const found = parseTestIdsFromFile(file, config);
      found.forEach(({ id, title, file: f }) => {
        if (!idOccurrences[id]) idOccurrences[id] = [];
        idOccurrences[id].push({ file: f, title });
      });
    });

    // Detect duplicates
    const duplicates = Object.entries(idOccurrences).filter(([_, list]) => list.length > 1);
    if (duplicates.length > 0) {
      console.log('\n🚨 Duplicate test IDs found:');
      for (const [id, items] of duplicates) {
        console.log(`\nID >>> ${id} <<< appears in:`);
        items.forEach(({ file, title }) => {
          console.log(` - ${file}: "${title}"`);
        });
      }
      console.log('\nFix duplicates before proceeding.\n');
      return;
    } else {
      console.log('\n✅ No duplicate test IDs found.');
    }

    const usedIds = new Set(Object.keys(idOccurrences));

    // Update files
    let totalInc = 0;
    for (const file of files) {
      const inc = transformFile(file, config, usedIds, config.baseNumber + totalInc);
      totalInc += inc;
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}
