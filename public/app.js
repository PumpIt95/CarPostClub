const initialPageMode = pageModeFromPath(window.location.pathname);

const state = {
  page: initialPageMode,
  dealerships: [],
  inventoryTypes: [],
  cars: [],
  photos: [],
  albums: [],
  albumDetails: {},
  activeAlbum: null,
  chatMessages: [],
  chatOpen: false,
  chatUnread: 0,
  chatReadMarker: null,
  chatReadSavePromise: null,
  chatEventSource: null,
  chatReconnectTimer: null,
  albumEventSource: null,
  albumReconnectTimer: null,
  albumLiveRefreshPromise: null,
  handledUploadEventIds: new Set(),
  currentUser: null,
  accountPreferencesSaveTimer: 0,
  accountPreferencesSavePromise: null,
  deferredInstallPrompt: null,
  serviceWorkerRegistration: null,
  pushPublicKey: "",
  pushSubscription: null,
  pushBusy: false,
  notifications: [],
  notificationUnreadCount: 0,
  notificationsOpen: false,
  notificationsLoading: false,
  selectedDealershipId: safeStorageGet("carpostclub.selectedDealershipId", "15"),
  selectedInventoryTypeId: safeStorageGet("carpostclub.selectedInventoryTypeId", "2"),
  selectedMake: safeStorageGet("carpostclub.selectedMake"),
  selectedModel: safeStorageGet("carpostclub.selectedModel"),
  selectedVin: safeStorageGet("carpostclub.selectedVin"),
  carSearch: safeStorageGet("carpostclub.carSearch"),
  showPostedInventory: safeStorageGet("carpostclub.showPostedInventory") === "true",
  galleryDealershipId: safeStorageGet("carpostclub.galleryDealershipId"),
  gallerySearch: safeStorageGet("carpostclub.gallerySearch"),
  galleryStatusFilter: safeStorageGet("carpostclub.galleryStatusFilter", "active"),
  galleryMakeFilter: safeStorageGet("carpostclub.galleryMakeFilter"),
  galleryModelFilter: safeStorageGet("carpostclub.galleryModelFilter"),
  galleryYearFilter: safeStorageGet("carpostclub.galleryYearFilter"),
  galleryUploaderFilter: safeStorageGet("carpostclub.galleryUploaderFilter"),
  initialOpenAlbum: false,
  expandedAlbumId: safeStorageGet("carpostclub.expandedAlbumId"),
  albumsLoading: false,
  openedUnreadAlbumIds: new Map(),
  inventoryFetchedAt: "",
  failedUploadFiles: [],
  failedUploadMessage: "",
  recentUploadCompletion: null,
  manualFormOpen: false,
  uploading: false,
  photoShareBusy: false,
  photoShareCache: {},
  photoShareActiveAlbumId: "",
  uploadCelebrationTimer: 0,
  chatSending: false,
  lastSessionCheckAt: 0,
  sessionCheckPromise: null,
};

const hapticPatterns = {
  tap: 10,
  select: 15,
  start: 20,
  success: [20, 40, 20],
  warning: [30, 60, 30],
  error: [40, 70, 40],
};
const hapticNativeStyles = {
  tap: "LIGHT",
  select: "LIGHT",
  start: "MEDIUM",
  success: "MEDIUM",
  warning: "HEAVY",
  error: "HEAVY",
};
const hapticNotificationTypes = {
  success: "SUCCESS",
  warning: "WARNING",
  error: "ERROR",
};
const pushPromptStorageKey = "carpostclub.pushPromptAsked";
const photoSharePreparationTimeoutMs = Number(window.__CARPOSTCLUB_PHOTO_SHARE_PREPARATION_TIMEOUT_MS || 20000);
const photoSharePreparationConcurrency = 2;
const photoShareDebugEnabled = new URLSearchParams(window.location.search).get("debugShare") === "1";
const hapticSelector = [
  "button:not(:disabled)",
  "a[href]",
  "select:not(:disabled)",
  "input[type='file']:not(:disabled)",
  ".source-mode-card:not(:disabled)",
  ".drop-zone:not([aria-disabled='true'])",
].join(",");
const hapticThrottleMs = 60;
const hapticCssResetMs = 140;
const uploadTimeoutMs = 20 * 60 * 1000;
let lastHapticAt = 0;
let hapticCssTimer = 0;

const els = {
  addManualCarButton: document.querySelector("#addManualCarButton"),
  albumCount: document.querySelector("#albumCount"),
  albumEmpty: document.querySelector("#albumEmpty"),
  albumList: document.querySelector("#albumList"),
  albumSectionSubhead: document.querySelector("#albumSectionSubhead"),
  albumSectionTitle: document.querySelector("#albumSectionTitle"),
  adminUsersLink: document.querySelector("#adminUsersLink"),
  appShell: document.querySelector(".app-shell"),
  cameraButton: document.querySelector("#cameraButton"),
  cameraInput: document.querySelector("#cameraInput"),
  carCount: document.querySelector("#carCount"),
  carSearchInput: document.querySelector("#carSearchInput"),
  carSearchResults: document.querySelector("#carSearchResults"),
  carSelect: document.querySelector("#carSelect"),
  chatClose: document.querySelector("#chatClose"),
  chatEmpty: document.querySelector("#chatEmpty"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatMessages: document.querySelector("#chatMessages"),
  chatPanel: document.querySelector("#chatPanel"),
  chatSend: document.querySelector("#chatSend"),
  chatToggle: document.querySelector("#chatToggle"),
  chatUnread: document.querySelector("#chatUnread"),
  dealershipSelect: document.querySelector("#dealershipSelect"),
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  installButton: document.querySelector("#installButton"),
  inventoryTypeSelect: document.querySelector("#inventoryTypeSelect"),
  logoutForm: document.querySelector("#logoutForm"),
  makeFilterSelect: document.querySelector("#makeFilterSelect"),
  manualBodyStyle: document.querySelector("#manualBodyStyle"),
  manualCarForm: document.querySelector("#manualCarForm"),
  manualDealershipSelect: document.querySelector("#manualDealershipSelect"),
  manualDescriptionPreview: document.querySelector("#manualDescriptionPreview"),
  manualExteriorColor: document.querySelector("#manualExteriorColor"),
  manualFuelType: document.querySelector("#manualFuelType"),
  manualInteriorColor: document.querySelector("#manualInteriorColor"),
  manualInventoryTypeSelect: document.querySelector("#manualInventoryTypeSelect"),
  manualMake: document.querySelector("#manualMake"),
  manualModel: document.querySelector("#manualModel"),
  manualOdometer: document.querySelector("#manualOdometer"),
  manualPrice: document.querySelector("#manualPrice"),
  manualStockNumber: document.querySelector("#manualStockNumber"),
  manualTransmission: document.querySelector("#manualTransmission"),
  manualTrim: document.querySelector("#manualTrim"),
  manualVin: document.querySelector("#manualVin"),
  manualYear: document.querySelector("#manualYear"),
  modelFilterSelect: document.querySelector("#modelFilterSelect"),
  notificationButton: document.querySelector("#notificationButton"),
  notificationClose: document.querySelector("#notificationClose"),
  notificationEmpty: document.querySelector("#notificationEmpty"),
  notificationList: document.querySelector("#notificationList"),
  notificationPanel: document.querySelector("#notificationPanel"),
  notificationPanelEnable: document.querySelector("#notificationPanelEnable"),
  notificationPanelOptIn: document.querySelector("#notificationPanelOptIn"),
  notificationPanelStatus: document.querySelector("#notificationPanelStatus"),
  notificationPrompt: document.querySelector("#notificationPrompt"),
  notificationPromptDismiss: document.querySelector("#notificationPromptDismiss"),
  notificationPromptEnable: document.querySelector("#notificationPromptEnable"),
  notificationUnread: document.querySelector("#notificationUnread"),
  oregansSourceButton: document.querySelector("#oregansSourceButton"),
  pickerPanel: document.querySelector(".picker-panel"),
  cancelManualCarButton: document.querySelector("#cancelManualCarButton"),
  pickerSubhead: document.querySelector("#pickerSubhead"),
  postedInventoryHint: document.querySelector("#postedInventoryHint"),
  galleryPageLink: document.querySelector("#galleryPageLink"),
  galleryFilterBar: document.querySelector("#galleryFilterBar"),
  gallerySearchInput: document.querySelector("#gallerySearchInput"),
  galleryStatusFilter: document.querySelector("#galleryStatusFilter"),
  galleryMakeFilter: document.querySelector("#galleryMakeFilter"),
  galleryModelFilter: document.querySelector("#galleryModelFilter"),
  galleryYearFilter: document.querySelector("#galleryYearFilter"),
  galleryUploaderFilter: document.querySelector("#galleryUploaderFilter"),
  pageEyebrow: document.querySelector("#pageEyebrow"),
  pageTitle: document.querySelector("#pageTitle"),
  refreshButton: document.querySelector("#refreshButton"),
  sourceLink: document.querySelector("#sourceLink"),
  statusBar: document.querySelector("#statusBar"),
  showPostedInventoryToggle: document.querySelector("#showPostedInventoryToggle"),
  uploadHint: document.querySelector("#uploadHint"),
  uploadProgress: document.querySelector("#uploadProgress"),
  uploadProgressShell: document.querySelector("#uploadProgressShell"),
  uploadRecovery: document.querySelector("#uploadRecovery"),
  uploadRecoveryMessage: document.querySelector("#uploadRecoveryMessage"),
  uploadPageLink: document.querySelector("#uploadPageLink"),
  uploadState: document.querySelector("#uploadState"),
  retryUploadButton: document.querySelector("#retryUploadButton"),
  clearUploadButton: document.querySelector("#clearUploadButton"),
  videoButton: document.querySelector("#videoButton"),
  videoInput: document.querySelector("#videoInput"),
};

init().catch((error) => showError(error));

async function init() {
  applyPageMode();
  bindEvents();
  await loadCurrentUser().catch(() => {});
  loadNotifications().catch((error) => console.warn(error));
  initChat().catch((error) => showError(error));
  initAlbumEvents();
  initPwa().catch((error) => {
    console.warn(error);
    renderPwaControls();
  });
  openInitialPanel();
  applyInitialSelectionFromUrl();
  await loadInventoryFilters();
  await loadCars({ keepSelectedCar: true });
  await loadAlbums();
}

function pageModeFromPath(pathname) {
  return normalizePathname(pathname) === "/gallery" ? "gallery" : "upload";
}

function normalizePathname(pathname) {
  const normalized = String(pathname || "/").replace(/\/+$/, "");
  return normalized || "/";
}

function applyPageMode() {
  const galleryPage = state.page === "gallery";
  els.appShell.classList.toggle("is-gallery-page", galleryPage);
  els.appShell.classList.toggle("is-upload-page", !galleryPage);
  if (els.galleryPageLink) els.galleryPageLink.hidden = galleryPage;
  if (els.uploadPageLink) els.uploadPageLink.hidden = !galleryPage;
  if (els.pageEyebrow) els.pageEyebrow.textContent = galleryPage ? "CarPostClub / Gallery" : "CarPostClub / Media";
  if (els.pageTitle) els.pageTitle.textContent = galleryPage ? "Media gallery" : "Vehicle media intake";
  if (els.albumSectionTitle) els.albumSectionTitle.textContent = galleryPage ? "Shared albums" : "Album tiles";
  if (els.albumSectionSubhead) els.albumSectionSubhead.textContent = galleryPage ? "All user accounts" : "Saved packages";
  document.title = galleryPage ? "Media Gallery | CarPostClub" : "CarPostClub";
}

async function loadCurrentUser() {
  const response = await apiJson("/api/me");
  state.currentUser = response.user || null;
  applyAccountPreferences(response.preferences);
  state.chatReadMarker = loadChatReadMarker();
  if (els.adminUsersLink) {
    els.adminUsersLink.hidden = state.currentUser?.role !== "admin";
  }
  if (state.chatMessages.length) {
    updateChatUnreadFromMessages();
    renderChatMessages();
    updateChatChrome();
  }
  renderActiveCar();
}

function bindEvents() {
  window.addEventListener("beforeunload", (event) => {
    if (!state.uploading) return;
    event.preventDefault();
    event.returnValue = "";
  });
  bindHapticSurfaceFeedback();

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link || !state.uploading) return;
    event.preventDefault();
    haptic("warning");
    showError("Upload still in progress. Stay on this page until it finishes.");
  }, true);

  document.addEventListener("submit", (event) => {
    if (!state.uploading) return;
    event.preventDefault();
    haptic("warning");
    showError("Upload still in progress. Stay on this page until it finishes.");
  }, true);

  els.inventoryTypeSelect.addEventListener("change", () => {
    haptic("select");
    state.selectedInventoryTypeId = els.inventoryTypeSelect.value;
    state.selectedMake = "";
    state.selectedModel = "";
    clearSelectedCarSelection();
    persistSelection();
    loadCars().catch((error) => showError(error));
  });

  els.dealershipSelect.addEventListener("change", () => {
    haptic("select");
    state.selectedDealershipId = els.dealershipSelect.value;
    state.selectedMake = "";
    state.selectedModel = "";
    clearSelectedCarSelection();
    persistSelection();
    loadCars().catch((error) => showError(error));
  });

  els.makeFilterSelect.addEventListener("change", () => {
    haptic("select");
    state.selectedMake = els.makeFilterSelect.value;
    state.selectedModel = "";
    clearSelectedCarSelection();
    persistSelection();
    renderCarOptions();
    renderActiveCar();
  });

  els.modelFilterSelect.addEventListener("change", () => {
    haptic("select");
    state.selectedModel = els.modelFilterSelect.value;
    clearSelectedCarSelection();
    persistSelection();
    renderCarOptions();
    renderActiveCar();
  });

  els.carSelect.addEventListener("change", () => {
    haptic("select");
    const vin = els.carSelect.value;
    if (!vin) {
      clearSelectedCarSelection();
      persistSelection();
      renderActiveCar();
      return;
    }
    selectCar(vin).catch((error) => showError(error));
  });

  els.carSearchResults.addEventListener("click", (event) => {
    const result = event.target.closest?.("[data-inventory-key]");
    if (!result || result.getAttribute("aria-disabled") === "true") return;
    haptic("select");
    selectCar(result.dataset.inventoryKey || "").catch((error) => showError(error));
  });

  els.carSearchInput.addEventListener("input", () => {
    state.carSearch = els.carSearchInput.value;
    safeStorageSet("carpostclub.carSearch", state.carSearch);
    scheduleAccountPreferencesSave();
    const selectedBeforeSearch = state.selectedVin;
    syncVehicleFiltersWithInventory();
    if (selectedCar() && !carMatchesVehicleFilters(selectedCar())) {
      clearSelectedCarSelection();
    }
    if (selectedBeforeSearch !== state.selectedVin) {
      persistSelection();
      renderActiveCar();
    }
    renderCarOptions();
  });

  els.showPostedInventoryToggle.addEventListener("change", () => {
    haptic("select");
    state.showPostedInventory = els.showPostedInventoryToggle.checked;
    safeStorageSet("carpostclub.showPostedInventory", String(state.showPostedInventory));
    scheduleAccountPreferencesSave();
    syncVehicleFiltersWithInventory({ keepSelectedCar: true });
    renderCarOptions();
    renderActiveCar();
  });

  els.refreshButton.addEventListener("click", () => {
    haptic("tap");
    refreshInventoryAndAlbums().catch((error) => showError(error));
  });

  els.addManualCarButton.addEventListener("click", () => {
    setManualCarFormOpen(true, { feedback: true });
  });

  els.oregansSourceButton.addEventListener("click", () => {
    setManualCarFormOpen(false, { feedback: true });
  });

  els.cancelManualCarButton.addEventListener("click", () => {
    setManualCarFormOpen(false, { feedback: true });
  });

  els.manualCarForm.addEventListener("submit", (event) => {
    haptic("start");
    createManualCar(event).catch((error) => showError(error));
  });

  els.albumList.addEventListener("click", handleAlbumListClick);
  els.gallerySearchInput?.addEventListener("input", () => {
    state.gallerySearch = els.gallerySearchInput.value;
    safeStorageSet("carpostclub.gallerySearch", state.gallerySearch);
    scheduleAccountPreferencesSave();
    renderAlbumList();
  });
  els.galleryStatusFilter?.addEventListener("change", () => {
    haptic("select");
    state.galleryStatusFilter = els.galleryStatusFilter.value;
    safeStorageSet("carpostclub.galleryStatusFilter", state.galleryStatusFilter);
    scheduleAccountPreferencesSave();
    syncGalleryFilterSelections();
    renderAlbumList();
  });
  els.galleryMakeFilter?.addEventListener("change", () => {
    haptic("select");
    state.galleryMakeFilter = els.galleryMakeFilter.value;
    state.galleryModelFilter = "";
    safeStorageSet("carpostclub.galleryMakeFilter", state.galleryMakeFilter);
    safeStorageRemove("carpostclub.galleryModelFilter");
    scheduleAccountPreferencesSave();
    syncGalleryFilterSelections();
    renderAlbumList();
  });
  els.galleryModelFilter?.addEventListener("change", () => {
    haptic("select");
    state.galleryModelFilter = els.galleryModelFilter.value;
    safeStorageSet("carpostclub.galleryModelFilter", state.galleryModelFilter);
    scheduleAccountPreferencesSave();
    renderAlbumList();
  });
  els.galleryYearFilter?.addEventListener("change", () => {
    haptic("select");
    state.galleryYearFilter = els.galleryYearFilter.value;
    safeStorageSet("carpostclub.galleryYearFilter", state.galleryYearFilter);
    scheduleAccountPreferencesSave();
    renderAlbumList();
  });
  els.galleryUploaderFilter?.addEventListener("change", () => {
    haptic("select");
    state.galleryUploaderFilter = els.galleryUploaderFilter.value;
    safeStorageSet("carpostclub.galleryUploaderFilter", state.galleryUploaderFilter);
    scheduleAccountPreferencesSave();
    renderAlbumList();
  });

  els.retryUploadButton.addEventListener("click", () => {
    uploadFiles(state.failedUploadFiles).catch((error) => showError(error));
  });

  els.clearUploadButton.addEventListener("click", () => {
    haptic("tap");
    clearFailedUpload();
    clearFileInput(els.fileInput);
    clearFileInput(els.cameraInput);
    clearFileInput(els.videoInput);
    resetUploadCelebration();
    setProgress(0);
    renderActiveCar();
  });

  els.logoutForm?.addEventListener("submit", handleLogoutSubmit);

  els.installButton?.addEventListener("click", installPwa);
  els.notificationButton?.addEventListener("click", () => setNotificationsOpen(!state.notificationsOpen, { feedback: true }));
  els.notificationClose?.addEventListener("click", () => setNotificationsOpen(false, { feedback: true }));
  els.notificationPromptEnable?.addEventListener("click", enablePushNotificationsFromPrompt);
  els.notificationPanelEnable?.addEventListener("click", enablePushNotificationsFromPrompt);
  els.notificationPromptDismiss?.addEventListener("click", dismissPushPrompt);
  els.notificationList?.addEventListener("click", handleNotificationListClick);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.notificationsOpen) setNotificationsOpen(false, { feedback: true });
  });

  document.addEventListener("click", (event) => {
    if (!state.notificationsOpen) return;
    if (els.notificationPanel?.contains(event.target) || els.notificationButton?.contains(event.target)) return;
    setNotificationsOpen(false);
  });

  window.addEventListener("popstate", () => {
    const shouldOpenChat = new URLSearchParams(window.location.search).get("openChat") === "1";
    if (shouldOpenChat !== state.chatOpen) setChatOpen(shouldOpenChat, { syncUrl: false });
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    renderPwaControls();
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    renderPwaControls();
    haptic("success");
    showStatus("CarPostClub installed.");
  });

  els.dropZone.addEventListener("click", () => {
    if (!selectedCar()) return;
    haptic("tap");
    clearFileInput(els.fileInput);
    els.fileInput.click();
  });

  els.cameraButton.addEventListener("click", () => {
    if (!selectedCar()) return;
    haptic("tap");
    clearFileInput(els.cameraInput);
    els.cameraInput.click();
  });

  els.videoButton.addEventListener("click", () => {
    if (!selectedCar()) return;
    haptic("tap");
    clearFileInput(els.videoInput);
    els.videoInput.click();
  });

  els.fileInput.addEventListener("change", () => {
    uploadFiles(snapshotFiles(els.fileInput.files));
    clearFileInput(els.fileInput);
  });

  els.cameraInput.addEventListener("change", () => {
    uploadFiles(snapshotFiles(els.cameraInput.files));
    clearFileInput(els.cameraInput);
  });

  els.videoInput.addEventListener("change", () => {
    uploadFiles(snapshotFiles(els.videoInput.files));
    clearFileInput(els.videoInput);
  });

  for (const eventName of ["dragenter", "dragover"]) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (selectedCar()) els.dropZone.classList.add("is-dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    els.dropZone.addEventListener(eventName, () => {
      els.dropZone.classList.remove("is-dragging");
    });
  }

  els.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    if (!selectedCar()) return;
    uploadFiles(snapshotFiles(event.dataTransfer?.files));
  });

  els.chatToggle.addEventListener("click", () => setChatOpen(!state.chatOpen, { feedback: true }));
  els.chatClose.addEventListener("click", () => setChatOpen(false, { feedback: true }));
  els.chatForm.addEventListener("submit", sendChatMessage);
  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    els.chatForm.requestSubmit();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
  }

  window.addEventListener("pagehide", disconnectChatStream);
  window.addEventListener("pagehide", disconnectAlbumStream);
  window.addEventListener("pageshow", handlePageShow);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) handlePageVisible();
  });
}

