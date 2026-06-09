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
  assert.doesNotMatch(description, /\b(?:Message me|Send me a message)\b/i);
  assert.ok((description.match(/automatic transmission/gi) || []).length <= 1);
  assert.ok((description.match(/gasoline/gi) || []).length <= 1);
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

    const unauthenticated = await fetchJson(`${harness.baseUrl}/api/inventory/dealerships`, {
      redirect: "manual",
    });
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.body.error, /Authentication required/i);

    const loginPage = await fetch(`${harness.baseUrl}/login`, { redirect: "manual" });
    assert.equal(loginPage.status, 200);
    assertNoStoreHeaders(loginPage);

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

    const missingDealershipSignup = await requestSignup(harness.baseUrl, {
      invite: invite.token,
      displayName: NEW_DISPLAY_NAME,
      username: NEW_USERNAME,
      dealershipId: "",
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(missingDealershipSignup.status, 400);
    assert.match(missingDealershipSignup.body, /Choose Kia, VW, GM, or Nissan/i);

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
    assert.match(passwordPageText, /\/styles\.css\?v=20260609-inventory-lifecycle-v56/);
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
    assert.deepEqual(dealerships.dealerships, [
      { id: "3", name: "O'Regan's Infiniti/Nissan Halifax", logoUrl: "/dealership-logos/3-nissan.webp" },
      { id: "15", name: "O'Regan's Kia Halifax", logoUrl: "/dealership-logos/15-kia.webp" },
      { id: "18", name: "O'Regan's Chevrolet Buick GMC Cadillac", logoUrl: "/dealership-logos/18-gm.webp" },
      { id: "31", name: "O'Regan's Volkswagen Halifax", logoUrl: "/dealership-logos/31-volkswagen.webp" },
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
    assert.match(manualUpload.body.album.storage.prefix, /^inventory\/15\/used-vehicles\/mnl123-manual-/);
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
    assert.equal(uploaded.body.album.storage.prefix, TEST_OBJECT_STORAGE_PREFIX);
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
    assert.equal(persistedMarketplaceCopy.variants.length, 6);
    await assert.rejects(fs.readFile(marketplaceCopyConflictPath, "utf8"), { code: "EISDIR" });
    await fs.rm(marketplaceCopyConflictPath, { recursive: true, force: true });
    assert.equal(uploaded.body.marketplaceDraft.descriptionSource, "template-upload");
    assert.match(uploaded.body.marketplaceDraft.description, /O'Regan's Kia Halifax/);
    assert.match(uploaded.body.marketplaceDraft.description, /ask for Konner/i);
    assert.match(uploaded.body.marketplaceDraft.description, /2026 Kia Seltos/);
    assert.match(uploaded.body.marketplaceDraft.description, /X-Line AWD/);
    assert.match(uploaded.body.marketplaceDraft.description, /finished in White/i);
    assert.match(uploaded.body.marketplaceDraft.description, /Black interior/);
    assert.match(uploaded.body.marketplaceDraft.description, /Price:\s*\$30,990/);
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
    assert.match(staleAlbumMarketplaceDraft.draft.description, /O'Regan's Kia Halifax/);
    assert.match(staleAlbumMarketplaceDraft.draft.description, /ask for Konner/i);
    assertCleanMarketplaceDescription(staleAlbumMarketplaceDraft.draft.description);
    const refreshedMarketplaceCopy = await readMarketplaceDescriptionDbStore(harness, TEST_ALBUM_ID);
    assert.notEqual(refreshedMarketplaceCopy.promptVersion, "facebook-marketplace-user-description-v1");
    assert.equal(refreshedMarketplaceCopy.mode, "upload_pool");

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
    assert.match(photoTechMarketplaceDraft.body.draft.description, /O'Regan's Kia Halifax/);
    assert.match(photoTechMarketplaceDraft.body.draft.description, /ask for Photo Tech/i);
    assert.match(photoTechMarketplaceDraft.body.draft.copyText, /Ask for: Photo Tech/);
    assertCleanMarketplaceDescription(photoTechMarketplaceDraft.body.draft.description);

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
    const testAlbum = albums.albums.find((album) => album.vehicle.vin === TEST_CAR.vin);
    const savedManualAlbum = albums.albums.find((album) => album.vehicle.inventoryKey === manualCreated.body.car.inventoryKey);
    assert.ok(testAlbum);
    assert.ok(savedManualAlbum);
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
    assert.match(photoTechDescriptionText, /Ask for: Photo Tech/);
    const photoTechDescriptionBody = marketplaceDocumentDescriptionBody(photoTechDescriptionText);
    assert.match(photoTechDescriptionBody, /ask for Photo Tech/i);
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
      assert.match(lateDescriptionText, new RegExp(`Ask for: ${lateUser.displayName}`));
      const lateDescriptionBody = marketplaceDocumentDescriptionBody(lateDescriptionText);
      assert.match(lateDescriptionBody, new RegExp(`ask for ${lateUser.displayName}`, "i"));
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
    assert.match(reuploaded.body.marketplaceDraft.description, /O'Regan's Kia Halifax/);
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
  const harness = await startTestServer();

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
    assert.equal(body.invite.signupUrl, `${harness.baseUrl}/signup?invite=${body.invite.id}`);
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
      assert.match(event.body, /1 file added for U6247A/);
      assert.equal(event.url, `/?dealershipId=15&inventoryTypeId=2&inventoryKey=${TEST_CAR.vin}&openAlbum=1`);
    }

    const adminGallery = await getJsonWithCookie(harness, harness.cookie, "/api/albums");
    assert.equal(albumUnread(adminGallery, TEST_ALBUM_ID), false);
    assert.equal(adminGallery.unreadTotal, 0);

    const firstGallery = await getJsonWithCookie(harness, firstViewer.cookie, "/api/albums");
    const secondGallery = await getJsonWithCookie(harness, secondViewer.cookie, "/api/albums");
    assert.equal(albumUnread(firstGallery, TEST_ALBUM_ID), true);
    assert.equal(albumUnread(secondGallery, TEST_ALBUM_ID), true);
    assert.equal(firstGallery.unreadTotal, 1);
    assert.equal(secondGallery.unreadTotal, 1);

    const firstRead = await postJsonWithCookie(harness, firstViewer.cookie, "/api/gallery/dealerships/15/seen", {});
    assert.equal(firstRead.status, 200);
    assert.equal(firstRead.body.marked, 1);
    assert.equal(albumUnread(firstRead.body, TEST_ALBUM_ID), false);
    assert.equal(firstRead.body.unreadTotal, 0);

    const firstAfterRead = await getJsonWithCookie(harness, firstViewer.cookie, "/api/albums");
    const secondAfterFirstRead = await getJsonWithCookie(harness, secondViewer.cookie, "/api/albums");
    assert.equal(albumUnread(firstAfterRead, TEST_ALBUM_ID), false);
    assert.equal(albumUnread(secondAfterFirstRead, TEST_ALBUM_ID), true);
    assert.equal(secondAfterFirstRead.unreadTotal, 1);

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
