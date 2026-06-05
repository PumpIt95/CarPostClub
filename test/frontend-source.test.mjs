import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";

const appJsPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
const dealershipLogosRoot = fileURLToPath(new URL("../public/dealership-logos/", import.meta.url));
const iconsRoot = fileURLToPath(new URL("../public/icons/", import.meta.url));
const indexHtmlPath = fileURLToPath(new URL("../public/index.html", import.meta.url));
const manifestPath = fileURLToPath(new URL("../public/manifest.webmanifest", import.meta.url));
const offlineHtmlPath = fileURLToPath(new URL("../public/offline.html", import.meta.url));
const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));
const serviceWorkerPath = fileURLToPath(new URL("../public/sw.js", import.meta.url));
const smokeTestPath = fileURLToPath(new URL("../scripts/smoke_test.mjs", import.meta.url));
const shareCardPath = fileURLToPath(new URL("../public/share-card.png", import.meta.url));
const uploadMonkeyPath = fileURLToPath(new URL("../public/upload-monkey.svg", import.meta.url));
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
  assert.match(html, /id="pageEyebrow"/);
  assert.match(html, /id="pageTitle"/);
  assert.match(html, /id="galleryPageLink"[^>]*href="\/gallery"/);
  assert.match(html, /Open media gallery/);
  assert.match(html, /id="uploadPageLink"[^>]*href="\/"[^>]*hidden/);
  assert.match(html, /aria-label="Home"/);
  assert.match(html, /title="Home"/);
  const headerActionsIndex = html.indexOf('<div class="header-actions">');
  const homeNavIndex = html.indexOf('id="uploadPageLink"', headerActionsIndex);
  const installButtonIndex = html.indexOf('id="installButton"', headerActionsIndex);
  assert.ok(headerActionsIndex >= 0);
  assert.ok(homeNavIndex > headerActionsIndex);
  assert.ok(homeNavIndex < installButtonIndex);
  assert.match(html, /id="inventoryTypeSelect"/);
  assert.match(html, /id="dealershipSelect"/);
  assert.match(html, /id="makeFilterSelect"/);
  assert.match(html, /id="modelFilterSelect"/);
  assert.match(html, /Choose a make/);
  assert.match(html, /All models/);
  assert.match(html, /id="carSearchInput"/);
  assert.match(html, /Search stock, make, model/);
  assert.match(html, /id="carSearchResults"/);
  assert.match(html, /id="showPostedInventoryToggle"/);
  assert.match(html, /Show already posted vehicles/);
  assert.match(html, /id="postedInventoryHint"/);
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
  assert.match(html, /id="albumList"/);
  assert.match(html, /id="albumSectionTitle"/);
  assert.match(html, /id="albumSectionSubhead"/);
  assert.match(html, /Album tiles/);
  assert.match(html, /id="logoutForm"/);
  assert.match(html, /id="installButton"/);
  assert.match(html, /id="notificationButton"/);
  assert.doesNotMatch(html, /id="shortcutButton"/i);
  assert.doesNotMatch(html, /id="shortcutPanel"/i);
  assert.doesNotMatch(html, /Photos Shortcut/i);
  assert.doesNotMatch(html, /Install iOS Shortcut/i);
  assert.doesNotMatch(html, /Device tokens/i);
  assert.match(html, /Open Inventory on oregans\.com/);
  assert.match(html, /href="\/account\/password"/);
  assert.match(html, /Change password/);
  assert.doesNotMatch(html, /id="marketplacePanel"/);
  assert.doesNotMatch(html, /id="marketplaceDescription"/);
  assert.doesNotMatch(html, /Refresh Marketplace draft/);
  assert.doesNotMatch(html, /id="gallery"/);
  assert.doesNotMatch(html, /id="galleryToggleButton"/);
  assert.match(html, /accept="image\/\*,video\/\*/);
  assert.match(html, /id="cameraInput"[^>]*accept="image\/\*,\.heic,\.heif"/);
  assert.match(html, /accept="video\/\*/);
  assert.match(html, /id="uploadProgressShell"/);
  assert.match(html, /id="uploadRecovery"/);
  assert.match(html, /id="retryUploadButton"/);
  assert.match(html, /id="clearUploadButton"/);
  assert.match(html, /id="fileInput"[^>]*type="file"[^>]*hidden/);
  assert.match(html, /id="cameraInput"[^>]*type="file"[^>]*hidden/);
  assert.match(html, /id="videoInput"[^>]*type="file"[^>]*hidden/);
  assert.match(html, /class="upload-panel"/);
  assert.match(html, /class="album-section"/);
  assert.match(html, /class="upload-progress-marker"/);
  assert.match(html, /class="upload-monkey"/);
  assert.match(html, /src="\/upload-monkey\.svg"/);
  assert.match(html, /class="progress-confetti"/);
  assert.doesNotMatch(html, /&#128018;/);
  assert.match(html, /id="galleryFilterBar"/);
  assert.match(html, /id="gallerySearchInput"/);
  assert.match(html, /Search stock, VIN, make, model, year, uploader/);
  assert.match(html, /id="galleryStatusFilter"/);
  assert.match(html, /Active only/);
  assert.match(html, /Inactive only/);
  assert.match(html, /id="galleryMakeFilter"/);
  assert.match(html, /id="galleryModelFilter"/);
  assert.match(html, /id="galleryYearFilter"/);
  assert.match(html, /id="galleryUploaderFilter"/);
  assert.match(html, /\/app\.js\?v=20260604-live-upload-v45/);
  assert.match(html, /\/styles\.css\?v=20260604-upload-selection-v43/);
  assert.doesNotMatch(html, /\/shortcuts\//i);
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
  assert.match(source, /\/api\/albums/);
  assert.match(source, /\/description\.txt/);
  assert.match(source, /\/package/);
  assert.match(source, /renderAlbumList/);
  assert.match(source, /albumTiles/);
  assert.match(source, /selectedAlbumTile/);
  assert.match(source, /pageModeFromPath/);
  assert.match(source, /state\.page === "gallery"/);
  assert.match(source, /renderGalleryAlbumList/);
  assert.match(source, /galleryDealershipFolders/);
  assert.match(source, /renderGalleryFolderCard/);
  assert.match(source, /galleryFolderStatusSummary/);
  assert.match(source, /galleryFolderStats/);
  assert.match(source, /galleryAlbumIsUnread/);
  assert.match(source, /openedUnreadAlbumIds/);
  assert.match(source, /markGalleryDealershipSeen/);
  assert.match(source, /markGalleryAlbumSeen/);
  assert.match(source, /\/api\/gallery\/dealerships\/\$\{encodeURIComponent\(dealershipId\)\}\/seen/);
  assert.match(source, /\/api\/albums\/\$\{encodeURIComponent\(albumId\)\}\/seen/);
  assert.match(source, /renderGalleryFilterBar/);
  assert.match(source, /gallerySearchInput/);
  assert.match(source, /galleryStatusFilter/);
  assert.match(source, /filteredGalleryAlbums/);
  assert.match(source, /galleryAlbumMatchesFilters/);
  assert.match(source, /galleryAlbumSearchText/);
  assert.match(source, /carpostclub\.galleryStatusFilter/);
  assert.match(source, /open-dealership-folder/);
  assert.match(source, /back-gallery-folders/);
  assert.match(source, /No vehicles posted yet/);
  assert.match(source, /No vehicles match these filters/);
  assert.match(source, /Dealership folders/);
  assert.match(source, /is-gallery-page/);
  assert.match(source, /is-upload-page/);
  assert.match(source, /galleryPageLink/);
  assert.match(source, /uploadPageLink/);
  assert.match(source, /albumSectionTitle/);
  assert.match(source, /Shared albums/);
  assert.match(source, /All user accounts/);
  assert.match(source, /albumSummaryTitle/);
  assert.match(source, /albumSummaryDescription/);
  assert.match(source, /albumCreatorLabel/);
  assert.match(source, /uploadedByUsers/);
  assert.match(source, /Created by/);
  assert.match(source, /is-gallery-album/);
  assert.match(source, /is-collapsed/);
  assert.match(source, /includeDraft: state\.page === "gallery"/);
  assert.match(source, /\/marketplace-draft/);
  assert.match(source, /renderAlbumDescription/);
  assert.match(source, /renderAlbumPostingKit/);
  assert.match(source, /albumPostingKitRows/);
  assert.match(source, /copy-album-text/);
  assert.match(source, /copy-field-text/);
  assert.match(source, /Copy description/);
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /uploadPageUrlForAlbum/);
  assert.match(source, /window\.location\.href = uploadPageUrlForAlbum\(album\)/);
  assert.match(source, /inventoryStatusBadge/);
  assert.match(source, /albumPlaceholderActionButton\("Download Photos",/);
  assert.match(source, /albumPlaceholderActionButton\("Delete Upload"/);
  assert.match(source, /share-album-photos/);
  assert.match(source, /async function shareAlbumPhotos\(albumId\)/);
  assert.match(source, /navigator\.share/);
  assert.match(source, /navigator\.canShare/);
  assert.match(source, /new File/);
  assert.match(source, /fetch\(photo\.url, \{ credentials: "same-origin" \}\)/);
  assert.match(source, /button\.disabled = Boolean\(disabled\)/);
  assert.match(source, /disabled: true/);
  assert.match(source, /appendUploadAlbumActions/);
  assert.match(source, /triggerFileDownload/);
  assert.match(source, /state\.activeAlbum = response\.album \|\| null/);
  assert.match(source, /deleteAlbumMedia/);
  assert.match(source, /deleteAlbumPhoto/);
  assert.match(source, /delete-album-photo/);
  assert.match(source, /canManageAlbumMedia/);
  assert.match(source, /Download all/);
  assert.match(source, /Delete all/);
  assert.doesNotMatch(source, /photos\.slice\(0, 10\)/);
  assert.doesNotMatch(source, /renderMarketplaceDraft/);
  assert.doesNotMatch(source, /requestMarketplaceDraft/);
  assert.doesNotMatch(source, /\/api\/marketplace-draft/);
  assert.match(source, /els\.carSelect\.addEventListener\("change"/);
  assert.match(source, /inventoryKey/);
  assert.match(source, /carRequestPayload/);
  assert.match(source, /filteredCars/);
  assert.match(source, /inventoryAvailabilityCars/);
  assert.match(source, /searchFilteredInventoryCars/);
  assert.match(source, /carMatchesSearchTerms/);
  assert.match(source, /renderCarSearchResults/);
  assert.match(source, /renderCarSearchResult/);
  assert.match(source, /data-inventory-key/);
  assert.match(source, /carAlreadyPosted/);
  assert.match(source, /postedInventoryHintText/);
  assert.match(source, /showPostedInventoryToggle/);
  assert.match(source, /carpostclub\.showPostedInventory/);
  assert.match(source, /No unposted vehicles available/);
  assert.match(source, /No matching vehicles found/);
  assert.match(source, /No makes match search/);
  assert.match(source, /selectedCarUploadDuplicateBlocked/);
  assert.match(source, /recentUploadCompletion/);
  assert.match(source, /recentUploadCompletedForCar/);
  assert.match(source, /Upload complete\. Open this vehicle from the gallery to view the album/);
  assert.match(source, /if \(recentUploadCompletedForCar\(car\)\) return "Upload complete"/);
  assert.match(source, /Already uploaded\. Open this vehicle from the gallery instead/);
  const uploadStateLabelBlock = source.slice(source.indexOf("function uploadStateLabel"), source.indexOf("function renderUploadRecovery"));
  assert.ok(uploadStateLabelBlock.indexOf("Upload complete") < uploadStateLabelBlock.indexOf("Already uploaded"));
  assert.match(source, /button\.disabled = state\.uploading \|\| duplicateBlocked/);
  assert.match(source, /carSearchText/);
  assert.match(source, /carpostclub\.carSearch/);
  assert.match(source, /safeStorageRemove\("carpostclub\.carSearch"\)/);
  assert.match(source, /safeStorageGet\("carpostclub\.selectedDealershipId", "15"\)/);
  assert.match(source, /safeStorageSet\("carpostclub\.carSearch", state\.carSearch\)/);
  assert.match(source, /\/api\/me\/preferences/);
  assert.match(source, /function applyAccountPreferences\(preferences\)/);
  assert.match(source, /function accountPreferencesPayload\(\)/);
  assert.match(source, /function scheduleAccountPreferencesSave\(\)/);
  assert.match(source, /galleryDealershipId: safeStorageGet\("carpostclub\.galleryDealershipId"\)/);
  assert.match(source, /setOptionalStorage\("carpostclub\.selectedVin", state\.selectedVin\)/);
  assert.match(source, /els\.inventoryTypeSelect\.value = state\.selectedInventoryTypeId/);
  assert.match(source, /els\.dealershipSelect\.value = state\.selectedDealershipId/);
  assert.match(source, /Storage can be unavailable in restricted\/private browser modes/);
  const stateInitializer = source.slice(source.indexOf("const state = {"), source.indexOf("const hapticPatterns"));
  const persistSelectionBlock = source.slice(source.indexOf("function persistSelection"), source.indexOf("function safeStorageGet"));
  assert.doesNotMatch(stateInitializer, /localStorage/);
  assert.doesNotMatch(persistSelectionBlock, /localStorage/);
  assert.doesNotMatch(source, /Konner Photos/);
  assert.match(source, /selectedMake/);
  assert.match(source, /selectedModel/);
  assert.match(source, /renderVehicleFilterOptions/);
  assert.match(source, /All makes/);
  assert.match(source, /Choose make for models/);
  assert.match(source, /els\.videoButton\.addEventListener\("click"/);
  assert.match(source, /heic\|heif/);
  assert.match(source, /isVideoMedia/);
  assert.match(source, /renderAlbumMediaThumb/);
  assert.match(source, /els\.dropZone\.disabled = !unlocked/);
  assert.match(source, /\/api\/chat\/messages/);
  assert.match(source, /\/api\/chat\/stream/);
  assert.match(source, /\/api\/albums\/stream/);
  assert.match(source, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(source, /navigator\.serviceWorker\.addEventListener\("message", handleServiceWorkerMessage\)/);
  assert.match(source, /beforeinstallprompt/);
  assert.match(source, /Notification\.requestPermission/);
  assert.match(source, /pushManager\.subscribe/);
  assert.match(source, /\/api\/push\/config/);
  assert.match(source, /\/api\/push\/subscriptions/);
  assert.match(source, /\/api\/push\/test/);
  assert.doesNotMatch(source, /\/api\/shortcut/i);
  assert.doesNotMatch(source, /setShortcutPanelOpen/i);
  assert.doesNotMatch(source, /shortcutImportUrl/i);
  assert.doesNotMatch(source, /shortcuts:\/\//i);
  assert.doesNotMatch(source, /shortcutDownload/i);
  assert.match(source, /applyInitialSelectionFromUrl/);
  assert.doesNotMatch(source, /shortcutUpload/i);
  assert.match(source, /openAlbum/);
  assert.match(source, /handleLogoutSubmit/);
  assert.match(source, /currentPushSubscription/);
  assert.match(source, /pushEndpoint/);
  assert.match(source, /subscription\.unsubscribe/);
  assert.match(source, /HTMLFormElement\.prototype\.submit\.call/);
  assert.match(source, /addEventListener\("pagehide", disconnectChatStream\)/);
  assert.match(source, /addEventListener\("pagehide", disconnectAlbumStream\)/);
  assert.match(source, /addEventListener\("pageshow", handlePageShow\)/);
  assert.match(source, /function disconnectChatStream\(\)/);
  assert.match(source, /function resumeChatStream\(\)/);
  assert.match(source, /function disconnectAlbumStream\(\)/);
  assert.match(source, /function resumeAlbumStream\(\)/);
  assert.match(source, /loadChatMessages\(\{ countUnread: true \}\)/);
  assert.match(source, /window\.setTimeout\(resumeChatStream, 3000\)/);
  assert.match(source, /window\.setTimeout\(resumeAlbumStream, 3000\)/);
  assert.match(source, /chatReadMarker/);
  assert.match(source, /function updateChatUnreadFromMessages\(\)/);
  assert.match(source, /function isUnreadChatMessage\(message\)/);
  assert.match(source, /function markChatReadThroughLatestMessage\(\)/);
  assert.match(source, /\/api\/chat\/read-state/);
  assert.match(source, /function syncChatReadMarkerFromResponse\(response\)/);
  assert.match(source, /async function persistChatReadMarker\(marker\)/);
  assert.match(source, /function chatReadMarkerCompare\(left, right\)/);
  assert.match(source, /function chatReadStorageKey\(\)/);
  assert.match(source, /carpostclub\.chatRead\./);
  assert.match(source, /function handlePageShow\(event\)/);
  assert.match(source, /event\.persisted/);
  assert.match(source, /function validateActiveSession/);
  assert.match(source, /state\.lastSessionCheckAt/);
  assert.match(source, /state\.sessionCheckPromise/);
  assert.match(source, /state\.chatEventSource = null/);
  assert.match(source, /state\.albumEventSource = null/);
  assert.match(source, /handleUploadLiveEvent/);
  assert.match(source, /refreshAlbumsAfterLiveUpload/);
  assert.match(source, /handledUploadEventIds/);
  assert.match(source, /event\.data\?\.type !== "carpostclub:push"/);
  assert.match(source, /if \(!document\.hidden\) handlePageVisible\(\)/);
  assert.match(source, /openChat/);
  assert.match(source, /popstate/);
  assert.match(source, /syncChatUrl/);
  assert.match(source, /history\.pushState/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /new EventSource/);
  assert.match(source, /new EventSource\("\/api\/albums\/stream"\)/);
  assert.match(source, /classList\.toggle\("is-open", state\.chatOpen\)/);
  assert.match(source, /chat-view-active/);
  assert.match(source, /setAttribute\("aria-hidden", String\(!state\.chatOpen\)\)/);
  assert.match(source, /els\.appShell\.inert = state\.chatOpen/);
  assert.match(source, /els\.appShell\.toggleAttribute\("inert", state\.chatOpen\)/);
  assert.match(source, /els\.appShell\.setAttribute\("aria-hidden", String\(state\.chatOpen\)\)/);
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
  assert.match(source, /state\.selectedMake = "";\n    state\.selectedModel = "";\n    state\.carSearch = "";\n    safeStorageRemove\("carpostclub\.carSearch"\);\n    clearSelectedCarSelection\(\);/);
  assert.match(source, /thumbnailUrl/);
  assert.match(source, /loading = "lazy"/);
  assert.match(source, /photoUploaderLabel/);
  assert.match(source, /renderAlbumMediaThumb/);
  assert.match(source, /album-media-action/);
  assert.match(source, /delete-album-photo/);
  assert.doesNotMatch(source, /galleryExpanded/);
  assert.doesNotMatch(source, /galleryToggleButton/);
  assert.doesNotMatch(source, /downloadAllButton/);
  assert.match(source, /downloadName/);
  assert.doesNotMatch(source, /deleteAllPhotos/);
  assert.doesNotMatch(source, /copyMarketplaceDraft/);
  assert.match(source, /Saving media and generating Marketplace copy/);
  assert.match(source, /\/api\/albums\/\$\{encodeURIComponent\(album\.id\)\}\/package/);
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
  assert.equal(Object.hasOwn(manifest, "shortcuts"), false);
  assert.match(offlineHtml, /CarPostClub Offline/);
  assert.doesNotMatch(offlineHtml, /Konner Photos/);
  assert.match(offlineHtml, /Try again/);
  assert.match(serviceWorker, /carpostclub-pwa-v51/);
  assert.match(serviceWorker, /CarPostClub/);
  assert.match(serviceWorker, /carpostclub-icon-192\.png/);
  assert.match(serviceWorker, /upload-monkey\.svg/);
  assert.match(serviceWorker, /dealership-logos\/3-nissan\.webp/);
  assert.match(serviceWorker, /dealership-logos\/15-kia\.webp/);
  assert.match(serviceWorker, /dealership-logos\/18-gm\.webp/);
  assert.match(serviceWorker, /dealership-logos\/31-volkswagen\.webp/);
  assert.doesNotMatch(serviceWorker, /Konner Photos/);
  assert.match(serviceWorker, /self\.addEventListener\("fetch"/);
  assert.match(serviceWorker, /networkFirstNavigation/);
  assert.match(serviceWorker, /staleWhileRevalidate/);
  assert.match(serviceWorker, /networkFirstVersionedStaticAsset/);
  assert.doesNotMatch(serviceWorker, /isShortcutDownloadPath/);
  assert.match(serviceWorker, /url\.search && isStaticAsset\(url\.pathname\)/);
  assert.match(serviceWorker, /cache\.put\(pathname, networkResponse\.clone\(\)\)/);
  assert.match(serviceWorker, /cachedStaticResponse/);
  assert.match(serviceWorker, /cache\.match\(url\.pathname\)/);
  assert.match(serviceWorker, /self\.registration\.showNotification/);
  assert.match(serviceWorker, /broadcastPushPayload/);
  assert.match(serviceWorker, /client\.postMessage/);
  assert.match(serviceWorker, /carpostclub:push/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(serviceWorker, /notificationActions/);
  assert.match(serviceWorker, /messageId/);
  assert.match(serviceWorker, /albumId/);
  assert.match(serviceWorker, /mediaCount/);
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
  const uploadMonkey = await sharp(uploadMonkeyPath).metadata();

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
  assert.equal(uploadMonkey.format, "svg");
  assert.equal(uploadMonkey.width, 512);
  assert.equal(uploadMonkey.height, 512);
  assert.equal(uploadMonkey.hasAlpha, true);

  for (const file of ["3-nissan.svg", "15-kia.svg", "18-gm.svg", "31-volkswagen.svg"]) {
    const logo = await fs.readFile(`${dealershipLogosRoot}${file}`, "utf8");
    assert.match(logo, /<svg\b/);
    assert.match(logo, /<\/svg>/);
  }

  for (const file of ["3-nissan.webp", "15-kia.webp", "18-gm.webp", "31-volkswagen.webp"]) {
    const logo = await sharp(`${dealershipLogosRoot}${file}`).metadata();
    assert.equal(logo.format, "webp");
    assert.equal(logo.width, 512);
    assert.equal(logo.height, 288);
  }
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
  assert.doesNotMatch(styles, /\.shortcut-/i);
  assert.doesNotMatch(styles, /body\.shortcut-view-active/i);
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
  assert.match(styles, /\.upload-progress-marker/);
  assert.match(styles, /@keyframes uploadMarkerPulse/);
  assert.match(styles, /@keyframes uploadMascotDance/);
  assert.doesNotMatch(styles, /Apple Color Emoji/);
  assert.doesNotMatch(styles, /monkeyDance/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.is-haptic-pressing/);
});

test("inventory source paths visually separate O'Regan's cars from manual details", async () => {
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");

  assert.match(styles, /\.source-mode-switch/);
  assert.match(styles, /\.source-mode-card\.is-active/);
  assert.match(styles, /\.picker-panel\.is-manual-mode \.picker-grid/);
  assert.match(styles, /\.picker-panel\.is-manual-mode \.inventory-actions/);
  assert.match(styles, /\.inventory-search-results/);
  assert.match(styles, /\.inventory-search-result/);
  assert.match(styles, /\.inventory-search-empty/);
  assert.match(styles, /@media \(min-width: 920px\)[\s\S]*\.picker-grid\s*\{[\s\S]*grid-template-columns:[\s\S]*minmax\(160px, 0\.65fr\)[\s\S]*minmax\(220px, 0\.85fr\)/);
  assert.match(styles, /@media \(min-width: 920px\)[\s\S]*\.field-wide\s*\{[^}]*grid-column: 1 \/ -1;/);
  assert.match(styles, /background: #eef6ff/);
  assert.match(styles, /background: #fff4ef/);
  assert.match(styles, /border: 1px solid var\(--color-flame-orange\)/);
  assert.match(styles, /grid-template-columns: 1fr/);
});

test("album media thumbs keep media inside album tiles", async () => {
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");
  const source = await fs.readFile(appJsPath, "utf8");

  assert.match(styles, /\.album-media-strip/);
  assert.match(styles, /\.album-media-item/);
  assert.match(styles, /\.album-media-thumb/);
  assert.match(styles, /\.album-media-name/);
  assert.match(styles, /\.album-media-actions/);
  assert.match(styles, /\.album-media-action/);
  assert.match(source, /renderAlbumMediaThumb/);
  assert.match(source, /photoUploaderLabel/);
  assert.match(source, /photo\.downloadUrl/);
  assert.match(source, /deleteAlbumPhoto/);
  assert.doesNotMatch(styles, /\.gallery-grid/);
  assert.doesNotMatch(styles, /\.photo-card/);
});

test("uploaded package albums show inventory status and mobile download controls", async () => {
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");
  const source = await fs.readFile(appJsPath, "utf8");

  assert.match(styles, /\.album-section/);
  assert.match(styles, /\.app-shell\.is-upload-page \.album-section/);
  assert.match(styles, /\.app-shell\.is-gallery-page \.picker-panel/);
  assert.match(styles, /\.app-shell\.is-gallery-page \.upload-panel/);
  assert.match(styles, /\.app-shell\.is-gallery-page \.album-section/);
  assert.match(styles, /\.album-list\.is-folder-grid/);
  assert.match(styles, /\.gallery-folder-card/);
  assert.match(styles, /\.gallery-folder-card\.has-unread/);
  assert.match(styles, /\.gallery-unread-badge/);
  assert.match(styles, /\.gallery-folder-cover/);
  assert.match(styles, /\.gallery-folder-cover\.has-logo/);
  assert.match(styles, /\.gallery-folder-cover\.has-logo img\.gallery-folder-logo/);
  assert.match(styles, /\.gallery-folder-bar/);
  assert.match(styles, /\.gallery-folder-crumb/);
  assert.match(source, /logoUrl: dealership\.logoUrl/);
  assert.match(source, /gallery-folder-logo/);
  assert.match(source, /\$\{folder\.name\} logo/);
  assert.match(styles, /\.app-shell\.is-gallery-page \.album-card\.is-collapsed/);
  assert.match(styles, /\.app-shell\.is-gallery-page \.album-card\.is-unread/);
  assert.match(styles, /\.album-unread-badge/);
  assert.match(styles, /background: #e11937/);
  assert.match(styles, /\.app-shell\.is-gallery-page \.album-card\.is-collapsed \.inventory-status-badge/);
  assert.match(styles, /\.album-summary-button/);
  assert.match(styles, /\.album-summary-copy \.album-summary-description/);
  assert.match(styles, /-webkit-line-clamp: 2/);
  assert.match(styles, /\.album-summary-copy \.album-summary-meta/);
  assert.match(styles, /\.album-media-strip/);
  assert.match(styles, /\.album-description/);
  assert.match(styles, /white-space: pre-wrap/);
  assert.match(styles, /\.album-card\.is-selected/);
  assert.match(styles, /\.album-detail-actions \.icon-text-button\.danger/);
  assert.match(styles, /\.inventory-status-badge\.is-active/);
  assert.match(styles, /\.inventory-status-badge\.is-missing/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.album-detail-actions\s*\{[\s\S]*grid-template-columns: 1fr 1fr/);
  assert.doesNotMatch(styles, /\.album-marketplace/);
});

test("gallery page is an authenticated app route separate from upload", async () => {
  const source = await fs.readFile(serverPath, "utf8");

  assert.match(source, /app\.get\("\/", requireAuth/);
  assert.match(source, /app\.get\("\/gallery", requireAuth/);
  assert.match(source, /res\.sendFile\(path\.join\(publicRoot, "index\.html"\)\)/);
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
  assert.match(source, /\/styles\.css\?v=20260604-upload-selection-v43/);
  assert.match(styles, /\.auth-brand/);
  assert.match(styles, /\.auth-brand \.brand-mark/);
});

test("auth pages use 24-hour invite links instead of approval requests", async () => {
  const source = await fs.readFile(serverPath, "utf8");
  const styles = await fs.readFile(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");

  assert.match(source, /authInvitesPath/);
  assert.match(source, /authInviteLifetimeHours/);
  assert.match(source, /app\.post\(\"\/admin\/invites\"/);
  assert.match(source, /Generate invite link/);
  assert.match(source, /data-invite-form/);
  assert.match(source, /Accept: "application\/json"/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /new ClipboardItem/);
  assert.match(source, /document\.execCommand\("copy"\)/);
  assert.match(source, /anyone with the link can create an account/i);
  assert.match(source, /Account created\. You can sign in now\./);
  assert.match(source, /This invite link expired/);
  assert.doesNotMatch(source, /Account request sent/);
  assert.doesNotMatch(source, /Send request/);
  assert.match(styles, /\.admin-invite-link/);
  assert.match(styles, /\.admin-invite-copy-status/);
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
