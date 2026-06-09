import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const TEST_USERNAME = "admin";
const TEST_PASSWORD = "password";
const TEST_SESSION_SECRET = "test-session-secret";
const VIEWER = {
  username: "gallery.viewer",
  displayName: "Gallery Viewer",
  password: "gallery-viewer-123"
};
const SCREENSHOT_DIR = process.env.CARPOSTCLUB_E2E_SCREENSHOT_DIR || "";

const INVENTORY_CARS = [
  {
    dealershipId: "15",
    inventoryTypeId: "2",
    vin: "KNDETCA76T7828611",
    stockNumber: "U6247A",
    title: "Used 2026 Kia Seltos X-Line AWD",
    year: "2026",
    make: "Kia",
    model: "Seltos",
    trim: "X-Line AWD",
    price: "$30,990",
    odometer: "1,234 km",
    exteriorColor: "White",
    interiorColor: "Black",
    bodyStyle: "SUV",
    fuelType: "Gas",
    transmission: "Automatic",
    detailUrl: "https://www.oregans.com/inventory/Used-2026-Kia-Seltos-U6247A/"
  },
  {
    dealershipId: "15",
    inventoryTypeId: "2",
    vin: "5NMS3DAJ2PH512345",
    stockNumber: "U7001",
    title: "Used 2023 Hyundai Santa Fe Preferred AWD",
    year: "2023",
    make: "Hyundai",
    model: "Santa Fe",
    trim: "Preferred AWD",
    price: "$34,488",
    odometer: "24,315 km",
    exteriorColor: "Blue",
    interiorColor: "Grey",
    bodyStyle: "SUV",
    fuelType: "Gas",
    transmission: "Automatic",
    detailUrl: "https://www.oregans.com/inventory/Used-2023-Hyundai-Santa-Fe-U7001/"
  },
  {
    dealershipId: "3",
    inventoryTypeId: "2",
    vin: "2T3B1RFV8PC123456",
    stockNumber: "T9012",
    title: "Used 2023 Toyota RAV4 LE AWD",
    year: "2023",
    make: "Toyota",
    model: "RAV4",
    trim: "LE AWD",
    price: "$33,995",
    odometer: "18,200 km",
    exteriorColor: "Silver",
    interiorColor: "Black",
    bodyStyle: "SUV",
    fuelType: "Gas",
    transmission: "Automatic",
    detailUrl: "https://www.oregans.com/inventory/Used-2023-Toyota-RAV4-T9012/"
  }
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
  { name: "compact-mobile", width: 360, height: 740 }
];

test("gallery unread UI fits desktop, laptop, tablet, and mobile screens", async ({ page }) => {
  const harness = await startTestServer();
  try {
    harness.cookie = await login(harness.baseUrl);
    await seedUnreadAlbums(harness);
    await createApprovedAccount(harness, VIEWER);

    await loginWithPage(page, harness.baseUrl, VIEWER.username, VIEWER.password);
    await page.goto(`${harness.baseUrl}/gallery`);
    await expect(page.locator("#pageTitle")).toHaveText("Media gallery");
    await expect(page.getByRole("button", { name: "Remove sold uploads" })).toHaveCount(0);
    await expect(page.locator(".gallery-folder-card.has-unread")).toHaveCount(2);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(100);
      await expect(page.locator(".gallery-unread-badge").first()).toBeVisible();
      await assertGalleryFits(page);
      await assertBadgeInsideCard(page, ".gallery-folder-card.has-unread", ".gallery-unread-badge");
      await assertControlTextFits(page);
      await capture(page, `${viewport.name}-folders`);
    }

    await page.locator(".gallery-folder-card.has-unread", { hasText: "2 new" }).first().click();
    await expect(page.locator(".gallery-folder-bar")).toBeVisible();
    await expect(page.locator(".album-card.is-unread")).toHaveCount(2);
    await expect(page.locator(".album-cover img").first()).toHaveAttribute("src", /\/thumbnail$/);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(100);
      await expect(page.locator(".album-unread-badge").first()).toBeVisible();
      await assertGalleryFits(page);
      await assertBadgeInsideCard(page, ".album-card.is-unread", ".album-unread-badge");
      await assertControlTextFits(page);
      await capture(page, `${viewport.name}-feed`);
    }

    await page.locator(".album-card.is-unread .album-summary-button").first().click();
    await expect(page.locator(".album-posting-kit").first()).toBeVisible();
    await expect(page.locator(".album-media-strip").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Upload" })).toHaveCount(0);
    await expect(page.locator(".album-media-thumb img").first()).toHaveAttribute("src", /\/thumbnail$/);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(100);
      await assertGalleryFits(page);
      await assertControlTextFits(page);
      await capture(page, `${viewport.name}-expanded`);
    }
  } finally {
    await stopTestServer(harness);
  }
});

