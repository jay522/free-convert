import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { fetchFile } from "./vendor/ffmpeg-util/index.js";

const { PDFDocument } = window.PDFLib;
const JSZip = window.JSZip;

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
    label: "WebM to MP4",
    description:
      "Transcode a WebM clip to MP4 with adaptive settings for larger files.",
    accept: ".webm,video/webm",
    allowedTypes: ["video/webm"],
    allowedExtensions: ["webm"],
    multiple: false,
    actionLabel: "Convert to MP4",
    dropHint: "Single WebM clip for MP4 conversion",
    optionMode: "video",
    usesFfmpeg: true,
    optionsHint:
      "Adaptive controls help larger clips finish more reliably inside the browser.",
  },
  videoPosterPng: {
    label: "Video to Poster PNG",
    description:
      "Capture a representative frame from a video file and save it as PNG.",
    accept: "video/webm,video/mp4,video/quicktime,video/x-m4v",
    allowedTypes: ["video/webm", "video/mp4", "video/quicktime", "video/x-m4v"],
    allowedExtensions: ["webm", "mp4", "mov", "m4v"],
    multiple: false,
    actionLabel: "Extract Poster",
    dropHint: "Single MP4, MOV, or WebM file",
    optionMode: "video",
    usesFfmpeg: false,
    optionsHint:
      "Poster extraction uses the browser video decoder and honors the selected max width.",
  },
  imagesToPdf: {
    label: "Images to PDF",
    description: "Combine JPG, PNG, or WebP images into a single PDF.",
    accept: "image/jpeg,image/png,image/webp",
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    multiple: true,
    actionLabel: "Build PDF",
    dropHint: "Select one or more JPG, PNG, or WebP files",
    optionMode: "pdf",
    usesFfmpeg: false,
    optionsHint: "Images are added to the PDF in the same order you select them.",
  },
  mergePdf: {
    label: "Merge PDFs",
    description: "Combine multiple PDF files into a single merged document.",
    accept: ".pdf,application/pdf",
    allowedTypes: ["application/pdf"],
    allowedExtensions: ["pdf"],
    multiple: true,
    actionLabel: "Merge PDFs",
    dropHint: "Select two or more PDF files",
    optionMode: "pdf",
    usesFfmpeg: false,
    optionsHint: "Merged PDFs keep the same page order as the selected files.",
  },
  imageToJpg: {
    label: "PNG / WebP to JPG",
    description: "Flatten transparent pixels onto white and export JPG files.",
    accept: "image/png,image/webp",
    allowedTypes: ["image/png", "image/webp"],
    allowedExtensions: ["png", "webp"],
    multiple: true,
    actionLabel: "Convert to JPG",
    dropHint: "Select one or more PNG or WebP files",
    optionMode: "image",
    usesFfmpeg: false,
    optionsHint: "The JPG quality slider controls the export compression level.",
  },
  imageToPng: {
    label: "JPG / WebP to PNG",
    description: "Convert common image formats into PNG output.",
    accept: "image/jpeg,image/png,image/webp",
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    multiple: true,
    actionLabel: "Convert to PNG",
    dropHint: "Select one or more JPG, PNG, or WebP files",
    optionMode: "image",
    usesFfmpeg: false,
    optionsHint: "PNG exports preserve transparency when the source includes it.",
  },
  imageToWebp: {
    label: "JPG / PNG to WebP",
    description: "Create compact WebP images directly in the browser.",
    accept: "image/jpeg,image/png",
    allowedTypes: ["image/jpeg", "image/png"],
    allowedExtensions: ["jpg", "jpeg", "png"],
    multiple: true,
    actionLabel: "Convert to WebP",
    dropHint: "Select one or more JPG or PNG files",
    optionMode: "image",
    usesFfmpeg: false,
    optionsHint: "The WebP quality slider trades file size against visual fidelity.",
  },
};

