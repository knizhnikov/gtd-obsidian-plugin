// Устанавливает плагин в локальный vault через симлинки, чтобы `npm run dev` сразу обновлял его.
// Использование: npm run install-vault -- "/путь/к/vault"   (или переменная OBSIDIAN_VAULT)
import { existsSync, mkdirSync, rmSync, symlinkSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const vault = process.argv[2] || process.env.OBSIDIAN_VAULT;
if (!vault) {
	console.error('Укажите путь к vault: npm run install-vault -- "/путь/к/vault"');
	process.exit(1);
}
if (!existsSync(join(vault, ".obsidian"))) {
	console.error(`В "${vault}" нет папки .obsidian — это точно vault Obsidian?`);
	process.exit(1);
}

const root = resolve(".");
const { id } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const target = join(vault, ".obsidian", "plugins", id);
mkdirSync(target, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
	const dest = join(target, file);
	rmSync(dest, { force: true });
	symlinkSync(join(root, file), dest);
}
// Маркер для плагина Hot-Reload: перезагружает плагин при изменении main.js
writeFileSync(join(target, ".hotreload"), "");

console.log(`Готово: ${target}`);
console.log("Включите плагин в Obsidian: Настройки → Сторонние плагины → GTD Lite.");