test("admin gallery delete upload controls refresh albums", async ({ page }) => {
  const harness = await startTestServer();
  const activeCar = INVENTORY_CARS[0];
  try {
    harness.cookie = await login(harness.baseUrl);
    const activeUpload = await uploadPhotos(harness, {
      dealershipId: activeCar.dealershipId,
      inventoryTypeId: activeCar.inventoryTypeId,
      vin: activeCar.vin,
      photos: [
        {
          filename: "delete-upload-front.png",
          type: "image/png",
          body: pngBytes(0)
        }
      ]
    });
    expect(activeUpload.status).toBe(201);

    await loginWithPage(page, harness.baseUrl, TEST_USERNAME, TEST_PASSWORD);
    await page.goto(`${harness.baseUrl}/gallery`);
    await expect(page.getByRole("button", { name: "Remove sold uploads" })).toHaveCount(0);
    await page.locator(".gallery-folder-card", { hasText: "O'Regan's Kia Halifax" }).click();
    await expect(page.getByRole("button", { name: "Remove sold uploads here" })).toHaveCount(0);

    const activeCard = page.locator(".album-card", { hasText: activeCar.stockNumber }).first();
    await activeCard.locator(".album-summary-button").click();
    const deleteUploadButton = activeCard.getByRole("button", { name: "Delete Upload" });
    await expect(deleteUploadButton).toBeEnabled();

    const deleteMessages = [];
    page.once("dialog", async (dialog) => {
      deleteMessages.push(dialog.message());
      await dialog.accept();
    });
    const deleteResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "DELETE"
      && response.url().endsWith(`/api/albums/${activeUpload.body.albumId}/media`)
    );
    await deleteUploadButton.click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(200);
    expect(deleteMessages[0]).toContain("cannot be undone");
    await expect(page.locator("#statusBar")).toContainText(`Deleted upload for ${activeCar.stockNumber}`);
    await expect(page.locator(".album-card", { hasText: activeCar.stockNumber })).toHaveCount(0);
  } finally {
    await stopTestServer(harness);
  }
});

test("iPhone Share Photos shares one prepared image", async ({ page }) => {
  const harness = await startTestServer();
  const car = INVENTORY_CARS[0];
  try {
    harness.cookie = await login(harness.baseUrl);
    const upload = await uploadPhotos(harness, {
      dealershipId: car.dealershipId,
      inventoryTypeId: car.inventoryTypeId,
      vin: car.vin,
      photos: [
        {
          filename: "iphone-one.png",
          type: "image/png",
          body: pngBytes(0)
        }
      ]
    });
    expect(upload.status).toBe(201);

    await enableIPhoneShareMocks(page);
    const { shareButton } = await openGalleryAlbum(page, harness, car);
    await expect(shareButton).toHaveText("Share Photos", { timeout: 10000 });

    await shareButton.click();
    const shareCall = await firstShareCall(page);
    expect(shareCall.fileCount).toBe(1);
    expect(shareCall.names).toEqual(["iphone-one.png"]);
    await expect(page.locator("#statusBar")).toContainText("Shared 1 photo");
  } finally {
    await stopTestServer(harness);
  }
});

