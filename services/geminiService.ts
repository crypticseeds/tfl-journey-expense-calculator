import { Type } from "@google/genai";
import { TravelEntry } from "../types";
import { traceGeminiCall, traceFileProcessing } from "./langfuseService";
import { runWithConcurrency } from "./concurrency";
import { createOcrSession } from "./ocr";

// File reading utilities
const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        // result is "data:mime/type;base64,..."
        resolve(reader.result.split(",")[1]);
      } else {
        reject(new Error("Failed to read file as base64 string."));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file as text."));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });
};

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file as ArrayBuffer."));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

// Secure client-side proxy for Gemini API calls
// This service calls our backend proxy instead of Google's API directly,
// ensuring the API key never leaves the server.

interface GenerateContentRequest {
  model: string;
  contents: unknown;
  config?: {
    responseMimeType?: string;
    responseSchema?: unknown;
    thinkingConfig?: unknown;
  };
}

interface GenerateContentResponse {
  text: string;
  response: unknown;
}

// The API is always served from the same origin (Vite proxy in dev).
const API_BASE_URL = "/api";

export const buildGenerateContentUrl = (apiBaseUrl = API_BASE_URL): string =>
  `${apiBaseUrl.replace(/\/$/, "")}/gemini/generateContent`;

/**
 * Generate content using Gemini API via secure backend proxy
 */
export const generateContent = async (
  request: GenerateContentRequest
): Promise<GenerateContentResponse> => {
  const url = buildGenerateContentUrl(API_BASE_URL);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        contents: request.contents,
        config: request.config,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.error ||
          error.message ||
          `HTTP ${response.status}: ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error: unknown) {
    // Handle network errors (backend not running, CORS, etc.)
    const err = error as Error;
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      throw new Error(
        `Cannot connect to backend server at ${API_BASE_URL}. ` +
          `Please ensure the backend proxy server is running. ` +
          `Run 'pnpm run dev:server' or 'pnpm run dev:all' to start it.`
      );
    }
    // Re-throw other errors as-is
    throw err;
  }
};

// Rebuild PDF page text with preserved line structure, grouping by Y position
export function rebuildPageTextWithLineBreaks(textContent: {
  items?: Array<{ str?: string; transform?: number[]; matrix?: number[] }>;
}): string {
  const items = (textContent?.items ?? []) as Array<{
    str?: string;
    transform?: number[];
    matrix?: number[];
  }>;
  type Line = { y: number; parts: { x: number; str: string }[] };
  const lines: Line[] = [];
  const yThreshold = 2; // tolerance for grouping into same visual line

  for (const item of items) {
    const tr = item.transform ?? item.matrix ?? [0, 0, 0, 0, 0, 0];
    const x = tr[4] ?? 0;
    const y = tr[5] ?? 0;
    let line = lines.find((l) => Math.abs(l.y - y) <= yThreshold);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, str: String(item.str ?? "") });
  }

  // Sort top-to-bottom (PDF y origin is bottom-left)
  lines.sort((a, b) => b.y - a.y);
  const outLines = lines
    .map((l) =>
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  return outLines.join("\n");
}

// Heuristic parser to recover journeys from raw text by inheriting date headers
export function parseJourneysHeuristically(text: string): TravelEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const monthMap: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    sept: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const datePatterns: RegExp[] = [
    /(\d{4})-(\d{2})-(\d{2})/, // 2025-10-14
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*\s+(\d{4})/i, // 14 Oct 2025
    /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*(?:\s+(\d{4}))?/i, // Tue 14 Oct [2025]
  ];

  function toISO(y: string, m: string | number, d: string) {
    const mm =
      typeof m === "number" ? m : monthMap[m.slice(0, 3).toLowerCase()];
    return `${y}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  let currentDate: string | null = null;
  const out: TravelEntry[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    // Detect a date header
    let matched: string | null = null;

    let m = line.match(datePatterns[0]);
    if (m) matched = toISO(m[1], parseInt(m[2], 10), m[3]);

    if (!matched) {
      m = line.match(datePatterns[1]);
      if (m) matched = toISO(m[3], m[2], m[1]);
    }

    if (!matched) {
      m = line.match(datePatterns[2]);
      if (m) {
        const y = m[4] || `${new Date().getFullYear()}`;
        matched = toISO(y, m[3], m[2]);
      }
    }

    if (matched) currentDate = matched;

    // Skip non-journey lines (caps/totals/topups/refunds/credits)
    if (
      /cap|capped|daily cap|weekly cap|total|payment|auto\s*top\s*up|auto\s*topup|refund|credit|adjustment/i.test(
        line
      )
    ) {
      continue;
    }

    // Extract amount
    const amt = line.match(/£?\s*(\d+\.\d{2})\b/);
    if (amt && currentDate) {
      const amount = parseFloat(amt[1]);
      if (!isNaN(amount) && amount > 0) out.push({ date: currentDate, amount });
    }
  }

  return out;
}

