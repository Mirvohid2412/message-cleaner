import { Composer, InlineKeyboard, InputFile } from 'grammy';
import { BOT_TOKEN } from './config.js';
import { parseWordList } from './matcher.js';
import { listPath, store } from './store.js';

const PAGE_SIZE = 10;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_ENTRY_LENGTH = 100;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Fayl kutilayotgan adminlar — har bir admin uchun alohida holat */
const awaitingFile = new Set();

export const admin = new Composer();

// ───────────────────────── Ko'rinishlar ─────────────────────────

const addGroupUrl = (ctx) =>
  `https://t.me/${ctx.me.username}?startgroup=true&admin=delete_messages`;

function mainMenu(ctx) {
  const me = store.for(ctx.from.id);
  const groups = [...me.groups.values()];
  const active = groups.filter((g) => g.active).length;

  const text =
    '👋 <b>Assalomu alaykum!</b>\n\n' +
    "Bot guruhlarda oddiy a'zolarning taqiqlangan so'z yoki reklama bor xabarlarini avtomatik o'chiradi.\n" +
    "Reklama: havolalar va boshqa kanal/guruhning @username'i. " +
    "Begona kanal nomidan yozilgan xabarlar ham o'chiriladi.\n" +
    "Adminlar va guruh egasining xabarlariga tegilmaydi.\n\n" +
    `📄 Ro'yxat: <b>${me.list ? `${me.list.count} ta so'z` : 'yuklanmagan'}</b>\n` +
    `👥 Guruhlar: <b>${groups.length} ta</b>${groups.length ? ` (faol: ${active})` : ''}`;

  const kb = new InlineKeyboard();
  if (me.list) kb.text("📄 Ro'yxatni ko'rish", 'view').text("🔄 Ro'yxatni yangilash", 'upload').row();
  else kb.text("📥 Ro'yxatni yuklash", 'upload').row();
  // Guruh bo'lsa — guruhlar tugmasi (qo'shish tugmasi guruhlar sahifasida), bo'lmasa — qo'shish tugmasi
  if (groups.length) kb.text(`👥 Guruhlar (${groups.length})`, 'groups:0');
  else kb.url("➕ Guruhga qo'shish", addGroupUrl(ctx));

  return { text, kb };
}

function uploadPrompt(ctx) {
  const me = store.for(ctx.from.id);
  const text =
    (me.list
      ? "🔄 <b>Yangi ro'yxat faylini yuboring.</b>\nEski ro'yxat o'chirilib, o'rniga yangisi ishlatiladi.\n\n"
      : "📥 <b>Ro'yxat faylini yuboring.</b>\n\n") +
    'Talablar:\n' +
    '• Fayl <b>.txt</b> formatida bo\'lishi kerak\n' +
    "• So'zlar <b>vergul</b> bilan ajratilgan bo'lishi kerak\n\n" +
    "Masalan: <code>so'z1, so'z2, so'z3</code>";
  return { text, kb: new InlineKeyboard().text('❌ Bekor qilish', 'menu') };
}

function groupsView(ctx, page) {
  const groups = [...store.for(ctx.from.id).groups.values()];
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
  kb.text('⬅️ Orqaga', 'menu').row().url("➕ Guruhga qo'shish", addGroupUrl(ctx)); // eng pastda

  const text = groups.length
    ? `👥 <b>Guruhlar</b> (${groups.length} ta)\n\n🟢 — faol, 🔴 — faolsiz\nBoshqarish uchun guruhni tanlang.`
    : "👥 Hozircha guruhlar yo'q.\nBotni guruhga qo'shish uchun pastdagi tugmani bosing.";
  return { text, kb };
}

function groupView(ctx, g, page) {
  const words = g.words !== false;
  const ads = g.ads !== false;
  const noList = words && !store.for(ctx.from.id).list;

  const text =
    `👥 <b>${esc(g.title)}</b>\n\n` +
    `Holati: ${g.active ? '🟢 <b>Faol</b>' : '🔴 <b>Faolsiz</b>'}\n` +
    `🚫 So'z filtri: ${words ? '✅ yoqilgan' : "❌ o'chirilgan"}${noList ? " (⚠️ ro'yxat yuklanmagan)" : ''}\n` +
    `📢 Reklama filtri: ${ads ? '✅ yoqilgan' : "❌ o'chirilgan"}\n` +
    `Huquq: ${g.canDelete ? "✅ xabarlarni o'chira oladi" : "⚠️ xabarlarni o'chirish huquqi yo'q (botni admin qiling)"}`;
  // Tugma nomi — bosilganda nima bo'lishi
  const kb = new InlineKeyboard()
    .text(g.active ? '🔴 Faolsizlantirish' : '🟢 Faollashtirish', `t:${g.id}:${page}`)
    .row()
    .text(words ? "🚫 So'z filtrini o'chirish" : "✅ So'z filtrini yoqish", `w:${g.id}:${page}`)
    .row()
    .text(ads ? "📢 Reklama filtrini o'chirish" : '✅ Reklama filtrini yoqish', `a:${g.id}:${page}`)
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
  awaitingFile.delete(ctx.from.id);
  await reply(ctx, mainMenu(ctx));
});

