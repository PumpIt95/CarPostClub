const state = {
  dealerships: [],
  inventoryTypes: [],
  cars: [],
  photos: [],
  activeAlbum: null,
  marketplaceDraft: null,
  marketplaceLoading: false,
  marketplaceRequestId: 0,
  chatMessages: [],
  chatOpen: false,
  chatUnread: 0,
  chatEventSource: null,
  chatReconnectTimer: null,
  currentUser: null,
  selectedDealershipId: localStorage.getItem("konner.selectedDealershipId") || "15",
  selectedInventoryTypeId: localStorage.getItem("konner.selectedInventoryTypeId") || "2",
  selectedMake: localStorage.getItem("konner.selectedMake") || "",
  selectedModel: localStorage.getItem("konner.selectedModel") || "",
  selectedVin: localStorage.getItem("konner.selectedVin") || "",
  carSearch: localStorage.getItem("konner.carSearch") || "",
  galleryExpanded: false,
  failedUploadFiles: [],
  failedUploadMessage: "",
  manualFormOpen: false,
  uploading: false,
  uploadCelebrationTimer: 0,
  chatSending: false,
};

const els = {
  activeCarLink: document.querySelector("#activeCarLink"),
  activeCarMeta: document.querySelector("#activeCarMeta"),
  activeCarName: document.querySelector("#activeCarName"),
  addManualCarButton: document.querySelector("#addManualCarButton"),
  adminUsersLink: document.querySelector("#adminUsersLink"),
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
  deleteAllButton: document.querySelector("#deleteAllButton"),
  downloadAllButton: document.querySelector("#downloadAllButton"),
  dropZone: document.querySelector("#dropZone"),
  emptyGallery: document.querySelector("#emptyGallery"),
  fileInput: document.querySelector("#fileInput"),
  gallery: document.querySelector("#gallery"),
  gallerySummary: document.querySelector("#gallerySummary"),
  galleryToggleButton: document.querySelector("#galleryToggleButton"),
  inventoryTypeSelect: document.querySelector("#inventoryTypeSelect"),
  logoutForm: document.querySelector("#logoutForm"),
  marketplaceCopyButton: document.querySelector("#marketplaceCopyButton"),
  marketplaceDescription: document.querySelector("#marketplaceDescription"),
  marketplaceFields: document.querySelector("#marketplaceFields"),
  marketplacePanel: document.querySelector("#marketplacePanel"),
  marketplaceRegenerateButton: document.querySelector("#marketplaceRegenerateButton"),
  marketplaceStatus: document.querySelector("#marketplaceStatus"),
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
  cancelManualCarButton: document.querySelector("#cancelManualCarButton"),
  photoCount: document.querySelector("#photoCount"),
  refreshButton: document.querySelector("#refreshButton"),
  sourceLink: document.querySelector("#sourceLink"),
  statusBar: document.querySelector("#statusBar"),
  uploadHint: document.querySelector("#uploadHint"),
  uploadProgress: document.querySelector("#uploadProgress"),
  uploadProgressShell: document.querySelector("#uploadProgressShell"),
  uploadRecovery: document.querySelector("#uploadRecovery"),
  uploadRecoveryMessage: document.querySelector("#uploadRecoveryMessage"),
  uploadState: document.querySelector("#uploadState"),
  retryUploadButton: document.querySelector("#retryUploadButton"),
  clearUploadButton: document.querySelector("#clearUploadButton"),
  videoButton: document.querySelector("#videoButton"),
  videoInput: document.querySelector("#videoInput"),
  photoTemplate: document.querySelector("#photoTemplate"),
};

init().catch((error) => showError(error));

async function init() {
  bindEvents();
  loadCurrentUser().catch(() => {});
  initChat().catch((error) => showError(error));
  await loadInventoryFilters();
  await loadCars({ keepSelectedCar: true });
}

async function loadCurrentUser() {
  const response = await apiJson("/api/me");
  state.currentUser = response.user || null;
  if (els.adminUsersLink) {
    els.adminUsersLink.hidden = state.currentUser?.role !== "admin";
  }
}

