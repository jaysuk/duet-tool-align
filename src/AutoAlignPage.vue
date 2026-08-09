<template>
  <v-container fluid class="pa-2 align-start">
    <v-card class="aa-page-card" width="100%">
      <v-card-title class="text-subtitle-1 d-flex align-center">
        <v-icon class="mr-2">mdi-image-filter-center-focus</v-icon>
        {{ $t("plugins.duetToolAlign.title") }}
        <v-spacer />
        <v-tooltip text="About, updates & diagnostics" location="bottom">
          <template #activator="{ props: tip }">
            <v-btn v-bind="tip" icon="mdi-information-outline" variant="text" size="small" @click="aboutOpen = true" />
          </template>
        </v-tooltip>
      </v-card-title>
      <v-divider />
      <AutoAlignWidget />

      <AboutDialog v-model="aboutOpen" plugin-id="DuetToolAlign" title="Duet Tool Align"
        :description="aboutDescription" :model="machineStore.model"
        repo="https://github.com/jaysuk/duet-tool-align"
        :update-available="updateState?.updateAvailable ?? false" :latest-version="updateState?.latestVersion"
        :applying="applying" :pending-reload="pendingReload" :auto-check="autoCheck"
        @check-update="onCheckUpdate" @apply-update="applyUpdateNow" @toggle-auto-check="onToggleAutoCheck" />
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from "vue";

import { useMachineStore } from "@/stores/machine";

import { AboutDialog } from "dwc-plugin-runtime";

import AutoAlignWidget from "./widgets/AutoAlignWidget.vue";
import {
  applying, applyUpdateNow, pendingReload, runUpdateCheck,
  setUpdateChecksEnabled, updateChecksEnabled, updateState,
} from "./model/updateCheck";

const machineStore = useMachineStore();
const aboutOpen = ref(false);
const autoCheck = ref(updateChecksEnabled());
const aboutDescription = "Aligns multiple toolheads / nozzles to each other so they print to the same coordinates.";
function onCheckUpdate(): void { void runUpdateCheck({ force: true }); }
function onToggleAutoCheck(v: boolean): void { autoCheck.value = v; setUpdateChecksEnabled(v); }
</script>

<style scoped>
/* No max-height here any more -- v-card has overflow: hidden by default, so max-height +
   inherited-overflow was clipping anything taller than 100vh - 120px with nothing to scroll to. Every
   fix this session to AutoAlignWidget.vue's own internal overflow/height handling was chasing symptoms
   inside a page that was still capping the card itself at the top level -- this was the actual root
   cause. Let the card (and page) grow to content and the document scroll normally, same as any other
   DWC page. */
.aa-page-card { display: flex; flex-direction: column; }
</style>
