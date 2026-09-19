"use strict";


/* ============================================================
   eSIM SCANNER
   ICCID + LPA + PIN + PUK
   ============================================================ */


document.addEventListener(
    "DOMContentLoaded",
    function () {


        /* ======================================================
           ELEMENTS
           ====================================================== */

        const fileInput =
            document.getElementById("fileInput");

        const cameraInput =
            document.getElementById("cameraInput");

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


        /* ======================================================
           VARIABLES
           ====================================================== */

        let selectedFiles = [];

        let results = [];

        let qrReader = null;

        let barcodeReader = null;

        let ocrWorker = null;


        /* ======================================================
           STATUS
           ====================================================== */

        function status(message) {

            statusBox.textContent =
                message;

            console.log(
                "[eSIM]",
                message
            );

        }


        /* ======================================================
           VERIFY LIBRARIES
           ====================================================== */

        function verifyLibraries() {

            console.log(
                "jsQR:",
                typeof window.jsQR
            );

            console.log(
                "Tesseract:",
                typeof window.Tesseract
            );

            console.log(
                "ZXing:",
                typeof window.ZXing
            );

        }


        /* ======================================================
           FILE INPUT
           ====================================================== */

        fileInput.addEventListener(
            "change",
            async function (event) {

                console.log(
                    "FILE SELECTED"
                );


                const files =
                    Array.from(
                        event.target.files || []
                    );


                if (
                    files.length === 0
                ) {

                    status(
                        "No photo selected."
                    );

                    return;

                }


                selectedFiles =
                    files;


                console.log(
                    "Files:",
                    selectedFiles
                );


                await startScan();

            }
        );


        /* ======================================================
           CAMERA INPUT
           ====================================================== */

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

                    return;

                }


                selectedFiles =
                    files;


                await startScan();

            }
        );


        /* ======================================================
           LOAD IMAGE
           ====================================================== */

        function loadImage(file) {

            return new Promise(
                function (resolve, reject) {

                    const img =
                        new Image();


                    const url =
                        URL.createObjectURL(
                            file
                        );


                    img.onload =
                        function () {

                            URL.revokeObjectURL(
                                url
                            );

                            resolve(img);

                        };


                    img.onerror =
                        function () {

                            URL.revokeObjectURL(
                                url
                            );

                            reject(
                                new Error(
                                    "Cannot open image"
                                )
                            );

                        };


                    img.src =
                        url;

                }
            );

        }


        /* ======================================================
           CANVAS
           ====================================================== */

        function createCanvas(
            image,
            crop,
            mode
        ) {

            const iw =
                image.naturalWidth;

            const ih =
                image.naturalHeight;


            let sx = 0;

            let sy = 0;

            let sw = iw;

            let sh = ih;


            if (
                crop
            ) {

                sx =
                    Math.floor(
                        iw * crop.x
                    );

                sy =
                    Math.floor(
                        ih * crop.y
                    );

                sw =
                    Math.floor(
                        iw * crop.width
                    );

                sh =
                    Math.floor(
                        ih * crop.height
                    );

            }


            const maxSize =
                3000;


            const scale =
                Math.min(
                    1,
                    maxSize /
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

                const data =
                    ctx.getImageData(
                        0,
                        0,
                        width,
                        height
                    );


                for (
                    let i = 0;
                    i < data.data.length;
                    i += 4
                ) {

                    let value =
                        0.299 *
                        data.data[i] +

                        0.587 *
                        data.data[i + 1] +

                        0.114 *
                        data.data[i + 2];


                    if (
                        mode === "threshold"
                    ) {

                        value =
                            value > 145
                                ? 255
                                : 0;

                    }


                    data.data[i] =
                        value;

                    data.data[i + 1] =
                        value;

                    data.data[i + 2] =
                        value;

                }


                ctx.putImageData(
                    data,
                    0,
                    0
                );

            }


            return canvas;

        }


        /* ======================================================
           AREAS
           ====================================================== */

        const FULL =
        {
            x: 0,
            y: 0,
            width: 1,
            height: 1
        };


        const QR_AREAS = [

            FULL,

            {
                x: 0.30,
                y: 0,
                width: 0.70,
                height: 0.80
            },

            {
                x: 0.40,
                y: 0,
                width: 0.60,
                height: 0.70
            },

            {
                x: 0.20,
                y: 0,
                width: 0.80,
                height: 0.90
            }

        ];


        const BARCODE_AREAS = [

            {
                x: 0,
                y: 0.40,
                width: 1,
                height: 0.60
            },

            {
                x: 0.10,
                y: 0.50,
                width: 0.90,
                height: 0.50
            },

            {
                x: 0,
                y: 0.55,
                width: 0.80,
                height: 0.45
            },

            FULL

        ];


        const OCR_AREAS = [

            {
                x: 0,
                y: 0,
                width: 0.75,
                height: 0.55
            },

            {
                x: 0,
                y: 0,
                width: 0.85,
                height: 0.70
            },

            FULL

        ];


        /* ======================================================
           QR WITH jsQR
           ====================================================== */

        function jsQRScan(canvas) {

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
                    window.jsQR(
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

            }
            catch (error) {

                console.log(
                    "jsQR error:",
                    error
                );

            }


            return "";

        }


        /* ======================================================
           QR
           ====================================================== */

        async function scanQR(image) {

            status(
                "Scanning QR code..."
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
                        createCanvas(
                            image,
                            area,
                            mode
                        );


                    /*
                     * First try jsQR.
                     */

                    const qr =
                        jsQRScan(
                            canvas
                        );


                    if (
                        qr
                    ) {

                        console.log(
                            "QR FOUND:",
                            qr
                        );

                        return qr;

                    }


                    /*
                     * Then try ZXing.
                     */

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

                        }
                        catch (_) {}

                    }

                }

            }


            return "";

        }


        /* ======================================================
           BARCODE
           ====================================================== */

        async function scanBarcode(image) {

            status(
                "Scanning ICCID barcode..."
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
                        createCanvas(
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
                                "BARCODE:",
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

                    }
                    catch (_) {}

                }

            }


            return "";

        }


        /* ======================================================
           OCR WORKER
           ====================================================== */

        async function getOCR() {

            if (
                ocrWorker
            ) {

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


            status(
                "Loading OCR..."
            );


            ocrWorker =
                await window.Tesseract.createWorker(
                    "eng",
                    1,
                    {
                        logger:
                            function (m) {

                                if (
                                    m &&
                                    m.status ===
                                    "recognizing text"
                                ) {

                                    const percent =
                                        Math.round(
                                            (
                                                m.progress ||
                                                0
                                            ) *
                                            100
                                        );


                                    status(
                                        "OCR: " +
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

            }
            catch (_) {}


            return ocrWorker;

        }


        /* ======================================================
           OCR
           ====================================================== */

        async function OCR(canvas) {

            const worker =
                await getOCR();


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


        /* ======================================================
           NORMALIZE
           ====================================================== */

        function normalize(text) {

            return String(
                text || ""
            )
                .replace(
                    /\|/g,
                    "I"
                )
                .replace(
                    /\r/g,
                    ""
                );

        }


        /* ======================================================
           PIN
           ====================================================== */

        function findPIN(text) {

            const t =
                normalize(
                    text
                );


            const patterns = [

                /PIN\s*[:\-]?\s*(\d{4})/i,

                /P\s*I\s*N\s*[:\-]?\s*(\d{4})/i,

                /P\s*1\s*N\s*[:\-]?\s*(\d{4})/i,

                /P\s*IN\s*[:\-]?\s*(\d{4})/i

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


        /* ======================================================
           PUK
           ====================================================== */

        function findPUK(text) {

            const t =
                normalize(
                    text
                );


            const patterns = [

                /PUK\s*[:\-]?\s*(\d{8})/i,

                /P\s*U\s*K\s*[:\-]?\s*(\d{8})/i,

                /P\s*U\s*K\s*[:\-]?\s*(\d{4})\s*(\d{4})/i,

                /P\s*U\s*X\s*[:\-]?\s*(\d{8})/i

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

                    if (
                        match[2]
                    ) {

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


        /* ======================================================
           ICCID OCR FALLBACK
           ====================================================== */

        function findICCID(text) {

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
             * ICCID starts with 89.
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


            return "";

        }


        /* ======================================================
           LPA OCR FALLBACK
           ====================================================== */

        function findLPA(text) {

            const t =
                String(
                    text || ""
                );


            const lpa =
                t.match(
                    /LPA\s*[:\-]?\s*[^\s]+/i
                );


            if (
                lpa
            ) {

                return lpa[0]
                    .replace(
                        /\s+/g,
                        ""
                    );

            }


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


        /* ======================================================
           OCR PIN / PUK
           ====================================================== */

        async function scanPINPUK(image) {

            let bestText = "";

            let pin = "";

            let puk = "";


            for (
                const area of OCR_AREAS
            ) {

                for (
                    const mode of [
                        "normal",
                        "gray",
                        "threshold"
                    ]
                ) {

                    const canvas =
                        createCanvas(
                            image,
                            area,
                            mode
                        );


                    const text =
                        await OCR(
                            canvas
                        );


                    if (
                        text.length >
                        bestText.length
                    ) {

                        bestText =
                            text;

                    }


                    const currentPIN =
                        findPIN(
                            text
                        );


                    const currentPUK =
                        findPUK(
                            text
                        );


                    if (
                        currentPIN
                    ) {

                        pin =
                            currentPIN;

                    }


                    if (
                        currentPUK
                    ) {

                        puk =
                            currentPUK;

                    }


                    if (
                        pin &&
                        puk
                    ) {

                        return {

                            pin:
                                pin,

                            puk:
                                puk,

                            text:
                                bestText

                        };

                    }

                }

            }


            return {

                pin:
                    pin,

                puk:
                    puk,

                text:
                    bestText

            };

        }


        /* ======================================================
           PREVIEW
           ====================================================== */

        function preview(file) {

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


            const img =
                document.createElement(
                    "img"
                );


            const url =
                URL.createObjectURL(
                    file
                );


            img.src =
                url;


            box.appendChild(
                title
            );


            box.appendChild(
                img
            );


            previewGrid.appendChild(
                box
            );

        }


        /* ======================================================
           DISPLAY RESULTS
           ====================================================== */

        function displayResults() {

            resultsBody.innerHTML =
                "";


            if (
                results.length === 0
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


            results.forEach(
                function (item, index) {

                    const row =
                        document.createElement(
                            "tr"
                        );


                    const values = [

                        index + 1,

                        item.file,

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
                                value ||
                                "Not found";


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


        /* ======================================================
           SUMMARY
           ====================================================== */

        function updateSummary() {

            photoCount.textContent =
                results.length;


            iccidCount.textContent =
                results.filter(
                    x => x.iccid
                ).length;


            lpaCount.textContent =
                results.filter(
                    x => x.lpa
                ).length;


            pinPukCount.textContent =
                results.filter(
                    x =>
                        x.pin &&
                        x.puk
                ).length;

        }


        /* ======================================================
           SCAN ONE PHOTO
           ====================================================== */

        async function scanPhoto(file) {

            status(
                "Opening " +
                file.name
            );


            const image =
                await loadImage(
                    file
                );


            preview(file);


            /*
             * QR
             */

            let lpa =
                await scanQR(
                    image
                );


            /*
             * ICCID
             */

            let iccid =
                await scanBarcode(
                    image
                );


            /*
             * PIN / PUK
             */

            const pinPuk =
                await scanPINPUK(
                    image
                );


            let text =
                pinPuk.text || "";


            /*
             * Full-card OCR fallback
             */

            if (
                !iccid ||
                !lpa ||
                !pinPuk.pin ||
                !pinPuk.puk
            ) {

                status(
                    "Running full-card OCR..."
                );


                const fullCanvas =
                    createCanvas(
                        image,
                        FULL,
                        "normal"
                    );


                const fullText =
                    await OCR(
                        fullCanvas
                    );


                text +=
                    "\n\n" +
                    fullText;


                if (
                    !iccid
                ) {

                    iccid =
                        findICCID(
                            fullText
                        );

                }


                if (
                    !lpa
                ) {

                    lpa =
                        findLPA(
                            fullText
                        );

                }

            }


            let pin =
                pinPuk.pin ||
                findPIN(
                    text
                );


            let puk =
                pinPuk.puk ||
                findPUK(
                    text
                );


            let found = 0;


            if (
                iccid
            ) {

                found++;

            }


            if (
                lpa
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


            rawOcrBox.textContent +=
                "\n\n============================\n" +
                file.name +
                "\n============================\n\n" +
                text;


            return {

                file:
                    file.name,

                iccid:
                    iccid,

                lpa:
                    lpa,

                pin:
                    pin,

                puk:
                    puk,

                confidence:
                    (
                        found * 25
                    ) + "%"

            };

        }


        /* ======================================================
           ZXING
           ====================================================== */

        function initializeZXing() {

            if (
                typeof window.ZXing ===
                "undefined"
            ) {

                console.warn(
                    "ZXing is not loaded."
                );

                return;

            }


            try {

                /*
                 * QR
                 */

                const qrHints =
                    new Map();


                qrHints.set(
                    window.ZXing.DecodeHintType.TRY_HARDER,
                    true
                );


                qrHints.set(
                    window.ZXing.DecodeHintType.POSSIBLE_FORMATS,
                    [
                        window.ZXing.BarcodeFormat.QR_CODE
                    ]
                );


                qrReader =
                    new window.ZXing.BrowserMultiFormatReader(
                        qrHints
                    );


                /*
                 * Barcode
                 */

                const barcodeHints =
                    new Map();


                barcodeHints.set(
                    window.ZXing.DecodeHintType.TRY_HARDER,
                    true
                );


                barcodeHints.set(
                    window.ZXing.DecodeHintType.POSSIBLE_FORMATS,
                    [

                        window.ZXing.BarcodeFormat.CODE_128,

                        window.ZXing.BarcodeFormat.CODE_39,

                        window.ZXing.BarcodeFormat.ITF,

                        window.ZXing.BarcodeFormat.EAN_13,

                        window.ZXing.BarcodeFormat.EAN_8

                    ]
                );


                barcodeReader =
                    new window.ZXing.BrowserMultiFormatReader(
                        barcodeHints
                    );


                console.log(
                    "ZXing ready"
                );

            }
            catch (error) {

                console.error(
                    "ZXing error:",
                    error
                );

            }

        }


        /* ======================================================
           START SCAN
           ====================================================== */

        async function startScan() {

            if (
                selectedFiles.length === 0
            ) {

                status(
                    "Please upload a photo."
                );

                return;

            }


            scanButton.disabled =
                true;


            results = [];


            previewGrid.innerHTML =
                "";


            rawOcrBox.textContent =
                "";


            displayResults();


            try {

                initializeZXing();


                for (
                    let i = 0;
                    i < selectedFiles.length;
                    i++
                ) {

                    status(
                        "Scanning photo " +
                        (
                            i + 1
                        ) +
                        " of " +
                        selectedFiles.length
                    );


                    const result =
                        await scanPhoto(
                            selectedFiles[i]
                        );


                    results.push(
                        result
                    );


                    displayResults();

                }


                status(
                    "Scan completed."
                );

            }
            catch (error) {

                console.error(
                    error
                );


                status(
                    "Error: " +
                    (
                        error.message ||
                        error
                    )
                );

            }


            scanButton.disabled =
                false;

        }


        /* ======================================================
           SCAN AGAIN
           ====================================================== */

        scanButton.addEventListener(
            "click",
            async function () {

                await startScan();

            }
        );


        /* ======================================================
           CLEAR
           ====================================================== */

        clearButton.addEventListener(
            "click",
            function () {

                selectedFiles =
                    [];

                results =
                    [];


                fileInput.value =
                    "";

                cameraInput.value =
                    "";


                previewGrid.innerHTML =
                    "";


                rawOcrBox.textContent =
                    "OCR text will appear here.";


                displayResults();


                status(
                    "Ready. Click Upload Photo."
                );

            }
        );


        /* ======================================================
           CSV EXPORT
           ====================================================== */

        exportButton.addEventListener(
            "click",
            function () {

                if (
                    results.length === 0
                ) {

                    status(
                        "Nothing to export."
                    );

                    return;

                }


                const rows = [

                    [
                        "File",
                        "ICCID",
                        "LPA / QR",
                        "PIN",
                        "PUK",
                        "Confidence"
                    ]

                ];


                results.forEach(
                    function (item) {

                        rows.push(
                            [

                                item.file,

                                item.iccid,

                                item.lpa,

                                item.pin,

                                item.puk,

                                item.confidence

                            ]
                        );

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
                                                    value ||
                                                    ""
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


                link.click();


                URL.revokeObjectURL(
                    url
                );

            }
        );


        /* ======================================================
           READY
           ====================================================== */

        verifyLibraries();


        status(
            "Ready. Click Upload Photo."
        );


    }
);