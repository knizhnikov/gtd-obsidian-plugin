import { App, Modal, Notice, Platform } from "obsidian";
import { appendLine, ensureFile } from "./vault-ops";

export async function appendToInbox(app: App, inboxPath: string, text: string): Promise<void> {
	const file = await ensureFile(app, inboxPath, "# Входящие\n\n");
	await appendLine(app, file, `- [ ] ${text}`);
}

export class CaptureModal extends Modal {
	private added = 0;

	constructor(app: App, private inboxPath: string, private showHints: boolean) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("gtd-capture-modal");
		this.setTitle("Добавить во входящие");

		const input = contentEl.createEl("input", {
			type: "text",
			cls: "gtd-capture-input",
			attr: { placeholder: "Что у тебя в голове?" },
		});
		input.focus();

		const mod = Platform.isMacOS ? "Cmd" : "Ctrl";
		const keys = contentEl.createDiv({ cls: "gtd-capture-keys" });
		keys.createSpan({ text: "Enter — сохранить и закрыть · " });
		keys.createSpan({ text: `${mod}+Enter — сохранить и записать ещё` });
		const counter = contentEl.createDiv({ cls: "gtd-capture-counter" });

		if (this.showHints) {
			const hint = contentEl.createDiv({ cls: "gtd-hint" });
			hint.createEl("p", {
				text: "Записывай всё, что крутится в голове и требует внимания. Сейчас не нужно думать, что это и куда это отнести, — просто выгрузи.",
			});
			const ul = hint.createEl("ul");
			for (const example of [
				"задачи — «позвонить Ивану», «купить корм коту»",
				"проекты и большие цели — «переезд», «запустить сайт»",
				"обещания другим — «скинуть Маше презентацию»",
				"идеи и «надо бы…» — «выучить испанский»",
				"то, что тревожит — «непонятно с отпуском»",
			]) {
				ul.createEl("li", { text: example });
			}
			hint.createEl("p", {
				text: "Формулировки неважны. Важно потом разобрать входящие: там решишь, что это и какое первое действие.",
			});
		}

		input.addEventListener("keydown", async (e) => {
			if (e.key !== "Enter" || e.isComposing) return;
			e.preventDefault();
			const text = input.value.trim();
			if (!text) return;
			const keepOpen = e.metaKey || e.ctrlKey;
			try {
				await appendToInbox(this.app, this.inboxPath, text);
				this.added++;
				if (keepOpen) {
					input.value = "";
					counter.setText(`Добавлено: ${this.added}. Что ещё?`);
				} else {
					this.close();
				}
			} catch (err) {
				console.error(err);
				new Notice(`Не удалось сохранить: ${err}`);
			}
		});
	}

	onClose(): void {
		if (this.added) {
			new Notice(`Во входящих +${this.added}. Не забудь разобрать!`);
		}
		this.contentEl.empty();
	}
}
