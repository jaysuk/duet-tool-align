<!--
  On/off control for the camera bridge's built-in status LED (see M5Stack-Unit-CamS3-5MP's
  led_mgr / GET+POST /api/led). Unlike NeoPixelControl there's no "enabled" gate to check --
  this LED is built into the board, not something the user wires up -- so "supported" here just
  means the bridge answered GET /api/led at all. Bridges that don't implement this endpoint
  (e.g. duet-webcam-bridge, or camera firmware without this feature) 404/fail the fetch, which
  is treated identically to "not supported" -- no error shown, the control simply doesn't appear.
-->
<template>
  <div v-if="supported" class="d-flex align-center ga-2 flex-wrap mb-2">
    <v-tooltip location="top" text="Turn the camera bridge's onboard LED on or off.">
      <template #activator="{ props }">
        <v-switch v-bind="props" v-model="on" density="compact" hide-details color="primary" :disabled="disabled || applying"
                  :label="$t('plugins.duetToolAlign.light.onboardLabel')" class="flex-grow-0" @update:model-value="apply" />
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
const supported = ref(false);
const on = ref(false);
const applying = ref(false);

function notify(msg: string): void {
	uiStore.makeNotification(LogLevel.warning, i18n.global.t("plugins.duetToolAlign.widget"), msg);
}

function apiUrl(): string {
	return props.bridgeUrl.replace(/\/+$/, "") + "/api/led";
}

async function refresh(): Promise<void> {
	if (!props.bridgeUrl) {
		supported.value = false;
		return;
	}
	try {
		const res = await fetch(apiUrl());
		if (!res.ok) {
			supported.value = false;
			return;
		}
		const data = await res.json();
		supported.value = true;
		on.value = data.on === true;
	} catch {
		// Bridge unreachable or doesn't implement this endpoint -- just stay hidden.
		supported.value = false;
	}
}

async function apply(): Promise<void> {
	if (!supported.value || applying.value) return;
	applying.value = true;
	try {
		const res = await fetch(apiUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `on=${on.value ? 1 : 0}`,
		});
		if (!res.ok) {
			const msg = await res.text().catch(() => `HTTP ${res.status}`);
			notify(i18n.global.t("plugins.duetToolAlign.light.applyFailed", { msg }));
			supported.value = false;
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
