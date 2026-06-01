import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const TINY_HEIC_BASE64 = [
  "AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABw21ldGEAAAAAAAAAIWhkbHIA",
  "AAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAA5mlwcnAAAADFaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAAAIAAAACAAAAAlpcm90AAAAABBwaXhpAAAAAAMICAgAAABxaHZjQwEDcAAAALAAAAAAAB7wAPz9+PgAAAsDoAABABdAAQwB//8DcAAAAwCwAAADAAADAB5wJKEAAQAjQgEBA3AAAAMAsAAAAwAAAwAeoBQgQcCbDuIe5FlU3AgIGAKiAAEACUQBwGFyyEBTJAAAABlpcG1hAAAAAAAAAAEAAQaBAgMFhoQAAAAsaWxvYwAAAABEAAACAAEAAAABAAACQwAAADsAAgAAAAEAAAH3AAAATAAAAAFtZGF0AAAAAAAAAJcAAAAGRXhpZgAATU0AKgAAAAgAAwEaAAUAAAABAAAAMgEbAAUAAAABAAAAOgEoAAMAAAABAAIAAAAAAAAAAAAZAAAAAQAAABkAAAABAAAANygBr6LyRoF8/8X//+Rr7L7dzfVf3nyPtAIv94VPdMsmf6Ag+cI1PkOyhr/JHgi9hX4RbWMmyK4=",
].join("");
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
const LONG_TITLE_CAR = {
  ...TEST_CAR,
  dealershipId: "15",
  inventoryTypeId: "1",
  vin: "KNDPYDDH1T7000012",
  stockNumber: "A10012",
  title: "New 2026 Kia Sportage Plug-In Hybrid EX Eligible for up to a $2500 federal government incentive",
  inventoryType: "-",
  detailUrl: "https://www.oregans.com/inventory/New-2026-Kia-Sportage-A10012/",
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

    const loginPage = await fetch(`${harness.baseUrl}/login`, { redirect: "manual" });
    assert.equal(loginPage.status, 200);
    assertNoStoreHeaders(loginPage);

    const signup = await requestSignup(harness.baseUrl, {
      displayName: NEW_DISPLAY_NAME,
      username: NEW_USERNAME,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(signup.status, 200);
    assertNoStoreHeaders(signup);
    assert.match(signup.body, /CarPostClub admin needs to approve/i);

    const pendingLogin = await loginAttempt(harness.baseUrl, NEW_USERNAME, NEW_PASSWORD);
    assert.equal(pendingLogin.status, 401);
    assert.match(pendingLogin.body, /waiting for a CarPostClub admin to approve/i);
    assert.equal(pendingLogin.cookie, null);

    harness.cookie = await login(harness.baseUrl);
    const adminSession = sessionPayloadFromCookie(harness.cookie);
    assert.equal(adminSession.u, TEST_USERNAME);
    assert.match(adminSession.pv, /^[A-Za-z0-9_-]{40,}$/);
    const staleBootstrapCookie = signedSessionCookie({
      v: 1,
      u: TEST_USERNAME,
      role: "admin",
      pv: "stale-bootstrap-password-version",
      iat: Date.now(),
      exp: Date.now() + 24 * 60 * 60 * 1000,
    });
    const staleBootstrapAccess = await fetchJson(`${harness.baseUrl}/api/me`, {
      headers: { Cookie: staleBootstrapCookie },
    });
    assert.equal(staleBootstrapAccess.status, 401);

    const me = await getJson(harness, "/api/me");
    assert.equal(me.user.username, TEST_USERNAME);
    assert.equal(me.user.role, "admin");

    const pushConfig = await getJson(harness, "/api/push/config");
    assert.equal(pushConfig.ok, true);
    assert.match(pushConfig.publicKey, /^[A-Za-z0-9_-]{80,}$/);

    const pushSubscription = {
      endpoint: "https://push.example.test/send/sub-1",
      keys: {
        p256dh: "B".repeat(88),
        auth: "A".repeat(22),
      },
    };
    const savedPush = await postJson(harness, "/api/push/subscriptions", { subscription: pushSubscription });
    assert.equal(savedPush.status, 201);
    assert.equal(savedPush.body.ok, true);
    assert.equal(savedPush.body.subscription.endpoint, pushSubscription.endpoint);
    assert.equal(savedPush.body.subscription.username, TEST_USERNAME);
    const storedAdminPush = await readPushSubscription(harness, pushSubscription.endpoint);
    assert.equal(storedAdminPush.passwordVersion, adminSession.pv);

    const testPush = await postJson(harness, "/api/push/test", {});
    assert.equal(testPush.status, 200);
    assert.equal(testPush.body.delivery.requested, 1);
    assert.equal(testPush.body.delivery.skipped, 1);

    const deletedPush = await deleteJson(harness, "/api/push/subscriptions", {
      endpoint: pushSubscription.endpoint,
    });
    assert.equal(deletedPush.status, 200);
    assert.equal(deletedPush.body.removed, true);

    const staleAdminSubscription = pushSubscriptionFor("stale-bootstrap-admin");
    await writePushSubscriptions(harness, [{
      ...staleAdminSubscription,
      username: TEST_USERNAME,
      displayName: TEST_USERNAME,
      passwordVersion: "stale-bootstrap-password-version",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);
    const staleAdminPush = await postJson(harness, "/api/push/test", {});
    assert.equal(staleAdminPush.status, 200);
    assert.equal(staleAdminPush.body.delivery.requested, 0);
    assert.equal(staleAdminPush.body.delivery.retiredRemoved, 1);
    assert.equal((await readPushSubscriptionCount(harness, staleAdminSubscription.endpoint)), 0);

    const adminPage = await fetch(`${harness.baseUrl}/admin/users`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(adminPage.status, 200);
    assertNoStoreHeaders(adminPage);
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

    const approvedPasswordPush = await postJsonWithCookie(harness, approvedCookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("photo-tech-password"),
    });
    assert.equal(approvedPasswordPush.status, 201);
    assert.equal(approvedPasswordPush.body.subscription.username, NEW_USERNAME);
    const pushBeforePasswordChange = await postJsonWithCookie(harness, approvedCookie, "/api/push/test", {});
    assert.equal(pushBeforePasswordChange.status, 200);
    assert.equal(pushBeforePasswordChange.body.delivery.requested, 1);
    assert.equal(pushBeforePasswordChange.body.delivery.skipped, 1);

    const passwordPage = await fetch(`${harness.baseUrl}/account/password`, {
      headers: { Cookie: approvedCookie },
    });
    assert.equal(passwordPage.status, 200);
    assertNoStoreHeaders(passwordPage);
    const passwordPageText = await passwordPage.text();
    assert.match(passwordPageText, /Change password/);
    assert.match(passwordPageText, /\/styles\.css\?v=20260530-auth-pwa/);
    assert.match(passwordPageText, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(passwordPageText, /<link rel="apple-touch-icon" href="\/icons\/carpostclub-apple-touch-icon\.png">/);
    assert.match(passwordPageText, /class="auth-brand"/);

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

    const cookieBeforePasswordChange = approvedCookie;
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
    const refreshedCookie = passwordChange.headers.get("set-cookie")?.split(";")[0] || "";
    assert.match(refreshedCookie, /^carpostclub_session=/);
    const staleAfterPasswordChange = await fetchJson(`${harness.baseUrl}/api/me`, {
      headers: { Cookie: cookieBeforePasswordChange },
    });
    assert.equal(staleAfterPasswordChange.status, 401);
    assert.equal((await loginAttempt(harness.baseUrl, NEW_USERNAME, NEW_PASSWORD)).status, 401);
    approvedCookie = refreshedCookie;
    const pushAfterPasswordChange = await postJsonWithCookie(harness, approvedCookie, "/api/push/test", {});
    assert.equal(pushAfterPasswordChange.status, 200);
    assert.equal(pushAfterPasswordChange.body.delivery.requested, 0);

    const cookieBeforeAdminReset = approvedCookie;
    const approvedResetPush = await postJsonWithCookie(harness, approvedCookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("photo-tech-reset"),
    });
    assert.equal(approvedResetPush.status, 201);
    const pushBeforeAdminReset = await postJsonWithCookie(harness, approvedCookie, "/api/push/test", {});
    assert.equal(pushBeforeAdminReset.status, 200);
    assert.equal(pushBeforeAdminReset.body.delivery.requested, 1);
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
    const staleAfterAdminReset = await fetchJson(`${harness.baseUrl}/api/me`, {
      headers: { Cookie: cookieBeforeAdminReset },
    });
    assert.equal(staleAfterAdminReset.status, 401);
    approvedCookie = await login(harness.baseUrl, NEW_USERNAME, RESET_PASSWORD);
    const pushAfterAdminReset = await postJsonWithCookie(harness, approvedCookie, "/api/push/test", {});
    assert.equal(pushAfterAdminReset.status, 200);
    assert.equal(pushAfterAdminReset.body.delivery.requested, 0);

    const logoutSubscription = pushSubscriptionFor("photo-tech-logout");
    const approvedLogoutPush = await postJsonWithCookie(harness, approvedCookie, "/api/push/subscriptions", {
      subscription: logoutSubscription,
    });
    assert.equal(approvedLogoutPush.status, 201);
    assert.equal((await readPushSubscriptionCount(harness, logoutSubscription.endpoint)), 1);
    const logout = await fetch(`${harness.baseUrl}/logout`, {
      method: "POST",
      headers: { Cookie: approvedCookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ pushEndpoint: logoutSubscription.endpoint }),
      redirect: "manual",
    });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get("location"), "/login");
    assertNoStoreHeaders(logout);
    assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);
    assert.equal((await readPushSubscriptionCount(harness, logoutSubscription.endpoint)), 0);
    approvedCookie = await login(harness.baseUrl, NEW_USERNAME, RESET_PASSWORD);

    const rejectable = await createApprovedAccount(harness, {
      username: "reject.me",
      displayName: "Reject Me",
      password: "reject-me-123",
    });
    const rejectableSubscription = pushSubscriptionFor("reject-me");
    const rejectablePush = await postJsonWithCookie(harness, rejectable.cookie, "/api/push/subscriptions", {
      subscription: rejectableSubscription,
    });
    assert.equal(rejectablePush.status, 201);
    assert.equal((await postJsonWithCookie(harness, rejectable.cookie, "/api/push/test", {})).body.delivery.requested, 1);
    const rejected = await fetch(`${harness.baseUrl}/admin/users/${encodeURIComponent(rejectable.username)}/reject`, {
      method: "POST",
      headers: { Cookie: harness.cookie },
      redirect: "manual",
    });
    assert.equal(rejected.status, 303);
    const rejectedAccess = await fetchJson(`${harness.baseUrl}/api/me`, {
      headers: { Cookie: rejectable.cookie },
    });
    assert.equal(rejectedAccess.status, 401);
    assert.equal((await readPushSubscriptionCount(harness, rejectableSubscription.endpoint)), 0);

    const reapproved = await fetch(`${harness.baseUrl}/admin/users/${encodeURIComponent(rejectable.username)}/approve`, {
      method: "POST",
      headers: { Cookie: harness.cookie },
      redirect: "manual",
    });
    assert.equal(reapproved.status, 303);
    const oldCookieAfterReapproval = await fetchJson(`${harness.baseUrl}/api/me`, {
      headers: { Cookie: rejectable.cookie },
    });
    assert.equal(oldCookieAfterReapproval.status, 401);
    const reapprovedCookie = await login(harness.baseUrl, rejectable.username, rejectable.password);
    const freshCookieAfterReapproval = await fetchJson(`${harness.baseUrl}/api/me`, {
      headers: { Cookie: reapprovedCookie },
    });
    assert.equal(freshCookieAfterReapproval.status, 200);
    assert.equal(freshCookieAfterReapproval.body.user.username, rejectable.username);
    const pushAfterReapproval = await postJsonWithCookie(harness, reapprovedCookie, "/api/push/test", {});
    assert.equal(pushAfterReapproval.status, 200);
    assert.equal(pushAfterReapproval.body.delivery.requested, 0);
    const rejectedAgain = await fetch(`${harness.baseUrl}/admin/users/${encodeURIComponent(rejectable.username)}/reject`, {
      method: "POST",
      headers: { Cookie: harness.cookie },
      redirect: "manual",
    });
    assert.equal(rejectedAgain.status, 303);
    const reapprovedCookieAfterSecondRejection = await fetchJson(`${harness.baseUrl}/api/me`, {
      headers: { Cookie: reapprovedCookie },
    });
    assert.equal(reapprovedCookieAfterSecondRejection.status, 401);

    const home = await fetch(`${harness.baseUrl}/`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(home.status, 200);
    assertNoStoreHeaders(home);
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

    await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-chat"),
    });
    const approvedPush = await postJsonWithCookie(harness, approvedCookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("photo-tech-chat"),
    });
    assert.equal(approvedPush.status, 201);
    assert.equal(approvedPush.body.subscription.username, NEW_USERNAME);

    const chatPost = await postJson(harness, "/api/chat/messages", { text: "Ready for photos" });
    assert.equal(chatPost.status, 201);
    assert.equal(chatPost.body.ok, true);
    assert.equal(chatPost.body.message.text, "Ready for photos");
    assert.equal(chatPost.body.message.author, TEST_USERNAME);
    assert.equal(chatPost.body.message.authorDisplayName, TEST_USERNAME);
    assert.equal(chatPost.body.message.authorUsername, TEST_USERNAME);
    assert.equal(chatPost.body.pushDelivery.requested, 1);
    assert.equal(chatPost.body.pushDelivery.skipped, 1);

    const chatAfterPost = await getJson(harness, "/api/chat/messages");
    assert.equal(chatAfterPost.messages.length, 1);
    assert.equal(chatAfterPost.messages[0].text, "Ready for photos");
    assert.equal(chatAfterPost.messages[0].authorUsername, TEST_USERNAME);

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

    const marketplaceCopyConflictPath = path.join(harness.uploadRoot, TEST_ALBUM_ID, ".marketplace-copy.json");
    await fs.mkdir(marketplaceCopyConflictPath, { recursive: true });
    const failedGeneratedUpload = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "rollback-front.jpg", type: "image/jpeg", body: jpegBytes("rollback-front") },
        { filename: "rollback-interior.png", type: "image/png", body: pngBytes("rollback-interior") },
      ],
    });
    assert.equal(failedGeneratedUpload.status, 500);
    assert.match(failedGeneratedUpload.body.error, /Unexpected server error/);
    const afterFailedGeneratedUpload = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.deepEqual(afterFailedGeneratedUpload.photos, []);
    assert.deepEqual(await fs.readdir(harness.tmpRoot), []);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(harness.uploadRoot, TEST_ALBUM_ID, ".photos.json"), "utf8")),
      {},
    );
    await fs.rm(marketplaceCopyConflictPath, { recursive: true, force: true });

    const uploaded = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "front.jpg", type: "image/jpeg", body: jpegBytes("front") },
        { filename: "interior.png", type: "image/png", body: pngBytes("interior") },
        { filename: "lot-tag.jpg", type: "image/heic", body: heicBytes() },
        { filename: "walkaround.mp4", type: "video/mp4", body: mp4Bytes("walkaround") },
      ],
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.ok, true);
    assert.equal(uploaded.body.album.vehicle.vin, TEST_CAR.vin);
    assert.equal(uploaded.body.count, 4);
    assert.ok(uploaded.body.photos.every((photo) => photo.uploadedBy?.username === TEST_USERNAME));
    assert.ok(uploaded.body.photos.every((photo) => photo.uploadedBy?.displayName === TEST_USERNAME));
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

    const regeneratedMarketplaceDraft = await postJson(harness, "/api/marketplace-draft/regenerate", {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
    });
    assert.equal(regeneratedMarketplaceDraft.status, 200);
    assert.equal(regeneratedMarketplaceDraft.body.draft.descriptionSource, "template-upload");
    assert.notEqual(
      regeneratedMarketplaceDraft.body.draft.descriptionVariantId,
      uploadedMarketplaceDraft.draft.descriptionVariantId,
    );
    assert.notEqual(
      regeneratedMarketplaceDraft.body.draft.description,
      uploadedMarketplaceDraft.draft.description,
    );
    const refreshedMarketplaceDraft = await getJson(
      harness,
      `/api/marketplace-draft?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(refreshedMarketplaceDraft.draft.description, regeneratedMarketplaceDraft.body.draft.description);

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
    assert.equal(afterUpload.photos.length, 4);

    const firstPhoto = afterUpload.photos.find((photo) => photo.originalName === "front.jpg");
    assert.ok(firstPhoto);
    assert.equal(firstPhoto.uploadedBy.username, TEST_USERNAME);
    assert.equal(firstPhoto.uploadedBy.displayName, TEST_USERNAME);
    assert.match(firstPhoto.thumbnailUrl, /\/thumbnail$/);
    assert.match(firstPhoto.downloadUrl, /download=1/);
    const imageResponse = await fetch(`${harness.baseUrl}${firstPhoto.url}`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(imageResponse.status, 200);
    assert.match(imageResponse.headers.get("content-type") || "", /^image\/jpeg/);

    const thumbnailResponse = await fetch(`${harness.baseUrl}${firstPhoto.thumbnailUrl}`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(thumbnailResponse.status, 200);
    assert.match(thumbnailResponse.headers.get("content-type") || "", /^image\//);

    const imageDownload = await fetch(`${harness.baseUrl}${firstPhoto.downloadUrl}`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(imageDownload.status, 200);
    assert.match(imageDownload.headers.get("content-disposition") || "", /attachment/);
    assert.match(imageDownload.headers.get("content-disposition") || "", /front\.jpg/);

    const heicPhoto = afterUpload.photos.find((photo) => photo.originalName === "lot-tag.jpg");
    assert.ok(heicPhoto);
    assert.equal(heicPhoto.kind, "image");
    assert.match(heicPhoto.filename, /\.heic$/);
    assert.equal(heicPhoto.contentType, "image/heic");
    assert.equal(heicPhoto.downloadName, "lot-tag.heic");
    const heicThumbnail = await fetch(`${harness.baseUrl}${heicPhoto.thumbnailUrl}`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(heicThumbnail.status, 200);
    assert.equal(heicThumbnail.headers.get("content-type"), "image/webp");
    const heicDownload = await fetch(`${harness.baseUrl}${heicPhoto.downloadUrl}`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(heicDownload.status, 200);
    assert.equal(heicDownload.headers.get("content-type"), "image/heic");
    assert.match(heicDownload.headers.get("content-disposition") || "", /lot-tag\.heic/);
    assert.deepEqual(Buffer.from(await heicDownload.arrayBuffer()), heicBytes());

    const firstVideo = afterUpload.photos.find((photo) => photo.originalName === "walkaround.mp4");
    assert.ok(firstVideo);
    assert.equal(firstVideo.uploadedBy.username, TEST_USERNAME);
    assert.equal(firstVideo.uploadedBy.displayName, TEST_USERNAME);
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
    assert.equal(testAlbum.photoCount, 3);
    assert.equal(testAlbum.videoCount, 1);
    assert.equal(testAlbum.mediaCount, 4);

    const albumDownload = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/download`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(albumDownload.status, 200);
    assert.match(albumDownload.headers.get("content-type") || "", /zip/);
    assert.match(albumDownload.headers.get("content-disposition") || "", /attachment/);
    const albumDownloadBytes = Buffer.from(await albumDownload.arrayBuffer());
    assert.ok(albumDownloadBytes.includes(Buffer.from("lot-tag.heic")));
    assert.ok(!albumDownloadBytes.includes(Buffer.from("lot-tag.jpg")));

    const deleted = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/photos/${encodeURIComponent(firstPhoto.filename)}`, {
      method: "DELETE",
      headers: { Cookie: harness.cookie, Accept: "application/json" },
    });
    assert.equal(deleted.status, 200);

    const afterDelete = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(afterDelete.photos.length, 3);
    assert.deepEqual(afterDelete.photos.map((photo) => photo.originalName).sort(), ["interior.png", "lot-tag.jpg", "walkaround.mp4"]);

    const deletedAll = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/media`, {
      method: "DELETE",
      headers: { Cookie: harness.cookie, Accept: "application/json" },
    });
    assert.equal(deletedAll.status, 200);
    assert.equal((await deletedAll.json()).deleted, 3);

    const afterDeleteAll = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.deepEqual(afterDeleteAll.photos, []);

    await assert.rejects(
      fs.access(path.join(harness.uploadRoot, TEST_ALBUM_ID, ".marketplace-copy.json")),
      { code: "ENOENT" },
    );
    const marketplaceDraftAfterDeleteAll = await getJson(
      harness,
      `/api/marketplace-draft?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(marketplaceDraftAfterDeleteAll.draft.descriptionSource, "not_generated");
    assert.equal(marketplaceDraftAfterDeleteAll.draft.description, "");
    assert.equal(marketplaceDraftAfterDeleteAll.draft.copyText, "");
    assert.ok(marketplaceDraftAfterDeleteAll.draft.missingFields.includes("Description"));
  } finally {
    await stopTestServer(harness);
  }
});

test("vehicle album lookup reuses existing media when live inventory titles drift", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const oldAlbumId = "car-used-2026-kia-seltos-previous-title-u6247a";
    const oldAlbumPath = path.join(harness.uploadRoot, oldAlbumId);
    const filename = "2026-06-01T10-00-00-000Z-title-drift-front.jpg";
    await fs.mkdir(oldAlbumPath, { recursive: true });
    await fs.writeFile(path.join(oldAlbumPath, filename), jpegBytes("title-drift-front"));
    await fs.writeFile(path.join(oldAlbumPath, ".album.json"), `${JSON.stringify({
      id: oldAlbumId,
      name: "Previous title - U6247A",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dealership: { id: "15", name: "O'Regan's Kia Halifax" },
      inventoryTypeId: "2",
      vehicle: {
        source: "oregans",
        inventoryKey: TEST_CAR.vin,
        vin: TEST_CAR.vin,
        stockNumber: TEST_CAR.stockNumber,
        title: "Previous live title",
        dealershipId: "15",
      },
    }, null, 2)}\n`);
    await fs.writeFile(path.join(oldAlbumPath, ".photos.json"), `${JSON.stringify({
      [filename]: {
        originalName: "title-drift-front.jpg",
        contentType: "image/jpeg",
        bytes: Buffer.byteLength(jpegBytes("title-drift-front")),
        uploadedAt: new Date().toISOString(),
        uploadedBy: { username: TEST_USERNAME, displayName: TEST_USERNAME },
      },
    }, null, 2)}\n`);

    const album = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${encodeURIComponent(TEST_CAR.vin)}`,
    );
    assert.equal(album.album.id, oldAlbumId);
    assert.equal(album.album.vehicle.title, TEST_CAR.title);
    assert.equal(album.photos.length, 1);
    assert.equal(album.photos[0].originalName, "title-drift-front.jpg");
  } finally {
    await stopTestServer(harness);
  }
});

