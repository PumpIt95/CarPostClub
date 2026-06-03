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
  chatEventSource: null,
  chatReconnectTimer: null,
  currentUser: null,
  deferredInstallPrompt: null,
  serviceWorkerRegistration: null,
  pushPublicKey: "",
  pushSubscription: null,
  pushBusy: false,
  selectedDealershipId: safeStorageGet("carpostclub.selectedDealershipId", "15"),
  selectedInventoryTypeId: safeStorageGet("carpostclub.selectedInventoryTypeId", "2"),
  selectedMake: safeStorageGet("carpostclub.selectedMake"),
  selectedModel: safeStorageGet("carpostclub.selectedModel"),
  selectedVin: safeStorageGet("carpostclub.selectedVin"),
  carSearch: safeStorageGet("carpostclub.carSearch"),
  initialOpenAlbum: false,
  expandedAlbumId: "",
  albumsLoading: false,
  inventoryFetchedAt: "",
  failedUploadFiles: [],
  failedUploadMessage: "",
  manualFormOpen: false,
  uploading: false,
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
  adminUsersLink: document.querySelector("#adminUsersLink"),
  appShell: document.querySelector(".app-shell"),
  cameraButton: document.querySelector("#cameraButton"),
  cameraInput: document.querySelector("#cameraInput"),
  carCount: document.querySelector("#carCount"),
  carSearchInput: document.querySelector("#carSearchInput"),
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
  oregansSourceButton: document.querySelector("#oregansSourceButton"),
  pickerPanel: document.querySelector(".picker-panel"),
  cancelManualCarButton: document.querySelector("#cancelManualCarButton"),
  pickerSubhead: document.querySelector("#pickerSubhead"),
  notificationButton: document.querySelector("#notificationButton"),
  galleryPageLink: document.querySelector("#galleryPageLink"),
  pageEyebrow: document.querySelector("#pageEyebrow"),
  pageTitle: document.querySelector("#pageTitle"),
  refreshButton: document.querySelector("#refreshButton"),
  sourceLink: document.querySelector("#sourceLink"),
  statusBar: document.querySelector("#statusBar"),
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
  loadCurrentUser().catch(() => {});
  initChat().catch((error) => showError(error));
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
  document.title = galleryPage ? "Media Gallery | CarPostClub" : "CarPostClub";
}

async function loadCurrentUser() {
  const response = await apiJson("/api/me");
  state.currentUser = response.user || null;
  if (els.adminUsersLink) {
    els.adminUsersLink.hidden = state.currentUser?.role !== "admin";
  }
  if (state.chatMessages.length) renderChatMessages();
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

  els.carSearchInput.addEventListener("input", () => {
    state.carSearch = els.carSearchInput.value;
    safeStorageSet("carpostclub.carSearch", state.carSearch);
    renderCarOptions();
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
  els.notificationButton?.addEventListener("click", togglePushNotifications);

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

  window.addEventListener("pagehide", disconnectChatStream);
  window.addEventListener("pageshow", handlePageShow);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) handlePageVisible();
  });
}

function handlePageShow(event) {
  resumeChatStream();
  if (event.persisted) validateActiveSession({ force: true }).catch(() => {});
}

