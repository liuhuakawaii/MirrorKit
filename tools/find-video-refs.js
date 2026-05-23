const fs = require('fs');
const path = require('path');
const { ROOT, TEXT_EXTS } = require('../config');

const VIDEO_RE = /["'`]([^"'`]+?\.(?:mp4|webm|mov|m3u8)(?:\?[^"'`]*)?)["'`]/gi;

function walk(dir, output = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath, output);
        else output.push(fullPath);
    }
    return output;
}

for (const filePath of walk(ROOT)) {
    if (filePath.includes(`${path.sep}tools${path.sep}`)) continue;
    if (!TEXT_EXTS.has(path.extname(filePath).toLowerCase())) continue;

    const text = fs.readFileSync(filePath, 'utf8');
    const matches = [...new Set([...text.matchAll(VIDEO_RE)].map(match => match[1]))];
    if (!matches.length) continue;

    console.log(`\n${path.relative(ROOT, filePath)}: ${matches.length}`);
    for (const item of matches.slice(0, 200)) {
        console.log(item);
    }
}