test("iPhone Share Photos shares multiple prepared images", async ({ page }) => {
  const harness = await startTestServer();
  const car = INVENTORY_CARS[0];
  try {
    harness.cookie = await login(harness.baseUrl);
    const upload = await uploadPhotos(harness, {
      dealershipId: car.dealershipId,
      inventoryTypeId: car.inventoryTypeId,
      vin: car.vin,
      photos: [
        {
          filename: "iphone-front.png",
          type: "image/png",
          body: pngBytes(0)
        },
        {
          filename: "iphone-rear.png",
          type: "image/png",
          body: pngBytes(1)
        }
      ]
    });
    expect(upload.status).toBe(201);

    await enableIPhoneShareMocks(page);
    const { shareButton } = await openGalleryAlbum(page, harness, car);
    await expect(shareButton).toHaveText("Share Photos", { timeout: 10000 });

    await shareButton.click();
    const shareCall = await firstShareCall(page);
    expect(shareCall.fileCount).toBe(2);
    expect(shareCall.names.sort()).toEqual(["iphone-front.png", "iphone-rear.png"]);
    await expect(page.locator("#statusBar")).toContainText("Shared 2 photos");
  } finally {
    await stopTestServer(harness);
  }
});

test("iPhone Share Photos does not stay stuck when a photo preparation request stalls", async ({ page }) => {
  const harness = await startTestServer();
  const car = INVENTORY_CARS[0];
  const consoleMessages = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    harness.cookie = await login(harness.baseUrl);
    const upload = await uploadPhotos(harness, {
      dealershipId: car.dealershipId,
      inventoryTypeId: car.inventoryTypeId,
      vin: car.vin,
      photos: [
        {
          filename: "share-front.png",
          type: "image/png",
          body: pngBytes(0)
        },
        {
          filename: "share-rear.png",
          type: "image/png",
          body: pngBytes(1)
        }
      ]
    });
    expect(upload.status).toBe(201);

    await enableIPhoneShareMocks(page, { timeoutMs: 150 });

    let stalledFetches = 0;
    await page.route(/\/api\/albums\/[^/]+\/media\//, async (route) => {
      if (route.request().resourceType() === "fetch" && stalledFetches === 0) {
        stalledFetches += 1;
        await new Promise(() => {});
        return;
      }
      await route.continue();
    });

    const { shareButton } = await openGalleryAlbum(page, harness, car);
    await expect(shareButton).toHaveText("Preparing Photos");
    await expect(shareButton).toHaveText("Share Photos", { timeout: 6000 });
    await expect(shareButton).toBeEnabled();

    await shareButton.click();
    await expect.poll(() => page.evaluate(() => window.__carpostclubShareCalls?.[0]?.fileCount || 0)).toBe(1);
    await expect(page.locator("#statusBar")).toContainText("Shared 1 photo");
    await assertGalleryFits(page);
    await assertControlTextFits(page);

    expect(stalledFetches).toBe(1);
    expect(consoleMessages).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await stopTestServer(harness);
  }
});

