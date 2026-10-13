import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Only public application assets are deployed. Dependencies, tests and credentials are excluded.
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'styles.css', 'leaderboard.css', 'js', 'assets', '.nojekyll']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
async function filesAt(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = `${path}/${entry.name}`;
    files.push(...(entry.isDirectory() ? await filesAt(name) : [name]));
  }
  return files.sort();
}
const files = await filesAt('dist');
const hash = createHash('sha256');
for (const file of files) { hash.update(file); hash.update(await readFile(file)); }
const build = hash.digest('hex').slice(0, 12);
// Version every module edge, so a cached old game cannot be mixed with a new lobby.
for (const file of files.filter(file => file.endsWith('.js'))) {
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace(/(from\s+['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, `$1$2?v=${build}$3`));
}
const html = await readFile('dist/index.html', 'utf8');
await writeFile('dist/index.html', html
  .replace('href="./styles.css"', `href="./styles.css?v=${build}"`)
  .replace('href="./leaderboard.css"', `href="./leaderboard.css?v=${build}"`)
  .replace('src="./js/app.js"', `src="./js/app.js?v=${build}"`));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('dist/release.json', JSON.stringify({ version, build }) + '\n');
console.log(`Static site ${version} (${build}) built in dist/`);
