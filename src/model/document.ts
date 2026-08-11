/**
 * Plugin configuration model + persistence.
 *
 * The config is stored under DWC's settings store at `plugins.duetToolAlign.config`, exactly like
 * Flexible-Layouts stores its document — so it's persisted with the rest of DWC's settings (on the
 * board by default, following the machine) and survives settings export/import. The field set is a
 * superset of FL's `toolAlign` widget config (camera position, feeds, reference tool, offset sign,
 * start/finish/save commands) plus the CV-specific knobs, so a future merge into FL is a rename, not
 * a redesign.
 *
 * The calibration transform (pixel-to-mm) is persisted too, in `transform` below, but only when
 * `cameraRigid` is set -- a rigidly-mounted camera's calibration only depends on its fixed mount
 * position/zoom relative to whatever's under the lens, so it doesn't change between sessions and
 * re-running Calibrate after every page reload for no physical reason is pure friction. A camera that
 * gets picked up/repositioned between sessions (handheld, magnetically mounted, etc.) has no such
 * guarantee, so `cameraRigid` defaults to false and the widget keeps that case's transform local to the
 * session instead of persisting it. Calibrate still overwrites the live value whenever you actually need
 * it to (camera bumped, refocused, repositioned) regardless of which mode you're in.
 */
import { reactive } from "vue";

import { useSettingsStore } from "@/stores/settings";

import type { Mat2 } from "../cv/geometry";
import { PLUGIN_ID } from "./constants";

/**
 * The subset of Detection fields that can be overridden per tool (or the carriage datum) -- nozzle
 * size/finish, and therefore what detects it well, can genuinely differ between tools. Kept as its own
 * type so DetectionSettings and the equivalent fields on AutoAlignConfig (the global/default values)
 * can't drift apart.
 */
export interface DetectionSettings {
	minRadiusPx: number;
	maxRadiusPx: number;
	detector: "hough" | "contour";
	threshold: number;
	minCircularity: number;
	darkBore: boolean;
	houghDp: number;
	houghParam1: number;
	houghParam2: number;
	houghMinDist: number;
	blurKsize: number;
	detectWidth: number;
	pickLargest: boolean;
}

export interface AutoAlignConfig {
	/** Camera stream/snapshot base URL (the duet-webcam-bridge), e.g. http://192.168.1.50:8081 */
	bridgeUrl: string;
	/** OpenCV.js loader URL. Default derives from bridgeUrl (`<bridge>/opencv/opencv.js`). */
	opencvUrl: string;

	/**
	 * How the 0,0 origin is defined:
	 *  - "tool":  a reference tool (e.g. T0). Its captured centre is the origin; other tools are
	 *             measured relative to it and the reference tool itself keeps its existing G10.
	 *  - "point": a fixed carriage datum (e.g. the E3D toolchanger's nozzle-alignment switch).
	 *             You capture that point once; EVERY tool (T0 included) is offset from it.
	 */
	referenceMode: "tool" | "point";
	/** Reference tool number (used when referenceMode = "tool"). */
	referenceTool: number;
	/** Negate computed offsets (machine/firmware sign convention escape hatch). */
	invertOffsets: boolean;

	/** Saved camera position in machine coordinates (where the nozzle sits over the lens). */
	cameraX: number | null;
	cameraY: number | null;
	cameraZ: number | null;
	/** Safe Z to lift to before travelling between tools/camera. */
	safeZ: number | null;
	/** Use G53 (machine coords) for the travel moves so a mid-calibration tool offset can't shift them. */
	useG53: boolean;
	/** Feed rates (mm/min). */
	travelFeed: number;
	jogFeed: number;

	/** Calibration: half-extent of the jog star around the start point, in mm. */
	calibStepMm: number;
	/** Settle dwell after each move before grabbing a frame, in ms (lets ooze/vibration settle). */
	settleMs: number;

	/** Convergence + control tolerances. */
	tolerancePx: number;
	gain: number;
	maxStepMm: number;
	/** Frames median-averaged for the displayed detection marker, to steady a jumpy lock. 1 = off. */
	smoothing: number;
	/** Max iterations for the per-tool centring loop before giving up. */
	maxIterations: number;

	/** Expected nozzle radius range in the image, in pixels. */
	minRadiusPx: number;
	maxRadiusPx: number;

	/** Detector algorithm: "hough" (circle transform) or "contour" (threshold + contour of the bore). */
	detector: "hough" | "contour";

	/** --- Contour detector tuning --- */
	/** Binary threshold 0–255; 0 = auto (Otsu). Pixels past it become the candidate blob. */
	threshold: number;
	/** Minimum contour circularity (4π·area/perimeter²), 0–1. Higher rejects non-round blobs. */
	minCircularity: number;
	/** The bore is darker than the nozzle (threshold keeps dark pixels). Off for a light target. */
	darkBore: boolean;

