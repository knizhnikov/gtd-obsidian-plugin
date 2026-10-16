import { Modal, Notice, normalizePath, setIcon } from "obsidian";
import type GtdLitePlugin from "./main";
import { Task, buildTaskLine, displayText } from "./tasks";
import { appendLine, ensureFile, removeTask, setTaskDone } from "./vault-ops";

type Step = "choose" | "next" | "waiting" | "project";

interface Choice {
	key: string;
	icon: string;
	label: string;
	hint: string;
	run: () => void | Promise<void>;
}

const DUE_IN_TEXT = /📅\s*\S+/u;

function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();
}

/** Пошаговый разбор входящих по алгоритму GTD */
export class ProcessInboxModal extends Modal {
	private items: Task[] = [];
	private idx = 0;
	private step: Step = "choose";
	private choices: Choice[] = [];

	constructor(private plugin: GtdLitePlugin) {
		super(plugin.app);
	}

	private get settings() {
		return this.plugin.settings;
	}

	private get item(): Task | undefined {
		return this.items[this.idx];
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass("gtd-process-modal");
		await this.plugin.index.rebuild();
		this.items = this.plugin.index.inboxTasks();

		for (const key of ["1", "2", "3", "4", "5", "6", "7", "0"]) {
			this.scope.register([], key, () => {
				if (this.step !== "choose") return true;
				void this.choices.find((c) => c.key === key)?.run();
				return false;
			});
		}
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ---------- рендер ----------

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const item = this.item;
		if (!item) {
			this.setTitle("Входящие пусты");
			contentEl.createEl("p", { text: "Всё разобрано. Отличная работа!" });
			const btn = contentEl.createEl("button", { text: "Закрыть", cls: "mod-cta" });
			btn.onclick = () => this.close();
			return;
		}

		this.setTitle(`Разбор входящих · ${this.idx + 1} из ${this.items.length}`);
		contentEl.createDiv({ cls: "gtd-process-item", text: displayText(item, this.settings) || item.text });

		if (this.step === "choose") this.renderChoose();
		else if (this.step === "next") this.renderNext(item);
		else if (this.step === "waiting") this.renderWaiting(item);
		else this.renderProject(item);
	}

	private renderChoose(): void {
		const item = this.item!;
		this.choices = [
			{ key: "1", icon: "zap", label: "Сделать сейчас", hint: "Займёт меньше 2 минут", run: () => this.act(() => setTaskDone(this.app, item, true)) },
			{ key: "2", icon: "arrow-right-circle", label: "Следующее действие", hint: "Одно конкретное действие", run: () => this.go("next") },
			{ key: "3", icon: "hourglass", label: "Делегировать / ждать", hint: "Жду от кого-то", run: () => this.go("waiting") },
			{ key: "4", icon: "folder-plus", label: "Это проект", hint: "Нужно больше одного шага", run: () => this.go("project") },
			{ key: "5", icon: "cloud", label: "Когда-нибудь", hint: "Не сейчас, но интересно", run: () => this.moveTo(this.settings.actionsPath, "# Действия\n\n", buildTaskLine(item.text, { tag: this.settings.somedayTag })) },
			{ key: "6", icon: "book-open", label: "Справочное", hint: "Действий не требует", run: () => this.moveTo(this.settings.referencePath, "# Справочное\n\n", `- ${item.text}`) },
			{ key: "7", icon: "trash-2", label: "Удалить", hint: "Не нужно", run: () => this.act(() => removeTask(this.app, item)) },
			{ key: "0", icon: "skip-forward", label: "Пропустить", hint: "Решу позже", run: () => this.advance() },
		];

		const groups: [string, Choice[]][] = [
			["Требует действий", this.choices.slice(0, 4)],
			["Не требует действий", this.choices.slice(4, 7)],
			["", this.choices.slice(7)],
		];
		for (const [title, choices] of groups) {
			if (title) this.contentEl.createDiv({ cls: "gtd-process-group", text: title });
			const grid = this.contentEl.createDiv({ cls: "gtd-process-grid" });
			for (const c of choices) {
				const btn = grid.createEl("button", { cls: "gtd-process-choice" });
				setIcon(btn.createSpan({ cls: "gtd-process-choice-icon" }), c.icon);
				const body = btn.createSpan();
				body.createDiv({ cls: "gtd-process-choice-label", text: c.label });
				body.createDiv({ cls: "gtd-process-choice-hint", text: c.hint });
				btn.createSpan({ cls: "gtd-process-key", text: c.key });
				btn.onclick = () => void c.run();
			}
		}
	}

	private renderNext(item: Task): void {
		const form = this.form();
		const text = form.text("Действие", item.text.replace(DUE_IN_TEXT, "").trim(), "Глагол + что сделать: «Позвонить Ивану про договор»");
		const contexts = form.contexts();
		const due = form.date("Срок", item.due);
		const project = form.project();
		form.buttons("Сохранить", async () => {
			const line = buildTaskLine(text.value, { tag: this.settings.nextTag, contexts: contexts(), due: due.value || null });
			await this.moveToProjectOrActions(project.value, line);
		});
	}

