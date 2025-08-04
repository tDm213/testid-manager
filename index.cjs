#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const recast = require('recast');
const babelParser = require('@babel/parser');

const CONFIG_FILES = [
  'testid-manager.config.json',
  path.join('cypress', 'testid-manager.config.json'),
  path.join('playwright', 'testid-manager.config.json'),
];

function loadConfig() {
  for (const configFile of CONFIG_FILES) {
    const configPath = path.resolve(process.cwd(), configFile);
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      console.log(`✅ Loaded config from: ${configFile}`);
      return JSON.parse(raw);
    }
  }
  throw new Error('Config file not found.');
}

function incrementStringNumber(str, increment) {
  const num = parseInt(str, 10);
  if (isNaN(num)) throw new Error('startIndex must be a numeric string');
  const newNum = num + increment;
  return newNum.toString().padStart(str.length, '0');
}

// Parses all test ids in the file and returns array of {id, title, file, loc}
function parseTestIdsFromFile(filePath) {
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
        let testTitle = null;
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
          if (typeof testTitle === 'string') {
            // Get ID prefix pattern length from startIndex length
            // We'll match exactly N digits followed by colon and optional spaces
            // e.g. /^(\d{4}):\s*/ for 4-digit IDs
            // Use dynamic regex
            const idLength = config.startIndex.length;
            const idPrefixRegex = new RegExp(`^(\\d{${idLength}}):\\s*`);
            const match = testTitle.match(idPrefixRegex);
            if (match) {
              foundIds.push({
                id: match[1],
                title: testTitle,
                file: filePath,
                loc: node.loc ? node.loc.start : null,
              });
            }
          }
        }
      }
      this.traverse(path);
    },
  });

  return foundIds;
}

function transformFile(filePath, config, usedIds, globalStartIndexNum) {
  console.log(`Reading file: ${filePath}`);

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
  let localIncrement = 0;

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
        let testTitle = null;
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
          if (typeof testTitle === 'string') {
            const idLength = config.startIndex.length;
            const idPrefixRegex = new RegExp(`^(\\d{${idLength}}):\\s*`);
            const match = testTitle.match(idPrefixRegex);
            const hasIdPrefix = !!match;
            if (hasIdPrefix && !config.overwriteExistingIds) {
              console.log(`  Skipping (existing id and overwrite disabled): ${testTitle}`);
            } else {
              let nextIdNum = globalStartIndexNum + localIncrement;
              let nextIdStr = nextIdNum.toString().padStart(idLength, '0');

              while (usedIds.has(nextIdStr)) {
                nextIdNum++;
                nextIdStr = nextIdNum.toString().padStart(idLength, '0');
              }

              localIncrement = nextIdNum - globalStartIndexNum + 1;
              usedIds.add(nextIdStr);

              const newTitleRaw = testTitle.replace(idPrefixRegex, '').trim();
              const finalTitle = `${nextIdStr}: ${newTitleRaw}`;

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
        }
      }
      this.traverse(path);
    },
  });

  if (fileChanged) {
    const output = recast.print(ast).code;
    fs.writeFileSync(filePath, output, 'utf-8');
    console.log(`✨ Updated file: ${filePath}`);
  } else {
    console.log(`⚪ No changes: ${filePath}`);
  }

  return localIncrement;
}

async function main() {
  try {
    config = loadConfig();
    console.log('Config:', config);

    const files = glob.sync(config.glob, { absolute: false, nodir: true });
    if (files.length === 0) {
      console.log('No files matched the glob pattern.');
      return;
    }

    // 1) Scan all files and collect all IDs + where they appear
    const idOccurrences = {}; // { id: [ { file, title } ] }

    files.forEach((file) => {
      const foundIds = parseTestIdsFromFile(file);
      foundIds.forEach(({ id, title, file: f }) => {
        if (!idOccurrences[id]) idOccurrences[id] = [];
        idOccurrences[id].push({ file: f, title });
      });
    });

    // 2) Detect duplicates (IDs that appear more than once)
    const duplicates = Object.entries(idOccurrences)
      .filter(([id, occurrences]) => occurrences.length > 1);

    if (duplicates.length > 0) {
      console.log('\n🚨 Duplicate test IDs found:');
      duplicates.forEach(([id, occurrences]) => {
        console.log(`\nID >>> ${id} <<< appears in:`);
        occurrences.forEach(({ file, title }) => {
          console.log(` - ${file}: "${title}"`);
        });
      });
      console.log('\nPlease fix duplicate test IDs before running the script to add new IDs.\n');
    } else {
      console.log('\n✅ No duplicate test IDs found.');
    }

    // 3) Collect all used IDs in a Set for generating new unique ones
    const usedIds = new Set(Object.keys(idOccurrences));

    // 4) Convert startIndex to number for arithmetic
    const globalStartIndexNum = parseInt(config.startIndex, 10);
    if (isNaN(globalStartIndexNum)) {
      throw new Error('startIndex in config must be a numeric string');
    }

    // 5) Process each file to add or overwrite IDs
    let totalIncrement = 0;
    files.forEach((file) => {
      const usedInFile = transformFile(file, config, usedIds, globalStartIndexNum + totalIncrement);
      totalIncrement += usedInFile;
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

let config; // global so parser can access startIndex length
main();
