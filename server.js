const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const {
    TARGET_HOST, MIRROR_NAME, START_PATH, PORT, TIMEOUT_MS,
    REMOTE_MIRRORS, MAGIC_BYTES, MIME_TYPES, IMAGE_EXTS, ROOT
} = require('./config');

const REQUEST_TIMEOUT_MS = TIMEOUT_MS;
const BUILTIN_REMOTE_MIRRORS = [];

const IGNORED_PATH_PREFIXES = [
    '/.well-known/',
    '/bb-mcp'
];

const SITE_PATH_PREFIXES = new Set([
    'content',
    'etc.clientlibs',
    'experiment',
    'webui',
    'auth',
    'graphql'
]);

function looksLikeMirroredRemoteHost(segment) {
    return /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(segment);
}

const REWRITE_TEXT_EXTS = new Set(['.html', '.css']);
const EXTERNAL_URL_REWRITE_TEXT_EXTS = new Set(['.js', '.mjs', '.json']);
const REWRITE_ASSET_EXTS = [
    'avif', 'bin', 'css', 'gif', 'html', 'ico', 'jpg', 'jpeg', 'js', 'json',
    'ktx', 'ktx2', 'mjs', 'mov', 'mp3', 'mp4', 'otf', 'png', 'svg', 'ttf',
    'wasm', 'wav', 'webm', 'webp', 'woff', 'woff2'
];

function isMirrorRequest(reqPath) {
    return reqPath === `/${MIRROR_NAME}` || reqPath.startsWith(`/${MIRROR_NAME}/`);
}

function stripMirrorPrefix(reqPath) {
    if (reqPath === `/${MIRROR_NAME}`) return '/';
    return reqPath.slice(MIRROR_NAME.length + 1) || '/';
}

function isRoutePath(reqPath) {
    return path.extname(reqPath) === '';
}

function isHtmlLike(buffer) {
    const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<title>');
}

function hasExpectedMagic(filePath, buffer) {
    const ext = path.extname(filePath).toLowerCase();
    const magic = MAGIC_BYTES[ext];
    if (!magic) return true;
    if (buffer.length < magic.length) return false;
    return magic.every((byte, index) => buffer[index] === byte);
}

function isValidCachedResponse(filePath, response, buffer) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (isHtmlLike(buffer) && ext !== '.html' && ext !== '') {
        return false;
    }

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

    return hasExpectedMagic(filePath, buffer);
}

function ensureDirExists(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getLocalPath(reqPath) {
    const baseDir = ROOT;
    let safePath = decodeURIComponent(reqPath);

    if (!isMirrorRequest(safePath)) {
        safePath = path.posix.join('/', MIRROR_NAME, safePath);
    }

    const targetPath = stripMirrorPrefix(safePath);
    if (isRoutePath(targetPath)) {
        safePath = path.posix.join(safePath, 'index.html');
    }

    const normalizedPath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, '');
    const localPath = path.join(baseDir, normalizedPath);
    const resolvedBase = path.resolve(baseDir);
    const resolvedLocal = path.resolve(localPath);

    if (!resolvedLocal.startsWith(resolvedBase)) {
        return null;
    }

    return localPath;
}