function bindEvents() {
  window.addEventListener("beforeunload", (event) => {
    if (!state.uploading) return;
    event.preventDefault();
    event.returnValue = "";
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link || !state.uploading) return;
    event.preventDefault();
    showError("Upload still in progress. Stay on this page until it finishes.");
  }, true);

  document.addEventListener("submit", (event) => {
    if (!state.uploading) return;
    event.preventDefault();
    showError("Upload still in progress. Stay on this page until it finishes.");
  }, true);

  els.inventoryTypeSelect.addEventListener("change", () => {
    state.selectedInventoryTypeId = els.inventoryTypeSelect.value;
    state.selectedMake = "";
    state.selectedModel = "";
    clearSelectedCarSelection();
    persistSelection();
    loadCars().catch((error) => showError(error));
  });

  els.dealershipSelect.addEventListener("change", () => {
    state.selectedDealershipId = els.dealershipSelect.value;
    state.selectedMake = "";
    state.selectedModel = "";
    clearSelectedCarSelection();
    persistSelection();
    loadCars().catch((error) => showError(error));
  });

  els.makeFilterSelect.addEventListener("change", () => {
    state.selectedMake = els.makeFilterSelect.value;
    state.selectedModel = "";
    clearSelectedCarSelection();
    persistSelection();
    renderCarOptions();
    renderActiveCar();
    renderGallery();
  });

  els.modelFilterSelect.addEventListener("change", () => {
    state.selectedModel = els.modelFilterSelect.value;
    clearSelectedCarSelection();
    persistSelection();
    renderCarOptions();
    renderActiveCar();
    renderGallery();
  });

  els.carSelect.addEventListener("change", () => {
    const vin = els.carSelect.value;
    if (!vin) {
      clearSelectedCarSelection();
      persistSelection();
      renderActiveCar();
      renderGallery();
      return;
    }
    selectCar(vin).catch((error) => showError(error));
  });

  els.carSearchInput.addEventListener("input", () => {
    state.carSearch = els.carSearchInput.value;
    localStorage.setItem("konner.carSearch", state.carSearch);
    renderCarOptions();
  });

  els.refreshButton.addEventListener("click", () => {
    loadCars({ keepSelectedCar: true, forceAlbumRefresh: true }).catch((error) => showError(error));
  });

  els.addManualCarButton.addEventListener("click", () => {
    setManualCarFormOpen(true);
  });

  els.cancelManualCarButton.addEventListener("click", () => {
    setManualCarFormOpen(false);
  });

  els.manualCarForm.addEventListener("submit", (event) => {
    createManualCar(event).catch((error) => showError(error));
  });

  els.downloadAllButton.addEventListener("click", (event) => {
    if (!state.activeAlbum?.id || !state.photos.length) event.preventDefault();
  });

  els.deleteAllButton.addEventListener("click", () => {
    deleteAllPhotos().catch((error) => showError(error));
  });

  els.galleryToggleButton.addEventListener("click", () => {
    setGalleryExpanded(!state.galleryExpanded);
  });

  els.gallerySummary.addEventListener("click", () => {
    setGalleryExpanded(true);
  });

  els.retryUploadButton.addEventListener("click", () => {
    uploadFiles(state.failedUploadFiles).catch((error) => showError(error));
  });

  els.clearUploadButton.addEventListener("click", () => {
    clearFailedUpload();
    clearFileInput(els.fileInput);
    clearFileInput(els.cameraInput);
    clearFileInput(els.videoInput);
    resetUploadCelebration();
    setProgress(0);
    renderActiveCar();
  });

  els.marketplaceCopyButton.addEventListener("click", () => {
    copyMarketplaceDraft().catch((error) => showError(error));
  });

  els.marketplaceRegenerateButton.addEventListener("click", () => {
    loadMarketplaceDraft().catch((error) => showError(error));
  });

  els.logoutForm?.addEventListener("submit", (event) => {
    const confirmed = window.confirm("Are you sure you want to sign out?");
    if (!confirmed) event.preventDefault();
  });

  els.dropZone.addEventListener("click", () => {
    if (!selectedCar()) return;
    clearFileInput(els.fileInput);
    els.fileInput.click();
  });

  els.cameraButton.addEventListener("click", () => {
    if (!selectedCar()) return;
    clearFileInput(els.cameraInput);
    els.cameraInput.click();
  });

  els.videoButton.addEventListener("click", () => {
    if (!selectedCar()) return;
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

  els.chatToggle.addEventListener("click", () => setChatOpen(!state.chatOpen));
  els.chatClose.addEventListener("click", () => setChatOpen(false));
  els.chatForm.addEventListener("submit", sendChatMessage);
  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    els.chatForm.requestSubmit();
  });

  window.addEventListener("pagehide", () => {
    state.chatEventSource?.close();
    window.clearTimeout(state.chatReconnectTimer);
  });
}

