import { photoRoots } from './config.ts';
import { scanLibrary, scanState } from './indexer.ts';

const force = process.argv.includes('--force');

if (photoRoots.length === 0) {
  console.error('PHOTO_ROOTS is empty. Add at least one folder path to .env.');
  process.exit(1);
}

console.log(`Scanning: ${photoRoots.join(', ')}${force ? ' (--force)' : ''}`);

const ticker = setInterval(() => {
  const { found, processed, skipped, failed } = scanState;
  if (found) {
    const done = processed + skipped + failed;
    process.stdout.write(`\r  ${done}/${found}  new:${processed} skipped:${skipped} failed:${failed}   `);
  }
}, 250);

const result = await scanLibrary({ force });
clearInterval(ticker);

const seconds = ((result.finishedAt ?? Date.now()) - (result.startedAt ?? Date.now())) / 1000;
process.stdout.write('\r');
if (result.error) {
  console.error(`Error: ${result.error}`);
  process.exit(1);
}
console.log(
  `Done: ${result.found} files, ${result.processed} indexed, ${result.skipped} skipped, ` +
    `${result.failed} unreadable — ${seconds.toFixed(1)}s`,
);
process.exit(0);
