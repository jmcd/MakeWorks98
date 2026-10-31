import { dotnet } from './_framework/dotnet.js';

const t0 = performance.now();
// The screen area: the Office's own size to begin with, and whatever Display Properties >
// Settings picks after that (see resize, below).
let WIDTH = 656, HEIGHT = 480;
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
// The frame lands at 1x in an offscreen canvas and is blown up by a whole number into the visible
// one, whose backing store is sized in device pixels (see fit()), so the browser has nothing to resample.
let frame1x, ctx1x, image, pixels;
function makeFrame() {
  frame1x = new OffscreenCanvas(WIDTH, HEIGHT);
  ctx1x = frame1x.getContext('2d');
  image = ctx1x.createImageData(WIDTH, HEIGHT);
  pixels = new Uint8Array(image.data.buffer);
}
makeFrame();
const statsEl = document.getElementById('stats');
let running = true;

// ---- The saved office ---------------------------------------------------------------------

// One snapshot of the Office's files (a zip, made by Persistence.cs) under one key, stamped with
// when it was taken. IndexedDB is where it lives, but a write there is asynchronous and a page
// being closed is not waited for, so the last snapshot of all also goes into localStorage, which is
// synchronous; whichever is newer is used at the next visit. `?reset` in the address throws both
// away first, for a new career without digging through the browser's settings.
// Loading an office from a file keeps the one it replaced under BEFORE_IMPORT_KEY (one deep), and
// `?undo-import` swaps the two back.
const DB_NAME = 'the-office', STORE = 'snapshots', KEY = 'save', URGENT_KEY = 'the-office-closing-snapshot';
const BEFORE_IMPORT_KEY = 'save-before-import';
const URGENT_LIMIT = 2_500_000; // characters of base64: well inside any browser's localStorage quota
const db = await new Promise((resolve, reject) => {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});
function idb(mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
function readUrgent() {
  try {
    const saved = JSON.parse(localStorage.getItem(URGENT_KEY));
    return saved ? { at: saved.at, bytes: fromBase64(saved.data) } : null;
  } catch { return null; }
}

// The query is the command line (`?--chat`), so it is edited as tokens: URLSearchParams would
// write a bare flag back as `--chat=`.
const queryTokens = location.search.slice(1).split('&').filter(Boolean);
function dropToken(token) {
  const rest = location.search.slice(1).split('&').filter((t) => t && t !== token);
  history.replaceState(null, '', location.pathname + (rest.length ? '?' + rest.join('&') : ''));
}
if (queryTokens.includes('reset')) {
  await idb('readwrite', (s) => s.delete(KEY));
  try { localStorage.removeItem(URGENT_KEY); } catch {}
  dropToken('reset');
}

let saved = await idb('readonly', (s) => s.get(KEY));
const urgent = readUrgent();
if (urgent && (!saved || urgent.at > saved.at)) {
  saved = urgent;
  await idb('readwrite', (s) => s.put(urgent, KEY));
}
try { localStorage.removeItem(URGENT_KEY); } catch {}

// `?start=day250`: one of the saves made for testers (make-saves.sh), in place of whatever this
// browser had, which is kept for ?undo-import as a loaded file's would be. It is the real office
// played forward to that day, so it opens on that morning like any other save.
const startToken = queryTokens.find((t) => t.startsWith('start='));
if (startToken) {
  const name = startToken.slice('start='.length);
  try {
    const response = /^[a-z0-9-]+$/i.test(name) ? await fetch(`saves/${name}.zip`) : null;
    if (!response?.ok) throw new Error(`no save called ${name}`);
    const record = { at: Date.now(), bytes: new Uint8Array(await response.arrayBuffer()) };
    await idb('readwrite', (s) => {
      if (saved) s.put(saved, BEFORE_IMPORT_KEY);
      return s.put(record, KEY);
    });
    saved = record;
  } catch (e) {
    console.error('Starting from a saved office failed:', e);
  }
  dropToken(startToken);
}

// After the closing snapshot is folded in, so what is set aside is the office as last left.
if (queryTokens.includes('undo-import')) {
  const before = await idb('readonly', (s) => s.get(BEFORE_IMPORT_KEY));
  if (before) {
    await idb('readwrite', (s) => {
      if (saved) s.put(saved, BEFORE_IMPORT_KEY); else s.delete(BEFORE_IMPORT_KEY);
      return s.put(before, KEY);
    });
    saved = before;
  }
  dropToken('undo-import');
}
const snapshot = saved?.bytes;
// Nothing saved in this browser yet: the page offers the testers' saves beside its links.
const firstVisit = !snapshot;

// Set once an office has been loaded from a file and the page is reloading into it: the running
// office's next snapshot (every 5 s, and the one on the way out) would write the old one back.
let saving = true;

const { setModuleImports, getAssemblyExports, getConfig, runMain } = await dotnet
  .withApplicationArguments(...decodeURIComponent(location.search.slice(1)).split(/[&\s]+/).filter(Boolean))
  .create();

setModuleImports('main.js', {
  present: (view) => {
    view.copyTo(pixels);
    ctx1x.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame1x, 0, 0, canvas.width, canvas.height);
    framesShown++;
  },
  setCursor: (cursor) => { canvas.style.cursor = cursor; },
  // A new screen area: a new 1x frame that size, and the page canvas refitted round it.
  resize: (width, height) => {
    WIDTH = width;
    HEIGHT = height;
    makeFrame();
    fit();
  },
  reload: () => location.reload(),
  // The view is only valid during the call; decoding is asynchronous, so the bytes are copied out first.
  playSound: (view) => playSound(view.slice()),
  // The view is only valid during the call, so the bytes are copied out before the write is queued.
  saveSnapshot: (view, closing) => {
    if (!saving) return;
    const record = { at: Date.now(), bytes: view.slice() };
    if (closing) {
      try {
        const data = toBase64(record.bytes);
        if (data.length <= URGENT_LIMIT) localStorage.setItem(URGENT_KEY, JSON.stringify({ at: record.at, data }));
      } catch (e) { console.error('Saving the office on the way out failed:', e); }
    }
    idb('readwrite', (s) => s.put(record, KEY)).catch((e) => console.error('Saving the office failed:', e));
  },
  // Backup, inside the office (WebBackupHost): the same download, picker and swap as the page's links.
  download: (view, name) => download(view.slice(), name),
  pickFile: () => backupPicker.click(),
  // Send Error Report (WebReportSender): the view is only valid during the call, so the bytes are
  // copied out first; the status, or 0 when nothing answered, goes back to be handed over next frame.
  sendReport: (id, url, view) => {
    const body = view.slice();
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then((response) => assembly.WebReportSender.Answered(id, response.status),
            () => assembly.WebReportSender.Answered(id, 0));
  },
  userAgent: () => navigator.userAgent,
  replaceOffice: (view, current) => replaceOffice(view.slice(), current.slice()),
  exited: () => {
    running = false;
    canvas.style.cursor = 'default';
    statsEl.textContent = 'The program has ended. Reload the page to start it again.';
  },
});

