import { ItemView, Notice, Platform, TFile, WorkspaceLeaf, moment, setIcon } from "obsidian";
import type GtdLitePlugin from "./main";
import { ProcessInboxModal } from "./process-modal";
import { Task, displayText, today } from "./tasks";
import { setTaskDone } from "./vault-ops";

export const VIEW_TYPE_GTD = "gtd-lite-view";

const NO_CONTEXT = "Без зоны";
const DONE_PAGE = 30;

/** Русское склонение: 1 задачу, 2 задачи, 5 задач */
function plural(n: number, one: string, few: string, many: string): string {
	const m10 = n % 10;
	const m100 = n % 100;
	if (m10 === 1 && m100 !== 11) return one;
	if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
	return many;
}

/** «Сегодня», «Вчера» или «16 окт 2026» */
function formatDate(date: string): string {
	const d = moment(date, "YYYY-MM-DD");
	if (date === today()) return "Сегодня";
	if (date === moment().subtract(1, "day").format("YYYY-MM-DD")) return "Вчера";
	return d.locale("ru").format("D MMM YYYY");
}

function byDue(a: Task, b: Task): number {
	if (a.due && b.due) return a.due.localeCompare(b.due);
	if (a.due) return -1;
	if (b.due) return 1;
	return 0;
}

/** Боковая панель: входящие, сроки, действия по зонам внимания, ожидания, когда-нибудь, проекты */
export class GtdView extends ItemView {
	/** Свёрнутые секции переживают перерисовку */
	private collapsed = new Set<string>(["someday", "done", "help"]);
	/** Сколько завершённых задач показывать */
	private doneLimit = DONE_PAGE;

	constructor(leaf: WorkspaceLeaf, private plugin: GtdLitePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_GTD;
	}

	getDisplayText(): string {
		return "GTD";
	}

	getIcon(): string {
		return "list-checks";
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.plugin.index.on("changed", () => this.render()));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass("gtd-view");

		const settings = this.plugin.settings;
		const open = this.plugin.index.tasks.filter((t) => !t.completed);
		const now = today();

		// Главные действия: добавить → разобрать
		const inboxCount = this.plugin.index.inboxTasks().length;
		const actions = el.createDiv({ cls: "gtd-actions" });
		const capture = this.bigButton(actions, "plus", "Добавить во входящие", "gtd-big-btn mod-capture", () => this.plugin.openCapture());
		capture.setAttr("aria-label", `Горячая клавиша: ${Platform.isMacOS ? "Cmd" : "Ctrl"}+Shift+A`);
		if (inboxCount) {
			this.bigButton(actions, "inbox", `Разобрать ${inboxCount} ${plural(inboxCount, "задачу", "задачи", "задач")}`, "gtd-big-btn mod-process", () =>
				new ProcessInboxModal(this.plugin).open()
			);
		} else {
			const empty = actions.createDiv({ cls: "gtd-inbox-empty" });
			setIcon(empty.createSpan(), "check-circle-2");
			empty.createSpan({ text: "Входящие пусты" });
		}

		// Сроки
		const dated = open.filter((t) => t.due && t.due <= now && (t.status === "next" || t.status === "waiting")).sort(byDue);
		if (dated.length) {
			this.section(el, "due", "Сегодня и просрочено", dated.length, "Жёсткие сроки. Это делается в первую очередь.", (body) => dated.forEach((t) => this.taskRow(body, t)));
		}

		// Следующие действия по зонам внимания
		const next = open.filter((t) => t.status === "next");
		this.section(el, "next", "Следующие действия", next.length, "Выбери зону, в которой сейчас твой фокус, и бери следующее действие оттуда.", (body) => {
			const groups = new Map<string, Task[]>();
			for (const t of next) {
				for (const ctx of t.contexts.length ? t.contexts : [NO_CONTEXT]) {
					if (!groups.has(ctx)) groups.set(ctx, []);
					groups.get(ctx)!.push(t);
				}
			}
			const order = [...settings.contexts, ...[...groups.keys()].filter((c) => !settings.contexts.includes(c) && c !== NO_CONTEXT).sort(), NO_CONTEXT];
			for (const ctx of order) {
				const list = groups.get(ctx);
				if (!list) continue;
				body.createDiv({ cls: "gtd-context", text: `${ctx} · ${list.length}` });
				list.sort(byDue).forEach((t) => this.taskRow(body, t, ctx));
			}
			if (!next.length) body.createDiv({ cls: "gtd-empty", text: "Нет следующих действий — разбери входящие или добавь действие в проект" });
		});

