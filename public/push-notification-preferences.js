export const pushNotificationPreferenceOptions = Object.freeze([
  Object.freeze({
    key: "chatMessages",
    label: "Chat messages",
    description: "Team chat messages and attachments.",
  }),
  Object.freeze({
    key: "chatReactions",
    label: "Chat reactions",
    description: "Reactions teammates add to chat messages.",
  }),
  Object.freeze({
    key: "mediaUploads",
    label: "Media uploads",
    description: "New vehicle photo and video packages.",
  }),
  Object.freeze({
    key: "newInventory",
    label: "New inventory",
    description: "New O'Regan's vehicles added to tracked lots.",
  }),
  Object.freeze({
    key: "priceChanges",
    label: "Price changes",
    description: "O'Regan's inventory price changes.",
  }),
  Object.freeze({
    key: "system",
    label: "System alerts",
    description: "Push test and account-level service alerts.",
  }),
]);

export const pushNotificationPreferenceKeys = Object.freeze(
  pushNotificationPreferenceOptions.map((option) => option.key),
);

const pushNotificationPreferenceKeySet = new Set(pushNotificationPreferenceKeys);

export function defaultPushNotificationPreferences() {
  return Object.fromEntries(pushNotificationPreferenceKeys.map((key) => [key, true]));
}

export function normalizePushNotificationPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = defaultPushNotificationPreferences();
  for (const key of pushNotificationPreferenceKeys) {
    if (Object.hasOwn(source, key)) normalized[key] = source[key] !== false;
  }
  return normalized;
}

export function isPushNotificationPreferenceKey(value) {
  return pushNotificationPreferenceKeySet.has(value);
}

export function pushNotificationPreferenceKeyForPayload(payload = {}) {
  const tokens = [
    payload.notificationType,
    payload.type,
    payload.route,
    payload.kind,
  ].map((value) => normalizePushNotificationToken(value));

  if (tokens.includes("chat_reaction")) return "chatReactions";
  if (tokens.includes("chat")) return "chatMessages";
  if (tokens.includes("media_upload") || tokens.includes("media_gallery") || tokens.includes("upload")) return "mediaUploads";
  if (tokens.includes("inventory_added")) return "newInventory";
  if (tokens.includes("price_change")) return "priceChanges";
  return "system";
}

function normalizePushNotificationToken(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}
