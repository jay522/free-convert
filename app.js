import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { fetchFile } from "./vendor/ffmpeg-util/index.js";

const { PDFDocument, ParseSpeeds } = window.PDFLib;
const JSZip = window.JSZip;
const PDF_FAST_PARSE_SPEED = ParseSpeeds?.Fastest ?? Number.POSITIVE_INFINITY;
const PDF_FAST_SAVE_OPTIONS = {
  useObjectStreams: false,
  objectsPerTick: 2048,
};
const DIFF_COMPARE_DEBOUNCE_MS = 220;
const DIFF_MAX_DP_CELLS = 2_000_000;
const DIFF_MAX_INLINE_CELLS = 60_000;

const STORAGE_KEYS = {
  history: "free-converter-history-v1",
  analytics: "free-converter-analytics-v1",
  profile: "free-converter-profile-v1",
  recordings: "free-converter-recordings-v1",
  recordingNaming: "free-converter-recording-naming-v1",
};

const HISTORY_LIMIT = 12;
const RECORDING_LIBRARY_LIMIT = 12;
const RECORDING_LIBRARY_DB_NAME = "free-converter-recordings-db-v1";
const RECORDING_LIBRARY_STORE = "recording-files";
const SPECIAL_PRESET_LABELS = {
  screenRecorder: "Screen Recorder",
  cameraRecorder: "Camera Recorder",
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
  recordings: normalizeStoredRecordings(loadStored(STORAGE_KEYS.recordings, [])),
  recordingNaming: normalizeRecordingNaming(
    loadStored(STORAGE_KEYS.recordingNaming, null),
  ),
  selectedRecordingId: "",
  recordingLibraryReady: false,
  recordingLibraryLoading: false,
  diagnostics: [],
  recorderFormats: [],
  recording: {
    active: false,
    processing: false,
    stopRequested: false,
    stream: null,
    sourceStreams: [],
    audioContext: null,
    mediaRecorder: null,
    chunks: [],
    startedAt: 0,
    timerId: null,
    captureMode: "",
    audioMode: "",
    desiredFormat: "",
    captureMimeType: "",
    captureSurface: "",
    fileBaseName: "",
    previewUrl: "",
  },
  videoSettingsTouched: false,
  diff: {
    compareTimerId: 0,
    blocks: [],
    leftLabel: "Original",
    rightLabel: "Updated",
    lastComparedLeft: "",
    lastComparedRight: "",
    scrollSyncing: false,
    lastOptions: {
      ignoreWhitespace: false,
      ignoreCase: false,
    },
  },
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
  coachText: document.querySelector("#coachText"),
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
  recordingList: document.querySelector("#recordingList"),
  recordingLibraryHint: document.querySelector("#recordingLibraryHint"),
  clearRecordingsButton: document.querySelector("#clearRecordingsButton"),
  recordingPlayerTitle: document.querySelector("#recordingPlayerTitle"),
  recordingPlayerMeta: document.querySelector("#recordingPlayerMeta"),
  downloadRecordingButton: document.querySelector("#downloadRecordingButton"),
  deleteRecordingButton: document.querySelector("#deleteRecordingButton"),
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
  recordCaptureModeInput: document.querySelector("#recordCaptureModeInput"),
  recordCaptureModeGroup: document.querySelector("#recordCaptureModeGroup"),
  recordOptimizeInput: document.querySelector("#recordOptimizeInput"),
  recordOptimizeButton: document.querySelector("#recordOptimizeButton"),
  recordOptimizeHint: document.querySelector("#recordOptimizeHint"),
  recordAudioModeInput: document.querySelector("#recordAudioModeInput"),
  recordAudioModeGroup: document.querySelector("#recordAudioModeGroup"),
  recordFormatSelect: document.querySelector("#recordFormatSelect"),
  recorderAdvancedOptions: document.querySelector("#recorderAdvancedOptions"),
  recordSurfaceField: document.querySelector("#recordSurfaceField"),
  recordSurfaceSelect: document.querySelector("#recordSurfaceSelect"),
  recordQualitySelect: document.querySelector("#recordQualitySelect"),
  recordWidthSelect: document.querySelector("#recordWidthSelect"),
  recordFpsSelect: document.querySelector("#recordFpsSelect"),
  recorderWarning: document.querySelector("#recorderWarning"),
  recorderHint: document.querySelector("#recorderHint"),
  startRecordingButton: document.querySelector("#startRecordingButton"),
  stopRecordingButton: document.querySelector("#stopRecordingButton"),
  recorderStatusText: document.querySelector("#recorderStatusText"),
  recorderTimerText: document.querySelector("#recorderTimerText"),
  recorderOutputMeta: document.querySelector("#recorderOutputMeta"),
  recorderPreview: document.querySelector("#recorderPreview"),
  openScreenRecorderLink: document.querySelector("#openScreenRecorderLink"),
  recorderDetails: document.querySelector("#recorderDetails"),
  openDiffcheckerLink: document.querySelector("#openDiffcheckerLink"),
  diffStatusBadge: document.querySelector("#diffStatusBadge"),
  diffIgnoreWhitespaceCheckbox: document.querySelector("#diffIgnoreWhitespaceCheckbox"),
  diffIgnoreCaseCheckbox: document.querySelector("#diffIgnoreCaseCheckbox"),
  diffSwapButton: document.querySelector("#diffSwapButton"),
  diffClearBothButton: document.querySelector("#diffClearBothButton"),
  diffLeftInput: document.querySelector("#diffLeftInput"),
  diffRightInput: document.querySelector("#diffRightInput"),
  diffLeftFileInput: document.querySelector("#diffLeftFileInput"),
  diffRightFileInput: document.querySelector("#diffRightFileInput"),
  diffLeftUploadButton: document.querySelector("#diffLeftUploadButton"),
  diffRightUploadButton: document.querySelector("#diffRightUploadButton"),
  diffLeftClearButton: document.querySelector("#diffLeftClearButton"),
  diffRightClearButton: document.querySelector("#diffRightClearButton"),
  runDiffButton: document.querySelector("#runDiffButton"),
  diffMergeLeftToRightAllButton: document.querySelector("#diffMergeLeftToRightAllButton"),
  diffMergeRightToLeftAllButton: document.querySelector("#diffMergeRightToLeftAllButton"),
  diffCopyLeftButton: document.querySelector("#diffCopyLeftButton"),
  diffCopyRightButton: document.querySelector("#diffCopyRightButton"),
  diffDownloadLeftButton: document.querySelector("#diffDownloadLeftButton"),
  diffDownloadRightButton: document.querySelector("#diffDownloadRightButton"),
  diffSummaryText: document.querySelector("#diffSummaryText"),
  diffResultList: document.querySelector("#diffResultList"),
  diffLeftMeta: document.querySelector("#diffLeftMeta"),
  diffRightMeta: document.querySelector("#diffRightMeta"),
  diffLeftTitle: document.querySelector("#diffLeftTitle"),
  diffRightTitle: document.querySelector("#diffRightTitle"),
};

let recordingLibraryDbPromise = null;

void boot();

async function boot() {
  if (!window.PDFLib || !window.JSZip) {
    setStatus("Vendor libraries failed to load. Refresh the page and try again.", true);
    return;
  }

  syncRecordingNamingCounters();
  populatePresetSelect();
  populateRecorderFormats();
  elements.recordSurfaceSelect.value = "screen";
  bindEvents();
  state.diagnostics = detectDiagnostics();
  renderDiagnostics();
  renderProfile();
  renderAnalytics();
  renderHistory();
  renderRecordingLibrary();
  renderRecordingPlayer();
  updateQualityLabels();
  applyPreset(state.presetKey);
  renderRecorderControls();
  renderRecorderWarning();
  renderRecorderTimer();
  initializeDiffchecker();
  handleInitialDeepLink();
  await restoreRecordingLibrary();
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
  elements.recordingList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-recording-id]");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    void selectRecordingFromLibrary(button.dataset.recordingId);
  });
  elements.clearRecordingsButton.addEventListener("click", () => {
    void clearSavedRecordings();
  });
  elements.downloadRecordingButton.addEventListener("click", () => {
    void downloadSelectedRecording();
  });
  elements.deleteRecordingButton.addEventListener("click", () => {
    void deleteSelectedRecording();
  });
  elements.recordCaptureModeGroup.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-record-mode]");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    setRecorderCaptureMode(button.dataset.recordMode);
  });
  elements.recordAudioModeGroup.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-record-audio]");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    setRecorderAudioMode(button.dataset.recordAudio);
  });
  elements.recordOptimizeButton.addEventListener("click", () => {
    setRecorderOptimize();
  });
  elements.recordFormatSelect.addEventListener("change", renderRecorderWarning);
  elements.recordSurfaceSelect.addEventListener("change", renderRecorderWarning);
  elements.recordQualitySelect.addEventListener("change", renderRecorderWarning);
  elements.recordWidthSelect.addEventListener("change", renderRecorderWarning);
  elements.recordFpsSelect.addEventListener("change", renderRecorderWarning);
  elements.startRecordingButton.addEventListener("click", () => {
    void startScreenRecording();
  });
  elements.stopRecordingButton.addEventListener("click", () => {
    void stopScreenRecording();
  });
  elements.openScreenRecorderLink?.addEventListener("click", (event) => {
    event.preventDefault();
    revealRecorderPanel({ focusStartButton: true });
  });

  if (hasDiffchecker()) {
    elements.openDiffcheckerLink?.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelector("#diffchecker-title")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      window.setTimeout(() => {
        elements.diffLeftInput?.focus();
      }, 220);
    });
    elements.diffLeftUploadButton.addEventListener("click", () => {
      elements.diffLeftFileInput.click();
    });
    elements.diffRightUploadButton.addEventListener("click", () => {
      elements.diffRightFileInput.click();
    });
    elements.diffLeftFileInput.addEventListener("change", () => {
      void handleDiffFileUpload("left");
    });
    elements.diffRightFileInput.addEventListener("change", () => {
      void handleDiffFileUpload("right");
    });
    elements.diffLeftInput.addEventListener("input", () => {
      updateDiffSideMeta("left");
      scheduleDiffComparison();
    });
    elements.diffRightInput.addEventListener("input", () => {
      updateDiffSideMeta("right");
      scheduleDiffComparison();
    });
    elements.diffLeftInput.addEventListener("scroll", () => {
      syncDiffEditorScroll("left");
    }, { passive: true });
    elements.diffRightInput.addEventListener("scroll", () => {
      syncDiffEditorScroll("right");
    }, { passive: true });
    elements.diffIgnoreWhitespaceCheckbox.addEventListener("change", scheduleDiffComparison);
    elements.diffIgnoreCaseCheckbox.addEventListener("change", scheduleDiffComparison);
    elements.diffSwapButton.addEventListener("click", swapDiffSides);
    elements.diffClearBothButton.addEventListener("click", clearDiffBothSides);
    elements.diffLeftClearButton.addEventListener("click", () => {
      clearDiffSide("left");
    });
    elements.diffRightClearButton.addEventListener("click", () => {
      clearDiffSide("right");
    });
    elements.runDiffButton.addEventListener("click", () => {
      runDiffComparison();
    });
    elements.diffMergeLeftToRightAllButton.addEventListener("click", () => {
      mergeDiffAll("left-to-right");
    });
    elements.diffMergeRightToLeftAllButton.addEventListener("click", () => {
      mergeDiffAll("right-to-left");
    });
    elements.diffCopyLeftButton?.addEventListener("click", () => {
      void copyDiffSide("left");
    });
    elements.diffCopyRightButton?.addEventListener("click", () => {
      void copyDiffSide("right");
    });
    elements.diffDownloadLeftButton?.addEventListener("click", () => {
      downloadDiffSide("left");
    });
    elements.diffDownloadRightButton?.addEventListener("click", () => {
      downloadDiffSide("right");
    });
    elements.diffResultList.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const button = event.target.closest("[data-diff-merge]");
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return;
      }

      const blockIndex = Number(button.dataset.diffBlockIndex);
      const direction = button.dataset.diffMerge;
      if (!Number.isFinite(blockIndex)) {
        return;
      }

      if (direction === "left-to-right" || direction === "right-to-left") {
        mergeDiffBlock(direction, blockIndex);
      }
    });
  }
}

function revealRecorderPanel(options = {}) {
  const smooth = options.smooth !== false;
  const focusStartButton = options.focusStartButton === true;

  if (elements.recorderDetails) {
    elements.recorderDetails.open = true;
  }

  document.querySelector("#recorder-title")?.scrollIntoView({
    behavior: smooth ? "smooth" : "auto",
    block: "start",
  });

  if (focusStartButton) {
    window.setTimeout(() => {
      elements.startRecordingButton?.focus();
    }, 220);
  }
}

function handleInitialDeepLink() {
  const hash = String(window.location.hash || "").toLowerCase();
  if (hash === "#recorder-title" || hash === "#recorderdetails") {
    revealRecorderPanel({ smooth: false, focusStartButton: false });
  }
}

