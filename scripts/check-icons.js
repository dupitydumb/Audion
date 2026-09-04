import fs from 'fs';
import path from 'path';

function findSvelteFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.svelte-kit' && file !== 'build') {
        findSvelteFiles(filePath, fileList);
      }
    } else if (file.endsWith('.svelte')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const svelteFiles = findSvelteFiles(path.resolve('src'));
const violations = [];

for (const file of svelteFiles) {
  if (path.basename(file) === 'Icon.svelte') continue;
  const content = fs.readFileSync(file, 'utf8');
  // Look for inline svg tags that are not part of known exempt third-party brand icons or internal helpers
  if (/<svg\b/i.test(content)) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (/<svg\b/i.test(line)) {
        violations.push({ file: path.relative(process.cwd(), file), line: idx + 1, snippet: line.trim() });
      }
    });
  }
}

if (violations.length > 0) {
  console.log(`[check:icons] Found ${violations.length} raw <svg> tags across components (target: Icon.svelte usage):`);
  for (const v of violations.slice(0, 20)) {
    console.log(`  ${v.file}:${v.line} -> ${v.snippet}`);
  }
  if (violations.length > 20) {
    console.log(`  ... and ${violations.length - 20} more.`);
  }
} else {
  console.log('[check:icons] All clear! No raw <svg> tags outside Icon.svelte.');
}
