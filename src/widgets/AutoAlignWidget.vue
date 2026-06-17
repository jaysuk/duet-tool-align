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
      <img v-else :src="streamSrc" class="aa-img" @error="onImgError" />

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
      <v-btn v-if="cfg.bridgeUrl && !cv" size="x-small" variant="tonal" :loading="cvLoading" @click="ensureCv">
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

    <!-- Camera position + primary actions -->
    <div class="aa-actions d-flex flex-wrap align-center ga-1 px-1 pt-1 flex-shrink-0">
      <v-btn size="small" variant="tonal" prepend-icon="mdi-camera-marker" :disabled="disabledNow || !hasCameraPos" @click="gotoCamera">
        {{ $t("plugins.duetToolAlign.camera.goto") }}
      </v-btn>
      <v-btn size="small" variant="text" prepend-icon="mdi-crosshairs" :disabled="disabledNow" @click="setCamera">
        {{ $t("plugins.duetToolAlign.camera.set") }}
      </v-btn>
      <v-spacer />
      <v-btn size="small" variant="tonal" prepend-icon="mdi-grid" :disabled="disabledNow || !cfg.bridgeUrl" @click="doCalibrate">
        {{ $t("plugins.duetToolAlign.actions.calibrate") }}
      </v-btn>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-image-filter-center-focus"
             :disabled="disabledNow || current < 0 || !transform" @click="centreCurrent">
        {{ $t("plugins.duetToolAlign.actions.centre") }}
      </v-btn>
      <v-btn size="small" color="primary" variant="flat" prepend-icon="mdi-play" :disabled="disabledNow || !cfg.bridgeUrl" @click="runFull">
        {{ $t("plugins.duetToolAlign.actions.runFull") }}
      </v-btn>
      <v-btn v-if="busy" size="small" color="error" variant="text" prepend-icon="mdi-stop" @click="stop">
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
                        :label="$t('plugins.duetToolAlign.settings.bridgeUrl')" :placeholder="$t('plugins.duetToolAlign.settings.bridgeUrlHint')" />
          <v-text-field v-model="cfg.opencvUrl" density="compact" variant="outlined" hide-details class="mb-2"
                        :label="$t('plugins.duetToolAlign.settings.opencvUrl')" :placeholder="$t('plugins.duetToolAlign.settings.opencvUrlHint')" />
          <div class="d-flex ga-2 flex-wrap">
            <v-text-field v-model.number="cfg.referenceTool" type="number" density="compact" variant="outlined" hide-details
                          class="aa-narrow" :label="$t('plugins.duetToolAlign.settings.referenceTool')" />
            <v-text-field v-model.number="cfg.calibStepMm" type="number" density="compact" variant="outlined" hide-details
                          class="aa-narrow" :label="$t('plugins.duetToolAlign.settings.calibStepMm')" />
            <v-text-field v-model.number="cfg.tolerancePx" type="number" density="compact" variant="outlined" hide-details
                          class="aa-narrow" :label="$t('plugins.duetToolAlign.settings.tolerancePx')" />
            <v-text-field v-model.number="cfg.gain" type="number" density="compact" variant="outlined" hide-details
                          class="aa-narrow" :label="$t('plugins.duetToolAlign.settings.gain')" />
            <v-text-field v-model.number="cfg.settleMs" type="number" density="compact" variant="outlined" hide-details
                          class="aa-narrow" :label="$t('plugins.duetToolAlign.settings.settleMs')" />
            <v-text-field v-model.number="cfg.minRadiusPx" type="number" density="compact" variant="outlined" hide-details
                          class="aa-narrow" :label="$t('plugins.duetToolAlign.settings.minRadiusPx')" />
            <v-text-field v-model.number="cfg.maxRadiusPx" type="number" density="compact" variant="outlined" hide-details
                          class="aa-narrow" :label="$t('plugins.duetToolAlign.settings.maxRadiusPx')" />
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
import { loadOpenCV } from "../cv/opencvLoader";
import { type CvLike, detectNozzle } from "../cv/detectNozzle";
import { grabFrame } from "../cv/frameGrabber";
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
const cv = ref<CvLike | null>(null);
const cvLoading = ref(false);
async function ensureCv(): Promise<CvLike | null> {
  if (cv.value) return cv.value;
  if (cvLoading.value) return null; // a load is already in flight
  const url = resolveOpencvUrl(cfg);
  if (!url) { setStatus(i18n.global.t("plugins.duetToolAlign.noUrl"), "error"); return null; }
  cvLoading.value = true;
  setStatus(i18n.global.t("plugins.duetToolAlign.cv.loading"));
  try {
    cv.value = await loadOpenCV(url);
    setStatus(i18n.global.t("plugins.duetToolAlign.cv.ready"), "ok");
    return cv.value;
  } catch (e) {
    setStatus(i18n.global.t("plugins.duetToolAlign.cv.error", { msg: (e as Error).message }), "error");
    return null;
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
const frameW = ref(0);
const frameH = ref(0);
const detectionStyle = computed(() => {
  const d = lastDetection.value;
  if (!d || !frameW.value || !frameH.value) return null;
  const cx = (d.x / frameW.value) * 100;
  const cy = (d.y / frameH.value) * 100;
  return { left: `${cx}%`, top: `${cy}%` };
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

async function detectOnce(): Promise<Vec2 | null> {
  const engine = cv.value;
  if (!engine || !cfg.bridgeUrl) return null;
  try {
    const img = await grabFrame(cfg.bridgeUrl);
    frameW.value = img.width;
    frameH.value = img.height;
    const c = detectNozzle(engine, img, { minRadius: cfg.minRadiusPx, maxRadius: cfg.maxRadiusPx });
    lastDetection.value = c ? { x: c.x, y: c.y } : null;
    return lastDetection.value;
  } catch (e) {
    setStatus((e as Error).message, "error");
    return null;
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
  };
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

function stop(): void { aborted = true; }

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

// Load the CV engine as soon as a bridge URL is available (on mount, and when the user first sets
// it) rather than waiting for an alignment action — which is disabled while disconnected, so it would
// otherwise never load and the status would sit on "not loaded". This also surfaces a bad URL /
// missing /opencv assets immediately as a clear error.
onMounted(() => {
  timer = setInterval(() => { tick.value = Date.now(); }, 1000);
  if (cfg.bridgeUrl) void ensureCv();
});
watch(() => cfg.bridgeUrl, (url) => { if (url && !cv.value && !cvLoading.value) void ensureCv(); });
onBeforeUnmount(() => { aborted = true; if (timer) clearInterval(timer); });
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
.aa-circle { position: absolute; width: 14px; height: 14px; transform: translate(-50%, -50%); border: 2px solid #ff3b30; border-radius: 50%; box-shadow: 0 0 4px #ff3b30; }

.aa-status-info { color: rgba(127, 127, 127, 0.95); }
.aa-status-ok { color: #2e7d32; }
.aa-status-error { color: #c62828; }

.aa-btn { min-width: 0; }
.aa-narrow { max-width: 120px; }

.aa-table { min-height: 0; overflow: auto; }
.aa-grid { width: 100%; border-collapse: collapse; font-size: 0.8em; }
.aa-grid th { text-align: left; font-weight: 600; opacity: 0.7; padding: 1px 4px; }
.aa-grid td { padding: 1px 4px; border-top: 1px solid rgba(127, 127, 127, 0.2); }
.aa-num { font-family: monospace; font-variant-numeric: tabular-nums; }
.aa-ref { background: rgba(127, 127, 127, 0.08); }
.aa-badge { margin-left: 4px; font-size: 0.75em; opacity: 0.6; }
</style>
