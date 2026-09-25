// Node entry point for self-hosted (Docker) deployment: adapts node:http to the
// same Web-standard `fetch(request, env)` handler the Cloudflare Worker exports,
// and serves the built front-end from the same origin so no CORS split-brain.
//
// Route dispatch is unchanged (see route.ts), so the API keeps answering on the
// root paths the Worker uses (`/login`, `/books`, ...) AND on `/api/...`, which
// is what the same-origin web build calls.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createMysqlDatabase, type DatabaseHandle } from "./db/mysql";
import { handler } from "./index";

/** Max request body we buffer before rejecting (a whole-book replace is large). */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "./public");
/** Trust X-Forwarded-For / X-Real-IP (only when a reverse proxy fronts us). */
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

const db: DatabaseHandle = createMysqlDatabase({
  host: requireEnv("DB_HOST"),
  port: Number(process.env.DB_PORT ?? 3306),
  user: requireEnv("DB_USER"),
  password: requireEnv("DB_PASSWORD"),
  database: requireEnv("DB_NAME"),
});

const env: Env = {
  DB: db.DB,
  TOKEN_SECRET: requireEnv("TOKEN_SECRET"),
  REFRESH_SECRET: requireEnv("REFRESH_SECRET"),
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function contentType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Absolute URL for the handler: it parses `new URL(request.url)`. */
function requestUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? `localhost:${PORT}`;
  return `http://${host}${req.url ?? "/"}`;
}

/**
 * The app reads the client IP from `CF-Connecting-IP` (set by Cloudflare for the
 * Worker). Here we synthesise it: from the proxy header when TRUST_PROXY is on,
 * otherwise from the socket — guessing an untrusted XFF would let a client
 * defeat the per-IP login throttle.
 */
function clientIp(req: IncomingMessage): string {
  const socketIp = req.socket.remoteAddress ?? "";
  if (!TRUST_PROXY) return socketIp;
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(",")[0]
    ?.trim();
  return first || (req.headers["x-real-ip"] as string) || socketIp;
}

function headersFor(req: IncomingMessage, ip: string): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(key, item);
    }
  }
  headers.set("cf-connecting-ip", ip);
  return headers;
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("payload too large"), { status: 413 });
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(req: IncomingMessage, ip: string): Promise<Request> {
  const body = await readBody(req);
  return new Request(requestUrl(req), {
    method: req.method ?? "GET",
    headers: headersFor(req, ip),
    body,
  });
}

function isApiRequest(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return true;
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Drop the `/api` prefix so the same router serves both mount points. */
function apiPath(pathname: string): string {
  if (pathname === "/api") return "/";
  if (pathname.startsWith("/api/")) return pathname.slice(4) || "/";
  return pathname;
}

/**
 * Join an already-decoded URL path onto STATIC_DIR without allowing traversal
 * (`.` + normalize collapses any `..` before it can escape the root).
 */
function safeJoin(root: string, pathname: string): string | null {
  if (pathname.includes("\0")) return null;
  const target = resolve(root, `.${normalize(pathname)}`);
  return target === root || target.startsWith(root + sep) ? target : null;
}

function sendFile(
  res: ServerResponse,
  filePath: string,
  immutable: boolean
): void {
  const { size } = statSync(filePath);
  res.writeHead(200, {
    "content-type": contentType(filePath),
    "content-length": size,
    // Vite fingerprints everything under /assets, so those can be cached hard.
    "cache-control": immutable
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  createReadStream(filePath).pipe(res);
}

/**
 * Serve a static file; unknown paths without a file extension fall back to
 * index.html so the SPA's client-side router owns them.
 */
function serveStatic(pathname: string, res: ServerResponse): void {
  const index = join(STATIC_DIR, "index.html");
  const target = safeJoin(STATIC_DIR, pathname === "/" ? "/index.html" : pathname);
  if (target && existsSync(target) && statSync(target).isFile()) {
    return sendFile(res, target, pathname.startsWith("/assets/"));
  }
  if (extname(pathname)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }
  if (!existsSync(index)) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("front-end build not found: run the web build first");
    return;
  }
  sendFile(res, index, false);
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = await toWebRequest(req, clientIp(req));
  const response = await handler.fetch(request, env);
  const body = Buffer.from(await response.arrayBuffer());
  const headers = new Headers(response.headers);
  headers.set("content-length", String(body.length));
  res.writeHead(response.status, Object.fromEntries(headers));
  res.end(req.method === "HEAD" ? undefined : body);
}

/** Liveness + DB reachability, for the container healthcheck. */
async function handleHealth(res: ServerResponse): Promise<void> {
  let dbOk = false;
  try {
    await env.DB.prepare(`select 1 as ok`).first();
    dbOk = true;
  } catch (error) {
    console.error("health: database unreachable", error);
  }
  const body = Buffer.from(
    JSON.stringify({ status: dbOk ? "ok" : "error", database: dbOk })
  );
  res.writeHead(dbOk ? 200 : 503, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  res.end(body);
}

const server = createServer((req, res) => {
  const method = req.method ?? "GET";
  const fullUrl = req.url ?? "/";
  const rawPath = fullUrl.split("?")[0] ?? "/";
  const query = fullUrl.slice(rawPath.length);
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400).end("Bad Request");
    return;
  }

  const run = async (): Promise<void> => {
    if (rawPath === "/health" || rawPath === "/api/health") {
      await handleHealth(res);
      return;
    }
    if (isApiRequest(method, rawPath)) {
      // Re-mount onto the path shape the router expects (raw, still URL-encoded).
      req.url = apiPath(rawPath) + query;
      await handleApi(req, res);
      return;
    }
    serveStatic(pathname, res);
  };

  run().catch((error: unknown) => {
    const status = (error as { status?: number }).status ?? 500;
    console.error("request failed", error);
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        code: status,
        message: status === 413 ? "请求体过大" : "服务端异常",
        data: null,
      })
    );
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`received ${signal}, shutting down`);
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
  });
}

server.listen(PORT, HOST, () => {
  console.log(`writing-assistant listening on http://${HOST}:${PORT}`);
  console.log(`static root: ${STATIC_DIR}`);
});
