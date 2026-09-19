/* ==========================================================================
   CONFIG
   ========================================================================== */
const FUNCTION_URL   = '/.netlify/functions/verify';
const SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxXrrPh05ep23EKnDZT32cuMq7UDPclhi4CFL2YU9MXmzqwP16CkKTpY86Ffu0K5T6a/exec';
const SHEET_SECRET   = 'CHANGE_ME';          // must match SECRET in Code.gs

const TARGET_LONG_SIDE       = 2400;   // working resolution for decode passes
const LOWRES_THRESHOLD       = 900;    // flag photos smaller than this
const BLUR_VARIANCE_THRESHOLD= 110;
const MAX_OCR_PASSES         = 8;      // per image, keeps batch scanning quick

/* ==========================================================================
   DOM
   ========================================================================== */
const $ = id => document.getElementById(id);
const video=$('video'), overlay=$('overlay'), viewfinder=$('viewfinder');
const startBtn=$('startBtn'), stopBtn=$('stopBtn'), captureBtn=$('captureBtn'), torchBtn=$('torchBtn');
const chipQR=$('chipQR'), chipICCID=$('chipICCID');
const fileInput=$('fileInput'), pickBtn=$('pickBtn'), dropzone=$('dropzone');
const thumbsEl=$('thumbs'), progressEl=$('progress'), progressBar=$('progressBar');
const saveBtn=$('saveBtn'), downloadBtn=$('downloadBtn'), clearBtn=$('clearBtn');
const aiToggle=$('aiToggle'), statusEl=$('status'), tableHint=$('tableHint');
const historyBody=document.querySelector('#historyTable tbody');

let historyData=[], nextId=1, batchRunning=false;

function setStatus(msg,isError){
  statusEl.textContent=msg||'';
  statusEl.className=isError?'error':'';
  if(isError) console.error(msg);
}
function setProgress(done,total){
  if(!total){progressEl.classList.remove('on');progressBar.style.width='0';return;}
  progressEl.classList.add('on');
  progressBar.style.width=Math.round(done/total*100)+'%';
}

window.addEventListener('load',()=>{
  const missing=[];
  if(typeof Tesseract==='undefined') missing.push('Tesseract.js');
  if(typeof jsQR==='undefined')      missing.push('jsQR');
  if(missing.length) setStatus('These libraries did not load: '+missing.join(', ')+'. Check the connection or an ad blocker, then reload.',true);
  if(typeof ZXing==='undefined') console.warn('ZXing missing — barcode ICCID disabled, OCR fallback still runs.');
  if(location.protocol!=='https:'&&location.hostname!=='localhost'){
    setStatus('Opened over '+location.protocol+' — the live camera needs https. Uploading photos still works.');
  }
  renderTable();
});

/* ==========================================================================
   TESSERACT WORKERS  (root cause of the "setImage of null" crash)
   v5 signature: createWorker(lang, oem, options) — already initialised.
   v4 signature: createWorker(options) then loadLanguage + initialize.
   This handles both, so the worker is never handed to recognize() uninitialised.
   Workers are created once and reused — a fresh worker per pass was also the
   main reason scanning felt slow.
   ========================================================================== */
let _ocrWorker=null,_ocrPromise=null,_digitWorker=null,_digitPromise=null,_ocrLabel='Reading';

async function buildWorker(params){
  if(typeof Tesseract==='undefined'||typeof Tesseract.createWorker!=='function') throw new Error('Tesseract.js is not loaded');
  const opts={logger:m=>{ if(m&&m.status==='recognizing text') setStatus(_ocrLabel+' '+Math.round(m.progress*100)+'%'); }};
  let w;
  try { w=await Tesseract.createWorker('eng',1,opts); }
  catch(e){ w=await Tesseract.createWorker(opts); }
  if(!w) throw new Error('Could not create an OCR worker');
  if(typeof w.loadLanguage==='function'&&typeof w.initialize==='function'){
    try{ await w.loadLanguage('eng'); await w.initialize('eng'); }catch(e){ /* v5 deprecates these */ }
  }
  if(params){ try{ await w.setParameters(params); }catch(e){} }
  return w;
}
async function getOcrWorker(){
  if(_ocrWorker) return _ocrWorker;
  if(!_ocrPromise) _ocrPromise=buildWorker({tessedit_pageseg_mode:'6'}).then(w=>{_ocrWorker=w;return w;});
  try{ return await _ocrPromise; }catch(e){ _ocrPromise=null; console.warn('OCR worker failed:',e); return null; }
}
async function getDigitWorker(){
  if(_digitWorker) return _digitWorker;
  if(!_digitPromise) _digitPromise=buildWorker({tessedit_char_whitelist:'0123456789 ',tessedit_pageseg_mode:'6'}).then(w=>{_digitWorker=w;return w;});
  try{ return await _digitPromise; }catch(e){ _digitPromise=null; console.warn('Digit worker failed:',e); return null; }
}
async function ocrText(canvas,label){
  _ocrLabel=label||'Reading';
  const w=await getOcrWorker();
  if(!w) return '';
  try{ const r=await w.recognize(canvas); return (r&&r.data&&r.data.text)||''; }
  catch(e){ console.warn('OCR pass failed:',e); return ''; }
}
async function ocrDigits(canvas){
  const w=await getDigitWorker();
  if(!w) return '';
  try{ const r=await w.recognize(canvas); return (r&&r.data&&r.data.text)||''; }
  catch(e){ console.warn('Digit pass failed:',e); return ''; }
}

/* ==========================================================================
   ZXING READERS — one single-format reader each, so a frame holding BOTH a QR
   and a barcode can never return the wrong symbol.
   ========================================================================== */
