// Fail the build when llms.txt or llms-full.txt does not name the latest release.
// Usage: node scripts/check-llms-version.mjs [v]version
// NUTHATCH_EXPECTED_VERSION is the offline equivalent of the argument.
import { readFile } from 'node:fs/promises';

const repo = 'nuthatch-org/nuthatch';
const files = ['public/llms.txt', 'public/llms-full.txt'];
const supplied = process.argv[2] ?? process.env.NUTHATCH_EXPECTED_VERSION;

async function latestVersion() {
  if (supplied) return supplied.replace(/^v/, '');
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'nuthatch-frontend' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the latest release`);
  const release = await res.json();
  if (release.draft || release.prerelease || typeof release.tag_name !== 'string') {
    throw new Error('GitHub returned no published release tag');
  }
  return release.tag_name.replace(/^v/, '');
}

const expected = await latestVersion();
if (!/^\d+\.\d+\.\d+$/.test(expected)) {
  throw new Error(`invalid expected release version: ${expected || '(empty)'}`);
}

const failures = [];
for (const file of files) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const match = text.match(/Status:\s*(?:\*\*)?v(\d+\.\d+\.\d+)/);
  if (!match) failures.push(`${file}: no Status: vX.Y.Z claim found`);
  else if (match[1] !== expected) failures.push(`${file}: states v${match[1]}, expected v${expected}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`llms.txt and llms-full.txt state the latest release, v${expected}.`);