function applyPreset(presetKey) {
  setActivePreset(presetKey);
  clearSelectedFiles();
  if (!isWorkspaceLocked()) {
    const preset = presets[state.presetKey];
    setCoachMessage(`Great. Step 2: add your ${preset.minimumFiles > 1 ? "files" : "file"} in the middle section.`);
  }
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
  setCoachMessage(`Great. Step 2: add your ${preset.minimumFiles > 1 ? "files" : "file"} in the middle section.`);
  syncControlAvailability();
  scheduleFfmpegWarmup();
}

function resetOptionInputs() {
  elements.videoProfileSelect.value = "balanced";
  elements.videoWidthSelect.value = "1280";
  elements.videoFpsSelect.value = "24";
  elements.stripAudioCheckbox.checked = false;
  elements.jpgQualityRange.value = "92";
  elements.webpQualityRange.value = "90";
  updateQualityLabels();
}

function updateQualityLabels() {
  elements.jpgQualityLabel.textContent = `${elements.jpgQualityRange.value}%`;
  elements.webpQualityLabel.textContent = `${elements.webpQualityRange.value}%`;
}

function hasDiffchecker() {
  return Boolean(
    elements.diffLeftInput &&
    elements.diffRightInput &&
    elements.diffResultList &&
    elements.diffSummaryText &&
    elements.diffStatusBadge,
  );
}

function initializeDiffchecker() {
  if (!hasDiffchecker()) {
    return;
  }

  state.diff.leftLabel = elements.diffLeftTitle?.textContent?.trim() || "Original";
  state.diff.rightLabel = elements.diffRightTitle?.textContent?.trim() || "Updated";
  applyDiffSideLabel("left", state.diff.leftLabel);
  applyDiffSideLabel("right", state.diff.rightLabel);
  updateDiffSideMeta("left");
  updateDiffSideMeta("right");
  setDiffStatus(
    "No comparison yet",
    "Add content to both sides to see line-by-line differences.",
  );
  renderDiffBlocks([]);
}

function getDiffSideValue(side) {
  return side === "left" ? elements.diffLeftInput.value : elements.diffRightInput.value;
}

function setDiffSideValue(side, value) {
  if (side === "left") {
    elements.diffLeftInput.value = value;
  } else {
    elements.diffRightInput.value = value;
  }
}

function getDiffDefaultLabel(side) {
  return side === "left" ? "Original" : "Updated";
}

function applyDiffSideLabel(side, label) {
  const trimmed = String(label || "").trim() || getDiffDefaultLabel(side);

  if (side === "left") {
    state.diff.leftLabel = trimmed;
    if (elements.diffLeftTitle) {
      elements.diffLeftTitle.textContent = trimmed;
    }
  } else {
    state.diff.rightLabel = trimmed;
    if (elements.diffRightTitle) {
      elements.diffRightTitle.textContent = trimmed;
    }
  }
}

function getDiffLinesFromText(text) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n");
  if (!normalized) {
    return [];
  }
  return normalized.split("\n");
}

function joinDiffLines(lines) {
  return lines.join("\n");
}

function formatDiffLineCount(count) {
  return `${count} line${count === 1 ? "" : "s"}`;
}

function updateDiffSideMeta(side) {
  if (!hasDiffchecker()) {
    return;
  }

  const lines = getDiffLinesFromText(getDiffSideValue(side)).length;
  if (side === "left") {
    elements.diffLeftMeta.textContent = formatDiffLineCount(lines);
  } else {
    elements.diffRightMeta.textContent = formatDiffLineCount(lines);
  }
}

function setDiffStatus(badgeText, summaryText) {
  if (!hasDiffchecker()) {
    return;
  }

  elements.diffStatusBadge.textContent = badgeText;
  elements.diffSummaryText.textContent = summaryText;
}

function syncDiffEditorScroll(sourceSide) {
  if (!hasDiffchecker() || state.diff.scrollSyncing) {
    return;
  }

  const source = sourceSide === "left" ? elements.diffLeftInput : elements.diffRightInput;
  const target = sourceSide === "left" ? elements.diffRightInput : elements.diffLeftInput;
  const sourceRange = source.scrollHeight - source.clientHeight;
  const targetRange = target.scrollHeight - target.clientHeight;

  if (sourceRange <= 0 || targetRange <= 0) {
    return;
  }

  const ratio = source.scrollTop / sourceRange;
  state.diff.scrollSyncing = true;
  target.scrollTop = Math.round(targetRange * ratio);
  state.diff.scrollSyncing = false;
}

function buildDiffDownloadName(side) {
  const rawLabel = side === "left" ? state.diff.leftLabel : state.diff.rightLabel;
  const base = stripExtension(String(rawLabel || "").trim())
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const safeBase = base || (side === "left" ? "diff-left" : "diff-right");
  return `${safeBase}.txt`;
}

async function copyDiffSide(side) {
  if (!hasDiffchecker()) {
    return;
  }

  const value = getDiffSideValue(side);
  const sideLabel = side === "left" ? "left" : "right";

  if (!value) {
    setDiffStatus("Nothing to copy", `The ${sideLabel} side is empty.`);
    return;
  }

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable.");
    }

    await navigator.clipboard.writeText(value);
    setDiffStatus("Copied", `${sideLabel === "left" ? "Left" : "Right"} side copied.`);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.setAttribute("readonly", "readonly");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    const ok = document.execCommand("copy");
    helper.remove();
    setDiffStatus(
      ok ? "Copied" : "Copy failed",
      ok
        ? `${sideLabel === "left" ? "Left" : "Right"} side copied.`
        : "Clipboard access was blocked by this browser.",
    );
  }
}

function downloadDiffSide(side) {
  if (!hasDiffchecker()) {
    return;
  }

  const value = getDiffSideValue(side);
  if (!value) {
    setDiffStatus(
      "Nothing to download",
      `The ${side === "left" ? "left" : "right"} side is empty.`,
    );
    return;
  }

  triggerBlobDownload(
    buildDiffDownloadName(side),
    new Blob([value], { type: "text/plain;charset=utf-8" }),
  );
  setDiffStatus(
    "Downloaded",
    `${side === "left" ? "Left" : "Right"} side downloaded as a text file.`,
  );
}

function scheduleDiffComparison() {
  if (!hasDiffchecker()) {
    return;
  }

  if (state.diff.compareTimerId) {
    window.clearTimeout(state.diff.compareTimerId);
  }

  state.diff.compareTimerId = window.setTimeout(() => {
    state.diff.compareTimerId = 0;
    runDiffComparison({ quiet: true });
  }, DIFF_COMPARE_DEBOUNCE_MS);
}

async function handleDiffFileUpload(side) {
  if (!hasDiffchecker()) {
    return;
  }

  const fileInput = side === "left" ? elements.diffLeftFileInput : elements.diffRightFileInput;
  const [file] = Array.from(fileInput.files || []);

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    if (text.includes("\u0000")) {
      throw new Error("This file looks binary. Use a plain text file.");
    }

    setDiffSideValue(side, text.replace(/\r\n?/g, "\n"));
    applyDiffSideLabel(side, file.name || getDiffDefaultLabel(side));
    updateDiffSideMeta(side);
    runDiffComparison({ quiet: true });
  } catch (error) {
    setDiffStatus(
      "File read failed",
      error instanceof Error ? error.message : "Could not read this file as text.",
    );
  } finally {
    fileInput.value = "";
  }
}

function clearDiffSide(side) {
  if (!hasDiffchecker()) {
    return;
  }

  setDiffSideValue(side, "");
  applyDiffSideLabel(side, getDiffDefaultLabel(side));
  updateDiffSideMeta(side);
  runDiffComparison({ quiet: true });
}

function clearDiffBothSides() {
  if (!hasDiffchecker()) {
    return;
  }

  if (state.diff.compareTimerId) {
    window.clearTimeout(state.diff.compareTimerId);
    state.diff.compareTimerId = 0;
  }

  setDiffSideValue("left", "");
  setDiffSideValue("right", "");
  applyDiffSideLabel("left", getDiffDefaultLabel("left"));
  applyDiffSideLabel("right", getDiffDefaultLabel("right"));
  updateDiffSideMeta("left");
  updateDiffSideMeta("right");
  state.diff.blocks = [];
  state.diff.lastComparedLeft = "";
  state.diff.lastComparedRight = "";
  setDiffStatus(
    "No comparison yet",
    "Add content to both sides to see line-by-line differences.",
  );
  renderDiffBlocks([]);
}

function swapDiffSides() {
  if (!hasDiffchecker()) {
    return;
  }

  const leftValue = getDiffSideValue("left");
  const rightValue = getDiffSideValue("right");
  const leftLabel = state.diff.leftLabel;
  const rightLabel = state.diff.rightLabel;

  setDiffSideValue("left", rightValue);
  setDiffSideValue("right", leftValue);
  applyDiffSideLabel("left", rightLabel);
  applyDiffSideLabel("right", leftLabel);
  updateDiffSideMeta("left");
  updateDiffSideMeta("right");
  runDiffComparison({ quiet: true });
}

function normalizeDiffLine(line, options) {
  let normalized = String(line);

  if (options.ignoreWhitespace) {
    normalized = normalized.replace(/\s+/g, " ").trim();
  }

  if (options.ignoreCase) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function buildGreedyDiffOperations(leftLines, rightLines, normalizedLeft, normalizedRight) {
  const operations = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftLines.length && rightIndex < rightLines.length) {
    if (normalizedLeft[leftIndex] === normalizedRight[rightIndex]) {
      operations.push({ type: "equal", value: leftLines[leftIndex] });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (
      leftIndex + 1 < leftLines.length &&
      normalizedLeft[leftIndex + 1] === normalizedRight[rightIndex]
    ) {
      operations.push({ type: "delete", value: leftLines[leftIndex] });
      leftIndex += 1;
      continue;
    }

    if (
      rightIndex + 1 < rightLines.length &&
      normalizedLeft[leftIndex] === normalizedRight[rightIndex + 1]
    ) {
      operations.push({ type: "insert", value: rightLines[rightIndex] });
      rightIndex += 1;
      continue;
    }

    operations.push({ type: "delete", value: leftLines[leftIndex] });
    operations.push({ type: "insert", value: rightLines[rightIndex] });
    leftIndex += 1;
    rightIndex += 1;
  }

  while (leftIndex < leftLines.length) {
    operations.push({ type: "delete", value: leftLines[leftIndex] });
    leftIndex += 1;
  }

  while (rightIndex < rightLines.length) {
    operations.push({ type: "insert", value: rightLines[rightIndex] });
    rightIndex += 1;
  }

  return operations;
}

function buildLcsDiffOperations(leftLines, rightLines, normalizedLeft, normalizedRight) {
  const leftLength = leftLines.length;
  const rightLength = rightLines.length;
  const width = rightLength + 1;
  const directions = new Uint8Array((leftLength + 1) * (rightLength + 1));
  let previousRow = new Uint32Array(width);
  let currentRow = new Uint32Array(width);

  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    currentRow[0] = 0;

    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      const directionIndex = leftIndex * width + rightIndex;

      if (normalizedLeft[leftIndex - 1] === normalizedRight[rightIndex - 1]) {
        currentRow[rightIndex] = previousRow[rightIndex - 1] + 1;
        directions[directionIndex] = 1;
      } else if (previousRow[rightIndex] >= currentRow[rightIndex - 1]) {
        currentRow[rightIndex] = previousRow[rightIndex];
        directions[directionIndex] = 2;
      } else {
        currentRow[rightIndex] = currentRow[rightIndex - 1];
        directions[directionIndex] = 3;
      }
    }

    const swap = previousRow;
    previousRow = currentRow;
    currentRow = swap;
  }

  const operations = [];
  let leftIndex = leftLength;
  let rightIndex = rightLength;

  while (leftIndex > 0 || rightIndex > 0) {
    const directionIndex = leftIndex * width + rightIndex;
    const direction = directions[directionIndex];

    if (leftIndex > 0 && rightIndex > 0 && direction === 1) {
      operations.push({ type: "equal", value: leftLines[leftIndex - 1] });
      leftIndex -= 1;
      rightIndex -= 1;
      continue;
    }

    if (leftIndex > 0 && (rightIndex === 0 || direction === 2)) {
      operations.push({ type: "delete", value: leftLines[leftIndex - 1] });
      leftIndex -= 1;
      continue;
    }

    operations.push({ type: "insert", value: rightLines[rightIndex - 1] });
    rightIndex -= 1;
  }

  operations.reverse();
  return operations;
}

