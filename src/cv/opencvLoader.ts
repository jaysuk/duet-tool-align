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

function awaitRuntime(): Promise<CvLike> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const timeoutMs = 30_000;
		const tick = () => {
			const g = globalThis.cv as unknown;
			if (g) {
				// Newer factory form: cv is a function returning a promise to the module.
				if (typeof g === "function") {
					(g as () => Promise<CvLike>)().then(resolve).catch(reject);
					return;
				}
				const mod = g as { Mat?: unknown; onRuntimeInitialized?: () => void };
				if (mod.Mat) {
					resolve(mod as unknown as CvLike);
					return;
				}
				// Older form: wait for the runtime-initialised callback.
				mod.onRuntimeInitialized = () => resolve(mod as unknown as CvLike);
				return;
			}
			if (Date.now() - start > timeoutMs) {
				reject(new Error("OpenCV.js did not initialise within 30s"));
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