		// Ожидание
		const waiting = open.filter((t) => t.status === "waiting").sort(byDue);
		this.section(el, "waiting", "Ожидание", waiting.length, "Поручено другим. Проверяй на обзоре и напоминай, если затянулось.", (body) => {
			waiting.forEach((t) => this.taskRow(body, t));
			if (!waiting.length) body.createDiv({ cls: "gtd-empty", text: "Ничего не ждём" });
		});

		// Проекты
		const projects = this.plugin.index.projects;
		const stalled = projects.filter((p) => p.nextCount === 0).length;
		this.section(el, "projects", stalled ? `Проекты (без действия: ${stalled})` : "Проекты", projects.length, "У каждого проекта должно быть хотя бы одно следующее действие. ⚠ — проект застрял.", (body) => {
			for (const p of [...projects].sort((a, b) => Number(a.nextCount > 0) - Number(b.nextCount > 0))) {
				const row = body.createDiv({ cls: "gtd-project" + (p.nextCount ? "" : " is-stalled") });
				setIcon(row.createSpan({ cls: "gtd-project-icon" }), p.nextCount ? "folder" : "alert-triangle");
				row.createSpan({ cls: "gtd-project-name", text: p.name });
				row.createSpan({ cls: "gtd-project-count", text: p.nextCount ? String(p.nextCount) : "нет действия" });
				row.onclick = () => this.openFile(p.file);
			}
			if (!projects.length) body.createDiv({ cls: "gtd-empty", text: "Проектов пока нет" });
		});

		// Когда-нибудь
		const someday = open.filter((t) => t.status === "someday");
		this.section(el, "someday", "Когда-нибудь / может быть", someday.length, "Идеи на потом. Раз в неделю решай: пора взять в работу или удалить.", (body) => someday.forEach((t) => this.taskRow(body, t)));