function buildDiffOperations(leftLines, rightLines, options) {
  const normalizedLeft = leftLines.map((line) => normalizeDiffLine(line, options));
  const normalizedRight = rightLines.map((line) => normalizeDiffLine(line, options));
  const operations = [];
  let usedGreedyFallback = false;
  let prefixLength = 0;

  while (
    prefixLength < leftLines.length &&
    prefixLength < rightLines.length &&
    normalizedLeft[prefixLength] === normalizedRight[prefixLength]
  ) {
    operations.push({ type: "equal", value: leftLines[prefixLength] });
    prefixLength += 1;
  }

  let leftSuffixIndex = leftLines.length - 1;
  let rightSuffixIndex = rightLines.length - 1;
  const suffixOperations = [];

  while (
    leftSuffixIndex >= prefixLength &&
    rightSuffixIndex >= prefixLength &&
    normalizedLeft[leftSuffixIndex] === normalizedRight[rightSuffixIndex]
  ) {
    suffixOperations.push({ type: "equal", value: leftLines[leftSuffixIndex] });
    leftSuffixIndex -= 1;
    rightSuffixIndex -= 1;
  }

  const middleLeft = leftLines.slice(prefixLength, leftSuffixIndex + 1);
  const middleRight = rightLines.slice(prefixLength, rightSuffixIndex + 1);
  const middleNormalizedLeft = normalizedLeft.slice(prefixLength, leftSuffixIndex + 1);
  const middleNormalizedRight = normalizedRight.slice(prefixLength, rightSuffixIndex + 1);
  const middleCellCount = middleLeft.length * middleRight.length;
  const middleOperations = middleCellCount > DIFF_MAX_DP_CELLS
    ? buildGreedyDiffOperations(
        middleLeft,
        middleRight,
        middleNormalizedLeft,
        middleNormalizedRight,
      )
    : buildLcsDiffOperations(
        middleLeft,
        middleRight,
        middleNormalizedLeft,
        middleNormalizedRight,
      );

  if (middleCellCount > DIFF_MAX_DP_CELLS) {
    usedGreedyFallback = true;
  }

  operations.push(...middleOperations);
  operations.push(...suffixOperations.reverse());
  return {
    operations,
    usedGreedyFallback,
  };
}

function getDiffBlockKind(block) {
  if (block.leftLines.length === 0 && block.rightLines.length > 0) {
    return "added";
  }

  if (block.rightLines.length === 0 && block.leftLines.length > 0) {
    return "removed";
  }

  return "changed";
}

function buildDiffBlocks(operations) {
  const blocks = [];
  let leftCursor = 0;
  let rightCursor = 0;
  let openBlock = null;

  const closeBlock = () => {
    if (!openBlock) {
      return;
    }

    openBlock.kind = getDiffBlockKind(openBlock);
    blocks.push(openBlock);
    openBlock = null;
  };

  for (const operation of operations) {
    if (operation.type === "equal") {
      closeBlock();
      leftCursor += 1;
      rightCursor += 1;
      continue;
    }

    if (!openBlock) {
      openBlock = {
        leftStart: leftCursor,
        leftEnd: leftCursor,
        rightStart: rightCursor,
        rightEnd: rightCursor,
        leftLines: [],
        rightLines: [],
      };
    }

    if (operation.type === "delete") {
      openBlock.leftLines.push(operation.value);
      leftCursor += 1;
      openBlock.leftEnd = leftCursor;
      openBlock.rightEnd = rightCursor;
      continue;
    }

    if (operation.type === "insert") {
      openBlock.rightLines.push(operation.value);
      rightCursor += 1;
      openBlock.leftEnd = leftCursor;
      openBlock.rightEnd = rightCursor;
    }
  }

  closeBlock();
  return blocks;
}

function getDiffOptions() {
  return {
    ignoreWhitespace: Boolean(elements.diffIgnoreWhitespaceCheckbox?.checked),
    ignoreCase: Boolean(elements.diffIgnoreCaseCheckbox?.checked),
  };
}

function formatDiffOptionsSummary(options) {
  const active = [];

  if (options.ignoreWhitespace) {
    active.push("extra spaces");
  }

  if (options.ignoreCase) {
    active.push("letter case");
  }

  if (active.length === 0) {
    return "";
  }

  return ` (ignoring ${active.join(" and ")})`;
}

function createDiffResult(leftText, rightText, options) {
  const leftLines = getDiffLinesFromText(leftText);
  const rightLines = getDiffLinesFromText(rightText);
  const diffResult = buildDiffOperations(leftLines, rightLines, options);
  const operations = diffResult.operations;
  const blocks = buildDiffBlocks(operations);
  const insertedLines = operations.filter((operation) => operation.type === "insert").length;
  const removedLines = operations.filter((operation) => operation.type === "delete").length;
  const changedBlocks = blocks.filter(
    (block) => block.leftLines.length > 0 && block.rightLines.length > 0,
  ).length;

  return {
    options,
    leftLines,
    rightLines,
    operations,
    blocks,
    insertedLines,
    removedLines,
    changedBlocks,
    usedGreedyFallback: diffResult.usedGreedyFallback,
  };
}

function formatDiffRange(start, end) {
  if (end <= start) {
    return "none";
  }

  const first = start + 1;
  const last = end;
  return first === last ? String(first) : `${first}-${last}`;
}

function getDiffBlockTitle(kind, index) {
  if (kind === "added") {
    return `Added block ${index + 1}`;
  }

  if (kind === "removed") {
    return `Removed block ${index + 1}`;
  }

  return `Changed block ${index + 1}`;
}

function splitInlineTokens(line) {
  return String(line).match(/\s+|[^\s]+/g) || [];
}

