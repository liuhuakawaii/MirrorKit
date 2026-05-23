const fs = require('fs');
const path = require('path');
const {
    ROOT, TARGET_HOST, MIRROR_NAME, START_PATH, TIMEOUT_MS, CONCURRENCY,
    SEED_URLS, ASSET_EXTS, MAGIC_BYTES, IMAGE_EXTS, MIRROR_DIR
} = require('../config');

const REMOTE_ASSET_PREFIXES = [];
const BUILTIN_REMOTE_ASSET_PREFIXES = [
    'https://storage.googleapis.com/'
];

const args = new Set(process.argv.slice(2));
const SHOULD_RETRY_BAD = args.has('--retry-bad');

function readTextIfExists(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function isAssetUrl(value) {
    try {
        const url = new URL(value);
        const ext = path.extname(decodeURIComponent(url.pathname)).toLowerCase().slice(1);
        return ASSET_EXTS.includes(ext);
    } catch {
        return false;
    }
}

function normalizeAssetPath(rawPath) {
    if (!rawPath) return null;

    let value = rawPath
        .replace(/\\\//g, '/')
        .replace(/^['"`]+|['"`]+$/g, '')
        .trim();

    if (!value || value.includes('${') || value.includes('`') || value.includes('\n') || value.includes('\r')) {
        return null;
    }

    if (value.startsWith('//')) value = `https:${value}`;
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return isAssetUrl(value) ? value : null;
    }

    if (value.startsWith('/')) value = value.slice(1);

    const clean = value.split('#')[0].split('?')[0];
    const ext = path.extname(clean).toLowerCase().slice(1);
    if (!ASSET_EXTS.includes(ext)) return null;

    return clean;
}

function extractAssetPathsFromText(text) {
    const output = new Set();
    const extGroup = ASSET_EXTS.join('|');
    const patterns = [
        new RegExp('["\'`]([^"\'`]+?\\.(?:' + extGroup + ')(?:\\?[^"\'`]*)?)["\'`]', 'gi'),
        new RegExp('url\\(([^)]+?\\.(?:' + extGroup + ')(?:\\?[^)]*)?)\\)', 'gi'),
        new RegExp('(?:https?:\\/\\/[^"\'`\\s)]+|\\/[A-Za-z0-9_./%~@+\\-=]+)\\.(?:' + extGroup + ')(?:\\?[^"\'`\\s)]*)?', 'gi')
    ];

    for (const regex of patterns) {
        for (const match of text.matchAll(regex)) {
            const candidate = normalizeAssetPath(match[1] || match[0]);
            if (candidate) output.add(candidate);
        }
    }

    for (const prefix of getActiveRemoteAssetPrefixes()) {
        let cursor = 0;
        while (true) {
            const start = text.indexOf(prefix, cursor);
            if (start === -1) break;

            let end = start;
            while (end < text.length && !['"', "'", '<', '>', '\n', '\r'].includes(text[end])) {
                end++;
            }

            const candidate = text.slice(start, end).trim();
            if (isAssetUrl(candidate)) output.add(candidate);
            cursor = end + 1;
        }
    }

    return output;
}

function getActiveRemoteAssetPrefixes() {
    return new Set([...REMOTE_ASSET_PREFIXES, ...BUILTIN_REMOTE_ASSET_PREFIXES]);
}

function extractAssetPathsFromJson(value, output = new Set()) {
    if (Array.isArray(value)) {
        for (const item of value) extractAssetPathsFromJson(item, output);
        return output;
    }

    if (value && typeof value === 'object') {
        for (const item of Object.values(value)) extractAssetPathsFromJson(item, output);
        return output;
    }

    if (typeof value !== 'string') return output;

    const direct = normalizeAssetPath(value);
    if (direct) output.add(direct);

    for (const item of extractAssetPathsFromText(value)) {
        output.add(item);
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

function isValidDownload(localPath, response, buffer) {
    const ext = path.extname(localPath).toLowerCase();
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (isHtmlLike(buffer) && ext !== '.html' && ext !== '') return false;

    if (ext === '.json') {
        try {
            JSON.parse(buffer.toString('utf8'));
            return true;
        } catch {
            return false;
        }
    }

    if (ext === '.js' || ext === '.mjs') {
        return !contentType.includes('text/html');
    }

    if (IMAGE_EXTS.has(ext) && contentType.startsWith('image/')) {
        return true;
    }

    const magic = MAGIC_BYTES[ext];
    if (magic) return hasMagic(buffer, magic);

    return true;
}

function localPathForAsset(assetPath) {
    if (assetPath.startsWith('http://') || assetPath.startsWith('https://')) {
        const url = new URL(assetPath);
        const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html';
        return path.join(MIRROR_DIR, url.hostname, pathname);
    }

    const cleanPath = decodeURIComponent(assetPath.replace(/^\/+/, '')) || 'index.html';
    const finalPath = path.extname(cleanPath) ? cleanPath : path.posix.join(cleanPath, 'index.html');
    return path.join(MIRROR_DIR, finalPath);
}

function remoteUrlForAsset(assetPath) {
    if (assetPath.startsWith('http://') || assetPath.startsWith('https://')) {
        return assetPath;
    }
    return `${TARGET_HOST}/${assetPath.replace(/^\/+/, '')}`;
}

async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Referer: TARGET_HOST
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

function collectLocalSources() {
    const sources = [];
    const startLocalPath = localPathForAsset(START_PATH);

    for (const filePath of [
        path.join(MIRROR_DIR, 'index.html'),
        startLocalPath,
        path.join(ROOT, 'unsupported.html')
    ]) {
        if (fs.existsSync(filePath)) sources.push(filePath);
    }

    return sources;
}

function walk(dir, output = []) {
    if (!fs.existsSync(dir)) return output;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath, output);
        else output.push(fullPath);
    }
    return output;
}

function collectBadCachedAssets() {
    const bad = new Set();

    for (const filePath of walk(MIRROR_DIR)) {
        const relativePath = path.relative(MIRROR_DIR, filePath).replace(/\\/g, '/');
        const buffer = fs.readFileSync(filePath);
        const fakeResponse = { headers: { get: () => '' } };
        if (!isValidDownload(filePath, fakeResponse, buffer)) bad.add(relativePath);
    }

    return bad;
}

function collectInitialAssets() {
    const assets = new Set(SEED_URLS);

    for (const filePath of collectLocalSources()) {
        const text = readTextIfExists(filePath);
        for (const item of extractAssetPathsFromText(text)) assets.add(item);

        if (path.extname(filePath).toLowerCase() === '.json') {
            try {
                const json = JSON.parse(text);
                for (const item of extractAssetPathsFromJson(json)) assets.add(item);
            } catch {
            }
        }
    }

    if (SHOULD_RETRY_BAD) {
        for (const item of collectBadCachedAssets()) assets.add(item);
    }

    return assets;
}

async function downloadAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    const url = remoteUrlForAsset(assetPath);

    if (fs.existsSync(localPath) && !SHOULD_RETRY_BAD) {
        return { status: 'skip', assetPath };
    }

    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        return { status: 'fail', assetPath, message: `HTTP ${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!isValidDownload(localPath, response, buffer)) {
        return { status: 'reject', assetPath, message: response.headers.get('content-type') || 'unknown content-type' };
    }

    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
    return { status: 'save', assetPath, bytes: buffer.length };
}

async function runQueue(items, onResult) {
    const queue = [...items];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) {
            const item = queue.shift();
            try {
                onResult(await downloadAsset(item));
            } catch (err) {
                onResult({ status: 'error', assetPath: item, message: err.message });
            }
        }
    });
    await Promise.all(workers);
}

async function loadJsonAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    if (!fs.existsSync(localPath) || path.extname(localPath).toLowerCase() !== '.json') return null;
    try {
        return JSON.parse(readTextIfExists(localPath));
    } catch {
        return null;
    }
}

async function loadTextAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    const ext = path.extname(localPath).toLowerCase();
    if (!fs.existsSync(localPath) || !['.html', '.js', '.mjs', '.css', '.json', '.txt', ''].includes(ext)) return null;

    try {
        const buffer = fs.readFileSync(localPath);
        if (buffer.includes(0)) return null;
        return buffer.toString('utf8');
    } catch {
        return null;
    }
}

async function main() {
    const pending = collectInitialAssets();
    const seen = new Set();
    const stats = { save: 0, skip: 0, fail: 0, reject: 0, error: 0 };

    for (let pass = 1; pass <= 4; pass++) {
        const batch = [...pending].filter(item => !seen.has(item));
        if (!batch.length) break;
        batch.forEach(item => seen.add(item));

        console.log(`\nPass ${pass}: ${batch.length} resources`);
        await runQueue(batch, result => {
            stats[result.status] = (stats[result.status] || 0) + 1;
            const suffix = result.message ? ` (${result.message})` : '';
            console.log(`${result.status.padEnd(6)} ${result.assetPath}${suffix}`);
        });

        for (const item of batch) {
            const json = await loadJsonAsset(item);
            if (json) {
                for (const assetPath of extractAssetPathsFromJson(json)) {
                    if (!seen.has(assetPath)) pending.add(assetPath);
                }
                continue;
            }

            const text = await loadTextAsset(item);
            if (!text) continue;
            for (const assetPath of extractAssetPathsFromText(text)) {
                if (!seen.has(assetPath)) pending.add(assetPath);
            }
        }
    }

    console.log('\nDone.');
    console.log(stats);
    console.log(`Mirror folder: ${MIRROR_DIR}`);
    console.log(`Scanned unique resources: ${seen.size}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