admin.callbackQuery('menu', async (ctx) => {
  awaitingFile.delete(ctx.from.id);
  await Promise.all([ctx.answerCallbackQuery(), show(ctx, mainMenu(ctx))]);
});

admin.callbackQuery('upload', async (ctx) => {
  awaitingFile.add(ctx.from.id);
  await Promise.all([ctx.answerCallbackQuery(), show(ctx, uploadPrompt(ctx))]);
});

admin.callbackQuery('view', async (ctx) => {
  const me = store.for(ctx.from.id);
  if (!me.list) {
    await ctx.answerCallbackQuery({ text: "Ro'yxat hali yuklanmagan", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  const caption = `📄 Joriy ro'yxat — <b>${me.list.count} ta so'z</b>`;
  if (me.listFileId) {
    try {
      await ctx.replyWithDocument(me.listFileId, { caption, parse_mode: 'HTML' });
      return;
    } catch {
      me.listFileId = null;
    }
  }
  const msg = await ctx.replyWithDocument(new InputFile(listPath(me.id), 'royxat.txt'), {
    caption,
    parse_mode: 'HTML',
  });
  me.listFileId = msg.document?.file_id ?? null;
});

admin.callbackQuery(/^groups:(\d+)$/, async (ctx) => {
  awaitingFile.delete(ctx.from.id);
  await Promise.all([ctx.answerCallbackQuery(), show(ctx, groupsView(ctx, Number(ctx.match[1])))]);
});

const OPTION_KEYS = { w: 'words', a: 'ads' };

function toastFor(action, g) {
  if (action === 't') return g.active ? '🟢 Faollashtirildi' : '🔴 Faolsizlantirildi';
  if (action === 'w') return g.words !== false ? "🚫 So'z filtri yoqildi" : "So'z filtri o'chirildi";
  if (action === 'a') return g.ads !== false ? '📢 Reklama filtri yoqildi' : "Reklama filtri o'chirildi";
  return undefined;
}

admin.callbackQuery(/^([gtwa]):(-?\d+):(\d+)$/, async (ctx) => {
  const [, action, rawId, rawPage] = ctx.match;
  const adminId = ctx.from.id;
  const chatId = Number(rawId);
  const page = Number(rawPage);

  // groupFor / toggle* faqat shu adminning guruhini qaytaradi — boshqanikiga tegib bo'lmaydi
  const g =
    action === 't' ? store.toggleGroup(adminId, chatId)
    : action === 'g' ? store.groupFor(adminId, chatId)
    : store.toggleOption(adminId, chatId, OPTION_KEYS[action]);
  if (!g) {
    await Promise.all([
      ctx.answerCallbackQuery({ text: 'Guruh topilmadi', show_alert: true }),
      show(ctx, groupsView(ctx, page)),
    ]);
    return;
  }
  await Promise.all([
    ctx.answerCallbackQuery(toastFor(action, g)),
    show(ctx, groupView(ctx, g, page)),
  ]);
});

admin.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

admin.on('message', async (ctx) => {
  const adminId = ctx.from.id;
  if (!awaitingFile.has(adminId)) return;
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

  const { entries, duplicates, invalid, junk } = parseWordList(text);
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
    store.setList(adminId, entries);
  } catch (e) {
    return fail(ctx, `ro'yxatni saqlab bo'lmadi (${esc(String(e?.message ?? e))}).`);
  }
  awaitingFile.delete(adminId);

  let info = `✅ <b>Ro'yxat saqlandi!</b>\n\nSo'zlar soni: <b>${entries.length} ta</b>`;
  if (duplicates) info += `\nTakroriy so'zlar olib tashlandi: ${duplicates} ta`;
  if (invalid.length) info += `\nHarfsiz elementlar o'tkazib yuborildi: ${invalid.length} ta`;
  if (junk.length) {
    info +=
      `\nTanib bo'lmaydigan yozuvlar o'tkazib yuborildi: <b>${junk.length} ta</b>\n` +
      `<i>Masalan: ${esc(junk.slice(0, 3).join(', '))}</i>\n` +
      "Yulduzcha bilan yashirilgan (<code>h***i</code>) va belgilardan iborat yozuvlar oddiy so'zlarni " +
      "noto'g'ri o'chiradi, shuning uchun ishlatilmaydi. So'zlarni to'liq yozing.";
  }

  const menu = mainMenu(ctx);
  await reply(ctx, { text: info, kb: menu.kb });
});