async function initChat() {
  await loadChatMessages();
  connectChatStream();
}

async function loadChatMessages() {
  const response = await apiJson("/api/chat/messages");
  state.chatMessages = Array.isArray(response.messages)
    ? response.messages.map(normalizeChatMessage).filter(Boolean)
    : [];
  renderChatMessages({ scrollToEnd: true });
  updateChatChrome();
}

function connectChatStream() {
  if (!("EventSource" in window)) {
    window.clearTimeout(state.chatReconnectTimer);
    state.chatReconnectTimer = window.setTimeout(() => {
      loadChatMessages().catch(() => {});
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
    state.chatReconnectTimer = window.setTimeout(connectChatStream, 3000);
  });
}

function setChatOpen(isOpen) {
  state.chatOpen = Boolean(isOpen);
  els.chatPanel.hidden = !state.chatOpen;
  els.chatPanel.classList.toggle("is-open", state.chatOpen);
  els.chatPanel.setAttribute("aria-hidden", String(!state.chatOpen));
  els.chatToggle.setAttribute("aria-expanded", String(state.chatOpen));
  els.chatToggle.setAttribute("aria-label", state.chatOpen ? "Close chat" : "Open chat");
  if (state.chatOpen) {
    state.chatUnread = 0;
    window.setTimeout(() => {
      scrollChatToEnd();
      els.chatInput.focus();
    }, 0);
  }
  updateChatChrome();
}

async function sendChatMessage(event) {
  event.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text || state.chatSending) return;

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
    author: String(message.author || "Konner").trim() || "Konner",
    text,
    createdAt,
  };
}

