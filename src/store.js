import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ADMIN_IDS } from './config.js';
import { Matcher, parseWordList } from './matcher.js';

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const DB_PATH = join(DATA_DIR, 'db.json');
const LEGACY_LIST_PATH = join(DATA_DIR, 'royxat.txt');

/** Har bir adminning ro'yxati o'z faylida saqlanadi */
export const listPath = (adminId) => join(DATA_DIR, `royxat-${adminId}.txt`);

mkdirSync(DATA_DIR, { recursive: true });

function writeAtomic(path, content) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path); // eski fayl bir zumda yangisi bilan almashtiriladi
}

/**
 * Bitta adminning o'z olami — boshqa adminlar buni ko'rmaydi.
 * Guruh: { id, title, active, words, ads, canDelete } — words/ads yo'q bo'lsa, yoqilgan hisoblanadi
 * Ro'yxat: { count, updatedAt } — so'zlarning o'zi royxat-<adminId>.txt da
 */
class AdminData {
  groups = new Map();
  list = null;
  /** @type {Matcher | null} */
  matcher = null;
  /** Ro'yxatni qayta yuborish uchun Telegram file_id (tezlik uchun) */
  listFileId = null;

  constructor(id) {
    this.id = id;
  }
}

class Store {
  /** @type {Map<number, AdminData>} */
  admins = new Map();
  /** guruh id -> uni qo'shgan adminning id si. Bitta guruh — bitta ega. */
  owners = new Map();

  constructor() {
    this.#load();
  }

  /** Admin ma'lumotlari; hali bo'lmasa — yaratiladi */
  for(adminId) {
    let a = this.admins.get(adminId);
    if (!a) {
      a = new AdminData(adminId);
      this.admins.set(adminId, a);
    }
    return a;
  }

  /** Guruh qaysi adminga tegishli */
  ownerOf(chatId) {
    return this.owners.get(chatId) ?? null;
  }

  /** Guruh va uning egasi (kim bo'lishidan qat'i nazar) */
  groupOf(chatId) {
    const adminId = this.owners.get(chatId);
    if (adminId === undefined) return null;
    const group = this.admins.get(adminId)?.groups.get(chatId);
    return group ? { group, adminId } : null;
  }

  /** Aynan shu adminning guruhi; boshqa adminnikini hech qachon qaytarmaydi */
  groupFor(adminId, chatId) {
    if (this.owners.get(chatId) !== adminId) return null;
    return this.admins.get(adminId)?.groups.get(chatId) ?? null;
  }

  #load() {
    let db = null;
    if (existsSync(DB_PATH)) {
      try {
        db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
      } catch (e) {
        console.error("db.json o'qilmadi:", e.message);
      }
    }
    if (!db) return;

    const legacy = !Array.isArray(db.admins);
    const records = legacy ? this.#fromLegacy(db) : db.admins;

    for (const rec of records) {
      const id = Number(rec?.id);
      if (!Number.isSafeInteger(id)) continue;

      const a = this.for(id);
      for (const g of rec.groups ?? []) {
        if (this.owners.has(g.id)) continue; // bir guruh ikki adminda bo'lmaydi
        a.groups.set(g.id, g);
        this.owners.set(g.id, id);
      }

      a.list = rec.list ?? null;
      const path = listPath(id);
      if (a.list && existsSync(path)) {
        const { entries } = parseWordList(readFileSync(path, 'utf8'));
        a.matcher = new Matcher(entries);
      } else {
        a.list = null;
      }
    }

    if (legacy) this.save(); // eski format yangisiga o'tkazilib saqlanadi
  }

  /** Eski, bitta adminli db.json ni birinchi adminga biriktiradi */
  #fromLegacy(db) {
    const owner = ADMIN_IDS[0];
    if (owner === undefined) return [];

    if (db.list && existsSync(LEGACY_LIST_PATH) && !existsSync(listPath(owner))) {
      try {
        renameSync(LEGACY_LIST_PATH, listPath(owner));
      } catch (e) {
        console.error("eski ro'yxatni ko'chirib bo'lmadi:", e.message);
      }
    }
    return [{ id: owner, groups: db.groups ?? [], list: db.list ?? null }];
  }

  save() {
    const admins = [...this.admins.values()].map((a) => ({
      id: a.id,
      groups: [...a.groups.values()],
      list: a.list,
    }));
    writeAtomic(DB_PATH, JSON.stringify({ version: 2, admins }, null, 2));
  }

  setList(adminId, entries) {
    const a = this.for(adminId);
    writeAtomic(listPath(adminId), entries.join(', '));
    a.matcher = new Matcher(entries);
    a.list = { count: entries.length, updatedAt: new Date().toISOString() };
    a.listFileId = null;
    this.save();
  }

  /** Guruhni adminga biriktiradi yoki mavjudini yangilaydi. Egasi boshqa admin bo'lsa — null. */
  upsertGroup(adminId, id, title, canDelete) {
    const owner = this.owners.get(id);
    if (owner !== undefined && owner !== adminId) return null;

    const a = this.for(adminId);
    const g = a.groups.get(id);
    if (g) {
      g.title = title;
      g.canDelete = canDelete;
    } else {
      a.groups.set(id, { id, title, active: true, words: true, ads: true, canDelete });
      this.owners.set(id, adminId);
    }
    this.save();
    return a.groups.get(id);
  }

  setTitle(chatId, title) {
    const found = this.groupOf(chatId);
    if (found && found.group.title !== title) {
      found.group.title = title;
      this.save();
    }
  }

  /** Faqat guruh egasi holatini o'zgartira oladi */
  toggleGroup(adminId, chatId) {
    const g = this.groupFor(adminId, chatId);
    if (!g) return null;
    g.active = !g.active;
    this.save();
    return g;
  }

  /** So'z filtri ('words') yoki reklama tozalashni ('ads') yoqish/o'chirish — faqat guruh egasi */
  toggleOption(adminId, chatId, key) {
    const g = this.groupFor(adminId, chatId);
    if (!g) return null;
    g[key] = g[key] === false; // eski yozuvlarda maydon yo'q — yoqilgan deb hisoblanadi
    this.save();
    return g;
  }

  /** @returns {{ group: object, adminId: number } | null} */
  removeGroup(chatId) {
    const found = this.groupOf(chatId);
    if (!found) return null;
    this.admins.get(found.adminId).groups.delete(chatId);
    this.owners.delete(chatId);
    this.save();
    return found;
  }

  migrateGroup(oldId, newId) {
    const found = this.groupOf(oldId);
    if (!found) return;
    const a = this.admins.get(found.adminId);
    a.groups.delete(oldId);
    this.owners.delete(oldId);
    found.group.id = newId;
    a.groups.set(newId, found.group);
    this.owners.set(newId, found.adminId);
    this.save();
  }
}

export const store = new Store();