let _qrReader=null,_barReader=null,_readersInit=false;
function makeReader(formats){
  if(typeof ZXing==='undefined') return null;
  try{
    const hints=new Map();
    hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,formats);
    return new ZXing.BrowserMultiFormatReader(hints);
  }catch(e){ console.warn('ZXing reader init failed:',e); return null; }
}
function initReaders(){
  if(_readersInit) return;
  _readersInit=true;
  if(typeof ZXing==='undefined') return;
  _qrReader =makeReader([ZXing.BarcodeFormat.QR_CODE]);
  _barReader=makeReader([ZXing.BarcodeFormat.CODE_128,ZXing.BarcodeFormat.CODE_39,ZXing.BarcodeFormat.ITF]);
}
function zxDecode(reader,canvas){
  if(!reader||!canvas) return null;
  try{
    const res=reader.decodeFromCanvas(canvas);
    if(!res) return null;
    return res.getText?res.getText():(res.text||null);
  }catch(e){ return null; }   // ZXing throws NotFoundException when nothing decodes
}

/* ==========================================================================
   CANVAS HELPERS
   ========================================================================== */
function toCanvas(src){
  const w=src.naturalWidth||src.width, h=src.naturalHeight||src.height;
  const c=document.createElement('canvas');
  c.width=w; c.height=h;
  c.getContext('2d').drawImage(src,0,0,w,h);
  return c;
}
function fitCanvas(img,size){
  const maxSide=Math.max(img.width,img.height);
  const scale=size/maxSide;
  const w=Math.max(1,Math.round(img.width*scale)), h=Math.max(1,Math.round(img.height*scale));
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(img,0,0,w,h);
  return c;
}
function cropCanvas(img,x0,y0,x1,y1){
  const sx=Math.max(0,Math.round(img.width*x0)), sy=Math.max(0,Math.round(img.height*y0));
  const ex=Math.min(img.width,Math.round(img.width*x1)), ey=Math.min(img.height,Math.round(img.height*y1));
  const sw=ex-sx, sh=ey-sy;
  if(sw<12||sh<12) return null;
  const scale=Math.min(3,Math.max(1,1800/sw));
  const c=document.createElement('canvas');
  c.width=Math.round(sw*scale); c.height=Math.round(sh*scale);
  const ctx=c.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
  return c;
}
function rotateCanvas(src,deg){
  const c=document.createElement('canvas');
  if(deg===90||deg===270){ c.width=src.height; c.height=src.width; } else { c.width=src.width; c.height=src.height; }
  const ctx=c.getContext('2d');
  ctx.translate(c.width/2,c.height/2);
  ctx.rotate(deg*Math.PI/180);
  ctx.drawImage(src,-src.width/2,-src.height/2);
  return c;
}
function grayOf(d,w,h,channel){
  const g=new Uint8ClampedArray(w*h);
  if(channel==='blue'){ for(let i=0,p=0;i<d.length;i+=4,p++) g[p]=d[i+2]; }
  else if(channel==='green'){ for(let i=0,p=0;i<d.length;i+=4,p++) g[p]=d[i+1]; }
  else { for(let i=0,p=0;i<d.length;i+=4,p++) g[p]=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114; }
  return g;
}
function sharpenGray(gray,w,h){
  const out=new Uint8ClampedArray(gray.length);
  const k=[0,-1,0,-1,5,-1,0,-1,0];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i=y*w+x;
    if(x===0||y===0||x===w-1||y===h-1){ out[i]=gray[i]; continue; }
    let sum=0,ki=0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) sum+=gray[i+dy*w+dx]*k[ki++];
    out[i]=sum;
  }
  return out;
}
function otsu(gray){
  const hist=new Array(256).fill(0);
  for(let i=0;i<gray.length;i++) hist[gray[i]]++;
  const total=gray.length;
  let sum=0; for(let t=0;t<256;t++) sum+=t*hist[t];
  let sumB=0,wB=0,varMax=0,threshold=127;
  for(let t=0;t<256;t++){
    wB+=hist[t]; if(wB===0) continue;
    const wF=total-wB; if(wF===0) break;
    sumB+=t*hist[t];
    const mB=sumB/wB,mF=(sum-sumB)/wF;
    const between=wB*wF*(mB-mF)*(mB-mF);
    if(between>varMax){ varMax=between; threshold=t; }
  }
  return threshold;
}
/* Binarise a canvas. `invert:true` produces DARK text on a LIGHT background, which is
   what Tesseract expects — Vodafone cards are white text on red, so the un-inverted
   result was white-on-black and read badly. Both polarities are now tried. */
