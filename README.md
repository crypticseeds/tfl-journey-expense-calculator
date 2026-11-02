# 🚇 TFL Journey Expense Calculator

> **An AI-powered expense automation tool that transforms the tedious process of calculating transport reimbursements into a simple, intelligent workflow.**

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev/)
[![Google Gemini](https://img.shields.io/badge/Google%20Gemini-AI-4285F4?style=flat&logo=google&logoColor=white)](https://ai.google.dev/)
[![Langfuse](https://img.shields.io/badge/Langfuse-Observability-000000?style=flat)](https://langfuse.com/)

[![Quality gate status](https://sonarcloud.io/api/project_badges/measure?project=devopsfoundry_tfl-journey-expense-calculator&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=devopsfoundry_tfl-journey-expense-calculator)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=devopsfoundry_tfl-journey-expense-calculator&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=devopsfoundry_tfl-journey-expense-calculator)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=devopsfoundry_tfl-journey-expense-calculator&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=devopsfoundry_tfl-journey-expense-calculator)

![TfL Journey Expense Calculator](images/tfl-home-page.png)

## 🎯 The Problem

As an employee claiming transport reimbursement, calculating monthly travel expenses is a **time-consuming nightmare**:

- Manually matching journey dates with work days across multiple months
- Cross-referencing invoices with actual work days
- Calculating costs from multiple TfL statements
- Repeating this process every month

**This app eliminates that hassle entirely.**

## ✨ The Solution

An intelligent expense calculator that:

- 📤 **Accepts multiple file formats**: Upload CSV invoices, PDF statements, or images
- 🤖 **AI-powered extraction**: Uses Google Gemini to intelligently parse transport data
- 📅 **Visual date selection**: Simple calendar UI to select days you worked
- 💰 **Automatic calculation**: Instantly computes your total reimbursement
- 📊 **Smart summaries**: Generates clear, exportable expense reports
- 🔄 **Multi-invoice support**: Handles multiple TfL statements seamlessly

![Expense Summary Report](images/expense-summary.png)

## 💡 Why This Project Matters

This isn't just another CRUD app it's a **production-ready AI agent** solving a real problem. Built to demonstrate:

- ✨ **Real-world AI application**: Not a tutorial project, but a tool people actually need
- 🏗️ **Production engineering**: Complete with observability, security, and error handling
- 🎯 **Problem-first approach**: Starting with user pain points, not tech
- 📈 **Scalable architecture**: Ready for real-world deployment and usage

Perfect for employees at companies with transport reimbursement policies, saves hours of manual work every month.

## 🧠 Technical Showcase

This project demonstrates advanced skills in **AI agent development** and **production-grade engineering**:

### AI Agent Architecture

- **Intelligent document parsing** using Google Gemini with structured prompts
- **Multi-modal AI processing** (text, PDF, images via OCR)
- **Context-aware data extraction** that understands TfL invoice formats
- **Structured output validation** ensuring data integrity
- **Performance-optimized processing**: PDF page-level chunking and parallel processing reduced latency by 78.5% (58.63s → 12.58s for large documents)

### Production Observability

Built-in **full-stack tracing** with Langfuse for production-grade AI monitoring. Using observability-driven optimization, we identified and resolved performance bottlenecks:

![Langfuse Document Chunking Optimization](images/langfuse-doc-chunking.png)
_Langfuse trace revealing document processing bottlenecks, leading to 78.5% latency reduction through intelligent chunking and parallelization_

### Enterprise Security

- **Zero client-side API key exposure** via secure backend proxy
- **Single-origin serving**: the frontend and API share one origin, so no CORS surface
- **Rate limiting** per client IP
- **Production-ready architecture** with environment-based configuration and a container image

## 🛠️ Tech Stack

**Frontend**: React 19, TypeScript, Vite, PDF.js, Tesseract.js  
**Backend**: Node.js, Express, Google Gemini AI, Langfuse, OpenTelemetry  
**DevOps**: pnpm, Doppler, Docker Compose, GitHub Actions, Playwright, Dependabot

## 🚀 Quick Start

### Prerequisites

- Node.js 22 (see `.node-version`) and pnpm (version pinned in `package.json`)
- Google Gemini API key ([Get one free](https://aistudio.google.com/app/apikey))

### Installation

1. **Clone and install**:

   ```bash
   git clone https://github.com/crypticseeds/tfl-journey-expense-calculator.git
   cd tfl-journey-expense-calculator
   pnpm install
   ```

2. **Configure secrets with Doppler**:

   Set `GEMINI_API_KEY` (and the optional `LANGFUSE_*` keys) in the Doppler
   project `tfl`, config `dev`.

3. **Run the application**:

   ```bash
   pnpm dev
   ```

   The app will be available at:
   - 🎨 Frontend (Vite): `http://localhost:3000`
   - 🔒 Backend API: `http://localhost:3001` (Vite proxies `/api` to it)

   No Doppler? Pass the key directly:

   ```bash
   GEMINI_API_KEY=your-key pnpm exec concurrently "node server/index.js" "vite"
   ```

That's it! 🎉

## 🎬 Try It Out

The project includes sample TfL statements in the `/sample` folder:

- `Amex - 2003 - October 2025 (Journeys).pdf` - Sample journey PDF
- `Amex - 2003 - October 2025 (Payments).csv` - Sample payment CSV

**Quick walkthrough**:

1. Open `http://localhost:3000` (`http://localhost:8080` when running the production build or Docker)
2. Click "Upload Files" and select the sample files
3. Select some dates in October 2025 on the calendar
4. Click "Calculate Expenses"
5. View your itemized expense report with total cost

Check the Langfuse dashboard (if configured) to see the full AI trace!

## 📖 Detailed Setup Options

### Production without Docker

Build the frontend and serve it together with the API from one process:

```bash
pnpm build && GEMINI_API_KEY=your-key pnpm start
```

Open `http://localhost:8080` (set `PORT` to change it).

### Docker

The container serves the frontend and API on port 8080 and restarts automatically (`restart: unless-stopped`), so it comes back after a reboot.

**With Doppler** (project `tfl`, config `prd`):

```bash
doppler run --project tfl --config prd -- docker compose up -d --build
```

**With a `.env` file**:

```bash
cp .env.example .env   # then fill in GEMINI_API_KEY
docker compose up -d --build
```

Open `http://localhost:8080`. Stop it with `docker compose down`.

### Configuration

| Variable                                                            | Default     | Purpose                                                                                                                                          |
| ------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GEMINI_API_KEY`                                                    | required    | Google Gemini API key                                                                                                                            |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` | unset       | Optional Langfuse tracing. The browser posts traces to `/api/langfuse/traces`; the server adds the keys, so the secret never reaches the browser |
| `TRUST_PROXY_HOPS`                                                  | `0`         | Number of reverse proxies in front of the app                                                                                                    |
| `HOST_PORT`                                                         | `8080`      | Host port the container is published on                                                                                                          |
| `BIND_ADDRESS`                                                      | `127.0.0.1` | `127.0.0.1` is this machine only; `0.0.0.0` exposes it to your network                                                                           |

> ⚠️ With `BIND_ADDRESS=0.0.0.0`, anyone who can reach the app can spend your Gemini quota. Only do this on a trusted network or behind authentication.

Docker and `pnpm start` serve everything from one origin, so there is no CORS or API base URL to configure.

### Testing

```bash
pnpm test        # unit tests (Vitest)
pnpm test:e2e    # Playwright smoke test
```

The smoke test builds and starts the production server and mocks Gemini. Run `pnpm exec playwright install chromium` once first.

### Dependency Updates and CI

Dependabot (weekly, grouped) and Snyk open dependency PRs. `react`, `react-dom` and their `@types` packages move together, and `react`/`react-dom` are pinned to the same exact version; `scripts/check-react-versions.mjs` fails CI on a mismatch.

CI runs two jobs: `ci` (format, lint, type-check, React version check, unit tests, build) and `smoke` (Docker image plus Playwright). Patch and minor bot PRs auto-merge once both pass; major bumps get the `needs-review` label. Merges made by auto-merge (with `GITHUB_TOKEN`) do not trigger push workflows on `main`, so the PR checks are the gate.

## 📋 How It Works

1. **Upload your TfL statements** (CSV, PDF, or images)
2. **Select the days you worked** using the interactive calendar
3. **Get your total** - the AI calculates your reimbursement instantly
4. **Export the summary** for your finance team

The AI agent intelligently:

- Extracts journey data from multiple formats
- Matches journeys to your work days
- Handles multiple invoices across different months
- Validates and merges data automatically

## 🔍 AI Observability with Langfuse

This project showcases **production-grade AI monitoring** using Langfuse:

### What's Tracked

- ✅ **Complete workflow traces** - See the entire expense calculation process
- ✅ **AI model calls** - Full Gemini API request/response details
- ✅ **Performance metrics** - Latency, token usage, and estimated costs
- ✅ **Error tracking** - Automatic capture of failures
- ✅ **Session grouping** - Group related operations for debugging

### Setup (Optional but Recommended)

1. Sign up for free at [cloud.langfuse.com](https://cloud.langfuse.com)
2. Get your API keys from the dashboard
3. Add them as `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` in Doppler or your `.env`
4. View traces in real-time as you use the app

## 🔒 Security

- ✅ **Backend Proxy Pattern**: All AI requests go through a secure server
- ✅ **Zero Client Exposure**: API keys never touch the browser
- ✅ **Single Origin**: The server serves the frontend and API together, so no CORS configuration is needed
- ✅ **Rate Limiting**: 30 requests/minute per IP
- ✅ **Local by Default**: Docker binds to `127.0.0.1` unless you set `BIND_ADDRESS`

## 🐛 Troubleshooting

**"Failed to fetch" error**: Ensure the backend is running (`pnpm dev`, or the container via `docker compose ps`) and check `http://localhost:3001/health` (dev) or `http://localhost:8080/health` (production/Docker) returns `{"status":"ok"}`

**"Invalid API key" error**: Get a valid key from [Google AI Studio](https://aistudio.google.com/app/apikey) and restart the backend server

## 🤝 Contributing

Contributions are welcome! Fork the repository, create a feature branch, and open a Pull Request.

---

**⭐ If you found this project interesting, please star the repo!**

---

<div align="center">

### 🔗 Connect with Me

[![Portfolio](https://img.shields.io/badge/Portfolio-000?style=for-the-badge&logo=ko-fi&logoColor=white)](https://devopsfoundry.com/projects/)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/femi-akinlotan/)
[![Mail](https://img.shields.io/badge/Email-lightgrey?style=for-the-badge&logo=minutemailer&logoColor=white)](mailto:femi.akinlotan@devopsfoundry.com)

**Built with ❤️ by Femi Akinlotan**
