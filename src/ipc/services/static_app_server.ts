import fs from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function isStaticHtmlApp(appPath: string): boolean {
  return (
    fs.existsSync(path.join(appPath, "index.html")) &&
    !fs.existsSync(path.join(appPath, "package.json"))
  );
}

export async function startStaticAppServer({
  appPath,
  port,
}: {
  appPath: string;
  port: number;
}): Promise<Server> {
  const root = path.resolve(appPath);
  const fallback = path.join(root, "index.html");
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
      const requestedPath = path.resolve(root, `.${pathname}`);
      const insideRoot =
        requestedPath === root ||
        requestedPath.startsWith(`${root}${path.sep}`);
      let filePath = insideRoot ? requestedPath : fallback;

      let stat = await fs.promises.stat(filePath).catch(() => null);
      if (stat?.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        stat = await fs.promises.stat(filePath).catch(() => null);
      }
      if (!stat?.isFile()) {
        filePath = fallback;
      }

      response.statusCode = 200;
      response.setHeader(
        "Content-Type",
        CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
          "application/octet-stream",
      );
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

export function stopStaticAppServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
