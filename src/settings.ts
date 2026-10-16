import { App, PluginSettingTab, Setting } from "obsidian";
import type GtdLitePlugin from "./main";

export interface GtdSettings {
	inboxPath: string;
	actionsPath: string;
	referencePath: string;
	projectsFolder: string;
	nextTag: string;
	waitingTag: string;
	somedayTag: string;
	contexts: string[];
	showHints: boolean;
	onboarded: boolean;
}

export const DEFAULT_SETTINGS: GtdSettings = {
	inboxPath: "GTD/Inbox.md",
	actionsPath: "GTD/Actions.md",
	referencePath: "GTD/Reference.md",
	projectsFolder: "GTD/Projects",
	nextTag: "#next",
	waitingTag: "#waiting",
	somedayTag: "#someday",
	contexts: ["@работа", "@дом", "@семья", "@здоровье", "@финансы"],
	showHints: true,
	onboarded: false,
};

type TextKey = "inboxPath" | "actionsPath" | "referencePath" | "projectsFolder" | "nextTag" | "waitingTag" | "somedayTag";

export class GtdSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: GtdLitePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const text = (name: string, desc: string, key: TextKey) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t
						.setPlaceholder(DEFAULT_SETTINGS[key])
						.setValue(this.plugin.settings[key])
						.onChange(async (value) => {
							this.plugin.settings[key] = value.trim() || DEFAULT_SETTINGS[key];
							await this.plugin.saveSettings();
						})
				);

		new Setting(containerEl)
			.setName("Показывать подсказки")
			.setDesc("Пояснения по методологии GTD в окнах и панели. Выключите, когда освоитесь.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showHints).onChange(async (value) => {
					this.plugin.settings.showHints = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Знакомство и настройка")
			.setDesc("Пошаговый рассказ о GTD и первичная настройка: захват, зоны внимания, проекты.")
			.addButton((b) => b.setButtonText("Запустить").onClick(() => this.plugin.openOnboarding()));

		text("Файл входящих", "Сюда попадает всё, что захвачено.", "inboxPath");
		text("Файл действий", "Действия, ожидания и «когда-нибудь» вне проектов.", "actionsPath");
		text("Файл справочного", "Справочные материалы из входящих.", "referencePath");
		text("Папка проектов", "Каждая заметка в этой папке — проект.", "projectsFolder");
		text("Тег следующего действия", "", "nextTag");
		text("Тег ожидания", "", "waitingTag");
		text("Тег «когда-нибудь»", "", "somedayTag");

		new Setting(containerEl)
			.setName("Зоны внимания")
			.setDesc("Сферы, к которым относятся действия. Через запятую, например: @работа, @дом, @здоровье")
			.addTextArea((t) =>
				t.setValue(this.plugin.settings.contexts.join(", ")).onChange(async (value) => {
					this.plugin.settings.contexts = value
						.split(",")
						.map((c) => c.trim())
						.filter(Boolean)
						.map((c) => (c.startsWith("@") ? c : "@" + c));
					await this.plugin.saveSettings();
				})
			);
	}
}