	private renderWaiting(item: Task): void {
		const form = this.form();
		const text = form.text("Чего жду", item.text.replace(DUE_IN_TEXT, "").trim());
		const who = form.text("От кого", "", "@Иван");
		const due = form.date("Напомнить / срок", item.due);
		const project = form.project();
		form.buttons("Сохранить", async () => {
			const person = who.value.trim().replace(/\s+/g, "_");
			const contexts = person ? [person.startsWith("@") ? person : "@" + person] : [];
			const line = buildTaskLine(text.value, { tag: this.settings.waitingTag, contexts, due: due.value || null });
			await this.moveToProjectOrActions(project.value, line);
		});
	}

	private renderProject(item: Task): void {
		const form = this.form();
		const name = form.text("Название проекта", item.text.replace(DUE_IN_TEXT, "").trim(), "Желаемый результат: «Сайт запущен»");
		const first = form.text("Первое действие", "", "Что сделать прямо сейчас, чтобы сдвинуть проект?");
		const contexts = form.contexts();
		const due = form.date("Срок первого действия", null);
		form.buttons("Создать проект", async () => {
			const projectName = sanitizeFileName(name.value);
			if (!projectName) throw new Error("Укажите название проекта");
			if (!first.value.trim()) throw new Error("У проекта должно быть первое действие");
			const path = normalizePath(`${this.settings.projectsFolder}/${projectName}.md`);
			const file = await ensureFile(this.app, path, `---\nstatus: active\n---\n# ${projectName}\n\n## Результат\n\n${item.text}\n\n## Действия\n`);
			await appendLine(this.app, file, buildTaskLine(first.value, { tag: this.settings.nextTag, contexts: contexts(), due: due.value || null }));
			await removeTask(this.app, item);
		});
	}

	// ---------- действия ----------

	private go(step: Step): void {
		this.step = step;
		this.render();
	}

	private advance(): void {
		this.idx++;
		this.step = "choose";
		this.render();
	}

	/** Выполняет операцию над текущим пунктом и переходит к следующему */
	private async act(fn: () => Promise<void>): Promise<void> {
		try {
			await fn();
			this.advance();
		} catch (err) {
			console.error(err);
			new Notice(err instanceof Error ? err.message : String(err));
		}
	}

	/** Дописывает строку в файл и удаляет пункт из входящих (сначала запись, потом удаление — без потери данных) */
	private moveTo(path: string, initial: string, line: string): Promise<void> {
		const item = this.item!;
		return this.act(async () => {
			const file = await ensureFile(this.app, path, initial);
			await appendLine(this.app, file, line);
			await removeTask(this.app, item);
		});
	}

	private async moveToProjectOrActions(projectPath: string, line: string): Promise<void> {
		const item = this.item!;
		const project = this.plugin.index.projects.find((p) => p.file.path === projectPath);
		const file = project ? project.file : await ensureFile(this.app, this.settings.actionsPath, "# Действия\n\n");
		await appendLine(this.app, file, line);
		await removeTask(this.app, item);
	}

	// ---------- поля формы ----------

	private form() {
		const el = this.contentEl.createDiv({ cls: "gtd-form" });
		const field = (label: string) => {
			const row = el.createDiv({ cls: "gtd-form-row" });
			row.createDiv({ cls: "gtd-form-label", text: label });
			return row;
		};
		let submit: () => void = () => {};
		let focused = false;

		return {
			text: (label: string, value: string, placeholder = "") => {
				const input = field(label).createEl("input", { type: "text", value, attr: { placeholder } });
				input.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.isComposing) {
						e.preventDefault();
						submit();
					}
				});
				if (!focused) {
					focused = true;
					window.setTimeout(() => input.focus(), 0);
				}
				return input;
			},
			date: (label: string, value: string | null) => field(label).createEl("input", { type: "date", value: value ?? "" }),
			contexts: () => {
				const selected = new Set<string>();
				const row = field("Контекст").createDiv({ cls: "gtd-chips" });
				for (const ctx of this.settings.contexts) {
					const chip = row.createEl("button", { cls: "gtd-chip", text: ctx });
					chip.onclick = () => {
						if (selected.has(ctx)) selected.delete(ctx);
						else selected.add(ctx);
						chip.toggleClass("is-active", selected.has(ctx));
					};
				}
				return () => [...selected];
			},
			project: () => {
				const select = field("Проект").createEl("select", { cls: "dropdown" });
				select.createEl("option", { value: "", text: "— без проекта —" });
				for (const p of this.plugin.index.projects) {
					select.createEl("option", { value: p.file.path, text: p.name });
				}
				return select;
			},
			buttons: (label: string, onSave: () => Promise<void>) => {
				const row = el.createDiv({ cls: "gtd-form-buttons" });
				row.createEl("button", { text: "Назад" }).onclick = () => this.go("choose");
				submit = () => void this.act(onSave);
				row.createEl("button", { text: label, cls: "mod-cta" }).onclick = submit;
			},
		};
	}
}