function normalizeInlineToken(token, options) {
  let normalized = String(token);

  if (options.ignoreWhitespace && /^\s+$/.test(normalized)) {
    normalized = " ";
  }

  if (options.ignoreCase) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function buildInlineTokenOperations(leftTokens, rightTokens, options) {
  const normalizedLeft = leftTokens.map((token) => normalizeInlineToken(token, options));
  const normalizedRight = rightTokens.map((token) => normalizeInlineToken(token, options));
  const cellCount = leftTokens.length * rightTokens.length;

  if (cellCount > DIFF_MAX_INLINE_CELLS) {
    return buildGreedyDiffOperations(leftTokens, rightTokens, normalizedLeft, normalizedRight);
  }

  return buildLcsDiffOperations(leftTokens, rightTokens, normalizedLeft, normalizedRight);
}

function appendInlineFragment(fragments, text, changed) {
  if (!text) {
    return;
  }

  const previous = fragments[fragments.length - 1];
  if (previous && previous.changed === changed) {
    previous.text += text;
    return;
  }

  fragments.push({ text, changed });
}

function buildInlineSegments(leftLine, rightLine, options) {
  if (normalizeDiffLine(leftLine, options) === normalizeDiffLine(rightLine, options)) {
    return {
      leftSegments: [{ text: leftLine, changed: false }],
      rightSegments: [{ text: rightLine, changed: false }],
    };
  }

  const leftTokens = splitInlineTokens(leftLine);
  const rightTokens = splitInlineTokens(rightLine);
  const operations = buildInlineTokenOperations(leftTokens, rightTokens, options);
  const leftSegments = [];
  const rightSegments = [];
  let leftIndex = 0;
  let rightIndex = 0;

  for (const operation of operations) {
    if (operation.type === "equal") {
      appendInlineFragment(leftSegments, leftTokens[leftIndex] || "", false);
      appendInlineFragment(rightSegments, rightTokens[rightIndex] || "", false);
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (operation.type === "delete") {
      appendInlineFragment(leftSegments, leftTokens[leftIndex] || "", true);
      leftIndex += 1;
      continue;
    }

    appendInlineFragment(rightSegments, rightTokens[rightIndex] || "", true);
    rightIndex += 1;
  }

  return {
    leftSegments,
    rightSegments,
  };
}

function createDiffLineRow(lineNumber, segments, options = {}) {
  const row = document.createElement("div");
  row.className = "diff-line";

  if (options.placeholder) {
    row.classList.add("is-placeholder");
  }

  if (options.changed) {
    row.classList.add("is-changed");
  }

  const lineNumberNode = document.createElement("span");
  lineNumberNode.className = "diff-line-number";
  lineNumberNode.textContent = lineNumber > 0 ? String(lineNumber) : "";

  const contentNode = document.createElement("span");
  contentNode.className = "diff-line-content";
  const normalizedSegments = Array.isArray(segments) ? segments : [];

  if (normalizedSegments.length === 0) {
    contentNode.textContent = "\u00a0";
  } else {
    for (const segment of normalizedSegments) {
      const text = String(segment?.text ?? "");
      const fragment = document.createElement("span");
      fragment.className = segment?.changed
        ? "diff-fragment is-changed"
        : "diff-fragment";
      fragment.textContent = text || "\u00a0";
      contentNode.append(fragment);
    }
  }

  row.append(lineNumberNode, contentNode);
  return row;
}

function createDiffSide(label, rows, emptyHint) {
  const side = document.createElement("section");
  side.className = "diff-side";

  const sideLabel = document.createElement("p");
  sideLabel.className = "diff-side-label";
  sideLabel.textContent = label;

  const body = document.createElement("div");
  body.className = "diff-side-body";

  if (rows.length === 0) {
    side.classList.add("is-empty");
    body.append(createDiffLineRow(0, [{ text: emptyHint, changed: false }], { placeholder: true }));
  } else {
    rows.forEach((row) => {
      body.append(createDiffLineRow(row.lineNumber, row.segments, row));
    });
  }

  side.append(sideLabel, body);
  return {
    side,
    body,
  };
}

function buildDiffRowsForBlock(block, options) {
  const leftRows = [];
  const rightRows = [];

  if (block.kind === "changed") {
    const totalRows = Math.max(block.leftLines.length, block.rightLines.length);
    let leftLineOffset = 0;
    let rightLineOffset = 0;

    for (let index = 0; index < totalRows; index += 1) {
      const leftLine = block.leftLines[index];
      const rightLine = block.rightLines[index];
      const hasLeft = typeof leftLine === "string";
      const hasRight = typeof rightLine === "string";
      const leftLineNumber = hasLeft ? block.leftStart + leftLineOffset + 1 : 0;
      const rightLineNumber = hasRight ? block.rightStart + rightLineOffset + 1 : 0;

      if (hasLeft) {
        leftLineOffset += 1;
      }

      if (hasRight) {
        rightLineOffset += 1;
      }

      if (hasLeft && hasRight) {
        const inline = buildInlineSegments(leftLine, rightLine, options);
        const leftChanged = inline.leftSegments.some((segment) => segment.changed);
        const rightChanged = inline.rightSegments.some((segment) => segment.changed);
        leftRows.push({
          lineNumber: leftLineNumber,
          segments: inline.leftSegments,
          changed: leftChanged,
          placeholder: false,
        });
        rightRows.push({
          lineNumber: rightLineNumber,
          segments: inline.rightSegments,
          changed: rightChanged,
          placeholder: false,
        });
      } else if (hasLeft) {
        leftRows.push({
          lineNumber: leftLineNumber,
          segments: [{ text: leftLine, changed: true }],
          changed: true,
          placeholder: false,
        });
        rightRows.push({
          lineNumber: 0,
          segments: [],
          changed: false,
          placeholder: true,
        });
      } else {
        leftRows.push({
          lineNumber: 0,
          segments: [],
          changed: false,
          placeholder: true,
        });
        rightRows.push({
          lineNumber: rightLineNumber,
          segments: [{ text: rightLine || "", changed: true }],
          changed: true,
          placeholder: false,
        });
      }
    }

    return {
      leftRows,
      rightRows,
    };
  }

  if (block.kind === "removed") {
    block.leftLines.forEach((line, index) => {
      leftRows.push({
        lineNumber: block.leftStart + index + 1,
        segments: [{ text: line, changed: true }],
        changed: true,
        placeholder: false,
      });
      rightRows.push({
        lineNumber: 0,
        segments: [],
        changed: false,
        placeholder: true,
      });
    });

    return {
      leftRows,
      rightRows,
    };
  }

  block.rightLines.forEach((line, index) => {
    leftRows.push({
      lineNumber: 0,
      segments: [],
      changed: false,
      placeholder: true,
    });
    rightRows.push({
      lineNumber: block.rightStart + index + 1,
      segments: [{ text: line, changed: true }],
      changed: true,
      placeholder: false,
    });
  });

  return {
    leftRows,
    rightRows,
  };
}

function bindDiffBlockScrollSync(leftBody, rightBody) {
  if (!(leftBody instanceof HTMLElement) || !(rightBody instanceof HTMLElement)) {
    return;
  }

  let syncing = false;
  const sync = (source, target) => {
    if (syncing) {
      return;
    }

    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetRange = target.scrollHeight - target.clientHeight;
    if (sourceRange <= 0 || targetRange <= 0) {
      return;
    }

    syncing = true;
    target.scrollTop = Math.round((source.scrollTop / sourceRange) * targetRange);
    syncing = false;
  };

  leftBody.addEventListener("scroll", () => {
    sync(leftBody, rightBody);
  }, { passive: true });
  rightBody.addEventListener("scroll", () => {
    sync(rightBody, leftBody);
  }, { passive: true });
}

function renderDiffBlocks(blocks) {
  if (!hasDiffchecker()) {
    return;
  }

  elements.diffResultList.innerHTML = "";

  if (blocks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No differences to show yet.";
    elements.diffResultList.append(empty);
    return;
  }

  const options = state.diff.lastOptions || { ignoreWhitespace: false, ignoreCase: false };

  blocks.forEach((block, index) => {
    const article = document.createElement("article");
    article.className = `diff-block is-${block.kind}`;

    const head = document.createElement("div");
    head.className = "diff-block-head";

    const title = document.createElement("h3");
    title.className = "diff-block-title";
    title.textContent = getDiffBlockTitle(block.kind, index);

    const meta = document.createElement("p");
    meta.className = "diff-block-meta";
    meta.textContent =
      `Left lines ${formatDiffRange(block.leftStart, block.leftEnd)} - ` +
      `Right lines ${formatDiffRange(block.rightStart, block.rightEnd)}`;

    head.append(title, meta);

    const grid = document.createElement("div");
    grid.className = "diff-block-grid";
    const rows = buildDiffRowsForBlock(block, options);

    const leftSide = createDiffSide(
      `Left (${state.diff.leftLabel})`,
      rows.leftRows,
      "No lines on the left side",
    );
    const rightSide = createDiffSide(
      `Right (${state.diff.rightLabel})`,
      rows.rightRows,
      "No lines on the right side",
    );

    bindDiffBlockScrollSync(leftSide.body, rightSide.body);
    grid.append(leftSide.side, rightSide.side);

    const actions = document.createElement("div");
    actions.className = "diff-merge-actions";

    const leftToRightButton = document.createElement("button");
    leftToRightButton.type = "button";
    leftToRightButton.className = "diff-merge-button";
    leftToRightButton.dataset.diffMerge = "left-to-right";
    leftToRightButton.dataset.diffBlockIndex = String(index);
    leftToRightButton.textContent = "Copy left block to right";

    const rightToLeftButton = document.createElement("button");
    rightToLeftButton.type = "button";
    rightToLeftButton.className = "diff-merge-button";
    rightToLeftButton.dataset.diffMerge = "right-to-left";
    rightToLeftButton.dataset.diffBlockIndex = String(index);
    rightToLeftButton.textContent = "Copy right block to left";

    actions.append(leftToRightButton, rightToLeftButton);
    article.append(head, grid, actions);
    elements.diffResultList.append(article);
  });
}

function runDiffComparison(options = {}) {
  if (!hasDiffchecker()) {
    return;
  }

  if (state.diff.compareTimerId) {
    window.clearTimeout(state.diff.compareTimerId);
    state.diff.compareTimerId = 0;
  }

  const leftText = getDiffSideValue("left");
  const rightText = getDiffSideValue("right");
  const compareOptions = getDiffOptions();
  const optionsSuffix = formatDiffOptionsSummary(compareOptions);
  state.diff.lastOptions = compareOptions;
  state.diff.lastComparedLeft = leftText;
  state.diff.lastComparedRight = rightText;
  updateDiffSideMeta("left");
  updateDiffSideMeta("right");

  try {
    const result = createDiffResult(leftText, rightText, compareOptions);
    state.diff.blocks = result.blocks;
    renderDiffBlocks(result.blocks);

    if (result.blocks.length === 0) {
      const emptyMessage =
        result.leftLines.length === 0 && result.rightLines.length === 0
          ? "Add content to both sides to see line-by-line differences."
          : `No differences found${optionsSuffix}.`;
      setDiffStatus("No differences", emptyMessage);
      return;
    }

    const blockSuffix = result.blocks.length === 1 ? "" : "s";
    const summary =
      `Compared ${formatDiffLineCount(result.leftLines.length)} on the left and ` +
      `${formatDiffLineCount(result.rightLines.length)} on the right${optionsSuffix}. ` +
      `${result.insertedLines} added, ${result.removedLines} removed, ` +
      `${result.changedBlocks} modified block${result.changedBlocks === 1 ? "" : "s"}.` +
      (result.usedGreedyFallback ? " Large-file fast compare mode was used." : "");
    setDiffStatus(`${result.blocks.length} change block${blockSuffix}`, summary);
  } catch (error) {
    state.diff.blocks = [];
    renderDiffBlocks([]);
    setDiffStatus(
      "Comparison failed",
      error instanceof Error ? error.message : "Could not compare these inputs.",
    );
  }
}

function mergeDiffAll(direction) {
  if (!hasDiffchecker()) {
    return;
  }

  if (direction === "left-to-right") {
    setDiffSideValue("right", getDiffSideValue("left"));
    updateDiffSideMeta("right");
  } else {
    setDiffSideValue("left", getDiffSideValue("right"));
    updateDiffSideMeta("left");
  }

  runDiffComparison();
}

function mergeDiffBlock(direction, blockIndex) {
  if (!hasDiffchecker()) {
    return;
  }

  if (
    state.diff.lastComparedLeft !== getDiffSideValue("left") ||
    state.diff.lastComparedRight !== getDiffSideValue("right")
  ) {
    runDiffComparison({ quiet: true });
    setDiffStatus(
      "Comparison refreshed",
      "Text changed since the previous comparison. Compare was refreshed, then merge again.",
    );
    return;
  }

  const block = state.diff.blocks[blockIndex];
  if (!block) {
    return;
  }

  const leftLines = getDiffLinesFromText(getDiffSideValue("left"));
  const rightLines = getDiffLinesFromText(getDiffSideValue("right"));

  if (direction === "left-to-right") {
    const nextRight = [
      ...rightLines.slice(0, block.rightStart),
      ...block.leftLines,
      ...rightLines.slice(block.rightEnd),
    ];
    setDiffSideValue("right", joinDiffLines(nextRight));
    updateDiffSideMeta("right");
  } else {
    const nextLeft = [
      ...leftLines.slice(0, block.leftStart),
      ...block.rightLines,
      ...leftLines.slice(block.leftEnd),
    ];
    setDiffSideValue("left", joinDiffLines(nextLeft));
    updateDiffSideMeta("left");
  }

  runDiffComparison();
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
    count.textContent = preset.multiple ? "1+ files" : "1 file";

    const engine = document.createElement("span");
    engine.textContent = "Simple";

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
    return preset.multiple ? "Step 2: add one or more files." : "Step 2: add one file.";
  }

  return `Step 2: add at least ${preset.minimumFiles} files.`;
}

function setCoachMessage(message) {
  if (!elements.coachText) {
    return;
  }

  elements.coachText.textContent = message;
}

function getCoachDefaultMessage() {
  return "Start at Step 1: pick what you want to make.";
}

function renderSelectionSummary() {
  const preset = presets[state.presetKey];

  if (state.files.length === 0) {
    elements.selectionSummary.textContent =
      `${getPresetRequirementText(preset)} We will make a ${getPresetOutputLabel(preset)} file.`;
    return;
  }

  const totalBytes = state.files.reduce((sum, file) => sum + file.size, 0);
  const suffix = state.files.length === 1 ? "file" : "files";
  let summary =
    `${state.files.length} ${suffix} added (${formatBytes(totalBytes)} total). ` +
    `Output: ${getPresetOutputLabel(preset)}.`;

  if (state.videoInfo) {
    summary += ` Video: ${state.videoInfo.width}x${state.videoInfo.height}, ${formatDuration(state.videoInfo.duration)}.`;
  }

  if (state.files.length < preset.minimumFiles) {
    summary += ` Add ${preset.minimumFiles - state.files.length} more file${preset.minimumFiles - state.files.length === 1 ? "" : "s"} to continue.`;
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
      setCoachMessage("Nice! The app picked the best match. Now tap the blue button in Step 3.");
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
      setCoachMessage("Step 1: choose one option above, then we continue.");
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
      setCoachMessage("Try another file type, or change Step 1 to match your file.");
      renderVideoWarning();
      syncControlAvailability();
      return;
    }

    setStatus("Pick or drop files to begin.");
    setCoachMessage("Step 2: add your file in the middle section.");
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
    setCoachMessage(`Add ${remaining} more file${remaining === 1 ? "" : "s"}, then tap the blue button.`);
    setProgress(0);
    syncControlAvailability();
    return;
  }

  if (skippedCount > 0) {
    setStatus(
      `${skippedCount} file${skippedCount === 1 ? "" : "s"} did not match, but the rest are ready.`,
    );
    setCoachMessage("Some files were skipped. The good files are ready. Tap the blue button.");
    setProgress(0);
    syncControlAvailability();
    return;
  }

  setStatus("Ready. Press the button below to start.");
  setCoachMessage("Perfect. Step 3: tap the blue button to start conversion.");
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
  setCoachMessage(
    isWorkspaceLocked()
      ? "Unlock the workspace first, then start from Step 1."
      : getCoachDefaultMessage(),
  );
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

function getRequestedRecorderMode() {
  return normalizeRecorderCaptureMode(elements.recordCaptureModeInput.value);
}

function normalizeRecorderCaptureMode(mode) {
  if (mode === "camera" && canRecordCameraCapture()) {
    return "camera";
  }

  if (mode === "screen" && canRecordScreenCapture()) {
    return "screen";
  }

  if (canRecordScreenCapture()) {
    return "screen";
  }

  if (canRecordCameraCapture()) {
    return "camera";
  }

  return mode === "camera" ? "camera" : "screen";
}

function getRequestedRecorderAudioMode() {
  return normalizeRecorderAudioMode(
    elements.recordAudioModeInput.value,
    getRequestedRecorderMode(),
  );
}

function normalizeRecorderAudioMode(mode, captureMode = getRequestedRecorderMode()) {
  if (captureMode === "camera") {
    return mode === "none" ? "none" : "microphone";
  }

  return mode === "none" ? "none" : "microphone";
}

function canRecordScreenCapture() {
  return Boolean(navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined");
}

function canRecordCameraCapture() {
  return Boolean(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
}

function canUseRecorder() {
  return canRecordScreenCapture() || canRecordCameraCapture();
}

function canRecordSelectedRecorderMode() {
  return getRequestedRecorderMode() === "camera"
    ? canRecordCameraCapture()
    : canRecordScreenCapture();
}

function isRecorderModeSupported(mode) {
  switch (mode) {
    case "camera":
      return canRecordCameraCapture();
    case "screen":
      return canRecordScreenCapture();
    case "screen-camera":
    default:
      return false;
  }
}

function isRecorderAudioModeSupported(mode, captureMode = getRequestedRecorderMode()) {
  return (mode === "none" || mode === "microphone") && (
    captureMode === "screen" || captureMode === "camera"
  );
}

function getRecorderModeLabel(mode) {
  switch (mode) {
    case "camera":
      return "Only Camera";
    case "screen-camera":
      return "Screen + Camera";
    case "screen":
    default:
      return "Only Screen";
  }
}

function getRecorderAudioLabel(mode) {
  switch (mode) {
    case "none":
      return "No audio";
    case "microphone":
    default:
      return "Microphone audio";
  }
}

function getRequestedRecorderOptimize() {
  return elements.recordOptimizeInput.value === "on";
}

function buildRecorderHint(captureMode, selectedFormat, audioMode, optimize) {
  const notes = [];

  if (captureMode === "screen") {
    notes.push(
      "Choose Entire screen in the share prompt if you want app switching to stay in the recording.",
    );
    notes.push(
      "If the browser only offers This Tab on macOS, allow Screen Recording for your browser in System Settings > Privacy & Security > Screen Recording, then restart the browser.",
    );
  } else {
    notes.push("The browser will ask for camera permission when you start.");
  }

  if (audioMode === "microphone" || audioMode === "system-microphone") {
    notes.push("Microphone permission may be requested too.");
  }

  if (optimize) {
    notes.push("Optimize is on, so saving can take longer after you stop the recording.");
  } else {
    notes.push("Optimize is off by default for the fastest save.");
  }

  if (selectedFormat?.needsTranscode) {
    notes.push("If MP4 is not available directly, the app will finish the MP4 after recording stops.");
  } else {
    notes.push("The recording stays on this device and will appear in Latest videos and the downloads area.");
  }

  return notes.join(" ");
}

function applyRecorderChoiceState(group, attributeName, selectedValue, disabledValues) {
  for (const button of group.querySelectorAll("button")) {
    const optionValue = button.dataset[attributeName];
    const isActive = optionValue === selectedValue;
    const isDisabled = disabledValues.has(optionValue);
    button.classList.toggle("is-active", isActive);
    button.classList.toggle("is-disabled", isDisabled);
    button.setAttribute("aria-pressed", String(isActive));
    button.disabled = isDisabled;
  }
}

function renderRecorderControls() {
  const requestedMode = getRequestedRecorderMode();

  if (elements.recordCaptureModeInput.value !== requestedMode) {
    elements.recordCaptureModeInput.value = requestedMode;
  }

  const audioMode = getRequestedRecorderAudioMode();
  const optimize = getRequestedRecorderOptimize();

  if (elements.recordAudioModeInput.value !== audioMode) {
    elements.recordAudioModeInput.value = audioMode;
  }

  const locked = isWorkspaceLocked();
  const recorderBusy = state.busy || state.recording.active || state.recording.processing;
  const captureDisabled = new Set();

  for (const button of elements.recordCaptureModeGroup.querySelectorAll("button")) {
    const mode = button.dataset.recordMode;
    const comingSoon = button.dataset.comingSoon === "true";

    if (comingSoon || !isRecorderModeSupported(mode) || locked || recorderBusy) {
      captureDisabled.add(mode);
    }
  }

  const audioDisabled = new Set();

  for (const button of elements.recordAudioModeGroup.querySelectorAll("button")) {
    const audioOption = button.dataset.recordAudio;

    if (
      !isRecorderAudioModeSupported(audioOption, requestedMode) ||
      locked ||
      recorderBusy ||
      !canRecordSelectedRecorderMode()
    ) {
      audioDisabled.add(audioOption);
    }
  }

  applyRecorderChoiceState(
    elements.recordCaptureModeGroup,
    "recordMode",
    requestedMode,
    captureDisabled,
  );
  applyRecorderChoiceState(
    elements.recordAudioModeGroup,
    "recordAudio",
    audioMode,
    audioDisabled,
  );

  elements.recordOptimizeButton.classList.toggle("is-active", optimize);
  elements.recordOptimizeButton.setAttribute("aria-pressed", String(optimize));
  elements.recordOptimizeButton.disabled = locked || recorderBusy || !getSelectedRecorderFormat();
  elements.recordOptimizeHint.textContent = optimize
    ? "Optimization is on. The recording will take a little longer to finish so playback and seeking can be cleaner."
    : "Leave optimization off for the fastest save. Turn it on if you want cleaner playback and seeking after recording.";
  elements.recordSurfaceField.hidden = requestedMode !== "screen";
  elements.recorderHint.textContent = buildRecorderHint(
    requestedMode,
    getSelectedRecorderFormat(),
    audioMode,
    optimize,
  );
}

function setRecorderCaptureMode(mode) {
  const nextMode = normalizeRecorderCaptureMode(mode);

  if (mode === "screen-camera" || !isRecorderModeSupported(nextMode)) {
    return;
  }

  elements.recordCaptureModeInput.value = nextMode;
  renderRecorderControls();
  renderRecorderWarning();
  syncControlAvailability();
}

function setRecorderAudioMode(mode) {
  const nextMode = normalizeRecorderAudioMode(mode, getRequestedRecorderMode());

  if (!isRecorderAudioModeSupported(nextMode, getRequestedRecorderMode())) {
    return;
  }

  elements.recordAudioModeInput.value = nextMode;
  renderRecorderControls();
  renderRecorderWarning();
  syncControlAvailability();
}

function setRecorderOptimize(forceValue) {
  const nextValue =
    typeof forceValue === "boolean" ? forceValue : !getRequestedRecorderOptimize();
  elements.recordOptimizeInput.value = nextValue ? "on" : "off";
  renderRecorderControls();
  renderRecorderWarning();
  syncControlAvailability();
}

function renderRecorderWarning(options = {}) {
  const preserveStatus = options.preserveStatus === true;
  const captureMode = getRequestedRecorderMode();
  const available = canRecordSelectedRecorderMode();
  const selectedFormat = getSelectedRecorderFormat();

  if (!available || !selectedFormat) {
    elements.recorderWarning.hidden = false;
    elements.recorderWarning.textContent =
      captureMode === "camera"
        ? "Camera recording is not fully supported in this browser."
        : "Screen recording is not fully supported in this browser.";
    if (!isRecorderBusy() && !preserveStatus) {
      setRecorderStatus(
        captureMode === "camera"
          ? "Camera recording is not available in this browser."
          : "Screen recording is not available in this browser.",
        true,
      );
      elements.recorderOutputMeta.textContent =
        captureMode === "camera"
          ? "Try Chrome, Edge, or Firefox for the best camera recording support."
          : "Try Chrome, Edge, or Firefox for the best recording support.";
    }
    return;
  }

  const settings = getRecorderSettings();
  const qualityLabel =
    elements.recordQualitySelect.selectedOptions[0]?.textContent ||
    elements.recordQualitySelect.value;
  const surface = settings.captureSurface;
  const surfaceLabel =
    elements.recordSurfaceSelect.selectedOptions[0]?.textContent ||
    getRecorderSurfaceLabel(surface);
  const widthLabel =
    elements.recordWidthSelect.selectedOptions[0]?.textContent ||
    (elements.recordWidthSelect.value === "original"
      ? "original width"
      : `${elements.recordWidthSelect.value}px max width`);
  const notes = [
    `Capture mode: ${getRecorderModeLabel(captureMode)}.`,
    `Saving as ${selectedFormat.label}.`,
    `${widthLabel} at ${elements.recordFpsSelect.value} FPS with ${qualityLabel}.`,
    `Audio: ${getRecorderAudioLabel(settings.audioMode)}.`,
  ];

  if (captureMode === "screen") {
    notes.unshift(`Capture source: ${surfaceLabel}.`);

    if (surface === "screen") {
      notes.push(
        "Choose Entire screen in the browser prompt if you want app switching to stay in the recording.",
      );
      notes.push(
        "If only This Tab appears on macOS, enable Screen Recording for your browser in System Settings > Privacy & Security > Screen Recording and restart the browser.",
      );
    } else if (surface === "window") {
      notes.push("Only the selected app window will be recorded.");
    } else {
      notes.push("Only the selected browser tab will be recorded.");
    }
  } else {
    notes.push("The browser will ask for camera access when you start recording.");
  }

  if (selectedFormat.needsTranscode) {
    notes.push("This browser will record first, then finish the MP4 after you stop.");
  }

  if (settings.requestMicrophone) {
    notes.push("Microphone access may be requested before the recording starts.");
  }

  if (settings.optimize) {
    notes.push("Optimization is on, so the app will do extra finishing work after the recording stops.");
  }

  elements.recorderWarning.hidden = false;
  elements.recorderWarning.textContent = notes.join(" ");

  if (!isRecorderBusy() && !preserveStatus) {
    setRecorderStatus("Ready");
    elements.recorderOutputMeta.textContent =
      "Your recording stays on this device and will appear in Latest videos and the downloads area.";
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

  if (!canRecordSelectedRecorderMode() || !selectedFormat) {
    renderRecorderWarning();
    return;
  }

  const settings = getRecorderSettings();

  if (selectedFormat.needsTranscode || settings.optimize) {
    void loadFfmpeg({ quiet: true }).catch(() => {});
  }

  let captureSession = null;

  try {
    captureSession = await createRecorderCaptureSession(settings);
    const stream = captureSession.stream;

    const recorderOptions = {
      mimeType: selectedFormat.captureMimeType,
      videoBitsPerSecond: settings.videoBitsPerSecond,
      ...(captureSession.hasAudio ? { audioBitsPerSecond: settings.audioBitsPerSecond } : {}),
    };
    let mediaRecorder = new MediaRecorder(stream, recorderOptions);
    let recoveryAttempts = 0;
    const maxRecoveryAttempts = 1;
    const finalizeSession = {
      captureMode: settings.captureMode,
      desiredFormat: selectedFormat.id,
      includeAudio: captureSession.hasAudio,
      optimize: settings.optimize,
      quality: settings.quality,
      width: settings.maxWidth,
      fps: settings.fps,
      fileBaseName: captureSession.fileBaseName,
      captureSurface: captureSession.captureSurface,
      audioMode: settings.audioMode,
      startedAt: Date.now(),
    };

    clearDownloads();

    state.recording.active = true;
    state.recording.processing = false;
    state.recording.stopRequested = false;
    state.recording.stream = stream;
    state.recording.sourceStreams = captureSession.sourceStreams;
    state.recording.audioContext = captureSession.audioContext;
    state.recording.mediaRecorder = mediaRecorder;
    state.recording.chunks = [];
    state.recording.startedAt = Date.now();
    state.recording.captureMode = settings.captureMode;
    state.recording.audioMode = settings.audioMode;
    state.recording.desiredFormat = selectedFormat.id;
    state.recording.captureMimeType = selectedFormat.captureMimeType;
    state.recording.captureSurface = captureSession.captureSurface;
    state.recording.fileBaseName = captureSession.fileBaseName;
    finalizeSession.startedAt = state.recording.startedAt;

    state.currentJob = {
      id: createJobId(),
      presetKey: "screenRecorder",
      presetLabel:
        settings.captureMode === "camera"
          ? SPECIAL_PRESET_LABELS.cameraRecorder
          : SPECIAL_PRESET_LABELS.screenRecorder,
      inputNames: captureSession.inputNames,
      inputBytes: 0,
      startedAt: state.recording.startedAt,
    };

    const attachRecorderListeners = (recorder) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          state.recording.chunks.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        const liveVideoTrack = state.recording.stream?.getVideoTracks?.()[0] || null;
        const canRecover =
          state.recording.active &&
          !state.recording.stopRequested &&
          liveVideoTrack &&
          liveVideoTrack.readyState === "live" &&
          recoveryAttempts < maxRecoveryAttempts;

        if (canRecover) {
          recoveryAttempts += 1;
          try {
            const recoveredRecorder = new MediaRecorder(state.recording.stream, recorderOptions);
            mediaRecorder = recoveredRecorder;
            state.recording.mediaRecorder = recoveredRecorder;
            attachRecorderListeners(recoveredRecorder);
            recoveredRecorder.start(1000);
            setRecorderStatus("Recording continued after a browser interruption.");
            return;
          } catch {
            // Fall through to finalize when recovery is not possible.
          }
        }

        if (state.recording.active && !state.recording.stopRequested) {
          const trackState = liveVideoTrack ? liveVideoTrack.readyState : "missing";
          setRecorderStatus("Recording was interrupted by the browser. Saving captured part.");
          elements.recorderOutputMeta.textContent = `Capture stream interrupted (video track: ${trackState}).`;
        }

        if (!state.recording.stopRequested) {
          state.recording.stopRequested = true;
        }

        void finalizeRecordingOutput(finalizeSession);
      }, { once: true });

      recorder.addEventListener("error", () => {
        void failRecordingJob("The browser reported an error while capturing the screen.");
      }, { once: true });
    };

    attachRecorderListeners(mediaRecorder);

    // Some browsers/platforms can end a microphone track unexpectedly.
    // Keep recording alive until the captured video track ends.
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        if (state.recording.active && !state.recording.stopRequested) {
          void stopScreenRecording();
        }
      }, { once: true });
    }

    mediaRecorder.start(1000);
    startRecorderTimer();
    setRecorderStatus(
      `Recording ${selectedFormat.label} - ${captureSession.captureLabel}`,
    );
    elements.recorderOutputMeta.textContent = [
      captureSession.liveMessage,
      captureSession.audioNote,
    ]
      .filter(Boolean)
      .join(" ");
    syncControlAvailability();
  } catch (error) {
    if (captureSession) {
      const seenTracks = new Set();
      const sessionStreams = [captureSession.stream, ...(captureSession.sourceStreams || [])].filter(Boolean);

      for (const stream of sessionStreams) {
        for (const track of stream.getTracks()) {
          if (seenTracks.has(track)) {
            continue;
          }

          seenTracks.add(track);
          track.stop();
        }
      }

      if (captureSession.audioContext) {
        void captureSession.audioContext.close().catch(() => {});
      }
    }

    if (error instanceof DOMException && error.name === "NotAllowedError" && settings.captureMode === "screen") {
      setRecorderStatus("Screen selection was cancelled.", true);
      elements.recorderOutputMeta.textContent =
        "Choose a screen, window, or tab when you are ready to capture. Pick Entire screen if you want app switching to stay visible. On macOS, allow Screen Recording for your browser in System Settings > Privacy & Security > Screen Recording.";
      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : settings.captureMode === "camera"
          ? "Could not start camera capture."
          : "Could not start screen capture.";
    setRecorderStatus(message, true);
    elements.recorderOutputMeta.textContent =
      settings.captureMode === "camera"
        ? "Camera recording could not be started in this browser session."
        : "Screen recording could not be started in this browser session.";
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
      note = "Recording captured and converted to MP4.";
    } else if (session.optimize) {
      try {
        setRecorderStatus("Optimizing recording...");
        outputs = await optimizeRecordedBlob(recordedBlob, session);
        note = `Recording optimized and exported as ${session.desiredFormat.toUpperCase()}.`;
      } catch {
        outputs = await saveRecordedBlobOutput(recordedBlob, session);
        note =
          `Recording exported as ${session.desiredFormat.toUpperCase()} without optimization.`;
      }
    } else {
      outputs = await saveRecordedBlobOutput(recordedBlob, session);
      note = `Recording exported as ${session.desiredFormat.toUpperCase()}.`;
    }

    if (!elements.recorderPreview.hidden) {
      elements.recorderPreview.currentTime = 0;
    }

    const outputName = outputs[0]?.name || `${session.fileBaseName}.${session.desiredFormat}`;
    const outputBlob = outputs[0]?.blob || null;
    const savedToLibrary =
      outputBlob instanceof Blob
        ? await saveRecordingToLibrary(outputBlob, session, outputName)
        : false;

    setRecorderStatus("Recording ready to download");
    elements.recorderOutputMeta.textContent =
      `${outputName} - ${formatBytes(outputs[0].size)}${savedToLibrary ? " - saved in Latest videos" : ""}`;
    if (!savedToLibrary && canUseRecordingLibrary()) {
      note = `${note} Browser storage could not keep a copy in Latest videos.`;
    }
    finalizeJob("success", outputs, note);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Recording could not be exported.";
    await failRecordingJob(message);
  } finally {
    state.recording.processing = false;
    state.recording.stopRequested = false;
    state.recording.mediaRecorder = null;
    state.recording.stream = null;
    state.recording.sourceStreams = [];
    state.recording.audioContext = null;
    state.recording.chunks = [];
    state.recording.startedAt = 0;
    state.recording.captureMode = "";
    state.recording.audioMode = "";
    state.recording.captureMimeType = "";
    state.recording.desiredFormat = "";
    state.recording.captureSurface = "";
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
  state.recording.sourceStreams = [];
  state.recording.audioContext = null;
  state.recording.chunks = [];
  state.recording.startedAt = 0;
  state.recording.captureMode = "";
  state.recording.audioMode = "";
  state.recording.captureMimeType = "";
  state.recording.desiredFormat = "";
  state.recording.captureSurface = "";
  state.recording.fileBaseName = "";
  setRecorderStatus(message, true);
  elements.recorderOutputMeta.textContent =
    "The recording did not finish successfully. Adjust the settings and try again.";
  renderRecorderTimer();
  finalizeJob("failed", [], message);
  syncControlAvailability();
}

