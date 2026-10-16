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
}

export const DEFAULT_SETTINGS: GtdSettings = {
	inboxPath: "GTD/Inbox.md",
	actionsPath: "GTD/Actions.md",
	referencePath: "GTD/Reference.md",
	projectsFolder: "GTD/Projects",
	nextTag: "#next",
	waitingTag: "#waiting",
	somedayTag: "#someday",
	contexts: ["@office", "@home", "@phone", "@computer", "@errands"],
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

		text("Файл входящих", "Сюда попадает всё, что захвачено.", "inboxPath");
		text("Файл действий", "Действия, ожидания и «когда-нибудь» вне проектов.", "actionsPath");
		text("Файл справочного", "Справочные материалы из входящих.", "referencePath");
		text("Папка проектов", "Каждая заметка в этой папке — проект.", "projectsFolder");
		text("Тег следующего действия", "", "nextTag");
		text("Тег ожидания", "", "waitingTag");
		text("Тег «когда-нибудь»", "", "somedayTag");

		new Setting(containerEl)
			.setName("Контексты")
			.setDesc("Через запятую, например: @office, @home, @phone")
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
