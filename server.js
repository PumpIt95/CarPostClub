import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ZipArchive } from "archiver";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import express from "express";
import heicConvert from "heic-convert";
import multer from "multer";
import OpenAI from "openai";
import sharp from "sharp";
import webPush from "web-push";
import {
  normalizePushNotificationPreferences,
  pushNotificationPreferenceKeyForPayload,
} from "./public/push-notification-preferences.js";
import { inventorySnapshotScheduleAt } from "./inventory-snapshot-schedule.js";
import { pruneInventorySnapshotHistory } from "./scripts/inventory_snapshot_retention.mjs";

const appRoot = fileURLToPath(new URL("./", import.meta.url));
const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
const appName = "CarPostClub";
const serviceName = "carpostclub";

dotenv.config({ path: path.join(appRoot, ".env"), quiet: true });
dotenv.config({ quiet: true });

const app = express();
const nodeEnv = process.env.NODE_ENV || "development";
const port = Number(process.env.PORT || 3911);
const host = process.env.HOST || "127.0.0.1";
const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || "/var/lib/carpostclub/uploads");
const tmpRoot = path.resolve(process.env.TMP_ROOT || "/var/lib/carpostclub/tmp");
const marketplaceDescriptionsDbPath = path.resolve(process.env.CARPOSTCLUB_MARKETPLACE_DESCRIPTIONS_DB_PATH
  || process.env.MARKETPLACE_DESCRIPTIONS_DB_PATH
  || path.join(path.dirname(uploadRoot), "marketplace-descriptions.sqlite"));
const oregansInventorySnapshotsDbPath = path.resolve(process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOTS_DB_PATH
  || process.env.OREGANS_INVENTORY_SNAPSHOTS_DB_PATH
  || path.join(path.dirname(uploadRoot), "oregans-inventory-snapshots.sqlite"));
const objectStorageBucket = process.env.CARPOSTCLUB_S3_BUCKET || process.env.HETZNER_OBJECT_STORAGE_BUCKET || "";
const objectStorageRegion = process.env.CARPOSTCLUB_S3_REGION || process.env.HETZNER_OBJECT_STORAGE_REGION || "fsn1";
const objectStorageEndpoint = process.env.CARPOSTCLUB_S3_ENDPOINT
  || process.env.HETZNER_OBJECT_STORAGE_ENDPOINT
  || (objectStorageBucket ? `https://${objectStorageRegion}.your-objectstorage.com` : "");
const objectStorageAccessKeyId = process.env.CARPOSTCLUB_S3_ACCESS_KEY_ID
  || process.env.HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID
  || process.env.AWS_ACCESS_KEY_ID
  || "";
const objectStorageSecretAccessKey = process.env.CARPOSTCLUB_S3_SECRET_ACCESS_KEY
  || process.env.HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY
  || process.env.AWS_SECRET_ACCESS_KEY
  || "";
const objectStoragePrefix = normalizeObjectStoragePrefix(process.env.CARPOSTCLUB_S3_PREFIX || process.env.HETZNER_OBJECT_STORAGE_PREFIX || "");
const requestedMediaStorageDriver = String(process.env.CARPOSTCLUB_MEDIA_STORAGE_DRIVER || process.env.MEDIA_STORAGE_DRIVER || "").trim().toLowerCase();
const mediaStorageDriver = requestedMediaStorageDriver || (objectStorageBucket ? "s3" : "local");
if (!["local", "s3"].includes(mediaStorageDriver)) {
  throw new Error(`Unsupported media storage driver: ${mediaStorageDriver}`);
}
if (mediaStorageDriver === "s3" && (!objectStorageBucket || !objectStorageEndpoint || !objectStorageAccessKeyId || !objectStorageSecretAccessKey)) {
  throw new Error("S3 media storage requires bucket, endpoint, access key ID, and secret access key.");
}
const s3MediaStorageEnabled = mediaStorageDriver === "s3";
const s3MediaClient = s3MediaStorageEnabled
  ? new S3Client({
    region: objectStorageRegion,
    endpoint: objectStorageEndpoint,
    forcePathStyle: parseBooleanEnv("CARPOSTCLUB_S3_FORCE_PATH_STYLE", parseBooleanEnv("HETZNER_OBJECT_STORAGE_FORCE_PATH_STYLE", false)),
    credentials: {
      accessKeyId: objectStorageAccessKeyId,
      secretAccessKey: objectStorageSecretAccessKey,
    },
  })
  : null;
const chatMessagesPath = path.resolve(process.env.CHAT_MESSAGES_PATH || path.join(path.dirname(uploadRoot), "chat-messages.json"));
const chatReadStatePath = path.resolve(process.env.CARPOSTCLUB_CHAT_READ_STATE_PATH || process.env.KONNER_CHAT_READ_STATE_PATH || process.env.CHAT_READ_STATE_PATH || path.join(path.dirname(uploadRoot), "chat-read-state.json"));
const chatMediaRoot = path.resolve(process.env.CARPOSTCLUB_CHAT_MEDIA_ROOT || process.env.KONNER_CHAT_MEDIA_ROOT || path.join(path.dirname(uploadRoot), "chat-media"));
const userPreferencesPath = path.resolve(process.env.CARPOSTCLUB_USER_PREFERENCES_PATH || process.env.KONNER_USER_PREFERENCES_PATH || process.env.USER_PREFERENCES_PATH || path.join(path.dirname(uploadRoot), "user-preferences.json"));
const manualInventoryPath = path.resolve(process.env.MANUAL_INVENTORY_PATH || path.join(path.dirname(uploadRoot), "manual-inventory.json"));
const albumSeenPath = path.resolve(process.env.CARPOSTCLUB_ALBUM_SEEN_PATH || process.env.KONNER_ALBUM_SEEN_PATH || process.env.ALBUM_SEEN_PATH || path.join(path.dirname(uploadRoot), "album-seen.json"));
const pushSubscriptionsPath = path.resolve(process.env.CARPOSTCLUB_PUSH_SUBSCRIPTIONS_PATH || process.env.KONNER_PUSH_SUBSCRIPTIONS_PATH || process.env.PUSH_SUBSCRIPTIONS_PATH || path.join(path.dirname(uploadRoot), "push-subscriptions.json"));
const pushVapidKeysPath = path.resolve(process.env.CARPOSTCLUB_PUSH_VAPID_KEYS_PATH || process.env.KONNER_PUSH_VAPID_KEYS_PATH || process.env.PUSH_VAPID_KEYS_PATH || path.join(path.dirname(uploadRoot), "push-vapid-keys.json"));
const notificationLogPath = path.resolve(process.env.CARPOSTCLUB_NOTIFICATION_LOG_PATH || process.env.KONNER_NOTIFICATION_LOG_PATH || process.env.NOTIFICATION_LOG_PATH || path.join(path.dirname(uploadRoot), "notification-log.json"));
const inventoryLifecyclePath = path.resolve(process.env.CARPOSTCLUB_INVENTORY_LIFECYCLE_PATH || process.env.KONNER_INVENTORY_LIFECYCLE_PATH || process.env.INVENTORY_LIFECYCLE_PATH || path.join(path.dirname(uploadRoot), "inventory-lifecycle.json"));
const auditLogPath = path.resolve(process.env.CARPOSTCLUB_AUDIT_LOG_PATH || process.env.KONNER_AUDIT_LOG_PATH || process.env.AUDIT_LOG_PATH || path.join(path.dirname(uploadRoot), "audit-log.json"));
const releaseManifestPath = process.env.CARPOSTCLUB_RELEASE_MANIFEST || process.env.KONNER_RELEASE_MANIFEST || path.join(appRoot, "release-manifest.json");
const publicOrigin = normalizePublicOrigin(process.env.CARPOSTCLUB_PUBLIC_ORIGIN || process.env.KONNER_PUBLIC_ORIGIN || "");
const maxFileBytes = positiveInteger(process.env.MAX_FILE_BYTES, 250 * 1024 * 1024);
const maxUploadFiles = positiveInteger(process.env.MAX_UPLOAD_FILES, 100);
const facebookMinimumPhotoCount = positiveInteger(process.env.CARPOSTCLUB_FACEBOOK_MIN_PHOTO_COUNT, 5);
const chatMessageLimit = positiveInteger(process.env.CHAT_MESSAGE_LIMIT, 500);
const chatResponseLimit = Math.min(chatMessageLimit, positiveInteger(process.env.CHAT_RESPONSE_LIMIT, 100));
const chatMessageMaxLength = positiveInteger(process.env.CHAT_MESSAGE_MAX_LENGTH, 1000);
const chatAttachmentLimit = Math.min(maxUploadFiles, positiveInteger(process.env.CARPOSTCLUB_CHAT_ATTACHMENT_LIMIT || process.env.KONNER_CHAT_ATTACHMENT_LIMIT, 4));
const chatReactionTypes = ["laugh", "heart", "thumbs_up", "thumbs_down"];
const chatGifSearchLimit = Math.min(24, positiveInteger(process.env.CARPOSTCLUB_GIPHY_LIMIT || process.env.GIPHY_LIMIT, 12));
const giphyApiKey = normalizeSpace(process.env.CARPOSTCLUB_GIPHY_API_KEY || process.env.GIPHY_API_KEY || "");
const giphyRating = normalizeSpace(process.env.CARPOSTCLUB_GIPHY_RATING || process.env.GIPHY_RATING || "pg-13").slice(0, 12) || "pg-13";
const marketplaceDescriptionModel = process.env.FACEBOOK_MARKETPLACE_DESCRIPTION_MODEL || "gpt-5-nano";
const marketplaceDescriptionFallbackModel = process.env.FACEBOOK_MARKETPLACE_DESCRIPTION_FALLBACK_MODEL || "gpt-4.1-nano";
const marketplaceDescriptionVariantCount = positiveInteger(process.env.FACEBOOK_MARKETPLACE_DESCRIPTION_VARIANT_COUNT, 6);
const marketplaceDescriptionPromptVersion = "facebook_marketplace_description_v4_fee_699";
const marketplaceLocation = process.env.FACEBOOK_MARKETPLACE_LOCATION || "Halifax, Nova Scotia";
const marketplacePostalCode = normalizeMarketplacePostalCode(process.env.FACEBOOK_MARKETPLACE_POSTAL_CODE) || "B3K4P9";
const marketplaceCleanTitleDefault = parseBooleanEnv("FACEBOOK_MARKETPLACE_CLEAN_TITLE_DEFAULT", true);
const marketplacePriceDisclosureFee = 699.95;
const marketplacePriceDisclosureHst = 14;
const marketplaceContactPerson = normalizeSpace(process.env.FACEBOOK_MARKETPLACE_CONTACT_NAME || "Konner") || "Konner";
const marketplaceLeadControlClosingPhrase = "(please message for more details)";
const facebookListingVerificationTtlMs = positiveInteger(process.env.CARPOSTCLUB_FACEBOOK_LISTING_VERIFICATION_TTL_MS, 4 * 60 * 60 * 1000);
const pushSubject = process.env.CARPOSTCLUB_PUSH_SUBJECT || process.env.KONNER_PUSH_SUBJECT || process.env.WEB_PUSH_SUBJECT || "mailto:hello@carpostclub.local";
const pushTtlSeconds = positiveInteger(process.env.CARPOSTCLUB_PUSH_TTL_SECONDS || process.env.KONNER_PUSH_TTL_SECONDS, 60 * 60);
const pushDeliveryDisabled = parseBooleanEnv("CARPOSTCLUB_PUSH_DELIVERY_DISABLED", parseBooleanEnv("KONNER_PUSH_DELIVERY_DISABLED", false));
const pushAwaitDelivery = parseBooleanEnv("CARPOSTCLUB_PUSH_AWAIT_DELIVERY", parseBooleanEnv("KONNER_PUSH_AWAIT_DELIVERY", process.env.NODE_ENV === "test"));
const inventoryAddedPushSpacingMs = Math.min(10_000, nonNegativeInteger(
  process.env.CARPOSTCLUB_INVENTORY_ADDED_PUSH_SPACING_MS
    || process.env.KONNER_INVENTORY_ADDED_PUSH_SPACING_MS,
  process.env.NODE_ENV === "test" ? 0 : 1500,
));
const inventoryReappearPushCooldownMs = nonNegativeInteger(
  process.env.CARPOSTCLUB_INVENTORY_REAPPEAR_PUSH_COOLDOWN_MS
    || process.env.KONNER_INVENTORY_REAPPEAR_PUSH_COOLDOWN_MS,
  24 * 60 * 60 * 1000,
);
const inventoryRemovalGraceMs = nonNegativeInteger(
  process.env.CARPOSTCLUB_OREGANS_INVENTORY_REMOVAL_GRACE_MS
    || process.env.OREGANS_INVENTORY_REMOVAL_GRACE_MS,
  48 * 60 * 60 * 1000,
);
const previewPushEnabled = nodeEnv !== "production" || parseBooleanEnv("CARPOSTCLUB_INTERNAL_PREVIEW_PUSH_ENABLED", false);
const notificationLogLimitPerUser = positiveInteger(process.env.CARPOSTCLUB_NOTIFICATION_LOG_LIMIT_PER_USER || process.env.KONNER_NOTIFICATION_LOG_LIMIT_PER_USER, 200);
const auditLogLimit = positiveInteger(process.env.CARPOSTCLUB_AUDIT_LOG_LIMIT || process.env.KONNER_AUDIT_LOG_LIMIT || process.env.AUDIT_LOG_LIMIT, 1000);
const authUsername = process.env.CARPOSTCLUB_AUTH_USERNAME || process.env.KONNER_AUTH_USERNAME || "admin";
const authPassword = process.env.CARPOSTCLUB_AUTH_PASSWORD || process.env.KONNER_AUTH_PASSWORD || "";
const authPasswordHash = process.env.CARPOSTCLUB_AUTH_PASSWORD_HASH || process.env.KONNER_AUTH_PASSWORD_HASH || "";
const authEnabled = Boolean(authPassword || authPasswordHash);
const authDisabled = !authEnabled;
const authDisabledAllowed = parseBooleanEnv("CARPOSTCLUB_AUTH_DISABLED", parseBooleanEnv("KONNER_AUTH_DISABLED", false));
if (authDisabled && nodeEnv === "production" && !authDisabledAllowed) {
  throw new Error("Authentication is not configured. Set CARPOSTCLUB_AUTH_PASSWORD_HASH or explicitly set CARPOSTCLUB_AUTH_DISABLED=true.");
}
if (nodeEnv === "production" && authEnabled && !configuredAuthSessionSecret()) {
  throw new Error("Production session secret is not configured. Set CARPOSTCLUB_AUTH_SESSION_SECRET before deploying.");
}
if (nodeEnv === "production" && authPassword && !authPasswordHash && isPlaceholderSecret(authPassword)) {
  throw new Error("Production authentication password is still a placeholder. Set CARPOSTCLUB_AUTH_PASSWORD_HASH before deploying.");
}
if (nodeEnv === "production" && isPlaceholderSecret(configuredAuthSessionSecret())) {
  throw new Error("Production session secret is still a placeholder. Set CARPOSTCLUB_AUTH_SESSION_SECRET before deploying.");
}
const authUsersPath = path.resolve(process.env.CARPOSTCLUB_AUTH_USERS_PATH || process.env.KONNER_AUTH_USERS_PATH || process.env.AUTH_USERS_PATH || path.join(path.dirname(uploadRoot), "auth-users.json"));
const authInvitesPath = path.resolve(process.env.CARPOSTCLUB_AUTH_INVITES_PATH || process.env.KONNER_AUTH_INVITES_PATH || process.env.AUTH_INVITES_PATH || path.join(path.dirname(uploadRoot), "auth-invites.json"));
const authCookieName = process.env.CARPOSTCLUB_AUTH_COOKIE_NAME || process.env.KONNER_AUTH_COOKIE_NAME || "carpostclub_session";
const authCookieSecure = parseBooleanEnv("CARPOSTCLUB_AUTH_COOKIE_SECURE", parseBooleanEnv("KONNER_AUTH_COOKIE_SECURE", process.env.NODE_ENV === "production"));
const authSessionDays = positiveInteger(process.env.CARPOSTCLUB_AUTH_SESSION_DAYS || process.env.KONNER_AUTH_SESSION_DAYS, 365);
const authSessionMs = authSessionDays * 24 * 60 * 60 * 1000;
const authInviteLifetimeHours = positiveInteger(process.env.CARPOSTCLUB_AUTH_INVITE_HOURS || process.env.KONNER_AUTH_INVITE_HOURS, 24);
const authInviteLifetimeMs = authInviteLifetimeHours * 60 * 60 * 1000;
const loginRateLimitWindowMs = positiveInteger(process.env.CARPOSTCLUB_LOGIN_RATE_LIMIT_WINDOW_MS || process.env.KONNER_LOGIN_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000);
const loginRateLimitMaxAttempts = positiveInteger(process.env.CARPOSTCLUB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS || process.env.KONNER_LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 10);
const shortcutBearerToken = normalizeSpace(process.env.CARPOSTCLUB_SHORTCUTS_BEARER_TOKEN || process.env.KONNER_SHORTCUTS_BEARER_TOKEN);
const authSessionSecret = sessionSecret();
const releaseInfo = await readReleaseInfo();
const thumbnailDirectoryName = ".thumbnails";
const thumbnailMaxWidth = positiveInteger(process.env.THUMBNAIL_MAX_WIDTH, 640);
const thumbnailMaxHeight = positiveInteger(process.env.THUMBNAIL_MAX_HEIGHT, 480);

const imageExtensions = new Set([
  ".avif",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);
const videoExtensions = new Set([
  ".m4v",
  ".mov",
  ".mp4",
  ".ogv",
  ".webm",
]);
const audioExtensions = new Set([
  ".3g2",
  ".3ga",
  ".3gp",
  ".aac",
  ".ac3",
  ".aif",
  ".aifc",
  ".aiff",
  ".amr",
  ".ape",
  ".au",
  ".caf",
  ".dts",
  ".flac",
  ".m4a",
  ".m4b",
  ".m4p",
  ".mid",
  ".midi",
  ".mka",
  ".mp2",
  ".mp3",
  ".oga",
  ".ogg",
  ".opus",
  ".ra",
  ".ram",
  ".wav",
  ".weba",
  ".wma",
]);
const sharpImageFormatsByExtension = new Map([
  [".avif", new Set(["avif"])],
  [".gif", new Set(["gif"])],
  [".jpeg", new Set(["jpeg"])],
  [".jpg", new Set(["jpeg"])],
  [".png", new Set(["png"])],
  [".tif", new Set(["tiff"])],
  [".tiff", new Set(["tiff"])],
  [".webp", new Set(["webp"])],
]);
const legacyStorageDirectories = new Set(["optimized", "originals", "thumbnails", "tmp"]);
const oregansInventorySearchApiUrl = "https://oserv3.oreganscdn.com/api/vehicle-inventory-search/";
const oregansInventoryRegionId = "1";
const defaultInventoryTypeId = "2";
const shortcutDefaultDealershipId = process.env.CARPOSTCLUB_SHORTCUT_DEFAULT_DEALERSHIP_ID || "15";
const inventoryCacheTtlMs = positiveInteger(process.env.OREGANS_INVENTORY_CACHE_TTL_MS, 5 * 60 * 1000);
const inventoryMockFile = process.env.OREGANS_INVENTORY_MOCK_FILE || "";
const oregansInventorySnapshotIntervalMs = positiveInteger(
  process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_INTERVAL_MS
    || process.env.OREGANS_INVENTORY_SNAPSHOT_INTERVAL_MS,
  60 * 60 * 1000,
);
const oregansInventorySnapshotOffHoursIntervalMs = positiveInteger(
  process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_OFF_HOURS_INTERVAL_MS
    || process.env.OREGANS_INVENTORY_SNAPSHOT_OFF_HOURS_INTERVAL_MS,
  oregansInventorySnapshotIntervalMs,
);
const oregansInventorySnapshotOffHoursEnabled = parseBooleanEnv(
  "CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_OFF_HOURS_ENABLED",
  parseBooleanEnv("OREGANS_INVENTORY_SNAPSHOT_OFF_HOURS_ENABLED", true),
);
const oregansInventorySnapshotDayStartHour = boundedInteger(
  process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_DAY_START_HOUR
    || process.env.OREGANS_INVENTORY_SNAPSHOT_DAY_START_HOUR,
  0,
  0,
  23,
);
const oregansInventorySnapshotDayEndHour = boundedInteger(
  process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_DAY_END_HOUR
    || process.env.OREGANS_INVENTORY_SNAPSHOT_DAY_END_HOUR,
  24,
  0,
  24,
);
const oregansInventorySnapshotInitialDelayMs = positiveInteger(
  process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_INITIAL_DELAY_MS
    || process.env.OREGANS_INVENTORY_SNAPSHOT_INITIAL_DELAY_MS,
  30_000,
);
const oregansInventorySnapshotRetentionDays = nonNegativeInteger(
  process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_RETENTION_DAYS
    || process.env.OREGANS_INVENTORY_SNAPSHOT_RETENTION_DAYS,
  14,
);
const oregansInventorySnapshotPruneIntervalMs = positiveInteger(
  process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_PRUNE_INTERVAL_MS
    || process.env.OREGANS_INVENTORY_SNAPSHOT_PRUNE_INTERVAL_MS,
  6 * 60 * 60 * 1000,
);
const oregansInventorySnapshotEnabled = parseBooleanEnv("CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_ENABLED",
  parseBooleanEnv("OREGANS_INVENTORY_SNAPSHOT_ENABLED", !inventoryMockFile));
const oregansInventorySnapshotTimeZone = process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_TIME_ZONE
  || process.env.OREGANS_INVENTORY_SNAPSHOT_TIME_ZONE
  || "America/Halifax";
const inventoryTypes = Object.freeze([
  { id: "2", name: "Used vehicles" },
  { id: "1", name: "New vehicles" },
]);
const oregansBodyStyleGroups = Object.freeze([
  { id: "1", name: "Sedan" },
  { id: "2", name: "Coupe" },
  { id: "3", name: "Wagon / Cross-Over" },
  { id: "4", name: "Hatchback" },
  { id: "5", name: "Convertible" },
  { id: "6", name: "SUV" },
  { id: "7", name: "Minivan" },
  { id: "8", name: "Truck" },
  { id: "10", name: "Commercial" },
  { id: "11", name: "Motorbike" },
  { id: "12", name: "ATV" },
  { id: "13", name: "RV" },
]);
const oregansDealerships = Object.freeze([
  { id: "1", name: "O'Regan's Mercedes-Benz" },
  { id: "2", name: "O'Regan's GreenLight Halifax", logoUrl: "/dealership-logos/2-greenlight.webp" },
  { id: "3", name: "O'Regan's Infiniti/Nissan Halifax", logoUrl: "/dealership-logos/3-nissan.webp" },
  { id: "6", name: "O'Regan's Kia Dartmouth" },
  { id: "7", name: "O'Regan's Toyota Dartmouth" },
  { id: "8", name: "O'Regan's National Leasing" },
  { id: "9", name: "O'Regan's Toyota Halifax" },
  { id: "13", name: "O'Regan's Dartmouth Hyundai" },
  { id: "14", name: "O'Regan's Green Light Used Car Centre Dartmouth" },
  { id: "15", name: "O'Regan's Kia Halifax", logoUrl: "/dealership-logos/15-kia.webp" },
  { id: "16", name: "O'Regan's Wholesale Direct Dartmouth" },
  { id: "17", name: "O'Regan's Nissan Dartmouth" },
  { id: "18", name: "O'Regan's Chevrolet Buick GMC Cadillac", logoUrl: "/dealership-logos/18-gm.webp" },
  { id: "21", name: "O'Regan's Wholesale Direct Halifax" },
  { id: "28", name: "O'Regan's BMW/MINI" },
  { id: "31", name: "O'Regan's Volkswagen Halifax", logoUrl: "/dealership-logos/31-volkswagen.webp" },
  { id: "40", name: "O'Regan's Lexus" },
]);
const inventoryPicklistDealershipIds = Object.freeze(["3", "15", "18", "2"]);
const inventoryPicklistDealerships = Object.freeze(
  inventoryPicklistDealershipIds
    .map((id) => oregansDealerships.find((dealership) => dealership.id === id))
    .filter(Boolean),
);
const authDealershipOptions = Object.freeze([
  { id: "15", key: "kia", label: "Kia" },
  { id: "2", key: "greenlight", label: "GreenLight" },
  { id: "18", key: "gm", label: "GM" },
  { id: "3", key: "nissan", label: "Nissan" },
].map((option) => ({
  ...option,
  name: oregansDealerships.find((dealership) => dealership.id === option.id)?.name || option.label,
})));
const pushDryRunDealershipIds = Object.freeze(["15", "18", "3", "2"]);
const authBootstrapDealershipId = normalizeAuthDealershipId(
  process.env.CARPOSTCLUB_AUTH_DEALERSHIP_ID
    || process.env.KONNER_AUTH_DEALERSHIP_ID
    || process.env.AUTH_DEALERSHIP_ID
    || defaultAuthDealershipIdForUser({ username: authUsername }),
);
const inventoryCache = new Map();
const inventoryFetchPromises = new Map();
const failedLoginAttempts = new Map();
const chatClients = new Set();
const albumClients = new Set();
const marketplaceCopyPromises = new Map();
const marketplaceCopyStoreWritePromises = new Map();
const vehicleUploadWritePromises = new Map();
const photoMetadataWritePromises = new Map();
let marketplaceDescriptionsDb = null;
let oregansInventorySnapshotsDb = null;
let chatWritePromise = Promise.resolve();
let chatReadStateWritePromise = Promise.resolve();
let userPreferencesWritePromise = Promise.resolve();
let authUsersWritePromise = Promise.resolve();
let authInvitesWritePromise = Promise.resolve();
let manualInventoryWritePromise = Promise.resolve();
let albumSeenWritePromise = Promise.resolve();
let pushSubscriptionsWritePromise = Promise.resolve();
let notificationLogWritePromise = Promise.resolve();
let inventoryLifecycleWritePromise = Promise.resolve();
let auditLogWritePromise = Promise.resolve();
let oregansInventorySnapshotRunPromise = Promise.resolve();
let oregansInventorySnapshotPendingRuns = 0;
let oregansInventorySnapshotTimer = null;
let oregansInventorySnapshotNextRunAt = null;
let oregansInventorySnapshotLastPruneAt = 0;
let oregansInventorySnapshotLastPrune = null;
let shuttingDown = false;
let openaiClient = null;

await fs.mkdir(uploadRoot, { recursive: true });
await fs.mkdir(tmpRoot, { recursive: true });
await fs.mkdir(path.dirname(marketplaceDescriptionsDbPath), { recursive: true });
await fs.mkdir(path.dirname(oregansInventorySnapshotsDbPath), { recursive: true });
await fs.mkdir(path.dirname(chatMessagesPath), { recursive: true });
await fs.mkdir(path.dirname(chatReadStatePath), { recursive: true });
await fs.mkdir(chatMediaRoot, { recursive: true });
await fs.mkdir(path.dirname(userPreferencesPath), { recursive: true });
await fs.mkdir(path.dirname(manualInventoryPath), { recursive: true });
await fs.mkdir(path.dirname(albumSeenPath), { recursive: true });
await fs.mkdir(path.dirname(authUsersPath), { recursive: true });
await fs.mkdir(path.dirname(authInvitesPath), { recursive: true });
await fs.mkdir(path.dirname(pushSubscriptionsPath), { recursive: true });
await fs.mkdir(path.dirname(pushVapidKeysPath), { recursive: true });
await fs.mkdir(path.dirname(notificationLogPath), { recursive: true });
await fs.mkdir(path.dirname(inventoryLifecyclePath), { recursive: true });
await fs.mkdir(path.dirname(auditLogPath), { recursive: true });

marketplaceDescriptionsDb = openMarketplaceDescriptionsDatabase();
oregansInventorySnapshotsDb = openOregansInventorySnapshotsDatabase();
const pushKeys = await resolvePushVapidKeys();
webPush.setVapidDetails(pushSubject, pushKeys.publicKey, pushKeys.privateKey);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, tmpRoot),
  filename: (_req, file, callback) => {
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extensionFor(file.originalname, file.mimetype)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: maxFileBytes,
    files: maxUploadFiles,
  },
  fileFilter: (_req, file, callback) => {
    if (isMediaLike(file.originalname, file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(httpError(400, "Only image or video files can be uploaded."));
  },
});
const chatUpload = multer({
  storage,
  limits: {
    fileSize: maxFileBytes,
    files: maxUploadFiles,
  },
  fileFilter: (_req, file, callback) => {
    if (isChatAttachmentLike(file.originalname, file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(httpError(400, "Only photos, GIFs, or audio files can be attached to chat."));
  },
});

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(applySecurityHeaders);
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  if (/\.(?:css|js|webmanifest)$/i.test(req.path)) {
    res.setHeader("Cache-Control", "no-cache");
  }
  next();
});
app.use(express.static(publicRoot, { index: false, maxAge: 0 }));
app.use(rejectCrossOriginUnsafeRequests);

app.get("/healthz", (_req, res) => {
  const criticalOperations = criticalOperationSnapshot();
  res.json({
    ok: true,
    service: serviceName,
    mode: "photo-albums",
    port,
    release: releaseInfo,
    storage: {
      mediaDriver: mediaStorageDriver,
      objectStorageEnabled: s3MediaStorageEnabled,
    },
    uptimeSeconds: Math.round(process.uptime()),
    shuttingDown,
    criticalOperationCount: criticalOperations.reduce((total, operation) => total + operation.count, 0),
    criticalOperations,
  });
});

app.get("/api/version", (_req, res) => {
  res.json({
    ok: true,
    service: serviceName,
    mode: "photo-albums",
    port,
    release: releaseInfo,
    runtime: {
      node: process.version,
      env: process.env.NODE_ENV || "development",
    },
  });
});

app.get("/login", async (req, res, next) => {
  try {
    const nextPath = safeRedirectPath(req.query.next);
    if (!authEnabled || await identifyRequestUser(req)) {
      res.redirect(nextPath || "/");
      return;
    }
    sendLoginPage(res, { next: nextPath });
  } catch (error) {
    next(error);
  }
});

app.post("/login", async (req, res, next) => {
  try {
    if (!authEnabled) {
      res.redirect("/");
      return;
    }

    const nextPath = safeRedirectPath(req.body?.next);
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");
    const loginLimit = loginRateLimitForRequest(req, username);
    if (loginLimit.limited) {
      res.setHeader("Retry-After", String(loginLimit.retryAfterSeconds));
      sendLoginPage(res, {
        error: `Too many failed sign-in attempts. Try again in ${loginLimit.retryAfterSeconds} seconds.`,
        next: nextPath,
        status: 429,
      });
      return;
    }

    const authResult = await authenticateCredentials(username, password);
    if (!authResult.ok) {
      recordFailedLogin(req, username);
      sendLoginPage(res, { error: authResult.message, next: nextPath });
      return;
    }

    clearFailedLoginAttempts(req, username);
    res.setHeader("Set-Cookie", serializeSessionCookie(authResult.user));
    res.redirect(303, nextPath || "/");
  } catch (error) {
    next(error);
  }
});

app.get("/signup", async (req, res, next) => {
  try {
    if (!authEnabled) {
      res.redirect("/");
      return;
    }

    const inviteState = await authInviteState(req.query.invite);
    sendSignupPage(res, {
      invite: inviteState.invite,
      inviteToken: inviteState.token,
      error: inviteState.status === "expired" || inviteState.status === "invalid" ? inviteState.message : "",
      inviteMessage: inviteState.status === "missing" ? inviteState.message : "",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/signup", async (req, res, next) => {
  try {
    if (!authEnabled) {
      res.redirect("/");
      return;
    }

    const username = normalizeAuthUsername(req.body?.username);
    const displayName = normalizeDisplayName(req.body?.displayName) || username;
    const dealershipId = normalizeAuthDealershipId(req.body?.dealershipId || req.body?.dealership);
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const inviteState = await authInviteState(req.body?.invite);
    if (inviteState.status !== "valid") {
      sendSignupPage(res, {
        error: inviteState.message,
        inviteToken: inviteState.token,
        values: { username, displayName, dealershipId },
      });
      return;
    }

    const validationError = validateSignup({ username, dealershipId, password, confirmPassword });
    if (validationError) {
      sendSignupPage(res, {
        error: validationError,
        invite: inviteState.invite,
        inviteToken: inviteState.token,
        values: { username, displayName, dealershipId },
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const createdUser = await updateAuthUsers(async (store) => {
      if (username === normalizeAuthUsername(authUsername) || store.users.some((user) => user.username === username)) {
        return null;
      }
      const now = new Date().toISOString();
      const user = {
        username,
        displayName,
        dealershipId,
        passwordHash,
        passwordVersion: newPasswordVersion(),
        role: "user",
        status: "approved",
        createdAt: now,
        updatedAt: now,
        approvedAt: now,
        approvedBy: `invite:${inviteState.invite.id}`,
        passwordUpdatedAt: now,
        passwordUpdatedBy: username,
      };
      store.users.push(user);
      return user;
    });

    if (!createdUser) {
      sendSignupPage(res, {
        error: "That username already exists.",
        invite: inviteState.invite,
        inviteToken: inviteState.token,
        values: { username, displayName, dealershipId },
      });
      return;
    }

    await markAuthInviteUsed(inviteState.invite.id, createdUser);
    sendSignupPage(res, {
      success: "Account created. You can sign in now.",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const pushEndpoint = cleanOptionalPushEndpoint(req.body?.pushEndpoint);
    if (pushEndpoint) await removePushSubscription(pushEndpoint, req.authUser);
    setPrivateNoStore(res);
    res.setHeader("Set-Cookie", `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${authCookieSecure ? "; Secure" : ""}`);
    res.redirect(303, "/login");
  } catch (error) {
    next(error);
  }
});

app.get("/account/password", requireAuth, (req, res) => {
  sendChangePasswordPage(res, { user: req.authUser });
});

app.post("/account/password", requireAuth, async (req, res, next) => {
  try {
    if (req.authUser.bootstrap) {
      sendChangePasswordPage(res, {
        user: req.authUser,
        error: "The bootstrap admin password is managed in the server environment. Reset it there, then restart the app.",
      });
      return;
    }

    const currentPassword = String(req.body?.currentPassword || "");
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const validationError = validatePasswordFields({ password, confirmPassword });
    if (validationError) {
      sendChangePasswordPage(res, { user: req.authUser, error: validationError });
      return;
    }

    const changed = await changeStoredUserPassword(req.authUser.username, currentPassword, password);
    if (!changed) {
      sendChangePasswordPage(res, { user: req.authUser, error: "Current password is incorrect." });
      return;
    }

    await appendAuditEvent("auth.password.changed", req.authUser, {
      username: changed.username,
      displayName: changed.displayName,
    });
    res.setHeader("Set-Cookie", serializeSessionCookie(authUserFromAccount(changed)));
    sendChangePasswordPage(res, { user: req.authUser, success: "Password updated." });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const generatedInvite = await authInviteForAdmin(req.query.invite, req);
    sendAdminUsersPage(res, {
      currentUser: req.authUser,
      users: (await readAuthUsers()).users,
      invites: await listAuthInvitesForAdmin(),
      generatedInvite,
      error: flashMessage(req.query.error),
      success: flashMessage(req.query.success),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/admin/invites", requireAdmin, async (req, res, next) => {
  try {
    const invite = await createAuthInvite(req.authUser);
    await appendAuditEvent("auth.invite.created", req.authUser, {
      inviteIdHash: shortAuditHash(invite.id),
      inviteIdSuffix: auditSuffix(invite.id),
      expiresAt: invite.expiresAt,
    });
    if (requestWantsJson(req)) {
      setPrivateNoStore(res);
      res.json({
        invite: publicAuthInvite(invite, req),
        redirect: adminUsersUrl({
          invite: invite.id,
          success: "Invite link created and copied to clipboard.",
        }),
      });
      return;
    }

    res.redirect(303, adminUsersUrl({
      invite: invite.id,
      success: "Invite link created. It is valid for 24 hours.",
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/admin/users/:username/approve", requireAdmin, async (req, res, next) => {
  try {
    await setAuthUserStatus(req.params.username, "approved", req.authUser.username);
    res.redirect(303, "/admin/users");
  } catch (error) {
    next(error);
  }
});

app.post("/admin/users/:username/reject", requireAdmin, async (req, res, next) => {
  try {
    await setAuthUserStatus(req.params.username, "rejected", req.authUser.username);
    res.redirect(303, "/admin/users");
  } catch (error) {
    next(error);
  }
});

app.post("/admin/users/:username/dealership", requireAdmin, async (req, res, next) => {
  try {
    const dealershipId = normalizeAuthDealershipId(req.body?.dealershipId || req.body?.dealership);
    if (!dealershipId) {
      res.redirect(303, adminUsersUrl({ error: "Choose Kia, GreenLight, GM, or Nissan." }));
      return;
    }

    const updated = await setStoredUserDealership(req.params.username, dealershipId, req.authUser.username);
    if (!updated) {
      res.redirect(303, adminUsersUrl({ error: "User not found." }));
      return;
    }

    const dealership = publicAuthDealership(updated.dealershipId);
    res.redirect(303, adminUsersUrl({ success: `Dealership updated for ${updated.displayName} to ${dealership?.label || "selected dealership"}.` }));
  } catch (error) {
    next(error);
  }
});

app.post("/admin/users/:username/password", requireAdmin, async (req, res, next) => {
  try {
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const validationError = validatePasswordFields({ password, confirmPassword });
    if (validationError) {
      res.redirect(303, adminUsersUrl({ error: validationError }));
      return;
    }

    const updated = await setStoredUserPassword(req.params.username, password, req.authUser.username);
    if (!updated) {
      res.redirect(303, adminUsersUrl({ error: "User not found." }));
      return;
    }

    await appendAuditEvent("auth.password.reset", req.authUser, {
      username: updated.username,
      displayName: updated.displayName,
    });
    res.redirect(303, adminUsersUrl({ success: `Password reset for ${updated.displayName}.` }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/audit-log", requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(auditLogLimit, positiveInteger(req.query.limit, 100));
    const store = await readAuditLog();
    setPrivateNoStore(res);
    res.json({
      ok: true,
      count: store.events.length,
      events: store.events.slice(0, limit),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/push/dry-run", requireAdmin, async (req, res, next) => {
  try {
    const uploadUploaderUsernames = normalizeDryRunUploadUsernames(req.body || {}, req.authUser);
    const uploadSimulations = [];
    for (const uploaderUsername of uploadUploaderUsernames) {
      uploadSimulations.push(await pushDryRunUploadTargets(uploaderUsername));
    }
    const inventoryDealerships = await pushDryRunDealershipTargets();
    setPrivateNoStore(res);
    res.json({
      ok: true,
      dryRun: true,
      dealerships: inventoryDealerships,
      inventory: {
        dealerships: inventoryDealerships,
      },
      upload: {
        simulations: uploadSimulations,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/operations-summary", requireAdmin, async (req, res, next) => {
  try {
    const gallery = await listAlbumsForUser(req.authUser, { includeInventoryStatus: true });
    const summary = operationsSummaryFromAlbums(gallery.albums);
    const automationSignals = operationsAutomationSignals(gallery.albums);
    setPrivateNoStore(res);
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      ...summary,
      automationSignals,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/", requireAuth, (_req, res) => {
  setPrivateNoStore(res);
  res.sendFile(path.join(publicRoot, "index.html"));
});

app.get("/gallery", requireAuth, (_req, res) => {
  setPrivateNoStore(res);
  res.sendFile(path.join(publicRoot, "index.html"));
});

app.get("/chat", requireAuth, (_req, res) => {
  setPrivateNoStore(res);
  res.sendFile(path.join(publicRoot, "index.html"));
});

app.get("/inventory", requireAuth, (_req, res) => {
  res.redirect(302, "/");
});

app.get("/api/albums", requireAuth, async (req, res, next) => {
  try {
    const gallery = await listAlbumsForUser(req.authUser, { includeInventoryStatus: true });
    res.json({
      ok: true,
      albums: publicAlbums(gallery.albums),
      unreadTotal: gallery.unreadTotal,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/albums/stream", requireAuth, (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const client = {
    res,
    username: normalizeAuthUsername(req.authUser?.username),
  };
  let closed = false;
  const heartbeat = setInterval(() => {
    writeSseEvent(res, ": ping\n\n");
  }, 25_000);
  heartbeat.unref?.();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    albumClients.delete(client);
  };

  albumClients.add(client);
  req.on("close", cleanup);
  writeSseEvent(res, "retry: 3000\n\n");
  writeSseEvent(res, ": connected\n\n");
});

app.post("/api/gallery/dealerships/:dealershipId/seen", requireAuth, async (req, res, next) => {
  try {
    const dealership = cleanDealershipId(req.params.dealershipId);
    const gallery = await listAlbumsForUser(req.authUser, { includeInventoryStatus: true });
    res.json({
      ok: true,
      dealership,
      marked: 0,
      deprecated: true,
      albums: publicAlbums(gallery.albums),
      unreadTotal: gallery.unreadTotal,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", requireAuth, async (req, res, next) => {
  try {
    const preferenceState = await userPreferencesForUser(req.authUser);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      user: publicAuthUser(req.authUser),
      preferences: preferenceState.preferences,
      preferencesUpdatedAt: preferenceState.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/me/preferences", requireAuth, async (req, res, next) => {
  try {
    const preferenceState = await userPreferencesForUser(req.authUser);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      preferences: preferenceState.preferences,
      updatedAt: preferenceState.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/me/preferences", requireAuth, async (req, res, next) => {
  try {
    const preferenceState = await saveUserPreferences(req.authUser, req.body?.preferences || req.body);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      preferences: preferenceState.preferences,
      updatedAt: preferenceState.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/push/config", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    ok: true,
    publicKey: pushKeys.publicKey,
    subject: pushSubject,
  });
});

app.post("/api/push/subscriptions", requireAuth, async (req, res, next) => {
  try {
    const subscription = cleanPushSubscription(req.body?.subscription || req.body);
    const record = await upsertPushSubscription(subscription, req.authUser, req.get("user-agent") || "");
    res.status(201).json({
      ok: true,
      subscription: publicPushSubscriptionRecord(record),
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/push/subscriptions", requireAuth, async (req, res, next) => {
  try {
    const endpoint = cleanPushEndpoint(req.body?.endpoint || req.body?.subscription?.endpoint);
    const removed = await removePushSubscription(endpoint, req.authUser);
    res.json({ ok: true, removed });
  } catch (error) {
    next(error);
  }
});

app.post("/api/push/test", requireAuth, async (req, res, next) => {
  try {
    const delivery = await sendPushNotifications({
      usernames: [req.authUser.username],
      payload: {
        title: appName,
        body: "Push notifications are ready.",
        tag: "carpostclub-test",
        url: "/",
      },
    });
    res.json({ ok: true, delivery });
  } catch (error) {
    next(error);
  }
});

app.post("/api/push/preview", requireAuth, async (req, res, next) => {
  try {
    if (!previewPushEnabled) throw httpError(404, "Preview push is disabled.");
    const payload = previewPushPayload(req.body || {}, req.authUser);
    const delivery = await sendPushNotifications({
      usernames: [req.authUser.username],
      payload,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      preview: true,
      payload: cleanPushPayload(payload),
      delivery,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/notifications", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(100, positiveInteger(req.query.limit, 50));
    const result = await notificationLogForUser(req.authUser, { limit });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      notifications: result.notifications,
      unreadCount: result.unreadCount,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/notifications/read", requireAuth, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    const marked = await markNotificationsRead(req.authUser, ids);
    const result = await notificationLogForUser(req.authUser, { limit: 50 });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      marked,
      notifications: result.notifications,
      unreadCount: result.unreadCount,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/dealerships", requireAuth, (_req, res) => {
  res.json({
    ok: true,
    dealerships: inventoryPicklistDealerships,
    inventoryTypes,
    defaultInventoryTypeId,
    sourceUrl: "https://www.oregans.com/inventory/",
  });
});

app.get("/api/inventory/cars", requireAuth, async (req, res, next) => {
  try {
    const dealership = cleanDealershipId(req.query.dealershipId);
    const inventoryTypeId = cleanInventoryTypeId(req.query.inventoryTypeId || defaultInventoryTypeId);
    const inventory = await fetchInventoryCarsSnapshot({ dealershipId: dealership.id, inventoryTypeId });
    const cars = await annotateInventoryCarsWithPostedStatus(
      await mergeManualInventoryCars(inventory.cars, { dealership, inventoryTypeId }),
      { dealershipId: dealership.id, inventoryTypeId },
    );
    res.json({
      ok: true,
      dealership,
      inventoryTypeId,
      cars,
      count: cars.length,
      fetchedAt: inventory.fetchedAtIso,
      source: inventory.source,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/snapshots/status", requireAuth, (_req, res, next) => {
  try {
    const schedule = currentOregansInventorySnapshotSchedule();
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      enabled: oregansInventorySnapshotEnabled,
      intervalMs: oregansInventorySnapshotIntervalMs,
      timeZone: oregansInventorySnapshotTimeZone,
      schedule: {
        dayIntervalMs: oregansInventorySnapshotIntervalMs,
        offHoursEnabled: oregansInventorySnapshotOffHoursEnabled,
        offHoursIntervalMs: oregansInventorySnapshotOffHoursIntervalMs,
        dayStartHour: oregansInventorySnapshotDayStartHour,
        dayEndHour: oregansInventorySnapshotDayEndHour,
        currentIntervalMs: schedule.currentIntervalMs,
        currentWindow: schedule.window,
        paused: schedule.paused,
        nextRunAt: oregansInventorySnapshotNextRunAt,
      },
      ...oregansInventorySnapshotStatus(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/snapshots/added", requireAuth, (req, res, next) => {
  try {
    const filters = inventorySnapshotQueryFilters(req.query);
    const result = oregansInventoryVehiclesAddedSince(filters);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/inventory/snapshots/run", requireAdmin, async (req, res, next) => {
  try {
    const snapshot = await queueOregansInventorySnapshotRun({ reason: "manual" });
    await appendAuditEvent("inventory.snapshot.manual_run", req.authUser, {
      snapshotId: snapshot.id,
      startedAt: snapshot.startedAt,
      finishedAt: snapshot.finishedAt,
      newInventoryCount: snapshot.newInventory?.count || 0,
      priceChangeCount: snapshot.priceChanges?.count || 0,
      detailsChangeCount: snapshot.detailsChanges?.count || 0,
      removedInventoryCount: snapshot.removedInventory?.count || 0,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(201).json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    next(error);
  }
});

// Public contract for the macOS/iOS "Inventory Album v3" Shortcut.
// Shortcuts cannot carry the upload app's browser session cookie.
app.get("/api/shortcuts/inventory-albums", async (req, res, next) => {
  try {
    if (!shortcutRequestAuthorized(req)) {
      setPrivateNoStore(res);
      res.setHeader("WWW-Authenticate", 'Bearer realm="CarPostClub Shortcuts"');
      res.status(401).json({ ok: false, error: "Shortcut token required." });
      return;
    }
    const picker = await shortcutInventoryAlbumPicker(req.query);
    if (shortcutBearerToken) {
      setPrivateNoStore(res);
    } else {
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    }

    const format = normalizeSpace(req.query?.format).toLowerCase();
    if (format === "labels" || format === "list") {
      res.json(picker.items.map((item) => item.albumName));
      return;
    }

    res.json(picker);
  } catch (error) {
    next(error);
  }
});

app.post("/api/manual-inventory/cars", requireAuth, async (req, res, next) => {
  try {
    const car = await createManualInventoryCar(req.body, req.authUser);
    res.status(201).json({
      ok: true,
      car,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/marketplace-draft", requireAuth, async (req, res, next) => {
  try {
    const { car } = await resolveInventoryCar(req.query);
    const album = await findExistingVehicleAlbum(car);
    const draft = await buildMarketplaceDraftForUser(car, req.authUser, { album });
    res.json({
      ok: true,
      album: publicAlbum(album),
      car,
      draft,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/marketplace-draft/regenerate", requireAuth, async (req, res, next) => {
  try {
    const { car } = await resolveInventoryCar(req.body);
    const album = await findExistingVehicleAlbum(car);
    const draft = await buildMarketplaceDraftForUser(car, req.authUser, { album, force: true });
    res.json({
      ok: true,
      album: publicAlbum(album),
      car,
      draft,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/marketplace-descriptions/backfill", requireAdmin, async (req, res, next) => {
  try {
    const options = marketplaceDescriptionBackfillOptions(req.body || {});
    const result = await backfillMarketplaceDescriptions(req.authUser, options);
    await appendAuditEvent("marketplace.descriptions.backfill", req.authUser, {
      promptVersion: result.promptVersion,
      dryRun: result.dryRun,
      summary: result.summary,
    });
    res.status(result.dryRun ? 200 : 201).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/albums/:albumId/marketplace-draft", requireAuth, async (req, res, next) => {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const album = await readAlbum(albumId);
    if (!album) throw httpError(404, "Album not found.");
    const currentAlbum = await albumWithInventoryStatus(album);
    const marketplaceAlbum = albumWithMatchedMarketplaceDealership(currentAlbum);
    const car = carFromAlbum(marketplaceAlbum);
    const draft = await buildMarketplaceDraftForUser(car, req.authUser, { album: marketplaceAlbum });
    res.json({
      ok: true,
      album: publicAlbum(currentAlbum),
      car,
      draft,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/albums/:albumId/facebook-listing-status", requireAdmin, async (req, res, next) => {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const album = await readAlbum(albumId);
    if (!album) throw httpError(404, "Album not found.");
    const facebookListing = await recordAlbumFacebookListingStatus(album, req.body || {}, req.authUser);
    const albumWithStatus = await albumWithInventoryStatus(album);
    await appendAuditEvent("facebook.listing_status.recorded", req.authUser, {
      albumId,
      vehicle: normalizeInventoryLifecycleVehicle(album.vehicle),
      facebookListing: {
        state: facebookListing.state,
        listingId: facebookListing.listingId,
        listingUrl: facebookListing.listingUrl,
        matchedBy: facebookListing.matchedBy,
        matchConfidence: facebookListing.matchConfidence,
        ambiguous: facebookListing.ambiguous,
        verifiedAt: facebookListing.verifiedAt,
      },
    });
    res.status(201).json({
      ok: true,
      album: publicAlbum(albumWithStatus),
      inventoryStatus: albumWithStatus.inventoryStatus,
      facebookListing,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/vehicle-album", requireAuth, async (req, res, next) => {
  try {
    const { car } = await resolveInventoryCar(req.query);
    const album = await findExistingVehicleAlbum(car);
    const photos = album ? await listAlbumPhotos(album.id) : [];
    if (album && photos.length && shouldMarkVehicleAlbumSeen(req.query)) {
      await markAlbumObjectsSeen(req.authUser, [album]);
      await markMediaGalleryNotificationsReadForAlbums(req.authUser, [album]);
    }
    res.json({
      ok: true,
      album: publicAlbum(await albumWithInventoryStatus(album)),
      photos,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/albums/:albumId/seen", requireAuth, async (req, res, next) => {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const album = await readAlbum(albumId);
    if (!album) throw httpError(404, "Album not found.");
    const marked = await markAlbumObjectsSeen(req.authUser, [album]);
    const notificationsMarked = await markMediaGalleryNotificationsReadForAlbums(req.authUser, [album]);
    const gallery = await listAlbumsForUser(req.authUser, { includeInventoryStatus: true });
    res.json({
      ok: true,
      album: publicAlbum(withAlbumReadState(await albumWithInventoryStatus(album), req.authUser, await readAlbumSeenStore())),
      marked,
      notificationsMarked,
      albums: publicAlbums(gallery.albums),
      unreadTotal: gallery.unreadTotal,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/albums/:albumId/photos", requireAuth, async (req, res, next) => {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const album = await readAlbum(albumId);
    if (!album) throw httpError(404, "Album not found.");
    const photos = await listAlbumPhotos(albumId);
    if (photos.length) {
      await markAlbumObjectsSeen(req.authUser, [album]);
      await markMediaGalleryNotificationsReadForAlbums(req.authUser, [album]);
    }
    res.json({
      ok: true,
      album: publicAlbum(await albumWithInventoryStatus(album)),
      photos,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/albums/:albumId/download", requireAuth, downloadAlbumMedia);
app.get("/api/albums/:albumId/description.txt", requireAuth, downloadAlbumDescription);
app.get("/api/albums/:albumId/package", requireAuth, downloadAlbumPackage);

app.post("/api/upload", requireAuth, upload.array("photos", maxUploadFiles), async (req, res, next) => {
  const files = Array.isArray(req.files) ? req.files : [];
  try {
    const { car } = await resolveInventoryCar(req.body);
    const result = await saveUploadedMediaForCar({ files, car, user: req.authUser });
    const uploadEvent = uploadAlbumEventPayload(car, result, req.authUser);

    res.status(201).json({
      ok: true,
      album: publicAlbum(result.album),
      albumId: result.album.id,
      car,
      count: result.photos.length,
      photos: result.photos,
      marketplaceGeneration: result.marketplaceGeneration,
      marketplaceDraft: result.marketplaceDraft,
    });
    broadcastAlbumEvent(uploadEvent);
    queuePushNotifications({
      excludeUsername: req.authUser.username,
      payload: uploadPushPayload(car, result.photos.length, uploadEvent),
    });
  } catch (error) {
    await cleanupTempFiles(files);
    next(error);
  }
});

app.get("/api/albums/:albumId/media/:filename", requireAuth, serveAlbumMedia);
app.get("/api/albums/:albumId/photos/:filename", requireAuth, serveAlbumMedia);
app.get("/api/albums/:albumId/media/:filename/thumbnail", requireAuth, serveAlbumThumbnail);

app.delete("/api/albums/:albumId/media", requireAdmin, deleteAlbumMediaCollection);
app.delete("/api/albums/:albumId/photos", requireAdmin, deleteAlbumMediaCollection);
app.delete("/api/albums/:albumId/media/:filename", requireAdmin, deleteAlbumMedia);
app.delete("/api/albums/:albumId/photos/:filename", requireAdmin, deleteAlbumMedia);

async function serveAlbumMedia(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const filename = cleanFilename(req.params.filename);
    const metadata = await readPhotoMetadata(albumId);
    const media = await storedMediaInfo(albumId, filename, metadata);
    if (!media) throw httpError(404, "Media not found.");
    const originalName = metadata[filename]?.originalName || filename;
    await sendStoredMedia(req, res, media, {
      downloadName: isDownloadRequest(req) ? mediaDownloadName(originalName, filename) : "",
    });
  } catch (error) {
    next(error);
  }
}

async function serveAlbumThumbnail(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const filename = cleanFilename(req.params.filename);
    const media = await storedMediaInfo(albumId, filename);
    if (!media) throw httpError(404, "Media not found.");

    if (!isPhotoFilename(filename)) throw httpError(404, "Thumbnail not available.");

    const thumbnail = await ensureStoredMediaThumbnail(media).catch(() => null);
    if (!thumbnail) {
      await sendStoredMedia(req, res, media);
      return;
    }

    const thumbnailStats = await fs.stat(thumbnail);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Content-Length", String(thumbnailStats.size));
    createReadStream(thumbnail).pipe(res);
  } catch (error) {
    next(error);
  }
}

async function downloadAlbumMedia(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const album = await readAlbum(albumId);
    if (!album) throw httpError(404, "Album not found.");
    const photos = await listAlbumPhotos(albumId);
    if (!photos.length) throw httpError(404, "No media to download.");

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      next(error);
    });

    res.attachment(`${slugify(album.name || albumId)}.zip`);
    res.setHeader("Cache-Control", "private, no-store");
    archive.pipe(res);

    const archiveNames = new Set();
    for (const photo of photos) {
      await appendStoredMediaToArchive(archive, albumId, photo.filename, uniqueArchiveName(mediaDownloadName(photo.originalName, photo.filename), archiveNames));
    }
    await archive.finalize();
  } catch (error) {
    next(error);
  }
}

async function downloadAlbumDescription(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const album = await readAlbum(albumId);
    if (!album) throw httpError(404, "Album not found.");
    const currentAlbum = await albumWithInventoryStatus(album);
    const marketplaceAlbum = albumWithMatchedMarketplaceDealership(currentAlbum);
    const car = carFromAlbum(marketplaceAlbum);
    const draft = await buildMarketplaceDraftForUser(car, req.authUser, { album: marketplaceAlbum });
    const photos = await listAlbumPhotos(albumId);
    const documentText = marketplaceDescriptionDocument({
      album: marketplaceAlbum,
      car,
      draft,
      photos,
      user: req.authUser,
      inventoryStatus: currentAlbum.inventoryStatus,
    });

    res.attachment(`${slugify(currentAlbum.name || albumId)}-marketplace-description.txt`);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(documentText);
  } catch (error) {
    next(error);
  }
}

async function downloadAlbumPackage(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const album = await readAlbum(albumId);
    if (!album) throw httpError(404, "Album not found.");
    const photos = await listAlbumPhotos(albumId);
    if (!photos.length) throw httpError(404, "No media to package.");

    const currentAlbum = await albumWithInventoryStatus(album);
    const marketplaceAlbum = albumWithMatchedMarketplaceDealership(currentAlbum);
    const car = carFromAlbum(marketplaceAlbum);
    const draft = await buildMarketplaceDraftForUser(car, req.authUser, { album: marketplaceAlbum });
    const inventoryStatus = currentAlbum.inventoryStatus;
    const descriptionText = marketplaceDescriptionDocument({
      album: marketplaceAlbum,
      car,
      draft,
      photos,
      user: req.authUser,
      inventoryStatus,
    });
    const manifest = marketplacePackageManifest({
      album: marketplaceAlbum,
      car,
      draft,
      photos,
      user: req.authUser,
      inventoryStatus,
    });

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      next(error);
    });

    res.attachment(`${slugify(currentAlbum.name || albumId)}-marketplace-package.zip`);
    res.setHeader("Cache-Control", "private, no-store");
    archive.pipe(res);

    const archiveNames = new Set();
    for (const photo of photos) {
      const archiveName = uniqueArchiveName(mediaDownloadName(photo.originalName, photo.filename), archiveNames);
      await appendStoredMediaToArchive(archive, albumId, photo.filename, path.posix.join("media", archiveName));
    }
    archive.append(descriptionText, { name: "facebook-marketplace-description.txt" });
    archive.append(JSON.stringify(draft.fields || {}, null, 2), { name: "facebook-marketplace-fields.json" });
    archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: "package-manifest.json" });
    await archive.finalize();
  } catch (error) {
    next(error);
  }
}

function carFromAlbum(album) {
  const vehicle = album?.vehicle || {};
  const dealership = cleanDealershipId(vehicle.dealershipId || album?.dealership?.id);
  const inventoryTypeId = cleanInventoryTypeId(vehicle.inventoryTypeId || album?.inventoryTypeId || defaultInventoryTypeId);
  const source = normalizeSpace(vehicle.source || "oregans").toLowerCase() === "manual" ? "manual" : "oregans";
  return {
    source,
    manualInventoryId: source === "manual" ? cleanManualInventoryId(vehicle.manualInventoryId || vehicle.inventoryKey) : "",
    inventoryKey: normalizeSpace(vehicle.inventoryKey || vehicle.manualInventoryId || vehicle.vin),
    vin: cleanOptionalVin(vehicle.vin),
    stockNumber: normalizeSpace(vehicle.stockNumber),
    title: normalizeSpace(vehicle.title || album?.name),
    label: normalizeSpace([vehicle.stockNumber, vehicle.title || album?.name].filter(Boolean).join(" - ")),
    inventoryTypeId,
    dealership,
    albumId: album.id,
    albumName: album.name,
    inventoryType: inventoryTypes.find((type) => type.id === inventoryTypeId)?.name || "",
    year: normalizeSpace(vehicle.year),
    make: normalizeSpace(vehicle.make),
    model: normalizeSpace(vehicle.model),
    trim: normalizeSpace(vehicle.trim),
    tagline: "",
    price: normalizeSpace(vehicle.price),
    priceValue: nullableFiniteNumber(vehicle.priceValue) ?? parseCurrency(vehicle.price),
    ownerLocation: normalizeSpace(vehicle.dealershipName || dealership.name),
    detailUrl: sanitizedOregansDetailUrl(vehicle.detailUrl || album?.sourceUrl, source),
    exteriorColor: normalizeSpace(vehicle.exteriorColor),
    interiorColor: normalizeSpace(vehicle.interiorColor),
    odometer: normalizeSpace(vehicle.odometer),
    odometerValue: parseNullableInteger(vehicle.odometer),
    bodyStyle: normalizeSpace(vehicle.bodyStyle),
    fuelType: normalizeSpace(vehicle.fuelType),
    transmission: normalizeSpace(vehicle.transmission),
    descriptionPreview: normalizeSpace(vehicle.descriptionPreview),
  };
}

function marketplaceDescriptionDocument({ album, car, draft, photos, user, inventoryStatus }) {
  const displayName = normalizeDisplayName(user?.displayName) || normalizeAuthUsername(user?.username) || "CarPostClub user";
  const missingFields = Array.isArray(draft.missingFields) ? draft.missingFields : [];
  const reviewFields = Array.isArray(draft.reviewFields) ? draft.reviewFields : [];
  const facebookSyncAction = inventoryLifecycleDocumentAction(inventoryStatus);
  const readyToPost = marketplaceReadyToPost(draft, inventoryStatus);
  return [
    "CarPostClub Marketplace Package",
    "",
    `Prepared for: ${displayName}`,
    `Vehicle: ${draft.title || car.title || album.name}`,
    `Stock: ${car.stockNumber || "Needs review"}`,
    `VIN: ${car.vin || "Needs review"}`,
    `Media: ${photos.length} ${photos.length === 1 ? "file" : "files"}`,
    `Inventory status: ${inventoryStatus?.label || "Unknown"}`,
    facebookSyncAction ? `Facebook sync: ${facebookSyncAction}` : "",
    `Ready to post: ${readyToPost ? "Yes" : "No"}`,
    missingFields.length ? `Missing fields: ${missingFields.join(", ")}` : "",
    reviewFields.length ? `Review fields: ${reviewFields.join(", ")}` : "",
    "",
    "Facebook Marketplace Fields",
    draft.copyText || buildMarketplaceCopyText({
      title: draft.title,
      fields: draft.fields || {},
      description: draft.description || "",
      car,
      user,
    }),
  ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n").trimEnd() + "\n";
}

function marketplaceReadyToPost(draft, inventoryStatus) {
  const lifecycle = inventoryStatus?.lifecycle || {};
  if (Object.hasOwn(lifecycle, "canPostToFacebook")) {
    return Boolean(draft?.ready && lifecycle.canPostToFacebook);
  }
  return Boolean(draft?.ready);
}

function inventoryLifecycleDocumentAction(inventoryStatus) {
  const action = inventoryStatus?.lifecycle?.facebookAction || "";
  if (action === "mark_sold") return "Mark any matching Konner John Marketplace listing sold; do not delete it.";
  if (action === "verify_facebook_before_mark_sold") return "Verify current Facebook and public O'Regan's status before marking a matching listing sold.";
  if (action === "already_sold") return "Matching Konner John Marketplace listing is already sold.";
  if (action === "skip_no_live_listing") return "No matching live Konner John Marketplace listing was found during the last sweep.";
  if (action === "skip_already_live") return "Already represented on Konner John Marketplace; do not publish a duplicate.";
  if (action === "recheck_facebook_before_post") return "Recheck Konner John Marketplace before publishing; previous Facebook evidence is stale.";
  if (action === "review_duplicate_live_evidence") return "Review ambiguous live Facebook evidence before publishing.";
  if (action === "review_sold_match") return "Review the sold matching Facebook listing before publishing a duplicate.";
  if (action === "post_if_not_live") return "Post to Konner John Marketplace if it is not already live.";
  if (action === "capture_photos") return "Capture and upload Connor photos before posting.";
  if (action === "wait_for_upload") return "Wait for the current CPC photo upload to finish before posting.";
  if (action === "manual_review") return "Review manually before any Facebook action.";
  if (action === "review") return "Review inventory status before any Facebook action.";
  return "";
}

function marketplacePackageManifest({ album, car, draft, photos, user, inventoryStatus }) {
  return {
    app: appName,
    generatedAt: new Date().toISOString(),
    generatedFor: publicAuthUser(user),
    readyToPost: marketplaceReadyToPost(draft, inventoryStatus),
    missingFields: draft.missingFields || [],
    reviewFields: draft.reviewFields || [],
    inventoryStatus,
    album: {
      id: album.id,
      name: album.name,
      createdAt: album.createdAt,
      updatedAt: album.updatedAt,
    },
    vehicle: {
      source: car.source,
      inventoryKey: car.inventoryKey,
      vin: car.vin,
      stockNumber: car.stockNumber,
      title: car.title,
      year: car.year,
      make: car.make,
      model: car.model,
      trim: car.trim,
      dealership: car.dealership,
      inventoryTypeId: car.inventoryTypeId,
    },
    marketplace: {
      title: draft.title,
      fields: draft.fields,
      descriptionSource: draft.descriptionSource,
      descriptionVariantId: draft.descriptionVariantId,
      descriptionOwner: draft.descriptionOwner,
    },
    media: photos.map((photo) => ({
      originalName: photo.originalName,
      downloadName: photo.downloadName,
      kind: photo.kind,
      contentType: photo.contentType,
      bytes: photo.bytes,
      uploadedAt: photo.uploadedAt,
      uploadedBy: photo.uploadedBy,
    })),
  };
}

async function deleteAlbumMedia(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const filename = cleanFilename(req.params.filename);
    const [album, metadata] = await Promise.all([
      readAlbum(albumId),
      readPhotoMetadata(albumId),
    ]);
    await deleteStoredMedia(albumId, filename);
    await updatePhotoMetadata(albumId, (metadata) => {
      delete metadata[filename];
    });
    await removeMarketplaceCopyIfAlbumEmpty(albumId);
    await appendAuditEvent("album.media.deleted", req.authUser, {
      ...auditAlbumDetails(album),
      filename,
      originalName: metadata[filename]?.originalName || filename,
      contentType: metadata[filename]?.contentType || contentTypeFor(filename),
      bytes: metadata[filename]?.bytes || 0,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

async function removeAlbumMediaCollection(albumId) {
  albumId = cleanAlbumId(albumId);
  const album = await readAlbum(albumId);
  if (!album) throw httpError(404, "Album not found.");
  const photos = await listAlbumPhotos(albumId);
  await Promise.all(photos.map((photo) => deleteStoredMedia(albumId, photo.filename)));
  await updatePhotoMetadata(albumId, (metadata) => {
    for (const filename of Object.keys(metadata)) delete metadata[filename];
  });
  await removeMarketplaceCopyStore(albumId);
  return { album, deleted: photos.length, photos };
}

async function deleteAlbumMediaCollection(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const result = await removeAlbumMediaCollection(albumId);
    await appendAuditEvent("album.media_collection.deleted", req.authUser, {
      ...auditAlbumDetails(result.album),
      deleted: result.deleted,
      filenames: result.photos.map((photo) => photo.filename),
    });
    res.json({ ok: true, deleted: result.deleted });
  } catch (error) {
    next(error);
  }
}

app.get("/api/chat/messages", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(200, chatMessageLimit, positiveInteger(req.query.limit, chatResponseLimit));
    const [messages, readState] = await Promise.all([
      readChatMessages(),
      chatReadStateForUser(req.authUser),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      messages: messages.slice(-limit),
      readState,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/chat/read-state", requireAuth, async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      readState: await chatReadStateForUser(req.authUser),
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/chat/read-state", requireAuth, async (req, res, next) => {
  try {
    const marker = normalizeChatReadMarker(req.body?.marker || req.body);
    if (!marker) throw httpError(400, "A valid chat read marker is required.");
    const readState = await markChatReadState(req.authUser, marker);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      readState,
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/chat/messages/:messageId/reaction", requireAuth, async (req, res, next) => {
  try {
    const messageId = cleanChatMessageId(req.params.messageId);
    const reaction = normalizeChatReactionInput(req.body?.reaction ?? req.body?.type ?? req.body?.kind);
    const result = await updateChatMessageReaction(messageId, reaction, req.authUser);
    const message = result.message;
    broadcastChatMessage(message, { event: "reaction" });
    const pushDeliveryPromise = result.added
      ? queuePushNotifications({
        excludeUsername: req.authUser.username,
        payload: chatReactionPushPayload(message, {
          reaction: result.reaction,
          reactor: req.authUser,
        }),
      })
      : null;
    const pushDelivery = pushDeliveryPromise && pushAwaitDelivery
      ? await pushDeliveryPromise
      : null;
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      message,
      ...(pushDelivery ? { pushDelivery } : {}),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/chat/stream", requireAuth, (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  const heartbeat = setInterval(() => {
    writeChatEvent(res, ": ping\n\n");
  }, 25_000);
  heartbeat.unref?.();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    chatClients.delete(res);
  };

  chatClients.add(res);
  req.on("close", cleanup);
  writeChatEvent(res, "retry: 3000\n\n");
  writeChatEvent(res, ": connected\n\n");
});

app.get("/api/chat/media/:filename", requireAuth, serveChatMedia);

app.get("/api/gifs/search", requireAuth, async (req, res, next) => {
  try {
    if (!giphyApiKey) {
      res.status(503).json({
        ok: false,
        configured: false,
        error: "GIF search is not configured.",
      });
      return;
    }

    const gifs = await searchGiphyGifs({
      q: req.query.q,
      limit: req.query.limit,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      configured: true,
      gifs,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/chat/messages", requireAuth, chatUpload.array("attachments", chatAttachmentLimit), async (req, res, next) => {
  const files = Array.isArray(req.files) ? req.files : [];
  let savedAttachments = [];
  try {
    const text = normalizeOptionalChatMessageText(req.body?.text);
    savedAttachments = await saveChatUploadedAttachments(files, req.authUser);
    const gifAttachment = normalizeChatGifAttachmentInput(req.body?.gif || req.body?.giphy || req.body?.gifUrl);
    const attachments = gifAttachment ? [...savedAttachments, gifAttachment] : savedAttachments;
    const message = await appendChatMessage({ text, attachments }, req.authUser);
    broadcastChatMessage(message);
    const pushDeliveryPromise = queuePushNotifications({
      excludeUsername: req.authUser.username,
      payload: chatPushPayload(message),
    });
    const pushDelivery = pushAwaitDelivery ? await pushDeliveryPromise : null;
    res.status(201).json({
      ok: true,
      message,
      ...(pushDelivery ? { pushDelivery } : {}),
    });
  } catch (error) {
    await cleanupTempFiles(files);
    await cleanupChatAttachments(savedAttachments);
    next(error);
  }
});

app.use((req, _res, next) => {
  next(httpError(404, `No route for ${req.method} ${req.path}`));
});

app.use(async (error, req, res, _next) => {
  if (Array.isArray(req.files)) await cleanupTempFiles(req.files);
  const responseError = uploadLimitHttpError(error);
  const status = Number(responseError?.status || responseError?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const message = safeStatus >= 500 ? "Unexpected server error." : String(responseError?.message || "Request failed.");
  if (safeStatus >= 500) console.error(responseError);
  res.status(safeStatus).json({ ok: false, error: message });
});

const server = app.listen(port, host, () => {
  console.log(`${appName} listening on ${host}:${port}`);
  startOregansInventorySnapshotScheduler();
});

process.on("SIGTERM", () => {
  shuttingDown = true;
  stopOregansInventorySnapshotScheduler();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 30_000).unref();
});

function criticalOperationSnapshot() {
  const operations = [
    ["vehicle-upload", vehicleUploadWritePromises],
    ["photo-metadata-write", photoMetadataWritePromises],
    ["marketplace-copy-write", marketplaceCopyStoreWritePromises],
  ].flatMap(([type, operations]) => {
    if (!operations?.size) return [];
    return [{
      type,
      count: operations.size,
      keys: [...operations.keys()].map((key) => String(key)).slice(0, 20),
    }];
  });
  if (oregansInventorySnapshotPendingRuns > 0) {
    operations.push({
      type: "inventory-snapshot",
      count: oregansInventorySnapshotPendingRuns,
      keys: [],
    });
  }
  return operations;
}

function applySecurityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.giphy.com https://*.giphyusercontent.com",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join("; "));
  next();
}

function rejectCrossOriginUnsafeRequests(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  if (isSameOriginUnsafeRequest(req)) {
    next();
    return;
  }
  next(httpError(403, "Cross-origin requests are not allowed."));
}

function isSameOriginUnsafeRequest(req) {
  const allowed = allowedRequestOrigins(req);
  const originHeader = req.get("origin");
  if (originHeader) return allowed.has(normalizePublicOrigin(originHeader));
  if (originHeader === "null") return false;

  const referer = req.get("referer");
  if (!referer) return true;
  try {
    return allowed.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

function allowedRequestOrigins(req) {
  return new Set([
    requestHostOrigin(req),
    publicOrigin,
  ].filter(Boolean));
}

function shortcutRequestAuthorized(req) {
  if (!shortcutBearerToken) return true;
  const header = normalizeSpace(req.get("authorization"));
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1] || "";
  const explicitHeader = normalizeSpace(req.get("x-carpostclub-shortcut-token"));
  return [bearer, explicitHeader].some((token) => token && timingSafeEqual(token, shortcutBearerToken));
}

async function listAlbums({ includeInventoryStatus = false } = {}) {
  const entries = await fs.readdir(uploadRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });

  const albums = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (legacyStorageDirectories.has(entry.name)) continue;
    const album = await readAlbum(entry.name);
    if (album?.vehicle && album.mediaCount > 0) albums.push(album);
  }

  const sorted = albums.sort((left, right) => {
    const time = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (time) return time;
    return left.name.localeCompare(right.name);
  });
  return includeInventoryStatus ? albumsWithInventoryStatus(sorted) : sorted;
}

async function listAlbumsForUser(user, { includeInventoryStatus = false } = {}) {
  const [albums, seenStore] = await Promise.all([
    listAlbums({ includeInventoryStatus }),
    readAlbumSeenStore(),
  ]);
  const albumsWithReadState = albums.map((album) => withAlbumReadState(album, user, seenStore));
  return {
    albums: albumsWithReadState,
    unreadTotal: albumsWithReadState.filter((album) => album.unread).length,
  };
}

function withAlbumReadState(album, user, seenStore) {
  const username = normalizeAuthUsername(user?.username);
  const seen = seenStore?.users?.[username]?.albums?.[album.id] || null;
  const albumUpdatedAt = albumReadVersion(album);
  const albumUpdatedMs = Date.parse(albumUpdatedAt || "");
  const seenMs = Date.parse(seen?.albumUpdatedAt || seen?.seenAt || "");
  const hasSeenVersion = Number.isFinite(seenMs) && (!Number.isFinite(albumUpdatedMs) || seenMs >= albumUpdatedMs);
  const unread = Boolean(
    username
    && album.mediaCount > 0
    && !hasSeenVersion
  );

  return {
    ...album,
    unread,
    readState: {
      unread,
      seenAt: seen?.seenAt || "",
      albumUpdatedAt: seen?.albumUpdatedAt || "",
    },
  };
}

function albumReadVersion(album) {
  return album?.latestUploadedAt || album?.updatedAt || album?.createdAt || "";
}

function shouldMarkVehicleAlbumSeen(query = {}) {
  return normalizeSpace(query.markSeen || query.markAsSeen || query.seen || "1") !== "0";
}

function albumDealershipKey(album) {
  return normalizeSpace(album?.vehicle?.dealershipId || album?.dealership?.id || "");
}

async function markAlbumObjectsSeen(user, albums) {
  const username = normalizeAuthUsername(user?.username);
  const validAlbums = albums
    .filter((album) => album?.id && album.mediaCount > 0)
    .map((album) => ({
      id: cleanAlbumId(album.id),
      albumUpdatedAt: albumReadVersion(album),
    }));
  if (!username || !validAlbums.length) return 0;

  return updateAlbumSeenStore((store) => {
    const userStore = store.users[username] || { albums: {} };
    userStore.albums = userStore.albums && typeof userStore.albums === "object" ? userStore.albums : {};
    const seenAt = new Date().toISOString();
    let marked = 0;
    for (const album of validAlbums) {
      const previous = userStore.albums[album.id];
      if (previous?.albumUpdatedAt === album.albumUpdatedAt) continue;
      userStore.albums[album.id] = {
        seenAt,
        albumUpdatedAt: album.albumUpdatedAt,
      };
      marked += 1;
    }
    store.users[username] = userStore;
    return marked;
  });
}

async function readAlbumSeenStore() {
  return normalizeAlbumSeenStore(await readJson(albumSeenPath, { users: {} }));
}

async function updateAlbumSeenStore(mutator) {
  albumSeenWritePromise = albumSeenWritePromise.catch(() => {}).then(async () => {
    const store = await readAlbumSeenStore();
    const result = await mutator(store);
    await writeJson(albumSeenPath, store);
    return result;
  });
  return albumSeenWritePromise;
}

function normalizeAlbumSeenStore(value) {
  const users = value?.users && typeof value.users === "object" ? value.users : {};
  const normalized = { users: {} };
  for (const [rawUsername, rawUserStore] of Object.entries(users)) {
    const username = normalizeAuthUsername(rawUsername);
    if (!username) continue;
    const rawAlbums = rawUserStore?.albums && typeof rawUserStore.albums === "object" ? rawUserStore.albums : {};
    const albums = {};
    for (const [rawAlbumId, rawSeen] of Object.entries(rawAlbums)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(rawAlbumId) || rawAlbumId.includes("..")) continue;
      const albumId = rawAlbumId.toLowerCase();
      const seenAt = validIsoString(rawSeen?.seenAt);
      const albumUpdatedAt = validIsoString(rawSeen?.albumUpdatedAt);
      if (!seenAt && !albumUpdatedAt) continue;
      albums[albumId] = {
        seenAt: seenAt || albumUpdatedAt,
        albumUpdatedAt: albumUpdatedAt || seenAt,
      };
    }
    normalized.users[username] = { albums };
  }
  return normalized;
}

function validIsoString(value) {
  const text = String(value || "");
  return Number.isFinite(Date.parse(text)) ? text : "";
}

async function readAlbum(albumId) {
  albumId = cleanAlbumId(albumId);
  const directory = albumPath(albumId);
  const stats = await fs.stat(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stats?.isDirectory()) return null;

  const metadata = await readAlbumMetadata(albumId);
  const photos = await listAlbumPhotos(albumId);
  const latestPhoto = albumLatestPhoto(photos);
  const updatedAt = latestPhoto?.uploadedAt || metadata.updatedAt || metadata.createdAt || stats.mtime.toISOString();
  const bytes = photos.reduce((total, photo) => total + photo.bytes, 0);
  const photoCount = photos.filter((photo) => photo.kind !== "video").length;
  const videoCount = photos.filter((photo) => photo.kind === "video").length;
  const cover = selectAlbumCoverPhoto(photos);
  const inventoryNumber = albumInventoryNumberFromMetadata(metadata);
  const storage = albumStorageInfo(albumId, metadata);
  const uploadedByUsers = albumUploadedByUsers(photos);
  const createdBy = albumCreator(metadata, photos);
  const updatedBy = publicUploader(metadata.updatedBy) || publicUploader(latestPhoto?.uploadedBy) || createdBy;
  const vehicle = sanitizedAlbumVehicle(metadata.vehicle);
  const sourceUrl = sanitizedOregansDetailUrl(metadata.sourceUrl, vehicle?.source)
    || sanitizedOregansDetailUrl(vehicle?.detailUrl, vehicle?.source);

  return {
    id: albumId,
    name: metadata.name || titleFromAlbumId(albumId),
    inventoryNumber,
    createdAt: metadata.createdAt || stats.birthtime.toISOString(),
    updatedAt,
    createdBy,
    updatedBy,
    uploadedByUsers,
    photoCount,
    videoCount,
    mediaCount: photos.length,
    bytes,
    coverPhoto: publicAlbumCoverPhoto(cover),
    coverUrl: cover?.url || null,
    coverThumbnailUrl: cover?.thumbnailUrl || null,
    latestUploadedAt: latestPhoto?.uploadedAt || null,
    latestUploadedBy: latestPhoto?.uploadedBy || null,
    descriptionPreview: normalizeSpace(metadata.vehicle?.descriptionPreview),
    objectStoragePrefix: storage.prefix,
    storage,
    dealership: metadata.dealership || null,
    vehicle,
    inventoryTypeId: metadata.inventoryTypeId || null,
    sourceUrl: sourceUrl || null,
  };
}

async function albumsWithInventoryStatus(albums) {
  return Promise.all(albums.map(albumWithInventoryStatus));
}

function albumCreator(metadata = {}, photos = []) {
  const firstUploader = albumPhotosOldestFirst(photos).find((photo) => publicUploader(photo.uploadedBy));
  return publicUploader(firstUploader?.uploadedBy) || publicUploader(metadata.createdBy) || null;
}

function albumUploadedByUsers(photos = []) {
  const seen = new Set();
  const users = [];
  for (const photo of albumPhotosOldestFirst(photos)) {
    const user = publicUploader(photo.uploadedBy);
    if (!user) continue;
    const key = user.username || user.displayName;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    users.push(user);
  }
  return users;
}

function albumPhotosOldestFirst(photos = []) {
  return [...photos].sort((left, right) => {
    const leftTime = Date.parse(left?.uploadedAt || "") || 0;
    const rightTime = Date.parse(right?.uploadedAt || "") || 0;
    return leftTime - rightTime;
  });
}

function albumLatestPhoto(photos = []) {
  return photos.reduce((latest, photo) => {
    if (!latest) return photo;
    return compareAlbumPhotosNewestFirst(photo, latest) < 0 ? photo : latest;
  }, null);
}

function publicAlbumCoverPhoto(photo) {
  if (!photo) return null;
  return {
    filename: photo.filename,
    originalName: photo.originalName,
    kind: photo.kind,
    contentType: photo.contentType,
    url: photo.url,
    thumbnailUrl: photo.thumbnailUrl || "",
    downloadUrl: photo.downloadUrl || "",
  };
}

function publicAlbum(album) {
  if (!album) return album;
  const {
    objectStoragePrefix: _objectStoragePrefix,
    storage: _storage,
    ...publicFields
  } = album;
  return publicFields;
}

function publicAlbums(albums = []) {
  return Array.isArray(albums) ? albums.map(publicAlbum) : [];
}

function sanitizedAlbumVehicle(vehicle) {
  if (!vehicle || typeof vehicle !== "object") return null;
  const source = normalizeSpace(vehicle.source || "oregans").toLowerCase();
  return {
    ...vehicle,
    detailUrl: sanitizedOregansDetailUrl(vehicle.detailUrl, source),
  };
}

function sortAlbumPhotosForDisplay(photos = []) {
  const stableOrder = [...photos].sort(compareAlbumPhotosStableOrder);
  const cover = selectAlbumCoverPhoto(stableOrder);
  if (!cover) return stableOrder;
  return [
    cover,
    ...stableOrder.filter((photo) => photo !== cover),
  ];
}

function selectAlbumCoverPhoto(photos = []) {
  const images = photos.filter((photo) => photo?.kind !== "video");
  if (!images.length) return photos[0] || null;
  return images.reduce((best, photo) => {
    if (!best) return photo;
    return compareAlbumCoverCandidates(photo, best) < 0 ? photo : best;
  }, null);
}

function compareAlbumCoverCandidates(left, right) {
  const scoreDelta = vehicleCoverPhotoScore(right) - vehicleCoverPhotoScore(left);
  if (scoreDelta) return scoreDelta;
  return compareAlbumPhotosStableOrder(left, right);
}

function compareAlbumPhotosStableOrder(left, right) {
  const indexDelta = albumPhotoUploadIndex(left) - albumPhotoUploadIndex(right);
  if (indexDelta) return indexDelta;

  const leftTime = Date.parse(left?.uploadedAt || "") || 0;
  const rightTime = Date.parse(right?.uploadedAt || "") || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;

  return String(left?.filename || "").localeCompare(String(right?.filename || ""));
}

function albumPhotoUploadIndex(photo) {
  const index = normalizedUploadIndex(photo?.uploadIndex);
  return index ?? Number.MAX_SAFE_INTEGER;
}

function compareAlbumPhotosNewestFirst(left, right) {
  const leftTime = Date.parse(left?.uploadedAt || "") || 0;
  const rightTime = Date.parse(right?.uploadedAt || "") || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;

  return compareAlbumPhotosStableOrder(left, right);
}

function vehicleCoverPhotoScore(photo) {
  if (!photo || photo.kind === "video") return -100000;

  const text = vehiclePhotoLabelText(photo);
  let score = 0;
  if (matchesAny(text, vehicleHeroPhotoPatterns())) score += 180;
  if (matchesAny(text, vehicleFrontExteriorPhotoPatterns())) score += 160;
  if (/\bfront\b/i.test(text)) score += 90;
  if (/\b(?:exterior|outside|ext|profile|walkaround)\b/i.test(text)) score += 70;
  if (/\b(?:three quarter|three quarters|3 4|quarter angle)\b/i.test(text)) score += 60;
  if (/\b(?:driver front|passenger front|left front|right front)\b/i.test(text)) score += 55;
  if (/\b(?:side|rear|back)\b/i.test(text)) score += 30;
  if (/\b(?:angle|beauty|showroom)\b/i.test(text)) score += 25;
  if (matchesAny(text, vehicleInteriorPhotoPatterns())) score -= 180;
  if (matchesAny(text, vehicleDetailPhotoPatterns())) score -= 150;
  if (matchesAny(text, vehicleMechanicalPhotoPatterns())) score -= 100;
  return score;
}

function vehiclePhotoLabelText(photo) {
  return ` ${[
    photo?.originalName,
    photo?.filename,
    photo?.downloadName,
  ].filter(Boolean).join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")} `;
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function vehicleHeroPhotoPatterns() {
  return [
    /\b(?:hero|cover|main|primary|thumbnail)\b/i,
  ];
}

function vehicleFrontExteriorPhotoPatterns() {
  return [
    /\b(?:front exterior|exterior front|front view|front shot|front angle|front quarter|front three quarter|front three quarters|front 3 4|3 4 front)\b/i,
  ];
}

function vehicleInteriorPhotoPatterns() {
  return [
    /\b(?:interior|inside|cabin|dash|dashboard|odometer|gauge|gauges|cluster|steering|wheel controls|seat|seats|console|screen|infotainment|radio|shifter|carplay|floor mat|mats|door panel|headliner|sunroof|cargo|trunk)\b/i,
  ];
}

function vehicleDetailPhotoPatterns() {
  return [
    /\b(?:vin|sticker|tag|lot tag|window sticker|monroney|plate|key|keys|fob|paperwork|document|scratch|dent|damage|tire|wheel|rim|warranty)\b/i,
  ];
}

function vehicleMechanicalPhotoPatterns() {
  return [
    /\b(?:engine|underhood|under hood|hood open|battery|brake|suspension|undercarriage)\b/i,
  ];
}

function normalizedUploadIndex(value) {
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function nextPhotoUploadIndex(metadata = {}) {
  let maxIndex = -1;
  let mediaCount = 0;
  for (const [filename, meta] of Object.entries(metadata || {})) {
    if (!isMediaFilename(filename)) continue;
    mediaCount += 1;
    const index = normalizedUploadIndex(meta?.uploadIndex);
    if (index !== null) maxIndex = Math.max(maxIndex, index);
  }
  return Math.max(maxIndex + 1, mediaCount);
}

async function albumWithInventoryStatus(album) {
  if (!album) return album;
  const inventoryStatus = await inventoryStatusForAlbum(album);
  recordAlbumInventoryLifecycle(album, inventoryStatus).catch((error) => {
    console.warn(`Inventory lifecycle update failed for ${album.id}: ${error?.message || error}`);
  });
  const currentAlbum = albumWithMatchedInventoryVehicle(album, inventoryStatus);
  return {
    ...currentAlbum,
    inventoryStatus,
  };
}

function albumWithMatchedInventoryVehicle(album, inventoryStatus) {
  const matchedVehicle = inventoryStatus?.matchedVehicle;
  if (!inventoryStatus?.active || !matchedVehicle) return album;

  const vehicle = { ...(album?.vehicle || {}) };
  for (const field of [
    "vin",
    "stockNumber",
    "title",
    "year",
    "make",
    "model",
    "trim",
    "price",
    "odometer",
    "exteriorColor",
    "interiorColor",
    "bodyStyle",
    "fuelType",
    "transmission",
    "detailUrl",
  ]) {
    const value = normalizeSpace(matchedVehicle[field]);
    if (value) vehicle[field] = value;
  }
  for (const field of ["priceValue", "odometerValue"]) {
    const value = nullableFiniteNumber(matchedVehicle[field]);
    if (value !== null) vehicle[field] = value;
  }

  return {
    ...album,
    vehicle,
    sourceUrl: normalizeSpace(matchedVehicle.detailUrl) || album?.sourceUrl,
  };
}

function albumWithMatchedMarketplaceDealership(album) {
  const matchedVehicle = album?.inventoryStatus?.matchedVehicle;
  if (!album?.inventoryStatus?.active || !matchedVehicle) return album;

  const dealershipId = normalizeSpace(matchedVehicle.dealershipId);
  if (!dealershipId) return album;
  const knownDealership = oregansDealerships.find((candidate) => candidate.id === dealershipId) || null;
  const dealershipName = normalizeSpace(matchedVehicle.dealershipName)
    || knownDealership?.name
    || album?.dealership?.name
    || "";
  const inventoryTypeId = normalizeSpace(matchedVehicle.inventoryTypeId) || album?.inventoryTypeId;

  return {
    ...album,
    vehicle: {
      ...(album?.vehicle || {}),
      dealershipId,
      dealershipName,
      inventoryTypeId,
    },
    dealership: {
      ...(album?.dealership || {}),
      ...(knownDealership || {}),
      id: dealershipId,
      name: dealershipName,
    },
    inventoryTypeId,
  };
}

async function inventoryStatusForAlbum(album) {
  const vehicle = album?.vehicle || {};
  const source = normalizeSpace(vehicle.source || "oregans").toLowerCase();
  const facebookListing = await facebookListingStatusForAlbum(album);
  if (source === "manual") {
    return {
      source: "manual",
      status: "manual",
      active: null,
      checkedAt: null,
      label: "Manual entry, not checked against O'Regan's inventory.",
      facebookListing,
      lifecycle: inventoryLifecycleState({ sourceStatus: "manual", album, facebookListing }),
    };
  }

  const dealershipId = normalizeSpace(vehicle.dealershipId || album?.dealership?.id);
  const inventoryTypeId = normalizeSpace(vehicle.inventoryTypeId || album?.inventoryTypeId || defaultInventoryTypeId);
  if (!dealershipId || !inventoryTypeId) {
    return {
      source: "oregans",
      status: "unknown",
      active: null,
      checkedAt: null,
      label: "O'Regan's inventory status is unavailable.",
      facebookListing,
      lifecycle: inventoryLifecycleState({ sourceStatus: "unknown", album, facebookListing }),
    };
  }

  try {
    const inventory = await fetchInventoryCarsSnapshot({ dealershipId, inventoryTypeId });
    const matchedCar = inventory.cars.find((car) => inventoryCarMatchesAlbum(car, album));
    const checkedAt = inventory.fetchedAtIso || new Date(inventory.fetchedAt || Date.now()).toISOString();
    const reappearedVehicle = matchedCar
      ? null
      : currentInventorySnapshotReappearedVehicleForAlbum(album);
    const recentlyConfirmedVehicle = matchedCar || reappearedVehicle
      ? null
      : recentInventorySnapshotVehicleForAlbum(album, checkedAt);
    const temporarilyMissing = !matchedCar && !reappearedVehicle && Boolean(recentlyConfirmedVehicle);
    const sourceActive = Boolean(matchedCar || reappearedVehicle || temporarilyMissing);
    const matchedVehicle = matchedCar
      ? {
          ...matchedCar,
          dealershipId: normalizeSpace(matchedCar?.dealership?.id),
          dealershipName: normalizeSpace(matchedCar?.dealership?.name),
          inventoryTypeId,
        }
      : reappearedVehicle
        ? publicOregansInventorySnapshotVehicleFromRow(reappearedVehicle)
        : null;
    return {
      source: "oregans",
      status: matchedCar || reappearedVehicle ? "active" : temporarilyMissing ? "temporarily_missing" : "missing",
      active: sourceActive,
      checkedAt,
      label: matchedCar
        ? `Active in O'Regan's inventory as of ${checkedAt}.`
        : reappearedVehicle
          ? `Active in O'Regan's inventory under stock ${normalizeSpace(reappearedVehicle.stock_number) || "unknown"} at ${normalizeSpace(reappearedVehicle.dealership_name) || "another O'Regan's dealership"} as of ${reappearedVehicle.last_seen_at || checkedAt}.`
        : temporarilyMissing
          ? `Temporarily absent from O'Regan's inventory feed as of ${checkedAt}; last confirmed active at ${recentlyConfirmedVehicle.last_seen_at}. Waiting for the next successful refresh.`
          : `No longer active in O'Regan's inventory as of ${checkedAt}.`,
      matchedInventoryKey: matchedCar?.inventoryKey || matchedCar?.vin || reappearedVehicle?.vin || reappearedVehicle?.vehicle_key || recentlyConfirmedVehicle?.vin || "",
      matchedStockNumber: matchedCar?.stockNumber || reappearedVehicle?.stock_number || recentlyConfirmedVehicle?.stock_number || "",
      matchedDealershipId: matchedCar?.dealership?.id || reappearedVehicle?.dealership_id || dealershipId,
      matchedDealershipName: matchedCar?.dealership?.name || reappearedVehicle?.dealership_name || album?.dealership?.name || "",
      matchedVehicle,
      stockNumberChanged: Boolean(reappearedVehicle && normalizeSpace(reappearedVehicle.stock_number).toUpperCase() !== normalizeSpace(vehicle.stockNumber).toUpperCase()),
      dealershipChanged: Boolean(reappearedVehicle && normalizeSpace(reappearedVehicle.dealership_id) !== dealershipId),
      lastConfirmedAt: reappearedVehicle?.last_seen_at || recentlyConfirmedVehicle?.last_seen_at || "",
      facebookListing,
      lifecycle: inventoryLifecycleState({
        sourceStatus: sourceActive ? "source_active" : "source_removed",
        sourceTemporarilyMissing: temporarilyMissing,
        album,
        checkedAt,
        facebookListing,
      }),
    };
  } catch (error) {
    return {
      source: "oregans",
      status: "unknown",
      active: null,
      checkedAt: null,
      label: "O'Regan's inventory check is temporarily unavailable.",
      facebookListing,
      lifecycle: inventoryLifecycleState({ sourceStatus: "unknown", album, facebookListing }),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function inventoryLifecycleState({ sourceStatus, sourceTemporarilyMissing = false, album, checkedAt = null, facebookListing = null }) {
  const hasPackagePhotos = Number(album?.mediaCount || 0) > 0;
  const packageStatus = sourceActivePackageStatus(album);
  const facebookPackageReady = packageStatus === "facebook_ready";
  const trustedFacebookListing = trustedFacebookListingStatus(facebookListing);
  if (sourceStatus === "manual") {
    return {
      sourceStatus: "manual",
      packageStatus: hasPackagePhotos ? "photo_matched" : "needs_photos",
      facebookState: "do_not_post",
      facebookAction: "manual_review",
      shouldMarkFacebookSold: false,
      canPostToFacebook: false,
      checkedAt,
    };
  }

  if (sourceStatus === "source_removed") {
    if (trustedFacebookListing?.state === "sold" || trustedFacebookListing?.state === "removed" || trustedFacebookListing?.state === "not_live") {
      return {
        sourceStatus: "source_removed",
        packageStatus: hasPackagePhotos ? "source_removed_package" : "needs_photos",
        facebookState: trustedFacebookListing.state === "not_live" ? "not_live" : "sold_on_facebook",
        facebookAction: trustedFacebookListing.state === "not_live" ? "skip_no_live_listing" : "already_sold",
        shouldMarkFacebookSold: false,
        canPostToFacebook: false,
        checkedAt,
      };
    }
    if (trustedFacebookListing?.state === "live") {
      return {
        sourceStatus: "source_removed",
        packageStatus: hasPackagePhotos ? "source_removed_package" : "needs_photos",
        facebookState: "stale_on_facebook",
        facebookAction: "mark_sold",
        shouldMarkFacebookSold: true,
        canPostToFacebook: false,
        checkedAt,
      };
    }
    return {
      sourceStatus: "source_removed",
      packageStatus: hasPackagePhotos ? "source_removed_package" : "needs_photos",
      facebookState: "facebook_verification_required",
      facebookAction: "verify_facebook_before_mark_sold",
      shouldMarkFacebookSold: false,
      canPostToFacebook: false,
      checkedAt,
    };
  }

  if (sourceStatus === "source_active") {
    if (sourceTemporarilyMissing) {
      const temporaryOverride = sourceActiveTemporarilyMissingFacebookLifecycleOverride(facebookListing, { packageStatus, checkedAt });
      if (temporaryOverride) return temporaryOverride;
    }
    const facebookOverride = sourceActiveFacebookLifecycleOverride(trustedFacebookListing, { packageStatus, checkedAt });
    if (facebookOverride) return facebookOverride;
    const staleFacebookOverride = sourceActiveStaleFacebookLifecycleOverride(facebookListing, { packageStatus, checkedAt });
    if (staleFacebookOverride) return staleFacebookOverride;
    const uploadInProgress = packageStatus === "upload_in_progress";
    return {
      sourceStatus: "source_active",
      packageStatus,
      facebookState: facebookPackageReady ? "ready_to_post" : packageStatus,
      facebookAction: facebookPackageReady ? "post_if_not_live" : uploadInProgress ? "wait_for_upload" : "capture_photos",
      shouldMarkFacebookSold: false,
      canPostToFacebook: facebookPackageReady,
      checkedAt,
    };
  }

  return {
    sourceStatus: "unknown",
    packageStatus: hasPackagePhotos ? "photo_matched" : "needs_photos",
    facebookState: "unknown",
    facebookAction: "review",
    shouldMarkFacebookSold: false,
    canPostToFacebook: false,
    checkedAt,
  };
}

function sourceActiveTemporarilyMissingFacebookLifecycleOverride(facebookListing, { packageStatus, checkedAt }) {
  const facebookOverride = sourceActiveFacebookLifecycleOverride(trustedFacebookListingStatus(facebookListing), { packageStatus, checkedAt });
  if (facebookOverride) return facebookOverride;
  const staleFacebookOverride = sourceActiveStaleFacebookLifecycleOverride(facebookListing, { packageStatus, checkedAt });
  if (staleFacebookOverride) return staleFacebookOverride;
  return {
    sourceStatus: "source_active",
    packageStatus,
    facebookState: "source_recheck_pending",
    facebookAction: "hold_source_recheck",
    shouldMarkFacebookSold: false,
    canPostToFacebook: false,
    checkedAt,
  };
}

function sourceActivePackageStatus(album) {
  const photoCount = Number(album?.photoCount || 0);
  if (vehicleUploadInProgressForAlbum(album)) return "upload_in_progress";
  if (photoCount >= facebookMinimumPhotoCount) return "facebook_ready";
  return photoCount > 0 ? "needs_more_photos" : "needs_photos";
}

function vehicleUploadInProgressForAlbum(album) {
  if (!album?.vehicle) return false;
  return vehicleUploadWritePromises.has(vehicleUploadLockKey(album.vehicle));
}

function sourceActiveStaleFacebookLifecycleOverride(facebookListing, { packageStatus, checkedAt }) {
  if (!facebookListing?.stale) return null;
  const facebookPackageReady = packageStatus === "facebook_ready";
  return {
    sourceStatus: "source_active",
    packageStatus,
    facebookState: "stale_facebook_evidence",
    facebookAction: facebookPackageReady ? "recheck_facebook_before_post" : packageStatus === "upload_in_progress" ? "wait_for_upload" : "capture_photos",
    shouldMarkFacebookSold: false,
    canPostToFacebook: false,
    checkedAt,
  };
}

function sourceActiveFacebookLifecycleOverride(facebookListing, { packageStatus, checkedAt }) {
  if (!facebookListing) return null;
  if (facebookListing.state === "live") {
    return {
      sourceStatus: "source_active",
      packageStatus,
      facebookState: "live_on_facebook",
      facebookAction: "skip_already_live",
      shouldMarkFacebookSold: false,
      canPostToFacebook: false,
      checkedAt,
    };
  }
  if (facebookListing.state === "duplicate_blocked") {
    return {
      sourceStatus: "source_active",
      packageStatus,
      facebookState: "duplicate_blocked",
      facebookAction: "review_duplicate_live_evidence",
      shouldMarkFacebookSold: false,
      canPostToFacebook: false,
      checkedAt,
    };
  }
  if (facebookListing.state === "sold") {
    return {
      sourceStatus: "source_active",
      packageStatus,
      facebookState: "sold_match_needs_review",
      facebookAction: "review_sold_match",
      shouldMarkFacebookSold: false,
      canPostToFacebook: false,
      checkedAt,
    };
  }
  if (facebookListing.state === "publish_blocked") {
    return {
      sourceStatus: "source_active",
      packageStatus,
      facebookState: "publish_blocked",
      facebookAction: "review",
      shouldMarkFacebookSold: false,
      canPostToFacebook: false,
      checkedAt,
    };
  }
  return null;
}

function trustedFacebookListingStatus(facebookListing) {
  if (!facebookListing || facebookListing.stale) return null;
  return facebookListing;
}

function operationsSummaryFromAlbums(albums = []) {
  const counts = {
    totalCpcAlbums: albums.length,
    sourceActiveCpcAlbums: 0,
    sourceRemovedCpcAlbums: 0,
    facebookLive: 0,
    readyToPublish: 0,
    staleFacebookVerification: 0,
    awaitingKonnerUpload: 0,
    needsReview: 0,
    readyToPublishItems: [],
  };

  for (const album of albums) {
    const status = album?.inventoryStatus || {};
    const lifecycle = status.lifecycle || {};
    const facebookState = lifecycle.facebookState || status.facebookListing?.state || "";
    const action = lifecycle.facebookAction || "";
    const sourceStatus = lifecycle.sourceStatus || "";

    if (sourceStatus === "source_active" || status.active === true || status.status === "active") {
      counts.sourceActiveCpcAlbums += 1;
    }
    if (sourceStatus === "source_removed" || status.active === false || status.status === "missing") {
      counts.sourceRemovedCpcAlbums += 1;
    }
    if (["live", "live_on_facebook"].includes(facebookState)) counts.facebookLive += 1;
    if (action === "post_if_not_live" && lifecycle.canPostToFacebook === true) {
      counts.readyToPublish += 1;
      const vehicle = album?.vehicle || {};
      counts.readyToPublishItems.push({
        albumId: normalizeSpace(album?.id),
        stockNumber: normalizeSpace(vehicle.stockNumber || album?.inventoryNumber),
        vin: normalizeSpace(vehicle.vin).toUpperCase(),
        dealershipId: normalizeSpace(vehicle.dealershipId || album?.dealershipId),
        inventoryTypeId: normalizeSpace(album?.inventoryTypeId || vehicle.inventoryTypeId),
        mediaCount: Number(album?.mediaCount || 0),
        updatedAt: normalizeIsoDate(album?.updatedAt) || "",
      });
    }
    if (facebookState === "stale_facebook_evidence" || action === "recheck_facebook_before_post") {
      counts.staleFacebookVerification += 1;
    }
    if (["capture_photos", "wait_for_upload"].includes(action)) counts.awaitingKonnerUpload += 1;
    if (action === "manual_review" || action === "review" || action === "verify_facebook_before_mark_sold") {
      counts.needsReview += 1;
    }
  }

  counts.readyToPublishItems.sort((left, right) => (
    left.albumId.localeCompare(right.albumId)
      || left.stockNumber.localeCompare(right.stockNumber)
      || left.vin.localeCompare(right.vin)
  ));
  return counts;
}

function operationsAutomationSignals(albums = []) {
  const cpcPackages = albums.map((album) => {
    const vehicle = album?.vehicle || {};
    return {
      albumId: normalizeSpace(album?.id),
      stockNumber: normalizeSpace(vehicle.stockNumber || album?.inventoryNumber).toUpperCase(),
      vin: normalizeSpace(vehicle.vin).toUpperCase(),
      dealershipId: normalizeSpace(vehicle.dealershipId || album?.dealership?.id),
      inventoryTypeId: normalizeSpace(album?.inventoryTypeId || vehicle.inventoryTypeId),
      mediaCount: Number(album?.mediaCount || 0),
      photoCount: Number(album?.photoCount || 0),
      videoCount: Number(album?.videoCount || 0),
      updatedAt: normalizeIsoDate(album?.updatedAt) || "",
    };
  }).sort((left, right) => (
    left.albumId.localeCompare(right.albumId)
      || left.stockNumber.localeCompare(right.stockNumber)
      || left.vin.localeCompare(right.vin)
  ));

  const trackedScopes = new Set(oregansInventorySnapshotScopes().map((scope) => (
    inventorySnapshotScopeKey(scope)
  )));
  const inventoryRows = oregansInventorySnapshotsDb.prepare(`
    SELECT *
    FROM oregans_inventory_vehicles
    WHERE present = 1
    ORDER BY dealership_id, inventory_type_id, stock_number, vehicle_key
  `).all().filter((row) => trackedScopes.has(inventorySnapshotScopeKey({
    dealershipId: row.dealership_id,
    inventoryTypeId: row.inventory_type_id,
  })));

  const membership = inventoryRows.map((row) => ({
    vehicleKey: normalizeSpace(row.vehicle_key),
    vin: normalizeSpace(row.vin).toUpperCase(),
    stockNumber: normalizeSpace(row.stock_number).toUpperCase(),
    dealershipId: normalizeSpace(row.dealership_id),
    inventoryTypeId: normalizeSpace(row.inventory_type_id),
  }));
  const prices = inventoryRows.map((row) => ({
    vehicleKey: normalizeSpace(row.vehicle_key),
    price: normalizeSpace(row.price),
    priceValue: nullableFiniteNumber(row.price_value),
  }));
  const details = inventoryRows.map((row) => ({
    vehicleKey: normalizeSpace(row.vehicle_key),
    title: normalizeSpace(row.title),
    year: normalizeSpace(row.year),
    make: normalizeSpace(row.make),
    model: normalizeSpace(row.model),
    trim: normalizeSpace(row.trim),
    odometer: normalizeSpace(row.odometer),
    odometerValue: nullableFiniteNumber(row.odometer_value),
    exteriorColor: normalizeSpace(row.exterior_color),
    interiorColor: normalizeSpace(row.interior_color),
    bodyStyle: normalizeSpace(row.body_style),
    fuelType: normalizeSpace(row.fuel_type),
    transmission: normalizeSpace(row.transmission),
    detailUrl: normalizeSpace(row.detail_url),
  }));
  const latestRun = oregansInventorySnapshotsDb.prepare(`
    SELECT id, status, finished_at
    FROM oregans_inventory_snapshot_runs
    ORDER BY started_at DESC
    LIMIT 1
  `).get();
  const latestMembershipChange = oregansInventorySnapshotsDb.prepare(`
    SELECT id, finished_at, new_inventory_count, removed_inventory_count
    FROM oregans_inventory_snapshot_runs
    WHERE new_inventory_count > 0 OR removed_inventory_count > 0
    ORDER BY started_at DESC
    LIMIT 1
  `).get();
  const latestPriceChange = oregansInventorySnapshotsDb.prepare(`
    SELECT id, finished_at, price_change_count
    FROM oregans_inventory_snapshot_runs
    WHERE price_change_count > 0
    ORDER BY started_at DESC
    LIMIT 1
  `).get();
  const latestDetailsChange = oregansInventorySnapshotsDb.prepare(`
    SELECT id, finished_at, details_change_count
    FROM oregans_inventory_snapshot_runs
    WHERE details_change_count > 0
    ORDER BY started_at DESC
    LIMIT 1
  `).get();

  return {
    version: 1,
    cpc: {
      packageFingerprint: hashJson(cpcPackages),
      albumCount: cpcPackages.length,
    },
    oregans: {
      membershipFingerprint: hashJson(membership),
      priceFingerprint: hashJson(prices),
      detailsFingerprint: hashJson(details),
      presentCount: inventoryRows.length,
      latestRunId: normalizeSpace(latestRun?.id),
      latestRunStatus: normalizeSpace(latestRun?.status),
      latestRunFinishedAt: normalizeIsoDate(latestRun?.finished_at) || "",
      latestMembershipChangeRunId: normalizeSpace(latestMembershipChange?.id),
      latestMembershipChangeFinishedAt: normalizeIsoDate(latestMembershipChange?.finished_at) || "",
      latestMembershipChangeCounts: {
        added: Number(latestMembershipChange?.new_inventory_count || 0),
        removed: Number(latestMembershipChange?.removed_inventory_count || 0),
      },
      latestPriceChangeRunId: normalizeSpace(latestPriceChange?.id),
      latestPriceChangeFinishedAt: normalizeIsoDate(latestPriceChange?.finished_at) || "",
      latestPriceChangeCount: Number(latestPriceChange?.price_change_count || 0),
      latestDetailsChangeRunId: normalizeSpace(latestDetailsChange?.id),
      latestDetailsChangeFinishedAt: normalizeIsoDate(latestDetailsChange?.finished_at) || "",
      latestDetailsChangeCount: Number(latestDetailsChange?.details_change_count || 0),
    },
  };
}

async function recordAlbumInventoryLifecycle(album, inventoryStatus) {
  const lifecycle = inventoryStatus?.lifecycle || {};
  if (!album?.id || inventoryStatus?.source !== "oregans") return;
  if (!["source_active", "source_removed"].includes(lifecycle.sourceStatus)) return;

  await updateInventoryLifecycleStore((store) => {
    const now = new Date().toISOString();
    const previous = store.albums[album.id] || {};
    const facebookListing = normalizeStoredFacebookListingStatus(inventoryStatus.facebookListing || previous.facebookListing);
    const isRemoved = lifecycle.sourceStatus === "source_removed";
    const vehicle = album.vehicle || {};
    const record = {
      ...previous,
      albumId: album.id,
      albumName: album.name || "",
      status: inventoryStatus.status,
      active: inventoryStatus.active,
      checkedAt: inventoryStatus.checkedAt || now,
      lastObservedAt: now,
      facebookListing,
      lifecycle,
      vehicle: {
        inventoryKey: normalizeSpace(vehicle.inventoryKey || vehicle.vin || vehicle.manualInventoryId),
        vin: normalizeSpace(vehicle.vin),
        stockNumber: normalizeSpace(vehicle.stockNumber),
        title: normalizeSpace(vehicle.title || album.name),
        dealershipId: normalizeSpace(vehicle.dealershipId || album.dealership?.id),
        dealershipName: normalizeSpace(vehicle.dealershipName || album.dealership?.name),
      },
    };

    if (isRemoved) {
      record.firstRemovedAt = previous.firstRemovedAt || now;
    } else {
      record.firstRemovedAt = "";
      record.removedNotifiedAt = "";
    }

    store.albums[album.id] = record;
  });
}

async function facebookListingStatusForAlbum(album) {
  if (!album?.id) return null;
  const albumId = cleanAlbumId(album.id);
  const store = await readInventoryLifecycleStore();
  const record = store.albums[albumId];
  return facebookListingStatusForRecord(record, album);
}

function facebookListingStatusForRecord(record, album = null) {
  const facebookListing = normalizeStoredFacebookListingStatus(record?.facebookListing);
  if (!facebookListing) return null;
  const albumId = normalizeOptionalAlbumId(album?.id || record?.albumId);
  if (albumId && facebookListing.albumId && facebookListing.albumId !== albumId) return null;
  return {
    ...facebookListing,
    stale: facebookListingStatusIsStale(facebookListing),
  };
}

async function recordAlbumFacebookListingStatus(album, payload, actor = null) {
  if (!album?.id) throw httpError(404, "Album not found.");
  const albumId = cleanAlbumId(album.id);
  const facebookListing = normalizeFacebookListingStatusPayload(payload, { album, actor });
  return updateInventoryLifecycleStore((store) => {
    const previous = store.albums[albumId] || {};
    const vehicle = album.vehicle || {};
    const now = new Date().toISOString();
    const record = {
      ...previous,
      albumId,
      albumName: album.name || previous.albumName || "",
      lastObservedAt: now,
      facebookListing,
      vehicle: {
        ...normalizeInventoryLifecycleVehicle(previous.vehicle),
        inventoryKey: normalizeSpace(vehicle.inventoryKey || vehicle.vin || vehicle.manualInventoryId || previous.vehicle?.inventoryKey),
        vin: normalizeSpace(vehicle.vin || previous.vehicle?.vin),
        stockNumber: normalizeSpace(vehicle.stockNumber || previous.vehicle?.stockNumber),
        title: normalizeSpace(vehicle.title || album.name || previous.vehicle?.title),
        dealershipId: normalizeSpace(vehicle.dealershipId || album.dealership?.id || previous.vehicle?.dealershipId),
        dealershipName: normalizeSpace(vehicle.dealershipName || album.dealership?.name || previous.vehicle?.dealershipName),
      },
    };
    store.albums[albumId] = record;
    return facebookListing;
  });
}

function normalizeFacebookListingStatusPayload(value = {}, { album = null, actor = null } = {}) {
  const state = normalizeFacebookListingState(value.state || value.facebookState);
  if (!state) throw httpError(400, "Facebook listing state is required.");
  const now = new Date().toISOString();
  const verifiedAt = normalizeIsoDate(value.verifiedAt || value.checkedAt) || now;
  const staleAfter = normalizeIsoDate(value.staleAfter) || new Date(Date.parse(verifiedAt) + facebookListingVerificationTtlMs).toISOString();
  const record = normalizeStoredFacebookListingStatus({
    albumId: album?.id || value.albumId,
    state,
    listingId: value.listingId || value.marketplaceId,
    listingUrl: value.listingUrl || value.url,
    title: value.title,
    price: value.price,
    listingStatus: value.listingStatus || value.status,
    sellerName: value.sellerName || value.seller,
    matchedBy: value.matchedBy || value.match?.matchedBy,
    matchConfidence: value.matchConfidence || value.confidence || value.match?.confidence,
    ambiguous: value.ambiguous || value.match?.ambiguous || state === "duplicate_blocked",
    source: value.source,
    thumbnailLabel: value.thumbnailLabel || value.thumbnail || value.firstPhoto,
    proofPath: value.proofPath || value.proof || value.screenshotPath,
    notes: value.notes || value.reason,
    verifiedAt,
    staleAfter,
    updatedAt: now,
    updatedBy: publicUploader(actor),
  });
  if (!record) throw httpError(400, "Facebook listing state is invalid.");
  if (["live", "sold", "removed"].includes(record.state) && !record.listingId && !record.listingUrl && !record.title) {
    throw httpError(400, "Facebook listing evidence is required for that state.");
  }
  if (record.state === "duplicate_blocked" && !record.title && !record.notes) {
    throw httpError(400, "Duplicate-blocked state requires visible listing evidence or notes.");
  }
  return record;
}

function normalizeStoredFacebookListingStatus(value = {}) {
  if (!value || typeof value !== "object") return null;
  const state = normalizeFacebookListingState(value.state || value.facebookState);
  if (!state) return null;
  const verifiedAt = normalizeIsoDate(value.verifiedAt || value.checkedAt || value.updatedAt);
  const updatedAt = normalizeIsoDate(value.updatedAt) || verifiedAt || "";
  const staleAfter = normalizeIsoDate(value.staleAfter)
    || (verifiedAt ? new Date(Date.parse(verifiedAt) + facebookListingVerificationTtlMs).toISOString() : "");
  const listingUrl = cleanExternalHttpUrl(value.listingUrl || value.url);
  return {
    albumId: normalizeOptionalAlbumId(value.albumId),
    state,
    verifiedAt: verifiedAt || "",
    staleAfter,
    stale: facebookListingStatusIsStale({ verifiedAt, staleAfter }),
    listingId: normalizeSpace(value.listingId || value.marketplaceId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120),
    listingUrl,
    title: normalizeSpace(value.title).slice(0, 220),
    price: normalizeSpace(value.price).slice(0, 80),
    listingStatus: normalizeSpace(value.listingStatus || value.status).slice(0, 80),
    sellerName: normalizeSpace(value.sellerName || value.seller).slice(0, 120),
    matchedBy: normalizeFacebookMatchedBy(value.matchedBy || value.match?.matchedBy),
    matchConfidence: normalizeFacebookMatchConfidence(value.matchConfidence || value.confidence || value.match?.confidence),
    ambiguous: Boolean(value.ambiguous || value.match?.ambiguous || state === "duplicate_blocked"),
    source: normalizeSpace(value.source).slice(0, 120),
    thumbnailLabel: normalizeSpace(value.thumbnailLabel || value.thumbnail || value.firstPhoto).slice(0, 220),
    proofPath: normalizeSpace(value.proofPath || value.proof || value.screenshotPath).slice(0, 500),
    notes: normalizeSpace(value.notes || value.reason).slice(0, 500),
    updatedAt,
    updatedBy: publicUploader(value.updatedBy),
  };
}

function normalizeOptionalAlbumId(value) {
  const albumId = String(value || "").trim();
  if (!albumId) return "";
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(albumId) && !albumId.includes("..") ? albumId.toLowerCase() : "";
}

function normalizeFacebookListingState(value) {
  const state = normalizeSpace(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!state) return "";
  if (["live", "active", "listed", "list", "live_on_facebook", "already_live"].includes(state)) return "live";
  if (["not_live", "no_live", "no_match", "none", "missing", "not_found"].includes(state)) return "not_live";
  if (["sold", "sold_on_facebook", "already_sold"].includes(state)) return "sold";
  if (["removed", "deleted", "taken_down"].includes(state)) return "removed";
  if (["duplicate", "duplicate_blocked", "ambiguous", "ambiguous_live", "ambiguous_match"].includes(state)) return "duplicate_blocked";
  if (["blocked", "publish_blocked", "review", "needs_review"].includes(state)) return "publish_blocked";
  if (state === "unknown") return "unknown";
  return "";
}

function normalizeFacebookMatchedBy(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,|]/);
  return items
    .map((item) => normalizeSpace(item).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, ""))
    .filter(Boolean)
    .slice(0, 8)
    .join(",");
}

function normalizeFacebookMatchConfidence(value) {
  const confidence = normalizeSpace(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["exact", "high", "medium", "low", "unknown"].includes(confidence)) return confidence;
  return "";
}

function facebookListingStatusIsStale(value = {}) {
  const staleAfterMs = Date.parse(value.staleAfter || "");
  if (Number.isFinite(staleAfterMs)) return Date.now() > staleAfterMs;
  const verifiedAtMs = Date.parse(value.verifiedAt || "");
  return Number.isFinite(verifiedAtMs) ? Date.now() > verifiedAtMs + facebookListingVerificationTtlMs : true;
}

async function readInventoryLifecycleStore() {
  return normalizeInventoryLifecycleStore(await readJson(inventoryLifecyclePath, { albums: {} }));
}

async function updateInventoryLifecycleStore(mutator) {
  inventoryLifecycleWritePromise = inventoryLifecycleWritePromise.catch(() => {}).then(async () => {
    const store = await readInventoryLifecycleStore();
    const result = await mutator(store);
    await writeJson(inventoryLifecyclePath, store);
    return result;
  });
  return inventoryLifecycleWritePromise;
}

function normalizeInventoryLifecycleStore(value) {
  const albums = value?.albums && typeof value.albums === "object" ? value.albums : {};
  const normalized = { albums: {} };
  for (const [rawAlbumId, rawRecord] of Object.entries(albums)) {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(rawAlbumId) || rawAlbumId.includes("..")) continue;
    const albumId = rawAlbumId.toLowerCase();
    const lifecycle = rawRecord?.lifecycle && typeof rawRecord.lifecycle === "object" ? rawRecord.lifecycle : {};
    normalized.albums[albumId] = {
      albumId,
      albumName: normalizeSpace(rawRecord?.albumName).slice(0, 160),
      status: normalizeSpace(rawRecord?.status).slice(0, 40),
      active: typeof rawRecord?.active === "boolean" ? rawRecord.active : null,
      checkedAt: normalizeIsoDate(rawRecord?.checkedAt) || "",
      lastObservedAt: normalizeIsoDate(rawRecord?.lastObservedAt) || "",
      firstRemovedAt: normalizeIsoDate(rawRecord?.firstRemovedAt) || "",
      removedNotifiedAt: normalizeIsoDate(rawRecord?.removedNotifiedAt) || "",
      facebookListing: normalizeStoredFacebookListingStatus(rawRecord?.facebookListing),
      lifecycle: {
        sourceStatus: normalizeSpace(lifecycle.sourceStatus).slice(0, 60),
        packageStatus: normalizeSpace(lifecycle.packageStatus).slice(0, 60),
        facebookState: normalizeSpace(lifecycle.facebookState).slice(0, 60),
        facebookAction: normalizeSpace(lifecycle.facebookAction).slice(0, 60),
        shouldMarkFacebookSold: Boolean(lifecycle.shouldMarkFacebookSold),
        canPostToFacebook: Boolean(lifecycle.canPostToFacebook),
        checkedAt: normalizeIsoDate(lifecycle.checkedAt) || "",
      },
      vehicle: normalizeInventoryLifecycleVehicle(rawRecord?.vehicle),
    };
  }
  return normalized;
}

function normalizeInventoryLifecycleVehicle(value = {}) {
  return {
    inventoryKey: normalizeSpace(value.inventoryKey).slice(0, 120),
    vin: normalizeSpace(value.vin).slice(0, 40),
    stockNumber: normalizeSpace(value.stockNumber).slice(0, 80),
    title: normalizeSpace(value.title).slice(0, 160),
    dealershipId: normalizeSpace(value.dealershipId).slice(0, 40),
    dealershipName: normalizeSpace(value.dealershipName).slice(0, 120),
  };
}

function inventoryCarMatchesAlbum(car, album) {
  const vehicle = album?.vehicle || {};
  const carKey = normalizeSpace(car?.inventoryKey || car?.vin || car?.manualInventoryId).toUpperCase();
  const albumKey = normalizeSpace(vehicle.inventoryKey || vehicle.vin || vehicle.manualInventoryId).toUpperCase();
  if (carKey && albumKey && carKey === albumKey) return true;

  const carVin = normalizeSpace(car?.vin).toUpperCase();
  const albumVin = normalizeSpace(vehicle.vin).toUpperCase();
  if (carVin && albumVin && carVin === albumVin) return true;

  const carStock = normalizeSpace(car?.stockNumber).toUpperCase();
  const albumStock = normalizeSpace(vehicle.stockNumber).toUpperCase();
  return Boolean(carStock && albumStock && carStock === albumStock);
}

function currentInventorySnapshotReappearedVehicleForAlbum(album) {
  const vehicle = album?.vehicle || {};
  const vin = normalizeSpace(vehicle.vin).toUpperCase();
  if (!vin) return null;

  const dealershipId = normalizeSpace(vehicle.dealershipId || album?.dealership?.id);
  const inventoryTypeId = normalizeSpace(vehicle.inventoryTypeId || album?.inventoryTypeId || defaultInventoryTypeId);
  const stockNumber = normalizeSpace(vehicle.stockNumber).toUpperCase();
  const rows = oregansInventorySnapshotsDb.prepare(`
    SELECT *
    FROM oregans_inventory_vehicles
    WHERE UPPER(vin) = ?
      AND present = 1
    ORDER BY last_seen_at DESC
  `).all(vin);

  return rows.find((row) => (
    normalizeSpace(row?.dealership_id) !== dealershipId
    || normalizeSpace(row?.inventory_type_id) !== inventoryTypeId
    || normalizeSpace(row?.stock_number).toUpperCase() !== stockNumber
  )) || null;
}

function recentInventorySnapshotVehicleForAlbum(album, checkedAt) {
  if (!inventoryRemovalGraceMs) return null;
  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) return null;
  const cutoff = new Date(checkedAtMs - inventoryRemovalGraceMs).toISOString();
  const vehicle = album?.vehicle || {};
  const dealershipId = normalizeSpace(vehicle.dealershipId || album?.dealership?.id);
  const inventoryTypeId = normalizeSpace(vehicle.inventoryTypeId || album?.inventoryTypeId || defaultInventoryTypeId);
  if (!dealershipId || !inventoryTypeId) return null;
  const rows = oregansInventorySnapshotsDb.prepare(`
    SELECT *
    FROM oregans_inventory_vehicles
    WHERE dealership_id = ?
      AND inventory_type_id = ?
      AND present = 1
      AND last_seen_at >= ?
    ORDER BY last_seen_at DESC
  `).all(dealershipId, inventoryTypeId, cutoff);
  return rows.find((row) => inventorySnapshotVehicleMatchesAlbum(row, album)) || null;
}

function inventorySnapshotVehicleMatchesAlbum(row, album) {
  const vehicle = album?.vehicle || {};
  const albumValues = [vehicle.inventoryKey, vehicle.vin, vehicle.stockNumber]
    .map((value) => normalizeSpace(value).toUpperCase())
    .filter(Boolean);
  const rowValues = [row?.vin, row?.stock_number]
    .map((value) => normalizeSpace(value).toUpperCase())
    .filter(Boolean);
  return albumValues.some((value) => rowValues.includes(value));
}

async function ensureCarAlbum(car, user = null) {
  const targetAlbumId = carAlbumId(car);
  await migrateLegacyCarAlbum(car, targetAlbumId);
  const albumId = await reusableVehicleAlbumId(car, targetAlbumId);
  const directory = albumPath(albumId);
  await fs.mkdir(directory, { recursive: true });
  await writeCarAlbumMetadata(albumId, car, user);
  const photoMetadataPath = path.join(directory, ".photos.json");
  await fs.access(photoMetadataPath).catch(async (error) => {
    if (error?.code !== "ENOENT") throw error;
    await writeJson(photoMetadataPath, {});
  });
  return readAlbum(albumId);
}

async function writeCarAlbumMetadata(albumId, car, user = null) {
  const existing = await readAlbumMetadata(albumId);
  const inventoryNumber = albumInventoryNumberFromCar(car) || albumInventoryNumberFromMetadata(existing);
  const albumPrefix = albumObjectStoragePrefixForCar(albumId, car, existing);
  const createdBy = publicUploader(existing.createdBy) || publicUploader(user);
  const updatedBy = publicUploader(user) || publicUploader(existing.updatedBy) || createdBy;
  const detailUrl = sanitizedOregansDetailUrl(car.detailUrl, car.source);
  await writeJson(path.join(albumPath(albumId), ".album.json"), {
    id: albumId,
    name: car.albumName,
    inventoryNumber,
    objectStoragePrefix: albumPrefix,
    storage: albumStorageInfo(albumId, { ...existing, objectStoragePrefix: albumPrefix }),
    createdAt: existing.createdAt || new Date().toISOString(),
    createdBy,
    updatedAt: new Date().toISOString(),
    updatedBy,
    dealership: car.dealership,
    inventoryTypeId: car.inventoryTypeId,
    sourceUrl: detailUrl,
    vehicle: {
      source: car.source || "oregans",
      inventoryKey: car.inventoryKey || car.vin,
      manualInventoryId: car.manualInventoryId || "",
      vin: car.vin,
      stockNumber: car.stockNumber,
      title: car.title,
      year: car.year,
      make: car.make,
      model: car.model,
      trim: car.trim,
      price: car.price,
      priceValue: car.priceValue ?? parseCurrency(car.price),
      odometer: car.odometer,
      exteriorColor: car.exteriorColor,
      interiorColor: car.interiorColor,
      bodyStyle: car.bodyStyle,
      fuelType: car.fuelType,
      transmission: car.transmission,
      descriptionPreview: car.descriptionPreview,
      detailUrl,
      dealershipId: car.dealership.id,
      dealershipName: car.dealership.name,
    },
  });
}

async function reusableVehicleAlbumId(car, targetAlbumId) {
  const candidates = await vehicleAlbumCandidates(car, targetAlbumId);
  if (!candidates.length) return availableVehicleAlbumId(car, targetAlbumId);

  candidates.sort((left, right) => {
    const mediaDelta = Number(right.mediaCount > 0) - Number(left.mediaCount > 0);
    if (mediaDelta) return mediaDelta;
    const targetDelta = Number(right.id === targetAlbumId) - Number(left.id === targetAlbumId);
    if (targetDelta) return targetDelta;
    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
  });
  return candidates[0].id;
}

async function findExistingVehicleAlbum(car) {
  const targetAlbumId = carAlbumId(car);
  const candidates = await vehicleAlbumCandidates(car, targetAlbumId);
  if (!candidates.length) return null;

  candidates.sort((left, right) => {
    const mediaDelta = Number(right.mediaCount > 0) - Number(left.mediaCount > 0);
    if (mediaDelta) return mediaDelta;
    const targetDelta = Number(right.id === targetAlbumId) - Number(left.id === targetAlbumId);
    if (targetDelta) return targetDelta;
    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
  });
  await writeCarAlbumMetadata(candidates[0].id, car);
  return readAlbum(candidates[0].id);
}

async function availableVehicleAlbumId(car, targetAlbumId) {
  const targetStats = await fs.stat(albumPath(targetAlbumId)).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!targetStats?.isDirectory()) return targetAlbumId;

  const targetMetadata = await readAlbumMetadata(targetAlbumId);
  if (!targetMetadata.vehicle || await albumMatchesVehicle(targetAlbumId, car)) return targetAlbumId;

  const preferred = vehicleSpecificAlbumId(car, targetAlbumId);
  for (const candidate of uniqueAlbumIdCandidates(preferred)) {
    const candidateStats = await fs.stat(albumPath(candidate)).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!candidateStats?.isDirectory()) return candidate;
    if (await albumMatchesVehicle(candidate, car)) return candidate;
  }

  throw httpError(409, "A different inventory record already uses this album name. Rename or clear that album before uploading.");
}

function vehicleSpecificAlbumId(car, targetAlbumId) {
  const key = slugify(car.inventoryKey || car.manualInventoryId || car.vin || car.stockNumber).slice(0, 18);
  if (!key) return targetAlbumId;
  const maxBaseLength = Math.max(1, 79 - key.length);
  const base = targetAlbumId.slice(0, maxBaseLength).replace(/-+$/g, "") || "car";
  return `${base}-${key}`.replace(/-+/g, "-").replace(/-+$/g, "").slice(0, 80);
}

function uniqueAlbumIdCandidates(preferred) {
  const candidates = [preferred];
  const base = preferred.slice(0, 76).replace(/-+$/g, "") || "car";
  for (let index = 2; index <= 50; index += 1) {
    candidates.push(`${base}-${index}`.slice(0, 80).replace(/-+$/g, ""));
  }
  return candidates;
}

async function vehicleAlbumCandidates(car, targetAlbumId) {
  const entries = await fs.readdir(uploadRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (legacyStorageDirectories.has(entry.name)) continue;

    let albumId;
    try {
      albumId = cleanAlbumId(entry.name);
    } catch {
      continue;
    }
    if (!await albumMatchesVehicle(albumId, car)) continue;

    const album = await readAlbum(albumId);
    candidates.push({
      id: albumId,
      mediaCount: album?.mediaCount || 0,
      updatedAt: album?.updatedAt || "",
    });
  }
  return candidates;
}

async function albumMatchesVehicle(albumId, car) {
  const metadata = await readAlbumMetadata(albumId);
  const vehicle = metadata.vehicle || {};
  const dealershipId = normalizeSpace(vehicle.dealershipId || metadata.dealership?.id);
  const inventoryTypeId = normalizeSpace(vehicle.inventoryTypeId || metadata.inventoryTypeId);
  const sameScope = (!dealershipId || dealershipId === normalizeSpace(car.dealership?.id))
    && (!inventoryTypeId || inventoryTypeId === normalizeSpace(car.inventoryTypeId));

  const carVin = normalizeSpace(car.vin).toUpperCase();
  const albumVin = normalizeSpace(vehicle.vin || vehicle.inventoryKey).toUpperCase();
  let sawComparableStrongIdentifier = false;
  if (carVin && albumVin) {
    sawComparableStrongIdentifier = true;
    if (carVin === albumVin) return sameScope;
  }

  const carInventoryKey = normalizeSpace(car.inventoryKey || car.manualInventoryId).toUpperCase();
  const albumInventoryKey = normalizeSpace(vehicle.inventoryKey || vehicle.manualInventoryId).toUpperCase();
  if (carInventoryKey && albumInventoryKey) {
    sawComparableStrongIdentifier = true;
    if (carInventoryKey === albumInventoryKey) return sameScope;
  }

  if (sawComparableStrongIdentifier) return false;

  const carStock = normalizeSpace(car.stockNumber).toUpperCase();
  const albumStock = normalizeSpace(vehicle.stockNumber).toUpperCase();
  return Boolean(carStock && albumStock && carStock === albumStock && sameScope);
}

async function migrateLegacyCarAlbum(car, albumId) {
  const legacyAlbumId = legacyCarAlbumId(car);
  if (legacyAlbumId === albumId) return;
  if (!legacyAlbumId) return;

  const legacyDirectory = albumPath(legacyAlbumId);
  const targetDirectory = albumPath(albumId);
  const legacyStats = await fs.stat(legacyDirectory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!legacyStats?.isDirectory()) return;

  const targetStats = await fs.stat(targetDirectory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (targetStats) return;
  await fs.rename(legacyDirectory, targetDirectory);
}

async function resolveInventoryCar(values) {
  const dealership = cleanDealershipId(values?.dealershipId);
  const inventoryTypeId = cleanInventoryTypeId(values?.inventoryTypeId || defaultInventoryTypeId);
  const inventoryKey = cleanInventoryKey(values?.inventoryKey || values?.manualInventoryId || values?.vin);
  const cars = await fetchInventoryCars({ dealershipId: dealership.id, inventoryTypeId });
  const car = cars.find((candidate) => candidate.inventoryKey === inventoryKey || candidate.vin === inventoryKey);
  if (!car) {
    throw httpError(400, "Select a saved inventory car from the chosen dealership before uploading media.");
  }
  return { dealership, inventoryTypeId, car };
}

function safeRedirectPath(value) {
  const text = normalizeSpace(value);
  if (!text || !text.startsWith("/") || text.startsWith("//")) return "";
  try {
    const parsed = new URL(text, "https://carpostclub.local");
    if (parsed.origin !== "https://carpostclub.local") return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

async function fetchInventoryCars({ dealershipId, inventoryTypeId }) {
  const dealership = cleanDealershipId(dealershipId);
  inventoryTypeId = cleanInventoryTypeId(inventoryTypeId || defaultInventoryTypeId);
  const inventory = await fetchInventoryCarsSnapshot({ dealershipId: dealership.id, inventoryTypeId });
  return mergeManualInventoryCars(inventory.cars, { dealership, inventoryTypeId });
}

async function annotateInventoryCarsWithPostedStatus(cars, { dealershipId, inventoryTypeId }) {
  const albums = await listAlbums();
  const scopedAlbums = albums.filter((album) => albumMatchesInventoryScope(album, { dealershipId, inventoryTypeId }));
  return cars.map((car) => {
    const album = scopedAlbums.find((candidate) => inventoryCarMatchesAlbum(car, candidate));
    if (!album) return { ...car, posted: { posted: false } };
    return {
      ...car,
      posted: {
        posted: true,
        albumId: album.id,
        albumName: album.name,
        mediaCount: album.mediaCount || 0,
        updatedAt: album.updatedAt || "",
        dealershipId: album.vehicle?.dealershipId || album.dealership?.id || "",
        inventoryTypeId: album.vehicle?.inventoryTypeId || album.inventoryTypeId || "",
      },
    };
  });
}

function albumMatchesInventoryScope(album, { dealershipId, inventoryTypeId }) {
  const albumDealershipId = normalizeSpace(album?.vehicle?.dealershipId || album?.dealership?.id);
  const albumInventoryTypeId = normalizeSpace(album?.vehicle?.inventoryTypeId || album?.inventoryTypeId);
  return (!albumDealershipId || albumDealershipId === String(dealershipId))
    && (!albumInventoryTypeId || albumInventoryTypeId === String(inventoryTypeId));
}

async function shortcutInventoryAlbumPicker(query = {}) {
  const dealership = shortcutDealershipFromQuery(query) || cleanDealershipId(shortcutDefaultDealershipId);
  const inventoryTypeId = shortcutInventoryTypeIdFromQuery(query) || defaultInventoryTypeId;
  const cars = await fetchInventoryCars({ dealershipId: dealership.id, inventoryTypeId });
  const items = cars
    .map((car) => shortcutInventoryAlbumItem(car, dealership))
    .filter(Boolean)
    .sort(compareShortcutInventoryAlbumItems);

  return {
    ok: true,
    mode: "inventory",
    generatedAt: new Date().toISOString(),
    source: `${dealership.name} active ${inventoryTypeName(inventoryTypeId).toLowerCase()}`,
    dealership: {
      id: dealership.id,
      name: dealership.name,
      label: dealership.name,
      value: dealership.id,
      count: items.length,
    },
    inventoryTypeId,
    count: items.length,
    items,
  };
}

function shortcutInventoryAlbumItem(car, dealership = null) {
  const albumName = shortcutInventoryAlbumName(car);
  if (!albumName) return null;
  return {
    albumName,
    label: albumName,
    value: car.inventoryKey || car.vin || car.stockNumber || albumName,
    inventoryKey: car.inventoryKey || "",
    vin: car.vin || "",
    stockNumber: car.stockNumber || "",
    title: car.title || "",
    price: car.price || "",
    detailUrl: sanitizedOregansDetailUrl(car.detailUrl, car.source),
    exteriorColor: car.exteriorColor || "",
    year: car.year || "",
    make: car.make || "",
    model: car.model || "",
    dealershipId: car.dealership?.id || dealership?.id || "",
    dealershipName: car.dealership?.name || dealership?.name || "",
    inventoryTypeId: car.inventoryTypeId || "",
    inventoryType: inventoryTypeName(car.inventoryTypeId || defaultInventoryTypeId),
  };
}

function shortcutInventoryAlbumName(car) {
  const stockNumber = cleanShortcutAlbumPart(car?.stockNumber);
  const vehicleName = [
    car?.exteriorColor,
    car?.year,
    car?.make,
    car?.model,
  ].map(cleanShortcutAlbumPart).filter(Boolean).join(" ");
  if (stockNumber && vehicleName) return `${stockNumber} - ${vehicleName}`;
  return normalizeSpace(car?.albumName || vehicleAlbumName(car) || car?.label || "");
}

function compareShortcutInventoryAlbumItems(left, right) {
  return normalizeSpace(left.albumName).localeCompare(normalizeSpace(right.albumName), "en-CA", {
    numeric: true,
    sensitivity: "base",
  });
}

function shortcutDealershipFromQuery(query = {}) {
  const raw = firstShortcutQueryValue(query.dealership)
    || firstShortcutQueryValue(query.dealer)
    || firstShortcutQueryValue(query.dealershipId)
    || firstShortcutQueryValue(query.dealerId)
    || firstShortcutQueryValue(query.lotLocationId);
  const value = normalizeSpace(raw);
  if (!value) return null;

  const token = shortcutLookupToken(value);
  const dealership = oregansDealerships.find((candidate) => (
    shortcutLookupToken(candidate.id) === token
    || shortcutLookupToken(candidate.name) === token
    || slugify(candidate.name) === token
  ));
  if (dealership) return dealership;
  throw httpError(400, `Unknown dealership "${value}".`);
}

function shortcutInventoryTypeIdFromQuery(query = {}) {
  const raw = firstShortcutQueryValue(query.inventoryTypeId)
    || firstShortcutQueryValue(query.inventoryType)
    || firstShortcutQueryValue(query.type);
  const value = normalizeSpace(raw);
  if (!value) return "";

  const token = shortcutLookupToken(value);
  const type = inventoryTypes.find((candidate) => (
    shortcutLookupToken(candidate.id) === token
    || shortcutLookupToken(candidate.name) === token
  ));
  if (type) return type.id;
  throw httpError(400, `Unknown inventory type "${value}".`);
}

function firstShortcutQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function shortcutLookupToken(value) {
  return normalizeSpace(value).toLowerCase();
}

function cleanShortcutAlbumPart(value) {
  return normalizeSpace(value).replace(/\s+/g, " ").slice(0, 80);
}

async function fetchInventoryCarsSnapshot({ dealershipId, inventoryTypeId, bypassCache = false }) {
  const dealership = cleanDealershipId(dealershipId);
  inventoryTypeId = cleanInventoryTypeId(inventoryTypeId || defaultInventoryTypeId);
  const cacheKey = `${dealership.id}:${inventoryTypeId}`;

  if (inventoryMockFile) {
    const fetchedAt = Date.now();
    return {
      dealership,
      inventoryTypeId,
      fetchedAt,
      fetchedAtIso: new Date(fetchedAt).toISOString(),
      source: "mock",
      cars: await fetchMockInventoryCars({ dealership, inventoryTypeId }),
    };
  }

  const cached = inventoryCache.get(cacheKey);
  if (!bypassCache && cached && Date.now() - cached.fetchedAt < inventoryCacheTtlMs) {
    return {
      dealership,
      inventoryTypeId,
      fetchedAt: cached.fetchedAt,
      fetchedAtIso: new Date(cached.fetchedAt).toISOString(),
      source: "oregans",
      cars: cached.cars,
    };
  }

  if (!bypassCache && inventoryFetchPromises.has(cacheKey)) {
    return inventoryFetchPromises.get(cacheKey);
  }

  const fetchPromise = fetchFreshInventoryCarsSnapshot({ dealership, inventoryTypeId, cacheKey });
  if (!bypassCache) inventoryFetchPromises.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    if (inventoryFetchPromises.get(cacheKey) === fetchPromise) {
      inventoryFetchPromises.delete(cacheKey);
    }
  }
}

async function fetchFreshInventoryCarsSnapshot({ dealership, inventoryTypeId, cacheKey }) {
  const maxResults = 500;
  const cars = await fetchOregansInventorySearchCars({ dealership, inventoryTypeId, maxResults });
  const enrichedCars = await enrichOregansInventoryCarsWithBodyStyles(cars, {
    dealership,
    inventoryTypeId,
    maxResults,
  });
  const normalized = enrichedCars.map((car) => normalizeInventoryCar(car, { dealership, inventoryTypeId }));
  const fetchedAt = Date.now();
  inventoryCache.set(cacheKey, { fetchedAt, cars: normalized });
  return {
    dealership,
    inventoryTypeId,
    fetchedAt,
    fetchedAtIso: new Date(fetchedAt).toISOString(),
    source: "oregans",
    cars: normalized,
  };
}

async function fetchOregansInventorySearchCars({
  dealership,
  inventoryTypeId,
  maxResults = 500,
  bodyStyleGroupId = "",
}) {
  const limit = 100;
  const cars = [];
  let totalResults = null;

  for (let offset = 0; offset < maxResults; offset += limit) {
    const inventory = await fetchOregansInventorySearchPage({
      dealership,
      inventoryTypeId,
      offset,
      limit,
      bodyStyleGroupId,
    });
    const results = inventory?.search?.results || [];
    totalResults = Number(inventory?.search?.stats?.totalResultsCount ?? results.length);
    cars.push(...results.map(parseInventoryResult).filter((car) => car.vin));
    if (!results.length || cars.length >= totalResults) break;
  }

  return cars;
}

async function fetchOregansInventorySearchPage({
  dealership,
  inventoryTypeId,
  offset,
  limit,
  bodyStyleGroupId = "",
}) {
  const params = {
    "search.vehicle-inventory-type-ids.0": inventoryTypeId,
    "search.region-ids.0": oregansInventoryRegionId,
    "search.lot-location-ids.0": dealership.id,
    "search.sort-order": "newest",
    "do-search": "1",
    "search.results-offset": String(offset),
    "search.results-limit": String(limit),
  };
  if (bodyStyleGroupId) params["search.vehicle-body-style-group-ids.0"] = bodyStyleGroupId;

  const searchUrl = new URL(oregansInventorySearchApiUrl);
  searchUrl.search = new URLSearchParams(params).toString();
  return fetchOregansJson(searchUrl);
}

async function enrichOregansInventoryCarsWithBodyStyles(cars, { dealership, inventoryTypeId, maxResults }) {
  if (!cars.some((car) => !car.bodyStyle)) return cars;

  let bodyStyleByKey;
  try {
    bodyStyleByKey = await fetchOregansBodyStyleLookup({ dealership, inventoryTypeId, maxResults });
  } catch (error) {
    console.warn(`O'Regan's body style enrichment failed: ${error?.message || error}`);
    return cars;
  }
  if (!bodyStyleByKey.size) return cars;

  return cars.map((car) => {
    if (car.bodyStyle) return car;
    const bodyStyle = oregansBodyStyleForCar(bodyStyleByKey, car);
    return bodyStyle ? { ...car, bodyStyle } : car;
  });
}

async function fetchOregansBodyStyleLookup({ dealership, inventoryTypeId, maxResults }) {
  const bodyStyleByKey = new Map();
  for (const group of oregansBodyStyleGroups) {
    const cars = await fetchOregansInventorySearchCars({
      dealership,
      inventoryTypeId,
      maxResults,
      bodyStyleGroupId: group.id,
    });
    for (const car of cars) {
      for (const key of oregansInventoryCarLookupKeys(car)) {
        if (!bodyStyleByKey.has(key)) bodyStyleByKey.set(key, group.name);
      }
    }
  }
  return bodyStyleByKey;
}

function oregansBodyStyleForCar(bodyStyleByKey, car) {
  for (const key of oregansInventoryCarLookupKeys(car)) {
    const bodyStyle = bodyStyleByKey.get(key);
    if (bodyStyle) return bodyStyle;
  }
  return "";
}

function oregansInventoryCarLookupKeys(car) {
  return [...new Set([
    normalizeSpace(car?.vin).toUpperCase(),
    normalizeSpace(car?.vehicleId),
    normalizeSpace(car?.stockNumber).toUpperCase(),
    sanitizedOregansDetailUrl(car?.detailUrl),
  ].filter(Boolean))];
}

async function fetchMockInventoryCars({ dealership, inventoryTypeId }) {
  const data = await readJson(inventoryMockFile, []);
  const rawCars = Array.isArray(data) ? data : data.cars || [];
  return rawCars
    .filter((car) => String(car.dealershipId || dealership.id) === dealership.id)
    .filter((car) => String(car.inventoryTypeId || inventoryTypeId) === inventoryTypeId)
    .map((car) => normalizeInventoryCar(car, { dealership, inventoryTypeId }))
    .filter((car) => car.vin);
}

async function mergeManualInventoryCars(cars, { dealership, inventoryTypeId }) {
  const manualCars = await listManualInventoryCars({ dealershipId: dealership.id, inventoryTypeId });
  return [...manualCars, ...cars];
}

async function createManualInventoryCar(values, user) {
  const dealership = cleanDealershipId(values?.dealershipId);
  const inventoryTypeId = cleanInventoryTypeId(values?.inventoryTypeId);
  const stockNumber = cleanManualText(values?.stockNumber, "Inventory number", { maxLength: 40 });
  const year = cleanManualYear(values?.year);
  const make = cleanManualText(values?.make, "Make", { maxLength: 40 });
  const model = cleanManualText(values?.model, "Model", { maxLength: 48 });
  const trim = cleanManualOptionalText(values?.trim, { maxLength: 64 });
  const priceValue = cleanManualMoney(values?.priceValue ?? values?.price);
  const odometerValue = cleanManualNonNegativeInteger(values?.odometerValue ?? values?.odometer, "Kilometers");
  const exteriorColor = cleanManualText(values?.exteriorColor, "Exterior color", { maxLength: 32 });
  const interiorColor = cleanManualOptionalText(values?.interiorColor, { maxLength: 32 });
  const bodyStyle = cleanManualText(values?.bodyStyle, "Body style", { maxLength: 32 });
  const fuelType = cleanManualText(values?.fuelType, "Fuel type", { maxLength: 32 });
  const transmission = cleanManualText(values?.transmission, "Transmission", { maxLength: 40 });
  const vin = cleanOptionalVin(values?.vin);
  const descriptionPreview = cleanManualOptionalText(values?.descriptionPreview, { maxLength: 600 });
  const now = new Date().toISOString();
  const id = `manual-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`.toLowerCase();
  const inventoryLabel = inventoryTypeId === "1" ? "New" : "Used";
  const title = normalizeSpace([inventoryLabel, year, make, model, trim].filter(Boolean).join(" "));
  const record = {
    id,
    source: "manual",
    dealershipId: dealership.id,
    inventoryTypeId,
    stockNumber,
    vin,
    title,
    year: String(year),
    make,
    model,
    trim,
    price: formatCadPrice(priceValue),
    priceValue,
    odometer: formatKilometers(odometerValue),
    odometerValue,
    exteriorColor,
    interiorColor,
    bodyStyle,
    fuelType,
    transmission,
    descriptionPreview,
    createdAt: now,
    createdBy: publicAuthUser(user),
    updatedAt: now,
  };

  const saved = await updateManualInventory((store) => {
    const duplicate = store.cars.find((car) =>
      String(car.dealershipId) === dealership.id
      && String(car.inventoryTypeId) === inventoryTypeId
      && normalizeSpace(car.stockNumber).toLowerCase() === stockNumber.toLowerCase()
    );
    if (duplicate) {
      throw httpError(409, "That inventory number already exists for this lot and inventory type.");
    }
    store.cars.push(record);
    return record;
  });

  return normalizeManualInventoryCar(saved);
}

async function listManualInventoryCars({ dealershipId, inventoryTypeId }) {
  const store = await readManualInventory();
  return store.cars
    .filter((car) => String(car.dealershipId) === String(dealershipId))
    .filter((car) => String(car.inventoryTypeId) === String(inventoryTypeId))
    .map(normalizeManualInventoryCar)
    .filter(Boolean)
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
}

async function readManualInventory() {
  const store = await readJson(manualInventoryPath, { cars: [] });
  return {
    cars: Array.isArray(store?.cars) ? store.cars : [],
  };
}

async function updateManualInventory(mutator) {
  manualInventoryWritePromise = manualInventoryWritePromise.catch(() => {}).then(async () => {
    const store = await readManualInventory();
    const result = await mutator(store);
    store.cars.sort((left, right) => String(left.stockNumber || "").localeCompare(String(right.stockNumber || "")));
    await writeJson(manualInventoryPath, store);
    return result;
  });
  return manualInventoryWritePromise;
}

function normalizeManualInventoryCar(record) {
  if (!record || typeof record !== "object") return null;
  const dealership = cleanDealershipId(record.dealershipId);
  const inventoryTypeId = cleanInventoryTypeId(record.inventoryTypeId);
  const manualInventoryId = cleanManualInventoryId(record.id);
  const stockNumber = normalizeSpace(record.stockNumber);
  const title = normalizeSpace(record.title || [
    inventoryTypeId === "1" ? "New" : "Used",
    record.year,
    record.make,
    record.model,
    record.trim,
  ].filter(Boolean).join(" "));
  const normalized = {
    source: "manual",
    manualInventoryId,
    inventoryKey: manualInventoryId,
    vin: cleanOptionalVin(record.vin),
    stockNumber,
    title,
    label: normalizeSpace([stockNumber, title].filter(Boolean).join(" - ")),
    inventoryTypeId,
    dealership,
    albumId: carAlbumId({ ...record, stockNumber, title }),
    albumName: vehicleAlbumName({ ...record, stockNumber, title }),
    inventoryType: inventoryTypes.find((type) => type.id === inventoryTypeId)?.name || "",
    year: String(record.year || ""),
    make: normalizeSpace(record.make),
    model: normalizeSpace(record.model),
    trim: normalizeSpace(record.trim),
    tagline: "",
    price: record.price || formatCadPrice(record.priceValue),
    priceValue: parseCurrency(record.price || record.priceValue),
    ownerLocation: dealership.name,
    detailUrl: "",
    exteriorColor: normalizeSpace(record.exteriorColor),
    interiorColor: normalizeSpace(record.interiorColor),
    odometer: record.odometer || formatKilometers(record.odometerValue),
    odometerValue: parseNullableInteger(record.odometer || record.odometerValue),
    bodyStyle: normalizeSpace(record.bodyStyle),
    fuelType: normalizeSpace(record.fuelType),
    transmission: normalizeSpace(record.transmission),
    descriptionPreview: normalizeSpace(record.descriptionPreview),
    createdAt: record.createdAt || "",
    createdBy: record.createdBy || null,
  };
  return normalized.stockNumber && normalized.title ? normalized : null;
}

async function fetchOregansJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      referer: "https://www.oregans.com/inventory/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136 Safari/537.36",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`O'Regan's inventory API returned HTTP ${response.status}`);
  }

  return response.json();
}

function normalizeInventoryCar(car, { dealership, inventoryTypeId }) {
  const stockNumber = normalizeSpace(car.stockNumber || "");
  const vin = cleanVin(car.vin);
  const title = normalizeSpace(car.title || [car.year, car.make, car.model, car.trim].filter(Boolean).join(" "));
  const albumName = vehicleAlbumName({ ...car, stockNumber, vin, title });

  return {
    source: "oregans",
    manualInventoryId: "",
    inventoryKey: vin,
    vin,
    stockNumber,
    title,
    label: normalizeSpace([stockNumber, title].filter(Boolean).join(" - ")),
    inventoryTypeId,
    dealership,
    albumId: carAlbumId({ ...car, stockNumber, vin, title }),
    albumName,
    inventoryType: car.inventoryType || inventoryTypes.find((type) => type.id === inventoryTypeId)?.name || "",
    year: car.year || "",
    make: car.make || "",
    model: car.model || "",
    trim: car.trim || "",
    tagline: car.tagline || "",
    price: car.price || "",
    priceValue: car.priceValue ?? null,
    ownerLocation: car.ownerLocation || dealership.name,
    detailUrl: sanitizedOregansDetailUrl(car.detailUrl, car.source),
    exteriorColor: car.exteriorColor || "",
    interiorColor: car.interiorColor || "",
    odometer: car.odometer || "",
    odometerValue: car.odometerValue ?? null,
    bodyStyle: car.bodyStyle || "",
    fuelType: car.fuelType || "",
    transmission: car.transmission || "",
    descriptionPreview: car.descriptionPreview || "",
  };
}

async function buildMarketplaceDraftForUser(car, user, { album = null, force = false } = {}) {
  const baseFields = buildMarketplaceFields(car);
  const fields = personalizeMarketplaceFields(baseFields, user);
  const title = buildMarketplaceTitle(car);
  const fallbackDescription = buildMarketplaceDescription(car, baseFields, user);
  const generated = await getMarketplaceDescriptionForUser({
    car,
    fields: baseFields,
    user,
    album,
    fallbackDescription,
    force,
  });
  const description = generated.description
    ? finalizeMarketplaceBuyerDescription(generated.description, fields, car, user)
    : "";
  const missingFields = [
    ["Location", fields.location],
    ["Postal code", fields.postalCode],
    ["Year", fields.year],
    ["Make", fields.make],
    ["Model", fields.model],
    ["Mileage", fields.mileage],
    ["Price", fields.price],
    ["Body style", fields.bodyStyle],
    ["Exterior color", fields.exteriorColor],
    ["Interior color", fields.interiorColor],
    ["Vehicle condition", fields.vehicleCondition],
    ["Fuel type", fields.fuelType],
    ["Transmission", fields.transmission],
    ["Description", description],
  ].filter(([, value]) => !value).map(([label]) => label);

  const reviewFields = [
    ...(!marketplaceCleanTitleDefault ? ["Clean title"] : []),
    ...(fields.vehicleCondition && !hasExplicitCondition(car) ? ["Vehicle condition"] : []),
    ...(fields.bodyStyle && !car.bodyStyle ? ["Body style"] : []),
    ...(!car.interiorColor ? ["Interior color"] : []),
    ...(!car.fuelType ? ["Fuel type"] : []),
    ...(!car.transmission ? ["Transmission"] : []),
  ];

  return {
    ready: missingFields.length === 0,
    status: missingFields.length ? "needs_info" : "ready",
    title,
    fields,
    description,
    copyText: description ? buildMarketplaceCopyText({ title, fields, description, car, user }) : "",
    missingFields,
    reviewFields: [...new Set(reviewFields)],
    descriptionSource: generated.source,
    descriptionModel: generated.model,
    descriptionGeneratedAt: generated.generatedAt,
    descriptionPromptVersion: generated.promptVersion,
    descriptionInputHash: generated.inputHash,
    descriptionVariantId: generated.variantId,
    descriptionOwner: publicAuthUser(user),
    factsSource: {
      inventory: "O'Regan's inventory feed",
      copy: generated.source === "not_generated"
        ? "Marketplace copy is generated only after media is uploaded."
        : generated.source?.startsWith("openai") ? "OpenAI generated from text vehicle facts on media upload" : "Template fallback copy generated on media upload",
      photos: "Photos are shared for the selected car; package header and contact text are personalized for the signed-in user.",
    },
  };
}

function marketplaceDescriptionBackfillOptions(value = {}) {
  return {
    dryRun: parseBooleanValue(value.dryRun, false),
    force: parseBooleanValue(value.force, false),
    includeManual: parseBooleanValue(value.includeManual, false),
    includeSourceRemoved: parseBooleanValue(value.includeSourceRemoved, false),
    limit: positiveInteger(value.limit, 0),
  };
}

async function backfillMarketplaceDescriptions(user, options = {}) {
  const startedAt = new Date().toISOString();
  const albums = await listAlbums({ includeInventoryStatus: true });
  const records = [];
  const summary = {
    total: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    wouldUpdate: 0,
  };

  for (const album of albums) {
    if (options.limit && summary.total >= options.limit) break;
    summary.total += 1;
    try {
      const record = await backfillMarketplaceDescriptionForAlbum(album, user, options);
      records.push(record);
      if (record.status === "updated") summary.updated += 1;
      else summary.skipped += 1;
      if (record.action === "would_update") summary.wouldUpdate += 1;
    } catch (error) {
      summary.failed += 1;
      records.push({
        status: "failed",
        action: "failed",
        albumId: album?.id || "",
        albumName: album?.name || "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    promptVersion: marketplaceDescriptionPromptVersion,
    dryRun: Boolean(options.dryRun),
    options,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    records,
  };
}

async function backfillMarketplaceDescriptionForAlbum(album, user, options = {}) {
  const car = carFromAlbum(album);
  const fields = buildMarketplaceFields(car);
  const inputHash = marketplaceDescriptionInputHash(car, fields);
  const existingStore = await readMarketplaceCopyStore(album.id);
  const sourceStatus = album.inventoryStatus?.lifecycle?.sourceStatus || "";
  const base = {
    albumId: album.id,
    albumName: album.name,
    vehicle: {
      vin: car.vin,
      stockNumber: car.stockNumber,
      title: buildMarketplaceTitle(car),
      year: car.year,
      make: car.make,
      model: car.model,
      trim: car.trim,
    },
    mediaCount: album.mediaCount || 0,
    vehicleSource: car.source,
    sourceStatus,
    facebookAction: album.inventoryStatus?.lifecycle?.facebookAction || "",
    previousPromptVersion: existingStore?.promptVersion || "",
    inputHash,
  };

  if (!album.mediaCount) return marketplaceBackfillSkipped(base, "no_media");
  if (car.source === "manual" && !options.includeManual) return marketplaceBackfillSkipped(base, "manual_inventory");
  if (sourceStatus === "source_removed" && !options.includeSourceRemoved) return marketplaceBackfillSkipped(base, "source_removed");
  if (!shouldGenerateMarketplaceDescription(fields)) return marketplaceBackfillSkipped(base, "missing_required_facts");
  if (!marketplaceCopyStoreAllowsAutoRegeneration(existingStore) && !options.force) {
    return marketplaceBackfillSkipped(base, "protected_description_store");
  }
  if (!options.force && isMarketplaceUploadPoolCurrent(existingStore, inputHash)) {
    return marketplaceBackfillSkipped(base, "already_current");
  }

  if (options.dryRun) {
    return {
      ...base,
      status: "skipped",
      action: "would_update",
      reason: existingStore?.promptVersion ? "outdated_or_forced" : "missing_description_store",
    };
  }

  const generation = await prepareMarketplaceDescriptionsForUpload(car, user, {
    album,
    uploadedMediaCount: album.mediaCount || 0,
    force: options.force || !isMarketplaceUploadPoolCurrent(existingStore, inputHash),
    reason: "backfill",
  });
  const draft = await buildMarketplaceDraftForUser(car, user, { album });
  const updatedStore = await readMarketplaceCopyStore(album.id);

  return {
    ...base,
    status: "updated",
    action: "updated",
    reason: "regenerated",
    generationSource: generation.source,
    promptVersion: updatedStore?.promptVersion || draft.descriptionPromptVersion,
    descriptionSource: draft.descriptionSource,
    descriptionVariantId: draft.descriptionVariantId,
    variantCount: generation.variantCount || updatedStore?.variants?.length || 0,
    historyCount: Array.isArray(updatedStore?.history) ? updatedStore.history.length : 0,
  };
}

function marketplaceBackfillSkipped(base, reason) {
  return {
    ...base,
    status: "skipped",
    action: "skipped",
    reason,
  };
}

function buildMarketplaceFields(car) {
  const dealershipContext = marketplaceDealershipContext(car);
  return {
    listingType: "Vehicle for sale",
    vehicleType: "Car/Truck",
    location: dealershipContext.location,
    postalCode: dealershipContext.postalCode,
    dealershipName: dealershipContext.name,
    dealershipCity: dealershipContext.city,
    dealershipLabel: dealershipContext.label,
    contactName: dealershipContext.contactName,
    year: parseNullableInteger(car.year),
    make: car.make || null,
    model: car.model || null,
    mileage: car.odometerValue || parseNullableInteger(car.odometer),
    price: car.priceValue || parseCurrency(car.price),
    bodyStyle: normalizeMarketplaceBodyStyle(car.bodyStyle || inferBodyStyle(car)),
    exteriorColor: normalizeMarketplaceColor(car.exteriorColor),
    interiorColor: normalizeMarketplaceColor(car.interiorColor) || "Other",
    cleanTitle: marketplaceCleanTitleDefault ? true : null,
    vehicleCondition: inferMarketplaceCondition(car),
    fuelType: normalizeMarketplaceFuel(car.fuelType),
    transmission: normalizeMarketplaceTransmission(car.transmission),
  };
}

function personalizeMarketplaceFields(fields, user) {
  return {
    ...fields,
    contactName: marketplaceContactNameForUser(user, fields?.contactName),
  };
}

function marketplaceContactNameForUser(user, fallbackName = marketplaceContactPerson) {
  const displayName = normalizeDisplayName(user?.displayName);
  const username = normalizeAuthUsername(user?.username);
  const fallback = normalizeSpace(fallbackName) || marketplaceContactPerson;
  if (username && username === normalizeAuthUsername(authUsername)) return fallback;
  return displayName || fallback;
}

async function prepareMarketplaceDescriptionsForUpload(car, user, {
  album = null,
  uploadedMediaCount = 0,
  force = false,
  reason = "media_upload",
} = {}) {
  album = album || await ensureCarAlbum(car);
  const fields = buildMarketplaceFields(car);
  const targetUsers = await marketplaceAssignmentUsers(user);
  const targetCount = Math.max(marketplaceDescriptionVariantCount, targetUsers.length);
  const input = buildMarketplaceDescriptionPoolInput({ car, fields, users: targetUsers, count: targetCount });
  const inputHash = marketplaceDescriptionInputHash(car, fields);
  const promiseKey = `upload:${album.id}:${inputHash}:${targetCount}:${force ? "force" : "current"}`;

  if (marketplaceCopyPromises.has(promiseKey)) return marketplaceCopyPromises.get(promiseKey);

  const promise = (async () => {
    const existingStore = await readMarketplaceCopyStore(album.id);
    if (!force && isMarketplaceUploadPoolCurrent(existingStore, inputHash) && existingStore.variants.length >= marketplaceDescriptionVariantCount) {
      const assigned = await assignMarketplaceDescriptionsToUsers(album.id, targetUsers, inputHash);
      return {
        ok: true,
        source: "existing-upload-pool",
        inputHash,
        variantCount: existingStore.variants.length,
        assignedCount: assigned.length,
      };
    }

    const variants = await generateMarketplaceDescriptionVariants(input, targetCount)
      .catch((error) => {
        console.error("Facebook Marketplace upload description generation failed:", error instanceof Error ? error.message : String(error));
        return buildMarketplaceTemplateVariants(car, fields, targetCount, targetUsers).map((description, index) => ({
          id: `variant-${index + 1}`,
          description,
          ...marketplaceVariantPostingMetadata(input.postingProfiles?.[index]),
          source: "template-upload",
          model: null,
          generatedAt: new Date().toISOString(),
          usage: null,
        }));
      });

    const generatedAt = new Date().toISOString();
    await writeMarketplaceCopyStore(album.id, {
      mode: "upload_pool",
      promptVersion: marketplaceDescriptionPromptVersion,
      inputHash,
      generatedAt,
      generatedBy: publicAuthUser(user),
      uploadedMediaCount,
      variantCount: variants.length,
      variants,
      assignments: {},
      users: {},
      history: marketplaceCopyHistoryWithSnapshot(existingStore, {
        reason,
        replacedAt: generatedAt,
        replacedBy: publicAuthUser(user),
      }),
    });

    const assigned = await assignMarketplaceDescriptionsToUsers(album.id, targetUsers, inputHash);
    return {
      ok: true,
      source: variants.some((variant) => variant.source === "openai-upload") ? "openai-upload" : "template-upload",
      inputHash,
      variantCount: variants.length,
      assignedCount: assigned.length,
    };
  })().finally(() => {
    marketplaceCopyPromises.delete(promiseKey);
  });

  marketplaceCopyPromises.set(promiseKey, promise);
  return promise;
}

async function getMarketplaceDescriptionForUser({ car, fields, user, album, force = false }) {
  const fallback = {
    description: "",
    source: "not_generated",
    model: null,
    generatedAt: null,
    promptVersion: marketplaceDescriptionPromptVersion,
    inputHash: null,
    variantId: null,
  };

  if (!shouldGenerateMarketplaceDescription(fields)) return fallback;
  if (!album?.id) return fallback;
  if (!await albumHasMedia(album.id)) return fallback;

  const inputHash = marketplaceDescriptionInputHash(car, fields);
  let store = await readMarketplaceCopyStore(album.id);
  if (!isMarketplaceUploadPoolCurrent(store, inputHash)) {
    if (!marketplaceCopyStoreAllowsAutoRegeneration(store) && !force) {
      return { ...fallback, source: "protected_stale", inputHash };
    }
    await prepareMarketplaceDescriptionsForUpload(car, user, {
      album,
      uploadedMediaCount: album.mediaCount || 0,
    });
    store = await readMarketplaceCopyStore(album.id);
  }
  if (!isMarketplaceUploadPoolCurrent(store, inputHash)) return { ...fallback, inputHash };

  const assigned = await assignMarketplaceDescriptionToUser(album.id, user, inputHash, { force });
  return assigned || { ...fallback, source: "unassigned", inputHash };
}

async function generateMarketplaceDescriptionVariants(input, count) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const models = [...new Set([marketplaceDescriptionModel, marketplaceDescriptionFallbackModel].filter(Boolean))];
  let lastError = null;

  for (const model of models) {
    try {
      const response = await getOpenAIClient().responses.create({
        model,
        store: false,
        max_output_tokens: marketplaceDescriptionMaxOutputTokens(model, count),
        ...marketplaceDescriptionReasoningOptions(model),
        input: [{
          role: "user",
          content: [{
            type: "input_text",
            text: [
              `Write exactly ${count} different short Facebook Marketplace vehicle descriptions from the supplied JSON facts.`,
              "Use only supplied facts. Do not invent warranty, financing, accident history, ownership history, service history, inspection status, availability, accessories, certification, ownership, or condition details.",
              "Write original copy from the source facts. Do not copy the source description or tagline verbatim except for short factual feature names.",
              "Each one should sound like a simple Marketplace vehicle listing: plain-spoken, helpful, restrained, and human, without sounding salesy or generic.",
              "Use the supplied postingProfiles in order. Keep the descriptions very similar across profiles with only subtle rhythm changes. Do not mention app usernames, contact names, or that the copy is assigned to a profile.",
              "Never start with 'I'm listing', 'I am listing', 'Listing this', 'Posting this', or similar listing-process language.",
              "Open naturally with a useful summary of the vehicle, for example '<year> <make> <model> <trim> with the main details kept simple.'",
              "Every description must mention the vehicle year, make, model, trim/status when available, and mileage when available. Include VIN when available.",
              "Do not mention price or add contact/disclosure footers. The app appends the user-specific contact line and required legal price line separately.",
              "Mention exterior colour, interior colour, transmission, fuel type, body style, and supplied highlights only when the supplied value is useful and specific. Keep this brief.",
              "Keep buyer benefits vague and conservative. Do not make strong claims about comfort, reliability, condition, winter use, safety, towing, family use, or tech unless the exact supporting fact is supplied.",
              "Do not say AWD, all-wheel drive, 4WD, four-wheel drive, winter confidence, towing, hybrid, electric, leather, sunroof, navigation, camera, heated seats, or similar feature claims unless those exact facts are supplied.",
              "Do not describe the vehicle or interior as comfortable, clean, excellent, like new, reliable, easy to park, or in good condition unless that wording or a directly supporting comfort/condition feature is supplied.",
              "Do not mention missing, vague, or placeholder facts such as Other, Unknown, N/A, not specified, body style not specified, or interior color is Other.",
              "Do not include dealership branch names, dealer names, store names, city, province, location, street addresses, lot locations, source URLs, or inventory source wording.",
              "Do not use wording that encourages a walk-in, including 'come in', 'located at', 'available at', 'come see it at', 'visit us at', 'stop by', or 'walk in'.",
              "Do not repeat the same facts. Mileage, VIN, color, transmission, and fuel type should each appear at most once inside the generated body/details.",
              "Avoid emojis, hashtags, exclamation marks, fake urgency, generic hype, and phrases like 'look no further', 'turn heads', 'dream ride', 'beast', 'loaded to the max', 'perfect blend', 'must-see', 'priced to sell', 'priced to move', 'won't last long', or 'don't miss out'.",
              "For each description, write one short opening sentence plus a compact details block. Do not include a feature bullet list.",
              "Keep each generated body between 55 and 95 words before the appended contact and price disclosure lines.",
              "The details block should include mileage, body style, exterior colour, interior colour, transmission, fuel type, up to three supplied highlights, and VIN when available, but not price.",
              "Do not include stock number, inventory number, internal inventory ID, dealership stock code, contact/footer line, or price-disclosure fee line.",
              "Return only JSON matching the schema.",
              "",
              JSON.stringify(input),
            ].join(" "),
          }],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "facebook_marketplace_description_batch",
            strict: true,
            schema: marketplaceDescriptionBatchSchema,
          },
        },
      });
      const rawText = response.output_text || extractResponseText(response);
      const parsed = JSON.parse(rawText);
      const fallbackDescriptions = Array.isArray(input.fallbackDescriptions) ? input.fallbackDescriptions : [];
      const descriptions = [];
      const seen = new Set();
      for (const value of Array.isArray(parsed.descriptions) ? parsed.descriptions : []) {
        const profile = input.postingProfiles?.[descriptions.length];
        const fallbackDescription = fallbackDescriptions[descriptions.length] || fallbackDescriptions[0] || "";
        const description = normalizeMarketplaceGeneratedDescription(value, fallbackDescription, input);
        const key = normalizeSearchToken(description);
        if (!description || seen.has(key)) continue;
        seen.add(key);
        descriptions.push({ description, profile });
        if (descriptions.length >= count) break;
      }
      for (const fallbackDescription of fallbackDescriptions) {
        if (descriptions.length >= count) break;
        const key = normalizeSearchToken(fallbackDescription);
        if (!fallbackDescription || seen.has(key)) continue;
        seen.add(key);
        descriptions.push({
          description: fallbackDescription,
          profile: input.postingProfiles?.[descriptions.length],
        });
      }
      if (!descriptions.length) throw new Error("Generated descriptions were empty.");
      return descriptions.slice(0, count).map(({ description, profile }, index) => ({
        id: `variant-${index + 1}`,
        description,
        ...marketplaceVariantPostingMetadata(profile),
        source: "openai-upload",
        model,
        generatedAt: new Date().toISOString(),
        usage: response.usage ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        } : null,
      }));
    } catch (error) {
      lastError = error;
      if (models.length > 1) {
        console.error(`Facebook Marketplace description model ${model} failed:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  throw lastError || new Error("Facebook Marketplace description generation failed.");
}

function marketplaceDescriptionMaxOutputTokens(model, count = 1) {
  const perDescription = /^gpt-5(?:\.|-|$)/i.test(model) ? 420 : 360;
  return Math.max(/^gpt-5(?:\.|-|$)/i.test(model) ? 1300 : 900, count * perDescription);
}

function marketplaceDescriptionReasoningOptions(model) {
  if (/^gpt-5\.4(?:-|$)/i.test(model)) return { reasoning: { effort: "none" } };
  if (/^gpt-5(?:-|$)/i.test(model)) return { reasoning: { effort: "minimal" } };
  return {};
}

function marketplaceDescriptionInputHash(car, fields) {
  const priceCad = nullableFiniteNumber(fields?.price ?? parseCurrency(car?.price));
  return hashJson({
    ...buildMarketplaceDescriptionFactsInput({ car, fields }),
    priceDisclosure: {
      priceCad,
      feeCad: marketplacePriceDisclosureFee,
      hstPercent: marketplacePriceDisclosureHst,
    },
  });
}

function buildMarketplaceDescriptionPoolInput({ car, fields, users = [], count = marketplaceDescriptionVariantCount }) {
  const postingProfiles = marketplacePostingProfiles(users, count);
  const fallbackDescriptions = buildMarketplaceTemplateVariants(car, fields, count, users);
  return {
    ...buildMarketplaceDescriptionFactsInput({ car, fields, postingProfiles }),
    requestedVariantCount: count,
    postingProfiles,
    fallbackDescriptions,
  };
}

function buildMarketplaceDescriptionFactsInput({ car, fields, postingProfiles = [] }) {
  const dealership = marketplaceDealershipContext(car);
  const bodyStyle = marketplaceUsefulFact(fields.bodyStyle);
  const exteriorColor = marketplaceUsefulFact(fields.exteriorColor);
  const interiorColor = marketplaceUsefulInteriorColor(fields.interiorColor);
  const fuelType = marketplaceUsefulFact(fields.fuelType);
  const transmission = marketplaceUsefulFact(fields.transmission);
  return {
    promptVersion: marketplaceDescriptionPromptVersion,
    dealership: {
      id: dealership.id,
    },
    writingGuidance: {
      targetAudience: "Facebook Marketplace vehicle shoppers",
      tone: "short, simple, useful, vague, human, not salesy",
      postingProfiles: postingProfiles.map((profile) => ({
        variantId: profile.variantId,
        displayName: profile.displayName,
        styleHint: profile.styleHint,
      })),
    },
    vehicle: {
      vin: car.vin,
      title: car.title,
      year: fields.year,
      make: fields.make,
      model: fields.model,
      trim: car.trim,
      odometerKm: fields.mileage,
      bodyStyle: bodyStyle || null,
      exteriorColor: exteriorColor || null,
      interiorColor: interiorColor || null,
      condition: hasExplicitCondition(car) ? fields.vehicleCondition : null,
      fuelType: fuelType || null,
      transmission: transmission || null,
    },
    inventoryCopy: {
      tagline: nullableString(car.tagline),
      descriptionPreview: nullableString(car.descriptionPreview),
      highlights: featureHighlights(car),
    },
  };
}

function buildMarketplaceTemplateVariants(car, fields, count, users = []) {
  const descriptions = [];
  const seen = new Set();
  for (let index = 0; descriptions.length < count && index < count * 4; index += 1) {
    const user = users[index % Math.max(users.length, 1)] || null;
    const seed = user ? `${marketplaceUserKey(user)}:${index}` : `variant-${index}`;
    const description = buildMarketplaceDescription(car, fields, user, seed);
    const key = normalizeSearchToken(description);
    if (!description || seen.has(key)) continue;
    seen.add(key);
    descriptions.push(description);
  }
  return descriptions;
}

function shouldGenerateMarketplaceDescription(fields) {
  return Boolean(fields.year && fields.make && fields.model && fields.price && fields.mileage);
}

function getOpenAIClient() {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

function openMarketplaceDescriptionsDatabase() {
  const db = new DatabaseSync(marketplaceDescriptionsDbPath);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS marketplace_description_stores (
      album_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT '',
      prompt_version TEXT NOT NULL DEFAULT '',
      input_hash TEXT NOT NULL DEFAULT '',
      store_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS marketplace_description_stores_input_hash_idx
      ON marketplace_description_stores(input_hash);
  `);
  return db;
}

function openOregansInventorySnapshotsDatabase() {
  const db = new DatabaseSync(oregansInventorySnapshotsDbPath);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS oregans_inventory_snapshot_runs (
      id TEXT PRIMARY KEY,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      scope_json TEXT NOT NULL DEFAULT '[]',
      summary_json TEXT NOT NULL DEFAULT '[]',
      error TEXT NOT NULL DEFAULT '',
      new_inventory_count INTEGER NOT NULL DEFAULT 0,
      price_change_count INTEGER NOT NULL DEFAULT 0,
      details_change_count INTEGER NOT NULL DEFAULT 0,
      removed_inventory_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS oregans_inventory_vehicles (
      vehicle_key TEXT PRIMARY KEY,
      vin TEXT NOT NULL DEFAULT '',
      stock_number TEXT NOT NULL DEFAULT '',
      dealership_id TEXT NOT NULL DEFAULT '',
      dealership_name TEXT NOT NULL DEFAULT '',
      inventory_type_id TEXT NOT NULL DEFAULT '',
      inventory_type_name TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      make TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      trim TEXT NOT NULL DEFAULT '',
      price TEXT NOT NULL DEFAULT '',
      price_value REAL,
      odometer TEXT NOT NULL DEFAULT '',
      odometer_value INTEGER,
      exterior_color TEXT NOT NULL DEFAULT '',
      interior_color TEXT NOT NULL DEFAULT '',
      body_style TEXT NOT NULL DEFAULT '',
      fuel_type TEXT NOT NULL DEFAULT '',
      transmission TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL,
      current_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      first_snapshot_run_id TEXT NOT NULL,
      last_snapshot_run_id TEXT NOT NULL,
      present INTEGER NOT NULL DEFAULT 1,
      removed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS oregans_inventory_snapshot_items (
      run_id TEXT NOT NULL,
      vehicle_key TEXT NOT NULL,
      dealership_id TEXT NOT NULL DEFAULT '',
      inventory_type_id TEXT NOT NULL DEFAULT '',
      observed_at TEXT NOT NULL,
      car_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (run_id, vehicle_key)
    );
    CREATE TABLE IF NOT EXISTS oregans_inventory_snapshot_scopes (
      dealership_id TEXT NOT NULL,
      inventory_type_id TEXT NOT NULL,
      dealership_name TEXT NOT NULL DEFAULT '',
      inventory_type_name TEXT NOT NULL DEFAULT '',
      first_snapshot_run_id TEXT NOT NULL,
      last_snapshot_run_id TEXT NOT NULL,
      first_snapshot_at TEXT NOT NULL,
      last_snapshot_at TEXT NOT NULL,
      snapshot_count INTEGER NOT NULL DEFAULT 0,
      last_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (dealership_id, inventory_type_id)
    );
    CREATE INDEX IF NOT EXISTS oregans_inventory_vehicles_current_seen_idx
      ON oregans_inventory_vehicles(current_seen_at);
    CREATE INDEX IF NOT EXISTS oregans_inventory_vehicles_scope_present_idx
      ON oregans_inventory_vehicles(dealership_id, inventory_type_id, present);
    CREATE INDEX IF NOT EXISTS oregans_inventory_vehicles_last_seen_idx
      ON oregans_inventory_vehicles(last_seen_at);
    CREATE INDEX IF NOT EXISTS oregans_inventory_snapshot_items_scope_idx
      ON oregans_inventory_snapshot_items(dealership_id, inventory_type_id, observed_at);
    CREATE INDEX IF NOT EXISTS oregans_inventory_snapshot_items_observed_idx
      ON oregans_inventory_snapshot_items(observed_at);
    CREATE INDEX IF NOT EXISTS oregans_inventory_snapshot_runs_finished_idx
      ON oregans_inventory_snapshot_runs(finished_at);
  `);
  const runColumns = new Set(
    db.prepare("PRAGMA table_info(oregans_inventory_snapshot_runs)").all().map((column) => column.name),
  );
  for (const [name, definition] of [
    ["new_inventory_count", "INTEGER NOT NULL DEFAULT 0"],
    ["price_change_count", "INTEGER NOT NULL DEFAULT 0"],
    ["details_change_count", "INTEGER NOT NULL DEFAULT 0"],
    ["removed_inventory_count", "INTEGER NOT NULL DEFAULT 0"],
  ]) {
    if (!runColumns.has(name)) {
      db.exec(`ALTER TABLE oregans_inventory_snapshot_runs ADD COLUMN ${name} ${definition}`);
    }
  }
  return db;
}

function maybePruneOregansInventorySnapshotHistory({ force = false } = {}) {
  if (!oregansInventorySnapshotRetentionDays) return null;
  const now = Date.now();
  if (!force && now - oregansInventorySnapshotLastPruneAt < oregansInventorySnapshotPruneIntervalMs) {
    return null;
  }
  oregansInventorySnapshotLastPruneAt = now;
  try {
    const result = pruneInventorySnapshotHistory(oregansInventorySnapshotsDb, {
      retentionDays: oregansInventorySnapshotRetentionDays,
      now: new Date(now),
      apply: true,
    });
    oregansInventorySnapshotLastPrune = {
      ...result,
      finishedAt: new Date().toISOString(),
    };
    return oregansInventorySnapshotLastPrune;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    oregansInventorySnapshotLastPrune = {
      ok: false,
      retentionDays: oregansInventorySnapshotRetentionDays,
      error: message,
      finishedAt: new Date().toISOString(),
    };
    console.warn(`O'Regan's inventory snapshot retention failed: ${message}`);
    return oregansInventorySnapshotLastPrune;
  }
}

function startOregansInventorySnapshotScheduler() {
  if (!oregansInventorySnapshotEnabled || oregansInventorySnapshotTimer) return;
  const run = () => {
    oregansInventorySnapshotTimer = null;
    const schedule = currentOregansInventorySnapshotSchedule();
    scheduleNextOregansInventorySnapshotRun(run, schedule);
    if (schedule.paused) return;
    queueOregansInventorySnapshotRun({ reason: "scheduled" }).catch((error) => {
      console.warn(`O'Regan's inventory snapshot failed: ${error?.message || error}`);
    });
  };
  const schedule = currentOregansInventorySnapshotSchedule();
  if (schedule.paused) {
    scheduleNextOregansInventorySnapshotRun(run, schedule);
    return;
  }
  oregansInventorySnapshotNextRunAt = new Date(Date.now() + oregansInventorySnapshotInitialDelayMs).toISOString();
  oregansInventorySnapshotTimer = setTimeout(run, oregansInventorySnapshotInitialDelayMs);
  oregansInventorySnapshotTimer.unref?.();
}

function scheduleNextOregansInventorySnapshotRun(run, schedule = currentOregansInventorySnapshotSchedule()) {
  if (!oregansInventorySnapshotEnabled || shuttingDown) return;
  const now = new Date();
  oregansInventorySnapshotNextRunAt = new Date(now.getTime() + schedule.delayMs).toISOString();
  oregansInventorySnapshotTimer = setTimeout(run, schedule.delayMs);
  oregansInventorySnapshotTimer.unref?.();
}

function currentOregansInventorySnapshotSchedule(now = new Date()) {
  return inventorySnapshotScheduleAt({
    now,
    timeZone: oregansInventorySnapshotTimeZone,
    dayIntervalMs: oregansInventorySnapshotIntervalMs,
    offHoursIntervalMs: oregansInventorySnapshotOffHoursIntervalMs,
    offHoursEnabled: oregansInventorySnapshotOffHoursEnabled,
    dayStartHour: oregansInventorySnapshotDayStartHour,
    dayEndHour: oregansInventorySnapshotDayEndHour,
  });
}

function stopOregansInventorySnapshotScheduler() {
  if (!oregansInventorySnapshotTimer) return;
  clearTimeout(oregansInventorySnapshotTimer);
  oregansInventorySnapshotTimer = null;
  oregansInventorySnapshotNextRunAt = null;
}

async function queueOregansInventorySnapshotRun({ reason = "manual" } = {}) {
  oregansInventorySnapshotPendingRuns += 1;
  oregansInventorySnapshotRunPromise = oregansInventorySnapshotRunPromise.catch(() => {}).then(async () => {
    try {
      return await captureOregansInventorySnapshot({ reason });
    } finally {
      oregansInventorySnapshotPendingRuns = Math.max(0, oregansInventorySnapshotPendingRuns - 1);
    }
  });
  return oregansInventorySnapshotRunPromise;
}

async function captureOregansInventorySnapshot({ reason = "manual" } = {}) {
  const runId = `oregans-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const scopes = oregansInventorySnapshotScopes();
  const observations = [];
  const summary = [];
  const successfulScopes = [];
  const errors = [];

  for (const scope of scopes) {
    try {
      const snapshot = await fetchInventoryCarsSnapshot({
        dealershipId: scope.dealershipId,
        inventoryTypeId: scope.inventoryTypeId,
        bypassCache: true,
      });
      const cars = snapshot.cars.map((car) => normalizeInventoryCar(car, {
        dealership: snapshot.dealership,
        inventoryTypeId: snapshot.inventoryTypeId,
      }));
      observations.push(...cars.map((car) => ({ car, scope })));
      successfulScopes.push(scope);
      summary.push({
        dealershipId: scope.dealershipId,
        dealershipName: scope.dealershipName,
        inventoryTypeId: scope.inventoryTypeId,
        inventoryTypeName: scope.inventoryTypeName,
        count: cars.length,
        fetchedAt: snapshot.fetchedAtIso,
        source: snapshot.source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${scope.dealershipName} ${scope.inventoryTypeName}: ${message}`);
      summary.push({
        dealershipId: scope.dealershipId,
        dealershipName: scope.dealershipName,
        inventoryTypeId: scope.inventoryTypeId,
        inventoryTypeName: scope.inventoryTypeName,
        count: 0,
        error: message,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const status = errors.length === scopes.length ? "failed" : errors.length ? "partial" : "completed";
  const writeResult = writeOregansInventorySnapshotRun({
    runId,
    reason,
    status,
    startedAt,
    finishedAt,
    scopes,
    summary,
    observations,
    successfulScopes,
    errors,
  });
  const retention = maybePruneOregansInventorySnapshotHistory();
  const albumPriceReconciliationPromise = writeResult.priceChanges.length
    ? reconcileAlbumPricesForInventoryPriceChanges(writeResult.priceChanges, finishedAt).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`O'Regan's inventory album price reconciliation failed: ${message}`);
      return {
        status: "failed",
        error: message,
        priceChangeCount: writeResult.priceChanges.length,
        matchedAlbumCount: 0,
        updatedAlbumCount: 0,
        alreadyCurrentAlbumCount: 0,
        regeneratedDescriptionCount: 0,
        staleDescriptionCount: 0,
        skippedCount: 0,
        records: [],
      };
    })
    : null;
  const pushDeliveryPromise = writeResult.newlyObserved.length
    ? queueInventoryAddedPushNotifications(writeResult.newlyObserved, finishedAt)
    : null;
  const priceChangePushDeliveryPromise = writeResult.priceChanges.length
    ? priceChangesWithCarPostClubMedia(writeResult.priceChanges)
      .then((priceChangesForPush) => (
        priceChangesForPush.length
          ? queueInventoryPriceChangePushNotifications(priceChangesForPush, finishedAt)
          : null
      ))
      .catch((error) => {
        console.warn(`O'Regan's inventory price-change push eligibility failed: ${error?.message || error}`);
        return null;
      })
    : null;
  const pushDelivery = pushDeliveryPromise && pushAwaitDelivery
    ? await pushDeliveryPromise
    : null;
  const priceChangePushDelivery = priceChangePushDeliveryPromise && pushAwaitDelivery
    ? await priceChangePushDeliveryPromise
    : null;
  const albumPriceReconciliation = albumPriceReconciliationPromise
    ? await albumPriceReconciliationPromise
    : null;

  return {
    id: runId,
    reason,
    status,
    startedAt,
    finishedAt,
    observed: observations.length,
    scopes: summary,
    errors,
    newInventory: {
      count: writeResult.newlyObserved.length,
      vehicles: writeResult.newlyObserved.slice(0, 20),
    },
    priceChanges: {
      count: writeResult.priceChanges.length,
      vehicles: writeResult.priceChanges.slice(0, 20),
    },
    detailsChanges: {
      count: writeResult.detailsChangeCount,
    },
    removedInventory: {
      count: writeResult.removedInventoryCount,
      vehicles: writeResult.removedInventory.slice(0, 20),
    },
    ...(retention ? { retention } : {}),
    ...(albumPriceReconciliation ? { albumPriceReconciliation } : {}),
    ...(pushDelivery ? { pushDelivery } : {}),
    ...(priceChangePushDelivery ? { priceChangePushDelivery } : {}),
  };
}

function writeOregansInventorySnapshotRun({
  runId,
  reason,
  status,
  startedAt,
  finishedAt,
  scopes,
  summary,
  observations,
  successfulScopes,
  errors,
}) {
  const insertRun = oregansInventorySnapshotsDb.prepare(`
    INSERT INTO oregans_inventory_snapshot_runs (
      id,
      reason,
      status,
      started_at,
      finished_at,
      scope_json,
      summary_json,
      error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateRunChangeCounts = oregansInventorySnapshotsDb.prepare(`
    UPDATE oregans_inventory_snapshot_runs
    SET new_inventory_count = ?,
        price_change_count = ?,
        details_change_count = ?,
        removed_inventory_count = ?
    WHERE id = ?
  `);
  const upsertVehicle = oregansInventorySnapshotsDb.prepare(`
    INSERT INTO oregans_inventory_vehicles (
      vehicle_key,
      vin,
      stock_number,
      dealership_id,
      dealership_name,
      inventory_type_id,
      inventory_type_name,
      title,
      year,
      make,
      model,
      trim,
      price,
      price_value,
      odometer,
      odometer_value,
      exterior_color,
      interior_color,
      body_style,
      fuel_type,
      transmission,
      detail_url,
      raw_json,
      first_seen_at,
      current_seen_at,
      last_seen_at,
      first_snapshot_run_id,
      last_snapshot_run_id,
      present,
      removed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '')
    ON CONFLICT(vehicle_key) DO UPDATE SET
      vin = excluded.vin,
      stock_number = excluded.stock_number,
      dealership_id = excluded.dealership_id,
      dealership_name = excluded.dealership_name,
      inventory_type_id = excluded.inventory_type_id,
      inventory_type_name = excluded.inventory_type_name,
      title = excluded.title,
      year = excluded.year,
      make = excluded.make,
      model = excluded.model,
      trim = excluded.trim,
      price = excluded.price,
      price_value = excluded.price_value,
      odometer = excluded.odometer,
      odometer_value = excluded.odometer_value,
      exterior_color = excluded.exterior_color,
      interior_color = excluded.interior_color,
      body_style = excluded.body_style,
      fuel_type = excluded.fuel_type,
      transmission = excluded.transmission,
      detail_url = excluded.detail_url,
      raw_json = excluded.raw_json,
      current_seen_at = CASE
        WHEN oregans_inventory_vehicles.present = 0 THEN excluded.current_seen_at
        ELSE oregans_inventory_vehicles.current_seen_at
      END,
      last_seen_at = excluded.last_seen_at,
      last_snapshot_run_id = excluded.last_snapshot_run_id,
      present = 1,
      removed_at = ''
  `);
  const insertItem = oregansInventorySnapshotsDb.prepare(`
    INSERT OR REPLACE INTO oregans_inventory_snapshot_items (
      run_id,
      vehicle_key,
      dealership_id,
      inventory_type_id,
      observed_at,
      car_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const markRemoved = oregansInventorySnapshotsDb.prepare(`
    UPDATE oregans_inventory_vehicles
    SET present = 0,
      removed_at = CASE WHEN removed_at = '' THEN ? ELSE removed_at END
    WHERE dealership_id = ?
      AND inventory_type_id = ?
      AND present = 1
      AND last_snapshot_run_id <> ?
      AND last_seen_at <= ?
  `);
  const selectRemoved = oregansInventorySnapshotsDb.prepare(`
    SELECT *
    FROM oregans_inventory_vehicles
    WHERE dealership_id = ?
      AND inventory_type_id = ?
      AND present = 0
      AND removed_at = ?
    ORDER BY stock_number, title
  `);
  const selectVehicle = oregansInventorySnapshotsDb.prepare(`
    SELECT
      vehicle_key,
      present,
      vin,
      stock_number,
      title,
      year,
      make,
      model,
      trim,
      price,
      price_value,
      odometer,
      odometer_value,
      exterior_color,
      interior_color,
      body_style,
      fuel_type,
      transmission,
      detail_url,
      first_seen_at,
      current_seen_at,
      last_seen_at,
      removed_at
    FROM oregans_inventory_vehicles
    WHERE vehicle_key = ?
  `);
  const selectScope = oregansInventorySnapshotsDb.prepare(`
    SELECT snapshot_count
    FROM oregans_inventory_snapshot_scopes
    WHERE dealership_id = ?
      AND inventory_type_id = ?
  `);
  const upsertScope = oregansInventorySnapshotsDb.prepare(`
    INSERT INTO oregans_inventory_snapshot_scopes (
      dealership_id,
      inventory_type_id,
      dealership_name,
      inventory_type_name,
      first_snapshot_run_id,
      last_snapshot_run_id,
      first_snapshot_at,
      last_snapshot_at,
      snapshot_count,
      last_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(dealership_id, inventory_type_id) DO UPDATE SET
      dealership_name = excluded.dealership_name,
      inventory_type_name = excluded.inventory_type_name,
      last_snapshot_run_id = excluded.last_snapshot_run_id,
      last_snapshot_at = excluded.last_snapshot_at,
      snapshot_count = oregans_inventory_snapshot_scopes.snapshot_count + 1,
      last_count = excluded.last_count
  `);
  const observedCountByScope = new Map();
  for (const { scope } of observations) {
    const key = inventorySnapshotScopeKey(scope);
    observedCountByScope.set(key, (observedCountByScope.get(key) || 0) + 1);
  }

  const newlyObserved = [];
  const priceChanges = [];
  const removedInventory = [];
  let detailsChangeCount = 0;
  let removedInventoryCount = 0;
  oregansInventorySnapshotsDb.exec("BEGIN IMMEDIATE");
  try {
    const scopeHasBaseline = new Map(successfulScopes.map((scope) => [
      inventorySnapshotScopeKey(scope),
      Boolean(selectScope.get(scope.dealershipId, scope.inventoryTypeId)),
    ]));

    insertRun.run(
      runId,
      normalizeSpace(reason).slice(0, 40),
      status,
      startedAt,
      finishedAt,
      JSON.stringify(scopes),
      JSON.stringify(summary),
      errors.join("\n").slice(0, 4000),
    );

    for (const { car, scope } of observations) {
      const record = oregansInventorySnapshotVehicleRecord(car, scope, finishedAt, runId);
      const previous = selectVehicle.get(record.vehicleKey);
      const scopeHadBaseline = scopeHasBaseline.get(inventorySnapshotScopeKey(scope));
      if (shouldNotifyNewlyObservedInventory(scopeHadBaseline, previous, finishedAt)) {
        newlyObserved.push(publicOregansInventorySnapshotVehicleFromCar(car, scope, finishedAt, record.vehicleKey));
      } else if (scopeHadBaseline && previous && Number(previous.present)) {
        if (oregansInventorySnapshotPriceChanged(previous, car)) {
          priceChanges.push(publicOregansInventorySnapshotPriceChangeFromCar(car, scope, finishedAt, record.vehicleKey, previous));
        }
        if (oregansInventorySnapshotDetailsChanged(previous, car)) {
          detailsChangeCount += 1;
        }
      }
      upsertVehicle.run(...record.values);
      insertItem.run(
        runId,
        record.vehicleKey,
        scope.dealershipId,
        scope.inventoryTypeId,
        finishedAt,
        JSON.stringify(car),
      );
    }

    const removalCutoff = new Date(Date.parse(finishedAt) - inventoryRemovalGraceMs).toISOString();
    for (const scope of successfulScopes) {
      const removed = markRemoved.run(finishedAt, scope.dealershipId, scope.inventoryTypeId, runId, removalCutoff);
      removedInventoryCount += Number(removed?.changes || 0);
      removedInventory.push(
        ...selectRemoved.all(scope.dealershipId, scope.inventoryTypeId, finishedAt)
          .map(publicOregansInventorySnapshotVehicleFromRow),
      );
      upsertScope.run(
        scope.dealershipId,
        scope.inventoryTypeId,
        scope.dealershipName,
        scope.inventoryTypeName,
        runId,
        runId,
        finishedAt,
        finishedAt,
        observedCountByScope.get(inventorySnapshotScopeKey(scope)) || 0,
      );
    }

    updateRunChangeCounts.run(
      newlyObserved.length,
      priceChanges.length,
      detailsChangeCount,
      removedInventoryCount,
      runId,
    );

    oregansInventorySnapshotsDb.exec("COMMIT");
  } catch (error) {
    oregansInventorySnapshotsDb.exec("ROLLBACK");
    throw error;
  }

  return { newlyObserved, priceChanges, detailsChangeCount, removedInventory, removedInventoryCount };
}

function shouldNotifyNewlyObservedInventory(scopeHasBaseline, previous, observedAt) {
  if (!scopeHasBaseline) return false;
  if (!previous) return true;
  if (Number(previous.present)) return false;
  return !inventoryReappearedWithinPushCooldown(previous, observedAt);
}

function inventoryReappearedWithinPushCooldown(previous, observedAt) {
  if (!inventoryReappearPushCooldownMs) return false;
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime)) return false;
  const referenceTimes = [
    previous.removed_at,
    previous.last_seen_at,
    previous.current_seen_at,
    previous.first_seen_at,
  ].map((value) => Date.parse(value)).filter(Number.isFinite);
  if (!referenceTimes.length) return false;
  const latestKnownTime = Math.max(...referenceTimes);
  return observedTime - latestKnownTime >= 0
    && observedTime - latestKnownTime < inventoryReappearPushCooldownMs;
}

function oregansInventorySnapshotVehicleRecord(car, scope, observedAt, runId) {
  const vehicleKey = oregansInventorySnapshotVehicleKey(car, scope);
  return {
    vehicleKey,
    values: [
      vehicleKey,
      normalizeSpace(car.vin),
      normalizeSpace(car.stockNumber),
      scope.dealershipId,
      scope.dealershipName,
      scope.inventoryTypeId,
      scope.inventoryTypeName,
      normalizeSpace(car.title),
      normalizeSpace(car.year),
      normalizeSpace(car.make),
      normalizeSpace(car.model),
      normalizeSpace(car.trim),
      normalizeSpace(car.price),
      car.priceValue ?? null,
      normalizeSpace(car.odometer),
      car.odometerValue ?? null,
      normalizeSpace(car.exteriorColor),
      normalizeSpace(car.interiorColor),
      normalizeSpace(car.bodyStyle),
      normalizeSpace(car.fuelType),
      normalizeSpace(car.transmission),
      normalizeSpace(car.detailUrl),
      JSON.stringify(car),
      observedAt,
      observedAt,
      observedAt,
      runId,
      runId,
    ],
  };
}

function oregansInventorySnapshotVehicleKey(car, scope) {
  const identifier = normalizeSpace(car.vin || car.inventoryKey || car.stockNumber)
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  return [
    scope.dealershipId,
    scope.inventoryTypeId,
    identifier || crypto.createHash("sha256").update(JSON.stringify(car)).digest("hex").slice(0, 24),
  ].join(":");
}

function inventorySnapshotScopeKey(scope) {
  return `${scope.dealershipId}:${scope.inventoryTypeId}`;
}

function publicOregansInventorySnapshotVehicleFromCar(car, scope, observedAt, vehicleKey) {
  return {
    vehicleKey,
    vin: normalizeSpace(car.vin),
    stockNumber: normalizeSpace(car.stockNumber),
    dealershipId: scope.dealershipId,
    dealershipName: scope.dealershipName,
    inventoryTypeId: scope.inventoryTypeId,
    inventoryTypeName: scope.inventoryTypeName,
    title: normalizeSpace(car.title),
    year: normalizeSpace(car.year),
    make: normalizeSpace(car.make),
    model: normalizeSpace(car.model),
    trim: normalizeSpace(car.trim),
    price: normalizeSpace(car.price),
    priceValue: car.priceValue ?? null,
    odometer: normalizeSpace(car.odometer),
    odometerValue: car.odometerValue ?? null,
    exteriorColor: normalizeSpace(car.exteriorColor),
    interiorColor: normalizeSpace(car.interiorColor),
    bodyStyle: normalizeSpace(car.bodyStyle),
    fuelType: normalizeSpace(car.fuelType),
    transmission: normalizeSpace(car.transmission),
    detailUrl: absolutizeOregansUrl(car.detailUrl),
    firstSeenAt: observedAt,
    currentSeenAt: observedAt,
    lastSeenAt: observedAt,
    present: true,
    removedAt: "",
  };
}

function publicOregansInventorySnapshotPriceChangeFromCar(car, scope, observedAt, vehicleKey, previous) {
  return {
    ...publicOregansInventorySnapshotVehicleFromCar(car, scope, observedAt, vehicleKey),
    previousPrice: normalizeSpace(previous?.price),
    previousPriceValue: nullableFiniteNumber(previous?.price_value),
    currentPrice: normalizeSpace(car.price),
    currentPriceValue: nullableFiniteNumber(car.priceValue),
  };
}

function publicOregansInventorySnapshotVehicleFromRow(row = {}) {
  return {
    vehicleKey: normalizeSpace(row.vehicle_key),
    vin: normalizeSpace(row.vin),
    stockNumber: normalizeSpace(row.stock_number),
    dealershipId: normalizeSpace(row.dealership_id),
    dealershipName: normalizeSpace(row.dealership_name),
    inventoryTypeId: normalizeSpace(row.inventory_type_id),
    inventoryTypeName: normalizeSpace(row.inventory_type_name),
    title: normalizeSpace(row.title),
    year: normalizeSpace(row.year),
    make: normalizeSpace(row.make),
    model: normalizeSpace(row.model),
    trim: normalizeSpace(row.trim),
    price: normalizeSpace(row.price),
    priceValue: nullableFiniteNumber(row.price_value),
    odometer: normalizeSpace(row.odometer),
    odometerValue: nullableFiniteNumber(row.odometer_value),
    exteriorColor: normalizeSpace(row.exterior_color),
    interiorColor: normalizeSpace(row.interior_color),
    bodyStyle: normalizeSpace(row.body_style),
    fuelType: normalizeSpace(row.fuel_type),
    transmission: normalizeSpace(row.transmission),
    detailUrl: absolutizeOregansUrl(row.detail_url),
    firstSeenAt: normalizeSpace(row.first_seen_at),
    currentSeenAt: normalizeSpace(row.current_seen_at),
    lastSeenAt: normalizeSpace(row.last_seen_at),
    present: Boolean(Number(row.present)),
    removedAt: normalizeSpace(row.removed_at),
  };
}

function oregansInventorySnapshotPriceChanged(previous, car) {
  const previousPriceValue = nullableFiniteNumber(previous?.price_value);
  const currentPriceValue = nullableFiniteNumber(car?.priceValue ?? parseCurrency(car?.price));
  if (previousPriceValue !== null && currentPriceValue !== null) {
    return previousPriceValue !== currentPriceValue;
  }

  const previousPrice = normalizeSpace(previous?.price);
  const currentPrice = normalizeSpace(car?.price);
  return Boolean(previousPrice && currentPrice && previousPrice !== currentPrice);
}

function oregansInventorySnapshotDetailsChanged(previous, car) {
  const previousDetails = {
    vin: normalizeSpace(previous?.vin).toUpperCase(),
    stockNumber: normalizeSpace(previous?.stock_number).toUpperCase(),
    title: normalizeSpace(previous?.title),
    year: normalizeSpace(previous?.year),
    make: normalizeSpace(previous?.make),
    model: normalizeSpace(previous?.model),
    trim: normalizeSpace(previous?.trim),
    odometer: normalizeSpace(previous?.odometer),
    odometerValue: nullableFiniteNumber(previous?.odometer_value),
    exteriorColor: normalizeSpace(previous?.exterior_color),
    interiorColor: normalizeSpace(previous?.interior_color),
    bodyStyle: normalizeSpace(previous?.body_style),
    fuelType: normalizeSpace(previous?.fuel_type),
    transmission: normalizeSpace(previous?.transmission),
    detailUrl: normalizeSpace(previous?.detail_url),
  };
  const currentDetails = {
    vin: normalizeSpace(car?.vin).toUpperCase(),
    stockNumber: normalizeSpace(car?.stockNumber).toUpperCase(),
    title: normalizeSpace(car?.title),
    year: normalizeSpace(car?.year),
    make: normalizeSpace(car?.make),
    model: normalizeSpace(car?.model),
    trim: normalizeSpace(car?.trim),
    odometer: normalizeSpace(car?.odometer),
    odometerValue: nullableFiniteNumber(car?.odometerValue),
    exteriorColor: normalizeSpace(car?.exteriorColor),
    interiorColor: normalizeSpace(car?.interiorColor),
    bodyStyle: normalizeSpace(car?.bodyStyle),
    fuelType: normalizeSpace(car?.fuelType),
    transmission: normalizeSpace(car?.transmission),
    detailUrl: normalizeSpace(car?.detailUrl),
  };
  return hashJson(previousDetails) !== hashJson(currentDetails);
}

function nullableFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function reconcileAlbumPricesForInventoryPriceChanges(priceChanges = [], observedAt = new Date().toISOString()) {
  const changes = Array.isArray(priceChanges) ? priceChanges.filter(Boolean) : [];
  const summary = {
    status: "completed",
    priceChangeCount: changes.length,
    matchedAlbumCount: 0,
    updatedAlbumCount: 0,
    alreadyCurrentAlbumCount: 0,
    regeneratedDescriptionCount: 0,
    staleDescriptionCount: 0,
    skippedCount: 0,
    records: [],
  };
  if (!changes.length) return summary;

  const albums = await listAlbums();
  for (const change of changes) {
    const matches = matchingAlbumsForInventoryPriceChange(albums, change);
    if (!matches.length) {
      summary.skippedCount += 1;
      summary.records.push(albumPriceReconciliationRecord(change, {
        action: "skipped",
        reason: "no_matching_media_gallery_album",
      }));
      continue;
    }

    for (const album of matches) {
      summary.matchedAlbumCount += 1;
      const update = await updateAlbumVehiclePriceFromInventoryPriceChange(album, change, observedAt);
      if (!update.updated) {
        if (update.reason === "already_current") summary.alreadyCurrentAlbumCount += 1;
        else summary.skippedCount += 1;
        summary.records.push(albumPriceReconciliationRecord(change, {
          albumId: album.id,
          action: "skipped",
          reason: update.reason,
        }));
        continue;
      }

      summary.updatedAlbumCount += 1;
      const description = await reconcileMarketplaceDescriptionAfterAlbumPriceChange(update.album, change, observedAt);
      if (description.action === "regenerated") summary.regeneratedDescriptionCount += 1;
      if (description.action === "marked_stale") summary.staleDescriptionCount += 1;
      summary.records.push(albumPriceReconciliationRecord(change, {
        albumId: update.album.id,
        action: "updated",
        reason: "price_changed",
        previousAlbumPrice: update.previousAlbumPrice,
        currentPrice: update.currentPrice,
        descriptionAction: description.action,
      }));
    }
  }

  summary.records = summary.records.slice(0, 20);
  return summary;
}

function matchingAlbumsForInventoryPriceChange(albums = [], change = {}) {
  const scopedAlbums = albums.filter((album) => albumPriceChangeScopeMatches(album, change));
  const vinMatches = scopedAlbums.filter((album) => albumMatchesPriceChangeVin(album, change));
  if (vinMatches.length) return vinMatches;
  return scopedAlbums.filter((album) => albumMatchesPriceChangeStock(album, change));
}

async function priceChangesWithCarPostClubMedia(priceChanges = []) {
  const changes = Array.isArray(priceChanges) ? priceChanges.filter(Boolean) : [];
  if (!changes.length) return [];

  const albums = await listAlbums();
  return changes.filter((change) => {
    return matchingAlbumsForInventoryPriceChange(albums, change)
      .some((album) => Number(album?.mediaCount || 0) > 0);
  });
}

function albumPriceChangeScopeMatches(album = {}, change = {}) {
  const vehicle = album?.vehicle || {};
  const source = normalizeSpace(vehicle.source || "oregans").toLowerCase();
  if (source === "manual") return false;

  const dealershipId = normalizeSpace(vehicle.dealershipId || album?.dealership?.id);
  const inventoryTypeId = normalizeSpace(vehicle.inventoryTypeId || album?.inventoryTypeId);
  return Boolean(
    dealershipId
    && inventoryTypeId
    && dealershipId === normalizeSpace(change.dealershipId)
    && inventoryTypeId === normalizeSpace(change.inventoryTypeId),
  );
}

function albumMatchesPriceChangeVin(album = {}, change = {}) {
  const changeVin = inventoryIdentityToken(change.vin);
  if (!changeVin) return false;
  const vehicle = album?.vehicle || {};
  return [vehicle.vin, vehicle.inventoryKey]
    .map(inventoryIdentityToken)
    .some((token) => token && token === changeVin);
}

function albumMatchesPriceChangeStock(album = {}, change = {}) {
  const changeStock = inventoryIdentityToken(change.stockNumber);
  if (!changeStock) return false;
  const vehicle = album?.vehicle || {};
  const albumVin = vehicleVinIdentityToken(vehicle);
  const changeVin = inventoryIdentityToken(change.vin);
  if (albumVin && changeVin && albumVin !== changeVin) return false;
  return inventoryIdentityToken(vehicle.stockNumber) === changeStock;
}

function inventoryIdentityToken(value) {
  return normalizeSpace(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function vehicleVinIdentityToken(vehicle = {}) {
  const vin = inventoryIdentityToken(vehicle.vin);
  if (vin) return vin;
  const inventoryKey = inventoryIdentityToken(vehicle.inventoryKey);
  return inventoryKey.length >= 11 ? inventoryKey : "";
}

async function updateAlbumVehiclePriceFromInventoryPriceChange(album, change, observedAt) {
  const albumId = cleanAlbumId(album?.id);
  const currentPrice = normalizeSpace(change.currentPrice || change.price);
  if (!currentPrice) return { updated: false, reason: "missing_current_price" };

  const metadata = await readAlbumMetadata(albumId);
  if (!albumPriceChangeScopeMatches(metadata, change)) return { updated: false, reason: "album_identity_mismatch" };
  if (!albumMatchesPriceChangeVin(metadata, change) && !albumMatchesPriceChangeStock(metadata, change)) {
    return { updated: false, reason: "album_identity_mismatch" };
  }

  const vehicle = metadata.vehicle && typeof metadata.vehicle === "object" ? { ...metadata.vehicle } : {};
  const previousAlbumPrice = normalizeSpace(vehicle.price);
  const previousAlbumPriceValue = nullableFiniteNumber(vehicle.priceValue ?? parseCurrency(previousAlbumPrice));
  const currentPriceValue = nullableFiniteNumber(change.currentPriceValue ?? parseCurrency(currentPrice));
  const priceTextChanged = previousAlbumPrice !== currentPrice;
  const priceValueChanged = currentPriceValue !== null
    && previousAlbumPriceValue !== null
    && currentPriceValue !== previousAlbumPriceValue;
  if (!priceTextChanged && !priceValueChanged) return { updated: false, reason: "already_current" };

  vehicle.price = currentPrice;
  if (currentPriceValue !== null) vehicle.priceValue = currentPriceValue;
  else delete vehicle.priceValue;
  vehicle.previousPrice = previousAlbumPrice || normalizeSpace(change.previousPrice);
  const previousPriceValue = previousAlbumPriceValue ?? nullableFiniteNumber(change.previousPriceValue);
  if (previousPriceValue !== null) vehicle.previousPriceValue = previousPriceValue;
  vehicle.priceUpdatedAt = observedAt;
  vehicle.priceSource = "oregans_inventory_snapshot";

  metadata.vehicle = vehicle;
  metadata.priceReconciledAt = observedAt;
  metadata.priceReconciledBy = "oregans_inventory_snapshot";
  metadata.priceReconciliation = {
    source: "oregans_inventory_snapshot",
    vehicleKey: normalizeSpace(change.vehicleKey),
    observedAt,
    previousPrice: vehicle.previousPrice,
    previousPriceValue: previousPriceValue ?? null,
    currentPrice,
    currentPriceValue: currentPriceValue ?? null,
  };

  await writeJson(path.join(albumPath(albumId), ".album.json"), metadata);
  return {
    updated: true,
    album: await readAlbum(albumId),
    previousAlbumPrice,
    currentPrice,
  };
}

async function reconcileMarketplaceDescriptionAfterAlbumPriceChange(album, change, observedAt) {
  if (!album?.id || !album.mediaCount) return { action: "skipped", reason: "no_media" };
  const car = carFromAlbum(album);
  const fields = buildMarketplaceFields(car);
  if (!shouldGenerateMarketplaceDescription(fields)) return { action: "skipped", reason: "missing_required_facts" };

  const inputHash = marketplaceDescriptionInputHash(car, fields);
  const store = await readMarketplaceCopyStore(album.id);
  if (isMarketplaceUploadPoolCurrent(store, inputHash)) return { action: "already_current", inputHash };

  if (!marketplaceCopyStoreAllowsAutoRegeneration(store)) {
    await markMarketplaceCopyStoreStaleForPriceChange(album.id, store, change, observedAt, inputHash);
    return { action: "marked_stale", inputHash };
  }

  const generation = await prepareMarketplaceDescriptionsForUpload(car, bootstrapAdminUser(), {
    album,
    uploadedMediaCount: album.mediaCount || 0,
    force: true,
    reason: "inventory_price_change",
  });
  return { action: "regenerated", inputHash, source: generation.source };
}

function marketplaceCopyStoreAllowsAutoRegeneration(store) {
  if (!store || typeof store !== "object") return true;
  if (store.manual === true || store.protected === true) return false;
  const mode = normalizeSpace(store.mode).toLowerCase();
  if (!mode) return true;
  return mode === "upload_pool";
}

async function markMarketplaceCopyStoreStaleForPriceChange(albumId, store, change, observedAt, inputHash) {
  await writeMarketplaceCopyStore(albumId, {
    ...store,
    stale: {
      reason: "inventory_price_change",
      detectedAt: observedAt,
      previousPrice: normalizeSpace(change.previousPrice),
      currentPrice: normalizeSpace(change.currentPrice || change.price),
      inputHash,
    },
  });
}

function albumPriceReconciliationRecord(change = {}, overrides = {}) {
  return {
    stockNumber: normalizeSpace(change.stockNumber),
    vin: normalizeSpace(change.vin),
    dealershipId: normalizeSpace(change.dealershipId),
    inventoryTypeId: normalizeSpace(change.inventoryTypeId),
    previousPrice: normalizeSpace(change.previousPrice),
    currentPrice: normalizeSpace(change.currentPrice || change.price),
    ...overrides,
  };
}

async function queueInventoryAddedPushNotifications(vehicles, timestamp) {
  const groups = vehiclesByTargetDealership(vehicles);
  const deliveries = [];
  for (const [dealershipId, dealershipVehicles] of groups) {
    const targeting = await pushTargetingForDealership(dealershipId);
    const delivery = emptyPushDeliveryTotals();
    for (const [index, vehicle] of dealershipVehicles.entries()) {
      if (index > 0) await delay(inventoryAddedPushSpacingMs);
      addPushDeliveryTotals(delivery, await queuePushNotifications({
        dealershipId,
        payload: oregansInventoryAddedPushPayload([vehicle], timestamp),
      }));
    }
    deliveries.push({
      dealershipId,
      label: targeting.label,
      count: dealershipVehicles.length,
      delivery,
    });
  }
  return aggregatePushDeliveries(deliveries);
}

async function queueInventoryPriceChangePushNotifications(vehicles, timestamp) {
  const totals = emptyPushDeliveryTotals();
  const deliveries = [];
  for (const vehicle of Array.isArray(vehicles) ? vehicles.filter(Boolean) : []) {
    const delivery = await queuePushNotifications({
      payload: oregansInventoryPriceChangePushPayload(vehicle, timestamp),
    });
    addPushDeliveryTotals(totals, delivery);
    deliveries.push({
      vehicleKey: vehicle.vehicleKey || "",
      stockNumber: vehicle.stockNumber || "",
      requested: Number(delivery.requested) || 0,
      delivered: Number(delivery.delivered) || 0,
      failed: Number(delivery.failed) || 0,
      skipped: Number(delivery.skipped) || 0,
      staleRemoved: Number(delivery.staleRemoved) || 0,
      retiredRemoved: Number(delivery.retiredRemoved) || 0,
      logged: Number(delivery.logged) || 0,
    });
  }
  return {
    ...totals,
    vehicles: deliveries,
  };
}

function emptyPushDeliveryTotals() {
  return {
    requested: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
    staleRemoved: 0,
    retiredRemoved: 0,
    logged: 0,
  };
}

function addPushDeliveryTotals(total, delivery = {}) {
  total.requested += Number(delivery.requested) || 0;
  total.delivered += Number(delivery.delivered) || 0;
  total.failed += Number(delivery.failed) || 0;
  total.skipped += Number(delivery.skipped) || 0;
  total.staleRemoved += Number(delivery.staleRemoved) || 0;
  total.retiredRemoved += Number(delivery.retiredRemoved) || 0;
  total.logged += Number(delivery.logged) || 0;
  return total;
}

function vehiclesByTargetDealership(vehicles) {
  const groups = new Map();
  for (const vehicle of Array.isArray(vehicles) ? vehicles : []) {
    const dealershipId = normalizeAuthDealershipId(vehicle?.dealershipId || vehicle?.dealership?.id || vehicle?.dealershipName);
    if (!dealershipId) continue;
    if (!groups.has(dealershipId)) groups.set(dealershipId, []);
    groups.get(dealershipId).push(vehicle);
  }
  return groups;
}

function aggregatePushDeliveries(deliveries) {
  const totals = {
    requested: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
    staleRemoved: 0,
    retiredRemoved: 0,
    logged: 0,
    dealerships: [],
  };
  for (const item of deliveries) {
    const delivery = item.delivery || {};
    totals.requested += Number(delivery.requested) || 0;
    totals.delivered += Number(delivery.delivered) || 0;
    totals.failed += Number(delivery.failed) || 0;
    totals.skipped += Number(delivery.skipped) || 0;
    totals.staleRemoved += Number(delivery.staleRemoved) || 0;
    totals.retiredRemoved += Number(delivery.retiredRemoved) || 0;
    totals.logged += Number(delivery.logged) || 0;
    totals.dealerships.push({
      dealershipId: item.dealershipId,
      label: item.label,
      count: item.count,
      requested: Number(delivery.requested) || 0,
      delivered: Number(delivery.delivered) || 0,
      failed: Number(delivery.failed) || 0,
      skipped: Number(delivery.skipped) || 0,
      staleRemoved: Number(delivery.staleRemoved) || 0,
      retiredRemoved: Number(delivery.retiredRemoved) || 0,
      logged: Number(delivery.logged) || 0,
    });
  }
  return totals;
}

function oregansInventoryAddedPushPayload(vehicles, timestamp) {
  const cleanVehicles = Array.isArray(vehicles) ? vehicles.filter(Boolean) : [];
  const first = cleanVehicles[0] || {};
  const dealership = publicAuthDealership(first.dealershipId || first.dealership?.id || first.dealershipName);
  const dealershipLabel = dealership?.label || normalizeSpace(first.dealershipName) || "O'Regan's";
  const title = inventoryAddedPushText(first, dealershipLabel);
  const body = inventoryAddedPushBody(first);
  const timestampMs = Date.parse(timestamp) || Date.now();
  const tagVehicleKey = inventoryAddedPushTagVehicleKey(first);
  return {
    kind: "inventory_added",
    type: "inventory_added",
    notificationType: "inventory_added",
    route: "vehicle_media_intake",
    messageId: `inventory-added-${timestampMs}-${tagVehicleKey}-${crypto.randomUUID().slice(0, 8)}`,
    title,
    body,
    tag: `carpostclub-inventory-added-${dealership?.id || "unknown"}-${tagVehicleKey}-${timestampMs}`,
    url: vehicleDeepLink(first),
    dealershipId: dealership?.id || normalizeAuthDealershipId(first.dealershipId),
    inventoryTypeId: normalizeSpace(first.inventoryTypeId || defaultInventoryTypeId),
    inventoryKey: first.inventoryKey || first.vin || "",
    stockNumber: first.stockNumber || "",
    timestamp,
  };
}

function oregansInventoryPriceChangePushPayload(vehicle, timestamp) {
  const timestampMs = Date.parse(timestamp) || Date.now();
  const tagVehicleKey = inventoryAddedPushTagVehicleKey(vehicle);
  const messageId = `price-change-${timestampMs}-${tagVehicleKey}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    kind: "price_change",
    type: "price_change",
    notificationType: "price_change",
    route: "notifications",
    messageId,
    title: inventoryPriceChangePushTitle(vehicle),
    body: inventoryPriceChangePushBody(vehicle),
    tag: `carpostclub-price-change-${tagVehicleKey}-${timestampMs}`,
    url: notificationsDeepLink({ notificationId: messageId }),
    dealershipId: vehicle.dealershipId,
    inventoryTypeId: normalizeSpace(vehicle.inventoryTypeId || defaultInventoryTypeId),
    inventoryKey: vehicle.inventoryKey || vehicle.vin || "",
    stockNumber: vehicle.stockNumber || "",
    timestamp,
  };
}

function oregansInventorySnapshotScopes() {
  const dealershipIds = csvEnvIds(
    process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_DEALERSHIP_IDS
      || process.env.OREGANS_INVENTORY_SNAPSHOT_DEALERSHIP_IDS,
    oregansDealerships.map((dealership) => dealership.id),
  );
  const inventoryTypeIds = csvEnvIds(
    process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_INVENTORY_TYPE_IDS
      || process.env.OREGANS_INVENTORY_SNAPSHOT_INVENTORY_TYPE_IDS,
    inventoryTypes.map((type) => type.id),
  );
  const scopes = [];
  for (const dealershipId of dealershipIds) {
    const dealership = cleanDealershipId(dealershipId);
    for (const inventoryTypeId of inventoryTypeIds) {
      const cleanTypeId = cleanInventoryTypeId(inventoryTypeId);
      scopes.push({
        dealershipId: dealership.id,
        dealershipName: dealership.name,
        inventoryTypeId: cleanTypeId,
        inventoryTypeName: inventoryTypeName(cleanTypeId),
      });
    }
  }
  return scopes;
}

function csvEnvIds(value, fallback) {
  const ids = String(value || "")
    .split(",")
    .map((id) => normalizeSpace(id))
    .filter(Boolean);
  return ids.length ? ids : [...fallback];
}

function inventorySnapshotQueryFilters(query = {}) {
  const dealershipId = normalizeSpace(query.dealershipId);
  const inventoryTypeId = normalizeSpace(query.inventoryTypeId);
  const since = normalizeIsoDate(query.since)
    || (normalizeSpace(query.date).toLowerCase() === "today" ? halifaxTodayStartIso() : "")
    || halifaxTodayStartIso();
  return {
    since,
    dealershipId: dealershipId ? cleanDealershipId(dealershipId).id : "",
    inventoryTypeId: inventoryTypeId ? cleanInventoryTypeId(inventoryTypeId) : "",
    limit: Math.min(500, positiveInteger(query.limit, 100)),
  };
}

function oregansInventoryVehiclesAddedSince({ since, dealershipId = "", inventoryTypeId = "", limit = 100 }) {
  const conditions = ["current_seen_at >= ?"];
  const params = [since];
  if (dealershipId) {
    conditions.push("dealership_id = ?");
    params.push(dealershipId);
  }
  if (inventoryTypeId) {
    conditions.push("inventory_type_id = ?");
    params.push(inventoryTypeId);
  }
  const rows = oregansInventorySnapshotsDb.prepare(`
    SELECT *
    FROM oregans_inventory_vehicles
    WHERE ${conditions.join(" AND ")}
    ORDER BY current_seen_at DESC, dealership_id, inventory_type_id, stock_number
    LIMIT ?
  `).all(...params, limit);
  return {
    since,
    dealershipId,
    inventoryTypeId,
    count: rows.length,
    vehicles: rows.map(publicOregansInventorySnapshotVehicle),
  };
}

function oregansInventorySnapshotStatus() {
  const latestRun = oregansInventorySnapshotsDb.prepare(`
    SELECT *
    FROM oregans_inventory_snapshot_runs
    ORDER BY started_at DESC
    LIMIT 1
  `).get();
  const presentCounts = oregansInventorySnapshotsDb.prepare(`
    SELECT dealership_id, dealership_name, inventory_type_id, inventory_type_name, COUNT(*) AS count
    FROM oregans_inventory_vehicles
    WHERE present = 1
    GROUP BY dealership_id, inventory_type_id
    ORDER BY dealership_id, inventory_type_id
  `).all();
  return {
    latestRun: latestRun ? publicOregansInventorySnapshotRun(latestRun) : null,
    retention: {
      enabled: oregansInventorySnapshotRetentionDays > 0,
      days: oregansInventorySnapshotRetentionDays,
      pruneIntervalMs: oregansInventorySnapshotPruneIntervalMs,
      lastPrune: oregansInventorySnapshotLastPrune,
    },
    removalGraceMs: inventoryRemovalGraceMs,
    presentCounts: presentCounts.map((row) => ({
      dealershipId: row.dealership_id,
      dealershipName: row.dealership_name,
      inventoryTypeId: row.inventory_type_id,
      inventoryTypeName: row.inventory_type_name,
      count: Number(row.count || 0),
    })),
  };
}

function publicOregansInventorySnapshotRun(row) {
  return {
    id: row.id,
    reason: row.reason,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    scopes: safeParseJson(row.summary_json, []),
    error: row.error,
    newInventoryCount: Number(row.new_inventory_count || 0),
    priceChangeCount: Number(row.price_change_count || 0),
    detailsChangeCount: Number(row.details_change_count || 0),
    removedInventoryCount: Number(row.removed_inventory_count || 0),
  };
}

function publicOregansInventorySnapshotVehicle(row) {
  return {
    vehicleKey: row.vehicle_key,
    vin: row.vin,
    stockNumber: row.stock_number,
    dealershipId: row.dealership_id,
    dealershipName: row.dealership_name,
    inventoryTypeId: row.inventory_type_id,
    inventoryTypeName: row.inventory_type_name,
    title: row.title,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim,
    price: row.price,
    priceValue: row.price_value,
    odometer: row.odometer,
    odometerValue: row.odometer_value,
    exteriorColor: row.exterior_color,
    interiorColor: row.interior_color,
    bodyStyle: row.body_style,
    fuelType: row.fuel_type,
    transmission: row.transmission,
    detailUrl: absolutizeOregansUrl(row.detail_url),
    firstSeenAt: row.first_seen_at,
    currentSeenAt: row.current_seen_at,
    lastSeenAt: row.last_seen_at,
    present: Boolean(row.present),
    removedAt: row.removed_at,
  };
}

function halifaxTodayStartIso() {
  return startOfDayInTimeZone(new Date(), oregansInventorySnapshotTimeZone);
}

function startOfDayInTimeZone(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const utcMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const offset = timeZoneOffsetMinutes(new Date(utcMidnight), timeZone);
  const candidate = new Date(utcMidnight - offset * 60 * 1000);
  const correctedOffset = timeZoneOffsetMinutes(candidate, timeZone);
  return new Date(utcMidnight - correctedOffset * 60 * 1000).toISOString();
}

function timeZoneOffsetMinutes(date, timeZone) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "";
  const match = value.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return -date.getTimezoneOffset();
  const sign = match[1] === "-" ? -1 : 1;
  return sign * ((Number(match[2]) || 0) * 60 + (Number(match[3]) || 0));
}

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function emptyMarketplaceCopyStore() {
  return { users: {} };
}

function marketplaceCopyHistoryWithSnapshot(previousStore, metadata = {}) {
  const existingHistory = Array.isArray(previousStore?.history) ? previousStore.history : [];
  const snapshot = marketplaceCopyStoreSnapshot(previousStore, metadata);
  const history = snapshot ? [...existingHistory, snapshot] : existingHistory;
  return history.slice(-8);
}

function marketplaceCopyStoreSnapshot(store, metadata = {}) {
  if (!store || typeof store !== "object") return null;
  const hasStoreContent = store.promptVersion
    || store.inputHash
    || Array.isArray(store.variants)
    || (store.users && Object.keys(store.users).length > 0);
  if (!hasStoreContent) return null;

  return {
    replacedAt: normalizeIsoDate(metadata.replacedAt) || new Date().toISOString(),
    reason: normalizeSpace(metadata.reason || "regenerated").slice(0, 80),
    replacedBy: metadata.replacedBy || null,
    mode: normalizeSpace(store.mode).slice(0, 80),
    promptVersion: normalizeSpace(store.promptVersion).slice(0, 120),
    inputHash: normalizeSpace(store.inputHash).slice(0, 160),
    generatedAt: normalizeIsoDate(store.generatedAt) || "",
    variantCount: Array.isArray(store.variants) ? store.variants.length : Number(store.variantCount || 0) || 0,
    userDescriptions: marketplaceCopyUserDescriptionSnapshots(store),
    variants: marketplaceCopyVariantSnapshots(store),
  };
}

function marketplaceCopyUserDescriptionSnapshots(store = {}) {
  return Object.entries(store.users && typeof store.users === "object" ? store.users : {})
    .map(([userKey, copy]) => ({
      userKey: normalizeSpace(userKey).slice(0, 120),
      variantId: normalizeSpace(copy?.variantId).slice(0, 80),
      promptVersion: normalizeSpace(copy?.promptVersion).slice(0, 120),
      source: normalizeSpace(copy?.source).slice(0, 80),
      generatedAt: normalizeIsoDate(copy?.generatedAt) || "",
      description: String(copy?.description || "").slice(0, 1800),
    }))
    .filter((snapshot) => snapshot.description);
}

function marketplaceCopyVariantSnapshots(store = {}) {
  return (Array.isArray(store.variants) ? store.variants : [])
    .map((variant) => ({
      id: normalizeSpace(variant?.id).slice(0, 80),
      source: normalizeSpace(variant?.source).slice(0, 80),
      model: normalizeSpace(variant?.model).slice(0, 120) || null,
      generatedAt: normalizeIsoDate(variant?.generatedAt) || "",
      description: String(variant?.description || "").slice(0, 1800),
    }))
    .filter((snapshot) => snapshot.id && snapshot.description)
    .slice(0, marketplaceDescriptionVariantCount);
}

async function readMarketplaceCopyStore(albumId) {
  albumId = cleanAlbumId(albumId);
  const row = marketplaceDescriptionsDb.prepare(`
    SELECT store_json
    FROM marketplace_description_stores
    WHERE album_id = ?
  `).get(albumId);
  if (row?.store_json) return JSON.parse(row.store_json);

  const legacyStore = await readLegacyMarketplaceCopyStore(albumId);
  if (legacyStore && typeof legacyStore === "object" && !Array.isArray(legacyStore)) {
    await writeMarketplaceCopyStore(albumId, legacyStore, { mirrorLegacy: false });
    return legacyStore;
  }

  return emptyMarketplaceCopyStore();
}

async function writeMarketplaceCopyStore(albumId, store, { mirrorLegacy = true } = {}) {
  albumId = cleanAlbumId(albumId);
  const now = new Date().toISOString();
  marketplaceDescriptionsDb.prepare(`
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
    normalizeSpace(store?.mode),
    normalizeSpace(store?.promptVersion),
    normalizeSpace(store?.inputHash),
    JSON.stringify(store),
    now,
    now,
  );

  if (mirrorLegacy) await writeLegacyMarketplaceCopyStore(albumId, store);
}

async function readLegacyMarketplaceCopyStore(albumId) {
  try {
    return await readJson(marketplaceCopyPath(albumId), null);
  } catch (error) {
    if (["EISDIR", "EPERM"].includes(error?.code)) return null;
    throw error;
  }
}

async function writeLegacyMarketplaceCopyStore(albumId, store) {
  try {
    await writeJson(marketplaceCopyPath(albumId), store);
  } catch (error) {
    console.warn("Legacy marketplace copy sidecar write skipped:", error instanceof Error ? error.message : String(error));
  }
}

async function updateMarketplaceCopyStore(albumId, mutator) {
  albumId = cleanAlbumId(albumId);
  const previous = marketplaceCopyStoreWritePromises.get(albumId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const store = await readMarketplaceCopyStore(albumId);
    const result = await mutator(store);
    if (result?.write !== false) await writeMarketplaceCopyStore(albumId, store);
    return result?.value;
  });
  const cleanup = next.finally(() => {
    if (marketplaceCopyStoreWritePromises.get(albumId) === cleanup) {
      marketplaceCopyStoreWritePromises.delete(albumId);
    }
  });
  marketplaceCopyStoreWritePromises.set(albumId, cleanup);
  return next;
}

function isMarketplaceUploadPoolCurrent(store, inputHash) {
  return store?.mode === "upload_pool"
    && store.promptVersion === marketplaceDescriptionPromptVersion
    && store.inputHash === inputHash
    && Array.isArray(store.variants)
    && store.variants.length > 0;
}

async function assignMarketplaceDescriptionsToUsers(albumId, users, inputHash) {
  const assigned = [];
  for (const user of users) {
    const copy = await assignMarketplaceDescriptionToUser(albumId, user, inputHash);
    if (copy) assigned.push(copy);
  }
  return assigned;
}

async function assignMarketplaceDescriptionToUser(albumId, user, inputHash, { force = false } = {}) {
  const userKey = marketplaceUserKey(user);
  return updateMarketplaceCopyStore(albumId, (store) => {
    if (!isMarketplaceUploadPoolCurrent(store, inputHash)) return { write: false, value: null };

    store.users = store.users && typeof store.users === "object" ? store.users : {};
    store.assignments = store.assignments && typeof store.assignments === "object" ? store.assignments : {};

    const existing = store.users[userKey];
    if (!force && existing?.inputHash === inputHash && existing.promptVersion === marketplaceDescriptionPromptVersion) {
      return { write: false, value: marketplaceAssignedCopyResponse(existing, inputHash) };
    }

    const assignedVariantIds = new Set(Object.entries(store.assignments)
      .filter(([key]) => key !== userKey)
      .map(([, variantId]) => variantId));
    const currentVariantId = store.assignments[userKey] || existing?.variantId || "";
    const availableVariants = store.variants.filter((candidate) => !assignedVariantIds.has(candidate.id));
    const targetedVariant = availableVariants.find((candidate) => candidate.targetUserKey === userKey)
      || store.variants.find((candidate) => candidate.targetUserKey === userKey && candidate.id === currentVariantId);
    const variant = force
      ? availableVariants.find((candidate) => candidate.id !== currentVariantId)
        || store.variants.find((candidate) => candidate.id !== currentVariantId)
        || store.variants.find((candidate) => candidate.id === currentVariantId)
      : targetedVariant
        || store.variants.find((candidate) => candidate.id === currentVariantId)
        || availableVariants[0]
        || marketplaceReusableDescriptionVariant(store.variants, userKey, inputHash);
    if (!variant) return { write: false, value: null };

    store.assignments[userKey] = variant.id;
    const assignedAt = new Date().toISOString();
    const copy = {
      inputHash,
      model: variant.model || null,
      promptVersion: marketplaceDescriptionPromptVersion,
      variantId: variant.id,
      description: variant.description,
      targetUserKey: variant.targetUserKey || null,
      targetUserDisplayName: variant.targetUserDisplayName || null,
      styleHint: variant.styleHint || null,
      generatedAt: variant.generatedAt || store.generatedAt || assignedAt,
      assignedAt,
      source: variant.source || "template-upload",
      usage: variant.usage || null,
    };
    store.users[userKey] = copy;
    return { value: marketplaceAssignedCopyResponse(copy, inputHash) };
  });
}

function marketplaceReusableDescriptionVariant(variants = [], userKey = "", inputHash = "") {
  const candidates = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (!candidates.length) return null;
  const index = marketplaceVariantIndex(userKey, candidates.length, inputHash);
  return candidates[index] || candidates[0] || null;
}

function marketplaceAssignedCopyResponse(copy, inputHash) {
  return {
    description: copy.description,
    source: copy.source || "template-upload",
    model: copy.model || null,
    generatedAt: copy.generatedAt || null,
    promptVersion: copy.promptVersion || marketplaceDescriptionPromptVersion,
    inputHash,
    variantId: copy.variantId || null,
  };
}

async function marketplaceAssignmentUsers(primaryUser) {
  const users = [bootstrapAdminUser()];
  const store = await readAuthUsers();
  users.push(...store.users.filter((user) => user.status === "approved").map(authUserFromAccount));
  if (primaryUser) users.push(primaryUser);
  const seen = new Set();
  return users.filter((user) => {
    const key = marketplaceUserKey(user);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function marketplaceCopyPath(albumId) {
  return path.join(albumPath(albumId), ".marketplace-copy.json");
}

async function albumHasMedia(albumId) {
  return (await listAlbumPhotos(albumId)).length > 0;
}

async function removeMarketplaceCopyIfAlbumEmpty(albumId) {
  if (await albumHasMedia(albumId)) return;
  await removeMarketplaceCopyStore(albumId);
}

async function removeMarketplaceCopyStore(albumId) {
  // Description pools live in SQLite so they can be reused after media is cleared.
  // Remove only the legacy sidecar file that older releases wrote into album folders.
  await fs.unlink(marketplaceCopyPath(albumId)).catch((error) => {
    if (!["ENOENT", "EISDIR", "EPERM"].includes(error?.code)) throw error;
  });
}

function marketplaceUserKey(user) {
  return normalizeAuthUsername(user?.username || authUsername || "admin") || "admin";
}

function marketplacePostingProfiles(users = [], count = marketplaceDescriptionVariantCount) {
  const profiles = [];
  for (let index = 0; index < count; index += 1) {
    const user = users[index] || null;
    const userKey = user ? marketplaceUserKey(user) : "";
    profiles.push({
      variantId: `variant-${index + 1}`,
      userKey: userKey || `variant-${index + 1}`,
      displayName: normalizeDisplayName(user?.displayName) || normalizeAuthUsername(user?.username) || `Poster ${index + 1}`,
      styleHint: marketplacePostingStyleHint(userKey || `variant-${index + 1}`, index),
    });
  }
  return profiles;
}

function marketplaceVariantPostingMetadata(profile = null) {
  if (!profile) return {};
  return {
    targetUserKey: profile.userKey || null,
    targetUserDisplayName: profile.displayName || null,
    styleHint: profile.styleHint || null,
  };
}

function marketplacePostingStyleHint(userKey, index = 0) {
  const hints = [
    "concise and practical, with the strongest facts up front",
    "slightly warmer and conversational, still straightforward",
    "organized and detail-first, like a quick note to a serious buyer",
    "calm and confident, with short sentences and no salesy wording",
    "friendly but restrained, focused on value and condition-related facts",
    "matter-of-fact, with a local dealership tone instead of ad copy",
    "helpful and direct, with a little more context around features",
    "simple and clean, written for someone comparing a few vehicles",
  ];
  return hints[marketplaceVariantIndex(userKey || `style-${index}`, hints.length, String(index))];
}

function marketplaceDealershipContext(car = {}) {
  const dealership = car.dealership
    || oregansDealerships.find((candidate) => candidate.id === normalizeSpace(car.dealershipId))
    || null;
  const name = normalizeSpace(dealership?.name || car.dealershipName || car.ownerLocation) || "O'Regan's";
  const city = marketplaceDealershipCity(name) || marketplaceLocation.split(",")[0].trim() || "Halifax";
  const region = marketplaceLocation.includes(",") ? marketplaceLocation.split(",").slice(1).join(",").trim() : "";
  const location = normalizeSpace([city, region].filter(Boolean).join(", ")) || marketplaceLocation;
  return {
    id: dealership?.id || normalizeSpace(car.dealershipId),
    name,
    city,
    location,
    postalCode: marketplacePostalCode,
    label: name,
    contactName: marketplaceContactPerson,
  };
}

function marketplaceDealershipCity(dealershipName = "") {
  const text = normalizeSearchToken(dealershipName);
  if (text.includes("dartmouth")) return "Dartmouth";
  if (text.includes("halifax")) return "Halifax";
  return "";
}

function buildMarketplaceTitle(car) {
  return [car.year, car.make, car.model].filter(Boolean).join(" ").trim() || car.title || "Vehicle for sale";
}

function marketplaceUsefulFact(value) {
  const text = normalizeSpace(value);
  if (!text) return "";
  const normalized = normalizeSearchToken(text);
  const placeholders = new Set([
    "other",
    "unknown",
    "none",
    "null",
    "undefined",
    "n a",
    "na",
    "not applicable",
    "not available",
    "not specified",
    "unspecified",
    "tbd",
    "needs review",
  ]);
  if (placeholders.has(normalized)) return "";
  if (/\bnot specified\b/i.test(text)) return "";
  return text;
}

function marketplaceUsefulInteriorColor(value) {
  return marketplaceUsefulFact(value);
}

function marketplaceVehicleLead(car, fields = {}) {
  const title = buildMarketplaceTitle(car);
  const trim = marketplaceUsefulFact(car.trim || fields.trim);
  if (!trim) return title;
  const titleToken = normalizeSearchToken(title);
  const trimToken = normalizeSearchToken(trim);
  if (trimToken && titleToken.includes(trimToken)) return title;
  return `${title} ${trim}`;
}

function marketplaceMileageText(fields = {}, car = {}) {
  if (fields.mileage) return `${fields.mileage.toLocaleString("en-CA")} km`;
  return normalizeSpace(car.odometer);
}

function marketplacePriceText(fields = {}, car = {}) {
  if (fields.price) return `$${fields.price.toLocaleString("en-CA")}`;
  return normalizeSpace(car.price);
}

function marketplaceLowerSpec(value) {
  const text = marketplaceUsefulFact(value);
  if (!text) return "";
  return /^[A-Z0-9 +.-]{2,}$/.test(text) ? text : text.toLowerCase();
}

function marketplaceTransmissionPhrase(value) {
  const text = marketplaceLowerSpec(value);
  if (!text) return "";
  return /\btransmission\b/i.test(text) ? text : `${text} transmission`;
}

function marketplaceFuelPhrase(value) {
  const text = marketplaceLowerSpec(value);
  if (!text) return "";
  if (/\belectric\b/i.test(text)) return "electric powertrain";
  if (/\bhybrid\b/i.test(text)) return `${text} powertrain`;
  if (/\b(?:gasoline|petrol|diesel|flex)\b/i.test(text)) return `${text} engine`;
  return text;
}

function marketplaceArticlePhrase(value) {
  const text = normalizeSpace(value);
  if (!text) return "";
  if (/^(?:a|an)\s+/i.test(text)) return text;
  return /^[aeiou]/i.test(text) ? `an ${text}` : `a ${text}`;
}

function marketplaceBodyStyleBenefit(bodyStyle) {
  const style = normalizeSearchToken(bodyStyle);
  if (!style) return "";
  if (style.includes("suv")) return "The SUV layout gives you useful space for daily driving, errands, and weekend cargo.";
  if (style.includes("truck")) return "The truck layout adds practical cargo flexibility for work, errands, and rougher weather.";
  if (style.includes("minivan") || style === "van") return "The minivan layout is a strong fit for passengers, family gear, and day-to-day flexibility.";
  if (style.includes("hatch")) return "The hatchback layout keeps it easy to park while still giving you flexible cargo room.";
  if (style.includes("sedan")) return "The sedan layout keeps the vehicle easy to live with for commuting and everyday driving.";
  if (style.includes("wagon")) return "The wagon layout gives you a useful mix of passenger comfort and cargo space.";
  return "";
}

function marketplaceWinterBenefit(car = {}) {
  const text = normalizeSearchToken([car.title, car.trim, car.tagline, car.descriptionPreview].filter(Boolean).join(" "));
  if (/\bawd\b|all wheel drive/.test(text)) return "All-wheel drive is a helpful plus for Nova Scotia winter roads.";
  if (/\b4wd\b|four wheel drive/.test(text)) return "Four-wheel drive adds useful confidence for winter weather and rougher road conditions.";
  return "";
}

function marketplaceDescriptionFeatureHighlights(car = {}, limit = 5) {
  return featureHighlights(car).slice(0, limit);
}

function marketplaceDescriptionFeatureBlock(highlights = []) {
  if (highlights.length < 3) return "";
  return [
    "Feature highlights:",
    ...highlights.slice(0, 5).map((highlight) => `- ${highlight}`),
  ].join("\n");
}

function marketplaceDescriptionDetailBlock(car, fields = {}) {
  const mileageText = marketplaceMileageText(fields, car);
  const bodyStyle = marketplaceUsefulFact(fields.bodyStyle);
  const exteriorColor = marketplaceUsefulFact(fields.exteriorColor);
  const interiorColor = marketplaceUsefulInteriorColor(fields.interiorColor);
  const transmission = marketplaceUsefulFact(fields.transmission);
  const fuelType = marketplaceUsefulFact(fields.fuelType);
  const highlights = marketplaceDescriptionFeatureHighlights(car, 3);
  const detailLines = [
    mileageText && `Mileage: ${mileageText}`,
    bodyStyle && `Body Style: ${bodyStyle}`,
    exteriorColor && `Exterior: ${exteriorColor}`,
    interiorColor && `Interior: ${interiorColor}`,
    transmission && `Transmission: ${transmission}`,
    fuelType && `Fuel Type: ${fuelType}`,
    highlights.length && `Features: ${naturalList(highlights.slice(0, 3))}`,
    car.vin && `VIN: ${car.vin}`,
  ].filter(Boolean);
  return detailLines.join("\n");
}

function buildMarketplaceLeadControlBaseDescription(car, fields = {}, variantSeed = "", user = null) {
  const lead = marketplaceVehicleLead(car, fields);
  const posterKey = marketplaceUserKey(user);
  const openers = [
    `${lead}. Key vehicle details are listed below.`,
    `${lead}. Vehicle information is organized below.`,
    `${lead}. Main specifications are included below.`,
    `${lead}. Important vehicle details are shown below.`,
    `Vehicle summary for ${lead}.`,
    `${lead}. Details are provided in a simple format.`,
    `${lead}. The main information is listed below.`,
    `${lead}. A concise vehicle summary is included below.`,
  ];
  const opener = openers[marketplaceVariantIndex(variantSeed, openers.length, `${car.vin}:${posterKey}`)];

  const lines = [
    opener,
  ].filter(Boolean);

  const detailBlock = marketplaceDescriptionDetailBlock(car, fields);
  if (detailBlock) lines.push(detailBlock);

  return lines.join("\n\n");
}

function buildMarketplaceDescription(car, fields, user, variantSeed = "") {
  return finalizeMarketplaceBuyerDescription(
    buildMarketplaceLeadControlBaseDescription(car, fields, variantSeed, user),
    fields,
    car,
    user,
  );
}

function marketplaceVariantIndex(variantSeed, count, salt = "") {
  const explicit = String(variantSeed || "").match(/variant-(\d+)/i);
  if (explicit) return Number(explicit[1]) % count;
  return Number.parseInt(hashJson(`${variantSeed}:${salt}`).slice(0, 2), 16) % count;
}

function buildMarketplaceCopyText({ title, fields, description, car, user = null }) {
  const leadControl = shouldLeadControlMarketplaceDescription(user);
  const rows = [
    ["Title", title],
    ["Vehicle type", fields.vehicleType],
    ["Location", fields.location],
    ["Postal code", fields.postalCode],
    ...(!leadControl ? [
      ["Dealership", fields.dealershipName],
      ["Ask for", fields.contactName],
    ] : []),
    ["Year", fields.year],
    ["Make", fields.make],
    ["Model", fields.model],
    ["Mileage", fields.mileage ? `${fields.mileage} km` : null],
    ["Price", fields.price ? `$${fields.price.toLocaleString("en-CA")}` : car.price],
    ["Body style", marketplaceUsefulFact(fields.bodyStyle)],
    ["Exterior color", fields.exteriorColor],
    ["Interior color", marketplaceUsefulInteriorColor(fields.interiorColor)],
    ["Clean title", fields.cleanTitle === true ? "Yes" : "Needs review"],
    ["Vehicle condition", fields.vehicleCondition],
    ["Fuel type", marketplaceUsefulFact(fields.fuelType)],
    ["Transmission", marketplaceUsefulFact(fields.transmission)],
  ];
  return [
    ...rows.map(([label, value]) => `${label}: ${value || "Needs review"}`),
    "",
    "Description:",
    description,
  ].join("\n");
}

function finalizeMarketplaceBuyerDescription(description, fields, car = null, user = null) {
  const fallbackDescription = buildMarketplaceLeadControlBaseDescription(car || {}, fields || {}, "", user);
  const safeDescription = sanitizeMarketplaceBuyerDescription(description, fields, car)
    || sanitizeMarketplaceBuyerDescription(fallbackDescription, fields, car)
    || fallbackDescription;
  return stripMarketplaceInventoryNumbers(
    appendMarketplaceContactLine(appendMarketplacePriceDisclosure(safeDescription, fields, car), fields, car, user),
    car,
  );
}

function appendMarketplacePriceDisclosure(description, fields, car = null) {
  const text = stripMarketplacePriceMentions(description, fields, car).trim();
  const footer = buildMarketplacePriceDisclosure(fields, car);
  if (!text) return footer;
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const withoutDisclosure = paragraphs.filter((paragraph) => !hasMarketplacePriceDisclosure(paragraph));
  return [...withoutDisclosure, footer].join("\n\n");
}

function sanitizeMarketplaceBuyerDescription(description, fields = {}, car = null) {
  const withoutPrice = stripMarketplacePriceMentions(description, fields, car);
  return sanitizeMarketplaceLeadControlDescription(withoutPrice, fields, car);
}

function stripMarketplacePriceMentions(description, fields = {}, car = null) {
  const text = String(description || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return "";
  const pricePatterns = marketplacePriceMentionPatterns(fields, car);
  return text
    .split(/\n{2,}/)
    .map((paragraph) => stripMarketplacePriceParagraph(paragraph, pricePatterns))
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMarketplacePriceParagraph(paragraph, pricePatterns = []) {
  const lines = String(paragraph || "")
    .split("\n")
    .map((line) => stripMarketplacePriceLine(line, pricePatterns))
    .filter(Boolean);
  return lines.join("\n").trim();
}

function stripMarketplacePriceLine(line, pricePatterns = []) {
  const text = String(line || "").trim();
  if (!text || hasMarketplacePriceDisclosure(text) || /^\s*(?:asking\s+)?price\s*[:,-]/i.test(text)) return "";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !hasMarketplacePriceMention(sentence, pricePatterns))
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hasMarketplacePriceMention(value, pricePatterns = []) {
  const text = String(value || "");
  if (!text) return false;
  if (/\b(?:price|priced|asking|listed\s+at|selling\s+for|advertised\s+at)\b/i.test(text)) return true;
  return pricePatterns.some((pattern) => pattern.test(text));
}

function marketplacePriceMentionPatterns(fields = {}, car = null) {
  const rawPrice = fields?.price || parseCurrency(car?.price);
  const values = new Set([marketplacePriceText(fields || {}, car || {}), car?.price]);
  if (rawPrice) {
    const localized = rawPrice.toLocaleString("en-CA");
    const plain = String(rawPrice);
    [localized, plain, localized.replace(/,/g, ""), localized.replace(/,/g, " ")].forEach((value) => {
      if (!value) return;
      values.add(value);
      values.add(`$${value}`);
      values.add(`CA$${value}`);
    });
  }
  return [...values]
    .map(normalizeSpace)
    .filter(Boolean)
    .map((value) => new RegExp(escapeRegExp(value).replace(/,/g, "[,\\s]?"), "i"));
}

function buildMarketplacePriceDisclosure(fields, car = null) {
  const rawPrice = fields?.price || parseCurrency(car?.price);
  const price = rawPrice ? `$${rawPrice.toLocaleString("en-CA")}` : car?.price || "Advertised price";
  return `Price: ${price} plus $${marketplacePriceDisclosureFee.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Documentation Fee, Security Etch, and ${marketplacePriceDisclosureHst}% HST.`;
}

function appendMarketplaceContactLine(description, fields = {}, car = null, user = null) {
  const text = String(description || "").trim();
  const contactLine = buildMarketplaceContactLine(fields, car, user);
  if (!text) return contactLine;
  const paragraphs = text.split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !isMarketplaceContactParagraph(paragraph));
  if (!paragraphs.length) return contactLine;
  const finalParagraph = paragraphs[paragraphs.length - 1] || "";
  if (hasMarketplacePriceDisclosure(finalParagraph)) {
    return [
      ...paragraphs.slice(0, -1),
      contactLine,
      finalParagraph,
    ].join("\n\n").trim();
  }
  return `${text}\n\n${contactLine}`;
}

function buildMarketplaceContactLine(fields = {}, car = null, user = null) {
  if (shouldLeadControlMarketplaceDescription(user)) return "Message for more details!";
  const contactName = normalizeSpace(fields.contactName) || marketplaceContactPerson;
  return `Message me for more details. If you're coming into the dealership, ask for ${contactName}.`;
}

function normalizeMarketplacePostalCode(value) {
  const postalCode = normalizeSpace(value).toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postalCode) ? postalCode : "";
}

function appendMarketplaceLeadControlClosing(description) {
  const text = String(description || "").trim();
  const paragraphs = text.split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !isMarketplaceLeadControlClosingParagraph(paragraph));
  return [...paragraphs, marketplaceLeadControlClosingPhrase].join("\n\n").trim();
}

function sanitizeMarketplaceLeadControlDescription(description, fields = {}, car = null) {
  const blockedNames = marketplaceLeadControlBlockedLocationNames(fields, car);
  const paragraphs = String(description || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => sanitizeMarketplaceLeadControlParagraph(paragraph, blockedNames))
    .filter(Boolean);
  const text = paragraphs.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text || text.length < 20) return "";
  return hasMarketplaceLeadControlUnsafeText(text, blockedNames) ? "" : text;
}

function sanitizeMarketplaceLeadControlParagraph(paragraph, blockedNames) {
  const text = String(paragraph || "").trim();
  if (!text || isMarketplaceContactParagraph(text) || isMarketplaceLeadControlClosingParagraph(text)) return "";
  const lines = text.split("\n").map((line) => sanitizeMarketplaceLeadControlLine(line, blockedNames)).filter(Boolean);
  return lines.join("\n").trim();
}

function sanitizeMarketplaceLeadControlLine(line, blockedNames) {
  const text = String(line || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^\s*(?:https?:\/\/|source listing|source url|detail url)\b/i.test(text)) return "";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return sentences
    .map((sentence) => sanitizeMarketplaceLeadControlSentence(sentence, blockedNames))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeMarketplaceLeadControlSentence(sentence, blockedNames) {
  let text = String(sentence || "").trim();
  if (!text || isMarketplaceLeadControlClosingParagraph(text)) return "";
  text = text
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\b(?:source listing|source url|detail url)\s*[:#-]?\s*\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  text = stripMarketplaceLeadControlBlockedNames(text, blockedNames);
  text = text
    .replace(/\b(?:located|available)\s+(?:at|from|through|on|in)\b\s*[,.:-]*/gi, "")
    .replace(/\b(?:come\s+see(?:\s+it)?|come\s+in|come\s+by|stop\s+by|drop\s+by|walk\s+in|visit\s+us|visit)\b.*$/i, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text || hasMarketplaceLeadControlUnsafeText(text, blockedNames)) return "";
  if (!/[.!?]$/.test(text) && /[A-Za-z0-9)]$/.test(text)) text += ".";
  return text;
}

function stripMarketplaceLeadControlBlockedNames(text, blockedNames) {
  let result = String(text || "");
  for (const name of blockedNames) {
    const escapedName = normalizeSpace(name).split(/\s+/).map(escapeRegExp).join("\\s+");
    const pattern = new RegExp(`\\b${escapedName}\\b`, "ig");
    result = result
      .replace(new RegExp(`\\b(?:at|from|through|by)\\s+${escapedName}\\b`, "ig"), "")
      .replace(new RegExp(`\\b${escapedName}\\s+(?:has|offers|presents)\\s+this\\b`, "ig"), "This")
      .replace(pattern, "");
  }
  return result;
}

function hasMarketplaceLeadControlUnsafeText(value, blockedNames = []) {
  const text = String(value || "");
  const normalized = normalizeSearchToken(text);
  if (!normalized) return false;
  const compactNormalized = normalized.replace(/\s+/g, "");
  if (blockedNames.some((name) => {
    const token = normalizeSearchToken(name);
    return token && (
      normalized.includes(token)
      || compactNormalized.includes(token.replace(/\s+/g, ""))
    );
  })) return true;
  if (/\b(?:located|available)\b/i.test(text)) return true;
  if (/\b(?:located\s+at|available\s+(?:at|from|through)|come\s+in|come\s+by|come\s+see|stop\s+by|drop\s+by|walk\s+in|visit\s+us|visit)\b/i.test(text)) return true;
  if (/\b(?:source\s+(?:listing|location)|inventory\s+source|lot\s+location|store|branch|dealership)\b/i.test(text)) return true;
  if (/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|boulevard|blvd\.?|lane|ln\.?|highway|hwy\.?|court|ct\.?|way)\b/i.test(text)) return true;
  return false;
}

function marketplaceLeadControlBlockedLocationNames(fields = {}, car = null) {
  const dealership = marketplaceDealershipContext(car || {});
  const values = [
    fields?.dealershipName,
    fields?.dealershipLabel,
    dealership.name,
    dealership.label,
    car?.dealershipName,
    car?.ownerLocation,
    car?.dealership?.name,
    ...oregansDealerships.map((candidate) => candidate.name),
  ];
  const seen = new Set();
  return values
    .map(normalizeSpace)
    .filter(Boolean)
    .filter((name) => {
      const token = normalizeSearchToken(name);
      if (!token || token === "o regan s" || token === "oregans") return false;
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

function shouldLeadControlMarketplaceDescription(user = null) {
  return !isInternalMarketplaceDescriptionUser(user);
}

function isInternalMarketplaceDescriptionUser(user = null) {
  if (user?.role === "admin") return true;
  const username = normalizeAuthUsername(user?.username);
  const bootstrapUsername = normalizeAuthUsername(authUsername);
  if (username && bootstrapUsername && username === bootstrapUsername) return true;
  return isKonnerIdentityText(user?.username) || isKonnerIdentityText(user?.displayName);
}

function isKonnerIdentityText(value) {
  const token = normalizeSearchToken(value);
  return token === "konner" || token.startsWith("konner ");
}

function isMarketplaceLeadControlClosingParagraph(value) {
  return normalizeSpace(value).toLowerCase() === marketplaceLeadControlClosingPhrase;
}

function isMarketplaceContactParagraph(value) {
  const text = String(value || "").trim();
  if (/^message\s+for\s+more\s+details!?$/i.test(text)) return true;
  return /\b(?:message|contact|reach|stop by|visit|come by|questions|closer look|arrange)\b/i.test(text)
    && /\bask for\s+[A-Z0-9][A-Z0-9 .'-]{0,60}\b/i.test(text);
}

function stripMarketplaceInventoryNumbers(description, car = null) {
  const stockNumber = String(car?.stockNumber || "").trim();
  const stockNumberPattern = stockNumber ? new RegExp(`\\b${escapeRegExp(stockNumber)}\\b`, "i") : null;
  return String(description || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => stripMarketplaceInventoryNumberLine(line, stockNumber, stockNumberPattern))
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMarketplaceInventoryNumberLine(line, stockNumber, stockNumberPattern) {
  const pipeParts = String(line || "").split(/\s+\|\s+/);
  if (pipeParts.length > 1) {
    return pipeParts
      .filter((part) => !isMarketplaceInventoryNumberSegment(part, stockNumberPattern))
      .join(" | ")
      .trim();
  }
  if (isMarketplaceInventoryNumberSegment(line, stockNumberPattern)) return "";
  if (!stockNumber) return line;
  return line
    .replace(new RegExp(`\\b(?:stock|inventory)\\s*(?:number|no\\.?|#)?\\s*[:#]?\\s*${escapeRegExp(stockNumber)}\\b\\s*(?:[,;|/-]\\s*)?`, "ig"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isMarketplaceInventoryNumberSegment(value, stockNumberPattern) {
  const text = String(value || "").trim();
  if (!/\b(?:stock|inventory)\s*(?:number|no\.?|#)?\b/i.test(text)) return false;
  if (stockNumberPattern) return stockNumberPattern.test(text);
  return /\b(?:stock|inventory)\s*(?:number|no\.?|#)?\s*[:#]?\s*[A-Z]*\d[A-Z0-9-]*\b/i.test(text);
}

function hasMarketplaceContactLine(description) {
  return String(description || "").split(/\n{2,}/).some(isMarketplaceContactParagraph);
}

function hasMarketplacePriceDisclosure(description) {
  return /\bPrice\s*:/i.test(description)
    && /\bDocumentation fee\b/i.test(description)
    && /\bSecurity Etch\b/i.test(description)
    && /\b14%\s*HST\b/i.test(description);
}

function normalizeMarketplaceGeneratedDescription(value, fallbackDescription, input = null) {
  const text = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text || text.length < 70) return fallbackDescription;
  if (/as an ai|i can(?:'|’)t|i cannot/i.test(text)) return fallbackDescription;
  if (/^\s*(?:i(?:'|’)m listing|i am listing|listing this|posting this)\b/i.test(text)) return fallbackDescription;
  if (/\b(?:not specified|not available|not provided|not listed|not shown|not disclosed|not stated|unspecified|unavailable|unknown|n\/a|body style not specified|interior colou?r is other|other interior)\b/i.test(text)) return fallbackDescription;
  if (hasMarketplaceBannedCopyTone(text)) return fallbackDescription;
  if (hasUnsupportedMarketplaceGeneratedClaim(text, input)) return fallbackDescription;
  return text.slice(0, 1400);
}

function hasMarketplaceBannedCopyTone(value) {
  return /#|[\u{1F300}-\u{1FAFF}]|(?:\b(?:wow|hurry|act fast|look no further|turn heads|dream ride|beast|loaded to the max|perfect blend|must-see|must see|priced to sell|priced to move|won't last long|do not miss out|don't miss out)\b)/iu.test(String(value || ""));
}

function hasUnsupportedMarketplaceGeneratedClaim(description, input = null) {
  const text = String(description || "");
  const sourceText = marketplaceGeneratedSourceText(input);
  if (!sourceText) return false;

  const unsupportedFeatureClaims = [
    {
      claim: /\b(?:awd|all[-\s]?wheel drive|all[-\s]?wheel|4wd|four[-\s]?wheel drive|four[-\s]?wheel|winter confidence|winter roads?)\b/i,
      source: /\b(?:awd|all[-\s]?wheel drive|all[-\s]?wheel|4wd|four[-\s]?wheel drive|four[-\s]?wheel)\b/i,
    },
    {
      claim: /\b(?:hybrid|plug[-\s]?in|phev|electric|ev)\b/i,
      source: /\b(?:hybrid|plug[-\s]?in|phev|electric|ev)\b/i,
    },
    {
      claim: /\b(?:diesel)\b/i,
      source: /\b(?:diesel)\b/i,
    },
    {
      claim: /\b(?:leather)\b/i,
      source: /\b(?:leather)\b/i,
    },
    {
      claim: /\b(?:sunroof|moonroof)\b/i,
      source: /\b(?:sunroof|moonroof)\b/i,
    },
    {
      claim: /\b(?:navigation|nav system)\b/i,
      source: /\b(?:navigation|nav system)\b/i,
    },
    {
      claim: /\b(?:backup camera|rearview camera|camera)\b/i,
      source: /\b(?:backup camera|rearview camera|camera)\b/i,
    },
    {
      claim: /\b(?:heated seats?|cooled seats?|ventilated seats?)\b/i,
      source: /\b(?:heated seats?|cooled seats?|ventilated seats?)\b/i,
    },
    {
      claim: /\b(?:comfort|comfortable)\b/i,
      source: /\b(?:comfort|comfortable|heated seats?|cooled seats?|ventilated seats?|leather|power seats?)\b/i,
    },
    {
      claim: /\b(?:easy to park|easy manoeuv|easy maneuver|manoeuvrability|maneuverability|nimble)\b/i,
      source: /\b(?:easy to park|easy manoeuv|easy maneuver|manoeuvrability|maneuverability|nimble)\b/i,
    },
    {
      claim: /\b(?:towing|tow package|trailer)\b/i,
      source: /\b(?:towing|tow package|trailer)\b/i,
    },
  ];

  if (unsupportedFeatureClaims.some(({ claim, source }) => claim.test(text) && !source.test(sourceText))) return true;
  if (/\b(?:clean|like new|near new)\b/i.test(text) && !/\b(?:clean|like new|near new|near brand new)\b/i.test(sourceText)) return true;
  if (/\b(?:excellent|very good|good)\s+condition\b/i.test(text) && !/\b(?:excellent|very good|good)\s+condition\b/i.test(sourceText)) return true;
  if (/\breliable\b/i.test(text) && !/\breliable\b/i.test(sourceText)) return true;
  return false;
}

function marketplaceGeneratedSourceText(input = null) {
  const facts = {
    vehicle: input?.vehicle || {},
    inventoryCopy: input?.inventoryCopy || {},
  };
  return JSON.stringify(facts);
}

function featureHighlights(car) {
  const raw = [
    car.tagline,
    car.descriptionPreview,
  ].filter(Boolean).join(", ");
  const seen = new Set();
  return raw
    .split(/[|,;]+/)
    .map((item) => normalizeSpace(item.replace(/[!.]+$/g, "")))
    .filter((item) => item && !/^\*+$/.test(item))
    .filter((item) => !/^(?:just arrived|just traded|new arrival|fresh trade)$/i.test(item))
    .filter((item) => !/\b(?:won't last long|priced to move|priced to sell|must see|don't miss out)\b/i.test(item))
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 7);
}

function hasExplicitCondition(car) {
  return /\b(excellent|very good|good|fair|poor)\b/i.test([car.title, car.tagline, car.descriptionPreview].filter(Boolean).join(" "));
}

function inferMarketplaceCondition(car) {
  const text = [car.title, car.trim, car.tagline, car.descriptionPreview].filter(Boolean).join(" ");
  if (/\bnear brand new\b/i.test(text)) return "Excellent";
  if (/\bfully certified\b/i.test(text)) return "Excellent";
  if ((Number(car.year) || 0) >= new Date().getFullYear() - 3 && (car.odometerValue || 0) < 80000) return "Very good";
  return "Good";
}

function inferBodyStyle(car) {
  const text = normalizeSearchToken([car.model, car.title, car.trim, car.tagline, car.bodyStyle].filter(Boolean).join(" "));
  const hasModel = (...models) => models.some((model) => {
    const normalized = normalizeSearchToken(model);
    if (!normalized) return false;
    const pattern = normalized.split(/\s+/).map(escapeRegExp).join("\\s+");
    return new RegExp(`(?:^|[^a-z0-9])${pattern}(?:[^a-z0-9]|$)`, "i").test(text);
  });
  if (hasModel("hatchback") || /\bhatch\b/i.test(text)) return "Hatchback";
  if (hasModel("niro", "niro ev", "niro hybrid")) return "Hatchback";
  if (hasModel("santa cruz", "silverado", "sierra", "f-150", "f150", "ram 1500", "tacoma", "tundra", "ranger", "frontier", "colorado", "canyon")) return "Truck";
  if (hasModel(
    "seltos", "kona", "venue", "sportage", "telluride", "countryman", "envista",
    "kicks", "qashqai", "sorento", "tucson", "rogue", "cr-v", "crv",
    "rav4", "rav 4", "highlander", "4runner", "cx-5", "cx5", "cx-30", "cx30",
    "escape", "edge", "explorer", "equinox", "trailblazer", "trax", "terrain",
    "compass", "cherokee", "grand cherokee", "wrangler", "forester", "outback",
    "ascent", "crosstrek", "pilot", "hr-v", "hrv", "passport", "pathfinder",
    "murano", "armada", "palisade", "santa fe", "santafe", "ev5", "ev6", "ev9",
    "rx 350", "rx350",
  )) return "SUV";
  if (hasModel("sedona", "carnival", "sienna", "odyssey", "pacifica", "grand caravan", "caravan")) return "Minivan";
  if (hasModel("ev4", "corolla", "crown", "jetta", "forte", "elantra", "sentra", "civic", "k4", "k5", "rio", "optima", "camry", "accord", "altima", "malibu", "versa")) return "Sedan";
  return null;
}

function normalizeMarketplaceBodyStyle(value) {
  const normalized = normalizeSearchToken(value);
  if (!normalized) return null;
  const mapping = {
    coupe: "Coupe",
    truck: "Truck",
    pickup: "Truck",
    sedan: "Sedan",
    "cross-over": "SUV",
    "cross over": "SUV",
    hatch: "Hatchback",
    hatchback: "Hatchback",
    suv: "SUV",
    crossover: "SUV",
    convertible: "Convertible",
    wagon: "Wagon",
    minivan: "Minivan",
    van: "Minivan",
    small: "Small Car",
  };
  for (const [needle, bodyStyle] of Object.entries(mapping)) {
    if (normalized.includes(needle)) return bodyStyle;
  }
  return "Other";
}

function normalizeMarketplaceColor(value) {
  const normalized = normalizeSearchToken(value);
  if (!normalized) return null;
  const mapping = [
    ["off white", "Off white"],
    ["charcoal", "Charcoal"],
    ["burgundy", "Burgundy"],
    ["turquoise", "Turquoise"],
    ["silver", "Silver"],
    ["orange", "Orange"],
    ["yellow", "Yellow"],
    ["purple", "Purple"],
    ["brown", "Brown"],
    ["beige", "Beige"],
    ["black", "Black"],
    ["white", "White"],
    ["blue", "Blue"],
    ["green", "Green"],
    ["gray", "Gray"],
    ["grey", "Gray"],
    ["gold", "Gold"],
    ["pink", "Pink"],
    ["red", "Red"],
    ["tan", "Tan"],
  ];
  return mapping.find(([needle]) => normalized.includes(needle))?.[1] || "Other";
}

function normalizeMarketplaceFuel(value) {
  const normalized = normalizeSearchToken(value);
  if (!normalized) return null;
  if (normalized.includes("plug")) return "Plug-in hybrid";
  if (normalized.includes("hybrid")) return "Hybrid";
  if (normalized.includes("electric")) return "Electric";
  if (normalized.includes("diesel")) return "Diesel";
  if (normalized.includes("flex")) return "Flex";
  if (normalized.includes("petrol")) return "Petrol";
  if (normalized.includes("gas")) return "Gasoline";
  return "Other";
}

function normalizeMarketplaceTransmission(value) {
  const normalized = normalizeSearchToken(value);
  if (!normalized) return null;
  if (normalized.includes("manual") || normalized.includes("6 speed")) return "Manual transmission";
  if (normalized.includes("auto") || normalized.includes("cvt") || normalized.includes("automatic")) return "Automatic transmission";
  return null;
}

function normalizeSearchToken(value) {
  return normalizeSpace(value).toLowerCase().replace(/[^a-z0-9 +.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function naturalList(items) {
  const values = items.map((item) => normalizeSpace(item)).filter(Boolean);
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function extractResponseText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function hashJson(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function nullableString(value) {
  const text = String(value || "").trim();
  return text || null;
}

const marketplaceDescriptionBatchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["descriptions"],
  properties: {
    descriptions: {
      type: "array",
      items: {
        type: "string",
        minLength: 70,
        maxLength: 1400,
      },
    },
  },
};

function parseInventoryResult(result) {
  const html = result.html || "";
  const vehicle = result.vehicle || {};
  const price = normalizeSpace(`${extractClassText(html, "currencyUnit")}${extractClassText(html, "currencyValue")}`);
  const year = extractClassText(html, "ouvsrYear");
  const make = extractClassText(html, "ouvsrMake");
  const model = extractClassText(html, "ouvsrModel");
  const trim = extractClassText(html, "ouvsrTrimAndPackage");
  const tagline = extractClassText(html, "ouvsrTagline");
  const inventoryType = extractClassText(html, "ouvsrInventoryType");
  const title = normalizeSpace([inventoryType, year, make, model, trim, tagline].filter(Boolean).join(" "));
  const detailPath = extractHrefByClass(html, "ouvsrDetailsLink") || extractHrefByClass(html, "ouvsrHeadingLink");
  const specs = extractSpecs(html);

  return {
    vin: extractVin(html),
    vehicleId: vehicle.id || extractDataAttribute(html, "vehicle-id"),
    vehicleModelYearId: vehicle.vehicleModelYear?.id || null,
    stockNumber: extractDataAttribute(html, "vehicle-stock") || cleanSpecValue(specs["Stock #"]),
    title,
    inventoryType,
    year,
    make,
    model,
    trim,
    tagline,
    price,
    priceValue: parseCurrency(price),
    ownerLocation: extractClassText(html, "ouvsrOwnerLocationLink"),
    detailUrl: absolutizeOregansUrl(detailPath),
    exteriorColor: cleanSpecValue(specs.Colour),
    interiorColor: cleanSpecValue(specs["Interior Colour"] || specs["Interior Color"]),
    odometer: cleanSpecValue(specs.Odometer),
    odometerValue: parseNullableInteger(specs.Odometer),
    bodyStyle: cleanSpecValue(
      specs["Body Style"]
      || specs["Body Type"]
      || specs.Body
      || specs["Vehicle Type"]
      || vehicle.vehicleBodyStyleGroup?.name
      || vehicle.bodyStyleGroup?.name
      || vehicle.vehicleBodyStyle?.name
      || vehicle.bodyStyle?.name
      || vehicle.bodyStyle
      || vehicle.bodyType,
    ),
    fuelType: cleanSpecValue(specs.Fuel || specs["Fuel Type"]),
    transmission: cleanSpecValue(specs.Transmission),
    descriptionPreview: cleanText(extractClassText(html, "ouvsrDescription")).replace(/\s+More$/, ""),
  };
}

function extractSpecs(html) {
  const specs = {};
  const pattern = /<div\b[^>]*class="[^"]*\bouvsrSpec\b[^"]*"[^>]*>([\s\S]*?)<\/div><\/li>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const block = match[1];
    const label = extractClassText(block, "ouvsrLabel");
    if (!label) continue;
    const withoutLabel = block.replace(/<span\b[^>]*class="[^"]*\bouvsrLabel\b[^"]*"[^>]*>[\s\S]*?<\/span>/i, " ");
    specs[cleanText(label)] = cleanText(stripTags(withoutLabel));
  }
  return specs;
}

async function listAlbumPhotos(albumId) {
  albumId = cleanAlbumId(albumId);
  const directory = albumPath(albumId);
  const metadata = await readPhotoMetadata(albumId);
  if (s3MediaStorageEnabled) return photosFromMetadata(albumId, metadata);

  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });

  const photos = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".") || !isMediaFilename(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    const stats = await fs.stat(filePath);
    const meta = metadata[entry.name] || {};
    const contentType = meta.contentType || contentTypeFor(entry.name);
    photos.push(photoResponse(albumId, entry.name, {
      originalName: meta.originalName || entry.name,
      bytes: stats.size,
      uploadedAt: meta.uploadedAt || stats.birthtime.toISOString(),
      contentType,
      uploadedBy: meta.uploadedBy,
      uploadIndex: meta.uploadIndex,
    }));
  }

  return sortAlbumPhotosForDisplay(photos);
}

function photosFromMetadata(albumId, metadata) {
  const photos = [];
  for (const [filename, meta] of Object.entries(metadata || {})) {
    if (!isMediaFilename(filename)) continue;
    const bytes = Number(meta?.bytes || 0);
    photos.push(photoResponse(albumId, filename, {
      originalName: meta?.originalName || filename,
      bytes: Number.isFinite(bytes) && bytes >= 0 ? bytes : 0,
      uploadedAt: meta?.uploadedAt || new Date(0).toISOString(),
      contentType: meta?.contentType || contentTypeFor(filename),
      uploadedBy: meta?.uploadedBy,
      uploadIndex: meta?.uploadIndex,
    }));
  }
  return sortAlbumPhotosForDisplay(photos);
}

async function saveUploadedPhoto(albumId, file, user) {
  await validateUploadedMediaFile(file);
  if (s3MediaStorageEnabled) return saveUploadedPhotoToObjectStorage(albumId, file, user);
  return saveUploadedPhotoToLocalStorage(albumId, file, user);
}

async function validateUploadedMediaFile(file) {
  const extension = extensionFor(file.originalname, file.mimetype);
  const contentType = contentTypeFor(`upload${extension}`);

  try {
    if (contentType.startsWith("image/")) {
      await validateUploadedImageFile(file.path, extension);
      return;
    }

    if (contentType.startsWith("video/")) {
      await validateUploadedVideoFile(file.path, extension);
      return;
    }
  } catch (error) {
    if (error?.status) throw error;
    throw httpError(400, "Uploaded media could not be decoded as the selected image or video type.");
  }

  throw httpError(400, "Only image or video files can be uploaded.");
}

async function validateUploadedImageFile(filePath, extension) {
  if (extension === ".heic" || extension === ".heif") {
    await heicConvert({
      buffer: await fs.readFile(filePath),
      format: "JPEG",
      quality: 0.8,
    });
    return;
  }

  const expectedFormats = sharpImageFormatsByExtension.get(extension);
  if (!expectedFormats) throw httpError(400, "Unsupported image format.");

  const image = sharp(filePath, { failOn: "error" });
  const metadata = await image.metadata();
  const actualFormat = String(metadata.format || "").toLowerCase();
  if (!expectedFormats.has(actualFormat)) {
    throw httpError(400, "Uploaded image bytes do not match the selected image type.");
  }
  if (!metadata.width || !metadata.height) {
    throw httpError(400, "Uploaded image has no readable dimensions.");
  }
  await sharp(filePath, { failOn: "error" })
    .rotate()
    .resize({ width: 1, height: 1, fit: "inside", withoutEnlargement: true })
    .toBuffer();
}

async function validateUploadedVideoFile(filePath, extension) {
  const header = await readFileHeader(filePath, 16);
  const asciiHeader = header.toString("ascii");

  if (extension === ".mp4" || extension === ".mov" || extension === ".m4v") {
    if (header.length >= 12 && header.subarray(4, 8).toString("ascii") === "ftyp") return;
    throw httpError(400, "Uploaded video bytes do not match the selected video type.");
  }

  if (extension === ".webm") {
    if (bufferStartsWith(header, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return;
    throw httpError(400, "Uploaded video bytes do not match the selected video type.");
  }

  if (extension === ".ogv") {
    if (asciiHeader.startsWith("OggS")) return;
    throw httpError(400, "Uploaded video bytes do not match the selected video type.");
  }

  throw httpError(400, "Unsupported video format.");
}

async function readFileHeader(filePath, length) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function bufferStartsWith(buffer, prefix) {
  return buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix);
}

async function saveUploadedPhotoToLocalStorage(albumId, file, user) {
  const directory = albumPath(albumId);
  const extension = extensionFor(file.originalname, file.mimetype);
  const baseName = sanitizeFilenameBase(path.basename(file.originalname, path.extname(file.originalname)));
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}-${baseName}${extension}`;
  const destination = path.join(directory, filename);

  let moved = false;
  let stats;
  let uploadedAt;
  let contentType;
  let uploadedBy;
  let uploadIndex;
  try {
    await moveFile(file.path, destination);
    moved = true;
    stats = await fs.stat(destination);
    uploadedAt = new Date().toISOString();
    contentType = contentTypeFor(filename);
    uploadedBy = publicUploader(user);
    uploadIndex = await updatePhotoMetadata(albumId, (metadata) => {
      const nextIndex = nextPhotoUploadIndex(metadata);
      metadata[filename] = {
        originalName: file.originalname,
        contentType,
        bytes: stats.size,
        uploadedAt,
        uploadedBy,
        uploadIndex: nextIndex,
      };
      return nextIndex;
    });
  } catch (error) {
    if (moved) await fs.unlink(destination).catch(() => {});
    throw error;
  }

  return photoResponse(albumId, filename, {
    originalName: file.originalname,
    contentType,
    bytes: stats.size,
    uploadedAt,
    uploadedBy,
    uploadIndex,
  });
}

async function saveUploadedPhotoToObjectStorage(albumId, file, user) {
  albumId = cleanAlbumId(albumId);
  const extension = extensionFor(file.originalname, file.mimetype);
  const baseName = sanitizeFilenameBase(path.basename(file.originalname, path.extname(file.originalname)));
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}-${baseName}${extension}`;
  const albumMetadata = await readAlbumMetadata(albumId);
  const objectKey = mediaObjectKey(albumId, filename, albumMetadata);
  const stats = await fs.stat(file.path);
  const uploadedAt = new Date().toISOString();
  const contentType = contentTypeFor(filename);
  const uploadedBy = publicUploader(user);
  let uploadIndex;

  let uploaded = false;
  try {
    await putMediaObject(objectKey, file.path, contentType);
    uploaded = true;
    uploadIndex = await updatePhotoMetadata(albumId, (metadata) => {
      const nextIndex = nextPhotoUploadIndex(metadata);
      metadata[filename] = {
        originalName: file.originalname,
        contentType,
        bytes: stats.size,
        uploadedAt,
        uploadedBy,
        storage: "s3",
        bucket: objectStorageBucket,
        objectKey,
        uploadIndex: nextIndex,
      };
      return nextIndex;
    });
    await fs.unlink(file.path).catch(() => {});
  } catch (error) {
    if (uploaded) await deleteMediaObject(objectKey).catch(() => {});
    throw error;
  }

  return photoResponse(albumId, filename, {
    originalName: file.originalname,
    contentType,
    bytes: stats.size,
    uploadedAt,
    uploadedBy,
    uploadIndex,
  });
}

async function storedMediaInfo(albumId, filename, metadata = null) {
  albumId = cleanAlbumId(albumId);
  filename = cleanFilename(filename);

  if (s3MediaStorageEnabled) {
    const loadedMetadata = metadata || await readPhotoMetadata(albumId);
    const meta = loadedMetadata?.[filename];
    if (meta?.storage === "s3" || meta?.objectKey) {
      return storedMediaInfoFromObjectStorage(albumId, filename, loadedMetadata);
    }

    return await storedMediaInfoFromLocalStorage(albumId, filename)
      || storedMediaInfoFromObjectStorage(albumId, filename, loadedMetadata);
  }

  return storedMediaInfoFromLocalStorage(albumId, filename);
}

async function storedMediaInfoFromLocalStorage(albumId, filename) {
  const filePath = photoPath(albumId, filename);
  const stats = await fs.stat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stats?.isFile()) return null;

  return {
    mode: "local",
    albumId,
    filename,
    filePath,
    stats,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    contentType: contentTypeFor(filename),
  };
}

async function storedMediaInfoFromObjectStorage(albumId, filename, metadata) {
  const meta = metadata?.[filename];
  if (!meta) return null;

  const objectKey = meta.objectKey || mediaObjectKey(albumId, filename);
  let size = Number(meta.bytes);
  let contentType = meta.contentType || contentTypeFor(filename);
  let mtimeMs = new Date(meta.uploadedAt || 0).getTime();

  if (!Number.isFinite(size) || size < 0 || !Number.isFinite(mtimeMs) || mtimeMs <= 0) {
    const head = await headMediaObject(objectKey).catch((error) => {
      if (isS3NotFoundError(error)) return null;
      throw error;
    });
    if (!head) return null;
    size = Number(head.ContentLength || 0);
    contentType = head.ContentType || contentType;
    mtimeMs = new Date(head.LastModified || Date.now()).getTime();
  }

  return {
    mode: "s3",
    albumId,
    filename,
    objectKey,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    mtimeMs: Number.isFinite(mtimeMs) && mtimeMs > 0 ? mtimeMs : Date.now(),
    contentType,
    metadata: meta,
  };
}

async function sendStoredMedia(req, res, media, options = {}) {
  if (media.mode === "s3") {
    await sendMediaObject(req, res, media, options);
    return;
  }
  sendMediaFile(req, res, media.filePath, media.filename, media.stats, options);
}

async function sendMediaObject(req, res, media, { downloadName = "" } = {}) {
  const range = parseByteRange(req.headers.range, media.size);
  if (downloadName) {
    res.attachment(downloadName);
    res.setHeader("Content-Type", media.contentType || contentTypeFor(media.filename));
  } else {
    res.setHeader("Content-Type", media.contentType || contentTypeFor(media.filename));
  }
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");

  if (range?.unsatisfiable) {
    res.status(416);
    res.setHeader("Content-Range", `bytes */${media.size}`);
    res.end();
    return;
  }

  const object = await getMediaObject(media.objectKey, {
    range: range ? `bytes=${range.start}-${range.end}` : "",
  }).catch((error) => {
    if (isS3NotFoundError(error)) throw httpError(404, "Media not found.");
    throw error;
  });

  if (range) {
    const length = range.end - range.start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${media.size}`);
    res.setHeader("Content-Length", String(length));
  } else {
    res.setHeader("Content-Length", String(media.size));
  }

  readableFromAwsBody(object.Body).pipe(res);
}

async function appendStoredMediaToArchive(archive, albumId, filename, archiveName) {
  if (!s3MediaStorageEnabled) {
    archive.file(photoPath(albumId, filename), { name: archiveName });
    return;
  }

  const media = await storedMediaInfo(albumId, filename);
  if (!media) throw httpError(404, "Media not found.");
  const object = await getMediaObject(media.objectKey).catch((error) => {
    if (isS3NotFoundError(error)) throw httpError(404, "Media not found.");
    throw error;
  });
  archive.append(readableFromAwsBody(object.Body), { name: archiveName });
}

async function deleteStoredMedia(albumId, filename) {
  albumId = cleanAlbumId(albumId);
  filename = cleanFilename(filename);

  if (s3MediaStorageEnabled) {
    const metadata = await readPhotoMetadata(albumId);
    const meta = metadata?.[filename];
    if (meta?.storage === "s3" || meta?.objectKey) {
      await deleteMediaObject(meta?.objectKey || mediaObjectKey(albumId, filename));
    }
  }

  await fs.unlink(photoPath(albumId, filename)).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await fs.unlink(thumbnailPath(albumId, filename)).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function ensureStoredMediaThumbnail(media) {
  if (media.mode !== "s3") return ensureImageThumbnail(media.albumId, media.filename, media.filePath, media.stats);

  const thumbnailsDirectory = thumbnailDirectoryPath(media.albumId);
  const destination = thumbnailPath(media.albumId, media.filename);
  const existingStats = await fs.stat(destination).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existingStats?.size > 0 && existingStats.mtimeMs >= media.mtimeMs) return destination;

  await fs.mkdir(thumbnailsDirectory, { recursive: true });
  const extension = path.extname(media.filename) || ".bin";
  const tmpSourcePath = path.join(thumbnailsDirectory, `${crypto.randomUUID()}.source${extension}`);
  try {
    await downloadMediaObjectToFile(media.objectKey, tmpSourcePath);
    return await ensureImageThumbnail(media.albumId, media.filename, tmpSourcePath, { mtimeMs: media.mtimeMs });
  } finally {
    await fs.unlink(tmpSourcePath).catch(() => {});
  }
}

async function putMediaObject(objectKey, filePath, contentType) {
  await s3MediaClient.send(new PutObjectCommand({
    Bucket: objectStorageBucket,
    Key: objectKey,
    Body: createReadStream(filePath),
    ContentType: contentType,
  }));
}

async function getMediaObject(objectKey, { range = "" } = {}) {
  return s3MediaClient.send(new GetObjectCommand({
    Bucket: objectStorageBucket,
    Key: objectKey,
    ...(range ? { Range: range } : {}),
  }));
}

async function headMediaObject(objectKey) {
  return s3MediaClient.send(new HeadObjectCommand({
    Bucket: objectStorageBucket,
    Key: objectKey,
  }));
}

async function deleteMediaObject(objectKey) {
  await s3MediaClient.send(new DeleteObjectCommand({
    Bucket: objectStorageBucket,
    Key: objectKey,
  }));
}

async function downloadMediaObjectToFile(objectKey, destination) {
  const object = await getMediaObject(objectKey);
  await pipeline(readableFromAwsBody(object.Body), createWriteStream(destination));
}

function mediaObjectKey(albumId, filename, albumMetadata = null) {
  const parts = [
    objectStoragePrefix,
    albumObjectStoragePrefix(albumId, albumMetadata),
    cleanFilename(filename),
  ].filter(Boolean);
  return parts.join("/");
}

function albumStorageInfo(albumId, metadata = null) {
  const prefix = albumObjectStoragePrefix(albumId, metadata);
  const storage = {
    driver: mediaStorageDriver,
    prefix,
  };
  if (s3MediaStorageEnabled) {
    storage.bucket = objectStorageBucket;
    storage.endpoint = objectStorageEndpoint;
    storage.region = objectStorageRegion;
  }
  return storage;
}

function albumObjectStoragePrefix(albumId, metadata = null) {
  const persisted = normalizeObjectStoragePrefix(metadata?.objectStoragePrefix || metadata?.storage?.prefix || "");
  return persisted || cleanAlbumId(albumId);
}

function albumObjectStoragePrefixForCar(albumId, car, existing = {}) {
  const persisted = normalizeObjectStoragePrefix(existing?.objectStoragePrefix || existing?.storage?.prefix || "");
  if (persisted) return persisted;

  const inventoryNumber = albumInventoryNumberFromCar(car);
  const stableKey = normalizeSpace(car?.manualInventoryId || car?.vin || car?.inventoryKey || car?.stockNumber || albumId);
  const inventorySlug = slugify(inventoryNumber || stableKey || albumId).slice(0, 64);
  const stableSlug = slugify(stableKey || inventoryNumber || albumId).slice(0, 64);
  const folderSlug = stableSlug && stableSlug !== inventorySlug
    ? `${inventorySlug}-${stableSlug}`.slice(0, 96).replace(/-+$/g, "")
    : inventorySlug;
  const dealershipSlug = slugify(car?.dealership?.id || car?.dealershipId || "dealership").slice(0, 32);
  const inventoryTypeSlug = slugify(inventoryTypeName(car?.inventoryTypeId) || car?.inventoryTypeId || "inventory").slice(0, 32);
  return normalizeObjectStoragePrefix(["inventory", dealershipSlug, inventoryTypeSlug, folderSlug || cleanAlbumId(albumId)].join("/"));
}

function albumInventoryNumberFromCar(car) {
  return normalizeSpace(car?.stockNumber || car?.manualInventoryId || car?.inventoryKey || car?.vin || "").slice(0, 120);
}

function albumInventoryNumberFromMetadata(metadata = {}) {
  const vehicle = metadata?.vehicle || {};
  return normalizeSpace(metadata?.inventoryNumber || vehicle.stockNumber || vehicle.manualInventoryId || vehicle.inventoryKey || vehicle.vin || "").slice(0, 120);
}

function inventoryTypeName(inventoryTypeId) {
  const id = normalizeSpace(inventoryTypeId);
  return inventoryTypes.find((type) => type.id === id)?.name || "";
}

function readableFromAwsBody(body) {
  if (body && typeof body.pipe === "function") return body;
  if (body && typeof body.getReader === "function") return Readable.fromWeb(body);
  if (body && typeof body.transformToWebStream === "function") return Readable.fromWeb(body.transformToWebStream());
  if (body instanceof Uint8Array || typeof body === "string") return Readable.from([body]);
  throw new Error("S3 object response did not include a readable body.");
}

function isS3NotFoundError(error) {
  return error?.$metadata?.httpStatusCode === 404
    || error?.name === "NoSuchKey"
    || error?.name === "NotFound"
    || error?.Code === "NoSuchKey"
    || error?.Code === "NotFound";
}

async function ensureImageThumbnail(albumId, filename, sourcePath, sourceStats) {
  const thumbnailsDirectory = thumbnailDirectoryPath(albumId);
  const destination = thumbnailPath(albumId, filename);
  const existingStats = await fs.stat(destination).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existingStats?.size > 0 && existingStats.mtimeMs >= sourceStats.mtimeMs) return destination;

  await fs.mkdir(thumbnailsDirectory, { recursive: true });
  const tmpPath = path.join(thumbnailsDirectory, `${crypto.randomUUID()}.tmp.webp`);
  let intermediatePath = "";
  try {
    const thumbnailSource = await readableImageSourceForThumbnail(sourcePath, filename, thumbnailsDirectory);
    if (thumbnailSource !== sourcePath) intermediatePath = thumbnailSource;
    await sharp(thumbnailSource, { failOn: "none" })
      .rotate()
      .resize({
        width: thumbnailMaxWidth,
        height: thumbnailMaxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 76, effort: 4 })
      .toFile(tmpPath);
    await fs.rename(tmpPath, destination);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  } finally {
    if (intermediatePath) await fs.unlink(intermediatePath).catch(() => {});
  }
  return destination;
}

async function readableImageSourceForThumbnail(sourcePath, filename, thumbnailsDirectory) {
  if (!isHeicFilename(filename)) return sourcePath;

  const jpegBuffer = await heicConvert({
    buffer: await fs.readFile(sourcePath),
    format: "JPEG",
    quality: 0.86,
  });
  const tmpJpegPath = path.join(thumbnailsDirectory, `${crypto.randomUUID()}.tmp.jpg`);
  await fs.writeFile(tmpJpegPath, jpegBuffer);
  return tmpJpegPath;
}

function photoResponse(albumId, filename, details) {
  const kind = mediaKindFor(filename, details.contentType);
  return {
    id: `${albumId}/${filename}`,
    albumId,
    filename,
    originalName: details.originalName,
    kind,
    contentType: details.contentType,
    bytes: details.bytes,
    uploadedAt: details.uploadedAt,
    uploadedBy: publicUploader(details.uploadedBy),
    uploadIndex: normalizedUploadIndex(details.uploadIndex),
    downloadName: mediaDownloadName(details.originalName, filename),
    url: `/api/albums/${encodeURIComponent(albumId)}/media/${encodeURIComponent(filename)}`,
    thumbnailUrl: kind === "image" ? `/api/albums/${encodeURIComponent(albumId)}/media/${encodeURIComponent(filename)}/thumbnail` : "",
    downloadUrl: `/api/albums/${encodeURIComponent(albumId)}/media/${encodeURIComponent(filename)}?download=1`,
    legacyUrl: `/api/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(filename)}`,
  };
}

function publicUploader(user) {
  const username = normalizeAuthUsername(user?.username);
  const displayName = normalizeDisplayName(user?.displayName) || username;
  if (!username && !displayName) return null;
  return {
    username,
    displayName: displayName || username,
  };
}

function mediaDownloadName(originalName, filename) {
  const storedName = path.basename(String(filename || "media"));
  const storedExtension = path.extname(storedName).toLowerCase();
  const originalBaseName = path.basename(String(originalName || storedName || "media"));
  const originalExtension = path.extname(originalBaseName).toLowerCase();
  if (!storedExtension || originalExtension === storedExtension) return originalBaseName || storedName;

  const base = path.basename(originalBaseName, originalExtension)
    || path.basename(storedName, storedExtension)
    || "media";
  return `${base}${storedExtension}`;
}

function sendMediaFile(req, res, filePath, filename, stats, { downloadName = "" } = {}) {
  const range = parseByteRange(req.headers.range, stats.size);
  if (downloadName) {
    res.attachment(downloadName);
    res.setHeader("Content-Type", contentTypeFor(filename));
  } else {
    res.setHeader("Content-Type", contentTypeFor(filename));
  }
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");

  if (range?.unsatisfiable) {
    res.status(416);
    res.setHeader("Content-Range", `bytes */${stats.size}`);
    res.end();
    return;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stats.size}`);
    res.setHeader("Content-Length", String(length));
    createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.setHeader("Content-Length", String(stats.size));
  createReadStream(filePath).pipe(res);
}

function isDownloadRequest(req) {
  return ["1", "true", "yes"].includes(String(req.query.download || "").toLowerCase());
}

function uniqueArchiveName(name, usedNames) {
  const parsed = path.parse(path.basename(String(name || "media")));
  const base = sanitizeFilenameBase(parsed.name || "media").slice(0, 80) || "media";
  const extension = isMediaFilename(`${base}${parsed.ext}`) ? parsed.ext.toLowerCase() : "";
  let candidate = `${base}${extension}`;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}-${counter}${extension}`;
    counter += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function parseByteRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return { unsatisfiable: true };

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match || (!match[1] && !match[2])) return { unsatisfiable: true };

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { unsatisfiable: true };
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) {
    return { unsatisfiable: true };
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

async function readAlbumMetadata(albumId) {
  return readJson(path.join(albumPath(albumId), ".album.json"), {});
}

async function readPhotoMetadata(albumId) {
  return readJson(path.join(albumPath(albumId), ".photos.json"), {});
}

async function writePhotoMetadata(albumId, metadata) {
  await writeJson(path.join(albumPath(albumId), ".photos.json"), metadata);
}

async function updatePhotoMetadata(albumId, mutator) {
  albumId = cleanAlbumId(albumId);
  const previous = photoMetadataWritePromises.get(albumId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const metadata = await readPhotoMetadata(albumId);
    const result = await mutator(metadata);
    await writePhotoMetadata(albumId, metadata);
    return result;
  });
  photoMetadataWritePromises.set(albumId, next);
  try {
    return await next;
  } finally {
    if (photoMetadataWritePromises.get(albumId) === next) {
      photoMetadataWritePromises.delete(albumId);
    }
  }
}

async function readChatMessages() {
  const messages = await readJson(chatMessagesPath, []);
  if (!Array.isArray(messages)) return [];
  return messages
    .map(normalizeStoredChatMessage)
    .filter(Boolean)
    .slice(-chatMessageLimit);
}

async function appendChatMessage(input, user) {
  const draft = typeof input === "string"
    ? { text: input, attachments: [] }
    : input && typeof input === "object"
      ? input
      : {};
  const text = sanitizeChatMessageText(draft.text, { truncate: true });
  const attachments = normalizeChatAttachments(draft.attachments);
  if (!text && !attachments.length) {
    throw httpError(400, "Enter a message or attach a photo, GIF, or audio file before sending.");
  }

  const authorUsername = normalizeAuthUsername(user?.username || authUsername);
  const authorDisplayName = normalizeChatAuthor(user?.displayName || authorUsername || authUsername);
  const message = {
    id: `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    author: authorDisplayName,
    authorDisplayName,
    authorUsername,
    text,
    attachments,
    reactions: emptyChatReactions(),
    createdAt: new Date().toISOString(),
  };

  chatWritePromise = chatWritePromise.catch(() => {}).then(async () => {
    const messages = await readChatMessages();
    messages.push(message);
    await writeJson(chatMessagesPath, messages.slice(-chatMessageLimit));
    return message;
  });

  return chatWritePromise;
}

async function updateChatMessageReaction(messageId, reaction, user) {
  const reactor = publicUploader(user);
  if (!reactor?.username) throw httpError(401, "Authentication required.");

  chatWritePromise = chatWritePromise.catch(() => {}).then(async () => {
    const messages = await readChatMessages();
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw httpError(404, "Chat message not found.");

    const message = {
      ...messages[index],
      reactions: normalizeChatReactions(messages[index].reactions),
    };
    const alreadyReacted = reaction
      ? message.reactions[reaction].some((candidate) => candidate.username === reactor.username)
      : false;
    let added = false;

    for (const type of chatReactionTypes) {
      message.reactions[type] = message.reactions[type]
        .filter((candidate) => candidate.username !== reactor.username);
    }
    if (reaction && !alreadyReacted) {
      message.reactions[reaction].push(reactor);
      added = true;
    }

    const normalized = normalizeStoredChatMessage(message);
    messages[index] = normalized;
    await writeJson(chatMessagesPath, messages.slice(-chatMessageLimit));
    return {
      message: normalized,
      added,
      reaction: added ? reaction : "",
    };
  });

  return chatWritePromise;
}

async function serveChatMedia(req, res, next) {
  try {
    const filename = cleanChatMediaFilename(req.params.filename);
    const filePath = path.join(chatMediaRoot, filename);
    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats?.isFile()) throw httpError(404, "Chat media not found.");
    sendMediaFile(req, res, filePath, filename, stats, {
      downloadName: isDownloadRequest(req) ? mediaDownloadName(req.query.name, filename) : "",
    });
  } catch (error) {
    next(error);
  }
}

async function saveChatUploadedAttachments(files, user) {
  const selected = Array.isArray(files) ? files : [];
  if (!selected.length) return [];
  if (selected.length > chatAttachmentLimit) {
    throw httpError(400, `Attach up to ${chatAttachmentLimit} ${chatAttachmentLimit === 1 ? "file" : "files"} at a time.`);
  }

  await fs.mkdir(chatMediaRoot, { recursive: true });
  const attachments = [];
  for (const file of selected) {
    attachments.push(await saveChatUploadedAttachment(file, user));
  }
  return attachments;
}

async function saveChatUploadedAttachment(file, user) {
  const mimetype = normalizeSpace(file?.mimetype).toLowerCase();
  const originalName = path.basename(String(file?.originalname || "chat-attachment"));
  const isImageAttachment = mimetype.startsWith("image/") || isPhotoFilename(originalName);
  const isAudioAttachment = mimetype.startsWith("audio/") || isAudioFilename(originalName);

  const extension = extensionFor(originalName, mimetype);
  if (!file?.path
    || mimetype.startsWith("video/")
    || isVideoFilename(originalName)
    || (!isImageAttachment && !isAudioAttachment)
    || (isImageAttachment && !imageExtensions.has(extension))
    || (isAudioAttachment && !audioExtensions.has(extension))) {
    throw httpError(400, "Only photos, GIFs, or audio files can be attached to chat.");
  }

  const filename = cleanChatMediaFilename(`${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}${extension}`);
  await moveFile(file.path, path.join(chatMediaRoot, filename));
  return normalizeChatUploadedAttachment({
    id: filename,
    source: "upload",
    filename,
    originalName,
    contentType: uploadContentTypeFor(filename, mimetype),
    bytes: Number(file.size || 0),
    uploadedBy: publicUploader(user),
  });
}

async function cleanupChatAttachments(attachments) {
  const uploads = normalizeChatAttachments(attachments)
    .filter((attachment) => attachment.source === "upload")
    .map((attachment) => fs.unlink(path.join(chatMediaRoot, attachment.filename)).catch(() => {}));
  await Promise.all(uploads);
}

function normalizeChatAttachments(value) {
  if (!Array.isArray(value)) return [];
  const attachments = [];
  for (const item of value) {
    const attachment = normalizeChatAttachment(item);
    if (attachment) attachments.push(attachment);
    if (attachments.length >= chatAttachmentLimit + 1) break;
  }
  return attachments;
}

function normalizeChatAttachment(value) {
  if (!value || typeof value !== "object") return null;
  try {
    const source = normalizeSpace(value.source).toLowerCase();
    if (source === "upload") return normalizeChatUploadedAttachment(value);
    if (source === "giphy" || source === "url" || value.url || value.gifUrl) {
      return normalizeChatGifAttachmentInput(value);
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeChatUploadedAttachment(value) {
  const filename = cleanChatMediaFilename(value.filename || value.id);
  const originalName = path.basename(String(value.originalName || value.name || filename)).slice(0, 160);
  const contentType = normalizeSpace(value.contentType || value.mimetype || contentTypeFor(filename)).toLowerCase();
  const type = chatUploadedAttachmentType(filename, contentType);
  return {
    id: filename,
    type,
    source: "upload",
    url: chatMediaUrl(filename),
    downloadUrl: `${chatMediaUrl(filename)}?download=1&name=${encodeURIComponent(originalName || filename)}`,
    filename,
    originalName: originalName || filename,
    contentType: contentType || contentTypeFor(filename),
    bytes: Math.max(0, Math.floor(Number(value.bytes || 0))),
    uploadedBy: publicUploader(value.uploadedBy),
  };
}

function chatUploadedAttachmentType(filename, contentType = "") {
  const mime = String(contentType || "").toLowerCase();
  if (mime === "image/gif" || path.extname(filename).toLowerCase() === ".gif") return "gif";
  if (mime.startsWith("audio/") || isAudioFilename(filename)) return "audio";
  return "image";
}

function normalizeChatGifAttachmentInput(value) {
  const source = parseChatGifInput(value);
  if (!source) return null;
  const url = normalizeGiphyUrl(source.url || source.gifUrl);
  const previewUrl = source.previewUrl || source.thumbnailUrl
    ? normalizeGiphyUrl(source.previewUrl || source.thumbnailUrl)
    : url;
  const attributionUrl = normalizeGiphyAttributionUrl(source.attributionUrl || source.giphyUrl || source.pageUrl || "");
  return {
    id: normalizeSpace(source.id || source.gifId).slice(0, 120) || `gif-${crypto.randomUUID().slice(0, 8)}`,
    type: "gif",
    source: "giphy",
    title: normalizeSpace(source.title || "GIF").slice(0, 160) || "GIF",
    url,
    previewUrl,
    width: Math.min(4000, positiveInteger(source.width, 0)),
    height: Math.min(4000, positiveInteger(source.height, 0)),
    attributionUrl,
  };
}

function parseChatGifInput(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        throw httpError(400, "Choose a valid GIF before sending.");
      }
    }
    return { url: trimmed };
  }
  if (typeof value === "object") return value;
  throw httpError(400, "Choose a valid GIF before sending.");
}

function chatMediaUrl(filename) {
  return `/api/chat/media/${encodeURIComponent(cleanChatMediaFilename(filename))}`;
}

function emptyChatReactions() {
  return Object.fromEntries(chatReactionTypes.map((type) => [type, []]));
}

function normalizeChatReactions(value) {
  const reactions = emptyChatReactions();
  if (!value || typeof value !== "object") return reactions;

  for (const type of chatReactionTypes) {
    const users = Array.isArray(value[type]) ? value[type] : [];
    const seen = new Set();
    for (const rawUser of users) {
      const user = normalizeChatReactionUser(rawUser);
      if (!user?.username || seen.has(user.username)) continue;
      seen.add(user.username);
      reactions[type].push(user);
    }
  }
  return reactions;
}

function normalizeChatReactionUser(value) {
  if (typeof value === "string") {
    const username = normalizeAuthUsername(value);
    return username ? { username, displayName: username } : null;
  }
  return publicUploader(value);
}

function normalizeChatReactionInput(value) {
  const raw = normalizeSpace(value).toLowerCase();
  if (!raw) return "";
  const key = raw.replace(/[\s-]+/g, "_");
  const aliases = new Map([
    ["haha", "laugh"],
    ["laughing", "laugh"],
    ["lol", "laugh"],
    ["love", "heart"],
    ["like", "thumbs_up"],
    ["thumb_up", "thumbs_up"],
    ["thumbsup", "thumbs_up"],
    ["up", "thumbs_up"],
    ["dislike", "thumbs_down"],
    ["thumb_down", "thumbs_down"],
    ["thumbsdown", "thumbs_down"],
    ["down", "thumbs_down"],
  ]);
  const reaction = chatReactionTypes.includes(key) ? key : aliases.get(key) || "";
  if (!reaction) throw httpError(400, "Choose a valid chat reaction.");
  return reaction;
}

function cleanChatMessageId(value) {
  const id = normalizeSpace(value);
  if (!id || id.length > 120 || !/^[a-z0-9._-]+$/i.test(id)) {
    throw httpError(400, "Invalid chat message ID.");
  }
  return id;
}

function cleanChatMediaFilename(value) {
  const filename = path.basename(String(value || ""));
  if (!filename
    || filename.length > 180
    || !/^[a-z0-9][a-z0-9._-]*$/i.test(filename)
    || (!isPhotoFilename(filename) && !isAudioFilename(filename))) {
    throw httpError(400, "Invalid chat media filename.");
  }
  return filename;
}

function normalizeGiphyUrl(value) {
  const raw = normalizeSpace(value);
  if (!raw) throw httpError(400, "Choose a valid GIF before sending.");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw httpError(400, "Choose a valid GIF before sending.");
  }
  if (parsed.protocol !== "https:" || !isGiphyHostname(parsed.hostname)) {
    throw httpError(400, "Only GIPHY GIF links can be sent.");
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeGiphyAttributionUrl(value) {
  const raw = normalizeSpace(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" && isGiphyHostname(parsed.hostname)) {
      parsed.hash = "";
      return parsed.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function isGiphyHostname(value) {
  const hostname = normalizeSpace(value).toLowerCase();
  return hostname === "giphy.com"
    || hostname.endsWith(".giphy.com")
    || hostname === "giphyusercontent.com"
    || hostname.endsWith(".giphyusercontent.com");
}

async function searchGiphyGifs({ q = "", limit = chatGifSearchLimit } = {}) {
  const query = normalizeSpace(q).slice(0, 80);
  const count = Math.min(24, positiveInteger(limit, chatGifSearchLimit));
  const endpoint = query
    ? "https://api.giphy.com/v1/gifs/search"
    : "https://api.giphy.com/v1/gifs/trending";
  const params = new URLSearchParams({
    api_key: giphyApiKey,
    limit: String(count),
    rating: giphyRating,
  });
  if (query) {
    params.set("q", query);
    params.set("lang", "en");
  }

  const response = await fetch(`${endpoint}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw httpError(502, "GIF search failed. Try again in a moment.");
  const body = await response.json();
  const gifs = Array.isArray(body?.data)
    ? body.data.map(giphyResultToAttachment).filter(Boolean)
    : [];
  return gifs.slice(0, count);
}

function giphyResultToAttachment(value) {
  const images = value?.images && typeof value.images === "object" ? value.images : {};
  const full = images.downsized_medium || images.downsized || images.original || images.fixed_height || {};
  const preview = images.fixed_width_small || images.preview_gif || images.downsized_still || full;
  try {
    return normalizeChatGifAttachmentInput({
      id: value.id,
      title: value.title,
      url: full.url,
      previewUrl: preview.url || full.url,
      width: full.width,
      height: full.height,
      attributionUrl: value.url,
    });
  } catch {
    return null;
  }
}

async function chatReadStateForUser(user) {
  const username = normalizeAuthUsername(user?.username);
  if (!username) return emptyChatReadState();
  const store = await readChatReadStateStore();
  return publicChatReadState(store.users[username]);
}

async function markChatReadState(user, marker) {
  const username = normalizeAuthUsername(user?.username);
  const normalizedMarker = normalizeChatReadMarker(marker);
  if (!username || !normalizedMarker) throw httpError(400, "A valid chat read marker is required.");
  const messages = await readChatMessages();

  return updateChatReadStateStore((store) => {
    const previous = publicChatReadState(store.users[username]);
    if (previous.marker && chatReadMarkerCompare(previous.marker, normalizedMarker, messages) >= 0) {
      return previous;
    }

    const readState = {
      marker: normalizedMarker,
      readAt: new Date().toISOString(),
    };
    store.users[username] = readState;
    return publicChatReadState(readState);
  });
}

async function readChatReadStateStore() {
  return normalizeChatReadStateStore(await readJson(chatReadStatePath, { users: {} }));
}

async function updateChatReadStateStore(mutator) {
  chatReadStateWritePromise = chatReadStateWritePromise.catch(() => {}).then(async () => {
    const store = await readChatReadStateStore();
    const result = await mutator(store);
    await writeJson(chatReadStatePath, store);
    return result;
  });
  return chatReadStateWritePromise;
}

function normalizeChatReadStateStore(value) {
  const users = value?.users && typeof value.users === "object" ? value.users : {};
  const normalized = { users: {} };
  for (const [rawUsername, rawState] of Object.entries(users)) {
    const username = normalizeAuthUsername(rawUsername);
    if (!username) continue;
    const readState = publicChatReadState(rawState);
    if (readState.marker || readState.readAt) normalized.users[username] = readState;
  }
  return normalized;
}

function publicChatReadState(value) {
  const marker = normalizeChatReadMarker(value?.marker || value);
  return {
    marker,
    readAt: validIsoString(value?.readAt),
  };
}

function emptyChatReadState() {
  return {
    marker: null,
    readAt: "",
  };
}

function normalizeChatReadMarker(marker) {
  if (!marker || typeof marker !== "object") return null;
  const id = normalizeSpace(marker.id).slice(0, 120);
  const createdAt = validIsoString(marker.createdAt);
  if (!id && !createdAt) return null;
  return { id, createdAt };
}

function chatReadMarkerCompare(left, right, messages) {
  const leftMarker = normalizeChatReadMarker(left);
  const rightMarker = normalizeChatReadMarker(right);
  if (!leftMarker && !rightMarker) return 0;
  if (!leftMarker) return -1;
  if (!rightMarker) return 1;

  const leftIndex = chatMessageIndexForMarker(leftMarker, messages);
  const rightIndex = chatMessageIndexForMarker(rightMarker, messages);
  if (leftIndex >= 0 && rightIndex >= 0 && leftIndex !== rightIndex) {
    return leftIndex > rightIndex ? 1 : -1;
  }

  const leftTime = Date.parse(leftMarker.createdAt || "");
  const rightTime = Date.parse(rightMarker.createdAt || "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime > rightTime ? 1 : -1;
  }

  if (leftMarker.id && rightMarker.id && leftMarker.id === rightMarker.id) return 0;
  return 0;
}

function chatMessageIndexForMarker(marker, messages) {
  if (!marker?.id || !Array.isArray(messages)) return -1;
  return messages.findIndex((message) => message.id === marker.id);
}

async function userPreferencesForUser(user) {
  const username = normalizeAuthUsername(user?.username);
  if (!username) return emptyUserPreferenceState();
  const store = await readUserPreferencesStore();
  return publicUserPreferenceState(store.users[username]);
}

async function saveUserPreferences(user, preferences) {
  const username = normalizeAuthUsername(user?.username);
  if (!username) throw httpError(401, "Authentication required.");
  const normalizedPreferences = normalizeUserPreferences(preferences);
  return updateUserPreferencesStore((store) => {
    const preferenceState = {
      preferences: normalizedPreferences,
      updatedAt: new Date().toISOString(),
    };
    store.users[username] = preferenceState;
    return publicUserPreferenceState(preferenceState);
  });
}

async function readUserPreferencesStore() {
  return normalizeUserPreferencesStore(await readJson(userPreferencesPath, { users: {} }));
}

async function updateUserPreferencesStore(mutator) {
  userPreferencesWritePromise = userPreferencesWritePromise.catch(() => {}).then(async () => {
    const store = await readUserPreferencesStore();
    const result = await mutator(store);
    await writeJson(userPreferencesPath, store);
    return result;
  });
  return userPreferencesWritePromise;
}

function normalizeUserPreferencesStore(value) {
  const users = value?.users && typeof value.users === "object" ? value.users : {};
  const normalized = { users: {} };
  for (const [rawUsername, rawState] of Object.entries(users)) {
    const username = normalizeAuthUsername(rawUsername);
    if (!username) continue;
    const preferenceState = publicUserPreferenceState(rawState);
    if (preferenceState.preferences) normalized.users[username] = preferenceState;
  }
  return normalized;
}

function publicUserPreferenceState(value) {
  if (!value || typeof value !== "object") return emptyUserPreferenceState();
  return {
    preferences: normalizeUserPreferences(value.preferences || value),
    updatedAt: validIsoString(value.updatedAt),
  };
}

function emptyUserPreferenceState() {
  return {
    preferences: null,
    updatedAt: "",
  };
}

function normalizeUserPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  const galleryStatusFilter = normalizeSpace(source.galleryStatusFilter).toLowerCase();
  return {
    selectedDealershipId: normalizePreferenceText(source.selectedDealershipId, 40),
    selectedInventoryTypeId: normalizePreferenceText(source.selectedInventoryTypeId, 40),
    selectedMake: normalizePreferenceText(source.selectedMake, 80),
    selectedModel: normalizePreferenceText(source.selectedModel, 80),
    selectedVin: normalizePreferenceText(source.selectedVin, 120),
    carSearch: normalizePreferenceText(source.carSearch, 160),
    showPostedInventory: Boolean(source.showPostedInventory),
    galleryDealershipId: normalizePreferenceText(source.galleryDealershipId, 80),
    expandedAlbumId: normalizePreferenceText(source.expandedAlbumId, 120),
    gallerySearch: normalizePreferenceText(source.gallerySearch, 160),
    galleryStatusFilter: ["active", "inactive", "all"].includes(galleryStatusFilter) ? galleryStatusFilter : "active",
    galleryMakeFilter: normalizePreferenceText(source.galleryMakeFilter, 80),
    galleryModelFilter: normalizePreferenceText(source.galleryModelFilter, 80),
    galleryYearFilter: normalizePreferenceText(source.galleryYearFilter, 20),
    galleryUploaderFilter: normalizePreferenceText(source.galleryUploaderFilter, 80),
    pushNotifications: normalizePushNotificationPreferences(source.pushNotifications),
  };
}

function normalizePreferenceText(value, maxLength = 120) {
  return normalizeSpace(value).slice(0, maxLength);
}

function broadcastChatMessage(message, { event = "message" } = {}) {
  const eventName = normalizeSpace(event);
  const payload = `${eventName && eventName !== "message" ? `event: ${eventName}\n` : ""}data: ${JSON.stringify(message)}\n\n`;
  for (const client of [...chatClients]) {
    if (!writeChatEvent(client, payload)) {
      chatClients.delete(client);
    }
  }
}

function broadcastAlbumEvent(event, { excludeUsername = "" } = {}) {
  const excluded = normalizeAuthUsername(excludeUsername);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of [...albumClients]) {
    if (excluded && client.username === excluded) continue;
    if (!writeSseEvent(client.res, payload)) {
      albumClients.delete(client);
    }
  }
}

function writeChatEvent(res, payload) {
  return writeSseEvent(res, payload);
}

function writeSseEvent(res, payload) {
  try {
    res.write(payload);
    return true;
  } catch {
    return false;
  }
}

function normalizeStoredChatMessage(value) {
  if (!value || typeof value !== "object") return null;
  const text = sanitizeChatMessageText(value.text, { truncate: true });
  const attachments = normalizeChatAttachments(value.attachments);
  if (!text && !attachments.length) return null;
  const createdAt = Number.isFinite(Date.parse(value.createdAt))
    ? new Date(value.createdAt).toISOString()
    : new Date().toISOString();
  return {
    id: normalizeSpace(value.id) || `${Date.parse(createdAt).toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    author: normalizeChatAuthor(value.authorDisplayName || value.author),
    authorDisplayName: normalizeChatAuthor(value.authorDisplayName || value.author),
    authorUsername: normalizeAuthUsername(value.authorUsername || value.username),
    text,
    attachments,
    reactions: normalizeChatReactions(value.reactions),
    createdAt,
  };
}

function normalizeChatMessageText(value) {
  const text = normalizeOptionalChatMessageText(value);
  if (!text) throw httpError(400, "Enter a message before sending.");
  return text;
}

function normalizeOptionalChatMessageText(value) {
  const text = sanitizeChatMessageText(value);
  if (text.length > chatMessageMaxLength) {
    throw httpError(400, `Messages must be ${chatMessageMaxLength} characters or less.`);
  }
  return text;
}

function sanitizeChatMessageText(value, { truncate = false } = {}) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizeSpace(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncate ? text.slice(0, chatMessageMaxLength) : text;
}

function normalizeChatAuthor(value) {
  return normalizeSpace(value || appName).slice(0, 40) || appName;
}

async function resolvePushVapidKeys() {
  const publicKey = normalizeSpace(process.env.CARPOSTCLUB_PUSH_VAPID_PUBLIC_KEY || process.env.KONNER_PUSH_VAPID_PUBLIC_KEY || process.env.WEB_PUSH_VAPID_PUBLIC_KEY);
  const privateKey = normalizeSpace(process.env.CARPOSTCLUB_PUSH_VAPID_PRIVATE_KEY || process.env.KONNER_PUSH_VAPID_PRIVATE_KEY || process.env.WEB_PUSH_VAPID_PRIVATE_KEY);

  if (publicKey || privateKey) {
    if (!publicKey || !privateKey) {
      throw new Error("Both CARPOSTCLUB_PUSH_VAPID_PUBLIC_KEY and CARPOSTCLUB_PUSH_VAPID_PRIVATE_KEY are required for push notifications.");
    }
    return { publicKey, privateKey, source: "env" };
  }

  const stored = await readJson(pushVapidKeysPath, {});
  if (stored?.publicKey && stored?.privateKey) {
    return {
      publicKey: normalizeSpace(stored.publicKey),
      privateKey: normalizeSpace(stored.privateKey),
      source: "file",
    };
  }

  const generated = webPush.generateVAPIDKeys();
  await writeJson(pushVapidKeysPath, {
    ...generated,
    createdAt: new Date().toISOString(),
  });
  return { ...generated, source: "generated" };
}

async function readPushSubscriptions() {
  const store = await readJson(pushSubscriptionsPath, { subscriptions: [] });
  const rawSubscriptions = Array.isArray(store) ? store : store.subscriptions;
  return {
    subscriptions: Array.isArray(rawSubscriptions)
      ? rawSubscriptions.map(normalizeStoredPushSubscription).filter(Boolean)
      : [],
  };
}

async function updatePushSubscriptions(mutator) {
  pushSubscriptionsWritePromise = pushSubscriptionsWritePromise.catch(() => {}).then(async () => {
    const store = await readPushSubscriptions();
    const result = await mutator(store);
    store.subscriptions.sort((left, right) => {
      const username = left.username.localeCompare(right.username);
      if (username) return username;
      return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
    });
    await writeJson(pushSubscriptionsPath, { subscriptions: store.subscriptions });
    return result;
  });
  return pushSubscriptionsWritePromise;
}

async function upsertPushSubscription(subscription, user, userAgent) {
  const username = normalizeAuthUsername(user?.username);
  if (!username) throw httpError(401, "Authentication required.");

  const now = new Date().toISOString();
  const publicUser = publicAuthUser(user);
  return updatePushSubscriptions((store) => {
    const existing = store.subscriptions.find((record) => record.endpoint === subscription.endpoint);
    const record = {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      expirationTime: subscription.expirationTime,
      username,
      displayName: publicUser.displayName || username,
      passwordVersion: normalizeSpace(user?.passwordVersion).slice(0, 120),
      userAgent: normalizeSpace(userAgent).slice(0, 240),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (existing) {
      Object.assign(existing, record);
      return existing;
    }

    store.subscriptions.push(record);
    return record;
  });
}

async function removePushSubscription(endpoint, user) {
  const username = normalizeAuthUsername(user?.username);
  let removed = false;
  await updatePushSubscriptions((store) => {
    const initialCount = store.subscriptions.length;
    store.subscriptions = store.subscriptions.filter((record) => {
      return !(record.endpoint === endpoint && record.username === username);
    });
    removed = store.subscriptions.length !== initialCount;
  });
  return removed;
}

async function removePushSubscriptionsForUser(usernameValue) {
  const username = normalizeAuthUsername(usernameValue);
  if (!username) return 0;
  let removed = 0;
  await updatePushSubscriptions((store) => {
    const initialCount = store.subscriptions.length;
    store.subscriptions = store.subscriptions.filter((record) => record.username !== username);
    removed = initialCount - store.subscriptions.length;
  });
  return removed;
}

async function removePushEndpoints(endpoints) {
  const endpointSet = new Set(endpoints);
  if (!endpointSet.size) return 0;
  let removed = 0;
  await updatePushSubscriptions((store) => {
    const initialCount = store.subscriptions.length;
    store.subscriptions = store.subscriptions.filter((record) => !endpointSet.has(record.endpoint));
    removed = initialCount - store.subscriptions.length;
  });
  return removed;
}

async function sendPushNotifications({ payload, usernames = null, dealershipId = "", dealershipIds = null, excludeUsername = "" }) {
  let usernameSet = usernames
    ? new Set(usernames.map(normalizeAuthUsername).filter(Boolean))
    : null;
  if (!usernameSet) {
    const targetDealershipIds = normalizePushTargetDealershipIds({ dealershipId, dealershipIds });
    if (targetDealershipIds) {
      usernameSet = new Set();
      for (const targetDealershipId of targetDealershipIds) {
        for (const username of await usernamesForDealership(targetDealershipId)) {
          usernameSet.add(username);
        }
      }
    }
  }
  const excluded = normalizeAuthUsername(excludeUsername);
  const eligibleUserVersions = await pushEligibleUserVersions();
  const cleanPayload = cleanPushPayload({
    ...payload,
    notificationId: pushNotificationId(payload),
  });
  const notificationPayload = JSON.stringify(cleanPayload);
  const userPreferenceStore = await readUserPreferencesStore();
  const { subscriptions } = await readPushSubscriptions();
  const retiredEndpoints = new Set();
  const targets = subscriptions.filter((record) => {
    const expectedPasswordVersion = eligibleUserVersions.get(record.username);
    if (expectedPasswordVersion === undefined) return false;
    if (record.passwordVersion !== expectedPasswordVersion) {
      retiredEndpoints.add(record.endpoint);
      return false;
    }
    if (excluded && record.username === excluded) return false;
    if (usernameSet && !usernameSet.has(record.username)) return false;
    if (!userWantsPushNotification(record.username, cleanPayload, userPreferenceStore)) return false;
    return true;
  });

  const logged = await appendNotificationLogEntries(cleanPayload, targets).catch((error) => {
    console.warn(`Notification log update failed: ${error?.message || error}`);
    return 0;
  });
  const staleEndpoints = new Set();
  const results = await Promise.all(targets.map(async (record) => {
    if (pushDeliveryDisabled) return { status: "skipped" };

    try {
      await webPush.sendNotification({
        endpoint: record.endpoint,
        keys: record.keys,
      }, notificationPayload, {
        TTL: pushTtlSeconds,
      });
      return { status: "delivered" };
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status);
      if (statusCode === 404 || statusCode === 410) {
        staleEndpoints.add(record.endpoint);
        return { status: "stale" };
      }
      console.warn(`Push notification failed for ${record.username}: ${error?.message || error}`);
      return { status: "failed" };
    }
  }));

  const staleRemoved = await removePushEndpoints(staleEndpoints);
  const retiredRemoved = await removePushEndpoints(retiredEndpoints);
  return {
    requested: targets.length,
    delivered: results.filter((result) => result.status === "delivered").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    staleRemoved,
    retiredRemoved,
    logged,
  };
}

function userWantsPushNotification(usernameValue, payload, preferenceStore = null) {
  const username = normalizeAuthUsername(usernameValue);
  if (!username) return false;
  const preferenceState = preferenceStore?.users?.[username] || null;
  const preferences = normalizePushNotificationPreferences(preferenceState?.preferences?.pushNotifications);
  const key = pushNotificationPreferenceKeyForPayload(payload);
  return preferences[key] !== false;
}

function normalizePushTargetDealershipIds({ dealershipId = "", dealershipIds = null } = {}) {
  const rawValues = [];
  const addRawValue = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) addRawValue(item);
      return;
    }
    if (value === null || value === undefined || value === "") return;
    rawValues.push(value);
  };
  addRawValue(dealershipIds);
  addRawValue(dealershipId);
  if (!rawValues.length) return null;
  const ids = [];
  const seen = new Set();
  for (const value of rawValues) {
    const id = normalizeAuthDealershipId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function usersForDealership(dealershipIdValue) {
  const dealershipId = normalizeAuthDealershipId(dealershipIdValue);
  if (!dealershipId) return [];
  return (await approvedPushUsers()).filter((user) => normalizeAuthDealershipId(user.dealershipId) === dealershipId);
}

async function approvedPushUsers() {
  const users = [];
  const seen = new Set();
  const addUser = (user) => {
    const username = normalizeAuthUsername(user?.username);
    if (!username || seen.has(username)) return;
    if (user?.status && user.status !== "approved") return;
    seen.add(username);
    users.push(user.bootstrap ? user : authUserFromAccount(user));
  };

  addUser(bootstrapAdminUser());
  if (authEnabled) {
    const store = await readAuthUsers();
    for (const user of store.users) addUser(user);
  }
  return users;
}

async function usernamesForDealership(dealershipIdValue) {
  return (await usersForDealership(dealershipIdValue)).map((user) => user.username);
}

async function pushTargetingForDealership(dealershipIdValue) {
  const dealership = publicAuthDealership(dealershipIdValue);
  const users = dealership ? await usersForDealership(dealership.id) : [];
  const usernames = users.map((user) => user.username);
  const pushEnabledUsernames = await pushEnabledUsernamesForUsernames(usernames);
  const pushEnabledSet = new Set(pushEnabledUsernames);
  return {
    dealershipId: dealership?.id || "",
    label: dealership?.label || "",
    name: dealership?.name || "",
    dealership,
    usernames,
    pushEnabledUsernames,
    users: users.map(publicAuthUser),
    pushEnabledUsers: users.filter((user) => pushEnabledSet.has(user.username)).map(publicAuthUser),
  };
}

async function pushDryRunDealershipTargets() {
  const ids = [];
  const seen = new Set();
  for (const value of [...pushDryRunDealershipIds, ...authDealershipOptions.map((dealership) => dealership.id)]) {
    const id = normalizeAuthDealershipId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const targets = [];
  for (const id of ids) {
    const targeting = await pushTargetingForDealership(id);
    targets.push({
      dealershipId: targeting.dealershipId,
      label: targeting.label,
      name: targeting.name,
      usernames: targeting.usernames,
      pushEnabledUsernames: targeting.pushEnabledUsernames,
      users: targeting.users,
      pushEnabledUsers: targeting.pushEnabledUsers,
    });
  }
  return targets;
}

async function pushDryRunUploadTargets(uploaderUsernameValue) {
  const requestedUploaderUsername = normalizeAuthUsername(uploaderUsernameValue);
  if (!requestedUploaderUsername) throw httpError(400, "Choose an uploader username.");
  const users = await approvedPushUsers();
  const uploader = dryRunUploaderFromUsers(users, uploaderUsernameValue);
  const uploaderUsername = uploader?.username || requestedUploaderUsername;
  const recipientUsers = users.filter((user) => user.username !== uploaderUsername);
  const usernames = recipientUsers.map((user) => user.username);
  const pushEnabledUsernames = await pushEnabledUsernamesForUsernames(usernames);
  const pushEnabledSet = new Set(pushEnabledUsernames);
  return {
    requestedUploaderUsername,
    uploaderUsername,
    uploaderDisplayName: uploader?.displayName || uploaderUsername,
    usernames,
    pushEnabledUsernames,
    recipients: recipientUsers.map((user) => {
      const publicUser = publicAuthUser(user);
      return {
        username: publicUser.username,
        displayName: publicUser.displayName,
        dealershipId: publicUser.dealershipId,
        dealershipLabel: publicUser.dealershipLabel,
        pushEnabled: pushEnabledSet.has(publicUser.username),
      };
    }),
  };
}

function dryRunUploaderFromUsers(users, value) {
  const requested = normalizeAuthUsername(value);
  if (!requested) return null;
  return users.find((user) => user.username === requested)
    || users.find((user) => normalizeAuthUsername(user.displayName) === requested)
    || null;
}

function normalizeDryRunUploadUsernames(body = {}, authUser = {}) {
  const values = [];
  const add = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    const username = normalizeAuthUsername(value);
    if (username) values.push(username);
  };
  add(body.uploadUploaderUsernames);
  add(body.uploaderUsernames);
  add(body.upload?.uploaderUsernames);
  add(body.uploadUploaderUsername);
  add(body.uploaderUsername);
  add(body.upload?.uploaderUsername);
  if (!values.length) add(authUser?.username);
  const seen = new Set();
  return values.filter((username) => {
    if (seen.has(username)) return false;
    seen.add(username);
    return true;
  });
}

async function pushEnabledUsernamesForUsernames(usernames = null, { excludeUsername = "" } = {}) {
  const usernameSet = usernames
    ? new Set(usernames.map(normalizeAuthUsername).filter(Boolean))
    : null;
  const excluded = normalizeAuthUsername(excludeUsername);
  const eligibleUserVersions = await pushEligibleUserVersions();
  const { subscriptions } = await readPushSubscriptions();
  const seen = new Set();
  const results = [];
  for (const record of subscriptions) {
    const username = normalizeAuthUsername(record.username);
    if (!username || seen.has(username)) continue;
    const expectedPasswordVersion = eligibleUserVersions.get(username);
    if (expectedPasswordVersion === undefined) continue;
    if (record.passwordVersion !== expectedPasswordVersion) continue;
    if (excluded && username === excluded) continue;
    if (usernameSet && !usernameSet.has(username)) continue;
    seen.add(username);
    results.push(username);
  }
  return results;
}

async function readNotificationLog() {
  const store = await readJson(notificationLogPath, { notifications: [] });
  const rawNotifications = Array.isArray(store) ? store : store.notifications;
  return {
    notifications: Array.isArray(rawNotifications)
      ? rawNotifications.map(normalizeStoredNotification).filter(Boolean)
      : [],
  };
}

async function updateNotificationLog(mutator) {
  notificationLogWritePromise = notificationLogWritePromise.catch(() => {}).then(async () => {
    const store = await readNotificationLog();
    const result = await mutator(store);
    store.notifications.sort((left, right) => {
      const username = left.username.localeCompare(right.username);
      if (username) return username;
      return new Date(right.receivedAt || right.createdAt || 0).getTime() - new Date(left.receivedAt || left.createdAt || 0).getTime();
    });
    pruneNotificationLog(store);
    await writeJson(notificationLogPath, { notifications: store.notifications });
    return result;
  });
  return notificationLogWritePromise;
}

async function appendNotificationLogEntries(payload, targetRecords) {
  const usernames = [...new Set((targetRecords || [])
    .map((record) => normalizeAuthUsername(record?.username))
    .filter(Boolean))];
  if (!usernames.length) return 0;

  const cleanPayload = cleanPushPayload(payload);
  const id = cleanPushNotificationId(cleanPayload.notificationId || cleanPayload.messageId) || pushNotificationId(cleanPayload);
  const now = new Date().toISOString();

  return updateNotificationLog((store) => {
    let changed = 0;
    for (const username of usernames) {
      const existing = store.notifications.find((entry) => entry.username === username && entry.id === id);
      const record = {
        id,
        username,
        title: cleanPayload.title,
        body: cleanPayload.body,
        url: cleanPayload.url,
        kind: cleanPayload.kind,
        type: cleanPayload.type,
        route: cleanPayload.route,
        notificationType: cleanPayload.notificationType,
        tag: cleanPayload.tag,
        messageId: cleanPayload.messageId,
        uploadId: cleanPayload.uploadId,
        notificationId: id,
        albumId: cleanPayload.albumId,
        mediaCount: cleanPayload.mediaCount,
        author: cleanPayload.author,
        preview: cleanPayload.preview,
        dealershipId: cleanPayload.dealershipId,
        inventoryTypeId: cleanPayload.inventoryTypeId,
        inventoryKey: cleanPayload.inventoryKey,
        stockNumber: cleanPayload.stockNumber,
        createdAt: cleanPayload.timestamp || now,
        receivedAt: existing?.receivedAt || now,
        readAt: existing?.readAt || "",
      };

      if (existing) Object.assign(existing, record);
      else store.notifications.push(record);
      changed += 1;
    }
    return changed;
  });
}

async function notificationLogForUser(user, { limit = 50 } = {}) {
  const username = normalizeAuthUsername(user?.username);
  if (!username) throw httpError(401, "Authentication required.");
  const store = await readNotificationLog();
  const notifications = store.notifications
    .filter((entry) => entry.username === username)
    .filter((entry) => !isPreviewNotification(entry))
    .sort((left, right) => new Date(right.receivedAt || right.createdAt || 0).getTime() - new Date(left.receivedAt || left.createdAt || 0).getTime());
  return {
    notifications: notifications.slice(0, limit).map(publicNotificationRecord),
    unreadCount: notifications.filter((entry) => !entry.readAt).length,
  };
}

function isPreviewNotification(entry) {
  return Boolean(entry?.preview) || /^preview-/i.test(normalizeSpace(entry?.messageId || entry?.id));
}

async function markNotificationsRead(user, ids = null) {
  const username = normalizeAuthUsername(user?.username);
  if (!username) throw httpError(401, "Authentication required.");
  const idSet = Array.isArray(ids)
    ? new Set(ids.map(cleanPushNotificationId).filter(Boolean))
    : null;
  const now = new Date().toISOString();
  return updateNotificationLog((store) => {
    let marked = 0;
    for (const entry of store.notifications) {
      if (entry.username !== username) continue;
      if (idSet && !idSet.has(entry.id)) continue;
      if (entry.readAt) continue;
      entry.readAt = now;
      marked += 1;
    }
    return marked;
  });
}

async function markMediaGalleryNotificationsReadForAlbums(user, albums = []) {
  const username = normalizeAuthUsername(user?.username);
  if (!username) throw httpError(401, "Authentication required.");
  const albumIds = new Set();
  const inventoryKeys = new Set();
  for (const album of albums) {
    const albumId = cleanAlbumId(album?.id);
    if (albumId) albumIds.add(albumId);
    const inventoryKey = mediaGalleryNotificationInventoryKeyForAlbum(album);
    if (inventoryKey) inventoryKeys.add(inventoryKey);
  }
  if (!albumIds.size && !inventoryKeys.size) return 0;

  const now = new Date().toISOString();
  return updateNotificationLog((store) => {
    let marked = 0;
    for (const entry of store.notifications) {
      if (entry.username !== username || entry.readAt) continue;
      if (!notificationRecordTargetsMediaGallery(entry)) continue;
      const entryAlbumId = cleanAlbumId(entry.albumId);
      const entryInventoryKey = normalizeSpace(entry.inventoryKey);
      if (
        (entryAlbumId && albumIds.has(entryAlbumId))
        || (entryInventoryKey && inventoryKeys.has(entryInventoryKey))
      ) {
        entry.readAt = now;
        marked += 1;
      }
    }
    return marked;
  });
}

function notificationRecordTargetsMediaGallery(record) {
  const tokens = [
    record?.route,
    record?.notificationType,
    record?.type,
    record?.kind,
  ].map((value) => normalizeNotificationToken(value));
  return tokens.includes("media_gallery")
    || tokens.includes("media_upload")
    || tokens.includes("upload");
}

function mediaGalleryNotificationInventoryKeyForAlbum(album) {
  const vehicle = album?.vehicle || {};
  return normalizeSpace(vehicle.inventoryKey || vehicle.manualInventoryId || vehicle.vin);
}

function pruneNotificationLog(store) {
  const counts = new Map();
  store.notifications = store.notifications.filter((entry) => {
    const username = entry.username;
    const count = (counts.get(username) || 0) + 1;
    counts.set(username, count);
    return count <= notificationLogLimitPerUser;
  });
}

async function readAuditLog() {
  const store = await readJson(auditLogPath, { events: [] });
  const rawEvents = Array.isArray(store) ? store : store.events;
  const events = Array.isArray(rawEvents)
    ? rawEvents.map(normalizeStoredAuditEvent).filter(Boolean)
    : [];
  events.sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
  return { events };
}

async function appendAuditEvent(kind, actor, details = {}) {
  const event = normalizeStoredAuditEvent({
    id: `audit-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 12)}`,
    kind,
    actor: auditActor(actor),
    details: sanitizeAuditDetails(details),
    createdAt: new Date().toISOString(),
  });
  if (!event) return null;

  auditLogWritePromise = auditLogWritePromise.catch(() => {}).then(async () => {
    const store = await readAuditLog();
    store.events.unshift(event);
    store.events.sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
    store.events = store.events.slice(0, auditLogLimit);
    await writeJson(auditLogPath, { events: store.events });
    return event;
  });
  return auditLogWritePromise;
}

function normalizeStoredAuditEvent(value) {
  if (!value || typeof value !== "object") return null;
  const kind = normalizeAuditKind(value.kind);
  if (!kind) return null;
  return {
    id: normalizeSpace(value.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || `audit-${Date.now().toString(36)}`,
    kind,
    actor: normalizeAuditActor(value.actor),
    details: sanitizeAuditDetails(value.details),
    createdAt: normalizeIsoDate(value.createdAt || value.timestamp) || new Date().toISOString(),
  };
}

function normalizeAuditKind(value) {
  return normalizeSpace(value).toLowerCase().replace(/[^a-z0-9_.:-]/g, "").slice(0, 80);
}

function auditActor(user) {
  const publicUser = publicAuthUser(user);
  return normalizeAuditActor(publicUser.username ? publicUser : { username: "system", displayName: "System", role: "system" });
}

function normalizeAuditActor(value) {
  if (!value || typeof value !== "object") {
    return { username: "system", displayName: "System", role: "system" };
  }
  const username = normalizeAuthUsername(value.username) || "system";
  return {
    username,
    displayName: normalizeDisplayName(value.displayName) || username,
    role: value.role === "admin" ? "admin" : value.role === "system" ? "system" : "user",
  };
}

function auditAlbumDetails(album) {
  const vehicle = album?.vehicle || {};
  const stockNumber = normalizeSpace(vehicle.stockNumber || album?.inventoryNumber).slice(0, 80);
  return {
    albumId: normalizeSpace(album?.id).slice(0, 120),
    inventoryNumber: normalizeSpace(album?.inventoryNumber || stockNumber).slice(0, 80),
    dealershipId: normalizeSpace(album?.dealership?.id || album?.dealershipId || vehicle.dealershipId).slice(0, 20),
    vehicle: {
      vin: normalizeSpace(vehicle.vin).slice(0, 20),
      stockNumber,
      year: normalizeSpace(vehicle.year).slice(0, 8),
      make: normalizeSpace(vehicle.make).slice(0, 40),
      model: normalizeSpace(vehicle.model).slice(0, 60),
      trim: normalizeSpace(vehicle.trim).slice(0, 80),
      title: normalizeSpace(vehicle.title || album?.name).slice(0, 160),
    },
  };
}

function shortAuditHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function auditSuffix(value) {
  return normalizeSpace(value).slice(-8);
}

function sanitizeAuditDetails(value) {
  const sanitized = sanitizeAuditValue(value, "", 0);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized) ? sanitized : {};
}

function sanitizeAuditValue(value, key, depth) {
  if (isSensitiveAuditKey(key)) return undefined;
  if (value === null || value === undefined) return value === null ? null : undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, 1000);
  if (value instanceof Date) return value.toISOString();
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => sanitizeAuditValue(item, key, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, 50);
    const result = {};
    for (const [entryKey, entryValue] of entries) {
      const cleanKey = normalizeSpace(entryKey).replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80);
      if (!cleanKey || isSensitiveAuditKey(cleanKey)) continue;
      const cleanValue = sanitizeAuditValue(entryValue, cleanKey, depth + 1);
      if (cleanValue !== undefined) result[cleanKey] = cleanValue;
    }
    return result;
  }
  return undefined;
}

function isSensitiveAuditKey(key) {
  return /password|secret|token|cookie|authorization|session|bearer|credential|privatekey|apikey/i.test(String(key || ""));
}

async function pushEligibleUserVersions() {
  const eligible = new Map();
  const bootstrap = bootstrapAdminUser();
  eligible.set(bootstrap.username, bootstrap.passwordVersion || "");
  if (!authEnabled) return eligible;
  const { users } = await readAuthUsers();
  for (const user of users) {
    if (user.status === "approved") eligible.set(user.username, user.passwordVersion || "");
  }
  return eligible;
}

function queuePushNotifications(options) {
  return sendPushNotifications(options).catch((error) => {
    console.warn(`Push notification queue failed: ${error?.message || error}`);
    return {
      requested: 0,
      delivered: 0,
      failed: 0,
      skipped: 0,
      staleRemoved: 0,
      retiredRemoved: 0,
      error: true,
    };
  });
}

function chatPushPayload(message) {
  const messageId = normalizeSpace(message.id) || `${Date.now()}`;
  return {
    kind: "chat",
    messageId,
    author: message.author,
    timestamp: message.createdAt,
    title: `${message.author} in chat`,
    body: chatPushBody(message),
    tag: `carpostclub-chat-${messageId}`,
    url: "/chat",
  };
}

function chatReactionPushPayload(message, { reaction = "", reactor = {} } = {}) {
  const messageId = normalizeSpace(message?.id) || `${Date.now()}`;
  const reactorProfile = publicUploader(reactor) || {};
  const reactorName = normalizeChatAuthor(reactorProfile.displayName || reactorProfile.username || "Someone");
  const reactionLabel = chatReactionPushLabel(reaction);
  const notificationId = [
    "chat-reaction",
    messageId,
    normalizeAuthUsername(reactorProfile.username) || "user",
    normalizeNotificationToken(reaction) || "reaction",
    Date.now().toString(36),
    crypto.randomUUID().slice(0, 8),
  ].join("-");

  return {
    kind: "chat",
    type: "chat_reaction",
    notificationType: "chat_reaction",
    messageId,
    notificationId,
    author: reactorName,
    timestamp: new Date().toISOString(),
    title: `${reactorName} reacted with ${reactionLabel}`,
    body: chatReactionPushBody(message),
    tag: `carpostclub-chat-reaction-${notificationId}`,
    url: "/chat",
  };
}

function chatReactionPushLabel(reaction) {
  switch (reaction) {
    case "laugh":
      return "a laugh";
    case "heart":
      return "a heart";
    case "thumbs_up":
      return "thumbs up";
    case "thumbs_down":
      return "thumbs down";
    default:
      return "a reaction";
  }
}

function chatReactionPushBody(message) {
  const preview = chatPushBody(message);
  return preview ? `Message: ${preview}` : "Message: sent an attachment";
}

function chatPushBody(message) {
  const text = sanitizeChatMessageText(message?.text);
  if (text) return text;
  const attachments = normalizeChatAttachments(message?.attachments);
  const hasGif = attachments.some((attachment) => attachment.type === "gif");
  const hasImage = attachments.some((attachment) => attachment.type === "image");
  const hasAudio = attachments.some((attachment) => attachment.type === "audio");
  if (hasAudio && (hasGif || hasImage)) return "sent media";
  if (hasAudio) return attachments.length === 1 ? "sent an audio file" : "sent audio files";
  if (hasGif && hasImage) return "sent photos and GIFs";
  if (hasGif) return "sent a GIF";
  if (hasImage) return attachments.length === 1 ? "sent a photo" : "sent photos";
  return "sent an attachment";
}

function previewPushPayload(input = {}, user = {}) {
  const requestedKind = normalizeSpace(input.kind || input.type || "inventory_added").toLowerCase();
  const kind = requestedKind === "upload"
    ? "upload"
    : requestedKind === "inventory_added"
      ? "inventory_added"
      : requestedKind === "price_change"
        ? "price_change"
        : "";
  if (!kind) throw httpError(400, "Choose inventory_added, price_change, or upload preview.");

  const now = new Date().toISOString();
  const messageId = `preview-${kind}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const requestedDealership = publicAuthDealership(input.dealershipId || user?.dealershipId);
  const userDealership = publicAuthDealership(user?.dealershipId);
  const dealership = requestedDealership || userDealership || publicAuthDealership(shortcutDefaultDealershipId);
  const dealershipLabel = normalizeSpace(input.dealershipLabel).slice(0, 40) || dealership?.label || "CarPostClub";
  const titleOverride = normalizeSpace(input.title).slice(0, 80);
  const hasBodyOverride = Object.hasOwn(input, "body");
  const bodyOverride = normalizeSpace(input.body).slice(0, 180);

  if (kind === "upload") {
    const sampleVehicle = previewVehicleSample(dealershipLabel);
    const previewUploader = normalizeDisplayName(input.uploaderDisplayName || input.uploader || user?.displayName || user?.username) || "Someone";
    const previewCar = {
      dealershipId: dealership?.id || "",
      inventoryTypeId: defaultInventoryTypeId,
      inventoryKey: "STK123",
      stockNumber: "STK123",
      year: "2024",
      make: sampleVehicle.make,
      model: sampleVehicle.model,
      trim: sampleVehicle.trim,
    };
    return {
      kind,
      type: "media_upload",
      notificationType: "media_upload",
      route: "media_gallery",
      preview: true,
      messageId,
      title: titleOverride || uploadPushTitle({ displayName: previewUploader, username: user?.username }, previewCar),
      body: hasBodyOverride ? bodyOverride : uploadPushBody(previewCar),
      tag: `carpostclub-preview-${messageId}`,
      url: mediaGalleryDeepLink(previewCar),
      dealershipId: dealership?.id || "",
      inventoryTypeId: previewCar.inventoryTypeId,
      inventoryKey: previewCar.inventoryKey,
      stockNumber: previewCar.stockNumber,
      mediaCount: 12,
      author: previewUploader,
      timestamp: now,
    };
  }

  const sampleVehicle = previewVehicleSample(dealershipLabel);
  if (kind === "price_change") {
    const previewCar = {
      dealershipId: dealership?.id || "",
      inventoryTypeId: defaultInventoryTypeId,
      inventoryKey: "a10412a",
      stockNumber: "a10412a",
      year: "2020",
      make: sampleVehicle.make,
      model: sampleVehicle.model,
      previousPrice: normalizeSpace(input.previousPrice) || "$34,990",
      currentPrice: normalizeSpace(input.currentPrice || input.price) || "$32,990",
    };
    return {
      kind,
      type: "price_change",
      notificationType: "price_change",
      route: "notifications",
      preview: true,
      messageId,
      title: titleOverride || inventoryPriceChangePushTitle(previewCar),
      body: hasBodyOverride ? bodyOverride : inventoryPriceChangePushBody(previewCar),
      tag: `carpostclub-preview-${messageId}`,
      url: notificationsDeepLink({ notificationId: messageId }),
      dealershipId: dealership?.id || "",
      inventoryTypeId: previewCar.inventoryTypeId,
      inventoryKey: previewCar.inventoryKey,
      stockNumber: previewCar.stockNumber,
      timestamp: now,
    };
  }

  const previewCar = {
    dealershipId: dealership?.id || "",
    inventoryTypeId: defaultInventoryTypeId,
    inventoryKey: "a10412a",
    stockNumber: "a10412a",
    year: "2020",
    make: sampleVehicle.make,
    model: sampleVehicle.model,
  };
  return {
    kind,
    type: "inventory_added",
    notificationType: "inventory_added",
    route: "vehicle_media_intake",
    preview: true,
    messageId,
    title: titleOverride || inventoryAddedPushText(previewCar, dealershipLabel),
    body: "",
    tag: `carpostclub-preview-${messageId}`,
    url: vehicleDeepLink({
      dealershipId: dealership?.id || "",
      inventoryTypeId: defaultInventoryTypeId,
    }),
    dealershipId: dealership?.id || "",
    inventoryTypeId: previewCar.inventoryTypeId,
    inventoryKey: previewCar.inventoryKey,
    stockNumber: previewCar.stockNumber,
    timestamp: now,
  };
}

function previewVehicleSample(dealershipLabel) {
  const label = normalizeSpace(dealershipLabel).toLowerCase();
  if (label === "gm") return { make: "Chevrolet", model: "Silverado", trim: "Custom" };
  if (label === "nissan") return { make: "Nissan", model: "Rogue", trim: "SV" };
  if (label === "greenlight") return { make: "Toyota", model: "RAV4", trim: "LE AWD" };
  if (label === "kia") return { make: "Kia", model: "Sportage", trim: "" };
  return { make: dealershipLabel, model: "Preview", trim: "" };
}

function uploadAlbumEventPayload(car, result, user) {
  const mediaCount = Array.isArray(result?.photos) ? result.photos.length : 0;
  const album = result?.album || null;
  const uploadedBy = publicAuthUser(user);
  return {
    kind: "upload",
    type: "media_upload",
    notificationType: "media_upload",
    route: "media_gallery",
    uploadId: `upload-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    albumId: album?.id || "",
    mediaCount,
    title: uploadPushTitle(uploadedBy, car || album?.vehicle),
    body: uploadPushBody(car || album?.vehicle),
    liveStatusBody: uploadLiveStatusBody(car || album?.vehicle),
    tag: `carpostclub-upload-${carInventoryNotificationKey(car)}`,
    url: mediaGalleryDeepLink(car, { albumId: album?.id || "" }),
    dealershipId: car?.dealership?.id || car?.dealershipId,
    inventoryTypeId: car?.inventoryTypeId || defaultInventoryTypeId,
    inventoryKey: car?.inventoryKey || car?.manualInventoryId || car?.vin || "",
    stockNumber: car?.stockNumber || "",
    uploadedBy,
    uploadedAt: new Date().toISOString(),
  };
}

function uploadPushPayload(car, mediaCount, uploadEvent = null) {
  const uploadedBy = uploadEvent?.uploadedBy || null;
  return {
    kind: "upload",
    type: "media_upload",
    notificationType: "media_upload",
    route: "media_gallery",
    messageId: uploadEvent?.uploadId || `upload-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    uploadId: uploadEvent?.uploadId || "",
    albumId: uploadEvent?.albumId || "",
    mediaCount,
    title: uploadEvent?.title || uploadPushTitle(uploadedBy, car),
    body: Object.hasOwn(uploadEvent || {}, "body") ? uploadEvent.body : uploadPushBody(car),
    tag: uploadEvent?.tag || `carpostclub-upload-${carInventoryNotificationKey(car)}`,
    url: uploadEvent?.url || mediaGalleryDeepLink(car),
    dealershipId: car?.dealership?.id || car?.dealershipId,
    inventoryTypeId: car?.inventoryTypeId || defaultInventoryTypeId,
    inventoryKey: car?.inventoryKey || car?.manualInventoryId || car?.vin || "",
    stockNumber: car?.stockNumber || "",
    author: uploadedBy?.displayName || uploadedBy?.username || "",
    timestamp: uploadEvent?.uploadedAt || new Date().toISOString(),
  };
}

function uploadPushTitle(uploadedBy, car = null) {
  const name = normalizeDisplayName(uploadedBy?.displayName || uploadedBy?.username) || "Someone";
  const label = vehicleUploadPushLabel(car);
  return label ? `${name} uploaded ${label}` : `${name} uploaded a car`;
}

function uploadPushBody(_car) {
  return "";
}

function uploadLiveStatusBody(car) {
  const label = vehicleUploadPushLabel(car);
  return label ? `Photos added for ${label}.` : "Media uploaded.";
}

function vehicleUploadPushLabel(car) {
  const stock = normalizeSpace(car?.stockNumber || car?.inventoryKey);
  const vehicleName = vehiclePushName(car);
  if (stock && vehicleName) return `${stock} - ${vehicleName}`;
  return stock || vehicleName;
}

function vehiclePushLabel(vehicle) {
  const stock = normalizeSpace(vehicle?.stockNumber || vehicle?.inventoryKey);
  const name = vehiclePushName(vehicle);
  return normalizeSpace([stock, name].filter(Boolean).join(" ")) || "Vehicle";
}

function inventoryAddedPushText(vehicle, dealershipLabel = "") {
  const make = displayVehicleWord(vehicle?.make || dealershipLabel || "Vehicle");
  const stock = normalizeSpace(vehicle?.stockNumber || vehicle?.inventoryKey);
  const year = normalizeSpace(vehicle?.year).replace(/[^0-9]/g, "");
  const vehicleMake = displayVehicleWord(vehicle?.make || make);
  const model = displayVehicleWords(vehicle?.model);
  const details = [stock, year, vehicleMake, model].filter(Boolean).join(" ");
  return normalizeSpace(`new ${make} Inventory ${details}`);
}

function inventoryAddedPushBody(vehicle) {
  const stock = normalizeSpace(vehicle?.stockNumber || vehicle?.inventoryKey);
  const price = normalizeSpace(vehicle?.price || vehicle?.currentPrice);
  const parts = [];
  if (stock) parts.push(`Stock ${stock}`);
  if (price) parts.push(price);
  return parts.join(" - ");
}

function inventoryPriceChangePushTitle(vehicle) {
  const stock = normalizeSpace(vehicle?.stockNumber || vehicle?.inventoryKey);
  const year = normalizeSpace(vehicle?.year).replace(/[^0-9]/g, "");
  const make = displayVehicleWord(vehicle?.make || "Vehicle");
  const details = [stock, year, make].filter(Boolean).join(" ");
  return normalizeSpace(`(PRICE CHANGE!!!) ${details}`);
}

function inventoryPriceChangePushBody(vehicle) {
  const previousPrice = normalizeSpace(vehicle?.previousPrice);
  const currentPrice = normalizeSpace(vehicle?.currentPrice || vehicle?.price);
  if (previousPrice && currentPrice && previousPrice !== currentPrice) return `${previousPrice} -> ${currentPrice}`;
  if (currentPrice) return `Now ${currentPrice}`;
  return "";
}

function inventoryAddedPushTagVehicleKey(vehicle) {
  const key = normalizeSpace(vehicle?.stockNumber || vehicle?.inventoryKey || vehicle?.vin)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  if (key) return key;
  return crypto.createHash("sha256").update(JSON.stringify(vehicle || {})).digest("hex").slice(0, 12);
}

function vehiclePushName(vehicle) {
  const structured = normalizeSpace([
    vehicle?.year,
    vehicle?.make,
    vehicle?.model,
    vehicle?.trim,
  ].filter(Boolean).join(" "));
  if (structured) return structured;
  return normalizeSpace(vehicle?.title).replace(/^(Used|New|Certified)\s+/i, "");
}

function displayVehicleWords(value) {
  return normalizeSpace(value)
    .split(/\s+/)
    .map(displayVehicleWord)
    .join(" ");
}

function displayVehicleWord(value) {
  const text = normalizeSpace(value);
  if (!text) return "";
  const upper = text.toUpperCase();
  if (["BMW", "GM", "GMC", "MINI", "VW", "GT", "GTI", "EV", "EV6", "EV9", "CX-5", "CX-50", "CR-V", "HR-V"].includes(upper)) {
    return upper;
  }
  return text.toLowerCase().replace(/(^|[-'./])([a-z0-9])/g, (match, prefix, char) => `${prefix}${char.toUpperCase()}`);
}

function carInventoryNotificationKey(car) {
  return normalizeSpace(car?.inventoryKey || car?.vin || car?.stockNumber || "vehicle")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "vehicle";
}

function vehicleDeepLink(car, { openAlbum = false } = {}) {
  const query = vehicleRouteParams(car, { openAlbum }).toString();
  return query ? `/?${query}` : "/";
}

function mediaGalleryDeepLink(car, { openAlbum = false, albumId = "" } = {}) {
  const query = vehicleRouteParams(car, { openAlbum, albumId }).toString();
  return query ? `/gallery?${query}` : "/gallery";
}

function notificationsDeepLink({ notificationId = "" } = {}) {
  const params = new URLSearchParams();
  params.set("openNotifications", "1");
  const cleanNotificationId = cleanPushNotificationId(notificationId);
  if (cleanNotificationId) params.set("notificationId", cleanNotificationId);
  return `/?${params.toString()}`;
}

function vehicleRouteParams(car, { openAlbum = false, albumId = "" } = {}) {
  const params = new URLSearchParams();
  const dealershipId = normalizeSpace(car?.dealership?.id || car?.dealershipId);
  const inventoryTypeId = normalizeSpace(car?.inventoryTypeId || defaultInventoryTypeId);
  const inventoryKey = normalizeSpace(car?.inventoryKey || car?.manualInventoryId || car?.vin);
  const cleanAlbumIdValue = normalizeSpace(albumId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
  if (dealershipId) params.set("dealershipId", dealershipId);
  if (inventoryTypeId) params.set("inventoryTypeId", inventoryTypeId);
  if (inventoryKey) params.set("inventoryKey", inventoryKey);
  if (cleanAlbumIdValue) params.set("albumId", cleanAlbumIdValue);
  if (openAlbum) params.set("openAlbum", "1");
  return params;
}

function pushNotificationId(payload = {}) {
  const explicit = cleanPushNotificationId(payload.notificationId || payload.messageId);
  if (explicit) return explicit;
  return `push-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function publicPushSubscriptionRecord(record) {
  return {
    endpoint: record.endpoint,
    username: record.username,
    displayName: record.displayName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function publicNotificationRecord(record) {
  return {
    id: record.id,
    notificationId: record.notificationId || record.id,
    title: record.title,
    body: record.body,
    url: record.url,
    kind: record.kind,
    type: record.type,
    route: record.route,
    notificationType: record.notificationType,
    tag: record.tag,
    messageId: record.messageId,
    uploadId: record.uploadId,
    albumId: record.albumId,
    mediaCount: record.mediaCount,
    author: record.author,
    preview: Boolean(record.preview),
    dealershipId: record.dealershipId,
    inventoryTypeId: record.inventoryTypeId,
    inventoryKey: record.inventoryKey,
    stockNumber: record.stockNumber,
    createdAt: record.createdAt,
    receivedAt: record.receivedAt,
    readAt: record.readAt,
  };
}

function normalizeStoredNotification(record) {
  if (!record || typeof record !== "object") return null;
  const username = normalizeAuthUsername(record.username);
  const id = cleanPushNotificationId(record.id || record.notificationId || record.messageId);
  if (!username || !id) return null;
  const now = new Date().toISOString();
  const hasBody = Object.hasOwn(record, "body");
  return {
    id,
    username,
    notificationId: id,
    title: normalizeSpace(record.title).slice(0, 80) || appName,
    body: hasBody ? sanitizeChatMessageText(record.body, { truncate: true }).slice(0, 180) : `Open ${appName}.`,
    url: cleanNotificationPath(record.url, "/"),
    kind: normalizeSpace(record.kind).slice(0, 32),
    type: normalizeNotificationToken(record.type || record.notificationType || record.kind),
    route: normalizeNotificationToken(record.route),
    notificationType: normalizeNotificationToken(record.notificationType || record.type || record.kind),
    tag: normalizeSpace(record.tag).slice(0, 80) || "carpostclub",
    messageId: cleanPushNotificationId(record.messageId),
    uploadId: cleanPushNotificationId(record.uploadId),
    albumId: normalizeSpace(record.albumId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120),
    mediaCount: positiveInteger(record.mediaCount, 0),
    author: record.author ? normalizeChatAuthor(record.author) : "",
    preview: Boolean(record.preview),
    dealershipId: normalizeAuthDealershipId(record.dealershipId),
    inventoryTypeId: normalizeSpace(record.inventoryTypeId).slice(0, 32),
    inventoryKey: normalizeSpace(record.inventoryKey).slice(0, 120),
    stockNumber: normalizeSpace(record.stockNumber).slice(0, 80),
    createdAt: normalizeIsoDate(record.createdAt || record.timestamp) || now,
    receivedAt: normalizeIsoDate(record.receivedAt) || normalizeIsoDate(record.createdAt || record.timestamp) || now,
    readAt: normalizeIsoDate(record.readAt) || "",
  };
}

function normalizeStoredPushSubscription(record) {
  if (!record || typeof record !== "object") return null;
  try {
    const subscription = cleanPushSubscription(record);
    const username = normalizeAuthUsername(record.username);
    if (!username) return null;
    const now = new Date().toISOString();
    return {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      expirationTime: subscription.expirationTime,
      username,
      displayName: normalizeDisplayName(record.displayName) || username,
      passwordVersion: normalizeSpace(record.passwordVersion).slice(0, 120),
      userAgent: normalizeSpace(record.userAgent).slice(0, 240),
      createdAt: normalizeIsoDate(record.createdAt) || now,
      updatedAt: normalizeIsoDate(record.updatedAt) || normalizeIsoDate(record.createdAt) || now,
    };
  } catch {
    return null;
  }
}

function cleanPushSubscription(value) {
  if (!value || typeof value !== "object") {
    throw httpError(400, "Invalid push subscription.");
  }
  return {
    endpoint: cleanPushEndpoint(value.endpoint),
    keys: {
      p256dh: cleanPushKey(value.keys?.p256dh, "p256dh"),
      auth: cleanPushKey(value.keys?.auth, "auth"),
    },
    expirationTime: cleanPushExpirationTime(value.expirationTime),
  };
}

function cleanPushExpirationTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const expirationTime = Number(value);
  return Number.isFinite(expirationTime) && expirationTime >= 0 ? expirationTime : null;
}

function cleanPushEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!endpoint || endpoint.length > 4096) throw httpError(400, "Invalid push endpoint.");
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") throw new Error("Push endpoints must use HTTPS.");
  } catch {
    throw httpError(400, "Invalid push endpoint.");
  }
  return endpoint;
}

function cleanOptionalPushEndpoint(value) {
  const endpoint = normalizeSpace(value);
  if (!endpoint) return "";
  try {
    return cleanPushEndpoint(endpoint);
  } catch {
    return "";
  }
}

function cleanPushKey(value, label) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9+/_=-]{12,512}$/.test(key)) {
    throw httpError(400, `Invalid push ${label} key.`);
  }
  return key;
}

function cleanPushPayload(payload = {}) {
  const kind = normalizeSpace(payload.kind).slice(0, 32);
  const timestamp = normalizeIsoDate(payload.timestamp);
  const messageId = cleanPushNotificationId(payload.messageId);
  const notificationId = cleanPushNotificationId(payload.notificationId || messageId);
  const notificationType = normalizeNotificationToken(payload.notificationType || payload.type || kind);
  const hasBody = Object.hasOwn(payload, "body");
  return {
    notificationId,
    title: normalizeSpace(payload.title).slice(0, 80) || appName,
    body: hasBody ? sanitizeChatMessageText(payload.body, { truncate: true }).slice(0, 180) : `Open ${appName}.`,
    icon: cleanNotificationPath(payload.icon, "/icons/carpostclub-icon-192.png"),
    badge: cleanNotificationPath(payload.badge, "/icons/carpostclub-apple-touch-icon.png"),
    tag: normalizeSpace(payload.tag).slice(0, 80) || "carpostclub",
    url: cleanNotificationPath(payload.url, "/"),
    kind,
    type: normalizeNotificationToken(payload.type || notificationType || kind),
    route: normalizeNotificationToken(payload.route),
    notificationType,
    messageId,
    uploadId: cleanPushNotificationId(payload.uploadId),
    albumId: normalizeSpace(payload.albumId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120),
    mediaCount: positiveInteger(payload.mediaCount, 0),
    author: payload.author ? normalizeChatAuthor(payload.author) : "",
    preview: Boolean(payload.preview),
    dealershipId: normalizeAuthDealershipId(payload.dealershipId || payload.dealership?.id),
    inventoryTypeId: normalizeSpace(payload.inventoryTypeId).slice(0, 32),
    inventoryKey: normalizeSpace(payload.inventoryKey).slice(0, 120),
    stockNumber: normalizeSpace(payload.stockNumber).slice(0, 80),
    timestamp,
  };
}

function normalizeNotificationToken(value) {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function cleanPushNotificationId(value) {
  return normalizeSpace(value)
    .replace(/[^A-Za-z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function cleanNotificationPath(value, fallback) {
  const text = String(value || "").trim();
  if (text.startsWith("/") && !text.startsWith("//")) return text.slice(0, 512);
  return fallback;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
}

async function moveFile(source, destination) {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    await fs.copyFile(source, destination);
    await fs.unlink(source);
  }
}

async function cleanupTempFiles(files) {
  await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {})));
}

async function cleanupSavedUploads(photos) {
  if (!Array.isArray(photos) || !photos.length) return;

  const filenamesByAlbum = new Map();
  for (const photo of photos) {
    let albumId;
    let filename;
    try {
      albumId = cleanAlbumId(photo?.albumId);
      filename = cleanFilename(photo?.filename);
    } catch {
      continue;
    }
    if (!filenamesByAlbum.has(albumId)) filenamesByAlbum.set(albumId, new Set());
    filenamesByAlbum.get(albumId).add(filename);
    await deleteStoredMedia(albumId, filename).catch(() => {});
  }

  await Promise.all([...filenamesByAlbum].map(async ([albumId, filenames]) => {
    await updatePhotoMetadata(albumId, (metadata) => {
      for (const filename of filenames) delete metadata[filename];
    }).catch(() => {});
    await removeMarketplaceCopyIfAlbumEmpty(albumId).catch(() => {});
  }));
}

async function saveUploadedMediaForCar({ files, car, user }) {
  const lockKey = vehicleUploadLockKey(car);
  const previous = vehicleUploadWritePromises.get(lockKey) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => saveUploadedMediaForCarLocked({ files, car, user }));
  vehicleUploadWritePromises.set(lockKey, next);
  try {
    return await next;
  } finally {
    if (vehicleUploadWritePromises.get(lockKey) === next) {
      vehicleUploadWritePromises.delete(lockKey);
    }
  }
}

async function saveUploadedMediaForCarLocked({ files, car, user }) {
  const saved = [];
  try {
    if (!files.length) throw httpError(400, "No media files were uploaded.");
    await assertVehicleCanReceiveUpload(car, user);
    const album = await ensureCarAlbum(car, user);

    for (const file of files) {
      saved.push(await saveUploadedPhoto(album.id, file, user));
    }

    let updatedAlbum = await readAlbum(album.id) || album;
    const marketplaceGeneration = await prepareMarketplaceDescriptionsForUpload(car, user, {
      album: updatedAlbum,
      uploadedMediaCount: saved.length,
    });
    updatedAlbum = await readAlbum(album.id) || updatedAlbum;
    const marketplaceDraft = await buildMarketplaceDraftForUser(car, user, { album: updatedAlbum });

    return {
      album: updatedAlbum,
      photos: saved,
      marketplaceGeneration,
      marketplaceDraft,
    };
  } catch (error) {
    await cleanupSavedUploads(saved);
    throw error;
  }
}

async function assertVehicleCanReceiveUpload(car, user) {
  const existingAlbum = await findExistingVehicleAlbum(car);
  if (!existingAlbum?.mediaCount) return;
  if (user?.role === "admin") return;

  const vehicleLabel = existingAlbum.vehicle?.stockNumber
    || existingAlbum.vehicle?.vin
    || existingAlbum.name
    || "this vehicle";
  throw httpError(
    409,
    `${vehicleLabel} already has uploaded CarPostClub photos. Open it from the gallery instead of creating a duplicate photo set.`,
  );
}

function vehicleUploadLockKey(car) {
  return [
    normalizeSpace(car?.dealership?.id || car?.dealershipId || "dealership").toLowerCase(),
    normalizeSpace(car?.inventoryTypeId || defaultInventoryTypeId).toLowerCase(),
    normalizeSpace(car?.vin || car?.inventoryKey || car?.manualInventoryId || car?.stockNumber || "vehicle").toUpperCase(),
  ].join(":");
}

function albumPath(albumId) {
  albumId = cleanAlbumId(albumId);
  const resolved = path.resolve(uploadRoot, albumId);
  if (resolved !== uploadRoot && resolved.startsWith(`${uploadRoot}${path.sep}`)) return resolved;
  throw httpError(400, "Invalid album.");
}

function photoPath(albumId, filename) {
  filename = cleanFilename(filename);
  const root = albumPath(albumId);
  const resolved = path.resolve(root, filename);
  if (resolved.startsWith(`${root}${path.sep}`)) return resolved;
  throw httpError(400, "Invalid photo.");
}

function thumbnailDirectoryPath(albumId) {
  const root = albumPath(albumId);
  const resolved = path.resolve(root, thumbnailDirectoryName);
  if (resolved.startsWith(`${root}${path.sep}`)) return resolved;
  throw httpError(400, "Invalid thumbnail directory.");
}

function thumbnailPath(albumId, filename) {
  filename = cleanFilename(filename);
  const root = thumbnailDirectoryPath(albumId);
  const resolved = path.resolve(root, `${filename}.webp`);
  if (resolved.startsWith(`${root}${path.sep}`)) return resolved;
  throw httpError(400, "Invalid thumbnail.");
}

function cleanAlbumId(value) {
  const albumId = String(value || "").trim();
  if (/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(albumId) && !albumId.includes("..")) {
    return albumId.toLowerCase();
  }
  throw httpError(400, "Invalid album.");
}

function cleanDealershipId(value) {
  const id = String(value || "").trim();
  const dealership = oregansDealerships.find((candidate) => candidate.id === id);
  if (dealership) return dealership;
  throw httpError(400, "Select a dealership before uploading photos.");
}

function cleanInventoryTypeId(value) {
  const id = String(value || "").trim();
  if (inventoryTypes.some((type) => type.id === id)) return id;
  throw httpError(400, "Invalid O'Regan's inventory filter.");
}

function cleanOptionalInventoryTypeId(value) {
  const id = String(value || "").trim();
  return id ? cleanInventoryTypeId(id) : "";
}

function cleanInventoryKey(value) {
  const key = String(value || "").trim();
  if (/^manual-[a-z0-9-]{8,80}$/i.test(key)) return key.toLowerCase();
  return cleanVin(key);
}

function cleanManualInventoryId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (/^manual-[a-z0-9-]{8,80}$/.test(id)) return id;
  throw httpError(400, "Invalid manual inventory record.");
}

function cleanVin(value) {
  const vin = String(value || "").trim().toUpperCase();
  if (/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) return vin;
  throw httpError(400, "Select a car before uploading media.");
}

function cleanOptionalVin(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return cleanVin(text);
  } catch {
    throw httpError(400, "VIN must be 11 to 17 characters and cannot include I, O, or Q.");
  }
}

function cleanManualText(value, label, { maxLength = 80 } = {}) {
  const text = normalizeSpace(value).slice(0, maxLength);
  if (!text) throw httpError(400, `${label} is required.`);
  return text;
}

function cleanManualOptionalText(value, { maxLength = 160 } = {}) {
  return normalizeSpace(value).slice(0, maxLength);
}

function cleanManualYear(value) {
  const year = parseNullableInteger(value);
  const nextYear = new Date().getFullYear() + 1;
  if (!Number.isInteger(year) || year < 1980 || year > nextYear) {
    throw httpError(400, `Year must be between 1980 and ${nextYear}.`);
  }
  return year;
}

function cleanManualMoney(value) {
  const price = parseCurrency(value);
  if (!Number.isFinite(price) || price <= 0) throw httpError(400, "Price in CAD is required.");
  return Math.round(price);
}

function cleanManualNonNegativeInteger(value, label) {
  const parsed = parseNullableInteger(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw httpError(400, `${label} is required.`);
  return parsed;
}

function formatCadPrice(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `$${Math.round(amount).toLocaleString("en-CA")}` : "";
}

function formatKilometers(value) {
  const kilometers = Number(value);
  return Number.isFinite(kilometers) && kilometers >= 0 ? `${Math.round(kilometers).toLocaleString("en-CA")} km` : "";
}

function cleanFilename(value) {
  const filename = String(value || "").trim();
  if (filename && path.basename(filename) === filename && !filename.startsWith(".") && isMediaFilename(filename)) {
    return filename;
  }
  throw httpError(400, "Invalid media file.");
}

function normalizeObjectStoragePrefix(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function carAlbumId(car) {
  const carSlug = slugify(car.title || [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ") || car.vin || "car").slice(0, 48);
  const inventorySlug = slugify(car.stockNumber || car.vin || "inventory").slice(0, 24);
  return `car-${carSlug}-${inventorySlug}`.replace(/-+/g, "-").replace(/-+$/g, "");
}

function legacyCarAlbumId(car) {
  if (!car.vin) return "";
  return `car-${cleanVin(car.vin).toLowerCase()}`;
}

function vehicleAlbumName(car) {
  return normalizeSpace([
    car.title || [car.year, car.make, car.model, car.trim].filter(Boolean).join(" "),
    car.stockNumber || car.vin,
  ].filter(Boolean).join(" - "));
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "album";
}

function titleFromAlbumId(albumId) {
  return albumId
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Album";
}

function sanitizeFilenameBase(value) {
  return slugify(value || "media").slice(0, 80) || "media";
}

function isMediaLike(filename, mimetype) {
  const mime = String(mimetype || "").toLowerCase();
  return mime.startsWith("image/") || mime.startsWith("video/") || isMediaFilename(filename);
}

function isChatAttachmentLike(filename, mimetype) {
  const mime = String(mimetype || "").toLowerCase();
  if (mime.startsWith("video/") || isVideoFilename(filename)) return false;
  return mime.startsWith("image/")
    || mime.startsWith("audio/")
    || isPhotoFilename(filename)
    || isAudioFilename(filename);
}

function isPhotoFilename(filename) {
  return imageExtensions.has(path.extname(String(filename || "")).toLowerCase());
}

function isHeicFilename(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  return extension === ".heic" || extension === ".heif";
}

function isVideoFilename(filename) {
  return videoExtensions.has(path.extname(String(filename || "")).toLowerCase());
}

function isAudioFilename(filename) {
  return audioExtensions.has(path.extname(String(filename || "")).toLowerCase());
}

function isMediaFilename(filename) {
  return isPhotoFilename(filename) || isVideoFilename(filename);
}

function mediaKindFor(filename, contentType = "") {
  const mime = String(contentType || "").toLowerCase();
  if (mime.startsWith("video/") || isVideoFilename(filename)) return "video";
  return "image";
}

function extensionFor(filename, mimetype) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  const mime = String(mimetype || "").toLowerCase();
  if (mime === "image/heic" || mime === "image/heic-sequence") return ".heic";
  if (mime === "image/heif" || mime === "image/heif-sequence") return ".heif";
  if (mime === "image/avif") return ".avif";
  const mimeKind = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "";
  const extensionKind = isVideoFilename(filename) ? "video" : isPhotoFilename(filename) ? "image" : isAudioFilename(filename) ? "audio" : "";
  if (extensionKind && (!mimeKind || extensionKind === mimeKind)) return extension;

  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "video/quicktime") return ".mov";
  if (mime === "video/webm") return ".webm";
  if (mime === "video/ogg") return ".ogv";
  if (mime === "video/x-m4v") return ".m4v";
  if (mime.startsWith("video/")) return ".mp4";
  if (mime === "audio/aac" || mime === "audio/x-aac") return ".aac";
  if (mime === "audio/ac3") return ".ac3";
  if (mime === "audio/aiff" || mime === "audio/x-aiff") return ".aiff";
  if (mime === "audio/amr") return ".amr";
  if (mime === "audio/ape" || mime === "audio/x-ape") return ".ape";
  if (mime === "audio/basic") return ".au";
  if (mime === "audio/flac" || mime === "audio/x-flac") return ".flac";
  if (mime === "audio/midi" || mime === "audio/x-midi") return ".mid";
  if (mime === "audio/mp4" || mime === "audio/x-m4a") return ".m4a";
  if (mime === "audio/mpeg" || mime === "audio/mp3" || mime === "audio/x-mp3" || mime === "audio/mpeg3") return ".mp3";
  if (mime === "audio/ogg" || mime === "application/ogg") return ".ogg";
  if (mime === "audio/opus") return ".opus";
  if (mime === "audio/vnd.dts") return ".dts";
  if (mime === "audio/vnd.rn-realaudio") return ".ra";
  if (mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav") return ".wav";
  if (mime === "audio/webm") return ".weba";
  if (mime === "audio/x-caf") return ".caf";
  if (mime === "audio/x-matroska") return ".mka";
  if (mime === "audio/x-ms-wma") return ".wma";
  if (mime === "audio/3gpp") return ".3gp";
  if (mime === "audio/3gpp2") return ".3g2";
  if (mime.startsWith("audio/")) return ".m4a";
  return ".jpg";
}

function uploadContentTypeFor(filename, mimetype) {
  const mime = normalizeSpace(mimetype).toLowerCase();
  if (mime && mime !== "application/octet-stream") return mime;
  return contentTypeFor(filename);
}

function contentTypeFor(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".avif") return "image/avif";
  if (extension === ".heic") return "image/heic";
  if (extension === ".heif") return "image/heif";
  if (extension === ".tif" || extension === ".tiff") return "image/tiff";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  if (extension === ".ogv") return "video/ogg";
  if (extension === ".m4v") return "video/x-m4v";
  if (extension === ".aac") return "audio/aac";
  if (extension === ".ac3") return "audio/ac3";
  if (extension === ".aif" || extension === ".aifc" || extension === ".aiff") return "audio/aiff";
  if (extension === ".amr") return "audio/amr";
  if (extension === ".ape") return "audio/ape";
  if (extension === ".au") return "audio/basic";
  if (extension === ".caf") return "audio/x-caf";
  if (extension === ".dts") return "audio/vnd.dts";
  if (extension === ".flac") return "audio/flac";
  if (extension === ".m4a" || extension === ".m4b" || extension === ".m4p") return "audio/mp4";
  if (extension === ".mid" || extension === ".midi") return "audio/midi";
  if (extension === ".mka") return "audio/x-matroska";
  if (extension === ".mp2" || extension === ".mp3") return "audio/mpeg";
  if (extension === ".oga" || extension === ".ogg") return "audio/ogg";
  if (extension === ".opus") return "audio/opus";
  if (extension === ".ra" || extension === ".ram") return "audio/vnd.rn-realaudio";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".weba") return "audio/webm";
  if (extension === ".wma") return "audio/x-ms-wma";
  if (extension === ".3g2") return "audio/3gpp2";
  if (extension === ".3ga" || extension === ".3gp") return "audio/3gpp";
  return "application/octet-stream";
}

function extractClassText(html, className) {
  const pattern = new RegExp(`<[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  const match = html.match(pattern);
  return match ? cleanText(stripTags(match[1])) : "";
}

function extractHrefByClass(html, className) {
  const pattern = /<a\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attributes = match[1];
    const classValue = getHtmlAttribute(attributes, "class");
    if (!classValue.split(/\s+/).includes(className)) continue;
    return decodeHtml(getHtmlAttribute(attributes, "href"));
  }
  return "";
}

function extractDataAttribute(html, name) {
  const pattern = new RegExp(`data-${escapeRegExp(name)}=["']([^"']+)["']`, "i");
  return decodeHtml(pattern.exec(html)?.[1] || "");
}

function getHtmlAttribute(attributes, name) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, "i");
  return pattern.exec(attributes)?.[1] || "";
}

function extractVin(html) {
  const href = html.match(/href=["'][^"']*vehicle\.vin=([^"'&]+)[^"']*["']/i)?.[1] || "";
  return decodeURIComponent(decodeHtml(href)).trim().toUpperCase();
}

function absolutizeOregansUrl(value) {
  const url = cleanExternalHttpUrl(value, { base: "https://www.oregans.com" });
  if (!url) return "";
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === "oregans.com" || hostname === "www.oregans.com" || hostname.endsWith(".oregans.com")) return url;
  return "";
}

function sanitizedOregansDetailUrl(value, source = "oregans") {
  if (normalizeSpace(source || "oregans").toLowerCase() === "manual") return "";
  return absolutizeOregansUrl(value);
}

function cleanExternalHttpUrl(value, { base = "" } = {}) {
  const text = normalizeSpace(value);
  if (!text) return "";
  try {
    const url = base ? new URL(text, base) : new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function cleanText(value) {
  return normalizeSpace(decodeHtml(value));
}

function cleanSpecValue(value) {
  return cleanText(value).replace(/^#/, "");
}

function normalizeSpace(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function parseCurrency(value) {
  const normalized = String(value || "").replace(/[^\d.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableInteger(value) {
  const normalized = String(value || "").replace(/[^\d-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function requireAuth(req, res, next) {
  try {
    if (!authEnabled) {
      req.authUser = bootstrapAdminUser();
      next();
      return;
    }

    const user = await identifyRequestUser(req);
    if (user) {
      req.authUser = user;
      next();
      return;
    }

    if (req.path.startsWith("/api/")) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }

    res.redirect(302, "/login");
  } catch (error) {
    next(error);
  }
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, (error) => {
    if (error) {
      next(error);
      return;
    }
    if (req.authUser?.role === "admin") {
      next();
      return;
    }
    if (req.path.startsWith("/api/")) {
      res.status(403).json({ ok: false, error: "Admin access required." });
      return;
    }
    res.status(403).send(renderAuthPage({
      title: "Admin access required",
      heading: "Admin access required",
      body: '<p class="auth-note">Only a CarPostClub admin can manage users and invite links.</p><p class="auth-actions"><a href="/">Back to app</a></p>',
    }));
  });
}

async function identifyRequestUser(req) {
  if (!authEnabled) return bootstrapAdminUser();
  const session = readSignedSession(req);
  if (!session) return null;

  const username = normalizeAuthUsername(session.u);
  if (username === normalizeAuthUsername(authUsername)) {
    const admin = bootstrapAdminUser();
    if (isSessionInvalidatedByPasswordChange(session, admin)) return null;
    return admin;
  }

  const account = (await readAuthUsers()).users.find((user) => user.username === username);
  if (!account || account.status !== "approved") return null;
  if (isSessionInvalidatedByPasswordChange(session, account)) return null;
  return authUserFromAccount(account);
}

function loginRateLimitForRequest(req, usernameValue) {
  if (!loginRateLimitMaxAttempts || !loginRateLimitWindowMs) return { limited: false, retryAfterSeconds: 0 };
  pruneExpiredFailedLoginAttempts();

  const key = failedLoginRateLimitKey(req, usernameValue);
  const record = failedLoginAttempts.get(key);
  const now = Date.now();
  if (!record || record.resetAt <= now) {
    failedLoginAttempts.delete(key);
    return { limited: false, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
  return {
    limited: record.count >= loginRateLimitMaxAttempts,
    retryAfterSeconds,
  };
}

function recordFailedLogin(req, usernameValue) {
  if (!loginRateLimitMaxAttempts || !loginRateLimitWindowMs) return;
  const key = failedLoginRateLimitKey(req, usernameValue);
  const now = Date.now();
  const existing = failedLoginAttempts.get(key);
  const record = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + loginRateLimitWindowMs };
  record.count += 1;
  failedLoginAttempts.set(key, record);
}

function clearFailedLoginAttempts(req, usernameValue) {
  failedLoginAttempts.delete(failedLoginRateLimitKey(req, usernameValue));
}

function failedLoginRateLimitKey(req, usernameValue) {
  const username = normalizeAuthUsername(usernameValue) || "_unknown";
  const ip = normalizeSpace(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 80) || "unknown";
  return `${ip}:${username}`;
}

function pruneExpiredFailedLoginAttempts() {
  if (failedLoginAttempts.size < 1000) return;
  const now = Date.now();
  for (const [key, record] of failedLoginAttempts) {
    if (!record || record.resetAt <= now) failedLoginAttempts.delete(key);
  }
}

function readSignedSession(req) {
  const cookie = parseCookies(req.headers.cookie || "")[authCookieName];
  if (!cookie) return null;

  const [payload, signature] = String(cookie).split(".");
  if (!payload || !signature) return null;

  const expected = crypto.createHmac("sha256", authSessionSecret).update(payload).digest("base64url");
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Number(session?.exp || 0) <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

async function authenticateCredentials(usernameValue, password) {
  const username = normalizeAuthUsername(usernameValue);
  if (!username || !password) {
    return { ok: false, message: "Invalid username or password." };
  }

  if (username === normalizeAuthUsername(authUsername) && await verifyBootstrapPassword(password)) {
    return { ok: true, user: bootstrapAdminUser() };
  }

  const account = (await readAuthUsers()).users.find((user) => user.username === username);
  if (!account || !await bcrypt.compare(String(password), account.passwordHash)) {
    return { ok: false, message: "Invalid username or password." };
  }

  if (account.status === "pending") {
    return { ok: false, message: "This account is not active. Ask Konner for a current invite link." };
  }

  if (account.status === "rejected") {
    return { ok: false, message: "This account is not active." };
  }

  return { ok: true, user: authUserFromAccount(account) };
}

async function verifyBootstrapPassword(password) {
  if (authPasswordHash) return bcrypt.compare(password, authPasswordHash);
  return authPassword && timingSafeEqual(password, authPassword);
}

function serializeSessionCookie(user) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    u: user.username,
    role: user.role,
    pv: user.passwordVersion || "",
    iat: now,
    exp: now + authSessionMs,
  }), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", authSessionSecret).update(payload).digest("base64url");
  return [
    `${authCookieName}=${encodeURIComponent(`${payload}.${signature}`)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.round(authSessionMs / 1000)}`,
    authCookieSecure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function bootstrapAdminUser() {
  return {
    username: normalizeAuthUsername(authUsername) || "admin",
    displayName: normalizeDisplayName(authUsername) || "Admin",
    dealershipId: authBootstrapDealershipId,
    role: "admin",
    status: "approved",
    passwordVersion: bootstrapAdminPasswordVersion(),
    bootstrap: true,
  };
}

function bootstrapAdminPasswordVersion() {
  const source = authPasswordHash || authPassword;
  if (!source) return "";
  return crypto.createHmac("sha256", authSessionSecret)
    .update(`bootstrap-password:${source}`)
    .digest("base64url");
}

function authUserFromAccount(account) {
  return {
    username: account.username,
    displayName: account.displayName || account.username,
    dealershipId: normalizeAuthDealershipId(account.dealershipId),
    role: account.role === "admin" ? "admin" : "user",
    status: account.status,
    passwordVersion: account.passwordVersion || "",
    bootstrap: false,
  };
}

function publicAuthUser(user) {
  const dealership = publicAuthDealership(user?.dealershipId);
  return {
    username: user?.username || "",
    displayName: user?.displayName || user?.username || "",
    dealershipId: dealership?.id || "",
    dealershipLabel: dealership?.label || "",
    dealership,
    role: user?.role === "admin" ? "admin" : "user",
    status: user?.status || "approved",
  };
}

async function readAuthUsers() {
  const store = await readJson(authUsersPath, { users: [] });
  const rawUsers = Array.isArray(store) ? store : store.users;
  const users = Array.isArray(rawUsers)
    ? rawUsers.map(normalizeStoredAuthUser).filter(Boolean)
    : [];
  return { users };
}

async function updateAuthUsers(mutator) {
  authUsersWritePromise = authUsersWritePromise.catch(() => {}).then(async () => {
    const store = await readAuthUsers();
    const result = await mutator(store);
    store.users.sort((left, right) => left.username.localeCompare(right.username));
    await writeJson(authUsersPath, { users: store.users });
    return result;
  });
  return authUsersWritePromise;
}

async function readAuthInvites() {
  const store = await readJson(authInvitesPath, { invites: [] });
  const rawInvites = Array.isArray(store) ? store : store.invites;
  const invites = Array.isArray(rawInvites)
    ? rawInvites.map(normalizeStoredAuthInvite).filter(Boolean)
    : [];
  return { invites };
}

async function updateAuthInvites(mutator) {
  authInvitesWritePromise = authInvitesWritePromise.catch(() => {}).then(async () => {
    const store = await readAuthInvites();
    const result = await mutator(store);
    store.invites.sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
    await writeJson(authInvitesPath, { invites: store.invites });
    return result;
  });
  return authInvitesWritePromise;
}

async function createAuthInvite(user) {
  return updateAuthInvites((store) => {
    const now = new Date();
    const existingIds = new Set(store.invites.map((invite) => invite.id));
    let id = "";
    do {
      id = crypto.randomBytes(24).toString("base64url");
    } while (existingIds.has(id));

    const invite = {
      id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + authInviteLifetimeMs).toISOString(),
      createdBy: publicAuthUser(user),
      useCount: 0,
      lastUsedAt: "",
      acceptedUsers: [],
    };
    store.invites.unshift(invite);
    return invite;
  });
}

async function listAuthInvitesForAdmin() {
  const { invites } = await readAuthInvites();
  return invites.map((invite) => publicAuthInvite(invite));
}

async function authInviteForAdmin(value, req) {
  const token = normalizeAuthInviteToken(value);
  if (!token) return null;
  const invite = (await readAuthInvites()).invites.find((candidate) => candidate.id === token);
  return invite ? publicAuthInvite(invite, req) : null;
}

async function authInviteState(value) {
  const token = normalizeAuthInviteToken(value);
  if (!token) {
    return {
      status: "missing",
      token: "",
      invite: null,
      message: "Ask Konner for a current invite link. Invite links expire after 24 hours.",
    };
  }

  const invite = (await readAuthInvites()).invites.find((candidate) => candidate.id === token);
  if (!invite) {
    return {
      status: "invalid",
      token,
      invite: null,
      message: "This invite link is not valid. Ask Konner for a new invite link.",
    };
  }

  if (Date.parse(invite.expiresAt || "") <= Date.now()) {
    return {
      status: "expired",
      token,
      invite,
      message: "This invite link expired. Ask Konner for a new invite link.",
    };
  }

  return {
    status: "valid",
    token,
    invite,
    message: "",
  };
}

async function markAuthInviteUsed(inviteId, user) {
  const id = normalizeAuthInviteToken(inviteId);
  if (!id) return null;
  return updateAuthInvites((store) => {
    const invite = store.invites.find((candidate) => candidate.id === id);
    if (!invite) return null;
    const now = new Date().toISOString();
    invite.useCount = Math.max(0, Number(invite.useCount) || 0) + 1;
    invite.lastUsedAt = now;
    invite.acceptedUsers = Array.isArray(invite.acceptedUsers) ? invite.acceptedUsers : [];
    invite.acceptedUsers.unshift({
      username: user.username,
      displayName: user.displayName || user.username,
      dealership: publicAuthDealership(user.dealershipId),
      acceptedAt: now,
    });
    invite.acceptedUsers = invite.acceptedUsers.slice(0, 25);
    return invite;
  });
}

function normalizeStoredAuthInvite(value) {
  if (!value || typeof value !== "object") return null;
  const id = normalizeAuthInviteToken(value.id);
  const createdAt = normalizeIsoDate(value.createdAt);
  const expiresAt = normalizeIsoDate(value.expiresAt);
  if (!id || !expiresAt) return null;

  const acceptedUsers = Array.isArray(value.acceptedUsers)
    ? value.acceptedUsers.map((acceptedUser) => ({
      username: normalizeAuthUsername(acceptedUser?.username),
      displayName: normalizeDisplayName(acceptedUser?.displayName) || normalizeAuthUsername(acceptedUser?.username),
      dealership: publicAuthDealership(acceptedUser?.dealership?.id || acceptedUser?.dealershipId || acceptedUser?.dealership),
      acceptedAt: normalizeIsoDate(acceptedUser?.acceptedAt),
    })).filter((acceptedUser) => acceptedUser.username)
    : [];

  return {
    id,
    createdAt: createdAt || new Date(0).toISOString(),
    expiresAt,
    createdBy: publicAuthUser(value.createdBy || {}),
    useCount: Math.max(0, Number(value.useCount) || acceptedUsers.length || 0),
    lastUsedAt: normalizeIsoDate(value.lastUsedAt),
    acceptedUsers,
  };
}

function publicAuthInvite(invite, req = null) {
  const active = Date.parse(invite.expiresAt || "") > Date.now();
  return {
    id: invite.id,
    signupUrl: req ? authInviteSignupUrl(invite, req) : "",
    status: active ? "active" : "expired",
    active,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    createdBy: invite.createdBy || null,
    useCount: Math.max(0, Number(invite.useCount) || 0),
    lastUsedAt: invite.lastUsedAt || "",
    acceptedUsers: invite.acceptedUsers || [],
  };
}

function authInviteSignupUrl(invite, req) {
  return new URL(`/signup?invite=${encodeURIComponent(invite.id)}`, requestOrigin(req)).toString();
}

function requestOrigin(req) {
  return publicOrigin || requestHostOrigin(req);
}

function requestHostOrigin(req) {
  const host = req.get?.("host") || "127.0.0.1";
  const protocol = req.protocol || (authCookieSecure ? "https" : "http");
  return `${protocol}://${host}`;
}

function normalizePublicOrigin(value) {
  const text = normalizeSpace(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function normalizeAuthInviteToken(value) {
  const token = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{16,120}$/.test(token)) return token;
  return "";
}

async function setAuthUserStatus(usernameValue, status, actorUsername) {
  const username = normalizeAuthUsername(usernameValue);
  if (!["approved", "rejected"].includes(status)) throw httpError(400, "Invalid user status.");
  const updated = await updateAuthUsers((store) => {
    const user = store.users.find((candidate) => candidate.username === username);
    if (!user) return null;
    const now = new Date().toISOString();
    user.status = status;
    user.updatedAt = now;
    if (status === "approved") {
      user.approvedAt = now;
      user.approvedBy = actorUsername;
      delete user.rejectedAt;
      delete user.rejectedBy;
    } else {
      user.rejectedAt = now;
      user.rejectedBy = actorUsername;
      user.passwordVersion = newPasswordVersion();
      delete user.approvedAt;
      delete user.approvedBy;
    }
    return user;
  });
  if (!updated) throw httpError(404, "User not found.");
  if (status === "rejected") {
    await removePushSubscriptionsForUser(username);
  }
  return updated;
}

async function setStoredUserDealership(usernameValue, dealershipIdValue, actorUsername) {
  const username = normalizeAuthUsername(usernameValue);
  const dealershipId = normalizeAuthDealershipId(dealershipIdValue);
  if (!username || !dealershipId) return null;

  return updateAuthUsers((store) => {
    const user = store.users.find((candidate) => candidate.username === username);
    if (!user) return null;
    const now = new Date().toISOString();
    user.dealershipId = dealershipId;
    user.updatedAt = now;
    user.dealershipUpdatedAt = now;
    user.dealershipUpdatedBy = normalizeAuthUsername(actorUsername);
    return user;
  });
}

async function changeStoredUserPassword(usernameValue, currentPassword, newPassword) {
  const username = normalizeAuthUsername(usernameValue);
  const store = await readAuthUsers();
  const account = store.users.find((user) => user.username === username);
  if (!account || !await bcrypt.compare(String(currentPassword || ""), account.passwordHash)) return null;
  return setStoredUserPassword(username, newPassword, username);
}

async function setStoredUserPassword(usernameValue, password, actorUsername) {
  const username = normalizeAuthUsername(usernameValue);
  const passwordHash = await bcrypt.hash(String(password), 12);
  const now = new Date().toISOString();
  const updated = await updateAuthUsers((store) => {
    const user = store.users.find((candidate) => candidate.username === username);
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.passwordVersion = newPasswordVersion();
    user.updatedAt = now;
    user.passwordUpdatedAt = now;
    user.passwordUpdatedBy = normalizeAuthUsername(actorUsername);
    return user;
  });
  if (updated) {
    // Session cookies are versioned, but push endpoints are not. Clear them on password reset.
    await removePushSubscriptionsForUser(username);
  }
  return updated;
}

function isSessionInvalidatedByPasswordChange(session, account) {
  if (account.passwordVersion) {
    return session.pv !== account.passwordVersion;
  }

  const passwordUpdatedAt = Date.parse(account.passwordUpdatedAt || "");
  if (!Number.isFinite(passwordUpdatedAt)) return false;
  const issuedAt = Number(session.iat || 0);
  return !Number.isFinite(issuedAt) || issuedAt < passwordUpdatedAt;
}

function newPasswordVersion() {
  return crypto.randomBytes(16).toString("base64url");
}

function normalizeStoredAuthUser(value) {
  if (!value || typeof value !== "object") return null;
  const username = normalizeAuthUsername(value.username);
  const passwordHash = String(value.passwordHash || "");
  if (!username || !passwordHash) return null;
  const status = ["pending", "approved", "rejected"].includes(value.status) ? value.status : "pending";
  return {
    username,
    displayName: normalizeDisplayName(value.displayName) || username,
    dealershipId: normalizeAuthDealershipId(value.dealershipId || value.dealership?.id || value.dealership)
      || defaultAuthDealershipIdForUser({ username, displayName: value.displayName }),
    passwordHash,
    passwordVersion: normalizeSpace(value.passwordVersion).slice(0, 80),
    role: value.role === "admin" ? "admin" : "user",
    status,
    createdAt: normalizeIsoDate(value.createdAt),
    updatedAt: normalizeIsoDate(value.updatedAt),
    approvedAt: normalizeIsoDate(value.approvedAt),
    approvedBy: normalizeAuthUsername(value.approvedBy),
    rejectedAt: normalizeIsoDate(value.rejectedAt),
    rejectedBy: normalizeAuthUsername(value.rejectedBy),
    passwordUpdatedAt: normalizeIsoDate(value.passwordUpdatedAt),
    passwordUpdatedBy: normalizeAuthUsername(value.passwordUpdatedBy),
    dealershipUpdatedAt: normalizeIsoDate(value.dealershipUpdatedAt),
    dealershipUpdatedBy: normalizeAuthUsername(value.dealershipUpdatedBy),
  };
}

function validateSignup({ username, dealershipId, password, confirmPassword }) {
  if (!username || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    return "Use 3-40 letters, numbers, dots, dashes, or underscores.";
  }
  if (username === normalizeAuthUsername(authUsername)) {
    return "That username already exists.";
  }
  if (!normalizeAuthDealershipId(dealershipId)) {
    return "Choose Kia, GreenLight, GM, or Nissan.";
  }
  return validatePasswordFields({ password, confirmPassword });
}

function validatePasswordFields({ password, confirmPassword }) {
  if (String(password).length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (String(password).length > 200) {
    return "Password is too long.";
  }
  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }
  return "";
}

function normalizeAuthUsername(value) {
  return normalizeSpace(value).toLowerCase().slice(0, 40);
}

function normalizeDisplayName(value) {
  return normalizeSpace(value).slice(0, 40);
}

function normalizeAuthDealershipId(value) {
  const raw = normalizeSpace(value);
  if (!raw) return "";
  const lowered = raw.toLowerCase();
  const match = authDealershipOptions.find((dealership) => (
    dealership.id === raw
    || dealership.key === lowered
    || dealership.label.toLowerCase() === lowered
    || dealership.name.toLowerCase() === lowered
    || (["green light", "greenlight"].includes(lowered) && dealership.key === "greenlight")
  ));
  return match?.id || "";
}

function publicAuthDealership(value) {
  const id = normalizeAuthDealershipId(value);
  const dealership = authDealershipOptions.find((candidate) => candidate.id === id);
  if (!dealership) return null;
  return {
    id: dealership.id,
    key: dealership.key,
    label: dealership.label,
    name: dealership.name,
  };
}

function defaultAuthDealershipIdForUser(user) {
  const username = normalizeAuthUsername(user?.username);
  const displayName = normalizeDisplayName(user?.displayName).toLowerCase();
  if (username === "konner" || displayName === "konner") return "15";
  if (username === "mwebber2030" || displayName === "michael") return "18";
  return "";
}

function renderAuthDealershipSelectOptions(selectedValue, { includePlaceholder = false } = {}) {
  const selectedId = normalizeAuthDealershipId(selectedValue);
  const placeholder = includePlaceholder
    ? `<option value=""${selectedId ? "" : " selected"}>Choose dealership</option>`
    : "";
  return `${placeholder}${authDealershipOptions.map((dealership) => {
    const selected = dealership.id === selectedId ? " selected" : "";
    return `<option value="${escapeHtml(dealership.id)}"${selected}>${escapeHtml(dealership.label)}</option>`;
  }).join("")}`;
}

function normalizeIsoDate(value) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function parseCookies(header) {
  const cookies = {};
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionSecret() {
  const configured = configuredAuthSessionSecret();
  if (configured) return configured;
  return crypto.createHash("sha256").update(authPasswordHash || authPassword || "carpostclub").digest("hex");
}

function configuredAuthSessionSecret() {
  return process.env.CARPOSTCLUB_AUTH_SESSION_SECRET || process.env.KONNER_AUTH_SESSION_SECRET || process.env.AUTH_SESSION_SECRET || "";
}

function isPlaceholderSecret(value) {
  const normalized = normalizeSpace(value).toLowerCase();
  return normalized === "change-me-before-deploying"
    || normalized === "replace-with-a-long-random-string"
    || normalized === "changeme"
    || normalized === "password"
    || normalized === "admin";
}

function sendLoginPage(res, options = {}) {
  const { error = "", next = "", status = error ? 401 : 200 } = typeof options === "string" ? { error: options, next: "", status: 401 } : options;
  const nextInput = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : "";
  setPrivateNoStore(res);
  res.status(status).send(renderAuthPage({
    title: `${appName} Login`,
    heading: "Sign in",
    error,
    body: `<form method="post" action="/login" class="login-form">
      ${nextInput}
      <label>
        <span>Username</span>
        <input name="username" autocomplete="username" required>
      </label>
      <label>
        <span>Password</span>
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Sign in</button>
    </form>
    <p class="auth-note">Need a password reset? Ask an admin to set a temporary password.</p>
    <p class="auth-actions"><a href="/signup">Need an invite?</a></p>`,
  }));
}

function sendChangePasswordPage(res, { user, error = "", success = "" }) {
  const bootstrapNote = user?.bootstrap
    ? '<p class="auth-note">The bootstrap admin password is managed through the server environment, not this page.</p>'
    : "";
  setPrivateNoStore(res);
  res.status(error ? 400 : 200).send(renderAuthPage({
    title: `Change ${appName} Password`,
    heading: "Change password",
    error,
    success,
    body: `${bootstrapNote}
    <form method="post" action="/account/password" class="login-form">
      <label>
        <span>Current password</span>
        <input name="currentPassword" type="password" autocomplete="current-password" required ${user?.bootstrap ? "disabled" : ""}>
      </label>
      <label>
        <span>New password</span>
        <input name="password" type="password" autocomplete="new-password" minlength="8" required ${user?.bootstrap ? "disabled" : ""}>
      </label>
      <label>
        <span>Confirm new password</span>
        <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required ${user?.bootstrap ? "disabled" : ""}>
      </label>
      <button type="submit" ${user?.bootstrap ? "disabled" : ""}>Update password</button>
    </form>
    <p class="auth-actions"><a href="/">Back to app</a></p>`,
  }));
}

function sendSignupPage(res, { error = "", success = "", values = {}, invite = null, inviteToken = "", inviteMessage = "" } = {}) {
  const inviteActive = Boolean(invite && Date.parse(invite.expiresAt || "") > Date.now());
  const inviteHidden = inviteToken ? `<input type="hidden" name="invite" value="${escapeHtml(inviteToken)}">` : "";
  const inviteNote = success
    ? ""
    : inviteActive
      ? `<p class="auth-note">This invite expires ${escapeHtml(formatAuthDate(invite.expiresAt))}; anyone with the link can create an account before then.</p>`
      : `<p class="auth-note">${escapeHtml(inviteMessage || "Ask Konner for a current invite link. Invite links expire after 24 hours.")}</p>`;
  const form = inviteActive ? `<form method="post" action="/signup" class="login-form">
      ${inviteHidden}
      <label>
        <span>Name</span>
        <input name="displayName" autocomplete="name" value="${escapeHtml(values.displayName || "")}" required>
      </label>
      <label>
        <span>Username</span>
        <input name="username" autocomplete="username" value="${escapeHtml(values.username || "")}" required>
      </label>
      <label>
        <span>Dealership</span>
        <select name="dealershipId" required>
          ${renderAuthDealershipSelectOptions(values.dealershipId, { includePlaceholder: true })}
        </select>
      </label>
      <label>
        <span>Password</span>
        <input name="password" type="password" autocomplete="new-password" minlength="8" required>
      </label>
      <label>
        <span>Confirm password</span>
        <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required>
      </label>
      <button type="submit">Create account</button>
    </form>`
    : "";

  setPrivateNoStore(res);
  res.status(error ? 400 : 200).send(renderAuthPage({
    title: `Join ${appName}`,
    heading: "Join CarPostClub",
    error,
    success,
    body: `${inviteNote}
    ${form}
    <p class="auth-actions"><a href="/login">Back to sign in</a></p>`,
  }));
}

function sendAdminUsersPage(res, { currentUser, users, invites = [], generatedInvite = null, error = "", success = "" }) {
  const sortedUsers = [...users].sort((left, right) => {
    const statusOrder = { approved: 0, pending: 1, rejected: 2 };
    return (statusOrder[left.status] - statusOrder[right.status])
      || left.username.localeCompare(right.username);
  });
  const userRows = sortedUsers.length
    ? sortedUsers.map(renderAdminUserCard).join("")
    : '<p class="auth-note">No invited accounts yet.</p>';
  const inviteRows = invites.length
    ? invites.slice(0, 8).map(renderAuthInviteCard).join("")
    : '<p class="auth-note">No invite links generated yet.</p>';
  const bootstrapUser = bootstrapAdminUser();
  const bootstrapDealership = publicAuthDealership(bootstrapUser.dealershipId);

  setPrivateNoStore(res);
  res.send(renderAuthPage({
    title: `Manage ${appName} Users`,
    heading: "Users",
    wide: true,
    error,
    success,
    body: `<p class="auth-note">Signed in as ${escapeHtml(currentUser.displayName)}. Generate a 24-hour invite link and send it to the people who should join.</p>
    <section class="admin-user-card is-bootstrap">
      <div>
        <strong>Invite link</strong>
        <span>Anyone with the latest link can sign up for 24 hours.</span>
      </div>
      <form method="post" action="/admin/invites" data-invite-form>
        <button type="submit">Generate invite link</button>
      </form>
      <p class="admin-invite-copy-status" data-invite-copy-status role="status" aria-live="polite"></p>
    </section>
    ${generatedInvite ? renderGeneratedInvite(generatedInvite) : ""}
    <div class="admin-user-list">${inviteRows}</div>
    <section class="admin-user-card is-bootstrap">
      <div>
        <strong>${escapeHtml(bootstrapUser.displayName)}</strong>
        <span>${escapeHtml(bootstrapUser.username)} · admin · approved · ${escapeHtml(bootstrapDealership?.label || "No dealership")}</span>
      </div>
      <em>Bootstrap admin</em>
    </section>
    <p class="auth-note">Invited users are active immediately. Use deactivate if an account should no longer have access.</p>
    <div class="admin-user-list">${userRows}</div>
    <p class="auth-actions"><a href="/">Back to app</a></p>
    ${renderInviteClipboardScript()}`,
  }));
}

function renderAdminUserCard(user) {
  const approved = user.status === "approved";
  const rejected = user.status === "rejected";
  const dealership = publicAuthDealership(user.dealershipId);
  const statusText = `${user.role} · ${user.status} · ${dealership?.label || "No dealership"}`;
  const createdText = user.createdAt ? `Joined ${formatAuthDate(user.createdAt)}` : "Join date unknown";
  const reactivateDisabled = approved ? "disabled" : "";
  const deactivateDisabled = rejected ? "disabled" : "";
  return `<section class="admin-user-card">
    <div>
      <strong>${escapeHtml(user.displayName)}</strong>
      <span>${escapeHtml(user.username)} · ${escapeHtml(statusText)}</span>
      <small>${escapeHtml(createdText)}</small>
    </div>
    <div class="admin-user-actions">
      <form method="post" action="/admin/users/${encodeURIComponent(user.username)}/approve">
        <button type="submit" ${reactivateDisabled}>Reactivate</button>
      </form>
      <form method="post" action="/admin/users/${encodeURIComponent(user.username)}/reject">
        <button class="danger" type="submit" ${deactivateDisabled}>Deactivate</button>
      </form>
    </div>
    <form class="admin-dealership-form" method="post" action="/admin/users/${encodeURIComponent(user.username)}/dealership">
      <label>
        <span>Dealership</span>
        <select name="dealershipId" required>
          ${renderAuthDealershipSelectOptions(user.dealershipId, { includePlaceholder: true })}
        </select>
      </label>
      <button type="submit">Save dealership</button>
    </form>
    <form class="admin-password-form" method="post" action="/admin/users/${encodeURIComponent(user.username)}/password">
      <label>
        <span>Reset password</span>
        <input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="Temporary password" required>
      </label>
      <label>
        <span>Confirm</span>
        <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="Repeat password" required>
      </label>
      <button type="submit">Reset</button>
    </form>
  </section>`;
}

function renderGeneratedInvite(invite) {
  return `<section class="admin-user-card is-bootstrap">
    <div>
      <strong>New invite link</strong>
      <span>This link expires ${escapeHtml(formatAuthDate(invite.expiresAt))}</span>
    </div>
    <div class="admin-invite-link">
      <label>
        <span>Invite URL</span>
        <input value="${escapeHtml(invite.signupUrl)}" readonly onclick="this.select()" data-generated-invite-url>
      </label>
      <button type="button" data-copy-invite-button>Copy link</button>
      <p class="admin-invite-copy-status" data-invite-copy-status role="status" aria-live="polite"></p>
    </div>
  </section>`;
}

function renderInviteClipboardScript() {
  return `<script>
(() => {
  const form = document.querySelector("[data-invite-form]");
  const existingInput = document.querySelector("[data-generated-invite-url]");
  const copyButton = document.querySelector("[data-copy-invite-button]");
  const status = document.querySelector("[data-invite-copy-status]");

  function setCopyStatus(message, ok = true) {
    if (!status) return;
    status.textContent = message;
    status.dataset.copyStatus = ok ? "success" : "error";
  }

  async function writeClipboardText(text) {
    if (!text) return false;
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.append(textarea);

    const selection = document.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {}

    textarea.remove();
    if (range && selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return copied;
  }

  async function copyGeneratedInvite(text, { silent = false } = {}) {
    const copied = await writeClipboardText(text);
    if (!silent || copied) {
      setCopyStatus(copied ? "Invite link copied to clipboard." : "Clipboard copy blocked. Use Copy link.", copied);
    }
    return copied;
  }

  async function createInviteLink() {
    const response = await fetch(form.action, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "fetch",
      },
    });
    if (!response.ok) throw new Error("Invite request failed.");
    return response.json();
  }

  function prepareDeferredClipboardWrite(invitePromise) {
    if (!navigator.clipboard?.write || !window.ClipboardItem || !window.isSecureContext) return null;
    try {
      const clipboardItem = new ClipboardItem({
        "text/plain": invitePromise.then((data) => new Blob([data?.invite?.signupUrl || ""], { type: "text/plain" })),
      });
      return navigator.clipboard.write([clipboardItem]).then(() => true, () => false);
    } catch {
      return null;
    }
  }

  function redirectWithCopyStatus(url, copied) {
    if (!url) return;
    const next = new URL(url, window.location.origin);
    next.searchParams.set(
      copied ? "success" : "error",
      copied ? "Invite link created and copied to clipboard." : "Invite link created. Use Copy link to copy it.",
    );
    window.location.assign(next.toString());
  }

  if (copyButton && existingInput) {
    copyButton.addEventListener("click", () => {
      existingInput.select();
      copyGeneratedInvite(existingInput.value);
    });
  }

  if (existingInput?.value) {
    copyGeneratedInvite(existingInput.value, { silent: true });
  }

  if (!form || !window.fetch) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    setCopyStatus("Generating invite link...", true);

    try {
      const invitePromise = createInviteLink();
      const preparedClipboardWrite = prepareDeferredClipboardWrite(invitePromise);
      const data = await invitePromise;
      const inviteUrl = data?.invite?.signupUrl || "";
      const copied = preparedClipboardWrite
        ? await preparedClipboardWrite || await copyGeneratedInvite(inviteUrl)
        : await copyGeneratedInvite(inviteUrl);
      if (copied) setCopyStatus("Invite link copied to clipboard.", true);
      redirectWithCopyStatus(data?.redirect, copied);
    } catch {
      setCopyStatus("Could not generate the invite link. Try again.", false);
      if (button) button.disabled = false;
    }
  });
})();
</script>`;
}

function renderAuthInviteCard(invite) {
  const statusText = invite.active ? `Active until ${formatAuthDate(invite.expiresAt)}` : `Expired ${formatAuthDate(invite.expiresAt)}`;
  const createdBy = invite.createdBy?.displayName || invite.createdBy?.username || "admin";
  const usageText = `${invite.useCount} ${invite.useCount === 1 ? "signup" : "signups"}`;
  return `<section class="admin-user-card">
    <div>
      <strong>${escapeHtml(statusText)}</strong>
      <span>${escapeHtml(usageText)} · created by ${escapeHtml(createdBy)}</span>
      <small>${escapeHtml(invite.createdAt ? `Created ${formatAuthDate(invite.createdAt)}` : "Creation date unknown")}</small>
    </div>
    <em>${invite.active ? "Active invite" : "Expired"}</em>
  </section>`;
}

function renderAuthPage({ title, heading, body, error = "", success = "", wide = false }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#fafafa">
  <meta name="application-name" content="${escapeHtml(appName)}">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="${escapeHtml(appName)}">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="/favicon.png" type="image/png">
  <link rel="apple-touch-icon" href="/icons/carpostclub-apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="preload" as="image" href="/icons/carpostclub-icon-192.png">
  <link rel="stylesheet" href="/styles.css?v=20260625-hide-notification-settings-v79">
</head>
<body class="login-body">
  <main class="login-card${wide ? " is-wide" : ""}">
    <div class="auth-brand">
      <span class="brand-mark" aria-hidden="true">
        <img src="/icons/carpostclub-icon-192.png" alt="">
      </span>
      <div>
        <p class="eyebrow">${escapeHtml(appName)}</p>
        <h1>${escapeHtml(heading)}</h1>
      </div>
    </div>
    ${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}
    ${success ? `<p class="form-success">${escapeHtml(success)}</p>` : ""}
    ${body}
  </main>
</body>
</html>`;
}

function adminUsersUrl({ error = "", success = "", invite = "" } = {}) {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (success) params.set("success", success);
  if (invite) params.set("invite", invite);
  const query = params.toString();
  return query ? `/admin/users?${query}` : "/admin/users";
}

function requestWantsJson(req) {
  return /\bapplication\/json\b/i.test(req.get("accept") || "")
    || req.get("x-requested-with") === "fetch";
}

function flashMessage(value) {
  return normalizeSpace(value).slice(0, 160);
}

function formatAuthDate(value) {
  if (!Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Halifax",
  }).format(new Date(value));
}

async function readReleaseInfo() {
  const fallback = {
    releaseId: process.env.CARPOSTCLUB_RELEASE_ID || process.env.KONNER_RELEASE_ID || "dev",
    createdAt: null,
    source: "runtime",
  };

  try {
    const manifest = JSON.parse(await fs.readFile(releaseManifestPath, "utf8"));
    return {
      releaseId: manifest.releaseId || fallback.releaseId,
      createdAt: manifest.createdAt || null,
      source: manifest.source || "manifest",
      sourceCommit: normalizeSpace(manifest.sourceCommit).slice(0, 120) || undefined,
      fileCount: Array.isArray(manifest.files) ? manifest.files.length : undefined,
    };
  } catch {
    return fallback;
  }
}

function parseBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function parseBooleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function delay(ms) {
  const duration = Math.max(0, Number(ms) || 0);
  if (!duration) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function uploadLimitHttpError(error) {
  if (!isMulterError(error)) return error;

  if (error.code === "LIMIT_FILE_SIZE") {
    return httpError(413, `Each file must be ${formatBytes(maxFileBytes)} or smaller.`);
  }

  if (error.code === "LIMIT_FILE_COUNT") {
    return httpError(400, `Upload up to ${maxUploadFiles} ${maxUploadFiles === 1 ? "file" : "files"} at a time.`);
  }

  if (error.code === "LIMIT_UNEXPECTED_FILE") {
    return httpError(400, "Upload files with the media picker before submitting.");
  }

  return httpError(400, "Upload could not be processed. Check the selected files and try again.");
}

function isMulterError(error) {
  return error instanceof multer.MulterError || error?.name === "MulterError";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function setPrivateNoStore(res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
