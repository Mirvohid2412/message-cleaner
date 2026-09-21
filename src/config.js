import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // .env bo'lmasa, muhit o'zgaruvchilaridan o'qiladi
}

export const BOT_TOKEN = process.env.BOT_TOKEN?.trim();
export const ADMIN_ID = Number(process.env.ADMIN_ID);

if (!BOT_TOKEN || !Number.isSafeInteger(ADMIN_ID)) {
  console.error(".env faylida BOT_TOKEN va ADMIN_ID to'g'ri ko'rsatilishi kerak");
  process.exit(1);
}
