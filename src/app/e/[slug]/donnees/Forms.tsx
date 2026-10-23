"use client";
import { useActionState, useState } from "react";
import { connectSource, decideSync, launchSync, uploadFiles, type FormState } from "./actions";
import { monthCount, sizeFmt } from "./ui";

function Feedback({ state }: { state: FormState }) {
  if (state?.error) return <p className="error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="notice ok" role="status">{state.ok}</p>;
  return null;
}

const KEY_HELP: Record<string, string> = {
  payfit:
    "Créez dans PayFit (Intégrations → Accès API) une clé dédiée à Clair, en lecture seule : accounting:read, collaborators:read, contracts:read, contracts:time-information:read, time:read.",
  pennylane:
    "Créez dans Pennylane (Paramètres → Connectivité → Développeurs) un jeton d'API dédié à Clair, en lecture seule sur la comptabilité.",
};

export function ConnectForm({ slug, source, label, connected }: { slug: string; source: string; label: string; connected: boolean }) {
  const [state, action, pending] = useActionState(connectSource.bind(null, slug, source), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <div className="inline-form dn-fields">
        <div className="field-row">
          <label htmlFor="apiKey">{connected ? `Remplacer la clé API ${label}` : `Clé API ${label}`}</label>
          <input className="input" id="apiKey" name="apiKey" type="password" autoComplete="off" spellCheck={false} required />
        </div>
        {source === "pennylane" && (
          <div className="field-row dn-narrow">
            <label htmlFor="companyId">Identifiant de société (facultatif)</label>
            <input className="input" id="companyId" name="companyId" inputMode="numeric" autoComplete="off" />
          </div>
        )}
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Vérification…" : "Vérifier et enregistrer"}</button>
      </div>
      <p className="dn-help">
        {KEY_HELP[source]} La clé est vérifiée auprès du fournisseur, puis stockée chiffrée ; elle n'est plus jamais affichée.
        {source === "pennylane" && " L'identifiant de société n'est utile qu'avec un jeton donnant accès à plusieurs sociétés."}
      </p>
    </form>
  );
}

const SYNC_HELP: Record<string, string> = {
  payfit:
    "Collaborateurs et contrats : état actuel chez PayFit (contrats archivés depuis plus d'un an non fournis). Temps, absences, statut de paie et journal : pour chaque mois de la période (24 au plus).",
  pennylane:
    "Plan comptable complet, puis lignes d'écritures des classes 6 et 7 et des comptes 421, 431, 437, pour chaque mois de la période (24 au plus).",
};

// Plafond de mois par lecture : celui de l'action serveur (24), rappelé ici pour prévenir avant l'envoi.
const MAX_MONTHS = 24;

export function SyncForm({ slug, source, defaultFrom, defaultTo }: { slug: string; source: string; defaultFrom: string; defaultTo: string }) {
  const [state, action, pending] = useActionState(launchSync.bind(null, slug, source), undefined);
  const [range, setRange] = useState({ from: defaultFrom, to: defaultTo });
  const n = monthCount(range.from, range.to);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <div className="inline-form dn-fields">
        <div className="field-row dn-narrow">
          <label htmlFor="from">Du mois</label>
          <input className="input" id="from" name="from" type="month" defaultValue={defaultFrom} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} required />
        </div>
        <div className="field-row dn-narrow">
          <label htmlFor="to">Au mois</label>
          <input className="input" id="to" name="to" type="month" defaultValue={defaultTo} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} required />
        </div>
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Lancement…" : "Synchroniser"}</button>
      </div>
      <p className="dn-range" aria-live="polite" data-ok={n !== null && n <= MAX_MONTHS ? "true" : "false"}>
        {n === null ? "Période incomplète, ou mois de début postérieur au mois de fin." : n > MAX_MONTHS ? `${n} mois demandés : ${MAX_MONTHS} au plus par lecture.` : `${n} mois seront lus.`}
      </p>
      <p className="dn-help">{SYNC_HELP[source]} Rien n'est modifié avant validation de l'aperçu.</p>
    </form>
  );
}

