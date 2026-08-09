/**
 * Web-Worker nozzle detector.
 *
 * OpenCV.js (~10 MB JS + ~7.5 MB inlined wasm) compiles and runs far too heavily to live on the
 * page's main thread — doing so freezes the whole DWC tab during load and on every detection. So all
 * of it runs in a Worker: the worker fetches the OpenCV.js source and runs it (indirect eval) on
 * first init, waits for the runtime, and on each request runs the Hough/contour pipeline, returning
 * candidate circles. The main thread only does the cheap pick-nearest-centre (in detectNozzle.ts).
 *
 * The runtime is shipped as a NON-".js" plugin asset (opencv.bin) loaded on demand here, so DWC's
 * plugin loader doesn't auto-inject the 10 MB file as a <script> on every page load.
 *
 * The worker is built from an inline Blob so nothing extra has to be emitted by DWC's single-IIFE
 * plugin build. Frames are sent as transferables (zero-copy). Detection is downscaled to ~800 px wide
 * inside the worker for speed, with circle coordinates scaled back to original-image pixels so the
 * overlay and calibration stay in one consistent coordinate space.
 */
import type { Circle, DetectParams } from "./detectNozzle";

// NB: plain JS, no backticks. Mirrors detectCircles() — keep the two in sync if the pipeline changes.
const WORKER_SOURCE = `
let cvRef = null;
let ready = false;
let loggedOnce = false;

function awaitRuntime(g, done, fail) {
  const deadline = Date.now() + 30000;
  let asyncHandled = false;
  (function tick() {
    if (g) {
      if (typeof g.then === 'function' && !asyncHandled) { asyncHandled = true; g.then(done, fail); return; }
      if (typeof g === 'function' && !asyncHandled) { asyncHandled = true; try { Promise.resolve(g()).then(done, fail); } catch (e) { fail(e); } return; }
      if (g.Mat) { done(g); return; }
      if (!g.__taHook) { g.__taHook = true; const prev = g.onRuntimeInitialized; g.onRuntimeInitialized = function () { try { prev && prev(); } finally { done(self.cv); } }; }
    }
    if (Date.now() > deadline) { fail(new Error('OpenCV.js did not initialise within 30s')); return; }
    setTimeout(tick, 50);
  })();
}

// Shared preprocessing: grayscale, optional downscale (for speed), optional median blur. Returns the
// working Mat and the scale factor (so circle coords can be mapped back to original-frame px).
function prep(cv, data, width, height, p) {
  const src = cv.matFromImageData({ data: data, width: width, height: height });
  const gray = new cv.Mat();
  const work = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const target = p.detectWidth > 0 ? p.detectWidth : width;
  const scale = width > target ? target / width : 1;
  if (scale < 1) {
    cv.resize(gray, work, new cv.Size(Math.round(width * scale), Math.round(height * scale)), 0, 0, cv.INTER_AREA);
  } else {
    gray.copyTo(work);
  }
  const ks = p.blur >= 3 && p.blur % 2 === 1 ? p.blur : 0;
  if (ks) cv.medianBlur(work, work, ks);
  src.delete(); gray.delete();
  return { work: work, scale: scale };
}

function detectHough(cv, work, scale, p) {
  const found = [];
  const minDist = p.minDist > 0 ? p.minDist * scale : Math.max(20, Math.floor(Math.min(work.cols, work.rows) / 8));
  const c = new cv.Mat();
  try {
    cv.HoughCircles(work, c, cv.HOUGH_GRADIENT, p.dp, minDist, p.param1, p.param2,
      Math.round(p.minRadius * scale), Math.round(p.maxRadius * scale));
    for (let i = 0; i < c.cols; i++) {
      const b = i * 3;
      const r = c.data32F[b + 2] / scale;
      // HOUGH_GRADIENT estimates radius in a pass separate from centre detection, so the min/maxRadius
      // passed above isn't always a hard filter -- occasionally a candidate's estimated radius lands
      // outside the requested range anyway. Enforce it explicitly so a stray circle can't win the pick.
      if (r < p.minRadius || r > p.maxRadius) continue;
      found.push({ x: c.data32F[b] / scale, y: c.data32F[b + 1] / scale, r: r });
    }
  } finally { c.delete(); }
  return found;
}

// Threshold the bore (dark blob on a bright nozzle), clean it morphologically, then take each
// sufficiently-round contour's min-enclosing circle. Robust to glare/texture that fools Hough.
function detectContour(cv, work, scale, p) {
  const found = [];
  const bin = new cv.Mat();
  const type = (p.darkBore ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY);
  if (p.threshold > 0) cv.threshold(work, bin, p.threshold, 255, type);
  else cv.threshold(work, bin, 0, 255, type | cv.THRESH_OTSU);
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  try {
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, k);
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k);
  } finally { k.delete(); }
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const minRs = p.minRadius * scale, maxRs = p.maxRadius * scale;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      try {
        const area = cv.contourArea(cnt, false);
        const peri = cv.arcLength(cnt, true);
        if (peri > 0 && area > 0) {
          const circ = 4 * Math.PI * area / (peri * peri);
          const mec = cv.minEnclosingCircle(cnt);
          if (circ >= p.minCircularity && mec.radius >= minRs && mec.radius <= maxRs) {
            found.push({ x: mec.center.x / scale, y: mec.center.y / scale, r: mec.radius / scale });
          }
        }
      } finally { cnt.delete(); }
    }
  } finally { contours.delete(); hierarchy.delete(); bin.delete(); }
  return found;
}

// Focus-assist metric: variance of the Laplacian (mirrors computeSharpness() in detectNozzle.ts --
// keep the two in sync). Computed on the same prepped (downscaled/blurred) Mat already built for
// detection, so this is what the detector itself "sees" -- no extra frame work.
function sharpness(cv, work) {
  const lap = new cv.Mat();
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  try {
    cv.Laplacian(work, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, stddev);
    const sd = stddev.data64F[0];
    return sd * sd;
  } finally { lap.delete(); mean.delete(); stddev.delete(); }
}

function detect(cv, data, width, height, p) {
  const prepped = prep(cv, data, width, height, p);
  try {
    const circles = p.method === 'contour' ? detectContour(cv, prepped.work, prepped.scale, p) : detectHough(cv, prepped.work, prepped.scale, p);
    return { circles: circles, sharpness: sharpness(cv, prepped.work) };
  } finally { prepped.work.delete(); }
}

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type === 'init') {
    // Fetch the OpenCV.js source and run it via indirect eval (global scope → sets self.cv) instead of
    // importScripts. This lets the asset ship with a non-".js" name so DWC's plugin loader doesn't
    // auto-inject the ~10 MB runtime as a <script> on every page load; it's loaded only here, when the
    // widget first mounts. fetch is MIME-agnostic (the asset can be served as octet-stream).
    fetch(msg.url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' loading ' + msg.url); return r.text(); })
      .then(function (src) {
        (0, eval)(src);
        awaitRuntime(self.cv, function (m) { cvRef = m || self.cv; ready = true; self.postMessage({ type: 'ready' }); },
          function (err) { self.postMessage({ type: 'error', error: String(err && err.message || err) }); });
      })
      .catch(function (err) { self.postMessage({ type: 'error', error: String(err && err.message || err) }); });
    return;
  }
  if (msg.type === 'detect') {
    if (!ready) { self.postMessage({ type: 'result', id: msg.id, circles: [], sharpness: 0, error: 'cv-not-ready' }); return; }
    try {
      const data = new Uint8ClampedArray(msg.buffer);
      const res = detect(cvRef, data, msg.width, msg.height, msg.params);
      if (!loggedOnce) { loggedOnce = true; console.log('[ToolAlign worker] first detect ok', { method: msg.params && msg.params.method, w: msg.width, h: msg.height, found: res.circles.length, hasMatFromImageData: typeof cvRef.matFromImageData }); }
      self.postMessage({ type: 'result', id: msg.id, circles: res.circles, sharpness: res.sharpness });
    } catch (err) {
      // Surface the real exception: previously this was swallowed, so a broken pipeline just looked
      // like "no nozzle found" forever. Log here (visible in the worker's console) and report it back.
      console.error('[ToolAlign worker] detect failed:', (err && err.stack) || String(err));
      self.postMessage({ type: 'result', id: msg.id, circles: [], sharpness: 0, error: String(err && err.message || err) });
    }
    return;
  }
};
`;

