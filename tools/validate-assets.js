const fs = require('fs');
const path = require('path');
const { ROOT, MAGIC_BYTES, TEXT_EXTS, MIRROR_DIR, MIRROR_NAME } = require('../config');

const JSON_EXTS = new Set(['.json']);
const COMPATIBLE_FALLBACKS = new Set([]);

function walk(dir, output = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, output);
        } else {
            output.push(fullPath);
        }
    }
    return output;
}

function isHtmlLike(buffer) {
    const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<title>');
}

function hasMagic(buffer, magic) {
    if (buffer.length < magic.length) return false;
    return magic.every((byte, index) => buffer[index] === byte);
}

function validateFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const buffer = fs.readFileSync(filePath);
    const relativePath = path.relative(MIRROR_DIR, filePath).replace(/\\/g, '/');

    if (!TEXT_EXTS.has(ext) && isHtmlLike(buffer)) {
        return 'html-fallback';
    }

    if (JSON_EXTS.has(ext)) {
        try {
            JSON.parse(buffer.toString('utf8'));
        } catch {
            return 'invalid-json';
        }
    }

    const magic = MAGIC_BYTES[ext];
    if (magic && COMPATIBLE_FALLBACKS.has(relativePath)) {
        return null;
    }

    if (magic && !hasMagic(buffer, magic)) {
        return 'bad-magic';
    }

    return null;
}

function main() {
    if (!fs.existsSync(MIRROR_DIR)) {
        console.error(`Mirror directory not found: ${MIRROR_DIR}`);
        console.error(`Run mirror-assets.js first to download resources.`);
        process.exit(1);
    }

    const bad = [];
    for (const filePath of walk(MIRROR_DIR)) {
        const reason = validateFile(filePath);
        if (reason) {
            bad.push({ reason, filePath });
        }
    }

    if (!bad.length) {
        console.log(`No invalid cached assets found in ${MIRROR_NAME}/`);
        return;
    }

    for (const item of bad) {
        console.log(`${item.reason}\t${path.relative(ROOT, item.filePath)}`);
    }
    console.log(`\nInvalid cached assets: ${bad.length}`);
    process.exitCode = 2;
}

main();
