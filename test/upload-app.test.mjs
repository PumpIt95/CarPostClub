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
import zlib from "node:zlib";
import sharp from "sharp";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const TEST_USERNAME = "admin";
const TEST_PASSWORD = "password";
const NEW_USERNAME = "photo.tech";
const NEW_DISPLAY_NAME = "Photo Tech";
const NEW_PASSWORD = "new-password-123";
const CHANGED_PASSWORD = "changed-password-456";
const RESET_PASSWORD = "reset-password-789";
const MARKETPLACE_PROMPT_VERSION = "facebook_marketplace_description_v3_simple";
const TINY_HEIC_BASE64 = [
  "AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABw21ldGEAAAAAAAAAIWhkbHIA",
  "AAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAA5mlwcnAAAADFaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAAAIAAAACAAAAAlpcm90AAAAABBwaXhpAAAAAAMICAgAAABxaHZjQwEDcAAAALAAAAAAAB7wAPz9+PgAAAsDoAABABdAAQwB//8DcAAAAwCwAAADAAADAB5wJKEAAQAjQgEBA3AAAAMAsAAAAwAAAwAeoBQgQcCbDuIe5FlU3AgIGAKiAAEACUQBwGFyyEBTJAAAABlpcG1hAAAAAAAAAAEAAQaBAgMFhoQAAAAsaWxvYwAAAABEAAACAAEAAAABAAACQwAAADsAAgAAAAEAAAH3AAAATAAAAAFtZGF0AAAAAAAAAJcAAAAGRXhpZgAATU0AKgAAAAgAAwEaAAUAAAABAAAAMgEbAAUAAAABAAAAOgEoAAMAAAABAAIAAAAAAAAAAAAZAAAAAQAAABkAAAABAAAANygBr6LyRoF8/8X//+Rr7L7dzfVf3nyPtAIv94VPdMsmf6Ag+cI1PkOyhr/JHgi9hX4RbWMmyK4=",
].join("");
const TEST_JPEG_BYTES = await sharp({
  create: {
    width: 1,
    height: 1,
    channels: 3,
    background: { r: 255, g: 255, b: 255 },
  },
}).jpeg().toBuffer();
const TEST_PNG_BYTES = await sharp({
  create: {
    width: 1,
    height: 1,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  },
}).png().toBuffer();
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
const TEST_OBJECT_STORAGE_PREFIX = `inventory/15/used-vehicles/u6247a-${TEST_CAR.vin.toLowerCase()}`;
const SOLD_CAR = {
  dealershipId: "15",
  inventoryTypeId: "2",
  vin: "3KPF24AD1NE123456",
  stockNumber: "SOLD123",
  title: "Used 2022 Kia Forte LX",
  year: "2022",
  make: "Kia",
  model: "Forte",
  trim: "LX",
  price: "$21,990",
  odometer: "45,123 km",
  exteriorColor: "Blue",
  interiorColor: "Black",
  bodyStyle: "Sedan",
  fuelType: "Gas",
  transmission: "Automatic",
  detailUrl: "https://www.oregans.com/inventory/Used-2022-Kia-Forte-SOLD123/",
};
const SANTA_CRUZ_WITHOUT_BODY_STYLE = {
  dealershipId: "15",
  inventoryTypeId: "2",
  vin: "5NTJCDDF1SH142527",
  stockNumber: "U6545",
  title: "Used 2025 Hyundai Santa Cruz Just Arrived & Fully Certified Preferred, AWD, Alloys, Heated Seats, Apple Carplay",
  year: "2025",
  make: "Hyundai",
  model: "Santa Cruz",
  trim: "Preferred AWD",
  price: "$41,490",
  odometer: "38,474 km",
  exteriorColor: "Gray",
  interiorColor: "",
  bodyStyle: "",
  fuelType: "Gas",
  transmission: "Automatic",
  detailUrl: "https://www.oregans.com/inventory/Used-2025-Hyundai-Santa-Cruz-U6545/",
};
const SNAPSHOT_NEW_CAR = {
  dealershipId: "18",
  inventoryTypeId: "2",
  vin: "1GCPABEK1RZ123456",
  stockNumber: "UG9999",
  title: "Used 2024 Chevrolet Silverado Custom",
  year: "2024",
  make: "Chevrolet",
  model: "Silverado",
  trim: "Custom",
  price: "$42,990",
  odometer: "18,500 km",
  exteriorColor: "Black",
  interiorColor: "Black",
  bodyStyle: "Truck",
  fuelType: "Gas",
  transmission: "Automatic",
  detailUrl: "https://www.oregans.com/inventory/Used-2024-Chevrolet-Silverado-Custom-UG9999/",
};
const SNAPSHOT_NEW_KIA_CAR = {
  dealershipId: "15",
  inventoryTypeId: "2",
  vin: "KNDPUCAF1S7123456",
  stockNumber: "a10412a",
  title: "Used 2020 Kia Sedona One Owner and Fully Certified",
  year: "2020",
  make: "Kia",
  model: "Sedona",
  trim: "One Owner and Fully Certified",
  price: "$34,990",
  odometer: "6,100 km",
  exteriorColor: "Blue",
  interiorColor: "Black",
  bodyStyle: "SUV",
  fuelType: "Gas",
  transmission: "Automatic",
  detailUrl: "https://www.oregans.com/inventory/Used-2020-Kia-Sedona-One-Owner-Fully-Certified-a10412a/",
};
const SNAPSHOT_BATCH_HONDA_CAR = {
  dealershipId: "15",
  inventoryTypeId: "2",
  vin: "2HGFC2F59MH205555",
  stockNumber: "b20555b",
  title: "Used 2021 Honda Civic Touring",
  year: "2021",
  make: "Honda",
  model: "Civic",
  trim: "Touring",
  price: "$25,990",
  odometer: "21,500 km",
  exteriorColor: "White",
  interiorColor: "Black",
  bodyStyle: "Sedan",
  fuelType: "Gas",
  transmission: "Automatic",
  detailUrl: "https://www.oregans.com/inventory/Used-2021-Honda-Civic-b20555b/",
};
const SNAPSHOT_BATCH_TOYOTA_CAR = {
  dealershipId: "15",
  inventoryTypeId: "2",
  vin: "5YFBPMBE9NP309999",
  stockNumber: "c30999c",
  title: "Used 2022 Toyota Corolla LE",
  year: "2022",
  make: "Toyota",
  model: "Corolla",
  trim: "LE",
  price: "$27,490",
  odometer: "18,250 km",
  exteriorColor: "Silver",
  interiorColor: "Black",
  bodyStyle: "Sedan",
  fuelType: "Gas",
  transmission: "Automatic",
  detailUrl: "https://www.oregans.com/inventory/Used-2022-Toyota-Corolla-c30999c/",
};
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
function assertCleanMarketplaceDescription(description) {
  assert.doesNotMatch(description, /\b(?:I(?:'|’)m listing|I am listing|Listing this|Posting this|Sharing the details)\b/i);
  assert.doesNotMatch(description, /\b(?:body style not specified|interior colou?r is Other|Other interior)\b/i);
  assert.doesNotMatch(description, /#|[\u{1F300}-\u{1FAFF}]|(?:\b(?:look no further|turn heads|dream ride|beast|loaded to the max|priced to sell|priced to move|won't last long|don't miss out)\b)/iu);
  assert.doesNotMatch(description, /\b(?:Message me|Send me a message)\b/i);
  assert.ok((description.match(/automatic transmission/gi) || []).length <= 1);
  assert.ok((description.match(/gasoline/gi) || []).length <= 1);
}

function assertLocationFreeMarketplaceDescription(description) {
  assert.doesNotMatch(description, /O'?Regan'?s/i);
  assert.doesNotMatch(description, /O'Regan's Kia Halifax/i);
  assert.doesNotMatch(description, /\b(?:Halifax|Nova Scotia)\b/i);
  assert.doesNotMatch(description, /\b(?:located at|located in|available at|available through|come in|come see|visit us|stop by|walk in)\b/i);
  assert.doesNotMatch(description, /\b(?:source listing|source location|inventory source|lot location|store|branch|dealership)\b/i);
}

function assertSingleMarketplaceDescriptionPrice(description, price = "$30,990") {
  const escapedPrice = escapeRegExp(price);
  assert.equal((String(description).match(new RegExp(escapedPrice, "g")) || []).length, 1);
  assert.equal((String(description).match(/\bPrice:/gi) || []).length, 1);
  assert.match(description, new RegExp(`Price:\\s*${escapedPrice}\\s+plus`, "i"));
}

function assertMarketplaceMessageLine(description) {
  assert.equal((String(description).match(/^Message for more details!$/gmi) || []).length, 1);
  assert.doesNotMatch(description, /\bask for\s+[A-Z0-9][A-Z0-9 .'-]{0,60}\b/i);
}

function assertLeadControlSafeMarketplaceDescription(description) {
  assertLocationFreeMarketplaceDescription(description);
  assert.doesNotMatch(description, new RegExp(TEST_CAR.stockNumber, "i"));
}

function marketplaceDocumentDescriptionBody(documentText) {
  return String(documentText || "").match(/\nDescription:\n([\s\S]*)$/)?.[1]?.trim() || "";
}

test("photo uploads require an O'Regan's dealership and car selection", async () => {
  const harness = await startTestServer();

  try {
    const version = await fetchJson(`${harness.baseUrl}/api/version`);
    assert.equal(version.status, 200);
    assert.equal(version.body.ok, true);
    assert.equal(version.body.mode, "photo-albums");

    const health = await fetchJson(`${harness.baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.storage.mediaDriver, "local");
    assert.equal(health.body.storage.objectStorageEnabled, false);
    assert.equal(Object.hasOwn(health.body.storage, "uploadRoot"), false);
    assert.equal(Object.hasOwn(health.body.storage, "objectStorage"), false);
    assertSecurityHeaders(health.response);

    const unauthenticated = await fetchJson(`${harness.baseUrl}/api/inventory/dealerships`, {
      redirect: "manual",
    });
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.body.error, /Authentication required/i);

    const loginPage = await fetch(`${harness.baseUrl}/login`, { redirect: "manual" });
    assert.equal(loginPage.status, 200);
    assertNoStoreHeaders(loginPage);
    assertSecurityHeaders(loginPage);

    const signupPageWithoutInvite = await fetch(`${harness.baseUrl}/signup`, { redirect: "manual" });
    assert.equal(signupPageWithoutInvite.status, 200);
    assert.match(await signupPageWithoutInvite.text(), /Ask Konner for a current invite link/i);

    const blockedSignup = await requestSignup(harness.baseUrl, {
      displayName: NEW_DISPLAY_NAME,
      username: NEW_USERNAME,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(blockedSignup.status, 400);
    assertNoStoreHeaders(blockedSignup);
    assert.match(blockedSignup.body, /current invite link/i);

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
    assert.equal(me.user.dealershipId, "15");
    assert.equal(me.user.dealershipLabel, "Kia");

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
    assert.equal(testPush.body.delivery.logged, 1);

    const pushNotifications = await getJson(harness, "/api/notifications");
    assert.equal(pushNotifications.ok, true);
    assert.equal(pushNotifications.unreadCount, 1);
    assert.equal(pushNotifications.notifications.length, 1);
    assert.equal(pushNotifications.notifications[0].title, "CarPostClub");
    assert.equal(pushNotifications.notifications[0].body, "Push notifications are ready.");
    assert.equal(pushNotifications.notifications[0].url, "/");

    const readNotifications = await postJson(harness, "/api/notifications/read", {});
    assert.equal(readNotifications.status, 200);
    assert.equal(readNotifications.body.marked, 1);
    assert.equal(readNotifications.body.unreadCount, 0);

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
    assert.match(adminPageText, /Generate invite link/);
    assert.doesNotMatch(adminPageText, /Approve/);
    assert.doesNotMatch(adminPageText, new RegExp(NEW_USERNAME.replace(".", "\\.")));

    const invite = await createInvite(harness);
    assert.match(invite.token, /^[A-Za-z0-9_-]{24,}$/);
    assert.match(invite.body, /New invite link/);
    assert.match(invite.body, /valid for 24 hours/i);
    const inviteAuditEvents = await readAuditLog(harness);
    const inviteAudit = assertAuditEvent(inviteAuditEvents, "auth.invite.created");
    assert.equal(inviteAudit.actor.username, TEST_USERNAME);
    assert.equal(inviteAudit.actor.role, "admin");
    assert.equal(inviteAudit.details.inviteIdSuffix, invite.token.slice(-8));
    assert.notEqual(JSON.stringify(inviteAudit), invite.token);

    const missingDealershipSignup = await requestSignup(harness.baseUrl, {
      invite: invite.token,
      displayName: NEW_DISPLAY_NAME,
      username: NEW_USERNAME,
      dealershipId: "",
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(missingDealershipSignup.status, 400);
    assert.match(missingDealershipSignup.body, /Choose Kia, GreenLight, GM, or Nissan/i);

    const signup = await requestSignup(harness.baseUrl, {
      invite: invite.token,
      displayName: NEW_DISPLAY_NAME,
      username: NEW_USERNAME,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(signup.status, 200);
    assertNoStoreHeaders(signup);
    assert.match(signup.body, /Account created\. You can sign in now/i);

    const invitedUserLogin = await loginAttempt(harness.baseUrl, NEW_USERNAME, NEW_PASSWORD);
    assert.equal(invitedUserLogin.status, 303);
    assert.match(invitedUserLogin.cookie || "", /^carpostclub_session=/);

    const adminPageAfterSignup = await fetch(`${harness.baseUrl}/admin/users`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(adminPageAfterSignup.status, 200);
    assertNoStoreHeaders(adminPageAfterSignup);
    const adminPageAfterSignupText = await adminPageAfterSignup.text();
    assert.match(adminPageAfterSignupText, new RegExp(NEW_USERNAME.replace(".", "\\.")));
    assert.match(adminPageAfterSignupText, /Reset password/);
    assert.match(adminPageAfterSignupText, /Deactivate/);
    assert.match(adminPageAfterSignupText, /Kia/);
    assert.match(adminPageAfterSignupText, /1 signup/);
    const storedInvites = JSON.parse(await fs.readFile(path.join(harness.tempRoot, "auth-invites.json"), "utf8"));
    assert.equal(storedInvites.invites[0].useCount, 1);
    assert.equal(storedInvites.invites[0].acceptedUsers[0].username, NEW_USERNAME);
    assert.equal(storedInvites.invites[0].acceptedUsers[0].dealership.id, "15");
    const storedUsers = JSON.parse(await fs.readFile(path.join(harness.tempRoot, "auth-users.json"), "utf8"));
    const storedNewUser = storedUsers.users.find((user) => user.username === NEW_USERNAME);
    assert.equal(storedNewUser.dealershipId, "15");

    const dealershipUpdate = await fetch(`${harness.baseUrl}/admin/users/${encodeURIComponent(NEW_USERNAME)}/dealership`, {
      method: "POST",
      headers: {
        Cookie: harness.cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ dealershipId: "18" }),
      redirect: "manual",
    });
    assert.equal(dealershipUpdate.status, 303);
    const storedUsersAfterDealership = JSON.parse(await fs.readFile(path.join(harness.tempRoot, "auth-users.json"), "utf8"));
    const storedUpdatedUser = storedUsersAfterDealership.users.find((user) => user.username === NEW_USERNAME);
    assert.equal(storedUpdatedUser.dealershipId, "18");

    const adminPageTextAfterInvite = adminPageAfterSignupText;
    assert.match(adminPageTextAfterInvite, /Reset password/);
    let approvedCookie = await login(harness.baseUrl, NEW_USERNAME, NEW_PASSWORD);
    const approvedAccess = await fetchJson(`${harness.baseUrl}/api/inventory/dealerships`, {
      headers: { Cookie: approvedCookie },
    });
    assert.equal(approvedAccess.status, 200);
    assert.equal(approvedAccess.body.ok, true);
    const approvedMe = await getJsonWithCookie(harness, approvedCookie, "/api/me");
    assert.equal(approvedMe.user.dealershipId, "18");
    assert.equal(approvedMe.user.dealershipLabel, "GM");

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
    assert.match(passwordPageText, /\/styles\.css\?v=20260618-chat-audio-button-v71/);
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
    const passwordChangeAuditEvents = await readAuditLog(harness);
    assertAuditEvent(passwordChangeAuditEvents, "auth.password.changed", (event) => (
      event.actor.username === NEW_USERNAME
      && event.details.username === NEW_USERNAME
    ));

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
    const passwordResetAuditEvents = await readAuditLog(harness);
    assertAuditEvent(passwordResetAuditEvents, "auth.password.reset", (event) => (
      event.actor.username === TEST_USERNAME
      && event.details.username === NEW_USERNAME
    ));
    const auditApi = await getJson(harness, "/api/admin/audit-log?limit=10");
    assert.equal(auditApi.ok, true);
    assert.ok(auditApi.events.some((event) => event.kind === "auth.invite.created"));
    assert.ok(auditApi.events.some((event) => event.kind === "auth.password.reset"));
    const nonAdminAuditApi = await fetchJson(`${harness.baseUrl}/api/admin/audit-log`, {
      headers: { Cookie: approvedCookie },
    });
    assert.equal(nonAdminAuditApi.status, 403);

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
    assertSecurityHeaders(home);
    const homeText = await home.text();
    assert.match(homeText, /Vehicle media intake/);
    assert.match(homeText, /id="carSelect"/);
    assert.match(homeText, /O'Regan's inventory/);

    const dealerships = await getJson(harness, "/api/inventory/dealerships");
    assert.equal(dealerships.ok, true);
    assert.deepEqual(dealerships.dealerships, [
      { id: "3", name: "O'Regan's Infiniti/Nissan Halifax", logoUrl: "/dealership-logos/3-nissan.webp" },
      { id: "15", name: "O'Regan's Kia Halifax", logoUrl: "/dealership-logos/15-kia.webp" },
      { id: "18", name: "O'Regan's Chevrolet Buick GMC Cadillac", logoUrl: "/dealership-logos/18-gm.webp" },
      { id: "2", name: "O'Regan's GreenLight Halifax", logoUrl: "/dealership-logos/2-greenlight.webp" },
    ]);
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
    assert.deepEqual(cars.cars[0].posted, { posted: false });

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

    const invalidManualVin = await postJson(harness, "/api/manual-inventory/cars", {
      ...MANUAL_CAR,
      stockNumber: "BADVIN",
      vin: "AUDITVIN000000001",
    });
    assert.equal(invalidManualVin.status, 400);
    assert.match(invalidManualVin.body.error, /VIN must be 11 to 17 characters/i);

    const manualAlbum = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&inventoryKey=${manualCreated.body.car.inventoryKey}`,
    );
    assert.equal(manualAlbum.album, null);
    assert.deepEqual(manualAlbum.photos, []);

    const manualUpload = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      inventoryKey: manualCreated.body.car.inventoryKey,
      photos: [{ filename: "manual-front.jpg", type: "image/jpeg", body: jpegBytes("manual-front") }],
    });
    assert.equal(manualUpload.status, 201);
    assert.equal(manualUpload.body.album.vehicle.source, "manual");
    assert.equal(manualUpload.body.album.inventoryNumber, MANUAL_CAR.stockNumber);
    assert.equal(manualUpload.body.album.createdBy.username, TEST_USERNAME);
    assert.equal(manualUpload.body.album.createdBy.displayName, TEST_USERNAME);
    assert.deepEqual(manualUpload.body.album.uploadedByUsers.map((user) => user.username), [TEST_USERNAME]);
    assert.equal(manualUpload.body.album.descriptionPreview, MANUAL_CAR.descriptionPreview);
    assert.equal(Object.hasOwn(manualUpload.body.album, "storage"), false);
    assert.equal(Object.hasOwn(manualUpload.body.album, "objectStoragePrefix"), false);
    assert.equal(manualUpload.body.album.mediaCount, 1);
    assert.equal(manualUpload.body.album.photoCount, 1);
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
    assert.equal(selectedAlbum.album, null);
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
    const albumsBeforeTestCarUpload = await getJson(harness, "/api/albums");
    assert.ok(!albumsBeforeTestCarUpload.albums.some((album) => album.vehicle?.vin === TEST_CAR.vin));

    const marketplaceCopyConflictPath = path.join(harness.uploadRoot, TEST_ALBUM_ID, ".marketplace-copy.json");
    await fs.mkdir(marketplaceCopyConflictPath, { recursive: true });

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
    assert.equal(uploaded.body.album.inventoryNumber, TEST_CAR.stockNumber);
    assert.equal(Object.hasOwn(uploaded.body.album, "storage"), false);
    assert.equal(Object.hasOwn(uploaded.body.album, "objectStoragePrefix"), false);
    assert.equal(uploaded.body.count, 4);
    assert.equal(uploaded.body.album.photoCount, 3);
    assert.equal(uploaded.body.album.videoCount, 1);
    assert.equal(uploaded.body.album.mediaCount, 4);
    const carsAfterUpload = await getJson(harness, "/api/inventory/cars?dealershipId=15&inventoryTypeId=2");
    const uploadedInventoryCar = carsAfterUpload.cars.find((car) => car.vin === TEST_CAR.vin);
    assert.equal(uploadedInventoryCar.posted.posted, true);
    assert.equal(uploadedInventoryCar.posted.albumId, uploaded.body.album.id);
    assert.equal(uploadedInventoryCar.posted.mediaCount, 4);
    assert.ok(uploaded.body.photos.every((photo) => photo.uploadedBy?.username === TEST_USERNAME));
    assert.ok(uploaded.body.photos.every((photo) => photo.uploadedBy?.displayName === TEST_USERNAME));
    assert.equal(uploaded.body.marketplaceGeneration.source, "template-upload");
    assert.equal(uploaded.body.marketplaceGeneration.variantCount, 6);
    assert.equal(uploaded.body.marketplaceGeneration.assignedCount, 2);
    const persistedMarketplaceCopy = await readMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID);
    assert.equal(persistedMarketplaceCopy.mode, "upload_pool");
    assert.equal(persistedMarketplaceCopy.promptVersion, MARKETPLACE_PROMPT_VERSION);
    assert.equal(persistedMarketplaceCopy.variants.length, 6);
    await assert.rejects(fs.readFile(marketplaceCopyConflictPath, "utf8"), { code: "EISDIR" });
    await fs.rm(marketplaceCopyConflictPath, { recursive: true, force: true });
    assert.equal(uploaded.body.marketplaceDraft.descriptionSource, "template-upload");
    assertLocationFreeMarketplaceDescription(uploaded.body.marketplaceDraft.description);
    assertMarketplaceMessageLine(uploaded.body.marketplaceDraft.description);
    assert.match(uploaded.body.marketplaceDraft.description, /2026 Kia Seltos/);
    assert.match(uploaded.body.marketplaceDraft.description, /X-Line AWD/);
    assert.match(uploaded.body.marketplaceDraft.description, /Exterior:\s*White/i);
    assert.match(uploaded.body.marketplaceDraft.description, /Interior:\s*Black/i);
    assert.match(uploaded.body.marketplaceDraft.description, /Transmission:\s*Automatic transmission/i);
    assert.match(uploaded.body.marketplaceDraft.description, /Fuel Type:\s*Gasoline/i);
    assertSingleMarketplaceDescriptionPrice(uploaded.body.marketplaceDraft.description);
    assert.match(uploaded.body.marketplaceDraft.description, /VIN:\s*KNDETCA76T7828611/);
    assert.match(uploaded.body.marketplaceDraft.description, /Mileage:\s*1,234 km/);
    assert.match(uploaded.body.marketplaceDraft.description, /Tire Road Hazard/);
    assertCleanMarketplaceDescription(uploaded.body.marketplaceDraft.description);
    assert.doesNotMatch(uploaded.body.marketplaceDraft.description, new RegExp(TEST_CAR.stockNumber));
	    assert.match(uploaded.body.marketplaceDraft.copyText, /Mileage: 1234 km/);
	    assert.match(uploaded.body.marketplaceDraft.copyText, /Dealership: O'Regan's Kia Halifax/);
	    assert.match(uploaded.body.marketplaceDraft.copyText, /Ask for: Konner/);

	    const regularDuplicateUpload = await uploadPhotosWithCookie(harness, approvedCookie, {
	      dealershipId: "15",
	      inventoryTypeId: "2",
	      vin: TEST_CAR.vin,
	      photos: [{ filename: "duplicate-front.jpg", type: "image/jpeg", body: jpegBytes("duplicate-front") }],
	    });
	    assert.equal(regularDuplicateUpload.status, 409);
	    assert.match(regularDuplicateUpload.body.error, /already has uploaded CarPostClub photos/i);

	    const staleMarketplaceCopy = await readMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID);
    await writeMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID, {
      ...staleMarketplaceCopy,
      promptVersion: "facebook-marketplace-user-description-v1",
    });
    const staleAlbumMarketplaceDraft = await getJson(harness, `/api/albums/${uploaded.body.album.id}/marketplace-draft`);
    assert.equal(staleAlbumMarketplaceDraft.draft.descriptionSource, "template-upload");
    assertLocationFreeMarketplaceDescription(staleAlbumMarketplaceDraft.draft.description);
    assertMarketplaceMessageLine(staleAlbumMarketplaceDraft.draft.description);
    assertSingleMarketplaceDescriptionPrice(staleAlbumMarketplaceDraft.draft.description);
    assertCleanMarketplaceDescription(staleAlbumMarketplaceDraft.draft.description);
    const refreshedMarketplaceCopy = await readMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID);
    assert.notEqual(refreshedMarketplaceCopy.promptVersion, "facebook-marketplace-user-description-v1");
    assert.equal(refreshedMarketplaceCopy.promptVersion, MARKETPLACE_PROMPT_VERSION);
    assert.ok(refreshedMarketplaceCopy.history.some((snapshot) => snapshot.promptVersion === "facebook-marketplace-user-description-v1"));
    assert.equal(refreshedMarketplaceCopy.mode, "upload_pool");

    const backfillDryRun = await postJson(harness, "/api/admin/marketplace-descriptions/backfill", {
      dryRun: true,
      force: true,
      limit: 1,
    });
    assert.equal(backfillDryRun.status, 200);
    assert.equal(backfillDryRun.body.promptVersion, MARKETPLACE_PROMPT_VERSION);
    assert.equal(backfillDryRun.body.summary.total, 1);
    assert.equal(backfillDryRun.body.summary.wouldUpdate, 1);
    assert.equal(backfillDryRun.body.records[0].action, "would_update");

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
    assert.match(photoTechMarketplaceDraft.body.draft.description, /2026 Kia Seltos/);
    assertMarketplaceMessageLine(photoTechMarketplaceDraft.body.draft.description);
    assertSingleMarketplaceDescriptionPrice(photoTechMarketplaceDraft.body.draft.description);
    assertLeadControlSafeMarketplaceDescription(photoTechMarketplaceDraft.body.draft.description);
    assert.doesNotMatch(photoTechMarketplaceDraft.body.draft.copyText, /Dealership: O'Regan's Kia Halifax/i);
    assert.doesNotMatch(photoTechMarketplaceDraft.body.draft.copyText, /Ask for: Photo Tech/i);
    assertLeadControlSafeMarketplaceDescription(marketplaceDocumentDescriptionBody(photoTechMarketplaceDraft.body.draft.copyText));
    assertCleanMarketplaceDescription(photoTechMarketplaceDraft.body.draft.description);

    const poisonedMarketplaceCopy = await readMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID);
    poisonedMarketplaceCopy.users[NEW_USERNAME] = {
      ...poisonedMarketplaceCopy.users[NEW_USERNAME],
      description: [
        "2026 Kia Seltos X-Line AWD with AWD, a backup camera, heated seats, and useful everyday utility.",
        "Located at O'Regan's Kia Halifax. Come in today or visit us at the store.",
        "Available at the O'Regan's Kia Halifax lot from the inventory source.",
      ].join("\n\n"),
    };
    await writeMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID, poisonedMarketplaceCopy);
    const poisonedPhotoTechMarketplaceDraft = await fetchJson(
      `${harness.baseUrl}/api/marketplace-draft?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
      { headers: { Cookie: approvedCookie } },
    );
    assert.match(poisonedPhotoTechMarketplaceDraft.body.draft.description, /2026 Kia Seltos/);
    assertMarketplaceMessageLine(poisonedPhotoTechMarketplaceDraft.body.draft.description);
    assertSingleMarketplaceDescriptionPrice(poisonedPhotoTechMarketplaceDraft.body.draft.description);
    assertLeadControlSafeMarketplaceDescription(poisonedPhotoTechMarketplaceDraft.body.draft.description);
    assertCleanMarketplaceDescription(poisonedPhotoTechMarketplaceDraft.body.draft.description);

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
    const savedAlbumMetadata = JSON.parse(await fs.readFile(path.join(harness.uploadRoot, TEST_ALBUM_ID, ".album.json"), "utf8"));
    assert.equal(savedAlbumMetadata.inventoryNumber, TEST_CAR.stockNumber);
    assert.equal(savedAlbumMetadata.createdBy.username, TEST_USERNAME);
    assert.equal(savedAlbumMetadata.createdBy.displayName, TEST_USERNAME);
    assert.equal(savedAlbumMetadata.updatedBy.username, TEST_USERNAME);
    assert.equal(savedAlbumMetadata.objectStoragePrefix, TEST_OBJECT_STORAGE_PREFIX);
    assert.equal(savedAlbumMetadata.storage.prefix, TEST_OBJECT_STORAGE_PREFIX);

    const afterUpload = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(afterUpload.photos.length, 4);
    assert.equal(afterUpload.album.coverPhoto.originalName, "front.jpg");
    assert.equal(afterUpload.photos[0].originalName, "front.jpg");
    assert.deepEqual(afterUpload.photos.map((photo) => photo.originalName), [
      "front.jpg",
      "interior.png",
      "lot-tag.jpg",
      "walkaround.mp4",
    ]);

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
    assert.equal(Object.hasOwn(albums, "uploadRoot"), false);
    assert.equal(Object.hasOwn(albums, "mediaDriver"), false);
    const testAlbum = albums.albums.find((album) => album.vehicle.vin === TEST_CAR.vin);
    const savedManualAlbum = albums.albums.find((album) => album.vehicle.inventoryKey === manualCreated.body.car.inventoryKey);
    assert.ok(testAlbum);
    assert.ok(savedManualAlbum);
    assert.equal(Object.hasOwn(testAlbum, "storage"), false);
    assert.equal(Object.hasOwn(testAlbum, "objectStoragePrefix"), false);
    assert.equal(testAlbum.photoCount, 3);
    assert.equal(testAlbum.videoCount, 1);
    assert.equal(testAlbum.mediaCount, 4);
    assert.equal(testAlbum.coverPhoto.originalName, "front.jpg");
    assert.match(testAlbum.coverUrl, /\/api\/albums\/[^/]+\/media\//);
    assert.match(testAlbum.coverThumbnailUrl, /\/api\/albums\/[^/]+\/media\/[^/]+\/thumbnail$/);
    assert.notEqual(testAlbum.coverThumbnailUrl, testAlbum.coverUrl);
    assert.equal(testAlbum.createdBy.username, TEST_USERNAME);
    assert.deepEqual(testAlbum.uploadedByUsers.map((user) => user.username), [TEST_USERNAME]);
    assert.equal(testAlbum.inventoryStatus.active, true);
    assert.match(testAlbum.inventoryStatus.label, /Active in O'Regan's inventory as of/);
    assert.equal(testAlbum.inventoryStatus.lifecycle.sourceStatus, "source_active");
    assert.equal(testAlbum.inventoryStatus.lifecycle.packageStatus, "facebook_ready");
    assert.equal(testAlbum.inventoryStatus.lifecycle.facebookState, "ready_to_post");
    assert.equal(testAlbum.inventoryStatus.lifecycle.facebookAction, "post_if_not_live");
    assert.equal(testAlbum.inventoryStatus.lifecycle.canPostToFacebook, true);
    assert.equal(savedManualAlbum.inventoryStatus.status, "manual");
    assert.equal(savedManualAlbum.inventoryStatus.lifecycle.facebookAction, "manual_review");
    assert.equal(savedManualAlbum.createdBy.username, TEST_USERNAME);
    assert.equal(savedManualAlbum.descriptionPreview, MANUAL_CAR.descriptionPreview);

    const albumMarketplaceDraft = await getJson(harness, `/api/albums/${afterUpload.album.id}/marketplace-draft`);
    assert.equal(albumMarketplaceDraft.draft.descriptionSource, "template-upload");
    assert.equal(albumMarketplaceDraft.draft.descriptionOwner.username, TEST_USERNAME);

    const descriptionDownload = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/description.txt`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(descriptionDownload.status, 200);
    assert.match(descriptionDownload.headers.get("content-disposition") || "", /marketplace-description\.txt/);
    const descriptionText = await descriptionDownload.text();
    assert.match(descriptionText, /CarPostClub Marketplace Package/);
    assert.match(descriptionText, /Prepared for: admin/);
    assert.match(descriptionText, /Ready to post: Yes/);
    assert.match(descriptionText, /Inventory status: Active in O'Regan's inventory as of/);
    assert.match(descriptionText, /Facebook sync: Post to Konner John Marketplace if it is not already live\./);

    const photoTechDescriptionDownload = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/description.txt`, {
      headers: { Cookie: approvedCookie },
    });
    assert.equal(photoTechDescriptionDownload.status, 200);
    const photoTechDescriptionText = await photoTechDescriptionDownload.text();
    assert.match(photoTechDescriptionText, /Prepared for: Photo Tech/);
    assert.match(photoTechDescriptionText, /Ready to post: Yes/);
    assert.doesNotMatch(photoTechDescriptionText, /Missing fields: Description/);
    assert.doesNotMatch(photoTechDescriptionText, /Dealership: O'Regan's Kia Halifax/i);
    assert.doesNotMatch(photoTechDescriptionText, /Ask for: Photo Tech/i);
    const photoTechDescriptionBody = marketplaceDocumentDescriptionBody(photoTechDescriptionText);
    assert.match(photoTechDescriptionBody, /2026 Kia Seltos/);
    assertMarketplaceMessageLine(photoTechDescriptionBody);
    assertSingleMarketplaceDescriptionPrice(photoTechDescriptionBody);
    assertLeadControlSafeMarketplaceDescription(photoTechDescriptionBody);
    assert.doesNotMatch(photoTechDescriptionText, /Ask for: Konner/);
    assertCleanMarketplaceDescription(photoTechDescriptionBody);
    assert.notEqual(descriptionText, photoTechDescriptionText);

    const lateUsers = [];
    for (let index = 1; index <= 5; index += 1) {
      lateUsers.push(await createApprovedAccount(harness, {
        displayName: `Late Poster ${index}`,
        username: `late.poster.${index}`,
        password: `late-password-${index}`,
      }));
    }
    for (const lateUser of lateUsers) {
      const lateDescriptionDownload = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/description.txt`, {
        headers: { Cookie: lateUser.cookie },
      });
      assert.equal(lateDescriptionDownload.status, 200);
      const lateDescriptionText = await lateDescriptionDownload.text();
      assert.match(lateDescriptionText, new RegExp(`Prepared for: ${lateUser.displayName}`));
      assert.match(lateDescriptionText, /Ready to post: Yes/);
      assert.doesNotMatch(lateDescriptionText, /Missing fields: Description/);
      assert.doesNotMatch(lateDescriptionText, new RegExp(`Ask for: ${lateUser.displayName}`));
      const lateDescriptionBody = marketplaceDocumentDescriptionBody(lateDescriptionText);
      assert.match(lateDescriptionBody, /2026 Kia Seltos/);
      assertMarketplaceMessageLine(lateDescriptionBody);
      assertSingleMarketplaceDescriptionPrice(lateDescriptionBody);
      assertLeadControlSafeMarketplaceDescription(lateDescriptionBody);
      assert.doesNotMatch(lateDescriptionText, /Ask for: Konner/);
      assert.doesNotMatch(lateDescriptionText, /Ask for: Photo Tech/);
      assertCleanMarketplaceDescription(lateDescriptionBody);
    }

    const albumDownload = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/download`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(albumDownload.status, 200);
    assert.match(albumDownload.headers.get("content-type") || "", /zip/);
    assert.match(albumDownload.headers.get("content-disposition") || "", /attachment/);
    const albumDownloadBytes = Buffer.from(await albumDownload.arrayBuffer());
    assert.ok(albumDownloadBytes.includes(Buffer.from("lot-tag.heic")));
    assert.ok(!albumDownloadBytes.includes(Buffer.from("lot-tag.jpg")));

    const packageDownload = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/package`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(packageDownload.status, 200);
    assert.match(packageDownload.headers.get("content-type") || "", /zip/);
    const packageDownloadBytes = Buffer.from(await packageDownload.arrayBuffer());
    assert.ok(packageDownloadBytes.includes(Buffer.from("media/lot-tag.heic")));
    assert.ok(packageDownloadBytes.includes(Buffer.from("facebook-marketplace-description.txt")));
    assert.ok(packageDownloadBytes.includes(Buffer.from("facebook-marketplace-fields.json")));
    assert.ok(packageDownloadBytes.includes(Buffer.from("package-manifest.json")));
    const packageManifest = JSON.parse(zipEntryText(packageDownloadBytes, "package-manifest.json"));
    assert.equal(packageManifest.readyToPost, true);

    const regularPackageDownload = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/package`, {
      headers: { Cookie: approvedCookie },
    });
    assert.equal(regularPackageDownload.status, 200);
    const regularPackageDownloadBytes = Buffer.from(await regularPackageDownload.arrayBuffer());
    const regularPackageDescriptionText = zipEntryText(regularPackageDownloadBytes, "facebook-marketplace-description.txt");
    assert.doesNotMatch(regularPackageDescriptionText, /Dealership: O'Regan's Kia Halifax/i);
    assert.doesNotMatch(regularPackageDescriptionText, /Ask for: Photo Tech/i);
    const regularPackageDescriptionBody = marketplaceDocumentDescriptionBody(regularPackageDescriptionText);
    assertMarketplaceMessageLine(regularPackageDescriptionBody);
    assertSingleMarketplaceDescriptionPrice(regularPackageDescriptionBody);
    assertLeadControlSafeMarketplaceDescription(regularPackageDescriptionBody);

    const nonAdminFacebookStatus = await postJsonWithCookie(
      harness,
      approvedCookie,
      `/api/albums/${afterUpload.album.id}/facebook-listing-status`,
      { state: "live", title: "2026 Kia Seltos", price: "CA$30,990" },
    );
    assert.equal(nonAdminFacebookStatus.status, 403);
    assert.match(nonAdminFacebookStatus.body.error, /Admin access required/i);

    const facebookStatus = await postJson(harness, `/api/albums/${afterUpload.album.id}/facebook-listing-status`, {
      state: "live",
      listingId: "27358000090461601",
      listingUrl: "https://www.facebook.com/marketplace/item/27358000090461601/",
      title: "2026 Kia Seltos",
      price: "CA$30,990",
      listingStatus: "Active",
      sellerName: "Konner John",
      matchedBy: ["vin", "stock"],
      matchConfidence: "exact",
      source: "test-facebook-sweep",
      proofPath: "/tmp/facebook-proof.png",
    });
    assert.equal(facebookStatus.status, 201);
    assert.equal(facebookStatus.body.facebookListing.state, "live");
    assert.equal(facebookStatus.body.facebookListing.listingId, "27358000090461601");
    assert.equal(facebookStatus.body.facebookListing.matchedBy, "vin,stock");
    assert.equal(facebookStatus.body.facebookListing.stale, false);
    assert.equal(facebookStatus.body.inventoryStatus.facebookListing.state, "live");
    assert.equal(facebookStatus.body.inventoryStatus.lifecycle.facebookState, "live_on_facebook");
    assert.equal(facebookStatus.body.inventoryStatus.lifecycle.facebookAction, "skip_already_live");
    assert.equal(facebookStatus.body.inventoryStatus.lifecycle.canPostToFacebook, false);

    const albumsAfterFacebookStatus = await getJson(harness, "/api/albums");
    const facebookTrackedAlbum = albumsAfterFacebookStatus.albums.find((album) => album.id === afterUpload.album.id);
    assert.equal(facebookTrackedAlbum.inventoryStatus.facebookListing.state, "live");
    assert.equal(facebookTrackedAlbum.inventoryStatus.lifecycle.facebookAction, "skip_already_live");

    const descriptionAfterFacebookStatus = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/description.txt`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(descriptionAfterFacebookStatus.status, 200);
    const facebookTrackedDescriptionText = await descriptionAfterFacebookStatus.text();
    assert.match(facebookTrackedDescriptionText, /Facebook sync: Already represented on Konner John Marketplace; do not publish a duplicate\./);
    assert.match(facebookTrackedDescriptionText, /Ready to post: No/);

    const regularDelete = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/photos/${encodeURIComponent(firstPhoto.filename)}`, {
      method: "DELETE",
      headers: { Cookie: approvedCookie, Accept: "application/json" },
    });
    assert.equal(regularDelete.status, 403);
    assert.match((await regularDelete.json()).error, /Admin access required/i);

    const deleted = await fetch(`${harness.baseUrl}/api/albums/${afterUpload.album.id}/photos/${encodeURIComponent(firstPhoto.filename)}`, {
      method: "DELETE",
      headers: { Cookie: harness.cookie, Accept: "application/json" },
    });
    assert.equal(deleted.status, 200);
    let mediaAuditEvents = await readAuditLog(harness);
    assertAuditEvent(mediaAuditEvents, "album.media.deleted", (event) => (
      event.actor.username === TEST_USERNAME
      && event.details.albumId === afterUpload.album.id
      && event.details.filename === firstPhoto.filename
      && event.details.originalName === "front.jpg"
    ));

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
    mediaAuditEvents = await readAuditLog(harness);
    assertAuditEvent(mediaAuditEvents, "album.media_collection.deleted", (event) => (
      event.actor.username === TEST_USERNAME
      && event.details.albumId === afterUpload.album.id
      && event.details.deleted === 3
      && event.details.filenames.includes(firstVideo.filename)
    ));

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

    const persistentMarketplaceCopyAfterDelete = await readMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID);
    assert.equal(persistentMarketplaceCopyAfterDelete.mode, "upload_pool");
    assert.equal(persistentMarketplaceCopyAfterDelete.variants.length, 6);

    const reuploaded = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "reupload-front.jpg", type: "image/jpeg", body: jpegBytes("reupload-front") },
      ],
    });
    assert.equal(reuploaded.status, 201);
    assert.equal(reuploaded.body.marketplaceGeneration.source, "existing-upload-pool");
    assert.equal(reuploaded.body.marketplaceGeneration.variantCount, 6);
    assert.equal(reuploaded.body.marketplaceDraft.descriptionSource, "template-upload");
    assertLocationFreeMarketplaceDescription(reuploaded.body.marketplaceDraft.description);
    assertMarketplaceMessageLine(reuploaded.body.marketplaceDraft.description);
    assertSingleMarketplaceDescriptionPrice(reuploaded.body.marketplaceDraft.description);
  } finally {
    await stopTestServer(harness);
  }
});

test("chat accepts audio attachments and serves them with byte ranges", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const audioBody = mp3Bytes("voice-note");
    const uploaded = await uploadChatAttachments(harness, {
      text: "Audio note",
      attachments: [
        { filename: "voice-note.mp3", type: "audio/mpeg", body: audioBody },
      ],
    });

    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.ok, true);
    assert.equal(uploaded.body.message.text, "Audio note");
    assert.equal(uploaded.body.message.attachments.length, 1);
    const [attachment] = uploaded.body.message.attachments;
    assert.equal(attachment.type, "audio");
    assert.equal(attachment.source, "upload");
    assert.equal(attachment.originalName, "voice-note.mp3");
    assert.equal(attachment.contentType, "audio/mpeg");
    assert.match(attachment.url, /^\/api\/chat\/media\/.+\.mp3$/);
    assert.match(attachment.downloadUrl, /download=1/);
    assert.match(attachment.downloadUrl, /voice-note\.mp3/);

    const messages = await getJson(harness, "/api/chat/messages");
    assert.equal(messages.messages.length, 1);
    assert.equal(messages.messages[0].attachments[0].type, "audio");

    const range = await fetch(`${harness.baseUrl}${attachment.url}`, {
      headers: {
        Cookie: harness.cookie,
        Range: "bytes=0-5",
      },
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("accept-ranges"), "bytes");
    assert.equal(range.headers.get("content-range"), `bytes 0-5/${audioBody.length}`);
    assert.equal(range.headers.get("content-length"), "6");
    assert.match(range.headers.get("content-type") || "", /^audio\/mpeg/);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), audioBody.subarray(0, 6));

    const download = await fetch(`${harness.baseUrl}${attachment.downloadUrl}`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") || "", /attachment/);
    assert.match(download.headers.get("content-disposition") || "", /voice-note\.mp3/);
  } finally {
    await stopTestServer(harness);
  }
});

test("chat message reactions persist, toggle, and stream", async () => {
  const harness = await startTestServer();
  let collector = null;

  try {
    harness.cookie = await login(harness.baseUrl);
    const firstViewer = await createApprovedAccount(harness, {
      username: "first.reactor",
      displayName: "First Reactor",
      password: "first-reactor-123",
    });
    const secondViewer = await createApprovedAccount(harness, {
      username: "second.reactor",
      displayName: "Second Reactor",
      password: "second-reactor-123",
    });
    const thirdViewer = await createApprovedAccount(harness, {
      username: "third.reactor",
      displayName: "Third Reactor",
      password: "third-reactor-123",
    });

    const post = await postJson(harness, "/api/chat/messages", { text: "React to this" });
    assert.equal(post.status, 201);
    assert.deepEqual(post.body.message.reactions, {
      laugh: [],
      heart: [],
      thumbs_up: [],
      thumbs_down: [],
    });

    collector = await openChatCollector(harness, firstViewer.cookie);
    const laugh = await putJsonWithCookie(harness, harness.cookie, `/api/chat/messages/${post.body.message.id}/reaction`, { reaction: "laugh" });
    assert.equal(laugh.status, 200, JSON.stringify(laugh.body));
    assert.deepEqual(laugh.body.message.reactions.laugh.map((user) => user.username), [TEST_USERNAME]);

    const [streamedReaction] = await collector.waitForMessages(1);
    assert.equal(streamedReaction.id, post.body.message.id);
    assert.deepEqual(streamedReaction.reactions.laugh.map((user) => user.username), [TEST_USERNAME]);

    const heart = await putJsonWithCookie(harness, firstViewer.cookie, `/api/chat/messages/${post.body.message.id}/reaction`, { reaction: "heart" });
    assert.equal(heart.status, 200, JSON.stringify(heart.body));
    const thumbsUp = await putJsonWithCookie(harness, secondViewer.cookie, `/api/chat/messages/${post.body.message.id}/reaction`, { reaction: "thumbs_up" });
    assert.equal(thumbsUp.status, 200, JSON.stringify(thumbsUp.body));
    const thumbsDown = await putJsonWithCookie(harness, thirdViewer.cookie, `/api/chat/messages/${post.body.message.id}/reaction`, { reaction: "thumbs_down" });
    assert.equal(thumbsDown.status, 200, JSON.stringify(thumbsDown.body));

    const withFourReactions = await getJson(harness, "/api/chat/messages");
    const reactedMessage = withFourReactions.messages.find((message) => message.id === post.body.message.id);
    assert.ok(reactedMessage);
    assert.deepEqual(reactedMessage.reactions.laugh.map((user) => user.username), [TEST_USERNAME]);
    assert.deepEqual(reactedMessage.reactions.heart.map((user) => user.username), [firstViewer.username]);
    assert.deepEqual(reactedMessage.reactions.thumbs_up.map((user) => user.username), [secondViewer.username]);
    assert.deepEqual(reactedMessage.reactions.thumbs_down.map((user) => user.username), [thirdViewer.username]);

    const toggleHeart = await putJsonWithCookie(harness, firstViewer.cookie, `/api/chat/messages/${post.body.message.id}/reaction`, { reaction: "heart" });
    assert.equal(toggleHeart.status, 200, JSON.stringify(toggleHeart.body));
    assert.deepEqual(toggleHeart.body.message.reactions.heart, []);

    const moveToThumbsDown = await putJsonWithCookie(harness, firstViewer.cookie, `/api/chat/messages/${post.body.message.id}/reaction`, { reaction: "thumbs_down" });
    assert.equal(moveToThumbsDown.status, 200, JSON.stringify(moveToThumbsDown.body));
    assert.deepEqual(moveToThumbsDown.body.message.reactions.heart, []);
    assert.deepEqual(
      moveToThumbsDown.body.message.reactions.thumbs_down.map((user) => user.username).sort(),
      [firstViewer.username, thirdViewer.username].sort(),
    );

    const invalidReaction = await putJsonWithCookie(harness, secondViewer.cookie, `/api/chat/messages/${post.body.message.id}/reaction`, { reaction: "confused" });
    assert.equal(invalidReaction.status, 400);
    assert.match(invalidReaction.body.error, /valid chat reaction/i);
  } finally {
    await collector?.close();
    await stopTestServer(harness);
  }
});

test("production refuses to start without explicit auth configuration", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "carpostclub-prod-auth-test-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: appRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      UPLOAD_ROOT: path.join(tempRoot, "uploads"),
      TMP_ROOT: path.join(tempRoot, "tmp"),
      CARPOSTCLUB_AUTH_PASSWORD: "",
      CARPOSTCLUB_AUTH_PASSWORD_HASH: "",
      KONNER_AUTH_PASSWORD: "",
      KONNER_AUTH_PASSWORD_HASH: "",
      AUTH_PASSWORD: "",
      AUTH_PASSWORD_HASH: "",
      CARPOSTCLUB_AUTH_DISABLED: "",
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

  try {
    const [code] = await Promise.race([
      once(child, "exit"),
      sleep(5000).then(() => {
        child.kill("SIGTERM");
        throw new Error(`server did not fail closed\n${output}`);
      }),
    ]);
    assert.notEqual(code, 0);
    assert.match(output, /Authentication is not configured/i);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("unsafe authenticated requests reject cross-origin origins", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);

    const rejected = await fetchJson(`${harness.baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: {
        Cookie: harness.cookie,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "cross-site attempt" }),
    });
    assert.equal(rejected.status, 403);
    assert.match(rejected.body.error, /Cross-origin/i);

    const accepted = await fetchJson(`${harness.baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: {
        Cookie: harness.cookie,
        Origin: harness.baseUrl,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "same-origin message" }),
    });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.message.text, "same-origin message");
  } finally {
    await stopTestServer(harness);
  }
});

test("login failures are rate limited and recover after the window", async () => {
  const harness = await startTestServer({
    env: {
      CARPOSTCLUB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: "2",
      CARPOSTCLUB_LOGIN_RATE_LIMIT_WINDOW_MS: "250",
    },
  });

  try {
    const firstFailure = await loginAttempt(harness.baseUrl, TEST_USERNAME, "wrong-password");
    assert.equal(firstFailure.status, 401);
    const secondFailure = await loginAttempt(harness.baseUrl, TEST_USERNAME, "wrong-password");
    assert.equal(secondFailure.status, 401);
    const limited = await loginAttempt(harness.baseUrl, TEST_USERNAME, "wrong-password");
    assert.equal(limited.status, 429);
    assert.match(limited.body, /Too many failed sign-in attempts/i);

    await sleep(350);
    const recovered = await loginAttempt(harness.baseUrl, TEST_USERNAME, TEST_PASSWORD);
    assert.equal(recovered.status, 303);
    assert.match(recovered.cookie || "", /^carpostclub_session=/);
  } finally {
    await stopTestServer(harness);
  }
});

test("Marketplace draft infers Hyundai Santa Cruz body style as Truck", async () => {
  const harness = await startTestServer({ inventoryCars: [SANTA_CRUZ_WITHOUT_BODY_STYLE] });

  try {
    harness.cookie = await login(harness.baseUrl);

    const marketplaceDraft = await getJson(
      harness,
      `/api/marketplace-draft?dealershipId=15&inventoryTypeId=2&vin=${SANTA_CRUZ_WITHOUT_BODY_STYLE.vin}`,
    );

    assert.equal(marketplaceDraft.draft.title, "2025 Hyundai Santa Cruz");
    assert.equal(marketplaceDraft.draft.fields.bodyStyle, "Truck");
    assert.notEqual(marketplaceDraft.draft.fields.bodyStyle, "Sedan");
    assert.ok(marketplaceDraft.draft.reviewFields.includes("Body style"));
  } finally {
    await stopTestServer(harness);
  }
});

test("Marketplace draft infers common uploaded body styles when source feed is blank", async () => {
  const bodyStyleCases = [
    {
      expectedBodyStyle: "Sedan",
      car: {
        dealershipId: "15",
        inventoryTypeId: "2",
        vin: "3KPFU4DE4SE148464",
        stockNumber: "U6552",
        title: "Used 2025 Kia K4 Just Arrived & Fully Certified EX",
        year: "2025",
        make: "Kia",
        model: "K4",
        trim: "EX",
        price: "$25,990",
        odometer: "28,660 km",
        exteriorColor: "Black",
        interiorColor: "",
        bodyStyle: "",
        fuelType: "Gas",
        transmission: "Automatic",
        detailUrl: "https://www.oregans.com/inventory/Used-2025-Kia-K4-U6552/",
      },
    },
    {
      expectedBodyStyle: "Minivan",
      car: {
        dealershipId: "15",
        inventoryTypeId: "2",
        vin: "KNDMB5C1XL6598841",
        stockNumber: "A10412A",
        title: "Used 2020 Kia Sedona One Owner & Fully Certified LX+, 8 Passenger",
        year: "2020",
        make: "Kia",
        model: "Sedona",
        trim: "LX+",
        price: "$21,990",
        odometer: "101,922 km",
        exteriorColor: "Silver",
        interiorColor: "",
        bodyStyle: "",
        fuelType: "Gas",
        transmission: "Automatic",
        detailUrl: "https://www.oregans.com/inventory/Used-2020-Kia-Sedona-A10412A/",
      },
    },
    {
      expectedBodyStyle: "SUV",
      car: {
        dealershipId: "15",
        inventoryTypeId: "2",
        vin: "2T3R1RFV6KW025107",
        stockNumber: "A10400A",
        title: "Used 2019 Toyota RAV4 One Owner & Fully Certified XLE Premium, AWD",
        year: "2019",
        make: "Toyota",
        model: "RAV4",
        trim: "XLE Premium AWD",
        price: "$28,990",
        odometer: "98,317 km",
        exteriorColor: "White",
        interiorColor: "",
        bodyStyle: "",
        fuelType: "Gas",
        transmission: "Automatic",
        detailUrl: "https://www.oregans.com/inventory/Used-2019-Toyota-RAV4-A10400A/",
      },
    },
  ];

  const harness = await startTestServer({ inventoryCars: bodyStyleCases.map(({ car }) => car) });

  try {
    harness.cookie = await login(harness.baseUrl);

    for (const { car, expectedBodyStyle } of bodyStyleCases) {
      const marketplaceDraft = await getJson(
        harness,
        `/api/marketplace-draft?dealershipId=15&inventoryTypeId=2&vin=${car.vin}`,
      );

      assert.equal(marketplaceDraft.draft.fields.bodyStyle, expectedBodyStyle);
      assert.ok(marketplaceDraft.draft.reviewFields.includes("Body style"));
      assert.ok(!marketplaceDraft.draft.missingFields.includes("Body style"));
    }
  } finally {
    await stopTestServer(harness);
  }
});

test("Marketplace draft normalizes O'Regan's cross-over body style group as SUV", async () => {
  const car = {
    dealershipId: "15",
    inventoryTypeId: "2",
    vin: "3N1CP5CV2RL542717",
    stockNumber: "U6526",
    title: "Used 2024 Nissan Kicks Just Arrived & Fully Certified SV",
    year: "2024",
    make: "Nissan",
    model: "Kicks",
    trim: "SV",
    price: "$25,990",
    odometer: "29,100 km",
    exteriorColor: "Blue",
    interiorColor: "",
    bodyStyle: "Wagon / Cross-Over",
    fuelType: "Gas",
    transmission: "Automatic",
    detailUrl: "https://www.oregans.com/inventory/Used-2024-Nissan-Kicks-U6526/",
  };
  const harness = await startTestServer({ inventoryCars: [car] });

  try {
    harness.cookie = await login(harness.baseUrl);

    const marketplaceDraft = await getJson(
      harness,
      `/api/marketplace-draft?dealershipId=15&inventoryTypeId=2&vin=${car.vin}`,
    );

    assert.equal(marketplaceDraft.draft.fields.bodyStyle, "SUV");
    assert.ok(!marketplaceDraft.draft.reviewFields.includes("Body style"));
    assert.ok(!marketplaceDraft.draft.missingFields.includes("Body style"));
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

test("album responses strip unsafe source listing URLs from stored metadata", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const albumId = "car-used-2026-kia-seltos-unsafe-url-u6247a";
    const filename = "2026-06-01T10-00-00-000Z-unsafe-url-front.jpg";
    const albumPath = path.join(harness.uploadRoot, albumId);
    const body = jpegBytes("unsafe-url-front");
    await fs.mkdir(albumPath, { recursive: true });
    await fs.writeFile(path.join(albumPath, filename), body);
    await fs.writeFile(path.join(albumPath, ".album.json"), `${JSON.stringify({
      id: albumId,
      name: "Unsafe URL Album - U6247A",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dealership: { id: "15", name: "O'Regan's Kia Halifax" },
      inventoryTypeId: "2",
      sourceUrl: "https://phishing.example/listing",
      vehicle: {
        source: "oregans",
        inventoryKey: TEST_CAR.vin,
        vin: TEST_CAR.vin,
        stockNumber: TEST_CAR.stockNumber,
        title: TEST_CAR.title,
        dealershipId: "15",
        detailUrl: "data:text/html,<script>alert(1)</script>",
      },
    }, null, 2)}\n`);
    await fs.writeFile(path.join(albumPath, ".photos.json"), `${JSON.stringify({
      [filename]: {
        originalName: "unsafe-url-front.jpg",
        contentType: "image/jpeg",
        bytes: body.length,
        uploadedAt: new Date().toISOString(),
        uploadedBy: { username: TEST_USERNAME, displayName: TEST_USERNAME },
      },
    }, null, 2)}\n`);

    const albums = await getJson(harness, "/api/albums");
    const album = albums.albums.find((candidate) => candidate.id === albumId);
    assert.ok(album);
    assert.equal(album.sourceUrl, null);
    assert.equal(album.vehicle.detailUrl, "");
  } finally {
    await stopTestServer(harness);
  }
});

test("O'Regan's inventory snapshots track newly seen vehicles by dealership", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);

    const firstRun = await postJson(harness, "/api/inventory/snapshots/run", {});
    assert.equal(firstRun.status, 201);
    assert.equal(firstRun.body.snapshot.status, "completed");
    assert.equal(firstRun.body.snapshot.observed, 1);
    assert.equal(firstRun.body.snapshot.newInventory.count, 0);
    assert.equal(firstRun.body.snapshot.pushDelivery, undefined);
    const snapshotAuditEvents = await readAuditLog(harness);
    assertAuditEvent(snapshotAuditEvents, "inventory.snapshot.manual_run", (event) => (
      event.actor.username === TEST_USERNAME
      && event.details.snapshotId === firstRun.body.snapshot.id
      && event.details.newInventoryCount === 0
    ));

    const initialStatus = await getJson(harness, "/api/inventory/snapshots/status");
    assert.equal(initialStatus.ok, true);
    assert.equal(initialStatus.enabled, false);
    assert.equal(initialStatus.latestRun.id, firstRun.body.snapshot.id);
    assert.ok(initialStatus.presentCounts.some((count) => (
      count.dealershipId === "15"
      && count.inventoryTypeId === "2"
      && count.count === 1
    )));

    const michael = await createApprovedAccount(harness, {
      username: "michael",
      displayName: "Michael",
      dealershipId: "18",
      password: "michael-password-123",
    });

    const pushSubscription = await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-inventory-added"),
    });
    assert.equal(pushSubscription.status, 201);
    const michaelPushSubscription = await postJsonWithCookie(harness, michael.cookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("michael-inventory-added"),
    });
    assert.equal(michaelPushSubscription.status, 201);

    await sleep(20);
    const sinceAfterFirstRun = new Date(Date.parse(firstRun.body.snapshot.finishedAt) + 1).toISOString();
    await writeInventoryMock(harness, [TEST_CAR, SNAPSHOT_NEW_CAR, SNAPSHOT_NEW_KIA_CAR]);

    const secondRun = await postJson(harness, "/api/inventory/snapshots/run", {});
    assert.equal(secondRun.status, 201);
    assert.equal(secondRun.body.snapshot.status, "completed");
    assert.equal(secondRun.body.snapshot.observed, 3);
    assert.equal(secondRun.body.snapshot.newInventory.count, 2);
    assert.deepEqual(
      secondRun.body.snapshot.newInventory.vehicles.map((vehicle) => vehicle.stockNumber).sort(),
      [SNAPSHOT_NEW_CAR.stockNumber, SNAPSHOT_NEW_KIA_CAR.stockNumber].sort(),
    );
    assert.equal(secondRun.body.snapshot.pushDelivery.requested, 2);
    assert.equal(secondRun.body.snapshot.pushDelivery.skipped, 2);
    assert.equal(secondRun.body.snapshot.pushDelivery.logged, 2);
    assert.deepEqual(
      secondRun.body.snapshot.pushDelivery.dealerships.map((dealership) => ({
        dealershipId: dealership.dealershipId,
        label: dealership.label,
        count: dealership.count,
        requested: dealership.requested,
        logged: dealership.logged,
      })).sort((left, right) => left.dealershipId.localeCompare(right.dealershipId)),
      [
        { dealershipId: "15", label: "Kia", count: 1, requested: 1, logged: 1 },
        { dealershipId: "18", label: "GM", count: 1, requested: 1, logged: 1 },
      ],
    );

    const notifications = await getJson(harness, "/api/notifications");
    assert.equal(notifications.unreadCount, 1);
    assert.equal(notifications.notifications[0].title, "new Kia Inventory a10412a 2020 Kia Sedona");
    assert.equal(notifications.notifications[0].body, "");
    assert.doesNotMatch(notifications.notifications[0].title, /from carpostclub|fully certified|added/i);
    assert.doesNotMatch(notifications.notifications[0].body, /UG9999|Chevrolet|GM/);
    assert.equal(notifications.notifications[0].kind, "inventory_added");
    assert.equal(notifications.notifications[0].dealershipId, "15");
    assert.match(notifications.notifications[0].url, /dealershipId=15/);

    const michaelNotifications = await getJsonWithCookie(harness, michael.cookie, "/api/notifications");
    assert.equal(michaelNotifications.unreadCount, 1);
    assert.equal(michaelNotifications.notifications[0].title, "new Chevrolet Inventory UG9999 2024 Chevrolet Silverado");
    assert.equal(michaelNotifications.notifications[0].body, "");
    assert.doesNotMatch(michaelNotifications.notifications[0].title, /from carpostclub|Custom|added/i);
    assert.doesNotMatch(michaelNotifications.notifications[0].body, /a10412a|Kia/);
    assert.equal(michaelNotifications.notifications[0].kind, "inventory_added");
    assert.equal(michaelNotifications.notifications[0].dealershipId, "18");
    assert.match(michaelNotifications.notifications[0].url, /dealershipId=18/);

    const added = await getJson(harness, `/api/inventory/snapshots/added?since=${encodeURIComponent(sinceAfterFirstRun)}`);
    assert.equal(added.ok, true);
    assert.equal(added.count, 2);
    const addedByStock = new Map(added.vehicles.map((vehicle) => [vehicle.stockNumber, vehicle]));
    assert.equal(addedByStock.get(SNAPSHOT_NEW_CAR.stockNumber).dealershipId, "18");
    assert.equal(addedByStock.get(SNAPSHOT_NEW_KIA_CAR.stockNumber).dealershipId, "15");
    assert.equal(addedByStock.get(SNAPSHOT_NEW_CAR.stockNumber).currentSeenAt, secondRun.body.snapshot.finishedAt);

    await writeInventoryMock(harness, [SNAPSHOT_NEW_CAR]);
    const thirdRun = await postJson(harness, "/api/inventory/snapshots/run", {});
    assert.equal(thirdRun.status, 201);
    assert.equal(thirdRun.body.snapshot.newInventory.count, 0);

    const finalStatus = await getJson(harness, "/api/inventory/snapshots/status");
    const kiaUsed = finalStatus.presentCounts.find((count) => count.dealershipId === "15" && count.inventoryTypeId === "2");
    const gmUsed = finalStatus.presentCounts.find((count) => count.dealershipId === "18" && count.inventoryTypeId === "2");
    assert.equal(kiaUsed, undefined);
    assert.equal(gmUsed.count, 1);
  } finally {
    await stopTestServer(harness);
  }
});

test("inventory-added batch sends one separate notification per vehicle", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);

    const firstRun = await postJson(harness, "/api/inventory/snapshots/run", {});
    assert.equal(firstRun.status, 201);
    assert.equal(firstRun.body.snapshot.newInventory.count, 0);

    const pushSubscription = await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-inventory-added-batch"),
    });
    assert.equal(pushSubscription.status, 201);

    await sleep(20);
    await writeInventoryMock(harness, [
      TEST_CAR,
      SNAPSHOT_NEW_KIA_CAR,
      SNAPSHOT_BATCH_HONDA_CAR,
      SNAPSHOT_BATCH_TOYOTA_CAR,
    ]);

    const secondRun = await postJson(harness, "/api/inventory/snapshots/run", {});
    assert.equal(secondRun.status, 201);
    assert.equal(secondRun.body.snapshot.status, "completed");
    assert.equal(secondRun.body.snapshot.newInventory.count, 3);
    assert.deepEqual(
      secondRun.body.snapshot.newInventory.vehicles.map((vehicle) => vehicle.stockNumber).sort(),
      ["a10412a", "b20555b", "c30999c"],
    );
    assert.equal(secondRun.body.snapshot.pushDelivery.requested, 3);
    assert.equal(secondRun.body.snapshot.pushDelivery.skipped, 3);
    assert.equal(secondRun.body.snapshot.pushDelivery.logged, 3);
    assert.deepEqual(
      secondRun.body.snapshot.pushDelivery.dealerships.map((dealership) => ({
        dealershipId: dealership.dealershipId,
        label: dealership.label,
        count: dealership.count,
        requested: dealership.requested,
        logged: dealership.logged,
      })),
      [
        { dealershipId: "15", label: "Kia", count: 3, requested: 3, logged: 3 },
      ],
    );

    const notifications = await getJson(harness, "/api/notifications");
    assert.equal(notifications.unreadCount, 3);
    assert.equal(notifications.notifications.length, 3);

    const expectedTitles = [
      "new Kia Inventory a10412a 2020 Kia Sedona",
      "new Honda Inventory b20555b 2021 Honda Civic",
      "new Toyota Inventory c30999c 2022 Toyota Corolla",
    ];
    const notificationsByTitle = new Map(notifications.notifications.map((notification) => [notification.title, notification]));
    for (const title of expectedTitles) {
      assert.ok(notificationsByTitle.has(title), `Missing notification title: ${title}`);
    }

    for (const [title, stockNumber] of [
      ["new Kia Inventory a10412a 2020 Kia Sedona", "a10412a"],
      ["new Honda Inventory b20555b 2021 Honda Civic", "b20555b"],
      ["new Toyota Inventory c30999c 2022 Toyota Corolla", "c30999c"],
    ]) {
      const notification = notificationsByTitle.get(title);
      assert.equal(notification.body, "");
      assert.equal(notification.stockNumber, stockNumber);
      assert.match(notification.messageId, /^inventory-added-/);
      assert.match(notification.tag, new RegExp(stockNumber.toLowerCase()));
      const notificationText = `${notification.title} ${notification.body}`;
      assert.doesNotMatch(notificationText, /\badded\b/i);
      assert.doesNotMatch(notificationText, /from carpostclub/i);
      assert.doesNotMatch(notificationText, /Open CarPostClub\./);
      assert.doesNotMatch(notificationText, /\btrim\b/i);
      assert.doesNotMatch(notificationText, /one owner|certified|fully certified/i);
    }

    assert.equal(new Set(notifications.notifications.map((notification) => notification.id)).size, 3);
    assert.equal(new Set(notifications.notifications.map((notification) => notification.notificationId)).size, 3);
    assert.equal(new Set(notifications.notifications.map((notification) => notification.messageId)).size, 3);
    assert.equal(new Set(notifications.notifications.map((notification) => notification.tag)).size, 3);
    assert.ok(notifications.notifications.every((notification) => notification.body === ""));
  } finally {
    await stopTestServer(harness);
  }
});

test("O'Regan's inventory price changes send all-user push alerts", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);

    const uploaded = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [{ filename: "price-change-front.jpg", type: "image/jpeg", body: jpegBytes("price-change-front") }],
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.album.id, TEST_ALBUM_ID);
    assert.equal(uploaded.body.album.vehicle.price, "$30,990");
    assertSingleMarketplaceDescriptionPrice(uploaded.body.marketplaceDraft.description);
    const initialMarketplaceCopy = await readMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID);
    assert.equal(initialMarketplaceCopy.mode, "upload_pool");

    const firstRun = await postJson(harness, "/api/inventory/snapshots/run", {});
    assert.equal(firstRun.status, 201);
    assert.equal(firstRun.body.snapshot.newInventory.count, 0);
    assert.equal(firstRun.body.snapshot.priceChanges.count, 0);
    assert.equal(firstRun.body.snapshot.priceChangePushDelivery, undefined);

    const michael = await createApprovedAccount(harness, {
      username: "michael.price",
      displayName: "Michael",
      dealershipId: "18",
      password: "michael-price-password-123",
    });

    await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-price-change"),
    });
    await postJsonWithCookie(harness, michael.cookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("michael-price-change"),
    });

    const priceChangedCar = {
      ...TEST_CAR,
      price: "$29,990",
    };
    await sleep(20);
    await writeInventoryMock(harness, [priceChangedCar]);

    const secondRun = await postJson(harness, "/api/inventory/snapshots/run", {});
    assert.equal(secondRun.status, 201);
    assert.equal(secondRun.body.snapshot.status, "completed");
    assert.equal(secondRun.body.snapshot.newInventory.count, 0);
    assert.equal(secondRun.body.snapshot.priceChanges.count, 1);
    assert.equal(secondRun.body.snapshot.priceChanges.vehicles[0].stockNumber, TEST_CAR.stockNumber);
    assert.equal(secondRun.body.snapshot.priceChanges.vehicles[0].previousPrice, "$30,990");
    assert.equal(secondRun.body.snapshot.priceChanges.vehicles[0].currentPrice, "$29,990");
    assert.equal(secondRun.body.snapshot.albumPriceReconciliation.status, "completed");
    assert.equal(secondRun.body.snapshot.albumPriceReconciliation.priceChangeCount, 1);
    assert.equal(secondRun.body.snapshot.albumPriceReconciliation.matchedAlbumCount, 1);
    assert.equal(secondRun.body.snapshot.albumPriceReconciliation.updatedAlbumCount, 1);
    assert.equal(secondRun.body.snapshot.albumPriceReconciliation.regeneratedDescriptionCount, 1);
    assert.equal(secondRun.body.snapshot.albumPriceReconciliation.records[0].albumId, TEST_ALBUM_ID);
    assert.equal(secondRun.body.snapshot.albumPriceReconciliation.records[0].descriptionAction, "regenerated");
    assert.equal(secondRun.body.snapshot.priceChangePushDelivery.requested, 2);
    assert.equal(secondRun.body.snapshot.priceChangePushDelivery.skipped, 2);
    assert.equal(secondRun.body.snapshot.priceChangePushDelivery.logged, 2);
    assert.equal(secondRun.body.snapshot.priceChangePushDelivery.vehicles[0].stockNumber, TEST_CAR.stockNumber);
    assert.equal(secondRun.body.snapshot.priceChangePushDelivery.vehicles[0].logged, 2);

    const updatedAlbumMetadata = JSON.parse(
      await fs.readFile(path.join(harness.uploadRoot, TEST_ALBUM_ID, ".album.json"), "utf8"),
    );
    assert.equal(updatedAlbumMetadata.vehicle.price, "$29,990");
    assert.equal(updatedAlbumMetadata.vehicle.priceValue, 29990);
    assert.equal(updatedAlbumMetadata.vehicle.previousPrice, "$30,990");
    assert.equal(updatedAlbumMetadata.vehicle.previousPriceValue, 30990);
    assert.equal(updatedAlbumMetadata.vehicle.priceSource, "oregans_inventory_snapshot");
    assert.equal(updatedAlbumMetadata.priceReconciliation.previousPrice, "$30,990");
    assert.equal(updatedAlbumMetadata.priceReconciliation.currentPrice, "$29,990");

    const refreshedMarketplaceCopy = await readMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID);
    assert.notEqual(refreshedMarketplaceCopy.inputHash, initialMarketplaceCopy.inputHash);
    assert.ok(refreshedMarketplaceCopy.history.some((entry) => entry.reason === "inventory_price_change"));

    const albumDraft = await getJson(harness, `/api/albums/${TEST_ALBUM_ID}/marketplace-draft`);
    assert.equal(albumDraft.album.vehicle.price, "$29,990");
    assert.equal(albumDraft.draft.fields.price, 29990);
    assert.equal(albumDraft.draft.descriptionInputHash, refreshedMarketplaceCopy.inputHash);
    assertSingleMarketplaceDescriptionPrice(albumDraft.draft.description, "$29,990");
    assert.doesNotMatch(albumDraft.draft.description, /\$30,990/);

    const notifications = await getJson(harness, "/api/notifications");
    assert.equal(notifications.unreadCount, 1);
    assert.equal(notifications.notifications[0].title, "(PRICE CHANGE!!!) U6247A 2026 Kia");
    assert.equal(notifications.notifications[0].body, "$30,990 -> $29,990");
    assert.equal(notifications.notifications[0].kind, "price_change");
    assert.equal(notifications.notifications[0].notificationType, "price_change");
    assert.equal(notifications.notifications[0].stockNumber, TEST_CAR.stockNumber);
    assert.equal(notifications.notifications[0].dealershipId, "15");
    assert.match(notifications.notifications[0].messageId, /^price-change-/);
    assert.match(notifications.notifications[0].url, /openNotifications=1/);

    const michaelNotifications = await getJsonWithCookie(harness, michael.cookie, "/api/notifications");
    assert.equal(michaelNotifications.unreadCount, 1);
    assert.equal(michaelNotifications.notifications[0].title, "(PRICE CHANGE!!!) U6247A 2026 Kia");
    assert.equal(michaelNotifications.notifications[0].body, "$30,990 -> $29,990");
    assert.equal(michaelNotifications.notifications[0].kind, "price_change");
    assert.equal(michaelNotifications.notifications[0].dealershipId, "15");

    await sleep(20);
    await writeInventoryMock(harness, [priceChangedCar]);
    const thirdRun = await postJson(harness, "/api/inventory/snapshots/run", {});
    assert.equal(thirdRun.status, 201);
    assert.equal(thirdRun.body.snapshot.priceChanges.count, 0);
    assert.equal(thirdRun.body.snapshot.priceChangePushDelivery, undefined);

    const afterDuplicateRun = await getJson(harness, "/api/notifications");
    assert.equal(afterDuplicateRun.unreadCount, 1);
    assert.equal(afterDuplicateRun.notifications.length, 1);
  } finally {
    await stopTestServer(harness);
  }
});

test("admin push dry-run reports dealership targets", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const michael = await createApprovedAccount(harness, {
      username: "mwebber2030",
      displayName: "Michael",
      dealershipId: "18",
      password: "michael-password-123",
    });

    await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-preview"),
    });
    await postJsonWithCookie(harness, michael.cookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("michael-preview"),
    });

    const dryRun = await postJson(harness, "/api/admin/push/dry-run", {
      uploadUploaderUsernames: [TEST_USERNAME, "michael"],
    });
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.ok, true);
    assert.equal(dryRun.body.dryRun, true);
    const targetsByLabel = new Map(dryRun.body.dealerships.map((dealership) => [dealership.label, dealership]));
    assert.deepEqual(targetsByLabel.get("Kia").usernames, [TEST_USERNAME]);
    assert.deepEqual(targetsByLabel.get("GM").usernames, ["mwebber2030"]);
    assert.deepEqual(targetsByLabel.get("GM").users.map((user) => user.displayName), ["Michael"]);
    assert.deepEqual(targetsByLabel.get("Nissan").usernames, []);
    assert.deepEqual(targetsByLabel.get("GreenLight").usernames, []);
    assert.deepEqual(targetsByLabel.get("Kia").pushEnabledUsernames, [TEST_USERNAME]);
    assert.deepEqual(targetsByLabel.get("GM").pushEnabledUsernames, ["mwebber2030"]);
    assert.deepEqual(targetsByLabel.get("GM").pushEnabledUsers.map((user) => user.displayName), ["Michael"]);
    const uploadDryRuns = new Map(dryRun.body.upload.simulations.map((simulation) => [simulation.uploaderUsername, simulation]));
    assert.deepEqual(uploadDryRuns.get(TEST_USERNAME).usernames, ["mwebber2030"]);
    assert.deepEqual(uploadDryRuns.get(TEST_USERNAME).pushEnabledUsernames, ["mwebber2030"]);
    assert.equal(uploadDryRuns.get("mwebber2030").requestedUploaderUsername, "michael");
    assert.deepEqual(uploadDryRuns.get("mwebber2030").usernames, [TEST_USERNAME]);
    assert.deepEqual(uploadDryRuns.get("mwebber2030").pushEnabledUsernames, [TEST_USERNAME]);

    const inventoryPreview = await postJson(harness, "/api/push/preview", {
      kind: "inventory_added",
      dealershipId: "15",
    });
    assert.equal(inventoryPreview.status, 200);
    assert.equal(inventoryPreview.body.payload.title, "new Kia Inventory a10412a 2020 Kia Sportage");
    assert.equal(inventoryPreview.body.payload.body, "");
    assert.equal(inventoryPreview.body.payload.stockNumber, "a10412a");
    assert.doesNotMatch(inventoryPreview.body.payload.title, /from carpostclub|added|fully certified/i);

    const nonAdminDryRun = await postJsonWithCookie(harness, michael.cookie, "/api/admin/push/dry-run", {});
    assert.equal(nonAdminDryRun.status, 403);

    const michaelNotifications = await getJsonWithCookie(harness, michael.cookie, "/api/notifications");
    assert.equal(michaelNotifications.unreadCount, 0);
    assert.deepEqual(michaelNotifications.notifications, []);
  } finally {
    await stopTestServer(harness);
  }
});

test("inventory preview push uses short copy and empty body", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-inventory-preview"),
    });

    const preview = await postJson(harness, "/api/push/preview", {
      kind: "inventory_added",
      dealershipId: "15",
      body: "Open CarPostClub.",
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.payload.title, "new Kia Inventory a10412a 2020 Kia Sportage");
    assert.equal(preview.body.payload.body, "");
    assert.equal(preview.body.payload.stockNumber, "a10412a");
    assert.equal(preview.body.payload.kind, "inventory_added");
    assert.equal(preview.body.delivery.requested, 1);
    assert.equal(preview.body.delivery.skipped, 1);
    assert.equal(preview.body.delivery.logged, 1);

    const notifications = await getJson(harness, "/api/notifications");
    assert.equal(notifications.unreadCount, 0);
    assert.deepEqual(notifications.notifications, []);
  } finally {
    await stopTestServer(harness);
  }
});

test("preview push endpoint is disabled in production and old preview notifications stay hidden", async () => {
  const harness = await startTestServer({ env: { NODE_ENV: "production" } });

  try {
    harness.cookie = await login(harness.baseUrl);
    await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-preview-disabled"),
    });

    const disabledPreview = await postJson(harness, "/api/push/preview", { kind: "upload" });
    assert.equal(disabledPreview.status, 404);
    assert.equal(disabledPreview.body.ok, false);
    assert.match(disabledPreview.body.error, /Preview push is disabled/);

    const now = new Date().toISOString();
    await fs.writeFile(path.join(harness.tempRoot, "notification-log.json"), `${JSON.stringify({
      notifications: [
        {
          id: "preview-upload-hidden",
          username: TEST_USERNAME,
          title: "admin uploaded a car",
          body: "Photos added for STK123 - 2024 Kia Sportage.",
          url: "/gallery?dealershipId=15&inventoryTypeId=2&inventoryKey=STK123&openAlbum=1",
          kind: "upload",
          type: "media_upload",
          route: "media_gallery",
          notificationType: "media_upload",
          tag: "carpostclub-preview-preview-upload-hidden",
          messageId: "preview-upload-hidden",
          preview: true,
          createdAt: now,
          receivedAt: now,
        },
        {
          id: "real-upload-visible",
          username: TEST_USERNAME,
          title: "Konner uploaded a car",
          body: "Photos added for U6247A - 2026 Kia Seltos X-Line AWD.",
          url: `/gallery?dealershipId=15&inventoryTypeId=2&inventoryKey=${TEST_CAR.vin}&albumId=${TEST_ALBUM_ID}&openAlbum=1`,
          kind: "upload",
          type: "media_upload",
          route: "media_gallery",
          notificationType: "media_upload",
          messageId: "upload-real-visible",
          preview: false,
          dealershipId: "15",
          inventoryTypeId: "2",
          inventoryKey: TEST_CAR.vin,
          stockNumber: TEST_CAR.stockNumber,
          createdAt: now,
          receivedAt: now,
        },
      ],
    }, null, 2)}\n`);

    const notifications = await getJson(harness, "/api/notifications");
    assert.equal(notifications.unreadCount, 1);
    assert.equal(notifications.notifications.length, 1);
    assert.equal(notifications.notifications[0].id, "real-upload-visible");
    assert.equal(notifications.notifications[0].preview, false);
    assert.equal(notifications.notifications[0].route, "media_gallery");
  } finally {
    await stopTestServer(harness);
  }
});

test("album cover prefers a front exterior photo over dash and detail images", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const uploaded = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "dash.jpg", type: "image/jpeg", body: jpegBytes("dash") },
        { filename: "front-exterior.jpg", type: "image/jpeg", body: jpegBytes("front-exterior") },
        { filename: "lot-tag.jpg", type: "image/jpeg", body: jpegBytes("lot-tag") },
      ],
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.album.coverPhoto.originalName, "front-exterior.jpg");

    const album = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.equal(album.album.coverPhoto.originalName, "front-exterior.jpg");
    assert.equal(album.photos[0].originalName, "front-exterior.jpg");
    assert.match(album.album.coverThumbnailUrl, /\/thumbnail$/);

    const uploadIndexByName = new Map(album.photos.map((photo) => [photo.originalName, photo.uploadIndex]));
    assert.equal(uploadIndexByName.get("dash.jpg"), 0);
    assert.equal(uploadIndexByName.get("front-exterior.jpg"), 1);
    assert.equal(uploadIndexByName.get("lot-tag.jpg"), 2);
  } finally {
    await stopTestServer(harness);
  }
});

test("album inventory status marks O'Regan's vehicles that disappear from the feed", async () => {
  const harness = await startTestServer({ inventoryCars: [] });

  try {
    harness.cookie = await login(harness.baseUrl);
    await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-source-removed-suppressed"),
    });

    const albumPath = path.join(harness.uploadRoot, TEST_ALBUM_ID);
    const missingInventoryFilename = "2026-06-01T10-00-00-000Z-missing-front.jpg";
    await fs.mkdir(albumPath, { recursive: true });
    await fs.writeFile(path.join(albumPath, missingInventoryFilename), jpegBytes("missing-front"));
    await fs.writeFile(path.join(albumPath, ".album.json"), `${JSON.stringify({
      id: TEST_ALBUM_ID,
      name: `${TEST_CAR.title} - ${TEST_CAR.stockNumber}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dealership: { id: "15", name: "O'Regan's Kia Halifax" },
      inventoryTypeId: "2",
      sourceUrl: TEST_CAR.detailUrl,
      vehicle: {
        source: "oregans",
        inventoryKey: TEST_CAR.vin,
        vin: TEST_CAR.vin,
        stockNumber: TEST_CAR.stockNumber,
        title: TEST_CAR.title,
        year: TEST_CAR.year,
        make: TEST_CAR.make,
        model: TEST_CAR.model,
        trim: TEST_CAR.trim,
        price: TEST_CAR.price,
        odometer: TEST_CAR.odometer,
        exteriorColor: TEST_CAR.exteriorColor,
        interiorColor: TEST_CAR.interiorColor,
        bodyStyle: TEST_CAR.bodyStyle,
        fuelType: TEST_CAR.fuelType,
        transmission: TEST_CAR.transmission,
        detailUrl: TEST_CAR.detailUrl,
        dealershipId: "15",
        dealershipName: "O'Regan's Kia Halifax",
      },
    }, null, 2)}\n`);
    await fs.writeFile(path.join(albumPath, ".photos.json"), `${JSON.stringify({
      [missingInventoryFilename]: {
        originalName: "missing-front.jpg",
        contentType: "image/jpeg",
        bytes: Buffer.byteLength(jpegBytes("missing-front")),
        uploadedAt: new Date().toISOString(),
        uploadedBy: { username: TEST_USERNAME, displayName: TEST_USERNAME },
      },
    }, null, 2)}\n`);

    const albums = await getJson(harness, "/api/albums");
    const album = albums.albums.find((candidate) => candidate.id === TEST_ALBUM_ID);
    assert.ok(album);
    assert.equal(album.inventoryStatus.active, false);
    assert.equal(album.inventoryStatus.status, "missing");
    assert.match(album.inventoryStatus.label, /No longer active in O'Regan's inventory as of/);
    assert.equal(album.inventoryStatus.lifecycle.sourceStatus, "source_removed");
    assert.equal(album.inventoryStatus.lifecycle.packageStatus, "source_removed_package");
    assert.equal(album.inventoryStatus.lifecycle.facebookState, "stale_on_facebook");
    assert.equal(album.inventoryStatus.lifecycle.facebookAction, "mark_sold");
    assert.equal(album.inventoryStatus.lifecycle.shouldMarkFacebookSold, true);
    assert.equal(album.inventoryStatus.lifecycle.canPostToFacebook, false);

    const descriptionDownload = await fetch(`${harness.baseUrl}/api/albums/${TEST_ALBUM_ID}/description.txt`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(descriptionDownload.status, 200);
    const descriptionText = await descriptionDownload.text();
    assert.match(descriptionText, /Facebook sync: Mark any matching Konner John Marketplace listing sold; do not delete it\./);
    assert.match(descriptionText, /Ready to post: No/);

    const packageDownload = await fetch(`${harness.baseUrl}/api/albums/${TEST_ALBUM_ID}/package`, {
      headers: { Cookie: harness.cookie },
    });
    assert.equal(packageDownload.status, 200);
    const packageManifest = JSON.parse(zipEntryText(Buffer.from(await packageDownload.arrayBuffer()), "package-manifest.json"));
    assert.equal(packageManifest.readyToPost, false);
    assert.equal(packageManifest.inventoryStatus.lifecycle.facebookAction, "mark_sold");

    const notifications = await getJson(harness, "/api/notifications");
    assert.equal(notifications.unreadCount, 0);
    assert.deepEqual(notifications.notifications, []);
    assert.deepEqual(await notificationLogForUsername(harness, TEST_USERNAME), []);
  } finally {
    await stopTestServer(harness);
  }
});

test("non-admin users cannot call destructive gallery delete routes", async () => {
  const harness = await startTestServer({ inventoryCars: [TEST_CAR] });

  try {
    harness.cookie = await login(harness.baseUrl);
    const viewer = await createApprovedAccount(harness, {
      username: "delete.viewer",
      displayName: "Delete Viewer",
      password: "delete-viewer-123",
    });
    const upload = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [{ filename: "blocked-delete-front.jpg", type: "image/jpeg", body: jpegBytes("blocked-delete-front") }],
    });
    assert.equal(upload.status, 201);

    const deleteAll = await deleteJsonWithCookie(harness, viewer.cookie, `/api/albums/${upload.body.album.id}/media`, {});
    assert.equal(deleteAll.status, 403);
    assert.match(deleteAll.body.error, /Admin access required/i);

    await fs.access(path.join(harness.uploadRoot, upload.body.album.id, upload.body.photos[0].filename));
  } finally {
    await stopTestServer(harness);
  }
});

