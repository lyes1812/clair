"use client";
import { useEffect, useId, useRef, useState } from "react";
import { checkFill, dirtyText, downTargets, neighborInColumn, reportTargets, rightTargets, rowTargets, scanFields, type FieldState, type GridCell } from "@/lib/viz/hyp-saisie";

// Outils d'une grille mensuelle (formulaire serveur à champs non contrôlés). Tout se passe dans le navigateur, sans appel
// serveur : rien n'est enregistré tant que le formulaire n'est pas envoyé, et « Réinitialiser » annule tout report.
// La grille (outils compris) est enveloppée dans un élément [data-grid-root] ; ses cellules portent data-cell, data-row,
// data-col et, quand la grille couvre plusieurs années, data-yi (rang de l'année). Les autres années restent dans la page
// (masquées par le style) : le formulaire les envoie avec le reste, aucune saisie n'est perdue en changeant d'année.
export type YearTab = { label: string; count?: number };
type Tool = "right" | "down" | "fill";

const SCOPE = "[data-grid-root]";
const scopeOf = (el: Element | null): HTMLElement | null => el?.closest<HTMLElement>(SCOPE) ?? null;
// Message de l'outil, dans la zone annoncée aux lecteurs d'écran (aucun rôle « status » : il est réservé à l'enregistrement).
const say = (scope: HTMLElement | null, text: string) => {
  const note = scope?.querySelector<HTMLElement>("[data-fill-note]");
  if (note) note.textContent = text;
};
const cellsOf = (scope: HTMLElement) => [...scope.querySelectorAll<HTMLInputElement>("input[data-cell]")];
const infoOf = (scope: HTMLElement, cells: HTMLInputElement[]): GridCell[] => {
  const shown = scope.getAttribute("data-ys");
  return cells.map((c) => ({ row: c.dataset.row ?? "", col: c.dataset.col ?? "", visible: c.dataset.yi === undefined || shown === null || c.dataset.yi === shown }));
};
// Écrit une valeur et prévient le formulaire (compteur de modifications, mise en évidence des cellules).
const put = (el: HTMLInputElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const cells = (n: number) => `${n} cellule${n > 1 ? "s" : ""}`;

export function RowFill({ row, label }: { row: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn small hs-report"
      data-testid={`fill-${row}`}
      aria-label={label ? `Reporter → : ${label}` : undefined}
      title="Reporte la première valeur renseignée sur les mois suivants de la ligne (non enregistré tant que vous n'envoyez pas la grille)"
      onClick={(e) => {
        const scope = scopeOf(e.currentTarget);
        if (!scope) return;
        const line = [...scope.querySelectorAll<HTMLInputElement>(`input[data-row="${CSS.escape(row)}"][data-cell]`)];
        const r = reportTargets(line.map((c) => c.value));
        if (!r) return say(scope, "Aucune valeur renseignée sur cette ligne : rien à reporter.");
        for (const i of r.targets) put(line[i], r.value);
        say(scope, r.targets.length ? `Valeur « ${r.value} » reportée sur ${r.targets.length} mois de la ligne, à enregistrer. « Réinitialiser » annule.` : "Aucun mois suivant.");
      }}
    >
      Reporter →
    </button>
  );
}

const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
// Une cellule de texte qui commence par = + - @ serait lue comme une formule par un tableur : on la neutralise (les nombres restent des nombres).
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^[+-]?\d+([.,]\d+)?$/.test(v) ? `'${v}` : v);

