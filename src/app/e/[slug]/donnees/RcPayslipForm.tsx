"use client";
import { useActionState } from 'react';
import { launchRcPayslips, resumeRcPayslips } from './rc-actions';

export function RcPayslipForm({ slug, from, to, running }: { slug: string; from: string; to: string; running: boolean }) {
  const [state, action, pending] = useActionState(launchRcPayslips.bind(null, slug), undefined);
  const [resumeState, resume, resuming] = useActionState(resumeRcPayslips.bind(null, slug), undefined);
  if (running) return <form action={resume} data-testid="rc-payslip-resume">
    {resumeState?.error && <p className="error" role="alert">{resumeState.error}</p>}
    {resumeState?.ok && <p className="notice" role="status">{resumeState.ok}</p>}
    <button className="btn small" disabled={resuming}>{resuming ? 'Reprise…' : 'Reprendre une lecture interrompue'}</button>
  </form>;
  return <form action={action} className="form" data-testid="rc-payslip-launch">
    {state?.error && <p className="error" role="alert">{state.error}</p>}
    {state?.ok && <p className="notice" role="status">{state.ok}</p>}
    <div className="inline-form dn-fields">
      <div className="field-row dn-narrow"><label htmlFor="rc-from">Du mois</label><input className="input" id="rc-from" type="month" name="from" defaultValue={from} required /></div>
      <div className="field-row dn-narrow"><label htmlFor="rc-to">Au mois</label><input className="input" id="rc-to" type="month" name="to" defaultValue={to} required /></div>
      <button className="btn primary" disabled={pending}>{pending ? 'Lancement…' : 'Synchroniser les indemnités de RC'}</button>
    </div>
  </form>;
}