function renderChatMessages({ scrollToEnd = false } = {}) {
  const wasNearBottom = isChatScrolledToBottom();
  els.chatMessages.replaceChildren(...state.chatMessages.map((message) => {
    const item = document.createElement("article");
    item.className = "chat-message";

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";

    const author = document.createElement("strong");
    author.textContent = message.author;

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
  els.manualDealershipSelect.value = state.selectedDealershipId;
}

function setManualCarFormOpen(isOpen) {
  state.manualFormOpen = Boolean(isOpen);
  els.manualCarForm.hidden = !state.manualFormOpen;
  if (!state.manualFormOpen) {
    els.manualCarForm.reset();
    return;
  }
  els.manualInventoryTypeSelect.value = state.selectedInventoryTypeId;
  els.manualDealershipSelect.value = state.selectedDealershipId;
  els.manualYear.value = new Date().getFullYear();
  window.requestAnimationFrame(() => els.manualStockNumber.focus());
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
    showStatus(`Added ${car.stockNumber || car.title}.`);
  } finally {
    submitButton.disabled = false;
  }
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
    syncVehicleFiltersWithInventory({ keepSelectedCar });
    const selected = selectedCar();
    if (!keepSelectedCar || !selected || !carMatchesVehicleFilters(selected)) clearSelectedCarSelection();
    renderCarOptions();
    persistSelection();
    await loadSelectedCarAlbum({ force: forceAlbumRefresh });
    renderActiveCar();
    renderGallery();
  } finally {
    setSelectorBusy(false);
  }
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
  renderGallery();
}

async function loadSelectedCarAlbum({ force = false } = {}) {
  const car = selectedCar();
  if (!car) {
    state.activeAlbum = null;
    state.photos = [];
    resetMarketplaceDraft();
    return;
  }
  if (!force && state.activeAlbum?.vehicle?.inventoryKey === carInventoryKey(car)) {
    if (!state.marketplaceDraft && !state.marketplaceLoading) {
      loadMarketplaceDraft().catch((error) => showError(error));
    }
    return;
  }

  const params = new URLSearchParams(carRequestPayload(car));
  const response = await apiJson(`/api/vehicle-album?${params}`);
  state.activeAlbum = response.album;
  state.photos = response.photos;
  state.galleryExpanded = false;
  resetMarketplaceDraft({ keepRequest: true });
  loadMarketplaceDraft().catch((error) => showError(error));
}

function renderActiveCar() {
  const car = selectedCar();
  const unlocked = Boolean(car) && !state.uploading;
  els.activeCarMeta.textContent = car
    ? [car.source === "manual" ? "Manual inventory" : selectedDealership()?.name, car.stockNumber, car.price].filter(Boolean).join(" · ")
    : "Select dealership and car";
  els.activeCarName.textContent = car?.title || "Upload is locked";
  els.uploadHint.textContent = car ? `Media will save to ${car.stockNumber || carInventoryKey(car)}` : "Choose a dealership and car first";
  els.uploadState.textContent = uploadStateLabel(car);
  els.dropZone.disabled = !unlocked;
  els.cameraButton.disabled = !unlocked;
  els.videoButton.disabled = !unlocked;
  els.carSelect.disabled = state.uploading || !state.selectedMake || !filteredCars().length;
  els.activeCarLink.hidden = !car?.detailUrl;
  if (car?.detailUrl) els.activeCarLink.href = car.detailUrl;
  renderUploadRecovery();
  renderMarketplaceDraft();
}

async function loadMarketplaceDraft() {
  const car = selectedCar();
  if (!car) {
    resetMarketplaceDraft();
    return;
  }

  const requestId = state.marketplaceRequestId + 1;
  state.marketplaceRequestId = requestId;
  state.marketplaceLoading = true;
  renderMarketplaceDraft();

  const payload = carRequestPayload(car);
  const response = await apiJson(`/api/marketplace-draft?${new URLSearchParams(payload)}`);

  if (state.marketplaceRequestId !== requestId) return;
  state.marketplaceDraft = response.draft;
  state.marketplaceLoading = false;
  renderMarketplaceDraft();
}

function resetMarketplaceDraft({ keepRequest = false } = {}) {
  if (!keepRequest) state.marketplaceRequestId += 1;
  state.marketplaceDraft = null;
  state.marketplaceLoading = false;
  renderMarketplaceDraft();
}

function renderMarketplaceDraft() {
  const car = selectedCar();
  els.marketplacePanel.hidden = !car;
  if (!car) {
    els.marketplaceStatus.textContent = "Select a car";
    els.marketplaceFields.replaceChildren();
    els.marketplaceDescription.value = "";
    els.marketplaceCopyButton.disabled = true;
    els.marketplaceRegenerateButton.disabled = true;
    return;
  }

  const draft = state.marketplaceDraft;
  els.marketplaceStatus.textContent = state.marketplaceLoading
    ? "Loading"
    : draft
      ? [draft.ready ? "Ready" : "Needs review", marketplaceSourceLabel(draft.descriptionSource)].filter(Boolean).join(" - ")
      : "Waiting";
  els.marketplaceCopyButton.disabled = state.marketplaceLoading || !draft?.copyText;
  els.marketplaceRegenerateButton.disabled = state.marketplaceLoading;
  els.marketplaceDescription.value = draft?.description || "";
  els.marketplaceFields.replaceChildren(...marketplaceFieldRows(draft, car));
}

function marketplaceFieldRows(draft, car) {
  const fields = draft?.fields || {};
  const rows = [
    ["Title", draft?.title || car.title],
    ["Location", fields.location],
    ["Year", fields.year || car.year],
    ["Make", fields.make || car.make],
    ["Model", fields.model || car.model],
    ["Mileage", fields.mileage ? `${Number(fields.mileage).toLocaleString("en-CA")} km` : car.odometer],
    ["Price", fields.price ? `$${Number(fields.price).toLocaleString("en-CA")}` : car.price],
    ["Body style", fields.bodyStyle || car.bodyStyle],
    ["Exterior", fields.exteriorColor || car.exteriorColor],
    ["Interior", fields.interiorColor || car.interiorColor],
    ["Condition", fields.vehicleCondition],
    ["Fuel", fields.fuelType],
    ["Transmission", fields.transmission],
  ];

  return rows.flatMap(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value || "Needs review";
    detail.classList.toggle("needs-review", !value);
    return [term, detail];
  });
}

