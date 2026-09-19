"use strict";

document.addEventListener("DOMContentLoaded", function () {

    console.log("eSIM Scanner JavaScript loaded");

    const fileInput = document.getElementById("fileInput");
    const cameraInput = document.getElementById("cameraInput");
    const scanButton = document.getElementById("scanButton");
    const exportButton = document.getElementById("exportButton");
    const clearButton = document.getElementById("clearButton");

    const status = document.getElementById("status");
    const previewGrid = document.getElementById("previewGrid");
    const resultsBody = document.getElementById("resultsBody");
    const rawOcr = document.getElementById("rawOcr");

    const photoCount = document.getElementById("photoCount");
    const iccidCount = document.getElementById("iccidCount");
    const lpaCount = document.getElementById("lpaCount");
    const pinPukCount = document.getElementById("pinPukCount");

    let selectedFiles = [];
    let results = [];
    let ocrWorker = null;

    /* =========================================================
       STATUS
    ========================================================= */

    function setStatus(message) {
        status.textContent = message;
        console.log("[STATUS]", message);
    }

    console.log("jsQR:", typeof window.jsQR);
    console.log("Tesseract:", typeof window.Tesseract);
    console.log("ZXing:", typeof window.ZXing);

    setStatus("Ready. Click Upload Photo.");

    /* =========================================================
       FILE INPUT
    ========================================================= */

    fileInput.addEventListener("change", async function (event) {

        const files = Array.from(event.target.files || []);

        if (!files.length) {
            setStatus("No photo selected.");
            return;
        }

        selectedFiles = files;

        showPreviews();

        setStatus(
            files.length +
            " photo(s) selected. Starting scan..."
        );

        await startScanning();
    });

    /* =========================================================
       CAMERA INPUT
    ========================================================= */

    cameraInput.addEventListener("change", async function (event) {

        const files = Array.from(event.target.files || []);

        if (!files.length) {
            return;
        }

        selectedFiles = files;

        showPreviews();

        setStatus("Camera photo selected. Starting scan...");

        await startScanning();
    });

    /* =========================================================
       SHOW PREVIEW
    ========================================================= */

    function showPreviews() {

        previewGrid.innerHTML = "";

        selectedFiles.forEach(function (file, index) {

            const card = document.createElement("div");
            card.className = "preview-card";

            const title = document.createElement("h3");

            title.textContent =
                (index + 1) + ". " + file.name;

            const image = document.createElement("img");

            const url = URL.createObjectURL(file);

            image.src = url;

            image.onload = function () {
                URL.revokeObjectURL(url);
            };

            card.appendChild(title);
            card.appendChild(image);

            previewGrid.appendChild(card);
        });

        photoCount.textContent = selectedFiles.length;
    }

    /* =========================================================
       LOAD IMAGE
    ========================================================= */

    function loadImage(file) {

        return new Promise(function (resolve, reject) {

            const image = new Image();

            const url = URL.createObjectURL(file);

            image.onload = function () {

                URL.revokeObjectURL(url);

                resolve(image);
            };

            image.onerror = function () {

                URL.revokeObjectURL(url);

                reject(
                    new Error("Could not load image.")
                );
            };

            image.src = url;
        });
    }

    /* =========================================================
       CREATE CANVAS
    ========================================================= */

    function createCanvas(image, crop, scaleMultiplier) {

        const width =
            image.naturalWidth || image.width;

        const height =
            image.naturalHeight || image.height;

        let x = 0;
        let y = 0;
        let w = width;
        let h = height;

        if (crop) {

            x = Math.floor(width * crop.x);
            y = Math.floor(height * crop.y);

            w = Math.floor(width * crop.width);
            h = Math.floor(height * crop.height);
        }

        scaleMultiplier = scaleMultiplier || 1;

        let targetWidth = Math.floor(w * scaleMultiplier);
        let targetHeight = Math.floor(h * scaleMultiplier);

        const maxSize = 4500;

        const limit =
            Math.min(
                1,
                maxSize /
                Math.max(targetWidth, targetHeight)
            );

        targetWidth =
            Math.max(
                1,
                Math.floor(targetWidth * limit)
            );

        targetHeight =
            Math.max(
                1,
                Math.floor(targetHeight * limit)
            );

        const canvas = document.createElement("canvas");

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently: true
                }
            );

        ctx.drawImage(
            image,
            x,
            y,
            w,
            h,
            0,
            0,
            canvas.width,
            canvas.height
        );

        return canvas;
    }

    /* =========================================================
       IMAGE ENHANCEMENT
    ========================================================= */

    function enhanceCanvas(sourceCanvas, mode) {

        const canvas =
            document.createElement("canvas");

        canvas.width = sourceCanvas.width;
        canvas.height = sourceCanvas.height;

        const sourceCtx =
            sourceCanvas.getContext(
                "2d",
                {
                    willReadFrequently: true
                }
            );

        const targetCtx =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently: true
                }
            );

        const imageData =
            sourceCtx.getImageData(
                0,
                0,
                sourceCanvas.width,
                sourceCanvas.height
            );

        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {

            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            let gray =
                (0.299 * r) +
                (0.587 * g) +
                (0.114 * b);

            if (mode === "gray") {

                data[i] = gray;
                data[i + 1] = gray;
                data[i + 2] = gray;
            }

            if (mode === "contrast") {

                gray =
                    ((gray - 128) * 1.8) + 128;

                gray =
                    Math.max(
                        0,
                        Math.min(
                            255,
                            gray
                        )
                    );

                data[i] = gray;
                data[i + 1] = gray;
                data[i + 2] = gray;
            }

            if (mode === "threshold") {

                gray =
                    gray > 150
                        ? 255
                        : 0;

                data[i] = gray;
                data[i + 1] = gray;
                data[i + 2] = gray;
            }
        }

        targetCtx.putImageData(
            imageData,
            0,
            0
        );

        return canvas;
    }

    /* =========================================================
       QR SCANNER
    ========================================================= */

    function scanQRCanvas(canvas) {

        if (typeof window.jsQR !== "function") {
            console.log("jsQR unavailable");
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

            const code =
                window.jsQR(
                    imageData.data,
                    imageData.width,
                    imageData.height,
                    {
                        inversionAttempts:
                            "attemptBoth"
                    }
                );

            if (code && code.data) {

                console.log(
                    "QR FOUND:",
                    code.data
                );

                return code.data;
            }

        } catch (error) {

            console.error(
                "QR error:",
                error
            );
        }

        return "";
    }

    /* =========================================================
       QR SCANNER - MANY AREAS
    ========================================================= */

    async function scanQR(image) {

        setStatus("Scanning QR code...");

        const areas = [

            /* Full image */
            {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            },

            /* Top */
            {
                x: 0,
                y: 0,
                width: 1,
                height: 0.55
            },

            /* Bottom */
            {
                x: 0,
                y: 0.45,
                width: 1,
                height: 0.55
            },

            /* Left */
            {
                x: 0,
                y: 0,
                width: 0.55,
                height: 1
            },

            /* Right */
            {
                x: 0.45,
                y: 0,
                width: 0.55,
                height: 1
            },

            /* Top-left */
            {
                x: 0,
                y: 0,
                width: 0.7,
                height: 0.7
            },

            /* Top-right */
            {
                x: 0.3,
                y: 0,
                width: 0.7,
                height: 0.7
            },

            /* Bottom-left */
            {
                x: 0,
                y: 0.3,
                width: 0.7,
                height: 0.7
            },

            /* Bottom-right */
            {
                x: 0.3,
                y: 0.3,
                width: 0.7,
                height: 0.7
            },

            /* Center */
            {
                x: 0.15,
                y: 0.15,
                width: 0.7,
                height: 0.7
            }
        ];

        const scales = [1, 1.5, 2];

        for (const area of areas) {

            for (const scale of scales) {

                const canvas =
                    createCanvas(
                        image,
                        area,
                        scale
                    );

                let result =
                    scanQRCanvas(canvas);

                if (result) {
                    return result;
                }

                /* Try enhanced QR image */
                const gray =
                    enhanceCanvas(
                        canvas,
                        "gray"
                    );

                result =
                    scanQRCanvas(gray);

                if (result) {
                    return result;
                }
            }
        }

        console.log("QR not found.");

        return "";
    }

    /* =========================================================
       BARCODE SCANNER
    ========================================================= */

    async function scanBarcode(image) {

        setStatus(
            "Scanning ICCID barcode..."
        );

        if (typeof window.ZXing === "undefined") {

            console.log(
                "ZXing unavailable."
            );

            return "";
        }

        try {

            const reader =
                new window.ZXing.BrowserMultiFormatReader();

            const areas = [

                {
                    x: 0,
                    y: 0.25,
                    width: 1,
                    height: 0.75
                },

                {
                    x: 0,
                    y: 0.4,
                    width: 1,
                    height: 0.6
                },

                {
                    x: 0,
                    y: 0.5,
                    width: 1,
                    height: 0.5
                },

                {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1
                }
            ];

            const scales = [1, 1.5, 2, 2.5];

            for (const area of areas) {

                for (const scale of scales) {

                    const canvas =
                        createCanvas(
                            image,
                            area,
                            scale
                        );

                    const canvases = [
                        canvas,
                        enhanceCanvas(
                            canvas,
                            "gray"
                        ),
                        enhanceCanvas(
                            canvas,
                            "contrast"
                        ),
                        enhanceCanvas(
                            canvas,
                            "threshold"
                        )
                    ];

                    for (const currentCanvas of canvases) {

                        try {

                            const result =
                                await reader.decodeFromCanvas(
                                    currentCanvas
                                );

                            if (result) {

                                const text =
                                    result.getText();

                                console.log(
                                    "BARCODE FOUND:",
                                    text
                                );

                                const digits =
                                    text.replace(
                                        /\D/g,
                                        ""
                                    );

                                if (
                                    digits.length >= 18 &&
                                    digits.length <= 22
                                ) {

                                    if (
                                        digits.startsWith("89")
                                    ) {
                                        return digits;
                                    }

                                    return digits;
                                }
                            }

                        } catch (error) {

                            /* Continue */
                        }
                    }
                }
            }

        } catch (error) {

            console.error(
                "Barcode error:",
                error
            );
        }

        console.log(
            "Barcode ICCID not found."
        );

        return "";
    }

    /* =========================================================
       OCR WORKER
    ========================================================= */

    async function getOCRWorker() {

        if (ocrWorker) {
            return ocrWorker;
        }

        if (
            typeof window.Tesseract ===
            "undefined"
        ) {

            throw new Error(
                "Tesseract.js did not load."
            );
        }

        setStatus(
            "Loading OCR engine..."
        );

        ocrWorker =
            await window.Tesseract.createWorker(
                "eng",
                1,
                {
                    logger: function (message) {

                        if (
                            message.status ===
                            "recognizing text"
                        ) {

                            const percent =
                                Math.round(
                                    (
                                        message.progress ||
                                        0
                                    ) * 100
                                );

                            setStatus(
                                "Reading card text: " +
                                percent +
                                "%"
                            );
                        }
                    }
                }
            );

        try {

            await ocrWorker.setParameters({

                tessedit_pageseg_mode: "6",

                preserve_interword_spaces: "1",

                tessedit_char_whitelist:
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:-./$"
            });

        } catch (error) {

            console.log(
                "OCR parameter warning:",
                error
            );
        }

        return ocrWorker;
    }

    /* =========================================================
       OCR
    ========================================================= */

    async function runOCR(canvas) {

        const worker =
            await getOCRWorker();

        try {

            const result =
                await worker.recognize(
                    canvas
                );

            if (
                result &&
                result.data
            ) {

                return (
                    result.data.text ||
                    ""
                );
            }

        } catch (error) {

            console.error(
                "OCR error:",
                error
            );
        }

        return "";
    }

    /* =========================================================
       NORMALIZE OCR TEXT
    ========================================================= */

    function normalizeText(text) {

        return String(text || "")
            .replace(/\r/g, "\n")
            .replace(/[|]/g, "I")
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/\u00a0/g, " ");
    }

    /* =========================================================
       FIND PIN
    ========================================================= */

    function findPIN(text) {

        const clean =
            normalizeText(text);

        const patterns = [

            /PIN\s*[:\-]?\s*(\d{4})/i,

            /P\s*I\s*N\s*[:\-]?\s*(\d{4})/i,

            /P1N\s*[:\-]?\s*(\d{4})/i,

            /P\s*IN\s*[:\-]?\s*(\d{4})/i,

            /PIN[^\d]{0,10}(\d{4})/i,

            /P1N[^\d]{0,10}(\d{4})/i
        ];

        for (const pattern of patterns) {

            const match =
                clean.match(pattern);

            if (match) {

                return match[1];
            }
        }

        return "";
    }

    /* =========================================================
       FIND PUK
    ========================================================= */

    function findPUK(text) {

        const clean =
            normalizeText(text);

        const patterns = [

            /PUK\s*[:\-]?\s*(\d{8})/i,

            /P\s*U\s*K\s*[:\-]?\s*(\d{8})/i,

            /PUK[^\d]{0,10}(\d{8})/i,

            /P\s*U\s*K[^\d]{0,10}(\d{4})\s*(\d{4})/i,

            /PUX\s*[:\-]?\s*(\d{8})/i
        ];

        for (const pattern of patterns) {

            const match =
                clean.match(pattern);

            if (match) {

                if (match[2]) {

                    return (
                        match[1] +
                        match[2]
                    );
                }

                return match[1];
            }
        }

        return "";
    }

    /* =========================================================
       FIND ICCID FROM OCR
    ========================================================= */

    function findICCID(text) {

        if (!text) {
            return "";
        }

        const normalized =
            normalizeText(text)
                .replace(/[Oo]/g, "0")
                .replace(/[Il|]/g, "1");

        /*
         * First look for ICCID beginning with 89.
         * Allows spaces/hyphens between digits.
         */

        const pattern =
            /89(?:[\s\-]*\d){16,20}/g;

        const matches =
            normalized.match(pattern);

        if (matches && matches.length) {

            for (const match of matches) {

                const digits =
                    match.replace(
                        /\D/g,
                        ""
                    );

                if (
                    digits.length >= 18 &&
                    digits.length <= 22
                ) {

                    return digits;
                }
            }
        }

        /*
         * Look line-by-line for long numbers.
         */

        const lines =
            normalized.split("\n");

        for (const line of lines) {

            const digits =
                line.replace(
                    /\D/g,
                    ""
                );

            if (
                digits.startsWith("89") &&
                digits.length >= 18 &&
                digits.length <= 22
            ) {

                return digits;
            }
        }

        return "";
    }

    /* =========================================================
       FIND LPA
    ========================================================= */

    function findLPA(text) {

        if (!text) {
            return "";
        }

        const clean =
            normalizeText(text)
                .replace(/\s+/g, "");

        /*
         * Standard LPA format
         */

        const lpaMatch =
            clean.match(
                /LPA:[A-Za-z0-9+./:_=-]+/i
            );

        if (lpaMatch) {

            return lpaMatch[0];
        }

        /*
         * Sometimes OCR reads LPA incorrectly.
         */

        const lpaBroken =
            clean.match(
                /LP[A4]:[A-Za-z0-9+./:_=-]+/i
            );

        if (lpaBroken) {

            return lpaBroken[0]
                .replace(/^LP[A4]/i, "LPA");
        }

        /*
         * Common activation-code format.
         */

        const activation =
            clean.match(
                /1\$[A-Za-z0-9._:+/=-]+\$[A-Za-z0-9._:+/=-]+/
            );

        if (activation) {

            return activation[0];
        }

        return "";
    }

    /* =========================================================
       OCR FULL CARD
    ========================================================= */

    async function scanCardText(image) {

        let allText = "";

        const areas = [

            /* Full image */
            {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            },

            /* Top */
            {
                x: 0,
                y: 0,
                width: 1,
                height: 0.6
            },

            /* Bottom */
            {
                x: 0,
                y: 0.4,
                width: 1,
                height: 0.6
            },

            /* Left */
            {
                x: 0,
                y: 0,
                width: 0.6,
                height: 1
            },

            /* Right */
            {
                x: 0.4,
                y: 0,
                width: 0.6,
                height: 1
            },

            /* Center */
            {
                x: 0.15,
                y: 0.15,
                width: 0.7,
                height: 0.7
            }
        ];

        for (
            let i = 0;
            i < areas.length;
            i++
        ) {

            setStatus(
                "OCR scan " +
                (i + 1) +
                " of " +
                areas.length +
                "..."
            );

            const baseCanvas =
                createCanvas(
                    image,
                    areas[i],
                    1.5
                );

            const variants = [

                baseCanvas,

                enhanceCanvas(
                    baseCanvas,
                    "gray"
                ),

                enhanceCanvas(
                    baseCanvas,
                    "contrast"
                ),

                enhanceCanvas(
                    baseCanvas,
                    "threshold"
                )
            ];

            for (
                const canvas of variants
            ) {

                const text =
                    await runOCR(canvas);

                if (text) {

                    allText +=
                        "\n\n" +
                        text;
                }

                const pin =
                    findPIN(allText);

                const puk =
                    findPUK(allText);

                const iccid =
                    findICCID(allText);

                /*
                 * Stop early when all important
                 * OCR fields are found.
                 */

                if (
                    pin &&
                    puk &&
                    iccid
                ) {

                    return allText;
                }
            }
        }

        return allText;
    }

    /* =========================================================
       SCAN ONE PHOTO
    ========================================================= */

    async function scanOnePhoto(file) {

        console.log(
            "Scanning:",
            file.name
        );

        const image =
            await loadImage(file);

        /* QR */

        const qr =
            await scanQR(image);

        /* Barcode */

        let iccid =
            await scanBarcode(image);

        /* OCR */

        setStatus(
            "Reading PIN, PUK, ICCID and card text..."
        );

        const ocrText =
            await scanCardText(image);

        /* PIN */

        const pin =
            findPIN(ocrText);

        /* PUK */

        const puk =
            findPUK(ocrText);

        /* ICCID OCR fallback */

        if (!iccid) {

            iccid =
                findICCID(ocrText);
        }

        /* LPA OCR fallback */

        let finalLPA = qr;

        if (!finalLPA) {

            finalLPA =
                findLPA(ocrText);
        }

        /*
         * If QR contains an LPA string,
         * use it directly.
         */

        if (
            finalLPA &&
            !finalLPA.toUpperCase().startsWith("LPA:")
        ) {

            /*
             * Keep actual QR value.
             * QR codes can contain full activation data.
             */
        }

        let found = 0;

        if (iccid) {
            found++;
        }

        if (finalLPA) {
            found++;
        }

        if (pin) {
            found++;
        }

        if (puk) {
            found++;
        }

        const confidence =
            (found * 25) + "%";

        console.log(
            "FINAL RESULT:",
            {
                iccid,
                lpa: finalLPA,
                pin,
                puk,
                confidence
            }
        );

        return {

            file: file.name,

            iccid: iccid,

            lpa: finalLPA,

            pin: pin,

            puk: puk,

            confidence: confidence,

            ocr: ocrText
        };
    }

    /* =========================================================
       START SCANNING
    ========================================================= */

    async function startScanning() {

        if (!selectedFiles.length) {

            setStatus(
                "Please select a photo first."
            );

            return;
        }

        results = [];

        rawOcr.textContent = "";

        displayResults();

        scanButton.disabled = true;

        try {

            for (
                let i = 0;
                i < selectedFiles.length;
                i++
            ) {

                setStatus(
                    "Scanning photo " +
                    (i + 1) +
                    " of " +
                    selectedFiles.length
                );

                const result =
                    await scanOnePhoto(
                        selectedFiles[i]
                    );

                results.push(result);

                rawOcr.textContent +=
                    "\n\n============================\n" +
                    result.file +
                    "\n============================\n\n" +
                    result.ocr;

                displayResults();
            }

            setStatus(
                "Scan completed successfully."
            );

        } catch (error) {

            console.error(
                "SCAN ERROR:",
                error
            );

            setStatus(
                "Scan error: " +
                (
                    error.message ||
                    String(error)
                )
            );

        } finally {

            scanButton.disabled = false;
        }
    }

    /* =========================================================
       DISPLAY RESULTS
    ========================================================= */

    function displayResults() {

        resultsBody.innerHTML = "";

        if (!results.length) {

            resultsBody.innerHTML = `
                <tr>
                    <td colspan="7">
                        No results yet.
                    </td>
                </tr>
            `;

            updateSummary();

            return;
        }

        results.forEach(
            function (result, index) {

                const row =
                    document.createElement("tr");

                addCell(
                    row,
                    index + 1
                );

                addCell(
                    row,
                    result.file
                );

                addResultCell(
                    row,
                    result.iccid
                );

                addResultCell(
                    row,
                    result.lpa
                );

                addResultCell(
                    row,
                    result.pin
                );

                addResultCell(
                    row,
                    result.puk
                );

                addCell(
                    row,
                    result.confidence
                );

                resultsBody.appendChild(row);
            }
        );

        updateSummary();
    }

    /* =========================================================
       ADD CELL
    ========================================================= */

    function addCell(row, value) {

        const cell =
            document.createElement("td");

        cell.textContent =
            value || "";

        row.appendChild(cell);
    }

    /* =========================================================
       ADD RESULT CELL
    ========================================================= */

    function addResultCell(row, value) {

        const cell =
            document.createElement("td");

        if (value) {

            cell.textContent = value;
            cell.className = "found";

        } else {

            cell.textContent = "Not found";
            cell.className = "not-found";
        }

        row.appendChild(cell);
    }

    /* =========================================================
       SUMMARY
    ========================================================= */

    function updateSummary() {

        photoCount.textContent =
            results.length;

        iccidCount.textContent =
            results.filter(
                item => Boolean(item.iccid)
            ).length;

        lpaCount.textContent =
            results.filter(
                item => Boolean(item.lpa)
            ).length;

        pinPukCount.textContent =
            results.filter(
                item =>
                    item.pin &&
                    item.puk
            ).length;
    }

    /* =========================================================
       SCAN AGAIN
    ========================================================= */

    scanButton.addEventListener(
        "click",
        async function () {

            if (!selectedFiles.length) {

                setStatus(
                    "Please upload a photo first."
                );

                return;
            }

            await startScanning();
        }
    );

    /* =========================================================
       CLEAR
    ========================================================= */

    clearButton.addEventListener(
        "click",
        function () {

            selectedFiles = [];
            results = [];

            fileInput.value = "";
            cameraInput.value = "";

            previewGrid.innerHTML = "";

            rawOcr.textContent =
                "OCR text will appear here.";

            displayResults();

            setStatus(
                "Ready. Click Upload Photo."
            );
        }
    );

    /* =========================================================
       EXPORT CSV
    ========================================================= */

    exportButton.addEventListener(
        "click",
        function () {

            if (!results.length) {

                setStatus(
                    "There are no results to export."
                );

                return;
            }

            const rows = [

                [
                    "Photo",
                    "ICCID",
                    "LPA / QR",
                    "PIN",
                    "PUK",
                    "Confidence"
                ]
            ];

            results.forEach(
                function (result) {

                    rows.push([

                        result.file,
                        result.iccid,
                        result.lpa,
                        result.pin,
                        result.puk,
                        result.confidence
                    ]);
                }
            );

            const csv =
                rows
                    .map(
                        function (row) {

                            return row
                                .map(
                                    function (value) {

                                        return '"' +
                                            String(
                                                value || ""
                                            )
                                                .replace(
                                                    /"/g,
                                                    '""'
                                                ) +
                                            '"';
                                    }
                                )
                                .join(",");
                        }
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
                URL.createObjectURL(blob);

            const link =
                document.createElement("a");

            link.href = url;

            link.download =
                "esim_scan_results.csv";

            document.body.appendChild(link);

            link.click();

            document.body.removeChild(link);

            URL.revokeObjectURL(url);

            setStatus(
                "CSV exported."
            );
        }
    );

    /* =========================================================
       INITIALIZE
    ========================================================= */

    console.log(
        "File input:",
        fileInput
    );

    console.log(
        "Camera input:",
        cameraInput
    );

    console.log(
        "All event listeners attached."
    );

    setStatus(
        "Ready. Click Upload Photo."
    );
});