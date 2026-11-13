import { formatDate } from "@/lib/dates";
import type { ColumnSpec, ExportCell, SheetSpec, WorkbookSpec } from "@/lib/export/xlsx";
import type { CashContext } from "./cash-context";
import { DIRECTIONS, FLOW_CATEGORIES, RECURRENCES, WEEK_COUNT, type PlanValue, type ScenarioPlan } from "./cashplan";
import { DEBT_NATURES, RANKS, type Amount, type CrisisItem, type CrisisPosition } from "./model";

// Cap 13, lot 3 — classeur Excel du dossier de crise : ce que montrent les deux vues, au centime, sans recalcul.
// Une valeur absente sort « n.d. » avec sa raison, jamais zéro. Le détail par tiers porte des noms de créanciers :
// l'export est réservé aux éditeurs et administrateurs de l'espace (contrôlé par la route).

export type CrisisExportContext = Pick<CashContext, "workspaceName" | "exercise" | "asOf" | "position" | "plan" | "scenarioPlan" | "settings" | "fecStart" | "openItems" | "supplierNet"> & { generatedAt: string };
type PositionValue = Extract<CrisisPosition, { kind: "value" }>;
type ScenarioValue = Extract<ScenarioPlan, { kind: "value" }>;

const cell = (amount: Amount): ExportCell => amount.cents === null ? { nd: amount.reason ?? "Valeur non disponible." } : amount.cents;
const text = (key: string, header: string, width: number): ColumnSpec => ({ key, header, kind: "text", width });
const eur = (key: string, header: string, width = 20): ColumnSpec => ({ key, header, kind: "eur", width });
const rankLabel = (id: string | null) => RANKS.find((rank) => rank.id === id)?.label ?? "Non choisi";
const weekHeader = (w: PlanValue["weeks"][number]) => `S${w.index} ${formatDate(w.from).slice(0, 5)}→${formatDate(w.to).slice(0, 5)}`;
const NOT_DUE = "Dettes comptabilisées, échues et non échues confondues : ce n’est pas le passif exigible. Le FEC ne porte aucune date d’échéance.";

function summary(ctx: CrisisExportContext): SheetSpec {
  const rows: ExportCell[][] = [];
  const position = ctx.position;
  if (position.kind === "value") {
    rows.push(
      ["Disponibilités", cell(position.cash.available), position.cash.available.reason ?? `Au ${formatDate(position.asOf)} · comptes 51 hors 519, 53, 54, soldes débiteurs`],
      ["Dettes comptabilisées", cell(position.totalDebt), position.totalDebt.reason ?? NOT_DUE],
      ["Disponibilités − dettes", cell(position.coverage), position.coverage.reason ?? "Indicateur de couverture, pas une prévision"],
      ["Valeurs mobilières de placement", cell(position.securities), position.securities.reason ?? "Comptes 50, hors disponibilités"],
    );
  } else rows.push(["Trésorerie et dettes à date", { nd: position.reason }, position.reason]);
  const plan = ctx.plan;
  if (plan.kind === "value") {
    const low = plan.weeks[plan.lowPoint.week - 1];
    rows.push(
      ["Solde de départ du plan", plan.start.cents, `${plan.start.source === "saisi" ? "Solde bancaire saisi" : "Soldes bancaires nets du FEC"} · au ${formatDate(plan.start.date)}`],
      ["Découvert autorisé", ctx.settings.overdraftCents ?? { nd: "Non saisi : la rupture se mesure par rapport à zéro." }, ctx.settings.overdraftCents === null ? "Non saisi : la rupture se mesure par rapport à zéro." : "Saisi dans Clair"],
      ["Point bas du plan de base", plan.lowPoint.cents, `Fin de semaine ${plan.lowPoint.week} · ${formatDate(low.to)}`],
      ["Solde de fin de semaine au moment de la rupture", plan.rupture ? plan.rupture.cents : "", plan.rupture ? `Rupture en semaine ${plan.rupture.week}, du ${formatDate(plan.rupture.from)} au ${formatDate(plan.rupture.to)}` : `Aucune rupture sur ${WEEK_COUNT} semaines, avec les flux saisis`],
      [`Solde de fin de semaine ${WEEK_COUNT}`, plan.weeks[WEEK_COUNT - 1].closing, `Au ${formatDate(plan.horizonEnd)}`],
    );
  } else rows.push(["Plan de trésorerie à 13 semaines", { nd: plan.reason }, plan.reason]);
  const sp = ctx.scenarioPlan;
  if (sp?.kind === "value") {
    rows.push(
      [`Scénario « ${sp.scenario.name} » : point bas`, sp.plan.lowPoint.cents, `Fin de semaine ${sp.plan.lowPoint.week}`],
      [`Scénario « ${sp.scenario.name} » : écart sur le point bas`, sp.lowPointDelta, "Scénario − plan de base"],
      [`Scénario « ${sp.scenario.name} » : solde à la rupture`, sp.plan.rupture ? sp.plan.rupture.cents : "", sp.plan.rupture ? `Rupture en semaine ${sp.plan.rupture.week}` : "Aucune rupture sur 13 semaines"],
      [`Scénario « ${sp.scenario.name} » : reporté après la semaine ${WEEK_COUNT}`, sp.beyondCents, "Toujours dû, hors de l’horizon"],
    );
  }
  return {
    name: "Synthèse", columns: [text("metric", "Indicateur", 58), eur("amount", "Montant EUR", 24), text("observations", "Observations", 90)], rows,
    note: `${NOT_DUE} Le plan à 13 semaines est une projection à partir d’hypothèses saisies ; il ne constate pas un état de cessation des paiements.`,
  };
}