function getContentType(filePath, data) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext && data && isHtmlLike(data)) return MIME_TYPES['.html'];
    return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveLocalFile(filePath, res) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Error reading file: ${err.code}`);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        if (REWRITE_TEXT_EXTS.has(ext) || ext === '') {
            data = Buffer.from(rewriteTextForLocalMirror(data.toString('utf8')));
        } else if (EXTERNAL_URL_REWRITE_TEXT_EXTS.has(ext)) {
            data = Buffer.from(rewriteExternalUrlsForLocalMirror(data.toString('utf8')));
        }

        res.writeHead(200, {
            'Content-Type': getContentType(filePath, data),
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
    });
}

function getMirrorEntryPath() {
    const startPath = START_PATH.startsWith('/') ? START_PATH : `/${START_PATH}`;
    return startPath === '/' ? `/${MIRROR_NAME}/` : `/${MIRROR_NAME}${startPath}`;
}

function serveStarterPage(res) {
    const filePath = path.join(ROOT, 'index.html');
    fs.readFile(filePath, 'utf8', (err, text) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Error reading file: ${err.code}`);
            return;
        }

        const config = {
            targetHost: TARGET_HOST,
            mirrorName: MIRROR_NAME,
            startPath: START_PATH,
            entryPath: getMirrorEntryPath()
        };

        const html = text.replace(
            'window.__MIRROR_CONFIG__ = null;',
            `window.__MIRROR_CONFIG__ = ${JSON.stringify(config)};`
        );

        res.writeHead(200, {
            'Content-Type': MIME_TYPES['.html'],
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(html);
    });
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTargetHostName() {
    return new URL(TARGET_HOST).hostname;
}

function getLocalUrlPrefixForHost(host, slash) {
    const separator = slash === '\\/' ? '\\/' : '/';

    if (host === getTargetHostName()) {
        return `${separator}${MIRROR_NAME}${separator}`;
    }

    return `${separator}${MIRROR_NAME}${separator}${host}${separator}`;
}

function rewriteExternalUrlsForLocalMirror(text) {
    const plainUrl = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/)/gi;
    const escapedUrl = /\bhttps?:\\\/\\\/([a-z0-9.-]+\.[a-z]{2,})(\\\/)/gi;

    return text
        .replace(plainUrl, (match, host, slash) => getLocalUrlPrefixForHost(host, slash))
        .replace(escapedUrl, (match, host, slash) => getLocalUrlPrefixForHost(host, slash));
}

function rewriteTextForLocalMirror(text) {
    const extGroup = REWRITE_ASSET_EXTS.join('|');
    const mirror = escapeRegExp(MIRROR_NAME);
    const assetUrl = new RegExp('https?:\\/\\/([^/"\\\'\\s)]+)(\\/[^"\\\'\\s)]+?\\.(?:' + extGroup + ')(?:\\?[^"\\\'\\s)]*)?)', 'gi');
    const rootAsset = new RegExp('(["\\\'(=])\\/(?!\\/|' + mirror + '\\/)([^"\\\'\\s)]+?\\.(?:' + extGroup + ')(?:\\?[^"\\\'\\s)]*)?)', 'gi');
    const rootRoute = new RegExp('(["\\\'=])\\/(?!\\/|' + mirror + '\\/)([a-z]{2}(?:-[a-z]{2})?(?:\\/[^"\\\'\\s<)]*)?)', 'gi');

    return rewriteExternalUrlsForLocalMirror(text)
        .replaceAll(TARGET_HOST, `/${MIRROR_NAME}`)
        .replace(assetUrl, (match, host, assetPath) => `/${MIRROR_NAME}/${host}${assetPath}`)
        .replace(rootAsset, (match, prefix, assetPath) => `${prefix}/${MIRROR_NAME}/${assetPath}`)
        .replace(rootRoute, (match, prefix, routePath) => `${prefix}/${MIRROR_NAME}/${routePath}`);
}

async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

function getRemoteMirror(reqPath) {
    return [...REMOTE_MIRRORS, ...BUILTIN_REMOTE_MIRRORS].find(mirror => reqPath.startsWith(mirror.prefix));
}

function getGoogleStorageTargetUrl(reqPath, search) {
    const parts = reqPath.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    if (parts[0] === 'storage.googleapis.com') {
        return `https://storage.googleapis.com/${parts.slice(1).join('/')}${search}`;
    }

    if (/^[a-z0-9-]+\.appspot\.com$/i.test(parts[0])) {
        return `https://storage.googleapis.com/${parts[0]}/${parts.slice(1).join('/')}${search}`;
    }

    return null;
}

