
"use strict";

const fileInput = document.getElementById("fileInput");
const cameraInput = document.getElementById("cameraInput");
const scanButton = document.getElementById("scanButton");
const exportButton = document.getElementById("exportButton");
const clearButton = document.getElementById("clearButton");

const statusBox = document.getElementById("status");
const previewGrid = document.getElementById("previewGrid");
const resultsBody = document.getElementById("resultsBody");
const rawOcrBox = document.getElementById("rawOcr");

let selectedFiles = [];
let scanResults = [];
let ocrWorker = null;
let qrReader = null;
let barcodeReader = null;

const WORK_SIZE = 2600;
const OCR_MAX_PASSES = 10;

function setStatus(message) {
  statusBox.textContent = message;
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/[|]/g, "I")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\r/g, "\n");
}

function cleanDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidLuhn(number) {
  const digits = cleanDigits(number);

  if (!digits) {
    return false;
  }

  let sum = 0;
  let alternate = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);

    if (alternate) {
      digit *= 2;

      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

function normalizeOcrDigits(text) {
  return String(text || "")
    .replace(/[Oo]/g, "0")
    .replace(/[IiLl|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[Gg]/g, "6")
    .replace(/[Bb]/g, "8");
}

function extractPin(text) {
  const normalized = normalizeOcrDigits(text);

  const labelledPatterns = [
    /P\s*I\s*N\s*[:\-]?\s*([0-9]{4})/i,
    /P\s*I\s*N\s*[:\-]?\s*([0-9]{4})/i,
    /PIN[^0-9]{0,15}([0-9]{4})/i
  ];

  for (const pattern of labelledPatterns) {
    const match = normalized.match(pattern);

    if (match) {
      return match[1];
    }
  }

  const candidates = normalized.match(/\b[0-9]{4}\b/g) || [];

  for (const candidate of candidates) {
    if (!["0000", "1111", "1234", "9999"].includes(candidate)) {
      return candidate;
    }
  }

  return "";
}

function extractPuk(text) {
  const normalized = normalizeOcrDigits(text);

  const labelledPatterns = [
    /P\s*U\s*K\s*[:\-]?\s*([0-9]{8})/i,
    /PUK[^0-9]{0,15}([0-9]{8})/i
  ];

  for (const pattern of labelledPatterns) {
    const match = normalized.match(pattern);

    if (match) {
      return match[1];
    }
  }

  const candidates = normalized.match(/\b[0-9]{8}\b/g) || [];

  for (const candidate of candidates) {
    if (!/^0{8}$/.test(candidate)) {
      return candidate;
    }
  }

  return "";
}

function extractIccidFromText(text) {
  const normalized = normalizeOcrDigits(text);

  const candidates = normalized.match(/\b[0-9]{18,22}\b/g) || [];

  for (const candidate of candidates) {
    if (isValidLuhn(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || "";
}

function extractLpa(text) {
  const value = String(text || "");

  const lpaMatch = value.match(
    /LPA\s*:\s*[A-Za-z0-9+\/=_:.-]+/i
  );

  if (lpaMatch) {
    return lpaMatch[0].replace(/\s+/g, "");
  }

  const activationCodeMatch = value.match(
    /1\$[A-Za-z0-9.-]+\$[A-Za-z0-9+\/=_-]+/
  );

  if (activationCodeMatch) {
    return activationCodeMatch[0];
  }

  return "";
}

function createImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to load image: " + file.name));
    };

    image.src = objectUrl;
  });
}

function drawImageToCanvas(image, crop = null, mode = "normal") {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (crop) {
    sx = Math.floor(sourceWidth * crop.x);
    sy = Math.floor(sourceHeight * crop.y);
    sw = Math.floor(sourceWidth * crop.width);
    sh = Math.floor(sourceHeight * crop.height);
  }

  const scale = Math.min(1, WORK_SIZE / Math.max(sw, sh));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(sw * scale));
  canvas.height = Math.max(1, Math.floor(sh * scale));

  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  context.drawImage(
    image,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height
  );

  if (mode !== "normal") {
    const imageData = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];

      let gray = Math.round(
        0.299 * r + 0.587 * g + 0.114 * b
      );

      if (mode === "gray") {
        imageData.data[i] = gray;
        imageData.data[i + 1] = gray;
        imageData.data[i + 2] = gray;
      }

      if (mode === "threshold") {
        gray = gray > 145 ? 255 : 0;

        imageData.data[i] = gray;
        imageData.data[i + 1] = gray;
        imageData.data[i + 2] = gray;
      }

      if (mode === "invert") {
        gray = 255 - gray;

        imageData.data[i] = gray;
        imageData.data[i + 1] = gray;
        imageData.data[i + 2] = gray;
      }
    }

    context.putImageData(imageData, 0, 0);
  }

  return canvas;
}