const state = {
  presetKey: "webmToMp4",
  files: [],
  busy: false,
  cancelRequested: false,
  ffmpeg: null,
  ffmpegPromise: null,
  downloadUrls: [],
  videoInfo: null,
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
  fileInput: document.querySelector("#fileInput"),
  pickFilesButton: document.querySelector("#pickFilesButton"),
  clearFilesButton: document.querySelector("#clearFilesButton"),
  dropZone: document.querySelector("#dropZone"),
  dropZoneHint: document.querySelector("#dropZoneHint"),
  helperText: document.querySelector("#helperText"),
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
  elements.pickFilesButton.addEventListener("click", () => {
    elements.fileInput.click();
  });
  elements.clearFilesButton.addEventListener("click", clearSelectedFiles);
  elements.dropZone.addEventListener("click", () => {
    if (!isWorkspaceLocked()) {
      elements.fileInput.click();
    }
  });
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
  const preset = presets[presetKey];
  state.presetKey = presetKey;
  state.videoSettingsTouched = false;
  resetOptionInputs();
  clearSelectedFiles();
  elements.presetSelect.value = presetKey;
  elements.fileInput.accept = preset.accept;
  elements.fileInput.multiple = preset.multiple;
  elements.helperText.textContent = preset.description;
  elements.dropZoneHint.textContent = preset.dropHint;
  elements.convertButton.textContent = preset.actionLabel;
  elements.formatBadge.textContent = preset.label;
  elements.optionsHint.textContent = preset.optionsHint;
  elements.videoOptions.hidden = preset.optionMode !== "video";
  elements.imageOptions.hidden = preset.optionMode !== "image";
  elements.pdfOptions.hidden = preset.optionMode !== "pdf";
  renderVideoWarning();
  syncControlAvailability();
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

async function setSelectedFiles(files) {
  const preset = presets[state.presetKey];
  const normalized = preset.multiple ? files : files.slice(0, 1);
  const validFiles = normalized.filter((file) => matchesPresetFile(file, preset));
  const skippedCount = normalized.length - validFiles.length;

  state.files = validFiles;
  clearDownloads();
  updateFileList();
  state.videoInfo = null;

  if (validFiles.length === 0) {
    if (skippedCount > 0) {
      setStatus("Selected files do not match this conversion preset.", true);
      renderVideoWarning();
      syncControlAvailability();
      return;
    }

    setStatus("Select files to begin.");
    setProgress(0);
    renderVideoWarning();
    syncControlAvailability();
    return;
  }

  if (preset.optionMode === "video") {
    await inspectVideoFile(validFiles[0]);
  } else {
    renderVideoWarning();
  }

  if (skippedCount > 0) {
    setStatus(
      `${skippedCount} file${skippedCount === 1 ? "" : "s"} skipped. Ready to ${preset.actionLabel.toLowerCase()}.`,
    );
    setProgress(0);
    syncControlAvailability();
    return;
  }

  setStatus(`Ready to ${preset.actionLabel.toLowerCase()}.`);
  setProgress(0);
  syncControlAvailability();
}

function clearSelectedFiles() {
  state.files = [];
  state.videoInfo = null;
  elements.fileInput.value = "";
  updateFileList();
  clearDownloads();
  setStatus(isWorkspaceLocked() ? "Unlock the workspace to continue." : "Select files to begin.");
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

  const { width, height, duration, severity, score } = state.videoInfo;
  const recommendation =
    severity === "severe"
      ? "This looks heavy for a browser session. Compressed mode with a smaller width is recommended."
      : severity === "high"
        ? "This clip is on the heavier side. Balanced mode should work, but compressed mode is safer."
        : severity === "medium"
          ? "This job should be fine, though a compressed profile may finish faster."
          : "This clip looks lightweight enough for an in-browser run.";

  elements.videoWarning.hidden = false;
  elements.videoWarning.textContent =
    `${width}x${height} - ${formatDuration(duration)} - workload ${score}. ${recommendation}`;
}

function maybeApplyRecommendedVideoSettings() {
  if (!state.videoInfo || state.videoSettingsTouched) {
    return;
  }

  if (state.videoInfo.severity === "high") {
    elements.videoProfileSelect.value = "compressed";
    elements.videoWidthSelect.value = "1280";
    elements.videoFpsSelect.value = "24";
  } else if (state.videoInfo.severity === "severe") {
    elements.videoProfileSelect.value = "compressed";
    elements.videoWidthSelect.value = "854";
    elements.videoFpsSelect.value = "24";
    elements.stripAudioCheckbox.checked = true;
  }
}

function renderRecorderWarning(options = {}) {
  const preserveStatus = options.preserveStatus === true;
  const available = canScreenRecord();
  const selectedFormat = getSelectedRecorderFormat();

  if (!available || !selectedFormat) {
    elements.recorderWarning.hidden = false;
    elements.recorderWarning.textContent =
      "Screen recording needs both Screen Capture and MediaRecorder support in the current browser.";
    if (!isRecorderBusy() && !preserveStatus) {
      setRecorderStatus("Screen recording is not available in this browser.", true);
      elements.recorderOutputMeta.textContent =
        "Try Chromium or Firefox for the full recording workflow.";
    }
    return;
  }

  const qualityLabel = elements.recordQualitySelect.value;
  const widthLabel = elements.recordWidthSelect.value === "original"
    ? "original width"
    : `${elements.recordWidthSelect.value}px max width`;
  const notes = [
    `${selectedFormat.label} output selected.`,
    `${widthLabel} at ${elements.recordFpsSelect.value} FPS with ${qualityLabel} quality.`,
  ];

  if (selectedFormat.needsTranscode) {
    notes.push("This browser will capture WebM first and convert it to MP4 after recording stops.");
  }

  if (elements.recordAudioCheckbox.checked) {
    notes.push("Audio is requested, but the browser and chosen surface decide whether it is available.");
  }

  elements.recorderWarning.hidden = false;
  elements.recorderWarning.textContent = notes.join(" ");

  if (!isRecorderBusy() && !preserveStatus) {
    setRecorderStatus("Ready to capture");
    elements.recorderOutputMeta.textContent =
      "Your recording will stay local and appear in the downloads area when it is ready.";
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

  if (state.files.length === 0) {
    setStatus("Select at least one file first.", true);
    return;
  }

  state.busy = true;
  state.cancelRequested = false;
  state.currentJob = {
    id: createJobId(),
    presetKey: state.presetKey,
    presetLabel: presets[state.presetKey].label,
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
      case "videoPosterPng":
        outputs = await extractPosterFromVideo(state.files[0]);
        note = "Poster image extracted from the video.";
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
  const ffmpeg = await loadFfmpeg();
  const inputName = `input.${getExtension(file.name) || "webm"}`;
  const outputName = `${stripExtension(file.name)}.mp4`;

  setStatus("Loading video file into the browser worker.");
  await ffmpeg.writeFile(inputName, await fetchFile(file));
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
        "-c:v",
        "libx264",
        "-preset",
        profile.x264Preset,
        "-crf",
        profile.x264Crf,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
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
        "-movflags",
        "+faststart",
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
    filters.push(`scale='min(${maxWidth},iw)':-2`);
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
        x264Preset: "medium",
        x264Crf: "18",
        mpeg4Q: "3",
        audioBitrate: "192k",
      };
    case "compressed":
      return {
        x264Preset: "veryfast",
        x264Crf: "29",
        mpeg4Q: "10",
        audioBitrate: "96k",
      };
    case "balanced":
    default:
      return {
        x264Preset: "faster",
        x264Crf: "23",
        mpeg4Q: "6",
        audioBitrate: "160k",
      };
  }
}

async function extractPosterFromVideo(file) {
  const { video, cleanup } = await loadVideo(file);

  try {
    const captureTime = computePosterCaptureTime(video.duration);
    if (captureTime > 0) {
      await seekVideo(video, captureTime);
    }

    const maxWidthValue = elements.videoWidthSelect.value;
    const maxWidth =
      maxWidthValue === "original" ? video.videoWidth : Number(maxWidthValue);
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is not available for poster extraction.");
    }

    context.drawImage(video, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/png");
    const result = addDownload({
      name: `${stripExtension(file.name)}-poster.png`,
      blob,
      caption: `Poster captured from ${file.name}.`,
    });
    setProgress(100);
    setStatus("Poster extraction finished.");
    return [result];
  } finally {
    cleanup();
  }
}

async function transcodeRecordedBlobToMp4(blob, session) {
  const ffmpeg = await loadFfmpeg();
  const inputExtension = mimeTypeToExtension(blob.type) || "webm";
  const inputName = `recording-input.${inputExtension}`;
  const outputName = `${session.fileBaseName}.mp4`;

  await ffmpeg.writeFile(inputName, await fetchFile(blob));

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
  const withAudioArgs = [
    "-i",
    inputName,
    ...filters,
    "-c:v",
    "libx264",
    "-preset",
    profile.x264Preset,
    "-crf",
    profile.x264Crf,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
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
    "-c:v",
    "libx264",
    "-preset",
    profile.x264Preset,
    "-crf",
    profile.x264Crf,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
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
    filters.push(`scale='min(${maxWidth},iw)':-2`);
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
        x264Preset: "medium",
        x264Crf: "18",
        audioBitrate: "192k",
      };
    case "compact":
      return {
        x264Preset: "veryfast",
        x264Crf: "29",
        audioBitrate: "96k",
      };
    case "balanced":
    default:
      return {
        x264Preset: "faster",
        x264Crf: "23",
        audioBitrate: "160k",
      };
  }
}

