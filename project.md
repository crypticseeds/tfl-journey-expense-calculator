---
title: TfL Journey Expense Calculator
description: An AI-powered expense automation tool that transforms manual transport reimbursement calculations into an intelligent, production-ready workflow
date: 2025-01-XX
author: Femi Akinlotan
tags:
  [ai, react, typescript, gemini, langfuse, fullstack, production-engineering]
github: https://github.com/yourusername/tfl-journey-expense-calculator
demo: https://your-demo-url.com
---

# TfL Journey Expense Calculator

An AI-powered expense automation tool that transforms the tedious process of calculating transport reimbursements into a simple, intelligent workflow. This project demonstrates production-grade AI engineering, solving a real-world problem that saves employees hours of manual work every month.

## Project Overview

### Motivation

As an employee claiming transport reimbursement, calculating monthly travel expenses is a time-consuming nightmare:

- Manually matching journey dates with work days across multiple months
- Cross-referencing invoices with actual work days
- Calculating costs from multiple TfL statements
- Repeating this process every month

This app eliminates that hassle entirely. It's not just another CRUD app—it's a **production-ready AI agent** solving a real problem, built to demonstrate real-world AI application development with proper observability, security, and performance optimization.

### Key Features

- **Multi-format file support**: Accepts CSV invoices, PDF statements, or images with intelligent format detection
- **AI-powered extraction**: Uses Google Gemini to intelligently parse and understand transport data with structured output validation
- **Visual date selection**: Simple, intuitive calendar UI to select days you actually worked
- **Automatic calculation**: Instantly computes total reimbursement amount with itemized breakdowns
- **Smart summaries**: Generates clear, exportable expense reports ready for finance teams
- **Multi-invoice support**: Handles multiple TfL statements seamlessly across different months
- **Production observability**: Full-stack tracing with Langfuse for debugging and monitoring AI workflows
- **Privacy-first design**: No user data is stored—all processing is stateless and in-memory, ensuring complete privacy

### Technologies Used

- **Frontend**: React 19, TypeScript, Vite, PDF.js, Tesseract.js
- **Backend**: Node.js, Express, Google Gemini AI (gemini-2.5-flash-lite)
- **Observability**: Langfuse, OpenTelemetry
- **DevOps**: pnpm, Doppler, Docker Compose, GitHub Actions, Playwright, Dependabot

## Architecture

### System Design

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React     │────▶│   Express   │────▶│  Gemini AI  │
│  Frontend   │     │   Backend   │     │   (Proxy)   │
└─────────────┘     └─────────────┘     └─────────────┘
      │                    │                    │
      │                    │                    │
      ▼                    ▼                    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  PDF.js     │     │  Langfuse   │     │  OpenTelemetry│
│ Tesseract   │     │  Tracing    │     │  Distributed │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Component Breakdown

#### Frontend Layer

The React frontend handles file uploads, date selection, and result visualization:

- **FileUpload Component**: Drag-and-drop interface supporting CSV, PDF, and image files
- **Calendar Component**: Interactive date picker for selecting work days
- **SummaryReport Component**: Displays itemized expenses with total calculations
- **Client-side processing**: PDF.js for PDF text extraction, Tesseract.js for OCR on images

#### Backend Layer

The Express server acts as a secure proxy, protecting API keys and handling AI requests:

- **Secure API proxy**: All Gemini API calls go through the backend, ensuring zero client-side API key exposure
- **Single origin**: The server also serves the built frontend, so the app and API share one origin and need no CORS
- **Rate limiting**: 30 requests/minute per IP to prevent abuse
- **Error handling**: Comprehensive error handling with proper HTTP status codes

#### AI Processing Layer

The core intelligence lives in the Gemini service:

- **Multi-modal processing**: Handles text (CSV), PDFs, and images (via OCR)
- **Structured extraction**: Uses Gemini's structured output with JSON schema validation
- **Intelligent parsing**: Understands TfL invoice formats, handles date inheritance, and filters out non-journey entries
- **Chunking strategy**: Large PDFs are split into 2-4 page chunks for parallel processing

