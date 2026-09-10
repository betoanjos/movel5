// Extrai texto de PDF preservando linhas, usando pdf.js carregado sob demanda.
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs';
const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs';

let _pdfjs = null;
async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import(/* @vite-ignore */ PDFJS_URL);
  _pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
  return _pdfjs;
}

/**
 * Converte o PDF em linhas de texto, agrupando itens pela coordenada Y.
 * @returns {Promise<string[]>} linhas na ordem de leitura
 */
export async function pdfParaLinhas(arrayBuffer) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: arrayBuffer, useSystemFonts: true }).promise;
  const linhas = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const porY = new Map();

    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 2.2) * 2.2; // tolerância vertical
      if (!porY.has(y)) porY.set(y, []);
      porY.get(y).push({ x: it.transform[4], s: it.str });
    }

    const ys = [...porY.keys()].sort((a, b) => b - a); // topo -> base
    for (const y of ys) {
      const texto = porY.get(y).sort((a, b) => a.x - b.x).map((i) => i.s).join(' ')
        .replace(/\s+/g, ' ').trim();
      if (texto) linhas.push(texto);
    }
    linhas.push('\f'); // marcador de fim de página
  }
  await doc.destroy();
  return linhas;
}

/** Divide as linhas em páginas (usando o marcador \f). */
export function porPagina(linhas) {
  const paginas = [[]];
  for (const l of linhas) {
    if (l === '\f') paginas.push([]);
    else paginas[paginas.length - 1].push(l);
  }
  return paginas.filter((p) => p.length);
}