test("iOS Shortcut endpoints upload shared Photos media by stock number", async () => {
  const harness = await startTestServer();

  try {
    const unauthenticated = await fetch(`${harness.baseUrl}/api/shortcut/vehicle?stockNumber=${encodeURIComponent(TEST_CAR.stockNumber)}`, {
      headers: { Accept: "application/json" },
    });
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get("www-authenticate") || "", /CarPostClub Shortcut/);

    const unauthenticatedTokens = await fetchJson(`${harness.baseUrl}/api/shortcut/tokens`, {
      redirect: "manual",
    });
    assert.equal(unauthenticatedTokens.status, 401);

    const shortcutDownload = await fetch(`${harness.baseUrl}/shortcuts/upload-to-carpostclub-pick-vehicle.shortcut`);
    assert.equal(shortcutDownload.status, 200);
    assertNoStoreHeaders(shortcutDownload);
    assert.match(shortcutDownload.headers.get("content-type") || "", /application\/octet-stream/);
    assert.match(shortcutDownload.headers.get("content-disposition") || "", /Upload to CarPostClub Pick Vehicle\.shortcut/);
    assert.ok((await shortcutDownload.arrayBuffer()).byteLength > 1000);

    const legacyShortcutDownload = await fetch(`${harness.baseUrl}/shortcuts/upload-to-carpostclub.shortcut`);
    assert.equal(legacyShortcutDownload.status, 200);
    assert.match(legacyShortcutDownload.headers.get("content-disposition") || "", /Upload to CarPostClub Pick Vehicle\.shortcut/);

    const v2ShortcutDownload = await fetch(`${harness.baseUrl}/shortcuts/upload-to-carpostclub-v2.shortcut`);
    assert.equal(v2ShortcutDownload.status, 200);
    assert.match(v2ShortcutDownload.headers.get("content-disposition") || "", /Upload to CarPostClub Pick Vehicle\.shortcut/);

    harness.cookie = await login(harness.baseUrl);

    const createdToken = await postJson(harness, "/api/shortcut/tokens", { name: "Konner iPhone" });
    assert.equal(createdToken.status, 201);
    assert.equal(createdToken.body.ok, true);
    assert.match(createdToken.body.token, /^cpcst_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
    assert.equal(createdToken.body.authorizationHeader, `Bearer ${createdToken.body.token}`);
    assert.equal(createdToken.body.record.name, "Konner iPhone");
    assert.equal(createdToken.body.record.username, TEST_USERNAME);
    assert.equal(createdToken.body.record.status, "active");
    assert.equal(createdToken.body.record.tokenHash, undefined);
    assert.equal(createdToken.body.shortcutDownloadUrl, "/shortcuts/upload-to-carpostclub-pick-vehicle.shortcut");
    assert.equal(createdToken.body.shortcutWorkflowVersion, "pick-vehicle-v8");

    const listedTokens = await getJson(harness, "/api/shortcut/tokens");
    assert.equal(listedTokens.shortcutDownloadUrl, "/shortcuts/upload-to-carpostclub-pick-vehicle.shortcut");
    assert.equal(listedTokens.shortcutWorkflowVersion, "pick-vehicle-v8");
    assert.equal(listedTokens.tokens.length, 1);
    assert.equal(listedTokens.tokens[0].id, createdToken.body.record.id);
    assert.equal(listedTokens.tokens[0].name, "Konner iPhone");
    assert.equal(JSON.stringify(listedTokens).includes(createdToken.body.token), false);
    const storedTokens = await readShortcutTokens(harness);
    assert.equal(storedTokens.length, 1);
    assert.equal(storedTokens[0].tokenHash?.length > 20, true);
    assert.equal(JSON.stringify(storedTokens).includes(createdToken.body.token), false);

    const bearerLookup = await fetchJson(
      `${harness.baseUrl}/api/shortcut/vehicle?stockNumber=${encodeURIComponent(TEST_CAR.stockNumber)}`,
      { headers: shortcutBearerHeaders(createdToken.body.token) },
    );
    assert.equal(bearerLookup.status, 200);
    assert.equal(bearerLookup.body.source, "ios-shortcut");
    assert.equal(bearerLookup.body.matchedBy, "stockNumber");
    assert.equal(bearerLookup.body.car.vin, TEST_CAR.vin);

    const dealershipPicklist = await fetch(`${harness.baseUrl}/api/shortcut/dealerships?format=labels`, {
      headers: shortcutBearerHeaders(createdToken.body.token),
    });
    assert.equal(dealershipPicklist.status, 200);
    assertNoStoreHeaders(dealershipPicklist);
    assert.match(dealershipPicklist.headers.get("content-type") || "", /text\/plain/);
    const dealershipPicklistText = await dealershipPicklist.text();
    assert.ok(dealershipPicklistText.split("\n").includes("O'Regan's Kia Halifax"));
    assert.doesNotMatch(dealershipPicklistText, /\n$/);

    const dealershipJson = await fetchJson(`${harness.baseUrl}/api/shortcut/dealerships`, {
      headers: shortcutBearerHeaders(createdToken.body.token),
    });
    assert.equal(dealershipJson.status, 200);
    assert.equal(dealershipJson.body.dealerships[0].name, "O'Regan's Kia Halifax");

    const inventoryTypeForm = new URLSearchParams();
    inventoryTypeForm.set("dealership", "O'Regan's Kia Halifax");
    const inventoryTypePicklist = await fetch(`${harness.baseUrl}/api/shortcut/inventory-types?format=labels`, {
      method: "POST",
      headers: {
        ...shortcutBearerHeaders(createdToken.body.token),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: inventoryTypeForm,
    });
    assert.equal(inventoryTypePicklist.status, 200);
    assert.equal(await inventoryTypePicklist.text(), "Used vehicles\nNew vehicles");

    const inventoryForm = new URLSearchParams();
    inventoryForm.set("dealership", "O'Regan's Kia Halifax");
    inventoryForm.set("inventoryType", "Used vehicles");
    const shortcutChoiceLabel = "U6247A - Used 2026 Kia Seltos X-Line AWD - Kia Halifax - Used";
    const shortcutInventoryList = await fetch(`${harness.baseUrl}/api/shortcut/inventory?format=labels`, {
      method: "POST",
      headers: {
        ...shortcutBearerHeaders(createdToken.body.token),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: inventoryForm,
    });
    assert.equal(shortcutInventoryList.status, 200);
    assertNoStoreHeaders(shortcutInventoryList);
    assert.match(shortcutInventoryList.headers.get("content-type") || "", /text\/plain/);
    const shortcutInventoryText = await shortcutInventoryList.text();
    assert.equal(shortcutInventoryText, shortcutChoiceLabel);

    const shortcutInventoryJson = await fetchJson(`${harness.baseUrl}/api/shortcut/inventory?dealership=${encodeURIComponent("O'Regan's Kia Halifax")}&inventoryType=Used%20vehicles`, {
      headers: shortcutBearerHeaders(createdToken.body.token),
    });
    assert.equal(shortcutInventoryJson.status, 200);
    assert.equal(shortcutInventoryJson.body.ok, true);
    assert.equal(shortcutInventoryJson.body.count, 1);
    assert.equal(shortcutInventoryJson.body.cars[0].label, shortcutChoiceLabel);
    assert.equal(shortcutInventoryJson.body.cars[0].vin, TEST_CAR.vin);
    assert.equal(shortcutInventoryJson.body.cars[0].dealershipName, "O'Regan's Kia Halifax");

    const choiceLookup = await fetchJson(
      `${harness.baseUrl}/api/shortcut/vehicle?dealership=${encodeURIComponent("O'Regan's Kia Halifax")}&inventoryType=Used%20vehicles&inventory=${encodeURIComponent(shortcutChoiceLabel)}`,
      { headers: shortcutBearerHeaders(createdToken.body.token) },
    );
    assert.equal(choiceLookup.status, 200);
    assert.equal(choiceLookup.body.matchedBy, "shortcutChoice");
    assert.equal(choiceLookup.body.car.vin, TEST_CAR.vin);

    const ambiguousToken = "cpcst_ADMIN_ID_WITH_UNDERSCORE_secret_PART_with_under_scores_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    const adminSession = sessionPayloadFromCookie(harness.cookie);
    await writeShortcutTokens(harness, [
      ...await readShortcutTokens(harness),
      {
        id: "ADMIN_ID_WITH_UNDERSCORE",
        name: "Ambiguous delimiter token",
        username: TEST_USERNAME,
        displayName: TEST_USERNAME,
        role: "admin",
        passwordVersion: adminSession.pv,
        scope: "shortcut_upload",
        tokenHash: shortcutTokenHash(ambiguousToken),
        createdAt: new Date().toISOString(),
      },
    ]);
    const ambiguousLookup = await fetchJson(
      `${harness.baseUrl}/api/shortcut/vehicle?stockNumber=${encodeURIComponent(TEST_CAR.stockNumber)}`,
      { headers: shortcutBearerHeaders(ambiguousToken) },
    );
    assert.equal(ambiguousLookup.status, 200);
    assert.equal(ambiguousLookup.body.car.vin, TEST_CAR.vin);

    const capitalizedPrefixLookup = await fetchJson(
      `${harness.baseUrl}/api/shortcut/vehicle?stockNumber=${encodeURIComponent(TEST_CAR.stockNumber)}`,
      { headers: shortcutBearerHeaders(createdToken.body.token.replace(/^cpcst_/, "Cpcst_")) },
    );
    assert.equal(capitalizedPrefixLookup.status, 200);
    assert.equal(capitalizedPrefixLookup.body.car.vin, TEST_CAR.vin);

    const lookup = await fetchJson(
      `${harness.baseUrl}/api/shortcut/vehicle?stockNumber=${encodeURIComponent(TEST_CAR.stockNumber)}`,
      { headers: shortcutAuthHeaders() },
    );
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.source, "ios-shortcut");
    assert.equal(lookup.body.matchedBy, "stockNumber");
    assert.equal(lookup.body.car.vin, TEST_CAR.vin);
    assert.equal(lookup.body.car.stockNumber, TEST_CAR.stockNumber);

    const bearerColonCredentialsLookup = await fetchJson(
      `${harness.baseUrl}/api/shortcut/vehicle?stockNumber=${encodeURIComponent(TEST_CAR.stockNumber)}`,
      { headers: shortcutBearerCredentialHeaders(`${TEST_USERNAME}:${TEST_PASSWORD}`) },
    );
    assert.equal(bearerColonCredentialsLookup.status, 200);
    assert.equal(bearerColonCredentialsLookup.body.car.vin, TEST_CAR.vin);

    const bearerCommaCredentialsLookup = await fetchJson(
      `${harness.baseUrl}/api/shortcut/vehicle?stockNumber=${encodeURIComponent(TEST_CAR.stockNumber)}`,
      { headers: shortcutBearerCredentialHeaders(`${TEST_USERNAME}, ${TEST_PASSWORD}`) },
    );
    assert.equal(bearerCommaCredentialsLookup.status, 200);
    assert.equal(bearerCommaCredentialsLookup.body.car.vin, TEST_CAR.vin);

    const form = new FormData();
    form.set("dealership", "O'Regan's Kia Halifax");
    form.set("inventoryType", "Used vehicles");
    form.set("inventory", shortcutChoiceLabel);
    form.set("shortcutVersion", "pick-vehicle-v8");
    form.append("media", new Blob([jpegBytes("shortcut-front")], { type: "image/jpeg" }), "iphone-front.jpg");
    form.append("Shortcut Input", new Blob([pngBytes("shortcut-interior")], { type: "image/png" }), "iphone-interior.png");
    const uploaded = await fetch(`${harness.baseUrl}/api/shortcut/upload`, {
      method: "POST",
      headers: shortcutBearerHeaders(createdToken.body.token),
      body: form,
    });
    const uploadedBody = await uploaded.json();
    assert.equal(uploaded.status, 201);
    assert.equal(uploadedBody.ok, true);
    assert.equal(uploadedBody.source, "ios-shortcut");
    assert.equal(uploadedBody.album.id, TEST_ALBUM_ID);
    assert.equal(uploadedBody.count, 2);
    assert.equal(uploadedBody.car.vin, TEST_CAR.vin);
    assert.ok(uploadedBody.photos.every((photo) => photo.uploadedBy?.username === TEST_USERNAME));
    assert.deepEqual(uploadedBody.photos.map((photo) => photo.originalName).sort(), ["iphone-front.jpg", "iphone-interior.png"]);

    const savedMetadata = JSON.parse(await fs.readFile(path.join(harness.uploadRoot, TEST_ALBUM_ID, ".photos.json"), "utf8"));
    assert.equal(Object.keys(savedMetadata).length, 2);
    assert.ok(Object.values(savedMetadata).every((photo) => photo.uploadedBy?.username === TEST_USERNAME));
    assert.deepEqual(await fs.readdir(harness.tmpRoot), []);

    const tokensAfterUse = await getJson(harness, "/api/shortcut/tokens");
    const createdTokenAfterUse = tokensAfterUse.tokens.find((token) => token.id === createdToken.body.record.id);
    assert.ok(createdTokenAfterUse);
    assert.match(createdTokenAfterUse.lastUsedAt, /^\d{4}-\d{2}-\d{2}T/);

    const skippedPickerForm = new FormData();
    skippedPickerForm.append("photos", new Blob([jpegBytes("skipped-picker")], { type: "image/jpeg" }), "skipped-picker.jpg");
    const skippedPicker = await fetch(`${harness.baseUrl}/api/shortcut/upload`, {
      method: "POST",
      headers: shortcutAuthHeaders(),
      body: skippedPickerForm,
    });
    const skippedPickerBody = await skippedPicker.json();
    assert.equal(skippedPicker.status, 400);
    assert.match(skippedPickerBody.error, /Old Shortcut/);
    assert.match(skippedPickerBody.error, /Upload to CarPostClub Pick Vehicle/);
    assert.deepEqual(await fs.readdir(harness.tmpRoot), []);

    const currentButSkippedPickerForm = new FormData();
    currentButSkippedPickerForm.set("shortcutVersion", "pick-vehicle-v8");
    currentButSkippedPickerForm.append("photos", new Blob([jpegBytes("current-skipped-picker")], { type: "image/jpeg" }), "current-skipped-picker.jpg");
    const currentButSkippedPicker = await fetch(`${harness.baseUrl}/api/shortcut/stage`, {
      method: "POST",
      headers: {
        Accept: "text/plain",
      },
      body: currentButSkippedPickerForm,
    });
    const pickerUrlText = await currentButSkippedPicker.text();
    assert.equal(currentButSkippedPicker.status, 202);
    assert.match(pickerUrlText, /\/shortcut\/complete\//);
    const pickerUrl = new URL(pickerUrlText.trim());
    const unauthenticatedPickerPage = await fetch(pickerUrl, { redirect: "manual" });
    assert.equal(unauthenticatedPickerPage.status, 302);
    assert.match(unauthenticatedPickerPage.headers.get("location") || "", /^\/login\?next=/);

    const pickerPage = await fetch(pickerUrl, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(pickerPage.status, 200);
    assert.match(await pickerPage.text(), /Finish CarPostClub Upload/);

    const unauthenticatedPendingDealerships = await fetchJson(`${harness.baseUrl}/api/shortcut/pending/${encodeURIComponent(pickerUrl.pathname.split("/").pop())}/dealerships?secret=${encodeURIComponent(pickerUrl.searchParams.get("secret"))}`, {
      redirect: "manual",
    });
    assert.equal(unauthenticatedPendingDealerships.status, 401);

    const pendingDealerships = await fetchJson(`${harness.baseUrl}/api/shortcut/pending/${encodeURIComponent(pickerUrl.pathname.split("/").pop())}/dealerships?secret=${encodeURIComponent(pickerUrl.searchParams.get("secret"))}`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(pendingDealerships.status, 200);
    assert.ok(pendingDealerships.body.dealerships.some((item) => item.label === "O'Regan's Kia Halifax"));

    const unauthenticatedPendingComplete = await fetch(`${harness.baseUrl}/api/shortcut/pending/${encodeURIComponent(pickerUrl.pathname.split("/").pop())}/complete?secret=${encodeURIComponent(pickerUrl.searchParams.get("secret"))}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        dealership: "O'Regan's Kia Halifax",
        inventoryType: "Used vehicles",
        inventory: shortcutChoiceLabel,
      }),
    });
    assert.equal(unauthenticatedPendingComplete.status, 401);

    const pendingComplete = await fetch(`${harness.baseUrl}/api/shortcut/pending/${encodeURIComponent(pickerUrl.pathname.split("/").pop())}/complete?secret=${encodeURIComponent(pickerUrl.searchParams.get("secret"))}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: harness.cookie },
      body: JSON.stringify({
        dealership: "O'Regan's Kia Halifax",
        inventoryType: "Used vehicles",
        inventory: shortcutChoiceLabel,
      }),
    });
    const pendingCompleteBody = await pendingComplete.json();
    assert.equal(pendingComplete.status, 200);
    assert.equal(pendingCompleteBody.ok, true);
    assert.equal(pendingCompleteBody.source, "ios-shortcut-pending");
    assert.equal(pendingCompleteBody.count, 1);
    assert.equal(pendingCompleteBody.car.vin, TEST_CAR.vin);
    assert.match(pendingCompleteBody.appUrl, /\/\?dealershipId=15&inventoryTypeId=2&inventoryKey=/);
    assert.match(pendingCompleteBody.appUrl, /openAlbum=1/);
    assert.match(pendingCompleteBody.appUrl, /shortcutUpload=complete/);
    assert.ok(pendingCompleteBody.photos.every((photo) => photo.uploadedBy?.username === TEST_USERNAME));
    assert.deepEqual(await fs.readdir(harness.tmpRoot), []);

    const missingForm = new FormData();
    missingForm.set("stockNumber", "NOPE123");
    missingForm.append("photos", new Blob([jpegBytes("missing")], { type: "image/jpeg" }), "missing.jpg");
    const missing = await fetch(`${harness.baseUrl}/api/shortcut/upload`, {
      method: "POST",
      headers: shortcutAuthHeaders(),
      body: missingForm,
    });
    const missingBody = await missing.json();
    assert.equal(missing.status, 404);
    assert.match(missingBody.error, /No inventory car matched/);
    assert.deepEqual(await fs.readdir(harness.tmpRoot), []);

    const revokedToken = await fetch(`${harness.baseUrl}/api/shortcut/tokens/${encodeURIComponent(createdToken.body.record.id)}`, {
      method: "DELETE",
      headers: { Cookie: harness.cookie, Accept: "application/json" },
    });
    assert.equal(revokedToken.status, 200);
    assert.equal((await revokedToken.json()).revoked, true);
    const rejectedBearerLookup = await fetchJson(
      `${harness.baseUrl}/api/shortcut/vehicle?stockNumber=${encodeURIComponent(TEST_CAR.stockNumber)}`,
      { headers: shortcutBearerHeaders(createdToken.body.token) },
    );
    assert.equal(rejectedBearerLookup.status, 401);
    assert.match(rejectedBearerLookup.body.error, /Invalid shortcut token/);

    const rejectedTextLookup = await fetch(`${harness.baseUrl}/api/shortcut/vehicle?stockNumber=${encodeURIComponent(TEST_CAR.stockNumber)}`, {
      headers: {
        Accept: "text/plain",
        Authorization: `Bearer ${createdToken.body.token}`,
      },
    });
    assert.equal(rejectedTextLookup.status, 401);
    assertNoStoreHeaders(rejectedTextLookup);
    assert.match(rejectedTextLookup.headers.get("content-type") || "", /text\/plain/);
    const rejectedTextBody = await rejectedTextLookup.text();
    assert.equal(rejectedTextBody, "Error: Invalid shortcut token.\n");
    assert.doesNotMatch(rejectedTextBody, /"ok"|false/);
  } finally {
    await stopTestServer(harness);
  }
});

test("iOS Shortcut picklist labels resolve when live O'Regan's titles are long", async () => {
  const harness = await startTestServer({ inventoryCars: [LONG_TITLE_CAR] });

  try {
    harness.cookie = await login(harness.baseUrl);
    const createdToken = await postJson(harness, "/api/shortcut/tokens", { name: "Long title iPhone" });
    assert.equal(createdToken.status, 201);

    const expectedLabel = "A10012 - New 2026 Kia Sportage Plug-In Hybrid EX Eligible for up to a $2500 federal government incentive - Kia Halifax - New";
    assert.equal(expectedLabel.length > 120, true);
    const picklist = await fetch(`${harness.baseUrl}/api/shortcut/inventory?format=labels`, {
      headers: shortcutBearerHeaders(createdToken.body.token),
    });
    assert.equal(picklist.status, 200);
    assert.equal(await picklist.text(), expectedLabel);

    const lookup = await fetchJson(
      `${harness.baseUrl}/api/shortcut/vehicle?inventory=${encodeURIComponent(expectedLabel)}`,
      { headers: shortcutBearerHeaders(createdToken.body.token) },
    );
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.matchedBy, "shortcutChoice");
    assert.equal(lookup.body.car.vin, LONG_TITLE_CAR.vin);
  } finally {
    await stopTestServer(harness);
  }
});

test("upload limits return clear client errors", async () => {
  const harness = await startTestServer({
    env: {
      MAX_FILE_BYTES: "16",
      MAX_UPLOAD_FILES: "2",
    },
  });

  try {
    harness.cookie = await login(harness.baseUrl);

    const tooLarge = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "oversized.jpg", type: "image/jpeg", body: Buffer.alloc(32, 1) },
      ],
    });
    assert.equal(tooLarge.status, 413);
    assert.match(tooLarge.body.error, /Each file must be 16 B or smaller/);
    assert.deepEqual(await fs.readdir(harness.tmpRoot), []);

    const tooMany = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "front.jpg", type: "image/jpeg", body: jpegBytes("a") },
        { filename: "rear.jpg", type: "image/jpeg", body: jpegBytes("b") },
        { filename: "interior.jpg", type: "image/jpeg", body: jpegBytes("c") },
      ],
    });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.error, /Upload up to 2 files at a time/);
    assert.deepEqual(await fs.readdir(harness.tmpRoot), []);

    const afterLimits = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.deepEqual(afterLimits.photos, []);
  } finally {
    await stopTestServer(harness);
  }
});

