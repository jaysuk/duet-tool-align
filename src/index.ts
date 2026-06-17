/**
 * Duet Tool Align — entry point.
 *
 * Registers a standalone DWC page (under Plugins) and an embeddable component so the same panel can
 * be dropped into a Flexible-Layouts grid (FL surfaces `uiStore.embeddableComponents` in its widget
 * palette). Both render the one AutoAlignWidget; the widget self-sources its config from DWC settings
 * when no `widget` prop is passed (which is how FL renders embeddables), so it works either way.
 *
 * App-lifetime resources (the error-capture buffer) are torn down on the plugin's `dwcPluginUnloaded`
 * event so nothing leaks when the plugin is stopped.
 */
import { registerEmbeddableComponent, registerPluginMessages, registerRoute, unregisterEmbeddableComponent, unregisterRoute } from "@/plugins";
import Events from "@/utils/events";
import { installErrorCapture } from "dwc-plugin-runtime";

import { clearAnnouncedUpdate } from "dwc-plugin-runtime";

import AutoAlignPage from "./AutoAlignPage.vue";
import AutoAlignWidget from "./widgets/AutoAlignWidget.vue";
import { EMBEDDABLE_ID, PLUGIN_ID, PLUGIN_MANIFEST_ID, ROUTE_PATH } from "./model/constants";
import { runUpdateCheck } from "./model/updateCheck";
import en from "./i18n/en.json";

registerPluginMessages(PLUGIN_ID, { en });

// registerRoute is NOT idempotent — it pushes a nav item + route every call. If this module is
// evaluated more than once in a session (e.g. installing a new build over a running one without a
// full DWC reload), that yields a duplicate "Tool Align" entry. Clearing any prior registration for
// our path first makes load self-healing. unregisterRoute is a no-op when nothing is registered.
unregisterRoute(ROUTE_PATH);
registerRoute(AutoAlignPage, {
	Plugins: {
		DuetToolAlign: {
			icon: "mdi-image-filter-center-focus",
			caption: "plugins.duetToolAlign.menuCaption",
			path: ROUTE_PATH,
		},
	},
});

registerEmbeddableComponent({
	id: EMBEDDABLE_ID,
	pluginId: PLUGIN_MANIFEST_ID,
	caption: "plugins.duetToolAlign.widget",
	icon: "mdi-image-filter-center-focus",
	description: "plugins.duetToolAlign.embeddableDesc",
	component: AutoAlignWidget,
	defaultSize: { w: 6, h: 14 },
	machineMode: "any",
});

// Buffer uncaught errors/rejections for diagnostics; cleaned up on unload.
const uninstallErrorCapture = installErrorCapture();

// Check GitHub for a newer release shortly after load and announce it into the shared update hub
// (FL's shell, if active, shows it in the unified popup; otherwise we fall back to our own banner +
// notification). Deferred so the connection/object-model has settled enough to read the version.
setTimeout(() => { void runUpdateCheck({ notify: true }); }, 4000);

function onPluginUnloaded(id: string): void {
	if (id === PLUGIN_MANIFEST_ID) {
		unregisterRoute(ROUTE_PATH);
		unregisterEmbeddableComponent(EMBEDDABLE_ID);
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID); // drop us from the unified popup
		uninstallErrorCapture();
		Events.off("dwcPluginUnloaded", onPluginUnloaded);
	}
}
Events.on("dwcPluginUnloaded", onPluginUnloaded);
