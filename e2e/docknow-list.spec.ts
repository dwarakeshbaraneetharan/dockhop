import { expect, test } from "@playwright/test";

import { DOCK_OPTIONS, mockApi, waitForMap } from "./fixtures";

/**
 * How the ranked dock list reads.
 *
 * A further station can outrank a nearer one, because a nearly full station is
 * charged for the chance it fills before the rider arrives. That is correct and
 * it looks broken, so the list has to carry its own explanation.
 */

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await waitForMap(page);
  await page.getByRole("button", { name: "Dock now" }).click();
  await expect(page.getByRole("heading", { name: "Nearest open docks" })).toBeVisible();
});

test("numbers the docks by rank, not by how many minutes away they are", async ({ page }) => {
  // The bug this replaces: the badge showed minutes, so the top pick was
  // labelled "2" above one labelled "1" and the list looked mis-sorted.
  const rows = page.getByRole("listitem");
  await expect(rows).toHaveCount(DOCK_OPTIONS.length);

  for (const [index, option] of DOCK_OPTIONS.entries()) {
    const row = rows.nth(index);
    await expect(row).toContainText(option.name);
    await expect(row).toContainText(`${index + 1}`);
    await expect(row).toContainText(`${option.minutes} min ride`);
    await expect(row).toContainText(`${option.meters} m`);
    await expect(row).toContainText(`${option.docks} docks free`);
  }
});

test("says why a nearer dock was passed over", async ({ page }) => {
  const nearerButTighter = page.getByRole("listitem").filter({ hasText: DOCK_OPTIONS[1].name });
  await expect(nearerButTighter).toContainText("Closer, but it may fill before you arrive");

  // The recommendation itself is not second-guessed.
  const top = page.getByRole("listitem").filter({ hasText: DOCK_OPTIONS[0].name });
  await expect(top).not.toContainText("Closer, but");
});

test("a roomy dock further down the list is not flagged", async ({ page }) => {
  // It is slower and further, so there is nothing surprising to explain.
  const furthest = page.getByRole("listitem").filter({ hasText: DOCK_OPTIONS[2].name });
  await expect(furthest).not.toContainText("Closer, but");
});

test("picking a dock from the list starts a ride to it", async ({ page }) => {
  await page.getByRole("listitem").filter({ hasText: DOCK_OPTIONS[0].name }).click();

  await expect(page.getByRole("heading", { name: "Nearest open docks" })).toBeHidden();
  await expect(page.getByText("until you should dock")).toBeVisible();
});
