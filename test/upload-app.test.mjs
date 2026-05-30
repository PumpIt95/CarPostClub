import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const TEST_USERNAME = "admin";
const TEST_PASSWORD = "password";
const NEW_USERNAME = "photo.tech";
const NEW_DISPLAY_NAME = "Photo Tech";
const NEW_PASSWORD = "new-password-123";
const CHANGED_PASSWORD = "changed-password-456";
const RESET_PASSWORD = "reset-password-789";
const TEST_CAR = {
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
  detailUrl: "https://www.oregans.com/inventory/Used-2026-Kia-Seltos-U6247A/",
};
const TEST_ALBUM_ID = "car-used-2026-kia-seltos-x-line-awd-u6247a";
const MANUAL_CAR = {
  dealershipId: "15",
  inventoryTypeId: "2",
  stockNumber: "MNL123",
  year: "2024",
  make: "Toyota",
  model: "Corolla",
  trim: "LE",
  price: "24990",
  odometer: "12000",
  exteriorColor: "Red",
  interiorColor: "Black",
  bodyStyle: "Sedan",
  fuelType: "Gasoline",
  transmission: "Automatic transmission",
  descriptionPreview: "Heated seats, backup camera, lane keep assist",
};

test("photo uploads require an O'Regan's dealership and car selection", async () => {
  const harness = await startTestServer();

  try {
    const version = await fetchJson(`${harness.baseUrl}/api/version`);
    assert.equal(version.status, 200);
    assert.equal(version.body.ok, true);
    assert.equal(version.body.mode, "photo-albums");

    const unauthenticated = await fetchJson(`${harness.baseUrl}/api/inventory/dealerships`, {
      redirect: "manual",
    });
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.body.error, /Authentication required/i);

    const signup = await requestSignup(harness.baseUrl, {
      displayName: NEW_DISPLAY_NAME,
      username: NEW_USERNAME,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(signup.status, 200);
    assert.match(signup.body, /Konner needs to approve/i);

    const pendingLogin = await loginAttempt(harness.baseUrl, NEW_USERNAME, NEW_PASSWORD);
    assert.equal(pendingLogin.status, 401);
    assert.match(pendingLogin.body, /waiting for Konner to approve/i);
    assert.equal(pendingLogin.cookie, null);

    harness.cookie = await login(harness.baseUrl);
    const me = await getJson(harness, "/api/me");
    assert.equal(me.user.username, TEST_USERNAME);
    assert.equal(me.user.role, "admin");

    const adminPage = await fetch(`${harness.baseUrl}/admin/users`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(adminPage.status, 200);
    const adminPageText = await adminPage.text();
    assert.match(adminPageText, new RegExp(NEW_USERNAME.replace(".", "\\.")));
    assert.match(adminPageText, /Reset password/);

    const approved = await fetch(`${harness.baseUrl}/admin/users/${encodeURIComponent(NEW_USERNAME)}/approve`, {
      method: "POST",
      headers: { Cookie: harness.cookie },
      redirect: "manual",
    });
    assert.equal(approved.status, 303);

    let approvedCookie = await login(harness.baseUrl, NEW_USERNAME, NEW_PASSWORD);
    const approvedAccess = await fetchJson(`${harness.baseUrl}/api/inventory/dealerships`, {
      headers: { Cookie: approvedCookie },
    });
    assert.equal(approvedAccess.status, 200);
    assert.equal(approvedAccess.body.ok, true);

    const passwordPage = await fetch(`${harness.baseUrl}/account/password`, {
      headers: { Cookie: approvedCookie },
    });
    assert.equal(passwordPage.status, 200);
    assert.match(await passwordPage.text(), /Change password/);

    const wrongPasswordChange = await fetch(`${harness.baseUrl}/account/password`, {
      method: "POST",
      headers: { Cookie: approvedCookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        currentPassword: "wrong-password",
        password: CHANGED_PASSWORD,
        confirmPassword: CHANGED_PASSWORD,
      }),
    });
    assert.equal(wrongPasswordChange.status, 400);
    assert.match(await wrongPasswordChange.text(), /Current password is incorrect/);

    const passwordChange = await fetch(`${harness.baseUrl}/account/password`, {
      method: "POST",
      headers: { Cookie: approvedCookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        currentPassword: NEW_PASSWORD,
        password: CHANGED_PASSWORD,
        confirmPassword: CHANGED_PASSWORD,
      }),
    });
    assert.equal(passwordChange.status, 200);
    assert.match(await passwordChange.text(), /Password updated/);
    assert.equal((await loginAttempt(harness.baseUrl, NEW_USERNAME, NEW_PASSWORD)).status, 401);
    approvedCookie = await login(harness.baseUrl, NEW_USERNAME, CHANGED_PASSWORD);

    const adminResetPassword = await fetch(`${harness.baseUrl}/admin/users/${encodeURIComponent(NEW_USERNAME)}/password`, {
      method: "POST",
      headers: { Cookie: harness.cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        password: RESET_PASSWORD,
        confirmPassword: RESET_PASSWORD,
      }),
      redirect: "manual",
    });
    assert.equal(adminResetPassword.status, 303);
    assert.match(adminResetPassword.headers.get("location") || "", /Password\+reset/);
    assert.equal((await loginAttempt(harness.baseUrl, NEW_USERNAME, CHANGED_PASSWORD)).status, 401);
    approvedCookie = await login(harness.baseUrl, NEW_USERNAME, RESET_PASSWORD);

    const home = await fetch(`${harness.baseUrl}/`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(home.status, 200);
    const homeText = await home.text();
    assert.match(homeText, /Vehicle media intake/);
    assert.match(homeText, /id="carSelect"/);
    assert.match(homeText, /O'Regan's inventory/);

    const dealerships = await getJson(harness, "/api/inventory/dealerships");
    assert.equal(dealerships.ok, true);
    assert.ok(dealerships.dealerships.some((dealership) => dealership.id === "15"));
    assert.ok(dealerships.inventoryTypes.some((type) => type.id === "2"));

    const emptyChat = await getJson(harness, "/api/chat/messages");
    assert.equal(emptyChat.ok, true);
    assert.deepEqual(emptyChat.messages, []);

    const streamController = new AbortController();
    const chatStream = await fetch(`${harness.baseUrl}/api/chat/stream`, {
      headers: { Cookie: harness.cookie },
      signal: streamController.signal,
    });
    assert.equal(chatStream.status, 200);
    assert.match(chatStream.headers.get("content-type") || "", /^text\/event-stream/);
    streamController.abort();

    const chatPost = await postJson(harness, "/api/chat/messages", { text: "Ready for photos" });
    assert.equal(chatPost.status, 201);
    assert.equal(chatPost.body.ok, true);
    assert.equal(chatPost.body.message.text, "Ready for photos");
    assert.equal(chatPost.body.message.author, TEST_USERNAME);

    const chatAfterPost = await getJson(harness, "/api/chat/messages");
    assert.equal(chatAfterPost.messages.length, 1);
    assert.equal(chatAfterPost.messages[0].text, "Ready for photos");

    const cars = await getJson(harness, "/api/inventory/cars?dealershipId=15&inventoryTypeId=2");
    assert.equal(cars.count, 1);
    assert.equal(cars.cars[0].vin, TEST_CAR.vin);
    assert.equal(cars.cars[0].albumId, TEST_ALBUM_ID);
    assert.equal(cars.cars[0].inventoryKey, TEST_CAR.vin);

    const incompleteManualCar = await postJson(harness, "/api/manual-inventory/cars", {
      dealershipId: "15",
      inventoryTypeId: "2",
      stockNumber: "MISSING",
    });
    assert.equal(incompleteManualCar.status, 400);
    assert.match(incompleteManualCar.body.error, /Year/i);

    const manualCreated = await postJson(harness, "/api/manual-inventory/cars", MANUAL_CAR);
    assert.equal(manualCreated.status, 201);
    assert.equal(manualCreated.body.car.source, "manual");
    assert.equal(manualCreated.body.car.vin, "");
    assert.match(manualCreated.body.car.inventoryKey, /^manual-/);
    assert.equal(manualCreated.body.car.stockNumber, MANUAL_CAR.stockNumber);
    assert.equal(manualCreated.body.car.price, "$24,990");
    assert.equal(manualCreated.body.car.odometer, "12,000 km");

    const carsWithManual = await getJson(harness, "/api/inventory/cars?dealershipId=15&inventoryTypeId=2");
    assert.equal(carsWithManual.count, 2);
    assert.ok(carsWithManual.cars.some((car) => car.inventoryKey === manualCreated.body.car.inventoryKey));

    const manualAlbum = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&inventoryKey=${manualCreated.body.car.inventoryKey}`,
    );
    assert.equal(manualAlbum.album.vehicle.source, "manual");
    assert.equal(manualAlbum.album.vehicle.stockNumber, MANUAL_CAR.stockNumber);
    assert.equal(manualAlbum.album.vehicle.year, MANUAL_CAR.year);
    assert.equal(manualAlbum.album.vehicle.make, MANUAL_CAR.make);

    const manualUpload = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      inventoryKey: manualCreated.body.car.inventoryKey,
      photos: [{ filename: "manual-front.jpg", type: "image/jpeg", body: jpegBytes("manual-front") }],
    });
    assert.equal(manualUpload.status, 201);
    assert.equal(manualUpload.body.album.vehicle.source, "manual");
    assert.equal(manualUpload.body.marketplaceGeneration.variantCount, 6);

    const blockedUpload = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: "",
      photos: [{ filename: "blocked.jpg", type: "image/jpeg", body: jpegBytes("blocked") }],
    });
    assert.equal(blockedUpload.status, 400);
    assert.match(blockedUpload.body.error, /Select a car/i);

    const selectedAlbum = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(selectedAlbum.album.id, TEST_ALBUM_ID);
    assert.equal(selectedAlbum.album.name, `${TEST_CAR.title} - ${TEST_CAR.stockNumber}`);
    assert.equal(selectedAlbum.album.vehicle.stockNumber, TEST_CAR.stockNumber);
    assert.deepEqual(selectedAlbum.photos, []);

    const marketplaceDraft = await getJson(
      harness,
      `/api/marketplace-draft?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(marketplaceDraft.draft.title, "2026 Kia Seltos");
    assert.equal(marketplaceDraft.draft.fields.mileage, 1234);
    assert.equal(marketplaceDraft.draft.fields.price, 30990);
    assert.equal(marketplaceDraft.draft.fields.bodyStyle, "SUV");
    assert.equal(marketplaceDraft.draft.fields.interiorColor, "Black");
    assert.equal(marketplaceDraft.draft.descriptionSource, "not_generated");
    assert.equal(marketplaceDraft.draft.description, "");
    assert.equal(marketplaceDraft.draft.copyText, "");
    assert.ok(marketplaceDraft.draft.missingFields.includes("Description"));

    const uploaded = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "front.jpg", type: "image/jpeg", body: jpegBytes("front") },
        { filename: "interior.png", type: "image/png", body: pngBytes("interior") },
        { filename: "walkaround.mp4", type: "video/mp4", body: mp4Bytes("walkaround") },
      ],
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.ok, true);
    assert.equal(uploaded.body.album.vehicle.vin, TEST_CAR.vin);
    assert.equal(uploaded.body.count, 3);
    assert.equal(uploaded.body.marketplaceGeneration.source, "template-upload");
    assert.equal(uploaded.body.marketplaceGeneration.variantCount, 6);
    assert.equal(uploaded.body.marketplaceGeneration.assignedCount, 2);
    assert.equal(uploaded.body.marketplaceDraft.descriptionSource, "template-upload");
    assert.match(uploaded.body.marketplaceDraft.description, /Message me for more details/);
    assert.match(uploaded.body.marketplaceDraft.description, /Tire Road Hazard/);
    assert.doesNotMatch(uploaded.body.marketplaceDraft.description, new RegExp(TEST_CAR.stockNumber));
    assert.match(uploaded.body.marketplaceDraft.copyText, /Mileage: 1234 km/);

    const uploadedMarketplaceDraft = await getJson(
      harness,
      `/api/marketplace-draft?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    const photoTechMarketplaceDraft = await fetchJson(
      `${harness.baseUrl}/api/marketplace-draft?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
      { headers: { Cookie: approvedCookie } },
    );
    assert.equal(uploadedMarketplaceDraft.draft.descriptionSource, "template-upload");
    assert.equal(photoTechMarketplaceDraft.body.draft.descriptionSource, "template-upload");
    assert.notEqual(uploadedMarketplaceDraft.draft.description, photoTechMarketplaceDraft.body.draft.description);

    for (const photo of uploaded.body.photos) {
      const diskPath = path.join(harness.uploadRoot, TEST_ALBUM_ID, photo.filename);
      const stats = await fs.stat(diskPath);
      assert.equal(stats.isFile(), true);
      assert.ok(stats.size > 0);
    }

    const afterUpload = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(afterUpload.photos.length, 3);

    const firstPhoto = afterUpload.photos.find((photo) => photo.originalName === "front.jpg");
    assert.ok(firstPhoto);
    assert.match(firstPhoto.downloadUrl, /download=1/);
    const imageResponse = await fetch(`${harness.baseUrl}${firstPhoto.url}`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(imageResponse.status, 200);
    assert.match(imageResponse.headers.get("content-type") || "", /^image\/jpeg/);

    const imageDownload = await fetch(`${harness.baseUrl}${firstPhoto.downloadUrl}`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(imageDownload.status, 200);
    assert.match(imageDownload.headers.get("content-disposition") || "", /attachment/);
    assert.match(imageDownload.headers.get("content-disposition") || "", /front\.jpg/);

    const firstVideo = afterUpload.photos.find((photo) => photo.originalName === "walkaround.mp4");
    assert.ok(firstVideo);
    assert.equal(firstVideo.kind, "video");
    assert.match(firstVideo.contentType, /^video\/mp4/);
    assert.match(firstVideo.url, /\/api\/albums\/[^/]+\/media\//);
    const videoRange = await fetch(`${harness.baseUrl}${firstVideo.url}`, {
      headers: { Cookie: harness.cookie, Range: "bytes=0-7" },
    });
    assert.equal(videoRange.status, 206);
    assert.equal(videoRange.headers.get("accept-ranges"), "bytes");
    assert.equal(videoRange.headers.get("content-range"), `bytes 0-7/${firstVideo.bytes}`);
    assert.equal(videoRange.headers.get("content-length"), "8");
    assert.match(videoRange.headers.get("content-type") || "", /^video\/mp4/);
    assert.deepEqual(Buffer.from(await videoRange.arrayBuffer()), mp4Bytes("walkaround").subarray(0, 8));

    const videoSuffixRange = await fetch(`${harness.baseUrl}${firstVideo.url}`, {
      headers: { Cookie: harness.cookie, Range: "bytes=-4" },
    });
    assert.equal(videoSuffixRange.status, 206);
    assert.equal(videoSuffixRange.headers.get("content-range"), `bytes ${firstVideo.bytes - 4}-${firstVideo.bytes - 1}/${firstVideo.bytes}`);

    const legacyVideoRange = await fetch(`${harness.baseUrl}${firstVideo.legacyUrl}`, {
      headers: { Cookie: harness.cookie, Range: "bytes=0-1" },
    });
    assert.equal(legacyVideoRange.status, 206);

    const invalidVideoRange = await fetch(`${harness.baseUrl}${firstVideo.url}`, {
      headers: { Cookie: harness.cookie, Range: `bytes=${firstVideo.bytes}-` },
    });
    assert.equal(invalidVideoRange.status, 416);
    assert.equal(invalidVideoRange.headers.get("content-range"), `bytes */${firstVideo.bytes}`);

    const albums = await getJson(harness, "/api/albums");
    const testAlbum = albums.albums.find((album) => album.vehicle.vin === TEST_CAR.vin);
    const savedManualAlbum = albums.albums.find((album) => album.vehicle.inventoryKey === manualCreated.body.car.inventoryKey);
    assert.ok(testAlbum);
    assert.ok(savedManualAlbum);
    assert.equal(testAlbum.photoCount, 2);
    assert.equal(testAlbum.videoCount, 1);
    assert.equal(testAlbum.mediaCount, 3);

    const albumDownload = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/download`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(albumDownload.status, 200);
    assert.match(albumDownload.headers.get("content-type") || "", /zip/);
    assert.match(albumDownload.headers.get("content-disposition") || "", /attachment/);

    const deleted = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/photos/${encodeURIComponent(firstPhoto.filename)}`, {
      method: "DELETE",
      headers: { Cookie: harness.cookie, Accept: "application/json" },
    });
    assert.equal(deleted.status, 200);

    const afterDelete = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(afterDelete.photos.length, 2);
    assert.deepEqual(afterDelete.photos.map((photo) => photo.originalName).sort(), ["interior.png", "walkaround.mp4"]);

    const deletedAll = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/media`, {
      method: "DELETE",
      headers: { Cookie: harness.cookie, Accept: "application/json" },
    });
    assert.equal(deletedAll.status, 200);
    assert.equal((await deletedAll.json()).deleted, 2);

    const afterDeleteAll = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.deepEqual(afterDeleteAll.photos, []);
  } finally {
    await stopTestServer(harness);
  }
});

async function startTestServer() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "konner-albums-test-"));
  const uploadRoot = path.join(tempRoot, "uploads");
  const tmpRoot = path.join(tempRoot, "tmp");
  const inventoryMockFile = path.join(tempRoot, "inventory.json");
  await fs.writeFile(inventoryMockFile, `${JSON.stringify({ cars: [TEST_CAR] }, null, 2)}\n`);
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
      KONNER_AUTH_USERNAME: TEST_USERNAME,
      KONNER_AUTH_PASSWORD: TEST_PASSWORD,
      KONNER_AUTH_PASSWORD_HASH: "",
      KONNER_AUTH_SESSION_SECRET: "test-session-secret",
      KONNER_AUTH_COOKIE_SECURE: "false",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
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
      sleep(3000),
    ]);
  }
  await fs.rm(harness.tempRoot, { recursive: true, force: true });
}

async function waitForHealth(baseUrl, child, output) {
  const deadline = Date.now() + 10000;
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
  const attempt = await loginAttempt(baseUrl, username, password);
  assert.equal(attempt.status, 303);
  assert.match(attempt.cookie || "", /^konner_upload_session=/);
  return attempt.cookie;
}

async function loginAttempt(baseUrl, username = TEST_USERNAME, password = TEST_PASSWORD) {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie");
  return {
    status: response.status,
    body: await response.text(),
    cookie: cookie ? cookie.split(";")[0] : null,
  };
}

async function requestSignup(baseUrl, body) {
  const response = await fetch(`${baseUrl}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    redirect: "manual",
  });
  return {
    status: response.status,
    body: await response.text(),
  };
}

async function getJson(harness, pathname) {
  const response = await fetch(`${harness.baseUrl}${pathname}`, {
    headers: { Cookie: harness.cookie, Accept: "application/json" },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function postJson(harness, pathname, body) {
  const response = await fetch(`${harness.baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      Cookie: harness.cookie,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function uploadPhotos(harness, { dealershipId, inventoryTypeId, vin, inventoryKey, photos }) {
  const form = new FormData();
  form.set("dealershipId", dealershipId);
  form.set("inventoryTypeId", inventoryTypeId);
  if (inventoryKey) form.set("inventoryKey", inventoryKey);
  if (vin) form.set("vin", vin);
  for (const photo of photos) {
    form.append("photos", new Blob([photo.body], { type: photo.type }), photo.filename);
  }

  const response = await fetch(`${harness.baseUrl}/api/upload`, {
    method: "POST",
    headers: {
      Cookie: harness.cookie,
      Accept: "application/json",
    },
    body: form,
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

function jpegBytes(label) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(label),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function pngBytes(label) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label),
  ]);
}

function mp4Bytes(label) {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypmp42"),
    Buffer.from(label),
  ]);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