function binarize(src,opts){
  const o=opts||{}, channel=o.channel||'luma', invert=!!o.invert, sharp=!!o.sharp;
  const w=src.width,h=src.height;
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d'); ctx.drawImage(src,0,0);
  const id=ctx.getImageData(0,0,w,h), d=id.data;
  let g=grayOf(d,w,h,channel);
  if(sharp) g=sharpenGray(g,w,h);
  const t=otsu(g);
  for(let i=0,p=0;i<d.length;i+=4,p++){
    const above=g[p]>t;
    const v=invert?(above?0:255):(above?255:0);
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  ctx.putImageData(id,0,0);
  return c;
}
function grayscaleSharp(src){
  const w=src.width,h=src.height;
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d'); ctx.drawImage(src,0,0);
  const id=ctx.getImageData(0,0,w,h),d=id.data;
  const g=sharpenGray(grayOf(d,w,h,'luma'),w,h);
  for(let i=0,p=0;i<d.length;i+=4,p++){ d[i]=d[i+1]=d[i+2]=g[p]; d[i+3]=255; }
  ctx.putImageData(id,0,0);
  return c;
}
function upscale(src,targetLong){
  const maxSide=Math.max(src.width,src.height);
  const scale=Math.max(1,Math.min(4,targetLong/maxSide));
  if(scale===1) return src;
  const c=document.createElement('canvas');
  c.width=Math.round(src.width*scale); c.height=Math.round(src.height*scale);
  const ctx=c.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(src,0,0,c.width,c.height);
  return c;
}
function laplacianVariance(canvas){
  const w=canvas.width,h=canvas.height;
  const d=canvas.getContext('2d').getImageData(0,0,w,h).data;
  const gray=new Float32Array(w*h);
  for(let i=0,p=0;i<d.length;i+=4,p++) gray[p]=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
  let sum=0,sumSq=0,count=0;
  for(let y=1;y<h-1;y+=2) for(let x=1;x<w-1;x+=2){
    const i=y*w+x;
    const lap=gray[i-w]+gray[i+w]+gray[i-1]+gray[i+1]-4*gray[i];
    sum+=lap; sumSq+=lap*lap; count++;
  }
  if(!count) return 0;
  const mean=sum/count;
  return sumSq/count-mean*mean;
}
function compressImage(img,maxSide,q){
  const md=Math.max(img.width,img.height);
  const scale=md>maxSide?maxSide/md:1;
  const c=document.createElement('canvas');
  c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',q);
}

/* ==========================================================================
   QR  →  LPA
   Tries the working-size image, a thresholded copy, quadrant crops (for photos
   where the card is small in frame) and rotations.
   ========================================================================== */
function decodeJsQR(canvas){
  try{
    const w=canvas.width,h=canvas.height;
    const id=canvas.getContext('2d').getImageData(0,0,w,h);
    const code=jsQR(id.data,w,h,{inversionAttempts:'attemptBoth'});
    return code?code.data:null;
  }catch(e){ return null; }
}
function findQR(base){
  const tries=[base];
  tries.push(binarize(base,{channel:'luma',invert:false}));
  // quadrants + centre, upscaled — rescues QRs that are small in a wide photo
  const boxes=[[0,0,.6,.6],[.4,0,1,.6],[0,.4,.6,1],[.4,.4,1,1],[.2,.2,.8,.8]];
  for(const b of boxes){ const c=cropCanvas(base,b[0],b[1],b[2],b[3]); if(c) tries.push(c); }

  for(const c of tries){
    if(typeof jsQR!=='undefined'){ const v=decodeJsQR(c); if(v) return v; }
  }
  initReaders();
  for(const c of tries){ const v=zxDecode(_qrReader,c); if(v) return v; }
  for(const deg of [90,180,270]){
    const r=rotateCanvas(base,deg);
    const v=(typeof jsQR!=='undefined'?decodeJsQR(r):null)||zxDecode(_qrReader,r);
    if(v) return v;
  }
  return null;
}

/* ==========================================================================
   BARCODE  →  ICCID  (authoritative — beats every OCR guess)
   ========================================================================== */
function barcodeCandidates(base){
  const out=[base];
  const bands=[[0,.40],[.25,.65],[.50,.85],[.60,1.0],[.30,1.0]];
  for(const b of bands){
    const band=cropCanvas(base,0,b[0],1,b[1]);
    if(!band) continue;
    out.push(band, grayscaleSharp(band), binarize(band,{channel:'luma',invert:false,sharp:true}));
  }
  out.push(rotateCanvas(base,90));       // sideways photos
  return out;
}
function findBarcodeIccid(base){
  initReaders();
  if(!_barReader) return null;
  const cands=barcodeCandidates(base);
  let loose=null;
  for(const c of cands){
    const t=zxDecode(_barReader,c);
    if(!t) continue;
    const digits=t.replace(/\D/g,'');
    if(/^89\d{16,18}$/.test(digits)){
      if(luhnValid(digits)) return digits;   // clean + checksum → done
      if(!loose) loose=digits;               // symbology check passed, keep as fallback
    }
  }
  return loose;
}

/* ==========================================================================
   OCR  →  PIN / PUK  (and ICCID fallback when the barcode will not decode)
   ========================================================================== */
function ocrVariants(crop){
  const c=upscale(crop,1100);
  return [
    {name:'blue-channel inverted', c:binarize(c,{channel:'blue',invert:true,sharp:true})},   // white text on red
    {name:'luma inverted',         c:binarize(c,{channel:'luma',invert:true,sharp:true})},
    {name:'luma normal',           c:binarize(c,{channel:'luma',invert:false,sharp:true})},  // dark text on white
    {name:'grayscale sharpened',   c:grayscaleSharp(c)}
  ];
}
function pinPukCrops(img){
  const list=[];
  const outline=detectOutlineBoxCrop(img); if(outline) list.push({name:'outline box',c:outline});
  const bright =detectBrightBoxCrop(img);  if(bright)  list.push({name:'bright box',c:bright});
  const heur=cropCanvas(img,.02,.22,.58,.58); if(heur) list.push({name:'upper-left region',c:heur});
  const left=cropCanvas(img,0,.10,.62,.70);  if(left)  list.push({name:'left half',c:left});
  list.push({name:'whole card',c:fitCanvas(img,1800)});
  return list;
}
async function readPrintedFields(img,knownIccid){
  const res={pin:'Not Found',puk:'Not Found',iccid:null,raw:''};
  let passes=0;
  const crops=pinPukCrops(img);

  for(const crop of crops){
    for(const v of ocrVariants(crop.c)){
      if(res.pin!=='Not Found'&&res.puk!=='Not Found') return res;
      if(passes>=MAX_OCR_PASSES) break;
      passes++;
      setStatus('Reading PIN and PUK — '+crop.name+' ('+v.name+')');
      const text=await ocrText(v.c,'Reading PIN and PUK');
      res.raw+='\n----- '+crop.name+' / '+v.name+' -----\n'+text;
      applyPinPuk(text,res,knownIccid);
      if(!knownIccid&&!res.iccid){ const cand=extractIccid(text); if(cand) res.iccid=cand; }
    }
    if(passes>=MAX_OCR_PASSES) break;
  }

  // Last resort: digits-only OCR. With letters forbidden the labels vanish, so the
  // numbers read cleanly and we match on length (4 = PIN, 8 = PUK).
  if(res.pin==='Not Found'||res.puk==='Not Found'){
    for(const crop of crops.slice(0,3)){
      if(res.pin!=='Not Found'&&res.puk!=='Not Found') break;
      setStatus('Reading PIN and PUK — digits only');
      for(const v of [binarize(upscale(crop.c,1100),{channel:'blue',invert:true,sharp:true}),
                      binarize(upscale(crop.c,1100),{channel:'luma',invert:true,sharp:true})]){
        const text=await ocrDigits(v);
        if(!text) continue;
        res.raw+='\n----- '+crop.name+' / digits only -----\n'+text;
        const pp=lengthMatchPinPuk(text,knownIccid||res.iccid);
        if(res.pin==='Not Found'&&pp.pin) res.pin=pp.pin;
        if(res.puk==='Not Found'&&pp.puk) res.puk=pp.puk;
        if(res.pin!=='Not Found'&&res.puk!=='Not Found') break;
      }
    }
  }
  return res;
}
async function readIccidDigits(img){
  const bands=[[.55,.90],[.60,1.0],[.40,.75],[.25,.60]];
  let fallback=null;
  for(const b of bands){
    const band=cropCanvas(img,0,b[0],1,b[1]);
    if(!band) continue;
    for(const v of [binarize(band,{channel:'luma',invert:false,sharp:true}),grayscaleSharp(band)]){
      const text=await ocrDigits(v);
      if(!text) continue;
      const best=bestIccidFromDigits(text.replace(/\D/g,''));
      if(best){ if(luhnValid(best)) return best; if(!fallback) fallback=best; }
    }
  }
  return fallback;
}

/* --------------------------- text extraction ---------------------------- */
const PIN_LABEL=/P\s*[I1l|!]\s*N/i;
const PUK_LABEL=/P\s*[UVO0]\s*[KX]/i;

function normalizeDigitsOCR(s){
  return s.replace(/[oO]/g,'0').replace(/[lI|]/g,'1').replace(/[sS]/g,'5')
          .replace(/[bB]/g,'8').replace(/[gG]/g,'6').replace(/[zZ]/g,'2')
          .replace(/[qQ]/g,'0').replace(/[aA]/g,'4').replace(/[tT]/g,'7');
}
/* Pull a run of exactly `count` digits. Loose first (tolerates "1884 1007"),
   then strict. No lookbehind — older mobile Safari chokes on it. */
function pickRun(str,count){
  const norm=normalizeDigitsOCR(String(str));
  const loose=norm.match(/\d(?:[ \-]?\d)*/g)||[];
  for(const r of loose){ const d=r.replace(/\D/g,''); if(d.length===count) return d; }
  const strict=norm.match(/\d+/g)||[];
  for(const r of strict) if(r.length===count) return r;
  return null;
}
function extractLabeled(text,labelRe,count){
  const lines=String(text).split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(labelRe);
    if(!m) continue;
    let d=pickRun(lines[i].slice(m.index+m[0].length),count);   // after the label
    if(d) return d;
    d=pickRun(lines[i],count);                                   // same line, anywhere
    if(d) return d;
    for(let off=1;off<=2&&i+off<lines.length;off++){             // wrapped onto next line
      d=pickRun(lines[i+off],count);
      if(d) return d;
    }
  }
  return null;
}
/* PIN is always printed directly above PUK on these cards. When the PIN label is
   mangled but PUK survives, anchor on PUK and look upward. */
