// Reklama: havolalar (sayt, t.me, ijtimoiy tarmoqlar) va boshqa kanal/guruhning @username'i.
// Odam yoki botning @username'i reklama hisoblanmaydi.

const LINK_ENTITIES = new Set(['url', 'text_link']);

// Telegram havola deb tanimaydigan, ataylab buzib yozilgan havolalar:
// "t . me/kanal", "t,me / kanal", "telegram.me/...", "tg://", "instagram . com/..."
const OBFUSCATED = new RegExp(
  [
    String.raw`\b(?:t|telegram)\s*[.,·•]\s*(?:me|dog)\s*[\/\\]\s*[\w+]`,
    String.raw`\btg\s*:\s*\/\/`,
    String.raw`\b(?:instagram|youtube|youtu|tiktok|facebook|fb|vk|twitter|x|threads|ok|telegram|whatsapp|wa|discord|snapchat|pinterest|likee|twitch|reddit)` +
      String.raw`\s*[.,·•]\s*(?:com|be|ru|me|net|org|gg|ly|app|uz|tv)\s*[\/\\]\s*\w`,
    String.raw`\bhttps?\s*:\s*\/\s*\/`,
  ].join('|'),
  'i',
);

function hasLinkButton(markup) {
  const rows = markup?.inline_keyboard;
  if (!rows) return false;
  for (const row of rows) for (const b of row) if (b.url || b.login_url) return true;
  return false;
}

/** Xabarda havola bormi (matn, izoh, yashirin havola, tugma). */
export function hasLink(msg) {
  const entities = msg.entities ?? msg.caption_entities;
  if (entities) for (const e of entities) if (LINK_ENTITIES.has(e.type)) return true;

  if (hasLinkButton(msg.reply_markup)) return true;

  const text = msg.text ?? msg.caption;
  return text !== undefined && OBFUSCATED.test(text);
}

// ───────────── @username: kanal/guruh — reklama, odam/bot — yo'q ─────────────

const MENTION_TTL_CHAT = 24 * 60 * 60 * 1000;
const MENTION_TTL_USER = 6 * 60 * 60 * 1000;
const MENTION_CACHE_LIMIT = 50_000;
const MAX_MENTIONS = 5; // bitta xabarda tekshiriladigan username'lar soni

/** username -> { chatId: number | null, at } | Promise; chatId null — odam, bot yoki mavjud emas */
const mentions = new Map();

/** @returns {Promise<number | null>} kanal/guruh id si yoki null */
async function resolveMention(api, username) {
  const entry = mentions.get(username);
  if (entry instanceof Promise) return entry;
  if (entry && Date.now() - entry.at < (entry.chatId === null ? MENTION_TTL_USER : MENTION_TTL_CHAT)) {
    return entry.chatId;
  }

  const p = api.getChat(`@${username}`).then(
    (c) => {
      const chatId = c.type === 'private' ? null : c.id;
      if (mentions.size >= MENTION_CACHE_LIMIT) mentions.clear();
      mentions.set(username, { chatId, at: Date.now() });
      return chatId;
    },
    (e) => {
      // 400 "chat not found" — bu odam yoki bot (Bot API ularni username orqali ko'rsatmaydi)
      if (e?.error_code === 400) mentions.set(username, { chatId: null, at: Date.now() });
      else mentions.delete(username); // tarmoq xatosi — keyinroq qayta so'raladi
      return null;
    },
  );
  mentions.set(username, p);
  return p;
}

/**
 * Xabarda boshqa kanal yoki guruhning @username'i bormi.
 * Shu guruhning o'zi va unga bog'langan kanal hisobga olinmaydi.
 * @param {() => Promise<number | null | undefined>} getLinkedId guruhga bog'langan kanal (faqat kerak bo'lsa so'raladi)
 */
export async function hasChatMention(api, msg, getLinkedId) {
  const entities = msg.entities ?? msg.caption_entities;
  if (!entities) return false;
  const text = msg.text ?? msg.caption;

  const names = new Set();
  const own = msg.chat.username?.toLowerCase();
  for (const e of entities) {
    if (e.type !== 'mention') continue;
    const name = text.slice(e.offset + 1, e.offset + e.length).toLowerCase();
    if (name && name !== own) names.add(name);
    if (names.size >= MAX_MENTIONS) break;
  }
  if (names.size === 0) return false;

  const ids = await Promise.all([...names].map((n) => resolveMention(api, n)));
  const chats = ids.filter((id) => id !== null && id !== msg.chat.id);
  if (chats.length === 0) return false;

  const linkedId = await getLinkedId();
  if (linkedId === undefined) return false; // aniqlab bo'lmadi — o'z kanali bo'lishi mumkin, tegilmaydi
  return chats.some((id) => id !== linkedId);
}
