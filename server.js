import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import express from "express";
import heicConvert from "heic-convert";
import multer from "multer";
import OpenAI from "openai";
import sharp from "sharp";
import webPush from "web-push";

const appRoot = fileURLToPath(new URL("./", import.meta.url));
const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
const appName = "CarPostClub";
const serviceName = "carpostclub";

dotenv.config({ path: path.join(appRoot, ".env"), quiet: true });
dotenv.config({ quiet: true });

const app = express();
const port = Number(process.env.PORT || 3911);
const host = process.env.HOST || "127.0.0.1";
const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || "/var/lib/carpostclub/uploads");
const tmpRoot = path.resolve(process.env.TMP_ROOT || "/var/lib/carpostclub/tmp");
const chatMessagesPath = path.resolve(process.env.CHAT_MESSAGES_PATH || path.join(path.dirname(uploadRoot), "chat-messages.json"));
const manualInventoryPath = path.resolve(process.env.MANUAL_INVENTORY_PATH || path.join(path.dirname(uploadRoot), "manual-inventory.json"));
const pushSubscriptionsPath = path.resolve(process.env.CARPOSTCLUB_PUSH_SUBSCRIPTIONS_PATH || process.env.KONNER_PUSH_SUBSCRIPTIONS_PATH || process.env.PUSH_SUBSCRIPTIONS_PATH || path.join(path.dirname(uploadRoot), "push-subscriptions.json"));
const pushVapidKeysPath = path.resolve(process.env.CARPOSTCLUB_PUSH_VAPID_KEYS_PATH || process.env.KONNER_PUSH_VAPID_KEYS_PATH || process.env.PUSH_VAPID_KEYS_PATH || path.join(path.dirname(uploadRoot), "push-vapid-keys.json"));
const releaseManifestPath = process.env.CARPOSTCLUB_RELEASE_MANIFEST || process.env.KONNER_RELEASE_MANIFEST || path.join(appRoot, "release-manifest.json");
const maxFileBytes = positiveInteger(process.env.MAX_FILE_BYTES, 250 * 1024 * 1024);
const maxUploadFiles = positiveInteger(process.env.MAX_UPLOAD_FILES, 100);
const chatMessageLimit = positiveInteger(process.env.CHAT_MESSAGE_LIMIT, 500);
const chatResponseLimit = Math.min(chatMessageLimit, positiveInteger(process.env.CHAT_RESPONSE_LIMIT, 100));
const chatMessageMaxLength = positiveInteger(process.env.CHAT_MESSAGE_MAX_LENGTH, 1000);
const marketplaceDescriptionModel = process.env.FACEBOOK_MARKETPLACE_DESCRIPTION_MODEL || "gpt-5-nano";
const marketplaceDescriptionFallbackModel = process.env.FACEBOOK_MARKETPLACE_DESCRIPTION_FALLBACK_MODEL || "gpt-4.1-nano";
const marketplaceDescriptionVariantCount = positiveInteger(process.env.FACEBOOK_MARKETPLACE_DESCRIPTION_VARIANT_COUNT, 6);
const marketplaceDescriptionPromptVersion = "facebook-marketplace-user-description-v1";
const marketplaceLocation = process.env.FACEBOOK_MARKETPLACE_LOCATION || "Halifax, Nova Scotia";
const marketplaceCleanTitleDefault = parseBooleanEnv("FACEBOOK_MARKETPLACE_CLEAN_TITLE_DEFAULT", true);
const marketplacePriceDisclosureFee = 499.95;
const marketplacePriceDisclosureHst = 14;
const marketplaceContactLine = "Message me for more details. If you're coming into the dealership, mention CarPostClub.";
const pushSubject = process.env.CARPOSTCLUB_PUSH_SUBJECT || process.env.KONNER_PUSH_SUBJECT || process.env.WEB_PUSH_SUBJECT || "mailto:hello@carpostclub.local";
const pushTtlSeconds = positiveInteger(process.env.CARPOSTCLUB_PUSH_TTL_SECONDS || process.env.KONNER_PUSH_TTL_SECONDS, 60 * 60);
const pushDeliveryDisabled = parseBooleanEnv("CARPOSTCLUB_PUSH_DELIVERY_DISABLED", parseBooleanEnv("KONNER_PUSH_DELIVERY_DISABLED", false));
const pushAwaitDelivery = parseBooleanEnv("CARPOSTCLUB_PUSH_AWAIT_DELIVERY", parseBooleanEnv("KONNER_PUSH_AWAIT_DELIVERY", process.env.NODE_ENV === "test"));
const authUsername = process.env.CARPOSTCLUB_AUTH_USERNAME || process.env.KONNER_AUTH_USERNAME || "admin";
const authPassword = process.env.CARPOSTCLUB_AUTH_PASSWORD || process.env.KONNER_AUTH_PASSWORD || "";
const authPasswordHash = process.env.CARPOSTCLUB_AUTH_PASSWORD_HASH || process.env.KONNER_AUTH_PASSWORD_HASH || "";
const authEnabled = Boolean(authPassword || authPasswordHash);
const authUsersPath = path.resolve(process.env.CARPOSTCLUB_AUTH_USERS_PATH || process.env.KONNER_AUTH_USERS_PATH || process.env.AUTH_USERS_PATH || path.join(path.dirname(uploadRoot), "auth-users.json"));
const authCookieName = process.env.CARPOSTCLUB_AUTH_COOKIE_NAME || process.env.KONNER_AUTH_COOKIE_NAME || "carpostclub_session";
const authCookieSecure = parseBooleanEnv("CARPOSTCLUB_AUTH_COOKIE_SECURE", parseBooleanEnv("KONNER_AUTH_COOKIE_SECURE", process.env.NODE_ENV === "production"));
const authSessionDays = positiveInteger(process.env.CARPOSTCLUB_AUTH_SESSION_DAYS || process.env.KONNER_AUTH_SESSION_DAYS, 365);
const authSessionMs = authSessionDays * 24 * 60 * 60 * 1000;
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
const legacyStorageDirectories = new Set(["optimized", "originals", "thumbnails", "tmp"]);
const oregansInventorySearchApiUrl = "https://oserv3.oreganscdn.com/api/vehicle-inventory-search/";
const oregansInventoryRegionId = "1";
const defaultInventoryTypeId = "2";
const inventoryCacheTtlMs = positiveInteger(process.env.OREGANS_INVENTORY_CACHE_TTL_MS, 5 * 60 * 1000);
const inventoryMockFile = process.env.OREGANS_INVENTORY_MOCK_FILE || "";
const inventoryTypes = Object.freeze([
  { id: "2", name: "Used vehicles" },
  { id: "1", name: "New vehicles" },
]);
const oregansDealerships = Object.freeze([
  { id: "1", name: "O'Regan's Mercedes-Benz" },
  { id: "2", name: "O'Regan's Green Light Used Car Centre Halifax" },
  { id: "3", name: "O'Regan's Infiniti/Nissan Halifax" },
  { id: "6", name: "O'Regan's Kia Dartmouth" },
  { id: "7", name: "O'Regan's Toyota Dartmouth" },
  { id: "8", name: "O'Regan's National Leasing" },
  { id: "9", name: "O'Regan's Toyota Halifax" },
  { id: "13", name: "O'Regan's Dartmouth Hyundai" },
  { id: "14", name: "O'Regan's Green Light Used Car Centre Dartmouth" },
  { id: "15", name: "O'Regan's Kia Halifax" },
  { id: "16", name: "O'Regan's Wholesale Direct Dartmouth" },
  { id: "17", name: "O'Regan's Nissan Dartmouth" },
  { id: "18", name: "O'Regan's Chevrolet Buick GMC Cadillac" },
  { id: "21", name: "O'Regan's Wholesale Direct Halifax" },
  { id: "28", name: "O'Regan's BMW/MINI" },
  { id: "31", name: "O'Regan's Volkswagen Halifax" },
  { id: "40", name: "O'Regan's Lexus" },
]);
const inventoryCache = new Map();
const chatClients = new Set();
const marketplaceCopyPromises = new Map();
const marketplaceCopyStoreWritePromises = new Map();
const photoMetadataWritePromises = new Map();
let chatWritePromise = Promise.resolve();
let authUsersWritePromise = Promise.resolve();
let manualInventoryWritePromise = Promise.resolve();
let pushSubscriptionsWritePromise = Promise.resolve();
let openaiClient = null;

