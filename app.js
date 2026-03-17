import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { fetchFile } from "./vendor/ffmpeg-util/index.js";

const { PDFDocument, ParseSpeeds } = window.PDFLib;
const JSZip = window.JSZip;
const PDF_FAST_PARSE_SPEED = ParseSpeeds?.Fastest ?? Number.POSITIVE_INFINITY;
const PDF_FAST_SAVE_OPTIONS = {
  useObjectStreams: false,
  objectsPerTick: 2048,
};

const STORAGE_KEYS = {
  history: "free-converter-history-v1",
  analytics: "free-converter-analytics-v1",
  profile: "free-converter-profile-v1",
};

const HISTORY_LIMIT = 12;
const SPECIAL_PRESET_LABELS = {
  screenRecorder: "Screen Recorder",
};

const presets = {
  webmToMp4: {
    group: "Video",
    label: "WebM to MP4",
    description: "Turn one WebM video into an MP4 file.",
    accept: ".webm,video/webm",
    allowedTypes: ["video/webm"],
    allowedExtensions: ["webm"],
    multiple: false,
    minimumFiles: 1,
    smartRank: 100,
    actionLabel: "Create MP4",
    dropLabel: "Drop a WebM clip or pick one from your device",
    dropHint: "Choose one WebM video",
    optionMode: "video",
    usesFfmpeg: true,
    optionsHint: "Not sure? Leave the recommended settings as they are.",
  },
  imagesToPdf: {
    group: "PDF",
    label: "Images to PDF",
    description: "Turn one or more images into one PDF file.",
    accept: "image/jpeg,image/png,image/webp",
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    multiple: true,
    minimumFiles: 1,
    smartRank: 70,
    actionLabel: "Create PDF",
    dropLabel: "Drop images or pick them from your device",
    dropHint: "Choose one or more JPG, PNG, or WebP images",
    optionMode: "pdf",
    usesFfmpeg: false,
    optionsHint: "Images stay in the same order as the file list above.",
  },
  mergePdf: {
    group: "PDF",
    label: "Merge PDFs",
    description: "Join multiple PDF files into one PDF.",
    accept: ".pdf,application/pdf",
    allowedTypes: ["application/pdf"],
    allowedExtensions: ["pdf"],
    multiple: true,
    minimumFiles: 2,
    smartRank: 100,
    actionLabel: "Combine PDFs",
    dropLabel: "Drop PDF files or pick them from your device",
    dropHint: "Choose two or more PDF files",
    optionMode: "pdf",
    usesFfmpeg: false,
    optionsHint: "The first file stays first, the second stays second, and so on.",
  },
  imageToJpg: {
    group: "Image",
    label: "PNG / WebP to JPG",
    description: "Turn PNG or WebP images into JPG files.",
    accept: "image/png,image/webp",
    allowedTypes: ["image/png", "image/webp"],
    allowedExtensions: ["png", "webp"],
    multiple: true,
    minimumFiles: 1,
    smartRank: 72,
    actionLabel: "Create JPG",
    dropLabel: "Drop PNG or WebP images or pick them from your device",
    dropHint: "Choose one or more PNG or WebP images",
    optionMode: "image",
    usesFfmpeg: false,
    optionsHint: "Higher quality looks better but can make bigger files.",
  },
  imageToPng: {
    group: "Image",
    label: "JPG / WebP to PNG",
    description: "Turn JPG or WebP images into PNG files.",
    accept: "image/jpeg,image/png,image/webp",
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    multiple: true,
    minimumFiles: 1,
    smartRank: 62,
    actionLabel: "Create PNG",
    dropLabel: "Drop JPG, PNG, or WebP images or pick them from your device",
    dropHint: "Choose one or more JPG, PNG, or WebP images",
    optionMode: "image",
    usesFfmpeg: false,
    optionsHint: "PNG keeps transparency when the original image has it.",
  },
  imageToWebp: {
    group: "Image",
    label: "JPG / PNG to WebP",
    description: "Turn JPG or PNG images into WebP files.",
    accept: "image/jpeg,image/png",
    allowedTypes: ["image/jpeg", "image/png"],
    allowedExtensions: ["jpg", "jpeg", "png"],
    multiple: true,
    minimumFiles: 1,
    smartRank: 78,
    actionLabel: "Create WebP",
    dropLabel: "Drop JPG or PNG images or pick them from your device",
    dropHint: "Choose one or more JPG or PNG images",
    optionMode: "image",
    usesFfmpeg: false,
    optionsHint: "WebP is useful when you want smaller image files.",
  },
};

const state = {
  presetKey: "webmToMp4",
  files: [],
  busy: false,
  cancelRequested: false,
  ffmpeg: null,
  ffmpegPromise: null,
  ffmpegReady: false,
  downloadUrls: [],
  videoInfo: null,
  pendingFiles: [],
  currentJob: null,
  history: loadStored(STORAGE_KEYS.history, []),
  analytics: loadStored(STORAGE_KEYS.analytics, createDefaultAnalytics()),
  profile: normalizeProfile(loadStored(STORAGE_KEYS.profile, null)),
  diagnostics: [],
  recorderFormats: [],
  recording: {
    active: false,
    processing: false,
    stopRequested: false,
    stream: null,
    mediaRecorder: null,
    chunks: [],
    startedAt: 0,
    timerId: null,
    desiredFormat: "",
    captureMimeType: "",
    fileBaseName: "",
    previewUrl: "",
  },
  videoSettingsTouched: false,
};

