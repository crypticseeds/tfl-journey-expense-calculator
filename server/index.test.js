import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./index";

const servers = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve)))
  );
});

const startApp = async (options) => {
  const server = createApp(options).listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
};

const request = (baseUrl, body) =>
  fetch(`${baseUrl}/api/gemini/generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const validRequest = {
  model: "gemini-3.5-flash-lite",
  contents: { parts: [{ text: "statement" }] },
};

describe("Gemini endpoint", () => {
  it("rejects JSON bodies over 10 MB", async () => {
    const baseUrl = await startApp({ geminiApiKey: "test" });
    const response = await request(baseUrl, {
      ...validRequest,
      contents: "x".repeat(10 * 1024 * 1024),
    });

    expect(response.status).toBe(413);
  });

  it("returns 400 for a POST without a JSON body", async () => {
    const baseUrl = await startApp({ geminiApiKey: "test" });
    const response = await fetch(`${baseUrl}/api/gemini/generateContent`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Missing required fields: model and contents",
    });
  });

  it("rejects models outside the allowlist", async () => {
    const fetchImpl = vi.fn();
    const baseUrl = await startApp({ geminiApiKey: "test", fetchImpl });
    const response = await request(baseUrl, {
      ...validRequest,
      model: "gemini-unapproved",
    });

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caches normalized responses for identical requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "one" }] } }],
        }),
        { status: 200 }
      )
    );
    const baseUrl = await startApp({ geminiApiKey: "test", fetchImpl });

    const first = await request(baseUrl, validRequest);
    const second = await request(baseUrl, validRequest);

    expect(await first.json()).toEqual({
      text: "one",
      response: { candidates: [{ content: { parts: [{ text: "one" }] } }] },
    });
    expect(await second.json()).toEqual({
      text: "one",
      response: { candidates: [{ content: { parts: [{ text: "one" }] } }] },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the final upstream response after exhausting retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    const baseUrl = await startApp({
      geminiApiKey: "test",
      fetchImpl,
      retryOptions: { backoffMs: 0 },
    });
    const response = await request(baseUrl, validRequest);

    expect(response.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("Gemini model allowlist", () => {
  it("accepts gemini-3.5-flash-lite", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        }),
        { status: 200 }
      )
    );
    const baseUrl = await startApp({ geminiApiKey: "test", fetchImpl });
    const response = await request(baseUrl, validRequest);

    expect(response.status).toBe(200);
  });

  it("rejects gemini-3.1-flash-lite", async () => {
    const fetchImpl = vi.fn();
    const baseUrl = await startApp({ geminiApiKey: "test", fetchImpl });
    const response = await request(baseUrl, {
      ...validRequest,
      model: "gemini-3.1-flash-lite",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported model" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("static frontend", () => {
  const dirs = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  });

  const makeStaticDir = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tfl-static-"));
    dirs.push(dir);
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), '<div id="root"></div>');
    writeFileSync(path.join(dir, "assets", "app.js"), "console.log(1);");
    return dir;
  };

  it("serves index.html at /", async () => {
    const baseUrl = await startApp({
      geminiApiKey: "test",
      staticDir: makeStaticDir(),
    });
    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
  });

  it("serves static assets", async () => {
    const baseUrl = await startApp({
      geminiApiKey: "test",
      staticDir: makeStaticDir(),
    });
    const response = await fetch(`${baseUrl}/assets/app.js`);

    expect(response.status).toBe(200);
  });

  it("serves index.html for unknown GET paths", async () => {
    const baseUrl = await startApp({
      geminiApiKey: "test",
      staticDir: makeStaticDir(),
    });
    const response = await fetch(`${baseUrl}/some/deep/link`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
  });

  it("returns 404 for a missing asset", async () => {
    const baseUrl = await startApp({
      geminiApiKey: "test",
      staticDir: makeStaticDir(),
    });
    const response = await fetch(`${baseUrl}/assets/missing.js`);

    expect(response.status).toBe(404);
  });

  it("serves index.html when only a non-final segment has a dot", async () => {
    const baseUrl = await startApp({
      geminiApiKey: "test",
      staticDir: makeStaticDir(),
    });
    const response = await fetch(`${baseUrl}/a.b/c`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
  });

  it("does not fall back for /api paths", async () => {
    const baseUrl = await startApp({
      geminiApiKey: "test",
      staticDir: makeStaticDir(),
    });
    const response = await fetch(`${baseUrl}/api/unknown`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("serves no static files when staticDir is unset", async () => {
    const baseUrl = await startApp({ geminiApiKey: "test" });
    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(404);
  });
});
