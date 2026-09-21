import { Composer, InlineKeyboard, InputFile } from 'grammy';
import { BOT_TOKEN } from './config.js';
import { parseWordList } from './matcher.js';
import { LIST_PATH, store } from './store.js';

const PAGE_SIZE = 10;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_ENTRY_LENGTH = 100;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Fayl kutilayotgan holat (faqat bitta admin bor) */
let awaitingFile = false;

export const admin = new Composer();

// ───────────────────────── Ko'rinishlar ─────────────────────────

const addGroupUrl = (ctx) =>
  `https://t.me/${ctx.me.username}?startgroup=true&admin=delete_messages`;

function mainMenu(ctx) {
  const groups = [...store.groups.values()];
  const active = groups.filter((g) => g.active).length;

  const text =
    '👋 <b>Assalomu alaykum!</b>\n\n' +
    "Bot guruhlarda ro'yxatdagi taqiqlangan so'zlar bor xabarlarni avtomatik o'chiradi.\n\n" +
    `📄 Ro'yxat: <b>${store.list ? `${store.list.count} ta so'z` : 'yuklanmagan'}</b>\n` +
    `👥 Guruhlar: <b>${groups.length} ta</b>${groups.length ? ` (faol: ${active})` : ''}`;

  const kb = new InlineKeyboard();
  if (store.list) kb.text("📄 Ro'yxatni ko'rish", 'view').text("🔄 Ro'yxatni yangilash", 'upload').row();
  else kb.text("📥 Ro'yxatni yuklash", 'upload').row();
  if (groups.length) kb.text("👥 Guruhlarni ko'rish", 'groups:0');
  else kb.url("➕ Guruhga qo'shish", addGroupUrl(ctx));

  return { text, kb };
}

function uploadPrompt() {
  const text =
    (store.list
      ? "🔄 <b>Yangi ro'yxat faylini yuboring.</b>\nEski ro'yxat o'chirilib, o'rniga yangisi ishlatiladi.\n\n"
      : "📥 <b>Ro'yxat faylini yuboring.</b>\n\n") +
    'Talablar:\n' +
    '• Fayl <b>.txt</b> formatida bo\'lishi kerak\n' +
    "• So'zlar <b>vergul</b> bilan ajratilgan bo'lishi kerak\n\n" +
    "Masalan: <code>so'z1, so'z2, so'z3</code>";
  return { text, kb: new InlineKeyboard().text('❌ Bekor qilish', 'menu') };
}

function groupsView(ctx, page) {
  const groups = [...store.groups.values()];
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  page = Math.min(Math.max(0, page), pages - 1);

  const kb = new InlineKeyboard();
  for (const g of groups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    kb.text(`${g.active ? '🟢' : '🔴'} ${g.title}`, `g:${g.id}:${page}`).row();
  }
  if (pages > 1) {
    kb.text(page > 0 ? '◀️' : '⏺', page > 0 ? `groups:${page - 1}` : 'noop')
      .text(`${page + 1} / ${pages}`, 'noop')
      .text(page < pages - 1 ? '▶️' : '⏺', page < pages - 1 ? `groups:${page + 1}` : 'noop')
      .row();
  }
  kb.url("➕ Guruhga qo'shish", addGroupUrl(ctx)).row().text('⬅️ Orqaga', 'menu');

  const text = groups.length
    ? `👥 <b>Guruhlar</b> (${groups.length} ta)\n\n🟢 — faol, 🔴 — faolsiz\nBoshqarish uchun guruhni tanlang.`
    : "👥 Hozircha guruhlar yo'q.\nBotni guruhga qo'shish uchun pastdagi tugmani bosing.";
  return { text, kb };
}

function groupView(g, page) {
  const text =
    `👥 <b>${esc(g.title)}</b>\n\n` +
    `Holati: ${g.active ? '🟢 <b>Faol</b>' : '🔴 <b>Faolsiz</b>'}\n` +
    `Huquq: ${g.canDelete ? "✅ xabarlarni o'chira oladi" : "⚠️ xabarlarni o'chirish huquqi yo'q (botni admin qiling)"}`;
  const kb = new InlineKeyboard()
    .text(g.active ? '🔴 Faolsizlantirish' : '🟢 Faollashtirish', `t:${g.id}:${page}`)
    .row()
    .text('⬅️ Orqaga', `groups:${page}`);
  return { text, kb };
}

// ───────────────────────── Yordamchilar ─────────────────────────

const opts = (kb) => ({ parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });

async function show(ctx, { text, kb }) {
  try {
    await ctx.editMessageText(text, opts(kb));
  } catch (e) {
    if (!String(e?.description ?? e).includes('not modified')) await ctx.reply(text, opts(kb));
  }
}

const reply = (ctx, { text, kb }) => ctx.reply(text, opts(kb));

const retryKb = () => new InlineKeyboard().text('❌ Bekor qilish', 'menu');
const fail = (ctx, reason) =>
  reply(ctx, { text: `❌ <b>Xatolik:</b> ${reason}\n\nIltimos, to'g'rilangan faylni qaytadan yuboring.`, kb: retryKb() });