## Implementation Details

### Prerequisites

- Node.js 22 (see `.node-version`) and pnpm (version pinned in `package.json`)
- Google Gemini API key ([Get one free](https://aistudio.google.com/app/apikey))
- Langfuse account (optional but recommended for observability)

### Installation and Setup

#### Clone the Repository

```bash
git clone https://github.com/yourusername/tfl-journey-expense-calculator.git
cd tfl-journey-expense-calculator
```

#### Install Dependencies

```bash
pnpm install
```

#### Environment Configuration

Set `GEMINI_API_KEY` (and the optional `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`) in Doppler (project `tfl`, config `dev`), or in a `.env` file copied from `.env.example` for Docker.

#### Running the Application

**Development Mode**:

```bash
pnpm dev
```

This runs the API on `http://localhost:3001` and Vite on `http://localhost:3000`, with Vite proxying `/api` to the API. Without Doppler:

```bash
GEMINI_API_KEY=your-key pnpm exec concurrently "node server/index.js" "vite"
```

**Production without Docker**:

```bash
pnpm build && GEMINI_API_KEY=your-key pnpm start
```

Frontend and API are served from `http://localhost:8080` (`PORT` overrides).

**Docker**:

```bash
doppler run --project tfl --config prd -- docker compose up -d --build
# or: cp .env.example .env, fill GEMINI_API_KEY, then
docker compose up -d --build
```

Open `http://localhost:8080`; stop with `docker compose down`. The container uses `restart: unless-stopped`.

Compose also reads `TRUST_PROXY_HOPS` (default `0`; number of reverse proxies in front), `HOST_PORT` (default `8080`) and `BIND_ADDRESS` (default `127.0.0.1`, local only). Setting `BIND_ADDRESS=0.0.0.0` exposes the app to your network, where anyone who can reach it can spend your Gemini quota, so use it only on a trusted network or behind authentication.

Langfuse tracing goes browser, then `/api/langfuse/traces`, where the server adds the keys before forwarding to Langfuse, so the secret never reaches the browser.

#### Testing

```bash
pnpm test        # Vitest unit tests
pnpm test:e2e    # Playwright smoke test (run `pnpm exec playwright install chromium` once)
```

The smoke test builds and starts the production server and mocks Gemini.

#### CI and Dependency Updates

Dependabot (weekly, grouped) and Snyk open dependency PRs. CI jobs are `ci` (format, lint, type-check, React version check, unit tests, build) and `smoke` (Docker image plus Playwright). Patch and minor bot PRs auto-merge once both pass; majors get the `needs-review` label. `react` and `react-dom` are pinned to the same exact version, and `scripts/check-react-versions.mjs` fails CI on a mismatch.

## Key Features Deep Dive

### Feature 1: Multi-Format Document Processing

#### How It Works

The system intelligently detects file types and routes them to appropriate processors:

- **CSV files**: Directly parsed using a custom parser that handles TfL statement formats
- **PDF files**: Extracted using PDF.js, preserving line structure and spatial relationships
- **Images**: Processed through Tesseract.js OCR, then sent to Gemini for extraction

The key innovation is preserving document structure (especially for PDFs) to maintain date context that gets inherited by subsequent journey entries.

#### Code Example

```typescript
// PDF text extraction with line structure preservation
function rebuildPageTextWithLineBreaks(textContent: {
  items?: Array<{ str?: string; transform?: number[] }>;
}): string {
  const lines: Line[] = [];
  const yThreshold = 2; // tolerance for grouping into same visual line

  // Group text items by Y position to preserve line structure
  for (const item of items) {
    const tr = item.transform ?? [0, 0, 0, 0, 0, 0];
    const y = tr[5] ?? 0;
    let line = lines.find((l) => Math.abs(l.y - y) <= yThreshold);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x: tr[4] ?? 0, str: String(item.str ?? "") });
  }

  // Sort top-to-bottom and reconstruct lines
  lines.sort((a, b) => b.y - a.y);
  return lines
    .map((l) =>
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(" ")
    )
    .join("\n");
}
```

### Feature 2: AI-Powered Structured Extraction

#### How It Works

Google Gemini processes the extracted text with a carefully crafted prompt that:

- Understands TfL statement formats (contactless/Oyster)
- Handles date inheritance (dates printed once, followed by multiple journeys)
- Filters out non-journey entries (caps, payments, refunds)
- Returns structured JSON with validated date and amount fields

The system uses Gemini's structured output feature with a JSON schema, ensuring type safety and validation.

#### Code Example

```typescript
const PROMPT = `
You are an expert data extraction agent for TfL contactless/Oyster statements.
Extract EVERY individual journey charge from this document.

CRITICAL:
- Dates are often printed once followed by multiple journey lines; 
  subsequent journeys inherit the most recent date header.
- Output date as YYYY-MM-DD. Output amount as a positive number.
- Strictly IGNORE non-journey lines: cap, capped, daily cap, weekly cap, 
  total, payment, auto top up, refund, credit, adjustment.

Return ONLY JSON: { "expenses": [ { "date": "YYYY-MM-DD", "amount": 0.00 } ] }
`;

const response = await generateContent({
  model: "gemini-2.5-flash-lite",
  contents: {
    parts: [{ text: PROMPT }, { text: documentText }],
  },
  config: {
    responseMimeType: "application/json",
    responseSchema: travelDataSchema,
    thinkingConfig: { thinkingBudget: 4096 },
  },
});
```

### Feature 3: Performance Optimization with Parallel Processing

#### How It Works

Large PDFs are intelligently chunked and processed in parallel:

- **Chunking strategy**: PDFs with >4 pages are split into 2-4 page chunks
- **Parallel processing**: Up to 3 chunks processed concurrently
- **File-level parallelization**: Up to 3 files processed simultaneously
- **Result merging**: Chunks are merged with date inheritance logic preserved

This optimization reduced processing time for an 8-page PDF from 58.63 seconds to 12.58 seconds—a **78.5% improvement**.

#### Code Example

```typescript
// Determine chunking strategy
let pagesPerChunk: number;
if (pdf.numPages <= 4) {
  pagesPerChunk = pdf.numPages; // Single chunk for small PDFs
} else if (pdf.numPages <= 8) {
  pagesPerChunk = 2; // 2 pages per chunk for medium PDFs
} else {
  pagesPerChunk = 4; // 4 pages per chunk for large PDFs
}

// Process chunks in parallel (limit to 3 concurrent)
const MAX_CONCURRENT_CHUNKS = 3;
const chunkPromises = chunks.map((chunkPages, chunkIndex) =>
  processPdfChunk(
    chunkPages,
    chunkIndex,
    chunks.length,
    model,
    onProgressUpdate
  )
);

// Process with concurrency limit
for (let i = 0; i < chunkPromises.length; i += MAX_CONCURRENT_CHUNKS) {
  const batch = chunkPromises.slice(i, i + MAX_CONCURRENT_CHUNKS);
  const batchResults = await Promise.all(batch);
  chunkResults.push(...batchResults);
}
```

## Technical Challenges

### Challenge 1: PDF Structure Preservation

**Problem**: PDFs don't preserve logical line structure—text is extracted as individual positioned elements. TfL statements print dates once, followed by multiple journey entries that inherit that date. Without preserving line structure, date context is lost.

**Solution**: Implemented a Y-position-based line grouping algorithm that reconstructs visual lines by grouping text items within a 2-pixel Y-threshold. This preserves the document's visual structure, allowing the AI to correctly identify date headers and their associated journeys.

```typescript
// Group text items by Y position to preserve line structure
const yThreshold = 2;
for (const item of items) {
  const y = tr[5] ?? 0;
  let line = lines.find((l) => Math.abs(l.y - y) <= yThreshold);
  if (!line) {
    line = { y, parts: [] };
    lines.push(line);
  }
  line.parts.push({ x, str: item.str });
}
```

### Challenge 2: Performance Bottleneck with Large PDFs

**Problem**: Using Langfuse tracing, we identified that a single 8-page PDF was taking 58.63 seconds to process, with the Gemini API call consuming 97% of the time (57.03 seconds). The entire document was being sent in a single large API call.

**Solution**: Implemented a multi-pronged optimization strategy:

1. **Reduced thinking budget**: From 32,768 to 4,096 tokens (20-40% faster for structured extraction)
2. **PDF chunking**: Split large PDFs into 2-4 page chunks, processed in parallel
3. **File-level parallelization**: Process up to 3 files concurrently
4. **Model optimization**: Switched from `gemini-2.5-pro` to `gemini-2.5-flash-lite` for faster inference

**Results**:

- **Before**: 58.63 seconds for an 8-page PDF
- **After**: 12.58 seconds for the same PDF
- **78.5% latency reduction** (46.05 seconds saved)
- **4.7x speedup** for single large PDFs
- **3x speedup** for multiple file processing

The key insight was that Langfuse tracing made the bottleneck immediately visible—without the detailed trace showing the exact breakdown, we wouldn't have known that chunking and parallelization would provide the biggest gains.

### Challenge 3: Date Inheritance Across Chunks

**Problem**: When splitting PDFs into chunks, date headers might appear at the end of one chunk while their associated journeys appear in the next chunk. This breaks date inheritance logic.

**Solution**: Implemented a merging strategy that:

- Tracks the last known date from each chunk
- Applies date inheritance during chunk merging
- Uses a fallback heuristic parser if AI extraction fails
- Validates dates to ensure they're within reasonable ranges

## Performance Optimization

### Implemented Optimizations

#### Caching Strategy

While not explicitly implemented in the current version, the architecture supports caching at multiple levels:

- **Client-side**: File contents are kept in memory during processing
- **Backend**: Could cache extracted data per file hash
- **AI responses**: Could cache Gemini responses for identical inputs

#### Database Optimization

No database is used—all processing is stateless and in-memory. **No user data is stored**—files are processed on-demand and discarded after calculation. This design choice prioritizes simplicity and privacy, ensuring that sensitive financial information never persists on servers.

#### Frontend Performance

- **Lazy loading**: Components are loaded on-demand
- **Progress indicators**: Real-time progress updates during file processing
- **Error boundaries**: Graceful error handling with user-friendly messages

### Performance Metrics

**Processing Time Improvements**:

- Single 8-page PDF: 58.63s → 12.58s (78.5% reduction)
- Multiple files: Sequential → 3x parallel processing
- API call latency: 20-40% reduction through thinking budget optimization

**Cost Optimization**:

- Model switch: `gemini-2.5-pro` → `gemini-2.5-flash-lite` (faster, cheaper)
- Thinking budget: 32,768 → 4,096 tokens (87.5% reduction)
- Parallel processing: Reduced total API time despite more calls

### Deployment

The app ships as a single container (see Docker above) that serves the frontend and API from one origin on port 8080. Put it behind a reverse proxy for HTTPS and set `TRUST_PROXY_HOPS` to the number of proxies in front of it.

### Security Checklist for Production

- ✅ Use HTTPS for all connections
- ✅ Keep `BIND_ADDRESS` at `127.0.0.1` unless the network is trusted or the app is behind authentication
- ✅ Set `TRUST_PROXY_HOPS` to match your reverse proxies
- ✅ Rotate API keys regularly
- ✅ Enable Langfuse for monitoring
- ✅ Set up alerts for API usage spikes
- ✅ Implement request logging and monitoring
- ✅ Use Doppler or similar for secret management

## Future Enhancements

### Planned Features

- [ ] **Google Calendar integration**: Automatically detect and select work days from Google Calendar events, eliminating manual date selection
- [ ] **Smart workday presets**: Quick-select options for typical work schedules (Monday-Friday, custom weekday patterns, or specific days of the week)
- [ ] Automated email report generation
- [ ] Batch processing for multiple months at once

### Potential Improvements

- **Caching layer**: Cache extracted data to avoid re-processing identical files
- **Database integration**: Store user expenses for historical tracking
- **Advanced analytics**: Spending patterns, monthly trends, cost predictions
- **Multi-language support**: Support for non-English TfL statements
- **Enhanced OCR**: Improve image processing accuracy with better preprocessing

## Lessons Learned

### Technical Insights

1. **Observability is crucial for AI systems**: Langfuse tracing revealed the exact bottleneck (97% of time in Gemini API calls), which wouldn't have been obvious without detailed traces.

2. **Structured outputs are game-changers**: Gemini's structured output feature eliminated the need for complex JSON parsing and validation, reducing errors significantly.

3. **Chunking strategy matters**: The optimal chunk size (2-4 pages) balances API call overhead with parallelization benefits. Too small = too many API calls, too large = slow sequential processing.

4. **Thinking budget optimization**: For structured extraction tasks, reducing thinking budget from 32K to 4K tokens provided 20-40% speedup with no accuracy loss.

### Best Practices Discovered

- **Always trace AI workflows**: Without Langfuse, we wouldn't have identified the performance bottleneck
- **Design for parallelization**: The chunking architecture enables horizontal scaling
- **Security-first architecture**: Backend proxy pattern protects API keys and enables rate limiting
- **Progressive enhancement**: The app works without Langfuse, but observability adds significant value

### What I'd Do Differently

- **Start with observability**: Would integrate Langfuse from day one, not as an afterthought
- **More comprehensive testing**: Would write tests alongside implementation, not after
- **Better error messages**: Would provide more specific error messages for different failure modes
- **Performance testing earlier**: Would identify bottlenecks before they become problems

## Resources

### Documentation

- [Google Gemini API Docs](https://ai.google.dev/docs)
- [Langfuse Documentation](https://langfuse.com/docs)
- [PDF.js Documentation](https://mozilla.github.io/pdf.js/)
- [React 19 Documentation](https://react.dev/)

### Related Projects

- Similar expense tracking tools
- AI document processing frameworks
- Production AI observability platforms

### Helpful Articles

- [Structured Outputs with Gemini](https://ai.google.dev/gemini-api/docs/structured-outputs)
- [Production AI Monitoring Best Practices](https://langfuse.com/docs/guides/production-monitoring)
- [PDF Text Extraction Techniques](https://mozilla.github.io/pdf.js/examples/)

## Conclusion

The TfL Journey Expense Calculator demonstrates that AI can solve real-world problems when combined with production-grade engineering practices. By focusing on observability, performance optimization, and security, we built a tool that's not just a prototype, but a production-ready application.

The project showcases the importance of:

- **Problem-first thinking**: Starting with user pain points, not technology
- **Production observability**: Langfuse tracing was instrumental in identifying and solving performance bottlenecks
- **Performance optimization**: Data-driven optimization (78.5% latency reduction) through careful measurement and iteration
- **Security architecture**: Enterprise-grade API key protection and rate limiting

### Try It Out

- **GitHub Repository**: [tfl-journey-expense-calculator](https://github.com/yourusername/tfl-journey-expense-calculator)
- **Live Demo**: [Your demo URL]
- **Sample Files**: Included in the `/sample` folder for testing

**Technologies**: React, TypeScript, Google Gemini, Langfuse, Node.js, Express  
**Project Status**: Active  
**Last Updated**: 04 December 2025