test("signup invite links expire and block account creation after 24 hours", async () => {
  const harness = await startTestServer();

  try {
    const expiredToken = "expired_invite_token_1234567890";
    const now = Date.now();
    await fs.writeFile(path.join(harness.tempRoot, "auth-invites.json"), `${JSON.stringify({
      invites: [{
        id: expiredToken,
        createdAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        createdBy: { username: TEST_USERNAME, displayName: TEST_USERNAME, role: "admin", status: "approved" },
        useCount: 0,
        acceptedUsers: [],
      }],
    }, null, 2)}\n`);

    const expiredPage = await fetch(`${harness.baseUrl}/signup?invite=${encodeURIComponent(expiredToken)}`);
    assert.equal(expiredPage.status, 400);
    assert.match(await expiredPage.text(), /invite link expired/i);

    const expiredSignup = await requestSignup(harness.baseUrl, {
      invite: expiredToken,
      displayName: "Late User",
      username: "late.user",
      password: "late-user-123",
      confirmPassword: "late-user-123",
    });
    assert.equal(expiredSignup.status, 400);
    assert.match(expiredSignup.body, /invite link expired/i);

    const lateLogin = await loginAttempt(harness.baseUrl, "late.user", "late-user-123");
    assert.equal(lateLogin.status, 401);
  } finally {
    await stopTestServer(harness);
  }
});