const elements = {
  presetSelect: document.querySelector("#presetSelect"),
  workflowGrid: document.querySelector("#workflowGrid"),
  fileInput: document.querySelector("#fileInput"),
  pickFilesButton: document.querySelector("#pickFilesButton"),
  clearFilesButton: document.querySelector("#clearFilesButton"),
  dropZone: document.querySelector("#dropZone"),
  dropZoneLabel: document.querySelector("#dropZoneLabel"),
  dropZoneHint: document.querySelector("#dropZoneHint"),
  dropZoneTip: document.querySelector("#dropZoneTip"),
  smartMatch: document.querySelector("#smartMatch"),
  smartMatchText: document.querySelector("#smartMatchText"),
  smartMatchActions: document.querySelector("#smartMatchActions"),
  helperText: document.querySelector("#helperText"),
  selectionSummary: document.querySelector("#selectionSummary"),
  countBadge: document.querySelector("#countBadge"),
  fileList: document.querySelector("#fileList"),
  statusText: document.querySelector("#statusText"),
  progressFill: document.querySelector("#progressFill"),
  convertButton: document.querySelector("#convertButton"),
  cancelButton: document.querySelector("#cancelButton"),
  formatBadge: document.querySelector("#formatBadge"),
  downloads: document.querySelector("#downloads"),
  downloadsEmpty: document.querySelector("#downloadsEmpty"),
  videoOptions: document.querySelector("#videoOptions"),
  imageOptions: document.querySelector("#imageOptions"),
  pdfOptions: document.querySelector("#pdfOptions"),
  optionsHint: document.querySelector("#optionsHint"),
  advancedOptions: document.querySelector("#advancedOptions"),
  videoWarning: document.querySelector("#videoWarning"),
  videoProfileSelect: document.querySelector("#videoProfileSelect"),
  videoWidthSelect: document.querySelector("#videoWidthSelect"),
  videoFpsSelect: document.querySelector("#videoFpsSelect"),
  stripAudioCheckbox: document.querySelector("#stripAudioCheckbox"),
  jpgQualityRange: document.querySelector("#jpgQualityRange"),
  webpQualityRange: document.querySelector("#webpQualityRange"),
  jpgQualityLabel: document.querySelector("#jpgQualityLabel"),
  webpQualityLabel: document.querySelector("#webpQualityLabel"),
  diagnosticsGrid: document.querySelector("#diagnosticsGrid"),
  deviceHint: document.querySelector("#deviceHint"),
  historyList: document.querySelector("#historyList"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  profileNameInput: document.querySelector("#profileNameInput"),
  pinInput: document.querySelector("#pinInput"),
  unlockPinInput: document.querySelector("#unlockPinInput"),
  authStatus: document.querySelector("#authStatus"),
  saveProfileButton: document.querySelector("#saveProfileButton"),
  setPinButton: document.querySelector("#setPinButton"),
  unlockButton: document.querySelector("#unlockButton"),
  lockButton: document.querySelector("#lockButton"),
  removePinButton: document.querySelector("#removePinButton"),
  statSuccess: document.querySelector("#statSuccess"),
  statFailed: document.querySelector("#statFailed"),
  statBytes: document.querySelector("#statBytes"),
  statLastRun: document.querySelector("#statLastRun"),
  favoritePreset: document.querySelector("#favoritePreset"),
  recordFormatSelect: document.querySelector("#recordFormatSelect"),
  recordQualitySelect: document.querySelector("#recordQualitySelect"),
  recordWidthSelect: document.querySelector("#recordWidthSelect"),
  recordFpsSelect: document.querySelector("#recordFpsSelect"),
  recordAudioCheckbox: document.querySelector("#recordAudioCheckbox"),
  recorderWarning: document.querySelector("#recorderWarning"),
  recorderHint: document.querySelector("#recorderHint"),
  startRecordingButton: document.querySelector("#startRecordingButton"),
  stopRecordingButton: document.querySelector("#stopRecordingButton"),
  recorderStatusText: document.querySelector("#recorderStatusText"),
  recorderTimerText: document.querySelector("#recorderTimerText"),
  recorderOutputMeta: document.querySelector("#recorderOutputMeta"),
  recorderPreview: document.querySelector("#recorderPreview"),
};

void boot();

async function boot() {
  if (!window.PDFLib || !window.JSZip) {
    setStatus("Vendor libraries failed to load. Refresh the page and try again.", true);
    return;
  }

  populatePresetSelect();
  populateRecorderFormats();
  bindEvents();
  state.diagnostics = detectDiagnostics();
  renderDiagnostics();
  renderProfile();
  renderAnalytics();
  renderHistory();
  updateQualityLabels();
  applyPreset(state.presetKey);
  renderRecorderWarning();
  renderRecorderTimer();
  await registerServiceWorker();
  scheduleFfmpegWarmup();
}

function populatePresetSelect() {
  for (const [key, preset] of Object.entries(presets)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = preset.label;
    elements.presetSelect.append(option);
  }
}

function populateRecorderFormats() {
  state.recorderFormats = getRecorderFormatOptions();
  elements.recordFormatSelect.innerHTML = "";

  if (state.recorderFormats.length === 0) {
    const option = document.createElement("option");
    option.value = "unsupported";
    option.textContent = "Unavailable";
    elements.recordFormatSelect.append(option);
    return;
  }

  for (const format of state.recorderFormats) {
    const option = document.createElement("option");
    option.value = format.id;
    option.textContent = format.label;
    elements.recordFormatSelect.append(option);
  }

  if (state.recorderFormats.some((format) => format.id === "mp4")) {
    elements.recordFormatSelect.value = "mp4";
  }
}

function bindEvents() {
  elements.presetSelect.addEventListener("change", () => {
    applyPreset(elements.presetSelect.value);
  });
  elements.workflowGrid.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-preset-key]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    applyPreset(button.dataset.presetKey);
  });
  elements.pickFilesButton.addEventListener("click", () => {
    elements.fileInput.click();
  });
  elements.pickFilesButton.addEventListener("mouseenter", primeFfmpegForCurrentPreset, { passive: true });
  elements.pickFilesButton.addEventListener("focus", primeFfmpegForCurrentPreset, { passive: true });
  elements.clearFilesButton.addEventListener("click", clearSelectedFiles);
  elements.dropZone.addEventListener("click", () => {
    if (!isWorkspaceLocked()) {
      elements.fileInput.click();
    }
  });
  elements.dropZone.addEventListener("mouseenter", primeFfmpegForCurrentPreset, { passive: true });
  elements.dropZone.addEventListener("focus", primeFfmpegForCurrentPreset, { passive: true });
  elements.fileInput.addEventListener("change", () => {
    void setSelectedFiles(Array.from(elements.fileInput.files || []));
  });
  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!isWorkspaceLocked()) {
      elements.dropZone.classList.add("is-dragover");
    }
  });
  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("is-dragover");
  });
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragover");
    if (!isWorkspaceLocked()) {
      void setSelectedFiles(Array.from(event.dataTransfer?.files || []));
    }
  });
  elements.smartMatchActions.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-match-preset]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    if (state.pendingFiles.length === 0) {
      return;
    }

    setActivePreset(button.dataset.matchPreset);
    void setSelectedFiles([...state.pendingFiles], { allowSmartMatch: false });
  });
  elements.convertButton.addEventListener("click", () => {
    void runConversion();
  });
  elements.cancelButton.addEventListener("click", cancelCurrentJob);
  elements.videoProfileSelect.addEventListener("change", () => {
    state.videoSettingsTouched = true;
  });
  elements.videoWidthSelect.addEventListener("change", () => {
    state.videoSettingsTouched = true;
    renderVideoWarning();
  });
  elements.videoFpsSelect.addEventListener("change", () => {
    state.videoSettingsTouched = true;
  });
  elements.stripAudioCheckbox.addEventListener("change", () => {
    state.videoSettingsTouched = true;
  });
  elements.jpgQualityRange.addEventListener("input", updateQualityLabels);
  elements.webpQualityRange.addEventListener("input", updateQualityLabels);
  elements.saveProfileButton.addEventListener("click", saveProfileName);
  elements.setPinButton.addEventListener("click", () => {
    void setWorkspacePin();
  });
  elements.unlockButton.addEventListener("click", () => {
    void unlockWorkspace();
  });
  elements.lockButton.addEventListener("click", lockWorkspace);
  elements.removePinButton.addEventListener("click", removeWorkspacePin);
  elements.clearHistoryButton.addEventListener("click", clearActivity);
  elements.recordFormatSelect.addEventListener("change", renderRecorderWarning);
  elements.recordQualitySelect.addEventListener("change", renderRecorderWarning);
  elements.recordWidthSelect.addEventListener("change", renderRecorderWarning);
  elements.recordFpsSelect.addEventListener("change", renderRecorderWarning);
  elements.recordAudioCheckbox.addEventListener("change", renderRecorderWarning);
  elements.startRecordingButton.addEventListener("click", () => {
    void startScreenRecording();
  });
  elements.stopRecordingButton.addEventListener("click", () => {
    void stopScreenRecording();
  });
}

function applyPreset(presetKey) {
  setActivePreset(presetKey);
  clearSelectedFiles();
}

function setActivePreset(presetKey) {
  const preset = presets[presetKey];
  state.presetKey = presetKey;
  state.videoSettingsTouched = false;
  resetOptionInputs();
  elements.presetSelect.value = presetKey;
  elements.fileInput.accept = preset.accept;
  elements.fileInput.multiple = preset.multiple;
  elements.helperText.textContent = preset.description;
  elements.dropZoneLabel.textContent = preset.dropLabel;
  elements.dropZoneHint.textContent = preset.dropHint;
  elements.dropZoneTip.textContent = getDropZoneTip(preset);
  elements.convertButton.textContent = preset.actionLabel;
  elements.formatBadge.textContent = preset.label;
  elements.optionsHint.textContent = preset.optionsHint;
  elements.videoOptions.hidden = preset.optionMode !== "video";
  elements.imageOptions.hidden = preset.optionMode !== "image";
  elements.pdfOptions.hidden = preset.optionMode !== "pdf";
  elements.advancedOptions.open = false;
  renderWorkflowCards();
  renderSelectionSummary();
  renderVideoWarning();
  syncControlAvailability();
  scheduleFfmpegWarmup();
}

function resetOptionInputs() {
  elements.videoProfileSelect.value = "balanced";
  elements.videoWidthSelect.value = "1280";
  elements.videoFpsSelect.value = "30";
  elements.stripAudioCheckbox.checked = false;
  elements.jpgQualityRange.value = "92";
  elements.webpQualityRange.value = "90";
  updateQualityLabels();
}

function updateQualityLabels() {
  elements.jpgQualityLabel.textContent = `${elements.jpgQualityRange.value}%`;
  elements.webpQualityLabel.textContent = `${elements.webpQualityRange.value}%`;
}

function renderWorkflowCards() {
  elements.workflowGrid.innerHTML = "";

  for (const [key, preset] of Object.entries(presets)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `workflow-card ${key === state.presetKey ? "is-active" : ""}`;
    button.dataset.presetKey = key;
    button.setAttribute("aria-pressed", String(key === state.presetKey));

    const header = document.createElement("div");
    header.className = "workflow-card-head";

    const title = document.createElement("strong");
    title.textContent = preset.label;

    const type = document.createElement("span");
    type.className = "workflow-card-type";
    type.textContent = preset.group;

    header.append(title, type);

    const description = document.createElement("p");
    description.textContent = preset.description;

    const meta = document.createElement("div");
    meta.className = "workflow-card-meta";

    const count = document.createElement("span");
    count.textContent = preset.multiple ? "One or many files" : "One file";

    const engine = document.createElement("span");
    engine.textContent = "Easy start";

    meta.append(count, engine);
    button.append(header, description, meta);
    elements.workflowGrid.append(button);
  }
}

function getDropZoneTip(preset) {
  if (preset.usesFfmpeg) {
    return "Your file stays on this device. Large videos can take a little longer.";
  }

  if (preset.optionMode === "pdf") {
    return "Your files stay on this device and keep the same order shown below.";
  }

  return "Your files stay on this device while the conversion runs.";
}

function getPresetOutputLabel(preset) {
  if (preset.actionLabel.startsWith("Create ")) {
    return preset.actionLabel.replace("Create ", "");
  }

  if (preset.actionLabel === "Create PDF") {
    return "PDF";
  }

  if (preset.actionLabel === "Combine PDFs") {
    return "merged PDF";
  }

  return preset.actionLabel.toLowerCase();
}

function getPresetRequirementText(preset) {
  if (preset.minimumFiles <= 1) {
    return preset.multiple ? "Add one or more files." : "Add one file.";
  }

  return `Add at least ${preset.minimumFiles} files.`;
}

function renderSelectionSummary() {
  const preset = presets[state.presetKey];

  if (state.files.length === 0) {
    elements.selectionSummary.textContent =
      `${getPresetRequirementText(preset)} The result will be a ${getPresetOutputLabel(preset)} file.`;
    return;
  }

  const totalBytes = state.files.reduce((sum, file) => sum + file.size, 0);
  const suffix = state.files.length === 1 ? "file is" : "files are";
  let summary =
    `${state.files.length} ${suffix} selected (${formatBytes(totalBytes)} total). ` +
    `The result will be a ${getPresetOutputLabel(preset)} file.`;

  if (state.videoInfo) {
    summary += ` Video size: ${state.videoInfo.width}x${state.videoInfo.height}. Length: ${formatDuration(state.videoInfo.duration)}.`;
  }

  if (state.files.length < preset.minimumFiles) {
    summary += ` Add ${preset.minimumFiles - state.files.length} more to continue.`;
  }

  elements.selectionSummary.textContent = summary;
}