function marketplaceSourceLabel(source) {
  if (source === "openai-upload") return "Generated";
  if (source === "template-upload") return "Template";
  if (source === "not_generated") return "Upload media first";
  if (source === "unassigned") return "No reserved copy";
  return "";
}

async function copyMarketplaceDraft() {
  const draft = state.marketplaceDraft;
  if (!draft?.copyText) return;
  await navigator.clipboard.writeText(draft.copyText);
  showStatus("Marketplace draft copied.");
}

function renderGallery() {
  els.gallery.replaceChildren();
  const hasCar = Boolean(selectedCar());
  const hasMedia = hasCar && state.photos.length > 0;
  els.photoCount.textContent = String(state.photos.length);
  renderGalleryActions();
  renderGallerySummary();
  els.emptyGallery.hidden = hasMedia || !hasCar;
  els.gallery.classList.toggle("is-collapsed", hasMedia && !state.galleryExpanded);
  if (!hasCar || !hasMedia || !state.galleryExpanded) return;

  for (const photo of state.photos) {
    const fragment = els.photoTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".photo-card");
    const frame = fragment.querySelector(".media-frame");
    const title = fragment.querySelector("strong");
    const meta = fragment.querySelector("span");
    const downloadButton = fragment.querySelector("[data-action='download']");
    const deleteButton = fragment.querySelector("[data-action='delete']");
    const isVideo = isVideoMedia(photo);

    if (isVideo) {
      const video = document.createElement("video");
      video.src = photo.url;
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      frame.append(video);
    } else {
      const link = document.createElement("a");
      link.className = "photo-link";
      link.href = photo.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      const image = document.createElement("img");
      image.src = photo.thumbnailUrl || photo.url;
      image.alt = photo.originalName;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => {
        if (image.src !== photo.url) image.src = photo.url;
      }, { once: true });
      link.append(image);
      frame.append(link);
    }

    const badge = document.createElement("span");
    badge.className = "media-kind";
    badge.textContent = isVideo ? "Video" : "Photo";
    frame.append(badge);
    title.textContent = photo.originalName;
    meta.textContent = `${isVideo ? "Video" : "Photo"} · ${formatBytes(photo.bytes)} · ${formatDate(photo.uploadedAt)}`;
    downloadButton.href = photo.downloadUrl || `${photo.url}?download=1`;
    downloadButton.download = photo.originalName || photo.filename;
    downloadButton.setAttribute("aria-label", `Download ${isVideo ? "video" : "photo"} ${photo.originalName}`);
    downloadButton.title = "Download";
    deleteButton.setAttribute("aria-label", `Delete ${isVideo ? "video" : "photo"} ${photo.originalName}`);
    deleteButton.title = "Delete";
    deleteButton.addEventListener("click", () => deletePhoto(photo, card));
    els.gallery.append(card);
  }
}