function exportCsv(scope: HTMLElement, filename: string) {
  const table = scope.querySelector("table");
  if (!table) return;
  const lines = [...table.querySelectorAll("tr")]
    .filter((tr) => !tr.hasAttribute("data-no-csv"))
    .map((tr) =>
      [...tr.children]
        .filter((c) => !c.hasAttribute("data-no-csv"))
        .map((c) => {
          const given = c.getAttribute("data-csv");
          if (given !== null) return q(safe(given));
          const box = c.querySelector<HTMLInputElement>("input[type=checkbox]");
          if (box) return q(box.checked ? "oui" : "non");
          const sel = c.querySelector<HTMLSelectElement>("select");
          if (sel) return q(sel.selectedOptions[0]?.text ?? sel.value);
          const input = c.querySelector<HTMLInputElement>("input:not([type=hidden])");
          return q(safe(input ? input.value : (c.textContent ?? "").replace("Reporter →", "").trim()));
        })
        .join(";"),
    );
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function GridTools({ filename, years, tools = ["right", "down", "fill"], readOnly = false }: { filename: string; years?: YearTab[]; tools?: Tool[]; readOnly?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const active = useRef<HTMLInputElement | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [yi, setYi] = useState(0);
  const valueId = useId();
  const multi = (years?.length ?? 0) > 1;

  // Cellule active = dernière cellule de la grille qui a pris le focus (le clic sur un bouton de l'outil la fait perdre le focus).
  useEffect(() => {
    const scope = scopeOf(root.current);
    if (!scope) return;
    const shown = Number(scope.getAttribute("data-ys"));
    if (Number.isInteger(shown) && shown > 0) setYi(shown);
    const onFocus = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.matches("input[data-cell]")) {
        active.current = t;
        setActiveLabel(t.getAttribute("aria-label") || "cellule sélectionnée");
      }
    };
    // Comme dans un tableur : Entrée ou flèche bas passe à la cellule du dessous, Maj+Entrée ou flèche haut à celle du dessus
    // (Entrée n'envoie donc pas la grille par mégarde ; l'enregistrement se fait par le bouton).
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !t.matches("input[data-cell]") || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      const down = e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey);
      const up = e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey);
      if (!down && !up) return;
      e.preventDefault();
      const all = cellsOf(scope);
      const next = neighborInColumn(infoOf(scope, all), all.indexOf(t), down ? 1 : -1);
      if (next >= 0) {
        all[next].focus();
        all[next].select();
      }
    };
    scope.addEventListener("focusin", onFocus);
    scope.addEventListener("keydown", onKey);
    return () => {
      scope.removeEventListener("focusin", onFocus);
      scope.removeEventListener("keydown", onKey);
    };
  }, []);

  const pick = (i: number) => {
    const scope = scopeOf(root.current);
    if (!scope) return;
    setYi(i);
    scope.setAttribute("data-ys", String(i));
    const a = active.current;
    if (a && a.dataset.yi !== undefined && a.dataset.yi !== String(i)) {
      active.current = null;
      setActiveLabel(null);
    }
    say(scope, `Année ${years?.[i]?.label ?? ""} affichée : les autres années restent dans la grille et seront enregistrées avec elle.`);
  };

  const run = (tool: Tool) => {
    const scope = scopeOf(root.current);
    if (!scope) return;
    const a = active.current;
    const all = cellsOf(scope);
    const at = a && a.isConnected ? all.indexOf(a) : -1;
    if (at < 0) return say(scope, "Cliquez d'abord dans une cellule de la grille : elle sert de point de départ.");
    const info = infoOf(scope, all);
    const where = multi ? " sur l'année affichée" : "";
    if (tool === "fill") {
      const raw = valueRef.current?.value ?? "";
      const check = checkFill(raw);
      if (check === "vide") return say(scope, "Saisissez d'abord la valeur à reporter sur la ligne : Clair n'en propose aucune.");
      if (check === "illisible") return say(scope, `« ${raw.trim()} » n'est pas une valeur lisible (ex. 2,5 ou 1 200,00).`);
      const targets = rowTargets(info, at);
      for (const i of targets) put(all[i], raw.trim());
      return say(scope, `Ligne remplie avec « ${raw.trim()} »${where} : ${cells(targets.length)}, à enregistrer. « Réinitialiser » annule.`);
    }
    const v = all[at].value;
    const check = checkFill(v);
    if (check === "vide") return say(scope, "La cellule active est vide : saisissez d'abord la valeur à copier.");
    if (check === "illisible") return say(scope, `La valeur de la cellule active (« ${v.trim()} ») est illisible : corrigez-la avant de la copier.`);
    const targets = tool === "right" ? rightTargets(info, at) : downTargets(info, at);
    if (targets.length === 0) return say(scope, tool === "right" ? "Aucune cellule à droite de la cellule active dans sa ligne." : "Aucune cellule sous la cellule active dans sa colonne.");
    for (const i of targets) put(all[i], v.trim());
    say(scope, `Valeur « ${v.trim()} » copiée ${tool === "right" ? "vers la droite" : "vers le bas"}${where} : ${cells(targets.length)}, à enregistrer. « Réinitialiser » annule.`);
  };

  return (
    <div className="hs-tools" ref={root} role="group" aria-label="Outils de la grille">
      <div className="hs-tools-row">
        {multi && (
          <div className="hs-years" role="group" aria-label="Année affichée">
            {years!.map((y, i) => (
              <button
                key={y.label}
                type="button"
                className="btn small"
                aria-pressed={i === yi}
                aria-label={y.count ? `${y.label}, ${cells(y.count)} renseignée${y.count > 1 ? "s" : ""}` : undefined}
                title={y.count ? `${cells(y.count)} renseignée${y.count > 1 ? "s" : ""} en ${y.label}` : `Aucune cellule renseignée en ${y.label}`}
                data-testid={`grid-year-${y.label}`}
                onClick={() => pick(i)}
              >
                {y.label}
                {y.count ? <span className="hs-count" aria-hidden="true">{y.count}</span> : null}
              </button>
            ))}
          </div>
        )}
        {!readOnly && tools.includes("right") && (
          <button type="button" className="btn small" data-testid="grid-copy-right" title="Copie la valeur de la cellule active sur les cellules suivantes de sa ligne. Rien n'est enregistré avant « Enregistrer »." onClick={() => run("right")}>
            Copier vers la droite
          </button>
        )}
        {!readOnly && tools.includes("down") && (
          <button type="button" className="btn small" data-testid="grid-copy-down" title="Copie la valeur de la cellule active sur les cellules situées dessous, dans sa colonne. Rien n'est enregistré avant « Enregistrer »." onClick={() => run("down")}>
            Copier vers le bas
          </button>
        )}
        {!readOnly && tools.includes("fill") && (
          <div className="hs-fill">
            <label htmlFor={valueId}>Valeur à reporter</label>
            <input
              ref={valueRef}
              id={valueId}
              className="input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Nombre"
              data-testid="grid-fill-value"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault(); // Entrée ne doit pas envoyer la grille
                run("fill");
              }}
            />
            <button type="button" className="btn small" data-testid="grid-fill-row" title="Remplit toute la ligne de la cellule active avec la valeur saisie. Rien n'est enregistré avant « Enregistrer »." onClick={() => run("fill")}>
              Remplir la ligne
            </button>
          </div>
        )}
        {!readOnly && (
          <button
            type="button"
            className="btn small"
            data-testid="grid-reset"
            onClick={() => {
              const scope = scopeOf(root.current);
              scope?.closest("form")?.reset();
              say(scope, "Saisie réinitialisée aux valeurs enregistrées.");
            }}
          >
            Réinitialiser
          </button>
        )}
        <button
          type="button"
          className="btn small"
          data-testid="grid-csv"
          onClick={() => {
            const scope = scopeOf(root.current);
            if (scope) exportCsv(scope, filename);
          }}
        >
          Télécharger (CSV)
        </button>
      </div>
      {!readOnly && (
        <p className="hs-active" data-testid="grid-active">
          {activeLabel ? <>Cellule active : <strong>{activeLabel}</strong></> : "Cliquez dans une cellule pour l'utiliser comme point de départ des copies. Entrée ou flèche bas : cellule du dessous ; Maj+Entrée ou flèche haut : cellule du dessus."}
        </p>
      )}
      <span className="hs-note" data-fill-note aria-live="polite" />
    </div>
  );
}