test("iPhone Share Photos can retry after all preparation fails", async ({ page }) => {
  const harness = await startTestServer();
  const car = INVENTORY_CARS[0];
  let failPreparation = true;
  try {
    harness.cookie = await login(harness.baseUrl);
    const upload = await uploadPhotos(harness, {
      dealershipId: car.dealershipId,
      inventoryTypeId: car.inventoryTypeId,
      vin: car.vin,
      photos: [
        {
          filename: "retry-front.png",
          type: "image/png",
          body: pngBytes(0)
        },
        {
          filename: "retry-rear.png",
          type: "image/png",
          body: pngBytes(1)
        }
      ]
    });
    expect(upload.status).toBe(201);

    await enableIPhoneShareMocks(page, { timeoutMs: 200 });
    await page.route(/\/api\/albums\/[^/]+\/media\//, async (route) => {
      if (route.request().resourceType() === "fetch" && failPreparation) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    const { shareButton } = await openGalleryAlbum(page, harness, car);
    await expect(shareButton).toHaveText("Share Photos", { timeout: 6000 });
    await shareButton.click();
    await expect(page.locator("#statusBar")).toContainText("Open a photo below", { timeout: 6000 });

    failPreparation = false;
    await shareButton.click();
    await expect(shareButton).toHaveText("Share Photos", { timeout: 10000 });
    await shareButton.click();

    const shareCall = await firstShareCall(page);
    expect(shareCall.fileCount).toBe(2);
    expect(shareCall.names.sort()).toEqual(["retry-front.png", "retry-rear.png"]);
  } finally {
    await stopTestServer(harness);
  }
});

test("switching albums clears old iPhone share preparation", async ({ page }) => {
  const harness = await startTestServer();
  const firstCar = INVENTORY_CARS[0];
  const secondCar = INVENTORY_CARS[1];
  let firstAlbumId = "";
  let stalledOldFetches = 0;
  try {
    harness.cookie = await login(harness.baseUrl);
    const firstUpload = await uploadPhotos(harness, {
      dealershipId: firstCar.dealershipId,
      inventoryTypeId: firstCar.inventoryTypeId,
      vin: firstCar.vin,
      photos: [
        {
          filename: "old-front.png",
          type: "image/png",
          body: pngBytes(0)
        },
        {
          filename: "old-rear.png",
          type: "image/png",
          body: pngBytes(1)
        }
      ]
    });
    expect(firstUpload.status).toBe(201);
    firstAlbumId = firstUpload.body.albumId;

    const secondUpload = await uploadPhotos(harness, {
      dealershipId: secondCar.dealershipId,
      inventoryTypeId: secondCar.inventoryTypeId,
      vin: secondCar.vin,
      photos: [
        {
          filename: "new-front.png",
          type: "image/png",
          body: pngBytes(1)
        },
        {
          filename: "new-rear.png",
          type: "image/png",
          body: pngBytes(2)
        }
      ]
    });
    expect(secondUpload.status).toBe(201);

    await enableIPhoneShareMocks(page, { timeoutMs: 5000 });
    await page.route(/\/api\/albums\/[^/]+\/media\//, async (route) => {
      if (route.request().resourceType() === "fetch" && route.request().url().includes(encodeURIComponent(firstAlbumId))) {
        stalledOldFetches += 1;
        await new Promise(() => {});
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await loginWithPage(page, harness.baseUrl, TEST_USERNAME, TEST_PASSWORD);
    await page.goto(`${harness.baseUrl}/gallery`);
    await expect(page.locator("#pageTitle")).toHaveText("Media gallery");
    await page.locator(".gallery-folder-card", { hasText: "O'Regan's Kia Halifax" }).click();

    const firstCard = page.locator(".album-card", { hasText: firstCar.stockNumber }).first();
    await firstCard.locator(".album-summary-button").click();
    await expect(firstCard.locator(".album-detail-actions button").first()).toHaveText("Preparing Photos");

    const secondCard = page.locator(".album-card", { hasText: secondCar.stockNumber }).first();
    await secondCard.locator(".album-summary-button").click();
    const secondShareButton = secondCard.locator(".album-detail-actions button").first();
    await expect(secondShareButton).toHaveText("Share Photos", { timeout: 10000 });
    await secondShareButton.click();

    const shareCall = await firstShareCall(page);
    expect(shareCall.fileCount).toBe(2);
    expect(shareCall.names.sort()).toEqual(["new-front.png", "new-rear.png"]);
    expect(stalledOldFetches).toBeGreaterThan(0);
  } finally {
    await stopTestServer(harness);
  }
});

test("desktop gallery keeps Download Photos ZIP behavior", async ({ browser }) => {
  const harness = await startTestServer();
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  const car = INVENTORY_CARS[0];
  try {
    harness.cookie = await login(harness.baseUrl);
    const upload = await uploadPhotos(harness, {
      dealershipId: car.dealershipId,
      inventoryTypeId: car.inventoryTypeId,
      vin: car.vin,
      photos: [
        {
          filename: "desktop-front.png",
          type: "image/png",
          body: pngBytes(0)
        }
      ]
    });
    expect(upload.status).toBe(201);

    await loginWithPage(page, harness.baseUrl, TEST_USERNAME, TEST_PASSWORD);
    await page.goto(`${harness.baseUrl}/gallery`);
    await page.locator(".gallery-folder-card", { hasText: "O'Regan's Kia Halifax" }).click();
    const albumCard = page.locator(".album-card", { hasText: car.stockNumber }).first();
    await albumCard.locator(".album-summary-button").click();
    const downloadButton = albumCard.locator(".album-detail-actions button").first();
    await expect(downloadButton).toHaveText("Download Photos");

    const downloadPromise = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    expect(await download.failure()).toBeNull();
  } finally {
    await context.close();
    await stopTestServer(harness);
  }
});

test("upload vehicle search and manual source mode stay mutually exclusive", async ({ page }) => {
  const harness = await startTestServer();
  try {
    await loginWithPage(page, harness.baseUrl, TEST_USERNAME, TEST_PASSWORD);
    await expect(page.locator("#pageTitle")).toHaveText("Vehicle media intake");
    await expect(page.locator(".picker-grid")).toBeVisible();
    await expect(page.locator("#manualCarForm")).toBeHidden();
    await expect(page.locator("#carSelect option")).toContainText(["Choose inventory"]);

    await page.locator("#carSearchInput").fill("U7001 blue Hyundai");
    await expect(page.locator("#makeFilterSelect option")).toContainText(["All makes", "Hyundai"]);
    await expect(page.locator("#makeFilterSelect option")).not.toContainText(["Kia"]);
    await expect(page.locator("#carSelect")).toBeHidden();
    await expect(page.locator("#carSearchResults")).toBeVisible();
    await expect(page.locator("#carSearchResults")).toContainText("U7001");
    await expect(page.locator("#carSearchResults")).not.toContainText("U6247A");

    await page.locator(`#carSearchResults [data-inventory-key="${INVENTORY_CARS[1].vin}"]`).click();
    await expect(page.locator("#makeFilterSelect")).toHaveValue("Hyundai");
    await expect(page.locator("#modelFilterSelect")).toHaveValue("Santa Fe");
    await expect(page.locator("#carSelect")).toHaveValue(INVENTORY_CARS[1].vin);

    await page.locator("#carSearchInput").fill("not-a-real-stock");
    await expect(page.locator("#makeFilterSelect option")).toContainText(["No makes match search"]);
    await expect(page.locator("#carSearchResults")).toContainText("No matching vehicles found.");
    await expect(page.locator("#carSelect")).toHaveValue("");

    await page.getByRole("button", { name: /Not listed yet/ }).click();
    await expect(page.locator("#manualCarForm")).toBeVisible();
    await expect(page.locator(".picker-grid")).toBeHidden();
    await expect(page.locator(".inventory-actions")).toBeHidden();
    await expect(page.locator("#carSearchInput")).toHaveValue("");
    await expect(page.locator("#carSelect")).toHaveValue("");

    await page.getByRole("button", { name: /Already listed/ }).click();
    await expect(page.locator("#manualCarForm")).toBeHidden();
    await expect(page.locator(".picker-grid")).toBeVisible();
    await expect(page.locator(".inventory-actions")).toBeVisible();
  } finally {
    await stopTestServer(harness);
  }
});

test("live upload events refresh gallery without reload and keep duplicate lock visible", async ({ page }) => {
  const harness = await startTestServer();
  const liveCar = INVENTORY_CARS[1];
  let mainFrameNavigations = 0;

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  try {
    harness.cookie = await login(harness.baseUrl);
    await createApprovedAccount(harness, VIEWER);
    await loginWithPage(page, harness.baseUrl, VIEWER.username, VIEWER.password);

    const streamRequest = page.waitForRequest((request) => request.url().endsWith("/api/albums/stream"));
    await page.goto(`${harness.baseUrl}/gallery`);
    await streamRequest;
    await expect(page.locator("#pageTitle")).toHaveText("Media gallery");
    await expect(page.locator(".gallery-folder-card.has-unread")).toHaveCount(0);
    await expect(page.locator(".gallery-folder-card", { hasText: liveCar.stockNumber })).toHaveCount(0);
    const navigationsBeforeUpload = mainFrameNavigations;

    const upload = await uploadPhotosWithCookie(harness, harness.cookie, {
      dealershipId: liveCar.dealershipId,
      inventoryTypeId: liveCar.inventoryTypeId,
      vin: liveCar.vin,
      photos: [
        {
          filename: "live-upload-front.png",
          type: "image/png",
          body: pngBytes(0)
        }
      ]
    });
    expect(upload.status).toBe(201);

    await expect(page.locator("#statusBar")).toContainText("1 file added for U7001");
    await expect(page.locator(".gallery-folder-card.has-unread")).toContainText("1 new");
    await expect(page.locator(".gallery-folder-card.has-unread")).toContainText("O'Regan's Kia Halifax");
    expect(mainFrameNavigations).toBe(navigationsBeforeUpload);

    await page.locator(".gallery-folder-card.has-unread").click();
    await expect(page.locator(".album-card", { hasText: liveCar.stockNumber })).toBeVisible();

    await page.goto(`${harness.baseUrl}/?dealershipId=${liveCar.dealershipId}&inventoryTypeId=${liveCar.inventoryTypeId}&inventoryKey=${liveCar.vin}`);
    await expect(page.locator("#uploadState")).toHaveText("Already uploaded");
    await expect(page.locator("#uploadHint")).toContainText("Already uploaded");
    await expect(page.locator("#dropZone")).toBeDisabled();

    await page.locator("#carSearchInput").fill(liveCar.stockNumber);
    const duplicateResult = page.locator(`#carSearchResults [data-inventory-key="${liveCar.vin}"]`);
    await expect(duplicateResult).toBeDisabled();
    await expect(duplicateResult).toContainText("Already uploaded");
  } finally {
    await stopTestServer(harness);
  }
});

async function enableIPhoneShareMocks(page, { timeoutMs = 1000, singleFileOnly = false } = {}) {
  await page.addInitScript(({ timeoutMs, singleFileOnly }) => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
    });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      get: () => "iPhone"
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5
    });
    Object.defineProperty(window, "__CARPOSTCLUB_PHOTO_SHARE_PREPARATION_TIMEOUT_MS", {
      configurable: true,
      value: timeoutMs
    });
    Object.defineProperty(window.navigator, "canShare", {
      configurable: true,
      value: (data) => Boolean(data?.files?.length) && (!singleFileOnly || data.files.length <= 1)
    });
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: async (data) => {
        window.__carpostclubShareCalls = window.__carpostclubShareCalls || [];
        window.__carpostclubShareCalls.push({
          fileCount: data.files.length,
          names: data.files.map((file) => file.name),
          types: data.files.map((file) => file.type),
          sizes: data.files.map((file) => file.size)
        });
      }
    });
  }, { timeoutMs, singleFileOnly });
}