const assembly = (await getAssemblyExports(getConfig().mainAssemblyName)).Web;
const exports = assembly.WebHost;
if (snapshot) assembly.Persistence.Restore(snapshot);
// Sans 8 is not inside the program (it is LGPL, so it stays a replaceable file): fetch it from
// Fonts/ beside this page into the runtime's file system, where FontCache looks for it.
await Promise.all(assembly.Fonts.Names().map(async (name) => {
  const response = await fetch(`Fonts/${name}`);
  if (!response.ok) throw new Error(`Fonts/${name}: ${response.status}`);
  assembly.Fonts.Install(name, new Uint8Array(await response.arrayBuffer()));
}));
await runMain();
const bootMs = performance.now() - t0;
// Set against the page views, this counts how many visitors gave up while the runtime downloaded.
// count.js may still be loading (or blocked), in which case the event is lost, as an ad blocker would lose it.
window.goatcounter?.count?.({ path: 'booted', title: 'Booted', event: true });

// ---- Sound ------------------------------------------------------------------------------

// A page may make no sound until it has been clicked or typed into (the browser's autoplay rule;
// Chrome relaxes it for a site the visitor has used before, Firefox never does). The context is
// made before the first frame; if the browser has it suspended, the page waits at "click to start"
// (below) and the desktop appears on that click, so the startup chime plays as it appears, as it
// does on the desktop. Should the context be suspended again later (a phone putting the page in
// the background does that), a sound asked for meanwhile waits for the next gesture instead of
// being lost.
const audio = new AudioContext();
const waitingSounds = [];
function playBuffer(buffer) {
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.start();
}
async function playSound(bytes) {
  let buffer;
  try {
    buffer = await audio.decodeAudioData(bytes.buffer);
  } catch (e) {
    console.error('Decoding a sound failed:', e);
    return;
  }
  if (audio.state === 'running') playBuffer(buffer);
  else waitingSounds.push(buffer);
}
function unlockSound() {
  if (audio.state === 'running') return;
  audio.resume().then(() => { for (const buffer of waitingSounds.splice(0)) playBuffer(buffer); }, () => {});
}
window.addEventListener('mousedown', unlockSound, { capture: true });
window.addEventListener('keydown', unlockSound, { capture: true });