function handlePageShow(event) {
  resumeChatStream();
  resumeAlbumStream();
  if (event.persisted) validateActiveSession({ force: true }).catch(() => {});
}

function handlePageVisible() {
  resumeChatStream();
  resumeAlbumStream();
  validateActiveSession().catch(() => {});
}

async function validateActiveSession({ force = false } = {}) {
  if (!state.currentUser) return;
  if (state.sessionCheckPromise) return state.sessionCheckPromise;

  const now = Date.now();
  if (!force && now - state.lastSessionCheckAt < 30_000) return;
  state.lastSessionCheckAt = now;

  state.sessionCheckPromise = loadCurrentUser()
    .finally(() => {
      state.sessionCheckPromise = null;
    });
  return state.sessionCheckPromise;
}

async function initPwa() {
  renderPwaControls();
  if (!("serviceWorker" in navigator)) return;

  state.serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js");
  state.serviceWorkerRegistration = await navigator.serviceWorker.ready;

  if (pushNotificationsSupported()) {
    await loadPushConfig();
    state.pushSubscription = await ensurePushSubscription({
      allowSubscribe: Notification.permission === "granted",
    }).catch((error) => {
      console.warn(error);
      return null;
    });
  }

  renderPwaControls();
}

async function installPwa() {
  if (!state.deferredInstallPrompt) return;
  haptic("tap");
  const promptEvent = state.deferredInstallPrompt;
  state.deferredInstallPrompt = null;
  renderPwaControls();
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice.catch(() => null);
  if (choice?.outcome === "accepted") showStatus("CarPostClub install started.");
}

async function enablePushNotificationsFromPrompt(event) {
  event?.preventDefault?.();
  setPushPromptAsked(true);
  await enablePushNotifications();
}

async function enablePushNotifications() {
  if (state.pushBusy) return;
  haptic("tap");
  state.pushBusy = true;
  renderPwaControls();

  try {
    if (!pushNotificationsSupported()) {
      throw new Error("Push notifications are not supported in this browser.");
    }

    if (!state.serviceWorkerRegistration) {
      state.serviceWorkerRegistration = await navigator.serviceWorker.ready;
    }

    await loadPushConfig();

    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(permission === "denied"
        ? "Notifications are blocked. Allow them in this browser's site settings."
        : "Notification permission was not granted.");
    }

    await ensurePushSubscription({ allowSubscribe: true });
    haptic("success");
    showStatus("Push notifications turned on.");
    apiJson("/api/push/test", { method: "POST" }).catch(() => {});
  } catch (error) {
    showError(error);
  } finally {
    state.pushBusy = false;
    renderPwaControls();
  }
}

function dismissPushPrompt() {
  haptic("tap");
  setPushPromptAsked(true);
  renderPwaControls();
}

async function handleLogoutSubmit(event) {
  const confirmed = window.confirm("Are you sure you want to sign out?");
  if (!confirmed) {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  const submitButton = els.logoutForm.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;
  try {
    const subscription = await currentPushSubscription();
    if (subscription?.endpoint) {
      setLogoutPushEndpoint(subscription.endpoint);
      await subscription.unsubscribe().catch(() => false);
      state.pushSubscription = null;
    }
  } finally {
    HTMLFormElement.prototype.submit.call(els.logoutForm);
  }
}

async function currentPushSubscription() {
  if (!pushNotificationsSupported()) return null;
  if (!state.serviceWorkerRegistration) {
    state.serviceWorkerRegistration = await promiseWithTimeout(
      navigator.serviceWorker.ready,
      2500,
    ).catch(() => null);
  }
  if (!state.serviceWorkerRegistration?.pushManager?.getSubscription) return null;
  return state.serviceWorkerRegistration.pushManager.getSubscription().catch(() => null);
}

function promiseWithTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Timed out waiting for service worker.")), timeoutMs);
    }),
  ]);
}

function setLogoutPushEndpoint(endpoint) {
  let input = els.logoutForm.querySelector("input[name='pushEndpoint']");
  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.name = "pushEndpoint";
    els.logoutForm.append(input);
  }
  input.value = endpoint;
}

function pushNotificationsSupported() {
  return "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

async function loadPushConfig() {
  if (state.pushPublicKey) return state.pushPublicKey;
  const config = await apiJson("/api/push/config");
  state.pushPublicKey = config.publicKey || "";
  if (!state.pushPublicKey) throw new Error("Push notifications are not configured.");
  return state.pushPublicKey;
}

async function ensurePushSubscription({ allowSubscribe = false } = {}) {
  if (!pushNotificationsSupported()) return null;
  if (!state.serviceWorkerRegistration) {
    state.serviceWorkerRegistration = await navigator.serviceWorker.ready;
  }
  await loadPushConfig();

  let subscription = await state.serviceWorkerRegistration.pushManager.getSubscription();
  const hadSubscription = Boolean(subscription);
  if (subscription && !pushSubscriptionMatchesPublicKey(subscription)) {
    await deletePushSubscription(subscription).catch(() => {});
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }

  if (!subscription && (allowSubscribe || hadSubscription) && Notification.permission === "granted") {
    subscription = await state.serviceWorkerRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.pushPublicKey),
    });
  }

  if (subscription) {
    await savePushSubscription(subscription);
    state.pushSubscription = subscription;
  } else {
    state.pushSubscription = null;
  }

  renderPwaControls();
  return subscription;
}

function pushSubscriptionMatchesPublicKey(subscription) {
  const key = subscription?.options?.applicationServerKey;
  if (!key || !state.pushPublicKey) return true;
  const expected = urlBase64ToUint8Array(state.pushPublicKey);
  const actual = new Uint8Array(key);
  if (actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

function pushPromptAsked() {
  return safeStorageGet(pushPromptStorageKey) === "true";
}

function setPushPromptAsked(asked) {
  if (asked) safeStorageSet(pushPromptStorageKey, "true");
  else safeStorageRemove(pushPromptStorageKey);
}

async function savePushSubscription(subscription) {
  const serialized = typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription;
  const response = await apiJson("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: serialized }),
  });
  return response.subscription;
}

async function deletePushSubscription(subscription) {
  await apiJson("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
}

function renderPwaControls() {
  if (els.installButton) {
    const canInstall = Boolean(state.deferredInstallPrompt);
    els.installButton.hidden = !canInstall;
    els.installButton.disabled = !canInstall;
  }

  renderNotificationPanel();
  renderPushPrompt();

  if (!els.notificationButton) return;
  const supported = pushNotificationsSupported();
  const permission = supported ? Notification.permission : "unsupported";
  const subscribed = Boolean(state.pushSubscription);
  const unread = Math.min(99, Math.max(0, state.notificationUnreadCount));
  els.notificationButton.hidden = false;
  els.notificationButton.disabled = state.pushBusy;
  els.notificationButton.classList.toggle("is-on", subscribed);
  els.notificationButton.setAttribute("aria-expanded", String(state.notificationsOpen));
  if (els.notificationUnread) {
    els.notificationUnread.hidden = unread <= 0;
    els.notificationUnread.textContent = unread === 99 && state.notificationUnreadCount > 99 ? "99+" : String(unread);
  }
  const label = state.pushBusy
    ? "Updating notifications"
    : unread > 0
      ? `Notifications, ${state.notificationUnreadCount} unread`
      : permission === "denied"
        ? "Notifications blocked"
        : "Notifications";
  els.notificationButton.setAttribute("aria-label", label);
  els.notificationButton.title = label;
}

async function loadNotifications() {
  if (!state.currentUser) return;
  state.notificationsLoading = true;
  renderNotificationPanel();
  try {
    const response = await apiJson("/api/notifications?limit=50");
    applyNotificationsResponse(response);
  } finally {
    state.notificationsLoading = false;
    renderPwaControls();
  }
}

async function markNotificationsRead(ids = null) {
  if (!state.currentUser) return;
  if (!ids && state.notificationUnreadCount <= 0) return;
  const response = await apiJson("/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
  });
  applyNotificationsResponse(response);
  renderPwaControls();
}

function applyNotificationsResponse(response) {
  state.notifications = Array.isArray(response?.notifications)
    ? response.notifications.map(normalizeNotification).filter(Boolean)
    : [];
  const unread = Number(response?.unreadCount);
  state.notificationUnreadCount = Number.isFinite(unread)
    ? Math.max(0, Math.floor(unread))
    : state.notifications.filter((notification) => !notification.readAt).length;
}

function normalizeNotification(notification) {
  if (!notification || typeof notification !== "object") return null;
  const id = String(notification.id || notification.notificationId || notification.messageId || "").trim();
  if (!id) return null;
  const url = cleanNotificationUrl(notification.url);
  return {
    id,
    title: String(notification.title || "CarPostClub").trim() || "CarPostClub",
    body: String(notification.body || "").trim(),
    url,
    kind: String(notification.kind || "").trim(),
    type: String(notification.type || "").trim(),
    route: String(notification.route || "").trim(),
    notificationType: String(notification.notificationType || "").trim(),
    tag: String(notification.tag || "").trim(),
    messageId: String(notification.messageId || "").trim(),
    uploadId: String(notification.uploadId || "").trim(),
    albumId: String(notification.albumId || "").trim(),
    mediaCount: Number.isFinite(Number(notification.mediaCount)) ? Math.max(0, Math.floor(Number(notification.mediaCount))) : 0,
    author: String(notification.author || "").trim(),
    preview: Boolean(notification.preview),
    dealershipId: String(notification.dealershipId || "").trim(),
    inventoryTypeId: String(notification.inventoryTypeId || "").trim(),
    inventoryKey: String(notification.inventoryKey || "").trim(),
    stockNumber: String(notification.stockNumber || "").trim(),
    createdAt: normalizeDateString(notification.createdAt),
    receivedAt: normalizeDateString(notification.receivedAt || notification.createdAt),
    readAt: normalizeDateString(notification.readAt),
  };
}

function cleanNotificationUrl(value) {
  const text = String(value || "").trim();
  return text.startsWith("/") && !text.startsWith("//") ? text : "/";
}

function normalizeDateString(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function setNotificationsOpen(isOpen, { feedback = false } = {}) {
  if (feedback) haptic("tap");
  state.notificationsOpen = Boolean(isOpen);
  document.body.classList.toggle("notification-panel-active", state.notificationsOpen);
  renderNotificationPanel();
  renderPwaControls();

  if (state.notificationsOpen) {
    loadNotifications()
      .then(() => markNotificationsRead())
      .catch((error) => console.warn(error));
  }
}

function renderNotificationPanel() {
  if (!els.notificationPanel) return;
  els.notificationPanel.hidden = !state.notificationsOpen;
  els.notificationPanel.classList.toggle("is-open", state.notificationsOpen);
  els.notificationPanel.setAttribute("aria-hidden", String(!state.notificationsOpen));

  const supported = pushNotificationsSupported();
  const permission = supported ? Notification.permission : "unsupported";
  const subscribed = Boolean(state.pushSubscription);
  if (els.notificationPanelStatus) {
    els.notificationPanelStatus.textContent = state.pushBusy
      ? "Updating push notifications..."
      : subscribed
        ? "Push notifications are on for this device."
        : permission === "denied"
          ? "Notifications are blocked in this browser's site settings."
          : supported
            ? "Push notifications are off for this device."
            : "Push notifications are not supported in this browser.";
  }
  if (els.notificationPanelOptIn) {
    els.notificationPanelOptIn.hidden = !supported || subscribed || permission === "denied";
  }
  if (els.notificationPanelEnable) {
    els.notificationPanelEnable.disabled = state.pushBusy || !supported || subscribed || permission === "denied";
  }
  renderNotificationList();
}

function renderPushPrompt() {
  if (!els.notificationPrompt) return;
  const supported = pushNotificationsSupported();
  const permission = supported ? Notification.permission : "unsupported";
  const shouldAsk = supported
    && Boolean(state.serviceWorkerRegistration)
    && !state.pushSubscription
    && permission === "default"
    && state.page !== "gallery"
    && !pushPromptAsked();
  els.notificationPrompt.hidden = !shouldAsk;
  if (els.notificationPromptEnable) els.notificationPromptEnable.disabled = state.pushBusy;
}

function renderNotificationList() {
  if (!els.notificationList) return;
  if (state.notifications.length) {
    els.notificationList.replaceChildren(...state.notifications.map(renderNotificationItem));
  } else {
    els.notificationList.replaceChildren();
  }
  if (els.notificationEmpty) {
    els.notificationEmpty.hidden = state.notificationsLoading || state.notifications.length > 0;
    els.notificationEmpty.textContent = state.notificationsLoading ? "Loading notifications..." : "No notifications yet";
  }
}

function renderNotificationItem(notification) {
  const link = document.createElement("a");
  link.className = "notification-item";
  link.classList.toggle("is-unread", !notification.readAt);
  link.href = notification.url || "/";
  link.dataset.notificationId = notification.id;
  link.setAttribute("role", "listitem");

  const header = document.createElement("span");
  header.className = "notification-item-header";

  const title = document.createElement("strong");
  title.textContent = notification.title;

  const time = document.createElement("time");
  const timestamp = notification.receivedAt || notification.createdAt;
  time.dateTime = timestamp;
  time.textContent = formatNotificationTime(timestamp);
  header.append(title, time);

  const body = document.createElement("span");
  body.className = "notification-item-body";
  body.textContent = notification.body || "Open CarPostClub.";

  const meta = document.createElement("span");
  meta.className = "notification-item-meta";
  meta.textContent = notificationMetaLabel(notification);

  link.append(header, body, meta);
  return link;
}

function formatNotificationTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? formatDate(new Date(time).toISOString()) : "";
}

function notificationMetaLabel(notification) {
  const labels = [];
  if (notification.kind === "chat") labels.push("Chat");
  else if (notification.kind === "upload") labels.push("Upload");
  else if (notification.kind === "inventory_removed" || notification.kind === "inventory_added") labels.push("Inventory");
  if (notification.mediaCount) labels.push(`${notification.mediaCount} ${plural(notification.mediaCount, "file")}`);
  if (notification.author) labels.push(notification.author);
  return labels.join(" - ") || "CarPostClub";
}

function handleNotificationListClick(event) {
  const link = event.target.closest?.(".notification-item");
  if (!link) return;
  haptic("select");
  const id = link.dataset.notificationId;
  if (id) markNotificationsRead([id]).catch((error) => console.warn(error));
  setNotificationsOpen(false);
}

function openInitialPanel() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("openChat") === "1") setChatOpen(true, { syncUrl: false });
}

function applyInitialSelectionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const dealershipId = cleanQueryValue(params.get("dealershipId"));
  const inventoryTypeId = cleanQueryValue(params.get("inventoryTypeId"));
  const inventoryKey = cleanQueryValue(params.get("inventoryKey") || params.get("vin"));
  const albumId = cleanQueryValue(params.get("albumId"));
  let changed = false;
  if (dealershipId) state.selectedDealershipId = dealershipId;
  if (dealershipId) changed = true;
  if (state.page === "gallery" && dealershipId) {
    state.galleryDealershipId = dealershipId;
    changed = true;
  }
  if (inventoryTypeId) {
    state.selectedInventoryTypeId = inventoryTypeId;
    changed = true;
  }
  if (state.page === "gallery" && albumId) {
    state.expandedAlbumId = albumId;
    changed = true;
  }
  if (inventoryKey) {
    state.selectedVin = inventoryKey;
    state.selectedMake = "";
    state.selectedModel = "";
    state.carSearch = "";
    safeStorageRemove("carpostclub.carSearch");
    changed = true;
  }
  state.initialOpenAlbum = params.get("openAlbum") === "1";
  if (changed) persistSelection();
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function initChat() {
  await loadChatMessages({ countUnread: true });
  connectChatStream();
}

async function loadChatMessages({ countUnread = false } = {}) {
  const response = await apiJson("/api/chat/messages");
  const messages = Array.isArray(response.messages)
    ? response.messages.map(normalizeChatMessage).filter(Boolean)
    : [];
  state.chatMessages = messages;
  syncChatReadMarkerFromResponse(response);
  if (state.chatOpen) {
    markChatReadThroughLatestMessage();
  } else if (countUnread) {
    updateChatUnreadFromMessages();
  }
  renderChatMessages({ scrollToEnd: true });
  updateChatChrome();
}

function connectChatStream() {
  if (!("EventSource" in window)) {
    window.clearTimeout(state.chatReconnectTimer);
    state.chatReconnectTimer = window.setTimeout(() => {
      loadChatMessages({ countUnread: true }).catch(() => {});
      connectChatStream();
    }, 5000);
    return;
  }

  state.chatEventSource?.close();
  const source = new EventSource("/api/chat/stream");
  state.chatEventSource = source;

  source.addEventListener("message", (event) => {
    try {
      mergeChatMessage(JSON.parse(event.data), { incoming: true });
    } catch {
      // Ignore malformed stream events and keep the live connection open.
    }
  });

  source.addEventListener("error", () => {
    source.close();
    if (state.chatEventSource === source) state.chatEventSource = null;
    window.clearTimeout(state.chatReconnectTimer);
    state.chatReconnectTimer = window.setTimeout(resumeChatStream, 3000);
  });
}