async function convertImagesToPdf(files) {
  const pdf = await PDFDocument.create();

  for (const [index, file] of files.entries()) {
    setStatus(`Embedding image ${index + 1} of ${files.length}.`);
    setProgress(8 + Math.round((index / files.length) * 72));

    const { blob, width, height } = await getPdfReadyImage(file);
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
  const pdfBytes = await pdf.save();
  const result = addDownload({
    name: "converted-images.pdf",
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

    const source = await PDFDocument.load(await file.arrayBuffer());
    const pages = await mergedPdf.copyPages(source, source.getPageIndices());
    totalPages += pages.length;
    for (const page of pages) {
      mergedPdf.addPage(page);
    }
  }

  const pdfBytes = await mergedPdf.save();
  const result = addDownload({
    name: "merged-documents.pdf",
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    caption: `${files.length} PDFs merged into one document with ${totalPages} pages.`,
  });
  setProgress(100);
  setStatus("PDF merge finished.");
  return [result];
}

async function convertImagesToFormat(files, options) {
  const converted = [];

  for (const [index, file] of files.entries()) {
    setStatus(`Converting image ${index + 1} of ${files.length}.`);
    setProgress(8 + Math.round((index / files.length) * 72));

    const blob = await reencodeImage(file, options);
    converted.push({
      name: `${stripExtension(file.name)}.${options.extension}`,
      blob,
      source: file.name,
    });
  }

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
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    },
    (metadata) => {
      setProgress(84 + Math.round(metadata.percent / 6.25));
    },
  );

  const result = addDownload({
    name: `converted-${options.extension}-files.zip`,
    blob: zipBlob,
    caption: `${converted.length} converted files bundled into a zip archive.`,
  });
  setProgress(100);
  setStatus("Image conversion finished.");
  return [result];
}

