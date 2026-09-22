// Guruh adminlari va bog'langan kanal keshi. Telegram'dan faqat o'chirilishi kerak bo'lgan xabar chiqqandagina so'raladi,
// oddiy xabarlar uchun hech qanday API so'rovi yuborilmaydi.

const TTL = 10 * 60 * 1000;

const TELEGRAM_SERVICE = 777000; // bog'langan kanal postlari
const GROUP_ANONYMOUS_BOT = 1087968824; // anonim admin

/** @type {Map<number, { ids: Set<number>, at: number } | Promise<Set<number> | null>>} */
const cache = new Map();

async function load(api, chatId) {
  try {
    const list = await api.getChatAdministrators(chatId);
    const ids = new Set(list.map((m) => m.user.id));
    cache.set(chatId, { ids, at: Date.now() });
    return ids;
  } catch {
    cache.delete(chatId);
    return null;
  }
}

async function adminIds(api, chatId) {
  const entry = cache.get(chatId);
  if (entry instanceof Promise) return entry;
  if (entry && Date.now() - entry.at < TTL) return entry.ids;
  const p = load(api, chatId); // bir vaqtdagi so'rovlar bitta so'rovga birlashadi
  cache.set(chatId, p);
  return p;
}

const LINKED_TTL = 60 * 60 * 1000;

/** @type {Map<number, { id: number | null, at: number } | Promise<number | null | undefined>>} */
const linked = new Map();

/**
 * Guruhga bog'langan kanal (izohlar guruhi bo'lsa) id si.
 * null — bog'langan kanal yo'q, undefined — aniqlab bo'lmadi (API xatosi).
 */
export async function linkedChatId(api, chatId) {
  const entry = linked.get(chatId);
  if (entry instanceof Promise) return entry;
  if (entry && Date.now() - entry.at < LINKED_TTL) return entry.id;

  const p = api.getChat(chatId).then(
    (c) => {
      const id = c.linked_chat_id ?? null;
      linked.set(chatId, { id, at: Date.now() });
      return id;
    },
    () => {
      linked.delete(chatId);
      return undefined;
    },
  );
  linked.set(chatId, p);
  return p;
}

/**
 * Kanal nomidan yozilgan xabar begona kanalniki bo'lsa — true.
 * Guruhning o'zi (anonim admin) va guruhga bog'langan kanal begona emas.
 */
export async function isForeignChannelPost(api, msg) {
  const sender = msg.sender_chat;
  if (!sender || sender.id === msg.chat.id || msg.is_automatic_forward) return false;
  const own = await linkedChatId(api, msg.chat.id);
  return own !== undefined && own !== sender.id;
}

/**
 * Xabar egasi guruh admini yoki egasimi.
 * Aniqlab bo'lmasa (API xatosi) — true: admin xabarini adashib o'chirgandan ko'ra qoldirgan yaxshi.
 */
export async function isFromGroupAdmin(api, msg) {
  const chat = msg.chat;
  // Guruh nomidan yozgan anonim admin yoki bog'langan kanal (posti yoki shu kanal nomidan izoh)
  if (msg.sender_chat) return !(await isForeignChannelPost(api, msg));
  const userId = msg.from?.id;
  if (userId === undefined) return false;
  if (userId === TELEGRAM_SERVICE || userId === GROUP_ANONYMOUS_BOT) return true;

  const ids = await adminIds(api, chat.id);
  return ids === null ? true : ids.has(userId);
}

/** chat_member update: kimdir admin bo'ldi yoki adminlikdan olindi — kesh darhol yangilanadi. */
export function onChatMember(ctx) {
  const { chat, new_chat_member: m } = ctx.chatMember;
  const entry = cache.get(chat.id);
  if (!entry || entry instanceof Promise) return;
  if (m.status === 'administrator' || m.status === 'creator') entry.ids.add(m.user.id);
  else entry.ids.delete(m.user.id);
}

export function forgetChat(chatId) {
  cache.delete(chatId);
  linked.delete(chatId);
}
