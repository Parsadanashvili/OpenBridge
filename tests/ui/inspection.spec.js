const { test, expect } = require("@playwright/test");
const node = (page, id) => page.locator(`.react-flow__node[data-id="${id}"]`);

test("node inspection shows source data, normalized output, resolved parameters and stale results", async ({
  page,
}, testInfo) => {
  await page.goto("/studio?tenant=ui-inspection");
  await node(page, "alpha").click();
  const panel = page.getByRole("complementary", { name: "Node settings" });
  await panel.getByRole("button", { name: "Input", exact: true }).click();
  await expect(panel.getByText("No execution data yet")).toBeVisible();
  await panel
    .getByRole("button", { name: "Execute workflow", exact: true })
    .click();
  await expect(
    page.getByText("Workflow executed successfully", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(panel.getByLabel("Input JSON data")).toContainText("{");
  await panel.getByRole("button", { name: "Output", exact: true }).click();
  await expect(panel.getByLabel("Output JSON data")).toContainText(
    "resourceId",
  );
  await panel.getByRole("button", { name: "Close node settings" }).click();
  await node(page, "map").click();
  await panel.getByRole("button", { name: "Input", exact: true }).click();
  await expect(
    panel.getByLabel("Input source node").locator("option"),
  ).toHaveCount(2);
  await panel.getByLabel("Input source node").selectOption("beta");
  await expect(panel.getByLabel("Input JSON data")).toContainText("resourceId");
  await panel.getByRole("button", { name: "Output", exact: true }).click();
  await expect(panel.getByLabel("Output JSON data")).toContainText("accountId");
  await panel.getByRole("button", { name: "Table output preview" }).click();
  await expect(panel.locator("table")).toContainText("accountId");
  await page.screenshot({ path: testInfo.outputPath("node-output.png") });
  await panel.getByRole("button", { name: "Parameters", exact: true }).click();
  await panel
    .getByText("Parameters used in last execution", { exact: true })
    .click();
  await expect(panel.locator(".resolved-parameters pre")).toContainText(
    "accounts",
  );
  await panel.getByRole("button", { name: "Close node settings" }).click();
  await node(page, "alpha").click();
  await panel.getByLabel("Operation", { exact: true }).selectOption("balances");
  await panel.getByRole("button", { name: "Output", exact: true }).click();
  await expect(panel.getByText(/From the previous execution/)).toBeVisible();
  await expect(panel.getByLabel("Output JSON data")).toContainText(
    "resourceId",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const sidebar = await page.locator(".workspace-sidebar").boundingBox();
      return sidebar.x + sidebar.width;
    })
    .toBeLessThanOrEqual(1);
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
  expect(box.x).toBeGreaterThanOrEqual(0);
  await page.screenshot({
    path: testInfo.outputPath("node-output-mobile.png"),
  });
});

test("failed nodes preserve inputs and display the execution error in output", async ({
  page,
}) => {
  await page.goto("/studio?tenant=ui-inspection-error");
  await node(page, "alpha").click();
  const panel = page.getByRole("complementary", { name: "Node settings" });
  await panel.getByRole("button", { name: "JSON", exact: true }).click();
  await panel
    .getByLabel("Node configuration JSON")
    .fill(JSON.stringify({ bank: "alpha", op: "invalid" }));
  await panel.getByRole("button", { name: "Apply JSON", exact: true }).click();
  await page
    .getByRole("button", { name: "Execute workflow", exact: true })
    .first()
    .click();
  await panel.getByRole("button", { name: "Output", exact: true }).click();
  await expect(panel.getByLabel("Output JSON data")).toContainText(
    "unknown op",
  );
  await expect(panel.getByText("Failed", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Input", exact: true }).click();
  await expect(panel.getByLabel("Input source node")).toHaveValue("trigger");
});