function positionSheets(position: PositionValue): SheetSpec[] {
  const item = (nature: string, side: string, i: CrisisItem): ExportCell[] => [nature, i.accountId, i.accountName ?? { nd: "Libellé de compte absent du FEC." }, i.auxiliary ?? "", i.auxiliaryLabel ?? "", side, i.cents];
  const ranks = position.ranks;
  return [
    {
      name: "Dettes par nature",
      columns: [text("nature", "Nature", 44), text("accounts", "Comptes lus", 52), text("rank", "Rang choisi", 30), eur("debt", "Dette EUR"), eur("debit", "Soldes débiteurs non déduits EUR", 34)],
      rows: [
        ...position.natures.map((n) => [n.label, n.accounts, rankLabel(n.rank), cell(n.debt), cell(n.debitBalances)]),
        ["Total des dettes comptabilisées", "", "", cell(position.totalDebt), ""],
      ],
      note: `Soldes créditeurs au ${formatDate(position.asOf)}. Les soldes débiteurs des mêmes comptes (acomptes, avances, crédits de TVA) ne sont jamais déduits. ${NOT_DUE}`,
    },
    {
      name: "Dettes par tiers",
      columns: [text("nature", "Nature", 40), text("account", "Compte", 14), text("label", "Libellé du compte", 40), text("aux", "Compte auxiliaire", 20), text("auxLabel", "Tiers", 40), text("side", "Sens du solde", 16), eur("balance", "Solde EUR")],
      rows: position.natures.flatMap((n) => [...n.items.map((i) => item(n.label, "Créditeur", i)), ...n.debitItems.map((i) => item(n.label, "Débiteur", i))]),
      note: "Un solde par compte et par compte auxiliaire. Un solde débiteur n’est pas déduit de la dette de la nature. Le nom du tiers n’existe que pour les FEC déposés après la lecture du libellé auxiliaire.",
    },
    {
      name: "Disponibilités",
      columns: [text("account", "Compte", 14), text("label", "Libellé du compte", 44), eur("balance", "Solde débiteur EUR", 24)],
      rows: [...position.cash.items.map((i): ExportCell[] => [i.accountId, i.accountName ?? { nd: "Libellé de compte absent du FEC." }, i.cents]), ["Total des disponibilités", "", cell(position.cash.available)], ["Soldes bancaires nets, découverts compris", "", cell(position.cash.net)]],
      note: "Comptes de banque, d’établissements financiers et de caisse. Un compte créditeur est un découvert : il est classé en dette bancaire.",
    },
    {
      name: "Dettes par rang",
      columns: [text("rank", "Rang", 34), text("natures", "Natures classées", 70), eur("debt", "Dette EUR")],
      rows: ranks.kind === "value" ? ranks.totals.map((r) => [r.label, r.natures.join(", "), cell(r.total)]) : [["Répartition par rang", "", { nd: ranks.reason }]],
      note: "Rang choisi par l’espace pour chaque nature de dette. Clair ne qualifie aucune créance et ne suppose aucun rang ; ce classement par nature est à valider avec le conseil de l’entreprise.",
    },
  ];
}