// ---- Scaling ----------------------------------------------------------------------------

// Every canvas pixel must cover a whole number of *device* pixels, or rows and columns come out
// unevenly doubled. CSS pixels are not device pixels on a 125% or 150% display (or under browser
// zoom), so the scale is chosen in device pixels and converted back, and the position is snapped
// to the device grid too: a canvas starting half a device pixel in would blur every edge.
const statsHeight = 22;
// True while the page is waiting at "click to start" (see Starting, below); fit() redraws that screen.
let gated = false;
function fit() {
  const dpr = window.devicePixelRatio || 1;
  const availW = window.innerWidth * dpr;
  const availH = (window.innerHeight - statsHeight) * dpr;
  const fits = Math.min(availW / WIDTH, availH / HEIGHT);
  const scale = Math.max(1, Math.floor(fits));
  canvas.width = WIDTH * scale;
  canvas.height = HEIGHT * scale;
  // A screen area bigger than the window even at 1x is shown shrunk to fit, a little soft,
  // rather than with its taskbar cut off where nobody can reach it.
  const shown = fits < 1 ? fits : scale;
  const w = Math.floor(WIDTH * shown), h = Math.floor(HEIGHT * shown);
  canvas.style.width = `${w / dpr}px`;
  canvas.style.height = `${h / dpr}px`;
  // Pixelated scaling drops whole rows on the way down, which takes text with it; shrunk, blend.
  canvas.style.imageRendering = fits < 1 ? 'auto' : '';
  canvas.style.left = `${Math.max(0, Math.floor((availW - w) / 2)) / dpr}px`;
  canvas.style.top = `${Math.max(0, Math.floor((availH - h) / 2)) / dpr}px`;
  canvas.dataset.scale = scale;
  if (gated) showGate();
}
// devicePixelRatio changes on zoom or on moving to another monitor, which a resize does not
// always accompany; a resolution media query fires for exactly that change, once.
function watchRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => { fit(); watchRatio(); }, { once: true });
}
window.addEventListener('resize', fit);
fit();
watchRatio();

// ---- Input ----------------------------------------------------------------------------

const held = new Set();
const modifiers = () =>
  (held.has('ShiftLeft') || held.has('ShiftRight') ? 1 : 0) |
  (held.has('ControlLeft') || held.has('ControlRight') ? 2 : 0) |
  (held.has('AltLeft') || held.has('AltRight') ? 4 : 0);

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) * WIDTH / r.width),
          Math.floor((e.clientY - r.top) * HEIGHT / r.height)];
}

window.addEventListener('mousemove', (e) => exports.MouseMove(...canvasPoint(e), modifiers()));
canvas.addEventListener('mousedown', (e) => { canvas.focus(); e.preventDefault(); exports.MouseButton(...canvasPoint(e), e.button, true, modifiers()); });
window.addEventListener('mouseup', (e) => exports.MouseButton(...canvasPoint(e), e.button, false, modifiers()));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const notches = -e.deltaY / (e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : 100);
  exports.MouseWheel(...canvasPoint(e), notches, modifiers());
}, { passive: false });

// The keys RaylibKeyMapper turns into virtual-key codes, by KeyboardEvent.code.
const mapped = {
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  Escape: 27, Tab: 9, Space: 32, Backspace: 8, Insert: 45, Delete: 46, Enter: 13, NumpadEnter: 13,
  PrintScreen: 44, ContextMenu: 93, NumpadMultiply: 106, NumpadDivide: 111, NumpadAdd: 107,
  NumpadSubtract: 109, NumpadDecimal: 110, Equal: 187, Minus: 189, Backquote: 192,
};
for (let i = 1; i <= 12; i++) mapped['F' + i] = 111 + i;

