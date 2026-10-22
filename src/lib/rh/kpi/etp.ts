import { formatDate, monthEnd } from "@/lib/dates";
import { headcountAt } from "@/lib/rh/headcount";
import type { ContractDraft, ContractMonthDraft } from "@/lib/rh/referential/types";
import { quotaUnitLabel } from "@/lib/dsn/labels";
import { memo } from "./memo";
import { countedOpts } from "./period";
import { kpiNd, type ContractRef, type EtpContribution, type EtpMissing, type EtpMonthEnd, type EtpSource, type KpiInput, type KpiNd } from "./types";

// ETP contractuel : quotité ÷ référence (DSN) ou ETP de la fiche (PayFit), arrondi à n décimales, en dix-millièmes entiers.
const INTERPRETED_UNITS = new Set(["10", "12", "20", "21"]); // heures, journées, forfait jours, forfait heures

const pow10 = (n: number) => 10n ** BigInt(n);
const to4 = (x: number) => Math.round(x * 1e4);
const fr4 = (etp4: number) => (etp4 / 1e4).toLocaleString("fr-FR", { maximumFractionDigits: 4 });
const frNum = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 4 });

export function etp4FromQuotas(contractQuota: number, referenceQuota: number, decimals: 2 | 3 | 4): number {
  const cq4 = BigInt(to4(contractQuota));
  const rq4 = BigInt(to4(referenceQuota));
  const units = (2n * cq4 * pow10(decimals) + rq4) / (2n * rq4);
  return Number(units * pow10(4 - decimals));
}

export function etp4FromFte(fte: number, decimals: 2 | 3 | 4): number {
  const x4 = BigInt(to4(fte));
  const step = pow10(4 - decimals);
  return Number(((2n * x4 + step) / (2n * step)) * step);
}

const refOf = (c: ContractDraft): ContractRef => ({ contractKey: c.contractKey, externalId: c.externalId, personKey: c.personKey, establishmentId: c.establishmentId, nature: c.nature });
const inEst = (scope: string[] | undefined, id: string | null) => !scope || (id !== null && scope.includes(id));

function payfitEtp(input: KpiInput, c: ContractDraft): EtpContribution | EtpMissing {
  const { fullTimeIsOne, capAtOne, etpDecimals: d } = input.params;
  const source: EtpSource = { source: "payfit", fteAtRead: c.fteAtRead, isFullTimeAtRead: c.isFullTimeAtRead, weeklyHoursAtRead: c.weeklyHoursAtRead, modalityAtRead: c.modalityAtRead };
  const base = { ...refOf(c), source };
  if (fullTimeIsOne && c.isFullTimeAtRead === true) {
    const checks = c.fteAtRead !== null && to4(c.fteAtRead) !== 10000 ? [`temps plein (isFullTime) mais fullTimeEquivalent = ${frNum(c.fteAtRead)} : 1 retenu (Paramètres)`] : [];
    return { ...base, kind: "etp", etp4: 10000, basis: "payfit_full_time", checks, provenance: c.provenance.isFullTimeAtRead ?? null };
  }
  if (c.fteAtRead !== null) {
    const x4 = to4(c.fteAtRead);
    const checks: string[] = [];
    let etp4: number;
    if (x4 > 10000 && capAtOne) {
      etp4 = 10000;
      checks.push(`fullTimeEquivalent = ${frNum(c.fteAtRead)} ramené à 1 (Paramètres)`);
    } else {
      etp4 = etp4FromFte(c.fteAtRead, d);
      if (x4 > 10000) checks.push(`fullTimeEquivalent = ${frNum(c.fteAtRead)} supérieur à 1, conservé (Paramètres)`);
      if (x4 === 0) checks.push("ETP nul dans PayFit (valeur de la source)");
    }
    return { ...base, kind: "etp", etp4, basis: "payfit_fte", checks, provenance: c.provenance.fteAtRead ?? null };
  }
  const nd = c.fieldsNd.fteAtRead;
  const reason = (nd?.reason ?? "fullTimeEquivalent non renseigné dans PayFit") + (c.isFullTimeAtRead === true && !fullTimeIsOne ? " ; temps plein = 1 désactivé" : "");
  return { ...base, kind: "missing", nd: kpiNd(nd?.code ?? "not-provided", reason) };
}

