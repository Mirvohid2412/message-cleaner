import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // .env bo'lmasa, muhit o'zgaruvchilaridan o'qiladi
}

export const BOT_TOKEN = process.env.BOT_TOKEN?.trim();

const MAX_ADMINS = 50;

/** .env dagi ADMIN1, ADMIN2, … — tartib bilan o'qiladi, bo'sh raqamlar o'tkazib yuboriladi */
function readAdminIds() {
  const ids = [];

  const add = (raw, key) => {
    const value = raw?.trim();
    if (!value) return;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
      console.error(`.env: ${key} noto'g'ri qiymat — e'tiborsiz qoldirildi (${value})`);
      return;
    }
    if (!ids.includes(id)) ids.push(id);
  };

  for (let i = 1; i <= MAX_ADMINS; i++) add(process.env[`ADMIN${i}`], `ADMIN${i}`);
  add(process.env.ADMIN_ID, 'ADMIN_ID'); // eski nom ham ishlayveradi

  return ids;
}

export const ADMIN_IDS = readAdminIds();

/** Foydalanuvchi adminlar ro'yxatidami */
export const isAdmin = (id) => typeof id === 'number' && ADMIN_IDS.includes(id);

if (!BOT_TOKEN || ADMIN_IDS.length === 0) {
  console.error(".env faylida BOT_TOKEN va kamida bitta ADMIN1 ko'rsatilishi kerak");
  process.exit(1);
}
