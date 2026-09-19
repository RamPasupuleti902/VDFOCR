"use strict";


/* ============================================================
   eSIM CARD SCANNER
   ============================================================ */


document.addEventListener(
    "DOMContentLoaded",
    function () {


        console.log(
            "================================="
        );

        console.log(
            "eSIM SCANNER: code.js loaded"
        );

        console.log(
            "================================="
        );


        /* ======================================================
           GET HTML ELEMENTS
        ====================================================== */

        const fileInput =
            document.getElementById(
                "fileInput"
            );


        const cameraInput =
            document.getElementById(
                "cameraInput"
            );


        const scanButton =
            document.getElementById(
                "scanButton"
            );


        const exportButton =
            document.getElementById(
                "exportButton"
            );


        const clearButton =
            document.getElementById(
                "clearButton"
            );


        const status =
            document.getElementById(
                "status"
            );


        const previewGrid =
            document.getElementById(
                "previewGrid"
            );


        const resultsBody =
            document.getElementById(
                "resultsBody"
            );


        const rawOcr =
            document.getElementById(
                "rawOcr"
            );


        const photoCount =
            document.getElementById(
                "photoCount"
            );


        const iccidCount =
            document.getElementById(
                "iccidCount"
            );


        const lpaCount =
            document.getElementById(
                "lpaCount"
            );


        const pinPukCount =
            document.getElementById(
                "pinPukCount"
            );


        /* ======================================================
           VARIABLES
        ====================================================== */

        let selectedFiles = [];

        let results = [];

        let ocrWorker = null;


        /* ======================================================
           STATUS
        ====================================================== */

        function setStatus(message) {

            status.textContent =
                message;


            console.log(
                "[STATUS]",
                message
            );

        }


        /* ======================================================
           CHECK LIBRARIES
        ====================================================== */

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


        setStatus(
            "JavaScript loaded successfully. Ready to upload."
        );


        /* ======================================================
           FILE SELECTED
        ====================================================== */

        fileInput.addEventListener(
            "change",
            async function (event) {

                console.log(
                    "================================="
                );

                console.log(
                    "FILE INPUT CHANGE"
                );

                console.log(
                    "================================="
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


                selectedFiles =
                    files;


                /*
                 * SHOW PHOTO IMMEDIATELY.
                 *
                 * This happens BEFORE OCR.
                 */

                showPreviews();


                setStatus(
                    files.length +
                    " photo(s) selected. Starting scan..."
                );


                await startScanning();

            }
        );


        /* ======================================================
           CAMERA SELECTED
        ====================================================== */

        cameraInput.addEventListener(
            "change",
            async function (event) {

                console.log(
                    "CAMERA INPUT CHANGE"
                );


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


                showPreviews();


                await startScanning();

            }
        );


        /* ======================================================
           SHOW PREVIEWS
        ====================================================== */

        function showPreviews() {

            previewGrid.innerHTML =
                "";


            selectedFiles.forEach(
                function (file, index) {

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
                        (
                            index + 1
                        ) +
                        ". " +
                        file.name;


                    const image =
                        document.createElement(
                            "img"
                        );


                    const objectUrl =
                        URL.createObjectURL(
                            file
                        );


                    image.src =
                        objectUrl;


                    image.onload =
                        function () {

                            URL.revokeObjectURL(
                                objectUrl
                            );

                        };


                    card.appendChild(
                        title
                    );


                    card.appendChild(
                        image
                    );


                    previewGrid.appendChild(
                        card
                    );

                }
            );


            photoCount.textContent =
                selectedFiles.length;

        }


        /* ======================================================
           LOAD IMAGE
        ====================================================== */

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


                            resolve(
                                image
                            );

                        };


                    image.onerror =
                        function () {

                            URL.revokeObjectURL(
                                url
                            );


                            reject(
                                new Error(
                                    "Could not load image."
                                )
                            );

                        };


                    image.src =
                        url;

                }
            );

        }


        /* ======================================================
           CREATE CANVAS
        ====================================================== */

        function createCanvas(
            image,
            crop
        ) {

            const width =
                image.naturalWidth ||
                image.width;


            const height =
                image.naturalHeight ||
                image.height;


            let x =
                0;


            let y =
                0;


            let w =
                width;


            let h =
                height;


            if (
                crop
            ) {

                x =
                    Math.floor(
                        width *
                        crop.x
                    );


                y =
                    Math.floor(
                        height *
                        crop.y
                    );


                w =
                    Math.floor(
                        width *
                        crop.width
                    );


                h =
                    Math.floor(
                        height *
                        crop.height
                    );

            }


            /*
             * Limit canvas size.
             */

            const max =
                3000;


            const scale =
                Math.min(
                    1,
                    max /
                    Math.max(
                        w,
                        h
                    )
                );


            const canvas =
                document.createElement(
                    "canvas"
                );


            canvas.width =
                Math.max(
                    1,
                    Math.floor(
                        w *
                        scale
                    )
                );


            canvas.height =
                Math.max(
                    1,
                    Math.floor(
                        h *
                        scale
                    )
                );


            const context =
                canvas.getContext(
                    "2d",
                    {
                        willReadFrequently:
                            true
                    }
                );


            context.drawImage(
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


        /* ======================================================
           QR SCAN
        ====================================================== */

        function scanQRCanvas(canvas) {

            if (
                typeof window.jsQR !==
                "function"
            ) {

                console.log(
                    "jsQR is not available."
                );

                return "";

            }


            try {

                const context =
                    canvas.getContext(
                        "2d",
                        {
                            willReadFrequently:
                                true
                        }
                    );


                const imageData =
                    context.getImageData(
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


                if (
                    code &&
                    code.data
                ) {

                    console.log(
                        "QR FOUND:",
                        code.data
                    );


                    return code.data;

                }

            }
            catch (error) {

                console.error(
                    "QR error:",
                    error
                );

            }


            return "";

        }


        /* ======================================================
           QR SCAN
        ====================================================== */

        async function scanQR(image) {

            setStatus(
                "Scanning QR code..."
            );


            const areas = [

                {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1
                },

                {
                    x: 0.25,
                    y: 0,
                    width: 0.75,
                    height: 0.8
                },

                {
                    x: 0,
                    y: 0,
                    width: 0.8,
                    height: 0.8
                },

                {
                    x: 0.2,
                    y: 0.1,
                    width: 0.8,
                    height: 0.8
                }

            ];


            for (
                const area of areas
            ) {

                const canvas =
                    createCanvas(
                        image,
                        area
                    );


                const result =
                    scanQRCanvas(
                        canvas
                    );


                if (
                    result
                ) {

                    return result;

                }

            }


            return "";

        }


        /* ======================================================
           BARCODE SCAN
        ====================================================== */

        async function scanBarcode(image) {

            setStatus(
                "Scanning ICCID barcode..."
            );


            if (
                typeof window.ZXing ===
                "undefined"
            ) {

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
                        y: 0.35,
                        width: 1,
                        height: 0.65
                    },

                    {
                        x: 0,
                        y: 0.5,
                        width: 1,
                        height: 0.5
                    },

                    {
                        x: 0.1,
                        y: 0.4,
                        width: 0.9,
                        height: 0.6
                    },

                    {
                        x: 0,
                        y: 0,
                        width: 1,
                        height: 1
                    }

                ];


                for (
                    const area of areas
                ) {

                    const canvas =
                        createCanvas(
                            image,
                            area
                        );


                    try {

                        const result =
                            await reader.decodeFromCanvas(
                                canvas
                            );


                        if (
                            result
                        ) {

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


                            /*
                             * ICCID normally has
                             * around 19-20 digits.
                             */

                            if (
                                digits.length >= 18 &&
                                digits.length <= 22
                            ) {

                                return digits;

                            }

                        }

                    }
                    catch (error) {

                        /*
                         * Continue with
                         * another crop.
                         */

                    }

                }

            }
            catch (error) {

                console.error(
                    "Barcode scanner error:",
                    error
                );

            }


            return "";

        }


        /* ======================================================
           OCR WORKER
        ====================================================== */

        async function getOCRWorker() {

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


            setStatus(
                "Loading OCR engine..."
            );


            ocrWorker =
                await window.Tesseract.createWorker(
                    "eng",
                    1,
                    {
                        logger:
                            function (message) {

                                if (
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
                                        "Reading card text: " +
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
            catch (error) {

                console.log(
                    "OCR parameter warning:",
                    error
                );

            }


            return ocrWorker;

        }


        /* ======================================================
           OCR IMAGE
        ====================================================== */

        async function runOCR(canvas) {

            const worker =
                await getOCRWorker();


            const result =
                await worker.recognize(
                    canvas
                );


            if (
                result &&
                result.data
            ) {

                return result.data.text ||
                    "";

            }


            return "";

        }


        /* ======================================================
           FIND PIN
        ====================================================== */

        function findPIN(text) {

            if (
                !text
            ) {

                return "";

            }


            const clean =
                text
                    .replace(
                        /\r/g,
                        ""
                    )
                    .replace(
                        /\|/g,
                        "I"
                    );


            const patterns = [

                /PIN\s*[:\-]?\s*(\d{4})/i,

                /P\s*I\s*N\s*[:\-]?\s*(\d{4})/i,

                /P1N\s*[:\-]?\s*(\d{4})/i,

                /P\s*IN\s*[:\-]?\s*(\d{4})/i

            ];


            for (
                const pattern of patterns
            ) {

                const match =
                    clean.match(
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
           FIND PUK
        ====================================================== */

        function findPUK(text) {

            if (
                !text
            ) {

                return "";

            }


            const clean =
                text
                    .replace(
                        /\r/g,
                        ""
                    )
                    .replace(
                        /\|/g,
                        "I"
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
                    clean.match(
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
           FIND ICCID FROM OCR
        ====================================================== */

        function findICCID(text) {

            if (
                !text
            ) {

                return "";

            }


            let clean =
                text;


            clean =
                clean
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


            const matches =
                clean.match(
                    /89\d{16,20}/g
                );


            if (
                matches &&
                matches.length
            ) {

                /*
                 * Prefer the first ICCID-like
                 * number starting with 89.
                 */

                return matches[0];

            }


            return "";

        }


        /* ======================================================
           FIND LPA FROM OCR
        ====================================================== */

        function findLPA(text) {

            if (
                !text
            ) {

                return "";

            }


            const clean =
                text.replace(
                    /\s+/g,
                    ""
                );


            /*
             * Common LPA format.
             */

            const lpa =
                clean.match(
                    /LPA:[^,\s]+/i
                );


            if (
                lpa
            ) {

                return lpa[0];

            }


            /*
             * Another common activation format.
             */

            const activation =
                clean.match(
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
           OCR FULL CARD
        ====================================================== */

        async function scanCardText(image) {

            let allText =
                "";


            const areas = [

                {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1
                },

                {
                    x: 0,
                    y: 0,
                    width: 0.8,
                    height: 0.7
                },

                {
                    x: 0,
                    y: 0.25,
                    width: 1,
                    height: 0.75
                }

            ];


            for (
                const area of areas
            ) {

                const canvas =
                    createCanvas(
                        image,
                        area
                    );


                const text =
                    await runOCR(
                        canvas
                    );


                if (
                    text
                ) {

                    allText +=
                        "\n\n" +
                        text;

                }


                /*
                 * If PIN and PUK are already
                 * found, we don't need to
                 * perform all OCR crops.
                 */

                const pin =
                    findPIN(
                        allText
                    );


                const puk =
                    findPUK(
                        allText
                    );


                if (
                    pin &&
                    puk
                ) {

                    break;

                }

            }


            return allText;

        }


        /* ======================================================
           SCAN ONE PHOTO
        ====================================================== */

        async function scanOnePhoto(file) {

            console.log(
                "Scanning:",
                file.name
            );


            const image =
                await loadImage(
                    file
                );


            /*
             * 1. QR
             */

            const lpa =
                await scanQR(
                    image
                );


            /*
             * 2. Barcode
             */

            let iccid =
                await scanBarcode(
                    image
                );


            /*
             * 3. OCR
             */

            setStatus(
                "Reading PIN, PUK and card text..."
            );


            const ocrText =
                await scanCardText(
                    image
                );


            /*
             * 4. Extract values
             */

            const pin =
                findPIN(
                    ocrText
                );


            const puk =
                findPUK(
                    ocrText
                );


            /*
             * 5. ICCID OCR fallback
             */

            if (
                !iccid
            ) {

                iccid =
                    findICCID(
                        ocrText
                    );

            }


            /*
             * 6. LPA OCR fallback
             */

            let finalLPA =
                lpa;


            if (
                !finalLPA
            ) {

                finalLPA =
                    findLPA(
                        ocrText
                    );

            }


            /*
             * 7. Confidence
             */

            let found =
                0;


            if (
                iccid
            ) {

                found++;

            }


            if (
                finalLPA
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
                    found *
                    25
                ) +
                "%";


            return {

                file:
                    file.name,

                iccid:
                    iccid,

                lpa:
                    finalLPA,

                pin:
                    pin,

                puk:
                    puk,

                confidence:
                    confidence,

                ocr:
                    ocrText

            };

        }


        /* ======================================================
           START SCANNING
        ====================================================== */

        async function startScanning() {

            if (
                selectedFiles.length === 0
            ) {

                setStatus(
                    "Please select a photo first."
                );

                return;

            }


            results =
                [];


            rawOcr.textContent =
                "";


            displayResults();


            scanButton.disabled =
                true;


            try {

                for (
                    let i = 0;
                    i < selectedFiles.length;
                    i++
                ) {

                    setStatus(
                        "Scanning photo " +
                        (
                            i + 1
                        ) +
                        " of " +
                        selectedFiles.length
                    );


                    const result =
                        await scanOnePhoto(
                            selectedFiles[i]
                        );


                    results.push(
                        result
                    );


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

            }
            catch (error) {

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

            }


            scanButton.disabled =
                false;

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
                function (result, index) {

                    const row =
                        document.createElement(
                            "tr"
                        );


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


                    resultsBody.appendChild(
                        row
                    );

                }
            );


            updateSummary();

        }


        /* ======================================================
           TABLE CELL
        ====================================================== */

        function addCell(
            row,
            value
        ) {

            const cell =
                document.createElement(
                    "td"
                );


            cell.textContent =
                value ||
                "";


            row.appendChild(
                cell
            );

        }


        /* ======================================================
           RESULT CELL
        ====================================================== */

        function addResultCell(
            row,
            value
        ) {

            const cell =
                document.createElement(
                    "td"
                );


            if (
                value
            ) {

                cell.textContent =
                    value;


                cell.className =
                    "found";

            }
            else {

                cell.textContent =
                    "Not found";


                cell.className =
                    "not-found";

            }


            row.appendChild(
                cell
            );

        }


        /* ======================================================
           SUMMARY
        ====================================================== */

        function updateSummary() {

            photoCount.textContent =
                results.length;


            iccidCount.textContent =
                results.filter(
                    function (item) {

                        return Boolean(
                            item.iccid
                        );

                    }
                ).length;


            lpaCount.textContent =
                results.filter(
                    function (item) {

                        return Boolean(
                            item.lpa
                        );

                    }
                ).length;


            pinPukCount.textContent =
                results.filter(
                    function (item) {

                        return (
                            item.pin &&
                            item.puk
                        );

                    }
                ).length;

        }


        /* ======================================================
           SCAN AGAIN
        ====================================================== */

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


                rawOcr.textContent =
                    "OCR text will appear here.";


                displayResults();


                setStatus(
                    "Ready. Click Upload Photo."
                );

            }
        );


        /* ======================================================
           EXPORT CSV
        ====================================================== */

        exportButton.addEventListener(
            "click",
            function () {

                if (
                    results.length === 0
                ) {

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

                        rows.push(
                            [

                                result.file,

                                result.iccid,

                                result.lpa,

                                result.pin,

                                result.puk,

                                result.confidence

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


                setStatus(
                    "CSV exported."
                );

            }
        );


        /* ======================================================
           INITIAL READY
        ====================================================== */

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

    }
);