function dsnEtp(input: KpiInput, c: ContractDraft, month: string): EtpContribution | EtpMissing {
  const { fullTimeIsOne, capAtOne, etpDecimals: d } = input.params;
  const rows = input.data.months
    .filter((m) => m.contractKey === c.contractKey && m.month === month && m.presenceBasis === "declared" && !m.flags.includes("declared_before_start") && !m.flags.includes("declared_after_end") && inEst(input.scope.establishments, m.establishmentId))
    .sort((a, b) => a.establishmentId.localeCompare(b.establishmentId));
  if (!rows.length) return { ...refOf(c), kind: "missing", source: null, nd: kpiNd("disappeared", `contrat non déclaré en ${month}`) };
  const sourceOf = (r: ContractMonthDraft): EtpSource => ({ source: "dsn", month, establishmentId: r.establishmentId, contractQuota: r.contractQuota, referenceQuota: r.referenceQuota, quotaUnit: r.quotaUnit, modality: r.modality });
  const sig = (r: ContractMonthDraft) => [r.contractQuota, r.referenceQuota, r.quotaUnit, r.modality].join("|");
  const r = rows[0];
  const base = { ...refOf(c), source: sourceOf(r) };
  const other = rows.find((x) => sig(x) !== sig(r));
  if (other) {
    return { ...base, kind: "missing", nd: kpiNd("quota-inconsistent", `quotités divergentes entre SIRET ${r.establishmentId} (${r.contractQuota ?? "n.d."}/${r.referenceQuota ?? "n.d."}) et ${other.establishmentId} (${other.contractQuota ?? "n.d."}/${other.referenceQuota ?? "n.d."}) en ${month}`) };
  }
  const checks: string[] = [];
  const readable = r.contractQuota !== null && r.referenceQuota !== null && r.referenceQuota > 0;
  const ratioText = readable ? frNum(Number(etp4FromQuotas(r.contractQuota!, r.referenceQuota!, 4)) / 1e4) : null;
  if (r.modality === null) checks.push("modalité S21.G00.40.014 absente : rapport des quotités");
  if (fullTimeIsOne && r.modality === "10") {
    if (ratioText !== null && etp4FromQuotas(r.contractQuota!, r.referenceQuota!, 4) !== 10000) checks.push(`modalité temps plein (S21.G00.40.014 = 10), rapport ${ratioText} : 1 retenu (Paramètres)`);
    return { ...base, kind: "etp", etp4: 10000, basis: "dsn_full_time_modality", checks, provenance: r.provenance.modality ?? null };
  }
  const missing = (nd: KpiNd): EtpMissing => ({ ...base, kind: "missing", nd });
  if (r.quotaUnit === null) return missing(kpiNd("quota-missing", r.fieldsNd.quotaUnit?.reason ?? "unité de quotité absente (S21.G00.40.011)"));
  if (!INTERPRETED_UNITS.has(r.quotaUnit)) return missing(kpiNd("quota-missing", `unité de quotité ${quotaUnitLabel(r.quotaUnit)} (${r.quotaUnit}) non interprétée (S21.G00.40.011)`));
  if (r.referenceQuota === null) return missing(kpiNd("quota-missing", "S21.G00.40.012 absente"));
  if (r.referenceQuota <= 0) return missing(kpiNd("quota-missing", "quotité de référence nulle (S21.G00.40.012)"));
  if (r.contractQuota === null) return missing(kpiNd("quota-missing", "S21.G00.40.013 absente"));
  const cq4 = to4(r.contractQuota);
  const rq4 = to4(r.referenceQuota);
  let etp4: number;
  if (cq4 > rq4 && capAtOne) {
    etp4 = 10000;
    checks.push(`rapport ${ratioText} (${frNum(r.contractQuota)} / ${frNum(r.referenceQuota)}) ramené à 1 (Paramètres)`);
  } else {
    etp4 = etp4FromQuotas(r.contractQuota, r.referenceQuota, d);
    if (cq4 > rq4) checks.push(`rapport ${ratioText} supérieur à 1, conservé (Paramètres)`);
  }
  if ((r.modality === "20" || r.modality === "21") && etp4 === 10000) checks.push("temps partiel déclaré à quotité pleine");
  return { ...base, kind: "etp", etp4, basis: "dsn_ratio", checks, provenance: r.provenance.contractQuota ?? null };
}

// Quotité d'un contrat compté présent en fin de mois.
export function contractEtp(input: KpiInput, c: ContractDraft, month: string): EtpContribution | EtpMissing {
  return input.data.build.source === "payfit" ? payfitEtp(input, c) : dsnEtp(input, c, month);
}

// ETP contractuel fin de mois : somme des quotités des contrats de l'effectif fin de mois (natures comptées).
export function etpMonthEnd(input: KpiInput, month: string): EtpMonthEnd {
  return memo(input, `etp:${month}`, () => {
    const h = headcountAt(input.data, monthEnd(month), countedOpts(input));
    if (h.kind === "nd") return { month, kind: "nd", nd: kpiNd(h.nd.code, h.nd.reason), missing: [] };
    const byKey = new Map(input.data.contracts.map((c) => [c.contractKey, c]));
    const contributions: EtpContribution[] = [];
    const missing: EtpMissing[] = [];
    for (const key of h.contractKeys) {
      const c = byKey.get(key);
      if (!c) continue;
      const r = contractEtp(input, c, month);
      if (r.kind === "etp") contributions.push(r);
      else missing.push(r);
    }
    if (!contributions.length && missing.length) {
      return { month, kind: "nd", nd: kpiNd("quota-missing", `aucune quotité lisible : ${missing[0].nd.reason}`, { keys: missing.map((m) => m.contractKey) }), missing };
    }
    const qualifiers = [...h.qualifiers];
    if (missing.length) qualifiers.push(`${missing.length} contrat(s) présent(s) sans quotité : total en borne basse`);
    if (input.data.build.source === "payfit") qualifiers.push(`quotités à la date de lecture (${formatDate(input.data.build.referenceDate)}), non historisées par PayFit`);
    return {
      month,
      kind: h.kind === "lower_bound" || missing.length ? "lower_bound" : "exact",
      etp4: contributions.reduce((s, x) => s + x.etp4, 0),
      contributions,
      missing,
      headcount: h,
      qualifiers,
    };
  });
}

export const etp4Text = fr4;
