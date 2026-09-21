import { ADMIN_ID } from './config.js';
import { store } from './store.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function notifyAdmin(api, text) {
  api.sendMessage(ADMIN_ID, text, { parse_mode: 'HTML' }).catch(() => {});
}

const NO_RIGHTS =
  "\n\n⚠️ Bot xabarlarni o'chira olishi uchun uni guruhda <b>admin</b> qiling va " +
  "<b>«Xabarlarni o'chirish»</b> huquqini bering.";

/** Guruhdagi xabar: taqiqlangan so'z bo'lsa jimgina o'chiriladi. Guruhga hech narsa yozilmaydi. */
export function moderate(ctx) {
  const msg = ctx.update.message ?? ctx.update.edited_message;
  if (!msg) return;
  const chat = msg.chat;

  if (msg.migrate_to_chat_id) {
    store.migrateGroup(chat.id, msg.migrate_to_chat_id);
    return;
  }

  const g = store.groups.get(chat.id);
  if (!g) return;
  if (g.title !== chat.title) store.setTitle(chat.id, chat.title);
  if (!g.active || !store.matcher) return;

  const text = msg.text ?? msg.caption;
  if (text && store.matcher.test(text)) {
    ctx.api.deleteMessage(chat.id, msg.message_id).catch(() => {});
  }
}

/** Bot guruhga qo'shilganda / chiqarilganda / huquqlari o'zgarganda. */
export async function onMyChatMember(ctx) {
  const { chat, from, old_chat_member: oldM, new_chat_member: m } = ctx.myChatMember;
  const isIn = (s) => s.status === 'member' || s.status === 'administrator' || (s.status === 'restricted' && s.is_member);
  const title = chat.title ?? 'Guruh';

  if (!isIn(m)) {
    const g = store.removeGroup(chat.id);
    if (g) notifyAdmin(ctx.api, `❌ Bot <b>${esc(g.title)}</b> guruhidan chiqarildi.`);
    return;
  }

  const canDelete = m.status === 'administrator' && m.can_delete_messages === true;
  const existing = store.groups.get(chat.id);

  if (!existing) {
    // Botni faqat admin guruhlarga qo'sha oladi — begona guruhdan darhol chiqib ketadi
    if (!isIn(oldM) && from.id !== ADMIN_ID) {
      await ctx.api.leaveChat(chat.id).catch(() => {});
      return;
    }
    store.upsertGroup(chat.id, title, canDelete);
    notifyAdmin(ctx.api, `✅ Bot <b>${esc(title)}</b> guruhiga qo'shildi.` + (canDelete ? '' : NO_RIGHTS));
    return;
  }

  if (existing.canDelete !== canDelete) {
    store.upsertGroup(chat.id, title, canDelete);
    notifyAdmin(
      ctx.api,
      canDelete
        ? `✅ <b>${esc(title)}</b> guruhida bot endi xabarlarni o'chira oladi.`
        : `⚠️ <b>${esc(title)}</b> guruhida botning xabarlarni o'chirish huquqi olib qo'yildi.` + NO_RIGHTS,
    );
  }
}
