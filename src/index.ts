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
import { clearAnnouncedUpdate, installErrorCapture, registerWidgetConfig, unregisterWidgetConfig } from "dwc-plugin-runtime";

import AutoAlignPage from "./AutoAlignPage.vue";
import AutoAlignWidget from "./widgets/AutoAlignWidget.vue";
import { EMBEDDABLE_ID, PLUGIN_ID, PLUGIN_MANIFEST_ID, ROUTE_PATH } from "./model/constants";
import { autoAlignSchema } from "./model/schema";
import { runUpdateCheck } from "./model/updateCheck";
import en from "./i18n/en.json";

registerPluginMessages(PLUGIN_ID, { en });

// registerRoute is idempotent by path in DWC 3.7 (b9b93bb+) — a repeated registration is a no-op,
// so a plugin reload no longer stacks a duplicate "Tool Align" drawer entry.
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

// Publish the widget's config schema so a host (Flexible Layouts) can render a per-instance editor
// and pass config to the embedded widget. See dwc-plugin-runtime's widget-config framework.
registerWidgetConfig({ schema: autoAlignSchema });

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
		unregisterWidgetConfig(EMBEDDABLE_ID);
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID); // drop us from the unified popup
		uninstallErrorCapture();
		Events.off("dwcPluginUnloaded", onPluginUnloaded);
	}
}
Events.on("dwcPluginUnloaded", onPluginUnloaded);
