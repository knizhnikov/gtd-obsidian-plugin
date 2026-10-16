import { Modal, Notice, Platform, normalizePath, setIcon } from "obsidian";
import { appendToInbox } from "./capture";
import type GtdLitePlugin from "./main";
import { ProcessInboxModal } from "./process-modal";
import { buildTaskLine, normalizeContext } from "./tasks";
import { appendLine, createProject, ensureFile } from "./vault-ops";

const SUGGESTED_ZONES = ["@работа", "@дом", "@семья", "@здоровье", "@финансы", "@учёба", "@хобби", "@звонки", "@поручения"];

interface ProjectDraft {
	name: string;
	firstAction: string;
}

interface Step {
	icon: string;
	title: string;
	render: (el: HTMLElement) => void;
	/** Выполняется при переходе вперёд; ошибка оставляет пользователя на шаге */
	commit?: () => Promise<void>;
}

/** Есть ли в vault данные GTD — если да, онбординг не нужен */
export function hasGtdData(plugin: GtdLitePlugin): boolean {
	const { inboxPath, actionsPath, projectsFolder } = plugin.settings;
	return [inboxPath, actionsPath, projectsFolder].some((p) => plugin.app.vault.getAbstractFileByPath(normalizePath(p)));
}

/** Пошаговое знакомство с GTD и первичная настройка: захват, зоны внимания, проекты */
export class OnboardingModal extends Modal {
	private idx = 0;
	private steps: Step[];
	private captured: string[] = [];
	private zones: string[];
	private projects: ProjectDraft[] = [];
	private createdProjects = new Set<string>();
	/** Добавляет то, что введено в поле, но не подтверждено кнопкой «Добавить» */
	private flushInput: (() => void) | null = null;

	constructor(private plugin: GtdLitePlugin) {
		super(plugin.app);
		this.zones = [...plugin.settings.contexts];
		this.steps = [
			{ icon: "sparkles", title: "Добро пожаловать в GTD", render: (el) => this.renderWelcome(el) },
			{ icon: "inbox", title: "Шаг 1. Захват", render: (el) => this.renderCapture(el) },
			{ icon: "target", title: "Шаг 2. Зоны внимания", render: (el) => this.renderZones(el), commit: () => this.saveZones() },
			{ icon: "folder", title: "Шаг 3. Проекты", render: (el) => this.renderProjects(el), commit: () => this.saveProjects() },
			{ icon: "rocket", title: "Готово! Как работать дальше", render: (el) => this.renderFinish(el) },
		];
	}

	onOpen(): void {
		this.modalEl.addClass("gtd-onboarding-modal");
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
		// Даже если окно закрыли раньше — система должна быть готова к работе
		await ensureFile(this.app, this.plugin.settings.inboxPath, "# Входящие\n\n");
		this.plugin.settings.onboarded = true;
		await this.plugin.saveSettings();
	}

	// ---------- каркас ----------

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const step = this.steps[this.idx];

		const dots = contentEl.createDiv({ cls: "gtd-onb-dots" });
		this.steps.forEach((_, i) => dots.createSpan({ cls: "gtd-onb-dot" + (i === this.idx ? " is-active" : i < this.idx ? " is-done" : "") }));

		const head = contentEl.createDiv({ cls: "gtd-onb-head" });
		setIcon(head.createSpan({ cls: "gtd-onb-icon" }), step.icon);
		head.createEl("h2", { text: step.title });

		step.render(contentEl.createDiv({ cls: "gtd-onb-body" }));

