"use client";

// Impression par la feuille de style (croisee.css, A4 paysage) et la fenêtre d'impression du navigateur, qui propose aussi
// « Enregistrer au format PDF ». « Synthèse en PDF · 1 page » (chapitre Synthèse) marque la page (body[data-print="synthese"]) pour
// n'imprimer que la synthèse ; la marque est retirée après l'impression, ou au premier clic ou à la première touche.
export function PrintActions({ synthese }: { synthese: boolean }) {
  const printSynthese = () => {
    document.body.dataset.print = "synthese";
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      delete document.body.dataset.print;
      window.removeEventListener("afterprint", done);
      window.removeEventListener("pointerdown", done);
      window.removeEventListener("keydown", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
    // Navigateurs où l'impression ne bloque pas la page : la marque tombe à la première interaction qui suit.
    if (!finished) {
      window.addEventListener("pointerdown", done);
      window.addEventListener("keydown", done);
    }
  };
  return (
    <div className="cx-print" role="group" aria-label="Impression">
      <button type="button" className="btn" onClick={() => window.print()} data-testid="cx-print">
        Imprimer / Enregistrer en PDF
      </button>
      {synthese && (
        <button type="button" className="btn" onClick={printSynthese} data-testid="cx-print-synthese">
          Synthèse en PDF · 1 page
        </button>
      )}
    </div>
  );
}