await fs.mkdir(uploadRoot, { recursive: true });
await fs.mkdir(tmpRoot, { recursive: true });
await fs.mkdir(path.dirname(chatMessagesPath), { recursive: true });
await fs.mkdir(path.dirname(manualInventoryPath), { recursive: true });
await fs.mkdir(path.dirname(authUsersPath), { recursive: true });
await fs.mkdir(path.dirname(pushSubscriptionsPath), { recursive: true });
await fs.mkdir(path.dirname(pushVapidKeysPath), { recursive: true });

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

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  if (/\.(?:css|js|webmanifest)$/i.test(req.path)) {
    res.setHeader("Cache-Control", "no-cache");
  }
  next();
});
app.use(express.static(publicRoot, { index: false, maxAge: 0 }));

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: serviceName,
    mode: "photo-albums",
    port,
    release: releaseInfo,
    storage: {
      uploadRoot,
    },
    uptimeSeconds: Math.round(process.uptime()),
    shuttingDown: false,
    criticalOperationCount: 0,
    criticalOperations: [],
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
    if (!authEnabled || await identifyRequestUser(req)) {
      res.redirect("/");
      return;
    }
    sendLoginPage(res);
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

    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");
    const authResult = await authenticateCredentials(username, password);
    if (!authResult.ok) {
      sendLoginPage(res, authResult.message);
      return;
    }

    res.setHeader("Set-Cookie", serializeSessionCookie(authResult.user));
    res.redirect(303, "/");
  } catch (error) {
    next(error);
  }
});

app.get("/signup", (req, res) => {
  if (!authEnabled) {
    res.redirect("/");
    return;
  }
  sendSignupPage(res);
});

