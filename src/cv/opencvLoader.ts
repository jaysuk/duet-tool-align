/**
 * Loads the OpenCV.js (WASM) runtime at runtime from a URL — by default the duet-webcam-bridge's
 * /opencv/opencv.js, so the heavy WASM never has to be bundled into the plugin's IIFE or shipped on
 * the Duet's SD card. `Module.locateFile` is pointed at the same directory so the loader fetches
 * opencv_js.wasm alongside the script (the bridge serves both with permissive CORS).
 *
 * Tolerant of both prebuilt shapes: older builds expose a global `cv` that fires
 * `onRuntimeInitialized`; newer ones export a factory function returning a promise. Cached so repeat
 * callers share one instance.
 */
import type { CvLike } from "./detectNozzle";

declare global {
	// eslint-disable-next-line no-var
	var cv: unknown;
	// eslint-disable-next-line no-var
	var Module: Record<string, unknown> | undefined;
}

let cached: Promise<CvLike> | null = null;

function baseDir(url: string): string {
	const i = url.lastIndexOf("/");
	return i >= 0 ? url.slice(0, i + 1) : "";
}

function injectScript(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[data-opencv="${CSS.escape(url)}"]`);
		if (existing) {
			resolve();
			return;
		}
		const script = document.createElement("script");
		script.src = url;
		script.async = true;
		script.dataset.opencv = url;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error(`failed to load OpenCV.js from ${url}`));
		document.head.appendChild(script);
	});
}

/**
 * Resolve once the OpenCV.js runtime is usable, tolerant of every prebuilt shape the global `cv` can
 * take: a thenable/Promise, a factory function returning one, a module that's already initialised
 * (has `Mat`), or one that still needs to fire `onRuntimeInitialized`. Polls so that a callback firing
 * before we attach it (a real race with inlined-wasm builds) is still caught via the `Mat` check.
 */
function awaitRuntime(): Promise<CvLike> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + 30_000;
		let asyncHandled = false;
		const finalize = (m: unknown) => resolve(m as CvLike);

		const tick = () => {
			const g = globalThis.cv as unknown;
			if (g) {
				const obj = g as { then?: unknown; Mat?: unknown; onRuntimeInitialized?: () => void; __taHook?: boolean };
				// Promise/thenable form.
				if (typeof obj.then === "function" && !asyncHandled) {
					asyncHandled = true;
					(g as Promise<CvLike>).then(finalize, reject);
					return;
				}
				// Factory-function form.
				if (typeof g === "function" && !asyncHandled) {
					asyncHandled = true;
					try { Promise.resolve((g as () => unknown)()).then(finalize, reject); } catch (e) { reject(e); }
					return;
				}
				// Already initialised.
				if (obj.Mat) {
					finalize(g);
					return;
				}
				// Module present but not ready yet — attach the init callback once, then keep polling in
				// case it already fired.
				if (!obj.__taHook) {
					obj.__taHook = true;
					const prev = obj.onRuntimeInitialized;
					obj.onRuntimeInitialized = () => { try { prev?.(); } finally { finalize(g); } };
				}
			}
			if (Date.now() > deadline) {
				reject(new Error("OpenCV.js loaded but did not initialise within 30s"));
				return;
			}
			setTimeout(tick, 50);
		};
		tick();
	});
}

/** Load (and cache) the OpenCV.js runtime from `url` (the bridge's opencv.js). */
export function loadOpenCV(url: string): Promise<CvLike> {
	if (cached) return cached;
	cached = (async () => {
		// Point Emscripten at the bridge dir so it fetches opencv_js.wasm from there, not the DWC origin.
		const dir = baseDir(url);
		globalThis.Module = {
			...(globalThis.Module ?? {}),
			locateFile: (file: string) => dir + file,
		};
		await injectScript(url);
		return awaitRuntime();
	})();
	cached.catch(() => { cached = null; }); // allow retry after a failed load
	return cached;
}

/** Test seam: drop the cached runtime (used by unit tests). */
export function _resetOpenCVCache(): void {
	cached = null;
}