async function openGalleryAlbum(page, harness, car, { folderName = "O'Regan's Kia Halifax" } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginWithPage(page, harness.baseUrl, TEST_USERNAME, TEST_PASSWORD);
  await page.goto(`${harness.baseUrl}/gallery`);
  await expect(page.locator("#pageTitle")).toHaveText("Media gallery");
  await page.locator(".gallery-folder-card", { hasText: folderName }).click();
  const albumCard = page.locator(".album-card", { hasText: car.stockNumber }).first();
  await expect(albumCard).toBeVisible();
  await albumCard.locator(".album-summary-button").click();
  const shareButton = albumCard.locator(".album-detail-actions button").first();
  await expect(shareButton).toHaveText(/Preparing Photos|Share Photos|Download Photos/);
  return { albumCard, shareButton };
}

async function firstShareCall(page) {
  await expect.poll(() => page.evaluate(() => window.__carpostclubShareCalls?.[0]?.fileCount || 0)).toBeGreaterThan(0);
  return page.evaluate(() => window.__carpostclubShareCalls[0]);
}

async function seedUnreadAlbums(harness) {
  for (const [index, car] of INVENTORY_CARS.entries()) {
    const upload = await uploadPhotos(harness, {
      dealershipId: car.dealershipId,
      inventoryTypeId: car.inventoryTypeId,
      vin: car.vin,
      photos: [
        {
          filename: `${car.stockNumber.toLowerCase()}-front.png`,
          type: "image/png",
          body: pngBytes(index)
        }
      ]
    });
    expect(upload.status).toBe(201);
  }
}

