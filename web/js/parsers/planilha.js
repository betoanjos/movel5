// Leitura genérica de planilhas (.xlsx/.xls) e CSV, com detecção de codificação.
const XLSX_URL = new URL('../../vendor/xlsx.full.min.js', import.meta.url).href;

let _xlsx = null;
export async function carregaXLSX() {
  if (_xlsx) return _xlsx;
  if (!window.XLSX) {
    await new Promise((ok, err) => {
      const s = document.createElement('script');
      s.src = XLSX_URL; s.onload = ok; s.onerror = () => err(new Error('Falha ao carregar leitor de planilhas'));
      document.head.appendChild(s);
    });
  }
  _xlsx = window.XLSX;
  return _xlsx;
}

/**
 * Decodifica bytes de texto. Arquivos do Bling e de bancos brasileiros
 * costumam vir em Windows-1252; o UTF-8 mal decodificado deixa "�".
 */
export function decodeTexto(arrayBuffer) {
  const utf8 = new TextDecoder('utf-8').decode(arrayBuffer);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('windows-1252').decode(arrayBuffer); }
  catch { return utf8; }
}

/** Lê a primeira aba (ou todas) como matriz de linhas. */
export async function planilhaParaMatriz(arrayBuffer, { todasAbas = false } = {}) {
  const XLSX = await carregaXLSX();
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, raw: false });
  const abas = todasAbas ? wb.SheetNames : [wb.SheetNames[0]];
  return abas.map((nome) => ({
    nome,
    linhas: XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: '', raw: false, blankrows: false }),
  }));
}

/** Divide uma linha CSV respeitando aspas. */
export function csvLinha(linha, sep) {
  const out = [];
  let campo = '', dentro = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentro && linha[i + 1] === '"') { campo += '"'; i++; }
      else dentro = !dentro;
    } else if (c === sep && !dentro) { out.push(campo); campo = ''; }
    else campo += c;
  }
  out.push(campo);
  return out.map((s) => s.trim());
}

/** CSV -> matriz, detectando o separador (`;` no Brasil, `,` no padrão). */
export function csvParaMatriz(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!linhas.length) return [];
  const amostra = linhas[0];
  const sep = (amostra.match(/;/g) || []).length >= (amostra.match(/,/g) || []).length ? ';' : ',';
  return linhas.map((l) => csvLinha(l, sep));
}

/**
 * Localiza a linha de cabeçalho e devolve objetos com chaves normalizadas.
 * @param {string[][]} matriz
 * @param {string[]} colunasEsperadas nomes (em minúsculas, sem acento) que identificam o cabeçalho
 */
export function comCabecalho(matriz, colunasEsperadas = []) {
  const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  let idx = 0;
  if (colunasEsperadas.length) {
    for (let i = 0; i < Math.min(matriz.length, 15); i++) {
      const cols = matriz[i].map(chave);
      const achou = colunasEsperadas.filter((c) => cols.some((x) => x.includes(c))).length;
      if (achou >= Math.min(2, colunasEsperadas.length)) { idx = i; break; }
    }
  }
  const cab = matriz[idx].map(chave);
  const registros = [];
  for (let i = idx + 1; i < matriz.length; i++) {
    const linha = matriz[i];
    if (!linha.some((c) => String(c).trim() !== '')) continue;
    const obj = {};
    cab.forEach((c, j) => { if (c) obj[c] = linha[j] ?? ''; });
    obj.__linha = i + 1;
    registros.push(obj);
  }
  return { cabecalho: cab, registros };
}

/** Busca o primeiro campo cujo nome contenha um dos termos. */
export function campo(obj, ...termos) {
  for (const t of termos) {
    const k = Object.keys(obj).find((x) => x === t) || Object.keys(obj).find((x) => x.includes(t));
    if (k && obj[k] !== '' && obj[k] != null) return obj[k];
  }
  return '';
}