function clearSmartMatch() {
  state.pendingFiles = [];
  elements.smartMatch.hidden = true;
  elements.smartMatchText.textContent = "Choose the result you want for these files.";
  elements.smartMatchActions.innerHTML = "";
}

function renderSmartMatch(files, presetKeys) {
  state.pendingFiles = [...files];
  elements.smartMatch.hidden = false;
  elements.smartMatchText.textContent =
    `These ${files.length} file${files.length === 1 ? "" : "s"} can work in more than one way. Choose the result you want.`;
  elements.smartMatchActions.innerHTML = "";

  for (const key of presetKeys) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.matchPreset = key;
    button.textContent = presets[key].label;
    elements.smartMatchActions.append(button);
  }
}

function getMatchingPresetKeys(files) {
  return Object.entries(presets)
    .filter(([, preset]) => {
      if (files.length < preset.minimumFiles) {
        return false;
      }

      if (!preset.multiple && files.length > 1) {
        return false;
      }

      return files.every((file) => matchesPresetFile(file, preset));
    })
    .sort((left, right) => right[1].smartRank - left[1].smartRank)
    .map(([key]) => key);
}

async function setSelectedFiles(files, options = {}) {
  const { allowSmartMatch = true } = options;
  const preset = presets[state.presetKey];
  const matchingFiles = files.filter((file) => matchesPresetFile(file, preset));
  const validFiles = preset.multiple ? matchingFiles : matchingFiles.slice(0, 1);
  const skippedCount = files.length - validFiles.length;

  clearSmartMatch();

  if (validFiles.length === 0 && files.length > 0 && allowSmartMatch) {
    const matchingPresetKeys = getMatchingPresetKeys(files);

    if (matchingPresetKeys.length === 1 && matchingPresetKeys[0] !== state.presetKey) {
      setActivePreset(matchingPresetKeys[0]);
      await setSelectedFiles(files, { allowSmartMatch: false });
      setStatus(
        `We switched to ${presets[matchingPresetKeys[0]].label} because it matches your file. Ready when you are.`,
      );
      return;
    }

    if (matchingPresetKeys.length > 1 && !matchingPresetKeys.includes(state.presetKey)) {
      state.files = [];
      state.videoInfo = null;
      clearDownloads();
      updateFileList();
      renderSelectionSummary();
      renderVideoWarning();
      renderSmartMatch(files, matchingPresetKeys);
      setStatus("Choose the result you want for these files.");
      setProgress(0);
      syncControlAvailability();
      return;
    }
  }

  state.files = validFiles;
  clearDownloads();
  updateFileList();
  state.videoInfo = null;
  renderSelectionSummary();

  if (validFiles.length === 0) {
    if (skippedCount > 0) {
      setStatus("These files do not match the option you picked.", true);
      renderVideoWarning();
      syncControlAvailability();
      return;
    }

    setStatus("Pick or drop files to begin.");
    setProgress(0);
    renderVideoWarning();
    syncControlAvailability();
    return;
  }

  if (preset.usesFfmpeg) {
    void loadFfmpeg({ quiet: true }).catch(() => {});
  }

  if (preset.optionMode === "video") {
    await inspectVideoFile(validFiles[0]);
  } else {
    renderVideoWarning();
  }

  renderSelectionSummary();

  if (validFiles.length < preset.minimumFiles) {
    const remaining = preset.minimumFiles - validFiles.length;
    setStatus(
      `Add ${remaining} more file${remaining === 1 ? "" : "s"} to continue.`,
    );
    setProgress(0);
    syncControlAvailability();
    return;
  }

  if (skippedCount > 0) {
    setStatus(
      `${skippedCount} file${skippedCount === 1 ? "" : "s"} did not match, but the rest are ready.`,
    );
    setProgress(0);
    syncControlAvailability();
    return;
  }

  setStatus("Ready. Press the button below to start.");
  setProgress(0);
  syncControlAvailability();
}

function clearSelectedFiles() {
  state.files = [];
  state.videoInfo = null;
  clearSmartMatch();
  elements.fileInput.value = "";
  updateFileList();
  renderSelectionSummary();
  clearDownloads();
  setStatus(isWorkspaceLocked() ? "Unlock the workspace to continue." : "Pick or drop files to begin.");
  setProgress(0);
  renderVideoWarning();
  syncControlAvailability();
}

function updateFileList() {
  elements.fileList.innerHTML = "";

  if (state.files.length === 0) {
    const empty = document.createElement("li");
    empty.className = "file-empty";
    empty.textContent = "No files selected yet.";
    elements.fileList.append(empty);
    elements.countBadge.textContent = "0 files";
    return;
  }

  for (const file of state.files) {
    const item = document.createElement("li");
    item.className = "file-item";

    const name = document.createElement("p");
    name.className = "file-name";
    name.textContent = file.name;

    const meta = document.createElement("p");
    meta.className = "file-meta";
    meta.textContent = `${file.type || "unknown"} - ${formatBytes(file.size)}`;

    item.append(name, meta);
    elements.fileList.append(item);
  }

  const suffix = state.files.length === 1 ? "file" : "files";
  elements.countBadge.textContent = `${state.files.length} ${suffix}`;
  renderSelectionSummary();
}

async function inspectVideoFile(file) {
  try {
    const info = await readVideoMetadata(file);
    state.videoInfo = assessVideoWorkload(info, file.size);
    maybeApplyRecommendedVideoSettings();
  } catch {
    state.videoInfo = null;
  }

  renderVideoWarning();
}

function renderVideoWarning() {
  const preset = presets[state.presetKey];

  if (preset.optionMode !== "video" || !state.videoInfo) {
    elements.videoWarning.hidden = true;
    elements.videoWarning.textContent = "";
    return;
  }

  const { width, height, duration, severity } = state.videoInfo;
  const recommendation =
    severity === "severe"
      ? "This is a large video. Faster settings were picked to help it finish."
      : severity === "high"
        ? "This video may take a while. Faster settings are safer."
        : severity === "medium"
          ? "This should be fine with the recommended settings."
          : "This file looks small enough for a normal in-browser conversion.";

  elements.videoWarning.hidden = false;
  elements.videoWarning.textContent =
    `Video detected: ${width}x${height}, ${formatDuration(duration)}. ${recommendation}`;
  elements.advancedOptions.open = severity === "high" || severity === "severe";
}

function maybeApplyRecommendedVideoSettings() {
  if (!state.videoInfo || state.videoSettingsTouched) {
    return;
  }

  const aggressive = shouldUseAggressiveVideoDefaults(state.videoInfo);

  if (state.videoInfo.severity === "high") {
    elements.videoProfileSelect.value = "compressed";
    elements.videoWidthSelect.value = aggressive ? "854" : "1280";
    elements.videoFpsSelect.value = aggressive ? "20" : "24";
  } else if (state.videoInfo.severity === "severe") {
    elements.videoProfileSelect.value = "compressed";
    elements.videoWidthSelect.value = aggressive ? "640" : "854";
    elements.videoFpsSelect.value = aggressive ? "20" : "24";
    elements.stripAudioCheckbox.checked = true;
  }
}

function shouldUseAggressiveVideoDefaults(videoInfo) {
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  return memory <= 4 || cores <= 4 || (videoInfo?.score || 0) >= 180;
}

function renderRecorderWarning(options = {}) {
  const preserveStatus = options.preserveStatus === true;
  const available = canScreenRecord();
  const selectedFormat = getSelectedRecorderFormat();

  if (!available || !selectedFormat) {
    elements.recorderWarning.hidden = false;
    elements.recorderWarning.textContent =
      "Screen recording is not fully supported in this browser.";
    if (!isRecorderBusy() && !preserveStatus) {
      setRecorderStatus("Screen recording is not available in this browser.", true);
      elements.recorderOutputMeta.textContent =
        "Try Chrome, Edge, or Firefox for the best recording support.";
    }
    return;
  }

  const qualityLabel =
    elements.recordQualitySelect.selectedOptions[0]?.textContent ||
    elements.recordQualitySelect.value;
  const widthLabel =
    elements.recordWidthSelect.selectedOptions[0]?.textContent ||
    (elements.recordWidthSelect.value === "original"
      ? "original width"
      : `${elements.recordWidthSelect.value}px max width`);
  const notes = [
    `Saving as ${selectedFormat.label}.`,
    `${widthLabel} at ${elements.recordFpsSelect.value} FPS with ${qualityLabel}.`,
  ];

  if (selectedFormat.needsTranscode) {
    notes.push("This browser will record first, then finish the MP4 after you stop.");
  }

  if (elements.recordAudioCheckbox.checked) {
    notes.push("Audio depends on what the browser lets the app capture.");
  }

  elements.recorderWarning.hidden = false;
  elements.recorderWarning.textContent = notes.join(" ");

  if (!isRecorderBusy() && !preserveStatus) {
    setRecorderStatus("Ready");
    elements.recorderOutputMeta.textContent =
      "Your recording stays on this device and will appear in the downloads area.";
  }
}

function setRecorderStatus(message, isError = false) {
  elements.recorderStatusText.textContent = message;
  elements.recorderStatusText.classList.toggle("is-error", isError);
}