function disconnectChatStream() {
  state.chatEventSource?.close();
  state.chatEventSource = null;
  window.clearTimeout(state.chatReconnectTimer);
  state.chatReconnectTimer = null;
}

function resumeChatStream() {
  window.clearTimeout(state.chatReconnectTimer);
  state.chatReconnectTimer = null;
  if (state.chatEventSource) return;
  loadChatMessages({ countUnread: true }).catch(() => {});
  connectChatStream();
}

function initAlbumEvents() {
  connectAlbumStream();
}

function connectAlbumStream() {
  if (!("EventSource" in window)) {
    window.clearTimeout(state.albumReconnectTimer);
    state.albumReconnectTimer = window.setTimeout(() => {
      refreshAlbumsAfterLiveUpload().catch(reportBackgroundAlbumRefreshError);
      connectAlbumStream();
    }, 10000);
    return;
  }

  state.albumEventSource?.close();
  const source = new EventSource("/api/albums/stream");
  state.albumEventSource = source;

  source.addEventListener("message", handleAlbumStreamMessage);

  source.addEventListener("error", () => {
    source.close();
    if (state.albumEventSource === source) state.albumEventSource = null;
    window.clearTimeout(state.albumReconnectTimer);
    state.albumReconnectTimer = window.setTimeout(resumeAlbumStream, 3000);
  });
}

function disconnectAlbumStream() {
  state.albumEventSource?.close();
  state.albumEventSource = null;
  window.clearTimeout(state.albumReconnectTimer);
  state.albumReconnectTimer = null;
}

function resumeAlbumStream() {
  window.clearTimeout(state.albumReconnectTimer);
  state.albumReconnectTimer = null;
  if (state.albumEventSource) return;
  refreshAlbumsAfterLiveUpload().catch(reportBackgroundAlbumRefreshError);
  connectAlbumStream();
}

function handleAlbumStreamMessage(event) {
  try {
    handleUploadLiveEvent(JSON.parse(event.data)).catch(reportBackgroundAlbumRefreshError);
  } catch {
    // Ignore malformed album events and keep the live connection open.
  }
}

function handleServiceWorkerMessage(event) {
  if (event.data?.type !== "carpostclub:push") return;
  loadNotifications().catch((error) => console.warn(error));
  handleUploadLiveEvent(event.data.payload).catch(reportBackgroundAlbumRefreshError);
}

function reportBackgroundAlbumRefreshError(error) {
  if (isTransientFetchError(error)) return;
  console.warn(error);
}

function isTransientFetchError(error) {
  return error?.name === "AbortError"
    || (error instanceof TypeError && /Failed to fetch/i.test(error.message || ""));
}

async function handleUploadLiveEvent(payload) {
  const event = normalizeUploadLiveEvent(payload);
  if (!event) return;

  const key = uploadLiveEventKey(event);
  if (state.handledUploadEventIds.has(key)) return;
  rememberUploadLiveEvent(key);

  showStatus(event.body || "Media uploaded.");
  await refreshAlbumsAfterLiveUpload(event);
}

function normalizeUploadLiveEvent(payload) {
  if (!payload || typeof payload !== "object" || payload.kind !== "upload") return null;
  const mediaCount = Number.isFinite(Number(payload.mediaCount))
    ? Math.max(0, Math.floor(Number(payload.mediaCount)))
    : 0;
  return {
    uploadId: String(payload.uploadId || payload.messageId || "").trim(),
    albumId: String(payload.albumId || "").trim(),
    mediaCount,
    body: String(payload.body || "").trim(),
    uploadedAt: String(payload.uploadedAt || payload.timestamp || "").trim(),
  };
}

function uploadLiveEventKey(event) {
  return event.uploadId || [
    "upload",
    event.albumId,
    event.uploadedAt,
    event.mediaCount,
    event.body,
  ].join(":");
}

function rememberUploadLiveEvent(key) {
  state.handledUploadEventIds.add(key);
  while (state.handledUploadEventIds.size > 80) {
    state.handledUploadEventIds.delete(state.handledUploadEventIds.values().next().value);
  }
}

async function refreshAlbumsAfterLiveUpload(event = null) {
  state.albumLiveRefreshPromise = (state.albumLiveRefreshPromise || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const selectedAlbumId = state.activeAlbum?.id || "";
      const selectedInventoryKey = selectedCar() ? carInventoryKey(selectedCar()) : "";
      const expandedAlbumId = state.expandedAlbumId || "";
      if (event?.albumId) delete state.albumDetails[event.albumId];

      await loadAlbums();

      const selectedAlbum = selectedInventoryKey
        ? albumForCar({ inventoryKey: selectedInventoryKey })
        : null;
      const shouldRefreshSelectedAlbum = Boolean(
        selectedAlbum?.id
          && (!event?.albumId || selectedAlbum.id === event.albumId || selectedAlbum.id === selectedAlbumId),
      );
      if (shouldRefreshSelectedAlbum) {
        await loadSelectedCarAlbum({ force: true, markSeen: false });
      }

      if (event?.albumId && expandedAlbumId === event.albumId) {
        await loadAlbumDetails(event.albumId, { force: true, includeDraft: state.page === "gallery" });
      }

      renderActiveCar();
    });
  return state.albumLiveRefreshPromise;
}

function setChatOpen(isOpen, { syncUrl = true, feedback = false } = {}) {
  if (feedback && Boolean(isOpen) !== state.chatOpen) haptic("select");
  state.chatOpen = Boolean(isOpen);
  els.chatPanel.hidden = !state.chatOpen;
  els.chatPanel.classList.toggle("is-open", state.chatOpen);
  document.body.classList.toggle("chat-view-active", state.chatOpen);
  els.chatPanel.setAttribute("aria-hidden", String(!state.chatOpen));
  if (els.appShell) {
    els.appShell.inert = state.chatOpen;
    els.appShell.toggleAttribute("inert", state.chatOpen);
    els.appShell.setAttribute("aria-hidden", String(state.chatOpen));
  }
  els.chatToggle.setAttribute("aria-expanded", String(state.chatOpen));
  els.chatToggle.setAttribute("aria-label", state.chatOpen ? "Close chat" : "Open chat");
  if (syncUrl) syncChatUrl(state.chatOpen);
  if (state.chatOpen) {
    state.chatUnread = 0;
    markChatReadThroughLatestMessage();
    window.setTimeout(() => {
      scrollChatToEnd();
      els.chatInput.focus();
    }, 0);
  }
  updateChatChrome();
}

function syncChatUrl(isOpen) {
  const url = new URL(window.location.href);
  const hasOpenChat = url.searchParams.get("openChat") === "1";
  if (isOpen) {
    if (hasOpenChat) return;
    url.searchParams.set("openChat", "1");
    window.history.pushState({ chatOpen: true }, "", url);
    return;
  }
  if (!hasOpenChat) return;
  url.searchParams.delete("openChat");
  window.history.replaceState({ chatOpen: false }, "", url);
}

async function sendChatMessage(event) {
  event.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text || state.chatSending) return;

  haptic("tap");
  state.chatSending = true;
  els.chatSend.disabled = true;
  try {
    const response = await apiJson("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    els.chatInput.value = "";
    if (response.message) mergeChatMessage(response.message);
    haptic("success");
  } catch (error) {
    showError(error);
  } finally {
    state.chatSending = false;
    els.chatSend.disabled = false;
    if (state.chatOpen) els.chatInput.focus();
  }
}

function mergeChatMessage(message, { incoming = false } = {}) {
  const normalized = normalizeChatMessage(message);
  if (!normalized) return;

  const existingIndex = state.chatMessages.findIndex((candidate) => candidate.id === normalized.id);
  if (existingIndex >= 0) {
    state.chatMessages.splice(existingIndex, 1, normalized);
  } else {
    state.chatMessages.push(normalized);
    state.chatMessages = state.chatMessages.slice(-200);
    if (incoming && !state.chatOpen && isUnreadChatMessage(normalized)) state.chatUnread += 1;
  }

  if (state.chatOpen) markChatReadThroughLatestMessage();
  renderChatMessages({ scrollToEnd: state.chatOpen });
  updateChatChrome();
}

function updateChatUnreadFromMessages() {
  if (state.chatOpen) {
    state.chatUnread = 0;
    return;
  }
  state.chatUnread = state.chatMessages.filter(isUnreadChatMessage).length;
}

function isUnreadChatMessage(message) {
  if (!message || isOwnChatMessage(message)) return false;
  const marker = state.chatReadMarker || loadChatReadMarker();
  if (!marker?.id && !marker?.createdAt) return true;

  const markerIndex = marker.id
    ? state.chatMessages.findIndex((candidate) => candidate.id === marker.id)
    : -1;
  if (markerIndex >= 0) {
    const messageIndex = state.chatMessages.findIndex((candidate) => candidate.id === message.id);
    return messageIndex > markerIndex;
  }

  const markerTime = Date.parse(marker.createdAt);
  const messageTime = Date.parse(message.createdAt);
  if (Number.isFinite(markerTime) && Number.isFinite(messageTime)) {
    return messageTime > markerTime;
  }
  return true;
}

function markChatReadThroughLatestMessage() {
  const latest = state.chatMessages[state.chatMessages.length - 1];
  if (!latest) {
    state.chatUnread = 0;
    return;
  }
  state.chatUnread = 0;
  state.chatReadMarker = {
    id: latest.id,
    createdAt: latest.createdAt,
  };
  saveChatReadMarker(state.chatReadMarker, { syncServer: true });
}

function syncChatReadMarkerFromResponse(response) {
  const serverMarker = normalizeChatReadMarker(response?.readState?.marker || response?.chatReadMarker);
  const localMarker = state.chatReadMarker || loadChatReadMarker();
  if (serverMarker && (!localMarker || chatReadMarkerCompare(serverMarker, localMarker) >= 0)) {
    state.chatReadMarker = serverMarker;
    saveChatReadMarker(serverMarker, { syncServer: false });
    return;
  }

  if (localMarker) {
    state.chatReadMarker = localMarker;
    saveChatReadMarker(localMarker, { syncServer: !serverMarker || chatReadMarkerCompare(localMarker, serverMarker) > 0 });
  }
}

function loadChatReadMarker() {
  const value = safeStorageGet(chatReadStorageKey());
  if (!value) return null;
  try {
    const marker = JSON.parse(value);
    return normalizeChatReadMarker(marker);
  } catch {
    return normalizeChatReadMarker({ id: value });
  }
}

function saveChatReadMarker(marker, { syncServer = false } = {}) {
  const normalized = normalizeChatReadMarker(marker);
  if (!normalized) return;
  safeStorageSet(chatReadStorageKey(), JSON.stringify(normalized));
  if (syncServer) persistChatReadMarker(normalized).catch((error) => console.warn(error));
}

async function persistChatReadMarker(marker) {
  const normalized = normalizeChatReadMarker(marker);
  if (!normalized) return null;

  state.chatReadSavePromise = (state.chatReadSavePromise || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const response = await apiJson("/api/chat/read-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marker: normalized }),
      });
      const serverMarker = normalizeChatReadMarker(response?.readState?.marker || response?.marker);
      if (serverMarker && chatReadMarkerCompare(serverMarker, state.chatReadMarker) >= 0) {
        state.chatReadMarker = serverMarker;
        saveChatReadMarker(serverMarker, { syncServer: false });
        updateChatUnreadFromMessages();
        updateChatChrome();
      }
      return serverMarker;
    });

  return state.chatReadSavePromise;
}

function normalizeChatReadMarker(marker) {
  if (!marker || typeof marker !== "object") return null;
  const id = String(marker.id || "").trim();
  const createdAt = Number.isFinite(Date.parse(marker.createdAt))
    ? new Date(marker.createdAt).toISOString()
    : "";
  if (!id && !createdAt) return null;
  return { id, createdAt };
}

function chatReadMarkerCompare(left, right) {
  const leftMarker = normalizeChatReadMarker(left);
  const rightMarker = normalizeChatReadMarker(right);
  if (!leftMarker && !rightMarker) return 0;
  if (!leftMarker) return -1;
  if (!rightMarker) return 1;

  const leftIndex = chatMessageIndexForMarker(leftMarker);
  const rightIndex = chatMessageIndexForMarker(rightMarker);
  if (leftIndex >= 0 && rightIndex >= 0 && leftIndex !== rightIndex) {
    return leftIndex > rightIndex ? 1 : -1;
  }

  const leftTime = Date.parse(leftMarker.createdAt);
  const rightTime = Date.parse(rightMarker.createdAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime > rightTime ? 1 : -1;
  }

  if (leftMarker.id && rightMarker.id && leftMarker.id === rightMarker.id) return 0;
  return 0;
}

function chatMessageIndexForMarker(marker) {
  if (!marker?.id) return -1;
  return state.chatMessages.findIndex((message) => message.id === marker.id);
}

function chatReadStorageKey() {
  const identity = normalizeChatIdentity(state.currentUser?.username || state.currentUser?.displayName || "guest")
    || "guest";
  return `carpostclub.chatRead.${identity}`;
}

function normalizeChatMessage(message) {
  if (!message || typeof message !== "object") return null;
  const text = String(message.text || "").trim();
  if (!text) return null;
  const createdAt = Number.isFinite(Date.parse(message.createdAt))
    ? new Date(message.createdAt).toISOString()
    : new Date().toISOString();
  return {
    id: String(message.id || `${Date.now()}`),
    author: String(message.author || "CarPostClub").trim() || "CarPostClub",
    authorDisplayName: String(message.authorDisplayName || message.author || "CarPostClub").trim() || "CarPostClub",
    authorUsername: normalizeChatIdentity(message.authorUsername || message.username),
    text,
    createdAt,
  };
}

function renderChatMessages({ scrollToEnd = false } = {}) {
  const wasNearBottom = isChatScrolledToBottom();
  els.chatMessages.replaceChildren(...state.chatMessages.map((message) => {
    const item = document.createElement("article");
    item.className = "chat-message";
    item.classList.toggle("is-own", isOwnChatMessage(message));
    item.style.setProperty("--chat-user-color", chatColorForAuthor(chatIdentityKey(message)));

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";

    const author = document.createElement("strong");
    author.textContent = message.authorDisplayName || message.author;

    const time = document.createElement("time");
    time.dateTime = message.createdAt;
    time.textContent = formatChatTime(message.createdAt);

    const text = document.createElement("p");
    text.textContent = message.text;

    meta.append(author, time);
    item.append(meta, text);
    return item;
  }));
  els.chatEmpty.hidden = state.chatMessages.length > 0;

  if (scrollToEnd || wasNearBottom) {
    window.requestAnimationFrame(scrollChatToEnd);
  }
}

function updateChatChrome() {
  const unread = Math.min(state.chatUnread, 99);
  els.chatUnread.hidden = unread <= 0;
  els.chatUnread.textContent = unread === 99 && state.chatUnread > 99 ? "99+" : String(unread);
}

function isChatScrolledToBottom() {
  return els.chatMessages.scrollHeight - els.chatMessages.scrollTop - els.chatMessages.clientHeight < 48;
}