test("multiple approved accounts can use live chat and upload to the same album concurrently", async () => {
  const harness = await startTestServer();
  const testAccounts = [
    { username: "lot.runner", displayName: "Lot Runner", password: "lot-runner-123" },
    { username: "photo.desk", displayName: "Lot Runner", password: "photo-desk-123" },
    { username: "sales.floor", displayName: "Sales Floor", password: "sales-floor-123" },
  ];
  const collectors = [];

  try {
    harness.cookie = await login(harness.baseUrl);

    const approvedUsers = await Promise.all(testAccounts.map((account) => createApprovedAccount(harness, account)));
    const chatUsers = [
      { username: TEST_USERNAME, displayName: TEST_USERNAME, cookie: harness.cookie },
      ...approvedUsers,
    ];

    for (const user of chatUsers) {
      collectors.push(await openChatCollector(harness, user.cookie));
    }
    await sleep(100);

    const chatPosts = await Promise.all(chatUsers.map((user, index) => postJsonWithCookie(
      harness,
      user.cookie,
      "/api/chat/messages",
      { text: `Concurrent message ${index + 1} from ${user.displayName}` },
    )));
    for (const [index, post] of chatPosts.entries()) {
      assert.equal(post.status, 201);
      assert.equal(post.body.message.author, chatUsers[index].displayName);
      assert.equal(post.body.message.authorDisplayName, chatUsers[index].displayName);
      assert.equal(post.body.message.authorUsername, chatUsers[index].username);
      assert.equal(post.body.message.text, `Concurrent message ${index + 1} from ${chatUsers[index].displayName}`);
    }

    for (const collector of collectors) {
      const streamedMessages = await collector.waitForMessages(chatUsers.length);
      assert.deepEqual(
        streamedMessages.map((message) => message.author).sort(),
        chatUsers.map((user) => user.displayName).sort(),
      );
      assert.deepEqual(
        streamedMessages.map((message) => message.authorUsername).sort(),
        chatUsers.map((user) => user.username).sort(),
      );
    }

    const persistedChat = await getJson(harness, "/api/chat/messages");
    assert.equal(persistedChat.messages.length, chatUsers.length);
    assert.deepEqual(
      persistedChat.messages.map((message) => message.text).sort(),
      chatUsers.map((user, index) => `Concurrent message ${index + 1} from ${user.displayName}`).sort(),
    );
    assert.deepEqual(
      persistedChat.messages.map((message) => message.authorUsername).sort(),
      chatUsers.map((user) => user.username).sort(),
    );

    const uploadUsers = chatUsers.slice(0, 3);
    const expectedOriginalNames = uploadUsers.flatMap((user) => [
      `${user.username}-front.jpg`,
      `${user.username}-walkaround.mp4`,
    ]).sort();
    const expectedUploaderByOriginalName = new Map(uploadUsers.flatMap((user) => [
      [`${user.username}-front.jpg`, user],
      [`${user.username}-walkaround.mp4`, user],
    ]));

    const uploads = await Promise.all(uploadUsers.map((user) => uploadPhotosWithCookie(harness, user.cookie, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: `${user.username}-front.jpg`, type: "image/jpeg", body: jpegBytes(`${user.username}-front`) },
        { filename: `${user.username}-walkaround.mp4`, type: "video/mp4", body: mp4Bytes(`${user.username}-walkaround`) },
      ],
    })));

    for (const upload of uploads) {
      assert.equal(upload.status, 201);
      assert.equal(upload.body.ok, true);
      assert.equal(upload.body.album.id, TEST_ALBUM_ID);
      assert.equal(upload.body.count, 2);
      for (const photo of upload.body.photos) {
        const expectedUploader = expectedUploaderByOriginalName.get(photo.originalName);
        assert.equal(photo.uploadedBy.username, expectedUploader.username);
        assert.equal(photo.uploadedBy.displayName, expectedUploader.displayName);
      }
    }

    const albumAfterConcurrentUploads = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(albumAfterConcurrentUploads.photos.length, expectedOriginalNames.length);
    assert.deepEqual(
      albumAfterConcurrentUploads.photos.map((photo) => photo.originalName).sort(),
      expectedOriginalNames,
    );
    for (const photo of albumAfterConcurrentUploads.photos) {
      const expectedUploader = expectedUploaderByOriginalName.get(photo.originalName);
      assert.equal(photo.uploadedBy.username, expectedUploader.username);
      assert.equal(photo.uploadedBy.displayName, expectedUploader.displayName);
    }

    const savedMetadata = JSON.parse(await fs.readFile(path.join(harness.uploadRoot, TEST_ALBUM_ID, ".photos.json"), "utf8"));
    assert.deepEqual(
      Object.values(savedMetadata).map((meta) => meta.originalName).sort(),
      expectedOriginalNames,
    );
    for (const meta of Object.values(savedMetadata)) {
      const expectedUploader = expectedUploaderByOriginalName.get(meta.originalName);
      assert.equal(meta.uploadedBy.username, expectedUploader.username);
      assert.equal(meta.uploadedBy.displayName, expectedUploader.displayName);
    }
  } finally {
    await Promise.all(collectors.map((collector) => collector.close()));
    await stopTestServer(harness);
  }
});

