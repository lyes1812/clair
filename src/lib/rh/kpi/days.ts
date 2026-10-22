import { addDays } from "@/lib/dates";
import type { DayBasis, SlotKey } from "./types";

// Jours calendaires ou du lundi au vendredi (aucun jour férié n'est connu) et créneaux d'absence par demi-journée.
export function isWeekday(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function countDays(from: string, to: string, basis: DayBasis): number {
  return eachDay(from, to).filter((d) => basis === "calendar" || isWeekday(d)).length;
}

export type Bound = { date: string; moment: string | null };

const START: Record<string, number[]> = { "beginning-of-day": [0, 1], "middle-of-day": [1] };
const END: Record<string, number[]> = { "end-of-day": [0, 1], "middle-of-day": [0] };

// Créneaux (jour, matin = 0 | après-midi = 1) d'une absence, bornés à `clip`. Un moment absent ou non interprété en
// premier ou dernier jour ne compte pas ce jour et le rend incertain ; une mi-journée → mi-journée le même jour aussi.
export function absenceSlots(a: { start: Bound; end: Bound }, clip: { from: string; to: string }, basis: DayBasis): { slots: SlotKey[]; uncertain: SlotKey[]; notes: string[] } {
  const from = a.start.date > clip.from ? a.start.date : clip.from;
  const to = a.end.date < clip.to ? a.end.date : clip.to;
  const slots: SlotKey[] = [];
  const uncertain: SlotKey[] = [];
  const notes: string[] = [];
  if (from > to) return { slots, uncertain, notes };
  for (const d of eachDay(from, to)) {
    if (basis === "weekdays" && !isWeekday(d)) continue;
    let set = [0, 1];
    let doubtful = false;
    if (d === a.start.date) {
      const allowed = a.start.moment !== null ? START[a.start.moment] : undefined;
      if (!allowed) {
        doubtful = true;
        set = [];
        notes.push(`début ${a.start.moment ?? "sans moment"} non interprété : ${d} non compté`);
      } else set = set.filter((x) => allowed.includes(x));
    }
    if (d === a.end.date) {
      const allowed = a.end.moment !== null ? END[a.end.moment] : undefined;
      if (!allowed) {
        doubtful = true;
        set = [];
        notes.push(`fin ${a.end.moment ?? "sans moment"} non interprétée : ${d} non compté`);
      } else set = set.filter((x) => allowed.includes(x));
    }
    if (!doubtful && set.length === 0) {
      doubtful = true;
      notes.push(`bornes incohérentes le ${d} (mi-journée → mi-journée) : non compté`);
    }
    for (const x of set) slots.push(`${d}#${x}`);
    if (doubtful) uncertain.push(`${d}#0`, `${d}#1`);
  }
  return { slots, uncertain, notes };
}
