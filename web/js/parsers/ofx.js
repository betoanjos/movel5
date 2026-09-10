// Leitor de OFX/OFC (SGML e XML). Testado com o extrato do Sicoob (VERSION:102, CP1252).
import { parseMoney, toISODate, extractDoc } from '../lib/util.js';

const tag = (bloco, nome) => {
  const m = bloco.match(new RegExp(`<${nome}>([^\\n<\\r]*)`, 'i'));
  return m ? m[1].trim() : '';
};

/** Detecta se o texto é um OFX. */
export const isOFX = (texto) => /<OFX>/i.test(texto) || /^OFXHEADER/im.test(texto);

/**
 * @param {string} texto conteúdo do arquivo .ofx
 * @returns {{contaDetectada:string|null, saldo:number|null, dataSaldo:string|null, lancamentos:Array}}
 */
export function parseOFX(texto) {
  const lancamentos = [];
  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];

  for (const b of blocos) {
    const valor = parseMoney(tag(b, 'TRNAMT'));
    if (!valor) continue;
    const memo = limpa(tag(b, 'MEMO'));
    const nome = limpa(tag(b, 'NAME'));
    const doc = tag(b, 'CHECKNUM') || tag(b, 'REFNUM') || '';

    lancamentos.push({
      data: toISODate(tag(b, 'DTPOSTED')),
      descricao: memo || nome || 'Lançamento',
      contraparte: extraiContraparte(nome, memo),
      documento: doc && doc !== '0' ? doc : '',
      valor,
      tipo: valor < 0 ? 'D' : 'C',
      ref: tag(b, 'FITID') || '',
      origem: 'ofx',
      meta: { trntype: tag(b, 'TRNTYPE'), memo, nome, cnpj: extractDoc(nome) },
    });
  }

  const bal = texto.match(/<LEDGERBAL>[\s\S]*?<\/LEDGERBAL>/i)?.[0] || '';
  const acct = texto.match(/<BANKACCTFROM>[\s\S]*?<\/BANKACCTFROM>/i)?.[0] || '';

  return {
    contaDetectada: acct ? `${tag(acct, 'BANKID')} ${tag(acct, 'BRANCHID')}/${tag(acct, 'ACCTID')}`.trim() : null,
    saldo: bal ? parseMoney(tag(bal, 'BALAMT')) : null,
    dataSaldo: bal ? toISODate(tag(bal, 'DTASOF')) : null,
    periodo: {
      inicio: toISODate(texto.match(/<DTSTART>([^\n<]*)/i)?.[1]),
      fim: toISODate(texto.match(/<DTEND>([^\n<]*)/i)?.[1]),
    },
    lancamentos,
  };
}

/** Conserta acentos perdidos quando o arquivo CP1252 é lido como UTF-8. */
function limpa(s) {
  return String(s || '')
    .replace(/�/g, '')          // caractere de substituição
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Pagamento Pix 90.400.888 0001-42" -> nome ou CNPJ do outro lado. */
function extraiContraparte(nome, memo) {
  const base = nome || '';
  const limpo = base
    .replace(/^(Pagamento|Recebimento)\s+Pix\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo || '';
}