function handlePageVisible() {
  resumeChatStream();
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
    const config = await apiJson("/api/push/config");
    state.pushPublicKey = config.publicKey || "";
    state.pushSubscription = await state.serviceWorkerRegistration.pushManager.getSubscription();
    if (state.pushSubscription && state.pushPublicKey) {
      savePushSubscription(state.pushSubscription).catch(() => {});
    }
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

async function togglePushNotifications() {
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

    let subscription = await state.serviceWorkerRegistration.pushManager.getSubscription();
    if (subscription) {
      await deletePushSubscription(subscription);
      await subscription.unsubscribe();
      state.pushSubscription = null;
      haptic("success");
      showStatus("Push notifications turned off.");
      return;
    }

    if (!state.pushPublicKey) {
      const config = await apiJson("/api/push/config");
      state.pushPublicKey = config.publicKey || "";
    }
    if (!state.pushPublicKey) throw new Error("Push notifications are not configured.");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(permission === "denied"
        ? "Notifications are blocked. Allow them in this browser's site settings."
        : "Notification permission was not granted.");
    }

    subscription = await state.serviceWorkerRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.pushPublicKey),
    });
    await savePushSubscription(subscription);
    state.pushSubscription = subscription;
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

  if (!els.notificationButton) return;
  const supported = pushNotificationsSupported();
  const permission = supported ? Notification.permission : "unsupported";
  const subscribed = Boolean(state.pushSubscription);
  els.notificationButton.hidden = !supported;
  els.notificationButton.disabled = state.pushBusy || permission === "denied" || !state.serviceWorkerRegistration;
  els.notificationButton.classList.toggle("is-on", subscribed);
  const label = state.pushBusy
    ? "Updating notifications"
    : subscribed
      ? "Turn off notifications"
      : permission === "denied"
        ? "Notifications blocked"
        : "Turn on notifications";
  els.notificationButton.setAttribute("aria-label", label);
  els.notificationButton.title = label;
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
  if (dealershipId) state.selectedDealershipId = dealershipId;
  if (inventoryTypeId) state.selectedInventoryTypeId = inventoryTypeId;
  if (inventoryKey) {
    state.selectedVin = inventoryKey;
    state.selectedMake = "";
    state.selectedModel = "";
    state.carSearch = "";
    safeStorageRemove("carpostclub.carSearch");
  }
  state.initialOpenAlbum = params.get("openAlbum") === "1";
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function initChat() {
  await loadChatMessages();
  connectChatStream();
}

async function loadChatMessages({ countUnread = false } = {}) {
  const previousChatIds = new Set(state.chatMessages.map((message) => message.id));
  const response = await apiJson("/api/chat/messages");
  const messages = Array.isArray(response.messages)
    ? response.messages.map(normalizeChatMessage).filter(Boolean)
    : [];
  if (countUnread && !state.chatOpen) {
    const missedUnread = messages.filter((message) => {
      return !previousChatIds.has(message.id) && !isOwnChatMessage(message);
    }).length;
    state.chatUnread += missedUnread;
  }
  state.chatMessages = messages;
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
    if (incoming && !state.chatOpen) state.chatUnread += 1;
  }

  renderChatMessages({ scrollToEnd: state.chatOpen });
  updateChatChrome();
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
    state.albums = Array.isArray(response.albums) ? response.albums : [];
    renderAlbumList();
  } finally {
    state.albumsLoading = false;
    renderAlbumList();
  }
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
  const narrowedCars = vehicleFilteredCars();
  const matchingCars = filteredCars();
  els.carCount.textContent = carCountLabel(narrowedCars.length, matchingCars.length);
  const options = [
    new Option(carSelectPlaceholder(matchingCars.length), ""),
    ...matchingCars.map((car) => new Option(carOptionLabel(car), carInventoryKey(car))),
  ];
  els.carSelect.replaceChildren(...options);
  els.carSelect.value = matchingCars.some((car) => carInventoryKey(car) === state.selectedVin) ? state.selectedVin : "";
  els.carSelect.disabled = state.uploading || !state.selectedMake || !matchingCars.length;
}

function renderVehicleFilterOptions() {
  const makeValues = uniqueFilterValues(state.cars, "make");
  if (state.selectedMake && !hasFilterValue(makeValues, state.selectedMake)) {
    state.selectedMake = "";
    state.selectedModel = "";
    clearSelectedCarSelection();
  }

  const makeOptions = [
    new Option(makeValues.length ? "Choose a make" : "No makes found", ""),
    ...makeValues.map((make) => new Option(make, make)),
  ];
  els.makeFilterSelect.replaceChildren(...makeOptions);
  els.makeFilterSelect.value = state.selectedMake;
  els.makeFilterSelect.disabled = state.uploading || !makeValues.length;

  const modelValues = state.selectedMake ? uniqueFilterValues(carsForMake(state.selectedMake), "model") : [];
  if (state.selectedModel && !hasFilterValue(modelValues, state.selectedModel)) {
    state.selectedModel = "";
  }

  const modelOptions = [
    new Option(state.selectedMake ? "All models" : "Choose a make first", ""),
    ...modelValues.map((model) => new Option(model, model)),
  ];
  els.modelFilterSelect.replaceChildren(...modelOptions);
  els.modelFilterSelect.value = state.selectedModel;
  els.modelFilterSelect.disabled = state.uploading || !state.selectedMake || !modelValues.length;
}

