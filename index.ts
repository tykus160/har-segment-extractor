import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, extname, join } from 'node:path';
import { Command } from 'commander';

const require = createRequire(import.meta.url);
const { version } = require('./package.json');

interface HarEntry {
  request: { url: string };
  response: {
    status: number;
    content: {
      text?: string;
      encoding?: string;
      mimeType?: string;
      size?: number;
    };
  };
}

interface HarLog {
  log: { entries: HarEntry[] };
}

const DEFAULT_EXTENSIONS = '.mp4,.m4i';

function parseExtensions(value: string): string[] {
  return value.split(',').map((e) => (e.startsWith('.') ? e : `.${e}`));
}

const program = new Command()
  .name('har-segment-extractor')
  .version(version)
  .description('Extract files from HAR archives by extension')
  .argument('<har-file>', 'path to the HAR file')
  .option(
    '-e, --extensions <exts>',
    'comma-separated list of file extensions to extract',
    DEFAULT_EXTENSIONS,
  )
  .option(
    '-o, --output <dir>',
    'output directory (default: output/<har-name>)',
  );

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return basename(pathname);
  } catch {
    return basename(url.split('?')[0]);
  }
}

function matchesExtension(filename: string, extensions: string[]): boolean {
  const ext = extname(filename).toLowerCase();
  return extensions.some((e) => e.toLowerCase() === ext);
}

async function extract(
  harFile: string,
  extensions: string[],
  outputDir: string,
): Promise<void> {
  const raw = await readFile(harFile, 'utf-8');
  const har: HarLog = JSON.parse(raw);

  await mkdir(outputDir, { recursive: true });

  let extracted = 0;
  const seen = new Map<string, number>();

  for (const entry of har.log.entries) {
    const url = entry.request.url;
    const filename = getFilenameFromUrl(url);

    if (!matchesExtension(filename, extensions)) continue;

    const status = entry.response.status;
    if (status < 200 || status >= 300) {
      console.warn(`  Skipping ${filename}: HTTP ${status}`);
      continue;
    }

    const content = entry.response.content;
    if (!content.text) {
      console.warn(`  Skipping ${filename}: no content body`);
      continue;
    }

    // Deduplicate filenames
    const count = seen.get(filename) ?? 0;
    seen.set(filename, count + 1);
    const outName =
      count > 0
        ? `${basename(filename, extname(filename))}_${count}${extname(filename)}`
        : filename;

    const buffer =
      content.encoding === 'base64'
        ? Buffer.from(content.text, 'base64')
        : Buffer.from(content.text);

    const outPath = join(outputDir, outName);
    await writeFile(outPath, buffer);
    extracted++;
    console.log(`  Extracted: ${outName} (${buffer.length} bytes)`);
  }

  console.log(`\nDone. Extracted ${extracted} file(s) to ${outputDir}`);
}

program.parse();

const [harFile] = program.args;
const opts = program.opts<{ extensions: string; output?: string }>();
const extensions = parseExtensions(opts.extensions);
const outputDir =
  opts.output ?? join('output', basename(harFile, extname(harFile)));

console.log(
  `Extracting files matching [${extensions.join(', ')}] from ${harFile}\n`,
);
extract(harFile, extensions, outputDir).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
