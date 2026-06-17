/**
 * Web-Worker nozzle detector.
 *
 * OpenCV.js (~10 MB JS + ~7.5 MB inlined wasm) compiles and runs far too heavily to live on the
 * page's main thread — doing so freezes the whole DWC tab during load and on every detection. So all
 * of it runs in a Worker: the worker `importScripts()` the OpenCV.js URL (served by the bridge with
 * CORS), waits for the runtime, and on each request runs the same multi-pass Hough pipeline as the
 * pure `detectCircles`, returning candidate circles. The main thread only does the cheap
 * pick-nearest-centre (kept pure + tested in detectNozzle.ts).
 *
 * The worker is built from an inline Blob so nothing extra has to be emitted by DWC's single-IIFE
 * plugin build. Frames are sent as transferables (zero-copy). Detection is downscaled to ~800 px wide
 * inside the worker for speed, with circle coordinates scaled back to original-image pixels so the
 * overlay and calibration stay in one consistent coordinate space.
 */
import type { Circle } from "./detectNozzle";

// NB: plain JS, no backticks. Mirrors detectCircles() — keep the two in sync if the pipeline changes.
const WORKER_SOURCE = `
let cvRef = null;
let ready = false;

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

function detect(cv, data, width, height, minR, maxR) {
  const src = cv.matFromImageData({ data: data, width: width, height: height });
  const gray = new cv.Mat();
  const work = new cv.Mat();
  const found = [];
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const maxW = 800;
    const scale = width > maxW ? maxW / width : 1;
    if (scale < 1) {
      cv.resize(gray, work, new cv.Size(Math.round(width * scale), Math.round(height * scale)), 0, 0, cv.INTER_AREA);
    } else {
      gray.copyTo(work);
    }
    cv.medianBlur(work, work, 5);
    const w = work.cols, h = work.rows;
    const minDist = Math.max(20, Math.floor(Math.min(w, h) / 8));
    const passes = [[1, 100, 60], [1, 100, 40], [1.5, 80, 30]];
    for (let k = 0; k < passes.length; k++) {
      const p = passes[k];
      const c = new cv.Mat();
      try {
        cv.HoughCircles(work, c, cv.HOUGH_GRADIENT, p[0], minDist, p[1], p[2], Math.round(minR * scale), Math.round(maxR * scale));
        for (let i = 0; i < c.cols; i++) {
          const b = i * 3;
          found.push({ x: c.data32F[b] / scale, y: c.data32F[b + 1] / scale, r: c.data32F[b + 2] / scale });
        }
      } finally { c.delete(); }
    }
  } finally { src.delete(); gray.delete(); work.delete(); }
  return found;
}

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      importScripts(msg.url);
      awaitRuntime(self.cv, function (m) { cvRef = m || self.cv; ready = true; self.postMessage({ type: 'ready' }); },
        function (err) { self.postMessage({ type: 'error', error: String(err && err.message || err) }); });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err && err.message || err) });
    }
    return;
  }
  if (msg.type === 'detect') {
    if (!ready) { self.postMessage({ type: 'result', id: msg.id, circles: [] }); return; }
    try {
      const data = new Uint8ClampedArray(msg.buffer);
      const circles = detect(cvRef, data, msg.width, msg.height, msg.minR, msg.maxR);
      self.postMessage({ type: 'result', id: msg.id, circles: circles });
    } catch (err) {
      self.postMessage({ type: 'result', id: msg.id, circles: [], error: String(err && err.message || err) });
    }
    return;
  }
};
`;

export class WorkerDetector {
	private worker: Worker | null = null;
	private nextId = 1;
	private pending = new Map<number, (circles: Array<Circle>) => void>();
	private ready = false;

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
			const d = e.data as { type?: string; id?: number; circles?: Array<Circle> };
			if (d.type === "result" && typeof d.id === "number") {
				const cb = this.pending.get(d.id);
				if (cb) { this.pending.delete(d.id); cb(d.circles ?? []); }
			}
		});
	}

	/** Detect candidate circles in a frame. Transfers the pixel buffer (the ImageData is consumed). */
	detect(img: ImageData, opts: { minRadius?: number; maxRadius?: number } = {}): Promise<Array<Circle>> {
		if (!this.worker || !this.ready) return Promise.resolve([]);
		const id = this.nextId++;
		const minR = opts.minRadius ?? 5;
		const maxR = opts.maxRadius ?? Math.floor(Math.min(img.width, img.height) / 2);
		const buffer = img.data.buffer;
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			this.worker!.postMessage({ type: "detect", id, width: img.width, height: img.height, buffer, minR, maxR }, [buffer]);
		});
	}

	dispose(): void {
		this.worker?.terminate();
		this.worker = null;
		this.ready = false;
		this.pending.clear();
	}
}
