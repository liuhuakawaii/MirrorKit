// ====== MirrorKit 统一配置 ======
// 换网站时只需要改这一个文件。
// 所有环境变量仍然可以覆盖这些值。

const path = require('path');

// 项目根目录（config.js 所在的目录）
const ROOT = __dirname;

// ------ 核心站点配置 ------
const TARGET_HOST = process.env.TARGET_HOST || 'https://carstenmell.com';
const MIRROR_NAME = process.env.MIRROR_NAME || 'carstenmell.com';
const START_PATH = process.env.START_PATH || '/';
const PORT = Number(process.env.PORT || 3000);

// ------ 超时与并发 ------
const TIMEOUT_MS = Number(process.env.MIRROR_TIMEOUT_MS || 30000);
const CONCURRENCY = Number(process.env.MIRROR_CONCURRENCY || 6);

// ------ CMS 补充下载（仅 mirror-cms-media.js 使用）------
const CMS_HOST = process.env.CMS_MEDIA_HOST || '';

// ------ 批量下载种子 URL ------
const SEED_URLS = [START_PATH];

// ------ 远程资源前缀映射 ------
const REMOTE_MIRRORS = [];

// ------ 可下载文件扩展名 ------
const ASSET_EXTS = [
    'avif', 'bin', 'css', 'gif', 'html', 'ico', 'jpg', 'jpeg', 'js', 'json',
    'ktx', 'ktx2', 'm3u8', 'm4s', 'mjs', 'mov', 'mp3', 'mp4', 'otf', 'png',
    'svg', 'ts', 'ttf', 'wasm', 'wav', 'webm', 'webp', 'woff', 'woff2', 'zip'
];

// ------ 二进制文件头校验 ------
const MAGIC_BYTES = {
    '.png': [0x89, 0x50, 0x4e, 0x47],
    '.jpg': [0xff, 0xd8, 0xff],
    '.jpeg': [0xff, 0xd8, 0xff],
    '.gif': [0x47, 0x49, 0x46],
    '.webp': [0x52, 0x49, 0x46, 0x46],
    '.wasm': [0x00, 0x61, 0x73, 0x6d],
    '.woff': [0x77, 0x4f, 0x46, 0x46],
    '.woff2': [0x77, 0x4f, 0x46, 0x32],
    '.ktx': [0xab, 0x4b, 0x54, 0x58],
    '.ktx2': [0xab, 0x4b, 0x54, 0x58]
};

// ------ MIME 类型 ------
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.wasm': 'application/wasm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.otf': 'font/opentype',
    '.ttf': 'font/ttf',
    '.bin': 'application/octet-stream',
    '.ktx': 'image/ktx',
    '.ktx2': 'image/ktx2',
    '.zip': 'application/zip'
};

// ------ 文件扩展名分类 ------
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);
const TEXT_EXTS = new Set(['.html', '.js', '.mjs', '.json', '.css', '.svg', '.txt', '.m3u8']);

// ------ 通用路径 ------
const MIRROR_DIR = path.join(ROOT, MIRROR_NAME);

module.exports = {
    ROOT,
    TARGET_HOST,
    MIRROR_NAME,
    START_PATH,
    PORT,
    TIMEOUT_MS,
    CONCURRENCY,
    CMS_HOST,
    SEED_URLS,
    REMOTE_MIRRORS,
    ASSET_EXTS,
    MAGIC_BYTES,
    MIME_TYPES,
    IMAGE_EXTS,
    TEXT_EXTS,
    MIRROR_DIR
};
