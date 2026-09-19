"use strict";


/* =========================================================
   eSIM CARD SCANNER
   ICCID + QR/LPA + PIN + PUK
   ========================================================= */


document.addEventListener(
    "DOMContentLoaded",
    function () {


        /* =====================================================
           ELEMENTS
           ===================================================== */

        const fileInput =
            document.getElementById("fileInput");

        const cameraInput =
            document.getElementById("cameraInput");

        const uploadButton =
            document.getElementById("uploadButton");

        const cameraButton =
            document.getElementById("cameraButton");

        const scanButton =
            document.getElementById("scanButton");

        const exportButton =
            document.getElementById("exportButton");

        const clearButton =
            document.getElementById("clearButton");

        const statusBox =
            document.getElementById("status");

        const previewGrid =
            document.getElementById("previewGrid");

        const resultsBody =
            document.getElementById("resultsBody");

        const rawOcrBox =
            document.getElementById("rawOcr");

        const photoCount =
            document.getElementById("photoCount");

        const iccidCount =
            document.getElementById("iccidCount");

        const lpaCount =
            document.getElementById("lpaCount");

        const pinPukCount =
            document.getElementById("pinPukCount");


        /* =====================================================
           VARIABLES
           ===================================================== */

        let selectedFiles = [];

        let scanResults = [];

        let ocrWorker = null;

        let qrReader = null;

        let barcodeReader = null;


        const MAX_IMAGE_SIZE = 3200;


        /* =====================================================
           STATUS
           ===================================================== */

        function setStatus(message) {

            statusBox.textContent = message;

            console.log(message);

        }


        /* =====================================================
           CHECK LIBRARIES
           ===================================================== */

        function checkLibraries() {

            console.log(
                "jsQR:",
                typeof jsQR
            );

            console.log(
                "Tesseract:",
                typeof Tesseract
            );

            console.log(
                "ZXing:",
                typeof ZXing
            );


            if (
                typeof jsQR === "undefined"
            ) {

                setStatus(
                    "ERROR: jsQR failed to load."
                );

            }

        }


        /* =====================================================
           UPLOAD BUTTON
           ===================================================== */

        uploadButton.addEventListener(
            "click",
            function () {

                console.log(
                    "Upload button clicked"
                );

                fileInput.value = "";

                fileInput.click();

            }
        );


        /* =====================================================
           CAMERA BUTTON
           ===================================================== */

        cameraButton.addEventListener(
            "click",
            function () {

                console.log(
                    "Camera button clicked"
                );

                cameraInput.value = "";

                cameraInput.click();

            }
        );


        /* =====================================================
           FILE SELECTED
           ===================================================== */

        fileInput.addEventListener(
            "change",
            async function (event) {

                console.log(
                    "File input changed"
                );


                const files =
                    Array.from(
                        event.target.files || []
                    );


                console.log(
                    "Selected files:",
                    files
                );


                if (
                    files.length === 0
                ) {

                    setStatus(
                        "No photo selected."
                    );

                    return;

                }


                selectedFiles = files;


                await startScanning();

            }
        );


        /* =====================================================
           CAMERA PHOTO SELECTED
           ===================================================== */

        cameraInput.addEventListener(
            "change",
            async function (event) {

                const files =
                    Array.from(
                        event.target.files || []
                    );


                if (
                    files.length === 0
                ) {

                    setStatus(
                        "No photo captured."
                    );

                    return;

                }


                selectedFiles = files;


                await startScanning();

            }
        );


        /* =====================================================
           LOAD IMAGE
           ===================================================== */

        function loadImage(file) {

            return new Promise(
                function (resolve, reject) {

                    const image =
                        new Image();

                    const url =
                        URL.createObjectURL(
                            file
                        );


                    image.onload =
                        function () {

                            URL.revokeObjectURL(
                                url
                            );

                            resolve(image);

                        };


                    image.onerror =
                        function () {

                            URL.revokeObjectURL(
                                url
                            );

                            reject(
                                new Error(
                                    "Could not load image: " +
                                    file.name
                                )
                            );

                        };


                    image.src = url;

                }
            );

        }


        /* =====================================================
           CREATE CANVAS
           ===================================================== */

        function makeCanvas(
            image,
            crop,
            mode
        ) {

            const originalWidth =
                image.naturalWidth;

            const originalHeight =
                image.naturalHeight;


            let sx = 0;

            let sy = 0;

            let sw =
                originalWidth;

            let sh =
                originalHeight;


            if (crop) {

                sx =
                    Math.floor(
                        originalWidth *
                        crop.x
                    );

                sy =
                    Math.floor(
                        originalHeight *
                        crop.y
                    );

                sw =
                    Math.floor(
                        originalWidth *
                        crop.width
                    );

                sh =
                    Math.floor(
                        originalHeight *
                        crop.height
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
                    Math.floor(
                        sw * scale
                    )
                );


            const height =
                Math.max(
                    1,
                    Math.floor(
                        sh * scale
                    )
                );


            const canvas =
                document.createElement(
                    "canvas"
                );


            canvas.width =
                width;

            canvas.height =
                height;


            const ctx =
                canvas.getContext(
                    "2d",
                    {
                        willReadFrequently:
                            true
                    }
                );


            ctx.drawImage(
                image,
                sx,
                sy,
                sw,
                sh,
                0,
                0,
                width,
                height
            );


            if (
                mode === "gray" ||
                mode === "threshold"
            ) {

                const imageData =
                    ctx.getImageData(
                        0,
                        0,
                        width,
                        height
                    );


                for (
                    let i = 0;
                    i < imageData.data.length;
                    i += 4
                ) {

                    let gray =
                        0.299 *
                        imageData.data[i] +

                        0.587 *
                        imageData.data[i + 1] +

                        0.114 *
                        imageData.data[i + 2];


                    if (
                        mode === "threshold"
                    ) {

                        gray =
                            gray > 145
                                ? 255
                                : 0;

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


        /* =====================================================
           QR AREAS
           ===================================================== */

        const QR_AREAS = [

            {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            },

            {
                x: 0.35,
                y: 0,
                width: 0.65,
                height: 0.80
            },

            {
                x: 0.45,
                y: 0,
                width: 0.55,
                height: 0.75
            },

            {
                x: 0.30,
                y: 0.05,
                width: 0.70,
                height: 0.75
            }

        ];


        /* =====================================================
           BARCODE AREAS
           ===================================================== */

        const BARCODE_AREAS = [

            {
                x: 0,
                y: 0.45,
                width: 1,
                height: 0.55
            },

            {
                x: 0.10,
                y: 0.50,
                width: 0.90,
                height: 0.50
            },

            {
                x: 0.20,
                y: 0.55,
                width: 0.80,
                height: 0.45
            },

            {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            }

        ];


        /* =====================================================
           PIN / PUK AREAS
           ===================================================== */

        const PIN_PUK_AREAS = [

            {
                x: 0,
                y: 0,
                width: 0.70,
                height: 0.55
            },

            {
                x: 0,
                y: 0,
                width: 0.80,
                height: 0.65
            },

            {
                x: 0,
                y: 0.05,
                width: 0.65,
                height: 0.55
            },

            {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            }

        ];


        /* =====================================================
           QR USING jsQR
           ===================================================== */

        function scanQRCanvas(canvas) {

            if (
                typeof jsQR !== "function"
            ) {

                return "";

            }


            try {

                const ctx =
                    canvas.getContext(
                        "2d",
                        {
                            willReadFrequently:
                                true
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
                    jsQR(
                        imageData.data,
                        imageData.width,
                        imageData.height,
                        {
                            inversionAttempts:
                                "attemptBoth"
                        }
                    );


                if (
                    result &&
                    result.data
                ) {

                    return result.data;

                }

            } catch (error) {

                console.log(
                    "jsQR error:",
                    error
                );

            }


            return "";

        }


        /* =====================================================
           QR SCAN
           ===================================================== */

        async function scanQR(image) {

            setStatus(
                "Scanning QR code / LPA..."
            );


            for (
                const area of QR_AREAS
            ) {

                for (
                    const mode of [
                        "normal",
                        "gray",
                        "threshold"
                    ]
                ) {

                    const canvas =
                        makeCanvas(
                            image,
                            area,
                            mode
                        );


                    /* jsQR */

                    const qr =
                        scanQRCanvas(
                            canvas
                        );


                    if (qr) {

                        console.log(
                            "QR found:",
                            qr
                        );

                        return qr;

                    }


                    /* ZXing */

                    if (
                        qrReader
                    ) {

                        try {

                            const result =
                                await qrReader.decodeFromCanvas(
                                    canvas
                                );


                            if (
                                result
                            ) {

                                return result.getText();

                            }

                        } catch (_) {}

                    }

                }

            }


            return "";

        }


        /* =====================================================
           BARCODE SCAN
           ===================================================== */

        async function scanBarcode(image) {

            setStatus(
                "Scanning barcode for ICCID..."
            );


            if (
                !barcodeReader
            ) {

                return "";

            }


            for (
                const area of BARCODE_AREAS
            ) {

                for (
                    const mode of [
                        "normal",
                        "gray",
                        "threshold"
                    ]
                ) {

                    const canvas =
                        makeCanvas(
                            image,
                            area,
                            mode
                        );


                    try {

                        const result =
                            await barcodeReader.decodeFromCanvas(
                                canvas
                            );


                        if (
                            result
                        ) {

                            const text =
                                result.getText();


                            console.log(
                                "Barcode:",
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

                                return digits;

                            }

                        }

                    } catch (_) {}

                }

            }


            return "";

        }


        /* =====================================================
           LOAD OCR
           ===================================================== */

        async function getOCRWorker() {

            if (
                ocrWorker
            ) {

                return ocrWorker;

            }


            if (
                typeof Tesseract ===
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
                await Tesseract.createWorker(
                    "eng",
                    1,
                    {
                        logger:
                            function (message) {

                                if (
                                    message &&
                                    message.status ===
                                    "recognizing text"
                                ) {

                                    const percent =
                                        Math.round(
                                            (
                                                message.progress ||
                                                0
                                            ) *
                                            100
                                        );


                                    setStatus(
                                        "OCR reading text: " +
                                        percent +
                                        "%"
                                    );

                                }

                            }
                    }
                );


            try {

                await ocrWorker.setParameters(
                    {
                        tessedit_pageseg_mode:
                            "6",

                        preserve_interword_spaces:
                            "1"
                    }
                );

            } catch (_) {}


            return ocrWorker;

        }


        /* =====================================================
           OCR IMAGE
           ===================================================== */

        async function readOCR(canvas) {

            const worker =
                await getOCRWorker();


            const result =
                await worker.recognize(
                    canvas
                );


            return (
                result &&
                result.data &&
                result.data.text
            )
                ? result.data.text
                : "";

        }


        /* =====================================================
           NORMALIZE OCR
           ===================================================== */

        function normalizeOCR(text) {

            return String(
                text || ""
            )
                .replace(
                    /[|]/g,
                    "I"
                )
                .replace(
                    /[\r\n]+/g,
                    "\n"
                );

        }


        /* =====================================================
           FIND PIN
           ===================================================== */

        function findPIN(text) {

            let t =
                normalizeOCR(
                    text
                );


            const patterns = [

                /PIN\s*[:.\-]?\s*(\d{4})/i,

                /P\s*I\s*N\s*[:.\-]?\s*(\d{4})/i,

                /P\s*1\s*N\s*[:.\-]?\s*(\d{4})/i,

                /P\s*IN\s*[:.\-]?\s*(\d{4})/i

            ];


            for (
                const pattern of patterns
            ) {

                const match =
                    t.match(
                        pattern
                    );


                if (
                    match
                ) {

                    return match[1];

                }

            }


            return "";

        }


        /* =====================================================
           FIND PUK
           ===================================================== */

        function findPUK(text) {

            let t =
                normalizeOCR(
                    text
                );


            const patterns = [

                /PUK\s*[:.\-]?\s*(\d{8})/i,

                /P\s*U\s*K\s*[:.\-]?\s*(\d{8})/i,

                /P\s*U\s*K\s*[:.\-]?\s*(\d{4}\s*\d{4})/i,

                /P\s*U\s*X\s*[:.\-]?\s*(\d{8})/i

            ];


            for (
                const pattern of patterns
            ) {

                const match =
                    t.match(
                        pattern
                    );


                if (
                    match
                ) {

                    return match[1]
                        .replace(
                            /\s/g,
                            ""
                        );

                }

            }


            return "";

        }


        /* =====================================================
           FIND ICCID FROM OCR
           ===================================================== */

        function findICCIDFromOCR(text) {

            let t =
                String(
                    text || ""
                );


            t =
                t
                    .replace(
                        /O/g,
                        "0"
                    )
                    .replace(
                        /o/g,
                        "0"
                    )
                    .replace(
                        /I/g,
                        "1"
                    )
                    .replace(
                        /l/g,
                        "1"
                    )
                    .replace(
                        /\|/g,
                        "1"
                    );


            /*
             * ICCID normally starts with 89.
             */

            const matches =
                t.match(
                    /89\d{16,20}/g
                );


            if (
                matches &&
                matches.length
            ) {

                return matches[0];

            }


            /*
             * General fallback.
             */

            const all =
                t.match(
                    /\d{18,22}/g
                );


            if (
                all &&
                all.length
            ) {

                return all[0];

            }


            return "";

        }


        /* =====================================================
           FIND LPA FROM OCR
           ===================================================== */

        function findLPAFromOCR(text) {

            const t =
                String(
                    text || ""
                );


            const lpaMatch =
                t.match(
                    /LPA\s*[:\-]?\s*[^\s]+/i
                );


            if (
                lpaMatch
            ) {

                return lpaMatch[0]
                    .replace(
                        /\s+/g,
                        ""
                    );

            }


            /*
             * Standard activation-code fallback.
             */

            const activation =
                t.match(
                    /1\$[A-Za-z0-9._:+\/=-]+\$[A-Za-z0-9._:+\/=-]+/
                );


            if (
                activation
            ) {

                return activation[0];

            }


            return "";

        }


        /* =====================================================
           SCAN PIN / PUK
           ===================================================== */

        async function scanPINPUK(image) {

            let bestText = "";

            let foundPIN = "";

            let foundPUK = "";


            for (
                const area of PIN_PUK_AREAS
            ) {

                for (
                    const mode of [
                        "normal",
                        "gray",
                        "threshold"
                    ]
                ) {

                    const canvas =
                        makeCanvas(
                            image,
                            area,
                            mode
                        );


                    const text =
                        await readOCR(
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
                        findPIN(
                            text
                        );


                    const puk =
                        findPUK(
                            text
                        );


                    if (
                        pin
                    ) {

                        foundPIN =
                            pin;

                    }


                    if (
                        puk
                    ) {

                        foundPUK =
                            puk;

                    }


                    if (
                        foundPIN &&
                        foundPUK
                    ) {

                        return {

                            pin:
                                foundPIN,

                            puk:
                                foundPUK,

                            text:
                                bestText

                        };

                    }

                }

            }


            return {

                pin:
                    foundPIN,

                puk:
                    foundPUK,

                text:
                    bestText

            };

        }


        /* =====================================================
           PREVIEW PHOTO
           ===================================================== */

        function showPreview(file) {

            const box =
                document.createElement(
                    "div"
                );


            box.className =
                "preview-card";


            const title =
                document.createElement(
                    "h3"
                );


            title.textContent =
                file.name;


            const image =
                document.createElement(
                    "img"
                );


            image.src =
                URL.createObjectURL(
                    file
                );


            image.onload =
                function () {

                    URL.revokeObjectURL(
                        image.src
                    );

                };


            box.appendChild(
                title
            );


            box.appendChild(
                image
            );


            previewGrid.appendChild(
                box
            );

        }


        /* =====================================================
           UPDATE SUMMARY
           ===================================================== */

        function updateSummary() {

            photoCount.textContent =
                scanResults.length;


            let iccid = 0;

            let lpa = 0;

            let pinPuk = 0;


            scanResults.forEach(
                function (item) {

                    if (
                        item.iccid
                    ) {

                        iccid++;

                    }


                    if (
                        item.lpa
                    ) {

                        lpa++;

                    }


                    if (
                        item.pin &&
                        item.puk
                    ) {

                        pinPuk++;

                    }

                }
            );


            iccidCount.textContent =
                iccid;


            lpaCount.textContent =
                lpa;


            pinPukCount.textContent =
                pinPuk;

        }


        /* =====================================================
           DISPLAY RESULTS
           ===================================================== */

        function displayResults() {

            resultsBody.innerHTML = "";


            if (
                scanResults.length === 0
            ) {

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


            scanResults.forEach(
                function (item, index) {

                    const row =
                        document.createElement(
                            "tr"
                        );


                    const values = [

                        index + 1,

                        item.fileName,

                        item.iccid,

                        item.lpa,

                        item.pin,

                        item.puk,

                        item.confidence

                    ];


                    values.forEach(
                        function (value) {

                            const cell =
                                document.createElement(
                                    "td"
                                );


                            cell.textContent =
                                value || "Not found";


                            if (
                                value
                            ) {

                                cell.className =
                                    "value";

                            } else {

                                cell.className =
                                    "missing";

                            }


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


            updateSummary();

        }


        /* =====================================================
           SCAN ONE PHOTO
           ===================================================== */

        async function scanOnePhoto(file) {

            setStatus(
                "Opening photo: " +
                file.name
            );


            const image =
                await loadImage(
                    file
                );


            console.log(
                "Image size:",
                image.naturalWidth,
                image.naturalHeight
            );


            showPreview(file);


            /* ================================================
               QR / LPA
               ================================================ */

            let qrData =
                await scanQR(
                    image
                );


            /* ================================================
               BARCODE / ICCID
               ================================================ */

            let iccid =
                await scanBarcode(
                    image
                );


            /* ================================================
               PIN / PUK
               ================================================ */

            const pinPuk =
                await scanPINPUK(
                    image
                );


            let ocrText =
                pinPuk.text || "";


            /* ================================================
               FULL CARD OCR FALLBACK
               ================================================ */

            if (
                !iccid ||
                !qrData ||
                !pinPuk.pin ||
                !pinPuk.puk
            ) {

                setStatus(
                    "Running full-card OCR..."
                );


                const fullCanvas =
                    makeCanvas(
                        image,
                        null,
                        "normal"
                    );


                const fullText =
                    await readOCR(
                        fullCanvas
                    );


                ocrText +=
                    "\n\n" +
                    fullText;


                if (
                    !iccid
                ) {

                    iccid =
                        findICCIDFromOCR(
                            fullText
                        );

                }


                if (
                    !qrData
                ) {

                    qrData =
                        findLPAFromOCR(
                            fullText
                        );

                }

            }


            /* ================================================
               FINAL PIN
               ================================================ */

            let pin =
                pinPuk.pin;


            if (
                !pin
            ) {

                pin =
                    findPIN(
                        ocrText
                    );

            }


            /* ================================================
               FINAL PUK
               ================================================ */

            let puk =
                pinPuk.puk;


            if (
                !puk
            ) {

                puk =
                    findPUK(
                        ocrText
                    );

            }


            /* ================================================
               CONFIDENCE
               ================================================ */

            let found = 0;


            if (
                iccid
            ) {

                found++;

            }


            if (
                qrData
            ) {

                found++;

            }


            if (
                pin
            ) {

                found++;

            }


            if (
                puk
            ) {

                found++;

            }


            const confidence =
                (
                    found * 25
                ) + "%";


            /* ================================================
               OCR DISPLAY
               ================================================ */

            rawOcrBox.textContent +=
                "\n\n" +
                "===== " +
                file.name +
                " =====\n\n" +
                ocrText;


            return {

                fileName:
                    file.name,

                iccid:
                    iccid,

                lpa:
                    qrData,

                pin:
                    pin,

                puk:
                    puk,

                confidence:
                    confidence

            };

        }


        /* =====================================================
           INITIALIZE ZXING
           ===================================================== */

        function initializeZXing() {

            if (
                typeof ZXing ===
                "undefined"
            ) {

                console.log(
                    "ZXing not available"
                );

                return;

            }


            try {

                /*
                 * QR reader
                 */

                const qrHints =
                    new Map();


                qrHints.set(
                    ZXing.DecodeHintType.TRY_HARDER,
                    true
                );


                qrHints.set(
                    ZXing.DecodeHintType.POSSIBLE_FORMATS,
                    [
                        ZXing.BarcodeFormat.QR_CODE
                    ]
                );


                qrReader =
                    new ZXing.BrowserMultiFormatReader(
                        qrHints
                    );


                /*
                 * Barcode reader
                 */

                const barcodeHints =
                    new Map();


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

                        ZXing.BarcodeFormat.EAN_13,

                        ZXing.BarcodeFormat.EAN_8

                    ]
                );


                barcodeReader =
                    new ZXing.BrowserMultiFormatReader(
                        barcodeHints
                    );


                console.log(
                    "ZXing initialized"
                );

            } catch (error) {

                console.error(
                    "ZXing initialization error:",
                    error
                );

            }

        }


        /* =====================================================
           START SCANNING
           ===================================================== */

        async function startScanning() {

            if (
                selectedFiles.length === 0
            ) {

                setStatus(
                    "Please upload a photo first."
                );

                return;

            }


            uploadButton.disabled =
                true;

            cameraButton.disabled =
                true;

            scanButton.disabled =
                true;


            previewGrid.innerHTML =
                "";

            rawOcrBox.textContent =
                "";

            scanResults =
                [];


            displayResults();


            try {

                initializeZXing();


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


                    scanResults.push(
                        result
                    );


                    displayResults();

                }


                setStatus(
                    "Scan completed."
                );

            } catch (error) {

                console.error(
                    "Scanning error:",
                    error
                );


                setStatus(
                    "ERROR: " +
                    (
                        error.message ||
                        String(error)
                    )
                );

            }


            uploadButton.disabled =
                false;

            cameraButton.disabled =
                false;

            scanButton.disabled =
                false;

        }


        /* =====================================================
           SCAN AGAIN
           ===================================================== */

        scanButton.addEventListener(
            "click",
            async function () {

                if (
                    selectedFiles.length === 0
                ) {

                    setStatus(
                        "Please upload a photo first."
                    );

                    return;

                }


                await startScanning();

            }
        );


        /* =====================================================
           CLEAR
           ===================================================== */

        clearButton.addEventListener(
            "click",
            function () {

                selectedFiles =
                    [];

                scanResults =
                    [];


                fileInput.value =
                    "";

                cameraInput.value =
                    "";


                previewGrid.innerHTML =
                    "";


                rawOcrBox.textContent =
                    "OCR text will appear here after scanning.";


                displayResults();


                setStatus(
                    "Ready. Click Upload Photo and select an eSIM card photo."
                );

            }
        );


        /* =====================================================
           EXPORT CSV
           ===================================================== */

        exportButton.addEventListener(
            "click",
            function () {

                if (
                    scanResults.length === 0
                ) {

                    setStatus(
                        "No results to export."
                    );

                    return;

                }


                const header = [

                    "File Name",

                    "ICCID",

                    "QR / LPA Data",

                    "PIN",

                    "PUK",

                    "Confidence"

                ];


                const rows =
                    scanResults.map(
                        function (item) {

                            return [

                                item.fileName,

                                item.iccid,

                                item.lpa,

                                item.pin,

                                item.puk,

                                item.confidence

                            ];

                        }
                    );


                const csv =
                    [
                        header,
                        ...rows
                    ]
                        .map(
                            function (row) {

                                return row
                                    .map(
                                        function (value) {

                                            return '"' +
                                                String(
                                                    value || ""
                                                ).replace(
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
                    "esim_scan_results.csv";


                document.body.appendChild(
                    link
                );


                link.click();


                document.body.removeChild(
                    link
                );


                URL.revokeObjectURL(
                    url
                );

            }
        );


        /* =====================================================
           INITIAL PAGE LOAD
           ===================================================== */

        checkLibraries();


        setStatus(
            "Ready. Click Upload Photo and select an eSIM card photo."
        );


        console.log(
            "eSIM Scanner loaded successfully."
        );

    }
);