function rawCode(e) {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.charCodeAt(3);
  if (/^Digit\d$/.test(e.code)) return e.code.charCodeAt(5);
  return e.keyCode;
}

// Left for the browser: devtools and reload, so the page can still be debugged.
const passThrough = (e) => e.code === 'F12' || (e.ctrlKey && e.shiftKey && (e.code === 'KeyI' || e.code === 'KeyJ')) ||
  (e.ctrlKey && e.code === 'KeyR');

canvas.addEventListener('keydown', (e) => {
  held.add(e.code);
  if (passThrough(e)) return;
  e.preventDefault();
  // As on the desktop, bare F10 takes a picture (Shift+F10 is the context menu) and the key goes on to the desk too.
  if (e.code === 'F10' && !e.shiftKey && !e.repeat) takeScreenshot();
  const mods = modifiers();
  // As raylib does: a printable key yields a character, and a mapped key (or anything
  // under Ctrl/Alt) a virtual-key code as well.
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey) exports.Key(0, e.key.codePointAt(0), true, mods);
  const vk = mapped[e.code];
  if (vk || e.ctrlKey || e.altKey) exports.Key(vk || rawCode(e), 0, true, mods);
});

canvas.addEventListener('keyup', (e) => {
  held.delete(e.code);
  if (passThrough(e)) return;
  e.preventDefault();
  // Print Screen on its way up: Windows keeps the key down to itself and lets a page see only the up.
  if (e.code === 'PrintScreen') takeScreenshot();
  const pairs = { Control: 17, Alt: 18, Shift: 16 };
  for (const [name, vk] of Object.entries(pairs)) {
    if (e.code.startsWith(name) && !held.has(name + 'Left') && !held.has(name + 'Right')) exports.Key(vk, 0, false, modifiers());
  }
  // The arrows too: the spreadsheet's flight steers for as long as one is held.
  if (e.code.startsWith('Arrow')) exports.Key(mapped[e.code], 0, false, modifiers());
});
window.addEventListener('blur', () => held.clear());

// The last chance to save: a tab being closed, reloaded or put in the background.
window.addEventListener('pagehide', () => exports.PageHidden());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') exports.PageHidden(); });

// ---- Save to file, load from file ----------------------------------------------------

// The saved office out of the browser as a file, and back in, for another browser or machine or
// after the site data was cleared. The file is the snapshot itself: the same zip IndexedDB keeps.
const linksEl = document.getElementById('links');
const noticeEl = document.getElementById('notice');
function notice(text) { noticeEl.textContent = text; }

function showFileLinks() {
  linksEl.hidden = false;
  if (firstVisit) offerStarts();
  document.getElementById('save-file').addEventListener('click', saveToFile);
  document.getElementById('screenshot').addEventListener('click', (e) => { e.preventDefault(); takeScreenshot(); canvas.focus(); });
  const picker = document.getElementById('load-picker');
  document.getElementById('load-file').addEventListener('click', (e) => { e.preventDefault(); picker.click(); });
  picker.addEventListener('change', () => {
    const file = picker.files[0];
    picker.value = '';
    if (file) loadFromFile(file);
  });
}

