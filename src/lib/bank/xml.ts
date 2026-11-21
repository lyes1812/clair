// Lecteur XML minimal pour les relevés CAMT.053 et OFX 2.x. Volontairement restreint : aucune DTD n'est lue (un
// fichier qui en déclare une est refusé, donc aucune entité externe ne peut être résolue), seules les cinq entités
// prédéfinies et les références numériques sont décodées. Les préfixes d'espace de noms sont ignorés.

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

export class XmlError extends Error {}

const MAX_DEPTH = 64;
const NAME = /^[A-Za-z_][\w.\-:]*$/;

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return "\"";
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!Number.isFinite(code) || code > 0x10ffff) throw new XmlError("Référence de caractère invalide.");
    return String.fromCodePoint(code);
  });
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

export function parseXml(source: string): XmlNode {
  if (/<!DOCTYPE/i.test(source) || /<!ENTITY/i.test(source)) throw new XmlError("Fichier XML avec DTD : refusé (aucune entité externe n'est lue).");
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const chunk = source.slice(i, lt === -1 ? source.length : lt);
    if (chunk.trim()) stack[stack.length - 1].text += decodeEntities(chunk);
    if (lt === -1) break;
    if (source.startsWith("<?", lt)) { const end = source.indexOf("?>", lt); if (end === -1) throw new XmlError("Instruction XML non fermée."); i = end + 2; continue; }
    if (source.startsWith("<!--", lt)) { const end = source.indexOf("-->", lt); if (end === -1) throw new XmlError("Commentaire XML non fermé."); i = end + 3; continue; }
    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt);
      if (end === -1) throw new XmlError("Section CDATA non fermée.");
      stack[stack.length - 1].text += source.slice(lt + 9, end);
      i = end + 3; continue;
    }
    const gt = source.indexOf(">", lt);
    if (gt === -1) throw new XmlError("Balise XML non fermée.");
    const tag = source.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith("/")) {
      const name = localName(tag.slice(1).trim());
      const open = stack.pop();
      if (!open || open === root || open.name !== name) throw new XmlError(`Balise fermante inattendue : ${name}.`);
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const m = /^\s*([^\s/>]+)([\s\S]*)$/.exec(body);
    if (!m || !NAME.test(m[1])) throw new XmlError("Nom de balise invalide.");
    const attrs: Record<string, string> = {};
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[2]))) attrs[localName(a[1])] = decodeEntities(a[3] ?? a[4] ?? "");
    const node: XmlNode = { name: localName(m[1]), attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      stack.push(node);
      if (stack.length > MAX_DEPTH) throw new XmlError("XML trop profond.");
    }
  }
  if (stack.length !== 1) throw new XmlError(`Balise non fermée : ${stack[stack.length - 1].name}.`);
  return root;
}

export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node?.children.find((c) => c.name === name);
export const childrenOf = (node: XmlNode | undefined, name: string): XmlNode[] => node?.children.filter((c) => c.name === name) ?? [];
/** Chemin de balises ; renvoie le texte nettoyé du dernier nœud, ou null. */
export function textAt(node: XmlNode | undefined, ...path: string[]): string | null {
  let cur = node;
  for (const p of path) cur = child(cur, p);
  const t = cur?.text.trim();
  return t ? t : null;
}
export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    else findAll(c, name, out);
  }
  return out;
}
