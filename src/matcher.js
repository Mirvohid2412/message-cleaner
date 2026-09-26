// Taqiqlangan so'zlarni tez va noaniq (fuzzy) aniqlash.
// O'xshashlik: 1 - levenshtein / maxUzunlik >= 0.7

const APOS = new Set(["'", '`', '´', 'ʻ', 'ʼ', '‘', '’', 'ʹ', '′', 'ʽ']);

// Kirill -> lotin (o'zbek), shuningdek boshqa diakritik harflar
const CHAR_MAP = new Map(Object.entries({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '',
  э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h', і: 'i', ї: 'i', є: 'e',
  ş: 'sh', ç: 'ch', ğ: 'g', ı: 'i', ö: 'o', ü: 'u', ñ: 'n', ß: 'ss',
}));

// Raqam/belgi bilan yozilgan harflar (faqat keyingi belgi harf bo'lsa almashtiriladi)
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

const LETTER_RE = /\p{L}/u;

// Ko'p adashtiriladigan harflar: h/x (ahmoq/axmoq), q/k (ahmoq/ahmok).
// Bu faqat uzun so'zlarda qo'llanadi — qisqa so'zlarda bitta harf hal qiluvchi: pok / po'q, hech / xach.
const PHONETIC = { h: 'x', q: 'k' };

/** Keyingi belgi (apostroflar o'tkazib yuboriladi): "0'lib" dagi 0 ham harf deb qaraladi */
function nextLetterish(s, i) {
  let j = i + 1;
  while (j < s.length && APOS.has(s[j])) j++;
  return s[j];
}

function isLetter(c) {
  if (c === undefined) return false;
  if (c >= 'a' && c <= 'z') return true;
  return c > '\x7f' && (CHAR_MAP.has(c) || LETTER_RE.test(c));
}

/** Matnni solishtirish uchun yagona ko'rinishga keltiradi: kichik lotin harflar,
 *  bitta bo'shliq bilan ajratilgan, ketma-ket takrorlangan harflar bittaga qisqartirilgan. */
export function normalize(input) {
  const s = input.toLowerCase();
  let out = '';
  let last = ' ';
  for (let i = 0, len = s.length; i < len; i++) {
    const ch = s[i];
    let rep;
    if (ch >= 'a' && ch <= 'z') rep = ch;
    else if (APOS.has(ch)) continue;
    else if ((rep = CHAR_MAP.get(ch)) !== undefined) { /* rep tayyor */ }
    // So'z ichidagi raqam/belgi harf o'rnida: "4hmoq", "kun7", "$1k"
    else if (LEET[ch] !== undefined && (isLetter(nextLetterish(s, i)) || (last >= 'a' && last <= 'z'))) {
      rep = LEET[ch];
    }
    else if (ch > '\x7f') {
      const base = ch.normalize('NFD')[0];
      rep = base >= 'a' && base <= 'z' ? base : LETTER_RE.test(ch) ? ch : ' ';
    } else rep = ' ';

    for (let j = 0; j < rep.length; j++) {
      const c = rep[j];
      if (c !== last) { out += c; last = c; }
    }
  }
  return last === ' ' ? out.slice(0, -1) : out;
}

/** Adashtiriladigan harflarni tenglashtiradi: uzun so'zlarni solishtirish uchun */
export function loosen(s) {
  let out = '';
  let last = '';
  for (let i = 0; i < s.length; i++) {
    const c = PHONETIC[s[i]] ?? s[i];
    if (c !== last) out += (last = c);
  }
  return out;
}

function collapse(s) {
  let out = '';
  let last = '';
  for (let i = 0; i < s.length; i++) if (s[i] !== last) out += (last = s[i]);
  return out;
}

// Levenshtein uchun oldindan ajratilgan xotira (GC bosimisiz)
let rowA = new Int32Array(128);
let rowB = new Int32Array(128);

/**
 * Chegaralangan Levenshtein masofasi.
 * prefix=false: w va t to'liq solishtiriladi.
 * prefix=true : w bilan t ning eng mos boshlanishi solishtiriladi (qo'shimchalar uchun: "so'zlar").
 * Natija > k bo'lsa, k+1 qaytariladi (erta to'xtash).
 */
