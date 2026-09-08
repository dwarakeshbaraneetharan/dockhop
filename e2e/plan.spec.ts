import { expect, test } from "@playwright/test";

import { emptyMapPoint, mockApi, PLAN, waitForMap } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("search a destination, plan a route, see the swap and the savings", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await page.getByPlaceholder("Where to? Or tap the map").fill("Bryant Park");
  await page.getByRole("button", { name: "Bryant Park, Manhattan" }).click();

  await page.getByRole("button", { name: "Plan route" }).click();

  await expect(page.getByText("1 swap", { exact: true })).toBeVisible();
  await expect(page.getByText(`${PLAN.totalMinutes} min total`)).toBeVisible();
  await expect(page.getByText(`$${PLAN.savingsUsd.toFixed(2)}`)).toBeVisible();
  await expect(page.getByText(PLAN.swaps[0].name)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start ride" })).toBeVisible();
});

test("every stop in the plan hands off to Google Maps", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await page.getByPlaceholder("Where to? Or tap the map").fill("Bryant Park");
  await page.getByRole("button", { name: "Bryant Park, Manhattan" }).click();
  await page.getByRole("button", { name: "Plan route" }).click();
  await expect(page.getByRole("button", { name: "Start ride" })).toBeVisible();

  // Walked to at the start, ridden to after that.
  const expected = [
    { name: PLAN.start.name, at: PLAN.start, mode: "walking" },
    { name: PLAN.swaps[0].name, at: PLAN.swaps[0], mode: "bicycling" },
    { name: PLAN.end.name, at: PLAN.end, mode: "bicycling" },
  ];

  for (const stop of expected) {
    const link = page.getByRole("link", { name: stop.name });
    await expect(link).toBeVisible();

    const href = new URL((await link.getAttribute("href"))!);
    expect(href.origin + href.pathname).toBe("https://www.google.com/maps/dir/");
    expect(href.searchParams.get("destination")).toBe(`${stop.at.lat},${stop.at.lon}`);
    expect(href.searchParams.get("travelmode")).toBe(stop.mode);
    // Opening Maps must not navigate away from a ride in progress.
    await expect(link).toHaveAttribute("target", "_blank");
  }
});

test("the planned route is drawn on the map", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await page.getByPlaceholder("Where to? Or tap the map").fill("Bryant Park");
  await page.getByRole("button", { name: "Bryant Park, Manhattan" }).click();
  await page.getByRole("button", { name: "Plan route" }).click();
  await expect(page.getByRole("button", { name: "Start ride" })).toBeVisible();

  // One pin per endpoint plus each swap, plus the rider's own position.
  await expect
    .poll(() => page.locator(".maplibregl-marker").count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(3);

  // Polled, not sampled: the camera is still easing into the route's bounds.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as unknown as {
            __dockhopMap?: { queryRenderedFeatures(o: unknown): unknown[] };
          }).__dockhopMap;
          return m?.queryRenderedFeatures({ layers: ["route-ride"] }).length ?? 0;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
});

test("plan button stays disabled until a destination is set", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await expect(page.getByRole("button", { name: "Plan route" })).toBeDisabled();
});

test("tapping the map sets a destination", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  // Away from the docks, which answer a tap with their own details instead.
  const point = await emptyMapPoint(page);
  await page.mouse.click(point.x, point.y);

  await expect(page.getByRole("button", { name: "Plan route" })).toBeEnabled();
});

test("an infeasible trip explains itself instead of failing silently", async ({ page }) => {
  await mockApi(page, {
    plan: {
      feasible: false,
      reason: "no_start_station",
      message: "No dock with a classic bike within walking distance.",
    },
  });

  await page.goto("/");
  await waitForMap(page);

  await page.getByPlaceholder("Where to? Or tap the map").fill("Bryant Park");
  await page.getByRole("button", { name: "Bryant Park, Manhattan" }).click();
  await page.getByRole("button", { name: "Plan route" }).click();

  await expect(page.getByText("No dock with a classic bike within walking distance.")).toBeVisible();
});

test("a failing planner surfaces an error rather than hanging", async ({ page }) => {
  await mockApi(page, { plan: { error: "Upstream feed unavailable" }, planStatus: 502 });

  await page.goto("/");
  await waitForMap(page);

  await page.getByPlaceholder("Where to? Or tap the map").fill("Bryant Park");
  await page.getByRole("button", { name: "Bryant Park, Manhattan" }).click();
  await page.getByRole("button", { name: "Plan route" }).click();

  await expect(page.getByText("Upstream feed unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan route" })).toBeEnabled();
});
