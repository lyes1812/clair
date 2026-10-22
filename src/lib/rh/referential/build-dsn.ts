import type { SourceRecordInput } from "@/lib/connectors/types";
import { addMonths, formatDate, isActiveOn, monthEnd, monthOf, monthsBetween, overlapsMonth } from "@/lib/dates";
import type { CoverageRow } from "@/lib/dsn/selection";
import { applyCommonRules, finding, sortOutputs, sortRecords, summarize } from "./common";
import { RH_BUILDER_VERSION, rhInputsHash } from "./hash";
import { nd, type BuildHeader, type ContractDraft, type ContractMonthDraft, type CoverageDraft, type EventDraft, type FindingDraft, type PersonDraft, type Provenance, type RhBuildInputs, type RhBuildResult } from "./types";

// Constructeur pur du référentiel depuis les déclarations DSN retenues (§ 4.2) : seules les paires
// (dépôt, déclaration) retenues par la couverture sont lues ; rien n'est fusionné par le nom.
export type DsnBuildInput = {
  coverage: CoverageRow[]; // dsnCoverage(workspaceId)
  syncs: { id: string; decidedAt: Date | null; contentHash: string | null }[]; // dépôts appliqués
  records: (SourceRecordInput & { syncId: string })[]; // declarations, people, contracts, remunerations, activities des dépôts appliqués
};

type Decl = { key: string; syncId: string; month: string; siret: string; siren: string | null; order: bigint; orderText: string; fraction: string | null; filename: string | null; complete: boolean };
type Rec = SourceRecordInput & { syncId: string };
type Occ = { decl: Decl; rec: Rec };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cmp = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
const declOrder = (a: Decl, b: Decl) => cmp(a.month, b.month) || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0) || cmp(a.key, b.key);
const parseOrder = (v: unknown): bigint => {
  try {
    return typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : 0n;
  } catch {
    return 0n;
  }
};

