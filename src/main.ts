import { Notice, Plugin } from "obsidian";
import { CaptureModal, appendToInbox } from "./capture";
import { OnboardingModal, hasGtdData } from "./onboarding";
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
		this.app.workspace.onLayoutReady(async () => {
			await this.index.rebuild();
			await this.maybeOnboard();
		});

		this.registerView(VIEW_TYPE_GTD, (leaf) => new GtdView(leaf, this));

		this.addCommand({
			id: "capture",
			name: "Захватить во входящие",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "A" }],
			callback: () => this.openCapture(),
		});
		this.addCommand({
			id: "process-inbox",
			name: "Разобрать входящие",
			callback: () => new ProcessInboxModal(this).open(),
		});
		this.addCommand({
			id: "onboarding",
			name: "Знакомство и настройка",
			callback: () => this.openOnboarding(),
		});
		this.addCommand({
			id: "open-view",
			name: "Открыть панель GTD",
			callback: () => this.activateView(),
		});

		// obsidian://gtd-capture — открыть окно захвата; ?text=... — сразу сохранить во входящие.
		// Работает и когда Obsidian закрыт: ссылка запускает его. Удобно вешать на глобальную клавишу.
		this.registerObsidianProtocolHandler("gtd-capture", async (params) => {
			const text = params.text?.trim();
			if (!text) return this.openCapture();
			try {
				await appendToInbox(this.app, this.settings.inboxPath, text);
				new Notice(`Во входящих: ${text}`);
			} catch (err) {
				new Notice(`Не удалось сохранить: ${err}`);
			}
		});

		this.addRibbonIcon("inbox", "GTD: захватить во входящие", () => this.openCapture());
		this.addRibbonIcon("list-checks", "GTD: открыть панель", () => this.activateView());

		this.addSettingTab(new GtdSettingTab(this.app, this));
	}

	/** Ссылка для захвата извне (глобальная клавиша, Быстрые команды, Raycast) */
	captureUri(withText = false): string {
		const vault = encodeURIComponent(this.app.vault.getName());
		return `obsidian://gtd-capture?vault=${vault}${withText ? "&text=" : ""}`;
	}

	openOnboarding(): void {
		new OnboardingModal(this).open();
	}

	/** Первый запуск: новичку — знакомство, тому, у кого данные уже есть, — просто отметка */
	private async maybeOnboard(): Promise<void> {
		if (this.settings.onboarded) return;
		if (hasGtdData(this)) {
			this.settings.onboarded = true;
			await this.saveSettings();
			return;
		}
		this.openOnboarding();
	}

	openCapture(): void {
		new CaptureModal(this.app, this.settings.inboxPath, this.settings.showHints).open();
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
