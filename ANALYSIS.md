# MirrorKit 项目深度分析

## 项目概述

MirrorKit 是一个**零依赖的本地网站镜像框架**，基于 Node.js 内置模块构建。它的核心功能是将目标网站的全部资源（HTML、CSS、JS、图片、字体、视频等）下载到本地文件夹，并通过本地代理服务器提供离线浏览能力。

**核心工作流（四步规则）：**
1. 所有资源请求优先查找本地文件
2. 本地不存在时，从远程网站获取
3. 获取成功后，缓存到本地
4. 后续请求直接读取本地文件

**适用场景：** 学习研究、技术分析、本地测试、离线浏览

**许可证：** AGPL-3.0-or-later

---

## 项目结构

```
MirrorKit/
├── .gitignore
├── LICENSE                      # AGPL-3.0 许可证
├── README.md                    # 中文文档（591 行）
├── README_EN.md                 # 英文文档（582 行）
├── index.html                   # 启动页/着陆页
├── server.js                    # 核心代理服务器（507 行）
├── unsupported.html             # 浏览器不支持时的回退页面
├── 一键启动服务器.bat             # Windows 双击启动脚本
└── tools/
    ├── mirror-assets.js         # 批量资源下载器（435 行）
    ├── mirror-cms-media.js      # CMS/媒体补充下载器（508 行）
    ├── find-video-refs.js       # 视频引用扫描器（39 行）
    └── validate-assets.js       # 缓存验证工具（119 行）
```

---

## 核心文件详解

### 1. `server.js` — 核心代理服务器

这是项目的**主入口**，基于 Node.js `http` 模块构建的 HTTP 服务器。

**主要功能：**
- 监听端口 3000（可通过 `PORT` 环境变量配置）
- 在 `/` 路径提供启动页，动态注入镜像配置
- 在 `/__mirror-config.json` 提供配置 JSON 端点
- 将请求路径映射到本地 `MIRROR_NAME` 目录下的文件
- 自动检测路由路径（无文件扩展名），保存为 `index.html`
- 本地文件不存在时，从远程获取、验证、缓存、返回
- **URL 重写**：将 HTML/CSS 中的远程 URL 改写为本地镜像路径
- **Magic Byte 验证**：检查 PNG、JPG、GIF、WebP、WASM、WOFF 等文件头签名
- 自动打开浏览器

**关键配置变量（文件顶部）：**

| 变量 | 说明 | 示例 |
|------|------|------|
| `TARGET_HOST` | 目标网站源（协议+域名） | `https://example.com` |
| `MIRROR_NAME` | 本地存储文件夹名 | `example.com` |
| `START_PATH` | 入口路径 | `/` |
| `PORT` | 服务器端口 | `3000` |
| `REQUEST_TIMEOUT_MS` | 请求超时时间 | `30000` |
| `REMOTE_MIRRORS` | 手动远程资源前缀映射 | `{}` |
| `SITE_PATH_PREFIXES` | 内部站点路径前缀 | `['etc.clientlibs']` |
| `IGNORED_PATH_PREFIXES` | 忽略的路径前缀 | `['/.well-known/']` |

**URL 重写策略：**

| 文件类型 | 重写方式 |
|----------|----------|
| HTML/CSS | 完整重写：远程 URL → 本地镜像路径 |
| JS/JSON | 仅替换外部 URL 前缀（避免破坏压缩代码） |
| 二进制/图片 | 原样返回，不做重写 |

---

### 2. `tools/mirror-assets.js` — 批量资源下载器

**独立的预下载工具**，用于在启动服务器前批量下载网站资源。

**工作原理：**
- 从种子 URL（默认 `START_PATH`）开始，递归发现资源
- 使用正则表达式从 HTML、JS、CSS、JSON 中提取资源路径
- 最多运行 **4 轮**扫描，每轮下载新发现的资源后再扫描
- **并发下载**：默认 6 个并发工作线程
- 验证下载文件的 Magic Byte 签名
- 支持 `--retry-bad` 重新下载验证失败的文件

**CLI 用法：**
```bash
node tools/mirror-assets.js              # 正常下载
node tools/mirror-assets.js --retry-bad  # 重新下载失败的文件
```

