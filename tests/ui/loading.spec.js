const { test, expect } = require("@playwright/test");

function gate() {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

test("audit pending states use animated concentric rings and retain accessible button names", async ({
  page,
}) => {
  const latest = gate();
  let running = false;
  await page.route("**/api/latest", async (route) => {
    await latest.wait;
    await route.fulfill({ json: null });
  });
  await page.route("**/api/progress", (route) =>
    route.fulfill({ json: { running, progress: [] } }),
  );
  await page.route("**/api/run", (route) => {
    running = true;
    return route.fulfill({ status: 202, json: { started: true } });
  });
  await page.goto("/nbg");
  const initialRing = page.locator(".section-loading .loading-ring");
  await expect(initialRing).toBeVisible();
  expect(
    await initialRing.evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("loading-ui-concentric-ring-rotation");
  const firstTransform = await initialRing.evaluate(
    (el) => getComputedStyle(el).transform,
  );
  await page.waitForTimeout(150);
  expect(
    await initialRing.evaluate((el) => getComputedStyle(el).transform),
  ).not.toBe(firstTransform);
  await expect(
    initialRing.locator(':scope > span[aria-hidden="true"]'),
  ).toHaveCount(2);
  expect(
    await initialRing
      .locator(":scope > span")
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
  ).toBe("2px");
  latest.release();
  await page.getByRole("button", { name: "Run audit", exact: true }).click();
  const button = page.getByRole("button", {
    name: "Audit running…",
    exact: true,
  });
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toHaveCSS("opacity", "1");
  await expect(button).toHaveCSS("cursor", "wait");
  await expect(button.locator(".loading-ring")).toBeVisible();
  await expect(page.locator(".audit-progress .loading-ring")).toBeVisible();
  await expect(
    page.locator(".lucide-loader-circle, .spin, .live-dot"),
  ).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await button.locator(".loading-ring").evaluate((el) => ({
    duration: getComputedStyle(el).animationDuration,
    iterations: getComputedStyle(el).animationIterationCount,
  }));
  expect(reduced.duration).toBe("2s");
  expect(reduced.iterations).toBe("infinite");
  const reducedRing = button.locator(".loading-ring");
  const reducedTransform = await reducedRing.evaluate(
    (el) => getComputedStyle(el).transform,
  );
  await page.waitForTimeout(200);
  expect(
    await reducedRing.evaluate((el) => getComputedStyle(el).transform),
  ).not.toBe(reducedTransform);
});

test("workspace loading, saving and mobile execution all use the same ring", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const initial = gate(),
    saving = gate(),
    executing = gate();
  await page.route("**/api/studio/templates", async (route) => {
    await initial.wait;
    await route.continue();
  });
  await page.route(
    "**/api/studio/ui-loading/flows/unified-accounts",
    async (route) => {
      if (route.request().method() === "PUT") await saving.wait;
      await route.continue();
    },
  );
  await page.route(
    "**/api/studio/ui-loading/flows/unified-accounts/run",
    async (route) => {
      await executing.wait;
      await route.continue();
    },
  );
  await page.goto("/studio?tenant=ui-loading");
  await expect(page.locator(".canvas-overlay .loading-ring")).toBeVisible();
  initial.release();
  await expect(
    page.locator('.react-flow__node[data-id="alpha"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Execute workflow", exact: true })
    .first()
    .click();
  await expect(page.locator(".save-state .loading-ring")).toBeVisible();
  saving.release();
  await expect(
    page
      .getByRole("button", { name: "Executing…", exact: true })
      .locator(".loading-ring"),
  ).toBeVisible();
  await expect(page.locator(".execution-status .loading-ring")).toBeVisible();
  await expect(
    page.locator(".execution-body .empty-icon .loading-ring"),
  ).toBeVisible();
  expect(
    await page
      .locator(".execution-status .loading-ring")
      .evaluate((el) => getComputedStyle(el).display),
  ).not.toBe("none");
  executing.release();
  await expect(
    page.getByText("Workflow executed successfully", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".execution-status .loading-ring")).toHaveCount(0);
});