function scrollChatToEnd() {
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function isOwnChatMessage(message) {
  if (!state.currentUser) return false;
  const username = normalizeChatIdentity(message?.authorUsername);
  if (username) return username === normalizeChatIdentity(state.currentUser.username);

  const author = normalizeChatIdentity(message?.author);
  if (!author) return false;
  return [
    state.currentUser.displayName,
    state.currentUser.username,
  ].some((value) => normalizeChatIdentity(value) === author);
}

function normalizeChatIdentity(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function chatIdentityKey(message) {
  return message?.authorUsername || message?.author || message?.authorDisplayName || "CarPostClub";
}

function chatColorForAuthor(identity) {
  const palette = [
    "#0b6ec5",
    "#f35815",
    "#22a652",
    "#8f3ffc",
    "#b77900",
    "#d61f69",
    "#007c73",
    "#5d6b00",
  ];
  let hash = 0;
  for (const char of String(identity || "CarPostClub").toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

async function loadInventoryFilters() {
  const response = await apiJson("/api/inventory/dealerships");
  state.dealerships = response.dealerships;
  state.inventoryTypes = response.inventoryTypes;
  state.selectedInventoryTypeId = state.inventoryTypes.some((type) => type.id === state.selectedInventoryTypeId)
    ? state.selectedInventoryTypeId
    : response.defaultInventoryTypeId;
  state.selectedDealershipId = state.dealerships.some((dealership) => dealership.id === state.selectedDealershipId)
    ? state.selectedDealershipId
    : state.dealerships[0]?.id || "";
  els.sourceLink.href = response.sourceUrl || "https://www.oregans.com/inventory/";
  renderFilterOptions();
  persistSelection();
}

function renderFilterOptions() {
  const inventoryTypeOptions = state.inventoryTypes.map((type) => {
    const option = document.createElement("option");
    option.value = type.id;
    option.textContent = type.name;
    option.selected = type.id === state.selectedInventoryTypeId;
    return option;
  });
  els.inventoryTypeSelect.replaceChildren(...inventoryTypeOptions.map((option) => option.cloneNode(true)));
  els.manualInventoryTypeSelect.replaceChildren(...inventoryTypeOptions.map((option) => option.cloneNode(true)));
  els.inventoryTypeSelect.value = state.selectedInventoryTypeId;
  els.manualInventoryTypeSelect.value = state.selectedInventoryTypeId;

  const dealershipOptions = state.dealerships.map((dealership) => {
    const option = document.createElement("option");
    option.value = dealership.id;
    option.textContent = dealership.name;
    option.selected = dealership.id === state.selectedDealershipId;
    return option;
  });
  els.dealershipSelect.replaceChildren(...dealershipOptions.map((option) => option.cloneNode(true)));
  els.manualDealershipSelect.replaceChildren(...dealershipOptions.map((option) => option.cloneNode(true)));
  els.dealershipSelect.value = state.selectedDealershipId;
  els.manualDealershipSelect.value = state.selectedDealershipId;
}

function setManualCarFormOpen(isOpen, { feedback = false } = {}) {
  const wasOpen = state.manualFormOpen;
  if (feedback && Boolean(isOpen) !== state.manualFormOpen) haptic("select");
  state.manualFormOpen = Boolean(isOpen);
  els.manualCarForm.hidden = !state.manualFormOpen;
  els.pickerPanel.classList.toggle("is-manual-mode", state.manualFormOpen);
  els.addManualCarButton.classList.toggle("is-active", state.manualFormOpen);
  els.oregansSourceButton.classList.toggle("is-active", !state.manualFormOpen);
  els.addManualCarButton.setAttribute("aria-pressed", String(state.manualFormOpen));
  els.oregansSourceButton.setAttribute("aria-pressed", String(!state.manualFormOpen));
  els.pickerSubhead.textContent = state.manualFormOpen
    ? "Enter the vehicle details before uploading media."
    : inventoryFreshnessLabel();
  if (!state.manualFormOpen) {
    els.manualCarForm.reset();
    return;
  }
  if (!wasOpen) {
    state.selectedMake = "";
    state.selectedModel = "";
    state.carSearch = "";
    safeStorageRemove("carpostclub.carSearch");
    clearSelectedCarSelection();
    persistSelection();
    renderCarOptions();
    renderActiveCar();
  }
  els.manualInventoryTypeSelect.value = state.selectedInventoryTypeId;
  els.manualDealershipSelect.value = state.selectedDealershipId;
  els.manualYear.value = new Date().getFullYear();
  window.requestAnimationFrame(() => els.manualStockNumber.focus());
}

function renderInventoryFreshness() {
  if (state.manualFormOpen) return;
  els.pickerSubhead.textContent = inventoryFreshnessLabel();
}

function inventoryFreshnessLabel() {
  return state.inventoryFetchedAt
    ? `O'Regan's inventory refreshed ${formatDate(state.inventoryFetchedAt)}.`
    : "Choose from O'Regan's inventory.";
}

async function createManualCar(event) {
  event.preventDefault();
  const submitButton = els.manualCarForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const formData = new FormData(els.manualCarForm);
    const response = await apiJson("/api/manual-inventory/cars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData.entries())),
    });
    const car = response.car;
    state.selectedDealershipId = car.dealership.id;
    state.selectedInventoryTypeId = car.inventoryTypeId;
    state.selectedVin = carInventoryKey(car);
    persistSelection();
    setManualCarFormOpen(false);
    renderFilterOptions();
    await loadCars({ keepSelectedCar: true, forceAlbumRefresh: true });
    await loadAlbums();
    haptic("success");
    showStatus(`Added ${car.stockNumber || car.title}.`);
  } finally {
    submitButton.disabled = false;
  }
}

async function refreshInventoryAndAlbums() {
  await loadCars({ keepSelectedCar: true, forceAlbumRefresh: true });
  await loadAlbums();
  showStatus("Inventory and packages refreshed.");
}

async function loadCars({ keepSelectedCar = false, forceAlbumRefresh = false } = {}) {
  setSelectorBusy(true);
  try {
    const params = new URLSearchParams({
      dealershipId: state.selectedDealershipId,
      inventoryTypeId: state.selectedInventoryTypeId,
    });
    const response = await apiJson(`/api/inventory/cars?${params}`);
    state.cars = response.cars;
    state.inventoryFetchedAt = response.fetchedAt || "";
    syncVehicleFiltersWithInventory({ keepSelectedCar });
    const selected = selectedCar();
    if (!keepSelectedCar || !selected || !carMatchesVehicleFilters(selected)) clearSelectedCarSelection();
    renderCarOptions();
    persistSelection();
    await loadSelectedCarAlbum({ force: forceAlbumRefresh });
    applyInitialAlbumView();
    renderActiveCar();
    renderInventoryFreshness();
  } finally {
    setSelectorBusy(false);
  }
}

async function loadAlbums() {
  state.albumsLoading = true;
  renderAlbumList();
  try {
    const response = await apiJson("/api/albums");
    applyAlbumsResponse(response);
    renderAlbumList();
  } finally {
    state.albumsLoading = false;
    syncVehicleFiltersWithInventory({ keepSelectedCar: true });
    renderCarOptions();
    renderAlbumList();
  }
}

function applyAlbumsResponse(response) {
  state.albums = Array.isArray(response?.albums) ? response.albums : [];
  pruneOpenedUnreadAlbumVersions();
}

async function markGalleryAlbumSeen(albumId) {
  if (!albumId) return;
  const response = await apiJson(`/api/albums/${encodeURIComponent(albumId)}/seen`, {
    method: "POST",
  });
  applyAlbumsResponse(response);
  renderAlbumList();
}

function applyInitialAlbumView() {
  if (!state.initialOpenAlbum) return;
  if (state.activeAlbum?.id) state.expandedAlbumId = state.activeAlbum.id;
  state.initialOpenAlbum = false;
  clearInitialSelectionUrl();
}

function renderCarOptions() {
  renderVehicleFilterOptions();
  els.carSearchInput.value = state.carSearch;
  els.showPostedInventoryToggle.checked = state.showPostedInventory;
  const searchScopedCars = searchFilteredInventoryCars({ includeSelected: true });
  const matchingCars = filteredCars();
  els.carCount.textContent = carCountLabel(searchScopedCars.length, matchingCars.length);
  els.postedInventoryHint.textContent = postedInventoryHintText(matchingCars);
  const options = [
    new Option(carSelectPlaceholder(matchingCars.length), ""),
    ...matchingCars.map((car) => new Option(carOptionLabel(car), carInventoryKey(car))),
  ];
  els.carSelect.replaceChildren(...options);
  els.carSelect.value = matchingCars.some((car) => carInventoryKey(car) === state.selectedVin) ? state.selectedVin : "";
  els.carSelect.disabled = state.uploading || !matchingCars.length;
  renderCarSearchResults(matchingCars);
}

function renderCarSearchResults(cars) {
  const searching = Boolean(state.carSearch.trim());
  els.carSelect.hidden = searching;
  els.carSearchResults.hidden = !searching;
  if (!searching) {
    els.carSearchResults.replaceChildren();
    return;
  }

  if (!cars.length) {
    const empty = document.createElement("p");
    empty.className = "inventory-search-empty";
    empty.textContent = "No matching vehicles found.";
    els.carSearchResults.replaceChildren(empty);
    return;
  }

  els.carSearchResults.replaceChildren(...cars.slice(0, 24).map(renderCarSearchResult));
}

function renderCarSearchResult(car) {
  const button = document.createElement("button");
  button.className = "inventory-search-result";
  button.type = "button";
  button.dataset.inventoryKey = carInventoryKey(car);
  button.classList.toggle("is-selected", carInventoryKey(car) === state.selectedVin);
  const duplicateBlocked = selectedCarUploadDuplicateBlocked(car);
  button.disabled = state.uploading || duplicateBlocked;
  if (duplicateBlocked) button.setAttribute("aria-disabled", "true");

  const title = document.createElement("strong");
  title.textContent = [car.stockNumber || car.vin, car.title].filter(Boolean).join(" - ");

  const meta = document.createElement("span");
  meta.textContent = [
    car.dealership?.name,
    car.inventoryType,
    car.price,
    car.odometer,
    car.exteriorColor,
  ].filter(Boolean).join(" - ");

  const status = document.createElement("small");
  status.textContent = duplicateBlocked
    ? "Already uploaded"
    : (carAlreadyPosted(car) ? "Already posted" : "Available for upload");

  button.append(title, meta, status);
  return button;
}

function renderVehicleFilterOptions() {
  const searchScopedCars = searchFilteredInventoryCars({ includeSelected: true });
  const searching = Boolean(carSearchTerms().length);
  const makeValues = uniqueFilterValues(searchScopedCars, "make");
  if (state.selectedMake && !hasFilterValue(makeValues, state.selectedMake)) {
    state.selectedMake = "";
    state.selectedModel = "";
    clearSelectedCarSelection();
  }

  const makeOptions = [
    new Option(makeValues.length ? "All makes" : (searching ? "No makes match search" : "No makes found"), ""),
    ...makeValues.map((make) => new Option(make, make)),
  ];
  els.makeFilterSelect.replaceChildren(...makeOptions);
  els.makeFilterSelect.value = state.selectedMake;
  els.makeFilterSelect.disabled = state.uploading || !makeValues.length;

  const modelValues = state.selectedMake ? uniqueFilterValues(carsForMake(state.selectedMake, searchScopedCars), "model") : [];
  if (state.selectedModel && !hasFilterValue(modelValues, state.selectedModel)) {
    state.selectedModel = "";
  }

  const modelOptions = [
    new Option(state.selectedMake ? "All models" : "Choose make for models", ""),
    ...modelValues.map((model) => new Option(model, model)),
  ];
  els.modelFilterSelect.replaceChildren(...modelOptions);
  els.modelFilterSelect.value = state.selectedModel;
  els.modelFilterSelect.disabled = state.uploading || !state.selectedMake || !modelValues.length;
}

async function selectCar(inventoryKey) {
  const car = state.cars.find((candidate) => carInventoryKey(candidate) === inventoryKey);
  clearRecentUploadCompletion();
  if (car) {
    state.selectedMake = car.make || state.selectedMake;
    state.selectedModel = car.model || state.selectedModel;
  }
  state.selectedVin = inventoryKey;
  persistSelection();
  renderCarOptions();
  await loadSelectedCarAlbum({ force: true });
  renderActiveCar();
}

async function loadSelectedCarAlbum({ force = false, markSeen = true } = {}) {
  const car = selectedCar();
  if (!car) {
    state.activeAlbum = null;
    state.photos = [];
    return;
  }
  if (!force && state.activeAlbum?.vehicle?.inventoryKey === carInventoryKey(car)) {
    return;
  }

  const params = new URLSearchParams(carRequestPayload(car));
  if (!markSeen) params.set("markSeen", "0");
  const response = await apiJson(`/api/vehicle-album?${params}`);
  state.activeAlbum = response.album || null;
  state.photos = Array.isArray(response.photos) ? response.photos : [];
  if (state.activeAlbum?.id) {
    const localAlbum = albumById(state.activeAlbum.id);
    if (markSeen) rememberOpenedUnreadAlbum(localAlbum);
    state.expandedAlbumId = state.activeAlbum.id;
    persistAccountPreferences();
    if (markSeen) markGalleryAlbumSeen(state.activeAlbum.id).catch((error) => console.warn(error));
  }
}

function renderActiveCar() {
  const car = selectedCar();
  const duplicateBlocked = selectedCarUploadDuplicateBlocked(car);
  const unlocked = Boolean(car) && !state.uploading && !duplicateBlocked;
  els.uploadHint.textContent = uploadHintLabel(car, duplicateBlocked);
  els.uploadState.textContent = uploadStateLabel(car);
  els.dropZone.disabled = !unlocked;
  els.cameraButton.disabled = !unlocked;
  els.videoButton.disabled = !unlocked;
  els.carSelect.disabled = state.uploading || !filteredCars().length;
  renderUploadRecovery();
  renderAlbumList();
}

function selectedCarUploadDuplicateBlocked(car) {
  return Boolean(car && carAlreadyPosted(car) && state.currentUser?.role !== "admin");
}

function recentUploadCompletedForCar(car) {
  if (!car || !state.recentUploadCompletion) return false;
  const inventoryKey = carInventoryKey(car);
  if (!inventoryKey || state.recentUploadCompletion.inventoryKey !== inventoryKey) return false;
  const albumId = state.recentUploadCompletion.albumId;
  return !albumId || state.activeAlbum?.id === albumId || albumForCar(car)?.id === albumId;
}

function uploadHintLabel(car, duplicateBlocked = false) {
  if (!car) return "Choose inventory to create an album tile";
  if (recentUploadCompletedForCar(car)) return "Upload complete. Open this vehicle from the gallery to view the album.";
  if (duplicateBlocked) return "Already uploaded. Open this vehicle from the gallery instead.";
  if (carAlreadyPosted(car) && state.currentUser?.role === "admin") return "Admin override: adds media to the existing album tile";
  return "Adds to the selected album tile";
}

function renderAlbumList() {
  updateAlbumSectionHeading();
  if (state.page !== "gallery") renderGalleryFilterBar(null);
  if (state.page === "gallery") {
    renderGalleryAlbumList();
    return;
  }

  const tiles = albumTiles();
  els.albumList.classList.remove("is-folder-grid", "is-folder-open");
  els.albumCount.textContent = state.albumsLoading ? "..." : String(tiles.length);
  els.albumEmpty.textContent = "No album tiles yet";
  els.albumEmpty.hidden = state.albumsLoading || tiles.length > 0;
  els.albumList.replaceChildren(...tiles.map(renderAlbumCard));
}

function renderGalleryAlbumList() {
  const selectedFolder = selectedGalleryFolder();
  if (state.galleryDealershipId && !selectedFolder) {
    state.galleryDealershipId = "";
    persistAccountPreferences();
  }
  renderGalleryFilterBar(selectedFolder);

  if (!state.galleryDealershipId) {
    const folders = galleryDealershipFolders();
    els.albumList.classList.add("is-folder-grid");
    els.albumList.classList.remove("is-folder-open");
    els.albumCount.textContent = state.albumsLoading ? "..." : String(folders.length);
    els.albumEmpty.textContent = "No dealership folders yet";
    els.albumEmpty.hidden = state.albumsLoading || folders.length > 0;
    els.albumList.replaceChildren(...folders.map(renderGalleryFolderCard));
    return;
  }

  syncGalleryFilterSelections(selectedFolder);
  renderGalleryFilterBar(selectedFolder);
  const albums = filteredGalleryAlbums(selectedFolder.albums);
  els.albumList.classList.remove("is-folder-grid");
  els.albumList.classList.add("is-folder-open");
  els.albumCount.textContent = state.albumsLoading
    ? "..."
    : albums.length === selectedFolder.albums.length
      ? String(albums.length)
      : `${albums.length}/${selectedFolder.albums.length}`;
  els.albumEmpty.textContent = selectedFolder.albums.length ? "No vehicles match these filters" : "No vehicles posted yet";
  els.albumEmpty.hidden = state.albumsLoading || albums.length > 0;
  els.albumList.replaceChildren(renderGalleryFolderHeader(selectedFolder), ...albums.map(renderAlbumCard));
}

function updateAlbumSectionHeading() {
  if (state.page !== "gallery") {
    if (els.albumSectionTitle) els.albumSectionTitle.textContent = "Album tiles";
    if (els.albumSectionSubhead) els.albumSectionSubhead.textContent = "Saved packages";
    return;
  }

  const selectedFolder = selectedGalleryFolder();
  if (selectedFolder) {
    if (els.albumSectionTitle) els.albumSectionTitle.textContent = selectedFolder.name;
    if (els.albumSectionSubhead) {
      els.albumSectionSubhead.textContent = galleryFolderStatusSummary(selectedFolder);
    }
    return;
  }

  if (els.albumSectionTitle) els.albumSectionTitle.textContent = "Dealership folders";
  if (els.albumSectionSubhead) els.albumSectionSubhead.textContent = "Shared albums by lot";
}

function renderGalleryFilterBar(folder) {
  if (!els.galleryFilterBar) return;
  const visible = state.page === "gallery" && Boolean(folder);
  els.galleryFilterBar.hidden = !visible;
  if (!visible) return;

  syncGalleryFilterSelections(folder);
  els.gallerySearchInput.value = state.gallerySearch;
  els.galleryStatusFilter.value = state.galleryStatusFilter;

  const statusScopedAlbums = folder.albums.filter(galleryAlbumMatchesStatusFilter);
  const makeValues = uniqueGalleryFilterValues(statusScopedAlbums, (album) => album.vehicle?.make);
  const makeScopedAlbums = state.galleryMakeFilter
    ? statusScopedAlbums.filter((album) => sameFilterValue(album.vehicle?.make, state.galleryMakeFilter))
    : statusScopedAlbums;
  const modelValues = uniqueGalleryFilterValues(makeScopedAlbums, (album) => album.vehicle?.model);
  const yearValues = uniqueGalleryFilterValues(statusScopedAlbums, (album) => album.vehicle?.year);
  const uploaderValues = uniqueGalleryFilterValues(statusScopedAlbums, albumUploaderLabels);

  replaceFilterSelectOptions(els.galleryMakeFilter, "All makes", makeValues, state.galleryMakeFilter);
  replaceFilterSelectOptions(els.galleryModelFilter, state.galleryMakeFilter ? "All models" : "Choose make first", modelValues, state.galleryModelFilter);
  replaceFilterSelectOptions(els.galleryYearFilter, "All years", yearValues, state.galleryYearFilter);
  replaceFilterSelectOptions(els.galleryUploaderFilter, "All uploaders", uploaderValues, state.galleryUploaderFilter);
  els.galleryModelFilter.disabled = !state.galleryMakeFilter || !modelValues.length;
}

function syncGalleryFilterSelections(folder = selectedGalleryFolder()) {
  let changed = false;
  if (!["active", "inactive", "all"].includes(state.galleryStatusFilter)) {
    state.galleryStatusFilter = "active";
    safeStorageSet("carpostclub.galleryStatusFilter", state.galleryStatusFilter);
    changed = true;
  }
  if (!folder) {
    if (changed) scheduleAccountPreferencesSave();
    return;
  }

  const statusScopedAlbums = folder.albums.filter(galleryAlbumMatchesStatusFilter);
  const makeValues = uniqueGalleryFilterValues(statusScopedAlbums, (album) => album.vehicle?.make);
  if (state.galleryMakeFilter && !hasFilterValue(makeValues, state.galleryMakeFilter)) {
    state.galleryMakeFilter = "";
    state.galleryModelFilter = "";
    safeStorageRemove("carpostclub.galleryMakeFilter");
    safeStorageRemove("carpostclub.galleryModelFilter");
    changed = true;
  }

  const modelScopedAlbums = state.galleryMakeFilter
    ? statusScopedAlbums.filter((album) => sameFilterValue(album.vehicle?.make, state.galleryMakeFilter))
    : statusScopedAlbums;
  const modelValues = uniqueGalleryFilterValues(modelScopedAlbums, (album) => album.vehicle?.model);
  if (state.galleryModelFilter && !hasFilterValue(modelValues, state.galleryModelFilter)) {
    state.galleryModelFilter = "";
    safeStorageRemove("carpostclub.galleryModelFilter");
    changed = true;
  }

  const yearValues = uniqueGalleryFilterValues(statusScopedAlbums, (album) => album.vehicle?.year);
  if (state.galleryYearFilter && !hasFilterValue(yearValues, state.galleryYearFilter)) {
    state.galleryYearFilter = "";
    safeStorageRemove("carpostclub.galleryYearFilter");
    changed = true;
  }

  const uploaderValues = uniqueGalleryFilterValues(statusScopedAlbums, albumUploaderLabels);
  if (state.galleryUploaderFilter && !hasFilterValue(uploaderValues, state.galleryUploaderFilter)) {
    state.galleryUploaderFilter = "";
    safeStorageRemove("carpostclub.galleryUploaderFilter");
    changed = true;
  }
  if (changed) scheduleAccountPreferencesSave();
}

function replaceFilterSelectOptions(select, placeholder, values, selectedValue) {
  const options = [
    new Option(placeholder, ""),
    ...values.map((value) => new Option(value, value)),
  ];
  select.replaceChildren(...options);
  select.value = hasFilterValue(values, selectedValue) ? selectedValue : "";
  select.disabled = !values.length;
}

function filteredGalleryAlbums(albums) {
  return albums.filter(galleryAlbumMatchesFilters);
}

function galleryAlbumMatchesFilters(album) {
  if (!galleryAlbumMatchesStatusFilter(album)) return false;
  if (state.galleryMakeFilter && !sameFilterValue(album.vehicle?.make, state.galleryMakeFilter)) return false;
  if (state.galleryModelFilter && !sameFilterValue(album.vehicle?.model, state.galleryModelFilter)) return false;
  if (state.galleryYearFilter && !sameFilterValue(album.vehicle?.year, state.galleryYearFilter)) return false;
  if (state.galleryUploaderFilter && !albumUploaderLabels(album).some((value) => sameFilterValue(value, state.galleryUploaderFilter))) {
    return false;
  }

  const query = normalizeSearchText(state.gallerySearch);
  if (!query) return true;
  const searchText = normalizeSearchText(galleryAlbumSearchText(album));
  return query.split(/\s+/).filter(Boolean).every((token) => searchText.includes(token));
}

function galleryAlbumMatchesStatusFilter(album) {
  if (state.galleryStatusFilter === "inactive") return album.inventoryStatus?.active === false;
  if (state.galleryStatusFilter === "all") return true;
  return album.inventoryStatus?.active !== false;
}

function galleryAlbumSearchText(album) {
  return [
    album.name,
    albumInventoryLabel(album),
    album.vehicle?.vin,
    album.vehicle?.stockNumber,
    album.vehicle?.year,
    album.vehicle?.make,
    album.vehicle?.model,
    album.vehicle?.trim,
    album.vehicle?.price,
    album.vehicle?.odometer,
    album.vehicle?.exteriorColor,
    album.vehicle?.interiorColor,
    album.vehicle?.bodyStyle,
    album.vehicle?.fuelType,
    album.vehicle?.transmission,
    album.vehicle?.dealershipName || album.dealership?.name,
    album.inventoryStatus?.status,
    album.inventoryStatus?.label,
    ...albumUploaderLabels(album),
  ].filter(Boolean).join(" ");
}

function albumUploaderLabels(album) {
  const labels = [];
  const creator = userAccountLabel(album.createdBy);
  if (creator) labels.push(creator);
  for (const user of album.uploadedByUsers || []) {
    const label = userAccountLabel(user);
    if (label) labels.push(label);
  }
  return [...new Map(labels.map((label) => [normalizeSearchText(label), label])).values()];
}

function uniqueGalleryFilterValues(albums, picker) {
  const values = new Map();
  for (const album of albums) {
    const picked = picker(album);
    const candidates = Array.isArray(picked) ? picked : [picked];
    for (const value of candidates) {
      const text = String(value || "").trim();
      const key = normalizeSearchText(text);
      if (key && !values.has(key)) values.set(key, text);
    }
  }
  return [...values.values()].sort((a, b) => a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

function galleryFolderStatusSummary(folder) {
  const stats = galleryFolderStats(folder);
  const ready = `${stats.ready} active ${plural(stats.ready, "vehicle")} ready`;
  return [
    stats.unread ? `${stats.unread} new` : "",
    ready,
    stats.inactive ? `${stats.inactive} inactive` : "",
  ].filter(Boolean).join("; ");
}

function galleryFolderStats(folder) {
  const albums = folder?.albums || [];
  const inactive = albums.filter((album) => album.inventoryStatus?.active === false).length;
  const unread = albums.filter((album) => galleryAlbumIsUnread(album)).length;
  return {
    total: albums.length,
    inactive,
    unread,
    ready: albums.length - inactive,
  };
}

function galleryDealershipFolders() {
  const folders = new Map();
  state.dealerships.forEach((dealership, index) => {
    folders.set(dealership.id, {
      id: dealership.id,
      name: dealership.name,
      logoUrl: dealership.logoUrl || "",
      sortIndex: index,
      albums: [],
    });
  });

  for (const album of state.albums) {
    const id = albumDealershipId(album) || "unassigned";
    if (!folders.has(id)) {
      folders.set(id, {
        id,
        name: albumDealershipName(album) || "Unassigned dealership",
        logoUrl: album?.dealership?.logoUrl || "",
        sortIndex: Number.MAX_SAFE_INTEGER,
        albums: [],
      });
    }
    folders.get(id).albums.push(album);
  }

  return [...folders.values()].sort((left, right) => {
    if (left.sortIndex !== right.sortIndex) return left.sortIndex - right.sortIndex;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function selectedGalleryFolder() {
  if (!state.galleryDealershipId) return null;
  return galleryDealershipFolders().find((folder) => folder.id === state.galleryDealershipId) || null;
}

function galleryAlbumsForDealership(dealershipId) {
  return state.albums.filter((album) => albumDealershipId(album) === dealershipId);
}

function albumDealershipId(album) {
  return album?.vehicle?.dealershipId || album?.dealership?.id || "";
}

function albumDealershipName(album) {
  return album?.vehicle?.dealershipName || album?.dealership?.name || "";
}

function galleryAlbumIsUnread(album) {
  return Boolean(album?.unread && !galleryAlbumWasOpenedLocally(album));
}

function formatBadgeCount(count) {
  const value = Number(count) || 0;
  return value > 99 ? "99+" : String(value);
}

function renderGalleryFolderCard(folder) {
  const button = document.createElement("button");
  button.className = "gallery-folder-card";
  button.type = "button";
  button.dataset.action = "open-dealership-folder";
  button.dataset.dealershipId = folder.id;

  const latestAlbum = folder.albums[0] || null;
  const stats = galleryFolderStats(folder);
  button.classList.toggle("has-unread", stats.unread > 0);
  const cover = document.createElement("span");
  cover.className = "gallery-folder-cover";
  if (folder.logoUrl) {
    cover.classList.add("has-logo");
    const image = document.createElement("img");
    image.className = "gallery-folder-logo";
    image.src = folder.logoUrl;
    image.alt = `${folder.name} logo`;
    image.loading = "lazy";
    image.decoding = "async";
    cover.append(image);
  } else if (albumCoverThumbnailUrl(latestAlbum)) {
    const image = document.createElement("img");
    image.src = albumCoverThumbnailUrl(latestAlbum);
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    cover.append(image);
  } else {
    cover.textContent = folderInitials(folder.name);
  }

  const copy = document.createElement("span");
  copy.className = "gallery-folder-copy";
  const name = document.createElement("strong");
  name.textContent = folder.name;
  const count = document.createElement("span");
  count.textContent = [
    stats.unread ? `${stats.unread} new` : "",
    `${stats.ready} active ${plural(stats.ready, "vehicle")} ready`,
  ].filter(Boolean).join(" - ");
  const updated = document.createElement("small");
  updated.textContent = [
    stats.inactive ? `${stats.inactive} inactive` : "",
    latestAlbum?.updatedAt ? `Latest ${formatDate(latestAlbum.updatedAt)}` : "No vehicles posted yet",
  ].filter(Boolean).join(" - ");
  copy.append(name, count, updated);

  const open = document.createElement("span");
  open.className = "gallery-folder-open";
  open.textContent = "Open";

  button.append(cover, copy, open);
  if (stats.unread > 0) {
    const badge = document.createElement("span");
    badge.className = "gallery-unread-badge";
    badge.textContent = formatBadgeCount(stats.unread);
    button.append(badge);
  }
  return button;
}

function renderGalleryFolderHeader(folder) {
  const bar = document.createElement("div");
  bar.className = "gallery-folder-bar";

  const back = document.createElement("button");
  back.className = "icon-text-button subtle";
  back.type = "button";
  back.dataset.action = "back-gallery-folders";
  back.textContent = "Back";

  const crumb = document.createElement("span");
  crumb.className = "gallery-folder-crumb";
  crumb.textContent = `Dealership folders / ${folder.name}`;

  bar.append(back, crumb);
  return bar;
}

function folderInitials(name) {
  const words = String(name || "CP").replace(/O'Regan's/i, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "CP";
}

function albumTiles() {
  const selectedTile = selectedAlbumTile();
  if (!selectedTile) return state.albums;

  const selectedKey = albumVehicleKey(selectedTile);
  const savedTiles = state.albums.filter((album) => {
    if (album.id === selectedTile.id) return false;
    return !selectedKey || albumVehicleKey(album) !== selectedKey;
  });
  return [selectedTile, ...savedTiles];
}

function selectedAlbumTile() {
  const car = selectedCar();
  if (!car) return null;

  const savedAlbum = state.activeAlbum || albumForCar(car);
  if (savedAlbum?.id) {
    return {
      ...savedAlbum,
      isSelected: true,
      mediaCount: state.activeAlbum?.id === savedAlbum.id ? state.photos.length : savedAlbum.mediaCount,
      vehicle: savedAlbum.vehicle || vehicleFromCar(car),
    };
  }

  return {
    id: selectedAlbumPendingId(car),
    isPending: true,
    isSelected: true,
    name: car.title || "Selected vehicle",
    coverUrl: "",
    coverThumbnailUrl: "",
    mediaCount: 0,
    updatedAt: "",
    dealership: car.dealership || selectedDealership(),
    vehicle: vehicleFromCar(car),
    inventoryStatus: selectedCarInventoryStatus(car),
  };
}

function albumForCar(car) {
  const key = carInventoryKey(car);
  if (!key) return null;
  return state.albums.find((album) => albumVehicleKey(album) === key) || null;
}

function albumVehicleKey(album) {
  const vehicle = album?.vehicle || {};
  return vehicle.inventoryKey || vehicle.manualInventoryId || vehicle.vin || "";
}

function selectedAlbumPendingId(car) {
  return `selected-${slugifyClient(carInventoryKey(car) || car.stockNumber || car.title)}`;
}

function vehicleFromCar(car) {
  return {
    title: car.title || "",
    year: car.year || "",
    make: car.make || "",
    model: car.model || "",
    trim: car.trim || "",
    stockNumber: car.stockNumber || "",
    vin: car.vin || "",
    manualInventoryId: car.manualInventoryId || "",
    inventoryKey: carInventoryKey(car),
    dealershipId: car.dealership?.id || state.selectedDealershipId,
    dealershipName: car.dealership?.name || selectedDealership()?.name || "",
    inventoryTypeId: car.inventoryTypeId || state.selectedInventoryTypeId,
  };
}

function selectedCarInventoryStatus(car) {
  if (car?.source === "manual") {
    return {
      status: "manual",
      label: "Manual inventory.",
      lifecycle: {
        sourceStatus: "manual",
        packageStatus: "needs_photos",
        facebookState: "do_not_post",
        facebookAction: "manual_review",
        shouldMarkFacebookSold: false,
        canPostToFacebook: false,
      },
    };
  }
  return {
    status: "active",
    checkedAt: state.inventoryFetchedAt,
    label: inventoryFreshnessLabel(),
    lifecycle: {
      sourceStatus: "source_active",
      packageStatus: "needs_photos",
      facebookState: "needs_photos",
      facebookAction: "capture_photos",
      shouldMarkFacebookSold: false,
      canPostToFacebook: false,
    },
  };
}

function renderAlbumCard(album) {
  const isGalleryPage = state.page === "gallery";
  const isOpen = album.isSelected || state.expandedAlbumId === album.id;
  const article = document.createElement("article");
  article.className = "album-card";
  article.classList.toggle("is-gallery-album", isGalleryPage);
  article.classList.toggle("is-collapsed", isGalleryPage && !isOpen);
  article.classList.toggle("is-open", isOpen);
  article.classList.toggle("is-selected", Boolean(album.isSelected));
  article.classList.toggle("is-unread", isGalleryPage && galleryAlbumIsUnread(album));
  article.classList.toggle("is-source-removed", album.inventoryStatus?.lifecycle?.sourceStatus === "source_removed" || album.inventoryStatus?.active === false);

  const summary = document.createElement("button");
  summary.className = "album-summary-button";
  summary.type = "button";
  summary.dataset.albumId = album.id;
  if (!album.isPending) summary.dataset.action = "toggle-album";
  summary.setAttribute("aria-expanded", String(isOpen));
  if (album.isSelected) summary.setAttribute("aria-current", "true");

  const cover = document.createElement("span");
  cover.className = "album-cover";
  const coverThumbnailUrl = albumCoverThumbnailUrl(album);
  if (coverThumbnailUrl) {
    const image = document.createElement("img");
    image.src = coverThumbnailUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    cover.append(image);
  } else {
    cover.textContent = "CP";
  }

  const copy = document.createElement("span");
  copy.className = "album-summary-copy";
  const title = document.createElement("strong");
  title.textContent = albumSummaryTitle(album, { inventoryFirst: isGalleryPage });
  copy.append(title);

  const descriptionLine = isGalleryPage ? albumSummaryDescription(album) : "";
  if (descriptionLine) {
    const description = document.createElement("span");
    description.className = "album-summary-description";
    description.textContent = descriptionLine;
    copy.append(description);
  }

  const meta = document.createElement("span");
  meta.className = "album-summary-meta";
  meta.textContent = [
    album.isSelected ? "Selected" : "",
    ...(!isGalleryPage ? [album.vehicle?.stockNumber || album.inventoryNumber] : []),
    ...(isGalleryPage ? [albumCreatorLabel(album), albumUploaderCountLabel(album)] : []),
    album.vehicle?.dealershipName || album.dealership?.name,
    `${album.mediaCount || 0} ${plural(album.mediaCount || 0, "asset")}`,
    album.updatedAt && `Updated ${formatDate(album.updatedAt)}`,
  ].filter(Boolean).join(" · ");
  copy.append(meta);

  const status = inventoryStatusBadge(album.inventoryStatus);
  summary.append(cover, copy, status);
  article.append(summary);
  if (isGalleryPage && galleryAlbumIsUnread(album)) {
    const badge = document.createElement("span");
    badge.className = "album-unread-badge";
    badge.textContent = "New Post";
    article.append(badge);
  }

  if (isOpen) article.append(renderAlbumDetail(album));
  return article;
}

function renderAlbumDetail(album) {
  const detail = document.createElement("div");
  detail.className = "album-detail";
  const albumDetails = state.albumDetails[album.id] || {};
  const photos = album.isSelected && state.activeAlbum?.id === album.id
    ? state.photos
    : Array.isArray(albumDetails.photos)
      ? albumDetails.photos
      : [];
  const hasMedia = photos.length > 0 || album.mediaCount > 0;
  const canUseSavedAlbum = Boolean(album.id && !album.isPending);
  const preparingShareFiles = state.page === "gallery"
    && iPhonePhotoShareAvailable()
    && (albumDetails.loading || albumPhotoSharePreparing(album.id, photos));

  const actions = document.createElement("div");
  actions.className = "album-detail-actions";

  if (state.page === "gallery") {
    actions.append(
      albumPlaceholderActionButton(galleryPhotoActionButtonLabel(album.id, photos, { loading: albumDetails.loading }), {
        action: "download-or-share-album-photos",
        albumId: album.id,
        disabled: !canUseSavedAlbum || !hasMedia || state.photoShareBusy || preparingShareFiles,
      })
    );
    if (canManageAlbumMedia()) {
      actions.append(albumPlaceholderActionButton("Delete Upload", {
        danger: true,
        action: "delete-album-media",
        albumId: album.id,
        disabled: !canUseSavedAlbum || !hasMedia,
      }));
    }
  } else if (!album.isSelected && canUseSavedAlbum) {
    const openButton = document.createElement("button");
    openButton.className = "icon-text-button subtle";
    openButton.type = "button";
    openButton.dataset.action = "select-album";
    openButton.dataset.albumId = album.id;
    openButton.textContent = "Select";
    actions.append(openButton);
    appendUploadAlbumActions(actions, album, { canUseSavedAlbum, hasMedia });
  } else {
    appendUploadAlbumActions(actions, album, { canUseSavedAlbum, hasMedia });
  }

  const statusLine = document.createElement("p");
  statusLine.className = "album-status-line";
  statusLine.textContent = inventoryStatusLabel(album.inventoryStatus);

  const media = document.createElement("div");
  media.className = "album-media-strip";
  if (albumDetails.loading) {
    media.textContent = "Loading media";
  } else if (!photos.length) {
    media.textContent = hasMedia ? "Open again to refresh media" : "No media saved";
  } else {
    media.replaceChildren(...photos.map(renderAlbumMediaThumb));
  }

  const saveHint = renderAlbumSaveHint(photos);
  detail.append(actions, statusLine);
  if (state.page === "gallery") {
    detail.append(renderAlbumPostingKit(album, albumDetails), renderAlbumDescription(albumDetails));
  }
  if (saveHint) detail.append(saveHint);
  detail.append(media);
  return detail;
}

function renderAlbumSaveHint(photos) {
  if (!imageAlbumPhotos(photos).length) return null;
  const hint = document.createElement("p");
  hint.className = "album-save-hint";
  hint.textContent = "iPhone fallback: tap a photo to open it full size, then press and hold it and choose Save to Photos.";
  return hint;
}

function galleryPhotoActionButtonLabel(albumId = "", photos = [], { loading = false } = {}) {
  if (state.photoShareBusy || (iPhonePhotoShareAvailable() && (loading || albumPhotoSharePreparing(albumId, photos)))) return "Preparing Photos";
  return iPhonePhotoShareAvailable() ? "Share Photos" : "Download Photos";
}

function appendUploadAlbumActions(actions, album, { canUseSavedAlbum, hasMedia }) {
  const descriptionLink = albumActionLink(album, "Description", `/api/albums/${encodeURIComponent(album.id)}/description.txt`, canUseSavedAlbum && hasMedia);
  const filesButton = document.createElement("button");
  filesButton.className = "icon-text-button subtle";
  filesButton.type = "button";
  filesButton.dataset.action = "download-album-files";
  filesButton.dataset.albumId = album.id;
  filesButton.disabled = !canUseSavedAlbum || !hasMedia;
  filesButton.textContent = "Download all";
  const packageLink = albumActionLink(album, "Package", `/api/albums/${encodeURIComponent(album.id)}/package`, canUseSavedAlbum && hasMedia);
  actions.append(descriptionLink, filesButton, packageLink);

  if (canManageAlbumMedia() && canUseSavedAlbum && hasMedia) {
    const clearButton = document.createElement("button");
    clearButton.className = "icon-text-button subtle danger";
    clearButton.type = "button";
    clearButton.dataset.action = "delete-album-media";
    clearButton.dataset.albumId = album.id;
    clearButton.textContent = "Delete all";
    actions.append(clearButton);
  }
}

function albumPlaceholderActionButton(label, {
  danger = false,
  action = "",
  albumId = "",
  disabled = true,
} = {}) {
  const button = document.createElement("button");
  button.className = `icon-text-button subtle${danger ? " danger" : ""}`;
  button.type = "button";
  button.disabled = Boolean(disabled);
  if (action && !button.disabled) button.dataset.action = action;
  if (albumId && !button.disabled) button.dataset.albumId = albumId;
  button.textContent = label;
  return button;
}

function renderAlbumPostingKit(album, albumDetails) {
  const section = document.createElement("section");
  section.className = "album-posting-kit";

  const heading = document.createElement("div");
  heading.className = "album-posting-kit-heading";
  const title = document.createElement("strong");
  title.textContent = "Posting kit";
  const actions = document.createElement("span");
  actions.className = "album-posting-kit-actions";

  const draftReady = Boolean(albumDetails.draft) && !albumDetails.draftLoading;
  for (const [kind, label] of [
    ["title", "Copy title"],
    ["details", "Copy details"],
    ["description", "Copy description"],
  ]) {
    const button = document.createElement("button");
    button.className = "album-copy-button";
    button.type = "button";
    button.dataset.action = "copy-album-text";
    button.dataset.albumId = album.id;
    button.dataset.copyKind = kind;
    button.disabled = !draftReady;
    button.textContent = label;
    actions.append(button);
  }

  heading.append(title, actions);
  const rows = document.createElement("div");
  rows.className = "album-field-grid";
  rows.replaceChildren(...albumPostingKitRows(album, albumDetails.draft).map(renderAlbumFieldRow));

  section.append(heading, rows);
  return section;
}

function renderAlbumFieldRow(row) {
  const item = document.createElement("div");
  item.className = "album-field-row";

  const text = document.createElement("span");
  text.className = "album-field-text";
  const label = document.createElement("small");
  label.textContent = row.label;
  const value = document.createElement(row.href ? "a" : "strong");
  value.textContent = row.value;
  if (row.href) {
    value.href = row.href;
    value.target = "_blank";
    value.rel = "noreferrer";
  }
  text.append(label, value);

  const copy = document.createElement("button");
  copy.className = "album-copy-button subtle";
  copy.type = "button";
  copy.dataset.action = "copy-field-text";
  copy.dataset.copyLabel = row.label;
  copy.dataset.copyValue = row.value;
  copy.textContent = "Copy";

  item.append(text, copy);
  return item;
}

function renderAlbumDescription(albumDetails) {
  const section = document.createElement("section");
  section.className = "album-description";

  const title = document.createElement("strong");
  title.textContent = "Description";

  const body = document.createElement("p");
  const description = albumDetails.draft?.description || "";
  if (albumDetails.draftLoading) {
    section.classList.add("is-muted");
    body.textContent = "Loading description";
  } else if (description) {
    body.textContent = description;
  } else {
    section.classList.add("is-muted");
    body.textContent = albumDetails.draftError || "Description is not ready for this album yet.";
  }

  section.append(title, body);
  return section;
}

function albumPostingKitRows(album, draft = null) {
  const vehicle = album?.vehicle || {};
  const fields = draft?.fields || {};
  const rows = [
    ["Marketplace title", draft?.title || albumSummaryTitle(album, { inventoryFirst: true })],
    ["Year", fields.year || vehicle.year],
    ["Make", fields.make || vehicle.make],
    ["Model", fields.model || vehicle.model],
    ["Trim", vehicle.trim],
    ["Price", formatMarketplacePrice(fields.price) || vehicle.price],
    ["Mileage", formatMarketplaceMileage(fields.mileage) || vehicle.odometer],
    ["Dealership", fields.dealershipName || vehicle.dealershipName || album?.dealership?.name],
    ["Location", fields.location],
    ["Stock", vehicle.stockNumber || album.inventoryNumber],
    ["VIN", vehicle.vin],
    ["Body style", fields.bodyStyle || vehicle.bodyStyle],
    ["Exterior color", fields.exteriorColor || vehicle.exteriorColor],
    ["Interior color", fields.interiorColor || vehicle.interiorColor],
    ["Fuel type", fields.fuelType || vehicle.fuelType],
    ["Transmission", fields.transmission || vehicle.transmission],
  ].map(([label, value]) => ({ label, value: normalizeCopyValue(value) })).filter((row) => row.value);

  const sourceUrl = vehicle.detailUrl || album?.sourceUrl;
  if (sourceUrl) rows.push({ label: "Source listing", value: sourceUrl, href: sourceUrl });
  return rows;
}

function formatMarketplacePrice(value) {
  if (!value && value !== 0) return "";
  if (typeof value === "number" && Number.isFinite(value)) return `$${value.toLocaleString("en-CA")}`;
  return String(value || "");
}

function formatMarketplaceMileage(value) {
  if (!value && value !== 0) return "";
  if (typeof value === "number" && Number.isFinite(value)) return `${value.toLocaleString("en-CA")} km`;
  return String(value || "");
}

function normalizeCopyValue(value) {
  return String(value || "").trim();
}

async function copyAlbumText(albumId, kind) {
  const details = await loadAlbumDetails(albumId, { includeDraft: true });
  const album = albumById(albumId) || details.album;
  const text = albumCopyText(kind, album, details.draft);
  await copyTextValue(text, albumCopyLabel(kind));
}

function albumCopyText(kind, album, draft = null) {
  if (kind === "title") return normalizeCopyValue(draft?.title || albumSummaryTitle(album, { inventoryFirst: true }));
  if (kind === "description") return normalizeCopyValue(draft?.description);
  return normalizeCopyValue(draft?.copyText || buildAlbumDetailsCopyText(album, draft));
}

function buildAlbumDetailsCopyText(album, draft = null) {
  const rows = albumPostingKitRows(album, draft);
  const description = normalizeCopyValue(draft?.description);
  return [
    ...rows.map((row) => `${row.label}: ${row.value}`),
    description ? `Description:\n${description}` : "",
  ].filter(Boolean).join("\n");
}

function albumCopyLabel(kind) {
  if (kind === "title") return "title";
  if (kind === "description") return "description";
  return "details";
}

async function copyTextValue(text, label = "text") {
  const value = normalizeCopyValue(text);
  if (!value) {
    showStatus(`No ${label} available to copy.`);
    return;
  }

  await writeClipboardText(value);
  showStatus(`Copied ${label}.`);
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function albumSummaryTitle(album, { inventoryFirst = false } = {}) {
  const title = album.vehicle?.title || album.name || "Vehicle package";
  const inventory = albumInventoryLabel(album);
  if (!inventoryFirst || !inventory) return title;
  return title.toLowerCase().includes(inventory.toLowerCase()) ? title : `${inventory} · ${title}`;
}

function albumInventoryLabel(album) {
  return [
    album.vehicle?.stockNumber,
    album.inventoryNumber,
    album.vehicle?.manualInventoryId,
    album.vehicle?.inventoryKey,
    album.vehicle?.vin,
  ].find(Boolean) || "";
}

function albumSummaryDescription(album) {
  const preview = album.descriptionPreview || album.vehicle?.descriptionPreview;
  if (preview) return preview;
  return [
    album.vehicle?.price,
    album.vehicle?.odometer,
    album.vehicle?.exteriorColor && `${album.vehicle.exteriorColor} exterior`,
    album.vehicle?.interiorColor && `${album.vehicle.interiorColor} interior`,
    album.vehicle?.bodyStyle,
    album.vehicle?.fuelType,
    album.vehicle?.transmission,
  ].filter(Boolean).join(" · ");
}

function albumCreatorLabel(album) {
  const creator = album.createdBy || album.uploadedByUsers?.[0];
  const label = userAccountLabel(creator);
  return label ? `Created by ${label}` : "Creator unknown";
}

function albumUploaderCountLabel(album) {
  const count = Array.isArray(album.uploadedByUsers) ? album.uploadedByUsers.length : 0;
  if (count <= 1) return "";
  return `${count} uploaders`;
}

function userAccountLabel(user) {
  return user?.displayName || user?.username || "";
}

function albumActionLink(album, label, href, available) {
  const link = document.createElement("a");
  link.className = "icon-text-button subtle";
  link.href = available ? href : "#";
  link.dataset.albumId = album.id;
  link.textContent = label;
  link.setAttribute("aria-disabled", String(!available));
  link.classList.toggle("is-disabled", !available);
  link.tabIndex = available ? 0 : -1;
  return link;
}

function albumCoverThumbnailUrl(album) {
  return album?.coverThumbnailUrl || "";
}

function renderAlbumMediaThumb(photo) {
  const item = document.createElement("div");
  item.className = "album-media-item";
  const mediaName = photo.originalName || photo.filename || "Media asset";

  const preview = document.createElement("a");
  preview.className = "album-media-thumb";
  preview.href = photo.url;
  preview.target = "_blank";
  preview.rel = "noreferrer";
  preview.title = `${mediaName} · ${photoUploaderLabel(photo)}`;

  if (isVideoMedia(photo)) {
    const videoLabel = document.createElement("span");
    videoLabel.textContent = "Video";
    preview.append(videoLabel);
  } else {
    preview.classList.add("is-image");
    preview.title = `Open ${mediaName} full size. On iPhone, press and hold the full-size image to save to Photos.`;
    preview.setAttribute("aria-label", preview.title);
    const image = document.createElement("img");
    image.src = photo.thumbnailUrl || "";
    image.alt = mediaName;
    image.loading = "lazy";
    image.decoding = "async";
    const saveBadge = document.createElement("span");
    saveBadge.className = "album-media-save-badge";
    saveBadge.textContent = "Open to save";
    preview.append(image, saveBadge);
  }

  const name = document.createElement("span");
  name.className = "album-media-name";
  name.textContent = mediaName;
  name.title = mediaName;

  const actions = document.createElement("div");
  actions.className = "album-media-actions";

  const downloadLink = document.createElement("a");
  downloadLink.className = "album-media-action";
  downloadLink.href = photo.downloadUrl || `${photo.url}?download=1`;
  downloadLink.download = photo.downloadName || mediaName;
  downloadLink.rel = "noreferrer";
  downloadLink.textContent = "Download";
  downloadLink.title = `Download ${mediaName}`;

  const deleteButton = document.createElement("button");
  deleteButton.className = "album-media-action danger";
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-album-photo";
  deleteButton.dataset.albumId = photo.albumId || "";
  deleteButton.dataset.filename = photo.filename || "";
  deleteButton.dataset.originalName = mediaName;
  deleteButton.hidden = !canManageAlbumMedia();
  deleteButton.disabled = !canManageAlbumMedia() || !photo.albumId || !photo.filename;
  deleteButton.textContent = "Delete";
  deleteButton.title = `Delete ${mediaName}`;

  actions.append(downloadLink, deleteButton);
  item.append(preview, name, actions);
  return item;
}

function canManageAlbumMedia() {
  return state.currentUser?.role === "admin";
}

function inventoryStatusBadge(status) {
  const badge = document.createElement("span");
  badge.className = "inventory-status-badge";
  const statusName = status?.status || "unknown";
  badge.classList.add(`is-${statusName}`);
  const sourceStatus = String(status?.lifecycle?.sourceStatus || "").replace(/_/g, "-");
  if (sourceStatus) badge.classList.add(`is-${sourceStatus}`);
  badge.textContent = statusName === "active"
    ? "Active"
    : statusName === "missing"
      ? "Source removed"
      : statusName === "manual"
        ? "Manual"
        : "Unknown";
  badge.title = inventoryStatusLabel(status);
  return badge;
}

function inventoryStatusLabel(status) {
  if (!status) return "Inventory status unavailable.";
  if (status.status === "active") {
    return `Active in O'Regan's inventory as of ${formatDate(status.checkedAt)}.`;
  }
  if (status.status === "missing") {
    const base = `No longer active in O'Regan's inventory as of ${formatDate(status.checkedAt)}.`;
    return status.lifecycle?.facebookAction === "mark_sold"
      ? `${base} Facebook sync action: mark any matching Konner John Marketplace listing sold; do not delete it.`
      : base;
  }
  return status.label || "Inventory status unavailable.";
}

async function handleAlbumListClick(event) {
  const disabledLink = event.target.closest?.("a.is-disabled");
  if (disabledLink) {
    event.preventDefault();
    return;
  }

  const target = event.target.closest?.("[data-action]");
  if (!target) return;
  if (target.dataset.action === "copy-field-text") {
    haptic("tap");
    await copyTextValue(target.dataset.copyValue || "", target.dataset.copyLabel || "field");
    return;
  }
  if (target.dataset.action === "open-dealership-folder") {
    haptic("select");
    const dealershipId = target.dataset.dealershipId || "";
    state.galleryDealershipId = dealershipId;
    state.expandedAlbumId = "";
    persistAccountPreferences();
    renderAlbumList();
    return;
  }
  if (target.dataset.action === "back-gallery-folders") {
    haptic("tap");
    state.galleryDealershipId = "";
    state.expandedAlbumId = "";
    clearInactivePhotoSharePreparations("");
    persistAccountPreferences();
    renderAlbumList();
    return;
  }
  const albumId = target.dataset.albumId;
  if (!albumId) return;

  try {
    if (target.dataset.action === "toggle-album") {
      haptic("tap");
      await toggleAlbum(albumId);
    } else if (target.dataset.action === "select-album") {
      haptic("select");
      await selectAlbumPackage(albumId);
    } else if (target.dataset.action === "download-album-files") {
      haptic("tap");
      const details = await loadAlbumDetails(albumId);
      const album = albumById(albumId) || details.album;
      await downloadAlbumFiles(album, details.photos || []);
    } else if (target.dataset.action === "download-or-share-album-photos") {
      haptic("tap");
      await downloadOrShareAlbumPhotos(albumId);
    } else if (target.dataset.action === "share-album-photos") {
      haptic("tap");
      await downloadOrShareAlbumPhotos(albumId);
    } else if (target.dataset.action === "copy-album-text") {
      haptic("tap");
      await copyAlbumText(albumId, target.dataset.copyKind || "details");
    } else if (target.dataset.action === "delete-album-media") {
      haptic("warning");
      await deleteAlbumMedia(albumId);
    } else if (target.dataset.action === "delete-album-photo") {
      haptic("warning");
      await deleteAlbumPhoto(albumId, target.dataset.filename, target.dataset.originalName);
    }
  } catch (error) {
    showError(error);
  }
}

async function toggleAlbum(albumId) {
  if (state.expandedAlbumId === albumId) {
    clearInactivePhotoSharePreparations("");
    state.expandedAlbumId = "";
    persistAccountPreferences();
    renderAlbumList();
    return;
  }

  clearInactivePhotoSharePreparations(albumId);
  state.expandedAlbumId = albumId;
  state.photoShareActiveAlbumId = albumId;
  const album = albumById(albumId);
  rememberOpenedUnreadAlbum(album);
  const existingDetails = state.albumDetails[albumId] || {};
  if (!Array.isArray(existingDetails.photos)) {
    state.albumDetails[albumId] = {
      ...existingDetails,
      loading: true,
      draftLoading: state.page === "gallery" && !existingDetails.draft,
    };
  }
  persistAccountPreferences();
  renderAlbumList();
  markGalleryAlbumSeen(albumId).catch((error) => console.warn(error));
  await loadAlbumDetails(albumId, { includeDraft: state.page === "gallery" });
  renderAlbumList();
}

async function loadAlbumDetails(albumId, { force = false, includeDraft = false } = {}) {
  const existing = state.albumDetails[albumId] || {};
  const needsPhotos = force || !Array.isArray(existing.photos);
  const needsDraft = includeDraft && (force || !existing.draft);
  if (!needsPhotos && !needsDraft) return existing;

  state.albumDetails[albumId] = {
    ...existing,
    loading: needsPhotos,
    draftLoading: needsDraft,
    draftError: needsDraft ? "" : existing.draftError,
  };
  renderAlbumList();
  try {
    const draftPromise = needsDraft
      ? apiJson(`/api/albums/${encodeURIComponent(albumId)}/marketplace-draft`)
        .then((response) => ({ response }))
        .catch((error) => ({ error }))
      : Promise.resolve(null);

    if (needsPhotos) {
      const photosResponse = await apiJson(`/api/albums/${encodeURIComponent(albumId)}/photos`);
      state.albumDetails[albumId] = {
        ...state.albumDetails[albumId],
        album: photosResponse.album,
        photos: photosResponse.photos || [],
        loading: false,
      };
      updateAlbumSummary(photosResponse.album);
      if (albumPhotoShareCanPrepare(albumId)) prepareAlbumShareFiles(albumId, photosResponse.photos || []);
      if (needsDraft) renderAlbumList();
    } else {
      state.albumDetails[albumId] = { ...state.albumDetails[albumId], loading: false };
    }

    const draftResult = await draftPromise;
    const nextDetails = { ...state.albumDetails[albumId], draftLoading: false };
    if (draftResult?.response) {
      nextDetails.draft = draftResult.response.draft || null;
      nextDetails.draftError = "";
      updateAlbumSummary(draftResult.response.album);
    } else if (draftResult?.error) {
      nextDetails.draftError = draftResult.error instanceof Error
        ? draftResult.error.message
        : "Description unavailable.";
    }
    state.albumDetails[albumId] = nextDetails;
    return nextDetails;
  } catch (error) {
    state.albumDetails[albumId] = { ...existing, loading: false, draftLoading: false };
    throw error;
  }
}

function updateAlbumSummary(album) {
  if (!album?.id) return;
  const index = state.albums.findIndex((candidate) => candidate.id === album.id);
  if (index >= 0) state.albums.splice(index, 1, album);
}

async function selectAlbumPackage(albumId) {
  const album = albumById(albumId);
  if (!album?.vehicle) return;
  if (album.inventoryStatus?.active === false) {
    showStatus(album.inventoryStatus.label);
    return;
  }

  if (state.page === "gallery") {
    window.location.href = uploadPageUrlForAlbum(album);
    return;
  }

  state.selectedDealershipId = album.vehicle.dealershipId || album.dealership?.id || state.selectedDealershipId;
  state.selectedInventoryTypeId = album.vehicle.inventoryTypeId || album.inventoryTypeId || state.selectedInventoryTypeId;
  state.selectedMake = album.vehicle.make || "";
  state.selectedModel = album.vehicle.model || "";
  state.selectedVin = album.vehicle.inventoryKey || album.vehicle.manualInventoryId || album.vehicle.vin || "";
  persistSelection();
  renderFilterOptions();
  await loadCars({ keepSelectedCar: true, forceAlbumRefresh: true });
  if (selectedCar()) {
    if (state.activeAlbum?.id) {
      state.expandedAlbumId = state.activeAlbum.id;
      persistAccountPreferences();
    }
    renderAlbumList();
    showStatus(`Opened ${album.vehicle.stockNumber || album.name}.`);
  } else {
    showStatus("Package is saved, but it is not selectable in the current inventory feed.");
  }
}

function uploadPageUrlForAlbum(album) {
  const params = new URLSearchParams();
  const vehicle = album?.vehicle || {};
  const dealershipId = vehicle.dealershipId || album?.dealership?.id || "";
  const inventoryTypeId = vehicle.inventoryTypeId || album?.inventoryTypeId || "";
  const inventoryKey = vehicle.inventoryKey || vehicle.manualInventoryId || vehicle.vin || "";

  if (dealershipId) params.set("dealershipId", dealershipId);
  if (inventoryTypeId) params.set("inventoryTypeId", inventoryTypeId);
  if (inventoryKey) params.set("inventoryKey", inventoryKey);
  params.set("openAlbum", "1");

  const query = params.toString();
  return query ? `/?${query}` : "/";
}

async function downloadAlbumFiles(album, photos) {
  if (!album?.id || !photos.length) return;
  const downloads = photos.map((photo) => ({
    href: photo.downloadUrl || `${photo.url}?download=1`,
    download: photo.downloadName || photo.originalName || photo.filename,
  }));

  downloads.forEach((download, index) => {
    window.setTimeout(() => triggerFileDownload(download.href, download.download), index * 220);
  });
  showStatus(`Starting ${downloads.length} media ${plural(downloads.length, "download")}.`);
}

async function downloadOrShareAlbumPhotos(albumId) {
  if (iPhonePhotoShareAvailable()) {
    await shareAlbumPhotos(albumId);
    return;
  }

  const details = await loadAlbumDetails(albumId);
  const album = albumById(albumId) || details.album;
  downloadAlbumZip(album);
}

function downloadAlbumZip(album) {
  if (!album?.id) return;
  const downloadName = `${slugifyClient(album.name || album.id)}.zip`;
  triggerFileDownload(`/api/albums/${encodeURIComponent(album.id)}/download`, downloadName);
  showStatus("Starting photo ZIP download.");
}

async function shareAlbumPhotos(albumId) {
  if (state.photoShareBusy) return;
  try {
    photoShareDebug("share-start", {
      albumId,
      platform: photoSharePlatformMode(),
      available: iPhonePhotoShareAvailable(),
    });
    if (!iPhonePhotoShareAvailable()) {
      const details = await loadAlbumDetails(albumId);
      const album = albumById(albumId) || details.album;
      downloadAlbumZip(album);
      return;
    }

    clearInactivePhotoSharePreparations(albumId);
    const details = Array.isArray(state.albumDetails[albumId]?.photos)
      ? state.albumDetails[albumId]
      : await loadAlbumDetails(albumId);
    const album = albumById(albumId) || details.album;
    const photos = imageAlbumPhotos(details.photos || []);
    if (!photos.length) throw new Error("No photos are saved in this upload yet.");

    const files = albumPhotoShareFiles(albumId, photos);
    if (!files.length) {
      prepareAlbumShareFiles(albumId, photos, { force: true, notify: true });
      showStatus(`Preparing ${photos.length} ${plural(photos.length, "photo")} for the iPhone share sheet. Keep this album open, then tap Share Photos again.`);
      renderAlbumList();
      return;
    }

    state.photoShareBusy = true;
    renderAlbumList();
    const allResult = await trySharePhotoFiles(files, album);
    if (allResult.status === "shared") {
      haptic("success");
      const partialMessage = files.length < photos.length
        ? ` Shared ${files.length} of ${photos.length} prepared photos because this browser could not prepare every image.`
        : "";
      showStatus(`Shared ${files.length} ${plural(files.length, "photo")}. Choose Save Images or Photos in the share sheet.${partialMessage}`);
      return;
    }
    if (allResult.status === "cancelled") {
      showStatus("Photo sharing cancelled.");
      return;
    }

    if (files.length > 1) {
      showStatus("This iOS/browser cannot share all photos at once. Trying the first photo only.");
      const singleResult = await trySharePhotoFiles([files[0]], album);
      if (singleResult.status === "shared") {
        showStatus("Shared 1 photo. This iOS/browser refused the full set; use the previews below to long-press save the rest.");
        return;
      }
      if (singleResult.status === "cancelled") {
        showStatus("Photo sharing cancelled.");
        return;
      }
    }

    showStatus("This iOS/browser cannot share these photo files. Open a photo below, then press and hold it to save to Photos.");
  } catch (error) {
    photoShareDebug("share-error", { albumId, message: error?.message || String(error) });
    throw error;
  } finally {
    state.photoShareBusy = false;
    renderAlbumList();
  }
}

async function trySharePhotoFiles(files, album) {
  if (!photoFileSharingSupported() || !files.length) return { status: "unsupported" };
  const shareData = { files };
  photoShareDebug("share-files-check", {
    albumId: album?.id || "",
    files: photoShareFileSummary(files),
  });
  try {
    if (navigator.canShare) {
      const canShare = navigator.canShare(shareData);
      photoShareDebug("navigator-can-share", {
        albumId: album?.id || "",
        canShare,
        files: photoShareFileSummary(files),
      });
      if (canShare === false) return { status: "unsupported" };
    }
  } catch {
    photoShareDebug("navigator-can-share-error", {
      albumId: album?.id || "",
      files: photoShareFileSummary(files),
    });
    return { status: "unsupported" };
  }

  try {
    await navigator.share(shareData);
    photoShareDebug("navigator-share-result", {
      albumId: album?.id || "",
      status: "shared",
      files: photoShareFileSummary(files),
    });
    return { status: "shared" };
  } catch (error) {
    if (error?.name === "AbortError") {
      photoShareDebug("navigator-share-result", {
        albumId: album?.id || "",
        status: "cancelled",
        files: photoShareFileSummary(files),
      });
      return { status: "cancelled" };
    }
    photoShareDebug("navigator-share-result", {
      albumId: album?.id || "",
      status: "failed",
      message: error?.message || String(error),
      files: photoShareFileSummary(files),
    });
    return { status: "failed", error };
  }
}

function iPhonePhotoShareAvailable() {
  return Boolean(isAppleMobileDevice() && photoFileSharingSupported());
}

function isAppleMobileDevice() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iP(hone|od|ad)/.test(userAgent)
    || (platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
}

function photoFileSharingSupported() {
  if (!window.File || !navigator.share) return false;
  if (!navigator.canShare) return true;
  try {
    return navigator.canShare({
      files: [new File([new Uint8Array([0])], "photo.jpg", { type: "image/jpeg" })],
    });
  } catch {
    return false;
  }
}

function imageAlbumPhotos(photos) {
  return (photos || []).filter((photo) => {
    if (isVideoMedia(photo)) return false;
    return photo?.kind === "image"
      || String(photo?.contentType || "").startsWith("image/")
      || /\.(avif|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(photo?.filename || photo?.originalName || "");
  });
}

async function albumPhotoShareFile(photo, { signal } = {}) {
  const response = await fetch(photo.url, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`Could not prepare ${photo.originalName || photo.filename || "photo"}.`);
  const blob = await response.blob();
  const type = blob.type || photo.contentType || "image/jpeg";
  const fileBlob = blob.type ? blob : new Blob([blob], { type });
  return new File([fileBlob], photoShareFilename(photo, type), { type });
}

async function albumPhotoShareFileWithTimeout(photo, { signal = null, timeoutMs = photoSharePreparationTimeoutMs } = {}) {
  if (signal?.aborted) throw photoShareAbortError();
  const controller = window.AbortController ? new AbortController() : null;
  let timeout = 0;
  const timeoutError = new Error(`Timed out preparing ${photo.originalName || photo.filename || "photo"}.`);
  const timeoutPromise = new Promise((_, reject) => {
    timeout = window.setTimeout(() => {
      controller?.abort();
      reject(timeoutError);
    }, timeoutMs);
  });
  let removeAbortListener = () => {};
  const abortPromise = signal
    ? new Promise((_, reject) => {
      const abort = () => {
        controller?.abort();
        reject(photoShareAbortError());
      };
      signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", abort);
    })
    : null;
  try {
    return await Promise.race([
      albumPhotoShareFile(photo, { signal: controller?.signal }),
      timeoutPromise,
      abortPromise,
    ].filter(Boolean));
  } finally {
    removeAbortListener();
    window.clearTimeout(timeout);
  }
}

function photoShareFilename(photo, type = "") {
  const name = photo.downloadName || photo.originalName || photo.filename || "carpostclub-photo.jpg";
  let cleaned = String(name).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 160) || "carpostclub-photo.jpg";
  if (String(type || "").toLowerCase() === "image/jpeg") {
    cleaned = cleaned.replace(/\.(jpe?g)$/i, ".jpg");
    if (!/\.(jpe?g)$/i.test(cleaned)) cleaned = `${cleaned.replace(/\.[^.]+$/, "")}.jpg`;
  }
  return cleaned;
}

function albumPhotoShareKey(photos) {
  return imageAlbumPhotos(photos)
    .map((photo) => [photo.filename, photo.bytes || "", photo.contentType || ""].join(":"))
    .join("|");
}

function albumPhotoShareEntry(albumId, photos) {
  if (!albumPhotoShareCanPrepare(albumId)) return null;
  const key = albumPhotoShareKey(photos);
  const entry = state.photoShareCache[albumId];
  return entry?.key === key ? entry : null;
}

function albumPhotoSharePreparing(albumId, photos) {
  return Boolean(albumPhotoShareEntry(albumId, photos)?.promise);
}

function albumPhotoShareFiles(albumId, photos) {
  const entry = albumPhotoShareEntry(albumId, photos);
  return Array.isArray(entry?.files) ? entry.files : [];
}

function albumPhotoShareError(albumId, photos) {
  return albumPhotoShareEntry(albumId, photos)?.error || null;
}

function prepareAlbumShareFiles(albumId, photos, { force = false, notify = false } = {}) {
  if (!albumPhotoShareCanPrepare(albumId)) return null;
  const imagePhotos = imageAlbumPhotos(photos);
  if (!albumId || !imagePhotos.length) return null;
  clearInactivePhotoSharePreparations(albumId);
  const key = albumPhotoShareKey(imagePhotos);
  const existing = state.photoShareCache[albumId];
  if (!force && existing?.key === key && (existing.promise || existing.files?.length)) return existing;
  if (existing) clearAlbumPhotoSharePreparation(albumId, "replace");

  const controller = window.AbortController ? new AbortController() : null;
  const entry = {
    albumId,
    key,
    files: [],
    error: null,
    errors: [],
    promise: null,
    controller,
    cancelled: false,
  };
  state.photoShareCache[albumId] = entry;
  state.photoShareActiveAlbumId = albumId;
  photoShareDebug("prep-start", {
    albumId,
    platform: photoSharePlatformMode(),
    photoCount: imagePhotos.length,
    concurrency: photoSharePreparationConcurrency,
    names: imagePhotos.map((photo) => photo.originalName || photo.filename || "photo"),
  });
  entry.promise = preparePhotoShareFilesWithConcurrency(imagePhotos, entry)
    .then((results) => {
      if (state.photoShareCache[albumId] !== entry) return [];
      const files = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      const firstError = errors[0] || null;
      entry.files = files;
      entry.errors = errors;
      entry.error = firstError || null;
      entry.promise = null;
      photoShareDebug("prep-complete", {
        albumId,
        files: photoShareFileSummary(files),
        failedCount: errors.length,
        errors: errors.map((error) => error?.message || String(error)),
      });
      if (notify && files.length === imagePhotos.length) {
        showStatus(`Photos are ready. Tap Share Photos to open the iPhone share sheet.`);
      } else if (notify && files.length) {
        showStatus(`Prepared ${files.length} of ${imagePhotos.length} photos. Tap Share Photos to share the ready photos; long-press previews for any that failed.`);
      } else if (notify && firstError) {
        showError(`${firstError.message || firstError} Open a photo below, then press and hold it to save to Photos.`);
      }
      return files;
    })
    .catch((error) => {
      if (state.photoShareCache[albumId] !== entry) return [];
      entry.files = [];
      entry.error = error;
      entry.errors = [error];
      entry.promise = null;
      photoShareDebug("prep-error", {
        albumId,
        message: error?.message || String(error),
      });
      if (notify) showError(error);
      return [];
    })
    .finally(() => {
      if (state.photoShareCache[albumId] === entry) renderAlbumList();
    });
  return entry;
}

async function preparePhotoShareFilesWithConcurrency(photos, entry) {
  const results = new Array(photos.length);
  let nextIndex = 0;
  const workerCount = Math.min(photoSharePreparationConcurrency, photos.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (!entry.controller?.signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= photos.length) return;
      const photo = photos[index];
      try {
        const file = await albumPhotoShareFileWithTimeout(photo, {
          signal: entry.controller?.signal,
        });
        results[index] = { status: "fulfilled", value: file };
        photoShareDebug("prep-file-success", {
          albumId: entry.albumId,
          index,
          files: photoShareFileSummary([file]),
        });
      } catch (error) {
        if (entry.cancelled && error?.name === "AbortError") return;
        results[index] = { status: "rejected", reason: error };
        photoShareDebug("prep-file-failure", {
          albumId: entry.albumId,
          index,
          name: photo.originalName || photo.filename || "photo",
          message: error?.message || String(error),
        });
      }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

function albumPhotoShareCanPrepare(albumId) {
  return Boolean(
    state.page === "gallery"
    && iPhonePhotoShareAvailable()
    && albumId
    && state.expandedAlbumId === albumId
  );
}

function clearInactivePhotoSharePreparations(activeAlbumId = "") {
  for (const albumId of Object.keys(state.photoShareCache)) {
    if (albumId !== activeAlbumId) clearAlbumPhotoSharePreparation(albumId, "inactive-album");
  }
  state.photoShareActiveAlbumId = activeAlbumId;
}

function clearAlbumPhotoSharePreparation(albumId, reason = "clear") {
  const entry = state.photoShareCache[albumId];
  if (!entry) return;
  entry.cancelled = true;
  entry.controller?.abort();
  delete state.photoShareCache[albumId];
  photoShareDebug("prep-cleared", { albumId, reason });
}

function photoShareAbortError() {
  try {
    return new DOMException("Photo sharing preparation was cancelled.", "AbortError");
  } catch {
    const error = new Error("Photo sharing preparation was cancelled.");
    error.name = "AbortError";
    return error;
  }
}

function photoSharePlatformMode() {
  return {
    userAgent: navigator.userAgent || "",
    platform: navigator.platform || "",
    maxTouchPoints: Number(navigator.maxTouchPoints || 0),
    appleMobile: isAppleMobileDevice(),
    fileSharingSupported: photoFileSharingSupported(),
    standalone: Boolean(navigator.standalone || window.matchMedia?.("(display-mode: standalone)")?.matches),
  };
}

function photoShareFileSummary(files) {
  return {
    count: files.length,
    names: files.map((file) => file.name || ""),
    types: files.map((file) => file.type || ""),
    sizes: files.map((file) => file.size || 0),
  };
}

function photoShareDebug(event, details = {}) {
  if (!photoShareDebugEnabled) return;
  console.debug("[CarPostClub Share Photos]", event, details);
}

function triggerFileDownload(href, downloadName) {
  const link = document.createElement("a");
  link.href = href;
  link.download = downloadName || "";
  link.rel = "noreferrer";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function albumById(albumId) {
  return state.albums.find((album) => album.id === albumId) || state.albumDetails[albumId]?.album || null;
}

function albumReadVersion(album) {
  return String(album?.latestUploadedAt || album?.updatedAt || album?.createdAt || "");
}

function rememberOpenedUnreadAlbum(album) {
  if (!album?.id || !album.unread) return;
  state.openedUnreadAlbumIds.set(album.id, albumReadVersion(album));
}

function galleryAlbumWasOpenedLocally(album) {
  if (!album?.id) return false;
  const version = state.openedUnreadAlbumIds.get(album.id);
  return Boolean(version && version === albumReadVersion(album));
}

function pruneOpenedUnreadAlbumVersions() {
  for (const [albumId, version] of state.openedUnreadAlbumIds.entries()) {
    const album = state.albums.find((candidate) => candidate.id === albumId);
    if (!album || !album.unread || albumReadVersion(album) !== version) {
      state.openedUnreadAlbumIds.delete(albumId);
    }
  }
}

function slugifyClient(value) {
  return String(value || "vehicle")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "vehicle";
}

function photoUploaderLabel(photo) {
  const uploader = photo?.uploadedBy;
  return uploader?.displayName || uploader?.username || "unknown user";
}

function uploadStateLabel(car) {
  if (state.uploading) return "Uploading";
  if (state.failedUploadFiles.length) return "Upload failed";
  if (recentUploadCompletedForCar(car)) return "Upload complete";
  if (selectedCarUploadDuplicateBlocked(car)) return "Already uploaded";
  return car ? "Ready" : "Locked";
}

function renderUploadRecovery() {
  const hasFailure = state.failedUploadFiles.length > 0 && !state.uploading;
  els.uploadRecovery.hidden = !hasFailure;
  els.retryUploadButton.disabled = !hasFailure;
  els.clearUploadButton.disabled = !hasFailure;
  if (!hasFailure) return;

  const count = state.failedUploadFiles.length;
  els.uploadRecoveryMessage.textContent = `${count} ${plural(count, "file")} did not upload. ${state.failedUploadMessage || "Try again or clear the selection."}`;
}

function clearFailedUpload() {
  state.failedUploadFiles = [];
  state.failedUploadMessage = "";
  els.uploadRecovery.hidden = true;
}

function clearRecentUploadCompletion() {
  state.recentUploadCompletion = null;
}

async function uploadFiles(files) {
  const selectedFiles = Array.from(files || []);
  if (!selectedFiles.length) return;

  if (state.uploading) {
    showError("Upload already in progress. Wait for it to finish, then try again.");
    return;
  }

  const car = selectedCar();
  if (!car) {
    showError("Select a car before uploading media.");
    return;
  }
  if (selectedCarUploadDuplicateBlocked(car)) {
    showError("This vehicle already has uploaded CarPostClub photos. Open it from the gallery instead of uploading a duplicate set.");
    return;
  }

  const mediaFiles = selectedFiles.filter((file) => isMediaLike(file));
  if (!mediaFiles.length) {
    showError("Only photos and videos can be uploaded.");
    return;
  }
  const skippedCount = selectedFiles.length - mediaFiles.length;

  haptic("start");
  const form = new FormData();
  for (const [key, value] of Object.entries(carRequestPayload(car))) {
    form.append(key, value);
  }
  for (const file of mediaFiles) form.append("photos", file, file.name);

  state.uploading = true;
  clearRecentUploadCompletion();
  clearFailedUpload();
  resetUploadCelebration();
  setProgress(0);
  renderActiveCar();
  els.uploadState.textContent = `Uploading ${mediaFiles.length} ${plural(mediaFiles.length, "file")}`;

  let uploadSucceeded = false;
  try {
    const response = await uploadForm(form);
    setProgress(100);
    state.recentUploadCompletion = {
      inventoryKey: carInventoryKey(car),
      albumId: response.album?.id || "",
    };
    state.activeAlbum = response.album;
    state.photos = [...response.photos, ...state.photos];
    await loadSelectedCarAlbum({ force: true, markSeen: false });
    await loadAlbums();
    uploadSucceeded = true;
    triggerUploadConfetti();
    haptic("success");
    showStatus([
      `Uploaded ${response.count} ${plural(response.count, "file")} to the selected album tile.`,
      skippedCount ? `Skipped ${skippedCount} unsupported ${plural(skippedCount, "file")}.` : "",
    ].filter(Boolean).join(" "));
  } catch (error) {
    state.failedUploadFiles = mediaFiles;
    state.failedUploadMessage = error instanceof Error ? error.message : String(error);
    haptic("error");
    showError(error);
  } finally {
    state.uploading = false;
    if (!uploadSucceeded) {
      resetUploadCelebration();
      setProgress(0);
    }
    renderActiveCar();
  }
}

function uploadForm(form) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/upload");
    request.responseType = "json";
    request.timeout = uploadTimeoutMs;

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setProgress(Math.round((event.loaded / event.total) * 100));
      if (event.loaded >= event.total) {
        els.uploadState.textContent = "Saving media and generating Marketplace copy";
      }
    });

    request.addEventListener("load", () => {
      const body = request.response;
      if (request.status === 401) {
        window.location.href = "/login";
        reject(new Error("Authentication required."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(body?.error || `Upload failed with ${request.status}.`));
        return;
      }
      resolve(body);
    });

    request.addEventListener("error", () => reject(new Error("Upload failed.")));
    request.addEventListener("abort", () => reject(new Error("Upload was cancelled.")));
    request.addEventListener("timeout", () => reject(new Error("Upload timed out. Check your connection and try again.")));
    request.send(form);
  });
}

async function deleteAlbumMedia(albumId) {
  const details = await loadAlbumDetails(albumId);
  const album = albumById(albumId) || details.album;
  const count = details.photos?.length || album?.mediaCount || 0;
  if (!album?.id || !count) return;

  const label = albumDeleteUploadLabel(album);
  const confirmed = window.confirm(`Delete uploaded media for ${label}? This deletes the uploaded media for that vehicle and cannot be undone.`);
  if (!confirmed) return;

  try {
    const response = await apiJson(`/api/albums/${encodeURIComponent(albumId)}/media`, {
      method: "DELETE",
    });
    if (state.activeAlbum?.id === albumId) {
      state.photos = [];
      await loadSelectedCarAlbum({ force: true });
    }
    state.albumDetails[albumId] = {
      ...state.albumDetails[albumId],
      photos: [],
      loading: false,
    };
    await loadAlbums();
    renderAlbumList();
    haptic("success");
    showStatus(`Deleted upload for ${label}.`);
  } catch (error) {
    throw error;
  }
}

function albumDeleteUploadLabel(album) {
  const stockNumber = album?.vehicle?.stockNumber || album?.inventoryNumber || "";
  const title = album?.vehicle?.title || album?.name || "";
  return [stockNumber, title].filter(Boolean).join(" / ") || "this vehicle";
}

async function deleteAlbumPhoto(albumId, filename, label = "this media asset") {
  if (!albumId || !filename) return;
  const mediaLabel = label || filename;
  const confirmed = window.confirm(`Delete ${mediaLabel} from this album? This cannot be undone.`);
  if (!confirmed) return;

  const response = await apiJson(`/api/albums/${encodeURIComponent(albumId)}/media/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  if (state.activeAlbum?.id === albumId) {
    state.photos = state.photos.filter((photo) => photo.filename !== filename);
    await loadSelectedCarAlbum({ force: true });
  }
  state.albumDetails[albumId] = {
    ...state.albumDetails[albumId],
    photos: (state.albumDetails[albumId]?.photos || []).filter((photo) => photo.filename !== filename),
    loading: false,
  };
  await loadAlbums();
  await loadAlbumDetails(albumId, { force: true, includeDraft: state.page === "gallery" });
  renderAlbumList();
  haptic("success");
  showStatus(response.ok ? `Deleted ${mediaLabel}.` : "Deleted media asset.");
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Authentication required.");
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 160));
    }
  }

  if (!response.ok) {
    throw new Error(body?.error || `Request failed with ${response.status}.`);
  }

  return body;
}

function selectedDealership() {
  return state.dealerships.find((dealership) => dealership.id === state.selectedDealershipId) || null;
}

function selectedCar() {
  return state.cars.find((car) => carInventoryKey(car) === state.selectedVin) || null;
}

function syncVehicleFiltersWithInventory({ keepSelectedCar = false } = {}) {
  let changed = false;
  const selected = selectedCar();
  if (keepSelectedCar && selected) {
    const nextMake = selected.make || state.selectedMake;
    const nextModel = selected.model || state.selectedModel;
    changed = changed || nextMake !== state.selectedMake || nextModel !== state.selectedModel;
    state.selectedMake = nextMake;
    state.selectedModel = nextModel;
  }

  const makeValues = uniqueFilterValues(inventoryAvailabilityCars({ includeSelected: true }), "make");
  if (state.selectedMake && !hasFilterValue(makeValues, state.selectedMake)) {
    state.selectedMake = "";
    state.selectedModel = "";
    changed = true;
  }

  const modelValues = state.selectedMake ? uniqueFilterValues(carsForMake(state.selectedMake), "model") : [];
  if (state.selectedModel && !hasFilterValue(modelValues, state.selectedModel)) {
    state.selectedModel = "";
    changed = true;
  }
  if (changed) persistAccountPreferences();
}

function clearSelectedCarSelection() {
  state.selectedVin = "";
  state.activeAlbum = null;
  state.photos = [];
  clearFailedUpload();
  clearRecentUploadCompletion();
}

function vehicleFilteredCars() {
  let cars = searchFilteredInventoryCars({ includeSelected: true });
  if (state.selectedMake) {
    cars = cars.filter((car) => sameFilterValue(car.make, state.selectedMake));
  }
  if (state.selectedModel) {
    cars = cars.filter((car) => sameFilterValue(car.model, state.selectedModel));
  }
  return cars;
}

function filteredCars() {
  return vehicleFilteredCars();
}

function carMatchesVehicleFilters(car) {
  return Boolean(car)
    && carMatchesSearchTerms(car)
    && (!state.selectedMake || sameFilterValue(car.make, state.selectedMake))
    && (!state.selectedModel || sameFilterValue(car.model, state.selectedModel));
}

function carCountLabel(narrowedCount, matchingCount) {
  return state.carSearch.trim() ? `${matchingCount}/${narrowedCount}` : String(matchingCount);
}

function carSelectPlaceholder(count) {
  if (!state.cars.length) return "No cars found";
  if (state.carSearch.trim() && !count) return "No matching vehicles found";
  if (!state.showPostedInventory && !count && postedInventoryCars().length) return "No unposted vehicles available";
  if (!count) return "No matches";
  return "Choose inventory";
}

function searchFilteredInventoryCars({ includeSelected = false } = {}) {
  const cars = inventoryAvailabilityCars({ includeSelected });
  const terms = carSearchTerms();
  if (!terms.length) return cars;
  return cars.filter((car) => carMatchesSearchTerms(car, terms));
}

function carSearchTerms() {
  return normalizeSearchText(state.carSearch).split(" ").filter(Boolean);
}

function carMatchesSearchTerms(car, terms = carSearchTerms()) {
  if (!terms.length) return true;
  const haystack = normalizeSearchText(carSearchText(car));
  return terms.every((term) => haystack.includes(term));
}

function inventoryAvailabilityCars({ includeSelected = false } = {}) {
  const selectedKey = includeSelected ? state.selectedVin : "";
  return state.cars.filter((car) => {
    if (state.showPostedInventory || !carAlreadyPosted(car)) return true;
    return Boolean(selectedKey && carInventoryKey(car) === selectedKey);
  });
}

function postedInventoryCars() {
  return state.cars.filter((car) => carAlreadyPosted(car));
}

function carAlreadyPosted(car) {
  return Boolean(car?.posted?.posted || albumForCar(car)?.mediaCount > 0);
}

function postedInventoryHintText(matchingCars) {
  const postedCount = postedInventoryCars().length;
  if (state.showPostedInventory) {
    const visiblePostedCount = matchingCars.filter((car) => carAlreadyPosted(car)).length;
    return visiblePostedCount
      ? `${visiblePostedCount} already posted ${plural(visiblePostedCount, "vehicle")} shown`
      : "No already posted vehicles in this view";
  }
  if (!state.cars.length) return "No inventory returned for this lot";
  if (!postedCount) return "Unposted inventory only";
  if (!matchingCars.length && postedCount === state.cars.length) return "No unposted vehicles available";
  return `${postedCount} already posted ${plural(postedCount, "vehicle")} hidden`;
}

function carInventoryKey(car) {
  return car?.inventoryKey || car?.manualInventoryId || car?.vin || "";
}

function carRequestPayload(car = selectedCar()) {
  const payload = {
    dealershipId: car?.dealership?.id || state.selectedDealershipId,
    inventoryTypeId: car?.inventoryTypeId || state.selectedInventoryTypeId,
    inventoryKey: carInventoryKey(car),
  };
  if (car?.vin) payload.vin = car.vin;
  if (car?.manualInventoryId) payload.manualInventoryId = car.manualInventoryId;
  return payload;
}

function persistSelection() {
  persistAccountPreferences();
}

function applyAccountPreferences(preferences) {
  if (!preferences || typeof preferences !== "object") return;
  if (hasPreference(preferences, "selectedDealershipId")) state.selectedDealershipId = cleanPreferenceValue(preferences.selectedDealershipId, "15");
  if (hasPreference(preferences, "selectedInventoryTypeId")) state.selectedInventoryTypeId = cleanPreferenceValue(preferences.selectedInventoryTypeId, "2");
  if (hasPreference(preferences, "selectedMake")) state.selectedMake = cleanPreferenceValue(preferences.selectedMake);
  if (hasPreference(preferences, "selectedModel")) state.selectedModel = cleanPreferenceValue(preferences.selectedModel);
  if (hasPreference(preferences, "selectedVin")) state.selectedVin = cleanPreferenceValue(preferences.selectedVin);
  if (hasPreference(preferences, "carSearch")) state.carSearch = cleanPreferenceValue(preferences.carSearch);
  if (hasPreference(preferences, "showPostedInventory")) state.showPostedInventory = Boolean(preferences.showPostedInventory);
  if (hasPreference(preferences, "galleryDealershipId")) state.galleryDealershipId = cleanPreferenceValue(preferences.galleryDealershipId);
  if (hasPreference(preferences, "expandedAlbumId")) state.expandedAlbumId = cleanPreferenceValue(preferences.expandedAlbumId);
  if (hasPreference(preferences, "gallerySearch")) state.gallerySearch = cleanPreferenceValue(preferences.gallerySearch);
  if (hasPreference(preferences, "galleryStatusFilter")) state.galleryStatusFilter = cleanGalleryStatusFilter(preferences.galleryStatusFilter);
  if (hasPreference(preferences, "galleryMakeFilter")) state.galleryMakeFilter = cleanPreferenceValue(preferences.galleryMakeFilter);
  if (hasPreference(preferences, "galleryModelFilter")) state.galleryModelFilter = cleanPreferenceValue(preferences.galleryModelFilter);
  if (hasPreference(preferences, "galleryYearFilter")) state.galleryYearFilter = cleanPreferenceValue(preferences.galleryYearFilter);
  if (hasPreference(preferences, "galleryUploaderFilter")) state.galleryUploaderFilter = cleanPreferenceValue(preferences.galleryUploaderFilter);
  persistAccountPreferenceFallback();
}

function persistAccountPreferences() {
  persistAccountPreferenceFallback();
  scheduleAccountPreferencesSave();
}

function persistAccountPreferenceFallback() {
  safeStorageSet("carpostclub.selectedDealershipId", state.selectedDealershipId);
  safeStorageSet("carpostclub.selectedInventoryTypeId", state.selectedInventoryTypeId);
  setOptionalStorage("carpostclub.selectedMake", state.selectedMake);
  setOptionalStorage("carpostclub.selectedModel", state.selectedModel);
  setOptionalStorage("carpostclub.selectedVin", state.selectedVin);
  safeStorageSet("carpostclub.carSearch", state.carSearch);
  safeStorageSet("carpostclub.showPostedInventory", String(state.showPostedInventory));
  setOptionalStorage("carpostclub.galleryDealershipId", state.galleryDealershipId);
  setOptionalStorage("carpostclub.expandedAlbumId", state.expandedAlbumId);
  safeStorageSet("carpostclub.gallerySearch", state.gallerySearch);
  safeStorageSet("carpostclub.galleryStatusFilter", state.galleryStatusFilter);
  setOptionalStorage("carpostclub.galleryMakeFilter", state.galleryMakeFilter);
  setOptionalStorage("carpostclub.galleryModelFilter", state.galleryModelFilter);
  setOptionalStorage("carpostclub.galleryYearFilter", state.galleryYearFilter);
  setOptionalStorage("carpostclub.galleryUploaderFilter", state.galleryUploaderFilter);
}

function scheduleAccountPreferencesSave() {
  if (!state.currentUser) return;
  window.clearTimeout(state.accountPreferencesSaveTimer);
  state.accountPreferencesSaveTimer = window.setTimeout(() => {
    saveAccountPreferences().catch((error) => console.warn(error));
  }, 350);
}

async function saveAccountPreferences() {
  if (!state.currentUser) return null;
  const preferences = accountPreferencesPayload();
  state.accountPreferencesSavePromise = (state.accountPreferencesSavePromise || Promise.resolve())
    .catch(() => {})
    .then(() => apiJson("/api/me/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences }),
    }));
  return state.accountPreferencesSavePromise;
}

function accountPreferencesPayload() {
  return {
    selectedDealershipId: state.selectedDealershipId,
    selectedInventoryTypeId: state.selectedInventoryTypeId,
    selectedMake: state.selectedMake,
    selectedModel: state.selectedModel,
    selectedVin: state.selectedVin,
    carSearch: state.carSearch,
    showPostedInventory: state.showPostedInventory,
    galleryDealershipId: state.galleryDealershipId,
    expandedAlbumId: state.expandedAlbumId,
    gallerySearch: state.gallerySearch,
    galleryStatusFilter: cleanGalleryStatusFilter(state.galleryStatusFilter),
    galleryMakeFilter: state.galleryMakeFilter,
    galleryModelFilter: state.galleryModelFilter,
    galleryYearFilter: state.galleryYearFilter,
    galleryUploaderFilter: state.galleryUploaderFilter,
  };
}

function hasPreference(preferences, key) {
  return Object.prototype.hasOwnProperty.call(preferences, key);
}

function cleanPreferenceValue(value, fallback = "") {
  const text = String(value || "").trim().slice(0, 160);
  return text || fallback;
}

function cleanGalleryStatusFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  return ["active", "inactive", "all"].includes(text) ? text : "active";
}

function setOptionalStorage(key, value) {
  if (value) safeStorageSet(key, value);
  else safeStorageRemove(key);
}

function clearInitialSelectionUrl() {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ["dealershipId", "inventoryTypeId", "inventoryKey", "vin", "albumId", "uploadId", "openAlbum"]) {
    if (!url.searchParams.has(key)) continue;
    url.searchParams.delete(key);
    changed = true;
  }
  if (changed) window.history.replaceState({}, "", url);
}

function cleanQueryValue(value) {
  return String(value || "").trim().slice(0, 120);
}

function safeStorageGet(key, fallback = "") {
  try {
    return window.localStorage?.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Storage can be unavailable in restricted/private browser modes.
  }
}

function safeStorageRemove(key) {
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted/private browser modes.
  }
}

function snapshotFiles(fileList) {
  return Array.from(fileList || []);
}

function clearFileInput(input) {
  input.value = "";
}

function isMediaLike(file) {
  const type = file?.type || "";
  return type.startsWith("image/")
    || type.startsWith("video/")
    || /\.(avif|gif|heic|heif|jpe?g|png|tiff?|webp|m4v|mov|mp4|ogv|webm)$/i.test(file?.name || "");
}

function isVideoMedia(media) {
  return media?.kind === "video"
    || String(media?.contentType || "").startsWith("video/")
    || /\.(m4v|mov|mp4|ogv|webm)$/i.test(media?.filename || media?.originalName || "");
}

function setSelectorBusy(isBusy) {
  els.inventoryTypeSelect.disabled = isBusy;
  els.dealershipSelect.disabled = isBusy;
  if (!isBusy) {
    renderCarOptions();
    return;
  }
  els.makeFilterSelect.disabled = isBusy || !state.cars.length;
  els.modelFilterSelect.disabled = isBusy || !state.selectedMake;
  els.carSelect.disabled = isBusy || !state.cars.length;
  els.carCount.textContent = "...";
  els.makeFilterSelect.replaceChildren(new Option("Loading makes...", ""));
  els.modelFilterSelect.replaceChildren(new Option("Loading models...", ""));
  els.carSelect.replaceChildren(new Option("Loading cars...", ""));
}

function setProgress(percent) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  els.uploadProgress.style.width = safePercent ? `${safePercent}%` : "0";
  els.uploadProgressShell.style.setProperty("--upload-progress", `${safePercent}%`);
  els.uploadProgressShell.classList.toggle("is-uploading", state.uploading);
}

function triggerUploadConfetti() {
  window.clearTimeout(state.uploadCelebrationTimer);
  els.uploadProgressShell.classList.remove("is-celebrating");
  void els.uploadProgressShell.offsetWidth;
  els.uploadProgressShell.classList.add("is-celebrating");
  state.uploadCelebrationTimer = window.setTimeout(() => {
    els.uploadProgressShell.classList.remove("is-celebrating");
    setProgress(0);
  }, 1500);
}

function resetUploadCelebration() {
  window.clearTimeout(state.uploadCelebrationTimer);
  state.uploadCelebrationTimer = 0;
  els.uploadProgressShell.classList.remove("is-celebrating");
}

function bindHapticSurfaceFeedback() {
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    const target = event.target.closest?.(hapticSelector);
    if (!target) return;
    pulseHapticSurface(target);
  }, { passive: true });

  for (const eventName of ["pointerup", "pointercancel", "pointerleave", "blur"]) {
    document.addEventListener(eventName, clearHapticSurfaceFeedback, true);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearHapticSurfaceFeedback();
  });
}

function pulseHapticSurface(target = null) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

  document.body.classList.add("is-haptic-pulse");
  if (target?.classList) target.classList.add("is-haptic-pressing");

  window.clearTimeout(hapticCssTimer);
  hapticCssTimer = window.setTimeout(clearHapticSurfaceFeedback, hapticCssResetMs);
}

function clearHapticSurfaceFeedback() {
  window.clearTimeout(hapticCssTimer);
  hapticCssTimer = 0;
  document.body.classList.remove("is-haptic-pulse");
  document.querySelectorAll(".is-haptic-pressing").forEach((target) => {
    target.classList.remove("is-haptic-pressing");
  });
}

function isStandalonePwa() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator.standalone === true
  );
}

function nativeHaptic(kind) {
  const haptics = window.Capacitor?.Plugins?.Haptics;
  const notificationType = hapticNotificationTypes[kind];

  try {
    if (haptics) {
      if (notificationType && typeof haptics.notification === "function") {
        settleHaptic(haptics.notification({ type: notificationType }));
        return true;
      }

      if (kind === "select" && typeof haptics.selectionChanged === "function") {
        settleHaptic(haptics.selectionChanged());
        return true;
      }

      if (typeof haptics.impact === "function") {
        settleHaptic(haptics.impact({ style: hapticNativeStyles[kind] || hapticNativeStyles.tap }));
        return true;
      }
    }

    const webkitHaptics = window.webkit?.messageHandlers?.carpostclubHaptics
      || window.webkit?.messageHandlers?.haptics;
    if (webkitHaptics?.postMessage) {
      webkitHaptics.postMessage({
        kind,
        standalone: isStandalonePwa(),
        style: hapticNativeStyles[kind] || hapticNativeStyles.tap,
      });
      return true;
    }
  } catch {
    // Native haptic bridges vary by wrapper and should never break the PWA.
  }

  return false;
}

function settleHaptic(request) {
  if (request && typeof request.catch === "function") void request.catch(() => {});
}

function haptic(kind = "tap", options = {}) {
  const pattern = hapticPatterns[kind] || hapticPatterns.tap;

  const now = Date.now();
  if (now - lastHapticAt < hapticThrottleMs) return;
  lastHapticAt = now;

  pulseHapticSurface(options.target || null);
  nativeHaptic(kind);

  if (!("vibrate" in navigator)) return;

  try {
    navigator.vibrate(pattern);
  } catch {
    // Haptics are a best-effort mobile PWA enhancement.
  }
}

function showStatus(message) {
  els.statusBar.hidden = false;
  els.statusBar.className = "status-bar";
  els.statusBar.textContent = message;
  window.clearTimeout(showStatus.timeout);
  showStatus.timeout = window.setTimeout(() => {
    els.statusBar.hidden = true;
  }, 4000);
}

function showError(error) {
  haptic("error");
  els.statusBar.hidden = false;
  els.statusBar.className = "status-bar is-error";
  els.statusBar.textContent = error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatChatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function plural(count, word) {
  return Number(count) === 1 ? word : `${word}s`;
}

function carSearchText(car) {
  return [
    car.source === "manual" ? "manual" : "oregans",
    carInventoryKey(car),
    car.stockNumber,
    car.vin,
    car.title,
    car.year,
    car.make,
    car.model,
    car.trim,
    car.price,
    car.priceValue,
    car.odometer,
    car.odometerValue,
    car.exteriorColor,
    car.interiorColor,
    car.bodyStyle,
    car.fuelType,
    car.transmission,
    car.descriptionPreview,
    car.dealership?.name,
    car.inventoryType,
    car.posted?.posted ? "posted uploaded shared album" : "unposted available",
    car.posted?.albumName,
  ].filter(Boolean).join(" ");
}

function carsForMake(make, cars = inventoryAvailabilityCars({ includeSelected: true })) {
  return cars.filter((car) => sameFilterValue(car.make, make));
}

function uniqueFilterValues(cars, key) {
  const values = new Map();
  for (const car of cars) {
    const value = String(car?.[key] || "").trim();
    const filterKey = normalizeSearchText(value);
    if (filterKey && !values.has(filterKey)) values.set(filterKey, value);
  }
  return [...values.values()].sort((a, b) => a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

function hasFilterValue(values, value) {
  return values.some((candidate) => sameFilterValue(candidate, value));
}

function sameFilterValue(left, right) {
  return Boolean(normalizeSearchText(left))
    && normalizeSearchText(left) === normalizeSearchText(right);
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function carOptionLabel(car) {
  return [
    carAlreadyPosted(car) ? "Posted" : "",
    car.source === "manual" ? "Manual" : "",
    car.stockNumber || car.vin,
    car.title,
    [car.price, car.odometer, car.exteriorColor].filter(Boolean).join(" / "),
  ].filter(Boolean).join(" - ");
}
