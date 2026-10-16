import { TFile, moment } from "obsidian";
import type { GtdSettings } from "./settings";

export type TaskStatus = "next" | "waiting" | "someday" | "none";

export interface Task {
	file: TFile;
	/** Номер строки (с 0) на момент индексации */
	line: number;
	/** Исходная строка целиком — используется для поиска при изменении файла */
	raw: string;
	completed: boolean;
	/** Текст без чекбокса */
	text: string;
	status: TaskStatus;
	contexts: string[];
	/** YYYY-MM-DD */
	due: string | null;
	/** Дата выполнения (✅ YYYY-MM-DD), YYYY-MM-DD */
	doneDate: string | null;
	/** Имя проекта, если задача лежит в заметке-проекте */
	project: string | null;
}

export const TASK_RE = /^(\s*[-*+] )\[(.)\] (.*)$/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const DONE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/u;
const CONTEXT_RE = /(?:^|\s)(@[\p{L}\p{N}_\-/.]+)/gu;

export function today(): string {
	return moment().format("YYYY-MM-DD");
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasTag(text: string, tag: string): boolean {
	return new RegExp(`(^|\\s)${escapeRe(tag)}(?=\\s|$)`, "u").test(text);
}

export function parseLine(raw: string, file: TFile, line: number, settings: GtdSettings, project: string | null): Task | null {
	const m = raw.match(TASK_RE);
	if (!m) return null;
	const text = m[3];

	let status: TaskStatus = "none";
	if (hasTag(text, settings.nextTag)) status = "next";
	else if (hasTag(text, settings.waitingTag)) status = "waiting";
	else if (hasTag(text, settings.somedayTag)) status = "someday";

	return {
		file,
		line,
		raw,
		completed: m[2] !== " ",
		text,
		status,
		contexts: Array.from(text.matchAll(CONTEXT_RE), (c) => c[1]),
		due: text.match(DUE_RE)?.[1] ?? null,
		doneDate: text.match(DONE_RE)?.[1] ?? null,
		project,
	};
}

/** Текст для отображения: без служебных тегов, дат и ссылочного синтаксиса */
export function displayText(task: Task, settings: GtdSettings): string {
	let t = task.text;
	for (const tag of [settings.nextTag, settings.waitingTag, settings.somedayTag]) {
		t = t.replace(new RegExp(`(^|\\s)${escapeRe(tag)}(?=\\s|$)`, "gu"), "$1");
	}
	return t
		.replace(DUE_RE, "")
		.replace(DONE_RE, "")
		.replace(CONTEXT_RE, "")
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

/** «работа» → «@работа», пробелы → «_» */
export function normalizeContext(raw: string): string {
	const c = raw.trim().replace(/\s+/g, "_");
	if (!c || c === "@") return "";
	return c.startsWith("@") ? c : "@" + c;
}

/** Собирает строку задачи в формате, совместимом с плагином Tasks */
export function buildTaskLine(text: string, opts: { tag?: string; contexts?: string[]; due?: string | null } = {}): string {
	if (opts.due) text = text.replace(DUE_RE, "");
	const parts = [text.replace(/\s+/g, " ").trim()];
	for (const c of opts.contexts ?? []) {
		if (c && !text.includes(c)) parts.push(c);
	}
	if (opts.tag && !hasTag(text, opts.tag)) parts.push(opts.tag);
	if (opts.due) parts.push(`📅 ${opts.due}`);
	return `- [ ] ${parts.join(" ")}`;
}
