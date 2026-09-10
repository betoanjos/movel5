// Utilitários compartilhados: dinheiro, datas, texto e hashes.

/** Converte "R$ 1.234,56" | "-R$ 1.016,98" | "1.234,56" | "1234.56" em Number. */
export function parseMoney(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return round2(v);
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || s.includes('-');
  s = s.replace(/[^\d,.]/g, '');
  const ptVirgula = s.lastIndexOf(','), ptPonto = s.lastIndexOf('.');
  if (ptVirgula >= 0 && ptPonto >= 0) {
    // Tem os dois separadores: o decimal é sempre o último. Assim lemos tanto
    // "1.234,56" (brasileiro) quanto "1,234.56" — o Magalu exporta assim.
    s = ptVirgula > ptPonto
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (ptVirgula >= 0) {
    // Só vírgula: no Brasil é o decimal.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return round2(neg ? -Math.abs(n) : n);
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Formata número como moeda brasileira. */
export function brl(n, { sign = false } = {}) {
  const v = Number(n) || 0;
  const s = v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return sign && v > 0 ? '+' + s : s;
}

/** Formata número sem símbolo, 2 casas. */
export const num = (n) =>
  (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Normaliza qualquer data reconhecida nos arquivos para ISO `YYYY-MM-DD`.
 * Aceita: 31/08/2026, 31/08/26, 2026-08-31, 20260831, Date, serial Excel.
 */
export function toISODate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return fmtISO(v);
  if (typeof v === 'number') {
    // Serial do Excel (dias desde 1899-12-30).
    if (v > 20000 && v < 80000) return fmtISO(new Date(Date.UTC(1899, 11, 30) + v * 864e5));
    v = String(v);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})(?!\d)/);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/); // OFX: 20260831120000[-3:BRT]
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d) ? null : fmtISO(d);
}

const fmtISO = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** `2026-08-31` -> `2026-08` (competência). */
export const competenciaOf = (iso) => (iso || '').slice(0, 7);

/** `2026-08` -> `ago/2026`. */
export function labelCompetencia(comp) {
  if (!comp) return '—';
  const [y, m] = comp.split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m) - 1] || '?'}/${y}`;
}

/** `2026-08` -> `2026-09`. */
export function nextCompetencia(comp) {
  const [y, m] = comp.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevCompetencia(comp) {
  const [y, m] = comp.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** `2026-08-31` -> `31/08/2026`. */
export function brDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Remove acentos, pontuação e espaços extras — base para casar textos. */
export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrai um CNPJ/CPF de um texto livre, retornando só os dígitos. */
export function extractDoc(s) {
  const t = String(s || '');
  const cnpj = t.match(/(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[\/\s]?(\d{4})[-\s]?(\d{2})/);
  if (cnpj) return cnpj.slice(1).join('');
  const cpf = t.match(/(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})/);
  if (cpf) return cpf.slice(1).join('');
  return null;
}

/** Hash estável (FNV-1a 64 em hex) usado para deduplicar lançamentos. */
/** Formata CNPJ (14 dígitos) ou CPF (11) a partir dos dígitos puros. */
export function formatarDoc(d) {
  const s = String(d || '').replace(/\D/g, '');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return String(d || '');
}

/** O texto é só um documento solto (sem nome)? */
export const soDocumento = (s) =>
  !!String(s || '').trim() && /^[\d.\/\-\s]+$/.test(String(s).trim());

export function hash(...parts) {
  const str = parts.map((p) => String(p ?? '')).join('|');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** Diferença em dias entre duas datas ISO. */
export const daysBetween = (a, b) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/** Agrupa um array por chave. */
export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

export const sum = (arr, f = (x) => x) => round2(arr.reduce((a, b) => a + (Number(f(b)) || 0), 0));

/** Escapa texto para inserção segura em HTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Baixa um Blob/arquivo no navegador. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