function stopRecorderTracks() {
  const streams = [state.recording.stream, ...(state.recording.sourceStreams || [])].filter(Boolean);
  const seenTracks = new Set();

  for (const stream of streams) {
    for (const track of stream.getTracks()) {
      if (seenTracks.has(track)) {
        continue;
      }

      seenTracks.add(track);
      track.stop();
    }
  }

  if (state.recording.audioContext) {
    void state.recording.audioContext.close().catch(() => {});
  }

  state.recording.sourceStreams = [];
  state.recording.audioContext = null;
}

async function runConversion() {
  const preset = presets[state.presetKey];

  if (state.busy) {
    return;
  }

  if (isRecorderBusy()) {
    setStatus("Finish the current recording before starting a conversion.", true);
    setCoachMessage("Recorder is busy now. Stop recording first, then convert.");
    return;
  }

  if (isWorkspaceLocked()) {
    setStatus("Unlock the workspace before starting a new conversion.", true);
    setCoachMessage("Unlock first, then continue with Step 1.");
    return;
  }

  if (state.files.length < preset.minimumFiles) {
    setStatus(getPresetRequirementText(preset), true);
    setCoachMessage(getPresetRequirementText(preset));
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
  setCoachMessage("Working on your file now. Please wait a moment.");
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
      setCoachMessage("Conversion stopped. You can tap the blue button again anytime.");
      setProgress(0);
      finalizeJob("cancelled", [], "The conversion was cancelled before completion.");
    } else {
      const message =
        error instanceof Error ? error.message : "Conversion failed unexpectedly.";
      setStatus(message, true);
      setCoachMessage("Something went wrong. Try a smaller file or keep recommended settings.");
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
  if (!canUseRecorder()) {
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

  // On browsers that can record WebM, MP4 is more reliable when we transcode
  // after capture instead of relying on native MediaRecorder MP4 blobs.
  if (webmMime) {
    formats.push({
      id: "mp4",
      label: "MP4",
      captureMimeType: webmMime,
      needsTranscode: true,
    });
  } else if (mp4Mime) {
    formats.push({
      id: "mp4",
      label: "MP4",
      captureMimeType: mp4Mime,
      needsTranscode: false,
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
  const captureMode = getRequestedRecorderMode();
  const audioMode = getRequestedRecorderAudioMode();

  return {
    captureMode,
    captureSurface: captureMode === "screen" ? getRequestedRecorderSurface() : "camera",
    audioMode,
    optimize: getRequestedRecorderOptimize(),
    quality: elements.recordQualitySelect.value,
    maxWidth: elements.recordWidthSelect.value,
    fps: elements.recordFpsSelect.value,
    includeAudio: audioMode !== "none",
    requestMicrophone: audioMode === "microphone",
    requestSystemAudio: false,
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

function getRequestedRecorderSurface() {
  return elements.recordSurfaceSelect.value || "screen";
}

function getRecorderSurfaceLabel(surface) {
  switch (surface) {
    case "window":
      return "App window";
    case "browser":
      return "Browser tab";
    case "screen":
    default:
      return "Entire screen";
  }
}

function getCapturedRecorderSurface(track, requestedSurface) {
  const capturedSurface = track.getSettings?.().displaySurface;

  switch (capturedSurface) {
    case "monitor":
      return "screen";
    case "window":
      return "window";
    case "browser":
      return "browser";
    default:
      return requestedSurface || "screen";
  }
}

function getActiveRecorderSurfaceMessage(requestedSurface, actualSurface) {
  if (actualSurface === "screen") {
    return "Whole screen recording is live. Changing apps or windows will stay in the capture.";
  }

  if (requestedSurface === "screen") {
    return `The browser started recording a ${getRecorderSurfaceLabel(actualSurface).toLowerCase()} instead of the whole screen. If you want app switching captured, choose Entire screen in the share prompt.`;
  }

  if (actualSurface === "window") {
    return "Only the selected app window is being recorded.";
  }

  return "Only the selected browser tab is being recorded.";
}

function buildDisplayMediaOptions(settings, mode = "advanced") {
  // Compatibility-first request so Chrome/Safari on macOS shows the
  // standard chooser (Entire Screen / Window / Tab) when available.
  if (mode === "compat") {
    return {
      video: true,
      audio: settings.requestSystemAudio,
    };
  }

  const options = {
    // Avoid strict constraints here. Some browser/macOS combinations can
    // end display capture immediately when width/fps constraints are applied.
    video: true,
    audio: settings.requestSystemAudio,
  };

  if (mode !== "advanced") {
    return options;
  }

  // Avoid forceful source hints because they can trigger tab-only dialogs
  // in some Chrome/macOS paths. Keep only audio-related hints here.
  if (settings.captureSurface === "window") {
    options.windowAudio = settings.requestSystemAudio ? "window" : "exclude";
  }

  if (settings.requestSystemAudio) {
    options.systemAudio = "include";
  }

  return options;
}

function getDisplayMediaOptionSets(settings) {
  const sets = [buildDisplayMediaOptions(settings, "compat")];
  sets.push(buildDisplayMediaOptions(settings, "basic"));

  // Use advanced as a final fallback only for browser-tab preference.
  if (settings.captureSurface === "browser") {
    sets.push(buildDisplayMediaOptions(settings, "advanced"));
  }

  return sets;
}

async function requestDisplayStream(settings) {
  let lastError = null;

  for (const displayOptions of getDisplayMediaOptionSets(settings)) {
    try {
      return await navigator.mediaDevices.getDisplayMedia(displayOptions);
    } catch (error) {
      lastError = error;

      if (!shouldRetryDisplayCapture(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Could not start screen capture.");
}

async function requestMicrophoneStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new Error("Microphone access was blocked or cancelled.");
    }

    if (error instanceof DOMException && error.name === "NotFoundError") {
      throw new Error("No microphone was found on this device.");
    }

    throw error;
  }
}

async function requestCameraStream(settings) {
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

  try {
    return await navigator.mediaDevices.getUserMedia({
      video,
      audio: settings.requestMicrophone
        ? {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : false,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new Error("Camera access was blocked or cancelled.");
    }

    if (error instanceof DOMException && error.name === "NotFoundError") {
      throw new Error("No camera was found on this device.");
    }

    throw error;
  }
}

async function mixRecorderAudioStreams(streams) {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  const fallbackTracks = streams.flatMap((stream) => stream.getAudioTracks()).filter(Boolean);

  if (!AudioContextConstructor) {
    return {
      tracks: fallbackTracks.slice(0, 1),
      audioContext: null,
      note:
        fallbackTracks.length > 1
          ? "This browser could not mix system and microphone audio together, so only one audio track was kept."
          : "",
    };
  }

  const audioContext = new AudioContextConstructor();
  const destination = audioContext.createMediaStreamDestination();

  try {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  } catch {
    // Some browsers block resume until the graph is used. Recording can still continue.
  }

  for (const stream of streams) {
    const audioTracks = stream.getAudioTracks();

    if (audioTracks.length === 0) {
      continue;
    }

    const sourceStream = new MediaStream(audioTracks);
    const source = audioContext.createMediaStreamSource(sourceStream);
    const gain = audioContext.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(destination);
  }

  const mixedTracks = destination.stream.getAudioTracks();

  return {
    tracks: mixedTracks.length > 0 ? mixedTracks : fallbackTracks.slice(0, 1),
    audioContext,
    note:
      mixedTracks.length === 0 && fallbackTracks.length > 1
        ? "The browser could not mix system and microphone audio together, so only one audio track was kept."
        : "",
  };
}

async function createScreenCaptureSession(settings) {
  const displayStream = await requestDisplayStream(settings);
  const sourceStreams = [displayStream];
  let audioContext = null;

  try {
    const videoTrack = displayStream.getVideoTracks()[0];

    if (!videoTrack) {
      throw new Error("The browser did not provide a screen video track.");
    }

    const actualSurface = getCapturedRecorderSurface(videoTrack, settings.captureSurface);
    let audioTracks = [];
    let audioNote = "";

    if (settings.audioMode === "system") {
      audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        audioNote = "System audio was not shared in the browser picker, so this recording will be video only.";
      }
    } else if (settings.audioMode === "microphone") {
      const microphoneStream = await requestMicrophoneStream();
      sourceStreams.push(microphoneStream);
      const mixedAudio = await mixRecorderAudioStreams([microphoneStream]);
      audioTracks = mixedAudio.tracks;
      audioContext = mixedAudio.audioContext;
      audioNote = mixedAudio.note;
    } else if (settings.audioMode === "system-microphone") {
      const microphoneStream = await requestMicrophoneStream();
      sourceStreams.push(microphoneStream);

      const systemTracks = displayStream.getAudioTracks();
      const microphoneTracks = microphoneStream.getAudioTracks();

      if (systemTracks.length > 0 && microphoneTracks.length > 0) {
        const mixedAudio = await mixRecorderAudioStreams([displayStream, microphoneStream]);
        audioTracks = mixedAudio.tracks;
        audioContext = mixedAudio.audioContext;
        audioNote = mixedAudio.note;
      } else if (microphoneTracks.length > 0) {
        const mixedMicrophone = await mixRecorderAudioStreams([microphoneStream]);
        audioTracks = mixedMicrophone.tracks;
        audioContext = mixedMicrophone.audioContext;
        audioNote = "System audio was not shared in the browser picker, so the recording is using microphone audio only.";
        if (mixedMicrophone.note) {
          audioNote = `${audioNote} ${mixedMicrophone.note}`;
        }
      } else if (systemTracks.length > 0) {
        audioTracks = systemTracks;
        audioNote = "Microphone audio was not available, so the recording is using system audio only.";
      }
    }

    const recorderStream = new MediaStream([videoTrack, ...audioTracks]);

    return {
      stream: recorderStream,
      sourceStreams,
      audioContext,
      captureSurface: actualSurface,
      captureLabel: getRecorderSurfaceLabel(actualSurface),
      liveMessage: getActiveRecorderSurfaceMessage(settings.captureSurface, actualSurface),
      audioNote,
      inputNames: [`${getRecorderSurfaceLabel(actualSurface)} capture`],
      fileBaseName: buildRecordingFileBaseName("screen"),
      hasAudio: audioTracks.length > 0,
    };
  } catch (error) {
    const seenTracks = new Set();

    for (const stream of sourceStreams) {
      for (const track of stream.getTracks()) {
        if (seenTracks.has(track)) {
          continue;
        }

        seenTracks.add(track);
        track.stop();
      }
    }

    if (audioContext) {
      void audioContext.close().catch(() => {});
    }

    throw error;
  }
}

async function createCameraCaptureSession(settings) {
  const cameraStream = await requestCameraStream(settings);
  const videoTrack = cameraStream.getVideoTracks()[0];

  if (!videoTrack) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }

    throw new Error("The browser did not provide a camera video track.");
  }

  await applyPreferredTrackConstraints(videoTrack, settings);
  let audioTracks = cameraStream.getAudioTracks();
  let audioContext = null;
  let audioNote = "";

  if (settings.audioMode === "microphone" && audioTracks.length > 0) {
    const mixedAudio = await mixRecorderAudioStreams([cameraStream]);
    audioTracks = mixedAudio.tracks;
    audioContext = mixedAudio.audioContext;
    audioNote = mixedAudio.note;
  }

  const recorderStream = new MediaStream([videoTrack, ...audioTracks]);
  const liveMessage =
    settings.audioMode === "microphone"
      ? "Camera recording is live with microphone audio."
      : "Camera recording is live.";

  return {
    stream: recorderStream,
    sourceStreams: [cameraStream],
    audioContext,
    captureSurface: "camera",
    captureLabel: "Camera",
    liveMessage,
    audioNote,
    inputNames: ["Camera capture"],
    fileBaseName: buildRecordingFileBaseName("camera"),
    hasAudio: audioTracks.length > 0,
  };
}

async function createRecorderCaptureSession(settings) {
  if (settings.captureMode === "camera") {
    return createCameraCaptureSession(settings);
  }

  return createScreenCaptureSession(settings);
}

function shouldRetryDisplayCapture(error) {
  if (error instanceof TypeError) {
    return true;
  }

  return Boolean(
    error instanceof DOMException &&
      (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError"),
  );
}

async function applyPreferredTrackConstraints(track, settings) {
  if (typeof track.applyConstraints !== "function") {
    return;
  }

  const constraints = {};
  const frameRate = Number(settings.fps);
  if (Number.isFinite(frameRate) && frameRate > 0) {
    constraints.frameRate = {
      ideal: frameRate,
      max: frameRate,
    };
  }

  if (settings.maxWidth !== "original") {
    const width = Number(settings.maxWidth);
    if (Number.isFinite(width) && width > 0) {
      constraints.width = {
        ideal: width,
        max: width,
      };
    }
  }

  if (Object.keys(constraints).length === 0) {
    return;
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

function isRecorderBusy() {
  return state.recording.active || state.recording.processing;
}

function buildRecordingFileBaseName(kind = "screen") {
  const type = kind === "camera" ? "camera" : "screen";
  const nextNumber = getNextRecordingNumber(type);
  const prefix = type === "camera" ? "camera-recorded" : "screen-recorded";
  return `${prefix}-${String(nextNumber).padStart(2, "0")}`;
}

function getNextRecordingNumber(type) {
  const key = type === "camera" ? "camera" : "screen";
  const current = Number(state.recordingNaming[key]) || 0;
  const nextValue = current + 1;
  state.recordingNaming[key] = nextValue;
  persistStored(STORAGE_KEYS.recordingNaming, state.recordingNaming);
  return nextValue;
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
        x264Crf: "32",
        mpeg4Q: "11",
        audioBitrate: "72k",
        tune: "zerolatency",
      };
    case "balanced":
    default:
      return {
        x264Preset: "ultrafast",
        x264Crf: "27",
        mpeg4Q: "8",
        audioBitrate: "96k",
        tune: "zerolatency",
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
      caption: "Recording converted to MP4.",
    });
    setRecorderPreview(mp4Blob);
    return [result];
  } finally {
    await removeFfmpegFile(ffmpeg, inputName);
    await removeFfmpegFile(ffmpeg, outputName);
  }
}

async function saveRecordedBlobOutput(recordedBlob, session) {
  const extension = session.desiredFormat === "mp4" ? "mp4" : "webm";
  const finalBlob =
    session.desiredFormat === "mp4" && recordedBlob.type !== "video/mp4"
      ? new Blob([await recordedBlob.arrayBuffer()], { type: "video/mp4" })
      : recordedBlob;
  const result = addDownload({
    name: `${session.fileBaseName}.${extension}`,
    blob: finalBlob,
    caption: `Recording exported as ${extension.toUpperCase()}.`,
  });
  setRecorderPreview(finalBlob);
  return [result];
}

async function optimizeRecordedBlob(blob, session) {
  const desiredExtension = session.desiredFormat === "mp4" ? "mp4" : "webm";
  const inputExtension = mimeTypeToExtension(blob.type) || desiredExtension;
  const inputName = `recording-input.${inputExtension}`;
  const outputName = `${session.fileBaseName}.${desiredExtension}`;
  const [ffmpeg, inputData] = await Promise.all([loadFfmpeg(), fetchFile(blob)]);

  await ffmpeg.writeFile(inputName, inputData);

  try {
    await execWithFallback(
      ffmpeg,
      inputName,
      outputName,
      buildRecordingOptimizationCommandSets(inputName, outputName, session),
    );

    const output = await ffmpeg.readFile(outputName);
    const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
    const mimeType = session.desiredFormat === "mp4" ? "video/mp4" : "video/webm";
    const optimizedBlob = new Blob([bytes], { type: mimeType });
    const result = addDownload({
      name: outputName,
      blob: optimizedBlob,
      caption: `Recording optimized and exported as ${desiredExtension.toUpperCase()}.`,
    });
    setRecorderPreview(optimizedBlob);
    return [result];
  } finally {
    await removeFfmpegFile(ffmpeg, inputName);
    await removeFfmpegFile(ffmpeg, outputName);
  }
}

function buildRecordingOptimizationCommandSets(inputName, outputName, session) {
  if (session.desiredFormat === "mp4") {
    return [
      {
        status: "Optimizing MP4 recording.",
        args: [
          "-i",
          inputName,
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          outputName,
        ],
      },
    ];
  }

  return [
    {
      status: "Optimizing WebM recording.",
      args: [
        "-i",
        inputName,
        "-c",
        "copy",
        outputName,
      ],
    },
  ];
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
    "-movflags",
    "+faststart",
    outputName,
  ];
  const withoutAudioArgs = [
    "-i",
    inputName,
    ...filters,
    ...videoArgs,
    "-an",
    "-movflags",
    "+faststart",
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
        x264Crf: "33",
        audioBitrate: "80k",
        tune: "zerolatency",
      };
    case "balanced":
    default:
      return {
        x264Preset: "ultrafast",
        x264Crf: "28",
        audioBitrate: "96k",
        tune: "zerolatency",
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
  setCoachMessage("Done! Tap Download to save your file.");

  return {
    name,
    size: blob.size,
    blob,
  };
}

function clearDownloads() {
  for (const url of state.downloadUrls) {
    URL.revokeObjectURL(url);
  }

  state.downloadUrls = [];
  elements.downloads.innerHTML = "";
  elements.downloadsEmpty.hidden = false;

  if (!state.busy && state.files.length === 0) {
    setCoachMessage(getCoachDefaultMessage());
  }
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

function renderRecordingLibrary() {
  elements.recordingList.innerHTML = "";

  if (isWorkspaceLocked()) {
    elements.recordingLibraryHint.textContent =
      "Unlock private mode to see the videos saved in this browser.";
    appendRecordingLibraryEmpty("Unlock to see saved recordings on this device.");
    return;
  }

  if (!canUseRecordingLibrary()) {
    elements.recordingLibraryHint.textContent =
      "This browser session can still record and download videos, but Latest videos needs IndexedDB support.";
    appendRecordingLibraryEmpty("Saved videos are unavailable in this browser session.");
    return;
  }

  if (!state.recordingLibraryReady) {
    elements.recordingLibraryHint.textContent =
      "Checking this browser for saved recordings...";
    appendRecordingLibraryEmpty("Checking saved recordings...");
    return;
  }

  if (state.recordings.length === 0) {
    elements.recordingLibraryHint.textContent =
      "Each finished recording stays in this browser so you can replay, download, or remove it later.";
    appendRecordingLibraryEmpty("No saved recordings yet.");
    return;
  }

  elements.recordingLibraryHint.textContent = state.recordingLibraryLoading
    ? "Opening the selected video from this device..."
    : "Pick any saved video to open it in the player on the right.";

  for (const entry of state.recordings) {
    const item = document.createElement("li");
    item.className = "recording-item";

    const button = document.createElement("button");
    button.className = "recording-select";
    button.type = "button";
    button.dataset.recordingId = entry.id;
    button.disabled = state.recordingLibraryLoading;
    button.classList.toggle("is-active", entry.id === state.selectedRecordingId);
    button.setAttribute("aria-pressed", String(entry.id === state.selectedRecordingId));

    const main = document.createElement("div");
    main.className = "recording-select-main";

    const title = document.createElement("p");
    title.className = "recording-select-title";
    title.textContent = entry.name;

    const meta = document.createElement("p");
    meta.className = "recording-select-meta";
    meta.textContent = `${formatTimestamp(entry.createdAt)} - ${formatDurationMs(entry.durationMs)} - ${formatBytes(entry.size)}`;

    main.append(title, meta);

    const tags = document.createElement("div");
    tags.className = "recording-select-tags";
    for (const value of [
      getRecordingKindLabel(entry),
      entry.format.toUpperCase(),
      getRecordingAudioLabel(entry.audioMode),
      entry.optimize ? "Optimized" : "Fast save",
    ]) {
      const tag = document.createElement("span");
      tag.className = "recording-tag";
      tag.textContent = value;
      tags.append(tag);
    }

    button.append(main, tags);
    item.append(button);
    elements.recordingList.append(item);
  }
}

function appendRecordingLibraryEmpty(message) {
  const empty = document.createElement("li");
  empty.className = "history-empty";
  empty.textContent = message;
  elements.recordingList.append(empty);
}

function renderRecordingPlayer() {
  const selected = getSelectedRecordingMeta();
  elements.downloadRecordingButton.textContent = selected
    ? `Download ${selected.name}`
    : "Download selected video";
  elements.deleteRecordingButton.textContent = selected
    ? "Remove selected video"
    : "Remove from latest videos";

  if (isWorkspaceLocked()) {
    clearRecorderPreview();
    elements.recordingPlayerTitle.textContent = "Unlock to open saved videos.";
    elements.recordingPlayerMeta.textContent =
      "Latest videos stay private while your workspace lock is on.";
    return;
  }

  if (!canUseRecordingLibrary()) {
    if (!state.recording.active && !state.recording.processing && elements.recorderPreview.hidden) {
      clearRecorderPreview();
    }
    elements.recordingPlayerTitle.textContent = elements.recorderPreview.hidden
      ? "Saved video player is unavailable here."
      : "Latest recording preview";
    elements.recordingPlayerMeta.textContent = elements.recorderPreview.hidden
      ? "You can still download each recording right after it finishes."
      : "This preview is ready to download, but Latest videos is not available in this browser.";
    return;
  }

  if (state.recordingLibraryLoading && selected) {
    elements.recordingPlayerTitle.textContent = `Opening ${selected.name}...`;
    elements.recordingPlayerMeta.textContent =
      "Loading the saved video from this browser.";
    return;
  }

  if (!selected) {
    if (!state.recording.active && !state.recording.processing && elements.recorderPreview.hidden) {
      clearRecorderPreview();
    }
    elements.recordingPlayerTitle.textContent = elements.recorderPreview.hidden
      ? "No saved recording selected yet."
      : "Latest recording preview";
    elements.recordingPlayerMeta.textContent = elements.recorderPreview.hidden
      ? "Finish a recording to preview it here and keep it in Latest videos on this device."
      : "This preview is ready to download. Pick a saved video or record again to refresh Latest videos.";
    return;
  }

  elements.recordingPlayerTitle.textContent = selected.name;
  elements.recordingPlayerMeta.textContent = [
    getRecordingKindLabel(selected),
    selected.captureMode === "screen" ? getRecorderSurfaceLabel(selected.captureSurface) : "Camera view",
    getRecordingAudioLabel(selected.audioMode),
    `${selected.format.toUpperCase()} export`,
    formatDurationMs(selected.durationMs),
    formatBytes(selected.size),
  ].join(" - ");
}

function getSelectedRecordingMeta() {
  return state.recordings.find((entry) => entry.id === state.selectedRecordingId) || null;
}

async function restoreRecordingLibrary() {
  state.recordingLibraryReady = canUseRecordingLibrary();
  renderRecordingLibrary();
  renderRecordingPlayer();
  syncControlAvailability();

  if (!state.recordingLibraryReady || isWorkspaceLocked() || state.recordings.length === 0) {
    return;
  }

  await selectRecordingFromLibrary(state.recordings[0].id, { silent: true });
}

async function selectRecordingFromLibrary(recordingId, options = {}) {
  if (!recordingId || isWorkspaceLocked() || !canUseRecordingLibrary()) {
    return;
  }

  const entry = state.recordings.find((item) => item.id === recordingId);
  if (!entry) {
    return;
  }

  state.selectedRecordingId = recordingId;
  state.recordingLibraryLoading = true;
  renderRecordingLibrary();
  renderRecordingPlayer();
  syncControlAvailability();

  try {
    const blob = options.blob || await getRecordingBlob(recordingId);

    if (!(blob instanceof Blob)) {
      await removeMissingRecording(recordingId);
      if (!options.silent) {
        setStatus("That saved recording is no longer available in browser storage.", true);
      }
      return;
    }

    setRecorderPreview(blob);
    renderRecordingPlayer();
  } catch (error) {
    if (!options.silent) {
      setStatus(
        error instanceof Error ? error.message : "Could not open the saved recording.",
        true,
      );
    }
  } finally {
    state.recordingLibraryLoading = false;
    renderRecordingLibrary();
    renderRecordingPlayer();
    syncControlAvailability();
  }
}

async function saveRecordingToLibrary(blob, session, outputName) {
  if (!canUseRecordingLibrary()) {
    return false;
  }

  const entry = {
    id: createJobId(),
    name: outputName,
    createdAt: Date.now(),
    size: blob.size,
    durationMs: Math.max(0, Date.now() - session.startedAt),
    captureMode: session.captureMode,
    captureSurface: session.captureSurface,
    audioMode: session.audioMode,
    format: session.desiredFormat,
    optimize: Boolean(session.optimize),
  };

  try {
    await putRecordingBlob(entry.id, blob);
    state.recordings = [entry, ...state.recordings.filter((item) => item.id !== entry.id)];

    const overflow = state.recordings.slice(RECORDING_LIBRARY_LIMIT);
    state.recordings = state.recordings.slice(0, RECORDING_LIBRARY_LIMIT);
    persistStored(STORAGE_KEYS.recordings, state.recordings);
    state.recordingLibraryReady = true;
    state.selectedRecordingId = entry.id;
    renderRecordingLibrary();
    renderRecordingPlayer();
    syncControlAvailability();

    await Promise.all(
      overflow.map((item) => deleteRecordingBlob(item.id).catch(() => {})),
    );
    await selectRecordingFromLibrary(entry.id, { blob, silent: true });
    return true;
  } catch {
    await deleteRecordingBlob(entry.id).catch(() => {});
    renderRecordingLibrary();
    renderRecordingPlayer();
    syncControlAvailability();
    return false;
  }
}

async function downloadSelectedRecording() {
  const selected = getSelectedRecordingMeta();

  if (!selected || isWorkspaceLocked() || !canUseRecordingLibrary()) {
    return;
  }

  state.recordingLibraryLoading = true;
  renderRecordingLibrary();
  renderRecordingPlayer();
  syncControlAvailability();

  try {
    const blob = await getRecordingBlob(selected.id);

    if (!(blob instanceof Blob)) {
      await removeMissingRecording(selected.id);
      setStatus("That saved recording is no longer available in browser storage.", true);
      return;
    }

    triggerBlobDownload(selected.name, blob);
    setStatus(`${selected.name} is downloading.`);
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Could not download the saved recording.",
      true,
    );
  } finally {
    state.recordingLibraryLoading = false;
    renderRecordingLibrary();
    renderRecordingPlayer();
    syncControlAvailability();
  }
}

async function deleteSelectedRecording() {
  const selected = getSelectedRecordingMeta();

  if (!selected || isWorkspaceLocked() || !canUseRecordingLibrary()) {
    return;
  }

  state.recordingLibraryLoading = true;
  renderRecordingLibrary();
  renderRecordingPlayer();
  syncControlAvailability();

  try {
    await deleteRecordingBlob(selected.id);
    state.recordings = state.recordings.filter((entry) => entry.id !== selected.id);
    persistStored(STORAGE_KEYS.recordings, state.recordings);

    const nextId = state.recordings[0]?.id || "";
    state.selectedRecordingId = nextId;

    if (!nextId) {
      clearRecorderPreview();
    }

    setStatus("Saved recording removed from Latest videos.");

    if (nextId) {
      await selectRecordingFromLibrary(nextId, { silent: true });
      return;
    }
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Could not remove the saved recording.",
      true,
    );
  } finally {
    state.recordingLibraryLoading = false;
    renderRecordingLibrary();
    renderRecordingPlayer();
    syncControlAvailability();
  }
}

async function clearSavedRecordings() {
  if (isWorkspaceLocked() || !canUseRecordingLibrary() || state.recordings.length === 0) {
    return;
  }

  state.recordingLibraryLoading = true;
  renderRecordingLibrary();
  renderRecordingPlayer();
  syncControlAvailability();

  try {
    await clearRecordingBlobs();
    state.recordings = [];
    state.selectedRecordingId = "";
    persistStored(STORAGE_KEYS.recordings, state.recordings);
    clearRecorderPreview();
    setStatus("Saved recorder videos cleared from this browser.");
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Could not clear saved recordings.",
      true,
    );
  } finally {
    state.recordingLibraryLoading = false;
    renderRecordingLibrary();
    renderRecordingPlayer();
    syncControlAvailability();
  }
}

async function removeMissingRecording(recordingId) {
  state.recordings = state.recordings.filter((entry) => entry.id !== recordingId);
  persistStored(STORAGE_KEYS.recordings, state.recordings);
  state.selectedRecordingId = state.recordings[0]?.id || "";
  clearRecorderPreview();
  renderRecordingLibrary();
  renderRecordingPlayer();

  if (state.selectedRecordingId) {
    await selectRecordingFromLibrary(state.selectedRecordingId, { silent: true });
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
  renderRecordingLibrary();
  renderRecordingPlayer();
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
  renderRecordingLibrary();
  renderRecordingPlayer();
  syncControlAvailability();
  setStatus("Workspace unlocked.");

  if (state.recordings.length > 0) {
    void selectRecordingFromLibrary(state.selectedRecordingId || state.recordings[0].id, {
      silent: true,
    });
  }
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
  renderRecordingLibrary();
  renderRecordingPlayer();
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
  renderRecordingLibrary();
  renderRecordingPlayer();
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
  const recorderUnavailable = !canRecordSelectedRecorderMode() || state.recorderFormats.length === 0;

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

  const diffControls = [
    elements.diffIgnoreWhitespaceCheckbox,
    elements.diffIgnoreCaseCheckbox,
    elements.diffSwapButton,
    elements.diffClearBothButton,
    elements.diffLeftInput,
    elements.diffRightInput,
    elements.diffLeftUploadButton,
    elements.diffRightUploadButton,
    elements.diffLeftClearButton,
    elements.diffRightClearButton,
    elements.runDiffButton,
    elements.diffMergeLeftToRightAllButton,
    elements.diffMergeRightToLeftAllButton,
    elements.diffCopyLeftButton,
    elements.diffCopyRightButton,
    elements.diffDownloadLeftButton,
    elements.diffDownloadRightButton,
  ].filter(Boolean);

  for (const control of diffControls) {
    control.disabled = locked;
  }

  elements.cancelButton.hidden = !(state.busy && preset.usesFfmpeg);
  elements.cancelButton.disabled = !state.busy || !preset.usesFfmpeg;
  elements.recordFormatSelect.disabled =
    locked || state.busy || state.recording.active || state.recording.processing || recorderUnavailable;
  elements.recordSurfaceSelect.disabled =
    getRequestedRecorderMode() !== "screen" ||
    locked ||
    state.busy ||
    state.recording.active ||
    state.recording.processing ||
    recorderUnavailable;
  elements.recordQualitySelect.disabled =
    locked || state.busy || state.recording.active || state.recording.processing || recorderUnavailable;
  elements.recordWidthSelect.disabled =
    locked || state.busy || state.recording.active || state.recording.processing || recorderUnavailable;
  elements.recordFpsSelect.disabled =
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
  elements.clearRecordingsButton.disabled =
    state.busy ||
    recorderBusy ||
    state.recordingLibraryLoading ||
    isWorkspaceLocked() ||
    !canUseRecordingLibrary() ||
    state.recordings.length === 0;
  elements.downloadRecordingButton.disabled =
    state.busy ||
    recorderBusy ||
    state.recordingLibraryLoading ||
    isWorkspaceLocked() ||
    !getSelectedRecordingMeta();
  elements.deleteRecordingButton.disabled =
    state.busy ||
    recorderBusy ||
    state.recordingLibraryLoading ||
    isWorkspaceLocked() ||
    !getSelectedRecordingMeta();
  renderRecorderControls();
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

function normalizeRecordingNaming(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalizeCounter = (counter) =>
    Math.max(0, Math.floor(Number(counter) || 0));

  return {
    screen: normalizeCounter(source.screen),
    camera: normalizeCounter(source.camera),
  };
}

function syncRecordingNamingCounters() {
  const findMaxCounter = (prefix) => {
    const regex = new RegExp(`^${prefix}-(\\d+)\\.(mp4|webm)$`, "i");
    return state.recordings.reduce((max, entry) => {
      const match = String(entry.name || "").match(regex);
      const counter = match ? Number(match[1]) : 0;
      return Number.isFinite(counter) ? Math.max(max, counter) : max;
    }, 0);
  };

  const maxScreen = findMaxCounter("screen-recorded");
  const maxCamera = findMaxCounter("camera-recorded");
  const nextState = {
    screen: Math.max(state.recordingNaming.screen, maxScreen),
    camera: Math.max(state.recordingNaming.camera, maxCamera),
  };

  if (
    nextState.screen !== state.recordingNaming.screen ||
    nextState.camera !== state.recordingNaming.camera
  ) {
    state.recordingNaming = nextState;
    persistStored(STORAGE_KEYS.recordingNaming, state.recordingNaming);
  }
}

function canUseRecordingLibrary() {
  return typeof window.indexedDB !== "undefined";
}

function normalizeStoredRecordings(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const filtered = entries
    .filter((entry) => entry && typeof entry === "object" && entry.id && entry.name)
    .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0))
    .slice(0, RECORDING_LIBRARY_LIMIT);

  return filtered.map((entry, index) => {
    const captureMode = entry.captureMode === "camera" ? "camera" : "screen";
    const format = entry.format === "webm" ? "webm" : "mp4";

    return {
      id: String(entry.id),
      name: normalizeRecordingFileName(String(entry.name), captureMode, format, index + 1),
      createdAt: Number(entry.createdAt) || Date.now(),
      size: Number(entry.size) || 0,
      durationMs: Number(entry.durationMs) || 0,
      captureMode,
      captureSurface:
        entry.captureSurface === "window" || entry.captureSurface === "browser"
          ? entry.captureSurface
          : "screen",
      audioMode: normalizeRecorderAudioMode(entry.audioMode, captureMode),
      format,
      optimize: Boolean(entry.optimize),
    };
  });
}

function normalizeRecordingFileName(name, captureMode, format, fallbackNumber = 1) {
  const extension = format === "webm" ? "webm" : "mp4";
  const basePrefix = captureMode === "camera" ? "camera-recorded" : "screen-recorded";
  const fallbackBase = `${basePrefix}-${String(Math.max(1, fallbackNumber)).padStart(2, "0")}`;
  const trimmed = String(name || "").trim();

  if (!trimmed) {
    return `${fallbackBase}.${extension}`;
  }

  const uuidLikeName = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.[a-z0-9]+)?$/i;
  const blobLikeName =
    trimmed.toLowerCase().startsWith("blob") ||
    trimmed.toLowerCase().startsWith("recording-input");

  if (uuidLikeName.test(trimmed) || blobLikeName) {
    return `${fallbackBase}.${extension}`;
  }

  if (!/\.[a-z0-9]+$/i.test(trimmed)) {
    return `${trimmed}.${extension}`;
  }

  return trimmed;
}

function openRecordingLibrary() {
  if (!canUseRecordingLibrary()) {
    return Promise.reject(
      new Error("Saved videos are unavailable because IndexedDB is not supported here."),
    );
  }

  if (!recordingLibraryDbPromise) {
    recordingLibraryDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(RECORDING_LIBRARY_DB_NAME, 1);

      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RECORDING_LIBRARY_STORE)) {
          db.createObjectStore(RECORDING_LIBRARY_STORE, { keyPath: "id" });
        }
      });

      request.addEventListener("success", () => {
        const db = request.result;
        db.addEventListener("versionchange", () => {
          db.close();
        });
        resolve(db);
      });

      request.addEventListener("error", () => {
        reject(request.error || new Error("Could not open the saved recordings database."));
      });
    });
  }

  return recordingLibraryDbPromise;
}