function renderRecorderTimer() {
  if (!state.recording.startedAt) {
    elements.recorderTimerText.textContent = "00:00";
    return;
  }

  const elapsedMs = Math.max(0, Date.now() - state.recording.startedAt);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  elements.recorderTimerText.textContent = `${minutes}:${seconds}`;
}

function startRecorderTimer() {
  stopRecorderTimer();
  renderRecorderTimer();
  state.recording.timerId = window.setInterval(renderRecorderTimer, 500);
}

function stopRecorderTimer() {
  if (state.recording.timerId) {
    window.clearInterval(state.recording.timerId);
    state.recording.timerId = null;
  }
}

function clearRecorderPreview() {
  if (state.recording.previewUrl) {
    URL.revokeObjectURL(state.recording.previewUrl);
    state.recording.previewUrl = "";
  }

  elements.recorderPreview.pause();
  elements.recorderPreview.removeAttribute("src");
  elements.recorderPreview.hidden = true;
}

function setRecorderPreview(blob) {
  clearRecorderPreview();
  const url = URL.createObjectURL(blob);
  state.recording.previewUrl = url;
  elements.recorderPreview.src = url;
  elements.recorderPreview.hidden = false;
}

async function startScreenRecording() {
  if (state.busy || state.recording.active || state.recording.processing) {
    return;
  }

  if (isWorkspaceLocked()) {
    setRecorderStatus("Unlock the workspace before starting a recording.", true);
    return;
  }

  const selectedFormat = getSelectedRecorderFormat();

  if (!canScreenRecord() || !selectedFormat) {
    renderRecorderWarning();
    return;
  }

  const settings = getRecorderSettings();
  const displayOptions = buildDisplayMediaOptions(settings);

  if (selectedFormat.needsTranscode) {
    void loadFfmpeg({ quiet: true }).catch(() => {});
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
    const videoTrack = stream.getVideoTracks()[0];

    if (!videoTrack) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("The browser did not provide a screen video track.");
    }

    await applyPreferredTrackConstraints(videoTrack, settings);

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: selectedFormat.captureMimeType,
      videoBitsPerSecond: settings.videoBitsPerSecond,
      ...(settings.includeAudio ? { audioBitsPerSecond: settings.audioBitsPerSecond } : {}),
    });

    clearDownloads();
    clearRecorderPreview();

    state.recording.active = true;
    state.recording.processing = false;
    state.recording.stopRequested = false;
    state.recording.stream = stream;
    state.recording.mediaRecorder = mediaRecorder;
    state.recording.chunks = [];
    state.recording.startedAt = Date.now();
    state.recording.desiredFormat = selectedFormat.id;
    state.recording.captureMimeType = selectedFormat.captureMimeType;
    state.recording.fileBaseName = buildRecordingFileBaseName();

    state.currentJob = {
      id: createJobId(),
      presetKey: "screenRecorder",
      presetLabel: SPECIAL_PRESET_LABELS.screenRecorder,
      inputNames: ["display capture"],
      inputBytes: 0,
      startedAt: state.recording.startedAt,
    };

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        state.recording.chunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", () => {
      void finalizeRecordingOutput({
        desiredFormat: selectedFormat.id,
        includeAudio: settings.includeAudio,
        quality: settings.quality,
        width: settings.maxWidth,
        fps: settings.fps,
        fileBaseName: state.recording.fileBaseName,
      });
    }, { once: true });

    mediaRecorder.addEventListener("error", () => {
      void failRecordingJob("The browser reported an error while capturing the screen.");
    }, { once: true });

    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        if (state.recording.active && !state.recording.stopRequested) {
          void stopScreenRecording();
        }
      }, { once: true });
    }

    mediaRecorder.start(1000);
    startRecorderTimer();
    setRecorderStatus(`Recording ${selectedFormat.label}`);
    elements.recorderOutputMeta.textContent =
      "Screen recording is live. Stop the capture when you are ready to save it.";
    syncControlAvailability();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      setRecorderStatus("Screen selection was cancelled.", true);
      elements.recorderOutputMeta.textContent =
        "Choose a screen, window, or tab when you are ready to capture.";
      return;
    }

    const message =
      error instanceof Error ? error.message : "Could not start screen capture.";
    setRecorderStatus(message, true);
    elements.recorderOutputMeta.textContent =
      "Screen recording could not be started in this browser session.";
  }
}

async function stopScreenRecording() {
  if (!state.recording.active || !state.recording.mediaRecorder) {
    return;
  }

  if (state.recording.stopRequested) {
    return;
  }

  state.recording.stopRequested = true;
  setRecorderStatus("Finishing recording...");
  stopRecorderTimer();

  if (typeof state.recording.mediaRecorder.requestData === "function") {
    try {
      state.recording.mediaRecorder.requestData();
    } catch {
      // Some browsers reject requestData during teardown, which is safe to ignore.
    }
  }

  if (state.recording.mediaRecorder.state !== "inactive") {
    state.recording.mediaRecorder.stop();
  }

  window.setTimeout(() => {
    if (state.recording.active && state.recording.stopRequested) {
      stopRecorderTracks();
    }
  }, 180);
}

async function finalizeRecordingOutput(session) {
  const chunks = [...state.recording.chunks];
  const mimeType = state.recording.captureMimeType;

  stopRecorderTracks();
  stopRecorderTimer();
  state.recording.active = false;
  state.recording.processing = true;
  syncControlAvailability();

  try {
    if (chunks.length === 0) {
      throw new Error("No recording data was captured.");
    }

    const recordedBlob = new Blob(chunks, { type: mimeType });
    let outputs = [];
    let note = "";

    if (session.desiredFormat === "mp4" && !mimeType.startsWith("video/mp4")) {
      setRecorderStatus("Converting recording to MP4...");
      outputs = await transcodeRecordedBlobToMp4(recordedBlob, session);
      note = "Screen recording captured and converted to MP4.";
    } else {
      const extension = session.desiredFormat === "mp4" ? "mp4" : "webm";
      const finalBlob =
        session.desiredFormat === "mp4"
          ? new Blob([await recordedBlob.arrayBuffer()], { type: "video/mp4" })
          : recordedBlob;
      const result = addDownload({
        name: `${session.fileBaseName}.${extension}`,
        blob: finalBlob,
        caption: `Screen recording exported as ${extension.toUpperCase()}.`,
      });
      outputs = [result];
      note = `Screen recording exported as ${extension.toUpperCase()}.`;
      setRecorderPreview(finalBlob);
    }

    if (!elements.recorderPreview.hidden) {
      elements.recorderPreview.currentTime = 0;
    }

    setRecorderStatus("Recording ready to download");
    elements.recorderOutputMeta.textContent =
      `${outputs[0].name} - ${formatBytes(outputs[0].size)}`;
    finalizeJob("success", outputs, note);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Screen recording could not be exported.";
    await failRecordingJob(message);
  } finally {
    state.recording.processing = false;
    state.recording.stopRequested = false;
    state.recording.mediaRecorder = null;
    state.recording.stream = null;
    state.recording.chunks = [];
    state.recording.startedAt = 0;
    state.recording.captureMimeType = "";
    state.recording.desiredFormat = "";
    state.recording.fileBaseName = "";
    renderRecorderTimer();
    renderRecorderWarning({ preserveStatus: true });
    syncControlAvailability();
  }
}

async function failRecordingJob(message) {
  stopRecorderTracks();
  stopRecorderTimer();
  state.recording.active = false;
  state.recording.processing = false;
  state.recording.stopRequested = false;
  state.recording.mediaRecorder = null;
  state.recording.stream = null;
  state.recording.chunks = [];
  state.recording.startedAt = 0;
  state.recording.captureMimeType = "";
  state.recording.desiredFormat = "";
  state.recording.fileBaseName = "";
  setRecorderStatus(message, true);
  elements.recorderOutputMeta.textContent =
    "The recording did not finish successfully. Adjust the settings and try again.";
  renderRecorderTimer();
  finalizeJob("failed", [], message);
  syncControlAvailability();
}

function stopRecorderTracks() {
  if (!state.recording.stream) {
    return;
  }

  for (const track of state.recording.stream.getTracks()) {
    track.stop();
  }
}