async function assertGalleryFits(page) {
  const metrics = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const visibleOffenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        if (element.closest("[hidden], .chat-panel")) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const box = element.getBoundingClientRect();
        return box.width > 1
          && box.height > 1
          && (box.left < -1 || box.right > viewportWidth + 1);
      })
      .slice(0, 8)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: String(element.className || ""),
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: Math.round(box.width)
        };
      });
    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      visibleOffenders
    };
  });

  expect(metrics.documentWidth, JSON.stringify(metrics, null, 2)).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.bodyWidth, JSON.stringify(metrics, null, 2)).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.visibleOffenders, JSON.stringify(metrics, null, 2)).toEqual([]);
}

async function assertBadgeInsideCard(page, cardSelector, badgeSelector) {
  const measurements = await page.locator(cardSelector).evaluateAll((cards, selector) => cards.map((card) => {
    const badge = card.querySelector(selector);
    if (!badge) return null;
    const cardBox = card.getBoundingClientRect();
    const badgeBox = badge.getBoundingClientRect();
    return {
      left: badgeBox.left >= cardBox.left,
      top: badgeBox.top >= cardBox.top,
      right: badgeBox.right <= cardBox.right,
      bottom: badgeBox.bottom <= cardBox.bottom
    };
  }).filter(Boolean), badgeSelector);

  for (const measurement of measurements) {
    expect(measurement).toEqual({ left: true, top: true, right: true, bottom: true });
  }
}

