// Extrai texto de PDF preservando linhas, usando pdf.js carregado sob demanda.
// pdf.js vem junto no repositório (web/vendor) — o painel não depende de CDN
// e funciona offline. Os caminhos são resolvidos a partir deste módulo, então
// o app pode ser servido de qualquer subpasta.
const PDFJS_URL = new URL('../../vendor/pdf.min.mjs', import.meta.url).href;
const WORKER_URL = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;

let _pdfjs = null;
async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import(PDFJS_URL);
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

    const pedacos = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      pedacos.push({
        x: it.transform[4],
        y: it.transform[5],
        alt: Math.abs(it.transform[3]) || Math.abs(it.height) || 8,
        s: it.str,
      });
    }
    if (!pedacos.length) { linhas.push('\f'); continue; }

    // Agrupa por proximidade vertical em vez de arredondar para uma grade
    // fixa: arredondar juntava linhas vizinhas e partia linhas cujos pedaços
    // têm y ligeiramente diferente, e o extrato perdia a maior parte das linhas.
    pedacos.sort((a, b) => b.y - a.y || a.x - b.x);
    const grupos = [];
    let atual = [pedacos[0]];
    for (let i = 1; i < pedacos.length; i++) {
      const it = pedacos[i];
      const ref = atual[atual.length - 1];
      const tolerancia = Math.max(2, Math.min(ref.alt, it.alt) * 0.6);
      if (Math.abs(ref.y - it.y) <= tolerancia) atual.push(it);
      else { grupos.push(atual); atual = [it]; }
    }
    grupos.push(atual);

    for (const g of grupos) {
      g.sort((a, b) => a.x - b.x);
      // Um vão horizontal grande separa colunas: vira um espaço só, mas o
      // texto de cada coluna não se cola no da coluna seguinte.
      let texto = '';
      let fimAnterior = null;
      for (const it of g) {
        const larguraMedia = it.alt * 0.5;
        if (fimAnterior != null && it.x - fimAnterior > larguraMedia * 0.6) texto += ' ';
        texto += it.s;
        fimAnterior = it.x + (it.s.length * larguraMedia);
      }
      texto = texto.replace(/\s+/g, ' ').trim();
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