function extractPinAbovePuk(text){
  const lines=String(text).split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    if(!PUK_LABEL.test(lines[i])) continue;
    for(let off=1;off<=2&&i-off>=0;off++){
      const d=pickRun(lines[i-off],4);
      if(d) return d;
    }
  }
  return null;
}
function isActivationCodeLine(line){
  return /LPA\s*[:.]?\s*1/i.test(line)||/SM-?DP/i.test(line)||
         /ondemandconnectivity/i.test(line)||/\$[A-Z0-9]{4,}/.test(line);
}
function lengthMatchPinPuk(text,iccid){
  const lines=String(text).split(/\r?\n/);
  let pin=null,puk=null;
  for(const raw of lines){
    const line=raw.trim();
    if(!line||isActivationCodeLine(line)) continue;
    const digitCount=(line.match(/\d/g)||[]).length;
    const letterCount=(line.match(/[A-Za-z]/g)||[]).length;
    if(letterCount>digitCount) continue;
    if(!puk){ const c=pickRun(line,8); if(c&&!partOfIccid(c,iccid)) puk=c; }
    if(!pin){ const c=pickRun(line,4); if(c&&!partOfIccid(c,iccid)&&c!==puk) pin=c; }
    if(pin&&puk) break;
  }
  return {pin,puk};
}
function partOfIccid(run,iccid){
  if(!iccid||iccid==='Not Found') return false;
  return iccid===run||iccid.indexOf(run)!==-1;
}
function applyPinPuk(text,res,iccid){
  if(res.pin==='Not Found'){ const d=extractLabeled(text,PIN_LABEL,4); if(d) res.pin=d; }
  if(res.puk==='Not Found'){ const d=extractLabeled(text,PUK_LABEL,8); if(d) res.puk=d; }
  if(res.pin==='Not Found'&&res.puk!=='Not Found'){ const d=extractPinAbovePuk(text); if(d) res.pin=d; }
  if(res.pin==='Not Found'||res.puk==='Not Found'){
    const pp=lengthMatchPinPuk(text,iccid);
    if(res.pin==='Not Found'&&pp.pin) res.pin=pp.pin;
    if(res.puk==='Not Found'&&pp.puk) res.puk=pp.puk;
  }
}
function extractIccid(text){
  const collapsed=String(text).replace(/[\s\-]/g,'');
  const best=bestIccidFromDigits(normalizeDigitsOCR(collapsed).replace(/\D/g,''));
  return best||null;
}
function bestIccidFromDigits(digits){
  if(!digits) return null;
  let idx=digits.indexOf('89');
  while(idx!==-1){
    for(const len of [19,20,18]){
      if(idx+len<=digits.length){
        const cand=digits.substr(idx,len);
        if(/^89\d+$/.test(cand)&&luhnValid(cand)) return cand;
      }
    }
    idx=digits.indexOf('89',idx+1);
  }
  const m=digits.match(/89\d{16,18}/);
  return m?m[0]:null;
}
function luhnValid(num){
  if(!/^\d+$/.test(num)) return false;
  let sum=0,alt=false;
  for(let i=num.length-1;i>=0;i--){
    let n=parseInt(num[i],10);
    if(alt){ n*=2; if(n>9) n-=9; }
    sum+=n; alt=!alt;
  }
  return sum%10===0;
}

