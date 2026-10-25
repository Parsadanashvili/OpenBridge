const { test, expect } = require("@playwright/test");

const studio = (name) => `/studio?tenant=ui-${name}`;
const node = (page, id) => page.locator(`.react-flow__node[data-id="${id}"]`);

test("existing graph shape loads, saves and survives a reload without JavaScript errors", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(studio("persist"));
  await expect(node(page, "alpha")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  const saved = await (
    await request.get("/api/studio/ui-persist/flows/unified-accounts")
  ).json();
  expect(saved.nodes.find((n) => n.id === "alpha").config.op).toBe("accounts");
  expect(saved.edges).toContainEqual({ from: "alpha", to: "map" });
  await page.reload();
  await expect(node(page, "alpha")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("node settings, undo and redo change the saved graph", async ({
  page,
  request,
}) => {
  await page.goto(studio("edit"));
  await node(page, "alpha").click();
  await page.getByLabel("Operation", { exact: true }).selectOption("balances");
  await expect(node(page, "alpha")).toContainText("balances");
  await page.getByRole("button", { name: "Undo (⌘Z)", exact: true }).click();
  await expect(node(page, "alpha")).toContainText("accounts");
  await page.getByRole("button", { name: "Redo (⌘⇧Z)", exact: true }).click();
  await expect(node(page, "alpha")).toContainText("balances");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  const saved = await (
    await request.get("/api/studio/ui-edit/flows/unified-accounts")
  ).json();
  expect(saved.nodes.find((n) => n.id === "alpha").config.op).toBe("balances");
});

test("node library search, adding, deleting and restoring a node", async ({
  page,
}) => {
  await page.goto(studio("library"));
  await expect(node(page, "alpha")).toBeVisible();
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page.getByRole("textbox", { name: "Search nodes" }).fill("limit");
  await page.getByRole("button", { name: /Limit Return a specific/ }).click();
  await expect(node(page, "limit")).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Node settings" }),
  ).toContainText("Limit");
  await page.getByRole("button", { name: "Delete node", exact: true }).click();
  await expect(node(page, "limit")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (⌘Z)", exact: true }).click();
  await expect(node(page, "limit")).toBeVisible();
});

test("node movement and port connections persist in the backend graph format", async ({
  page,
  request,
}) => {
  await page.goto(studio("connect"));
  await expect(node(page, "alpha")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  const before = await (
    await request.get("/api/studio/ui-connect/flows/unified-accounts")
  ).json();
  const box = await node(page, "trigger").boundingBox();
  await page.mouse.move(box.x + 60, box.y + 65);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 145, { steps: 10 });
  await page.mouse.up();
  const source = node(page, "trigger").locator(".react-flow__handle-right");
  const target = node(page, "respond").locator(".react-flow__handle-left");
  const from = await source.boundingBox(),
    to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  const saved = await (
    await request.get("/api/studio/ui-connect/flows/unified-accounts")
  ).json();
  expect(saved.nodes.find((n) => n.id === "trigger").y).not.toBe(
    before.nodes.find((n) => n.id === "trigger").y,
  );
  expect(saved.edges).toContainEqual({ from: "trigger", to: "respond" });
});

test("execution uses real simulator APIs and exposes output, issues and node traces", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(studio("execute"));
  await expect(node(page, "alpha")).toBeVisible();
  await page
    .getByRole("button", { name: "Execute workflow", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Workflow executed successfully", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".workflow-node.node-success")).toHaveCount(7);
  await expect(page.locator(".workflow-node.node-error")).toHaveCount(0);
  await expect(node(page, "alpha").locator(".workflow-node")).toHaveCSS(
    "border-top-color",
    "rgb(131, 198, 160)",
  );
  await expect(page.locator(".execution-body table")).toContainText(
    "accountId",
  );
  await expect(page.locator(".execution-body table")).toContainText("alpha");
  await expect(page.locator(".execution-body table")).toContainText("beta");
  await page.getByRole("button", { name: "JSON output" }).click();
  await expect(page.locator(".json-output")).toContainText('"accounts"');
  await page
    .getByRole("button", { name: "Execution log", exact: true })
    .click();
  await expect(page.locator(".execution-body table")).toContainText("Success");
  await page.getByRole("button", { name: /^Issues/ }).click();
  await expect(
    page.getByText("Missing: availableBalance").first(),
  ).toBeVisible();
  await node(page, "alpha").click();
  await expect(node(page, "alpha").locator(".workflow-node")).toHaveCSS(
    "border-top-color",
    "rgb(131, 198, 160)",
  );
  await page.getByLabel("Operation", { exact: true }).selectOption("balances");
  await expect(
    page.getByText(/Workflow changed since the last execution/),
  ).toBeVisible();
  await expect(
    page.locator(".workflow-node.node-success, .workflow-node.node-error"),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a failed node glows red while successful nodes stay green, and rerunning clears old borders", async ({
  page,
}) => {
  await page.goto(studio("node-errors"));
  await node(page, "alpha").click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Node configuration JSON" })
    .fill(JSON.stringify({ bank: "alpha", op: "invalid-operation" }));
  await page.getByRole("button", { name: "Apply JSON", exact: true }).click();
  await page
    .getByRole("button", { name: "Execute workflow", exact: true })
    .first()
    .click();
  const alpha = node(page, "alpha").locator(".workflow-node");
  const beta = node(page, "beta").locator(".workflow-node");
  await expect(alpha).toHaveAttribute("data-execution-status", "error", {
    timeout: 30000,
  });
  await expect(alpha).toHaveCSS("border-top-color", "rgb(243, 147, 147)");
  await expect(beta).toHaveAttribute("data-execution-status", "success");
  await expect(beta).toHaveCSS("border-top-color", "rgb(131, 198, 160)");
  await expect(page.locator(".workflow-node.node-error")).toHaveCount(1);

  let resume;
  const pending = new Promise((resolve) => {
    resume = resolve;
  });
  await page.route(
    "**/api/studio/ui-node-errors/flows/unified-accounts/run",
    async (route) => {
      await pending;
      await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "Execute workflow", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Executing…", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".workflow-node.node-success, .workflow-node.node-error"),
  ).toHaveCount(0);
  resume();
  await expect(alpha).toHaveAttribute("data-execution-status", "error", {
    timeout: 30000,
  });
  await expect(beta).toHaveAttribute("data-execution-status", "success");
});

test("a disconnected graph is rejected before any bank execution", async ({
  page,
}) => {
  await page.goto(studio("validation"));
  await expect(node(page, "alpha")).toBeVisible();
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page.getByRole("textbox", { name: "Search nodes" }).fill("limit");
  await page.getByRole("button", { name: /Limit Return a specific/ }).click();
  await page
    .getByRole("button", { name: "Execute workflow", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText("Connect and configure");
  await expect(page.getByRole("alert")).toContainText("Connect every node");
});

test("publish, call and unpublish a workflow endpoint", async ({
  page,
  request,
}) => {
  await page.goto(studio("publish"));
  await expect(node(page, "alpha")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("textbox", { name: "Endpoint path" }).fill("accounts");
  await page
    .getByRole("button", { name: "Publish endpoint", exact: true })
    .click();
  await expect(page.getByText("Live endpoint", { exact: true })).toBeVisible();
  const response = await request.get("/t/ui-publish/accounts");
  expect(response.status()).toBe(200);
  expect((await response.json()).data.accounts.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(page.getByText("Live endpoint", { exact: true })).toHaveCount(0);
  expect((await request.get("/t/ui-publish/accounts")).status()).toBe(404);
});

test("create a template workflow, enter runtime inputs and retain the original workflow", async ({
  page,
}) => {
  await page.goto(studio("templates"));
  await expect(node(page, "alpha")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create workflow", exact: true })
    .click();
  await page.getByRole("button", { name: /^Unified transactions / }).click();
  await page
    .getByRole("textbox", { name: "Workflow name", exact: true })
    .fill("My transactions");
  await page
    .getByRole("textbox", { name: "Workflow ID", exact: true })
    .fill("my-transactions");
  await page
    .getByRole("button", { name: "Create workflow", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("textbox", { name: "Workflow title" }),
  ).toHaveValue("My transactions");
  await page.getByRole("button", { name: "Inputs", exact: true }).click();
  await page.getByLabel(/dateFrom/).fill("2026-10-01");
  await page.getByRole("spinbutton", { name: /limit/ }).fill("5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workflow-list-item")).toHaveCount(2);
});

test("unsaved changes require an explicit discard when switching workflows", async ({
  page,
}) => {
  await page.goto(studio("persist"));
  await expect(node(page, "alpha")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Workflow title" })
    .fill("Unsaved rename");
  await page
    .getByRole("button", { name: "Create workflow", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "You have unsaved changes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Workflow title" }),
  ).toHaveValue("Unsaved rename");
  await page
    .getByRole("button", { name: "Create workflow", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create a workflow", exact: true }),
  ).toBeVisible();
});

test("JSON configuration errors are actionable and do not corrupt node settings", async ({
  page,
}) => {
  await page.goto(studio("json"));
  await node(page, "alpha").click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Node configuration JSON" })
    .fill("{oops");
  await page.getByRole("button", { name: "Apply JSON", exact: true }).click();
  await expect(page.locator(".inspector").getByRole("alert")).toBeVisible();
  await expect(node(page, "alpha")).toContainText("accounts");
});

test("the React regulatory console loads documents and records manual evidence", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/nbg");
  await expect(
    page.getByRole("heading", { name: "Audit overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Regulatory reports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Documentation audit", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("22 valid", { exact: true })).toBeVisible();
  await page.locator(".evidence-status").first().click();
  await page.getByLabel("Status", { exact: true }).selectOption("confirmed");
  await page
    .getByRole("textbox", { name: "Evidence note" })
    .fill("Acceptance test: reference reviewed.");
  await page
    .getByRole("button", { name: "Save evidence", exact: true })
    .click();
  await expect(
    page.getByText("Evidence recorded", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".evidence-status").first()).toContainText(
    "confirmed",
  );
  const download = await page
    .getByRole("link", { name: "Documentation audit Markdown" })
    .getAttribute("href");
  expect(download).toBe("/api/reports/doc-audit.md");
  expect(errors).toEqual([]);
});

test("small screens keep the canvas usable and expose workspace navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(studio("mobile"));
  await expect(node(page, "alpha")).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle workspace navigation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Bank connections", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close workspace navigation" })
    .click();
  await expect(
    page.getByRole("button", { name: "Execute workflow", exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a complete audit populates all React console screens and downloadable reports", async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/nbg");
  await page.getByRole("button", { name: "Run audit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Audit running…", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("High severity", { exact: true })).toBeVisible({
    timeout: 200000,
  });
  await page.getByRole("link", { name: "API Auditor", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Conformance checks", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".report-card").first()).toContainText("pass");
  await page.getByRole("link", { name: "AI Findings", exact: true }).click();
  await expect(
    page.getByText("Deterministic template", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search findings" }).fill("bic");
  await expect(page.locator(".report-card").first()).toContainText("bic");
  await page
    .getByRole("link", { name: "Regulatory reports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Standards coverage", exact: true }),
  ).toBeVisible();
  const download = await request.get("/api/reports/quality.csv");
  expect(download.status()).toBe(200);
  expect(await download.text()).toContain("medianMs,p95Ms");
  expect(errors).toEqual([]);
});
