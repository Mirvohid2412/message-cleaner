import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';
import { autoRetry } from '@grammyjs/auto-retry';
import { ADMIN_IDS, BOT_TOKEN, isAdmin } from './src/config.js';
import { moderate, onMyChatMember } from './src/moderation.js';
import { admin } from './src/admin.js';
import { onChatMember } from './src/groupAdmins.js';

const bot = new Bot(BOT_TOKEN);

// 429 (flood) va vaqtinchalik tarmoq xatolarida so'rovni avtomatik takrorlash
bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }));

// Birinchi filtr: guruhlar darhol moderatsiyaga, shaxsiy chatda faqat adminlar o'tadi
bot.use((ctx, next) => {
  const type = ctx.chat?.type;
  if (type === 'group' || type === 'supergroup') {
    if (ctx.update.my_chat_member) return onMyChatMember(ctx);
    if (ctx.update.chat_member) return onChatMember(ctx);
    return moderate(ctx);
  }
  if (type === 'private' && isAdmin(ctx.from?.id)) return next();
  // boshqa hamma narsa e'tiborsiz qoldiriladi
});

bot.use(admin);

bot.catch(({ error }) => console.error('Xatolik:', error));

await bot.init();

// Buyruqlar menyusi: faqat /start, faqat shaxsiy chatda; guruhlarda menyu yo'q
await Promise.all([
  bot.api.setMyCommands([{ command: 'start', description: 'Botni ishga tushirish' }], {
    scope: { type: 'all_private_chats' },
  }),
  bot.api.deleteMyCommands(),
  bot.api.deleteMyCommands({ scope: { type: 'all_group_chats' } }),
  bot.api.setChatMenuButton({ menu_button: { type: 'commands' } }),
]).catch((e) => console.error('Buyruqlar menyusini sozlab bo\'lmadi:', e.message));

// Bot tavsifi: bo'sh chatda /start dan oldin (description) va profilda (short description) ko'rinadi
const DESCRIPTION =
  "🧹 Guruhlarni reklama va nomaqbul so'zlardan avtomatik tozalovchi bot.\n\n" +
  "Guruhda oddiy a'zolarning quyidagi xabarlarini jimgina o'chiradi:\n" +
  "• taqiqlangan so'zlar — imlo xatosi, kirill yozuvi yoki harflarni ajratib yozilgan bo'lsa ham\n" +
  "• havolalar: saytlar, Telegram kanal va guruhlar, ijtimoiy tarmoqlar\n" +
  "• boshqa kanal yoki guruhning @username'i\n" +
  "• begona kanal nomidan yozilgan xabarlar\n\n" +
  "Adminlar va guruh egasining xabarlariga tegmaydi. Guruhga hech narsa yozmaydi.";
const SHORT_DESCRIPTION =
  "🧹 Guruhdan reklama, havolalar va taqiqlangan so'zlarni avtomatik o'chiradi. Adminlarga tegmaydi.";

// Faqat o'zgargan bo'lsa yuboriladi — har ishga tushishda keraksiz so'rov bo'lmasin
await Promise.all([
  bot.api.getMyDescription().then(({ description }) =>
    description === DESCRIPTION ? null : bot.api.setMyDescription(DESCRIPTION)),
  bot.api.getMyShortDescription().then(({ short_description }) =>
    short_description === SHORT_DESCRIPTION ? null : bot.api.setMyShortDescription(SHORT_DESCRIPTION)),
]).catch((e) => console.error('Bot tavsifini sozlab bo\'lmadi:', e.message));

const runner = run(bot, {
  runner: {
    fetch: { allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member'] },
  },
});

console.log(`@${bot.botInfo.username} ishga tushdi — ${ADMIN_IDS.length} ta admin: ${ADMIN_IDS.join(', ')}`);

const stop = () => runner.isRunning() && runner.stop();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