async function runConversion() {
  const preset = presets[state.presetKey];

  if (state.busy) {
    return;
  }

  if (isRecorderBusy()) {
    setStatus("Finish the current screen recording before starting a conversion.", true);
    return;
  }

  if (isWorkspaceLocked()) {
    setStatus("Unlock the workspace before starting a new conversion.", true);
    return;
  }

  if (state.files.length < preset.minimumFiles) {
    setStatus(getPresetRequirementText(preset), true);
    return;
  }

  state.busy = true;
  state.cancelRequested = false;
  state.currentJob = {
    id: createJobId(),
    presetKey: state.presetKey,
    presetLabel: preset.label,
    inputNames: state.files.map((file) => file.name),
    inputBytes: state.files.reduce((sum, file) => sum + file.size, 0),
    startedAt: Date.now(),
  };

  clearDownloads();
  setProgress(2);
  syncControlAvailability();

  try {
    let outputs = [];
    let note = "";

    switch (state.presetKey) {
      case "webmToMp4":
        outputs = await convertWebmToMp4(state.files[0]);
        note = "Adaptive MP4 conversion finished.";
        break;
      case "imagesToPdf":
        outputs = await convertImagesToPdf(state.files);
        note = "Images were combined into a PDF.";
        break;
      case "mergePdf":
        outputs = await mergePdfFiles(state.files);
        note = "PDF files were merged successfully.";
        break;
      case "imageToJpg":
        outputs = await convertImagesToFormat(state.files, {
          mimeType: "image/jpeg",
          extension: "jpg",
          quality: Number(elements.jpgQualityRange.value) / 100,
          background: "#ffffff",
        });
        note = "Images were exported as JPG.";
        break;
      case "imageToPng":
        outputs = await convertImagesToFormat(state.files, {
          mimeType: "image/png",
          extension: "png",
        });
        note = "Images were exported as PNG.";
        break;
      case "imageToWebp":
        outputs = await convertImagesToFormat(state.files, {
          mimeType: "image/webp",
          extension: "webp",
          quality: Number(elements.webpQualityRange.value) / 100,
        });
        note = "Images were exported as WebP.";
        break;
      default:
        throw new Error("Unsupported conversion preset.");
    }

    finalizeJob("success", outputs, note);
  } catch (error) {
    if (state.cancelRequested || isTerminationError(error)) {
      setStatus("Conversion cancelled.");
      setProgress(0);
      finalizeJob("cancelled", [], "The conversion was cancelled before completion.");
    } else {
      const message =
        error instanceof Error ? error.message : "Conversion failed unexpectedly.";
      setStatus(message, true);
      finalizeJob("failed", [], message);
    }
  } finally {
    state.busy = false;
    state.cancelRequested = false;
    syncControlAvailability();
  }
}

function cancelCurrentJob() {
  if (!state.busy || !state.ffmpeg) {
    return;
  }

  state.cancelRequested = true;
  setStatus("Cancelling the current video job.");

  try {
    state.ffmpeg.terminate();
  } catch {
    return;
  } finally {
    resetFfmpeg();
  }
}

async function convertWebmToMp4(file) {
  const inputName = `input.${getExtension(file.name) || "webm"}`;
  const outputName = buildOutputName(file, "mp4");
  setStatus("Preparing the video engine and file.");
  const [ffmpeg, inputData] = await Promise.all([loadFfmpeg(), fetchFile(file)]);

  setStatus("Loading video file into the browser worker.");
  await ffmpeg.writeFile(inputName, inputData);
  setStatus("Transcoding WebM to MP4.");

  try {
    await execWithFallback(ffmpeg, inputName, outputName, buildMp4CommandSets(inputName, outputName));
    const output = await ffmpeg.readFile(outputName);
    const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
    const blob = new Blob([bytes], { type: "video/mp4" });
    const result = addDownload({
      name: outputName,
      blob,
      caption: `${file.name} converted to MP4.`,
    });
    setProgress(100);
    setStatus("Video conversion finished.");
    return [result];
  } finally {
    await removeFfmpegFile(ffmpeg, inputName);
    await removeFfmpegFile(ffmpeg, outputName);
  }
}

function buildMp4CommandSets(inputName, outputName) {
  const filters = buildVideoFilters();
  const profile = getVideoProfileOptions();
  const videoArgs = buildH264VideoArgs(profile);
  const audioArgs = elements.stripAudioCheckbox.checked
    ? ["-an"]
    : ["-c:a", "aac", "-b:a", profile.audioBitrate];

  return [
    {
      status: "Transcoding with H.264 and AAC.",
      args: [
        "-i",
        inputName,
        ...filters,
        ...videoArgs,
        ...audioArgs,
        outputName,
      ],
    },
    {
      status: "Retrying with MPEG-4 video output.",
      args: [
        "-i",
        inputName,
        ...filters,
        "-c:v",
        "mpeg4",
        "-q:v",
        profile.mpeg4Q,
        ...audioArgs,
        outputName,
      ],
    },
  ];
}

function buildVideoFilters() {
  const filters = [];
  const maxWidth = elements.videoWidthSelect.value;
  const maxFps = elements.videoFpsSelect.value;

  if (maxWidth !== "original") {
    filters.push(`scale='min(${maxWidth},iw)':-2:flags=fast_bilinear`);
  }

  if (maxFps !== "original") {
    filters.push(`fps=${maxFps}`);
  }

  return filters.length > 0 ? ["-vf", filters.join(",")] : [];
}

function getRecorderFormatOptions() {
  if (!canScreenRecord()) {
    return [];
  }

  const webmMime = pickSupportedMimeType([
    "video/webm",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
  ]);
  const mp4Mime = pickSupportedMimeType([
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
  ]);

  const formats = [];

  if (webmMime) {
    formats.push({
      id: "webm",
      label: "WebM",
      captureMimeType: webmMime,
      needsTranscode: false,
    });
  }

  if (mp4Mime) {
    formats.push({
      id: "mp4",
      label: "MP4",
      captureMimeType: mp4Mime,
      needsTranscode: false,
    });
  } else if (webmMime) {
    formats.push({
      id: "mp4",
      label: "MP4",
      captureMimeType: webmMime,
      needsTranscode: true,
    });
  }

  return formats;
}

function getSelectedRecorderFormat() {
  return (
    state.recorderFormats.find(
      (format) => format.id === elements.recordFormatSelect.value,
    ) || state.recorderFormats[0] || null
  );
}

function getRecorderSettings() {
  return {
    quality: elements.recordQualitySelect.value,
    maxWidth: elements.recordWidthSelect.value,
    fps: elements.recordFpsSelect.value,
    includeAudio: elements.recordAudioCheckbox.checked,
    videoBitsPerSecond: computeRecorderVideoBitrate(
      elements.recordQualitySelect.value,
      elements.recordWidthSelect.value,
      elements.recordFpsSelect.value,
    ),
    audioBitsPerSecond: 128000,
  };
}

function computeRecorderVideoBitrate(quality, maxWidth, fps) {
  let bitrate =
    quality === "crisp" ? 9000000 : quality === "compact" ? 2600000 : 5500000;

  if (maxWidth === "2560") {
    bitrate *= 1.4;
  } else if (maxWidth === "1280") {
    bitrate *= 0.76;
  }

  if (fps === "60") {
    bitrate *= 1.25;
  } else if (fps === "15") {
    bitrate *= 0.72;
  }

  return Math.round(bitrate);
}

function buildDisplayMediaOptions(settings) {
  const video = {
    frameRate: {
      ideal: Number(settings.fps),
      max: Number(settings.fps),
    },
  };

  if (settings.maxWidth !== "original") {
    video.width = {
      ideal: Number(settings.maxWidth),
      max: Number(settings.maxWidth),
    };
  }

  return {
    video,
    audio: settings.includeAudio,
    preferCurrentTab: true,
  };
}

async function applyPreferredTrackConstraints(track, settings) {
  if (typeof track.applyConstraints !== "function") {
    return;
  }

  const constraints = {
    frameRate: Number(settings.fps),
  };

  if (settings.maxWidth !== "original") {
    constraints.width = Number(settings.maxWidth);
  }

  try {
    await track.applyConstraints(constraints);
  } catch {
    return;
  }
}

function pickSupportedMimeType(candidates) {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return candidates[0] || "";
  }

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
}

function canScreenRecord() {
  return Boolean(
    navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined",
  );
}

function isRecorderBusy() {
  return state.recording.active || state.recording.processing;
}

function buildRecordingFileBaseName() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `screen-recording-${parts.join("")}`;
}

function mimeTypeToExtension(mimeType) {
  if (mimeType.startsWith("video/mp4")) {
    return "mp4";
  }

  if (mimeType.startsWith("video/webm")) {
    return "webm";
  }

  return "";
}

function getVideoProfileOptions() {
  switch (elements.videoProfileSelect.value) {
    case "archive":
      return {
        x264Preset: "fast",
        x264Crf: "18",
        mpeg4Q: "3",
        audioBitrate: "192k",
      };
    case "compressed":
      return {
        x264Preset: "ultrafast",
        x264Crf: "30",
        mpeg4Q: "10",
        audioBitrate: "96k",
        tune: "zerolatency",
      };
    case "balanced":
    default:
      return {
        x264Preset: "superfast",
        x264Crf: "24",
        mpeg4Q: "6",
        audioBitrate: "128k",
      };
  }
}

async function transcodeRecordedBlobToMp4(blob, session) {
  const inputExtension = mimeTypeToExtension(blob.type) || "webm";
  const inputName = `recording-input.${inputExtension}`;
  const outputName = `${session.fileBaseName}.mp4`;
  const [ffmpeg, inputData] = await Promise.all([loadFfmpeg(), fetchFile(blob)]);

  await ffmpeg.writeFile(inputName, inputData);

  try {
    await execWithFallback(
      ffmpeg,
      inputName,
      outputName,
      buildRecordingMp4CommandSets(inputName, outputName, session),
    );

    const output = await ffmpeg.readFile(outputName);
    const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
    const mp4Blob = new Blob([bytes], { type: "video/mp4" });
    const result = addDownload({
      name: outputName,
      blob: mp4Blob,
      caption: "Screen recording converted to MP4.",
    });
    setRecorderPreview(mp4Blob);
    return [result];
  } finally {
    await removeFfmpegFile(ffmpeg, inputName);
    await removeFfmpegFile(ffmpeg, outputName);
  }
}

