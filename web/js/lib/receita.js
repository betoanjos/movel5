// Consulta de CNPJ em bases públicas, para trocar o número pelo nome da empresa.
//
// Só CNPJ: CPF é dado pessoal e não existe consulta pública — nesses casos o
// painel continua mostrando o documento formatado.
//
// Duas fontes gratuitas e sem cadastro, tentadas em ordem. Se as duas
// falharem (sem internet, fora do ar, limite de consultas), a busca devolve
// null e o painel segue funcionando como antes.

const FONTES = [
  {
    nome: 'BrasilAPI',
    url: (doc) => `https://brasilapi.com.br/api/cnpj/v1/${doc}`,
    ler: (d) => ({
      nome: d.razao_social || d.nome_fantasia || '',
      fantasia: d.nome_fantasia || '',
      atividade: d.cnae_fiscal_descricao || '',
      municipio: d.municipio || '',
      uf: d.uf || '',
      situacao: d.descricao_situacao_cadastral || '',
    }),
  },
  {
    nome: 'Minha Receita',
    url: (doc) => `https://minhareceita.org/${doc}`,
    ler: (d) => ({
      nome: d.razao_social || d.nome_fantasia || '',
      fantasia: d.nome_fantasia || '',
      atividade: d.cnae_fiscal_descricao || '',
      municipio: d.municipio || '',
      uf: d.uf || '',
      situacao: d.descricao_situacao_cadastral || '',
    }),
  },
];

/** Dígito verificador: evita gastar consulta com número que nem é CNPJ. */
export function cnpjValido(doc) {
  const s = String(doc || '').replace(/\D/g, '');
  if (s.length !== 14 || /^(\d)\1{13}$/.test(s)) return false;
  const calc = (base) => {
    let peso = base.length - 7, soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(s.slice(0, 12)) === Number(s[12]) && calc(s.slice(0, 13)) === Number(s[13]);
}

/**
 * Busca a razão social de um CNPJ.
 * @returns {Promise<null|{documento,nome,fantasia,atividade,municipio,uf,situacao,fonte}>}
 */
export async function consultarCNPJ(documento, { timeoutMs = 6000 } = {}) {
  const doc = String(documento || '').replace(/\D/g, '');
  if (!cnpjValido(doc)) return null;

  for (const fonte of FONTES) {
    // Sem prazo, uma base fora do ar deixa a fila inteira pendurada.
    const corta = new AbortController();
    const relogio = setTimeout(() => corta.abort(), timeoutMs);
    try {
      const r = await fetch(fonte.url(doc), { signal: corta.signal });
      if (!r.ok) continue;
      const dados = fonte.ler(await r.json());
      if (dados.nome) return { documento: doc, ...dados, fonte: fonte.nome };
    } catch {
      // Rede fora, CORS, limite de consultas: tenta a próxima fonte.
    } finally {
      clearTimeout(relogio);
    }
  }
  return null;
}

/**
 * Busca vários CNPJs em fila, com uma pausa entre um e outro para não bater
 * no limite das bases públicas.
 * @param {string[]} documentos
 * @param {(feito:number, total:number, achado:Object|null)=>void} aoAndar
 */
export async function consultarVarios(documentos, aoAndar, { pausaMs = 350, desistirApos = 2 } = {}) {
  const achados = [];
  let seguidasEmBranco = 0;
  for (let i = 0; i < documentos.length; i++) {
    const r = await consultarCNPJ(documentos[i]);
    if (r) { achados.push(r); seguidasEmBranco = 0; } else seguidasEmBranco++;
    aoAndar?.(i + 1, documentos.length, r);

    // Se nem os primeiros vieram, é a internet ou as bases — não adianta
    // insistir nos outros e fazer ele esperar à toa.
    if (seguidasEmBranco >= desistirApos && !achados.length) {
      return { achados, interrompido: true, feitos: i + 1 };
    }
    if (i < documentos.length - 1) await new Promise((ok) => setTimeout(ok, pausaMs));
  }
  return { achados, interrompido: false, feitos: documentos.length };
}