/* ------------------------- box detection (crops) ------------------------- */
function connectedBrightBoxes(img,detectSize,lumaCut){
  const det=fitCanvas(img,detectSize);
  const dw=det.width,dh=det.height;
  const dd=det.getContext('2d').getImageData(0,0,dw,dh).data;
  const bright=new Uint8Array(dw*dh);
  for(let i=0,p=0;i<dd.length;i+=4,p++){
    const luma=dd[i]*0.299+dd[i+1]*0.587+dd[i+2]*0.114;
    bright[p]=luma>lumaCut?1:0;
  }
  const visited=new Uint8Array(dw*dh), queue=new Int32Array(dw*dh), boxes=[];
  for(let y=0;y<dh;y++) for(let x=0;x<dw;x++){
    const idx=y*dw+x;
    if(!bright[idx]||visited[idx]) continue;
    let qs=0,qe=0; queue[qe++]=idx; visited[idx]=1;
    let minX=x,maxX=x,minY=y,maxY=y,area=0;
    while(qs<qe){
      const cur=queue[qs++], cy=(cur/dw)|0, cx=cur%dw;
      area++;
      if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
      if(cx>0&&bright[cur-1]&&!visited[cur-1]){visited[cur-1]=1;queue[qe++]=cur-1;}
      if(cx<dw-1&&bright[cur+1]&&!visited[cur+1]){visited[cur+1]=1;queue[qe++]=cur+1;}
      if(cy>0&&bright[cur-dw]&&!visited[cur-dw]){visited[cur-dw]=1;queue[qe++]=cur-dw;}
      if(cy<dh-1&&bright[cur+dw]&&!visited[cur+dw]){visited[cur+dw]=1;queue[qe++]=cur+dw;}
    }
    boxes.push({minX,minY,maxX,maxY,area,dw,dh});
  }
  return boxes;
}
function boxToCrop(img,box,insetFracX,insetFracY){
  const scaleX=img.width/box.dw, scaleY=img.height/box.dh;
  const outerW=(box.maxX-box.minX)*scaleX, outerH=(box.maxY-box.minY)*scaleY;
  const ix=outerW*insetFracX, iy=outerH*insetFracY;
  const sx=Math.max(0,box.minX*scaleX+ix), sy=Math.max(0,box.minY*scaleY+iy);
  const ex=Math.min(img.width,(box.maxX+1)*scaleX-ix), ey=Math.min(img.height,(box.maxY+1)*scaleY-iy);
  const sw=ex-sx, sh=ey-sy;
  if(sw<12||sh<12) return null;
  const c=document.createElement('canvas');
  c.width=Math.round(sw); c.height=Math.round(sh);
  c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
  return c;
}
/* A HOLLOW rectangle — the thin white frame around "PIN: / PUK:". Cropping inside
   the stroke stops the border corrupting the PIN line, which sits right under it. */
function detectOutlineBoxCrop(img){
  const boxes=connectedBrightBoxes(img,500,190);
  let best=null;
  for(const b of boxes){
    const w=b.maxX-b.minX+1, h=b.maxY-b.minY+1;
    const fill=b.area/(w*h), areaFrac=(w*h)/(b.dw*b.dh), aspect=w/h;
    if(areaFrac>0.015&&areaFrac<0.5&&fill>0.012&&fill<0.40&&aspect>1.4&&aspect<9&&w>b.dw*0.12){
      if(!best||w*h>(best.maxX-best.minX+1)*(best.maxY-best.minY+1)) best=b;
    }
  }
  return best?boxToCrop(img,best,0.05,0.09):null;
}
/* A solidly FILLED bright block — a white label panel on a dark card. */
function detectBrightBoxCrop(img){
  const boxes=connectedBrightBoxes(img,400,195);
  let best=null;
  for(const b of boxes){
    const w=b.maxX-b.minX+1, h=b.maxY-b.minY+1;
    const fill=b.area/(w*h), areaFrac=b.area/(b.dw*b.dh), aspect=w/h;
    if(areaFrac>0.015&&areaFrac<0.5&&fill>0.55&&aspect>0.3&&aspect<6){
      if(!best||b.area>best.area) best=b;
    }
  }
  return best?boxToCrop(img,best,-0.12,-0.12):null;   // negative inset = pad outward
}

/* ==========================================================================
   THE PIPELINE — identical for an uploaded photo and a camera capture
   ========================================================================== */