function buildRecordingMp4CommandSets(inputName, outputName, session) {
  const profile = getRecorderTranscodeProfile(session.quality);
  const filters = buildCustomVideoFilters(session.width, session.fps);
  const videoArgs = buildH264VideoArgs(profile);
  const withAudioArgs = [
    "-i",
    inputName,
    ...filters,
    ...videoArgs,
    "-c:a",
    "aac",
    "-b:a",
    profile.audioBitrate,
    outputName,
  ];
  const withoutAudioArgs = [
    "-i",
    inputName,
    ...filters,
    ...videoArgs,
    "-an",
    outputName,
  ];

  return session.includeAudio
    ? [
        {
          status: "Converting recording to MP4 with audio.",
          args: withAudioArgs,
        },
        {
          status: "Retrying recording export without audio.",
          args: withoutAudioArgs,
        },
      ]
    : [
        {
          status: "Converting recording to MP4.",
          args: withoutAudioArgs,
        },
      ];
}

function buildCustomVideoFilters(maxWidth, fps) {
  const filters = [];

  if (maxWidth !== "original") {
    filters.push(`scale='min(${maxWidth},iw)':-2:flags=fast_bilinear`);
  }

  if (fps !== "original") {
    filters.push(`fps=${fps}`);
  }

  return filters.length > 0 ? ["-vf", filters.join(",")] : [];
}

function getRecorderTranscodeProfile(quality) {
  switch (quality) {
    case "crisp":
      return {
        x264Preset: "fast",
        x264Crf: "18",
        audioBitrate: "192k",
      };
    case "compact":
      return {
        x264Preset: "ultrafast",
        x264Crf: "30",
        audioBitrate: "96k",
        tune: "zerolatency",
      };
    case "balanced":
    default:
      return {
        x264Preset: "superfast",
        x264Crf: "24",
        audioBitrate: "128k",
      };
  }
}

async function convertImagesToPdf(files) {
  const pdf = await PDFDocument.create();
  let preparedCount = 0;
  const preparedImages = await mapWithConcurrency(
    files,
    Math.min(getPdfJobConcurrency(), files.length),
    async (file) => {
      const prepared = await getPdfReadyImage(file);
      preparedCount += 1;
      setStatus(`Preparing image ${preparedCount} of ${files.length}.`);
      setProgress(8 + Math.round((preparedCount / files.length) * 28));
      return prepared;
    },
  );

  for (const [index, prepared] of preparedImages.entries()) {
    setStatus(`Adding image ${index + 1} of ${files.length} to the PDF.`);
    setProgress(40 + Math.round((index / files.length) * 48));

    const { blob, width, height } = prepared;
    const bytes = await blob.arrayBuffer();
    const embedded =
      blob.type === "image/jpeg"
        ? await pdf.embedJpg(bytes)
        : await pdf.embedPng(bytes);

    const pageWidth = width * 0.75;
    const pageHeight = height * 0.75;
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  }

  setStatus("Saving PDF file.");
  setProgress(92);
  const pdfBytes = await pdf.save(PDF_FAST_SAVE_OPTIONS);
  const result = addDownload({
    name: buildBatchOutputName(files, "pdf", "combined"),
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    caption: `${files.length} image${files.length === 1 ? "" : "s"} combined into one PDF.`,
  });
  setProgress(100);
  setStatus("PDF conversion finished.");
  return [result];
}

async function mergePdfFiles(files) {
  const mergedPdf = await PDFDocument.create();
  let totalPages = 0;

  for (const [index, file] of files.entries()) {
    setStatus(`Merging PDF ${index + 1} of ${files.length}.`);
    setProgress(8 + Math.round((index / files.length) * 72));

    const source = await PDFDocument.load(await file.arrayBuffer(), {
      parseSpeed: PDF_FAST_PARSE_SPEED,
      updateMetadata: false,
    });
    const pages = await mergedPdf.copyPages(source, source.getPageIndices());
    totalPages += pages.length;
    for (const page of pages) {
      mergedPdf.addPage(page);
    }
  }

  setStatus("Saving merged PDF.");
  setProgress(92);
  const pdfBytes = await mergedPdf.save(PDF_FAST_SAVE_OPTIONS);
  const result = addDownload({
    name: buildBatchOutputName(files, "pdf", "merged"),
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    caption: `${files.length} PDFs merged into one document with ${totalPages} pages.`,
  });
  setProgress(100);
  setStatus("PDF merge finished.");
  return [result];
}

async function convertImagesToFormat(files, options) {
  let completed = 0;
  const concurrency = Math.min(getImageJobConcurrency(), files.length);
  const converted = await mapWithConcurrency(files, concurrency, async (file) => {
    const blob = await reencodeImage(file, options);
    completed += 1;
    setStatus(`Processing images ${completed} of ${files.length}.`);
    setProgress(8 + Math.round((completed / files.length) * 72));
    return {
      name: `${stripExtension(file.name)}.${options.extension}`,
      blob,
      source: file.name,
    };
  });

  if (converted.length === 1) {
    const result = addDownload({
      name: converted[0].name,
      blob: converted[0].blob,
      caption: `${converted[0].source} converted successfully.`,
    });
    setProgress(100);
    setStatus("Image conversion finished.");
    return [result];
  }

  setStatus("Packing converted files into a zip archive.");
  const zip = new JSZip();

  for (const item of converted) {
    zip.file(item.name, item.blob);
  }

  const zipBlob = await zip.generateAsync(
    {
      type: "blob",
      compression: "STORE",
    },
    (metadata) => {
      setProgress(84 + Math.round(metadata.percent / 6.25));
    },
  );

  const result = addDownload({
    name: buildBatchArchiveName(files, options.extension),
    blob: zipBlob,
    caption: `${converted.length} converted files bundled into a zip archive.`,
  });
  setProgress(100);
  setStatus("Image conversion finished.");
  return [result];
}

async function loadFfmpeg(options = {}) {
  const quiet = options.quiet === true;

  if (state.ffmpegPromise) {
    if (!state.ffmpegReady && !quiet) {
      setStatus("Loading browser video engine. First run may take a moment.");
    }
    return state.ffmpegPromise;
  }

  const ffmpeg = new FFmpeg();
  const coreBaseUrl = new URL("./vendor/ffmpeg-core/", window.location.href);
  state.ffmpeg = ffmpeg;
  state.ffmpegReady = false;

  ffmpeg.on("progress", ({ progress }) => {
    if (!Number.isFinite(progress)) {
      return;
    }

    const percent = Math.max(10, Math.min(98, Math.round(progress * 100)));
    setProgress(percent);
  });

  state.ffmpegPromise = (async () => {
    try {
      if (!quiet) {
        setStatus("Loading browser video engine. First run may take a moment.");
      }

      await ffmpeg.load({
        coreURL: new URL("ffmpeg-core.js", coreBaseUrl).href,
        wasmURL: new URL("ffmpeg-core.wasm", coreBaseUrl).href,
      });
      state.ffmpegReady = true;
      return ffmpeg;
    } catch (error) {
      resetFfmpeg();
      throw error;
    }
  })();

  return state.ffmpegPromise;
}

function primeFfmpegForCurrentPreset() {
  if (!presets[state.presetKey].usesFfmpeg) {
    return;
  }

  if (state.busy || state.ffmpegPromise || isWorkspaceLocked()) {
    return;
  }

  if (document.visibilityState === "hidden") {
    return;
  }

  void loadFfmpeg({ quiet: true }).catch(() => {});
}

function scheduleFfmpegWarmup() {
  if (!presets[state.presetKey].usesFfmpeg) {
    return;
  }

  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;

  if (memory < 4 || cores < 4) {
    return;
  }

  if (state.busy || state.ffmpegPromise || isWorkspaceLocked()) {
    return;
  }

  const warmup = () => {
    primeFfmpegForCurrentPreset();
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warmup, { timeout: 2500 });
    return;
  }

  window.setTimeout(warmup, 1200);
}

async function execWithFallback(ffmpeg, inputName, outputName, commandSets) {
  let lastError = null;

  for (const command of commandSets) {
    try {
      setStatus(command.status);
      await ffmpeg.exec(command.args);
      return;
    } catch (error) {
      lastError = error;
      await removeFfmpegFile(ffmpeg, outputName);

      if (state.cancelRequested || isTerminationError(error)) {
        throw error;
      }
    }
  }

  console.error(lastError);
  throw new Error(
    "Video conversion failed in this browser session. Try a smaller clip or use compressed mode.",
  );
}

async function removeFfmpegFile(ffmpeg, fileName) {
  try {
    await ffmpeg.deleteFile(fileName);
  } catch {
    return;
  }
}

function resetFfmpeg() {
  state.ffmpeg = null;
  state.ffmpegPromise = null;
  state.ffmpegReady = false;
}

function getImageJobConcurrency() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;

  if (memory <= 2 || cores <= 4) {
    return 2;
  }

  if (memory >= 12 && cores >= 12) {
    return 5;
  }

  if (memory >= 8 && cores >= 8) {
    return 4;
  }

  return 3;
}

