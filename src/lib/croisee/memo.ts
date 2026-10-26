// Mémo par requête : la clé est le contexte de la page (un objet par requête, libéré avec lui) ; aucun cache partagé entre
// requêtes. Le composant d'un chapitre et l'export appellent la même fonction mémoïsée : le modèle n'est calculé qu'une fois.
export function memoByContext<C extends object, T>(fn: (ctx: C) => Promise<T>): (ctx: C) => Promise<T> {
  const memo = new WeakMap<C, Promise<T>>();
  return (ctx) => {
    let p = memo.get(ctx);
    if (!p) memo.set(ctx, (p = fn(ctx)));
    return p;
  };
}
