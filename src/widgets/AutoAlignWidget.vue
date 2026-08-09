<template>
  <div class="aa-root fill-height d-flex flex-column">
    <!-- Update notice (also surfaced in Flexible Layouts' unified popup via the shared hub) -->
    <v-alert v-if="pendingReload" type="success" density="compact" variant="tonal" class="ma-1">
      {{ $t("plugins.duetToolAlign.updates.reloadPrompt") }}
      <template #append>
        <v-btn size="small" variant="tonal" @click="reloadPage">{{ $t("plugins.duetToolAlign.updates.reload") }}</v-btn>
      </template>
    </v-alert>
    <v-alert v-else-if="updateBannerVisible" type="info" density="compact" variant="tonal" class="ma-1">
      {{ $t("plugins.duetToolAlign.updates.available", { version: updateState!.latestVersion }) }}
      <template #append>
        <div class="d-flex align-center ga-1 flex-wrap">
          <v-btn v-if="updateState!.scenario === 'pluginUpdate'" size="small" color="primary" variant="flat" :loading="applying" @click="applyUpdateNow">
            {{ $t("plugins.duetToolAlign.updates.updateNow") }}
          </v-btn>
          <span v-else class="text-caption">{{ $t("plugins.duetToolAlign.updates.needsDwc", { dwc: updateState!.requiredDwc, running: updateState!.runningDwc }) }}</span>
          <v-btn size="small" variant="text" :href="updateState!.releaseUrl || undefined" target="_blank" rel="noopener">{{ $t("plugins.duetToolAlign.updates.notes") }}</v-btn>
          <v-btn size="small" variant="text" @click="dismissCurrentUpdate">{{ $t("plugins.duetToolAlign.updates.dismiss") }}</v-btn>
        </div>
      </template>
    </v-alert>

    <div class="aa-main flex-grow-1 d-flex">
    <!-- Camera with crosshair + detected-circle overlay -->
    <div class="aa-cam-col flex-shrink-0">
    <div class="aa-cam">
      <div v-if="!cfg.bridgeUrl" class="aa-setup pa-3">
        <div class="text-caption text-medium-emphasis mb-2">{{ $t("plugins.duetToolAlign.noUrl") }}</div>
        <v-text-field v-model="bridgeUrlDraft" density="compact" variant="outlined" hide-details autofocus
                      :label="$t('plugins.duetToolAlign.settings.bridgeUrl')"
                      :placeholder="$t('plugins.duetToolAlign.settings.bridgeUrlHint')"
                      @keyup.enter="commitBridgeUrlDraft" @blur="commitBridgeUrlDraft" />
      </div>
      <img v-else ref="imgEl" :src="streamSrc" class="aa-img" :class="{ 'aa-img-measuring': measuring }"
           @error="onImgError" @contextmenu.prevent="toggleMeasure" @click="onImgMeasureClick" />

      <div class="aa-overlay">
        <div class="aa-cross-h" />
        <div class="aa-cross-v" />
        <template v-if="showScale && imgScale">
          <template v-for="r in scaleRingRadii" :key="'scale-' + r">
            <div class="aa-ring aa-ring-scale" :style="ringStyle(r)!" />
            <div class="aa-ring-label aa-ring-label-scale" :style="{ top: labelTopPx(r) }">{{ r.toFixed(0) }}px</div>
          </template>
          <div class="aa-ring aa-ring-min" :style="ringStyle(cfg.minRadiusPx)!" />
          <div class="aa-ring-label aa-ring-label-min" :style="{ top: labelTopPx(cfg.minRadiusPx) }">min {{ cfg.minRadiusPx }}px</div>
          <div class="aa-ring aa-ring-max" :style="ringStyle(cfg.maxRadiusPx)!" />
          <div class="aa-ring-label aa-ring-label-max" :style="{ top: labelTopPx(cfg.maxRadiusPx) }">max {{ cfg.maxRadiusPx }}px</div>
        </template>
        <div v-if="detectionStyle" class="aa-circle" :style="detectionStyle" />
        <svg v-if="measureADisp && measureBDisp" class="aa-measure-svg">
          <line :x1="measureADisp.x" :y1="measureADisp.y" :x2="measureBDisp.x" :y2="measureBDisp.y" />
        </svg>
        <div v-if="measureADisp" class="aa-measure-pt" :style="{ left: measureADisp.x + 'px', top: measureADisp.y + 'px' }" />
        <div v-if="measureBDisp" class="aa-measure-pt" :style="{ left: measureBDisp.x + 'px', top: measureBDisp.y + 'px' }" />
        <div v-if="measureMidDisp && measureDistPx != null" class="aa-measure-label"
             :style="{ left: measureMidDisp.x + 'px', top: measureMidDisp.y + 'px' }">
          {{ measureDistPx.toFixed(0) }}px<span v-if="measureDistMm != null"> ({{ measureDistMm.toFixed(2) }}mm)</span>
        </div>
      </div>
    </div>
    </div>

    <div class="aa-side-col flex-grow-1 d-flex flex-column">
    <!-- Status line -->
    <div class="aa-status text-caption px-2 py-1 flex-shrink-0 d-flex align-center" :class="statusClass">
      <v-icon size="14" class="mr-1">{{ statusIcon }}</v-icon><span>{{ statusText }}</span>
      <v-spacer />
      <v-tooltip v-if="cfg.bridgeUrl && !cvReady" location="top" text="Load the OpenCV.js detection engine now, instead of waiting for the first Detect/Calibrate/Align.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="x-small" variant="tonal" :loading="cvLoading" @click="ensureCv">
            {{ $t("plugins.duetToolAlign.cv.load") }}
          </v-btn>
        </template>
      </v-tooltip>
    </div>

    <!-- Tool buttons (auto-populated from the object model) -->
    <div class="aa-tools d-flex flex-wrap align-center ga-1 px-1 pt-1 flex-shrink-0">
      <v-tooltip v-for="t in tools" :key="t.number" location="top" :text="`Select ${t.name || 'T' + t.number} (sends T${t.number}).`">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" class="text-none aa-btn"
                 :variant="t.number === current ? 'flat' : 'tonal'"
                 :color="t.number === current ? 'primary' : undefined"
                 :disabled="disabledNow" @click="select(t.number)">
            {{ t.name || ("T" + t.number) }}
            <v-icon v-if="t.number === cfg.referenceTool" size="14" class="ml-1">mdi-target</v-icon>
          </v-btn>
        </template>
      </v-tooltip>
      <span v-if="!tools.length" class="text-caption text-medium-emphasis">{{ $t("plugins.duetToolAlign.tools.empty") }}</span>
    </div>

    <!-- Live detection (no motion — needs only the camera) + Z focus -->
    <div class="aa-focus d-flex flex-wrap align-center ga-1 px-1 pt-1 flex-shrink-0">
      <v-tooltip location="top" text="Continuously detect the nozzle without moving anything -- use this to tune the Detection settings below against the live image.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" :variant="detecting ? 'flat' : 'tonal'" :color="detecting ? 'primary' : undefined"
                 prepend-icon="mdi-eye" :disabled="busy || !cfg.bridgeUrl" @click="toggleDetect">
            {{ detecting ? $t("plugins.duetToolAlign.actions.stopDetect") : $t("plugins.duetToolAlign.actions.detect") }}
          </v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" max-width="260"
                 text="Show a pixel ruler over the camera image (rings every so many px, plus the current Min/Max radius settings) -- to estimate how many pixels wide something is.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" :variant="showScale ? 'flat' : 'tonal'" :color="showScale ? 'primary' : undefined"
                 icon="mdi-ruler" :disabled="!cfg.bridgeUrl" @click="showScale = !showScale" />
        </template>
      </v-tooltip>
      <v-tooltip location="top" max-width="260"
                 text="Measure between two points on the image (px, and mm once calibrated). Right-click the image to arm/disarm, or use this button; then click two points. A third click starts a new measurement.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" :variant="measuring ? 'flat' : 'tonal'" :color="measuring ? 'primary' : undefined"
                 icon="mdi-map-marker-distance" :disabled="!cfg.bridgeUrl" @click="toggleMeasure" />
        </template>
      </v-tooltip>
      <v-spacer />
      <span class="text-caption text-medium-emphasis mr-1">{{ $t("plugins.duetToolAlign.focus.label") }}</span>
      <v-tooltip location="top" text="Jog Z down by the step size, to bring the nozzle into focus.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabledNow" @click="focusZ(-1)">Z−</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Jog Z up by the step size, to bring the nozzle into focus.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabledNow" @click="focusZ(1)">Z+</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" max-width="280" text="Z distance per -Z/+Z press (mm), to bring the nozzle into focus. Typical 0.02–0.2. (default: 0.05)">
        <template #activator="{ props }">
          <v-text-field v-bind="props" v-model.number="cfg.zStep" type="number" min="0.01" max="2" step="0.01"
                        density="compact" variant="outlined" hide-details class="aa-narrow" suffix="mm" />
        </template>
      </v-tooltip>
    </div>

    <!-- Focus assist: sharpness of the last detected frame, relative to the best seen since Detect was
         (re)started. Jog Z, watch it climb toward 100% -- back off once it starts dropping again. Only
         meaningful once Detect has produced at least one reading. -->
    <v-tooltip v-if="lastSharpness != null" location="top"
               text="Focus assist: how sharp the last frame was, relative to the best seen since Detect was (re)started. Jog Z to climb toward 100%; it resets each time you start Detect.">
      <template #activator="{ props }">
        <div v-bind="props" class="aa-focusbar d-flex align-center ga-2 px-1 pt-1 flex-shrink-0">
          <span class="text-caption text-medium-emphasis">{{ $t("plugins.duetToolAlign.focus.assist") }}</span>
          <v-progress-linear :model-value="focusPct" height="6" rounded color="primary" class="aa-focusbar-bar" />
          <span class="text-caption text-medium-emphasis aa-num">{{ focusPct.toFixed(0) }}%</span>
        </div>
      </template>
    </v-tooltip>

    <!-- Live machine position -- otherwise you're jogging blind unless you're also watching DWC's
         own status bar elsewhere. -->
    <div class="aa-pos text-caption text-medium-emphasis px-1 pt-1 flex-shrink-0 d-flex ga-3 aa-num">
      <span>X {{ fmtPos(livePos.x) }}</span>
      <span>Y {{ fmtPos(livePos.y) }}</span>
      <span>Z {{ fmtPos(livePos.z) }}</span>
    </div>

    <!-- Manual X/Y jog (bring a tool into frame) + unload the active tool -->
    <div class="aa-jog d-flex flex-wrap align-center ga-1 px-1 pt-1 flex-shrink-0">
      <span class="text-caption text-medium-emphasis mr-1">{{ $t("plugins.duetToolAlign.jog.label") }}</span>
      <v-tooltip location="top" text="Jog X by the step size, to bring the tool's nozzle into frame.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabledNow" @click="jogXY('X', -1)">X−</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Jog X by the step size, to bring the tool's nozzle into frame.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabledNow" @click="jogXY('X', 1)">X+</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Jog Y by the step size, to bring the tool's nozzle into frame.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabledNow" @click="jogXY('Y', -1)">Y−</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Jog Y by the step size, to bring the tool's nozzle into frame.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabledNow" @click="jogXY('Y', 1)">Y+</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" max-width="280" text="X/Y jog distance per button press (mm). Use a big step to bring a far-off tool into frame, then a small step to fine-tune. (default: 0.1)">
        <template #activator="{ props }">
          <v-text-field v-bind="props" v-model.number="cfg.xyStep" type="number" min="0.01" max="50" step="0.05"
                        density="compact" variant="outlined" hide-details class="aa-narrow" suffix="mm" />
        </template>
      </v-tooltip>
      <v-spacer />
      <v-tooltip location="top" text="Unload the active tool (sends T-1) -- e.g. to bring a bare carriage datum/switch over the camera.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-eject" :disabled="disabledNow" @click="unloadTool">
            {{ $t("plugins.duetToolAlign.tools.unload") }}
          </v-btn>
        </template>
      </v-tooltip>
    </div>

    <!-- Camera position + primary actions -->
    <div class="aa-actions d-flex flex-wrap align-center ga-1 px-1 pt-1 flex-shrink-0">
      <v-tooltip location="top" text="Travel to the saved camera position (X/Y, and Z if saved).">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-camera-marker" :disabled="disabledNow || !hasCameraPos" @click="gotoCamera">
            {{ $t("plugins.duetToolAlign.camera.goto") }}
          </v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Save the current machine position as the camera position, for 'Go to camera' and the start of each alignment run.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="text" prepend-icon="mdi-crosshairs" :disabled="disabledNow" @click="setCamera">
            {{ $t("plugins.duetToolAlign.camera.set") }}
          </v-btn>
        </template>
      </v-tooltip>
      <v-spacer />
      <v-tooltip location="top" text="Jog a small star pattern from the current position and solve the pixel-to-mm transform. Run once per camera position/zoom -- not per tool.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-grid" :disabled="disabledNow || detecting || !cfg.bridgeUrl" @click="doCalibrate">
            {{ $t("plugins.duetToolAlign.actions.calibrate") }}
          </v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Centre the current tool's nozzle on the crosshair and record its position -- without applying an offset. Useful for testing.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-image-filter-center-focus"
                 :disabled="disabledNow || detecting || current < 0 || !transform" @click="centreCurrent">
            {{ $t("plugins.duetToolAlign.actions.centre") }}
          </v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Centre the currently-loaded tool and capture its offset. Does not change tools or travel on its own -- select/load the tool and jog it into frame yourself first.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" color="primary" variant="flat" prepend-icon="mdi-play"
                 :disabled="disabledNow || detecting || current < 0 || !transform" @click="runFull">
            {{ $t("plugins.duetToolAlign.actions.runFull") }}
          </v-btn>
        </template>
      </v-tooltip>
      <v-tooltip v-if="busy || detecting" location="top" text="Abort the running operation.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" color="error" variant="text" prepend-icon="mdi-stop" @click="stop">
            {{ $t("plugins.duetToolAlign.actions.stop") }}
          </v-btn>
        </template>
      </v-tooltip>
    </div>
    <div v-if="!allHomed" class="text-caption text-warning px-2 pt-1 flex-shrink-0 d-flex align-center ga-1">
      <v-icon size="14">mdi-alert</v-icon> <span>{{ $t("plugins.duetToolAlign.notHomed") }}</span>
      <v-spacer />
      <v-tooltip location="top" text="Home all axes (sends G28).">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="x-small" variant="tonal" color="warning" :disabled="disabledNow" @click="homeAll">
            {{ $t("plugins.duetToolAlign.actions.homeAll") }}
          </v-btn>
        </template>
      </v-tooltip>
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
              <v-tooltip v-if="!r.isRef && r.g10" location="top" :text="`Apply ${r.name}'s offset now (sends ${r.g10}).`">
                <template #activator="{ props }">
                  <v-btn v-bind="props" size="x-small" variant="tonal" :disabled="disabledNow" @click="applyTool(r.number)">
                    {{ $t("plugins.duetToolAlign.offsets.apply") }}
                  </v-btn>
                </template>
              </v-tooltip>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="d-flex align-center ga-2 mt-1 flex-wrap">
        <v-tooltip location="top" text="Apply every captured tool's offset via G10, in one go.">
          <template #activator="{ props }">
            <v-btn v-bind="props" size="small" color="primary" variant="flat" prepend-icon="mdi-content-save-cog"
                   :disabled="disabledNow || !anyApplicable" @click="applyAll">
              {{ $t("plugins.duetToolAlign.offsets.applyAll") }}
            </v-btn>
          </template>
        </v-tooltip>
        <v-tooltip v-if="cfg.saveCommand" location="top" :text="`Persist applied offsets so they survive a reboot (sends ${cfg.saveCommand}).`">
          <template #activator="{ props }">
            <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-content-save-check"
                   :disabled="disabledNow" @click="saveOffsets">
              {{ $t("plugins.duetToolAlign.offsets.save") }}
            </v-btn>
          </template>
        </v-tooltip>
        <template v-if="cfg.referenceMode === 'point'">
          <v-tooltip location="top" text="Capture the current machine XY as the carriage datum -- every tool's offset (T0 included) is measured from this point.">
            <template #activator="{ props }">
              <v-btn v-bind="props" size="small" variant="text" prepend-icon="mdi-crosshairs-gps" :disabled="disabledNow" @click="captureRefPoint">
                {{ $t("plugins.duetToolAlign.offsets.captureDatum") }}
              </v-btn>
            </template>
          </v-tooltip>
          <span class="text-caption text-medium-emphasis aa-num">
            {{ $t("plugins.duetToolAlign.offsets.datum") }}: {{ refPoint ? refPoint.x.toFixed(2) + ", " + refPoint.y.toFixed(2) : "—" }}
          </span>
        </template>
        <v-tooltip v-else location="top" text="Make the currently-selected tool the reference origin -- other tools' offsets are measured relative to it.">
          <template #activator="{ props }">
            <v-btn v-bind="props" size="small" variant="text" :disabled="disabledNow || current < 0" @click="setReference">
              {{ $t("plugins.duetToolAlign.offsets.setRef") }}
            </v-btn>
          </template>
        </v-tooltip>
        <v-tooltip location="top" text="Negate every computed offset -- use if your firmware/machine expects the opposite sign convention.">
          <template #activator="{ props }">
            <v-switch v-bind="props" v-model="invert" density="compact" hide-details color="primary"
                      :label="$t('plugins.duetToolAlign.offsets.invert')" />
          </template>
        </v-tooltip>
      </div>
      <div class="text-caption text-medium-emphasis mt-1">{{ $t("plugins.duetToolAlign.offsets.persistHint") }}</div>
    </div>

    <!-- Settings -->
    <v-expansion-panels class="aa-settings flex-shrink-0" variant="accordion">
      <v-expansion-panel :title="$t('plugins.duetToolAlign.settings.title')">
        <v-expansion-panel-text>
          <v-text-field v-model="cfg.bridgeUrl" density="compact" variant="outlined" hide-details class="mb-2"
                        :label="$t('plugins.duetToolAlign.settings.bridgeUrl')" :placeholder="$t('plugins.duetToolAlign.settings.bridgeUrlHint')">
            <template #append-inner><HelpTip text="Base URL of the duet-webcam-bridge, e.g. http://192.168.1.50:8081 — used for the camera stream and to load the CV engine." /></template>
          </v-text-field>
          <v-text-field v-model="cfg.opencvUrl" density="compact" variant="outlined" hide-details class="mb-3"
                        :label="$t('plugins.duetToolAlign.settings.opencvUrl')" :placeholder="$t('plugins.duetToolAlign.settings.opencvUrlHint')">
            <template #append-inner><HelpTip text="Override the OpenCV.js URL. Leave blank to use <bridge>/opencv/opencv.js (recommended)." /></template>
          </v-text-field>

          <div class="text-caption text-medium-emphasis mb-1">{{ $t("plugins.duetToolAlign.settings.alignmentHeading") }}</div>
          <div class="d-flex ga-2 flex-wrap mb-2 align-center">
            <v-select v-model="cfg.referenceMode" :items="refModeItems" item-title="title" item-value="value"
                      density="compact" variant="outlined" hide-details class="aa-select"
                      :label="$t('plugins.duetToolAlign.settings.referenceMode')">
              <template #append-inner><HelpTip text="How the 0,0 origin is defined. Reference tool: a tool (e.g. T0) is the origin, others are relative to it. Carriage datum: a fixed point on the carriage (e.g. the E3D toolchanger switch) is the origin — capture it once and every tool is offset from it. (default: Reference tool)" /></template>
            </v-select>
            <v-text-field v-for="f in alignFields" :key="f.key" :model-value="getNum(f.key)" @update:model-value="setNum(f.key, $event)"
                          type="number" :min="f.min" :max="f.max" :step="f.step ?? 1" :suffix="f.unit"
                          density="compact" variant="outlined" hide-details class="aa-field"
                          :label="$t('plugins.duetToolAlign.settings.' + f.key)">
              <template #append-inner><HelpTip :text="fieldTip(f)" /></template>
            </v-text-field>
          </div>

          <div class="d-flex align-center mt-2 mb-1">
            <div class="text-caption text-medium-emphasis">{{ $t("plugins.duetToolAlign.settings.detectionHeading") }}</div>
            <v-spacer />
            <v-tooltip location="top" text="Reset every Detection setting below (for whichever profile is selected above) back to its default value.">
              <template #activator="{ props }">
                <v-btn v-bind="props" size="x-small" variant="text" prepend-icon="mdi-restore" :disabled="editingLocked" @click="resetDetectionDefaults">
                  {{ $t("plugins.duetToolAlign.settings.resetDetection") }}
                </v-btn>
              </template>
            </v-tooltip>
          </div>
          <div class="d-flex ga-2 flex-wrap align-center mb-2">
            <v-select v-model="editingProfileKey" :items="profileOptions" item-title="title" item-value="value"
                      density="compact" variant="outlined" hide-details class="aa-select"
                      :label="$t('plugins.duetToolAlign.settings.profile')">
              <template #append-inner><HelpTip text="Detection settings below apply to whichever tool is actually loaded, using that tool's own overrides if it has any. Pick a tool (or the carriage datum) here to view or tune its overrides without affecting other tools. (default: Global)" /></template>
            </v-select>
            <v-tooltip v-if="editingProfileKey" location="top" max-width="300" text="Give this profile its own Detection settings, starting from the current Global values. Untick to delete the override and go back to following Global.">
              <template #activator="{ props }">
                <v-switch v-bind="props" :model-value="hasOverride" density="compact" hide-details color="primary"
                          :label="$t('plugins.duetToolAlign.settings.useCustom')" @update:model-value="toggleOverride" />
              </template>
            </v-tooltip>
          </div>
          <div class="d-flex ga-2 flex-wrap align-center mb-2">
            <v-select v-model="activeDetector" :items="detectorItems" item-title="title" item-value="value"
                      density="compact" variant="outlined" hide-details class="aa-select" :disabled="editingLocked"
                      :label="$t('plugins.duetToolAlign.settings.detector')" />
            <v-tooltip location="top" max-width="300" text="Pick the largest detected circle instead of the one nearest the crosshair. Handy while the nozzle is off-centre during tuning; turn off for centring. (default: off)">
              <template #activator="{ props }">
                <v-switch v-bind="props" v-model="activePickLargest" density="compact" hide-details color="primary" :disabled="editingLocked"
                          :label="$t('plugins.duetToolAlign.settings.pickLargest')" />
              </template>
            </v-tooltip>
            <v-tooltip v-if="activeDetector === 'contour'" location="top" max-width="300" text="The bore is darker than the nozzle, so threshold keeps the dark pixels. Turn off only if your target is brighter than its surroundings. (default: on)">
              <template #activator="{ props }">
                <v-switch v-bind="props" v-model="activeDarkBore" density="compact" hide-details color="primary" :disabled="editingLocked"
                          :label="$t('plugins.duetToolAlign.settings.darkBore')" />
              </template>
            </v-tooltip>
          </div>
          <div class="d-flex ga-2 flex-wrap align-center">
            <v-text-field v-for="f in activeDetectFields" :key="f.key" :model-value="getDetectNum(f.key)" @update:model-value="setDetectNum(f.key, $event)"
                          type="number" :min="f.min" :max="f.max" :step="f.step ?? 1" :suffix="f.unit" :disabled="editingLocked"
                          density="compact" variant="outlined" hide-details class="aa-field"
                          :label="$t('plugins.duetToolAlign.settings.' + f.key)">
              <template #append-inner><HelpTip :text="fieldTip(f)" /></template>
            </v-text-field>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { HelpTip } from "dwc-plugin-runtime";

import { showConfirmDialog } from "@/composables/useConfirmDialog";
import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";
import { LogLevel, useUiStore } from "@/stores/ui";

import { type AxisCapture, computeToolOffset, formatG10, type ToolOffset } from "../util/toolAlign";
import { resolveOmPath } from "../util/omPath";
import { type AutoAlignConfig, type DetectionSettings, defaultConfig, resolveOpencvUrl, useConfig } from "../model/document";
import { type DetectParams, pickLargest, pickNearestToCentre } from "../cv/detectNozzle";
import { WorkerDetector } from "../cv/detectorWorker";
import { grabFrame } from "../cv/frameGrabber";
import { apply2, magnitude, medianPoint } from "../cv/geometry";
import type { Mat2, Vec2 } from "../cv/geometry";
import { centreTool, type MachineIO, runCalibration } from "../model/orchestrator";
import { applying, dismissCurrentUpdate, dismissedVersion, applyUpdateNow, pendingReload, updateState } from "../model/updateCheck";

// Per-instance config injection (the widget-config framework contract): a host (Flexible Layouts)
// passes a reactive `config` object it persists; the standalone page passes nothing, so we fall back
// to the shared settings-store config. The widget mutates `cfg` directly; the host deep-watches the
// object it passed to persist changes. (`widget` kept as a back-compat alias.)
const props = defineProps<{ config?: AutoAlignConfig; widget?: AutoAlignConfig; disabled?: boolean; host?: { isEditing?: boolean } }>();

const machineStore = useMachineStore();
const uiStore = useUiStore();
const cfg = props.config ?? props.widget ?? useConfig();

const disabledNow = computed(() => props.disabled || uiStore.uiFrozen || busy.value);

// The first-run "set the bridge URL" prompt (aa-setup) is only shown while cfg.bridgeUrl is empty --
// so a v-model straight onto cfg.bridgeUrl would make the prompt (and the field itself) vanish after
// the very first keystroke, mid-typing, and immediately attempt to load a one-character stream URL.
// Typing goes into this local draft instead; only Enter/blur commits it to cfg.bridgeUrl.
const bridgeUrlDraft = ref("");
function commitBridgeUrlDraft(): void {
  const v = bridgeUrlDraft.value.trim();
  if (v) cfg.bridgeUrl = v;
}

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
// `tick` cache-busts the <img> src to force a fresh /stream connection. It must only change on
// an actual load failure (with a backoff) -- MJPEG is one long-lived multipart response, so
// bumping it on a blind timer tears down and reopens a healthy connection every cycle. Cheap
// backends (esp_http_server-class boards) run a small fixed pool of concurrent stream slots, so
// churning through them like that can exhaust it -- worse the lower the frame rate/resolution,
// since a fresh connection can get torn down again before its first frame ever arrives.
const tick = ref(0);
let timer: ReturnType<typeof setTimeout> | null = null;
const streamSrc = computed(() => {
  if (!cfg.bridgeUrl) return "";
  const base = cfg.bridgeUrl.replace(/\/+$/, "") + "/stream";
  return base + (base.includes("?") ? "&" : "?") + "_t=" + tick.value;
});
function onImgError(): void {
  if (timer) return; // a retry is already scheduled
  timer = setTimeout(() => {
    timer = null;
    tick.value = Date.now();
  }, 2000);
}

const lastDetection = ref<Vec2 | null>(null);
const lastRadius = ref(0);
const smoothBuf: Array<Vec2> = []; // recent raw detections for display smoothing

// --- Focus assist ----------------------------------------------------------------
// Variance-of-Laplacian sharpness from the same worker call detection already makes, so this is free
// (no extra frame grab). bestSharpness is a high-water mark for the current focusing session (reset
// whenever Detect (re)starts) -- there's no meaningful absolute scale, so the UI shows current/best as
// a percentage: jog Z, watch it climb toward 100%, back off if it starts dropping again.
const lastSharpness = ref<number | null>(null);
const bestSharpness = ref(0);
const focusPct = computed(() => {
  if (lastSharpness.value == null || bestSharpness.value <= 0) return 0;
  return Math.min(100, (lastSharpness.value / bestSharpness.value) * 100);
});
const frameW = ref(0);
const frameH = ref(0);
const imgEl = ref<HTMLImageElement | null>(null);
// Map the detected circle (in original frame pixels) onto the displayed <img>, accounting for the
// letterbox (object-fit: contain) so the marker sits exactly on what was detected and is drawn at the
// real detected radius. Recomputes each detection (lastDetection/lastRadius change).
// Displayed-px-per-frame-px. Shared by the detection marker and the pixel-scale rings below so both
// use the same source of truth for the letterbox (object-fit: contain) scaling.
const imgScale = computed(() => {
  const img = imgEl.value;
  if (!img || !frameW.value || !img.clientWidth) return null;
  const s = img.clientWidth / frameW.value;
  return isFinite(s) && s > 0 ? s : null;
});

const detectionStyle = computed(() => {
  const d = lastDetection.value;
  const img = imgEl.value;
  const scale = imgScale.value;
  if (!d || !img || !scale) return null;
  const diam = Math.max(8, 2 * lastRadius.value * scale);
  return {
    left: `${img.offsetLeft + d.x * scale}px`,
    top: `${img.offsetTop + d.y * scale}px`,
    width: `${diam}px`,
    height: `${diam}px`,
  };
});

// --- Pixel scale overlay: "how many pixels wide is that?" for setting Min/Max radius etc. ----------
// Toggled on demand (not always-on) so it doesn't clutter the view once you're done tuning.
const showScale = ref(false);
// Round a radius up to a "nice" 1/2/5-times-a-power-of-10 step, same technique chart libraries use for
// axis ticks, so ring labels read as round numbers (20/50/100px) rather than arbitrary fractions.
function niceStep(raw: number): number {
  if (!(raw > 0)) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * pow;
}
// Neutral measurement rings (original-frame px), centred on the crosshair, spaced ~4 across the
// shorter frame dimension so they stay readable rather than crowding the image.
const scaleRingRadii = computed(() => {
  if (!showScale.value || !frameW.value || !frameH.value) return [];
  const maxR = Math.min(frameW.value, frameH.value) / 2;
  const step = niceStep(maxR / 4);
  const rings: Array<number> = [];
  for (let r = step; r <= maxR; r += step) rings.push(r);
  return rings;
});
// A ring's inline style: diameter in displayed px, centred via the shared aa-ring CSS (transform).
function ringStyle(radiusPx: number): Record<string, string> | null {
  const scale = imgScale.value;
  if (!scale) return null;
  const d = radiusPx * 2 * scale;
  return { width: `${d}px`, height: `${d}px` };
}
// Top of a ring's label: the container's vertical centre minus the ring's displayed radius minus a
// small gap, so the label (anchored by its own bottom edge via CSS transform) sits just above the ring.
function labelTopPx(radiusPx: number): string {
  const scale = imgScale.value ?? 0;
  return `calc(50% - ${radiusPx * scale}px - 4px)`;
}

// --- Click-to-measure: right-click (or the ruler-line button) arms it, then two left clicks mark the
// endpoints. A third click starts a new measurement rather than requiring re-arming each time. Points
// are stored in original-frame px like everything else; apply2(transform, ...) converts to mm using
// the same calibration the alignment loop itself uses, when one exists.
const measuring = ref(false);
const measureA = ref<Vec2 | null>(null);
const measureB = ref<Vec2 | null>(null);
function toggleMeasure(): void {
  measuring.value = !measuring.value;
  measureA.value = null;
  measureB.value = null;
}
function frameCoordsFromEvent(e: MouseEvent): Vec2 | null {
  const img = imgEl.value;
  const scale = imgScale.value;
  if (!img || !scale) return null;
  const rect = img.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
}
function onImgMeasureClick(e: MouseEvent): void {
  if (!measuring.value) return;
  const p = frameCoordsFromEvent(e);
  if (!p) return;
  if (!measureA.value || measureB.value) { measureA.value = p; measureB.value = null; }
  else measureB.value = p;
}
const measureDistPx = computed(() => {
  if (!measureA.value || !measureB.value) return null;
  return magnitude({ x: measureB.value.x - measureA.value.x, y: measureB.value.y - measureA.value.y });
});
const measureDistMm = computed(() => {
  if (!measureA.value || !measureB.value || !transform.value) return null;
  const d = apply2(transform.value, { x: measureB.value.x - measureA.value.x, y: measureB.value.y - measureA.value.y });
  return magnitude(d);
});
// Display-px line endpoints for the SVG (frame px -> display px, relative to .aa-cam like everything
// else in the overlay), and the midpoint for the distance label.
function ptStyle(p: Vec2 | null): { x: number; y: number } | null {
  const img = imgEl.value;
  const scale = imgScale.value;
  if (!p || !img || !scale) return null;
  return { x: img.offsetLeft + p.x * scale, y: img.offsetTop + p.y * scale };
}
const measureADisp = computed(() => ptStyle(measureA.value));
const measureBDisp = computed(() => ptStyle(measureB.value));
const measureMidDisp = computed(() => {
  const a = measureADisp.value, b = measureBDisp.value;
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
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
const livePos = computed(() => ({ x: machinePos("X"), y: machinePos("Y"), z: machinePos("Z") }));
function fmtPos(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}

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

// The Detection fields that can be overridden per tool/datum (see DetectionSettings in document.ts).
// Single source of truth for the key list, shared by live resolution, override-creation, and reset.
const DETECTION_KEYS: ReadonlyArray<keyof DetectionSettings> = [
  "detector", "pickLargest", "darkBore",
  "minRadiusPx", "maxRadiusPx", "blurKsize", "detectWidth",
  "houghDp", "houghParam1", "houghParam2", "houghMinDist",
  "threshold", "minCircularity",
];

// Resolve effective Detection settings for a profile key: global values with any per-key overrides
// from cfg.detectProfiles[profileKey] layered on top. null key (Global) or a key with no override yet
// just returns the global values.
function resolveDetectionSettings(profileKey: string | null): DetectionSettings {
  const base = {} as Record<string, unknown>;
  for (const k of DETECTION_KEYS) base[k] = (cfg as unknown as Record<string, unknown>)[k];
  const override = profileKey ? cfg.detectProfiles[profileKey] : undefined;
  return (override ? { ...base, ...override } : base) as unknown as DetectionSettings;
}

// The profile that actually drives live detection: whichever tool is currently loaded on the machine
// (not the settings panel's independently-browsable editingProfileKey below).
const liveProfileKey = computed(() => (current.value >= 0 ? String(current.value) : null));

// Build the detector params from the resolved (global + per-tool override) settings, so tuning in
// Settings -- global or a profile for the loaded tool -- takes effect immediately in the live Detect loop.
function detectParams(s: DetectionSettings): DetectParams {
  return {
    method: s.detector,
    minRadius: s.minRadiusPx,
    maxRadius: s.maxRadiusPx,
    blur: s.blurKsize,
    detectWidth: s.detectWidth,
    dp: s.houghDp,
    param1: s.houghParam1,
    param2: s.houghParam2,
    minDist: s.houghMinDist,
    threshold: s.threshold,
    minCircularity: s.minCircularity,
    darkBore: s.darkBore,
  };
}

async function detectOnce(): Promise<Vec2 | null> {
  if (!cvReady.value || !cfg.bridgeUrl) return null;
  try {
    const img = await grabFrame(cfg.bridgeUrl);
    frameW.value = img.width;
    frameH.value = img.height;
    const centre = { x: img.width / 2, y: img.height / 2 };
    const settings = resolveDetectionSettings(liveProfileKey.value);
    // detect() transfers the pixel buffer to the worker, so read dimensions/centre first.
    const res = await detector.detect(img, detectParams(settings));
    if (detector.lastError) setStatus(i18n.global.t("plugins.duetToolAlign.detect.error", { msg: detector.lastError }), "error");
    // Update focus-assist regardless of whether a circle was found -- a too-blurry-to-detect frame is
    // exactly when this is most useful.
    lastSharpness.value = res.sharpness;
    bestSharpness.value = Math.max(bestSharpness.value, res.sharpness);
    const c = settings.pickLargest ? pickLargest(res.circles) : pickNearestToCentre(res.circles, centre);
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
  bestSharpness.value = 0; // fresh focusing session -- don't compare against a stale peak
  lastSharpness.value = null;
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

// Manual X/Y jog to bring a tool's nozzle into frame (useful when tools differ a lot).
function jogXY(axis: "X" | "Y", dir: number): void {
  if (disabledNow.value) return;
  const d = dir * (cfg.xyStep || 0.1);
  void send(`M120\nG91\nG1 ${axis}${d.toFixed(3)} F${cfg.jogFeed}\nG90\nM121`);
}

// Unload the active tool (RRF T-1) — e.g. to bring a bare carriage datum/switch over the camera.
function unloadTool(): void {
  if (disabledNow.value) return;
  void send("T-1");
}

// Bare G28 runs the machine's own homeall.g on RRF -- same as DWC's own Home All button.
function homeAll(): void {
  if (disabledNow.value) return;
  void send("G28");
}

// Capture the current machine XY as the carriage datum (referenceMode = "point").
function captureRefPoint(): void {
  const x = machinePos("X"), y = machinePos("Y");
  if (x == null || y == null) { notify(i18n.global.t("plugins.duetToolAlign.noPos")); return; }
  refPoint.value = { x, y };
  notify(i18n.global.t("plugins.duetToolAlign.offsets.datumSaved"), LogLevel.success);
}
function frameCentre(): Vec2 {
  return { x: (frameW.value || 640) / 2, y: (frameH.value || 480) / 2 };
}

// --- Alignment state -----------------------------------------------------------
const transform = ref<Mat2 | null>(null);
const captures = ref<Record<number, AxisCapture>>({});
// Captured carriage datum (referenceMode = "point"): the 0,0 every tool is offset from.
const refPoint = ref<{ x: number; y: number } | null>(null);
const busy = ref(false);
let aborted = false;

const refModeItems = [
  { title: i18n.global.t("plugins.duetToolAlign.settings.refModeTool"), value: "tool" },
  { title: i18n.global.t("plugins.duetToolAlign.settings.refModePoint"), value: "point" },
];

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

// Align the CURRENTLY-LOADED tool only: optional start macro → centre on the crosshair → capture →
// optional finish macro. The user drives tool changes and jogs the nozzle into frame themselves, then
// runs this per tool. Requires a calibration (transform) to exist first; does not change tools or
// travel on its own.
async function runFull(): Promise<void> {
  if (busy.value) return;
  if (current.value < 0) { notify(i18n.global.t("plugins.duetToolAlign.selectTool")); return; }
  if (!transform.value) { setStatus(i18n.global.t("plugins.duetToolAlign.calib.needed"), "error"); return; }
  if (cfg.referenceMode === "point" && !refPoint.value) {
    setStatus(i18n.global.t("plugins.duetToolAlign.run.needRefPoint"), "error");
    return;
  }
  if (!(await ensureCv())) return;
  busy.value = true; aborted = false;
  try {
    if (cfg.startCommand) await machineIO.sendCode(cfg.startCommand);
    if (!aborted) {
      const res = await centreTool(machineIO, detectOnce, transform.value, frameCentre(), motionParams(), progress);
      if (res.ok && res.position) captureXY(current.value, res.position);
      else setStatus(i18n.global.t("plugins.duetToolAlign.centre.fail", { msg: res.error ?? "" }), "error");
    }
    if (!aborted && cfg.finishCommand) await machineIO.sendCode(cfg.finishCommand);
    setStatus(aborted ? i18n.global.t("plugins.duetToolAlign.run.aborted")
      : i18n.global.t("plugins.duetToolAlign.run.done"), aborted ? "error" : "ok");
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
  const ct = captures.value[t];
  if (!ct) return null;
  if (cfg.referenceMode === "point") {
    // Every tool (T0 included) is offset from the captured carriage datum; no carried base offset.
    if (!refPoint.value) return null;
    return computeToolOffset(refPoint.value, ct, { x: 0, y: 0 }, cfg.invertOffsets);
  }
  const cr = captures.value[cfg.referenceTool];
  if (!cr) return null;
  return computeToolOffset(cr, ct, refOffset(), cfg.invertOffsets);
}
// In "tool" mode the reference tool keeps its own offset (excluded); in "point" mode every tool gets one.
function isOffsettable(t: number): boolean {
  return cfg.referenceMode === "point" || t !== cfg.referenceTool;
}
function g10For(t: number): string | null {
  const o = offsetFor(t);
  return o ? formatG10(t, o) : null;
}
const anyApplicable = computed(() => tools.value.some((t) => isOffsettable(t.number) && g10For(t.number)));

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
  isRef: cfg.referenceMode === "tool" && t.number === cfg.referenceTool,
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
  const cmds = tools.value.filter((t) => isOffsettable(t.number)).map((t) => g10For(t.number)).filter((c): c is string => !!c);
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
// `unit`, when set, is shown as a compact field suffix instead of being spelled out in the label --
// labels are floating and the fields are narrow (half the panel width, see .aa-field), so keeping
// them to a word or two is what stops them being clipped. Full context (units included) is always
// in the tooltip via fieldTip().
interface NumField { key: string; min?: number; max?: number; step?: number; tip: string; unit?: string }
const alignFields: Array<NumField> = [
  { key: "referenceTool", min: 0, step: 1, tip: "Tool number used as the origin that all other tools' offsets are measured against. Usually 0." },
  { key: "calibStepMm", min: 0.05, max: 5, step: 0.05, unit: "mm", tip: "Half-size of the calibration jog star (mm). Big enough to move the nozzle a clear distance in view, small enough to stay in frame. Typical 0.3–1.0." },
  { key: "tolerancePx", min: 0.5, max: 15, step: 0.5, unit: "px", tip: "How close (px) repeated detections must agree to count as locked, and how near the crosshair counts as centred. Raise if the lock is jumpy; lower for more precision. Typical 1–4." },
  { key: "smoothing", min: 1, max: 15, step: 1, unit: "frames", tip: "Frames median-averaged for the on-screen marker, to steady a jumpy lock. 1 = off. Display only — does not affect captured positions. Typical 3–7." },
  { key: "gain", min: 0.1, max: 1.5, step: 0.05, tip: "Fraction of each computed correction applied per centring step. Lower = slower but stable; higher = faster but can overshoot. Typical 0.5–0.9." },
  { key: "maxStepMm", min: 0.1, max: 10, step: 0.1, unit: "mm", tip: "Clamp on a single centring jog (mm), so a bad detection can't fling the toolhead. Typical 0.5–3." },
  { key: "maxIterations", min: 5, max: 100, step: 1, tip: "Maximum centring jogs before giving up on a tool. Typical 15–40." },
  { key: "settleMs", min: 0, max: 3000, step: 50, unit: "ms", tip: "Pause after each move before grabbing a frame, letting vibration/ooze settle (ms). Typical 200–800." },
  { key: "travelFeed", min: 100, max: 30000, step: 100, unit: "mm/min", tip: "Feed rate (mm/min) for travel moves to the camera position. e.g. 6000." },
  { key: "jogFeed", min: 60, max: 12000, step: 60, unit: "mm/min", tip: "Feed rate (mm/min) for small calibration/centring/Z-focus jogs. e.g. 1200." },
];
// Common to both detectors.
const commonFields: Array<NumField> = [
  { key: "minRadiusPx", min: 1, max: 1000, step: 1, unit: "px", tip: "Smallest circle radius accepted (original-frame px). Raise to reject small specks / the inner dark dot. Watch the r= readout." },
  { key: "maxRadiusPx", min: 1, max: 2000, step: 1, unit: "px", tip: "Largest circle radius accepted (original-frame px). Must be above the bore radius or the bore won't be found. Watch the r= readout." },
  { key: "blurKsize", min: 0, max: 21, step: 2, tip: "Median blur kernel (odd number) applied before detection to suppress speckle/glitter. 0 or 1 = off. Typical 3–9." },
  { key: "detectWidth", min: 160, max: 2000, step: 20, unit: "px", tip: "Frame is downscaled to this width for detection speed (coords scaled back). Lower = faster, less precise. Typical 480–1000." },
];
// Hough-only.
const houghFields: Array<NumField> = [
  { key: "houghParam2", min: 1, max: 300, step: 1, tip: "Detection sensitivity (Hough accumulator threshold). LOWER finds more circles (and more false ones); higher is stricter. The main knob. Typical 20–80." },
  { key: "houghParam1", min: 10, max: 400, step: 5, tip: "Edge sensitivity (Canny high threshold). Higher = only strong edges, ignoring faint surface texture. Typical 80–200." },
  { key: "houghDp", min: 1, max: 3, step: 0.1, tip: "Accumulator resolution (inverse). 1 = full detail; 1.5–2 finds rougher/blurrier circles, less accurately. Typical 1–2." },
  { key: "houghMinDist", min: 0, max: 2000, step: 5, unit: "px", tip: "Minimum distance between detected circle centres (px). 0 = auto (frame/8). Raise to avoid several overlapping detections." },
];
// Contour-only.
const contourFields: Array<NumField> = [
  { key: "threshold", min: 0, max: 255, step: 1, tip: "Brightness cut (0–255) separating the bore from the nozzle. 0 = auto (Otsu), which usually works. Set manually if lighting is uneven." },
  { key: "minCircularity", min: 0, max: 1, step: 0.05, tip: "How round a blob must be to count (4π·area/perimeter²). Higher rejects irregular shapes; lower is more forgiving. Typical 0.5–0.8." },
];
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
// Tooltip text with the built-in default appended, so the user always knows the original value.
const DEFAULTS = defaultConfig() as unknown as Record<string, unknown>;
function fieldTip(f: NumField): string {
  return `${f.tip} (default: ${DEFAULTS[f.key]})`;
}

// --- Per-tool / carriage-datum Detection profiles -----------------------------
// The Settings panel lets you browse and tune a profile for any tool (or the carriage datum)
// independently of which tool is actually loaded -- that's editingProfileKey. It's unrelated to
// liveProfileKey above, which always follows whatever tool the machine actually has loaded.
const editingProfileKey = ref<string | null>(null); // null = Global (default)
const profileOptions = computed(() => [
  { title: i18n.global.t("plugins.duetToolAlign.settings.profileGlobal"), value: null },
  ...tools.value.map((t) => ({ title: t.name || `T${t.number}`, value: String(t.number) })),
  { title: i18n.global.t("plugins.duetToolAlign.settings.profileDatum"), value: "datum" },
]);
// Whether the currently-browsed profile has its own override (vs. just inheriting Global).
const hasOverride = computed(() => {
  const key = editingProfileKey.value;
  return key != null && !!cfg.detectProfiles[key];
});
// Create an override for the browsed profile (snapshotting the current Global values as its starting
// point) or delete it to revert that profile back to following Global.
function toggleOverride(): void {
  const key = editingProfileKey.value;
  if (!key) return;
  if (cfg.detectProfiles[key]) {
    delete cfg.detectProfiles[key];
  } else {
    const snapshot = {} as Record<string, unknown>;
    for (const k of DETECTION_KEYS) snapshot[k] = (cfg as unknown as Record<string, unknown>)[k];
    cfg.detectProfiles[key] = snapshot as Partial<DetectionSettings>;
  }
}
// Where Detection field reads/writes go: the browsed profile's override object once it has one,
// otherwise the global cfg (same as before this feature existed, and how Global itself always behaves).
function activeStore(): Record<string, unknown> {
  const key = editingProfileKey.value;
  const override = key ? cfg.detectProfiles[key] : undefined;
  return (override ?? cfg) as unknown as Record<string, unknown>;
}
// Fields are read-only previews of Global until "use custom settings" creates an override to edit.
const editingLocked = computed(() => editingProfileKey.value != null && !hasOverride.value);
function getDetectNum(key: string): number {
  return activeStore()[key] as number;
}
function setDetectNum(key: string, val: unknown): void {
  activeStore()[key] = val === "" || val === null || val === undefined ? 0 : Number(val);
}
const activeDetector = computed<"hough" | "contour">({
  get: () => (activeStore().detector as "hough" | "contour" | undefined) ?? cfg.detector,
  set: (v) => { activeStore().detector = v; },
});
const activePickLargest = computed<boolean>({
  get: () => (activeStore().pickLargest as boolean | undefined) ?? cfg.pickLargest,
  set: (v) => { activeStore().pickLargest = v; },
});
const activeDarkBore = computed<boolean>({
  get: () => (activeStore().darkBore as boolean | undefined) ?? cfg.darkBore,
  set: (v) => { activeStore().darkBore = v; },
});
// Fields shown for the currently-browsed profile's detector.
const activeDetectFields = computed(() =>
  activeDetector.value === "hough" ? [...commonFields, ...houghFields] : [...commonFields, ...contourFields]);

// Reset the browsed profile's Detection settings (detector choice + every tuning field) back to
// built-in defaults -- Global if browsing Global, or the override object if browsing a tool/datum
// profile that has one. Doesn't touch Alignment & motion, bridge URL, etc.
function resetDetectionDefaults(): void {
  const d = defaultConfig() as unknown as Record<string, unknown>;
  const target = activeStore();
  for (const k of DETECTION_KEYS) target[k] = d[k];
  notify(i18n.global.t("plugins.duetToolAlign.settings.resetDetectionDone"), LogLevel.success);
}

// --- Update notification (announced into the shared hub; banner is the in-context surface) ---
// Whether checks happen at all is toggled from AboutDialog (the "i" button) or Flexible Layouts'
// unified update hub when embedded there -- not duplicated here.
const updateBannerVisible = computed(() =>
  !!updateState.value?.updateAvailable && updateState.value.latestVersion !== dismissedVersion.value);
function reloadPage(): void {
  window.location.reload();
}

// Load the CV engine as soon as a bridge URL is available (on mount, and when the user first sets
// it) rather than waiting for an alignment action — which is disabled while disconnected, so it would
// otherwise never load and the status would sit on "not loaded". This also surfaces a bad URL /
// missing /opencv assets immediately as a clear error.
onMounted(() => {
  if (cfg.bridgeUrl) void ensureCv();
});
watch(() => cfg.bridgeUrl, (url) => { if (url && !cvReady.value && !cvLoading.value) void ensureCv(); });
onBeforeUnmount(() => { aborted = true; if (timer) clearTimeout(timer); detector.dispose(); });
</script>

<style scoped>
/* container-type lets .aa-main below respond to the widget's own box (it can be embedded in a
   Flexible Layouts grid cell of any size, unrelated to viewport width) rather than the viewport. */
.aa-root { min-height: 0; overflow: hidden; container-type: inline-size; }

/* Camera (left) + everything else (right), side by side so the camera gets a squarish box instead
   of being squeezed thin by every control row stacking underneath it. Default align-items: stretch
   is kept deliberately -- aa-side-col relies on it to get a bounded height so its own overflow-y:
   auto can scroll; only aa-cam-col opts out (align-self below), since stretching it would distort
   the square. */
.aa-main { min-height: 0; gap: 8px; }

/* Half the row's width -- deliberately sized off width, not height: this widget's own height often
   isn't a definite value (Flexible Layouts panels/the standalone page can auto-size to content), and
   aspect-ratio can't compute a sensible size from an indefinite one. Width is always definite here
   (the row gets it from the widget's own box), so aa-cam below can go width: 100%; aspect-ratio: 1/1
   and get a reliable square regardless of how much vertical space is actually available.
   align-self: flex-start so this column doesn't stretch to aa-side-col's (taller, scrolling)
   height -- it should stay exactly as tall as its own square content. */
.aa-cam-col { flex: 0 0 50%; max-width: 50%; align-self: flex-start; }

/* Stretches to aa-main's full height (default align-items) so this box is actually bounded --
   without that, overflow-y: auto has nothing to overflow against and never shows a scrollbar,
   letting content run past aa-root's overflow: hidden with no way to reach it. */
.aa-side-col { min-width: 0; min-height: 0; overflow-y: auto; }

/* Narrow embeds (e.g. a slim Flexible Layouts panel): drop back to the original stacked layout
   rather than crushing either column past usability. */
@container (max-width: 480px) {
  .aa-main { flex-direction: column; }
  .aa-cam-col { flex-basis: auto; width: 100%; max-width: none; }
  .aa-side-col { overflow-y: visible; }
}

.aa-cam { position: relative; width: 100%; aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #000; }
.aa-img { max-width: 100%; max-height: 100%; display: block; object-fit: contain; }
.aa-img-measuring { cursor: crosshair; }
/* The setup prompt (shown until a bridge URL is set) sits on a normal surface, not the black camera
   backdrop, so the input is readable; it's always interactive regardless of connection state. */
.aa-setup { width: 100%; max-width: 460px; background: rgb(var(--v-theme-surface)); border-radius: 6px; }

.aa-overlay { position: absolute; inset: 0; pointer-events: none; }
.aa-cross-h { position: absolute; left: 0; right: 0; top: 50%; border-top: 1px solid #39ff14; }
.aa-cross-v { position: absolute; top: 0; bottom: 0; left: 50%; border-left: 1px solid #39ff14; }
/* width/height/left/top come from detectionStyle (the real detected radius, letterbox-corrected). */
.aa-circle { position: absolute; transform: translate(-50%, -50%); border: 2px solid #ff3b30; border-radius: 50%; box-shadow: 0 0 4px #ff3b30; }

/* Pixel scale overlay (toggled via showScale): width/height come from ringStyle(), centred on the
   crosshair like aa-circle. Neutral rings are a measuring aid; min/max are the live Detection settings. */
.aa-ring { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); border-radius: 50%; box-sizing: border-box; }
.aa-ring-scale { border: 1px dashed rgba(255, 255, 255, 0.4); }
.aa-ring-min { border: 1px dashed #00e5ff; }
.aa-ring-max { border: 1px dashed #ffb300; }
/* top comes from labelTopPx(); anchored by its own bottom edge so it sits just above the ring. */
.aa-ring-label { position: absolute; left: 50%; transform: translate(-50%, -100%); font-size: 10px; line-height: 1.4;
  white-space: nowrap; padding: 0 3px; border-radius: 2px; background: rgba(0, 0, 0, 0.55); }
.aa-ring-label-scale { color: rgba(255, 255, 255, 0.75); }
.aa-ring-label-min { color: #00e5ff; }
.aa-ring-label-max { color: #ffb300; }

/* Click-to-measure: SVG fills the same box as the crosshair/rings so the line can be drawn at
   whatever angle, endpoints/label positioned in the same display-px space as everything else. */
.aa-measure-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.aa-measure-svg line { stroke: #ffeb3b; stroke-width: 1.5; stroke-dasharray: 4 3; }
.aa-measure-pt { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%;
  background: #ffeb3b; box-shadow: 0 0 3px rgba(0, 0, 0, 0.8); }
.aa-measure-label { position: absolute; transform: translate(-50%, -100%); margin-top: -6px; font-size: 11px;
  white-space: nowrap; padding: 1px 4px; border-radius: 2px; background: rgba(0, 0, 0, 0.7); color: #ffeb3b; }

.aa-status-info { color: rgba(127, 127, 127, 0.95); }
.aa-status-ok { color: #2e7d32; }
.aa-status-error { color: #c62828; }

.aa-btn { min-width: 0; }
.aa-narrow { max-width: 120px; }
/* A little wider than before (was 160px): labels are now short (unit moved to the field's own
   suffix, see NumField.unit), but a value + suffix together (e.g. "30000" + "mm/min") still wants
   more room than a bare value did. */
.aa-field { max-width: 180px; }
.aa-select { max-width: 200px; }
.aa-focusbar { width: 100%; }
.aa-focusbar-bar { max-width: 220px; }

.aa-table { min-height: 0; overflow: auto; }
.aa-grid { width: 100%; border-collapse: collapse; font-size: 0.8em; }
.aa-grid th { text-align: left; font-weight: 600; opacity: 0.7; padding: 1px 4px; }
.aa-grid td { padding: 1px 4px; border-top: 1px solid rgba(127, 127, 127, 0.2); }
.aa-num { font-family: monospace; font-variant-numeric: tabular-nums; }
.aa-ref { background: rgba(127, 127, 127, 0.08); }
.aa-badge { margin-left: 4px; font-size: 0.75em; opacity: 0.6; }
</style>