	/** --- HoughCircles detection tuning (exposed for live tuning) --- */
	/** Inverse accumulator resolution. 1 = full res; higher finds rougher circles. */
	houghDp: number;
	/** Canny high threshold (edge sensitivity). */
	houghParam1: number;
	/** Accumulator threshold — LOWER finds more (and weaker) circles. The main knob. */
	houghParam2: number;
	/** Minimum distance between detected circle centres, in px. 0 = auto (frame/8). */
	houghMinDist: number;
	/** Median blur kernel size (odd). 0 or 1 = no blur. */
	blurKsize: number;
	/** Downscale width for detection, in px (coords are scaled back). 0 = no downscale. */
	detectWidth: number;
	/** Pick the largest candidate circle instead of the one nearest frame centre. Useful while the
	 *  nozzle is deliberately off-centre during tuning; centring works better with "nearest". */
	pickLargest: boolean;

	/** Per-tool (keyed by tool number as a string, e.g. "2") or carriage-datum ("datum") overrides for
	 *  any subset of the DetectionSettings fields above. A missing key (or a profile with no entry for
	 *  it) falls back to the corresponding global field. The tool profile used for live detection always
	 *  follows whichever tool is actually loaded; the "datum" profile is used by the camera-assisted
	 *  "Centre & capture datum" action. The plain manual "Capture datum" action (a direct position read,
	 *  no camera involved) ignores it entirely. */
	detectProfiles: Record<string, Partial<DetectionSettings>>;

	/** Z focus jog step, in mm (the -Z/+Z buttons that sharpen the image). */
	zStep: number;
	/** X/Y manual jog step, in mm (the X/Y jog buttons for bringing a tool into frame). */
	xyStep: number;

	/** Optional macros run at the start/finish of a full alignment run, and to persist offsets. */
	startCommand: string;
	finishCommand: string;
	saveCommand: string;

	/** Whether the camera is fixed in place relative to the machine (vs. handheld/removable). Gates
	 *  whether `transform` below is persisted -- see the module doc comment above. */
	cameraRigid: boolean;

	/** Pixel-to-mm calibration transform from the last successful Calibrate, or null if never run
	 *  (or run and then invalidated) this camera setup. Only meaningful to persist across reloads when
	 *  `cameraRigid` is set -- see the module doc comment above. */
	transform: Mat2 | null;
}

export function defaultConfig(): AutoAlignConfig {
	return {
		bridgeUrl: "",
		opencvUrl: "",
		referenceMode: "tool",
		referenceTool: 0,
		invertOffsets: false,
		cameraX: null,
		cameraY: null,
		cameraZ: null,
		safeZ: null,
		useG53: true,
		travelFeed: 6000,
		jogFeed: 1200,
		calibStepMm: 0.5,
		settleMs: 400,
		tolerancePx: 2,
		gain: 0.8,
		maxStepMm: 2,
		smoothing: 3,
		maxIterations: 25,
		minRadiusPx: 5,
		maxRadiusPx: 120,
		detector: "hough",
		threshold: 0,
		minCircularity: 0.6,
		darkBore: true,
		houghDp: 1,
		houghParam1: 100,
		houghParam2: 30,
		houghMinDist: 0,
		blurKsize: 5,
		detectWidth: 800,
		pickLargest: false,
		detectProfiles: {},
		zStep: 0.05,
		xyStep: 0.1,
		startCommand: "",
		finishCommand: "",
		saveCommand: "M500",
		cameraRigid: false,
		transform: null,
	};
}

/**
 * Resolve the OpenCV.js URL. Priority: explicit override → the OpenCV runtime bundled with this
 * plugin (served from DWC's web root, resolved via DWC's `pluginAssetUrl`, DWC 3.7 b9b93bb+) → the
 * camera bridge's /opencv copy (fallback for older DWC). Reads the global `window.DWC` rather than
 * importing `@/plugins`, so it stays resolvable in unit tests too.
 */
export function resolveOpencvUrl(cfg: AutoAlignConfig): string {
	if (cfg.opencvUrl) return cfg.opencvUrl;
	const dwc = (globalThis as { DWC?: { pluginAssetUrl?: (p: string) => string } }).DWC;
	if (dwc?.pluginAssetUrl) {
		// Non-".js" name so DWC's loader doesn't auto-inject the 10 MB runtime as a <script> at startup;
		// the CV worker fetch+evals it on demand instead.
		const rel = dwc.pluginAssetUrl("DuetToolAlign/opencv.bin");
		try { return new URL(rel, location.href).href; } catch { return rel; }
	}
	if (cfg.bridgeUrl) return cfg.bridgeUrl.replace(/\/+$/, "") + "/opencv/opencv.js";
	return "";
}

/**
 * The live, reactive, persisted config object. Reads/writes go straight through DWC's settings store
 * so any edit is saved automatically. Missing keys are backfilled from defaults so a config written
 * by an older plugin version keeps working.
 */
export function useConfig(): AutoAlignConfig {
	const settings = useSettingsStore();
	const plugins = settings.plugins as Record<string, Record<string, unknown>>;
	if (!plugins[PLUGIN_ID]) plugins[PLUGIN_ID] = {};
	const container = plugins[PLUGIN_ID];
	if (!container.config) {
		container.config = reactive(defaultConfig());
	} else {
		// Backfill any new keys onto the persisted object without clobbering saved values.
		const defaults = defaultConfig();
		const cfg = container.config as Record<string, unknown>;
		for (const [k, v] of Object.entries(defaults)) {
			if (!(k in cfg)) cfg[k] = v;
		}
	}
	return container.config as AutoAlignConfig;
}