function weeksSheet(name: string, plan: PlanValue, note: string): SheetSpec {
  const line = (label: string, values: number[], total: number | ""): ExportCell[] => [label, ...values, total];
  const sum = (pick: (w: PlanValue["weeks"][number]) => number) => plan.weeks.reduce((t, w) => t + pick(w), 0);
  return {
    name, columns: [text("line", "Ligne", 44), ...plan.weeks.map((w) => eur(`s${w.index}`, weekHeader(w), 18)), eur("total", "Total EUR")],
    rows: [
      ...plan.rows.filter((r) => r.direction === "in").map((r) => line(`Encaissements · ${r.label}`, r.weeks, r.total)),
      line("Total encaissements", plan.weeks.map((w) => w.inflow), sum((w) => w.inflow)),
      ...plan.rows.filter((r) => r.direction === "out").map((r) => line(`Décaissements · ${r.label}`, r.weeks, r.total)),
      line("Total décaissements", plan.weeks.map((w) => w.outflow), sum((w) => w.outflow)),
      line("Variation de la semaine", plan.weeks.map((w) => w.net), sum((w) => w.net)),
      line("Solde de fin de semaine", plan.weeks.map((w) => w.closing), ""),
    ],
    note,
  };
}

const traceSheet = (name: string, plan: PlanValue, note: string): SheetSpec => ({
  name, columns: [text("week", "Semaine", 12), { key: "date", header: "Date", kind: "date", width: 14 }, text("line", "Ligne ou mesure", 70), eur("amount", "Montant EUR (encaissement +, décaissement −)", 40)],
  rows: plan.weeks.flatMap((w) => w.contributions.map((c): ExportCell[] => [`S${w.index}`, c.date, c.label, c.cents])),
  note,
});

function planSheets(ctx: CrisisExportContext, plan: PlanValue): SheetSpec[] {
  const ignored = new Map(plan.ignored.map((line) => [line.flowId, line.reason]));
  const floor = plan.floor.source === "decouvert" ? "le découvert autorisé saisi" : "zéro (découvert autorisé non saisi)";
  return [
    weeksSheet("Plan 13 semaines", plan, `Semaines calendaires du lundi au dimanche ; départ au ${formatDate(plan.start.date)}. Seuls les flux datés après la date de départ comptent. Seuil de rupture : ${floor}. Le solde est lu en fin de semaine.`),
    traceSheet("Détail des flux du plan", plan, "Chaque montant du plan remonte à une ligne saisie dans Clair et à sa date."),
    {
      name: "Flux saisis",
      columns: [text("label", "Libellé", 44), text("category", "Catégorie", 24), text("direction", "Sens", 16), text("recurrence", "Fréquence", 18), { key: "date", header: "Date ou première date", kind: "date", width: 22 }, { key: "until", header: "Jusqu’au", kind: "date", width: 14 }, eur("amount", "Montant EUR"), text("observations", "Observations", 70)],
      rows: [...ctx.settings.flows].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label)).map((f): ExportCell[] => [
        f.label, FLOW_CATEGORIES.find((c) => c.id === f.category)!.label, DIRECTIONS.find((d) => d.id === f.direction)!.label, RECURRENCES.find((r) => r.id === f.recurrence)!.label,
        f.date, f.until ?? "", f.amountCents, ignored.has(f.id) ? `Hors du plan : ${ignored.get(f.id)}` : "Dans le plan",
      ]),
      note: "Montant toujours positif ; le sens fait le signe. Une ligne hors du plan n’est ni déplacée ni reportée automatiquement.",
    },
  ];
}

function scenarioSheets(sp: ScenarioValue): SheetSpec[] {
  const weeks = sp.plan.weeks;
  return [
    {
      name: "Scénario - comparaison", columns: [text("line", "Solde de fin de semaine", 30), ...weeks.map((w) => eur(`s${w.index}`, weekHeader(w), 18))],
      rows: [["Plan de base", ...sp.comparison.map((c) => c.base)], [`Scénario « ${sp.scenario.name} »`, ...sp.comparison.map((c) => c.scenario)], ["Écart (scénario − base)", ...sp.comparison.map((c) => c.delta)]],
      note: "Le plan de base n’est jamais modifié par un scénario.",
    },
    {
      name: "Scénario - mesures", columns: [text("measure", "Mesure", 60), text("effect", "Effet", 70), eur("beyond", `Reporté après la semaine ${WEEK_COUNT} EUR`, 34)],
      rows: sp.outcomes.map((o): ExportCell[] => [o.label, o.inapplicable ? `Non appliquée : ${o.inapplicable}` : "Appliquée", o.beyondCents]),
      note: `Un montant décalé après la semaine ${WEEK_COUNT} reste dû. Clair ne calcule ni majoration ni pénalité de retard, et ne dit pas si un délai sera accordé.`,
    },
    weeksSheet("Scénario - plan", sp.plan, `Plan de trésorerie du scénario « ${sp.scenario.name} ».`),
    traceSheet("Scénario - détail des flux", sp.plan, "Chaque montant du scénario remonte à sa mesure, et la mesure à la ligne du plan de base."),
  ];
}