test("admin invite generation returns a signup URL for clipboard copy", async () => {
  const harness = await startTestServer({
    env: { CARPOSTCLUB_PUBLIC_ORIGIN: "https://carpostclub.com/some/path" },
  });

  try {
    harness.cookie = await login(harness.baseUrl);
    const response = await fetch(`${harness.baseUrl}/admin/invites`, {
      method: "POST",
      headers: {
        Cookie: harness.cookie,
        Accept: "application/json",
        "X-Requested-With": "fetch",
      },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
    assertNoStoreHeaders(response);

    const body = await response.json();
    assert.match(body.invite.id, /^[A-Za-z0-9_-]{24,}$/);
    assert.equal(body.invite.active, true);
    assert.equal(body.invite.signupUrl, `https://carpostclub.com/signup?invite=${body.invite.id}`);
    assert.match(body.redirect, /\/admin\/users\?/);
    const redirect = new URL(body.redirect, harness.baseUrl);
    assert.equal(redirect.searchParams.get("success"), "Invite link created and copied to clipboard.");
    assert.equal(redirect.searchParams.get("invite"), body.invite.id);

    const storedInvites = JSON.parse(await fs.readFile(path.join(harness.tempRoot, "auth-invites.json"), "utf8"));
    assert.equal(storedInvites.invites[0].id, body.invite.id);
  } finally {
    await stopTestServer(harness);
  }
});

test("Shortcut inventory endpoint requires bearer token when configured", async () => {
  const token = "shortcut-token-for-tests";
  const harness = await startTestServer({
    env: { CARPOSTCLUB_SHORTCUTS_BEARER_TOKEN: token },
  });

  try {
    const unauthenticated = await fetchJson(`${harness.baseUrl}/api/shortcuts/inventory-albums`);
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.response.headers.get("www-authenticate") || "", /Bearer/);
    assertNoStoreHeaders(unauthenticated.response);

    const authorized = await fetchJson(`${harness.baseUrl}/api/shortcuts/inventory-albums`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.body.ok, true);
    assert.equal(authorized.body.count, 1);
    assert.equal(authorized.body.items[0].vin, TEST_CAR.vin);
    assertNoStoreHeaders(authorized.response);
  } finally {
    await stopTestServer(harness);
  }
});

test("one active invite link can sign up multiple people before it expires", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const invite = await createInvite(harness);
    const accounts = [
      { displayName: "Group One", username: "group.one", password: "group-one-123" },
      { displayName: "Group Two", username: "group.two", password: "group-two-123" },
    ];

    for (const account of accounts) {
      const signup = await requestSignup(harness.baseUrl, {
        invite: invite.token,
        displayName: account.displayName,
        username: account.username,
        password: account.password,
        confirmPassword: account.password,
      });
      assert.equal(signup.status, 200);
      assert.match(signup.body, /Account created\. You can sign in now/i);
      const cookie = await login(harness.baseUrl, account.username, account.password);
      const me = await fetchJson(`${harness.baseUrl}/api/me`, {
        headers: { Cookie: cookie },
      });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.username, account.username);
    }

    const storedInvites = JSON.parse(await fs.readFile(path.join(harness.tempRoot, "auth-invites.json"), "utf8"));
    assert.equal(storedInvites.invites[0].id, invite.token);
    assert.equal(storedInvites.invites[0].useCount, 2);
    assert.deepEqual(
      storedInvites.invites[0].acceptedUsers.map((user) => user.username).sort(),
      accounts.map((account) => account.username).sort(),
    );
  } finally {
    await stopTestServer(harness);
  }
});

