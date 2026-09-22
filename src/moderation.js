import { isAdmin } from './config.js';
import { store } from './store.js';
import { hasChatMention, hasLink } from './ads.js';
import { forgetChat, isForeignChannelPost, isFromGroupAdmin, linkedChatId } from './groupAdmins.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Xabar faqat o'sha guruhning egasiga boradi */
function notifyAdmin(api, adminId, text) {
  api.sendMessage(adminId, text, { parse_mode: 'HTML' }).catch(() => {});
}

const NO_RIGHTS =
  "\n\n⚠️ Bot xabarlarni o'chira olishi uchun uni guruhda <b>admin</b> qiling va " +
  "<b>«Xabarlarni o'chirish»</b> huquqini bering.";

/**
 * Guruhdagi xabar jimgina o'chiriladi, agar:
 *  - so'z filtri yoqilgan va guruh egasining ro'yxatidagi so'z bo'lsa, yoki
 *  - reklama filtri yoqilgan va xabarda havola yoki boshqa kanal/guruhning @username'i bo'lsa, yoki
 *  - xabar begona kanal nomidan yozilgan bo'lsa (filtrlardan qat'i nazar, guruh faol bo'lsa doim).
 * Guruh adminlari va egasining xabarlariga tegilmaydi.
 */
export async function moderate(ctx) {
  const msg = ctx.update.message ?? ctx.update.edited_message;
  if (!msg) return;
  const chat = msg.chat;

  if (msg.migrate_to_chat_id) {
    store.migrateGroup(chat.id, msg.migrate_to_chat_id);
    forgetChat(chat.id);
    return;
  }

  const found = store.groupOf(chat.id);
  if (!found) return;

  const { group: g, adminId } = found;
  if (g.title !== chat.title) store.setTitle(chat.id, chat.title);
  if (!g.active) return;

  const ads = g.ads !== false;
  const api = ctx.api;

  // Tekshiruvlar arzonidan qimmatiga: avval xotirada, API so'rovi faqat kerak bo'lsa.
  // Adminlik esa faqat xabar o'chirilishi kerak bo'lib chiqqandagina tekshiriladi.
  let violation = ads && hasLink(msg);
  if (!violation && g.words !== false) {
    const matcher = store.admins.get(adminId)?.matcher; // har bir guruh — o'z egasining ro'yxati bilan
    const text = msg.text ?? msg.caption;
    violation = matcher != null && text !== undefined && matcher.test(text);
  }
  if (!violation) violation = await isForeignChannelPost(api, msg);
  if (!violation && ads) violation = await hasChatMention(api, msg, () => linkedChatId(api, chat.id));
  if (!violation) return;

  if (await isFromGroupAdmin(api, msg)) return;
  api.deleteMessage(chat.id, msg.message_id).catch(() => {});
}

/** Bot guruhga qo'shilganda / chiqarilganda / huquqlari o'zgarganda. */
export async function onMyChatMember(ctx) {
  const { chat, from, old_chat_member: oldM, new_chat_member: m } = ctx.myChatMember;
  const isIn = (s) => s.status === 'member' || s.status === 'administrator' || (s.status === 'restricted' && s.is_member);
  const title = chat.title ?? 'Guruh';

  if (!isIn(m)) {
    forgetChat(chat.id);
    const removed = store.removeGroup(chat.id);
    if (removed) {
      notifyAdmin(ctx.api, removed.adminId, `❌ Bot <b>${esc(removed.group.title)}</b> guruhidan chiqarildi.`);
    }
    return;
  }

  const canDelete = m.status === 'administrator' && m.can_delete_messages === true;
  const existing = store.groupOf(chat.id);

  if (!existing) {
    if (!isAdmin(from.id)) {
      // Botni faqat adminlar qo'sha oladi — begona guruhdan darhol chiqib ketadi
      if (!isIn(oldM)) await ctx.api.leaveChat(chat.id).catch(() => {});
      return;
    }
    // Guruh uni qo'shgan adminga biriktiriladi — boshqa adminlar uni ko'rmaydi
    store.upsertGroup(from.id, chat.id, title, canDelete);
    notifyAdmin(ctx.api, from.id, `✅ Bot <b>${esc(title)}</b> guruhiga qo'shildi.` + (canDelete ? '' : NO_RIGHTS));
    return;
  }

  const { group, adminId } = existing;
  if (group.canDelete !== canDelete) {
    store.upsertGroup(adminId, chat.id, title, canDelete);
    notifyAdmin(
      ctx.api,
      adminId,
      canDelete
        ? `✅ <b>${esc(title)}</b> guruhida bot endi xabarlarni o'chira oladi.`
        : `⚠️ <b>${esc(title)}</b> guruhida botning xabarlarni o'chirish huquqi olib qo'yildi.` + NO_RIGHTS,
    );
  }
}