function distance(w, t, k, prefix) {
  const m = w.length;
  const n = t.length;
  const jEnd = prefix ? Math.min(n, m + k) : n;
  if (m + 1 > rowA.length) { rowA = new Int32Array(m + 64); rowB = new Int32Array(m + 64); }
  let prev = rowA;
  let cur = rowB;
  for (let i = 0; i <= m; i++) prev[i] = i;
  let best = prefix && m <= k ? m : k + 1;

  for (let j = 1; j <= jEnd; j++) {
    const c = t.charCodeAt(j - 1);
    cur[0] = j;
    let rowMin = j;
    for (let i = 1; i <= m; i++) {
      let v = prev[i - 1] + (w.charCodeAt(i - 1) === c ? 0 : 1);
      const del = prev[i] + 1;
      const ins = cur[i - 1] + 1;
      if (del < v) v = del;
      if (ins < v) v = ins;
      cur[i] = v;
      if (v < rowMin) rowMin = v;
    }
    if (prefix && cur[m] < best) best = cur[m];
    if (rowMin > k) return k + 1;
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prefix ? best : prev[m];
}

/**
 * Ruxsat etilgan xatolar soni.
 * Qisqa so'zlarda bitta xato ham butunlay boshqa so'zni beradi (uka/suka, opa/jopa,
 * dollar/mollar), shuning uchun ular faqat aynan mos kelganda o'chiriladi.
 */
function maxEdits(len) {
  if (len <= 6) return 0;
  if (len <= 10) return 1;
  return 2;
}

const CACHE_LIMIT = 100_000;

export class Matcher {
  /** @param {string[]} entries ro'yxatdagi so'zlar/iboralar (xom ko'rinishda) */
  constructor(entries) {
    this.exact = new Set();
    this.words = []; // { w, m, k }
    /** 3+ so'zli iboralar, birinchi so'zi bo'yicha guruhlangan: birinchiSo'z -> [{ w, p }] */
    this.phrases = new Map();
    this.cache = new Map();

    for (const raw of entries) {
      const norm = normalize(raw);
      if (!norm) continue;
      const parts = norm.split(' ');
      const w = collapse(parts.join(''));
      if (this.exact.has(w)) continue;
      this.exact.add(w);
      if (w.length >= 4) this.words.push({ w, m: w.length, k: maxEdits(w.length) });
      if (parts.length >= 3) {
        const first = collapse(parts[0]);
        const group = this.phrases.get(first);
        if (group) group.push({ w, p: parts.length });
        else this.phrases.set(first, [{ w, p: parts.length }]);
      }
    }
    this.words.sort((a, b) => a.m - b.m);
    this.size = this.exact.size;
  }

  /** Bitta nomzod (so'z yoki birlashtirilgan so'zlar) taqiqlangan so'zga mosmi. */
  checkCandidate(t, minLen) {
    const key = minLen ? '#' + t : t; // '#' normalize() natijasida uchramaydi
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    let hit = this.exact.has(t);
    const n = t.length;
    if (!hit) {
      for (let x = 0; x < this.words.length; x++) {
        const e = this.words[x];
        const m = e.m;
        if (m < minLen) continue;
        if (n < m - e.k) break; // so'zlar uzunlik bo'yicha tartiblangan — qolganlari ham mos kelmaydi

        // 1) butun so'z 70% o'xshashlik bilan
        const k = maxEdits(n > m ? n : m);
        if (n - m <= k && m - n <= k && distance(e.w, t, k, false) <= k) { hit = true; break; }

        // 2) so'z boshqa so'zning ichida (qo'shimchalar, old qo'shimchalar).
        //    Qisqa so'zlar uchun ishlatilmaydi: "anal" -> "analiz", "sik" -> "sikl".
        if (n > m) {
          if (m >= 5 && t.startsWith(e.w)) { hit = true; break; }
          if (m >= 7 && t.includes(e.w)) { hit = true; break; }
          if (m >= 9 && distance(e.w, t, e.k, true) <= e.k) { hit = true; break; }
        }
      }
    }

    if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    this.cache.set(key, hit);
    return hit;
  }

  /** Xabar matnida taqiqlangan so'z bormi. */
  test(text) {
    if (this.size === 0 || !text) return false;
    const norm = normalize(text);
    if (!norm) return false;

    // "a h m o q" / "a.h.m.o.q" kabi harfma-harf yozilganlarni birlashtirish
    const raw = norm.split(' ');
    const tokens = [];
    let run = '';
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i];
      if (t.length === 1) { run += t; continue; }
      if (run) { tokens.push(collapse(run)); run = ''; }
      tokens.push(t);
    }
    if (run) tokens.push(collapse(run));

    for (let i = 0; i < tokens.length; i++) {
      if (this.checkCandidate(tokens[i], 0)) return true;
    }

    // Bo'lib yozilgan so'zlar va 2 so'zli iboralar: "ahm oq", "yomon so'z"
    for (let i = 0; i + 1 < tokens.length; i++) {
      if (this.checkCandidate(collapse(tokens[i] + tokens[i + 1]), 5)) return true;
    }

    // 3+ so'zli iboralar: faqat birinchi so'zi mos kelganlari tekshiriladi
    if (this.phrases.size !== 0) {
      for (let i = 0; i < tokens.length; i++) {
        const group = this.phrases.get(tokens[i]);
        if (group === undefined) continue;
        for (let x = 0; x < group.length; x++) {
          const { w, p } = group[x];
          if (i + p > tokens.length) continue;
          const cand = collapse(tokens.slice(i, i + p).join(''));
          if (cand.startsWith(w)) return true;
          const kk = Math.max(maxEdits(w.length), maxEdits(cand.length));
          if (Math.abs(cand.length - w.length) <= kk && distance(w, cand, kk, false) <= kk) return true;
        }
      }
    }
    return false;
  }
}

const MIN_KEY_LENGTH = 3;
const MIN_READABLE_RATIO = 0.6;

/**
 * Ro'yxat faylining matnini tahlil qiladi.
 * Yulduzcha bilan yashirilgan ("h*****i") va belgilardan tanib bo'lmaydigan yozuvlar
 * chetlab o'tiladi — ular oddiy so'zlarni noto'g'ri o'chirishga sabab bo'ladi.
 * @returns {{ entries: string[], duplicates: number, invalid: string[], junk: string[] }}
 */
export function parseWordList(text) {
  const entries = [];
  const invalid = [];
  const junk = [];
  const seen = new Set();
  let duplicates = 0;

  for (const piece of text.split(/[,\r\n]+/)) {
    const entry = piece.trim().replace(/\s+/g, ' ');
    if (!entry) continue;
    const key = normalize(entry).replace(/ /g, '');
    if (!key) { invalid.push(entry); continue; }

    const rawLength = entry.replace(/[\s'`´ʻʼ‘’]/g, '').length;
    if (entry.includes('*') || key.length < MIN_KEY_LENGTH || key.length < rawLength * MIN_READABLE_RATIO) {
      junk.push(entry);
      continue;
    }

    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    entries.push(entry);
  }
  return { entries, duplicates, invalid, junk };
}
