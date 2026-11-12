"use server";
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/workspace';
import { ProviderError } from '@/lib/connectors/http';
import { RcPayslipError, resumeRcPayslipScan, startRcPayslipScan } from '@/lib/payroll/rc-payslips-store';
import type { FormState } from './actions';

export async function launchRcPayslips(slug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, 'editor');
  try {
    await startRcPayslipScan(workspace.id, session.user.id, String(form.get('from') ?? ''), String(form.get('to') ?? ''));
  } catch (error) {
    return { error: error instanceof RcPayslipError ? error.message : error instanceof ProviderError ? 'La connexion PayFit ne permet pas cette lecture. Vérifie les droits ou réessaie.' : 'Lecture des bulletins indisponible. Aucun journal de paie modifié.' };
  }
  revalidatePath(`/e/${slug}/donnees/payfit`);
  revalidatePath(`/e/${slug}/studio-rh`, 'layout');
  return { ok: 'Lecture des bulletins lancée. Seuls les mois explicitement clôturés seront traités.' };
}

export async function resumeRcPayslips(slug: string, _previous: FormState): Promise<FormState> {
  const { workspace } = await requireWorkspace(slug, 'editor');
  try { await resumeRcPayslipScan(workspace.id); }
  catch (error) { return { error: error instanceof RcPayslipError ? error.message : 'Reprise indisponible. Réessaie.' }; }
  revalidatePath(`/e/${slug}/donnees/payfit`);
  return { ok: 'Reprise demandée ; le traitement continue depuis son dernier point enregistré.' };
}