function getPdfJobConcurrency() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;

  if (memory <= 2 || cores <= 4) {
    return 1;
  }

  if (memory >= 12 && cores >= 12) {
    return 4;
  }

  if (memory >= 8 && cores >= 8) {
    return 3;
  }

  return 2;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function getPdfReadyImage(file) {
  const { image, cleanup } = await loadImage(file);

  try {
    const outputType = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
    const sourceWidth = getGraphicWidth(image);
    const sourceHeight = getGraphicHeight(image);
    const longestSide = Math.max(sourceWidth, sourceHeight);

    if (outputType === file.type && longestSide <= 2200) {
      return {
        blob: file,
        width: sourceWidth,
        height: sourceHeight,
      };
    }

    const canvas = renderImageToCanvas(image, { maxSide: 2200 });
    const blob = await canvasToBlob(
      canvas,
      outputType,
      outputType === "image/jpeg" ? 0.92 : undefined,
    );

    return {
      blob,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    cleanup();
  }
}

async function reencodeImage(file, options) {
  const { image, cleanup } = await loadImage(file);

  try {
    const longestSide = Math.max(getGraphicWidth(image), getGraphicHeight(image));

    if (options.mimeType === file.type && !options.background && longestSide <= 2600) {
      return file;
    }

    const canvas = renderImageToCanvas(image, {
      maxSide: 2600,
      background: options.background,
    });
    return canvasToBlob(canvas, options.mimeType, options.quality);
  } finally {
    cleanup();
  }
}

function renderImageToCanvas(image, options = {}) {
  const sourceWidth = getGraphicWidth(image);
  const sourceHeight = getGraphicHeight(image);
  const longestSide = Math.max(sourceWidth, sourceHeight);
  const scale =
    options.maxSide && longestSide > options.maxSide
      ? options.maxSide / longestSide
      : 1;

  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = createWorkingCanvas(width, height);

  const context = canvas.getContext("2d", {
    alpha: !options.background,
    desynchronized: true,
  });

  if (!context) {
    throw new Error("Canvas is not available in this browser.");
  }

  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

function createWorkingCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function buildH264VideoArgs(profile) {
  const args = [
    "-c:v",
    "libx264",
    "-preset",
    profile.x264Preset,
    "-crf",
    profile.x264Crf,
    "-pix_fmt",
    "yuv420p",
  ];

  if (profile.tune) {
    args.push("-tune", profile.tune);
  }

  return args;
}

function canvasToBlob(canvas, mimeType, quality) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({
      type: mimeType,
      quality,
    });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The browser could not export the converted file."));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file)
      .then((image) => ({
        image,
        cleanup: () => image.close?.(),
      }))
      .catch(() => loadImageElement(file));
  }

  return loadImageElement(file);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";

    image.onload = () => {
      resolve({
        image,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read ${file.name} as an image.`));
    };

    image.src = objectUrl;
  });
}

function getGraphicWidth(image) {
  return image.naturalWidth || image.videoWidth || image.width || 0;
}

function getGraphicHeight(image) {
  return image.naturalHeight || image.videoHeight || image.height || 0;
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      resolve({
        video,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read ${file.name} as a video.`));
    };

    video.src = objectUrl;
  });
}

async function readVideoMetadata(file) {
  const { video, cleanup } = await loadVideo(file);

  try {
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
    };
  } finally {
    cleanup();
  }
}

function assessVideoWorkload(info, sizeBytes) {
  const sizeMb = sizeBytes / (1024 * 1024);
  const megapixels = (info.width * info.height) / 1000000;
  const minutes = info.duration / 60;
  const score = Math.round(sizeMb + megapixels * 18 + minutes * 12);

  let severity = "low";
  if (score >= 140) {
    severity = "severe";
  } else if (score >= 80) {
    severity = "high";
  } else if (score >= 40) {
    severity = "medium";
  }

  return {
    ...info,
    score,
    severity,
  };
}

function addDownload({ name, blob, caption }) {
  const card = document.createElement("article");
  card.className = "download-card";

  const copy = document.createElement("div");
  const title = document.createElement("p");
  title.className = "download-title";
  title.textContent = name;

  const description = document.createElement("p");
  description.className = "download-caption";
  description.textContent = caption;

  copy.append(title, description);

  const link = document.createElement("a");
  link.className = "download-link";
  link.textContent = "Download";
  link.download = name;

  const url = URL.createObjectURL(blob);
  link.href = url;
  state.downloadUrls.push(url);

  card.append(copy, link);
  elements.downloads.append(card);
  elements.downloadsEmpty.hidden = true;

  return {
    name,
    size: blob.size,
  };
}

function clearDownloads() {
  for (const url of state.downloadUrls) {
    URL.revokeObjectURL(url);
  }

  state.downloadUrls = [];
  elements.downloads.innerHTML = "";
  elements.downloadsEmpty.hidden = false;
}

function finalizeJob(status, outputs, note) {
  if (!state.currentJob) {
    return;
  }

  const finishedAt = Date.now();
  const outputBytes = outputs.reduce((sum, item) => sum + item.size, 0);
  const entry = {
    id: state.currentJob.id,
    presetKey: state.currentJob.presetKey,
    presetLabel: state.currentJob.presetLabel,
    actor: state.profile.displayName || "Guest",
    inputNames: state.currentJob.inputNames,
    inputBytes: state.currentJob.inputBytes,
    outputNames: outputs.map((item) => item.name),
    outputBytes,
    status,
    note,
    startedAt: state.currentJob.startedAt,
    finishedAt,
    durationMs: finishedAt - state.currentJob.startedAt,
  };

  state.history.unshift(entry);
  state.history = state.history.slice(0, HISTORY_LIMIT);
  persistStored(STORAGE_KEYS.history, state.history);

  const analytics = state.analytics;
  analytics.totals.bytes += state.currentJob.inputBytes;
  analytics.lastRunAt = finishedAt;
  analytics.lastPreset = state.currentJob.presetLabel;
  analytics.presets[state.currentJob.presetKey] =
    (analytics.presets[state.currentJob.presetKey] || 0) + 1;

  if (status === "success") {
    analytics.totals.success += 1;
    analytics.totals.outputBytes += outputBytes;
  } else if (status === "failed") {
    analytics.totals.failed += 1;
  } else if (status === "cancelled") {
    analytics.totals.cancelled += 1;
  }

  persistStored(STORAGE_KEYS.analytics, analytics);
  renderHistory();
  renderAnalytics();
  state.currentJob = null;
}

function renderHistory() {
  elements.historyList.innerHTML = "";

  if (isWorkspaceLocked()) {
    const locked = document.createElement("li");
    locked.className = "history-empty";
    locked.textContent = "Unlock to see past activity saved in this browser.";
    elements.historyList.append(locked);
    return;
  }

  if (state.history.length === 0) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = "No past conversions yet.";
    elements.historyList.append(empty);
    return;
  }

  for (const entry of state.history) {
    const item = document.createElement("li");
    item.className = "history-item";

    const copy = document.createElement("div");
    copy.className = "history-copy";

    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = `${entry.presetLabel} - ${entry.inputNames.join(", ")}`;

    const meta = document.createElement("p");
    meta.className = "history-meta";
    meta.textContent =
      `${entry.actor} - ${formatDurationMs(entry.durationMs)} - ${formatTimestamp(entry.finishedAt)} - ${entry.note}`;

    copy.append(title, meta);

    const status = document.createElement("span");
    status.className = `status-chip is-${entry.status}`;
    status.textContent = entry.status;

    item.append(copy, status);
    elements.historyList.append(item);
  }
}

function renderAnalytics() {
  if (isWorkspaceLocked()) {
    elements.statSuccess.textContent = "Locked";
    elements.statFailed.textContent = "Locked";
    elements.statBytes.textContent = "Locked";
    elements.statLastRun.textContent = "Locked";
    elements.favoritePreset.textContent =
      "Unlock to see the local summary stored in this browser.";
    return;
  }

  elements.statSuccess.textContent = String(state.analytics.totals.success);
  elements.statFailed.textContent = String(state.analytics.totals.failed);
  elements.statBytes.textContent = formatBytes(state.analytics.totals.bytes);
  elements.statLastRun.textContent = state.analytics.lastRunAt
    ? formatTimestamp(state.analytics.lastRunAt)
    : "Never";

  const favorite = getFavoritePreset();
  elements.favoritePreset.textContent = favorite
    ? `Most used so far: ${favorite.label} (${favorite.count} time${favorite.count === 1 ? "" : "s"}).`
    : "This summary stays in this browser only. Nothing is sent anywhere.";
}

function renderDiagnostics() {
  elements.diagnosticsGrid.innerHTML = "";

  for (const item of state.diagnostics) {
    const card = document.createElement("div");
    card.className = `diagnostic-item ${item.ok ? "is-ok" : "is-warning"}`;

    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = item.label;

    const value = document.createElement("strong");
    value.textContent = item.ok ? "Ready" : "Limited";

    card.append(label, value);
    elements.diagnosticsGrid.append(card);
  }

  const memory = navigator.deviceMemory ? `${navigator.deviceMemory} GB memory hint` : "Memory hint unavailable";
  const cores = navigator.hardwareConcurrency
    ? `${navigator.hardwareConcurrency} CPU cores`
    : "CPU core hint unavailable";
  elements.deviceHint.textContent = `About this device: ${memory}, ${cores}.`;
}

function renderProfile() {
  elements.profileNameInput.value = state.profile.displayName;
  elements.authStatus.textContent = state.profile.pinHash
    ? isWorkspaceLocked()
      ? "A PIN is set. Unlock to use the app and see saved activity."
      : "Private mode is unlocked. Your local history is protected by your PIN."
    : "No PIN is set right now. You can add one if you want extra privacy.";

  elements.setPinButton.textContent = state.profile.pinHash ? "Update PIN" : "Set PIN";
  elements.unlockButton.disabled = !state.profile.pinHash || !isWorkspaceLocked();
  elements.lockButton.disabled = !state.profile.pinHash || isWorkspaceLocked();
  elements.removePinButton.disabled = !state.profile.pinHash || isWorkspaceLocked();
}