export function buildFromDsn(input: DsnBuildInput): RhBuildResult {
  const selectedPairs = input.coverage.flatMap((r) => (r.status === "blocked" ? [] : r.selected.map((d) => ({ syncId: d.sourceId, key: d.key }))));
  const selected = new Set(selectedPairs.map((p) => `${p.syncId}\u0000${p.key}`));
  const declKeyOf = (r: Rec) => str(r.data.declarationKey) ?? str(r.data.key) ?? "";
  const records = sortRecords(input.records.filter((r) => selected.has(`${r.syncId}\u0000${declKeyOf(r)}`)));
  const covStatus = new Map(input.coverage.map((r) => [`${r.siret}|${r.month}`, r.status]));

  // --- Déclarations retenues (ordre : mois, numéro d'ordre, clé) et couverture.
  const decls = new Map<string, Decl>();
  for (const r of records) {
    if (r.collection !== "declarations") continue;
    const month = str(r.data.month);
    const siret = str(r.data.siret);
    if (!month || !siret) continue;
    decls.set(`${r.syncId}\u0000${r.key}`, {
      key: r.key,
      syncId: r.syncId,
      month,
      siret,
      siren: str(r.data.siren),
      order: parseOrder(r.data.order),
      orderText: str(r.data.order) ?? "n.d.",
      fraction: str(r.data.fraction),
      filename: str(r.data.filename),
      complete: covStatus.get(`${siret}|${month}`) === "complete",
    });
  }
  const coverage: CoverageDraft[] = input.coverage.map((r) => ({
    establishmentId: r.siret,
    month: r.month,
    presenceStatus: r.status,
    presenceReason: r.messages.join(" ") || null,
    timeStatus: "paid_only",
    timeReason: "temps travaillé non porté par la DSN",
    declarationKeys: r.status === "blocked" ? [] : r.selected.map((d) => d.key),
    provenance: {},
  }));
  // Mois manquants : de la première déclaration du SIRET jusqu'au dernier mois vu tous établissements confondus,
  // pour qu'un établissement qui cesse de déclarer rende le total n.d. plutôt qu'exact sans lui (C5). Décision par
  // défaut : un établissement qui apparaît plus tard n'est pas réputé manquant avant sa première déclaration.
  const monthsBySiret = new Map<string, string[]>();
  for (const r of input.coverage) monthsBySiret.set(r.siret, [...(monthsBySiret.get(r.siret) ?? []), r.month]);
  const globalLast = [...input.coverage.map((r) => r.month)].sort().pop() ?? null;
  for (const [siret, ms] of monthsBySiret) {
    const sorted = [...ms].sort();
    for (const M of monthsBetween(sorted[0], globalLast ?? sorted[sorted.length - 1])) {
      if (covStatus.has(`${siret}|${M}`)) continue;
      covStatus.set(`${siret}|${M}`, "missing" as CoverageRow["status"]);
      coverage.push({ establishmentId: siret, month: M, presenceStatus: "missing", presenceReason: `aucune déclaration appliquée pour ${M} (SIRET ${siret})`, timeStatus: "paid_only", timeReason: "temps travaillé non porté par la DSN", declarationKeys: [], provenance: {} });
    }
  }
  const completeMonths = [...new Set(input.coverage.filter((r) => r.status === "complete").map((r) => r.month))].sort();
  const presenceFrom = completeMonths[0] ?? null;
  const presenceTo = completeMonths[completeMonths.length - 1] ?? null;
  const referenceDate = presenceTo ? monthEnd(presenceTo) : null;
  const completeFor = (siret: string) => input.coverage.filter((r) => r.siret === siret && r.status === "complete").map((r) => r.month).sort();

  const inputs: RhBuildInputs = {
    source: "dsn",
    syncs: [...input.syncs].sort((a, b) => cmp(a.id, b.id)).map((s) => ({ id: s.id, contentHash: s.contentHash, decidedAt: s.decidedAt?.toISOString() ?? null })),
    coverage: input.coverage.map((r) => ({
      siret: r.siret,
      month: r.month,
      status: r.status,
      selected: r.selected.map((d) => ({ key: d.key, sourceId: d.sourceId, filename: decls.get(`${d.sourceId}\u0000${d.key}`)?.filename ?? null })),
      messages: r.messages,
    })),
  };
  const header: BuildHeader = {
    source: "dsn",
    builderVersion: RH_BUILDER_VERSION,
    inputsHash: rhInputsHash({ source: "dsn", syncs: input.syncs.map((s) => ({ id: s.id, contentHash: s.contentHash })), selected: selectedPairs }),
    inputs,
    referenceDate,
    presenceFrom,
    presenceTo,
    summary: { persons: 0, contracts: 0, months: 0, events: 0, findings: 0 },
    unavailableReason: null,
  };
  const prov = (occ: Occ, path: string): Provenance => ({
    syncId: occ.decl.syncId,
    collection: occ.rec.collection,
    recordKey: occ.rec.key,
    period: occ.decl.month,
    path,
    declarationKey: occ.decl.key,
    label: `DSN ${occ.decl.month} · SIRET ${occ.decl.siret} · ordre ${occ.decl.orderText} · ${path}`,
  });
  const findings: FindingDraft[] = [];
  const declOf = (r: Rec) => decls.get(`${r.syncId}\u0000${declKeyOf(r)}`) ?? null;

  // --- Personnes : une fiche par identifiant (empreinte du NIR ou du NTT), libellés de la déclaration la plus récente.
  const occByPerson = new Map<string, Occ[]>();
  for (const r of records) {
    if (r.collection !== "people") continue;
    const decl = declOf(r);
    const personId = str(r.data.personId);
    if (!decl || !personId) continue;
    occByPerson.set(personId, [...(occByPerson.get(personId) ?? []), { decl, rec: r }]);
  }
  const persons = new Map<string, PersonDraft>();
  const PERSON_FIELDS: [keyof Pick<PersonDraft, "familyName" | "givenNames" | "usageName" | "employeeNumber">, string][] = [
    ["familyName", "S21.G00.30.002"],
    ["givenNames", "S21.G00.30.004"],
    ["usageName", "S21.G00.30.003"],
    ["employeeNumber", "S21.G00.30.019"],
  ];
  for (const [personId, occs] of occByPerson) {
    occs.sort((a, b) => declOrder(b.decl, a.decl)); // la plus récente d'abord
    const latest = occs[0];
    const kind = str(latest.rec.data.identifierKind) === "ntt" ? "ntt" : "nir";
    const personKey = `dsn:${personId}`;
    const p: PersonDraft = {
      personKey,
      externalId: personId,
      identifierKind: kind,
      siren: latest.decl.siren ?? latest.decl.siret.slice(0, 9),
      establishmentIds: [...new Set(occs.map((o) => o.decl.siret))].sort(),
      familyName: null,
      givenNames: null,
      usageName: null,
      employeeNumber: null,
      teamName: null,
      hasContract: false,
      firstDeclaredMonth: occs[occs.length - 1].decl.month,
      lastDeclaredMonth: latest.decl.month,
      fieldsNd: { teamName: nd("not-in-source", "non porté par la DSN") },
      provenance: { externalId: prov(latest, kind === "ntt" ? "S21.G00.30.020" : "S21.G00.30.001"), firstDeclaredMonth: prov(occs[occs.length - 1], "S20.G00.05.005"), lastDeclaredMonth: prov(latest, "S20.G00.05.005") },
    };
    for (const [field, path] of PERSON_FIELDS) {
      const occ = occs.find((o) => str(o.rec.data[field]) !== null);
      if (!occ) p.fieldsNd[field] = nd("not-provided", "non renseigné dans les déclarations retenues");
      else {
        p[field] = str(occ.rec.data[field]);
        p.provenance[field] = prov(occ, path);
      }
    }
    persons.set(personKey, p);
    if (kind === "ntt") findings.push(finding("ntt-identity", { persons: [personKey], message: "identifiant temporaire (NTT) : à vérifier quand le NIR sera connu ; aucun rapprochement automatique" }));
    const byMonth = new Map<string, Occ[]>();
    for (const o of occs) byMonth.set(`${o.decl.siret}|${o.decl.month}`, [...(byMonth.get(`${o.decl.siret}|${o.decl.month}`) ?? []), o]);
    for (const [, list] of byMonth) {
      if (new Set(list.map((o) => o.decl.key)).size > 1) {
        findings.push(finding("fraction-duplicate", { persons: [personKey], month: list[0].decl.month, message: `personne présente dans ${list.length} déclarations retenues du même mois (fractions) : une seule fiche`, detail: { declarationKeys: list.map((o) => o.decl.key).sort() } }));
      }
    }
  }

  // --- Contrats : une ligne par identifiant de contrat (SIREN + personne + numéro + début).
  const occByContract = new Map<string, Occ[]>();
  for (const r of records) {
    if (r.collection !== "contracts") continue;
    const decl = declOf(r);
    const contractId = str(r.data.contractId);
    if (!decl || !contractId) continue;
    occByContract.set(contractId, [...(occByContract.get(contractId) ?? []), { decl, rec: r }]);
  }
  const remunerations = new Map<string, number>(); // `${declKey}|${contractId}` → nombre de blocs 51
  const activities = new Map<string, { unit: string | null; measure: number; rec: Rec }[]>();
  for (const r of records) {
    const decl = declOf(r);
    const contractId = str(r.data.contractId);
    if (!decl || !contractId) continue;
    const k = `${decl.key}|${contractId}`;
    if (r.collection === "remunerations") remunerations.set(k, (remunerations.get(k) ?? 0) + 1);
    else if (r.collection === "activities" && str(r.data.type) === "01") {
      const measure = numOrNull(r.data.measure);
      if (measure !== null) activities.set(k, [...(activities.get(k) ?? []), { unit: str(r.data.unit), measure, rec: r }]);
    }
  }

  const contracts: ContractDraft[] = [];
  const months: ContractMonthDraft[] = [];
  const events: EventDraft[] = [];
  const stubPerson = (personId: string, occ: Occ): PersonDraft => ({
    personKey: `dsn:${personId}`,
    externalId: personId,
    identifierKind: "nir",
    siren: occ.decl.siren ?? occ.decl.siret.slice(0, 9),
    establishmentIds: [occ.decl.siret],
    familyName: null,
    givenNames: null,
    usageName: null,
    employeeNumber: null,
    teamName: null,
    hasContract: true,
    firstDeclaredMonth: occ.decl.month,
    lastDeclaredMonth: occ.decl.month,
    fieldsNd: Object.fromEntries(["familyName", "givenNames", "usageName", "employeeNumber"].map((f) => [f, nd("not-provided", "individu absent du bloc S21.G00.30 de la déclaration retenue")])),
    provenance: {},
  });

  for (const [contractId, occs] of occByContract) {
    occs.sort((a, b) => declOrder(a.decl, b.decl)); // la plus ancienne d'abord
    const first = occs[0];
    const latest = occs[occs.length - 1];
    const personId = str(latest.rec.data.personId);
    if (!personId) throw new Error(`enregistrement contracts DSN sans identifiant de personne : ${latest.rec.key}`);
    const personKey = `dsn:${personId}`;
    const contractKey = `dsn:${contractId}`;
    const startDate = str(first.rec.data.startDate) ?? str(latest.rec.data.startDate);
    const withEnd = occs.filter((o) => str(o.rec.data.endDate) !== null);
    const endOcc = withEnd[withEnd.length - 1] ?? null;
    const endDate = endOcc ? str(endOcc.rec.data.endDate) : null;
    const nature = str(latest.rec.data.nature);
    const c: ContractDraft = {
      contractKey,
      externalId: str(latest.rec.data.contractNumber) ?? contractId,
      personKey,
      establishmentId: latest.decl.siret,
      startDate,
      endDate,
      endReason: endOcc ? str(endOcc.rec.data.endReason) : null,
      endStatus: "unpositioned",
      nature,
      statusSource: null,
      fteAtRead: null,
      weeklyHoursAtRead: null,
      isFullTimeAtRead: null,
      modalityAtRead: null,
      executive: null,
      firstDeclaredMonth: first.decl.month,
      lastDeclaredMonth: latest.decl.month,
      fieldsNd: {
        statusSource: nd("not-in-source", "non porté par la DSN"),
        fteAtRead: nd("not-in-source", "quotités par mois sur la DSN (voir la table mensuelle)"),
        weeklyHoursAtRead: nd("not-in-source", "quotités par mois sur la DSN (voir la table mensuelle)"),
        isFullTimeAtRead: nd("not-in-source", "quotités par mois sur la DSN (voir la table mensuelle)"),
        modalityAtRead: nd("not-in-source", "modalité par mois sur la DSN (voir la table mensuelle)"),
        executive: nd("not-in-source", "non porté par la DSN"),
      },
      provenance: {
        externalId: prov(latest, "S21.G00.40.009"),
        personKey: prov(latest, persons.get(personKey)?.identifierKind === "ntt" ? "S21.G00.30.020" : "S21.G00.30.001"),
        establishmentId: prov(latest, "S21.G00.11.001"),
        firstDeclaredMonth: prov(first, "S20.G00.05.005"),
        lastDeclaredMonth: prov(latest, "S20.G00.05.005"),
      },
    };
    if (startDate !== null) c.provenance.startDate = prov(first, "S21.G00.40.001");
    else c.fieldsNd.startDate = nd("not-provided", "date de début absente (S21.G00.40.001)");
    if (nature !== null) c.provenance.nature = prov(latest, "S21.G00.40.007");
    else {
      c.fieldsNd.nature = nd("not-provided", "nature de contrat absente (S21.G00.40.007)");
      findings.push(finding("nature-unknown", { contracts: [contractKey], persons: [personKey], message: `contrat ${c.externalId} sans nature de contrat : hors effectif, affiché à part` }));
    }
    if (endOcc) {
      c.provenance.endDate = prov(endOcc, "S21.G00.62.001");
      if (c.endReason !== null) c.provenance.endReason = prov(endOcc, "S21.G00.62.002");
      else c.fieldsNd.endReason = nd("not-provided", "motif de rupture absent (S21.G00.62.002)");
      const values = withEnd.map((o) => ({ endDate: str(o.rec.data.endDate), declarationKey: o.decl.key }));
      if (new Set(values.map((v) => v.endDate)).size > 1) {
        findings.push(finding("end-conflict", { contracts: [contractKey], persons: [personKey], message: `fins de contrat différentes déclarées pour ${c.externalId} : ${values.map((v) => `${formatDate(v.endDate)} (${v.declarationKey})`).join(", ")} ; la plus récente fait foi`, detail: { values }, provenance: { endDate: prov(endOcc, "S21.G00.62.001") } }));
      }
    } else {
      c.fieldsNd.endReason = nd("not-provided", "aucune fin déclarée");
    }
    let person = persons.get(personKey);
    if (!person) {
      person = stubPerson(personId, latest);
      persons.set(personKey, person);
    }
    person.hasContract = true;

    // Mois déclarés : une ligne par (déclaration retenue, SIRET), attributs de cette déclaration (C12).
    const declaredMonths = new Set<string>();
    const byMonthSiret = new Map<string, Occ[]>(); // fractions d'un même mois : attributs de la première, versements et activités cumulés
    for (const o of occs) {
      declaredMonths.add(o.decl.month);
      const mk = `${o.decl.month}|${o.decl.siret}`;
      byMonthSiret.set(mk, [...(byMonthSiret.get(mk) ?? []), o]);
    }
    for (const group of byMonthSiret.values()) {
      const o = group[0];
      const M = o.decl.month;
      // Fractions d'un même mois aux attributs différents : la première fait foi, le désaccord est signalé (C4 bis).
      const differing = group.slice(1).filter((g) => (["nature", "referenceQuota", "contractQuota", "unit", "modality"] as const).some((f) => (g.rec.data[f] ?? null) !== (o.rec.data[f] ?? null)));
      if (differing.length) {
        findings.push(finding("fraction-conflict", { contracts: [contractKey], persons: [personKey], month: M, message: `contrat ${c.externalId} : attributs différents entre les fractions retenues de ${M} (${[o, ...differing].map((g) => g.decl.key).join(", ")}) ; la fraction ${o.decl.fraction ?? "n.d."} fait foi`, detail: { declarationKeys: [o, ...differing].map((g) => g.decl.key) }, provenance: { nature: prov(o, "S21.G00.40.007") } }));
      }
      const row: ContractMonthDraft = {
        contractKey,
        month: M,
        establishmentId: o.decl.siret,
        presenceBasis: "declared",
        presentAnyDay: false,
        presentMonthEnd: false,
        nature: str(o.rec.data.nature),
        referenceQuota: numOrNull(o.rec.data.referenceQuota),
        contractQuota: numOrNull(o.rec.data.contractQuota),
        quotaUnit: str(o.rec.data.unit),
        modality: str(o.rec.data.modality),
        paidTime: null,
        workedTime: null,
        timeUnit: null,
        paymentCount: 0,
        flags: [],
        fieldsNd: { workedTime: nd("not-in-source", "non porté par la DSN") },
        provenance: { presentAnyDay: prov(o, "S21.G00.40.001"), presentMonthEnd: prov(o, "S21.G00.40.001") },
      };
      const attrs: [keyof Pick<ContractMonthDraft, "nature" | "referenceQuota" | "contractQuota" | "quotaUnit" | "modality">, string][] = [
        ["nature", "S21.G00.40.007"],
        ["referenceQuota", "S21.G00.40.012"],
        ["contractQuota", "S21.G00.40.013"],
        ["quotaUnit", "S21.G00.40.011"],
        ["modality", "S21.G00.40.014"],
      ];
      for (const [field, path] of attrs) {
        if (row[field] === null) row.fieldsNd[field] = nd("not-provided", `rubrique ${path} absente`);
        else row.provenance[field] = prov(o, path);
      }
      if (startDate !== null) {
        if (startDate > monthEnd(M)) {
          row.flags.push("declared_before_start");
          findings.push(finding("declared-before-start", { contracts: [contractKey], persons: [personKey], month: M, message: `contrat ${c.externalId} déclaré en ${M} avant son début du ${formatDate(startDate)}` }));
        } else if (endDate !== null && monthOf(endDate) < M) {
          if (str(o.rec.data.endDate) === null) {
            row.flags.push("declared_after_end");
            findings.push(finding("declared-after-end", { contracts: [contractKey], persons: [personKey], month: M, message: `contrat ${c.externalId} déclaré en ${M} après sa fin du ${formatDate(endDate)} : régularisation ou rupture annulée ?` }));
          }
        } else {
          row.presentAnyDay = overlapsMonth(startDate, endDate, M);
          row.presentMonthEnd = isActiveOn(startDate, endDate, monthEnd(M));
          if (endDate !== null) row.provenance.presentMonthEnd = prov(endOcc!, "S21.G00.62.001");
        }
      }
      row.paymentCount = group.reduce((n, g) => n + (remunerations.get(`${g.decl.key}|${contractId}`) ?? 0), 0);
      if (row.paymentCount === 0) row.fieldsNd.paymentCount = nd("no-payment", `aucun versement déclaré pour ce contrat en ${M}`);
      else row.provenance.paymentCount = prov(group.find((g) => (remunerations.get(`${g.decl.key}|${contractId}`) ?? 0) > 0) ?? o, "S21.G00.51");
      const acts = group.flatMap((g) => activities.get(`${g.decl.key}|${contractId}`) ?? []);
      if (acts.length === 0) row.fieldsNd.paidTime = nd("no-activity", `aucune activité déclarée pour ce contrat en ${M}`);
      else if (new Set(acts.map((a) => a.unit)).size > 1) row.fieldsNd.paidTime = nd("mixed-units", `activités en unités hétérogènes (${[...new Set(acts.map((a) => a.unit ?? "n.d."))].join(", ")})`);
      else {
        // Somme arrondie à 4 décimales (précision du stockage numeric(14,4)) : pas de bruit flottant.
        row.paidTime = Math.round(acts.reduce((s, a) => s + a.measure, 0) * 1e4) / 1e4;
        row.timeUnit = acts[0].unit;
        const first = group.find((g) => (activities.get(`${g.decl.key}|${contractId}`) ?? []).length > 0) ?? o;
        row.provenance.paidTime = { ...prov(first, "S21.G00.53.002"), recordKey: acts[0].rec.key, collection: "activities" };
        if (row.timeUnit === null) row.fieldsNd.timeUnit = nd("not-provided", "unité d'activité absente (S21.G00.53.003)");
      }
      months.push(row);
    }
    for (let i = 1; i < occs.length; i++) {
      const a = occs[i - 1].rec.data;
      const b = occs[i].rec.data;
      const changes = (["nature", "referenceQuota", "contractQuota", "unit", "modality"] as const).filter((f) => (a[f] ?? null) !== (b[f] ?? null));
      if (changes.length && occs[i - 1].decl.month !== occs[i].decl.month) {
        findings.push(finding("attributes-changed", { contracts: [contractKey], persons: [personKey], month: occs[i].decl.month, message: `contrat ${c.externalId} : ${changes.join(", ")} modifié(s) entre ${occs[i - 1].decl.month} et ${occs[i].decl.month} (avenant ?)`, detail: { from: occs[i - 1].decl.month, to: occs[i].decl.month, changes: changes.map((f) => ({ field: f, before: a[f] ?? null, after: b[f] ?? null })) } }));
      }
    }
    const siretsByMonth = new Map<string, Set<string>>();
    for (const o of occs) siretsByMonth.set(o.decl.month, new Set([...(siretsByMonth.get(o.decl.month) ?? []), o.decl.siret]));
    for (const [M, sirets] of siretsByMonth) {
      if (sirets.size > 1) findings.push(finding("multi-establishment", { contracts: [contractKey], persons: [personKey], month: M, message: `contrat ${c.externalId} déclaré par ${sirets.size} établissements en ${M} : mutation ?`, detail: { sirets: [...sirets].sort() } }));
    }

    // Trous (C7 bis) et disparition (C7) : uniquement sur les mois complets du SIRET de la dernière déclaration.
    const notDeclared = (M: string, reason: string): ContractMonthDraft => ({
      contractKey,
      month: M,
      establishmentId: c.establishmentId!,
      presenceBasis: "not_declared",
      presentAnyDay: false,
      presentMonthEnd: false,
      nature: null,
      referenceQuota: null,
      contractQuota: null,
      quotaUnit: null,
      modality: null,
      paidTime: null,
      workedTime: null,
      timeUnit: null,
      paymentCount: null,
      flags: ["not_declared"],
      fieldsNd: Object.fromEntries(["nature", "referenceQuota", "contractQuota", "quotaUnit", "modality", "paidTime", "workedTime", "paymentCount"].map((f) => [f, nd("disappeared", reason)])),
      provenance: {},
    });
    const endMonth = endDate ? monthOf(endDate) : null;
    const complete = completeFor(c.establishmentId!);
    for (const M of complete) {
      if (M <= c.firstDeclaredMonth! || M >= c.lastDeclaredMonth! || declaredMonths.has(M)) continue;
      if (endMonth !== null && M > endMonth) continue;
      months.push(notDeclared(M, `contrat non déclaré en ${M} entre deux déclarations`));
      findings.push(finding("declared-gap", { contracts: [contractKey], persons: [personKey], month: M, message: `contrat ${c.externalId} absent de la déclaration de ${M} (mois complet) entre ${c.firstDeclaredMonth} et ${c.lastDeclaredMonth}` }));
    }
    if (startDate === null) {
      c.endStatus = "unpositioned";
      findings.push(finding("no-start-date", { contracts: [contractKey], persons: [personKey], message: `contrat ${c.externalId} sans date de début : non positionnable, hors effectif` }));
    } else if (endDate !== null) {
      c.endStatus = "known";
      const lastComplete = complete[complete.length - 1];
      for (const M of complete) {
        if (M <= c.lastDeclaredMonth! || M > endMonth! || (lastComplete !== undefined && M > lastComplete)) continue;
        months.push(notDeclared(M, `contrat non déclaré en ${M} avant sa fin déclarée du ${formatDate(endDate)}`));
        findings.push(finding("declared-gap", { contracts: [contractKey], persons: [personKey], month: M, message: `contrat ${c.externalId} absent de la déclaration de ${M} (mois complet) alors que sa fin est déclarée au ${formatDate(endDate)}` }));
      }
    } else {
      const after = complete.filter((M) => M > c.lastDeclaredMonth!);
      if (after.length) {
        c.endStatus = "disappeared";
        c.fieldsNd.endDate = nd("disappeared", `contrat absent des déclarations à partir de ${after[0]}, aucune fin déclarée`);
        for (const M of after) months.push(notDeclared(M, `contrat absent des déclarations à partir de ${after[0]}, aucune fin déclarée`));
        findings.push(finding("disappeared", { contracts: [contractKey], persons: [personKey], month: after[0], message: `contrat ${c.externalId} déclaré jusqu'en ${c.lastDeclaredMonth}, absent à partir de ${after[0]} sans fin déclarée : aucune sortie n'est inventée` }));
      } else if (nature === "01") c.endStatus = "none_cdi";
      else if (nature !== null) {
        c.endStatus = "none_other_nature";
        c.fieldsNd.endDate = nd("not-provided", "aucune fin déclarée (bloc S21.G00.62 absent)");
      } else {
        c.endStatus = "none_nature_nd";
        c.fieldsNd.endDate = nd("not-provided", "aucune fin déclarée et nature absente");
      }
    }
    contracts.push(c);

    if (startDate !== null) {
      const entry: EventDraft = {
        kind: "entry",
        date: startDate,
        month: monthOf(startDate),
        contractKey,
        personKey,
        establishmentId: first.decl.siret,
        nature: str(first.rec.data.nature), // nature déclarée à l'entrée (pas celle d'une transformation ultérieure)
        endReason: null,
        flags: [],
        fieldsNd: {},
        provenance: { date: prov(first, "S21.G00.40.001") },
      };
      if (referenceDate !== null && startDate > referenceDate) entry.flags.push("future");
      events.push(entry);
      if (endDate !== null && endOcc) {
        const exit: EventDraft = {
          kind: "exit",
          date: endDate,
          month: monthOf(endDate),
          contractKey,
          personKey,
          establishmentId: endOcc.decl.siret,
          nature: str(endOcc.rec.data.nature), // nature déclarée avec la fin
          endReason: c.endReason,
          flags: [],
          fieldsNd: c.endReason === null ? { endReason: nd("not-provided", "motif de rupture absent (S21.G00.62.002)") } : {},
          provenance: { date: prov(endOcc, "S21.G00.62.001"), ...(c.endReason !== null ? { endReason: prov(endOcc, "S21.G00.62.002") } : {}) },
        };
        if (referenceDate !== null && endDate > referenceDate) exit.flags.push("future");
        if (covStatus.get(`${endOcc.decl.siret}|${addMonths(exit.month, 1)}`) !== "complete") exit.flags.push("provisional");
        events.push(exit);
      }
    }
  }

  // --- Identité (A4) : même (SIREN, numéro, début) sous deux identifiants de personne ⇒ constat, jamais de fusion.
  const byIdentity = new Map<string, ContractDraft[]>();
  for (const c of contracts) {
    const p = persons.get(c.personKey!);
    const k = `${p?.siren ?? ""}|${c.externalId}|${c.startDate ?? ""}`;
    byIdentity.set(k, [...(byIdentity.get(k) ?? []), c]);
  }
  for (const list of byIdentity.values()) {
    const keys = [...new Set(list.map((c) => c.personKey!))];
    if (keys.length > 1) {
      findings.push(finding("identity-change", { persons: keys, contracts: list.map((c) => c.contractKey), message: `même numéro de contrat (${list[0].externalId}) et même début sous ${keys.length} identifiants : NTT→NIR ou NIR corrigé ? à vérifier`, detail: { contractNumber: list[0].externalId, startDate: list[0].startDate } }));
    }
  }

  // --- Renumérotation (C10, H3) : disparu en M, nouveau contrat de la même personne déclaré en M ou M+1.
  const eventOf = new Map(events.map((e) => [`${e.contractKey}|${e.kind}`, e]));
  const byPerson = new Map<string, ContractDraft[]>();
  for (const c of contracts) byPerson.set(c.personKey!, [...(byPerson.get(c.personKey!) ?? []), c]);
  for (const [personKey, list] of byPerson) {
    for (const x of list) {
      if (x.endStatus !== "disappeared") continue;
      const M = x.lastDeclaredMonth!;
      for (const y of list) {
        if (y === x || !y.firstDeclaredMonth || (y.firstDeclaredMonth !== M && y.firstDeclaredMonth !== addMonths(M, 1))) continue;
        findings.push(finding("renumbered", { persons: [personKey], contracts: [x.contractKey, y.contractKey], month: y.firstDeclaredMonth, message: `contrat ${x.externalId} disparu après ${M}, contrat ${y.externalId} déclaré à partir de ${y.firstDeclaredMonth} pour la même personne : renuméroté ou date de début corrigée ? à vérifier` }));
        const entry = eventOf.get(`${y.contractKey}|entry`);
        if (entry && !entry.flags.includes("renumbered")) entry.flags.push("renumbered");
      }
    }
  }

  for (const p of persons.values()) {
    if (!p.hasContract) findings.push(finding("person-without-contract", { persons: [p.personKey], message: "aucun contrat déclaré dans les déclarations retenues" }));
  }

  applyCommonRules(contracts, events, findings);
  const result: RhBuildResult = { build: header, persons: [...persons.values()], contracts, months, events, coverage, findings };
  sortOutputs(result);
  result.build.summary = summarize(result);
  return result;
}
