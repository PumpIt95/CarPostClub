import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPushNotificationPreferences,
  isPushNotificationPreferenceKey,
  normalizePushNotificationPreferences,
  pushNotificationPreferenceKeyForPayload,
  pushNotificationPreferenceKeys,
  pushNotificationPreferenceOptions,
} from "../public/push-notification-preferences.js";

const expectedPreferenceKeys = [
  "chatMessages",
  "chatReactions",
  "mediaUploads",
  "newInventory",
  "priceChanges",
  "system",
];

test("push notification preference options define the user-facing contract", () => {
  assert.deepEqual(pushNotificationPreferenceKeys, expectedPreferenceKeys);
  assert.deepEqual(pushNotificationPreferenceOptions.map((option) => option.key), expectedPreferenceKeys);
  assert.ok(pushNotificationPreferenceOptions.every((option) => option.label && option.description));
});

test("push notification preferences default to enabled and normalize partial stores", () => {
  assert.deepEqual(defaultPushNotificationPreferences(), {
    chatMessages: true,
    chatReactions: true,
    mediaUploads: true,
    newInventory: true,
    priceChanges: true,
    system: true,
  });

  assert.deepEqual(normalizePushNotificationPreferences({
    chatMessages: false,
    chatReactions: 0,
    mediaUploads: null,
    newInventory: true,
    priceChanges: "",
    unknown: false,
  }), {
    chatMessages: false,
    chatReactions: true,
    mediaUploads: true,
    newInventory: true,
    priceChanges: true,
    system: true,
  });
});

test("push notification preference keys reject unknown settings", () => {
  assert.equal(isPushNotificationPreferenceKey("chatMessages"), true);
  assert.equal(isPushNotificationPreferenceKey("system"), true);
  assert.equal(isPushNotificationPreferenceKey(""), false);
  assert.equal(isPushNotificationPreferenceKey("preview"), false);
});

test("push notification payloads map to preference buckets", () => {
  assert.equal(pushNotificationPreferenceKeyForPayload({ notificationType: "chat_reaction" }), "chatReactions");
  assert.equal(pushNotificationPreferenceKeyForPayload({ kind: "chat" }), "chatMessages");
  assert.equal(pushNotificationPreferenceKeyForPayload({ type: "media_upload" }), "mediaUploads");
  assert.equal(pushNotificationPreferenceKeyForPayload({ route: "media gallery" }), "mediaUploads");
  assert.equal(pushNotificationPreferenceKeyForPayload({ notificationType: "inventory added" }), "newInventory");
  assert.equal(pushNotificationPreferenceKeyForPayload({ type: "price_change" }), "priceChanges");
  assert.equal(pushNotificationPreferenceKeyForPayload({ title: "Push notifications are ready." }), "system");
});
