import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isStaticHtmlApp,
  startStaticAppServer,
  stopStaticAppServer,
} from "./static_app_server";

const temporaryDirectories: string[] = [];

function get(url: string): Promise<{
  body: string;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ body, headers: response.headers }));
      })
      .on("error", reject);
  });
}

async function createApp(files: Record<string, string>): Promise<string> {
  const appPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "crackerbox-static-app-"),
  );
  temporaryDirectories.push(appPath);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(appPath, relativePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, contents);
  }
  return appPath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe("static app preview", () => {
  it("recognizes an index-only app but leaves package-based apps alone", async () => {
    const staticApp = await createApp({ "index.html": "static" });
    const packageApp = await createApp({
      "index.html": "package",
      "package.json": "{}",
    });

    expect(isStaticHtmlApp(staticApp)).toBe(true);
    expect(isStaticHtmlApp(packageApp)).toBe(false);
  });

  it("serves assets and falls back to index.html for app routes", async () => {
    const appPath = await createApp({
      "index.html": "<h1>Cut Once</h1>",
      "styles/app.css": "body { color: green; }",
    });
    const server = await startStaticAppServer({ appPath, port: 0 });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Static preview did not bind to a TCP port");
    }

    try {
      const origin = `http://127.0.0.1:${address.port}`;
      const indexResponse = await get(`${origin}/drawing/one`);
      const assetResponse = await get(`${origin}/styles/app.css`);

      expect(indexResponse.body).toBe("<h1>Cut Once</h1>");
      expect(indexResponse.headers["content-type"]).toBe(
        "text/html; charset=utf-8",
      );
      expect(assetResponse.body).toBe("body { color: green; }");
      expect(assetResponse.headers["content-type"]).toBe(
        "text/css; charset=utf-8",
      );
    } finally {
      await stopStaticAppServer(server);
    }
  });
});