async function assertControlTextFits(page) {
  const overflowingControls = await page.evaluate(() => [...document.querySelectorAll(
    "button, .icon-text-button, .gallery-folder-open, .gallery-unread-badge, .album-unread-badge"
  )]
    .filter((element) => {
      if (element.closest("[hidden]")) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
    })
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      className: String(element.className || ""),
      text: String(element.textContent || "").trim()
    })));

  expect(overflowingControls, JSON.stringify(overflowingControls, null, 2)).toEqual([]);
}

async function capture(page, name) {
  if (!SCREENSHOT_DIR) return;
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true
  });
}

async function startTestServer() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "carpostclub-gallery-e2e-"));
  const uploadRoot = path.join(tempRoot, "uploads");
  const tmpRoot = path.join(tempRoot, "tmp");
  const inventoryMockFile = path.join(tempRoot, "inventory.json");
  await fs.writeFile(inventoryMockFile, `${JSON.stringify({ cars: INVENTORY_CARS }, null, 2)}\n`);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: appRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      UPLOAD_ROOT: uploadRoot,
      TMP_ROOT: tmpRoot,
      OREGANS_INVENTORY_MOCK_FILE: inventoryMockFile,
      CARPOSTCLUB_AUTH_USERNAME: TEST_USERNAME,
      CARPOSTCLUB_AUTH_PASSWORD: TEST_PASSWORD,
      CARPOSTCLUB_AUTH_PASSWORD_HASH: "",
      CARPOSTCLUB_AUTH_SESSION_SECRET: TEST_SESSION_SECRET,
      CARPOSTCLUB_AUTH_COOKIE_SECURE: "false",
      CARPOSTCLUB_PUSH_DELIVERY_DISABLED: "true",
      OPENAI_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await waitForHealth(baseUrl, child, () => output);
  return { baseUrl, child, output: () => output, tempRoot, uploadRoot, tmpRoot, inventoryMockFile, cookie: "" };
}

