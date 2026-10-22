#!/usr/bin/env node
// 打包 MCP server 成单文件，并生成安装脚本要用的 latest.json。
//
// 产物（dist/）会被 Dockerfile 复制进镜像的 public/download/mcp/，由同一个容器
// 对外提供 —— 用户一条命令下载即可用，不经过 npm、也不需要 npm 账号。
//
//   node build.mjs        打 dist/server.mjs + dist/latest.json + 两个安装脚本

import { build } from "esbuild";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"));
const source = readFileSync(join(HERE, "server.mjs"), "utf8");
const sourceVersion = /const VERSION = "([^"]+)"/.exec(source)?.[1];

// 版本号有两处（package.json 和 server.mjs 的常量，后者会被打进单文件），
// 一旦漂移就会出现"提示更新却下载到同一个版本"，所以构建时直接卡住。
if (!sourceVersion) fail("server.mjs 里找不到 `const VERSION = \"...\"`");
if (sourceVersion !== pkg.version) {
  fail(
    `版本不一致：server.mjs 的 VERSION=${sourceVersion}，package.json=${pkg.version}`
  );
}

mkdirSync(DIST, { recursive: true });

await build({
  entryPoints: [join(HERE, "server.mjs")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: join(DIST, "server.mjs"),
  logLevel: "warning",
});

const bundled = join(DIST, "server.mjs");
const body = readFileSync(bundled);
// 装到 Unix 上直接 `./server.mjs` 也能跑。
chmodSync(bundled, 0o755);

const latest = {
  name: pkg.name,
  version: pkg.version,
  file: "server.mjs",
  sha256: createHash("sha256").update(body).digest("hex"),
  size: statSync(bundled).size,
  builtAt: new Date().toISOString(),
};
writeFileSync(join(DIST, "latest.json"), JSON.stringify(latest, null, 2) + "\n");

for (const script of ["install.ps1", "install.sh"]) {
  copyFileSync(join(HERE, script), join(DIST, script));
}

console.log(
  `✓ ${pkg.name}@${pkg.version} → dist/server.mjs（${(body.length / 1024).toFixed(0)} kB）`
);
console.log(`  sha256 ${latest.sha256}`);