**关键配置：**

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TIMEOUT_MS` | 请求超时 | `30000` |
| `CONCURRENCY` | 并发数 | `6` |
| `SEED_URLS` | 额外入口页 | `[]` |
| `ASSET_EXTS` | 可下载文件扩展名 | 图片/字体/视频等 |
| `REMOTE_ASSET_PREFIXES` | CDN 前缀 | `[]` |

---

### 3. `tools/mirror-cms-media.js` — CMS/媒体补充下载器

专门处理**隐藏在 CMS JSON 端点、远程存储桶或带缓存版本号的应用文件**中的媒体资源。

**特殊能力：**
- 扫描 `index.html` 和应用 bundle 文件名中的 `_CACHE_` 模式
- 探测 CMS JSON 端点（`metadata`、`contact`、`projects`）
- 扫描已缓存的 JS/data 文件中的媒体引用
- 同样支持 4 轮递归扫描和 `--retry-bad`

**CLI 用法：**
```bash
node tools/mirror-cms-media.js              # 正常下载
node tools/mirror-cms-media.js --retry-bad  # 重新下载失败的文件
```

**额外配置：**

| 变量 | 说明 |
|------|------|
| `CMS_HOST` | 远程 CMS/存储桶源 |

---

### 4. `tools/find-video-refs.js` — 视频引用扫描器

轻量级工具，扫描所有本地文本文件中的视频引用（`.mp4`、`.webm`、`.mov`、`.m3u8`），仅报告不下载。

```bash
node tools/find-video-refs.js
```

---

### 5. `tools/validate-assets.js` — 缓存验证工具

扫描本地 `assets/` 目录，报告可能损坏的缓存文件：
- 非 HTML 文件内容以 `<!doctype html>` 或 `<html>` 开头
- JSON 文件解析失败
- 二进制文件的 Magic Byte 与扩展名不匹配

```bash
node tools/validate-assets.js
# 退出码 2 表示发现问题
```

---

### 6. `index.html` — 启动页

双语（中/英）着陆页，展示：
- 目标网站信息
- 镜像文件夹名称
- 可点击的镜像入口链接
- 语言切换按钮（持久化到 `localStorage`）

---

## 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | **18+**（需要内置 `fetch` API） |
| npm 依赖 | **无**（零依赖，全部使用内置模块） |
| 浏览器 | 任何现代浏览器（Chrome、Edge、Firefox） |

**使用的 Node.js 内置模块：**
- `http` — HTTP 服务器
- `fs` — 文件系统操作
- `path` — 路径处理
- `child_process` — 自动打开浏览器

---

## 使用指南

### 场景一：普通网站镜像（推荐流程）

```bash
# 1. 编辑配置（保持 server.js 和 tools/mirror-assets.js 一致）
#    修改 TARGET_HOST、MIRROR_NAME、START_PATH

# 2. 批量下载资源
node tools/mirror-assets.js

# 3. 启动服务器
node server.js
# 或双击 一键启动服务器.bat

# 4. 浏览器打开 http://localhost:3000/
```

### 场景二：含 CMS 媒体的网站

```bash
# 1. 编辑配置（三个文件保持一致）
#    额外配置 tools/mirror-cms-media.js 中的 CMS_HOST

# 2. 批量下载资源
node tools/mirror-assets.js

# 3. 补充下载 CMS 媒体
node tools/mirror-cms-media.js

# 4. 启动服务器
node server.js

# 5. 浏览器打开 http://localhost:3000/
```

### 场景三：懒加载模式（边浏览边缓存）

```bash
# 跳过批量下载，直接启动服务器
node server.js

# 浏览网站时，缺失资源会自动获取并缓存
# 适合快速预览或资源较少的网站
```

### 场景四：修复损坏的缓存

```bash
# 1. 验证缓存
node tools/validate-assets.js

# 2. 重新下载验证失败的文件
node tools/mirror-assets.js --retry-bad

# 3. 如有 CMS 媒体
node tools/mirror-cms-media.js --retry-bad
```

### 场景五：重新镜像

```bash
# 1. 删除镜像文件夹
rm -rf <MIRROR_NAME>