		// Завершённые: GTD-задачи и сделанное сразу из входящих, свежие сверху
		const done = this.plugin.index.tasks
			.filter((t) => t.completed && (t.status !== "none" || this.plugin.index.isInbox(t.file)))
			.sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));
		this.section(el, "done", "Завершённые", done.length, "Сделанное — для еженедельного обзора и чувства прогресса. Сними галочку, чтобы вернуть задачу.", (body) => {
			let lastDate: string | null | undefined;
			for (const t of done.slice(0, this.doneLimit)) {
				if (t.doneDate !== lastDate) {
					lastDate = t.doneDate;
					body.createDiv({ cls: "gtd-context", text: t.doneDate ? formatDate(t.doneDate) : "Без даты" });
				}
				this.taskRow(body, t);
			}
			if (done.length > this.doneLimit) {
				const more = body.createEl("button", { cls: "gtd-more", text: `Показать ещё (${done.length - this.doneLimit})` });
				more.onclick = () => {
					this.doneLimit += DONE_PAGE;
					this.render();
				};
			}
			if (!done.length) body.createDiv({ cls: "gtd-empty", text: "Пока ничего не завершено" });
		});

		this.section(el, "help", "Справка", null, "", (body) => this.renderHelp(body));
	}

	private renderHelp(body: HTMLElement): void {
		const mod = Platform.isMacOS ? "Cmd" : "Ctrl";
		const s = this.plugin.settings;
		const help = body.createDiv({ cls: "gtd-help" });

		const block = (title: string, items: [string, string][]) => {
			help.createDiv({ cls: "gtd-help-title", text: title });
			const dl = help.createEl("dl");
			for (const [term, desc] of items) {
				dl.createEl("dt", { text: term });
				dl.createEl("dd", { text: desc });
			}
		};

		help.createEl("p", { text: "GTD освобождает голову: всё, что требует внимания, хранится в надёжной системе, а не в памяти." });
		block("Цикл GTD", [
			["1. Захват", "Всё новое — сразу во входящие, не раздумывая."],
			["2. Разбор", "Раз в день: по каждому пункту реши, что это и какой следующий шаг. До пустых входящих."],
			["3. Действия", "Выбери зону внимания и бери следующее действие оттуда."],
			["4. Обзор", "Раз в неделю: у каждого проекта есть следующее действие? Что с ожиданиями и «когда-нибудь»?"],
		]);
		block("Понятия", [
			["Следующее действие", "Конкретный видимый шаг, который можно сделать без раздумий. Начинается с глагола."],
			["Проект", "Результат, для которого нужно больше одного шага. Заметка в папке проектов."],
			["Зона внимания", "Сфера, к которой относится действие: @работа, @дом, @здоровье."],
			["Правило 2 минут", "Если дело займёт меньше 2 минут — сделай сразу, не записывая."],
		]);
		block("Формат задач", [
			[s.nextTag, "следующее действие"],
			[s.waitingTag, "ожидание — делает кто-то другой"],
			[s.somedayTag, "когда-нибудь / может быть"],
			["@зона", "зона внимания (или человек — в ожидании)"],
			["📅 2026-10-20", "срок; ✅ 2026-10-16 — дата выполнения"],
		]);
		block("Горячие клавиши", [
			[`${mod}+Shift+A`, "добавить во входящие"],
			[`${mod}+Enter`, "в окне добавления — сохранить и записать ещё"],
			["1–7, 0", "в окне разбора — выбор варианта, 0 — пропустить"],
		]);

		const btn = help.createEl("button", { cls: "gtd-help-btn" });
		setIcon(btn.createSpan({ cls: "gtd-big-btn-icon" }), "graduation-cap");
		btn.createSpan({ text: "Повторить онбординг" });
		btn.onclick = () => this.plugin.openOnboarding();
	}

	private bigButton(parent: HTMLElement, icon: string, label: string, cls: string, onClick: () => void): HTMLButtonElement {
		const btn = parent.createEl("button", { cls });
		setIcon(btn.createSpan({ cls: "gtd-big-btn-icon" }), icon);
		btn.createSpan({ text: label });
		btn.onclick = onClick;
		return btn;
	}

	private section(parent: HTMLElement, id: string, title: string, count: number | null, hint: string, fill: (body: HTMLElement) => void): void {
		const sec = parent.createDiv({ cls: "gtd-section" });
		const head = sec.createDiv({ cls: "gtd-section-head" });
		const chevron = head.createSpan({ cls: "gtd-chevron" });
		head.createSpan({ text: title });
		head.createSpan({ cls: "gtd-count", text: count === null ? "" : String(count) });
		const body = sec.createDiv({ cls: "gtd-section-body" });
		if (hint && this.plugin.settings.showHints) body.createDiv({ cls: "gtd-section-hint", text: hint });

		const apply = () => {
			const isCollapsed = this.collapsed.has(id);
			setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");
			body.toggle(!isCollapsed);
		};
		head.onclick = () => {
			if (this.collapsed.has(id)) this.collapsed.delete(id);
			else this.collapsed.add(id);
			apply();
		};
		fill(body);
		apply();
	}

	private taskRow(parent: HTMLElement, task: Task, hideContext?: string): void {
		const row = parent.createDiv({ cls: "gtd-task" + (task.completed ? " is-done" : "") });
		const cb = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
		cb.checked = task.completed;
		cb.onclick = async (e) => {
			e.stopPropagation();
			cb.disabled = true;
			const done = !task.completed;
			try {
				await setTaskDone(this.app, task, done);
				row.toggleClass("is-done", done);
			} catch (err) {
				new Notice(err instanceof Error ? err.message : String(err));
				cb.checked = task.completed;
				cb.disabled = false;
			}
		};

		const main = row.createDiv({ cls: "gtd-task-main" });
		main.createDiv({ cls: "gtd-task-text", text: displayText(task, this.plugin.settings) });

		const meta = main.createDiv({ cls: "gtd-task-meta" });
		if (task.due && !task.completed) {
			const now = today();
			const cls = task.due < now ? "is-overdue" : task.due === now ? "is-today" : "";
			meta.createSpan({ cls: `gtd-due ${cls}`, text: `📅 ${task.due}` });
		}
		for (const ctx of task.contexts) {
			if (ctx !== hideContext) meta.createSpan({ cls: "gtd-tag", text: ctx });
		}
		if (task.project) meta.createSpan({ cls: "gtd-tag gtd-tag-project", text: task.project });
		if (!meta.hasChildNodes()) meta.remove();

		row.onclick = () => this.openFile(task.file, task.line);
	}

	private async openFile(file: TFile, line?: number): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, line === undefined ? undefined : { eState: { line } });
	}
}
