import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Matcher, parseWordList } from './matcher.js';

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const DB_PATH = join(DATA_DIR, 'db.json');
export const LIST_PATH = join(DATA_DIR, 'royxat.txt');

mkdirSync(DATA_DIR, { recursive: true });

function writeAtomic(path, content) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path); // eski fayl bir zumda yangisi bilan almashtiriladi
}

/**
 * Guruh: { id, title, active, canDelete }
 * Ro'yxat: { count, updatedAt } — so'zlarning o'zi royxat.txt da
 */
class Store {
  groups = new Map();
  list = null;
  /** @type {Matcher | null} */
  matcher = null;
  /** Ro'yxatni qayta yuborish uchun Telegram file_id (tezlik uchun) */
  listFileId = null;

  constructor() {
    if (existsSync(DB_PATH)) {
      try {
        const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
        for (const g of db.groups ?? []) this.groups.set(g.id, g);
        this.list = db.list ?? null;
      } catch (e) {
        console.error('db.json o\'qilmadi:', e.message);
      }
    }
    if (this.list && existsSync(LIST_PATH)) {
      const { entries } = parseWordList(readFileSync(LIST_PATH, 'utf8'));
      this.matcher = new Matcher(entries);
    } else {
      this.list = null;
    }
  }

  save() {
    writeAtomic(DB_PATH, JSON.stringify({ groups: [...this.groups.values()], list: this.list }, null, 2));
  }

  setList(entries) {
    writeAtomic(LIST_PATH, entries.join(', '));
    this.matcher = new Matcher(entries);
    this.list = { count: entries.length, updatedAt: new Date().toISOString() };
    this.listFileId = null;
    this.save();
  }

  upsertGroup(id, title, canDelete) {
    const g = this.groups.get(id);
    if (g) {
      g.title = title;
      g.canDelete = canDelete;
    } else {
      this.groups.set(id, { id, title, active: true, canDelete });
    }
    this.save();
    return this.groups.get(id);
  }

  setTitle(id, title) {
    const g = this.groups.get(id);
    if (g && g.title !== title) { g.title = title; this.save(); }
  }

  toggleGroup(id) {
    const g = this.groups.get(id);
    if (!g) return null;
    g.active = !g.active;
    this.save();
    return g;
  }

  removeGroup(id) {
    const g = this.groups.get(id);
    if (g) { this.groups.delete(id); this.save(); }
    return g;
  }

  migrateGroup(oldId, newId) {
    const g = this.groups.get(oldId);
    if (!g) return;
    this.groups.delete(oldId);
    g.id = newId;
    this.groups.set(newId, g);
    this.save();
  }
}

export const store = new Store();