# 2. 确保配置一致，重新运行下载脚本
node tools/mirror-assets.js
```

---

## 环境变量覆盖

所有配置都支持环境变量覆盖：

| 环境变量 | 对应配置 | 适用文件 |
|----------|----------|----------|
| `TARGET_HOST` | 目标网站源 | 全部 |
| `MIRROR_NAME` | 镜像文件夹名 | 全部 |
| `START_PATH` | 入口路径 | 全部 |
| `PORT` | 服务器端口 | server.js |
| `PROXY_TIMEOUT_MS` | 代理超时 | server.js |
| `MIRROR_TIMEOUT_MS` | 下载超时 | mirror-assets.js |
| `MIRROR_CONCURRENCY` | 下载并发数 | mirror-assets.js |
| `CMS_MEDIA_HOST` | CMS 主机 | mirror-cms-media.js |

**示例：**
```bash
TARGET_HOST=https://mysite.com MIRROR_NAME=mysite PORT=8080 node server.js
```

---

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│                    浏览器                            │
│              http://localhost:3000                   │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│               server.js (代理服务器)                  │
│                                                     │
│  1. 检查本地 MIRROR_NAME/ 目录是否有请求的文件        │
│  2. 有 → 直接返回（URL 重写后）                      │
│  3. 没有 → 从 TARGET_HOST 获取                      │
│  4. 验证 → 缓存到本地 → 返回给浏览器                 │
└─────────────────────────────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
┌────────┐  ┌──────────┐  ┌──────────────┐
│ 本地   │  │ 远程网站  │  │ tools/       │
│ 文件   │  │ (源站)   │  │ 预下载工具    │
│ 系统   │  │          │  │              │
└────────┘  └──────────┘  └──────────────┘
```

**预下载工具工作流：**
```
mirror-assets.js ──┐
                   ├──→ 本地文件系统（共享缓存）
mirror-cms-media.js┘
```

---

## 工具链总结

| 工具 | 用途 | 是否下载 | 是否需要配置 |
|------|------|----------|-------------|
| `server.js` | 代理服务器 + 懒加载缓存 | 按需 | `TARGET_HOST`, `MIRROR_NAME`, `START_PATH` |
| `mirror-assets.js` | 批量预下载资源 | 是 | 同上 |
| `mirror-cms-media.js` | CMS 媒体补充下载 | 是 | 同上 + `CMS_HOST` |
| `find-video-refs.js` | 扫描视频引用 | 否 | 无 |
| `validate-assets.js` | 验证缓存完整性 | 否 | 无 |

---

## 注意事项

1. **配置一致性**：`server.js` 和 `tools/mirror-assets.js` 中的 `TARGET_HOST`、`MIRROR_NAME`、`START_PATH` 必须保持一致
2. **Node.js 版本**：必须 18+，因为使用了内置的 `fetch` API
3. **编码问题**：部分网站可能使用非 UTF-8 编码，可能需要额外处理
4. **视频资源**：视频文件通常较大，`find-video-refs.js` 可以帮助定位但不会自动下载
5. **合法使用**：项目仅用于学习研究、技术分析和本地测试，请遵守相关法律法规
6. **Magic Byte 验证**：下载工具会自动验证文件头签名，避免将错误页面保存为资源文件

---

## 与传统镜像工具的区别

| 特性 | MirrorKit | wget --mirror | HTTrack |
|------|-----------|---------------|---------|
| 零依赖 | ✅ | ❌ | ❌ |
| 运行时代理 | ✅ | ❌ | ❌ |
| 懒加载缓存 | ✅ | ❌ | ❌ |
| URL 实时重写 | ✅ | 静态重写 | 静态重写 |
| Magic Byte 验证 | ✅ | ❌ | ❌ |
| CMS 媒体支持 | ✅ | ❌ | ❌ |
| 并发下载 | ✅ | ✅ | ✅ |

MirrorKit 的核心优势在于**运行时代理 + 懒加载缓存**的模式：不需要预先下载所有资源，可以在浏览过程中逐步缓存，同时通过 URL 重写确保离线时链接仍然有效。