function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1251').decode(buf); // eski Windows (ANSI) fayllar
  }
}

// ───────────────────────── Handlerlar ─────────────────────────

admin.command('start', async (ctx) => {
  awaitingFile = false;
  await reply(ctx, mainMenu(ctx));
});

admin.callbackQuery('menu', async (ctx) => {
  awaitingFile = false;
  await Promise.all([ctx.answerCallbackQuery(), show(ctx, mainMenu(ctx))]);
});

admin.callbackQuery('upload', async (ctx) => {
  awaitingFile = true;
  await Promise.all([ctx.answerCallbackQuery(), show(ctx, uploadPrompt())]);
});

admin.callbackQuery('view', async (ctx) => {
  if (!store.list) {
    await ctx.answerCallbackQuery({ text: "Ro'yxat hali yuklanmagan", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  const caption = `📄 Joriy ro'yxat — <b>${store.list.count} ta so'z</b>`;
  if (store.listFileId) {
    try {
      await ctx.replyWithDocument(store.listFileId, { caption, parse_mode: 'HTML' });
      return;
    } catch {
      store.listFileId = null;
    }
  }
  const msg = await ctx.replyWithDocument(new InputFile(LIST_PATH, 'royxat.txt'), { caption, parse_mode: 'HTML' });
  store.listFileId = msg.document?.file_id ?? null;
});

admin.callbackQuery(/^groups:(\d+)$/, async (ctx) => {
  awaitingFile = false;
  await Promise.all([ctx.answerCallbackQuery(), show(ctx, groupsView(ctx, Number(ctx.match[1])))]);
});

admin.callbackQuery(/^([gt]):(-?\d+):(\d+)$/, async (ctx) => {
  const [, action, id, page] = ctx.match;
  const g = action === 't' ? store.toggleGroup(Number(id)) : store.groups.get(Number(id));
  if (!g) {
    await Promise.all([
      ctx.answerCallbackQuery({ text: 'Guruh topilmadi', show_alert: true }),
      show(ctx, groupsView(ctx, Number(page))),
    ]);
    return;
  }
  await Promise.all([
    ctx.answerCallbackQuery(action === 't' ? (g.active ? '🟢 Faollashtirildi' : '🔴 Faolsizlantirildi') : undefined),
    show(ctx, groupView(g, Number(page))),
  ]);
});

admin.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

admin.on('message', async (ctx) => {
  if (!awaitingFile) return;
  const doc = ctx.message.document;

  if (!doc) return fail(ctx, "ro'yxat <b>.txt fayl</b> ko'rinishida yuborilishi kerak.");

  const name = doc.file_name ?? '';
  if (!name.toLowerCase().endsWith('.txt')) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : 'kengaytmasiz';
    return fail(ctx, `fayl <b>.txt</b> formatida bo'lishi kerak. Siz yuborgan fayl: <b>${esc(ext)}</b>`);
  }
  if ((doc.file_size ?? 0) > MAX_FILE_SIZE) {
    return fail(ctx, `fayl hajmi juda katta (${(doc.file_size / 1048576).toFixed(1)} MB). Maksimal hajm: 2 MB.`);
  }

  let buf;
  try {
    const file = await ctx.api.getFile(doc.file_id);
    const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return fail(ctx, `faylni yuklab olib bo'lmadi (${esc(String(e?.description ?? e?.message ?? e))}).`);
  }

  if (buf.length === 0) return fail(ctx, "fayl bo'sh.");

  const text = decode(buf);
  if (text.includes('\u0000')) return fail(ctx, "fayl matnli emas. Oddiy matnli .txt fayl yuboring.");

  const { entries, duplicates, invalid } = parseWordList(text);
  if (entries.length === 0) {
    return fail(ctx, "faylda birorta ham so'z topilmadi. So'zlar vergul bilan ajratilgan bo'lishi kerak.");
  }
  const long = entries.find((e) => e.length > MAX_ENTRY_LENGTH);
  if (long) {
    return fail(
      ctx,
      `juda uzun element topildi — ehtimol so'zlar vergul bilan ajratilmagan:\n<code>${esc(long.slice(0, 60))}…</code>`,
    );
  }
  if (!text.includes(',') && entries.length === 1 && entries[0].split(' ').length > 3) {
    return fail(ctx, "faylda vergul topilmadi. So'zlarni vergul bilan ajrating: <code>so'z1, so'z2, so'z3</code>");
  }

  try {
    store.setList(entries);
  } catch (e) {
    return fail(ctx, `ro'yxatni saqlab bo'lmadi (${esc(String(e?.message ?? e))}).`);
  }
  awaitingFile = false;

  let info = `✅ <b>Ro'yxat saqlandi!</b>\n\nSo'zlar soni: <b>${entries.length} ta</b>`;
  if (duplicates) info += `\nTakroriy so'zlar olib tashlandi: ${duplicates} ta`;
  if (invalid.length) info += `\nHarfsiz elementlar o'tkazib yuborildi: ${invalid.length} ta`;

  const menu = mainMenu(ctx);
  await reply(ctx, { text: info, kb: menu.kb });
});
