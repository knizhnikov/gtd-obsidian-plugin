import { Plugin } from "obsidian";
import { CaptureModal } from "./capture";
import { ProcessInboxModal } from "./process-modal";
import { DEFAULT_SETTINGS, GtdSettings, GtdSettingTab } from "./settings";
import { TaskIndex } from "./task-index";
import { GtdView, VIEW_TYPE_GTD } from "./view";

export default class GtdLitePlugin extends Plugin {
	settings: GtdSettings;
	index: TaskIndex;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.index = new TaskIndex(this.app, () => this.settings);
		this.index.attach((ref) => this.registerEvent(ref));
		this.app.workspace.onLayoutReady(() => this.index.rebuild());

		this.registerView(VIEW_TYPE_GTD, (leaf) => new GtdView(leaf, this));

		this.addCommand({
			id: "capture",
			name: "Захватить во входящие",
			callback: () => this.openCapture(),
		});
		this.addCommand({
			id: "process-inbox",
			name: "Разобрать входящие",
			callback: () => new ProcessInboxModal(this).open(),
		});
		this.addCommand({
			id: "open-view",
			name: "Открыть панель GTD",
			callback: () => this.activateView(),
		});

		this.addRibbonIcon("inbox", "GTD: захватить во входящие", () => this.openCapture());
		this.addRibbonIcon("list-checks", "GTD: открыть панель", () => this.activateView());

		this.addSettingTab(new GtdSettingTab(this.app, this));
	}

	openCapture(): void {
		new CaptureModal(this.app, this.settings.inboxPath).open();
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_GTD)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false)!;
			await leaf.setViewState({ type: VIEW_TYPE_GTD, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.index.invalidate();
	}
}
