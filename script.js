const fileInput = document.getElementById('fileInput');
const preview = document.getElementById('preview');
const processBtn = document.getElementById('processBtn');
const loader = document.getElementById('loader');
const tableBody = document.querySelector('#masterTable tbody');

let historyData = [];
let currentImgBase64 = null;

// 1. Handle File Selection
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentImgBase64 = event.target.result;
            preview.src = currentImgBase64;
            preview.style.display = 'block';
            processBtn.disabled = false;
        };
        reader.readAsDataURL(file);
    }
});

// 2. Main Process Logic
processBtn.addEventListener('click', async () => {
    loader.style.display = 'block';
    processBtn.disabled = true;

    try {
        // --- STEP A: QR SCAN (LPA) ---
        const lpa = await scanQR(currentImgBase64);

        // --- STEP B: IMAGE PRE-PROCESSING (Crucial for Accuracy) ---
        // We create a high-contrast version of the image for the OCR
        const processedImage = await preprocessImage(currentImgBase64);

        // --- STEP C: OCR SCAN (ICCID, PIN, PUK) ---
        const { data: { text } } = await Tesseract.recognize(processedImage, 'eng');
        console.log("Raw OCR Data:", text);

        // Extract using patterns
        const iccid = text.match(/89\d{16,18}/) ? text.match(/89\d{16,18}/)[0] : "Not Found";
        const pin = text.match(/PIN[:\s]*(\d{4})/i) ? text.match(/PIN[:\s]*(\d{4})/i)[1] : "Not Found";
        const puk = text.match(/PUK[:\s]*(\d{8})/i) ? text.match(/PUK[:\s]*(\d{8})/i)[1] : "Not Found";

        // 3. Record to History
        const entry = {
            time: new Date().toLocaleTimeString(),
            iccid: iccid,
            pin: pin,
            puk: puk,
            lpa: lpa || "QR Not Found"
        };

        historyData.unshift(entry); // Newest at top
        renderTable();
        
        // Reset
        preview.style.display = 'none';
        fileInput.value = "";
        alert("Record Saved!");

    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        loader.style.display = 'none';
        processBtn.disabled = false;
    }
});

// Helper: Preprocess Image for OCR (Turns it into high-contrast B&W)
async function preprocessImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            
            ctx.drawImage(img, 0, 0);
            
            // Apply Filters: Grayscale + High Contrast
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imageData.data;
            for (let i = 0; i < d.length; i += 4) {
                let r = d[i], g = d[i+1], b = d[i+2];
                let gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                // Thresholding: If darker than 128, make it black. Else white.
                let v = (gray > 128) ? 255 : 0; 
                d[i] = d[i+1] = d[i+2] = v;
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL());
        };
        img.src = src;
    });
}

// Helper: QR Scanner
async function scanQR(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(data.data, data.width, data.height);
            resolve(code ? code.data : null);
        };
        img.src = src;
    });
}

function renderTable() {
    tableBody.innerHTML = historyData.map(item => `
        <tr>
            <td>${item.time}</td>
            <td>'${item.iccid}</td>
            <td>${item.pin}</td>
            <td>${item.puk}</td>
            <td class="lpa-cell">${item.lpa}</td>
        </tr>
    `).join('');
}

document.getElementById('downloadBtn').addEventListener('click', () => {
    if (historyData.length === 0) return;
    let csv = "Time,ICCID,PIN,PUK,LPA Code\n";
    historyData.forEach(r => {
        csv += `${r.time},'${r.iccid},${r.pin},${r.puk},"${r.lpa}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Batch_Report.csv`; a.click();
});