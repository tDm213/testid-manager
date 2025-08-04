#!/usr/bin/env node

import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Get command and any additional arguments
const [,, command, ...args] = process.argv;

if (!command) {
  console.error("❌ No command provided.\nAvailable commands: add, clean, compare");
  process.exit(1);
}

// Resolve command module path
const commandPath = path.resolve(__dirname, `../commands/${command}.js`);

if (!fs.existsSync(commandPath)) {
  console.error(`❌ Unknown command '${command}'.\nAvailable commands: add, clean, compare`);
  process.exit(1);
}

// Parses args like "start=C001", "files=tests/**/*.js", "overwrite"
function parseArgs(args) {
  const options = {};
  args.forEach(arg => {
    if (arg.includes('=')) {
      const [key, val] = arg.split('=');
      options[key] = val;
    } else {
      options[arg] = true; // flags like `overwrite`
    }
  });
  return options;
}

try {
  const commandModule = await import(pathToFileURL(commandPath).href);

  if (typeof commandModule.default !== 'function') {
    throw new Error('Command file must export a default function');
  }

  const options = parseArgs(args);
  await commandModule.default(options); // Pass parsed options to the command
} catch (err) {
  console.error(`❌ Failed to run command '${command}':`, err.message);
  process.exit(1);
}
