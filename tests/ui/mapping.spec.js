const { test, expect } = require("@playwright/test");
const node = (page, id) => page.locator(`.react-flow__node[data-id="${id}"]`);
async function openMapper(page, tenant, execute = true) {
  await page.goto(`/studio?tenant=${tenant}`);
  if (execute) {
    await page
      .getByRole("button", { name: "Execute workflow", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("Workflow executed successfully", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
  }
  await node(page, "map").click();
  await page
    .getByRole("button", { name: "Visual mapping", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Visual field mapping" });
}

test("visual mapping selects and drags fields, previews both banks, and persists one undoable change", async ({
  page,
  request,
}, testInfo) => {
  const dialog = await openMapper(page, "ui-mapping");
  const output = dialog.getByLabel("Mapped JSON preview");
  await expect(output).toContainText("alpha");
  const shortcutRuns = [];
  const watchRun = (request) => {
    if (request.url().endsWith("/run")) shortcutRuns.push(request.url());
  };
  page.on("request", watchRun);
  await dialog.getByLabel("Source expression 1", { exact: true }).focus();
  await page.keyboard.press("Control+Enter");
  const history = await (
    await request.get(
      "/api/studio/ui-mapping/flows/unified-accounts/executions",
    )
  ).json();
  expect(history.runs).toHaveLength(1);
  expect(shortcutRuns).toHaveLength(0);
  page.off("request", watchRun);
  await dialog
    .getByRole("button", { name: "Select source resourceId", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Add selected field", exact: true })
    .click();
  await dialog.getByLabel("Output field 9", { exact: true }).fill("externalId");
  await dialog.getByLabel("Transform 9", { exact: true }).selectOption("upper");
  await expect
    .poll(async () => {
      const rows = JSON.parse(await output.textContent());
      return rows[0].externalId;
    })
    .toMatch(/[A-F0-9-]+/);
  await dialog.getByLabel("Mapping source node").selectOption("beta");
  await expect(output).toContainText("beta");
  await expect(
    dialog.getByLabel("Sample output 1", { exact: true }),
  ).toContainText("beta");
  const target = dialog.getByLabel("Mapping 9", { exact: true });
  await dialog
    .getByRole("button", { name: "Select source currency", exact: true })
    .dragTo(target);
  await dialog
    .getByLabel("Output field 9", { exact: true })
    .fill("bankCurrency");
  await dialog.getByLabel("Transform 9", { exact: true }).selectOption("lower");
  await expect(
    dialog.getByLabel("Sample output 9", { exact: true }),
  ).toContainText("gel");
  await page.screenshot({ path: testInfo.outputPath("mapping-desktop.png") });
  await dialog
    .getByRole("button", { name: "Apply mappings", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText(/Workflow changed since the last execution/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo (⌘Z)", exact: true }).click();
  await node(page, "map").click();
  await expect(
    page.getByRole("button", { name: "Remove mapping 9", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Redo (⌘⇧Z)", exact: true }).click();
  await node(page, "map").click();
  await expect(
    page.getByRole("button", { name: "Remove mapping 9", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  const saved = await (
    await request.get("/api/studio/ui-mapping/flows/unified-accounts")
  ).json();
  const fields = saved.nodes.find((n) => n.id === "map").config.fields;
  expect(fields[8]).toEqual({
    to: "bankCurrency",
    from: "currency",
    fn: "lower",
  });
  expect(fields[1].fmt).toBe("${@bank}:${resourceId}");
  await page
    .getByRole("button", { name: "Execute workflow", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Workflow executed successfully", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("complementary", { name: "Node settings" })
    .getByRole("button", { name: "Output", exact: true })
    .click();
  await expect(page.getByLabel("Output JSON data")).toContainText(
    '"bankCurrency": "gel"',
  );
});

test("mapping validates targets, preserves cancel, and supports constants and missing values on mobile", async ({
  page,
}, testInfo) => {
  const dialog = await openMapper(page, "ui-mapping-validation");
  await expect(dialog.getByLabel("Mapped JSON preview")).toContainText("alpha");
  await dialog
    .getByLabel("Output field 1", { exact: true })
    .fill("__proto__.polluted");
  await expect(
    dialog.getByRole("button", { name: "Apply mappings", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("Output paths");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Visual mapping", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Output field 1", { exact: true }),
  ).toHaveValue("bank");
  await dialog
    .getByLabel("Value type 1", { exact: true })
    .selectOption("constant");
  await dialog
    .getByLabel("Source expression 1", { exact: true })
    .fill("custom bank");
  await expect(
    dialog.getByLabel("Sample output 1", { exact: true }),
  ).toContainText("custom bank");
  await dialog.getByLabel("Value type 1", { exact: true }).selectOption("path");
  await dialog
    .getByLabel("Source expression 1", { exact: true })
    .fill("noSuchField");
  await expect(
    dialog.getByLabel("Sample output 1", { exact: true }),
  ).toContainText("null");
  await expect(
    dialog.getByLabel("Sample output 1", { exact: true }),
  ).toContainText("Missing");
  await dialog.getByLabel("Output field 1", { exact: true }).fill("currency");
  await expect(dialog.getByRole("alert")).toContainText("unique path");
  await dialog
    .getByLabel("Output field 1", { exact: true })
    .fill("missingBank");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox()).width).toBeLessThanOrEqual(390);
  await dialog.getByLabel("Mapping source node").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("mapping-mobile.png") });
  await dialog
    .getByRole("button", { name: "Apply mappings", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});

test("mapping without captured data offers configuration without invented sample data", async ({
  page,
}) => {
  const dialog = await openMapper(page, "ui-mapping-empty", false);
  await expect(
    dialog.getByText(/Run the workflow first to load source fields/),
  ).toBeVisible();
  await expect(dialog.getByLabel("Mapped JSON preview")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Add mapping", exact: true })
    .click();
  await dialog.getByLabel("Output field 9", { exact: true }).fill("newField");
  await dialog
    .getByLabel("Value type 9", { exact: true })
    .selectOption("constant");
  await dialog.getByLabel("Source expression 9", { exact: true }).fill("hello");
  await dialog
    .getByRole("button", { name: "Apply mappings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove mapping 9", exact: true }),
  ).toBeVisible();
});

test("mapping preview uses the shared loading ring and recovers from request errors", async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/mapping-preview", async (route) => {
    if (!first) return route.continue();
    first = false;
    await gate;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Preview unavailable" }),
    });
  });
  const dialog = await openMapper(page, "ui-mapping-preview-error");
  await expect(dialog.locator(".history-loading .loading-ring")).toBeVisible();
  release();
  await expect(dialog.getByRole("alert")).toHaveText("Preview unavailable");
  await dialog.getByLabel("Output field 1", { exact: true }).fill("sourceBank");
  await expect(dialog.getByLabel("Mapped JSON preview")).toContainText(
    "sourceBank",
  );
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});
