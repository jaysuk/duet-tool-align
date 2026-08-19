<!--
  Optional on/off + brightness control for a NeoPixel work light on the camera bridge (see
  M5Stack-Unit-CamS3-5MP's neopixel_mgr / GET+POST /api/neopixel). Entirely self-hiding: polls
  the bridge once per bridgeUrl change (and on an interval while visible, in case the ring is
  enabled/disabled on the device's own /setup page mid-session) and renders nothing unless the
  bridge reports the ring as "active" (enabled in config AND the driver initialized OK). Bridges
  that don't implement this endpoint at all (e.g. duet-webcam-bridge, or camera firmware without
  this feature) just 404/fail the fetch, which is treated identically to "not active" -- no error
  shown, the control simply doesn't appear.
-->
<template>
  <div v-if="active" class="d-flex align-center ga-2 flex-wrap aa-neopixel mb-2">
    <v-tooltip location="top" text="Turn the camera bridge's NeoPixel work light on or off.">
      <template #activator="{ props }">
        <v-switch v-bind="props" v-model="on" density="compact" hide-details color="primary" :disabled="disabled || applying"
                  :label="$t('plugins.duetToolAlign.light.label')" class="flex-grow-0" @update:model-value="apply" />
      </template>
    </v-tooltip>
    <v-tooltip location="top" text="Work light brightness (white only).">
      <template #activator="{ props }">
        <v-slider v-bind="props" v-model="brightness" min="0" max="255" step="1" density="compact" hide-details
                  :disabled="disabled || applying || !on" class="aa-neopixel-slider" @update:model-value="apply" />
      </template>
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import i18n from "@/i18n";
import { LogLevel, useUiStore } from "@/stores/ui";

const props = defineProps<{ bridgeUrl: string; disabled: boolean }>();

const uiStore = useUiStore();
const active = ref(false);
const on = ref(false);
const brightness = ref(40);
const applying = ref(false);

function notify(msg: string): void {
	uiStore.makeNotification(LogLevel.warning, i18n.global.t("plugins.duetToolAlign.widget"), msg);
}

function apiUrl(): string {
	return props.bridgeUrl.replace(/\/+$/, "") + "/api/neopixel";
}

async function refresh(): Promise<void> {
	if (!props.bridgeUrl) {
		active.value = false;
		return;
	}
	try {
		const res = await fetch(apiUrl());
		if (!res.ok) {
			active.value = false;
			return;
		}
		const data = await res.json();
		active.value = data.active === true;
		if (active.value) {
			on.value = data.on === true;
			brightness.value = typeof data.brightness === "number" ? data.brightness : brightness.value;
		}
	} catch {
		// Bridge unreachable or doesn't implement this endpoint -- just stay hidden.
		active.value = false;
	}
}

async function apply(): Promise<void> {
	if (!active.value || applying.value) return;
	applying.value = true;
	try {
		const res = await fetch(apiUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `on=${on.value ? 1 : 0}&brightness=${brightness.value}`,
		});
		if (!res.ok) {
			const msg = await res.text().catch(() => `HTTP ${res.status}`);
			notify(i18n.global.t("plugins.duetToolAlign.light.applyFailed", { msg }));
			active.value = false;
		}
	} catch (e) {
		notify(i18n.global.t("plugins.duetToolAlign.light.applyFailed", { msg: e instanceof Error ? e.message : String(e) }));
	} finally {
		applying.value = false;
	}
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
	void refresh();
	pollTimer = setInterval(refresh, 15000);
});
onBeforeUnmount(() => {
	if (pollTimer) clearInterval(pollTimer);
});
watch(() => props.bridgeUrl, refresh);
</script>

<style scoped>
.aa-neopixel-slider {
  max-width: 200px;
}
</style>