test("upload limits return clear client errors", async () => {
  const harness = await startTestServer({
    env: {
      MAX_FILE_BYTES: "1024",
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
        { filename: "oversized.jpg", type: "image/jpeg", body: Buffer.alloc(2048, 1) },
      ],
    });
    assert.equal(tooLarge.status, 413);
    assert.match(tooLarge.body.error, /Each file must be 1\.0 KB or smaller/);
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

test("media uploads reject corrupt or mismatched file bytes", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const corruptImage = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "front.jpg", type: "image/jpeg", body: Buffer.from("not a decodable image") },
      ],
    });
    assert.equal(corruptImage.status, 400);
    assert.match(corruptImage.body.error, /could not be decoded|image bytes do not match/i);
    assert.deepEqual(await fs.readdir(harness.tmpRoot), []);

    const mismatchedImage = await uploadPhotos(harness, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "front.jpg", type: "image/jpeg", body: pngBytes("front") },
      ],
    });
    assert.equal(mismatchedImage.status, 400);
    assert.match(mismatchedImage.body.error, /image bytes do not match/i);
    assert.deepEqual(await fs.readdir(harness.tmpRoot), []);

    const afterRejectedUploads = await getJson(
      harness,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}`,
    );
    assert.deepEqual(afterRejectedUploads.photos, []);
  } finally {
    await stopTestServer(harness);
  }
});

test("vehicle gallery unread state is tracked per user", async () => {
  const harness = await startTestServer();
  const albumCollectors = [];

  try {
    harness.cookie = await login(harness.baseUrl);
    const firstViewer = await createApprovedAccount(harness, {
      username: "first.viewer",
      displayName: "First Viewer",
      password: "first-viewer-123",
    });
    const secondViewer = await createApprovedAccount(harness, {
      username: "second.viewer",
      displayName: "Second Viewer",
      password: "second-viewer-123",
    });

    albumCollectors.push(await openAlbumCollector(harness, firstViewer.cookie));
    albumCollectors.push(await openAlbumCollector(harness, secondViewer.cookie));
    await sleep(100);

    const uploaded = await uploadPhotosWithCookie(harness, harness.cookie, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "admin-front.jpg", type: "image/jpeg", body: jpegBytes("admin-front") },
      ],
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.album.id, TEST_ALBUM_ID);

    for (const collector of albumCollectors) {
      const [event] = await collector.waitForMessages(1);
      assert.equal(event.kind, "upload");
      assert.match(event.uploadId, /^upload-/);
      assert.equal(event.albumId, TEST_ALBUM_ID);
      assert.equal(event.mediaCount, 1);
      assert.equal(event.uploadedBy.username, TEST_USERNAME);
      assert.equal(event.title, "admin uploaded U6247A - 2026 Kia Seltos X-Line AWD");
      assert.equal(event.body, "");
      assert.equal(event.liveStatusBody, "Photos added for U6247A - 2026 Kia Seltos X-Line AWD.");
      assert.equal(event.type, "media_upload");
      assert.equal(event.notificationType, "media_upload");
      assert.equal(event.route, "media_gallery");
      assert.equal(event.dealershipId, "15");
      assert.equal(event.inventoryTypeId, "2");
      assert.equal(event.inventoryKey, TEST_CAR.vin);
      assert.equal(event.stockNumber, TEST_CAR.stockNumber);
      assert.equal(event.url, `/gallery?dealershipId=15&inventoryTypeId=2&inventoryKey=${TEST_CAR.vin}&albumId=${TEST_ALBUM_ID}`);
    }

    const adminGallery = await getJsonWithCookie(harness, harness.cookie, "/api/albums");
    assert.equal(albumUnread(adminGallery, TEST_ALBUM_ID), true);
    assert.equal(adminGallery.unreadTotal, 1);

    const firstGallery = await getJsonWithCookie(harness, firstViewer.cookie, "/api/albums");
    const secondGallery = await getJsonWithCookie(harness, secondViewer.cookie, "/api/albums");
    assert.equal(albumUnread(firstGallery, TEST_ALBUM_ID), true);
    assert.equal(albumUnread(secondGallery, TEST_ALBUM_ID), true);
    assert.equal(firstGallery.unreadTotal, 1);
    assert.equal(secondGallery.unreadTotal, 1);

    const brandNewViewer = await createApprovedAccount(harness, {
      username: "brand.new.viewer",
      displayName: "Brand New Viewer",
      password: "brand-new-viewer-123",
    });
    const brandNewGallery = await getJsonWithCookie(harness, brandNewViewer.cookie, "/api/albums");
    assert.equal(albumUnread(brandNewGallery, TEST_ALBUM_ID), true);
    assert.equal(brandNewGallery.unreadTotal, 1);

    const uploaderNoMarkRefresh = await getJsonWithCookie(
      harness,
      harness.cookie,
      `/api/vehicle-album?dealershipId=15&inventoryTypeId=2&vin=${TEST_CAR.vin}&markSeen=0`,
    );
    assert.equal(uploaderNoMarkRefresh.album.id, TEST_ALBUM_ID);
    assert.equal(uploaderNoMarkRefresh.photos.length, 1);
    const adminAfterNoMarkRefresh = await getJsonWithCookie(harness, harness.cookie, "/api/albums");
    assert.equal(albumUnread(adminAfterNoMarkRefresh, TEST_ALBUM_ID), true);
    assert.equal(adminAfterNoMarkRefresh.unreadTotal, 1);

    const adminFolderRead = await postJsonWithCookie(harness, harness.cookie, "/api/gallery/dealerships/15/seen", {});
    assert.equal(adminFolderRead.status, 200);
    assert.equal(adminFolderRead.body.marked, 0);
    assert.equal(adminFolderRead.body.deprecated, true);
    assert.equal(albumUnread(adminFolderRead.body, TEST_ALBUM_ID), true);
    assert.equal(adminFolderRead.body.unreadTotal, 1);

    const firstRead = await postJsonWithCookie(harness, firstViewer.cookie, "/api/gallery/dealerships/15/seen", {});
    assert.equal(firstRead.status, 200);
    assert.equal(firstRead.body.marked, 0);
    assert.equal(firstRead.body.deprecated, true);
    assert.equal(albumUnread(firstRead.body, TEST_ALBUM_ID), true);
    assert.equal(firstRead.body.unreadTotal, 1);

    const firstAfterRead = await getJsonWithCookie(harness, firstViewer.cookie, "/api/albums");
    const secondAfterFirstRead = await getJsonWithCookie(harness, secondViewer.cookie, "/api/albums");
    assert.equal(albumUnread(firstAfterRead, TEST_ALBUM_ID), true);
    assert.equal(albumUnread(secondAfterFirstRead, TEST_ALBUM_ID), true);
    assert.equal(secondAfterFirstRead.unreadTotal, 1);

    const adminAlbumRead = await postJsonWithCookie(harness, harness.cookie, `/api/albums/${TEST_ALBUM_ID}/seen`, {});
    assert.equal(adminAlbumRead.status, 200);
    assert.equal(adminAlbumRead.body.marked, 1);
    assert.equal(albumUnread(adminAlbumRead.body, TEST_ALBUM_ID), false);
    assert.equal(adminAlbumRead.body.unreadTotal, 0);

    const firstAfterAdminRead = await getJsonWithCookie(harness, firstViewer.cookie, "/api/albums");
    const secondAfterAdminRead = await getJsonWithCookie(harness, secondViewer.cookie, "/api/albums");
    assert.equal(albumUnread(firstAfterAdminRead, TEST_ALBUM_ID), true);
    assert.equal(albumUnread(secondAfterAdminRead, TEST_ALBUM_ID), true);
    assert.equal(firstAfterAdminRead.unreadTotal, 1);
    assert.equal(secondAfterAdminRead.unreadTotal, 1);

    const firstAlbumRead = await postJsonWithCookie(harness, firstViewer.cookie, `/api/albums/${TEST_ALBUM_ID}/seen`, {});
    assert.equal(firstAlbumRead.status, 200);
    assert.equal(firstAlbumRead.body.marked, 1);
    assert.equal(albumUnread(firstAlbumRead.body, TEST_ALBUM_ID), false);
    assert.equal(firstAlbumRead.body.unreadTotal, 0);

    const secondAfterFirstAlbumRead = await getJsonWithCookie(harness, secondViewer.cookie, "/api/albums");
    assert.equal(albumUnread(secondAfterFirstAlbumRead, TEST_ALBUM_ID), true);
    assert.equal(secondAfterFirstAlbumRead.unreadTotal, 1);

    const secondRead = await postJsonWithCookie(harness, secondViewer.cookie, `/api/albums/${TEST_ALBUM_ID}/seen`, {});
    assert.equal(secondRead.status, 200);
    assert.equal(secondRead.body.marked, 1);
    assert.equal(albumUnread(secondRead.body, TEST_ALBUM_ID), false);
    assert.equal(secondRead.body.unreadTotal, 0);
  } finally {
    await Promise.all(albumCollectors.map((collector) => collector.close()));
    await stopTestServer(harness);
  }
});

test("vehicle upload push notifications go to all approved push-enabled users except uploader", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const kiaViewer = await createApprovedAccount(harness, {
      username: "kia.viewer",
      displayName: "Kia Viewer",
      dealershipId: "15",
      password: "kia-viewer-123",
    });
    const gmViewer = await createApprovedAccount(harness, {
      username: "gm.viewer",
      displayName: "GM Viewer",
      dealershipId: "18",
      password: "gm-viewer-123",
    });
    const nissanViewer = await createApprovedAccount(harness, {
      username: "nissan.viewer",
      displayName: "Nissan Viewer",
      dealershipId: "3",
      password: "nissan-viewer-123",
    });
    const noPushViewer = await createApprovedAccount(harness, {
      username: "no.push.viewer",
      displayName: "No Push Viewer",
      dealershipId: "2",
      password: "no-push-viewer-123",
    });
    const rejectedViewer = await createApprovedAccount(harness, {
      username: "rejected.viewer",
      displayName: "Rejected Viewer",
      dealershipId: "2",
      password: "rejected-viewer-123",
    });

    await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-upload-targeted"),
    });
    await postJsonWithCookie(harness, kiaViewer.cookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("kia-viewer-upload-targeted"),
    });
    await postJsonWithCookie(harness, gmViewer.cookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("gm-viewer-upload-targeted"),
    });
    await postJsonWithCookie(harness, nissanViewer.cookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("nissan-viewer-upload-targeted"),
    });
    await postJsonWithCookie(harness, rejectedViewer.cookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("rejected-viewer-upload-targeted"),
    });

    const rejected = await fetch(`${harness.baseUrl}/admin/users/${encodeURIComponent(rejectedViewer.username)}/reject`, {
      method: "POST",
      headers: { Cookie: harness.cookie },
      redirect: "manual",
    });
    assert.equal(rejected.status, 303);

    const uploaded = await uploadPhotosWithCookie(harness, harness.cookie, {
      dealershipId: "15",
      inventoryTypeId: "2",
      vin: TEST_CAR.vin,
      photos: [
        { filename: "targeted-front.jpg", type: "image/jpeg", body: jpegBytes("targeted-front") },
      ],
    });
    assert.equal(uploaded.status, 201);

    const kiaNotifications = await waitForNotificationCount(harness, kiaViewer.cookie, 1);
    assert.equal(kiaNotifications.notifications[0].title, "admin uploaded U6247A - 2026 Kia Seltos X-Line AWD");
    assert.equal(kiaNotifications.notifications[0].body, "");
    assert.equal(kiaNotifications.notifications[0].kind, "upload");
    assert.equal(kiaNotifications.notifications[0].type, "media_upload");
    assert.equal(kiaNotifications.notifications[0].notificationType, "media_upload");
    assert.equal(kiaNotifications.notifications[0].route, "media_gallery");
    assert.equal(kiaNotifications.notifications[0].dealershipId, "15");
    assert.equal(kiaNotifications.notifications[0].inventoryTypeId, "2");
    assert.equal(kiaNotifications.notifications[0].inventoryKey, TEST_CAR.vin);
    assert.equal(kiaNotifications.notifications[0].stockNumber, TEST_CAR.stockNumber);
    assert.equal(kiaNotifications.notifications[0].url, `/gallery?dealershipId=15&inventoryTypeId=2&inventoryKey=${TEST_CAR.vin}&albumId=${TEST_ALBUM_ID}`);

    const gmNotifications = await waitForNotificationCount(harness, gmViewer.cookie, 1);
    assert.equal(gmNotifications.notifications[0].title, "admin uploaded U6247A - 2026 Kia Seltos X-Line AWD");
    assert.equal(gmNotifications.notifications[0].body, "");
    assert.equal(gmNotifications.notifications[0].kind, "upload");
    assert.equal(gmNotifications.notifications[0].route, "media_gallery");
    assert.equal(gmNotifications.notifications[0].dealershipId, "15");

    const nissanNotifications = await waitForNotificationCount(harness, nissanViewer.cookie, 1);
    assert.equal(nissanNotifications.notifications[0].title, "admin uploaded U6247A - 2026 Kia Seltos X-Line AWD");
    assert.equal(nissanNotifications.notifications[0].body, "");
    assert.equal(nissanNotifications.notifications[0].kind, "upload");
    assert.equal(nissanNotifications.notifications[0].route, "media_gallery");
    assert.equal(nissanNotifications.notifications[0].dealershipId, "15");

    const adminNotifications = await getJson(harness, "/api/notifications");
    assert.equal(adminNotifications.unreadCount, 0);
    assert.deepEqual(adminNotifications.notifications, []);

    const noPushNotifications = await getJsonWithCookie(harness, noPushViewer.cookie, "/api/notifications");
    assert.equal(noPushNotifications.unreadCount, 0);
    assert.deepEqual(noPushNotifications.notifications, []);

    assert.deepEqual(await notificationLogForUsername(harness, rejectedViewer.username), []);
  } finally {
    await stopTestServer(harness);
  }
});

test("gm uploader is excluded while kia users receive the upload push", async () => {
  const harness = await startTestServer({ inventoryCars: [TEST_CAR, SNAPSHOT_NEW_CAR] });

  try {
    harness.cookie = await login(harness.baseUrl);
    const michael = await createApprovedAccount(harness, {
      username: "michael",
      displayName: "Michael",
      dealershipId: "18",
      password: "michael-password-123",
    });

    await postJson(harness, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("admin-gm-upload"),
    });
    await postJsonWithCookie(harness, michael.cookie, "/api/push/subscriptions", {
      subscription: pushSubscriptionFor("michael-gm-upload"),
    });

    const uploaded = await uploadPhotosWithCookie(harness, michael.cookie, {
      dealershipId: "18",
      inventoryTypeId: "2",
      vin: SNAPSHOT_NEW_CAR.vin,
      photos: [
        { filename: "gm-front.jpg", type: "image/jpeg", body: jpegBytes("gm-front") },
      ],
    });
    assert.equal(uploaded.status, 201);

    const adminNotifications = await waitForNotificationCount(harness, harness.cookie, 1);
    assert.equal(adminNotifications.notifications[0].title, "Michael uploaded UG9999 - 2024 Chevrolet Silverado Custom");
    assert.equal(adminNotifications.notifications[0].body, "");
    assert.equal(adminNotifications.notifications[0].kind, "upload");
    assert.equal(adminNotifications.notifications[0].route, "media_gallery");
    assert.equal(adminNotifications.notifications[0].dealershipId, "18");
    assert.equal(adminNotifications.notifications[0].url, `/gallery?dealershipId=18&inventoryTypeId=2&inventoryKey=${SNAPSHOT_NEW_CAR.vin}&albumId=${uploaded.body.album.id}`);

    const michaelNotifications = await getJsonWithCookie(harness, michael.cookie, "/api/notifications");
    assert.equal(michaelNotifications.unreadCount, 0);
    assert.deepEqual(michaelNotifications.notifications, []);
  } finally {
    await stopTestServer(harness);
  }
});

test("chat read state is tracked per account across sessions", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const firstViewer = await createApprovedAccount(harness, {
      username: "first.chat.viewer",
      displayName: "First Chat Viewer",
      password: "first-chat-viewer-123",
    });
    const secondViewer = await createApprovedAccount(harness, {
      username: "second.chat.viewer",
      displayName: "Second Chat Viewer",
      password: "second-chat-viewer-123",
    });
    const firstViewerPhoneCookie = await login(harness.baseUrl, firstViewer.username, firstViewer.password);

    const firstPost = await postJson(harness, "/api/chat/messages", { text: "Read this on desktop" });
    assert.equal(firstPost.status, 201);
    const firstMarker = {
      id: firstPost.body.message.id,
      createdAt: firstPost.body.message.createdAt,
    };

    const firstBeforeRead = await getJsonWithCookie(harness, firstViewer.cookie, "/api/chat/messages");
    assert.equal(firstBeforeRead.messages.length, 1);
    assert.equal(firstBeforeRead.readState.marker, null);

    const firstRead = await putJsonWithCookie(harness, firstViewer.cookie, "/api/chat/read-state", { marker: firstMarker });
    assert.equal(firstRead.status, 200);
    assert.deepEqual(firstRead.body.readState.marker, firstMarker);
    assert.ok(firstRead.body.readState.readAt);

    const firstPhoneMessages = await getJsonWithCookie(harness, firstViewerPhoneCookie, "/api/chat/messages");
    assert.deepEqual(firstPhoneMessages.readState.marker, firstMarker);

    const secondMessages = await getJsonWithCookie(harness, secondViewer.cookie, "/api/chat/messages");
    assert.equal(secondMessages.readState.marker, null);

    const secondPost = await postJsonWithCookie(harness, secondViewer.cookie, "/api/chat/messages", { text: "New message after desktop read" });
    assert.equal(secondPost.status, 201);
    const secondMarker = {
      id: secondPost.body.message.id,
      createdAt: secondPost.body.message.createdAt,
    };

    const firstPhoneRead = await putJsonWithCookie(harness, firstViewerPhoneCookie, "/api/chat/read-state", { marker: secondMarker });
    assert.equal(firstPhoneRead.status, 200);
    assert.deepEqual(firstPhoneRead.body.readState.marker, secondMarker);

    const staleDesktopWrite = await putJsonWithCookie(harness, firstViewer.cookie, "/api/chat/read-state", { marker: firstMarker });
    assert.equal(staleDesktopWrite.status, 200);
    assert.deepEqual(staleDesktopWrite.body.readState.marker, secondMarker);

    const firstAfterStaleWrite = await getJsonWithCookie(harness, firstViewer.cookie, "/api/chat/read-state");
    assert.deepEqual(firstAfterStaleWrite.readState.marker, secondMarker);
  } finally {
    await stopTestServer(harness);
  }
});

test("gallery and vehicle preferences are tracked per account across sessions", async () => {
  const harness = await startTestServer();

  try {
    harness.cookie = await login(harness.baseUrl);
    const firstViewer = await createApprovedAccount(harness, {
      username: "first.pref.viewer",
      displayName: "First Pref Viewer",
      password: "first-pref-viewer-123",
    });
    const secondViewer = await createApprovedAccount(harness, {
      username: "second.pref.viewer",
      displayName: "Second Pref Viewer",
      password: "second-pref-viewer-123",
    });
    const firstViewerPhoneCookie = await login(harness.baseUrl, firstViewer.username, firstViewer.password);

    const firstInitial = await getJsonWithCookie(harness, firstViewer.cookie, "/api/me");
    assert.equal(firstInitial.preferences, null);

    const preferences = {
      selectedDealershipId: "15",
      selectedInventoryTypeId: "2",
      selectedMake: "Kia",
      selectedModel: "Seltos",
      selectedVin: TEST_CAR.vin,
      carSearch: "u6247a",
      showPostedInventory: true,
      galleryDealershipId: "15",
      expandedAlbumId: TEST_ALBUM_ID,
      gallerySearch: "seltos photos",
      galleryStatusFilter: "all",
      galleryMakeFilter: "Kia",
      galleryModelFilter: "Seltos",
      galleryYearFilter: "2026",
      galleryUploaderFilter: firstViewer.displayName,
    };

    const saved = await putJsonWithCookie(harness, firstViewer.cookie, "/api/me/preferences", { preferences });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.preferences, preferences);
    assert.ok(saved.body.updatedAt);

    const firstPhoneMe = await getJsonWithCookie(harness, firstViewerPhoneCookie, "/api/me");
    assert.deepEqual(firstPhoneMe.preferences, preferences);
    assert.ok(firstPhoneMe.preferencesUpdatedAt);

    const firstPhonePreferences = await getJsonWithCookie(harness, firstViewerPhoneCookie, "/api/me/preferences");
    assert.deepEqual(firstPhonePreferences.preferences, preferences);

    const secondMe = await getJsonWithCookie(harness, secondViewer.cookie, "/api/me");
    assert.equal(secondMe.preferences, null);
  } finally {
    await stopTestServer(harness);
  }
});

test("multiple approved accounts can use live chat while duplicate vehicle uploads are blocked", async () => {
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

	    const uploadUsers = approvedUsers;
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

	    assert.deepEqual(uploads.map((upload) => upload.status).sort(), [201, 409, 409]);
	    const successfulUpload = uploads.find((upload) => upload.status === 201);
	    assert.ok(successfulUpload);
	    assert.equal(successfulUpload.body.ok, true);
	    assert.equal(successfulUpload.body.album.id, TEST_ALBUM_ID);
	    assert.equal(successfulUpload.body.count, 2);
	    for (const photo of successfulUpload.body.photos) {
	      const expectedUploader = expectedUploaderByOriginalName.get(photo.originalName);
	      assert.equal(photo.uploadedBy.username, expectedUploader.username);
	      assert.equal(photo.uploadedBy.displayName, expectedUploader.displayName);
	    }
	    for (const upload of uploads.filter((candidate) => candidate.status === 409)) {
	      assert.match(upload.body.error, /already has uploaded CarPostClub photos/i);
	    }

	    const expectedOriginalNames = successfulUpload.body.photos.map((photo) => photo.originalName).sort();

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
      CARPOSTCLUB_AUTH_DEALERSHIP_ID: "15",
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
  return { baseUrl, child, output: () => output, tempRoot, uploadRoot, tmpRoot, inventoryMockFile, cookie: "" };
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
    body: new URLSearchParams({ dealershipId: "15", ...body }),
    redirect: "manual",
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

async function createInvite(harness) {
  const response = await fetch(`${harness.baseUrl}/admin/invites`, {
    method: "POST",
    headers: { Cookie: harness.cookie },
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.url, /\/admin\/users\?/);
  assertNoStoreHeaders(response);
  const token = body.match(/\/signup\?invite=([A-Za-z0-9_-]+)/)?.[1] || "";
  assert.ok(token, body);
  return {
    token,
    body,
  };
}

async function createApprovedAccount(harness, account) {
  const invite = await createInvite(harness);
  const signup = await requestSignup(harness.baseUrl, {
    invite: invite.token,
    displayName: account.displayName,
    username: account.username,
    dealershipId: account.dealershipId || "15",
    password: account.password,
    confirmPassword: account.password,
  });
  assert.equal(signup.status, 200);
  assert.match(signup.body, /Account created\. You can sign in now/i);

  return {
    ...account,
    cookie: await login(harness.baseUrl, account.username, account.password),
  };
}

async function getJson(harness, pathname) {
  return getJsonWithCookie(harness, harness.cookie, pathname);
}

async function getJsonWithCookie(harness, cookie, pathname) {
  const response = await fetch(`${harness.baseUrl}${pathname}`, {
    headers: { Cookie: cookie, Accept: "application/json" },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function waitForNotificationCount(harness, cookie, count) {
  const deadline = Date.now() + 3000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await getJsonWithCookie(harness, cookie, "/api/notifications");
    if (latest.unreadCount === count && latest.notifications.length === count) return latest;
    await sleep(40);
  }
  assert.fail(`Timed out waiting for ${count} notifications; latest=${JSON.stringify(latest)}`);
}

async function notificationLogForUsername(harness, username) {
  const storePath = path.join(harness.tempRoot, "notification-log.json");
  const raw = await fs.readFile(storePath, "utf8").catch(() => "{\"notifications\":[]}");
  const store = JSON.parse(raw);
  const notifications = Array.isArray(store) ? store : store.notifications;
  return Array.isArray(notifications)
    ? notifications.filter((notification) => notification.username === username)
    : [];
}

function albumUnread(gallery, albumId) {
  return Boolean(gallery.albums?.find((album) => album.id === albumId)?.unread);
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

async function writeInventoryMock(harness, cars) {
  await fs.writeFile(harness.inventoryMockFile, `${JSON.stringify({ cars }, null, 2)}\n`);
}

async function putJsonWithCookie(harness, cookie, pathname, body) {
  const response = await fetch(`${harness.baseUrl}${pathname}`, {
    method: "PUT",
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

async function readMarketplaceDescriptionDbStore(harness, albumId) {
  const db = await openMarketplaceDescriptionTestDb(harness);
  try {
    const row = db.prepare(`
      SELECT store_json
      FROM marketplace_description_stores
      WHERE album_id = ?
    `).get(albumId);
    assert.ok(row?.store_json, `Missing marketplace description DB row for ${albumId}`);
    return JSON.parse(row.store_json);
  } finally {
    if (typeof db.close === "function") db.close();
  }
}

async function writeMarketplaceDescriptionDbStore(harness, albumId, store) {
  const db = await openMarketplaceDescriptionTestDb(harness);
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO marketplace_description_stores (
        album_id,
        mode,
        prompt_version,
        input_hash,
        store_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(album_id) DO UPDATE SET
        mode = excluded.mode,
        prompt_version = excluded.prompt_version,
        input_hash = excluded.input_hash,
        store_json = excluded.store_json,
        updated_at = excluded.updated_at
    `).run(
      albumId,
      String(store?.mode || ""),
      String(store?.promptVersion || ""),
      String(store?.inputHash || ""),
      JSON.stringify(store),
      now,
      now,
    );
  } finally {
    if (typeof db.close === "function") db.close();
  }
}

