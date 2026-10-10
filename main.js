import { dotnet } from './_framework/dotnet.js';

const t0 = performance.now();
const WIDTH = 656, HEIGHT = 480;
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
// The frame lands at 1x in an offscreen canvas and is blown up by a whole number into the visible
// one, whose backing store is sized in device pixels (see fit()), so the browser has nothing to resample.
const frame1x = new OffscreenCanvas(WIDTH, HEIGHT);
const ctx1x = frame1x.getContext('2d');
const image = ctx1x.createImageData(WIDTH, HEIGHT);
const pixels = new Uint8Array(image.data.buffer);
const statsEl = document.getElementById('stats');
let running = true;

// ---- The saved office ---------------------------------------------------------------------

// One snapshot of the Office's files (a zip, made by Persistence.cs) under one key, stamped with
// when it was taken. IndexedDB is where it lives, but a write there is asynchronous and a page
// being closed is not waited for, so the last snapshot of all also goes into localStorage, which is
// synchronous; whichever is newer is used at the next visit. `?reset` in the address throws both
// away first, for a new career without digging through the browser's settings.
const DB_NAME = 'the-office', STORE = 'snapshots', KEY = 'save', URGENT_KEY = 'the-office-closing-snapshot';
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
if (queryTokens.includes('reset')) {
  await idb('readwrite', (s) => s.delete(KEY));
  try { localStorage.removeItem(URGENT_KEY); } catch {}
  const rest = queryTokens.filter((t) => t !== 'reset');
  history.replaceState(null, '', location.pathname + (rest.length ? '?' + rest.join('&') : ''));
}

let saved = await idb('readonly', (s) => s.get(KEY));
const urgent = readUrgent();
if (urgent && (!saved || urgent.at > saved.at)) {
  saved = urgent;
  await idb('readwrite', (s) => s.put(urgent, KEY));
}
try { localStorage.removeItem(URGENT_KEY); } catch {}
const snapshot = saved?.bytes;

const { setModuleImports, getAssemblyExports, getConfig, runMain } = await dotnet
  .withApplicationArguments(...decodeURIComponent(location.search.slice(1)).split(/[&\s]+/).filter(Boolean))
  .create();

setModuleImports('main.js', {
  present: (view) => {
    view.copyTo(pixels);
    ctx1x.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame1x, 0, 0, canvas.width, canvas.height);
  },
  setCursor: (cursor) => { canvas.style.cursor = cursor; },
  reload: () => location.reload(),
  // The view is only valid during the call; decoding is asynchronous, so the bytes are copied out first.
  playSound: (view) => playSound(view.slice()),
  // The view is only valid during the call, so the bytes are copied out before the write is queued.
  saveSnapshot: (view, closing) => {
    const record = { at: Date.now(), bytes: view.slice() };
    if (closing) {
      try {
        const data = toBase64(record.bytes);
        if (data.length <= URGENT_LIMIT) localStorage.setItem(URGENT_KEY, JSON.stringify({ at: record.at, data }));
      } catch (e) { console.error('Saving the office on the way out failed:', e); }
    }
    idb('readwrite', (s) => s.put(record, KEY)).catch((e) => console.error('Saving the office failed:', e));
  },
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
  const scale = Math.max(1, Math.floor(Math.min(availW / WIDTH, availH / HEIGHT)));
  const w = WIDTH * scale, h = HEIGHT * scale;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w / dpr}px`;
  canvas.style.height = `${h / dpr}px`;
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
  const pairs = { Control: 17, Alt: 18, Shift: 16 };
  for (const [name, vk] of Object.entries(pairs)) {
    if (e.code.startsWith(name) && !held.has(name + 'Left') && !held.has(name + 'Right')) exports.Key(vk, 0, false, modifiers());
  }
});
window.addEventListener('blur', () => held.clear());

// The last chance to save: a tab being closed, reloaded or put in the background.
window.addEventListener('pagehide', () => exports.PageHidden());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') exports.PageHidden(); });

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