async function putRecordingBlob(id, blob) {
  const db = await openRecordingLibrary();

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDING_LIBRARY_STORE, "readwrite");
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("error", () => {
      reject(transaction.error || new Error("Could not save the recording in this browser."));
    }, { once: true });
    transaction.objectStore(RECORDING_LIBRARY_STORE).put({ id, blob });
  });
}

async function getRecordingBlob(id) {
  const db = await openRecordingLibrary();

  return await new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDING_LIBRARY_STORE, "readonly");
    const request = transaction.objectStore(RECORDING_LIBRARY_STORE).get(id);

    request.addEventListener("success", () => {
      resolve(request.result?.blob || null);
    }, { once: true });
    request.addEventListener("error", () => {
      reject(request.error || new Error("Could not load the saved recording."));
    }, { once: true });
  });
}

async function deleteRecordingBlob(id) {
  if (!canUseRecordingLibrary()) {
    return;
  }

  const db = await openRecordingLibrary();

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDING_LIBRARY_STORE, "readwrite");
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("error", () => {
      reject(transaction.error || new Error("Could not remove the saved recording."));
    }, { once: true });
    transaction.objectStore(RECORDING_LIBRARY_STORE).delete(id);
  });
}

async function clearRecordingBlobs() {
  if (!canUseRecordingLibrary()) {
    return;
  }

  const db = await openRecordingLibrary();

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDING_LIBRARY_STORE, "readwrite");
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("error", () => {
      reject(transaction.error || new Error("Could not clear saved recordings."));
    }, { once: true });
    transaction.objectStore(RECORDING_LIBRARY_STORE).clear();
  });
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

function getRecordingKindLabel(entry) {
  return entry.captureMode === "camera" ? "Camera" : "Screen";
}

function getRecordingAudioLabel(audioMode) {
  switch (normalizeRecorderAudioMode(audioMode)) {
    case "microphone":
      return "Microphone";
    case "system":
      return "System";
    case "system-microphone":
      return "System + Mic";
    case "none":
    default:
      return "No audio";
  }
}

function triggerBlobDownload(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1200);
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
