const { test, expect } = require("@playwright/test");

test("saved executions survive reload, compare with previous success and open node previews", async ({
  page,
  request,
}, testInfo) => {
  const base = "/api/studio/ui-history/flows";
  const created = await request.post(base, {
    data: { template: "unified-accounts" },
  });
  const flow = await created.json();
  const run = async (graph) => {
    const response = await request.post(`${base}/${flow.id}/run`, {
      data: { flow: graph },
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const first = await run(flow);
  const changed = structuredClone(flow);
  changed.nodes.find((node) => node.id === "alpha").config.account =
    "not-found";
  await request.put(`${base}/${flow.id}`, { data: changed });
  const second = await run(changed);
  const list = await (
    await request.get(`${base}/${flow.id}/executions`)
  ).json();
  expect(list.runs).toHaveLength(2);
  expect(list.runs[0].id).toBe(second.executionId);
  const compared = await (
    await request.get(
      `${base}/${flow.id}/executions/${second.executionId}?compareTo=${first.executionId}`,
    )
  ).json();
  expect(compared.comparison.outputChanged).toBe(true);
  expect(
    compared.comparison.changes.some((node) => node.change === "count"),
  ).toBe(true);
  expect(
    (
      await request.get(
        `/api/studio/ui-other/flows/${flow.id}/executions/${first.executionId}`,
      )
    ).status(),
  ).toBe(404);
  await page.goto("/studio?tenant=ui-history");
  await page.getByRole("button", { name: "Execution", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Execution history" });
  await expect(
    dialog.getByLabel("Saved executions").getByRole("button"),
  ).toHaveCount(2);
  await expect(dialog.getByTestId("history-comparison")).toContainText(
    "Endpoint response changed",
  );
  await expect(dialog.getByLabel("Comparison baseline")).toHaveValue("auto");
  await dialog
    .getByText("Endpoint response · before / after", { exact: true })
    .click();
  await expect(dialog.getByLabel("Previous response")).toContainText(
    "accounts",
  );
  await expect(dialog.getByLabel("Saved response")).toContainText("accounts");
  await dialog
    .getByLabel("Comparison baseline")
    .selectOption(first.executionId);
  await expect(dialog.getByTestId("history-comparison")).toContainText(
    "Endpoint response changed",
  );
  await page.screenshot({ path: testInfo.outputPath("history-desktop.png") });
  await dialog
    .getByLabel("Saved executions")
    .getByRole("button")
    .last()
    .click();
  await expect(
    dialog.getByText("No earlier successful run is available for comparison."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Inspect run" }).click();
  await expect(page.locator(".saved-execution-notice")).toContainText(
    "Saved execution",
  );
  await expect(page.getByLabel("Workflow title")).toHaveValue(changed.name);
  await expect(
    page.getByText(/Workflow changed since the last execution/),
  ).toBeVisible();
  await page.locator('.react-flow__node[data-id="alpha"]').click();
  await page
    .getByRole("complementary", { name: "Node settings" })
    .getByRole("button", { name: "JSON", exact: true })
    .click();
  await expect(page.getByLabel("Node configuration JSON")).toContainText(
    "not-found",
  );
  await page.getByRole("button", { name: "Close node settings" }).click();
  await page.locator('.react-flow__node[data-id="map"]').click();
  const panel = page.getByRole("complementary", { name: "Node settings" });
  await panel.getByRole("button", { name: "Output", exact: true }).click();
  await expect(panel.getByLabel("Output JSON data")).toContainText("accountId");
  await page.reload();
  await page.getByRole("button", { name: "Execution", exact: true }).click();
  await expect(
    dialog.getByLabel("Saved executions").getByRole("button"),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("button", { name: "Inspect run" }),
  ).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("history-mobile.png") });
});

test("failed executions and rejected inputs are retained and the last successful baseline stays selectable", async ({
  request,
  page,
}) => {
  const base = "/api/studio/ui-history-failed/flows";
  const flow = await (
    await request.post(base, { data: { template: "unified-accounts" } })
  ).json();
  const first = await (
    await request.post(`${base}/${flow.id}/run`, { data: {} })
  ).json();
  const broken = structuredClone(flow);
  broken.nodes.find((n) => n.id === "alpha").config.op = "invalid";
  const failure = await (
    await request.post(`${base}/${flow.id}/run`, { data: { flow: broken } })
  ).json();
  // Add an explicit required input to exercise pre-execution failures independently of optional enums.
  const required = structuredClone(flow);
  required.nodes.find((n) => n.type === "trigger").config.inputs = [
    { name: "required", type: "integer", required: true },
  ];
  expect(
    (
      await request.post(`${base}/${flow.id}/run`, { data: { flow: required } })
    ).status(),
  ).toBe(400);
  const list = await (
    await request.get(`${base}/${flow.id}/executions`)
  ).json();
  expect(list.runs[0].status).toBe("failed");
  expect(list.runs.find((r) => r.id === failure.executionId).status).toBe(
    "failed",
  );
  await page.goto("/studio?tenant=ui-history-failed");
  await page.getByRole("button", { name: "Execution", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Execution history" });
  await expect(
    dialog.getByText("invalid input", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog
      .getByLabel("Comparison baseline")
      .locator(`option[value="${first.executionId}"]`),
  ).toHaveCount(1);
  await expect(dialog.getByTestId("history-comparison")).toBeVisible();
});
