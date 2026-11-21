import { readBankLedger } from "@/lib/bank/store";
import { todayParis } from "@/lib/dates";
import { fecReport, type FecCheck, type FecStoredControls } from "./controls";
import type { FecExercise } from "./import";

export type ExerciseReport = { filename: string; checks: FecCheck[] | null; stored: FecStoredControls | null; reason: string | null };

// Rapport F01 à F09 des exercices affichés : F06 à la date du jour (Paris), F08 contre les relevés appliqués de l'espace.
export async function exerciseReports(workspaceId: string, exercises: Pick<FecExercise, "filename" | "firstDate" | "lastDate" | "controls">[], referenceDate = todayParis()): Promise<ExerciseReport[]> {
  if (!exercises.length) return [];
  const ledger = exercises.some((e) => e.controls) ? await readBankLedger(workspaceId) : [];
  return exercises.map((e) =>
    e.controls
      ? { filename: e.filename, checks: fecReport(e.controls, e, { referenceDate, ledger }), stored: e.controls, reason: null }
      : { filename: e.filename, checks: null, stored: null, reason: "n.d. — fichier déposé avant les contrôles F01 à F09 : redépose-le pour obtenir son rapport." },
  );
}