// Merge two entry sets keeping the maximum count per (date, amount) to avoid double counting or losing duplicates
export function mergeEntriesByMaxCount(
  a: TravelEntry[],
  b: TravelEntry[]
): TravelEntry[] {
  const key = (e: TravelEntry) => `${e.date}|${e.amount.toFixed(2)}`;
  const count = (arr: TravelEntry[]) => {
    const m = new Map<string, number>();
    for (const e of arr) {
      const k = key(e);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  const keys = new Set<string>([
    ...Array.from(ca.keys()),
    ...Array.from(cb.keys()),
  ]);
  const result: TravelEntry[] = [];
  for (const k of keys) {
    const n = Math.max(ca.get(k) || 0, cb.get(k) || 0);
    if (n > 0) {
      const [date, amountStr] = k.split("|");
      const amount = parseFloat(amountStr);
      for (let i = 0; i < n; i++) {
        result.push({ date, amount });
      }
    }
  }
  return result;
}

export function mergeDisjointChunks(chunks: TravelEntry[][]): TravelEntry[] {
  return chunks.flat();
}

// CSV parser for daily totals: expects lines with date and total; accepts multiple date formats and £
export function parseCsvToTravelEntries(text: string): TravelEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const out: TravelEntry[] = [];
  const header = lines[0].toLowerCase();
  const hasHeader =
    /(date|journey|day)/.test(header) &&
    /(amount|total|charge|cost)/.test(header);
  const startIdx = hasHeader ? 1 : 0;

  function toISODate(s: string): string | null {
    s = s.trim();
    // ISO
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // dd/mm/yyyy or dd/mm/yy
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${String(parseInt(m[2], 10)).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
    }
    // 14 Oct 2025 or 14-Oct-2025
    m = s.match(
      /^(\d{1,2})[ -](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*[ -](\d{4})$/i
    );
    if (m) {
      const monthMap: Record<string, number> = {
        jan: 1,
        feb: 2,
        mar: 3,
        apr: 4,
        may: 5,
        jun: 6,
        jul: 7,
        aug: 8,
        sep: 9,
        sept: 9,
        oct: 10,
        nov: 11,
        dec: 12,
      };
      const mm = monthMap[m[2].slice(0, 3).toLowerCase()];
      return `${m[3]}-${String(mm).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
    }
    return null;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const row = lines[i];
    const cols = row
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)|;|\t/)
      .map((c) => c.replace(/^"|"$/g, "").trim());
    if (cols.length < 2) continue;
    // try first col as date
    let date = toISODate(cols[0]);
    if (!date) continue; // Skip if date is invalid

    // find amount in remaining cols (skip first column which is the date)
    let amount: number | null = null;
    for (let j = 1; j < cols.length; j++) {
      const col = cols[j].trim();
      // Match numbers (positive or negative), extract the numeric value
      // Handles: "-7.2", "7.2", "- 7.2", "£7.2", "-£7.2", etc.
      const match = col.match(/^[-]?\s*£?\s*(\d+(?:\.\d{1,2})?)\s*$/);
      if (match && match[1]) {
        const parsedAmount = parseFloat(match[1]);
        // Ensure we have a valid positive number
        if (!isNaN(parsedAmount) && parsedAmount > 0) {
          amount = parsedAmount;
          break; // Use first matching amount found
        }
      }
    }
    if (date && amount !== null && !isNaN(amount) && amount > 0) {
      out.push({ date, amount });
    }
  }
  return out;
}

const travelDataSchema = {
  type: Type.OBJECT,
  properties: {
    expenses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: {
            type: Type.STRING,
            description: "The date of the travel expense in YYYY-MM-DD format.",
          },
          amount: {
            type: Type.NUMBER,
            description: "The cost of the travel expense as a number.",
          },
        },
        required: ["date", "amount"],
      },
    },
  },
};

const PROMPT = `
You are an expert data extraction agent for TfL contactless/Oyster statements (possibly OCR'd).
Extract EVERY individual journey charge (one JSON item per journey). Aggregation to daily/monthly totals is handled downstream.

CRITICAL:
- Dates are often printed once followed by multiple journey lines; subsequent journeys inherit the most recent date header until a new date appears.
- Output date as YYYY-MM-DD. Output amount as a positive number (no currency symbols).
- Strictly IGNORE non-journey lines: any line containing (case-insensitive): cap, capped, daily cap, weekly cap, total, payment, auto top up, auto topup, refund, credit, adjustment.
- Do NOT output daily or weekly totals; only individual journeys.

Return ONLY JSON in this schema:
{ "expenses": [ { "date": "YYYY-MM-DD", "amount": 0.00 }, ... ] }
`;

const CHUNK_PROMPT = `
You are an expert data extraction agent for TfL contactless/Oyster statements (possibly OCR'd).
This is a CHUNK of a larger document. Extract EVERY individual journey charge from this section.

CRITICAL:
- Dates are often printed once followed by multiple journey lines; subsequent journeys inherit the most recent date header until a new date appears.
- If this chunk starts without a date header, use the preceding context supplied before the chunk to inherit its date.
- Output date as YYYY-MM-DD. Output amount as a positive number (no currency symbols).
- Strictly IGNORE non-journey lines: any line containing (case-insensitive): cap, capped, daily cap, weekly cap, total, payment, auto top up, auto topup, refund, credit, adjustment.
- Do NOT output daily or weekly totals; only individual journeys.

Return ONLY JSON in this schema:
{ "expenses": [ { "date": "YYYY-MM-DD", "amount": 0.00 }, ... ] }
`;

export function addPreviousPageContext(
  pageTexts: string[],
  pagesPerChunk: number
): Array<{ context?: string; pages: string[] }> {
  const chunks: Array<{ context?: string; pages: string[] }> = [];
  for (let start = 0; start < pageTexts.length; start += pagesPerChunk) {
    chunks.push({
      context: start === 0 ? undefined : pageTexts[start - 1],
      pages: pageTexts.slice(start, start + pagesPerChunk),
    });
  }
  return chunks;
}

// Process a single PDF chunk (2-4 pages) through Gemini
async function processPdfChunk(
  pages: string[],
  previousPageContext: string | undefined,
  chunkIndex: number,
  totalChunks: number,
  model: string,
  onProgressUpdate: (message: string) => void,
  fileSpan?: {
    startObservation: (
      name: string,
      opts: unknown
    ) => { update: (data: unknown) => void; end: () => void };
  }
): Promise<TravelEntry[]> {
  const chunkText = pages.join("\n\n");
  const contextInstruction = previousPageContext
    ? `\n\nPRECEDING PAGE FOR DATE CONTEXT ONLY. Do not extract or output journeys from this section:\n${previousPageContext}\n\nCURRENT CHUNK TO EXTRACT:\n`
    : "\n\nCURRENT CHUNK TO EXTRACT:\n";
  const chunkPrompt =
    totalChunks > 1
      ? `${CHUNK_PROMPT}\n\nThis is chunk ${chunkIndex + 1} of ${totalChunks} from the document.`
      : PROMPT;

  onProgressUpdate(`Processing chunk ${chunkIndex + 1} of ${totalChunks}...`);

  const response = await traceGeminiCall(
    `gemini-extract-chunk-${chunkIndex + 1}`,
    model,
    { chunkIndex: String(chunkIndex + 1), totalChunks: String(totalChunks) },
    async () => {
      return await generateContent({
        model: model,
        contents: {
          parts: [
            { text: `${chunkPrompt}${contextInstruction}` },
            { text: chunkText },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: travelDataSchema,
          thinkingConfig: { thinkingBudget: 4096 },
        },
      });
    },
    { chunkIndex: String(chunkIndex + 1), totalChunks: String(totalChunks) },
    fileSpan || undefined
  );

  const jsonString = response.text;
  let parsedJson;
  try {
    parsedJson = JSON.parse(jsonString);
  } catch {
    console.error(
      `Failed to parse JSON response from chunk ${chunkIndex + 1}:`,
      jsonString
    );
    return []; // Return empty array for failed chunks, will be handled during merging
  }

  if (!parsedJson || !Array.isArray(parsedJson.expenses)) {
    return [];
  }

  // Validate entries
  const validEntries: TravelEntry[] = [];
  for (const item of parsedJson.expenses) {
    if (
      item &&
      typeof item.date === "string" &&
      typeof item.amount === "number" &&
      !isNaN(item.amount)
    ) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
        validEntries.push({ date: item.date, amount: item.amount });
      }
    }
  }

  return validEntries;
}

export const extractTravelDataFromFile = async (
  file: File,
  onProgressUpdate: (message: string) => void,
  parentSpan?: {
    startObservation: (
      name: string,
      opts: unknown
    ) => { update: (data: unknown) => void; end: () => void };
  }
): Promise<TravelEntry[]> => {
  return await traceFileProcessing(
    "extract-travel-data",
    { fileName: file.name, fileType: file.type },
    async (fileSpan?: {
      startObservation: (
        name: string,
        opts: unknown
      ) => { update: (data: unknown) => void; end: () => void };
    }) => {
      try {
        const model = "gemini-3.5-flash-lite";
        let contents;
        let rawTextForFallback = "";

        // Fast-path for CSV: parse locally
        if (file.type === "text/csv" || /\.csv$/i.test(file.name)) {
          onProgressUpdate("Processing CSV...");
          return await traceFileProcessing(
            "parse-csv",
            { fileName: file.name },
            async () => {
              const text = await readFileAsText(file);
              const csvEntries = parseCsvToTravelEntries(text);
              onProgressUpdate(`Found ${csvEntries.length} entries from CSV.`);
              return csvEntries;
            },
            undefined,
            fileSpan
          );
        }

        if (file.type === "application/pdf") {
          onProgressUpdate("Processing PDF...");
          const [
            { getDocument, GlobalWorkerOptions },
            { default: pdfWorkerSrc },
          ] = await Promise.all([
            import("pdfjs-dist"),
            import("pdfjs-dist/build/pdf.worker.mjs?worker&url"),
          ]);
          GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
          const arrayBuffer = await readFileAsArrayBuffer(file);
          const pdf = await getDocument({ data: arrayBuffer }).promise;

          // Read and render pages in parallel. A single reused OCR worker queues
          // sparse-page recognition while other pages continue preparing.
          const ocr = createOcrSession();
          const pageTasks = Array.from({ length: pdf.numPages }, (_, index) => {
            const pageNumber = index + 1;
            return async () => {
              onProgressUpdate(
                `Reading PDF page ${pageNumber} of ${pdf.numPages}...`
              );
              const page = await pdf.getPage(pageNumber);

              const textContent = await page.getTextContent();
              let pageText = rebuildPageTextWithLineBreaks(
                textContent as {
                  items?: Array<{
                    str?: string;
                    transform?: number[];
                    matrix?: number[];
                  }>;
                }
              );

              if (pageText.trim().length < 100) {
                onProgressUpdate(
                  `Page ${pageNumber} appears image-based. Starting OCR...`
                );
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d");
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: context, viewport }).promise;
                pageText = await ocr.recognizeText(canvas);
                onProgressUpdate(`OCR on page ${pageNumber} complete.`);
              }

              return pageText;
            };
          });
          let pageTexts: string[];
          try {
            pageTexts = await runWithConcurrency(pageTasks, 3);
          } finally {
            await ocr.release();
          }

          rawTextForFallback = pageTexts.join("\n\n");

          // Determine chunking strategy: 2-4 pages per chunk
          // For PDFs with <=4 pages, process as single chunk
          // For PDFs with >4 pages, use 2-4 pages per chunk (prefer 4 when possible)
          let pagesPerChunk: number;
          if (pdf.numPages <= 4) {
            pagesPerChunk = pdf.numPages; // Single chunk for small PDFs
          } else if (pdf.numPages <= 8) {
            pagesPerChunk = 2; // 2 pages per chunk for medium PDFs
          } else {
            pagesPerChunk = 4; // 4 pages per chunk for large PDFs
          }

          const chunks = addPreviousPageContext(pageTexts, pagesPerChunk);

          // Process chunks in parallel (limit to 3 concurrent)
          onProgressUpdate(
            `Processing ${chunks.length} chunk${chunks.length > 1 ? "s" : ""} in parallel...`
          );

          const chunkTasks = chunks.map(
            (chunk, chunkIndex) => () =>
              processPdfChunk(
                chunk.pages,
                chunk.context,
                chunkIndex,
                chunks.length,
                model,
                onProgressUpdate,
                fileSpan
              )
          );

          // Process with concurrency limit of 3
          const MAX_CONCURRENT_CHUNKS = 3;
          const chunkResults = await runWithConcurrency(
            chunkTasks,
            MAX_CONCURRENT_CHUNKS
          );

          // Merge all chunk results
          let mergedEntries = mergeDisjointChunks(chunkResults);

          // Apply heuristic fallback and return
          if (rawTextForFallback) {
            const heuristicEntries =
              parseJourneysHeuristically(rawTextForFallback);
            if (heuristicEntries.length) {
              mergedEntries = mergeEntriesByMaxCount(
                mergedEntries,
                heuristicEntries
              );
            }
          }

          onProgressUpdate(
            mergedEntries.length === 0
              ? "No journey data found."
              : `Found ${mergedEntries.length} journey entries.`
          );

          return mergedEntries;
        } else if (file.type.startsWith("image/")) {
          const data = await readFileAsBase64(file);
          contents = {
            parts: [
              { text: PROMPT },
              { inlineData: { mimeType: file.type, data } },
            ],
          };
        } else {
          const text = await readFileAsText(file);
          rawTextForFallback = text;
          contents = {
            parts: [{ text: PROMPT }, { text }],
          };
        }

        onProgressUpdate("Sending data to Gemini for analysis...");

        const response = await traceGeminiCall(
          "gemini-extract",
          model,
          { fileType: file.type, fileName: file.name },
          async () => {
            return await generateContent({
              model: model,
              contents,
              config: {
                responseMimeType: "application/json",
                responseSchema: travelDataSchema,
                thinkingConfig: { thinkingBudget: 4096 },
              },
            });
          },
          { fileType: file.type },
          fileSpan
        );

        onProgressUpdate("Validating extracted data...");
        const jsonString = response.text;
        let parsedJson;

        try {
          parsedJson = JSON.parse(jsonString);
        } catch {
          console.error(
            "Failed to parse JSON response from Gemini:",
            jsonString
          );
          throw new Error(
            "The AI model returned a response in an unexpected format. Please try a different document or check the file quality."
          );
        }

        if (!parsedJson || !Array.isArray(parsedJson.expenses)) {
          console.warn(
            "Gemini response was valid JSON but missing the 'expenses' array.",
            parsedJson
          );
          throw new Error(
            "The AI model was unable to find any valid expense data in the document."
          );
        }

        // Validate and clean the entries from AI
        return await traceFileProcessing(
          "validate-entries",
          { rawCount: parsedJson.expenses.length },
          async () => {
            const validEntries: TravelEntry[] = [];
            for (const item of parsedJson.expenses) {
              if (
                item &&
                typeof item.date === "string" &&
                typeof item.amount === "number" &&
                !isNaN(item.amount)
              ) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
                  validEntries.push({ date: item.date, amount: item.amount });
                }
              }
            }

            // Heuristic fallback on raw text
            let finalEntries: TravelEntry[] = validEntries;
            if (rawTextForFallback) {
              const heuristicEntries =
                parseJourneysHeuristically(rawTextForFallback);
              if (heuristicEntries.length) {
                finalEntries = mergeEntriesByMaxCount(
                  validEntries,
                  heuristicEntries
                );
              }
            }

            if (finalEntries.length === 0 && parsedJson.expenses.length > 0) {
              throw new Error(
                "The AI model found some data, but none of it was in the correct format (e.g., YYYY-MM-DD for dates)."
              );
            }

            onProgressUpdate(
              finalEntries.length === 0
                ? "No journey data found."
                : `Found ${finalEntries.length} journey entries.`
            );

            return finalEntries;
          },
          undefined,
          fileSpan
        );
      } catch (error) {
        let errorMessage = `Failed to process ${file.name}.`;
        if (error instanceof Error) {
          errorMessage += ` Reason: ${error.message}`;
        }
        throw new Error(errorMessage);
      }
    },
    undefined,
    parentSpan
  );
};