app.post("/signup", async (req, res, next) => {
  try {
    if (!authEnabled) {
      res.redirect("/");
      return;
    }

    const username = normalizeAuthUsername(req.body?.username);
    const displayName = normalizeDisplayName(req.body?.displayName) || username;
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const validationError = validateSignup({ username, password, confirmPassword });
    if (validationError) {
      sendSignupPage(res, { error: validationError, values: { username, displayName } });
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
        passwordHash,
        passwordVersion: newPasswordVersion(),
        role: "user",
        status: "pending",
        createdAt: now,
        updatedAt: now,
        passwordUpdatedAt: now,
        passwordUpdatedBy: username,
      };
      store.users.push(user);
      return user;
    });

    if (!createdUser) {
      sendSignupPage(res, { error: "That username already exists.", values: { username, displayName } });
      return;
    }

    sendSignupPage(res, {
      success: "Account request sent. A CarPostClub admin needs to approve it before you can sign in.",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const pushEndpoint = cleanOptionalPushEndpoint(req.body?.pushEndpoint);
    if (pushEndpoint) await removePushSubscription(pushEndpoint, req.authUser);
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

    res.setHeader("Set-Cookie", serializeSessionCookie(authUserFromAccount(changed)));
    sendChangePasswordPage(res, { user: req.authUser, success: "Password updated." });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/users", requireAdmin, async (req, res, next) => {
  try {
    sendAdminUsersPage(res, {
      currentUser: req.authUser,
      users: (await readAuthUsers()).users,
      error: flashMessage(req.query.error),
      success: flashMessage(req.query.success),
    });
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

    res.redirect(303, adminUsersUrl({ success: `Password reset for ${updated.displayName}.` }));
  } catch (error) {
    next(error);
  }
});

app.get("/", requireAuth, (_req, res) => {
  res.sendFile(path.join(publicRoot, "index.html"));
});

app.get("/inventory", requireAuth, (_req, res) => {
  res.redirect(302, "/");
});

app.get("/api/albums", requireAuth, async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      uploadRoot,
      albums: await listAlbums(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: publicAuthUser(req.authUser),
  });
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

app.get("/api/inventory/dealerships", requireAuth, (_req, res) => {
  res.json({
    ok: true,
    dealerships: oregansDealerships,
    inventoryTypes,
    defaultInventoryTypeId,
    sourceUrl: "https://www.oregans.com/inventory/",
  });
});

app.get("/api/inventory/cars", requireAuth, async (req, res, next) => {
  try {
    const dealership = cleanDealershipId(req.query.dealershipId);
    const inventoryTypeId = cleanInventoryTypeId(req.query.inventoryTypeId || defaultInventoryTypeId);
    const cars = await fetchInventoryCars({ dealershipId: dealership.id, inventoryTypeId });
    res.json({
      ok: true,
      dealership,
      inventoryTypeId,
      cars,
      count: cars.length,
    });
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
    const album = await ensureCarAlbum(car);
    const draft = await buildMarketplaceDraftForUser(car, req.authUser, { album });
    res.json({
      ok: true,
      album,
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
    const album = await ensureCarAlbum(car);
    const draft = await buildMarketplaceDraftForUser(car, req.authUser, { album, force: true });
    res.json({
      ok: true,
      album,
      car,
      draft,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/vehicle-album", requireAuth, async (req, res, next) => {
  try {
    const { car } = await resolveInventoryCar(req.query);
    const album = await ensureCarAlbum(car);
    res.json({
      ok: true,
      album,
      photos: await listAlbumPhotos(album.id),
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
    res.json({
      ok: true,
      album,
      photos: await listAlbumPhotos(albumId),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/albums/:albumId/download", requireAuth, downloadAlbumMedia);

app.post("/api/upload", requireAuth, upload.array("photos", maxUploadFiles), async (req, res, next) => {
  const files = Array.isArray(req.files) ? req.files : [];
  try {
    const { car } = await resolveInventoryCar(req.body);
    const album = await ensureCarAlbum(car);
    if (!files.length) throw httpError(400, "No media files were uploaded.");

    const saved = [];
    for (const file of files) {
      saved.push(await saveUploadedPhoto(album.id, file, req.authUser));
    }
    const marketplaceGeneration = await prepareMarketplaceDescriptionsForUpload(car, req.authUser, {
      album,
      uploadedMediaCount: saved.length,
    });
    const marketplaceDraft = await buildMarketplaceDraftForUser(car, req.authUser, { album });

    res.status(201).json({
      ok: true,
      album,
      albumId: album.id,
      car,
      count: saved.length,
      photos: saved,
      marketplaceGeneration,
      marketplaceDraft,
    });
    queuePushNotifications({
      excludeUsername: req.authUser.username,
      payload: uploadPushPayload(car, saved.length),
    });
  } catch (error) {
    await cleanupTempFiles(files);
    next(error);
  }
});

app.get("/api/albums/:albumId/media/:filename", requireAuth, serveAlbumMedia);
app.get("/api/albums/:albumId/photos/:filename", requireAuth, serveAlbumMedia);
app.get("/api/albums/:albumId/media/:filename/thumbnail", requireAuth, serveAlbumThumbnail);

app.delete("/api/albums/:albumId/media", requireAuth, deleteAlbumMediaCollection);
app.delete("/api/albums/:albumId/photos", requireAuth, deleteAlbumMediaCollection);
app.delete("/api/albums/:albumId/media/:filename", requireAuth, deleteAlbumMedia);
app.delete("/api/albums/:albumId/photos/:filename", requireAuth, deleteAlbumMedia);

async function serveAlbumMedia(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const filename = cleanFilename(req.params.filename);
    const filePath = photoPath(albumId, filename);
    const stats = await fs.stat(filePath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!stats?.isFile()) throw httpError(404, "Media not found.");

    const metadata = await readPhotoMetadata(albumId);
    const originalName = metadata[filename]?.originalName || filename;
    sendMediaFile(req, res, filePath, filename, stats, {
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
    const filePath = photoPath(albumId, filename);
    const stats = await fs.stat(filePath).catch((error) => {
      if (error?.code === "ENOENT") throw httpError(404, "Media not found.");
      throw error;
    });

    if (!isPhotoFilename(filename)) throw httpError(404, "Thumbnail not available.");

    const thumbnail = await ensureImageThumbnail(albumId, filename, filePath, stats).catch(() => null);
    if (!thumbnail) {
      sendMediaFile(req, res, filePath, filename, stats);
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
      archive.file(photoPath(albumId, photo.filename), {
        name: uniqueArchiveName(mediaDownloadName(photo.originalName, photo.filename), archiveNames),
      });
    }
    await archive.finalize();
  } catch (error) {
    next(error);
  }
}

async function deleteAlbumMedia(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const filename = cleanFilename(req.params.filename);
    await fs.unlink(photoPath(albumId, filename)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await fs.unlink(thumbnailPath(albumId, filename)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await updatePhotoMetadata(albumId, (metadata) => {
      delete metadata[filename];
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

async function deleteAlbumMediaCollection(req, res, next) {
  try {
    const albumId = cleanAlbumId(req.params.albumId);
    const album = await readAlbum(albumId);
    if (!album) throw httpError(404, "Album not found.");
    const photos = await listAlbumPhotos(albumId);
    await Promise.all(photos.map((photo) => fs.unlink(photoPath(albumId, photo.filename)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    })));
    await fs.rm(thumbnailDirectoryPath(albumId), { recursive: true, force: true });
    await updatePhotoMetadata(albumId, (metadata) => {
      for (const filename of Object.keys(metadata)) delete metadata[filename];
    });
    res.json({ ok: true, deleted: photos.length });
  } catch (error) {
    next(error);
  }
}

app.get("/api/chat/messages", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(200, chatMessageLimit, positiveInteger(req.query.limit, chatResponseLimit));
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      messages: (await readChatMessages()).slice(-limit),
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

app.post("/api/chat/messages", requireAuth, async (req, res, next) => {
  try {
    const message = await appendChatMessage(normalizeChatMessageText(req.body?.text), req.authUser);
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
    next(error);
  }
});

app.use((req, _res, next) => {
  next(httpError(404, `No route for ${req.method} ${req.path}`));
});

app.use(async (error, req, res, _next) => {
  if (Array.isArray(req.files)) await cleanupTempFiles(req.files);
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const message = safeStatus >= 500 ? "Unexpected server error." : String(error?.message || "Request failed.");
  if (safeStatus >= 500) console.error(error);
  res.status(safeStatus).json({ ok: false, error: message });
});

const server = app.listen(port, host, () => {
  console.log(`${appName} listening on ${host}:${port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 30_000).unref();
});

async function listAlbums() {
  const entries = await fs.readdir(uploadRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });

  const albums = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (legacyStorageDirectories.has(entry.name)) continue;
    const album = await readAlbum(entry.name);
    if (album?.vehicle) albums.push(album);
  }

  return albums.sort((left, right) => {
    const time = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (time) return time;
    return left.name.localeCompare(right.name);
  });
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
  const updatedAt = photos[0]?.uploadedAt || metadata.createdAt || stats.mtime.toISOString();
  const bytes = photos.reduce((total, photo) => total + photo.bytes, 0);
  const photoCount = photos.filter((photo) => photo.kind !== "video").length;
  const videoCount = photos.filter((photo) => photo.kind === "video").length;
  const cover = photos.find((photo) => photo.kind !== "video") || photos[0] || null;

  return {
    id: albumId,
    name: metadata.name || titleFromAlbumId(albumId),
    createdAt: metadata.createdAt || stats.birthtime.toISOString(),
    updatedAt,
    photoCount,
    videoCount,
    mediaCount: photos.length,
    bytes,
    coverUrl: cover?.url || null,
    dealership: metadata.dealership || null,
    vehicle: metadata.vehicle || null,
    inventoryTypeId: metadata.inventoryTypeId || null,
    sourceUrl: metadata.sourceUrl || metadata.vehicle?.detailUrl || null,
  };
}

async function ensureCarAlbum(car) {
  const albumId = carAlbumId(car);
  await migrateLegacyCarAlbum(car, albumId);
  const directory = albumPath(albumId);
  await fs.mkdir(directory, { recursive: true });
  const existing = await readAlbumMetadata(albumId);
  const createdAt = existing.createdAt || new Date().toISOString();
  await writeJson(path.join(directory, ".album.json"), {
    id: albumId,
    name: car.albumName,
    createdAt,
    updatedAt: new Date().toISOString(),
    dealership: car.dealership,
    inventoryTypeId: car.inventoryTypeId,
    sourceUrl: car.detailUrl,
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
      odometer: car.odometer,
      exteriorColor: car.exteriorColor,
      interiorColor: car.interiorColor,
      bodyStyle: car.bodyStyle,
      fuelType: car.fuelType,
      transmission: car.transmission,
      descriptionPreview: car.descriptionPreview,
      detailUrl: car.detailUrl,
      dealershipId: car.dealership.id,
      dealershipName: car.dealership.name,
    },
  });
  const photoMetadataPath = path.join(directory, ".photos.json");
  await fs.access(photoMetadataPath).catch(async (error) => {
    if (error?.code !== "ENOENT") throw error;
    await writeJson(photoMetadataPath, {});
  });
  return readAlbum(albumId);
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

async function fetchInventoryCars({ dealershipId, inventoryTypeId }) {
  const dealership = cleanDealershipId(dealershipId);
  inventoryTypeId = cleanInventoryTypeId(inventoryTypeId || defaultInventoryTypeId);

  if (inventoryMockFile) {
    return mergeManualInventoryCars(await fetchMockInventoryCars({ dealership, inventoryTypeId }), { dealership, inventoryTypeId });
  }

  const cacheKey = `${dealership.id}:${inventoryTypeId}`;
  const cached = inventoryCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < inventoryCacheTtlMs) {
    return mergeManualInventoryCars(cached.cars, { dealership, inventoryTypeId });
  }

  const limit = 100;
  const maxResults = 500;
  const cars = [];
  let totalResults = null;

  for (let offset = 0; offset < maxResults; offset += limit) {
    const searchUrl = new URL(oregansInventorySearchApiUrl);
    searchUrl.search = new URLSearchParams({
      "search.vehicle-inventory-type-ids.0": inventoryTypeId,
      "search.region-ids.0": oregansInventoryRegionId,
      "search.lot-location-ids.0": dealership.id,
      "search.sort-order": "newest",
      "do-search": "1",
      "search.results-offset": String(offset),
      "search.results-limit": String(limit),
    }).toString();

    const inventory = await fetchOregansJson(searchUrl);
    const results = inventory?.search?.results || [];
    totalResults = Number(inventory?.search?.stats?.totalResultsCount ?? results.length);
    cars.push(...results.map(parseInventoryResult).filter((car) => car.vin));
    if (!results.length || cars.length >= totalResults) break;
  }

  const normalized = cars.map((car) => normalizeInventoryCar(car, { dealership, inventoryTypeId }));
  inventoryCache.set(cacheKey, { fetchedAt: Date.now(), cars: normalized });
  return mergeManualInventoryCars(normalized, { dealership, inventoryTypeId });
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
    detailUrl: car.detailUrl || "",
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
  const fields = buildMarketplaceFields(car);
  const title = buildMarketplaceTitle(car);
  const fallbackDescription = buildMarketplaceDescription(car, fields, user);
  const generated = await getMarketplaceDescriptionForUser({
    car,
    fields,
    user,
    album: album || await ensureCarAlbum(car),
    fallbackDescription,
    force,
  });
  const description = generated.description
    ? finalizeMarketplaceBuyerDescription(generated.description, fields, car)
    : "";
  const missingFields = [
    ["Location", fields.location],
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
    copyText: description ? buildMarketplaceCopyText({ title, fields, description, car }) : "",
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
      photos: "Photos are shared for the selected car; description text is user-specific.",
    },
  };
}

function buildMarketplaceFields(car) {
  return {
    listingType: "Vehicle for sale",
    vehicleType: "Car/Truck",
    location: marketplaceLocation,
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

async function prepareMarketplaceDescriptionsForUpload(car, user, { album = null, uploadedMediaCount = 0 } = {}) {
  album = album || await ensureCarAlbum(car);
  const fields = buildMarketplaceFields(car);
  const targetUsers = await marketplaceAssignmentUsers(user);
  const targetCount = Math.max(marketplaceDescriptionVariantCount, targetUsers.length);
  const input = buildMarketplaceDescriptionPoolInput({ car, fields, count: targetCount });
  const inputHash = marketplaceDescriptionInputHash(car, fields);
  const copyPath = marketplaceCopyPath(album.id);
  const promiseKey = `upload:${album.id}:${inputHash}:${targetCount}`;

  if (marketplaceCopyPromises.has(promiseKey)) return marketplaceCopyPromises.get(promiseKey);

  const promise = (async () => {
    const existingStore = await readMarketplaceCopyStore(copyPath);
    if (isMarketplaceUploadPoolCurrent(existingStore, inputHash) && existingStore.variants.length >= targetCount) {
      const assigned = await assignMarketplaceDescriptionsToUsers(copyPath, targetUsers, inputHash);
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
        return buildMarketplaceTemplateVariants(car, fields, targetCount).map((description, index) => ({
          id: `variant-${index + 1}`,
          description,
          source: "template-upload",
          model: null,
          generatedAt: new Date().toISOString(),
          usage: null,
        }));
      });

    const generatedAt = new Date().toISOString();
    await writeJson(copyPath, {
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
    });

    const assigned = await assignMarketplaceDescriptionsToUsers(copyPath, targetUsers, inputHash);
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

  const inputHash = marketplaceDescriptionInputHash(car, fields);
  const copyPath = marketplaceCopyPath(album.id);
  const store = await readMarketplaceCopyStore(copyPath);
  if (!isMarketplaceUploadPoolCurrent(store, inputHash)) return { ...fallback, inputHash };

  const assigned = await assignMarketplaceDescriptionToUser(copyPath, user, inputHash, { force });
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
              `Write exactly ${count} different Facebook Marketplace vehicle descriptions from the supplied JSON facts.`,
              "Use only supplied facts. Do not invent warranty, financing, accident history, ownership history, inspection status, availability, accessories, or condition details.",
              "Each one should sound like a different real local person wrote it: specific, plain-spoken, helpful, and not like AI or a dealership brochure.",
              "Avoid emojis, hashtags, exclamation marks, generic hype, and phrases like 'look no further', 'turn heads', 'perfect blend', 'must-see', or 'don't miss out'.",
              "Keep all important factual information represented in every description, but vary sentence structure and word choice across the set.",
              "For each description, write 2 short paragraphs plus one final details line. Keep each one between 75 and 130 words.",
              "The final details line should include VIN, price, and mileage when available.",
              "Do not include stock number, inventory number, internal inventory ID, dealership stock code, contact line, or price-disclosure fee line.",
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
        const fallbackDescription = fallbackDescriptions[descriptions.length] || fallbackDescriptions[0] || "";
        const description = normalizeMarketplaceGeneratedDescription(value, fallbackDescription);
        const key = normalizeSearchToken(description);
        if (!description || seen.has(key)) continue;
        seen.add(key);
        descriptions.push(description);
        if (descriptions.length >= count) break;
      }
      for (const fallbackDescription of fallbackDescriptions) {
        if (descriptions.length >= count) break;
        const key = normalizeSearchToken(fallbackDescription);
        if (!fallbackDescription || seen.has(key)) continue;
        seen.add(key);
        descriptions.push(fallbackDescription);
      }
      if (!descriptions.length) throw new Error("Generated descriptions were empty.");
      return descriptions.slice(0, count).map((description, index) => ({
        id: `variant-${index + 1}`,
        description,
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
  const perDescription = /^gpt-5(?:\.|-|$)/i.test(model) ? 280 : 240;
  return Math.max(/^gpt-5(?:\.|-|$)/i.test(model) ? 900 : 420, count * perDescription);
}

function marketplaceDescriptionReasoningOptions(model) {
  if (/^gpt-5\.4(?:-|$)/i.test(model)) return { reasoning: { effort: "none" } };
  if (/^gpt-5(?:-|$)/i.test(model)) return { reasoning: { effort: "minimal" } };
  return {};
}

function marketplaceDescriptionInputHash(car, fields) {
  return hashJson(buildMarketplaceDescriptionFactsInput({ car, fields }));
}

function buildMarketplaceDescriptionPoolInput({ car, fields, count = marketplaceDescriptionVariantCount }) {
  const fallbackDescriptions = buildMarketplaceTemplateVariants(car, fields, count);
  return {
    ...buildMarketplaceDescriptionFactsInput({ car, fields }),
    requestedVariantCount: count,
    fallbackDescriptions,
  };
}

function buildMarketplaceDescriptionFactsInput({ car, fields }) {
  return {
    promptVersion: marketplaceDescriptionPromptVersion,
    location: marketplaceLocation,
    vehicle: {
      vin: car.vin,
      title: car.title,
      year: fields.year,
      make: fields.make,
      model: fields.model,
      trim: car.trim,
      price: fields.price,
      odometerKm: fields.mileage,
      bodyStyle: fields.bodyStyle,
      exteriorColor: fields.exteriorColor,
      interiorColor: fields.interiorColor,
      condition: fields.vehicleCondition,
      fuelType: fields.fuelType,
      transmission: fields.transmission,
      detailUrl: car.detailUrl,
    },
    inventoryCopy: {
      tagline: nullableString(car.tagline),
      descriptionPreview: nullableString(car.descriptionPreview),
      highlights: featureHighlights(car),
    },
  };
}

function buildMarketplaceTemplateVariants(car, fields, count) {
  const descriptions = [];
  const seen = new Set();
  for (let index = 0; descriptions.length < count && index < count * 4; index += 1) {
    const description = buildMarketplaceDescription(car, fields, null, `variant-${index}`);
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

function readMarketplaceCopyStore(filePath) {
  return readJson(filePath, { users: {} });
}

async function updateMarketplaceCopyStore(filePath, mutator) {
  const previous = marketplaceCopyStoreWritePromises.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const store = await readMarketplaceCopyStore(filePath);
    const result = await mutator(store);
    if (result?.write !== false) await writeJson(filePath, store);
    return result?.value;
  });
  const cleanup = next.finally(() => {
    if (marketplaceCopyStoreWritePromises.get(filePath) === cleanup) {
      marketplaceCopyStoreWritePromises.delete(filePath);
    }
  });
  marketplaceCopyStoreWritePromises.set(filePath, cleanup);
  return next;
}

function isMarketplaceUploadPoolCurrent(store, inputHash) {
  return store?.mode === "upload_pool"
    && store.promptVersion === marketplaceDescriptionPromptVersion
    && store.inputHash === inputHash
    && Array.isArray(store.variants)
    && store.variants.length > 0;
}

async function assignMarketplaceDescriptionsToUsers(copyPath, users, inputHash) {
  const assigned = [];
  for (const user of users) {
    const copy = await assignMarketplaceDescriptionToUser(copyPath, user, inputHash);
    if (copy) assigned.push(copy);
  }
  return assigned;
}

async function assignMarketplaceDescriptionToUser(copyPath, user, inputHash, { force = false } = {}) {
  const userKey = marketplaceUserKey(user);
  return updateMarketplaceCopyStore(copyPath, (store) => {
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
    const variant = force
      ? availableVariants.find((candidate) => candidate.id !== currentVariantId)
        || store.variants.find((candidate) => candidate.id !== currentVariantId)
        || store.variants.find((candidate) => candidate.id === currentVariantId)
      : store.variants.find((candidate) => candidate.id === currentVariantId)
        || availableVariants[0];
    if (!variant) return { write: false, value: null };

    store.assignments[userKey] = variant.id;
    const assignedAt = new Date().toISOString();
    const copy = {
      inputHash,
      model: variant.model || null,
      promptVersion: marketplaceDescriptionPromptVersion,
      variantId: variant.id,
      description: variant.description,
      generatedAt: variant.generatedAt || store.generatedAt || assignedAt,
      assignedAt,
      source: variant.source || "template-upload",
      usage: variant.usage || null,
    };
    store.users[userKey] = copy;
    return { value: marketplaceAssignedCopyResponse(copy, inputHash) };
  });
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

function marketplaceUserKey(user) {
  return normalizeAuthUsername(user?.username || authUsername || "admin") || "admin";
}

function buildMarketplaceTitle(car) {
  return [car.year, car.make, car.model].filter(Boolean).join(" ").trim() || car.title || "Vehicle for sale";
}

function buildMarketplaceDescription(car, fields, user, variantSeed = "") {
  const title = buildMarketplaceTitle(car);
  const lead = [
    title,
    car.trim && car.trim !== car.model ? car.trim : null,
  ].filter(Boolean).join(" - ");
  const openers = [
    `${lead} available in Halifax, Nova Scotia.`,
    `Posting this ${lead} in Halifax, Nova Scotia.`,
    `This ${lead} is available in Halifax, Nova Scotia.`,
    `${lead} ready for a closer look in Halifax, Nova Scotia.`,
    `Sharing the details on this ${lead} in Halifax, Nova Scotia.`,
    `Available now in Halifax, Nova Scotia: ${lead}.`,
    `Listing this ${lead} out of Halifax, Nova Scotia.`,
    `Here's the basic info for this ${lead} in Halifax, Nova Scotia.`,
  ];
  const openerIndex = marketplaceVariantIndex(variantSeed, openers.length, car.vin);
  const lines = [openers[openerIndex]];

  const facts = [
    car.odometer && `${car.odometer}`,
    car.exteriorColor && `${car.exteriorColor} exterior`,
    fields.interiorColor && fields.interiorColor !== "Other" && `${fields.interiorColor} interior`,
    fields.transmission && fields.transmission.replace(" transmission", ""),
    fields.fuelType,
  ].filter(Boolean);
  if (facts.length) lines.push(facts.join(" | "));

  const highlights = featureHighlights(car);
  if (highlights.length) lines.push(`Highlights: ${highlights.join(", ")}.`);

  const detailLine = [
    car.vin && `VIN ${car.vin}`,
    fields.price ? `Price $${fields.price.toLocaleString("en-CA")}` : car.price && `Price ${car.price}`,
    fields.mileage ? `Mileage ${fields.mileage.toLocaleString("en-CA")} km` : car.odometer && `Mileage ${car.odometer}`,
  ].filter(Boolean).join(" | ");
  if (detailLine) lines.push(detailLine);

  return finalizeMarketplaceBuyerDescription(lines.join("\n\n"), fields, car);
}

function marketplaceVariantIndex(variantSeed, count, salt = "") {
  const explicit = String(variantSeed || "").match(/variant-(\d+)/i);
  if (explicit) return Number(explicit[1]) % count;
  return Number.parseInt(hashJson(`${variantSeed}:${salt}`).slice(0, 2), 16) % count;
}

function buildMarketplaceCopyText({ title, fields, description, car }) {
  const rows = [
    ["Title", title],
    ["Vehicle type", fields.vehicleType],
    ["Location", fields.location],
    ["Year", fields.year],
    ["Make", fields.make],
    ["Model", fields.model],
    ["Mileage", fields.mileage ? `${fields.mileage} km` : null],
    ["Price", fields.price ? `$${fields.price.toLocaleString("en-CA")}` : car.price],
    ["Body style", fields.bodyStyle],
    ["Exterior color", fields.exteriorColor],
    ["Interior color", fields.interiorColor],
    ["Clean title", fields.cleanTitle === true ? "Yes" : "Needs review"],
    ["Vehicle condition", fields.vehicleCondition],
    ["Fuel type", fields.fuelType],
    ["Transmission", fields.transmission],
  ];
  return [
    ...rows.map(([label, value]) => `${label}: ${value || "Needs review"}`),
    "",
    "Description:",
    description,
  ].join("\n");
}

function finalizeMarketplaceBuyerDescription(description, fields, car = null) {
  return stripMarketplaceInventoryNumbers(
    appendMarketplaceContactLine(appendMarketplacePriceDisclosure(description, fields, car)),
    car,
  );
}

function appendMarketplacePriceDisclosure(description, fields, car = null) {
  const text = String(description || "").trim();
  const footer = buildMarketplacePriceDisclosure(fields, car);
  if (!text) return footer;
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const withoutDisclosure = paragraphs.filter((paragraph) => !hasMarketplacePriceDisclosure(paragraph));
  return [...withoutDisclosure, footer].join("\n\n");
}

function buildMarketplacePriceDisclosure(fields, car = null) {
  const rawPrice = fields?.price || parseCurrency(car?.price);
  const price = rawPrice ? `$${rawPrice.toLocaleString("en-CA")}` : car?.price || "Advertised price";
  return `Price: ${price} plus $${marketplacePriceDisclosureFee.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Tire Road Hazard, Documentation Fee, Security Etch, and ${marketplacePriceDisclosureHst}% HST.`;
}

function appendMarketplaceContactLine(description) {
  const text = String(description || "").trim();
  if (!text) return marketplaceContactLine;
  if (hasMarketplaceContactLine(text)) return text;
  const paragraphs = text.split(/\n{2,}/);
  const finalParagraph = paragraphs[paragraphs.length - 1] || "";
  if (hasMarketplacePriceDisclosure(finalParagraph)) {
    return [
      ...paragraphs.slice(0, -1),
      marketplaceContactLine,
      finalParagraph,
    ].join("\n\n").trim();
  }
  return `${text}\n\n${marketplaceContactLine}`;
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
  const text = String(description || "");
  return /\bmessage me for more details\b/i.test(text) && /\bCarPostClub\b/i.test(text);
}

function hasMarketplacePriceDisclosure(description) {
  return /\bTire Road Hazard\b/i.test(description)
    && /\bDocumentation fee\b/i.test(description)
    && /\bSecurity Etch\b/i.test(description)
    && /\b14%\s*HST\b/i.test(description);
}

function normalizeMarketplaceGeneratedDescription(value, fallbackDescription) {
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
  return text.slice(0, 1400);
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
  const model = normalizeSearchToken(car.model);
  const title = normalizeSearchToken([car.title, car.trim, car.tagline, car.bodyStyle].filter(Boolean).join(" "));
  if (title.includes("hatch")) return "Hatchback";
  if (["santa cruz"].includes(model)) return "Truck";
  if ([
    "seltos", "kona", "venue", "sportage", "telluride", "countryman", "envista",
    "kicks", "qashqai", "sorento", "tucson", "rogue", "cr-v", "crv",
  ].includes(model)) return "SUV";
  if (["corolla", "jetta", "forte", "elantra", "sentra", "civic"].includes(model)) return "Sedan";
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
    bodyStyle: cleanSpecValue(specs["Body Style"]),
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
    }));
  }

  return photos.sort((left, right) => new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime());
}

async function saveUploadedPhoto(albumId, file, user) {
  const directory = albumPath(albumId);
  const extension = extensionFor(file.originalname, file.mimetype);
  const baseName = sanitizeFilenameBase(path.basename(file.originalname, path.extname(file.originalname)));
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}-${baseName}${extension}`;
  const destination = path.join(directory, filename);

  await moveFile(file.path, destination);
  const stats = await fs.stat(destination);
  const uploadedAt = new Date().toISOString();
  const contentType = contentTypeFor(filename);
  const uploadedBy = publicUploader(user);
  await updatePhotoMetadata(albumId, (metadata) => {
    metadata[filename] = {
      originalName: file.originalname,
      contentType,
      bytes: stats.size,
      uploadedAt,
      uploadedBy,
    };
  });

  return photoResponse(albumId, filename, {
    originalName: file.originalname,
    contentType,
    bytes: stats.size,
    uploadedAt,
    uploadedBy,
  });
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

async function appendChatMessage(text, user) {
  const message = {
    id: `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    author: normalizeChatAuthor(user?.displayName || user?.username || authUsername),
    text,
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

function broadcastChatMessage(message) {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of [...chatClients]) {
    if (!writeChatEvent(client, payload)) {
      chatClients.delete(client);
    }
  }
}

function writeChatEvent(res, payload) {
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
  if (!text) return null;
  const createdAt = Number.isFinite(Date.parse(value.createdAt))
    ? new Date(value.createdAt).toISOString()
    : new Date().toISOString();
  return {
    id: normalizeSpace(value.id) || `${Date.parse(createdAt).toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    author: normalizeChatAuthor(value.author),
    text,
    createdAt,
  };
}

function normalizeChatMessageText(value) {
  const text = sanitizeChatMessageText(value);
  if (!text) throw httpError(400, "Enter a message before sending.");
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

async function sendPushNotifications({ payload, usernames = null, excludeUsername = "" }) {
  const usernameSet = usernames
    ? new Set(usernames.map(normalizeAuthUsername).filter(Boolean))
    : null;
  const excluded = normalizeAuthUsername(excludeUsername);
  const eligibleUsernames = await pushEligibleUsernames();
  const notificationPayload = JSON.stringify(cleanPushPayload(payload));
  const { subscriptions } = await readPushSubscriptions();
  const targets = subscriptions.filter((record) => {
    if (!eligibleUsernames.has(record.username)) return false;
    if (excluded && record.username === excluded) return false;
    if (usernameSet && !usernameSet.has(record.username)) return false;
    return true;
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
  return {
    requested: targets.length,
    delivered: results.filter((result) => result.status === "delivered").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    staleRemoved,
  };
}

async function pushEligibleUsernames() {
  const usernames = new Set([normalizeAuthUsername(authUsername) || "admin"]);
  if (!authEnabled) return usernames;
  const { users } = await readAuthUsers();
  for (const user of users) {
    if (user.status === "approved") usernames.add(user.username);
  }
  return usernames;
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
    body: message.text,
    tag: `carpostclub-chat-${messageId}`,
    url: "/?openChat=1",
  };
}

function uploadPushPayload(car, mediaCount) {
  const label = car?.stockNumber || car?.title || "a vehicle";
  return {
    title: "Media uploaded",
    body: `${mediaCount} ${mediaCount === 1 ? "file" : "files"} added for ${label}.`,
    tag: `carpostclub-upload-${carInventoryNotificationKey(car)}`,
    url: "/",
  };
}

function carInventoryNotificationKey(car) {
  return normalizeSpace(car?.inventoryKey || car?.vin || car?.stockNumber || "vehicle")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "vehicle";
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
  return {
    title: normalizeSpace(payload.title).slice(0, 80) || appName,
    body: sanitizeChatMessageText(payload.body, { truncate: true }).slice(0, 180) || `Open ${appName}.`,
    icon: cleanNotificationPath(payload.icon, "/icons/carpostclub-icon-192.png"),
    badge: cleanNotificationPath(payload.badge, "/icons/carpostclub-apple-touch-icon.png"),
    tag: normalizeSpace(payload.tag).slice(0, 80) || "carpostclub",
    url: cleanNotificationPath(payload.url, "/"),
    kind,
    messageId: normalizeSpace(payload.messageId).slice(0, 80),
    author: payload.author ? normalizeChatAuthor(payload.author) : "",
    timestamp,
  };
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
  return cleanVin(text);
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
  const mimeKind = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : "";
  const extensionKind = isVideoFilename(filename) ? "video" : isPhotoFilename(filename) ? "image" : "";
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
  return ".jpg";
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
  if (!value) return "";
  return new URL(value, "https://www.oregans.com").toString();
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
      res.status(403).json({ ok: false, error: "Admin approval required." });
      return;
    }
    res.status(403).send(renderAuthPage({
      title: "Admin access required",
      heading: "Admin access required",
      body: '<p class="auth-note">Only a CarPostClub admin can approve account requests.</p><p class="auth-actions"><a href="/">Back to app</a></p>',
    }));
  });
}

async function identifyRequestUser(req) {
  if (!authEnabled) return bootstrapAdminUser();
  const session = readSignedSession(req);
  if (!session) return null;

  const username = normalizeAuthUsername(session.u);
  if (username === normalizeAuthUsername(authUsername)) return bootstrapAdminUser();

  const account = (await readAuthUsers()).users.find((user) => user.username === username);
  if (!account || account.status !== "approved") return null;
  if (isSessionInvalidatedByPasswordChange(session, account)) return null;
  return authUserFromAccount(account);
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
    return { ok: false, message: "Your account is waiting for a CarPostClub admin to approve it." };
  }

  if (account.status === "rejected") {
    return { ok: false, message: "This account request was not approved." };
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
    role: "admin",
    status: "approved",
    bootstrap: true,
  };
}

function authUserFromAccount(account) {
  return {
    username: account.username,
    displayName: account.displayName || account.username,
    role: account.role === "admin" ? "admin" : "user",
    status: account.status,
    passwordVersion: account.passwordVersion || "",
    bootstrap: false,
  };
}

function publicAuthUser(user) {
  return {
    username: user?.username || "",
    displayName: user?.displayName || user?.username || "",
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
      delete user.approvedAt;
      delete user.approvedBy;
    }
    return user;
  });
  if (!updated) throw httpError(404, "User not found.");
  if (status === "rejected") await removePushSubscriptionsForUser(username);
  return updated;
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
    // Session cookies are versioned, but push endpoints are not. Clear them so old devices stop receiving notices.
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
  };
}

function validateSignup({ username, password, confirmPassword }) {
  if (!username || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    return "Use 3-40 letters, numbers, dots, dashes, or underscores.";
  }
  if (username === normalizeAuthUsername(authUsername)) {
    return "That username already exists.";
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
  const configured = process.env.CARPOSTCLUB_AUTH_SESSION_SECRET || process.env.KONNER_AUTH_SESSION_SECRET || process.env.AUTH_SESSION_SECRET;
  if (configured) return configured;
  return crypto.createHash("sha256").update(authPasswordHash || authPassword || "carpostclub").digest("hex");
}

function sendLoginPage(res, error = "") {
  res.status(error ? 401 : 200).send(renderAuthPage({
    title: `${appName} Login`,
    heading: "Sign in",
    error,
    body: `<form method="post" action="/login" class="login-form">
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
    <p class="auth-actions"><a href="/signup">Request access</a></p>`,
  }));
}

function sendChangePasswordPage(res, { user, error = "", success = "" }) {
  const bootstrapNote = user?.bootstrap
    ? '<p class="auth-note">The bootstrap admin password is managed through the server environment, not this page.</p>'
    : "";
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

function sendSignupPage(res, { error = "", success = "", values = {} } = {}) {
  res.status(error ? 400 : 200).send(renderAuthPage({
    title: `Request ${appName} Access`,
    heading: "Request access",
    error,
    success,
    body: `<form method="post" action="/signup" class="login-form">
      <label>
        <span>Name</span>
        <input name="displayName" autocomplete="name" value="${escapeHtml(values.displayName || "")}" required>
      </label>
      <label>
        <span>Username</span>
        <input name="username" autocomplete="username" value="${escapeHtml(values.username || "")}" required>
      </label>
      <label>
        <span>Password</span>
        <input name="password" type="password" autocomplete="new-password" minlength="8" required>
      </label>
      <label>
        <span>Confirm password</span>
        <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required>
      </label>
      <button type="submit">Send request</button>
    </form>
    <p class="auth-note">A CarPostClub admin must approve new accounts before they can open the app.</p>
    <p class="auth-actions"><a href="/login">Back to sign in</a></p>`,
  }));
}

function sendAdminUsersPage(res, { currentUser, users, error = "", success = "" }) {
  const sortedUsers = [...users].sort((left, right) => {
    const statusOrder = { pending: 0, approved: 1, rejected: 2 };
    return (statusOrder[left.status] - statusOrder[right.status])
      || left.username.localeCompare(right.username);
  });
  const userRows = sortedUsers.length
    ? sortedUsers.map(renderAdminUserCard).join("")
    : '<p class="auth-note">No account requests yet.</p>';

  res.send(renderAuthPage({
    title: `Manage ${appName} Users`,
    heading: "Users",
    wide: true,
    error,
    success,
    body: `<p class="auth-note">Signed in as ${escapeHtml(currentUser.displayName)}. The bootstrap admin approves new accounts here.</p>
    <section class="admin-user-card is-bootstrap">
      <div>
        <strong>${escapeHtml(bootstrapAdminUser().displayName)}</strong>
        <span>${escapeHtml(bootstrapAdminUser().username)} · admin · approved</span>
      </div>
      <em>Bootstrap admin</em>
    </section>
    <p class="auth-note">Use password reset to set a temporary password for a user. They can change it after signing in.</p>
    <div class="admin-user-list">${userRows}</div>
    <p class="auth-actions"><a href="/">Back to app</a></p>`,
  }));
}

function renderAdminUserCard(user) {
  const approved = user.status === "approved";
  const rejected = user.status === "rejected";
  const statusText = `${user.role} · ${user.status}`;
  const createdText = user.createdAt ? `Requested ${formatAuthDate(user.createdAt)}` : "Request date unknown";
  return `<section class="admin-user-card">
    <div>
      <strong>${escapeHtml(user.displayName)}</strong>
      <span>${escapeHtml(user.username)} · ${escapeHtml(statusText)}</span>
      <small>${escapeHtml(createdText)}</small>
    </div>
    <div class="admin-user-actions">
      <form method="post" action="/admin/users/${encodeURIComponent(user.username)}/approve">
        <button type="submit" ${approved ? "disabled" : ""}>Approve</button>
      </form>
      <form method="post" action="/admin/users/${encodeURIComponent(user.username)}/reject">
        <button class="danger" type="submit" ${rejected ? "disabled" : ""}>Reject</button>
      </form>
    </div>
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
  <link rel="stylesheet" href="/styles.css?v=20260530-auth-pwa">
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

function adminUsersUrl({ error = "", success = "" } = {}) {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (success) params.set("success", success);
  const query = params.toString();
  return query ? `/admin/users?${query}` : "/admin/users";
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

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
