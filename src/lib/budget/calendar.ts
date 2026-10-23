// Calendrier des jours ouvrés en France métropolitaine : lundi à vendredi hors jours fériés légaux (1er janvier, lundi de
// Pâques, 1er mai, 8 mai, Ascension, lundi de Pentecôte, 14 juillet, 15 août, 1er novembre, 11 novembre, 25 décembre).
// Les dates mobiles viennent de la date de Pâques (algorithme grégorien de Meeus/Jones/Butcher), valable pour toute année :
// 2026, 2027, 2028, 2029… Non pris en compte : jours fériés locaux d'Alsace-Moselle, ponts et jours de fermeture.
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const DAY = 86_400_000;

export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(utc(year, month, day));
}

const cache = new Map<number, Set<string>>();
export function holidays(year: number): Set<string> {
  let s = cache.get(year);
  if (!s) {
    const e = Date.parse(`${easter(year)}T00:00:00Z`);
    s = new Set([iso(utc(year, 1, 1)), iso(e + DAY), iso(utc(year, 5, 1)), iso(utc(year, 5, 8)), iso(e + 39 * DAY), iso(e + 50 * DAY), iso(utc(year, 7, 14)), iso(utc(year, 8, 15)), iso(utc(year, 11, 1)), iso(utc(year, 11, 11)), iso(utc(year, 12, 25))]);
    cache.set(year, s);
  }
  return s;
}

export function isWorkday(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays(Number(date.slice(0, 4))).has(date);
}

// Jours ouvrés d'un intervalle de dates [from, to] bornes incluses.
export function workdays(from: string, to: string): number {
  let n = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) if (isWorkday(iso(t))) n += 1;
  return n;
}
