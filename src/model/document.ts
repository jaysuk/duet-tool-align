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
 * The persisted calibration transform is intentionally NOT stored here: it's a per-session
 * measurement that depends on the exact camera/lens placement and is recomputed each run.
 */
import { reactive } from "vue";

import { useSettingsStore } from "@/stores/settings";

import { PLUGIN_ID } from "./constants";

export interface AutoAlignConfig {
	/** Camera stream/snapshot base URL (the duet-webcam-bridge), e.g. http://192.168.1.50:8081 */
	bridgeUrl: string;
	/** OpenCV.js loader URL. Default derives from bridgeUrl (`<bridge>/opencv/opencv.js`). */
	opencvUrl: string;

	/** Reference tool number; its centre is the origin all offsets are measured from. */
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
	/** Max iterations for the per-tool centring loop before giving up. */
	maxIterations: number;

	/** Expected nozzle radius range in the image, in pixels. */
	minRadiusPx: number;
	maxRadiusPx: number;

	/** Optional macros run at the start/finish of a full alignment run, and to persist offsets. */
	startCommand: string;
	finishCommand: string;
	saveCommand: string;
}

export function defaultConfig(): AutoAlignConfig {
	return {
		bridgeUrl: "",
		opencvUrl: "",
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
		tolerancePx: 1,
		gain: 0.8,
		maxStepMm: 2,
		maxIterations: 25,
		minRadiusPx: 5,
		maxRadiusPx: 120,
		startCommand: "",
		finishCommand: "",
		saveCommand: "M500",
	};
}

/** Resolve the OpenCV.js URL: explicit override, else derived from the bridge URL. */
export function resolveOpencvUrl(cfg: AutoAlignConfig): string {
	if (cfg.opencvUrl) return cfg.opencvUrl;
	if (!cfg.bridgeUrl) return "";
	return cfg.bridgeUrl.replace(/\/+$/, "") + "/opencv/opencv.js";
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
