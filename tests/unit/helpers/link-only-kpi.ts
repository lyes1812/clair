import type { KpiInput } from "@/lib/rh/kpi/types";
import type { RhBuildData } from "@/lib/rh/referential/types";
import { DSN_ABSENCES, kpiInput } from "./kpi";

// Référentiel factice réduit au lien contrat → personne, pour les tests de la garde de MASSE du filtre Service : la source RH est
// déclarée indisponible, aucun ETP de fin de mois n'est dénombré (etpMonthEnd n.d.), la colonne des stocks n'entre donc pas dans la
// garde (serviceStockMask : null). Les contrats (et la source déclarée) sont conservés tels quels : linkFromReferential et croiseeLink
// donnent le même lien. Les cas de la colonne des stocks ont leur propre référentiel complet (confidentialite-etp-service.test.ts).
export function linkOnlyKpi(data: { contracts?: readonly unknown[]; build?: { source?: string }; persons?: readonly unknown[] }): KpiInput {
  const d = data as Partial<RhBuildData>;
  const ref: RhBuildData = {
    persons: d.persons ?? [],
    contracts: d.contracts ?? [],
    months: [],
    events: [],
    coverage: [],
    findings: [],
    build: { source: d.build?.source ?? "payfit", referenceDate: null, presenceFrom: null, presenceTo: null, unavailableReason: "référentiel factice : ETP de fin de mois non lu (test)" },
  };
  return kpiInput(ref, DSN_ABSENCES);
}
