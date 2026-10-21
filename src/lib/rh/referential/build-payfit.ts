import type { SyncSummary } from "@/lib/connectors/sync";
import type { SourceRecordInput } from "@/lib/connectors/types";
import { addMonths, formatDate, isActiveOn, monthEnd, monthOf, monthsBetween, overlapsMonth } from "@/lib/dates";
import { applyCommonRules, finding, sortOutputs, sortRecords, summarize } from "./common";
import { RH_BUILDER_VERSION, rhInputsHash } from "./hash";
import { nd, type BuildHeader, type ContractDraft, type ContractMonthDraft, type EventDraft, type FieldNd, type FindingDraft, type PersonDraft, type Provenance, type RhBuildInputs, type RhBuildResult } from "./types";

// Constructeur pur du référentiel depuis la lecture PayFit appliquée (photographie à la date de lecture, § 4.1).
// Hypothèse B4 à confirmer sur le compte pilote : PayFit ne renvoie plus les contrats archivés depuis plus d'un an ;
// null = l'API renvoie tout (jamais de borne basse).
export const PAYFIT_ARCHIVED_RETENTION_MONTHS: number | null = 12;

export type PayFitBuildInput = {
  sync: { id: string; startedAt: Date; decidedAt: Date | null; scope: { months?: string[] }; summary: SyncSummary; contentHash: string | null };
  records: SourceRecordInput[];
};

const parisDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function buildFromPayFit(input: PayFitBuildInput): RhBuildResult {
  const { sync } = input;
  const records = sortRecords(input.records);
  const referenceDate = parisDate(sync.startedAt);
  const readLabel = `lecture du ${formatDate(referenceDate)}`;
  const scopeMonths = [...(sync.scope.months ?? [])].filter((m): m is string => typeof m === "string").sort();
  const outcomes = sync.summary.collections ?? [];
  const unavailable = (c: string): string | null => {
    const o = outcomes.find((x) => x.collection === c);
    if (!o) return `collection ${c} absente de la lecture appliquée`;
    return o.status === "unavailable" ? o.reason : null;
  };

  const companyRec = records.find((r) => r.collection === "company");
  const company = companyRec
    ? { id: String(companyRec.data.id), name: String(companyRec.data.name ?? ""), identificationNumber: str(companyRec.data.identificationNumber) }
    : (sync.summary.company ?? null);
  const establishment = company?.id ?? "payfit";
  const siren = company?.identificationNumber && /^\d{9}$/.test(company.identificationNumber) ? company.identificationNumber : null;
  const inputs: RhBuildInputs = {
    source: "payfit",
    syncId: sync.id,
    startedAt: sync.startedAt.toISOString(),
    decidedAt: sync.decidedAt?.toISOString() ?? null,
    contentHash: sync.contentHash,
    scopeMonths,
    company,
    collections: outcomes,
  };
  const presenceTo = monthOf(referenceDate);
  const header: BuildHeader = {
    source: "payfit",
    builderVersion: RH_BUILDER_VERSION,
    inputsHash: rhInputsHash({ source: "payfit", syncs: [{ id: sync.id, contentHash: sync.contentHash }] }),
    inputs,
    referenceDate,
    presenceFrom: presenceTo,
    presenceTo,
    summary: { persons: 0, contracts: 0, months: 0, events: 0, findings: 0 },
    unavailableReason: null,
  };

  const contractsUnavailable = unavailable("contracts");
  if (contractsUnavailable) {
    return { build: { ...header, unavailableReason: contractsUnavailable }, persons: [], contracts: [], months: [], events: [], coverage: [], findings: [] };
  }

  const prov = (collection: string, recordKey: string, period: string | null, path: string): Provenance => ({
    syncId: sync.id,
    collection,
    recordKey,
    period,
    path,
    label: `PayFit · ${readLabel} · ${collection} · ${recordKey} · ${path}`,
  });
  const findings: FindingDraft[] = [];

  // --- Personnes (collaborators) : une fiche par identifiant collaborateur, noms = libellés d'affichage.
  const persons = new Map<string, PersonDraft>();
  const collaboratorsUnavailable = unavailable("collaborators");
  const newPerson = (id: string): PersonDraft => ({
    personKey: `payfit:${id}`,
    externalId: id,
    identifierKind: "payfit",
    siren,
    establishmentIds: [establishment],
    familyName: null,
    givenNames: null,
    usageName: null,
    employeeNumber: null,
    teamName: null,
    hasContract: false,
    firstDeclaredMonth: null,
    lastDeclaredMonth: null,
    fieldsNd: {
      usageName: nd("not-in-source", "PayFit n'expose pas le nom d'usage"),
      firstDeclaredMonth: nd("not-in-source", "lecture PayFit : pas de déclaration mensuelle"),
      lastDeclaredMonth: nd("not-in-source", "lecture PayFit : pas de déclaration mensuelle"),
    },
    provenance: {},
  });
  const NAME_FIELDS: [keyof Pick<PersonDraft, "familyName" | "givenNames" | "employeeNumber" | "teamName">, string][] = [
    ["familyName", "lastName"],
    ["givenNames", "firstName"],
    ["employeeNumber", "employeeNumber"],
    ["teamName", "teamName"],
  ];
  for (const r of records) {
    if (r.collection !== "collaborators") continue;
    const id = String(r.data.id);
    const p = newPerson(id);
    for (const [field, path] of NAME_FIELDS) {
      const v = str(r.data[path]);
      if (v === null) p.fieldsNd[field] = nd("not-provided", "non renseigné dans PayFit");
      else {
        p[field] = v;
        p.provenance[field] = prov("collaborators", id, null, path);
      }
    }
    persons.set(p.personKey, p);
  }
  const stubPerson = (id: string, reason: FieldNd): PersonDraft => {
    const p = newPerson(id);
    for (const [field] of NAME_FIELDS) p.fieldsNd[field] = reason;
    return p;
  };

  // --- Contrats
  const contracts: ContractDraft[] = [];
  const months: ContractMonthDraft[] = [];
  const events: EventDraft[] = [];
  const retention = PAYFIT_ARCHIVED_RETENTION_MONTHS;
  const windowStart = retention !== null ? addMonths(presenceTo, -retention) : null;
  const timeUnavailable = unavailable("worked_time");
  const timeByKey = new Map<string, SourceRecordInput>();
  for (const r of records) if (r.collection === "worked_time") timeByKey.set(r.key, r);
  const scopeLabel = scopeMonths.length ? `${scopeMonths[0]} → ${scopeMonths[scopeMonths.length - 1]}` : "aucun";
  let minStart: string | null = null;

  for (const r of records) {
    if (r.collection !== "contracts") continue;
    const d = r.data;
    const cid = String(d.contractId);
    const key = `payfit:${cid}`;
    const collaboratorId = str(d.collaboratorId);
    const startDate = str(d.startDate);
    const endDate = str(d.endDate);
    const status = str(d.status);
    const nature = str(d.natureContratDsn);
    const timeRead = d.timeInformation === "read";
    const c: ContractDraft = {
      contractKey: key,
      externalId: cid,
      personKey: collaboratorId ? `payfit:${collaboratorId}` : null,
      establishmentId: establishment,
      startDate,
      endDate,
      endReason: null,
      endStatus: "unpositioned",
      nature,
      statusSource: status,
      fteAtRead: timeRead ? numOrNull(d.fullTimeEquivalent) : null,
      weeklyHoursAtRead: timeRead ? numOrNull(d.standardWeeklyHours) : null,
      isFullTimeAtRead: timeRead ? boolOrNull(d.isFullTime) : null,
      modalityAtRead: timeRead ? str(d.workingTimeModality) : null,
      executive: boolOrNull(d.executive),
      firstDeclaredMonth: null,
      lastDeclaredMonth: null,
      fieldsNd: {
        endReason: nd("not-in-source", "PayFit n'expose pas le motif de fin"),
        firstDeclaredMonth: nd("not-in-source", "lecture PayFit : pas de déclaration mensuelle"),
        lastDeclaredMonth: nd("not-in-source", "lecture PayFit : pas de déclaration mensuelle"),
      },
      provenance: { externalId: prov("contracts", cid, null, "contractId"), establishmentId: prov("company", establishment, null, "id") },
    };
    const trace = (field: keyof ContractDraft, path: string, missing: FieldNd) => {
      if (c[field] === null) c.fieldsNd[field] = missing;
      else c.provenance[field] = prov("contracts", cid, null, path);
    };
    trace("startDate", "startDate", nd("not-provided", "date de début absente dans PayFit"));
    trace("nature", "natureContratDsn", nd("not-provided", "nature de contrat absente dans PayFit"));
    trace("statusSource", "status", nd("not-provided", "statut absent dans PayFit"));
    const timeMissing = timeRead ? nd("not-provided", "non renseigné dans PayFit") : nd("scope-missing", "droit contracts:time-information:read non accordé à la clé");
    trace("fteAtRead", "fullTimeEquivalent", timeMissing);
    trace("weeklyHoursAtRead", "standardWeeklyHours", timeMissing);
    trace("isFullTimeAtRead", "isFullTime", timeMissing);
    trace("modalityAtRead", "workingTimeModality", timeMissing);
    trace("executive", "estCadreDirigeant", nd("not-provided", "non renseigné dans PayFit"));

    // Personne liée (B5, B6, B6 bis) : l'identifiant de source est conservé tel quel, jamais rapproché par le nom.
    if (!collaboratorId) {
      c.fieldsNd.personKey = nd("no-person", "contrat sans collaborateur dans PayFit");
      findings.push(finding("contract-without-person", { contracts: [key], message: `contrat ${cid} sans collaborateur dans la lecture PayFit`, provenance: { collaboratorId: prov("contracts", cid, null, "collaboratorId") } }));
    } else {
      c.provenance.personKey = prov("contracts", cid, null, "collaboratorId");
      let p = persons.get(c.personKey!);
      if (!p) {
        p = collaboratorsUnavailable
          ? stubPerson(collaboratorId, nd("scope-missing", collaboratorsUnavailable))
          : stubPerson(collaboratorId, nd("not-provided", `collaborateur absent de la collection collaborators de la ${readLabel}`));
        persons.set(p.personKey, p);
        if (!collaboratorsUnavailable) {
          findings.push(finding("person-not-in-collaborators", { persons: [p.personKey], contracts: [key], message: `collaborateur ${collaboratorId} référencé par le contrat ${cid} mais absent de la collection collaborators` }));
        }
      }
      p.hasContract = true;
    }

    // Fin (B7, B8) et nature (C11).
    if (startDate === null) {
      c.endStatus = "unpositioned";
      findings.push(finding("no-start-date", { contracts: [key], persons: c.personKey ? [c.personKey] : [], message: `contrat ${cid} sans date de début : non positionnable, hors effectif` }));
    } else if (endDate !== null) {
      c.endStatus = "known";
      c.provenance.endDate = prov("contracts", cid, null, "endDate");
    } else if (nature === "01") {
      c.endStatus = "none_cdi";
    } else if (nature !== null) {
      c.endStatus = "none_other_nature";
      c.fieldsNd.endDate = nd("not-provided", "fin non renseignée dans PayFit");
      findings.push(finding("end-not-provided", { contracts: [key], persons: c.personKey ? [c.personKey] : [], message: `contrat ${cid} de nature ${nature} sans date de fin renseignée : présent à toute date depuis son début` }));
    } else {
      c.endStatus = "none_nature_nd";
      c.fieldsNd.endDate = nd("not-provided", "fin non renseignée et nature absente dans PayFit");
    }
    if (nature === null) findings.push(finding("nature-unknown", { contracts: [key], persons: c.personKey ? [c.personKey] : [], message: `contrat ${cid} sans nature de contrat : hors effectif, affiché à part` }));
    if (status === "PENDING") {
      const past = startDate !== null && startDate <= referenceDate;
      findings.push(
        finding("pending", {
          contracts: [key],
          persons: c.personKey ? [c.personKey] : [],
          severity: past ? "check" : "info",
          message: past ? `contrat ${cid} en attente chez PayFit avec une date de début passée (${formatDate(startDate)})` : `contrat ${cid} en attente chez PayFit${startDate ? ` (début le ${formatDate(startDate)})` : " (sans date de début)"}`,
        }),
      );
    }
    contracts.push(c);
    if (startDate !== null && (minStart === null || startDate < minStart)) minStart = startDate;
  }

  const presenceFrom = minStart !== null && monthOf(minStart) < presenceTo ? monthOf(minStart) : presenceTo;
  const allMonths = monthsBetween(presenceFrom, presenceTo);

  // --- Mois et événements des contrats positionnés.
  for (const c of contracts) {
    if (c.startDate === null) continue;
    const cid = c.externalId;
    for (const M of allMonths) {
      if (!overlapsMonth(c.startDate, c.endDate, M)) continue;
      const row: ContractMonthDraft = {
        contractKey: c.contractKey,
        month: M,
        establishmentId: establishment,
        presenceBasis: "dates",
        presentAnyDay: true,
        presentMonthEnd: isActiveOn(c.startDate, c.endDate, monthEnd(M)),
        nature: null,
        referenceQuota: null,
        contractQuota: null,
        quotaUnit: null,
        modality: null,
        paidTime: null,
        workedTime: null,
        timeUnit: null,
        paymentCount: null,
        flags: [],
        fieldsNd: {},
        provenance: { presentAnyDay: prov("contracts", cid, null, "startDate, endDate"), presentMonthEnd: prov("contracts", cid, null, "startDate, endDate") },
      };
      const notHistorized = nd("not-in-source", "non historisé par PayFit : valeur à la date de lecture sur la fiche");
      for (const f of ["nature", "referenceQuota", "contractQuota", "quotaUnit", "modality"] as const) row.fieldsNd[f] = notHistorized;
      row.fieldsNd.paymentCount = nd("not-in-source", "PayFit n'expose pas les versements");
      if (timeUnavailable) {
        row.fieldsNd.paidTime = nd("scope-missing", timeUnavailable);
        row.fieldsNd.workedTime = nd("scope-missing", timeUnavailable);
      } else if (!scopeMonths.includes(M)) {
        const out = nd("month-out-of-scope", `mois hors du périmètre de la lecture appliquée (mois lus : ${scopeLabel})`);
        row.fieldsNd.paidTime = out;
        row.fieldsNd.workedTime = out;
      } else {
        const t = timeByKey.get(`${cid}@${M}`);
        if (!t) {
          const none = nd("no-time-line", `aucune ligne de temps PayFit pour ce contrat en ${M}`);
          row.fieldsNd.paidTime = none;
          row.fieldsNd.workedTime = none;
          row.flags.push("time_missing");
          findings.push(finding("time-missing", { contracts: [c.contractKey], persons: c.personKey ? [c.personKey] : [], month: M, message: `contrat ${cid} présent en ${M} sans ligne de temps dans la lecture` }));
        } else {
          const unit = str(t.data.unit);
          row.timeUnit = unit;
          if (unit !== null) row.provenance.timeUnit = prov("worked_time", t.key, M, "unit");
          const cells: [keyof Pick<ContractMonthDraft, "paidTime" | "workedTime">, string][] = [
            ["paidTime", "paidWorkedTime"],
            ["workedTime", "effectiveWorkedTime"],
          ];
          for (const [field, path] of cells) {
            const v = numOrNull(t.data[path]);
            if (v === null) row.fieldsNd[field] = nd("not-provided", "temps absent de PayFit pour ce mois");
            else {
              row[field] = v;
              row.provenance[field] = prov("worked_time", t.key, M, path);
              if (v < 0) {
                if (!row.flags.includes("negative_time")) row.flags.push("negative_time");
                findings.push(finding("negative-time", { contracts: [c.contractKey], persons: c.personKey ? [c.personKey] : [], month: M, message: `temps ${path === "paidWorkedTime" ? "payé" : "travaillé"} négatif (${v}) pour le contrat ${cid} en ${M} : régularisation PayFit conservée telle quelle`, provenance: { [field]: prov("worked_time", t.key, M, path) } }));
              }
            }
          }
        }
      }
      months.push(row);
    }

    const entry: EventDraft = {
      kind: "entry",
      date: c.startDate,
      month: monthOf(c.startDate),
      contractKey: c.contractKey,
      personKey: c.personKey,
      establishmentId: establishment,
      nature: c.nature,
      endReason: null,
      flags: [],
      fieldsNd: {},
      provenance: { date: prov("contracts", cid, null, "startDate") },
    };
    if (c.startDate > referenceDate) entry.flags.push("future");
    if (c.statusSource === "PENDING") entry.flags.push("pending");
    if (windowStart !== null && entry.month < windowStart) entry.flags.push("lower_bound_window");
    events.push(entry);
    if (c.endDate !== null) {
      const exit: EventDraft = {
        kind: "exit",
        date: c.endDate,
        month: monthOf(c.endDate),
        contractKey: c.contractKey,
        personKey: c.personKey,
        establishmentId: establishment,
        nature: c.nature,
        endReason: null,
        flags: [],
        fieldsNd: { endReason: nd("not-in-source", "PayFit n'expose pas le motif de fin") },
        provenance: { date: prov("contracts", cid, null, "endDate") },
      };
      if (c.endDate > referenceDate) exit.flags.push("future");
      if (windowStart !== null && exit.month < windowStart) exit.flags.push("lower_bound_window");
      events.push(exit);
    }
  }

  // --- Couverture par mois (B4, F1, F5).
  const coverage = allMonths.map((M) => {
    const lower = windowStart !== null && M < windowStart;
    const timeStatus = timeUnavailable ? "unavailable" : scopeMonths.includes(M) ? "read" : "out_of_scope";
    return {
      establishmentId: establishment,
      month: M,
      presenceStatus: lower ? ("lower_bound" as const) : ("complete" as const),
      presenceReason: lower ? `PayFit ne renvoie plus les contrats archivés depuis plus de ${retention} mois (hypothèse à confirmer) : borne basse, ${readLabel}` : null,
      timeStatus: timeStatus as "unavailable" | "read" | "out_of_scope",
      timeReason: timeUnavailable ? timeUnavailable : timeStatus === "out_of_scope" ? `mois hors du périmètre de la lecture appliquée (mois lus : ${scopeLabel})` : null,
      declarationKeys: [] as string[],
      provenance: {} as Record<string, Provenance>,
    };
  });
  const lowerMonths = coverage.filter((c) => c.presenceStatus === "lower_bound");
  if (lowerMonths.length) {
    findings.push(
      finding("lower-bound-window", {
        message: `effectifs en borne basse de ${lowerMonths[0].month} à ${lowerMonths[lowerMonths.length - 1].month} : contrats archivés depuis plus de ${retention} mois absents de PayFit (hypothèse à confirmer)`,
        detail: { from: lowerMonths[0].month, to: lowerMonths[lowerMonths.length - 1].month, retentionMonths: retention },
      }),
    );
  }

  for (const p of persons.values()) {
    if (!p.hasContract) findings.push(finding("person-without-contract", { persons: [p.personKey], message: `aucun contrat connu dans la lecture PayFit du ${formatDate(referenceDate)}` }));
  }

  applyCommonRules(contracts, events, findings);
  const result: RhBuildResult = { build: { ...header, presenceFrom, presenceTo }, persons: [...persons.values()], contracts, months, events, coverage, findings };
  sortOutputs(result);
  result.build.summary = summarize(result);
  return result;
}