// `bytes` is a zip, or a Blob that already says what it is.
function download(bytes, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/zip' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// Links to the saves make-saves.sh put beside the page, if it did: a published site has them,
// a plain local build does not, and then nothing is offered.
async function offerStarts() {
  let starts;
  try {
    const response = await fetch('saves/index.json');
    if (!response.ok) return;
    starts = await response.json();
  } catch { return; }
  if (!starts.length) return;
  const span = document.createElement('span');
  span.id = 'starts';
  span.append('Start at: ');
  starts.forEach(({ name, label }, i) => {
    if (i > 0) span.append(' · ');
    const a = document.createElement('a');
    a.href = `?start=${encodeURIComponent(name)}`;
    a.textContent = label;
    span.append(a);
  });
  span.append('  ');
  linksEl.prepend(span);
}

const pad = (n) => String(n).padStart(2, '0');
const dateStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function saveToFile(e) {
  e.preventDefault();
  download(assembly.Persistence.Snapshot(), `MakeWorks98-${dateStamp(new Date())}.zip`);
  notice('');
  canvas.focus();
}

// The screen as a PNG download: the 1x frame the desk last drew, so it is the screen area pixel
// for pixel whatever the page's scale. Before the first frame there is nothing to take.
let framesShown = 0;
let shooting = false;
async function takeScreenshot() {
  if (!framesShown || shooting) return;
  shooting = true;
  try {
    const d = new Date();
    const png = await frame1x.convertToBlob({ type: 'image/png' });
    download(png, `MakeWorks98-${dateStamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`);
  } catch (e) {
    console.error('Taking a screenshot failed:', e);
    notice('The screenshot could not be taken.');
  } finally {
    shooting = false;
  }
}

// Backup's Restore Wizard asks with this picker; the file goes back to it, to check and confirm in the office.
const backupPicker = Object.assign(document.createElement('input'), { type: 'file', accept: '.zip', hidden: true });
document.body.append(backupPicker);
backupPicker.addEventListener('change', async () => {
  const file = backupPicker.files[0];
  backupPicker.value = '';
  canvas.focus();
  if (file) assembly.WebBackupHost.Chosen(file.name, new Uint8Array(await file.arrayBuffer()));
});

// Puts `bytes` in place of the office and reloads into it, keeping `current` for ?undo-import.
async function replaceOffice(bytes, current) {
  // From here the running office is never saved again: its next snapshot would be the old office.
  saving = false;
  try {
    await idb('readwrite', (s) => {
      s.put({ at: Date.now(), bytes: current }, BEFORE_IMPORT_KEY);
      return s.put({ at: Date.now(), bytes }, KEY);
    });
  } catch (e) {
    saving = true;
    console.error('Loading the office failed:', e);
    notice('The office could not be loaded.');
    return false;
  }
  try { localStorage.removeItem(URGENT_KEY); } catch {}
  location.reload();
  return true;
}

async function loadFromFile(file) {
  canvas.focus();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = assembly.Persistence.Check(bytes);
  if (problem) {
    notice(problem);
    return;
  }
  if (!confirm(`Replace the office in this browser with ${file.name}?\n\n` +
    'The current one is kept: add ?undo-import to the address to bring it back.')) return;

  await replaceOffice(bytes, assembly.Persistence.Snapshot());
}

// ---- Frame loop -----------------------------------------------------------------------

let last = performance.now();
let frames = 0, tickMs = 0, statWindow = performance.now();
function frame(now) {
  if (!running) return;
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const s = performance.now();
  exports.Tick(dt);
  tickMs += performance.now() - s;
  frames++;
  if (now - statWindow >= 1000) {
    const [render, worst, present] = exports.TakeStats().split('|');
    statsEl.textContent =
      `fps ${(frames * 1000 / (now - statWindow)).toFixed(0)}  |  whole tick ${(tickMs / frames).toFixed(2)} ms  |  ` +
      `update+render ${render} ms (worst ${worst})  |  present ${present} ms  |  boot ${bootMs.toFixed(0)} ms  |  ` +
      `scale ${canvas.dataset.scale}x @ dpr ${window.devicePixelRatio}`;
    frames = 0; tickMs = 0; statWindow = now;
  }
  requestAnimationFrame(frame);
}
// ---- Starting -------------------------------------------------------------------------

// Where the browser has sound blocked, the desktop waits for a click or a key so that it can
// appear with its chime; where it is allowed (Chrome, for a site used before), it appears at once.
// The gesture that starts it is swallowed on the way, so the desk is not also clicked by it.
function showGate() {
  const scale = Number(canvas.dataset.scale) || 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#c0c0c0';
  ctx.font = `${12 * scale}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Click anywhere, or press a key, to start.', canvas.width / 2, canvas.height / 2);
}
function start() {
  gated = false;
  statsEl.textContent = '';
  canvas.focus();
  requestAnimationFrame(frame);
}
if (audio.state === 'running') {
  start();
} else {
  gated = true;
  showGate();
  statsEl.textContent = 'Ready. Click anywhere, or press a key, to start.';
  const begin = (e) => {
    if (!gated) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    window.removeEventListener('mousedown', begin, { capture: true });
    window.removeEventListener('keydown', begin, { capture: true });
    unlockSound();
    start();
  };
  // Registered after unlockSound's own capture listeners, so the context is resumed first.
  window.addEventListener('mousedown', begin, { capture: true });
  window.addEventListener('keydown', begin, { capture: true });
}
showFileLinks();
