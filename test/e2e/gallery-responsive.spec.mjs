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
  return { baseUrl, child, output: () => output, tempRoot, uploadRoot, tmpRoot, cookie: "" };
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
