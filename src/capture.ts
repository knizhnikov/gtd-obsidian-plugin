import { App, Modal, Notice } from "obsidian";
import { appendLine, ensureFile } from "./vault-ops";

export async function appendToInbox(app: App, inboxPath: string, text: string): Promise<void> {
	const file = await ensureFile(app, inboxPath, "# Входящие\n\n");
	await appendLine(app, file, `- [ ] ${text}`);
}

export class CaptureModal extends Modal {
	constructor(app: App, private inboxPath: string) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle("Захват во входящие");

		const input = contentEl.createEl("input", {
			type: "text",
			cls: "gtd-capture-input",
			attr: { placeholder: "Что у вас на уме? Enter — сохранить" },
		});
		input.focus();

		input.addEventListener("keydown", async (e) => {
			if (e.key !== "Enter" || e.isComposing) return;
			e.preventDefault();
			const text = input.value.trim();
			if (!text) return;
			try {
				await appendToInbox(this.app, this.inboxPath, text);
				new Notice("Добавлено во входящие");
				this.close();
			} catch (err) {
				console.error(err);
				new Notice(`Не удалось сохранить: ${err}`);
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