async function loadFfmpeg() {
  if (state.ffmpegPromise) {
    return state.ffmpegPromise;
  }

  const ffmpeg = new FFmpeg();
  const coreBaseUrl = new URL("./vendor/ffmpeg-core/", window.location.href);
  state.ffmpeg = ffmpeg;

  ffmpeg.on("progress", ({ progress }) => {
    if (!Number.isFinite(progress)) {
      return;
    }

    const percent = Math.max(10, Math.min(98, Math.round(progress * 100)));
    setProgress(percent);
  });

  state.ffmpegPromise = (async () => {
    setStatus("Loading browser video engine. First run may take a moment.");
    await ffmpeg.load({
      coreURL: new URL("ffmpeg-core.js", coreBaseUrl).href,
      wasmURL: new URL("ffmpeg-core.wasm", coreBaseUrl).href,
    });
    return ffmpeg;
  })();

  return state.ffmpegPromise;
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
}

async function getPdfReadyImage(file) {
  const { image, cleanup } = await loadImage(file);

  try {
    const outputType = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
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
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale =
    options.maxSide && longestSide > options.maxSide
      ? options.maxSide / longestSide
      : 1;

  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

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

function canvasToBlob(canvas, mimeType, quality) {
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
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

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

function computePosterCaptureTime(duration) {
  if (!Number.isFinite(duration) || duration <= 0.15) {
    return 0;
  }

  return Math.min(Math.max(duration * 0.25, 0.1), duration - 0.05);
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const handleSeeked = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
      resolve();
    };
    const handleError = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
      reject(new Error("Could not seek to the requested frame."));
    };

    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.currentTime = time;
  });
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
    locked.textContent = "Unlock the workspace to view local activity history.";
    elements.historyList.append(locked);
    return;
  }

  if (state.history.length === 0) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = "No conversions have been recorded yet.";
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
      "Unlock the workspace to view the local analytics summary.";
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
    ? `Most-used preset so far: ${favorite.label} (${favorite.count} runs).`
    : "Local-only analytics stay in this browser. No external telemetry is sent.";
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

  const memory = navigator.deviceMemory ? `${navigator.deviceMemory} GB RAM hint` : "Device memory hint unavailable";
  const cores = navigator.hardwareConcurrency
    ? `${navigator.hardwareConcurrency} logical cores`
    : "CPU core hint unavailable";
  elements.deviceHint.textContent = `${memory} - ${cores}`;
}

function renderProfile() {
  elements.profileNameInput.value = state.profile.displayName;
  elements.authStatus.textContent = state.profile.pinHash
    ? isWorkspaceLocked()
      ? "A local workspace PIN is set. Unlock to use conversions and view history."
      : "Workspace is unlocked. Local history and analytics are protected by your PIN."
    : "No PIN set yet. Add one if you want to lock local history and controls.";

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
  elements.pickFilesButton.disabled = disabled;
  elements.clearFilesButton.disabled = disabled || state.files.length === 0;
  elements.fileInput.disabled = disabled;
  elements.convertButton.disabled = disabled || state.files.length === 0;

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
