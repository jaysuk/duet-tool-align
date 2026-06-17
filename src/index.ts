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

import AutoAlignPage from "./AutoAlignPage.vue";
import AutoAlignWidget from "./widgets/AutoAlignWidget.vue";
import { EMBEDDABLE_ID, PLUGIN_ID, PLUGIN_MANIFEST_ID, ROUTE_PATH } from "./model/constants";
import en from "./i18n/en.json";

registerPluginMessages(PLUGIN_ID, { en });

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

function onPluginUnloaded(id: string): void {
	if (id === PLUGIN_MANIFEST_ID) {
		unregisterRoute(ROUTE_PATH);
		unregisterEmbeddableComponent(EMBEDDABLE_ID);
		uninstallErrorCapture();
		Events.off("dwcPluginUnloaded", onPluginUnloaded);
	}
}
Events.on("dwcPluginUnloaded", onPluginUnloaded);