// Compteur de modifications non enregistrées d'un formulaire de saisie (à placer dans le pied de ActionForm) : compare chaque
// champ à sa valeur enregistrée, met en évidence les cellules modifiées et signale les valeurs numériques illisibles.
export function DirtyIndicator() {
  const ref = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<{ n: number; bad: number; text: string }>({ n: 0, bad: 0, text: "Aucune modification non enregistrée." });

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    let frame = 0;
    const scan = () => {
      const fields: FieldState[] = [];
      const els: (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[] = [];
      for (const el of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name], select[name], textarea[name]")) {
        if (el instanceof HTMLInputElement && ["hidden", "submit", "button", "reset", "file"].includes(el.type)) continue;
        const changed =
          el instanceof HTMLSelectElement ? [...el.options].some((o) => o.selected !== o.defaultSelected)
          : el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? el.checked !== el.defaultChecked
          : el.value !== el.defaultValue;
        fields.push({ label: el.getAttribute("aria-label") || el.name, raw: el.value, changed, numeric: el.getAttribute("inputmode") === "decimal" });
        els.push(el);
      }
      const { changed, unreadable } = scanFields(fields);
      els.forEach((el, i) => {
        const bad = scanFields([fields[i]]).unreadable.length > 0;
        if (fields[i].changed) el.setAttribute("data-dirty", "true");
        else el.removeAttribute("data-dirty");
        if (bad) {
          el.setAttribute("data-invalid", "true");
          el.setAttribute("aria-invalid", "true");
        } else {
          el.removeAttribute("data-invalid");
          el.removeAttribute("aria-invalid");
        }
      });
      setState({ n: changed, bad: unreadable.length, text: dirtyText(changed, unreadable) });
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    };
    const afterReset = () => setTimeout(later, 0); // l'événement « reset » précède la remise à zéro des champs
    form.addEventListener("input", later);
    form.addEventListener("change", later);
    form.addEventListener("reset", afterReset);
    // Les valeurs enregistrées changent (React met à jour defaultValue) : on relit.
    const observer = new MutationObserver(later);
    observer.observe(form, { subtree: true, attributes: true, attributeFilter: ["value", "checked", "selected"] });
    // La barre d'enregistrement n'est collée au bas de la fenêtre que si le formulaire dépasse la fenêtre (data-tall, lu par le style).
    const fit = () => form.setAttribute("data-tall", form.getBoundingClientRect().height > window.innerHeight - 120 ? "1" : "0");
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    sizes?.observe(form);
    window.addEventListener("resize", fit);
    fit();
    later();
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener("input", later);
      form.removeEventListener("change", later);
      form.removeEventListener("reset", afterReset);
      observer.disconnect();
      sizes?.disconnect();
      window.removeEventListener("resize", fit);
      form.removeAttribute("data-tall");
    };
  }, []);

  return (
    <span ref={ref} className="hs-dirty" data-testid="grid-dirty" data-n={state.n} data-bad={state.bad} aria-live="polite">
      {state.text}
    </span>
  );
}
