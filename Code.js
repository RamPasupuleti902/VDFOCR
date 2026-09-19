"use strict";

document.addEventListener("DOMContentLoaded", () => {

  const fileInput = document.getElementById("fileInput");
  const cameraInput = document.getElementById("cameraInput");

  const uploadButton = document.getElementById("uploadButton");
  const cameraButton = document.getElementById("cameraButton");
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

  const MAX_IMAGE_SIZE = 3200;


  // ============================================================
  // STATUS
  // ============================================================

  function setStatus(text) {
    statusBox.textContent = text;
  }


  // ============================================================
  // UPLOAD / CAMERA BUTTONS
  // ============================================================

  uploadButton.addEventListener("click", () => {
    fileInput.click();
  });

  cameraButton.addEventListener("click", () => {
    cameraInput.click();
  });


  fileInput.addEventListener("change", event => {

    addFiles(event.target.files);

  });


  cameraInput.addEventListener("change", event => {

    addFiles(event.target.files);

  });


  function addFiles(files) {

    const incomingFiles = Array.from(files || []);

    if (!incomingFiles.length) {
      return;
    }

    selectedFiles =
      selectedFiles.concat(incomingFiles);

    setStatus(
      selectedFiles.length +
      " photo(s) selected. Click Scan Photo."
    );
  }


  // ============================================================
  // OCR DIGIT NORMALIZATION
  // ============================================================

  function normalizeDigits(text) {

    return String(text || "")
      .replace(/[Oo]/g, "0")
      .replace(/[IiLl|!]/g, "1")
      .replace(/[Zz]/g, "2")
      .replace(/[Ss]/g, "5")
      .replace(/[Gg]/g, "6")
      .replace(/[Bb]/g, "8");

  }


  // ============================================================
  // LUHN CHECK
  // ============================================================

  function luhn(number) {

    const digits =
      String(number || "")
        .replace(/\D/g, "");

    if (!digits) {
      return false;
    }

    let sum = 0;
    let alternate = false;

    for (
      let i = digits.length - 1;
      i >= 0;
      i--
    ) {

      let n = Number(digits[i]);

      if (alternate) {

        n = n * 2;

        if (n > 9) {
          n = n - 9;
        }

      }

      sum += n;

      alternate = !alternate;
    }

    return sum % 10 === 0;

  }


  // ============================================================
  // PIN
  // ============================================================

  function extractPin(text) {

    const t = normalizeDigits(text);

    const patterns = [

      /P\s*I\s*N\s*[:\-]?\s*([0-9]{4})/i,

      /PIN[^0-9]{0,12}([0-9]{4})/i

    ];

    for (const pattern of patterns) {

      const match =
        t.match(pattern);

      if (match) {
        return match[1];
      }

    }

    return "";

  }


  // ============================================================
  // PUK
  // ============================================================

  function extractPuk(text) {

    const t = normalizeDigits(text);

    const patterns = [

      /P\s*U\s*K\s*[:\-]?\s*([0-9]{8})/i,

      /PUK[^0-9]{0,12}([0-9]{8})/i

    ];

    for (const pattern of patterns) {

      const match =
        t.match(pattern);

      if (match) {
        return match[1];
      }

    }

    return "";

  }


  // ============================================================
  // ICCID FROM OCR
  // ============================================================

  function extractIccid(text) {

    const t =
      normalizeDigits(text);

    /*
      ICCID must normally contain
      18 to 22 digits.
    */

    const candidates =
      t.match(/\b\d{18,22}\b/g) || [];


    /*
      First prefer Luhn-valid ICCID.
    */

    for (const candidate of candidates) {

      if (luhn(candidate)) {
        return candidate;
      }

    }


    /*
      If no Luhn-valid candidate,
      still accept a proper ICCID length.
    */

    return candidates[0] || "";

  }


  // ============================================================
  // LPA FROM OCR
  // ============================================================

  function extractLpa(text) {

    const t =
      String(text || "");


    const lpa =
      t.match(
        /LPA\s*:\s*[A-Za-z0-9+\/=_:.-]+/i
      );


    if (lpa) {

      return lpa[0]
        .replace(/\s+/g, "");

    }


    /*
      Common eSIM activation-code format
    */

    const activation =
      t.match(
        /1\$[A-Za-z0-9.-]+\$[A-Za-z0-9+\/=_-]+/
      );


    if (activation) {

      return activation[0];

    }


    return "";

  }


  // ============================================================
  // LOAD IMAGE
  // ============================================================

  function loadImage(file) {

    return new Promise(
      (resolve, reject) => {

        const img =
          new Image();

        const url =
          URL.createObjectURL(file);


        img.onload = () => {

          URL.revokeObjectURL(url);

          resolve(img);

        };


        img.onerror = () => {

          URL.revokeObjectURL(url);

          reject(
            new Error(
              "Unable to load image: " +
              file.name
            )
          );

        };


        img.src = url;

      }
    );

  }


  // ============================================================
  // CREATE CANVAS
  // ============================================================

  function canvasFromImage(
    img,
    crop = null,
    mode = "normal",
    rotate = 0
  ) {

    const imageWidth =
      img.naturalWidth ||
      img.width;

    const imageHeight =
      img.naturalHeight ||
      img.height;


    let sx = 0;
    let sy = 0;
    let sw = imageWidth;
    let sh = imageHeight;


    if (crop) {

      sx =
        Math.floor(
          imageWidth * crop.x
        );

      sy =
        Math.floor(
          imageHeight * crop.y
        );

      sw =
        Math.floor(
          imageWidth * crop.width
        );

      sh =
        Math.floor(
          imageHeight * crop.height
        );

    }


    const scale =
      Math.min(
        1,
        MAX_IMAGE_SIZE /
        Math.max(sw, sh)
      );


    const width =
      Math.max(
        1,
        Math.floor(sw * scale)
      );


    const height =
      Math.max(
        1,
        Math.floor(sh * scale)
      );


    const canvas =
      document.createElement(
        "canvas"
      );


    if (
      rotate === 90 ||
      rotate === 270
    ) {

      canvas.width = height;
      canvas.height = width;

    } else {

      canvas.width = width;
      canvas.height = height;

    }


    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );


    ctx.save();


    if (rotate === 90) {

      ctx.translate(
        height,
        0
      );

      ctx.rotate(
        Math.PI / 2
      );

    }


    else if (rotate === 180) {

      ctx.translate(
        width,
        height
      );

      ctx.rotate(
        Math.PI
      );

    }


    else if (rotate === 270) {

      ctx.translate(
        0,
        width
      );

      ctx.rotate(
        -Math.PI / 2
      );

    }


    ctx.drawImage(
      img,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      width,
      height
    );


    ctx.restore();


    /*
      Image processing
    */

    if (mode !== "normal") {

      const imageData =
        ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        );


      for (
        let i = 0;
        i < imageData.data.length;
        i += 4
      ) {

        let gray =
          Math.round(
            0.299 *
              imageData.data[i] +

            0.587 *
              imageData.data[i + 1] +

            0.114 *
              imageData.data[i + 2]
          );


        if (
          mode === "threshold"
        ) {

          gray =
            gray > 145
              ? 255
              : 0;

        }


        if (
          mode === "invert"
        ) {

          gray =
            255 - gray;

        }


        imageData.data[i] =
          gray;

        imageData.data[i + 1] =
          gray;

        imageData.data[i + 2] =
          gray;

      }


      ctx.putImageData(
        imageData,
        0,
        0
      );

    }


    return canvas;

  }


  // ============================================================
  // CARD AREAS
  //
  // Your card:
  //
  // PIN/PUK = upper-left
  // QR       = upper-right
  // ICCID    = bottom
  // ============================================================

  function getCardRegions() {

    return {

      qr: [

        {
          x: 0.45,
          y: 0.00,
          width: 0.55,
          height: 0.70
        },

        {
          x: 0.50,
          y: 0.05,
          width: 0.47,
          height: 0.62
        },

        {
          x: 0.40,
          y: 0.00,
          width: 0.60,
          height: 0.75
        }

      ],


      pinPuk: [

        {
          x: 0.00,
          y: 0.00,
          width: 0.60,
          height: 0.42
        },

        {
          x: 0.05,
          y: 0.05,
          width: 0.50,
          height: 0.35
        },

        {
          x: 0.00,
          y: 0.00,
          width: 0.70,
          height: 0.55
        }

      ],


      barcode: [

        {
          x: 0.30,
          y: 0.58,
          width: 0.70,
          height: 0.42
        },

        {
          x: 0.20,
          y: 0.55,
          width: 0.80,
          height: 0.45
        },

        {
          x: 0.35,
          y: 0.60,
          width: 0.65,
          height: 0.40
        }

      ],


      whole: [

        null,

        {
          x: 0,
          y: 0,
          width: 1,
          height: 0.55
        },

        {
          x: 0,
          y: 0.45,
          width: 1,
          height: 0.55
        }

      ]

    };

  }


  // ============================================================
  // QR WITH jsQR
  // ============================================================

  function decodeJsQR(canvas) {

    if (
      typeof window.jsQR !==
      "function"
    ) {

      return "";

    }


    try {

      const ctx =
        canvas.getContext(
          "2d",
          {
            willReadFrequently: true
          }
        );


      const imageData =
        ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        );


      const result =
        window.jsQR(
          imageData.data,
          imageData.width,
          imageData.height,
          {
            inversionAttempts:
              "attemptBoth"
          }
        );


      return (
        result?.data ||
        ""
      );

    }

    catch {

      return "";

    }

  }


  // ============================================================
  // ZXING
  // ============================================================

  async function initializeZXing() {

    if (!window.ZXing) {

      return;

    }


    if (!qrReader) {

      const hints =
        new Map();


      hints.set(
        ZXing.DecodeHintType.TRY_HARDER,
        true
      );


      hints.set(
        ZXing.DecodeHintType.POSSIBLE_FORMATS,
        [
          ZXing.BarcodeFormat.QR_CODE
        ]
      );


      qrReader =
        new ZXing.BrowserMultiFormatReader(
          hints
        );

    }


    if (!barcodeReader) {

      const hints =
        new Map();


      hints.set(
        ZXing.DecodeHintType.TRY_HARDER,
        true
      );


      hints.set(
        ZXing.DecodeHintType.POSSIBLE_FORMATS,
        [
          ZXing.BarcodeFormat.CODE_128,
          ZXing.BarcodeFormat.CODE_39,
          ZXing.BarcodeFormat.ITF,
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.EAN_8
        ]
      );


      barcodeReader =
        new ZXing.BrowserMultiFormatReader(
          hints
        );

    }

  }


  async function decodeZXing(
    reader,
    canvas
  ) {

    if (!reader) {

      return "";

    }


    try {

      const result =
        await reader.decodeFromCanvas(
          canvas
        );


      return (
        result?.getText?.() ||
        ""
      );

    }

    catch {

      return "";

    }

  }


  // ============================================================
  // OCR WORKER
  // ============================================================

  async function getOcrWorker() {

    if (ocrWorker) {

      return ocrWorker;

    }


    if (!window.Tesseract) {

      throw new Error(
        "Tesseract.js did not load."
      );

    }


    setStatus(
      "Loading OCR engine..."
    );


    ocrWorker =
      await Tesseract.createWorker(
        "eng",
        1,
        {

          logger: message => {

            if (
              message &&
              message.status ===
              "recognizing text"
            ) {

              const progress =
                Math.round(
                  (message.progress || 0) *
                  100
                );


              setStatus(
                "OCR progress: " +
                progress +
                "%"
              );

            }

          }

        }
      );


    try {

      await ocrWorker.setParameters({

        tessedit_pageseg_mode:
          "6",

        preserve_interword_spaces:
          "1"

      });

    }

    catch (_) {}


    return ocrWorker;

  }


  async function recognize(canvas) {

    const worker =
      await getOcrWorker();


    const result =
      await worker.recognize(
        canvas
      );


    return (
      result?.data?.text ||
      ""
    );

  }


  // ============================================================
  // SCAN QR
  // ============================================================

  async function scanQR(img) {

    const regions =
      getCardRegions().qr;


    for (
      const crop of regions
    ) {

      for (
        const mode of [
          "normal",
          "gray",
          "threshold"
        ]
      ) {

        for (
          const rotation of [
            0,
            90,
            270
          ]
        ) {

          const canvas =
            canvasFromImage(
              img,
              crop,
              mode,
              rotation
            );


          /*
            First jsQR
          */

          let result =
            decodeJsQR(
              canvas
            );


          if (result) {

            return result;

          }


          /*
            Then ZXing
          */

          result =
            await decodeZXing(
              qrReader,
              canvas
            );


          if (result) {

            return result;

          }

        }

      }

    }


    return "";

  }


  // ============================================================
  // SCAN ICCID BARCODE
  // ============================================================

  async function scanBarcode(img) {

    const regions =
      getCardRegions().barcode;


    for (
      const crop of regions
    ) {

      for (
        const mode of [
          "normal",
          "gray",
          "threshold"
        ]
      ) {

        for (
          const rotation of [
            0,
            180
          ]
        ) {

          const canvas =
            canvasFromImage(
              img,
              crop,
              mode,
              rotation
            );


          const result =
            await decodeZXing(
              barcodeReader,
              canvas
            );


          const digits =
            String(result || "")
              .replace(
                /\D/g,
                ""
              );


          /*
            Only accept a proper ICCID length.
          */

          if (
            digits.length >= 18 &&
            digits.length <= 22
          ) {

            return digits;

          }

        }

      }

    }


    return "";

  }


  // ============================================================
  // SCAN PIN / PUK
  // ============================================================

  async function scanPinPuk(img) {

    const regions =
      getCardRegions().pinPuk;


    let bestText = "";


    for (
      const crop of regions
    ) {

      for (
        const mode of [
          "normal",
          "gray",
          "threshold"
        ]
      ) {

        const canvas =
          canvasFromImage(
            img,
            crop,
            mode,
            0
          );


        const text =
          await recognize(
            canvas
          );


        if (
          text.length >
          bestText.length
        ) {

          bestText =
            text;

        }


        const pin =
          extractPin(text);


        const puk =
          extractPuk(text);


        if (
          pin ||
          puk
        ) {

          return {

            pin: pin,

            puk: puk,

            text: bestText

          };

        }

      }

    }


    return {

      pin:
        extractPin(
          bestText
        ),

      puk:
        extractPuk(
          bestText
        ),

      text:
        bestText

    };

  }


  // ============================================================
  // FALLBACK OCR
  // ============================================================

  async function wholeCardOCR(img) {

    const regions =
      getCardRegions().whole;


    let bestText = "";


    for (
      const crop of regions
    ) {

      for (
        const mode of [
          "normal",
          "gray"
        ]
      ) {

        const canvas =
          canvasFromImage(
            img,
            crop,
            mode,
            0
          );


        const text =
          await recognize(
            canvas
          );


        if (
          text.length >
          bestText.length
        ) {

          bestText =
            text;

        }

      }

    }


    return bestText;

  }


  // ============================================================
  // RENDER RESULTS
  // ============================================================

  function renderResults() {

    resultsBody.innerHTML = "";


    if (
      !scanResults.length
    ) {

      resultsBody.innerHTML =
        `
        <tr>
          <td colspan="7">
            No results yet.
          </td>
        </tr>
        `;

      return;

    }


    scanResults.forEach(
      (result, index) => {

        const row =
          document.createElement(
            "tr"
          );


        const values = [

          index + 1,

          result.fileName,

          result.iccid,

          result.lpa,

          result.pin,

          result.puk,

          result.confidence

        ];


        values.forEach(
          value => {

            const cell =
              document.createElement(
                "td"
              );


            cell.textContent =
              value || "";


            row.appendChild(
              cell
            );

          }
        );


        resultsBody.appendChild(
          row
        );

      }
    );

  }


  // ============================================================
  // SCAN FILE
  // ============================================================

  async function scanFile(
    file,
    index
  ) {

    setStatus(
      "Scanning " +
      (index + 1) +
      " of " +
      selectedFiles.length +
      ": " +
      file.name
    );


    const img =
      await loadImage(
        file
      );


    /*
      Preview
    */

    const card =
      document.createElement(
        "div"
      );

    card.className =
      "preview-card";


    const title =
      document.createElement(
        "h3"
      );

    title.textContent =
      file.name;


    const preview =
      document.createElement(
        "img"
      );


    preview.src =
      URL.createObjectURL(
        file
      );


    preview.alt =
      "eSIM card photo";


    card.appendChild(
      title
    );


    card.appendChild(
      preview
    );


    previewGrid.appendChild(
      card
    );


    await initializeZXing();


    // ----------------------------------------------------------
    // QR / LPA
    // ----------------------------------------------------------

    setStatus(
      "Scanning QR / LPA..."
    );


    const lpa =
      await scanQR(
        img
      );


    // ----------------------------------------------------------
    // ICCID
    // ----------------------------------------------------------

    setStatus(
      "Scanning ICCID barcode..."
    );


    let iccid =
      await scanBarcode(
        img
      );


    // ----------------------------------------------------------
    // PIN / PUK
    // ----------------------------------------------------------

    setStatus(
      "Reading PIN / PUK..."
    );


    const pinPuk =
      await scanPinPuk(
        img
      );


    // ----------------------------------------------------------
    // FALLBACK OCR
    // ----------------------------------------------------------

    let wholeText = "";


    if (
      !iccid ||
      !lpa ||
      !pinPuk.pin ||
      !pinPuk.puk
    ) {

      setStatus(
        "Running fallback OCR..."
      );


      wholeText =
        await wholeCardOCR(
          img
        );

    }


    // ICCID fallback

    if (!iccid) {

      iccid =
        extractIccid(
          wholeText +
          "\n" +
          pinPuk.text
        );

    }


    // PIN

    const pin =
      pinPuk.pin ||
      extractPin(
        wholeText
      );


    // PUK

    const puk =
      pinPuk.puk ||
      extractPuk(
        wholeText
      );


    // LPA

    const finalLpa =
      lpa ||
      extractLpa(
        wholeText
      );


    /*
      Raw OCR
    */

    const combinedOCR =
      [
        pinPuk.text,
        wholeText
      ]
      .filter(Boolean)
      .join("\n");


    rawOcrBox.textContent +=
      "\n\n===== " +
      file.name +
      " =====\n" +
      (
        combinedOCR ||
        "No OCR text found"
      );


    /*
      Confidence
    */

    let found = 0;


    if (iccid) {
      found++;
    }


    if (finalLpa) {
      found++;
    }


    if (pin) {
      found++;
    }


    if (puk) {
      found++;
    }


    return {

      fileName:
        file.name,

      iccid:
        iccid,

      lpa:
        finalLpa,

      pin:
        pin,

      puk:
        puk,

      confidence:
        (found * 25) +
        "%"

    };

  }


  // ============================================================
  // SCAN BUTTON
  // ============================================================

  scanButton.addEventListener(
    "click",
    async () => {

      if (
        !selectedFiles.length
      ) {

        setStatus(
          "Please upload a photo first."
        );

        return;

      }


      scanButton.disabled =
        true;


      scanResults = [];


      previewGrid.innerHTML =
        "";


      rawOcrBox.textContent =
        "";


      try {

        for (
          let i = 0;
          i < selectedFiles.length;
          i++
        ) {

          const result =
            await scanFile(
              selectedFiles[i],
              i
            );


          scanResults.push(
            result
          );


          renderResults();

        }


        setStatus(
          "Completed. Scanned " +
          scanResults.length +
          " photo(s)."
        );

      }


      catch (error) {

        console.error(
          error
        );


        setStatus(
          "Scanning failed: " +
          (
            error.message ||
            error
          )
        );

      }


      finally {

        scanButton.disabled =
          false;

      }

    }
  );


  // ============================================================
  // EXPORT CSV
  // ============================================================

  exportButton.addEventListener(
    "click",
    () => {

      if (
        !scanResults.length
      ) {

        setStatus(
          "There are no results to export."
        );

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


      const rows =
        scanResults.map(
          result => [

            result.fileName,

            result.iccid,

            result.lpa,

            result.pin,

            result.puk,

            result.confidence

          ]
        );


      const csv =
        [headers, ...rows]
        .map(
          row =>
            row
              .map(
                value =>
                  '"' +
                  String(
                    value ?? ""
                  )
                  .replaceAll(
                    '"',
                    '""'
                  ) +
                  '"'
              )
              .join(",")
        )
        .join("\n");


      const blob =
        new Blob(
          [csv],
          {
            type:
              "text/csv;charset=utf-8"
          }
        );


      const url =
        URL.createObjectURL(
          blob
        );


      const link =
        document.createElement(
          "a"
        );


      link.href =
        url;


      link.download =
        "esim-scan-results.csv";


      link.click();


      URL.revokeObjectURL(
        url
      );

    }
  );


  // ============================================================
  // CLEAR
  // ============================================================

  clearButton.addEventListener(
    "click",
    () => {

      selectedFiles = [];

      scanResults = [];


      fileInput.value =
        "";

      cameraInput.value =
        "";


      previewGrid.innerHTML =
        "";


      rawOcrBox.textContent =
        "OCR text will appear here after scanning.";


      renderResults();


      setStatus(
        "Cleared. Ready for a new photo."
      );

    }
  );


  // Initial state

  renderResults();

  setStatus(
    "Ready. Click Upload Photo or Take Photo."
  );

});