async function selectCar(inventoryKey) {
  const car = state.cars.find((candidate) => carInventoryKey(candidate) === inventoryKey);
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

async function loadSelectedCarAlbum({ force = false } = {}) {
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
  const response = await apiJson(`/api/vehicle-album?${params}`);
  state.activeAlbum = response.album || null;
  state.photos = Array.isArray(response.photos) ? response.photos : [];
  if (state.activeAlbum?.id) state.expandedAlbumId = state.activeAlbum.id;
}

function renderActiveCar() {
  const car = selectedCar();
  const unlocked = Boolean(car) && !state.uploading;
  els.uploadHint.textContent = car ? "Adds to the selected album tile" : "Choose inventory to create an album tile";
  els.uploadState.textContent = uploadStateLabel(car);
  els.dropZone.disabled = !unlocked;
  els.cameraButton.disabled = !unlocked;
  els.videoButton.disabled = !unlocked;
  els.carSelect.disabled = state.uploading || !state.selectedMake || !filteredCars().length;
  renderUploadRecovery();
  renderAlbumList();
}

function renderAlbumList() {
  const tiles = albumTiles();
  els.albumCount.textContent = state.albumsLoading ? "..." : String(tiles.length);
  els.albumEmpty.hidden = state.albumsLoading || tiles.length > 0;
  els.albumList.replaceChildren(...tiles.map(renderAlbumCard));
}

function albumTiles() {
  if (state.page === "gallery") return state.albums;

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
  if (car?.source === "manual") return { status: "manual", label: "Manual inventory." };
  return {
    status: "active",
    checkedAt: state.inventoryFetchedAt,
    label: inventoryFreshnessLabel(),
  };
}

function renderAlbumCard(album) {
  const isOpen = album.isSelected || state.expandedAlbumId === album.id;
  const article = document.createElement("article");
  article.className = "album-card";
  article.classList.toggle("is-open", isOpen);
  article.classList.toggle("is-selected", Boolean(album.isSelected));

  const summary = document.createElement("button");
  summary.className = "album-summary-button";
  summary.type = "button";
  summary.dataset.albumId = album.id;
  if (!album.isPending) summary.dataset.action = "toggle-album";
  summary.setAttribute("aria-expanded", String(isOpen));
  if (album.isSelected) summary.setAttribute("aria-current", "true");

  const cover = document.createElement("span");
  cover.className = "album-cover";
  if (album.coverUrl) {
    const image = document.createElement("img");
    image.src = album.coverUrl;
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
  title.textContent = album.name || album.vehicle?.title || "Vehicle package";
  const meta = document.createElement("span");
  meta.textContent = [
    album.isSelected ? "Selected" : "",
    album.vehicle?.stockNumber || album.inventoryNumber,
    album.vehicle?.dealershipName || album.dealership?.name,
    `${album.mediaCount || 0} ${plural(album.mediaCount || 0, "asset")}`,
    album.updatedAt && `Updated ${formatDate(album.updatedAt)}`,
  ].filter(Boolean).join(" · ");
  copy.append(title, meta);

  const status = inventoryStatusBadge(album.inventoryStatus);
  summary.append(cover, copy, status);
  article.append(summary);

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

  const actions = document.createElement("div");
  actions.className = "album-detail-actions";

  if (!album.isSelected && canUseSavedAlbum) {
    const openButton = document.createElement("button");
    openButton.className = "icon-text-button subtle";
    openButton.type = "button";
    openButton.dataset.action = "select-album";
    openButton.dataset.albumId = album.id;
    openButton.textContent = state.page === "gallery" ? "Upload" : "Select";
    actions.append(openButton);
  }

  const descriptionLink = albumActionLink(album, "Description", `/api/albums/${encodeURIComponent(album.id)}/description.txt`, canUseSavedAlbum && hasMedia);
  const filesButton = document.createElement("button");
  filesButton.className = "icon-text-button subtle";
  filesButton.type = "button";
  filesButton.dataset.action = "download-album-files";
  filesButton.dataset.albumId = album.id;
  filesButton.disabled = !canUseSavedAlbum || !hasMedia;
  filesButton.textContent = "Files";
  const packageLink = albumActionLink(album, "Package", `/api/albums/${encodeURIComponent(album.id)}/package`, canUseSavedAlbum && hasMedia);
  actions.append(descriptionLink, filesButton, packageLink);

  if (canUseSavedAlbum && hasMedia) {
    const clearButton = document.createElement("button");
    clearButton.className = "icon-text-button subtle danger";
    clearButton.type = "button";
    clearButton.dataset.action = "delete-album-media";
    clearButton.dataset.albumId = album.id;
    clearButton.textContent = "Clear media";
    actions.append(clearButton);
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
    media.replaceChildren(...photos.slice(0, 10).map(renderAlbumMediaThumb));
  }

  detail.append(actions, statusLine, media);
  return detail;
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

function renderAlbumMediaThumb(photo) {
  const item = document.createElement("a");
  item.className = "album-media-thumb";
  item.href = photo.url;
  item.target = "_blank";
  item.rel = "noreferrer";
  item.title = `${photo.originalName} · ${photoUploaderLabel(photo)}`;

  if (isVideoMedia(photo)) {
    const videoLabel = document.createElement("span");
    videoLabel.textContent = "Video";
    item.append(videoLabel);
  } else {
    const image = document.createElement("img");
    image.src = photo.thumbnailUrl || photo.url;
    image.alt = photo.originalName;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      if (image.src !== photo.url) image.src = photo.url;
    }, { once: true });
    item.append(image);
  }
  return item;
}

function inventoryStatusBadge(status) {
  const badge = document.createElement("span");
  badge.className = "inventory-status-badge";
  const statusName = status?.status || "unknown";
  badge.classList.add(`is-${statusName}`);
  badge.textContent = statusName === "active"
    ? "Active"
    : statusName === "missing"
      ? "No longer active"
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
    return `No longer active in O'Regan's inventory as of ${formatDate(status.checkedAt)}.`;
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
    } else if (target.dataset.action === "delete-album-media") {
      haptic("warning");
      await deleteAlbumMedia(albumId);
    }
  } catch (error) {
    showError(error);
  }
}