export function DecisionButtons({ slug, syncId, additive = false }: { slug: string; syncId: string; additive?: boolean }) {
  const [applyState, apply, applying] = useActionState(async () => decideSync(slug, syncId, "apply"), undefined);
  const [discardState, discard, discarding] = useActionState(async () => decideSync(slug, syncId, "discard"), undefined);
  return (
    <div className="form dn-decision">
      <div className="dn-decision-text">
        <strong>Valider cette lecture ?</strong>
        <span className="desc">
          {additive
            ? "Appliquer fait compter ces fichiers dans la couverture de l'espace (un fichier qui en remplace un autre est signalé dans l'aperçu). Abandonner jette l'aperçu : rien n'est modifié."
            : "Appliquer rend cette lecture active pour les modules. Abandonner jette l'aperçu : rien n'est modifié."}
        </span>
      </div>
      <Feedback state={applyState ?? discardState} />
      <div className="actions">
        <form action={apply}>
          <button className="btn primary" type="submit" disabled={applying || discarding}>Appliquer cette lecture</button>
        </form>
        <form action={discard}>
          <button className="btn danger" type="submit" disabled={applying || discarding}>Abandonner</button>
        </form>
      </div>
    </div>
  );
}

const UPLOAD_HELP = {
  dsn: {
    label: "Fichiers DSN (norme P25V01 ou P26V01, 24 fichiers et 4 Mo par fichier au plus)",
    accept: ".dsn,.txt,text/plain",
    help: "Chaque fichier est lu, contrôlé et présenté en aperçu avant d'être appliqué. Un fichier déjà déposé est reconnu à son empreinte et n'est pas importé deux fois. Le fichier d'origine est conservé chiffré ; le NIR n'est jamais stocké en clair.",
  },
  fec: {
    label: "Fichiers FEC (18 colonnes de la norme, tabulation ou « | », 6 fichiers et 32 Mo par fichier au plus)",
    accept: ".txt,.csv,.fec,text/plain",
    help: "Un fichier = un exercice. Chaque fichier est lu, contrôlé (équilibre, dates, montants) et présenté en aperçu avant d'être appliqué. Un fichier déjà déposé est reconnu à son empreinte ; un FEC couvrant la même période que l'un déjà appliqué le remplace.",
  },
} as const;

const SHOWN_FILES = 8;

export function FileUploadForm({ slug, kind }: { slug: string; kind: keyof typeof UPLOAD_HELP }) {
  const [state, action, pending] = useActionState(uploadFiles.bind(null, slug, kind), undefined);
  const [chosen, setChosen] = useState<{ name: string; size: number }[]>([]);
  const help = UPLOAD_HELP[kind];
  const total = chosen.reduce((s, f) => s + f.size, 0);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <div className="inline-form dn-fields">
        <div className="field-row">
          <label htmlFor={`${kind}-files`}>{help.label}</label>
          <input
            className="input"
            id={`${kind}-files`}
            name="files"
            type="file"
            multiple
            accept={help.accept}
            required
            onChange={(e) => setChosen(Array.from(e.target.files ?? []).map((f) => ({ name: f.name, size: f.size })))}
          />
        </div>
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Lecture…" : "Déposer et prévisualiser"}</button>
      </div>
      <div className="dn-chosen" aria-live="polite">
        {chosen.length > 0 && (
          <>
            <p><strong>{chosen.length} fichier{chosen.length > 1 ? "s" : ""} prêt{chosen.length > 1 ? "s" : ""} à déposer</strong> · {sizeFmt(total)}</p>
            <ul>
              {chosen.slice(0, SHOWN_FILES).map((f, i) => (
                <li key={`${i}-${f.name}`}><span className="dn-chosen-name">{f.name}</span> <span className="desc">{sizeFmt(f.size)}</span></li>
              ))}
              {chosen.length > SHOWN_FILES && <li className="desc">… et {chosen.length - SHOWN_FILES} autre{chosen.length - SHOWN_FILES > 1 ? "s" : ""}</li>}
            </ul>
          </>
        )}
      </div>
      <p className="dn-help">{help.help}</p>
    </form>
  );
}