		const nav = contentEl.createDiv({ cls: "gtd-onb-nav" });
		if (this.idx < this.steps.length - 1) {
			const skip = nav.createEl("button", { cls: "gtd-onb-skip", text: "Пропустить знакомство" });
			skip.onclick = () => this.close();
		}
		nav.createDiv({ cls: "gtd-onb-spacer" });
		if (this.idx > 0 && this.idx < this.steps.length - 1) {
			nav.createEl("button", { text: "Назад" }).onclick = () => this.goto(this.idx - 1);
		}
		if (this.idx < this.steps.length - 1) {
			const next = nav.createEl("button", { cls: "mod-cta", text: this.idx === 0 ? "Начать" : "Дальше" });
			next.onclick = () => void this.forward();
		}
	}

	private goto(i: number): void {
		this.flushInput = null;
		this.idx = i;
		this.render();
	}

	private async forward(): Promise<void> {
		try {
			this.flushInput?.();
			await this.steps[this.idx].commit?.();
			this.goto(this.idx + 1);
		} catch (err) {
			console.error(err);
			new Notice(err instanceof Error ? err.message : String(err));
		}
	}

	private para(el: HTMLElement, text: string): void {
		el.createEl("p", { text });
	}

	private tip(el: HTMLElement, text: string): void {
		el.createDiv({ cls: "gtd-hint", text });
	}

	// ---------- шаги ----------

	private renderWelcome(el: HTMLElement): void {
		this.para(el, "GTD (Getting Things Done) — методика, которая освобождает голову: всё, что требует внимания, хранится в надёжной системе, а не в памяти. Голова — для идей, а не для хранения.");
		const flow = el.createDiv({ cls: "gtd-onb-flow" });
		for (const [icon, title, text] of [
			["inbox", "Захват", "Записываешь всё во входящие, не раздумывая"],
			["filter", "Разбор", "Решаешь, что это и какой следующий шаг"],
			["list-checks", "Действия", "Делаешь дела по зонам внимания"],
			["calendar-check", "Обзор", "Раз в неделю наводишь порядок"],
		]) {
			const card = flow.createDiv({ cls: "gtd-onb-card" });
			setIcon(card.createDiv({ cls: "gtd-onb-card-icon" }), icon);
			card.createDiv({ cls: "gtd-onb-card-title", text: title });
			card.createDiv({ cls: "gtd-onb-card-text", text });
		}
		this.para(el, "За пару минут настроим систему под тебя: выгрузим первые мысли, выберем зоны внимания и запишем текущие проекты.");
	}

	private renderCapture(el: HTMLElement): void {
		const hotkey = `${Platform.isMacOS ? "Cmd" : "Ctrl"}+Shift+A`;
		this.para(el, `Входящие — единственное место, куда попадает всё новое: задачи, идеи, обещания, «надо бы…». Добавить можно из любого места Obsidian клавишами ${hotkey} или большой кнопкой в панели GTD.`);
		this.tip(el, "Не формулируй красиво и не решай сразу, что с этим делать — это будет на этапе разбора. Задача захвата — выгрузить из головы.");

		el.createDiv({ cls: "gtd-form-label", text: "Попробуй: что сейчас крутится в голове? Запиши 3–5 вещей, Enter после каждой." });
		const input = el.createEl("input", { type: "text", cls: "gtd-capture-input", attr: { placeholder: "Например: позвонить в банк" } });
		const list = el.createEl("ul", { cls: "gtd-onb-captured" });
		const renderList = () => {
			list.empty();
			this.captured.forEach((t) => list.createEl("li", { text: t }));
		};
		renderList();
		input.addEventListener("keydown", async (e) => {
			if (e.key !== "Enter" || e.isComposing) return;
			e.preventDefault();
			const text = input.value.trim();
			if (!text) return;
			try {
				await appendToInbox(this.app, this.plugin.settings.inboxPath, text);
				this.captured.push(text);
				input.value = "";
				renderList();
			} catch (err) {
				new Notice(`Не удалось сохранить: ${err}`);
			}
		});
		window.setTimeout(() => input.focus(), 0);
	}

	private renderZones(el: HTMLElement): void {
		this.para(el, "Зона внимания — сфера жизни или работы, к которой относится действие. В панели действия группируются по зонам: выбираешь зону, в которой сейчас твой фокус, и видишь только её дела.");
		this.tip(el, "Начни с 3–6 зон — потом их легко поменять. В тексте задачи зона пишется через @: «Записаться к врачу @здоровье».");

		const chips = el.createDiv({ cls: "gtd-chips gtd-onb-zones" });
		const renderChips = () => {
			chips.empty();
			const all = [...SUGGESTED_ZONES, ...this.zones.filter((z) => !SUGGESTED_ZONES.includes(z))];
			for (const zone of all) {
				const chip = chips.createEl("button", { cls: "gtd-chip", text: zone });
				chip.toggleClass("is-active", this.zones.includes(zone));
				chip.onclick = () => {
					this.zones = this.zones.includes(zone) ? this.zones.filter((z) => z !== zone) : [...this.zones, zone];
					chip.toggleClass("is-active", this.zones.includes(zone));
				};
			}
		};
		renderChips();

		const row = el.createDiv({ cls: "gtd-onb-add" });
		const input = row.createEl("input", { type: "text", attr: { placeholder: "Своя зона, например: дача" } });
		const add = () => {
			const zone = normalizeContext(input.value);
			if (zone && !this.zones.includes(zone)) this.zones.push(zone);
			input.value = "";
			renderChips();
			input.focus();
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				add();
			}
		});
		row.createEl("button", { text: "Добавить" }).onclick = add;
		this.flushInput = () => input.value.trim() && add();
	}

	private async saveZones(): Promise<void> {
		if (!this.zones.length) throw new Error("Выбери хотя бы одну зону внимания");
		this.plugin.settings.contexts = [...this.zones];
		await this.plugin.saveSettings();
	}

	private renderProjects(el: HTMLElement): void {
		this.para(el, "Проект — любой результат, для которого нужно больше одного шага: «Отпуск спланирован», «Отчёт за квартал сдан», «Ремонт в ванной закончен». Каждый проект — отдельная заметка.");
		this.tip(el, "Главное правило: у каждого проекта всегда есть следующее действие — конкретный шаг, который можно сделать прямо сейчас. Проект без него застревает, и панель подсветит его ⚠.");

		const list = el.createDiv({ cls: "gtd-onb-projects" });
		const renderList = () => {
			list.empty();
			this.projects.forEach((p, i) => {
				const row = list.createDiv({ cls: "gtd-onb-project" });
				const main = row.createDiv({ cls: "gtd-onb-project-main" });
				main.createDiv({ cls: "gtd-onb-project-name", text: p.name });
				main.createDiv({ cls: "gtd-onb-project-action", text: p.firstAction ? `→ ${p.firstAction}` : "⚠ нет первого действия" });
				const del = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Убрать" } });
				setIcon(del, "x");
				del.onclick = () => {
					this.projects.splice(i, 1);
					renderList();
				};
			});
		};
		renderList();

		const form = el.createDiv({ cls: "gtd-onb-project-form" });
		const name = form.createEl("input", { type: "text", attr: { placeholder: "Проект: желаемый результат" } });
		const action = form.createEl("input", { type: "text", attr: { placeholder: "Первое действие: с чего начать?" } });
		const add = () => {
			if (!name.value.trim()) return name.focus();
			this.projects.push({ name: name.value.trim(), firstAction: action.value.trim() });
			name.value = "";
			action.value = "";
			renderList();
			name.focus();
		};
		for (const input of [name, action]) {
			input.addEventListener("keydown", (e) => {
				if (e.key !== "Enter" || e.isComposing) return;
				e.preventDefault();
				if (input === name && !action.value.trim()) action.focus();
				else add();
			});
		}
		form.createEl("button", { text: "Добавить проект" }).onclick = add;
		this.flushInput = () => name.value.trim() && add();
		window.setTimeout(() => name.focus(), 0);
	}

	private async saveProjects(): Promise<void> {
		const { projectsFolder, nextTag } = this.plugin.settings;
		for (const p of this.projects) {
			// Защита от повторного создания при «Назад» → «Дальше»
			if (this.createdProjects.has(p.name)) continue;
			const file = await createProject(this.app, projectsFolder, p.name, "");
			if (p.firstAction) await appendLine(this.app, file, buildTaskLine(p.firstAction, { tag: nextTag }));
			this.createdProjects.add(p.name);
		}
	}

	private renderFinish(el: HTMLElement): void {
		this.para(el, "Система готова. Вот ежедневный цикл:");
		const ol = el.createEl("ol", { cls: "gtd-onb-steps" });
		for (const text of [
			`Мысль пришла в голову — сразу во входящие (${Platform.isMacOS ? "Cmd" : "Ctrl"}+Shift+A).`,
			"Раз в день разбирай входящие кнопкой «Разобрать»: по каждому пункту реши, что это, — до пустых входящих.",
			"Работай по панели «Следующие действия»: выбери зону внимания и бери задачу.",
			"Раз в неделю — обзор: проверь проекты (у каждого есть следующее действие?), ожидания и «когда-нибудь».",
		]) {
			ol.createEl("li", { text });
		}

		const stats: string[] = [];
		if (this.captured.length) stats.push(`во входящих: ${this.captured.length}`);
		if (this.createdProjects.size) stats.push(`проектов: ${this.createdProjects.size}`);
		stats.push(`зон внимания: ${this.plugin.settings.contexts.length}`);
		this.tip(el, `Создано — ${stats.join(", ")}. Подсказки в окнах можно выключить в настройках плагина, когда освоишься. Пройти знакомство заново — команда «GTD Lite: Знакомство и настройка».`);

		const actions = el.createDiv({ cls: "gtd-actions" });
		if (this.captured.length) {
			const process = actions.createEl("button", { cls: "gtd-big-btn mod-capture", text: `Разобрать входящие (${this.captured.length})` });
			process.onclick = async () => {
				this.close();
				await this.plugin.activateView();
				new ProcessInboxModal(this.plugin).open();
			};
		}
		const open = actions.createEl("button", { cls: this.captured.length ? "gtd-big-btn mod-process" : "gtd-big-btn mod-capture", text: "Открыть панель GTD" });
		open.onclick = async () => {
			this.close();
			await this.plugin.activateView();
		};
	}
}