function getTargetUrl(req, reqPath) {
    const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
    const targetPath = isMirrorRequest(reqPath) ? stripMirrorPrefix(reqPath) : reqPath;
    const mirror = getRemoteMirror(targetPath);

    if (mirror) {
        return `${mirror.origin}${targetPath.slice(mirror.prefix.length - 1)}${requestUrl.search}`;
    }

    const gcsUrl = getGoogleStorageTargetUrl(targetPath, requestUrl.search);
    if (gcsUrl) return gcsUrl;

    const parts = targetPath.split('/').filter(Boolean);
    if (parts.length > 1 && looksLikeMirroredRemoteHost(parts[0]) && !SITE_PATH_PREFIXES.has(parts[0])) {
        return `https://${parts[0]}/${parts.slice(1).join('/')}${requestUrl.search}`;
    }

    return `${TARGET_HOST}${targetPath}${requestUrl.search}`;
}

async function proxyAndCache(req, res, localPath, reqPath) {
    const targetUrl = getTargetUrl(req, reqPath);
    console.log(`\x1b[33m[Cache Miss] ${req.url} -> ${targetUrl}\x1b[0m`);

    try {
        const response = await fetchWithTimeout(targetUrl);

        if (!response.ok) {
            console.error(`\x1b[31m[Failed] Origin status ${response.status}: ${req.url}\x1b[0m`);
            res.writeHead(response.status, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Origin responded with status: ${response.status}`);
            return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (!isValidCachedResponse(localPath, response, buffer)) {
            const contentType = response.headers.get('content-type') || 'unknown';
            console.error(`\x1b[31m[Rejected] Not caching unexpected content for ${req.url} (${contentType})\x1b[0m`);
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Rejected unexpected content for ${req.url}`);
            return;
        }

        ensureDirExists(localPath);
        fs.writeFileSync(localPath, buffer);
        console.log(`\x1b[32m[Saved] ${localPath}\x1b[0m`);

        res.writeHead(200, {
            'Content-Type': getContentType(localPath, buffer),
            'Access-Control-Allow-Origin': '*'
        });
        res.end(buffer);
    } catch (err) {
        const status = err.name === 'AbortError' ? 504 : 500;
        console.error(`\x1b[31m[Error] ${req.url}: ${err.message}\x1b[0m`);
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Proxy error: ${err.message}`);
    }
}

const server = http.createServer(async (req, res) => {
    if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
    }

    const reqPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;

    if (reqPath === '/__mirror-config.json') {
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
            targetHost: TARGET_HOST,
            mirrorName: MIRROR_NAME,
            startPath: START_PATH,
            entryPath: getMirrorEntryPath()
        }));
        return;
    }

    if (reqPath === '/index.html') {
        serveStarterPage(res);
        return;
    }

    if (IGNORED_PATH_PREFIXES.some(prefix => reqPath === prefix || reqPath.startsWith(prefix))) {
        res.writeHead(204);
        res.end();
        return;
    }

    const localPath = getLocalPath(reqPath);
    if (!localPath) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        serveLocalFile(localPath, res);
        return;
    }

    await proxyAndCache(req, res, localPath, reqPath);
});

server.listen(PORT, () => {
    console.log('\n==========================================================');
    console.log('\x1b[36m  Offline Mirror - Local Proxy & Crawler Server\x1b[0m');
    console.log('==========================================================');
    console.log(`Target host: \x1b[32m${TARGET_HOST}\x1b[0m`);
    console.log(`Mirror folder: \x1b[32m${MIRROR_NAME}\x1b[0m`);
    console.log(`Local starter: \x1b[32mhttp://localhost:${PORT}/\x1b[0m`);
    console.log(`Mirror entry: \x1b[32mhttp://localhost:${PORT}${getMirrorEntryPath()}\x1b[0m`);
    console.log(`Request timeout: ${REQUEST_TIMEOUT_MS}ms`);
    console.log('Unexpected HTML fallback responses will not be cached as assets.');
    console.log('----------------------------------------------------------\n');

    const url = `http://localhost:${PORT}/`;
    const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${startCmd} ${url}`, (err) => {
        if (err) console.error('Failed to auto-open browser:', err.message);
    });
});
