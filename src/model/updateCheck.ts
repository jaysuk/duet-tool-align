/**
 * Self-update for Duet Tool Align, working WITH the shared cross-plugin update hub in
 * dwc-plugin-runtime (the same one Flexible Layouts uses).
 *
 * On load it checks GitHub Releases for a newer build and, when one is found, ANNOUNCES it into the
 * hub (`announceUpdate`). If a host is present (e.g. FL's shell, which claims the host), that host
 * renders ONE aggregated popup listing every plugin with an update — so this plugin appears in the
 * unified popup rather than nagging separately. When no host is active we fall back to our own
 * one-shot notification, and the widget always shows an in-context banner with a one-click apply.
 *
 * The heavy lifting (GitHub fetch, version compare, ZIP download + install) lives in the runtime; this
 * is the thin wiring: throttling, opt-out, hub sync, and supplying DWC's installer.
 */
import { ref } from "vue";

import { announceUpdate, applyUpdate, checkForUpdate, clearAnnouncedUpdate, isUpdateHostActive, type UpdateResult } from "dwc-plugin-runtime";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";
import { LogLevel, useUiStore } from "@/stores/ui";

import { PLUGIN_MANIFEST_ID } from "./constants";

const OWNER = "jaysuk";
const REPO = "duet-tool-align";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // re-check at most once a day on load

const LS_ENABLED = "duetToolAlign.updateCheck.enabled";
const LS_LAST = "duetToolAlign.updateCheck.lastCheck";
const LS_DISMISSED = "duetToolAlign.updateCheck.dismissed";

export const updateState = ref<UpdateResult | null>(null);
export const applying = ref(false);
/** True after a one-click update: the running bundle is stale until the page reloads. */
export const pendingReload = ref(false);
export const dismissedVersion = ref<string | null>(safeGet(LS_DISMISSED));

const t = (key: string, named?: Record<string, unknown>) =>
	i18n.global.t(`plugins.duetToolAlign.updates.${key}`, named ?? {});

function safeGet(key: string): string | null {
	try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
	try { localStorage.setItem(key, value); } catch { /* storage disabled */ }
}

/** Installed plugin version, from the object model's plugins map (authoritative). */
function currentVersion(): string {
	const plugins = (useMachineStore().model as { plugins?: Map<string, { version?: string }> }).plugins;
	return plugins?.get(PLUGIN_MANIFEST_ID)?.version ?? "0.0.0";
}

export function updateChecksEnabled(): boolean {
	return safeGet(LS_ENABLED) !== "false";
}
export function setUpdateChecksEnabled(on: boolean): void {
	safeSet(LS_ENABLED, on ? "true" : "false");
	if (!on) clearAnnouncedUpdate(PLUGIN_MANIFEST_ID);
}

/** Mirror the current result into the shared hub so a host's aggregated popup can include us. */
function syncHub(): void {
	const s = updateState.value;
	if (s?.updateAvailable && dismissedVersion.value !== s.latestVersion) {
		announceUpdate(PLUGIN_MANIFEST_ID, i18n.global.t("plugins.duetToolAlign.title"), s);
	} else {
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID);
	}
}

/**
 * Run a check. Throttled to once per {@link CHECK_INTERVAL_MS} unless forced, skipped when disabled.
 * Announces into the hub; with `notify` (and no host present) raises a one-off fallback notification.
 * Never throws.
 */
export async function runUpdateCheck(opts: { force?: boolean; notify?: boolean } = {}): Promise<UpdateResult | null> {
	if (!opts.force) {
		if (!updateChecksEnabled()) return null;
		const last = Number(safeGet(LS_LAST) || 0);
		if (Date.now() - last < CHECK_INTERVAL_MS) {
			syncHub();
			return updateState.value;
		}
	}
	try {
		const result = await checkForUpdate({ owner: OWNER, repo: REPO, currentVersion: currentVersion() });
		updateState.value = result;
		safeSet(LS_LAST, String(Date.now()));
		if (opts.notify && result.updateAvailable && dismissedVersion.value !== result.latestVersion && !isUpdateHostActive()) {
			const message = result.scenario === "dwcUpdate"
				? t("notifyDwc", { version: result.latestVersion, dwc: result.requiredDwc })
				: t("notifyPlugin", { version: result.latestVersion });
			useUiStore().makeNotification(LogLevel.info, t("title"), message);
		}
		syncHub();
		return result;
	} catch {
		return null; // offline / rate-limited / CORS — never throw
	}
}

/** Stop offering the current version (until a newer release); also drops us from the unified popup. */
export function dismissCurrentUpdate(): void {
	const v = updateState.value?.latestVersion;
	if (v) {
		safeSet(LS_DISMISSED, v);
		dismissedVersion.value = v;
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID);
	}
}

/** Download the release ZIP and install it via DWC (hot-reloads the bundle). Falls back to a link. */
export async function applyUpdateNow(): Promise<void> {
	const result = updateState.value;
	const machine = useMachineStore();
	const ui = useUiStore();
	if (!result?.assetUrl || !result.assetName) {
		ui.makeNotification(LogLevel.warning, t("title"), t("applyFailed"));
		return;
	}
	applying.value = true;
	try {
		await applyUpdate({
			assetUrl: result.assetUrl,
			assetName: result.assetName,
			installPlugin: async (filename, blob, start) => {
				await (machine as unknown as {
					installPlugin: (f: string, b: Blob, s: boolean) => Promise<unknown>;
				}).installPlugin(filename, blob, start);
			},
		});
		pendingReload.value = true;
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID);
		ui.makeNotification(LogLevel.success, t("title"), t("installedReload", { version: result.latestVersion }));
	} catch (e) {
		console.warn("[DuetToolAlign] update failed:", e);
		ui.makeNotification(LogLevel.warning, t("title"), t("corsBlocked"));
		window.location.href = result.assetUrl; // manual download fallback
	} finally {
		applying.value = false;
	}
}