function getImageVariants(image) {
  const crops = [
    null,
    { x: 0, y: 0, width: 1, height: 0.5 },
    { x: 0, y: 0.5, width: 1, height: 0.5 },
    { x: 0, y: 0, width: 0.5, height: 1 },
    { x: 0.5, y: 0, width: 0.5, height: 1 },
    { x: 0.15, y: 0.15, width: 0.7, height: 0.7 }
  ];

  const modes = [
    "normal",
    "gray",
    "threshold",
    "invert"
  ];

  const variants = [];

  for (const crop of crops) {
    for (const mode of modes) {
      if (variants.length >= OCR_MAX_PASSES) {
        return variants;
      }

      variants.push(drawImageToCanvas(image, crop, mode));
    }
  }

  return variants;
}

function scanQrWithJsQr(canvas) {
  if (typeof jsQR === "undefined") {
    return "";
  }

  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const imageData = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const result = jsQR(
    imageData.data,
    imageData.width,
    imageData.height,
    {
      inversionAttempts: "attemptBoth"
    }
  );

  return result?.data || "";
}

async function initializeReaders() {
  if (typeof ZXing === "undefined") {
    return;
  }

  if (!qrReader) {
    const qrHints = new Map();

    qrHints.set(
      ZXing.DecodeHintType.TRY_HARDER,
      true
    );

    qrHints.set(
      ZXing.DecodeHintType.POSSIBLE_FORMATS,
      [ZXing.BarcodeFormat.QR_CODE]
    );

    qrReader = new ZXing.BrowserMultiFormatReader(qrHints);
  }

  if (!barcodeReader) {
    const barcodeHints = new Map();

    barcodeHints.set(
      ZXing.DecodeHintType.TRY_HARDER,
      true
    );

    barcodeHints.set(
      ZXing.DecodeHintType.POSSIBLE_FORMATS,
      [
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.ITF,
        ZXing.BarcodeFormat.EAN_13
      ]
    );

    barcodeReader = new ZXing.BrowserMultiFormatReader(
      barcodeHints
    );
  }
}

async function scanQrWithZxing(canvas) {
  if (!qrReader) {
    return "";
  }

  try {
    const result = await qrReader.decodeFromCanvas(canvas);
    return result?.getText?.() || "";
  } catch {
    return "";
  }
}

async function scanBarcodeWithZxing(canvas) {
  if (!barcodeReader) {
    return "";
  }

  try {
    const result = await barcodeReader.decodeFromCanvas(canvas);
    return result?.getText?.() || "";
  } catch {
    return "";
  }
}

async function getOcrWorker() {
  if (ocrWorker) {
    return ocrWorker;
  }

  if (typeof Tesseract === "undefined") {
    throw new Error("Tesseract.js did not load.");
  }

  setStatus("Loading OCR engine...");

  ocrWorker = await Tesseract.createWorker("eng", 1, {
    logger: message => {
      if (
        message &&
        message.status === "recognizing text"
      ) {
        const progress = Math.round(
          (message.progress || 0) * 100
        );

        setStatus("OCR progress: " + progress + "%");
      }
    }
  });

  try {
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1"
    });
  } catch {
    // Some Tesseract versions may not support these settings.
  }

  return ocrWorker;
}

async function recognizeText(canvas) {
  const worker = await getOcrWorker();

  const result = await worker.recognize(canvas);

  return result?.data?.text || "";
}

function addPreview(file, image) {
  const card = document.createElement("div");
  card.className = "preview-card";

  const title = document.createElement("h3");
  title.textContent = file.name;

  const imageElement = document.createElement("img");
  imageElement.src = image.src || "";
  imageElement.alt = "Uploaded eSIM card image";

  card.appendChild(title);
  card.appendChild(imageElement);

  previewGrid.appendChild(card);
}