function renderGalleryActions() {
  const hasMedia = Boolean(state.activeAlbum?.id && state.photos.length);
  els.galleryToggleButton.disabled = !hasMedia;
  els.galleryToggleButton.querySelector("span").textContent = state.galleryExpanded ? "Collapse" : "Expand";
  els.galleryToggleButton.setAttribute("aria-expanded", String(state.galleryExpanded && hasMedia));
  els.downloadAllButton.href = hasMedia
    ? `/api/albums/${encodeURIComponent(state.activeAlbum.id)}/download`
    : "#";
  els.downloadAllButton.classList.toggle("is-disabled", !hasMedia);
  els.downloadAllButton.setAttribute("aria-disabled", String(!hasMedia));
  els.downloadAllButton.tabIndex = hasMedia ? 0 : -1;
  els.deleteAllButton.disabled = !hasMedia;
}

function renderGallerySummary() {
  const hasMedia = Boolean(selectedCar() && state.photos.length);
  els.gallerySummary.hidden = !hasMedia || state.galleryExpanded;
  if (!hasMedia) return;
  const count = state.photos.length;
  els.gallerySummary.querySelector("strong").textContent = `${count} saved ${plural(count, "asset")}`;
  els.gallerySummary.querySelector("span").textContent = "Expand this media folder to load thumbnails and previews.";
}

function setGalleryExpanded(isExpanded) {
  state.galleryExpanded = Boolean(isExpanded);
  renderGallery();
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
  const car = selectedCar();
  const mediaFiles = files.filter((file) => isMediaLike(file));
  if (!car || !mediaFiles.length || state.uploading) return;

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
    state.galleryExpanded = false;
    renderGallery();
    uploadSucceeded = true;
    triggerUploadConfetti();
    showStatus(`Uploaded ${response.count} ${plural(response.count, "file")} to ${car.stockNumber || carInventoryKey(car)}.`);
  } catch (error) {
    state.failedUploadFiles = mediaFiles;
    state.failedUploadMessage = error instanceof Error ? error.message : String(error);
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
    request.send(form);
  });
}

async function deletePhoto(photo, card) {
  const confirmed = window.confirm(`Are you sure you want to delete ${photo.originalName}? This cannot be undone.`);
  if (!confirmed) return;

  card.classList.add("is-removing");
  try {
    await apiJson(`/api/albums/${encodeURIComponent(photo.albumId)}/photos/${encodeURIComponent(photo.filename)}`, {
      method: "DELETE",
    });
    await loadSelectedCarAlbum({ force: true });
    renderGallery();
  } catch (error) {
    card.classList.remove("is-removing");
    showError(error);
  }
}

async function deleteAllPhotos() {
  const albumId = state.activeAlbum?.id;
  const count = state.photos.length;
  if (!albumId || !count) return;

  const car = selectedCar();
  const label = car?.stockNumber || car?.vin || "this car";
  const confirmed = window.confirm(`Are you sure you want to delete all ${count} media ${plural(count, "asset")} for ${label}? This cannot be undone.`);
  if (!confirmed) return;

  els.deleteAllButton.disabled = true;
  try {
    const response = await apiJson(`/api/albums/${encodeURIComponent(albumId)}/media`, {
      method: "DELETE",
    });
    state.photos = [];
    await loadSelectedCarAlbum({ force: true });
    renderGallery();
    showStatus(`Deleted ${response.deleted ?? count} media ${plural(response.deleted ?? count, "asset")}.`);
  } catch (error) {
    renderGalleryActions();
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
  state.galleryExpanded = false;
  clearFailedUpload();
  resetMarketplaceDraft();
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
  localStorage.setItem("konner.selectedDealershipId", state.selectedDealershipId);
  localStorage.setItem("konner.selectedInventoryTypeId", state.selectedInventoryTypeId);
  if (state.selectedMake) localStorage.setItem("konner.selectedMake", state.selectedMake);
  else localStorage.removeItem("konner.selectedMake");
  if (state.selectedModel) localStorage.setItem("konner.selectedModel", state.selectedModel);
  else localStorage.removeItem("konner.selectedModel");
  if (state.selectedVin) localStorage.setItem("konner.selectedVin", state.selectedVin);
  else localStorage.removeItem("konner.selectedVin");
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