async function stopTestServer(harness) {
  if (harness.child.exitCode === null) {
    harness.child.kill("SIGTERM");
    await Promise.race([
      once(harness.child, "exit"),
      sleep(3000)
    ]);
  }
  await fs.rm(harness.tempRoot, { recursive: true, force: true });
}

async function waitForHealth(baseUrl, child, output) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with ${child.exitCode}\n${output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Keep polling until the child opens the port.
    }
    await sleep(80);
  }
  throw new Error(`server did not become ready\n${output()}`);
}

async function login(baseUrl, username = TEST_USERNAME, password = TEST_PASSWORD) {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
    redirect: "manual"
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  expect(response.status).toBe(303);
  expect(cookie).toMatch(/^carpostclub_session=/);
  return cookie;
}

async function loginWithPage(page, baseUrl, username, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${baseUrl}/`);
}

async function writeInventoryMock(harness, cars) {
  await fs.writeFile(harness.inventoryMockFile, `${JSON.stringify({ cars }, null, 2)}\n`);
}

async function createInvite(harness) {
  const response = await fetch(`${harness.baseUrl}/admin/invites`, {
    method: "POST",
    headers: { Cookie: harness.cookie }
  });
  const body = await response.text();
  expect(response.status).toBe(200);
  const token = body.match(/\/signup\?invite=([A-Za-z0-9_-]+)/)?.[1] || "";
  expect(token, body).toBeTruthy();
  return token;
}

async function createApprovedAccount(harness, account) {
  const invite = await createInvite(harness);
  const response = await fetch(`${harness.baseUrl}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      invite,
      displayName: account.displayName,
      username: account.username,
      dealershipId: account.dealershipId || "15",
      password: account.password,
      confirmPassword: account.password
    }),
    redirect: "manual"
  });
  expect(response.status).toBe(200);
  return {
    ...account,
    cookie: await login(harness.baseUrl, account.username, account.password)
  };
}

async function uploadPhotos(harness, { dealershipId, inventoryTypeId, vin, photos }) {
  return uploadPhotosWithCookie(harness, harness.cookie, { dealershipId, inventoryTypeId, vin, photos });
}

async function uploadPhotosWithCookie(harness, cookie, { dealershipId, inventoryTypeId, vin, photos }) {
  const form = new FormData();
  form.set("dealershipId", dealershipId);
  form.set("inventoryTypeId", inventoryTypeId);
  form.set("vin", vin);
  for (const photo of photos) {
    form.append("photos", new Blob([photo.body], { type: photo.type }), photo.filename);
  }

  const response = await fetch(`${harness.baseUrl}/api/upload`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Accept: "application/json"
    },
    body: form
  });

  return {
    status: response.status,
    body: await response.json()
  };
}

function pngBytes(index) {
  const images = [
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8/58BAAQBAf9Si9VPAAAAAElFTkSuQmCC",
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mNk+M8AAwUBAcqX6m4AAAAASUVORK5CYII="
  ];
  return Buffer.from(images[index % images.length], "base64");
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
