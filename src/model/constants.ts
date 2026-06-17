/**
 * Shared plugin identifiers. Kept in a leaf module so any file can import them without pulling in
 * index.ts (which would create an import cycle).
 */

/** Manifest id (plugin.json `id`) — used for dwcPluginLoaded/Unloaded events and the dwcFiles manifest. */
export const PLUGIN_MANIFEST_ID = "DuetToolAlign";

/** camelCase key for settings persistence and i18n (`plugins.duetToolAlign.*`). */
export const PLUGIN_ID = "duetToolAlign";

/** Stable id the auto-align panel registers under for embedding in flexible layouts. */
export const EMBEDDABLE_ID = "DuetToolAlign.AutoAlign";

/** Route path for the standalone DWC page. */
export const ROUTE_PATH = "/Plugins/DuetToolAlign";
