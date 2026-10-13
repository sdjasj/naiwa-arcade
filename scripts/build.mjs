import { cp, mkdir, rm } from 'node:fs/promises';
// Only public application assets are deployed. Dependencies, tests and credentials are excluded.
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'styles.css', 'js', 'assets', '.nojekyll']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
console.log('Static site built in dist/');
