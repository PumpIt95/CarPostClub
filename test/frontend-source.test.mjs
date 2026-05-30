import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";

const appJsPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
const iconsRoot = fileURLToPath(new URL("../public/icons/", import.meta.url));
const indexHtmlPath = fileURLToPath(new URL("../public/index.html", import.meta.url));
const manifestPath = fileURLToPath(new URL("../public/manifest.webmanifest", import.meta.url));
const offlineHtmlPath = fileURLToPath(new URL("../public/offline.html", import.meta.url));
const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));
const serviceWorkerPath = fileURLToPath(new URL("../public/sw.js", import.meta.url));
const smokeTestPath = fileURLToPath(new URL("../scripts/smoke_test.mjs", import.meta.url));
const shareCardPath = fileURLToPath(new URL("../public/share-card.png", import.meta.url));
const faviconPath = fileURLToPath(new URL("../public/favicon.png", import.meta.url));
const generatedIconPath = fileURLToPath(new URL("../public/icons/app-icon-ai.png", import.meta.url));

test("home page gates uploads behind inventory car selection", async () => {
  const html = await fs.readFile(indexHtmlPath, "utf8");

  assert.match(html, /<title>CarPostClub<\/title>/);
  assert.match(html, /meta name="application-name" content="CarPostClub"/);
  assert.match(html, /property="og:image" content="\/share-card\.png"/);
  assert.match(html, /rel="icon" href="\/favicon\.png" type="image\/png"/);
  assert.match(html, /\/icons\/carpostclub-icon-192\.png/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /CarPostClub \/ Media/);
  assert.match(html, /id="inventoryTypeSelect"/);
  assert.match(html, /id="dealershipSelect"/);
  assert.match(html, /id="makeFilterSelect"/);
  assert.match(html, /id="modelFilterSelect"/);
  assert.match(html, /Choose a make/);
  assert.match(html, /All models/);
  assert.match(html, /id="carSearchInput"/);
  assert.match(html, /Search stock, make, model/);
  assert.match(html, /id="carSelect"/);
  assert.match(html, /id="addManualCarButton"/);
  assert.match(html, /id="oregansSourceButton"/);
  assert.match(html, /Already listed/);
  assert.match(html, /Not listed yet/);
  assert.match(html, /Enter full details/);
  assert.match(html, /id="manualCarForm"/);
  assert.match(html, /id="manualStockNumber"/);
  assert.match(html, /id="manualYear"/);
  assert.match(html, /id="manualPrice"/);
  assert.match(html, /id="manualOdometer"/);
  assert.match(html, /id="dropZone"[^>]*disabled/);
  assert.match(html, /id="chatToggle"/);
  assert.match(html, /id="chatPanel"/);
  assert.match(html, /id="chatPanel"[^>]*aria-hidden="true"[^>]*hidden/);
  assert.match(html, /id="chatForm"/);
  assert.match(html, /Back to dashboard/);
  assert.match(html, /O'Regan's inventory/);
  assert.match(html, /id="videoButton"/);
  assert.match(html, /id="downloadAllButton"/);
  assert.match(html, /id="deleteAllButton"/);
  assert.match(html, /id="logoutForm"/);
  assert.match(html, /id="installButton"/);
  assert.match(html, /id="notificationButton"/);
  assert.match(html, /Open Inventory on oregans\.com/);
  assert.match(html, /href="\/account\/password"/);
  assert.match(html, /Change password/);
  assert.match(html, /id="marketplacePanel"/);
  assert.match(html, /id="marketplaceDescription"/);
  assert.match(html, /id="marketplaceRegenerateButton"/);
  assert.match(html, /Refresh Marketplace draft/);
  assert.match(html, /id="marketplaceCopyButton"/);
  assert.match(html, /data-action="download"/);
  assert.match(html, /data-action="delete"/);
  assert.match(html, /class="media-uploader"/);
  assert.match(html, /accept="image\/\*,video\/\*/);
  assert.match(html, /id="cameraInput"[^>]*accept="image\/\*,\.heic,\.heif"/);
  assert.match(html, /accept="video\/\*/);
  assert.match(html, /id="uploadProgressShell"/);
  assert.match(html, /id="uploadRecovery"/);
  assert.match(html, /id="retryUploadButton"/);
  assert.match(html, /id="clearUploadButton"/);
  assert.match(html, /class="upload-monkey"/);
  assert.match(html, /class="progress-confetti"/);
  assert.match(html, /id="galleryToggleButton"/);
  assert.match(html, /id="gallerySummary"/);
  assert.match(html, /\/app\.js\?v=20260530-auth-pwa/);
  assert.match(html, /\/styles\.css\?v=20260530-auth-pwa/);
  assert.doesNotMatch(html, /Konner Photos/);
  assert.doesNotMatch(html, /id="albumName"/);
});

test("frontend sends dealership, inventory filter, and vin with uploads", async () => {
  const source = await fs.readFile(appJsPath, "utf8");

  assert.match(source, /\/api\/inventory\/dealerships/);
  assert.match(source, /\/api\/inventory\/cars/);
  assert.match(source, /\/api\/manual-inventory\/cars/);
  assert.match(source, /oregansSourceButton/);
  assert.match(source, /pickerSubhead/);
  assert.match(source, /is-manual-mode/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /Enter the vehicle details before uploading media/);
  assert.match(source, /\/api\/vehicle-album/);
  assert.match(source, /\/api\/marketplace-draft/);
  assert.match(source, /regenerateMarketplaceDraft/);
  assert.match(source, /requestMarketplaceDraft/);
  assert.match(source, /\/api\/marketplace-draft\/regenerate/);
  assert.match(source, /Marketplace draft refreshed/);
  assert.match(source, /els\.carSelect\.addEventListener\("change"/);
  assert.match(source, /inventoryKey/);
  assert.match(source, /carRequestPayload/);
  assert.match(source, /finally \{\n    if \(state\.marketplaceRequestId === requestId\) \{/);
  assert.match(source, /state\.marketplaceLoading = false;\n      renderMarketplaceDraft\(\);/);
  assert.match(source, /filteredCars/);
  assert.match(source, /carSearchText/);
  assert.match(source, /carpostclub\.carSearch/);
  assert.match(source, /safeStorageGet\("carpostclub\.selectedDealershipId", "15"\)/);
  assert.match(source, /safeStorageSet\("carpostclub\.carSearch", state\.carSearch\)/);
  assert.match(source, /safeStorageRemove\("carpostclub\.selectedVin"\)/);
  assert.match(source, /Storage can be unavailable in restricted\/private browser modes/);
  const stateInitializer = source.slice(source.indexOf("const state = {"), source.indexOf("const hapticPatterns"));
  const persistSelectionBlock = source.slice(source.indexOf("function persistSelection"), source.indexOf("function safeStorageGet"));
  assert.doesNotMatch(stateInitializer, /localStorage/);
  assert.doesNotMatch(persistSelectionBlock, /localStorage/);
  assert.doesNotMatch(source, /Konner Photos/);
  assert.match(source, /selectedMake/);
  assert.match(source, /selectedModel/);
  assert.match(source, /renderVehicleFilterOptions/);
  assert.match(source, /Choose a make first/);
  assert.match(source, /els\.videoButton\.addEventListener\("click"/);
  assert.match(source, /heic\|heif/);
  assert.match(source, /isVideoMedia/);
  assert.match(source, /video\.preload = "metadata"/);
  assert.match(source, /els\.dropZone\.disabled = !unlocked/);
  assert.match(source, /\/api\/chat\/messages/);
  assert.match(source, /\/api\/chat\/stream/);
  assert.match(source, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(source, /beforeinstallprompt/);
  assert.match(source, /Notification\.requestPermission/);
  assert.match(source, /pushManager\.subscribe/);
  assert.match(source, /\/api\/push\/config/);
  assert.match(source, /\/api\/push\/subscriptions/);
  assert.match(source, /\/api\/push\/test/);
  assert.match(source, /handleLogoutSubmit/);
  assert.match(source, /currentPushSubscription/);
  assert.match(source, /pushEndpoint/);
  assert.match(source, /subscription\.unsubscribe/);
  assert.match(source, /HTMLFormElement\.prototype\.submit\.call/);
  assert.match(source, /addEventListener\("pagehide", disconnectChatStream\)/);
  assert.match(source, /addEventListener\("pageshow", handlePageShow\)/);
  assert.match(source, /function disconnectChatStream\(\)/);
  assert.match(source, /function resumeChatStream\(\)/);
  assert.match(source, /loadChatMessages\(\{ countUnread: true \}\)/);
  assert.match(source, /window\.setTimeout\(resumeChatStream, 3000\)/);
  assert.match(source, /const previousChatIds = new Set/);
  assert.match(source, /countUnread && !state\.chatOpen/);
  assert.match(source, /state\.chatUnread \+= missedUnread/);
  assert.match(source, /function handlePageShow\(event\)/);
  assert.match(source, /event\.persisted/);
  assert.match(source, /function validateActiveSession/);
  assert.match(source, /state\.lastSessionCheckAt/);
  assert.match(source, /state\.sessionCheckPromise/);
  assert.match(source, /state\.chatEventSource = null/);
  assert.match(source, /if \(!document\.hidden\) handlePageVisible\(\)/);
  assert.match(source, /openChat/);
  assert.match(source, /popstate/);
  assert.match(source, /syncChatUrl/);
  assert.match(source, /history\.pushState/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /new EventSource/);
  assert.match(source, /classList\.toggle\("is-open", state\.chatOpen\)/);
  assert.match(source, /chat-view-active/);
  assert.match(source, /setAttribute\("aria-hidden", String\(!state\.chatOpen\)\)/);
  assert.match(source, /chatColorForAuthor/);
  assert.match(source, /chatIdentityKey/);
  assert.match(source, /authorUsername/);
  assert.match(source, /authorDisplayName/);
  assert.match(source, /--chat-user-color/);
  assert.match(source, /isOwnChatMessage/);
  assert.match(source, /classList\.toggle\("is-own"/);
  assert.match(source, /uploadProgressShell/);
  assert.match(source, /classList\.toggle\("is-uploading", state\.uploading\)/);
  assert.match(source, /triggerUploadConfetti/);
  assert.match(source, /is-celebrating/);
  assert.match(source, /Upload already in progress/);
  assert.match(source, /Select a car before uploading media/);
  assert.match(source, /Only photos and videos can be uploaded/);
  assert.match(source, /const uploadTimeoutMs = 20 \* 60 \* 1000/);
  assert.match(source, /request\.timeout = uploadTimeoutMs/);
  assert.match(source, /reject\(new Error\("Authentication required\."\)\)/);
  assert.match(source, /addEventListener\("timeout"/);
  assert.match(source, /Upload timed out\. Check your connection and try again\./);
  assert.match(source, /Skipped \$\{skippedCount\} unsupported/);
  assert.match(source, /beforeunload/);
  assert.match(source, /failedUploadFiles/);
  assert.match(source, /retryUploadButton/);
  assert.match(source, /clearUploadButton/);
  assert.match(source, /thumbnailUrl/);
  assert.match(source, /loading = "lazy"/);
  assert.match(source, /media-uploader-badge/);
  assert.match(source, /photoUploaderLabel/);
  assert.match(source, /Uploaded by \$\{photoUploaderLabel\(photo\)\}/);
  assert.match(source, /galleryExpanded/);
  assert.match(source, /galleryToggleButton/);
  assert.match(source, /downloadAllButton/);
  assert.match(source, /downloadName/);
  assert.match(source, /deleteAllPhotos/);
  assert.match(source, /renderMarketplaceDraft/);
  assert.match(source, /copyMarketplaceDraft/);
  assert.match(source, /copyTextToClipboard/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /document\.execCommand\?\.\("copy"\)/);
  assert.match(source, /selection-based copy path/);
  assert.match(source, /Saving media and generating Marketplace copy/);
  assert.match(source, /\/api\/albums\/\$\{encodeURIComponent\(state\.activeAlbum\.id\)\}\/download/);
  assert.match(source, /Are you sure you want to delete/);
  assert.match(source, /Are you sure you want to sign out/);
  assert.doesNotMatch(source, /form\.append\("albumId"/);
});

test("pwa manifest and service worker expose install, offline, and push features", async () => {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const offlineHtml = await fs.readFile(offlineHtmlPath, "utf8");
  const serviceWorker = await fs.readFile(serviceWorkerPath, "utf8");

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.name, "CarPostClub");
  assert.equal(manifest.short_name, "CarPostClub");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose.includes("maskable")));
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/carpostclub-icon-192.png"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/favicon.png" && icon.type === "image/png"));
  assert.ok(manifest.screenshots.some((screenshot) => screenshot.src === "/share-card.png"));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url.includes("openChat=1")));
  assert.match(offlineHtml, /CarPostClub Offline/);
  assert.doesNotMatch(offlineHtml, /Konner Photos/);
  assert.match(offlineHtml, /Try again/);
  assert.match(serviceWorker, /carpostclub-pwa-v13/);
  assert.match(serviceWorker, /CarPostClub/);
  assert.match(serviceWorker, /carpostclub-icon-192\.png/);
  assert.doesNotMatch(serviceWorker, /Konner Photos/);
  assert.match(serviceWorker, /self\.addEventListener\("fetch"/);
  assert.match(serviceWorker, /networkFirstNavigation/);
  assert.match(serviceWorker, /staleWhileRevalidate/);
  assert.match(serviceWorker, /networkFirstVersionedStaticAsset/);
  assert.match(serviceWorker, /url\.search && isStaticAsset\(url\.pathname\)/);
  assert.match(serviceWorker, /cache\.put\(pathname, networkResponse\.clone\(\)\)/);
  assert.match(serviceWorker, /cachedStaticResponse/);
  assert.match(serviceWorker, /cache\.match\(url\.pathname\)/);
  assert.match(serviceWorker, /self\.registration\.showNotification/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(serviceWorker, /notificationActions/);
  assert.match(serviceWorker, /messageId/);
  assert.match(serviceWorker, /Open chat/);
});

test("service worker offline fallback handles page navigations but not API requests", async () => {
  const serviceWorker = await fs.readFile(serviceWorkerPath, "utf8");
  const handlers = new Map();
  const offlineResponse = { status: 200, marker: "offline-fallback" };
  const context = {
    URL,
    console,
    fetch: async () => {
      throw new Error("offline");
    },
    caches: {
      keys: async () => [],
      delete: async () => true,
      match: async (key) => key === "/offline.html" ? offlineResponse : null,
      open: async () => ({
        addAll: async () => {},
        match: async () => null,
        put: async () => {},
      }),
    },
    Response: {
      error: () => ({ status: 0, marker: "response-error" }),
    },
    self: {
      location: { origin: "https://carpostclub.test" },
      addEventListener: (type, handler) => {
        handlers.set(type, handler);
      },
      clients: {
        claim: async () => {},
        matchAll: async () => [],
        openWindow: async () => null,
      },
      registration: {
        showNotification: async () => {},
      },
      skipWaiting: async () => {},
    },
  };
  vm.runInNewContext(serviceWorker, context);

  const fetchHandler = handlers.get("fetch");
  assert.equal(typeof fetchHandler, "function");

  const loginNavigation = fetchEventFor("https://carpostclub.test/login", "navigate");
  fetchHandler(loginNavigation);
  assert.equal(loginNavigation.responded, true);
  assert.equal(await loginNavigation.response, offlineResponse);

  const accountNavigation = fetchEventFor("https://carpostclub.test/account/password", "navigate");
  fetchHandler(accountNavigation);
  assert.equal(accountNavigation.responded, true);
  assert.equal(await accountNavigation.response, offlineResponse);

  const apiRequest = fetchEventFor("https://carpostclub.test/api/me", "same-origin");
  fetchHandler(apiRequest);
  assert.equal(apiRequest.responded, false);
});

test("brand assets include favicon, PWA icons, and social share image", async () => {
  const generatedIcon = await sharp(generatedIconPath).metadata();
  const favicon = await sharp(faviconPath).metadata();
  const icon192 = await sharp(`${iconsRoot}/carpostclub-icon-192.png`).metadata();
  const icon512 = await sharp(`${iconsRoot}/carpostclub-icon-512.png`).metadata();
  const icon1024 = await sharp(`${iconsRoot}/carpostclub-icon-1024.png`).metadata();
  const appleTouchIcon = await sharp(`${iconsRoot}/carpostclub-apple-touch-icon.png`).metadata();
  const shareCard = await sharp(shareCardPath).metadata();

  assert.ok(generatedIcon.width >= 1024);
  assert.ok(generatedIcon.height >= 1024);
  assert.equal(favicon.width, 128);
  assert.equal(favicon.height, 128);
  assert.equal(icon192.width, 192);
  assert.equal(icon192.height, 192);
  assert.equal(icon512.width, 512);
  assert.equal(icon512.height, 512);
  assert.equal(icon1024.width, 1024);
  assert.equal(icon1024.height, 1024);
  assert.equal(appleTouchIcon.width, 180);
  assert.equal(appleTouchIcon.height, 180);
  assert.equal(shareCard.width, 1200);
  assert.equal(shareCard.height, 630);
});

test("mobile chat view and chat messages have distinct author accents", async () => {
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");
  const source = await fs.readFile(appJsPath, "utf8");

  assert.match(styles, /body\.chat-view-active/);
  assert.match(styles, /\.brand-mark\s*\{[^}]*aspect-ratio: 1;/s);
  assert.match(styles, /\.brand-mark\s*\{[^}]*height: 64px;/s);
  assert.match(styles, /\.brand-mark img\s*\{[^}]*object-fit: contain;/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.brand-mark\s*\{[^}]*height: 56px;/);
  assert.match(styles, /height: 100svh/);
  assert.match(styles, /width: 100vw/);
  assert.match(styles, /\.chat-back-button span/);
  assert.match(styles, /border-left: 6px solid var\(--chat-user-color\)/);
  assert.match(styles, /\.chat-message\.is-own/);
  assert.match(styles, /justify-self: end/);
  assert.match(styles, /border-right: 6px solid var\(--chat-user-color\)/);
  assert.match(styles, /\.chat-message-meta strong::before/);
  assert.match(source, /palette = \[/);
  assert.match(source, /chatIdentityKey\(message\)/);
  assert.match(source, /message\?\.authorUsername/);
  assert.match(source, /username === normalizeChatIdentity\(state\.currentUser\.username\)/);
});

test("pwa haptics provide tactile feedback on mobile interaction paths", async () => {
  const source = await fs.readFile(appJsPath, "utf8");
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");

  assert.match(source, /const hapticPatterns = {/);
  assert.match(source, /const hapticNativeStyles = {/);
  assert.match(source, /const hapticNotificationTypes = {/);
  assert.match(source, /const hapticSelector = \[/);
  assert.match(source, /let lastHapticAt = 0/);
  assert.match(source, /bindHapticSurfaceFeedback\(\)/);
  assert.match(source, /document\.addEventListener\("pointerdown"/);
  assert.match(source, /event\.pointerType === "mouse"/);
  assert.match(source, /pulseHapticSurface\(target\)/);
  assert.match(source, /function isStandalonePwa\(\)/);
  assert.ok(source.includes('window.matchMedia?.("(display-mode: standalone)")?.matches'));
  assert.match(source, /window\.navigator\.standalone === true/);
  assert.match(source, /window\.Capacitor\?\.Plugins\?\.Haptics/);
  assert.match(source, /window\.webkit\?\.messageHandlers\?\.carpostclubHaptics/);
  assert.match(source, /function haptic\(kind = "tap", options = {}\)/);
  assert.match(source, /"vibrate" in navigator/);
  assert.match(source, /navigator\.vibrate\(pattern\)/);
  assert.match(source, /haptic\("tap"\)/);
  assert.match(source, /haptic\("select"\)/);
  assert.match(source, /haptic\("start"\)/);
  assert.match(source, /haptic\("success"\)/);
  assert.match(source, /haptic\("warning"\)/);
  assert.match(source, /haptic\("error"\)/);
  assert.match(source, /setChatOpen\(!state\.chatOpen, { feedback: true }\)/);
  assert.match(source, /setManualCarFormOpen\(true, { feedback: true }\)/);
  assert.match(source, /showError\(error\) {\n  haptic\("error"\)/);
  assert.match(styles, /-webkit-tap-highlight-color: transparent/);
  assert.match(styles, /body\.is-haptic-pulse/);
  assert.match(styles, /\.is-haptic-pressing/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.is-haptic-pressing/);
});

test("inventory source paths visually separate O'Regan's cars from manual details", async () => {
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");

  assert.match(styles, /\.source-mode-switch/);
  assert.match(styles, /\.source-mode-card\.is-active/);
  assert.match(styles, /@media \(min-width: 920px\)[\s\S]*\.picker-grid\s*\{[\s\S]*grid-template-columns:[\s\S]*minmax\(160px, 0\.65fr\)[\s\S]*minmax\(220px, 0\.85fr\)/);
  assert.match(styles, /@media \(min-width: 920px\)[\s\S]*\.field-wide\s*\{[^}]*grid-column: 1 \/ -1;/);
  assert.match(styles, /background: #eef6ff/);
  assert.match(styles, /background: #fff4ef/);
  assert.match(styles, /border: 1px solid var\(--color-flame-orange\)/);
  assert.match(styles, /grid-template-columns: 1fr/);
});

test("gallery media cards show the uploading user", async () => {
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");

  assert.match(styles, /\.photo-meta \.media-uploader/);
  assert.match(styles, /\.media-uploader-badge/);
  assert.match(styles, /font-weight: var\(--font-weight-semibold\)/);
});

test("disabled auth controls are visibly unavailable", async () => {
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");

  assert.match(styles, /input:disabled/);
  assert.match(styles, /\.login-form input:disabled/);
  assert.match(styles, /\.login-form button:disabled/);
  assert.match(styles, /cursor: not-allowed/);
});

test("auth pages expose PWA metadata and brand assets", async () => {
  const source = await fs.readFile(serverPath, "utf8");
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");

  assert.match(source, /meta name="theme-color" content="#fafafa"/);
  assert.match(source, /meta name="mobile-web-app-capable" content="yes"/);
  assert.match(source, /meta name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(source, /link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(source, /link rel="apple-touch-icon" href="\/icons\/carpostclub-apple-touch-icon\.png"/);
  assert.match(source, /link rel="preload" as="image" href="\/icons\/carpostclub-icon-192\.png"/);
  assert.match(source, /<div class="auth-brand">/);
  assert.match(source, /<img src="\/icons\/carpostclub-icon-192\.png" alt="">/);
  assert.match(source, /\/styles\.css\?v=20260530-auth-pwa/);
  assert.match(styles, /\.auth-brand/);
  assert.match(styles, /\.auth-brand \.brand-mark/);
});

test("production smoke helper mints versioned bootstrap admin sessions", async () => {
  const source = await fs.readFile(smokeTestPath, "utf8");

  assert.match(source, /pv: bootstrapAdminPasswordVersion\(secret\)/);
  assert.match(source, /function bootstrapAdminPasswordVersion\(secret\)/);
  assert.match(source, /bootstrap-password:\$\{source\}/);
});

function fetchEventFor(url, mode) {
  return {
    request: {
      method: "GET",
      mode,
      url,
    },
    responded: false,
    response: null,
    respondWith(response) {
      this.responded = true;
      this.response = Promise.resolve(response);
    },
  };
}
