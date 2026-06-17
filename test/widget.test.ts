import { beforeEach, describe, expect, it } from "vitest";

import { mountInDwc, resetDwc, sentCodes, setModel } from "dwc-plugin-test-kit";

import AutoAlignWidget from "../src/widgets/AutoAlignWidget.vue";

function modelWithTools() {
	return {
		tools: [
			{ number: 0, name: "T0", offsets: [0, 0, 0] },
			{ number: 1, name: "T1", offsets: [0, 0, 0] },
		],
		state: { currentTool: 0 },
		move: {
			axes: [
				{ letter: "X", homed: true, machinePosition: 100 },
				{ letter: "Y", homed: true, machinePosition: 50 },
				{ letter: "Z", homed: true, machinePosition: 10 },
			],
		},
		plugins: {},
	};
}

describe("AutoAlignWidget", () => {
	beforeEach(() => resetDwc());

	it("mounts without throwing (disconnected, empty model)", () => {
		const wrapper = mountInDwc(AutoAlignWidget);
		expect(wrapper.exists()).toBe(true);
	});

	it("renders a button per tool and sends T<n> on click", async () => {
		setModel(modelWithTools());
		const wrapper = mountInDwc(AutoAlignWidget);
		await wrapper.vm.$nextTick();

		const t1 = wrapper.findAll("button").find((b) => b.text().includes("T1"));
		expect(t1).toBeTruthy();
		await t1!.trigger("click");

		expect(sentCodes()).toContain("T1");
	});

	it("shows the no-URL hint when no bridge is configured", () => {
		const wrapper = mountInDwc(AutoAlignWidget);
		// The i18n stub returns the key; assert the key is present in the rendered hint.
		expect(wrapper.text()).toContain("duetToolAlign.noUrl");
	});
});