async function toggleAlbum(albumId) {
  if (state.expandedAlbumId === albumId) {
    state.expandedAlbumId = "";
    renderAlbumList();
    return;
  }

  state.expandedAlbumId = albumId;
  renderAlbumList();
  await loadAlbumDetails(albumId);
  renderAlbumList();
}

async function loadAlbumDetails(albumId, { force = false } = {}) {
  const existing = state.albumDetails[albumId] || {};
  if (!force && Array.isArray(existing.photos)) return existing;

  state.albumDetails[albumId] = { ...existing, loading: true };
  renderAlbumList();
  try {
    const response = await apiJson(`/api/albums/${encodeURIComponent(albumId)}/photos`);
    state.albumDetails[albumId] = {
      ...state.albumDetails[albumId],
      album: response.album,
      photos: response.photos || [],
      loading: false,
    };
    updateAlbumSummary(response.album);
    return state.albumDetails[albumId];
  } catch (error) {
    state.albumDetails[albumId] = { ...existing, loading: false };
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
    if (state.activeAlbum?.id) state.expandedAlbumId = state.activeAlbum.id;
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
  const downloads = [
    {
      href: `/api/albums/${encodeURIComponent(album.id)}/description.txt`,
      download: `${slugifyClient(album.name || "vehicle")}-marketplace-description.txt`,
    },
    ...photos.map((photo) => ({
      href: photo.downloadUrl || `${photo.url}?download=1`,
      download: photo.downloadName || photo.originalName || photo.filename,
    })),
  ];

  downloads.forEach((download, index) => {
    window.setTimeout(() => triggerFileDownload(download.href, download.download), index * 220);
  });
  showStatus(`Starting ${downloads.length} downloads.`);
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
  clearFailedUpload();
  resetUploadCelebration();
  setProgress(0);
  renderActiveCar();
  els.uploadState.textContent = `Uploading ${mediaFiles.length} ${plural(mediaFiles.length, "file")}`;

  let uploadSucceeded = false;
  try {
    const response = await uploadForm(form);
    setProgress(100);
    state.activeAlbum = response.album;
    state.photos = [...response.photos, ...state.photos];
    await loadSelectedCarAlbum({ force: true });
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

  const label = album.vehicle?.stockNumber || album.name || "this album";
  const confirmed = window.confirm(`Are you sure you want to delete all ${count} media ${plural(count, "asset")} for ${label}? This cannot be undone.`);
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
    showStatus(`Deleted ${response.deleted ?? count} media ${plural(response.deleted ?? count, "asset")}.`);
  } catch (error) {
    throw error;
  }
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
  const selected = selectedCar();
  if (keepSelectedCar && selected) {
    state.selectedMake = selected.make || state.selectedMake;
    state.selectedModel = selected.model || state.selectedModel;
  }

  const makeValues = uniqueFilterValues(state.cars, "make");
  if (state.selectedMake && !hasFilterValue(makeValues, state.selectedMake)) {
    state.selectedMake = "";
    state.selectedModel = "";
  }

  const modelValues = state.selectedMake ? uniqueFilterValues(carsForMake(state.selectedMake), "model") : [];
  if (state.selectedModel && !hasFilterValue(modelValues, state.selectedModel)) {
    state.selectedModel = "";
  }
}

function clearSelectedCarSelection() {
  state.selectedVin = "";
  state.activeAlbum = null;
  state.photos = [];
  clearFailedUpload();
}

function vehicleFilteredCars() {
  if (!state.selectedMake) return [];
  let cars = carsForMake(state.selectedMake);
  if (state.selectedModel) {
    cars = cars.filter((car) => sameFilterValue(car.model, state.selectedModel));
  }
  return cars;
}

function filteredCars() {
  const cars = vehicleFilteredCars();
  const query = normalizeSearchText(state.carSearch);
  if (!query) return cars;
  const terms = query.split(" ").filter(Boolean);
  return cars.filter((car) => {
    const haystack = normalizeSearchText(carSearchText(car));
    return terms.every((term) => haystack.includes(term));
  });
}

function carMatchesVehicleFilters(car) {
  return Boolean(car && state.selectedMake && sameFilterValue(car.make, state.selectedMake))
    && (!state.selectedModel || sameFilterValue(car.model, state.selectedModel));
}

function carCountLabel(narrowedCount, matchingCount) {
  if (!state.selectedMake) return String(state.cars.length);
  return state.carSearch.trim() ? `${matchingCount}/${narrowedCount}` : String(matchingCount);
}

function carSelectPlaceholder(count) {
  if (!state.cars.length) return "No cars found";
  if (!state.selectedMake) return "Choose a make first";
  if (!count) return "No matches";
  return "Choose inventory";
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
  safeStorageSet("carpostclub.selectedDealershipId", state.selectedDealershipId);
  safeStorageSet("carpostclub.selectedInventoryTypeId", state.selectedInventoryTypeId);
  if (state.selectedMake) safeStorageSet("carpostclub.selectedMake", state.selectedMake);
  else safeStorageRemove("carpostclub.selectedMake");
  if (state.selectedModel) safeStorageSet("carpostclub.selectedModel", state.selectedModel);
  else safeStorageRemove("carpostclub.selectedModel");
  if (state.selectedVin) safeStorageSet("carpostclub.selectedVin", state.selectedVin);
  else safeStorageRemove("carpostclub.selectedVin");
}

function clearInitialSelectionUrl() {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ["dealershipId", "inventoryTypeId", "inventoryKey", "vin", "openAlbum"]) {
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
  els.carSelect.disabled = isBusy || !state.selectedMake || !state.cars.length;
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
  ].filter(Boolean).join(" ");
}

function carsForMake(make) {
  return state.cars.filter((car) => sameFilterValue(car.make, make));
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
    car.source === "manual" ? "Manual" : "",
    car.stockNumber || car.vin,
    car.title,
    [car.price, car.odometer, car.exteriorColor].filter(Boolean).join(" / "),
  ].filter(Boolean).join(" - ");
}