async function scanFile(file, index) {
  setStatus(
    `Processing ${index + 1} of ${selectedFiles.length}: ${file.name}`
  );

  const image = await createImageFromFile(file);

  const imageUrl = URL.createObjectURL(file);

  const previewCard = document.createElement("div");
  previewCard.className = "preview-card";

  const previewTitle = document.createElement("h3");
  previewTitle.textContent = file.name;

  const previewImage = document.createElement("img");
  previewImage.src = imageUrl;
  previewImage.alt = "eSIM card preview";

  previewCard.appendChild(previewTitle);
  previewCard.appendChild(previewImage);
  previewGrid.appendChild(previewCard);

  await initializeReaders();

  const variants = getImageVariants(image);

  let qrData = "";
  let barcodeData = "";
  let ocrText = "";

  for (const canvas of variants) {
    if (!qrData) {
      qrData = scanQrWithJsQr(canvas);
    }

    if (!qrData) {
      qrData = await scanQrWithZxing(canvas);
    }

    if (!barcodeData) {
      barcodeData = await scanBarcodeWithZxing(canvas);
    }

    if (!ocrText) {
      ocrText = await recognizeText(canvas);
    } else {
      const additionalText = await recognizeText(canvas);

      if (additionalText.length > ocrText.length) {
        ocrText = additionalText;
      }
    }

    if (qrData && barcodeData && ocrText.length > 20) {
      break;
    }
  }

  const combinedText = normalizeText(
    [ocrText, qrData, barcodeData].join("\n")
  );

  const pin = extractPin(combinedText);
  const puk = extractPuk(combinedText);

  let iccid = "";

  if (/^\d{18,22}$/.test(barcodeData)) {
    iccid = barcodeData;
  }

  if (!iccid) {
    iccid = extractIccidFromText(combinedText);
  }

  const lpaData = qrData || extractLpa(combinedText);

  rawOcrBox.textContent +=
    `\n\n===== ${file.name} =====\n${ocrText || "No OCR text found"}`;

  return {
    fileName: file.name,
    iccid,
    lpa: lpaData,
    pin,
    puk,
    confidence: calculateConfidence({
      iccid,
      lpa: lpaData,
      pin,
      puk
    })
  };
}

function calculateConfidence(result) {
  let score = 0;

  if (result.iccid) {
    score += 25;
  }

  if (result.lpa) {
    score += 25;
  }

  if (/^\d{4}$/.test(result.pin)) {
    score += 25;
  }

  if (/^\d{8}$/.test(result.puk)) {
    score += 25;
  }

  return score + "%";
}

function renderResults() {
  resultsBody.innerHTML = "";

  if (!scanResults.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 7;
    cell.textContent = "No results yet.";

    row.appendChild(cell);
    resultsBody.appendChild(row);

    return;
  }

  scanResults.forEach((result, index) => {
    const row = document.createElement("tr");

    const values = [
      index + 1,
      result.fileName,
      result.iccid,
      result.lpa,
      result.pin,
      result.puk,
      result.confidence
    ];

    values.forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value || "";
      row.appendChild(cell);
    });

    resultsBody.appendChild(row);
  });
}

async function scanSelectedFiles() {
  if (!selectedFiles.length) {
    setStatus("Please upload or take a photo first.");
    return;
  }

  scanButton.disabled = true;
  scanResults = [];
  previewGrid.innerHTML = "";
  rawOcrBox.textContent = "";

  try {
    for (let i = 0; i < selectedFiles.length; i++) {
      const result = await scanFile(
        selectedFiles[i],
        i
      );

      scanResults.push(result);
      renderResults();
    }

    setStatus(
      `Completed. Scanned ${scanResults.length} file(s).`
    );
  } catch (error) {
    console.error(error);

    setStatus(
      "Scanning failed: " +
      (error.message || "Unknown error")
    );
  } finally {
    scanButton.disabled = false;
  }
}

function addFiles(files) {
  const incomingFiles = Array.from(files || []);

  selectedFiles.push(...incomingFiles);

  setStatus(
    `${selectedFiles.length} photo(s) selected. Click Scan Photo.`
  );
}

function exportCsv() {
  if (!scanResults.length) {
    setStatus("There are no results to export.");
    return;
  }

  const headers = [
    "File Name",
    "ICCID",
    "QR / LPA Data",
    "PIN",
    "PUK",
    "Confidence"
  ];

  const rows = scanResults.map(result => [
    result.fileName,
    result.iccid,
    result.lpa,
    result.pin,
    result.puk,
    result.confidence
  ]);

  const csv = [
    headers,
    ...rows
  ]
    .map(row => row.map(escapeCsv).join(","))
    .join("\n");

  const blob = new Blob(
    [csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "esim-scan-results.csv";
  link.click();

  URL.revokeObjectURL(url);
}

function clearAll() {
  selectedFiles = [];
  scanResults = [];

  fileInput.value = "";
  cameraInput.value = "";

  previewGrid.innerHTML = "";
  rawOcrBox.textContent =
    "OCR text will appear here after scanning.";

  renderResults();

  setStatus("Cleared. Ready for a new photo.");
}

fileInput.addEventListener("change", event => {
  addFiles(event.target.files);
});

cameraInput.addEventListener("change", event => {
  addFiles(event.target.files);
});

scanButton.addEventListener("click", scanSelectedFiles);
exportButton.addEventListener("click", exportCsv);
clearButton.addEventListener("click", clearAll);

renderResults();