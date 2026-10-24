import fs from 'node:fs/promises';

const fixtures = [
  ['research-paper.pdf', 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf'],
  ['second-paper.pdf', 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'],
];

// Download public sample PDFs that are kept outside version control.
for (const [name, url] of fixtures) {
  const destination = new URL('./fixtures/' + name, import.meta.url);
  try {
    await fs.access(destination);
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Could not download ' + name + ': HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF response for ' + name);
  await fs.mkdir(new URL('./fixtures/', import.meta.url), { recursive: true });
  const temporary = new URL('./fixtures/' + name + '.tmp', import.meta.url);
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, destination);
  console.log('Downloaded ' + name);
}
