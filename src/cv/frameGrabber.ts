/**
 * Grabs a single frame from the camera bridge as ImageData for CV.
 *
 * Fetches `<bridgeUrl>/snapshot` into an Image with crossOrigin="anonymous" (the bridge sends
 * Access-Control-Allow-Origin), draws it to an offscreen canvas, and reads the pixels back. The
 * crossOrigin + CORS pairing is what stops the canvas being "tainted" so getImageData can succeed —
 * without it the browser throws a SecurityError. A cache-busting query param defeats the bridge's
 * no-store snapshot being reused by the image cache.
 *
 * Lives outside the Vue component so it can be reused by the calibration/alignment orchestration and
 * (in principle) tested with a stubbed Image/canvas.
 */

export interface GrabOptions {
	/** Snapshot endpoint. Default `<bridgeUrl>/snapshot`. */
	snapshotPath?: string;
	/** Per-grab timeout in ms. Default 5000. */
	timeoutMs?: number;
}

function snapshotUrl(bridgeUrl: string, path: string): string {
	const base = bridgeUrl.replace(/\/+$/, "");
	const url = path.startsWith("http") ? path : base + path;
	return url + (url.includes("?") ? "&" : "?") + "_t=" + Date.now();
}

/** Load one snapshot from the bridge and return its pixels as ImageData. */
export function grabFrame(bridgeUrl: string, opts: GrabOptions = {}): Promise<ImageData> {
	const url = snapshotUrl(bridgeUrl, opts.snapshotPath ?? "/snapshot");
	const timeoutMs = opts.timeoutMs ?? 5000;

	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		let done = false;
		const timer = setTimeout(() => {
			if (done) return;
			done = true;
			reject(new Error("snapshot timed out — is the bridge reachable?"));
		}, timeoutMs);

		img.onload = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			try {
				const canvas = document.createElement("canvas");
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext("2d", { willReadFrequently: true });
				if (!ctx) throw new Error("could not get a 2D canvas context");
				ctx.drawImage(img, 0, 0);
				resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
			} catch (e) {
				// Most likely a tainted canvas — the bridge didn't send CORS headers.
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		};
		img.onerror = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			reject(new Error(`could not load snapshot from ${url}`));
		};
		img.src = url;
	});
}
