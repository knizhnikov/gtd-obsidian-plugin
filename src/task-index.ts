import { App, Events, TFile, debounce, normalizePath } from "obsidian";
import type { GtdSettings } from "./settings";
import { Task, parseLine } from "./tasks";

export interface Project {
	file: TFile;
	name: string;
	nextCount: number;
	openCount: number;
}

/** Индекс задач по всему vault. Пересобирается (с задержкой) при изменении файлов. */
export class TaskIndex extends Events {
	tasks: Task[] = [];
	projects: Project[] = [];

	private requestRebuild = debounce(() => this.rebuild(), 400, true);

	constructor(private app: App, private getSettings: () => GtdSettings) {
		super();
	}

	/** Подписки на изменения vault; возвращает функции для регистрации в плагине */
	attach(register: (ref: ReturnType<App["vault"]["on"]>) => void): void {
		register(this.app.metadataCache.on("changed", () => this.requestRebuild()));
		register(this.app.vault.on("delete", () => this.requestRebuild()));
		register(this.app.vault.on("rename", () => this.requestRebuild()));
	}

	invalidate(): void {
		this.requestRebuild();
	}

	isProjectFile(file: TFile): boolean {
		const folder = normalizePath(this.getSettings().projectsFolder);
		return file.extension === "md" && file.path.startsWith(folder + "/");
	}

	isInbox(file: TFile): boolean {
		return file.path === normalizePath(this.getSettings().inboxPath);
	}

	inboxTasks(): Task[] {
		return this.tasks.filter((t) => !t.completed && this.isInbox(t.file));
	}

	async rebuild(): Promise<void> {
		const settings = this.getSettings();
		const tasks: Task[] = [];
		const projects: Project[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			const isProject = this.isProjectFile(file);
			const projectName = isProject ? file.basename : null;
			const fileTasks: Task[] = [];

			if (cache?.listItems?.some((li) => li.task !== undefined)) {
				const lines = (await this.app.vault.cachedRead(file)).split("\n");
				for (const li of cache.listItems) {
					if (li.task === undefined) continue;
					const n = li.position.start.line;
					const task = parseLine(lines[n] ?? "", file, n, settings, projectName);
					if (task) fileTasks.push(task);
				}
				tasks.push(...fileTasks);
			}

			if (isProject) {
				const status = String(cache?.frontmatter?.status ?? "").toLowerCase();
				if (status === "done" || status === "dropped") continue;
				const open = fileTasks.filter((t) => !t.completed);
				projects.push({
					file,
					name: file.basename,
					nextCount: open.filter((t) => t.status === "next").length,
					openCount: open.length,
				});
			}
		}

		projects.sort((a, b) => a.name.localeCompare(b.name));
		this.tasks = tasks;
		this.projects = projects;
		this.trigger("changed");
	}
}
