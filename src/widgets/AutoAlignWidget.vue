<template>
  <div class="aa-root fill-height d-flex flex-column">
    <!-- Camera with crosshair + detected-circle overlay -->
    <div class="aa-cam flex-grow-1">
      <div v-if="!cfg.bridgeUrl" class="aa-setup pa-3">
        <div class="text-caption text-medium-emphasis mb-2">{{ $t("plugins.duetToolAlign.noUrl") }}</div>
        <v-text-field v-model="cfg.bridgeUrl" density="compact" variant="outlined" hide-details autofocus
                      :label="$t('plugins.duetToolAlign.settings.bridgeUrl')"
                      :placeholder="$t('plugins.duetToolAlign.settings.bridgeUrlHint')" />
      </div>
      <img v-else ref="imgEl" :src="streamSrc" class="aa-img" @error="onImgError" />

      <div class="aa-overlay">
        <div class="aa-cross-h" />
        <div class="aa-cross-v" />
        <div v-if="detectionStyle" class="aa-circle" :style="detectionStyle" />
      </div>
    </div>

    <!-- Status line -->
    <div class="aa-status text-caption px-2 py-1 flex-shrink-0 d-flex align-center" :class="statusClass">
      <v-icon size="14" class="mr-1">{{ statusIcon }}</v-icon><span>{{ statusText }}</span>
      <v-spacer />
      <v-btn v-if="cfg.bridgeUrl && !cvReady" size="x-small" variant="tonal" :loading="cvLoading" @click="ensureCv">
        {{ $t("plugins.duetToolAlign.cv.load") }}
      </v-btn>
    </div>

    <!-- Tool buttons (auto-populated from the object model) -->
    <div class="aa-tools d-flex flex-wrap align-center ga-1 px-1 pt-1 flex-shrink-0">
      <v-btn v-for="t in tools" :key="t.number" size="small" class="text-none aa-btn"
             :variant="t.number === current ? 'flat' : 'tonal'"
             :color="t.number === current ? 'primary' : undefined"
             :disabled="disabledNow" @click="select(t.number)">
        {{ t.name || ("T" + t.number) }}
        <v-icon v-if="t.number === cfg.referenceTool" size="14" class="ml-1">mdi-target</v-icon>
      </v-btn>
      <span v-if="!tools.length" class="text-caption text-medium-emphasis">{{ $t("plugins.duetToolAlign.tools.empty") }}</span>
    </div>

    <!-- Live detection (no motion — needs only the camera) + Z focus -->
    <div class="aa-focus d-flex flex-wrap align-center ga-1 px-1 pt-1 flex-shrink-0">
      <v-btn size="small" :variant="detecting ? 'flat' : 'tonal'" :color="detecting ? 'primary' : undefined"
             prepend-icon="mdi-eye" :disabled="busy || !cfg.bridgeUrl" @click="toggleDetect">
        {{ detecting ? $t("plugins.duetToolAlign.actions.stopDetect") : $t("plugins.duetToolAlign.actions.detect") }}
      </v-btn>
      <v-spacer />
      <span class="text-caption text-medium-emphasis mr-1">{{ $t("plugins.duetToolAlign.focus.label") }}</span>
      <v-btn size="small" variant="tonal" :disabled="disabledNow" @click="focusZ(-1)">Z−</v-btn>
      <v-btn size="small" variant="tonal" :disabled="disabledNow" @click="focusZ(1)">Z+</v-btn>
      <v-tooltip location="top" max-width="280" text="Z distance per -Z/+Z press (mm), to bring the nozzle into focus. Typical 0.02–0.2.">
        <template #activator="{ props }">
          <v-text-field v-bind="props" v-model.number="cfg.zStep" type="number" min="0.01" max="2" step="0.01"
                        density="compact" variant="outlined" hide-details class="aa-narrow" suffix="mm" />
        </template>
      </v-tooltip>
    </div>

    <!-- Camera position + primary actions -->
    <div class="aa-actions d-flex flex-wrap align-center ga-1 px-1 pt-1 flex-shrink-0">
      <v-btn size="small" variant="tonal" prepend-icon="mdi-camera-marker" :disabled="disabledNow || !hasCameraPos" @click="gotoCamera">
        {{ $t("plugins.duetToolAlign.camera.goto") }}
      </v-btn>
      <v-btn size="small" variant="text" prepend-icon="mdi-crosshairs" :disabled="disabledNow" @click="setCamera">
        {{ $t("plugins.duetToolAlign.camera.set") }}
      </v-btn>
      <v-spacer />
      <v-btn size="small" variant="tonal" prepend-icon="mdi-grid" :disabled="disabledNow || detecting || !cfg.bridgeUrl" @click="doCalibrate">
        {{ $t("plugins.duetToolAlign.actions.calibrate") }}
      </v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-image-filter-center-focus"
             :disabled="disabledNow || detecting || current < 0 || !transform" @click="centreCurrent">
        {{ $t("plugins.duetToolAlign.actions.centre") }}
      </v-btn>
      <v-btn size="small" color="primary" variant="flat" prepend-icon="mdi-play" :disabled="disabledNow || detecting || !cfg.bridgeUrl" @click="runFull">
        {{ $t("plugins.duetToolAlign.actions.runFull") }}
      </v-btn>
      <v-btn v-if="busy || detecting" size="small" color="error" variant="text" prepend-icon="mdi-stop" @click="stop">
        {{ $t("plugins.duetToolAlign.actions.stop") }}
      </v-btn>
    </div>
    <div v-if="!allHomed" class="text-caption text-warning px-2 pt-1 flex-shrink-0">
      <v-icon size="14">mdi-alert</v-icon> {{ $t("plugins.duetToolAlign.notHomed") }}
    </div>

    <!-- Offsets table -->
    <div class="aa-table flex-grow-1 px-1 pt-1">
      <table class="aa-grid">
        <thead>
          <tr>
            <th>{{ $t("plugins.duetToolAlign.offsets.tool") }}</th>
            <th>{{ $t("plugins.duetToolAlign.offsets.captured") }}</th>
            <th>{{ $t("plugins.duetToolAlign.offsets.offset") }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.number" :class="{ 'aa-ref': r.isRef }">
            <td>{{ r.name }}<span v-if="r.isRef" class="aa-badge">{{ $t("plugins.duetToolAlign.offsets.refBadge") }}</span></td>
            <td class="aa-num">{{ r.captured }}</td>
            <td class="aa-num">{{ r.offset }}</td>
            <td>
              <v-btn v-if="!r.isRef && r.g10" size="x-small" variant="tonal" :disabled="disabledNow" @click="applyTool(r.number)">
                {{ $t("plugins.duetToolAlign.offsets.apply") }}
              </v-btn>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="d-flex align-center ga-2 mt-1 flex-wrap">
        <v-btn size="small" color="primary" variant="flat" prepend-icon="mdi-content-save-cog"
               :disabled="disabledNow || !anyApplicable" @click="applyAll">
          {{ $t("plugins.duetToolAlign.offsets.applyAll") }}
        </v-btn>
        <v-btn v-if="cfg.saveCommand" size="small" variant="tonal" prepend-icon="mdi-content-save-check"
               :disabled="disabledNow" @click="saveOffsets">
          {{ $t("plugins.duetToolAlign.offsets.save") }}
        </v-btn>
        <v-btn size="small" variant="text" :disabled="disabledNow || current < 0" @click="setReference">
          {{ $t("plugins.duetToolAlign.offsets.setRef") }}
        </v-btn>
        <v-switch v-model="invert" density="compact" hide-details color="primary"
                  :label="$t('plugins.duetToolAlign.offsets.invert')" />
      </div>
      <div class="text-caption text-medium-emphasis mt-1">{{ $t("plugins.duetToolAlign.offsets.persistHint") }}</div>
    </div>

    <!-- Settings -->
    <v-expansion-panels class="aa-settings flex-shrink-0" variant="accordion">
      <v-expansion-panel :title="$t('plugins.duetToolAlign.settings.title')">
        <v-expansion-panel-text>
          <v-text-field v-model="cfg.bridgeUrl" density="compact" variant="outlined" hide-details class="mb-2"
                        :label="$t('plugins.duetToolAlign.settings.bridgeUrl')" :placeholder="$t('plugins.duetToolAlign.settings.bridgeUrlHint')">
            <template #append-inner>
              <v-tooltip location="top" max-width="300" text="Base URL of the duet-webcam-bridge, e.g. http://192.168.1.50:8081 — used for the camera stream and to load the CV engine.">
                <template #activator="{ props }"><v-icon v-bind="props" size="16" color="medium-emphasis">mdi-information-outline</v-icon></template>
              </v-tooltip>
            </template>
          </v-text-field>
          <v-text-field v-model="cfg.opencvUrl" density="compact" variant="outlined" hide-details class="mb-3"
                        :label="$t('plugins.duetToolAlign.settings.opencvUrl')" :placeholder="$t('plugins.duetToolAlign.settings.opencvUrlHint')">
            <template #append-inner>
              <v-tooltip location="top" max-width="300" text="Override the OpenCV.js URL. Leave blank to use <bridge>/opencv/opencv.js (recommended).">
                <template #activator="{ props }"><v-icon v-bind="props" size="16" color="medium-emphasis">mdi-information-outline</v-icon></template>
              </v-tooltip>
            </template>
          </v-text-field>

          <div class="text-caption text-medium-emphasis mb-1">{{ $t("plugins.duetToolAlign.settings.alignmentHeading") }}</div>
          <div class="d-flex ga-2 flex-wrap mb-2">
            <v-text-field v-for="f in alignFields" :key="f.key" :model-value="getNum(f.key)" @update:model-value="setNum(f.key, $event)"
                          type="number" :min="f.min" :max="f.max" :step="f.step ?? 1"
                          density="compact" variant="outlined" hide-details class="aa-field"
                          :label="$t('plugins.duetToolAlign.settings.' + f.key)">
              <template #append-inner>
                <v-tooltip location="top" max-width="300" :text="f.tip">
                  <template #activator="{ props }"><v-icon v-bind="props" size="16" color="medium-emphasis">mdi-information-outline</v-icon></template>
                </v-tooltip>
              </template>
            </v-text-field>
          </div>

          <div class="text-caption text-medium-emphasis mt-2 mb-1">{{ $t("plugins.duetToolAlign.settings.detectionHeading") }}</div>
          <div class="d-flex ga-2 flex-wrap align-center mb-2">
            <v-select v-model="cfg.detector" :items="detectorItems" item-title="title" item-value="value"
                      density="compact" variant="outlined" hide-details class="aa-select"
                      :label="$t('plugins.duetToolAlign.settings.detector')" />
            <v-tooltip location="top" max-width="300" text="Pick the largest detected circle instead of the one nearest the crosshair. Handy while the nozzle is off-centre during tuning; turn off for centring.">
              <template #activator="{ props }">
                <v-switch v-bind="props" v-model="cfg.pickLargest" density="compact" hide-details color="primary"
                          :label="$t('plugins.duetToolAlign.settings.pickLargest')" />
              </template>
            </v-tooltip>
            <v-tooltip v-if="cfg.detector === 'contour'" location="top" max-width="300" text="The bore is darker than the nozzle, so threshold keeps the dark pixels. Turn off only if your target is brighter than its surroundings.">
              <template #activator="{ props }">
                <v-switch v-bind="props" v-model="cfg.darkBore" density="compact" hide-details color="primary"
                          :label="$t('plugins.duetToolAlign.settings.darkBore')" />
              </template>
            </v-tooltip>
          </div>
          <div class="d-flex ga-2 flex-wrap align-center">
            <v-text-field v-for="f in activeDetectFields" :key="f.key" :model-value="getNum(f.key)" @update:model-value="setNum(f.key, $event)"
                          type="number" :min="f.min" :max="f.max" :step="f.step ?? 1"
                          density="compact" variant="outlined" hide-details class="aa-field"
                          :label="$t('plugins.duetToolAlign.settings.' + f.key)">
              <template #append-inner>
                <v-tooltip location="top" max-width="300" :text="f.tip">
                  <template #activator="{ props }"><v-icon v-bind="props" size="16" color="medium-emphasis">mdi-information-outline</v-icon></template>
                </v-tooltip>
              </template>
            </v-text-field>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { showConfirmDialog } from "@/composables/useConfirmDialog";
import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";
import { LogLevel, useUiStore } from "@/stores/ui";

import { type AxisCapture, computeToolOffset, formatG10, type ToolOffset } from "../util/toolAlign";
import { resolveOmPath } from "../util/omPath";
import { type AutoAlignConfig, resolveOpencvUrl, useConfig } from "../model/document";
import { type DetectParams, pickLargest, pickNearestToCentre } from "../cv/detectNozzle";
import { WorkerDetector } from "../cv/detectorWorker";
import { grabFrame } from "../cv/frameGrabber";
import { medianPoint } from "../cv/geometry";
import type { Mat2, Vec2 } from "../cv/geometry";
import { centreTool, type MachineIO, runCalibration } from "../model/orchestrator";

// Optional config injection (FL merge / standalone page may pass one); embeddable use passes none, so
// fall back to the persisted settings-store config.
const props = defineProps<{ widget?: AutoAlignConfig; disabled?: boolean }>();

const machineStore = useMachineStore();
const uiStore = useUiStore();
const cfg = props.widget ?? useConfig();

const disabledNow = computed(() => props.disabled || uiStore.uiFrozen || busy.value);

// --- CV engine -----------------------------------------------------------------
// OpenCV runs entirely in a Web Worker (loading + detection) so the ~17 MB runtime never blocks the
// DWC tab. `cvReady` mirrors the worker's state for the template.
const detector = new WorkerDetector();
const cvReady = ref(false);
const cvLoading = ref(false);
async function ensureCv(): Promise<boolean> {
  if (cvReady.value) return true;
  if (cvLoading.value) return false; // a load is already in flight
  const url = resolveOpencvUrl(cfg);
  if (!url) { setStatus(i18n.global.t("plugins.duetToolAlign.noUrl"), "error"); return false; }
  cvLoading.value = true;
  setStatus(i18n.global.t("plugins.duetToolAlign.cv.loading"));
  try {
    await detector.init(url);
    cvReady.value = true;
    setStatus(i18n.global.t("plugins.duetToolAlign.cv.ready"), "ok");
    return true;
  } catch (e) {
    setStatus(i18n.global.t("plugins.duetToolAlign.cv.error", { msg: (e as Error).message }), "error");
    return false;
  } finally {
    cvLoading.value = false;
  }
}

// --- Camera stream + overlay ---------------------------------------------------
const tick = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;
const streamSrc = computed(() => {
  if (!cfg.bridgeUrl) return "";
  const base = cfg.bridgeUrl.replace(/\/+$/, "") + "/stream";
  return base + (base.includes("?") ? "&" : "?") + "_t=" + tick.value;
});
function onImgError(): void { /* retried by the refresh tick */ }

const lastDetection = ref<Vec2 | null>(null);
const lastRadius = ref(0);
const smoothBuf: Array<Vec2> = []; // recent raw detections for display smoothing
const frameW = ref(0);
const frameH = ref(0);
const imgEl = ref<HTMLImageElement | null>(null);
// Map the detected circle (in original frame pixels) onto the displayed <img>, accounting for the
// letterbox (object-fit: contain) so the marker sits exactly on what was detected and is drawn at the
// real detected radius. Recomputes each detection (lastDetection/lastRadius change).
const detectionStyle = computed(() => {
  const d = lastDetection.value;
  const img = imgEl.value;
  if (!d || !img || !frameW.value || !img.clientWidth) return null;
  const scale = img.clientWidth / frameW.value;
  if (!isFinite(scale) || scale <= 0) return null;
  const diam = Math.max(8, 2 * lastRadius.value * scale);
  return {
    left: `${img.offsetLeft + d.x * scale}px`,
    top: `${img.offsetTop + d.y * scale}px`,
    width: `${diam}px`,
    height: `${diam}px`,
  };
});

// --- Status --------------------------------------------------------------------
const statusText = ref(i18n.global.t("plugins.duetToolAlign.cv.notReady"));
const statusKind = ref<"info" | "ok" | "error">("info");
const statusClass = computed(() => `aa-status-${statusKind.value}`);
const statusIcon = computed(() => statusKind.value === "error" ? "mdi-alert-circle" : statusKind.value === "ok" ? "mdi-check-circle" : "mdi-information");
function setStatus(msg: string, kind: "info" | "ok" | "error" = "info"): void {
  statusText.value = msg;
  statusKind.value = kind;
}

// --- Tools / position (object-model reads) ------------------------------------
interface RawTool { number?: number; name?: string; offsets?: Array<number> }
interface RawAxis { letter?: string; homed?: boolean; machinePosition?: number | null }

const tools = computed<Array<{ number: number; name: string }>>(() => {
  const arr = resolveOmPath(machineStore.model, "tools");
  if (!Array.isArray(arr)) return [];
  return (arr as Array<RawTool | null>).filter((t): t is RawTool => t != null)
    .map((t) => ({ number: t.number ?? 0, name: t.name ?? "" }));
});
const current = computed(() => {
  const n = resolveOmPath(machineStore.model, "state.currentTool");
  return typeof n === "number" ? n : -1;
});
function axisRow(letter: string): RawAxis | null {
  const arr = resolveOmPath(machineStore.model, "move.axes");
  if (!Array.isArray(arr)) return null;
  return (arr as Array<RawAxis>).find((a) => (a?.letter ?? "").toUpperCase() === letter) ?? null;
}
function machinePos(letter: "X" | "Y" | "Z"): number | null {
  const a = axisRow(letter);
  return a && typeof a.machinePosition === "number" ? a.machinePosition : null;
}
const allHomed = computed(() => ["X", "Y"].every((l) => axisRow(l)?.homed));

function refOffset(): ToolOffset {
  const arr = resolveOmPath(machineStore.model, "tools");
  const t = Array.isArray(arr) ? (arr as Array<RawTool | null>).find((x) => x?.number === cfg.referenceTool) : null;
  const off = t?.offsets;
  const at = (i: number) => (Array.isArray(off) && typeof off[i] === "number" ? off[i] : 0);
  return { x: at(0), y: at(1) };
}

// --- Machine IO + detection seam ----------------------------------------------
const machineIO: MachineIO = {
  sendCode: (code: string) => machineStore.sendCode(code),
  machinePos,
};

// Build the detector params from the live config, so tuning in Settings takes effect immediately
// (including during the live Detect loop).
function detectParams(): DetectParams {
  return {
    method: cfg.detector,
    minRadius: cfg.minRadiusPx,
    maxRadius: cfg.maxRadiusPx,
    blur: cfg.blurKsize,
    detectWidth: cfg.detectWidth,
    dp: cfg.houghDp,
    param1: cfg.houghParam1,
    param2: cfg.houghParam2,
    minDist: cfg.houghMinDist,
    threshold: cfg.threshold,
    minCircularity: cfg.minCircularity,
    darkBore: cfg.darkBore,
  };
}

async function detectOnce(): Promise<Vec2 | null> {
  if (!cvReady.value || !cfg.bridgeUrl) return null;
  try {
    const img = await grabFrame(cfg.bridgeUrl);
    frameW.value = img.width;
    frameH.value = img.height;
    const centre = { x: img.width / 2, y: img.height / 2 };
    // detect() transfers the pixel buffer to the worker, so read dimensions/centre first.
    const circles = await detector.detect(img, detectParams());
    const c = cfg.pickLargest ? pickLargest(circles) : pickNearestToCentre(circles, centre);
    if (!c) { smoothBuf.length = 0; lastDetection.value = null; lastRadius.value = 0; return null; }
    const raw = { x: c.x, y: c.y };
    // Median-smooth the DISPLAYED marker so a jumpy lock reads steadily. The raw point is what we
    // return to the orchestrator (its detectStable does its own validated averaging per move).
    const n = Math.max(1, Math.round(cfg.smoothing || 1));
    smoothBuf.push(raw);
    while (smoothBuf.length > n) smoothBuf.shift();
    lastDetection.value = medianPoint(smoothBuf);
    lastRadius.value = c.r;
    return raw;
  } catch (e) {
    setStatus((e as Error).message, "error");
    return null;
  }
}

// --- Live detection preview (no motion) — verify/tune detection before aligning ---
const detecting = ref(false);
async function toggleDetect(): Promise<void> {
  if (detecting.value) { detecting.value = false; return; }
  if (!(await ensureCv())) return;
  detecting.value = true;
  aborted = false;
  while (detecting.value && !aborted) {
    const p = await detectOnce();
    if (p) {
      setStatus(i18n.global.t("plugins.duetToolAlign.detect.found", { x: p.x.toFixed(0), y: p.y.toFixed(0), r: lastRadius.value.toFixed(0) }), "ok");
    } else if (cvReady.value) {
      setStatus(i18n.global.t("plugins.duetToolAlign.detect.none"));
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

function motionParams() {
  return {
    jogFeed: cfg.jogFeed,
    settleMs: cfg.settleMs,
    tolerancePx: cfg.tolerancePx,
    gain: cfg.gain,
    maxStepMm: cfg.maxStepMm,
    maxIterations: cfg.maxIterations,
    calibStepMm: cfg.calibStepMm,
    shouldAbort: () => aborted,
  };
}

// Manual Z jog to bring the nozzle into focus (sharpen the image) before/while detecting.
function focusZ(dir: number): void {
  if (disabledNow.value) return;
  const d = dir * (cfg.zStep || 0.05);
  void send(`M120\nG91\nG1 Z${d.toFixed(3)} F${cfg.jogFeed}\nG90\nM121`);
}
function frameCentre(): Vec2 {
  return { x: (frameW.value || 640) / 2, y: (frameH.value || 480) / 2 };
}

// --- Alignment state -----------------------------------------------------------
const transform = ref<Mat2 | null>(null);
const captures = ref<Record<number, AxisCapture>>({});
const busy = ref(false);
let aborted = false;

const invert = computed({
  get: () => !!cfg.invertOffsets,
  set: (v: boolean) => { cfg.invertOffsets = v; },
});
const hasCameraPos = computed(() => typeof cfg.cameraX === "number" && typeof cfg.cameraY === "number");

function notify(msg: string, level: LogLevel = LogLevel.warning): void {
  uiStore.makeNotification(level, i18n.global.t("plugins.duetToolAlign.widget"), msg);
}
function send(code: string): Promise<unknown> {
  return machineStore.sendCode(code).catch((e: unknown) => notify((e as Error)?.message ?? String(e), LogLevel.error));
}

function select(n: number): void {
  if (disabledNow.value) return;
  void send(`T${n}`);
}

// --- Camera position -----------------------------------------------------------
function setCamera(): void {
  const x = machinePos("X"), y = machinePos("Y"), z = machinePos("Z");
  if (x == null || y == null) { notify(i18n.global.t("plugins.duetToolAlign.noPos")); return; }
  cfg.cameraX = x; cfg.cameraY = y;
  if (z != null) cfg.cameraZ = z;
  notify(i18n.global.t("plugins.duetToolAlign.camera.saved"), LogLevel.success);
}
function gotoCameraCode(): string | null {
  if (cfg.cameraX == null || cfg.cameraY == null) return null;
  const g = cfg.useG53 ? "G53 " : "";
  const lines = ["M120", "G90"];
  if (typeof cfg.safeZ === "number") lines.push(`${g}G1 Z${cfg.safeZ} F${cfg.jogFeed}`);
  lines.push(`${g}G1 X${cfg.cameraX} Y${cfg.cameraY} F${cfg.travelFeed}`);
  if (typeof cfg.cameraZ === "number") lines.push(`${g}G1 Z${cfg.cameraZ} F${cfg.jogFeed}`);
  lines.push("M121", "M400");
  return lines.join("\n");
}
function gotoCamera(): void {
  if (disabledNow.value) return;
  const code = gotoCameraCode();
  if (!code) { notify(i18n.global.t("plugins.duetToolAlign.camera.setFirst")); return; }
  void send(code);
}

// --- Calibration / centring ----------------------------------------------------
const progress = {
  status: (m: string) => setStatus(m),
  detection: (p: Vec2 | null) => { lastDetection.value = p; },
};

async function doCalibrate(): Promise<void> {
  if (busy.value) return;
  if (!(await ensureCv())) return;
  busy.value = true; aborted = false;
  try {
    const res = await runCalibration(machineIO, detectOnce, motionParams(), progress);
    if (res.ok && res.mmPerPx) {
      transform.value = res.mmPerPx;
      setStatus(i18n.global.t("plugins.duetToolAlign.calib.done", {
        residual: (res.residualMm ?? 0).toFixed(3), used: res.used ?? 0,
      }), "ok");
    } else {
      setStatus(i18n.global.t("plugins.duetToolAlign.calib.fail", { msg: res.error ?? "" }), "error");
    }
  } finally {
    busy.value = false;
  }
}

function captureXY(tool: number, pos: { x: number; y: number }): void {
  captures.value = { ...captures.value, [tool]: { ...captures.value[tool], x: pos.x, y: pos.y } };
}

async function centreCurrent(): Promise<void> {
  if (busy.value || current.value < 0) return;
  if (!transform.value) { setStatus(i18n.global.t("plugins.duetToolAlign.calib.needed"), "error"); return; }
  if (!(await ensureCv())) return;
  busy.value = true; aborted = false;
  try {
    const res = await centreTool(machineIO, detectOnce, transform.value, frameCentre(), motionParams(), progress);
    if (res.ok && res.position) {
      captureXY(current.value, res.position);
      setStatus(i18n.global.t("plugins.duetToolAlign.centre.done"), "ok");
    } else {
      setStatus(i18n.global.t("plugins.duetToolAlign.centre.fail", { msg: res.error ?? "" }), "error");
    }
  } finally {
    busy.value = false;
  }
}

async function selectAndTravel(n: number): Promise<void> {
  await machineIO.sendCode(`T${n}\nM400`);
  const code = gotoCameraCode();
  if (code) await machineIO.sendCode(code);
}

async function runFull(): Promise<void> {
  if (busy.value || !(await ensureCv())) return;
  busy.value = true; aborted = false;
  try {
    if (cfg.startCommand) await machineIO.sendCode(cfg.startCommand);

    // Reference tool: select, travel, calibrate (once), centre + capture origin.
    await selectAndTravel(cfg.referenceTool);
    if (aborted) return;
    if (!transform.value) {
      const cal = await runCalibration(machineIO, detectOnce, motionParams(), progress);
      if (!cal.ok || !cal.mmPerPx) { setStatus(i18n.global.t("plugins.duetToolAlign.calib.fail", { msg: cal.error ?? "" }), "error"); return; }
      transform.value = cal.mmPerPx;
    }
    let res = await centreTool(machineIO, detectOnce, transform.value, frameCentre(), motionParams(), progress);
    if (aborted) return;
    if (res.ok && res.position) captureXY(cfg.referenceTool, res.position);

    // Every other tool.
    for (const t of tools.value) {
      if (aborted) { setStatus(i18n.global.t("plugins.duetToolAlign.run.aborted"), "error"); return; }
      if (t.number === cfg.referenceTool) continue;
      await selectAndTravel(t.number);
      res = await centreTool(machineIO, detectOnce, transform.value, frameCentre(), motionParams(), progress);
      if (res.ok && res.position) captureXY(t.number, res.position);
    }

    if (cfg.finishCommand) await machineIO.sendCode(cfg.finishCommand);
    setStatus(i18n.global.t("plugins.duetToolAlign.run.done"), "ok");
  } catch (e) {
    setStatus((e as Error).message, "error");
  } finally {
    busy.value = false;
  }
}

function stop(): void { aborted = true; detecting.value = false; }

// --- Offsets -------------------------------------------------------------------
function setReference(): void {
  if (current.value < 0) { notify(i18n.global.t("plugins.duetToolAlign.selectTool")); return; }
  cfg.referenceTool = current.value;
}
function offsetFor(t: number): ToolOffset | null {
  const ct = captures.value[t], cr = captures.value[cfg.referenceTool];
  if (!ct || !cr) return null;
  return computeToolOffset(cr, ct, refOffset(), cfg.invertOffsets);
}
function g10For(t: number): string | null {
  const o = offsetFor(t);
  return o ? formatG10(t, o) : null;
}
const anyApplicable = computed(() => tools.value.some((t) => t.number !== cfg.referenceTool && g10For(t.number)));

function fmtPair(c?: AxisCapture): string {
  if (!c || typeof c.x !== "number" || typeof c.y !== "number") return "—";
  return `${c.x.toFixed(2)}, ${c.y.toFixed(2)}`;
}
function fmtOffset(o: ToolOffset | null): string {
  if (!o || typeof o.x !== "number" || typeof o.y !== "number") return "—";
  return `${o.x.toFixed(3)}, ${o.y.toFixed(3)}`;
}
const rows = computed(() => tools.value.map((t) => ({
  number: t.number,
  name: t.name || ("T" + t.number),
  isRef: t.number === cfg.referenceTool,
  captured: fmtPair(captures.value[t.number]),
  offset: fmtOffset(offsetFor(t.number)),
  g10: g10For(t.number),
})));

async function applyTool(t: number): Promise<void> {
  const cmd = g10For(t);
  if (!cmd) return;
  if (await confirmApply([cmd])) void send(cmd);
}
async function applyAll(): Promise<void> {
  const cmds = tools.value.filter((t) => t.number !== cfg.referenceTool).map((t) => g10For(t.number)).filter((c): c is string => !!c);
  if (!cmds.length) return;
  if (cfg.saveCommand) cmds.push(cfg.saveCommand);
  if (await confirmApply(cmds)) void send(cmds.join("\n"));
}
async function saveOffsets(): Promise<void> {
  if (!cfg.saveCommand) return;
  if (await confirmApply([cfg.saveCommand])) void send(cfg.saveCommand);
}
function confirmApply(cmds: Array<string>): Promise<boolean> {
  return showConfirmDialog(
    i18n.global.t("plugins.duetToolAlign.offsets.confirmTitle"),
    `${i18n.global.t("plugins.duetToolAlign.offsets.confirmBody")}\n\n${cmds.join("\n")}`,
    "mdi-content-save-cog",
  );
}

// --- Settings metadata (drives the Settings fields with tooltips + ranges) ---
interface NumField { key: string; min?: number; max?: number; step?: number; tip: string }
const alignFields: Array<NumField> = [
  { key: "referenceTool", min: 0, step: 1, tip: "Tool number used as the origin that all other tools' offsets are measured against. Usually 0." },
  { key: "calibStepMm", min: 0.05, max: 5, step: 0.05, tip: "Half-size of the calibration jog star (mm). Big enough to move the nozzle a clear distance in view, small enough to stay in frame. Typical 0.3–1.0." },
  { key: "tolerancePx", min: 0.5, max: 15, step: 0.5, tip: "How close (px) repeated detections must agree to count as locked, and how near the crosshair counts as centred. Raise if the lock is jumpy; lower for more precision. Typical 1–4." },
  { key: "smoothing", min: 1, max: 15, step: 1, tip: "Frames median-averaged for the on-screen marker, to steady a jumpy lock. 1 = off. Display only — does not affect captured positions. Typical 3–7." },
  { key: "gain", min: 0.1, max: 1.5, step: 0.05, tip: "Fraction of each computed correction applied per centring step. Lower = slower but stable; higher = faster but can overshoot. Typical 0.5–0.9." },
  { key: "maxStepMm", min: 0.1, max: 10, step: 0.1, tip: "Clamp on a single centring jog (mm), so a bad detection can't fling the toolhead. Typical 0.5–3." },
  { key: "maxIterations", min: 5, max: 100, step: 1, tip: "Maximum centring jogs before giving up on a tool. Typical 15–40." },
  { key: "settleMs", min: 0, max: 3000, step: 50, tip: "Pause after each move before grabbing a frame, letting vibration/ooze settle (ms). Typical 200–800." },
  { key: "travelFeed", min: 100, max: 30000, step: 100, tip: "Feed rate (mm/min) for travel moves to the camera position. e.g. 6000." },
  { key: "jogFeed", min: 60, max: 12000, step: 60, tip: "Feed rate (mm/min) for small calibration/centring/Z-focus jogs. e.g. 1200." },
];
// Common to both detectors.
const commonFields: Array<NumField> = [
  { key: "minRadiusPx", min: 1, max: 1000, step: 1, tip: "Smallest circle radius accepted (original-frame px). Raise to reject small specks / the inner dark dot. Watch the r= readout." },
  { key: "maxRadiusPx", min: 1, max: 2000, step: 1, tip: "Largest circle radius accepted (original-frame px). Must be above the bore radius or the bore won't be found. Watch the r= readout." },
  { key: "blurKsize", min: 0, max: 21, step: 2, tip: "Median blur kernel (odd number) applied before detection to suppress speckle/glitter. 0 or 1 = off. Typical 3–9." },
  { key: "detectWidth", min: 160, max: 2000, step: 20, tip: "Frame is downscaled to this width for detection speed (coords scaled back). Lower = faster, less precise. Typical 480–1000." },
];
// Hough-only.
const houghFields: Array<NumField> = [
  { key: "houghParam2", min: 1, max: 300, step: 1, tip: "Detection sensitivity (Hough accumulator threshold). LOWER finds more circles (and more false ones); higher is stricter. The main knob. Typical 20–80." },
  { key: "houghParam1", min: 10, max: 400, step: 5, tip: "Edge sensitivity (Canny high threshold). Higher = only strong edges, ignoring faint surface texture. Typical 80–200." },
  { key: "houghDp", min: 1, max: 3, step: 0.1, tip: "Accumulator resolution (inverse). 1 = full detail; 1.5–2 finds rougher/blurrier circles, less accurately. Typical 1–2." },
  { key: "houghMinDist", min: 0, max: 2000, step: 5, tip: "Minimum distance between detected circle centres (px). 0 = auto (frame/8). Raise to avoid several overlapping detections." },
];
// Contour-only.
const contourFields: Array<NumField> = [
  { key: "threshold", min: 0, max: 255, step: 1, tip: "Brightness cut (0–255) separating the bore from the nozzle. 0 = auto (Otsu), which usually works. Set manually if lighting is uneven." },
  { key: "minCircularity", min: 0, max: 1, step: 0.05, tip: "How round a blob must be to count (4π·area/perimeter²). Higher rejects irregular shapes; lower is more forgiving. Typical 0.5–0.8." },
];
// Fields shown for the currently-selected detector.
const activeDetectFields = computed(() =>
  cfg.detector === "hough" ? [...commonFields, ...houghFields] : [...commonFields, ...contourFields]);
const detectorItems = [
  { title: i18n.global.t("plugins.duetToolAlign.settings.methodHough"), value: "hough" },
  { title: i18n.global.t("plugins.duetToolAlign.settings.methodContour"), value: "contour" },
];

function getNum(key: string): number {
  return (cfg as unknown as Record<string, number>)[key];
}
function setNum(key: string, val: unknown): void {
  (cfg as unknown as Record<string, number>)[key] = val === "" || val === null || val === undefined ? 0 : Number(val);
}

// Load the CV engine as soon as a bridge URL is available (on mount, and when the user first sets
// it) rather than waiting for an alignment action — which is disabled while disconnected, so it would
// otherwise never load and the status would sit on "not loaded". This also surfaces a bad URL /
// missing /opencv assets immediately as a clear error.
onMounted(() => {
  timer = setInterval(() => { tick.value = Date.now(); }, 1000);
  if (cfg.bridgeUrl) void ensureCv();
});
watch(() => cfg.bridgeUrl, (url) => { if (url && !cvReady.value && !cvLoading.value) void ensureCv(); });
onBeforeUnmount(() => { aborted = true; if (timer) clearInterval(timer); detector.dispose(); });
</script>

<style scoped>
.aa-root { min-height: 0; overflow: hidden; }

.aa-cam { position: relative; min-height: 120px; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #000; }
.aa-img { max-width: 100%; max-height: 100%; display: block; object-fit: contain; }
/* The setup prompt (shown until a bridge URL is set) sits on a normal surface, not the black camera
   backdrop, so the input is readable; it's always interactive regardless of connection state. */
.aa-setup { width: 100%; max-width: 460px; background: rgb(var(--v-theme-surface)); border-radius: 6px; }

.aa-overlay { position: absolute; inset: 0; pointer-events: none; }
.aa-cross-h { position: absolute; left: 0; right: 0; top: 50%; border-top: 1px solid #39ff14; }
.aa-cross-v { position: absolute; top: 0; bottom: 0; left: 50%; border-left: 1px solid #39ff14; }
/* width/height/left/top come from detectionStyle (the real detected radius, letterbox-corrected). */
.aa-circle { position: absolute; transform: translate(-50%, -50%); border: 2px solid #ff3b30; border-radius: 50%; box-shadow: 0 0 4px #ff3b30; }

.aa-status-info { color: rgba(127, 127, 127, 0.95); }
.aa-status-ok { color: #2e7d32; }
.aa-status-error { color: #c62828; }

.aa-btn { min-width: 0; }
.aa-narrow { max-width: 120px; }
.aa-field { max-width: 160px; }
.aa-select { max-width: 200px; }

.aa-table { min-height: 0; overflow: auto; }
.aa-grid { width: 100%; border-collapse: collapse; font-size: 0.8em; }
.aa-grid th { text-align: left; font-weight: 600; opacity: 0.7; padding: 1px 4px; }
.aa-grid td { padding: 1px 4px; border-top: 1px solid rgba(127, 127, 127, 0.2); }
.aa-num { font-family: monospace; font-variant-numeric: tabular-nums; }
.aa-ref { background: rgba(127, 127, 127, 0.08); }
.aa-badge { margin-left: 4px; font-size: 0.75em; opacity: 0.6; }
</style>
