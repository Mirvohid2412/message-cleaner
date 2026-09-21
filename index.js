import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';
import { autoRetry } from '@grammyjs/auto-retry';
import { ADMIN_ID, BOT_TOKEN } from './src/config.js';
import { moderate, onMyChatMember } from './src/moderation.js';
import { admin } from './src/admin.js';

const bot = new Bot(BOT_TOKEN);

// 429 (flood) va vaqtinchalik tarmoq xatolarida so'rovni avtomatik takrorlash
bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }));

// Birinchi filtr: guruhlar darhol moderatsiyaga, shaxsiy chatda faqat admin o'tadi
bot.use((ctx, next) => {
  const type = ctx.chat?.type;
  if (type === 'group' || type === 'supergroup') {
    return ctx.update.my_chat_member ? onMyChatMember(ctx) : moderate(ctx);
  }
  if (type === 'private' && ctx.from?.id === ADMIN_ID) return next();
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

const runner = run(bot, {
  runner: {
    fetch: { allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member'] },
  },
});

console.log(`@${bot.botInfo.username} ishga tushdi`);

const stop = () => runner.isRunning() && runner.stop();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
