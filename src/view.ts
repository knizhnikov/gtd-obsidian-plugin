import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type GtdLitePlugin from "./main";
import { ProcessInboxModal } from "./process-modal";
import { Task, displayText, today } from "./tasks";
import { setTaskDone } from "./vault-ops";

export const VIEW_TYPE_GTD = "gtd-lite-view";

const NO_CONTEXT = "Без контекста";

function byDue(a: Task, b: Task): number {
	if (a.due && b.due) return a.due.localeCompare(b.due);
	if (a.due) return -1;
	if (b.due) return 1;
	return 0;
}

/** Боковая панель: входящие, сроки, действия по контекстам, ожидания, когда-нибудь, проекты */
export class GtdView extends ItemView {
	/** Свёрнутые секции переживают перерисовку */
	private collapsed = new Set<string>(["someday"]);

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

		// Входящие
		const inboxCount = this.plugin.index.inboxTasks().length;
		const inbox = el.createDiv({ cls: "gtd-inbox-bar" });
		setIcon(inbox.createSpan(), "inbox");
		inbox.createSpan({ text: `Входящие: ${inboxCount}`, cls: inboxCount ? "gtd-inbox-count is-full" : "gtd-inbox-count" });
		const processBtn = inbox.createEl("button", { text: "Разобрать" });
		processBtn.disabled = inboxCount === 0;
		processBtn.onclick = () => new ProcessInboxModal(this.plugin).open();
		const captureBtn = inbox.createEl("button", { attr: { "aria-label": "Захватить" } });
		setIcon(captureBtn, "plus");
		captureBtn.onclick = () => this.plugin.openCapture();

		// Сроки
		const dated = open.filter((t) => t.due && t.due <= now && (t.status === "next" || t.status === "waiting")).sort(byDue);
		if (dated.length) {
			this.section(el, "due", "Сегодня и просрочено", dated.length, (body) => dated.forEach((t) => this.taskRow(body, t)));
		}

		// Следующие действия по контекстам
		const next = open.filter((t) => t.status === "next");
		this.section(el, "next", "Следующие действия", next.length, (body) => {
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
			if (!next.length) body.createDiv({ cls: "gtd-empty", text: "Нет следующих действий" });
		});

		// Ожидание
		const waiting = open.filter((t) => t.status === "waiting").sort(byDue);
		this.section(el, "waiting", "Ожидание", waiting.length, (body) => {
			waiting.forEach((t) => this.taskRow(body, t));
			if (!waiting.length) body.createDiv({ cls: "gtd-empty", text: "Ничего не ждём" });
		});

		// Проекты
		const projects = this.plugin.index.projects;
		const stalled = projects.filter((p) => p.nextCount === 0).length;
		this.section(el, "projects", stalled ? `Проекты (без действия: ${stalled})` : "Проекты", projects.length, (body) => {
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
		this.section(el, "someday", "Когда-нибудь / может быть", someday.length, (body) => someday.forEach((t) => this.taskRow(body, t)));
	}

	private section(parent: HTMLElement, id: string, title: string, count: number, fill: (body: HTMLElement) => void): void {
		const sec = parent.createDiv({ cls: "gtd-section" });
		const head = sec.createDiv({ cls: "gtd-section-head" });
		const chevron = head.createSpan({ cls: "gtd-chevron" });
		head.createSpan({ text: title });
		head.createSpan({ cls: "gtd-count", text: String(count) });
		const body = sec.createDiv({ cls: "gtd-section-body" });

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
		const row = parent.createDiv({ cls: "gtd-task" });
		const cb = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
		cb.onclick = async (e) => {
			e.stopPropagation();
			cb.disabled = true;
			try {
				await setTaskDone(this.app, task, true);
				row.addClass("is-done");
			} catch (err) {
				new Notice(err instanceof Error ? err.message : String(err));
				cb.checked = false;
				cb.disabled = false;
			}
		};

		const main = row.createDiv({ cls: "gtd-task-main" });
		main.createDiv({ cls: "gtd-task-text", text: displayText(task, this.plugin.settings) });

		const meta = main.createDiv({ cls: "gtd-task-meta" });
		if (task.due) {
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
