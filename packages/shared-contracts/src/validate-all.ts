import { validateAllContracts } from './loader.js';

const results = validateAllContracts();

for (const result of results) {
  const mark = result.valid ? 'ok' : 'failed';
  console.log(`${mark}  ${result.contract}`);
  for (const error of result.errors ?? []) {
    console.error(`  ${error}`);
  }
}

if (results.some((result) => !result.valid)) {
  process.exitCode = 1;
}

