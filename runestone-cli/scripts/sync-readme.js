const fs = require('fs');
const path = require('path');

const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..');
const source = path.join(repoRoot, 'README.md');
const target = path.join(packageRoot, 'README.md');

const repoUrl = 'https://github.com/cymondez/runestone';
const repoRef = process.env.RUNESTONE_README_REPO_REF || 'main';
const blobBase = `${repoUrl}/blob/${repoRef}`;
const rawBase = `https://raw.githubusercontent.com/cymondez/runestone/${repoRef}`;

if (!fs.existsSync(source)) {
  throw new Error(`README source not found: ${source}`);
}

let content = fs.readFileSync(source, 'utf8');

content = content
  .replace(/\]\(docs\/README\/README\.zh-TW\.md\)/g, `](${blobBase}/docs/README/README.zh-TW.md)`)
  .replace(/\]\(docs\/README\/README\.ja-JP\.md\)/g, `](${blobBase}/docs/README/README.ja-JP.md)`)
  .replace(/\]\(logos\/runestone_icon_gray_large\.png\)/g, `](${rawBase}/logos/runestone_icon_gray_large.png)`);

fs.writeFileSync(target, content, 'utf8');
console.log(`Synced README.md from ${path.relative(packageRoot, source)} to ${path.relative(packageRoot, target)}`);
