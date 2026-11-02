import { expect, test as base } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const SAMPLE_PDF = fileURLToPath(
  new URL(
    "../../sample/Amex - 2003 - October 2025 (Journeys).pdf",
    import.meta.url
  )
);
const extraction = readFileSync(fixture("gemini-extraction.json"), "utf8");
const EMPTY_EXTRACTION = JSON.stringify({
  text: JSON.stringify({ expenses: [] }),
  response: {},
});
// Fares in gemini-extraction.json: 14 Oct 2025 GBP 2.80, 15 Oct 2025 GBP 3.10.
const WORKDAYS = [/14 October 2025/, /15 October 2025/];
const TOTAL = "£5.90";

// Every test fails on any console error or uncaught page error. This is what
// catches a broken bundle, such as the React / React DOM version mismatch.
const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page, baseURL }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      // Third-party assets (fonts, CDN scripts) are stubbed so the run needs
      // no outside network and cannot fail on someone else's outage.
      const appOrigin = new URL(baseURL!).origin;
      await page.route(
        (url) => url.origin !== appOrigin,
        (route) => {
          const type = route.request().resourceType();
          return route.fulfill({
            status: 200,
            contentType:
              type === "script"
                ? "text/javascript"
                : type === "stylesheet"
                  ? "text/css"
                  : "text/plain",
            body: "",
          });
        }
      );
      await page.route("**/api/langfuse/traces", (route) =>
        route.fulfill({ status: 204 })
      );
      await use(errors);
      expect(errors, "console and page errors").toEqual([]);
    },
    { auto: true },
  ],
});

// The PDF is split into several Gemini requests; return the journeys once and
// an empty list for the rest, so the total is not counted per request.
const mockGemini = async (page: import("@playwright/test").Page) => {
  let calls = 0;
  await page.route("**/api/gemini/generateContent", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: calls++ === 0 ? extraction : EMPTY_EXTRACTION,
    })
  );
};

const reportFor = async (
  page: import("@playwright/test").Page,
  file: string
) => {
  await mockGemini(page);
  await page.goto("/");
  await page.getByLabel("Upload your TfL statements").setInputFiles(file);

  // The calendar opens on the current month; step back to October 2025.
  const month = page.getByRole("heading", { level: 3 });
  for (let i = 0; i < 240; i++) {
    if ((await month.innerText()) === "October 2025") break;
    await page.getByRole("button", { name: "Previous month" }).click();
  }
  await expect(month).toHaveText("October 2025");
  for (const day of WORKDAYS) {
    await page.getByRole("button", { name: day }).click();
  }

  await page.getByRole("button", { name: "Calculate expenses" }).click();
  await expect(page.locator("#step-3-summary")).toContainText(TOTAL);
};

test("home page renders without errors", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /TfL journey expense calculator/i })
  ).toBeVisible();
});

test("pdf upload produces a report", async ({ page }) => {
  await reportFor(page, SAMPLE_PDF);
});

test("image upload produces a report", async ({ page }) => {
  await reportFor(page, fixture("statement.png"));
});