async function scanImage(source,sourceLabel){
  const src=toCanvas(source);
  const base=fitCanvas(src,TARGET_LONG_SIDE);
  const isLowRes=Math.max(src.width,src.height)<LOWRES_THRESHOLD;
  const isBlurry=laplacianVariance(fitCanvas(src,1000))<BLUR_VARIANCE_THRESHOLD;
  let raw='';

  setStatus('Reading QR code…');
  const lpa=findQR(base);
  if(lpa) raw+='----- QR -----\n'+lpa+'\n';

  setStatus('Reading ICCID barcode…');
  let iccid='Not Found', iccidFromBc=false, iccidLuhn=null;
  const bc=findBarcodeIccid(base);
  if(bc){ iccid=bc; iccidFromBc=true; iccidLuhn=luhnValid(bc); raw+='----- barcode ICCID -----\n'+bc+'\n'; }

  const printed=await readPrintedFields(src,iccidFromBc?iccid:null);
  raw+=printed.raw;

  if(!iccidFromBc){
    let cand=printed.iccid;
    if(!cand||!luhnValid(cand)){
      setStatus('Barcode would not decode — reading the printed ICCID digits…');
      const digitsIccid=await readIccidDigits(src);
      if(digitsIccid&&(!cand||luhnValid(digitsIccid))) cand=digitsIccid;
    }
    if(cand){ iccid=cand; iccidLuhn=luhnValid(cand); raw+='\n----- printed ICCID (OCR) -----\n'+cand+'\n'; }
  }

  return {
    id:nextId++,
    time:new Date().toLocaleTimeString(),
    source:sourceLabel||'Camera',
    iccid, iccidLuhn, iccidFromBc,
    pin:printed.pin, puk:printed.puk,
    lpa:lpa||'QR Not Found',
    img:compressImage(src,1400,0.8),
    aiVerified:false, saved:false,
    lowRes:isLowRes, blurry:isBlurry,
    duplicate:false,
    rawText:raw, showRaw:false
  };
}
function missingFields(e){
  const m=[];
  if(e.iccid==='Not Found') m.push('ICCID');
  if(e.pin==='Not Found')   m.push('PIN');
  if(e.puk==='Not Found')   m.push('PUK');
  if(e.lpa==='QR Not Found')m.push('QR');
  return m;
}
function markDuplicate(entry){
  entry.duplicate=historyData.some(r=>r.id!==entry.id&&r.iccid!=='Not Found'&&r.iccid===entry.iccid);
}

/* ==========================================================================
   UPLOAD — one or many files, processed in order
   ========================================================================== */
pickBtn.addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',e=>{
  const files=Array.from(e.target.files||[]);
  fileInput.value='';
  if(files.length) processFiles(files);
});
['dragenter','dragover'].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.remove('drag');}));
dropzone.addEventListener('drop',e=>{
  const files=Array.from(e.dataTransfer.files||[]).filter(f=>f.type.startsWith('image/'));
  if(files.length) processFiles(files); else setStatus('Those were not image files. Drop photos of the cards.',true);
});

function loadImageFromFile(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{ resolve(img); setTimeout(()=>URL.revokeObjectURL(url),1000); };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('This browser cannot open '+file.name+' — HEIC files need converting to JPEG first.')); };
    img.src=url;
  });
}
async function processFiles(files){
  if(batchRunning){ setStatus('Still working through the last batch — wait for it to finish.',true); return; }
  batchRunning=true; setBusy(true);
  thumbsEl.innerHTML='';
  const thumbEls=files.map(f=>{
    const im=document.createElement('img');
    im.src=URL.createObjectURL(f); im.title=f.name;
    thumbsEl.appendChild(im); return im;
  });

  let ok=0, problems=0;
  for(let i=0;i<files.length;i++){
    thumbEls[i].classList.add('active');
    setProgress(i,files.length);
    setStatus('Photo '+(i+1)+' of '+files.length+' — '+files[i].name);
    try{
      const img=await loadImageFromFile(files[i]);
      const entry=await scanImage(img,files[i].name);
      markDuplicate(entry);
      historyData.unshift(entry);
      renderTable();
      if(missingFields(entry).length) problems++; else ok++;
      if(aiToggle.checked) verifyRow(entry);
    }catch(err){
      problems++;
      console.error(err);
      setStatus('Could not read '+files[i].name+': '+(err&&err.message?err.message:err),true);
      await new Promise(r=>setTimeout(r,800));
    }
    thumbEls[i].classList.remove('active');
    thumbEls[i].classList.add('done');
  }
  setProgress(files.length,files.length);
  setStatus('Done — '+ok+' complete, '+problems+' needing a check. Fields marked "Not Found" can be typed in directly.');
  setTimeout(()=>setProgress(0,0),1200);
  batchRunning=false; setBusy(false);
}
function setBusy(on){
  pickBtn.disabled=on; startBtn.disabled=on; captureBtn.disabled=on;
  saveBtn.disabled=on; downloadBtn.disabled=on; clearBtn.disabled=on;
}

/* ==========================================================================
   LIVE CAMERA
   ========================================================================== */
let stream=null, videoTrack=null, scanning=false, busy=false, torchOn=false, scanTimer=null;
const scanCanvas=document.createElement('canvas');
const grabCanvas=document.createElement('canvas');

function setChip(el,on,label){
  el.classList.toggle('chip-on',!!on);
  el.innerHTML=(on?'&#9679; ':'&#9675; ')+label;
}
function resetChips(){ setChip(chipQR,false,'QR'); setChip(chipICCID,false,'ICCID'); }