const DEFINITIONS = [
  { term: "Disponibilités", definition: "Soldes débiteurs des comptes de banque, d’établissements financiers et de caisse (51 hors 519, 53, 54) à la date d’arrêté, à-nouveaux compris. Un compte créditeur est un découvert, classé en dette bancaire." },
  { term: "Dettes comptabilisées", definition: `Soldes créditeurs par nature : ${DEBT_NATURES.map((n) => `${n.label.toLowerCase()} (${n.accounts})`).join(" ; ")}. Échues et non échues confondues : ce n’est pas le passif exigible.` },
  { term: "Rang", definition: "Classement choisi par l’espace pour chaque nature de dette. Aucun rang n’est supposé ; sans choix, la répartition par rang est n.d." },
  { term: "Solde de départ", definition: "Soldes nets des comptes de trésorerie du FEC à la date d’arrêté (découverts compris, hors 519), ou solde bancaire saisi et daté, qui le remplace." },
  { term: "Semaine", definition: `${WEEK_COUNT} semaines calendaires du lundi au dimanche ; la première est celle de la date de départ.` },
  { term: "Rupture", definition: "Première semaine dont le solde de fin passe sous le seuil : le découvert autorisé saisi, ou zéro s’il n’est pas saisi." },
  { term: "Report", definition: "Mesure de scénario : chaque occurrence d’un décaissement dans le plan est décalée d’un nombre de semaines." },
  { term: "Étalement", definition: "Mesure de scénario : les occurrences d’un décaissement dans le plan sont remplacées par des échéances égales ; le reliquat d’arrondi est porté par la dernière." },
  { term: "Reporté après la semaine 13", definition: "Décaissements que les mesures font sortir de l’horizon. Ils restent dus." },
];

/** Classeur du dossier de crise. `null` quand il n'y a rien à exporter (ni position, ni plan). */
export function crisisWorkbook(ctx: CrisisExportContext): WorkbookSpec | null {
  if (ctx.position.kind === "nd" && ctx.plan.kind === "nd") return null;
  const sp = ctx.scenarioPlan?.kind === "value" ? ctx.scenarioPlan : null;
  const plan = ctx.plan.kind === "value" ? ctx.plan : null;
  return {
    title: "Cap 13 — dossier de crise", workspaceName: ctx.workspaceName, generatedAt: ctx.generatedAt,
    filters: [
      { label: "Exercice FEC lu", value: ctx.exercise ? `${formatDate(ctx.exercise.firstDate)} → ${formatDate(ctx.exercise.lastDate)}` : "Aucun FEC appliqué" },
      { label: "Date d’arrêté du FEC", value: ctx.asOf ? formatDate(ctx.asOf) : "n.d." },
      { label: "Départ du plan", value: plan ? `${formatDate(plan.start.date)} (${plan.start.source === "saisi" ? "solde saisi" : "solde du FEC"})` : "n.d." },
      { label: "Scénario", value: sp ? sp.scenario.name : "Plan de base seul" },
      { label: "Devise", value: "EUR, centimes conservés" },
    ],
    sheets: [
      summary(ctx),
      ...(ctx.position.kind === "value" ? positionSheets(ctx.position) : []),
      ...(plan ? planSheets(ctx, plan) : []),
      ...(sp ? scenarioSheets(sp) : []),
    ],
    sources: [
      { label: "FEC appliqué dans Données", detail: ctx.exercise ? `${ctx.exercise.filename} ; exercice du ${formatDate(ctx.exercise.firstDate)} au ${formatDate(ctx.exercise.lastDate)} ; un seul exercice lu.` : "Aucun FEC appliqué : trésorerie et dettes n.d.", syncedAt: null, status: ctx.exercise ? "Lecture appliquée" : "Absent" },
      { label: "Plan de trésorerie saisi dans Clair", detail: `${ctx.settings.flows.length} ligne(s) de flux, ${ctx.settings.scenarios.length} scénario(s), révision ${ctx.settings.revision}. ${ctx.settings.start ? "Solde de départ saisi." : "Solde de départ lu dans le FEC."}`, syncedAt: null, status: plan ? "Calculé à la demande" : "Non calculable" },
    ],
    definitions: DEFINITIONS,
  };
}
