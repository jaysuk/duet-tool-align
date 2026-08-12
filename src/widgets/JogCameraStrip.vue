<!--
  Shared jog (X/Y/Z) + Go to camera + travel-settings strip, used identically on the Calibrate and
  Align tools steps -- extracted so that markup, not just logic, lives in exactly one place. Reads
  cfg directly via useConfig() (the same singleton reactive object the host widget uses, since
  useConfig() always returns the one persisted config for this plugin) rather than taking every
  field as a prop. `disabled` still has to come from the parent: it folds in this widget instance's
  own `busy` state, which has no shared store to read independently.
-->
<template>
  <div class="d-flex flex-wrap align-center ga-3 mb-2">
    <div class="d-flex align-center ga-1 aa-jog-group">
      <span class="text-caption text-medium-emphasis mr-1">XY</span>
      <v-tooltip location="top" text="Jog X by the step size, to bring the tool's nozzle into frame.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabled" @click="$emit('jog-xy', 'X', -1)">X−</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Jog X by the step size, to bring the tool's nozzle into frame.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabled" @click="$emit('jog-xy', 'X', 1)">X+</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Jog Y by the step size, to bring the tool's nozzle into frame.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabled" @click="$emit('jog-xy', 'Y', -1)">Y−</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Jog Y by the step size, to bring the tool's nozzle into frame.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabled" @click="$emit('jog-xy', 'Y', 1)">Y+</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" max-width="280" text="X/Y jog distance per button press (mm). Use a big step to bring a far-off tool into frame, then a small step to fine-tune. (default: 0.1)">
        <template #activator="{ props }">
          <v-text-field v-bind="props" v-model.number="cfg.xyStep" type="number" min="0.01" max="50" step="0.05" label="XY step"
                        density="compact" variant="outlined" hide-details class="aa-step-field" suffix="mm" />
        </template>
      </v-tooltip>
    </div>
    <v-divider vertical class="aa-jog-divider" />
    <div class="d-flex align-center ga-1 aa-jog-group">
      <span class="text-caption text-medium-emphasis mr-1">Z</span>
      <v-tooltip location="top" text="Jog Z down by the step size, to bring the nozzle into focus.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabled" @click="$emit('jog-z', -1)">Z−</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" text="Jog Z up by the step size, to bring the nozzle into focus.">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="tonal" :disabled="disabled" @click="$emit('jog-z', 1)">Z+</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip location="top" max-width="280" text="Z distance per -Z/+Z press (mm), to bring the nozzle into focus. Typical 0.02–0.2. (default: 0.05)">
        <template #activator="{ props }">
          <v-text-field v-bind="props" v-model.number="cfg.zStep" type="number" min="0.01" max="2" step="0.01" label="Z step"
                        density="compact" variant="outlined" hide-details class="aa-step-field" suffix="mm" />
        </template>
      </v-tooltip>
    </div>
    <v-spacer />
    <v-tooltip location="top" text="Travel to the saved camera position (X/Y, and Z if saved and Z is included below).">
      <template #activator="{ props }">
        <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-camera-marker" :disabled="disabled || !hasCameraPos" @click="$emit('goto-camera')">
          {{ $t("plugins.duetToolAlign.camera.goto") }}
        </v-btn>
      </template>
    </v-tooltip>
    <v-menu v-model="travelMenuOpen" :close-on-content-click="false" location="bottom end">
      <template #activator="{ props }">
        <v-tooltip location="top" text="Travel settings for Go to camera.">
          <template #activator="{ props: tipProps }">
            <v-btn v-bind="{ ...props, ...tipProps }" size="small" variant="tonal" icon="mdi-cog-outline" />
          </template>
        </v-tooltip>
      </template>
      <v-card min-width="260" class="pa-3">
        <div class="d-flex align-center ga-2 mb-1">
          <v-switch v-model="cfg.useG53" density="compact" hide-details color="primary"
                    :label="$t('plugins.duetToolAlign.settings.useG53')" class="flex-grow-0" />
          <HelpTip text="On: Go to camera always returns to the exact saved machine position (G53), regardless of the loaded tool's offset -- reliable even mid-calibration when offsets aren't set yet. Off: moves in the loaded tool's offset-compensated coordinates, so that tool's nozzle lands over the camera instead of the bare carriage." />
        </div>
        <div class="d-flex align-center ga-2">
          <v-switch v-model="cfg.gotoCameraZ" density="compact" hide-details color="primary"
                    :label="$t('plugins.duetToolAlign.settings.gotoCameraZ')" class="flex-grow-0" />
          <HelpTip text="On: Go to camera also drives Z to the saved camera focus height (after any safe-Z lift). Off: only moves X/Y -- Z is left wherever the safe-Z lift put it (or untouched if no safe Z is set) -- useful if you're focusing manually and don't want every Go to camera to re-drive Z to a stale value." />
        </div>
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { HelpTip } from "dwc-plugin-runtime";
import { useConfig } from "../model/document";

defineProps<{ disabled: boolean }>();
defineEmits<{
  "jog-xy": [axis: "X" | "Y", dir: number];
  "jog-z": [dir: number];
  "goto-camera": [];
}>();

const cfg = useConfig();
const hasCameraPos = computed(() => typeof cfg.cameraX === "number" && typeof cfg.cameraY === "number");
const travelMenuOpen = ref(false);
</script>
