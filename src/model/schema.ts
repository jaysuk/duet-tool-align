/**
 * The widget config schema for the Auto Tool Align widget — the FL-facing contract (see
 * dwc-plugin-runtime's widget-config framework). Registered at plugin load so Flexible Layouts can
 * render an editor and pass per-instance config to the widget.
 *
 * Defaults are sourced from {@link defaultConfig} so they never drift from the plugin's own settings.
 */
import type { WidgetConfigSchema } from "dwc-plugin-runtime";

import { defaultConfig } from "./document";
import { EMBEDDABLE_ID } from "./constants";

const D = defaultConfig() as unknown as Record<string, unknown>;
const isHough = (c: Record<string, unknown>) => c.detector === "hough";
const isContour = (c: Record<string, unknown>) => c.detector === "contour";
const isToolRef = (c: Record<string, unknown>) => c.referenceMode === "tool";

export const autoAlignSchema: WidgetConfigSchema = {
	id: EMBEDDABLE_ID,
	version: 1,
	fields: [
		// Connection
		{ key: "bridgeUrl", type: "text", label: "Camera bridge URL", group: "Camera", default: D.bridgeUrl,
			placeholder: "http://192.168.1.50:8081", description: "Base URL of the duet-webcam-bridge (camera stream + OpenCV.js)." },
		{ key: "opencvUrl", type: "text", label: "OpenCV.js URL", group: "Camera", default: D.opencvUrl,
			placeholder: "bundled with the plugin", description: "Override the OpenCV.js URL; blank uses the copy bundled with the plugin." },

		// Alignment & motion
		{ key: "referenceMode", type: "select", label: "Reference", group: "Alignment", default: D.referenceMode,
			options: [{ title: "Reference tool", value: "tool" }, { title: "Carriage datum", value: "point" }],
			description: "Origin: a reference tool (e.g. T0), or a fixed carriage datum that every tool is offset from." },
		{ key: "referenceTool", type: "number", label: "Reference tool", group: "Alignment", default: D.referenceTool,
			min: 0, step: 1, visibleWhen: isToolRef, description: "Tool number used as the origin." },
		{ key: "invertOffsets", type: "toggle", label: "Invert offsets", group: "Alignment", default: D.invertOffsets,
			description: "Negate computed offsets (firmware sign-convention escape hatch)." },
		{ key: "calibStepMm", type: "number", label: "Calibration step (mm)", group: "Alignment", default: D.calibStepMm,
			min: 0.05, max: 5, step: 0.05, description: "Half-size of the calibration jog star. Typical 0.3–1.0." },
		{ key: "tolerancePx", type: "number", label: "Tolerance (px)", group: "Alignment", default: D.tolerancePx,
			min: 0.5, max: 15, step: 0.5, description: "How close detections must agree to lock / count as centred. Typical 1–4." },
		{ key: "smoothing", type: "number", label: "Smoothing (frames)", group: "Alignment", default: D.smoothing,
			min: 1, max: 15, step: 1, description: "Median-average frames to steady a jumpy marker (display only). Typical 3–7." },
		{ key: "gain", type: "number", label: "Gain", group: "Alignment", default: D.gain,
			min: 0.1, max: 1.5, step: 0.05, description: "Fraction of each correction applied per centring step. Typical 0.5–0.9." },
		{ key: "maxStepMm", type: "number", label: "Max jog step (mm)", group: "Alignment", default: D.maxStepMm,
			min: 0.1, max: 10, step: 0.1, description: "Clamp on a single centring jog. Typical 0.5–3." },
		{ key: "maxIterations", type: "number", label: "Max iterations", group: "Alignment", default: D.maxIterations,
			min: 5, max: 100, step: 1, description: "Max centring jogs before giving up on a tool. Typical 15–40." },
		{ key: "settleMs", type: "number", label: "Settle (ms)", group: "Alignment", default: D.settleMs,
			min: 0, max: 3000, step: 50, description: "Pause after each move before grabbing a frame. Typical 200–800." },
		{ key: "travelFeed", type: "number", label: "Travel feed (mm/min)", group: "Alignment", default: D.travelFeed,
			min: 100, max: 30000, step: 100, description: "Feed for travel moves to the camera." },
		{ key: "jogFeed", type: "number", label: "Jog feed (mm/min)", group: "Alignment", default: D.jogFeed,
			min: 60, max: 12000, step: 60, description: "Feed for small calibration/centring/focus jogs." },
		{ key: "zStep", type: "number", label: "Z focus step (mm)", group: "Alignment", default: D.zStep,
			min: 0.01, max: 2, step: 0.01, description: "Z distance per -Z/+Z press. Typical 0.02–0.2." },
		{ key: "xyStep", type: "number", label: "XY jog step (mm)", group: "Alignment", default: D.xyStep,
			min: 0.01, max: 50, step: 0.05, description: "X/Y distance per jog button press." },

		// Detection
		{ key: "detector", type: "select", label: "Detector", group: "Detection", default: D.detector,
			options: [{ title: "Hough circles", value: "hough" }, { title: "Contour (threshold)", value: "contour" }],
			description: "Hough circle transform, or contour/threshold of the dark bore (best for shiny nozzles)." },
		{ key: "minRadiusPx", type: "number", label: "Min nozzle radius (px)", group: "Detection", default: D.minRadiusPx,
			min: 1, max: 1000, step: 1, description: "Smallest circle radius accepted. Raise to reject specks." },
		{ key: "maxRadiusPx", type: "number", label: "Max nozzle radius (px)", group: "Detection", default: D.maxRadiusPx,
			min: 1, max: 2000, step: 1, description: "Largest circle radius accepted. Must exceed the bore radius." },
		{ key: "blurKsize", type: "number", label: "Blur kernel (odd)", group: "Detection", default: D.blurKsize,
			min: 0, max: 21, step: 2, description: "Median blur before detection to suppress speckle. 0/1 = off. Typical 3–9." },
		{ key: "detectWidth", type: "number", label: "Detect width (px)", group: "Detection", default: D.detectWidth,
			min: 160, max: 2000, step: 20, description: "Downscale width for detection speed. Typical 480–1000." },
		{ key: "houghParam2", type: "number", label: "Sensitivity", group: "Detection", default: D.houghParam2,
			min: 1, max: 300, step: 1, visibleWhen: isHough, description: "Hough accumulator threshold; lower finds more circles. Typical 20–80." },
		{ key: "houghParam1", type: "number", label: "Edge threshold", group: "Detection", default: D.houghParam1,
			min: 10, max: 400, step: 5, visibleWhen: isHough, description: "Canny high threshold; higher keeps only strong edges. Typical 80–200." },
		{ key: "houghDp", type: "number", label: "Accumulator dp", group: "Detection", default: D.houghDp,
			min: 1, max: 3, step: 0.1, visibleWhen: isHough, description: "Inverse accumulator resolution. Typical 1–2." },
		{ key: "houghMinDist", type: "number", label: "Min centre dist (px)", group: "Detection", default: D.houghMinDist,
			min: 0, max: 2000, step: 5, visibleWhen: isHough, description: "Min distance between circle centres. 0 = auto." },
		{ key: "threshold", type: "number", label: "Threshold (0=auto)", group: "Detection", default: D.threshold,
			min: 0, max: 255, step: 1, visibleWhen: isContour, description: "Brightness cut for the bore. 0 = Otsu auto." },
		{ key: "minCircularity", type: "number", label: "Min circularity", group: "Detection", default: D.minCircularity,
			min: 0, max: 1, step: 0.05, visibleWhen: isContour, description: "How round a blob must be (0–1). Typical 0.5–0.8." },
		{ key: "darkBore", type: "toggle", label: "Dark bore", group: "Detection", default: D.darkBore,
			visibleWhen: isContour, description: "Bore is darker than the nozzle (threshold keeps dark pixels)." },
		{ key: "pickLargest", type: "toggle", label: "Pick largest circle", group: "Detection", default: D.pickLargest,
			description: "Lock the largest circle (the bore) rather than the nearest to centre. Turn off for centring." },

		// Macros
		{ key: "startCommand", type: "textarea", label: "Start command", group: "Macros", default: D.startCommand,
			description: "G-code run at the start of a full alignment run (optional)." },
		{ key: "finishCommand", type: "textarea", label: "Finish command", group: "Macros", default: D.finishCommand,
			description: "G-code run at the end of a full alignment run (optional)." },
		{ key: "saveCommand", type: "text", label: "Save command", group: "Macros", default: D.saveCommand,
			description: "G-code to persist offsets (e.g. M500)." },
	],
};