async function startTestServer({ env = {}, inventoryCars = [TEST_CAR] } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "carpostclub-test-"));
  const uploadRoot = path.join(tempRoot, "uploads");
  const tmpRoot = path.join(tempRoot, "tmp");
  const inventoryMockFile = path.join(tempRoot, "inventory.json");
  await fs.writeFile(inventoryMockFile, `${JSON.stringify({ cars: inventoryCars }, null, 2)}\n`);
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
      CARPOSTCLUB_AUTH_SESSION_SECRET: "test-session-secret",
      CARPOSTCLUB_AUTH_COOKIE_SECURE: "false",
      CARPOSTCLUB_PUSH_DELIVERY_DISABLED: "true",
      OPENAI_API_KEY: "",
      ...env,
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
  assert.match(attempt.cookie || "", /^carpostclub_session=/);
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
    headers: response.headers,
    body: await response.text(),
  };
}

async function createApprovedAccount(harness, account) {
  const signup = await requestSignup(harness.baseUrl, {
    displayName: account.displayName,
    username: account.username,
    password: account.password,
    confirmPassword: account.password,
  });
  assert.equal(signup.status, 200);
  assert.match(signup.body, /CarPostClub admin needs to approve/i);

  const approved = await fetch(`${harness.baseUrl}/admin/users/${encodeURIComponent(account.username)}/approve`, {
    method: "POST",
    headers: { Cookie: harness.cookie },
    redirect: "manual",
  });
  assert.equal(approved.status, 303);

  return {
    ...account,
    cookie: await login(harness.baseUrl, account.username, account.password),
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

async function postJsonWithCookie(harness, cookie, pathname, body) {
  const response = await fetch(`${harness.baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      Cookie: cookie,
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

async function openChatCollector(harness, cookie) {
  const controller = new AbortController();
  const response = await fetch(`${harness.baseUrl}/api/chat/stream`, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/event-stream/);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const messages = [];
  let buffer = "";
  const done = (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        let separatorIndex;
        while ((separatorIndex = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const data = block.split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) messages.push(JSON.parse(data));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();

  return {
    messages,
    async waitForMessages(count) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (messages.length >= count) return messages.slice(0, count);
        await sleep(25);
      }
      throw new Error(`Timed out waiting for ${count} chat messages; received ${messages.length}.`);
    },
    async close() {
      controller.abort();
      await reader.cancel().catch(() => {});
      await done.catch(() => {});
    },
  };
}

async function deleteJson(harness, pathname, body) {
  const response = await fetch(`${harness.baseUrl}${pathname}`, {
    method: "DELETE",
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

function pushSubscriptionFor(id) {
  return {
    endpoint: `https://push.example.test/send/${id}`,
    keys: {
      p256dh: "B".repeat(88),
      auth: "A".repeat(22),
    },
  };
}

async function readPushSubscriptionCount(harness, endpoint) {
  const subscriptions = await readPushSubscriptions(harness);
  return subscriptions.filter((subscription) => subscription.endpoint === endpoint).length;
}

async function readPushSubscription(harness, endpoint) {
  return (await readPushSubscriptions(harness)).find((subscription) => subscription.endpoint === endpoint) || null;
}

async function readPushSubscriptions(harness) {
  const storePath = path.join(harness.tempRoot, "push-subscriptions.json");
  const raw = await fs.readFile(storePath, "utf8").catch(() => "{\"subscriptions\":[]}");
  const store = JSON.parse(raw);
  const subscriptions = Array.isArray(store) ? store : store.subscriptions;
  return Array.isArray(subscriptions)
    ? subscriptions
    : [];
}

async function writePushSubscriptions(harness, subscriptions) {
  const storePath = path.join(harness.tempRoot, "push-subscriptions.json");
  await fs.writeFile(storePath, `${JSON.stringify({ subscriptions }, null, 2)}\n`);
}

async function readShortcutTokens(harness) {
  const storePath = path.join(harness.tempRoot, "shortcut-tokens.json");
  const raw = await fs.readFile(storePath, "utf8").catch(() => "{\"tokens\":[]}");
  const store = JSON.parse(raw);
  const tokens = Array.isArray(store) ? store : store.tokens;
  return Array.isArray(tokens) ? tokens : [];
}

async function writeShortcutTokens(harness, tokens) {
  const storePath = path.join(harness.tempRoot, "shortcut-tokens.json");
  await fs.writeFile(storePath, `${JSON.stringify({ tokens }, null, 2)}\n`);
}

function shortcutTokenHash(token) {
  return crypto.createHash("sha256")
    .update(`carpostclub-shortcut-token:${token}`)
    .digest("base64url");
}

function assertNoStoreHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("expires"), "0");
}

function sessionPayloadFromCookie(cookie) {
  const value = String(cookie || "").split("=")[1] || "";
  const [payload] = decodeURIComponent(value).split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function signedSessionCookie(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", "test-session-secret").update(encodedPayload).digest("base64url");
  return `carpostclub_session=${encodeURIComponent(`${encodedPayload}.${signature}`)}`;
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

function shortcutAuthHeaders(username = TEST_USERNAME, password = TEST_PASSWORD) {
  return {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
  };
}

function shortcutBearerHeaders(token) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function shortcutBearerCredentialHeaders(value) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${value}`,
  };
}

async function uploadPhotos(harness, { dealershipId, inventoryTypeId, vin, inventoryKey, photos }) {
  return uploadPhotosWithCookie(harness, harness.cookie, { dealershipId, inventoryTypeId, vin, inventoryKey, photos });
}

async function uploadPhotosWithCookie(harness, cookie, { dealershipId, inventoryTypeId, vin, inventoryKey, photos }) {
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
      Cookie: cookie,
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

function heicBytes() {
  return Buffer.from(TINY_HEIC_BASE64, "base64");
}

function mp4Bytes(label) {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypmp42"),
    Buffer.from(label),
  ]);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
