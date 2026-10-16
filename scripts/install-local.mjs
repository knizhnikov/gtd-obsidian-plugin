// Устанавливает плагин в локальный vault.
//   npm run install-vault -- "/путь/к/vault"          — симлинки: `npm run dev` сразу обновляет плагин
//   npm run install-vault -- "/путь/к/vault" --copy   — копия файлов (для vault в iCloud/Dropbox: симлинки там не синхронизируются)
// Путь можно задать переменной OBSIDIAN_VAULT.
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const args = process.argv.slice(2);
const copy = args.includes("--copy");
const vault = args.find((a) => !a.startsWith("--")) || process.env.OBSIDIAN_VAULT;
if (!vault) {
	console.error('Укажите путь к vault: npm run install-vault -- "/путь/к/vault" [--copy]');
	process.exit(1);
}
if (!existsSync(join(vault, ".obsidian"))) {
	console.error(`В "${vault}" нет папки .obsidian — это точно vault Obsidian?`);
	process.exit(1);
}

const root = resolve(".");
if (!existsSync(join(root, "main.js"))) {
	console.error("Нет main.js — сначала выполните npm run build");
	process.exit(1);
}

const { id } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const target = join(vault, ".obsidian", "plugins", id);
mkdirSync(target, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
	const dest = join(target, file);
	rmSync(dest, { force: true });
	if (copy) copyFileSync(join(root, file), dest);
	else symlinkSync(join(root, file), dest);
}

const hotreload = join(target, ".hotreload");
if (copy) rmSync(hotreload, { force: true });
// Маркер для плагина Hot-Reload: перезагружает плагин при изменении main.js
else writeFileSync(hotreload, "");

console.log(`Готово (${copy ? "копия" : "симлинки"}): ${target}`);
console.log("Включите плагин в Obsidian: Настройки → Сторонние плагины → GTD Lite.");
