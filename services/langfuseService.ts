/**
 * Langfuse tracing service using OpenTelemetry-based v4 SDK
 *
 * Note: @langfuse/otel is designed for Node.js. For browser environments,
 * we use the OpenTelemetry web SDK with a custom exporter that sends to Langfuse.
 * Context propagation is handled by @langfuse/tracing's startActiveObservation.
 */

import { startActiveObservation, propagateAttributes } from "@langfuse/tracing";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import {
  resourceFromAttributes,
  defaultResource,
} from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

const initializeLangfuse = async (): Promise<void> => {
  if (isInitialized) {
    return;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      const otlpEndpoint = "/api/langfuse/traces";

      const exporter = new OTLPTraceExporter({
        url: otlpEndpoint,
      });

      const resource = defaultResource().merge(
        resourceFromAttributes({
          [SemanticResourceAttributes.SERVICE_NAME]: "tfl-expense-calculator",
          [SemanticResourceAttributes.SERVICE_VERSION]: "1.0.0",
        })
      );

      const spanProcessor = new BatchSpanProcessor(exporter, {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 30000,
      });

      const provider = new WebTracerProvider({
        resource,
        spanProcessors: [spanProcessor],
      });

      provider.register();
      isInitialized = true;

      // Expose for manual flushing if needed
      (
        window as Window & { __langfuseSpanProcessor?: typeof spanProcessor }
      ).__langfuseSpanProcessor = spanProcessor;
    } catch (error) {
      console.error("[Langfuse] Failed to initialize:", error);
      throw error;
    }
  })();

  return initializationPromise;
};

// Auto-initialize when module is imported
if (typeof window !== "undefined") {
  initializeLangfuse().catch(() => {});
}

const waitForInitialization = async (): Promise<boolean> => {
  if (isInitialized) return true;
  if (initializationPromise) {
    try {
      await initializationPromise;
      return isInitialized;
    } catch {
      return false;
    }
  }
  return false;
};

let initChecked = false;
const ensureInitialized = async () => {
  if (!initChecked) {
    initChecked = true;
    await waitForInitialization();
  }
};

/**
 * Start a new trace for the expense calculation workflow
 */
export const startExpenseTrace = <T>(
  sessionId?: string,
  userId?: string,
  metadata?: Record<string, string>
) => {
  return async (
    operation: (rootSpan: {
      startObservation: (name: string, opts: unknown) => unknown;
      update: (data: unknown) => void;
    }) => Promise<T>
  ): Promise<T> => {
    await ensureInitialized();

    return await startActiveObservation(
      "process-tfl-journey-statement",
      async (span) => {
        span.update({
          input: { sessionId, userId, metadata },
        });

        if (sessionId || userId || metadata) {
          return await propagateAttributes(
            {
              sessionId,
              userId,
              metadata: metadata
                ? Object.fromEntries(
                    Object.entries(metadata).map(([k, v]) => [k, String(v)])
                  )
                : undefined,
              tags: ["expense-calculator", "gemini"],
            },
            async () => {
              try {
                const result = await operation(span);
                span.update({ output: { success: true } });
                return result;
              } catch (error: unknown) {
                const err = error as Error;
                span.update({ output: { error: err.message } });
                throw error;
              }
            }
          );
        } else {
          try {
            const result = await operation(span);
            span.update({ output: { success: true } });
            return result;
          } catch (error: unknown) {
            const err = error as Error;
            span.update({ output: { error: err.message } });
            throw error;
          }
        }
      }
    );
  };
};

/**
 * Create a generation observation for Gemini API calls
 */
export const traceGeminiCall = async <T>(
  name: string,
  model: string,
  input: unknown,
  apiCall: () => Promise<T>,
  metadata?: Record<string, string>,
  parent?: {
    startObservation: (
      name: string,
      opts: unknown,
      options?: unknown
    ) => { update: (data: unknown) => void; end: () => void };
  }
): Promise<T> => {
  await ensureInitialized();

  const createObservation = parent
    ? (
        name: string,
        callback: (span: { update: (data: unknown) => void }) => Promise<T>,
        opts?: unknown
      ) => {
        const child = parent.startObservation(
          name,
          {
            model,
            input,
            metadata: { ...metadata, service: "gemini-service" },
          },
          opts
        );
        return callback(child).finally(() => child.end());
      }
    : startActiveObservation;

  return await createObservation(
    name,
    async (span: { update: (data: unknown) => void }) => {
      span.update({
        model,
        input,
        metadata: { ...metadata, service: "gemini-service" },
      });

      try {
        const startTime = Date.now();
        const result = await apiCall();
        const duration = Date.now() - startTime;

        let output: unknown;
        let usageDetails:
          | { input: number; output: number; total: number }
          | undefined = undefined;

        if (typeof result === "object" && result !== null) {
          const resultObj = result as Record<string, unknown>;
          if ("usageMetadata" in resultObj) {
            const usage = resultObj.usageMetadata as {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
            };
            usageDetails = {
              input: usage.promptTokenCount || 0,
              output:
                usage.candidatesTokenCount ||
                (usage.totalTokenCount || 0) - (usage.promptTokenCount || 0) ||
                0,
              total: usage.totalTokenCount || 0,
            };
          }

          if ("text" in resultObj) {
            output = { text: resultObj.text };
          } else if ("response" in resultObj) {
            output = { response: resultObj.response };
          } else {
            output = result;
          }
        } else {
          output = { response: result };
        }

        span.update({
          output,
          usageDetails,
          metadata: {
            ...metadata,
            service: "gemini-service",
            status: "success",
            duration: String(duration),
          },
        });

        return result;
      } catch (error: unknown) {
        const err = error as Error;
        span.update({
          output: { error: err.message },
          metadata: { ...metadata, service: "gemini-service", status: "error" },
        });
        throw error;
      }
    },
    { asType: "generation" }
  );
};

/**
 * Create a span for file processing operations
 */
export const traceFileProcessing = async <T>(
  name: string,
  input: unknown,
  operation: (parent?: {
    startObservation: (
      name: string,
      opts: unknown
    ) => { update: (data: unknown) => void; end: () => void };
  }) => Promise<T>,
  metadata?: Record<string, string>,
  parent?: {
    startObservation: (
      name: string,
      opts: unknown
    ) => { update: (data: unknown) => void; end: () => void };
  }
): Promise<T> => {
  await ensureInitialized();

  const createObservation = parent
    ? (
        name: string,
        callback: (span: {
          update: (data: unknown) => void;
          end: () => void;
        }) => Promise<T>
      ) => {
        const child = parent.startObservation(name, { input, metadata });
        return callback(child).finally(() => child.end());
      }
    : startActiveObservation;

  return await createObservation(
    name,
    async (span: { update: (data: unknown) => void }) => {
      span.update({ input, metadata });

      try {
        const result = await operation(
          span as unknown as {
            startObservation: (
              name: string,
              opts: unknown
            ) => { update: (data: unknown) => void; end: () => void };
          }
        );
        span.update({
          output: result,
          metadata: { ...metadata, status: "success" },
        });
        return result;
      } catch (error: unknown) {
        const err = error as Error;
        span.update({
          output: { error: err.message },
          metadata: { ...metadata, status: "error" },
        });
        throw error;
      }
    }
  );
};