async function openMarketplaceDescriptionTestDb(harness) {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(path.join(path.dirname(harness.uploadRoot), "marketplace-descriptions.sqlite"));
}

async function readAuditLog(harness) {
  try {
    const store = JSON.parse(await fs.readFile(path.join(harness.tempRoot, "audit-log.json"), "utf8"));
    return Array.isArray(store.events) ? store.events : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function assertAuditEvent(events, kind, predicate = () => true) {
  const event = events.find((candidate) => candidate.kind === kind && predicate(candidate));
  assert.ok(event, `Missing audit event ${kind}`);
  assert.match(event.id, /^audit-/);
  assert.match(event.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  return event;
}

async function openChatCollector(harness, cookie) {
  return openSseCollector(harness, cookie, "/api/chat/stream", "chat messages");
}

async function openAlbumCollector(harness, cookie) {
  return openSseCollector(harness, cookie, "/api/albums/stream", "album events");
}

async function openSseCollector(harness, cookie, pathname, label) {
  const controller = new AbortController();
  const response = await fetch(`${harness.baseUrl}${pathname}`, {
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
      throw new Error(`Timed out waiting for ${count} ${label}; received ${messages.length}.`);
    },
    async close() {
      controller.abort();
      await reader.cancel().catch(() => {});
      await done.catch(() => {});
    },
  };
}

async function deleteJson(harness, pathname, body) {
  return deleteJsonWithCookie(harness, harness.cookie, pathname, body);
}

async function deleteJsonWithCookie(harness, cookie, pathname, body) {
  const response = await fetch(`${harness.baseUrl}${pathname}`, {
    method: "DELETE",
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

function assertNoStoreHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("expires"), "0");
}

function assertSecurityHeaders(response) {
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy") || "", /form-action 'self'/);
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
    response,
    body: await response.json(),
  };
}

async function uploadPhotos(harness, { dealershipId, inventoryTypeId, vin, inventoryKey, photos }) {
  return uploadPhotosWithCookie(harness, harness.cookie, { dealershipId, inventoryTypeId, vin, inventoryKey, photos });
}

async function uploadChatAttachments(harness, { text = "", attachments = [] }) {
  const form = new FormData();
  if (text) form.set("text", text);
  for (const attachment of attachments) {
    form.append("attachments", new Blob([attachment.body], { type: attachment.type }), attachment.filename);
  }

  const response = await fetch(`${harness.baseUrl}/api/chat/messages`, {
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

function jpegBytes(_label) {
  return Buffer.from(TEST_JPEG_BYTES);
}

function pngBytes(_label) {
  return Buffer.from(TEST_PNG_BYTES);
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

function mp3Bytes(label) {
  return Buffer.concat([
    Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "binary"),
    Buffer.from(label),
  ]);
}

function zipEntryText(buffer, entryName) {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(eocdOffset, -1, "ZIP end-of-central-directory record was not found");
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  for (let offset = centralDirectoryOffset; offset < centralDirectoryEnd;) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "Invalid ZIP central-directory header");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (name === entryName) {
      assert.equal(buffer.readUInt32LE(localHeaderOffset), 0x04034b50, "Invalid ZIP local-file header");
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return compressed.toString("utf8");
      if (method === 8) return zlib.inflateRawSync(compressed).toString("utf8");
      throw new Error(`Unsupported ZIP compression method ${method} for ${entryName}`);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP entry not found: ${entryName}`);
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
