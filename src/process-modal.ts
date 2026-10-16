import { Modal, Notice, TFile, moment, normalizePath, setIcon } from "obsidian";
import type GtdLitePlugin from "./main";
import { Task, buildTaskLine, displayText, normalizeContext } from "./tasks";
import { appendLine, createProject, ensureFile, removeTask, sanitizeFileName, setTaskDone } from "./vault-ops";

type Step = "choose" | "next" | "waiting" | "project";

interface Choice {
	key: string;
	icon: string;
	label: string;
	hint: string;
	run: () => void | Promise<void>;
}

const DUE_IN_TEXT = /📅\s*\S+/u;

const CONTEXT_HINT =
	"Зона внимания — сфера жизни или работы, к которой относится действие: @работа, @дом, @семья, @здоровье, @финансы. " +
	"Потом выбираешь зону, в которой сейчас держишь фокус, и видишь только её дела.";
const PROJECT_HINT =
	"Проект — результат, для которого нужно больше одного шага: «Сайт запущен», «Отпуск спланирован». " +
	"Привяжи действие к проекту, чтобы видеть, движется ли он.";



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
			this.hint(
				"Теперь работай по списку «Следующие действия»: выбери зону внимания, в которой сейчас твой фокус, и бери задачу. " +
					"Раз в неделю проводи обзор: проверь проекты, ожидания и «когда-нибудь»."
			);
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

	private hint(text: string): void {
		if (this.settings.showHints) this.contentEl.createDiv({ cls: "gtd-hint", text });
	}

	private renderChoose(): void {
		const item = this.item!;
		this.contentEl.createDiv({ cls: "gtd-process-question", text: "Что это? Нужно ли что-то с этим делать?" });
		this.hint(
			"Разбирай по порядку, сверху вниз, и ничего не возвращай во входящие. " +
				"Если действие займёт меньше 2 минут — сделай его прямо сейчас: записывать и отслеживать дольше."
		);
		this.choices = [
			{ key: "1", icon: "zap", label: "Сделать сейчас", hint: "Меньше 2 минут — сделай и отметь", run: () => this.act(() => setTaskDone(this.app, item, true)) },
			{ key: "2", icon: "arrow-right-circle", label: "Описать следующее действие", hint: "Один конкретный шаг", run: () => this.go("next") },
			{ key: "3", icon: "hourglass", label: "Делегировать / ждать", hint: "Сделает другой человек", run: () => this.go("waiting") },
			{ key: "4", icon: "folder-plus", label: "Это проект", hint: "Нужно больше одного шага", run: () => this.go("project") },
			{ key: "5", icon: "cloud", label: "Когда-нибудь", hint: "Не сейчас, вернусь на обзоре", run: () => this.moveTo(this.settings.actionsPath, "# Действия\n\n", buildTaskLine(item.text, { tag: this.settings.somedayTag })) },
			{ key: "6", icon: "book-open", label: "Справочное", hint: "Пригодится, но делать нечего", run: () => this.moveTo(this.settings.referencePath, "# Справочное\n\n", `- ${item.text}`) },
			{ key: "7", icon: "trash-2", label: "Удалить", hint: "Уже неактуально", run: () => this.act(() => removeTask(this.app, item)) },
			{ key: "0", icon: "skip-forward", label: "Пропустить", hint: "Решу позже", run: () => this.advance() },
		];

		const groups: [string, Choice[]][] = [
			["Требует действий", this.choices.slice(0, 4)],
			["Не требует действий", this.choices.slice(4, 7)],
		];
		for (const [title, choices] of groups) {
			this.contentEl.createDiv({ cls: "gtd-process-group", text: title });
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

		// «Пропустить» — не решение, а отсрочка: отдельно и неярко
		const skip = this.choices[7];
		const footer = this.contentEl.createDiv({ cls: "gtd-process-footer" });
		const skipBtn = footer.createEl("button", { cls: "gtd-process-skip" });
		setIcon(skipBtn.createSpan({ cls: "gtd-process-choice-icon" }), skip.icon);
		skipBtn.createSpan({ text: `${skip.label} — ${skip.hint.toLowerCase()}` });
		skipBtn.createSpan({ cls: "gtd-process-key", text: skip.key });
		skipBtn.onclick = () => void skip.run();
	}

	private renderNext(item: Task): void {
		this.hint(
			"Следующее действие — конкретный видимый шаг, который можно сделать без раздумий. " +
				"Начни с глагола: не «отчёт», а «набросать план отчёта». Срок ставь, только если после этой даты будет поздно."
		);
		const form = this.form();
		const text = form.text("Действие", item.text.replace(DUE_IN_TEXT, "").trim(), "Глагол + что сделать: «Позвонить Ивану про договор»");
		const contexts = form.contexts();
		const due = form.date("Срок", item.due);
		const project = form.project();
		form.buttons("Сохранить", async () => {
			const line = buildTaskLine(text.value, { tag: this.settings.nextTag, contexts: contexts(), due: due.value || null });
			await this.moveToProjectOrActions(await project(), line);
		});
	}

	private renderWaiting(item: Task): void {
		this.hint(
			"Ты поручил это или ждёшь от кого-то. Запиши, от кого, и дату, когда напомнить, — " +
				"список «Ожидание» просматривай на еженедельном обзоре."
		);
		const form = this.form();
		const text = form.text("Чего жду", item.text.replace(DUE_IN_TEXT, "").trim());
		const who = form.text("От кого", "", "@Иван");
		const due = form.date("Напомнить / срок", item.due);
		const project = form.project();
		form.buttons("Сохранить", async () => {
			const person = who.value.trim().replace(/\s+/g, "_");
			const contexts = person ? [person.startsWith("@") ? person : "@" + person] : [];
			const line = buildTaskLine(text.value, { tag: this.settings.waitingTag, contexts, due: due.value || null });
			await this.moveToProjectOrActions(await project(), line);
		});
	}

	private renderProject(item: Task): void {
		this.hint(
			"Проект — любой результат, для которого нужно больше одного шага. Сформулируй его как уже достигнутый: «Сайт запущен». " +
				"Сразу определи первое действие — без него проект застрянет."
		);
		const form = this.form();
		const name = form.text("Название проекта", item.text.replace(DUE_IN_TEXT, "").trim(), "Желаемый результат: «Сайт запущен»");
		const first = form.text("Первое действие", "", "Что сделать прямо сейчас, чтобы сдвинуть проект?");
		const contexts = form.contexts();
		const due = form.date("Срок первого действия", null);
		form.buttons("Создать проект", async () => {
			if (!first.value.trim()) throw new Error("У проекта должно быть первое действие");
			const file = await createProject(this.app, this.settings.projectsFolder, name.value, item.text);
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

	private async moveToProjectOrActions(project: TFile | null, line: string): Promise<void> {
		const item = this.item!;
		const file = project ?? (await ensureFile(this.app, this.settings.actionsPath, "# Действия\n\n"));
		await appendLine(this.app, file, line);
		await removeTask(this.app, item);
	}

	// ---------- поля формы ----------

	private form() {
		const el = this.contentEl.createDiv({ cls: "gtd-form" });
		const field = (label: string, desc?: string) => {
			const row = el.createDiv({ cls: "gtd-form-row" });
			row.createDiv({ cls: "gtd-form-label", text: label });
			if (desc && this.settings.showHints) row.createDiv({ cls: "gtd-form-desc", text: desc });
			return row;
		};
		/** Поле ввода, где Enter не отправляет форму, а выполняет своё действие */
		const inlineInput = (parent: HTMLElement, value: string, placeholder: string, onEnter: () => void) => {
			const input = parent.createEl("input", { type: "text", value, attr: { placeholder } });
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					e.stopPropagation();
					onEnter();
				}
			});
			return input;
		};
		const iconButton = (parent: HTMLElement, icon: string, label: string, onClick: () => void) => {
			const btn = parent.createEl("button", { cls: "gtd-icon-btn clickable-icon", attr: { "aria-label": label } });
			setIcon(btn, icon);
			btn.onclick = (e) => {
				e.preventDefault();
				onClick();
			};
			return btn;
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
			/** Поле даты с быстрыми кнопками: сегодня, завтра, следующий понедельник */
			date: (label: string, value: string | null) => {
				const row = field(label).createDiv({ cls: "gtd-date-row" });
				const input = row.createEl("input", { type: "date", value: value ?? "" });
				const presets: [string, string][] = [
					["Сегодня", moment().format("YYYY-MM-DD")],
					["Завтра", moment().add(1, "day").format("YYYY-MM-DD")],
					["На следующей неделе", moment().add(1, "week").startOf("isoWeek").format("YYYY-MM-DD")],
				];
				const buttons = presets.map(([text, date]) => {
					const btn = row.createEl("button", { cls: "gtd-chip", text, attr: { "aria-label": moment(date).format("dd, D MMM") } });
					btn.onclick = (e) => {
						e.preventDefault();
						input.value = input.value === date ? "" : date;
						sync();
					};
					return { btn, date };
				});
				const sync = () => buttons.forEach(({ btn, date }) => btn.toggleClass("is-active", input.value === date));
				input.addEventListener("change", sync);
				sync();
				return input;
			},

			/** Чипы зон внимания с добавлением и редактированием списка. Возвращает функцию получения выбранных. */
			contexts: () => {
				let selected: string[] = [];
				const box = field("Зона внимания", CONTEXT_HINT).createDiv();

				const saveContexts = async (list: string[]) => {
					this.settings.contexts = list;
					await this.plugin.saveSettings();
				};

				const renderChips = () => {
					box.empty();
					const chips = box.createDiv({ cls: "gtd-chips" });
					for (const ctx of this.settings.contexts) {
						const chip = chips.createEl("button", { cls: "gtd-chip", text: ctx });
						chip.toggleClass("is-active", selected.includes(ctx));
						chip.onclick = (e) => {
							e.preventDefault();
							selected = selected.includes(ctx) ? selected.filter((c) => c !== ctx) : [...selected, ctx];
							chip.toggleClass("is-active", selected.includes(ctx));
						};
					}
					const add = chips.createEl("button", { cls: "gtd-chip gtd-chip-add", text: "＋", attr: { "aria-label": "Новая зона" } });
					add.onclick = (e) => {
						e.preventDefault();
						add.remove();
						const input = inlineInput(chips, "", "@новый", async () => {
							const ctx = normalizeContext(input.value);
							if (ctx && !this.settings.contexts.includes(ctx)) await saveContexts([...this.settings.contexts, ctx]);
							if (ctx && !selected.includes(ctx)) selected.push(ctx);
							renderChips();
						});
						input.addClass("gtd-chip-input");
						// Клик мимо поля — отмена; если поле уже убрано (Enter или редактор), ничего не делаем
						input.addEventListener("blur", () => window.setTimeout(() => input.isConnected && renderChips(), 150));
						input.focus();
					};
					iconButton(chips, "pencil", "Редактировать зоны", renderEditor);
				};

				const renderEditor = () => {
					box.empty();
					const editor = box.createDiv({ cls: "gtd-list-editor" });
					const rows: { original: string; input: HTMLInputElement }[] = [];
					const addRow = (value: string) => {
						const row = editor.createDiv({ cls: "gtd-list-editor-row" });
						const input = inlineInput(row, value, "@зона", () => done());
						const entry = { original: value, input };
						rows.push(entry);
						iconButton(row, "x", "Удалить", () => {
							row.remove();
							rows.splice(rows.indexOf(entry), 1);
						});
						return input;
					};
					this.settings.contexts.forEach(addRow);

					const footer = box.createDiv({ cls: "gtd-list-editor-footer" });
					footer.createEl("button", { text: "＋ Добавить" }).onclick = (e) => {
						e.preventDefault();
						addRow("").focus();
					};
					const done = async () => {
						const list: string[] = [];
						const renamed = new Map<string, string>();
						for (const { original, input } of rows) {
							const ctx = normalizeContext(input.value);
							if (!ctx || list.includes(ctx)) continue;
							list.push(ctx);
							if (original) renamed.set(original, ctx);
						}
						selected = selected.map((c) => renamed.get(c) ?? c).filter((c) => list.includes(c));
						await saveContexts(list);
						renderChips();
					};
					footer.createEl("button", { text: "Готово", cls: "mod-cta" }).onclick = (e) => {
						e.preventDefault();
						void done();
					};
					if (this.settings.showHints) {
						box.createDiv({ cls: "gtd-form-desc", text: "Меняется только список для выбора — уже записанные задачи не изменятся." });
					}
				};

				renderChips();
				return () => [...selected];
			},

			/** Выбор проекта с созданием и переименованием. Возвращает функцию, отдающую файл проекта (или null). */
			project: () => {
				const NEW = "__new__";
				const files = new Map<string, TFile>();
				const row = field("Проект", PROJECT_HINT);
				const picker = row.createDiv({ cls: "gtd-project-picker" });
				const select = picker.createEl("select", { cls: "dropdown" });
				select.createEl("option", { value: "", text: "— без проекта —" });
				this.plugin.index.projects.forEach((p, i) => {
					files.set(String(i), p.file);
					select.createEl("option", { value: String(i), text: p.name });
				});
				select.createEl("option", { value: NEW, text: "＋ Новый проект…" });

				const extra = row.createDiv({ cls: "gtd-project-extra" });
				let newName: HTMLInputElement | null = null;

				const renameBtn = iconButton(picker, "pencil", "Переименовать проект", () => {
					const file = files.get(select.value);
					if (!file) return;
					extra.empty();
					const input = inlineInput(extra, file.basename, "Новое название", () => void apply());
					input.focus();
					input.select();
					const apply = async () => {
						const name = sanitizeFileName(input.value);
						if (!name || name === file.basename) return extra.empty();
						const path = normalizePath(`${file.parent?.path ?? this.settings.projectsFolder}/${name}.md`);
						if (this.app.vault.getAbstractFileByPath(path)) {
							new Notice("Проект с таким названием уже есть");
							return;
						}
						await this.app.fileManager.renameFile(file, path);
						select.selectedOptions[0].text = file.basename;
						extra.empty();
					};
					extra.createEl("button", { text: "Переименовать", cls: "mod-cta" }).onclick = (e) => {
						e.preventDefault();
						void apply();
					};
				});

				const update = () => {
					extra.empty();
					newName = null;
					renameBtn.toggle(files.has(select.value));
					if (select.value === NEW) {
						newName = inlineInput(extra, "", "Желаемый результат: «Сайт запущен»", () => submit());
						newName.focus();
					}
				};
				select.onchange = update;
				update();

				return async (): Promise<TFile | null> => {
					if (select.value === NEW) return createProject(this.app, this.settings.projectsFolder, newName?.value ?? "", "");
					return files.get(select.value) ?? null;
				};
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