/** Candidate circles plus the frame's focus-assist sharpness score (see computeSharpness() in detectNozzle.ts). */
export interface DetectResult {
	circles: Array<Circle>;
	sharpness: number;
}

export class WorkerDetector {
	private worker: Worker | null = null;
	private nextId = 1;
	private pending = new Map<number, (result: DetectResult) => void>();
	private ready = false;
	/** Last per-frame detect error reported by the worker (null when the last detect was clean). */
	lastError: string | null = null;

	get isReady(): boolean {
		return this.ready;
	}

	/** Spin up the worker and load OpenCV from `opencvUrl`. Resolves once the runtime is ready. */
	init(opencvUrl: string): Promise<void> {
		if (this.ready) return Promise.resolve();
		const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
		const blobUrl = URL.createObjectURL(blob);
		const worker = new Worker(blobUrl);
		URL.revokeObjectURL(blobUrl);
		this.worker = worker;

		return new Promise<void>((resolve, reject) => {
			const onReady = (e: MessageEvent) => {
				const d = e.data as { type?: string; error?: string };
				if (d.type === "ready") { cleanup(); this.ready = true; this.attachResultHandler(); resolve(); }
				else if (d.type === "error") { cleanup(); reject(new Error(d.error || "OpenCV worker failed")); }
			};
			const onErr = (err: ErrorEvent) => { cleanup(); reject(new Error(err.message || "worker error")); };
			const cleanup = () => {
				worker.removeEventListener("message", onReady);
				worker.removeEventListener("error", onErr);
			};
			worker.addEventListener("message", onReady);
			worker.addEventListener("error", onErr);
			worker.postMessage({ type: "init", url: opencvUrl });
		});
	}

	private attachResultHandler(): void {
		this.worker?.addEventListener("message", (e: MessageEvent) => {
			const d = e.data as { type?: string; id?: number; circles?: Array<Circle>; sharpness?: number; error?: string };
			if (d.type === "result" && typeof d.id === "number") {
				this.lastError = d.error ?? null;
				if (d.error) console.warn("[ToolAlign] worker detect error:", d.error);
				const cb = this.pending.get(d.id);
				if (cb) { this.pending.delete(d.id); cb({ circles: d.circles ?? [], sharpness: d.sharpness ?? 0 }); }
			}
		});
	}

	/** Detect candidate circles (+ focus sharpness) in a frame. Transfers the pixel buffer (the ImageData is consumed). */
	detect(img: ImageData, params: DetectParams): Promise<DetectResult> {
		if (!this.worker || !this.ready) return Promise.resolve({ circles: [], sharpness: 0 });
		const id = this.nextId++;
		const buffer = img.data.buffer;
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			this.worker!.postMessage({ type: "detect", id, width: img.width, height: img.height, buffer, params }, [buffer]);
		});
	}

	dispose(): void {
		this.worker?.terminate();
		this.worker = null;
		this.ready = false;
		this.pending.clear();
	}
}