async function startCamera(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    setStatus('This browser cannot open a camera. Use Chrome on Android over https, or upload photos instead.',true); return;
  }
  if(location.protocol!=='https:'&&location.hostname!=='localhost'){
    setStatus('The camera needs https. Open this page over https, or upload photos instead.',true); return;
  }
  try{
    setStatus('Starting the camera…');
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1440}},audio:false
    });
    video.srcObject=stream;
    await video.play();
    videoTrack=stream.getVideoTracks()[0];
    setupTorch();
    viewfinder.classList.add('on');
    startBtn.style.display='none'; stopBtn.style.display=''; captureBtn.style.display='';
    scanning=true; busy=false;
    resetChips();
    setStatus('Line the card up — the chips light when the QR and barcode are in focus, then tap Capture card.');
    loopScan();
  }catch(err){
    setStatus('The camera did not start: '+(err&&err.message?err.message:err)+'. Check the camera permission for this site.',true);
  }
}
function stopCamera(){
  scanning=false;
  if(scanTimer){ clearTimeout(scanTimer); scanTimer=null; }
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  videoTrack=null; torchOn=false;
  try{ video.srcObject=null; }catch(e){}
  viewfinder.classList.remove('on');
  startBtn.style.display=''; stopBtn.style.display='none'; captureBtn.style.display='none'; torchBtn.style.display='none';
  resetChips();
}
function setupTorch(){
  torchOn=false;
  try{
    const caps=videoTrack.getCapabilities?videoTrack.getCapabilities():{};
    if(caps&&caps.torch){ torchBtn.style.display=''; torchBtn.textContent='Torch: off'; }
    else torchBtn.style.display='none';
  }catch(e){ torchBtn.style.display='none'; }
}
async function toggleTorch(){
  if(!videoTrack) return;
  try{
    torchOn=!torchOn;
    await videoTrack.applyConstraints({advanced:[{torch:torchOn}]});
    torchBtn.textContent='Torch: '+(torchOn?'on':'off');
  }catch(e){ setStatus('This camera has no controllable torch.'); }
}
function frameToCanvas(canvas,longSide){
  const vw=video.videoWidth, vh=video.videoHeight;
  if(!vw||!vh) return null;
  const scale=longSide?Math.min(1,longSide/Math.max(vw,vh)):1;
  canvas.width=Math.max(1,Math.round(vw*scale));
  canvas.height=Math.max(1,Math.round(vh*scale));
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  return canvas;
}
function loopScan(){
  if(!scanning) return;
  if(!busy){
    try{
      const c=frameToCanvas(scanCanvas,1000);
      if(c){
        initReaders();
        const qrVal=(typeof jsQR!=='undefined'?decodeJsQR(c):null)||zxDecode(_qrReader,c);
        setChip(chipQR,!!qrVal,'QR');
        const bcVal=zxDecode(_barReader,c);
        setChip(chipICCID,!!(bcVal&&/^89\d{16,18}$/.test(bcVal.replace(/\D/g,''))),'ICCID');
      }
    }catch(e){}
  }
  scanTimer=setTimeout(loopScan,300);
}
async function captureAndScan(){
  if(busy) return;
  const grab=frameToCanvas(grabCanvas,0);
  if(!grab){ setStatus('No camera frame yet — wait for the preview, then capture.',true); return; }
  busy=true;
  overlay.classList.add('flash'); setTimeout(()=>overlay.classList.remove('flash'),350);
  stopCamera();
  setBusy(true);
  setStatus('Captured — reading the card…');
  try{
    const entry=await scanImage(grab,'Camera');
    markDuplicate(entry);
    historyData.unshift(entry);
    renderTable();
    const missing=missingFields(entry);
    setStatus(missing.length
      ? 'Row added — check '+missing.join(', ')+'. Tap the value to type it in, or scan the card again.'
      : 'Row added. Start the camera for the next card.');
    if(aiToggle.checked) verifyRow(entry);
  }catch(err){
    setStatus('The read failed: '+(err&&err.message?err.message:err)+'. Start the camera and try again.',true);
  }finally{
    busy=false; setBusy(false);
  }
}
startBtn.addEventListener('click',startCamera);
stopBtn.addEventListener('click',()=>{stopCamera();setStatus('Camera stopped.');});
captureBtn.addEventListener('click',captureAndScan);
torchBtn.addEventListener('click',toggleTorch);
window.addEventListener('pagehide',stopCamera);
document.addEventListener('visibilitychange',()=>{ if(document.hidden&&stream) stopCamera(); });

/* ==========================================================================
   OPTIONAL AI CHECK
   ========================================================================== */
async function verifyRow(entry){
  if(!entry.img) return;
  try{
    const resp=await fetch(FUNCTION_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:entry.img})});
    let json; try{ json=await resp.json(); }catch(_){ throw new Error('HTTP '+resp.status); }
    if(!resp.ok) throw new Error(json.error||('HTTP '+resp.status));
    if(json.iccid&&!entry.iccidFromBc){ entry.iccid=json.iccid; entry.iccidLuhn=/^\d+$/.test(json.iccid)?luhnValid(json.iccid):null; }
    if(json.pin) entry.pin=json.pin;
    if(json.puk) entry.puk=json.puk;
    entry.aiVerified=true;
    renderTable();
  }catch(err){ console.warn('AI check skipped:',err.message); }
}

/* ==========================================================================
   SHEET / CSV
   ========================================================================== */
