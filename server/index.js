import express from "express";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLruCache, createRateLimiter, fetchWithRetry } from "./utils.js";

const PRODUCTION = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || (PRODUCTION ? 8080 : 3001);
const ALLOWED_GEMINI_MODELS = new Set(["gemini-3.5-flash-lite"]);
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute per IP

export const createApp = ({
  geminiApiKey = process.env.GEMINI_API_KEY,
  fetchImpl = fetch,
  retryOptions = {},
  responseCache = createLruCache(50),
  staticDir,
} = {}) => {
  const app = express();
  const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
  const langfuseBaseUrl =
    process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com";
  const trustProxyHops = Number.parseInt(
    process.env.TRUST_PROXY_HOPS || "0",
    10
  );
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
  }
  const rateLimit = createRateLimiter({
    windowMs: RATE_LIMIT_WINDOW,
    maxRequests: RATE_LIMIT_MAX,
  });

  // Middleware
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });

  app.post(
    "/api/langfuse/traces",
    rateLimit,
    express.raw({
      type: ["application/x-protobuf", "application/json"],
      limit: "5mb",
    }),
    async (req, res) => {
      if (!langfusePublicKey || !langfuseSecretKey) {
        return res.status(204).end();
      }

      try {
        const response = await fetchWithRetry(
          `${langfuseBaseUrl.replace(/\/$/, "")}/api/public/otel/v1/traces`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                req.get("Content-Type") || "application/x-protobuf",
              Authorization: `Basic ${Buffer.from(`${langfusePublicKey}:${langfuseSecretKey}`).toString("base64")}`,
            },
            body: req.body,
          },
          { ...retryOptions, fetchImpl }
        );
        res
          .status(response.status)
          .send(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        console.error("Langfuse proxy error:", error);
        res.status(502).json({ error: "Langfuse request failed" });
      }
    }
  );
  // Add request logging for debugging
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "gemini-proxy" });
  });

  // Secure proxy endpoint for Gemini API
  app.post(
    "/api/gemini/generateContent",
    rateLimit,
    express.json({ limit: "10mb" }),
    async (req, res) => {
      try {
        const { model, contents, config } = req.body;

        // Validate required fields
        if (!model || !contents) {
          return res.status(400).json({
            error: "Missing required fields: model and contents",
          });
        }

        if (!ALLOWED_GEMINI_MODELS.has(model)) {
          return res.status(400).json({ error: "Unsupported model" });
        }

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        // Prepare the request body for Gemini API
        // Map config properties to Gemini API format
        const generationConfig = {};
        if (config) {
          if (config.responseMimeType) {
            generationConfig.responseMimeType = config.responseMimeType;
          }
          if (config.responseSchema) {
            generationConfig.responseSchema = config.responseSchema;
          }
          if (config.thinkingConfig) {
            generationConfig.thinkingConfig = config.thinkingConfig;
          }
        }

        const geminiRequestBody = {
          contents: contents,
          ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
        };
        const requestBody = JSON.stringify(geminiRequestBody);
        const cacheKey = `${model}:${requestBody}`;
        const cachedResponse = responseCache.get(cacheKey);
        if (cachedResponse) return res.json(cachedResponse);

        // Forward the request to Google's Gemini API
        const response = await fetchWithRetry(
          geminiUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": geminiApiKey,
            },
            body: requestBody,
          },
          { ...retryOptions, fetchImpl }
        );

        if (!response.ok) {
          console.error("Gemini API error:", response.status);
          return res.status(response.status).json({
            error: "Gemini API request failed",
          });
        }

        const data = await response.json();

        // Return the response in a format compatible with the client
        const normalizedResponse = {
          text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
          response: data,
        };
        if (normalizedResponse.text) {
          responseCache.set(cacheKey, normalizedResponse);
        }
        res.json(normalizedResponse);
      } catch (error) {
        console.error("Proxy error:", error);
        const timedOut = error.name === "AbortError";
        res.status(timedOut ? 504 : 502).json({
          error: timedOut
            ? "Gemini API request timed out"
            : "Gemini API unavailable",
        });
      }
    }
  );

  if (staticDir) {
    app.use("/api", (req, res) => {
      res.status(404).json({ error: "Not found" });
    });
    app.use(express.static(staticDir));
    app.get(/^\/(?!health$).*/, (req, res) => {
      res.sendFile(path.join(path.resolve(staticDir), "index.html"));
    });
  }

  return app;
};

// Start server
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.error("ERROR: GEMINI_API_KEY environment variable is not set");
    process.exit(1);
  }

  const staticDir = PRODUCTION
    ? path.join(import.meta.dirname, "..", "dist")
    : undefined;

  createApp({ geminiApiKey, staticDir }).listen(PORT, () => {
    console.log(`🔒 Secure Gemini API proxy server running on port ${PORT}`);
    console.log("   API key configured: ✅");
  });
}