function saveProfileName() {
  const value = elements.profileNameInput.value.trim();
  state.profile.displayName = value || "Guest";
  persistStored(STORAGE_KEYS.profile, state.profile);
  renderProfile();
  renderHistory();
  setStatus("Display name saved.");
}

async function setWorkspacePin() {
  const pin = elements.pinInput.value.trim();

  if (!/^\d{4,12}$/.test(pin)) {
    setStatus("PIN must be 4 to 12 digits.", true);
    return;
  }

  const { hash, salt } = await hashPin(pin);
  state.profile.pinHash = hash;
  state.profile.pinSalt = salt;
  state.profile.locked = false;
  persistStored(STORAGE_KEYS.profile, state.profile);
  elements.pinInput.value = "";
  renderProfile();
  renderAnalytics();
  renderHistory();
  syncControlAvailability();
  setStatus("Workspace PIN saved.");
}

async function unlockWorkspace() {
  const pin = elements.unlockPinInput.value.trim();

  if (!state.profile.pinHash) {
    setStatus("Set a PIN before trying to unlock the workspace.", true);
    return;
  }

  if (!pin) {
    setStatus("Enter your PIN to unlock the workspace.", true);
    return;
  }

  const { hash } = await hashPin(pin, state.profile.pinSalt);

  if (hash !== state.profile.pinHash) {
    setStatus("That PIN does not match the saved workspace lock.", true);
    return;
  }

  state.profile.locked = false;
  persistStored(STORAGE_KEYS.profile, state.profile);
  elements.unlockPinInput.value = "";
  renderProfile();
  renderHistory();
  renderAnalytics();
  syncControlAvailability();
  setStatus("Workspace unlocked.");
}

function lockWorkspace() {
  if (state.busy || isRecorderBusy()) {
    setStatus("Finish the active job before locking the workspace.", true);
    return;
  }

  if (!state.profile.pinHash) {
    setStatus("Set a PIN before locking the workspace.", true);
    return;
  }

  state.profile.locked = true;
  persistStored(STORAGE_KEYS.profile, state.profile);
  renderProfile();
  renderHistory();
  renderAnalytics();
  syncControlAvailability();
  setStatus("Workspace locked.");
}

function removeWorkspacePin() {
  if (state.busy || isRecorderBusy()) {
    setStatus("Finish the active job before changing the workspace PIN.", true);
    return;
  }

  state.profile.pinHash = "";
  state.profile.pinSalt = "";
  state.profile.locked = false;
  persistStored(STORAGE_KEYS.profile, state.profile);
  renderProfile();
  renderHistory();
  renderAnalytics();
  syncControlAvailability();
  setStatus("Workspace PIN removed.");
}

function clearActivity() {
  state.history = [];
  state.analytics = createDefaultAnalytics();
  persistStored(STORAGE_KEYS.history, state.history);
  persistStored(STORAGE_KEYS.analytics, state.analytics);
  renderHistory();
  renderAnalytics();
  setStatus("Local history and analytics cleared.");
}

function syncControlAvailability() {
  const preset = presets[state.presetKey];
  const locked = isWorkspaceLocked();
  const recorderBusy = isRecorderBusy();
  const disabled = state.busy || locked || recorderBusy;
  const recorderUnavailable = !canScreenRecord() || state.recorderFormats.length === 0;

  elements.presetSelect.disabled = disabled;
  elements.dropZone.disabled = disabled;
  elements.pickFilesButton.disabled = disabled;
  elements.clearFilesButton.disabled = disabled || state.files.length === 0;
  elements.fileInput.disabled = disabled;
  elements.convertButton.disabled = disabled || state.files.length < preset.minimumFiles;

  for (const card of elements.workflowGrid.querySelectorAll("button")) {
    card.disabled = disabled;
  }

  for (const button of elements.smartMatchActions.querySelectorAll("button")) {
    button.disabled = disabled;
  }

  const optionControls = [
    elements.videoProfileSelect,
    elements.videoWidthSelect,
    elements.videoFpsSelect,
    elements.stripAudioCheckbox,
    elements.jpgQualityRange,
    elements.webpQualityRange,
  ];

  for (const control of optionControls) {
    control.disabled = disabled;
  }

  elements.cancelButton.hidden = !(state.busy && preset.usesFfmpeg);
  elements.cancelButton.disabled = !state.busy || !preset.usesFfmpeg;
  elements.recordFormatSelect.disabled =
    locked || state.busy || state.recording.active || state.recording.processing || recorderUnavailable;
  elements.recordQualitySelect.disabled =
    locked || state.busy || state.recording.active || state.recording.processing || recorderUnavailable;
  elements.recordWidthSelect.disabled =
    locked || state.busy || state.recording.active || state.recording.processing || recorderUnavailable;
  elements.recordFpsSelect.disabled =
    locked || state.busy || state.recording.active || state.recording.processing || recorderUnavailable;
  elements.recordAudioCheckbox.disabled =
    locked || state.busy || state.recording.active || state.recording.processing || recorderUnavailable;
  elements.startRecordingButton.disabled =
    locked || state.busy || state.recording.active || state.recording.processing || recorderUnavailable;
  elements.stopRecordingButton.disabled =
    !state.recording.active || locked || recorderUnavailable;
  elements.saveProfileButton.disabled = state.busy || recorderBusy;
  elements.setPinButton.disabled = state.busy || recorderBusy;
  elements.unlockButton.disabled =
    state.busy || recorderBusy || !state.profile.pinHash || !isWorkspaceLocked();
  elements.lockButton.disabled =
    state.busy || recorderBusy || !state.profile.pinHash || isWorkspaceLocked();
  elements.removePinButton.disabled =
    state.busy || recorderBusy || !state.profile.pinHash || isWorkspaceLocked();
}

function setStatus(message, isError = false) {
  elements.statusText.textContent = message;
  elements.statusText.classList.toggle("is-error", isError);
}

function setProgress(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  elements.progressFill.style.width = `${clamped}%`;
}

function detectDiagnostics() {
  return [
    { label: "WebAssembly", ok: typeof WebAssembly === "object" },
    { label: "Web Workers", ok: typeof Worker !== "undefined" },
    { label: "Media Recorder", ok: typeof MediaRecorder !== "undefined" },
    { label: "Screen Capture", ok: !!navigator.mediaDevices?.getDisplayMedia },
    { label: "Canvas export", ok: typeof HTMLCanvasElement !== "undefined" && !!HTMLCanvasElement.prototype.toBlob },
    { label: "Local storage", ok: canUseStorage() },
    { label: "Web Crypto", ok: !!window.crypto?.subtle },
  ];
}

async function hashPin(pin, saltBase64 = "") {
  const encoder = new TextEncoder();
  const salt = saltBase64 ? base64ToBytes(saltBase64) : window.crypto.getRandomValues(new Uint8Array(16));
  const key = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 150000,
      hash: "SHA-256",
    },
    key,
    256,
  );

  return {
    hash: bytesToBase64(new Uint8Array(bits)),
    salt: bytesToBase64(salt),
  };
}

function isWorkspaceLocked() {
  return Boolean(state.profile.pinHash && state.profile.locked);
}

function normalizeProfile(profile) {
  const normalized = {
    displayName: "Guest",
    pinHash: "",
    pinSalt: "",
    locked: false,
    ...(profile || {}),
  };

  if (normalized.pinHash) {
    normalized.locked = true;
  }

  return normalized;
}

function createDefaultAnalytics() {
  return {
    totals: {
      success: 0,
      failed: 0,
      cancelled: 0,
      bytes: 0,
      outputBytes: 0,
    },
    presets: {},
    lastRunAt: 0,
    lastPreset: "",
  };
}

function getFavoritePreset() {
  const entries = Object.entries(state.analytics.presets);

  if (entries.length === 0) {
    return null;
  }

  const [key, count] = entries.sort((left, right) => right[1] - left[1])[0];
  return {
    label: presets[key]?.label || SPECIAL_PRESET_LABELS[key] || key,
    count,
  };
}

function createJobId() {
  return window.crypto?.randomUUID?.() || `job-${Date.now()}`;
}

function matchesPresetFile(file, preset) {
  const extension = getExtension(file.name);
  return (
    preset.allowedTypes.includes(file.type) ||
    preset.allowedExtensions.includes(extension)
  );
}

function isTerminationError(error) {
  return String(error).toLowerCase().includes("terminated");
}

function canUseStorage() {
  try {
    const key = "__free_converter_probe__";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function loadStored(key, fallback) {
  if (!canUseStorage()) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persistStored(key, value) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

function base64ToBytes(value) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "under 1s";
  }

  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatDurationMs(milliseconds) {
  return formatDuration(milliseconds / 1000);
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function stripExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, "") || "converted-file";
}

function buildOutputName(file, extension) {
  return `${stripExtension(file.name)}.${extension}`;
}

function getBatchBaseName(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return "converted-file";
  }

  return stripExtension(files[0].name);
}

function buildBatchOutputName(files, extension, suffix) {
  const baseName = getBatchBaseName(files);

  if (files.length <= 1) {
    return `${baseName}.${extension}`;
  }

  return `${baseName}-${suffix}.${extension}`;
}

function buildBatchArchiveName(files, extension) {
  const baseName = getBatchBaseName(files);
  return `${baseName}-${extension}-files.zip`;
}

function getExtension(fileName) {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch {
    return;
  }
}