saveBtn.addEventListener('click',async()=>{
  if(!SHEET_ENDPOINT){ setStatus('Add your Apps Script URL to SHEET_ENDPOINT first.',true); return; }
  const unsaved=historyData.filter(r=>!r.saved);
  if(!unsaved.length){ setStatus('Every row is already saved.'); return; }
  const payload={secret:SHEET_SECRET,records:unsaved.map(r=>({
    time:r.time, source:r.source,
    iccid:r.iccid==='Not Found'?'':r.iccid,
    iccidValid:r.iccidLuhn===true?'OK':(r.iccidLuhn===false?'CHECK':''),
    iccidSource:r.iccidFromBc?'BARCODE':'OCR',
    pin:r.pin==='Not Found'?'':r.pin,
    puk:r.puk==='Not Found'?'':r.puk,
    lpa:r.lpa==='QR Not Found'?'':r.lpa,
    aiVerified:!!r.aiVerified, lowRes:!!r.lowRes
  }))};
  setStatus('Saving to the sheet…'); saveBtn.disabled=true;
  try{
    await fetch(SHEET_ENDPOINT,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    unsaved.forEach(r=>r.saved=true);
    renderTable();
    setStatus('Sent '+unsaved.length+' row(s) — open the sheet to confirm.');
  }catch(err){ setStatus('The save failed: '+err.message,true); }
  finally{ saveBtn.disabled=false; }
});
downloadBtn.addEventListener('click',()=>{
  if(!historyData.length){ setStatus('There is nothing to export yet.',true); return; }
  let csv='Time,Source,ICCID,ICCID_Valid,ICCID_Source,PIN,PUK,LPA Code,AI_Checked,Low_Res\n';
  historyData.forEach(r=>{
    const valid=r.iccidLuhn===true?'OK':(r.iccidLuhn===false?'CHECK':'');
    const fields=[r.time,r.source,"'"+r.iccid,valid,r.iccidFromBc?'BARCODE':'OCR',r.pin,r.puk,r.lpa,r.aiVerified?'YES':'NO',r.lowRes?'YES':'NO'];
    csv+=fields.map(f=>'"'+String(f).replace(/"/g,'""')+'"').join(',')+'\n';
  });
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const a=document.createElement('a');
  a.href=url; a.download='eSIM_Batch.csv'; a.click();
  URL.revokeObjectURL(url);
});
clearBtn.addEventListener('click',()=>{
  if(!historyData.length) return;
  if(!confirm('Remove all '+historyData.length+' rows? Anything not saved or exported is lost.')) return;
  historyData=[]; thumbsEl.innerHTML=''; renderTable(); setStatus('Rows cleared.');
});

/* ==========================================================================
   TABLE
   ========================================================================== */
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function luhnBadge(l){
  if(l===true)  return '<span class="ok-badge" title="Luhn checksum passes">&#10003;</span>';
  if(l===false) return '<span class="warn-badge" title="Luhn checksum fails — likely a misread">&#9888;</span>';
  return '';
}
function renderTable(){
  tableHint.style.display=historyData.length?'block':'none';
  if(!historyData.length){
    historyBody.innerHTML='<tr><td colspan="6" class="empty">No cards yet. Choose photos or start the camera.</td></tr>';
    return;
  }
  historyBody.innerHTML=historyData.map(item=>{
    const tags=
      (item.aiVerified?'<span class="tag tag-ai" title="Checked by AI">AI</span>':'')+
      (item.saved?'<span class="tag tag-saved">saved</span>':'')+
      (item.duplicate?'<span class="tag tag-dup" title="Another row has this ICCID">DUPLICATE</span>':'')+
      (item.lowRes?'<span class="tag tag-low" title="Small source photo — verify the fields">LOW RES</span>':'')+
      (item.blurry?'<span class="tag tag-blur" title="Looks blurry — verify the fields">BLURRY</span>':'');
    const row=
      '<tr data-id="'+item.id+'">'+
        '<td>'+(item.img?'<img class="rowthumb" src="'+item.img+'" alt="scanned card" title="Open the frame this row came from">':'')+
          '<div style="font-size:12px;color:#64748b;max-width:120px;word-break:break-all;">'+escapeHtml(item.source)+'</div>'+
          '<div style="font-size:12px;color:#94a3b8;">'+escapeHtml(item.time)+'</div>'+tags+'</td>'+
        '<td><span class="edit'+(item.iccidLuhn===false?' bad':'')+'" contenteditable="true" data-field="iccid">'+escapeHtml(item.iccid)+'</span>'+
          '<span class="badge">'+luhnBadge(item.iccidLuhn)+'</span>'+
          (item.iccidFromBc?'<span class="tag tag-bc" title="Decoded from the Code128 barcode">BARCODE</span>':'')+'</td>'+
        '<td><span class="edit" contenteditable="true" data-field="pin">'+escapeHtml(item.pin)+'</span></td>'+
        '<td><span class="edit" contenteditable="true" data-field="puk">'+escapeHtml(item.puk)+'</span></td>'+
        '<td class="lpa-text"><span class="edit" contenteditable="true" data-field="lpa">'+escapeHtml(item.lpa)+'</span></td>'+
        '<td><button class="icon-btn" data-raw="'+item.id+'" title="Show the raw OCR text">&#128269;</button>'+
            '<button class="icon-btn del" data-del="'+item.id+'" title="Delete this row">&#128465;</button></td>'+
      '</tr>';
    const rawRow=item.showRaw
      ? '<tr class="raw-row"><td colspan="6"><pre class="raw-text">'+escapeHtml(item.rawText||'(no OCR text captured)')+'</pre></td></tr>'
      : '';
    return row+rawRow;
  }).join('');
}
historyBody.addEventListener('focusout',e=>{
  const span=e.target.closest?e.target.closest('.edit'):null; if(!span) return;
  const tr=span.closest('tr');
  const entry=historyData.find(x=>x.id===+tr.dataset.id); if(!entry) return;
  entry[span.dataset.field]=span.textContent.trim();
  if(span.dataset.field==='iccid'){
    entry.iccidFromBc=false;
    entry.iccidLuhn=/^\d+$/.test(entry.iccid)?luhnValid(entry.iccid):null;
    markDuplicate(entry);
    renderTable();
  }
});
historyBody.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.closest&&e.target.closest('.edit')){ e.preventDefault(); e.target.blur(); }
});
historyBody.addEventListener('click',e=>{
  const thumb=e.target.closest('.rowthumb');
  if(thumb&&thumb.src){ const w=window.open(); if(w) w.document.write('<img src="'+thumb.src+'" style="max-width:100%">'); return; }
  const del=e.target.closest('[data-del]');
  if(del){ historyData=historyData.filter(x=>x.id!==+del.dataset.del); historyData.forEach(markDuplicate); renderTable(); return; }
  const raw=e.target.closest('[data-raw]');
  if(raw){ const entry=historyData.find(x=>x.id===+raw.dataset.raw); if(entry){ entry.showRaw=!entry.showRaw; renderTable(); } }
});

/* Tells the boot diagnostics in index.html that this file loaded and ran to the end. */
window.__esimReady = true;