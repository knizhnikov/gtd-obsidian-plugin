import { App, TFile, normalizePath } from "obsidian";
import { TASK_RE, Task, today } from "./tasks";

async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder || app.vault.getAbstractFileByPath(folder)) return;
	await ensureFolder(app, folder.split("/").slice(0, -1).join("/"));
	await app.vault.createFolder(folder);
}

/** Возвращает файл по пути, создавая его (и папки) с initialContent, если его нет. */
export async function ensureFile(app: App, path: string, initialContent: string): Promise<TFile> {
	path = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	if (existing) throw new Error(`${path} — не файл`);
	await ensureFolder(app, path.split("/").slice(0, -1).join("/"));
	return app.vault.create(path, initialContent);
}

export function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();
}

/** Создаёт заметку-проект (или возвращает существующую с тем же именем) */
export async function createProject(app: App, projectsFolder: string, rawName: string, outcome: string): Promise<TFile> {
	const name = sanitizeFileName(rawName);
	if (!name) throw new Error("Укажите название проекта");
	const path = normalizePath(`${projectsFolder}/${name}.md`);
	return ensureFile(app, path, `---\nstatus: active\n---\n# ${name}\n\n## Результат\n\n${outcome}\n\n## Действия\n`);
}

/** Дописывает строку в конец файла */
export async function appendLine(app: App, file: TFile, line: string): Promise<void> {
	await app.vault.process(file, (data) => {
		const sep = data.length === 0 || data.endsWith("\n") ? "" : "\n";
		return `${data}${sep}${line}\n`;
	});
}

/** Находит строку задачи: сначала по номеру, затем по точному совпадению текста (если файл менялся) */
function findLine(lines: string[], task: Pick<Task, "line" | "raw">): number {
	if (lines[task.line] === task.raw) return task.line;
	return lines.indexOf(task.raw);
}

/** Применяет fn к строке задачи. Бросает ошибку, если задачу не удалось найти. */
export async function editTaskLine(app: App, task: Task, fn: (line: string) => string | null): Promise<void> {
	let found = true;
	await app.vault.process(task.file, (data) => {
		const lines = data.split("\n");
		const i = findLine(lines, task);
		if (i < 0) {
			found = false;
			return data;
		}
		const next = fn(lines[i]);
		if (next === null) lines.splice(i, 1);
		else lines[i] = next;
		return lines.join("\n");
	});
	if (!found) throw new Error("Задача изменилась или удалена — обновите панель");
}

export function removeTask(app: App, task: Task): Promise<void> {
	return editTaskLine(app, task, () => null);
}

export function setTaskDone(app: App, task: Task, done: boolean): Promise<void> {
	return editTaskLine(app, task, (line) => {
		const m = line.match(TASK_RE);
		if (!m) return line;
		if (done) return `${m[1]}[x] ${m[3].trimEnd()} ✅ ${today()}`;
		return `${m[1]}[ ] ${m[3].replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, "")}`;
	});
}
