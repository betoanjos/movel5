// Motor de importação: deduplicação, enriquecimento, categorização
// automática e detecção de transferências entre contas próprias.
import { normalize, hash, round2, daysBetween, competenciaOf, uid, extractDoc } from '../lib/util.js';
import { REGRAS_PADRAO, CATEGORIA_POR_ID } from './seed.js';

// ------------------------------------------------------------ DEDUPLICAÇÃO ---

/**
 * Chave de deduplicação. Quando o arquivo traz identificador próprio (FITID do
 * OFX, ID da transação do gateway) usamos ele; senão, data+valor+descrição.
 * O sufixo `#n` permite duas linhas idênticas legítimas no mesmo dia.
 */
export function chaveDedupe(l, contaId, ocorrencia = 0) {
  const base = l.ref
    ? `${contaId}|ref|${l.ref}`
    : `${contaId}|dv|${l.data}|${round2(l.valor).toFixed(2)}|${normalize(l.descricao).slice(0, 40)}`;
  return hash(base, ocorrencia);
}

/**
 * Chave "fraca": mesma conta, mesma data e mesmo valor. Detecta o mesmo
 * lançamento vindo de fontes diferentes (ex.: OFX e extrato em PDF).
 */
export const chaveFraca = (l, contaId, ocorrencia = 0) =>
  hash(`${contaId}|fraca|${l.data}|${round2(l.valor).toFixed(2)}`, ocorrencia);

// ----------------------------------------------------------- ENRIQUECIMENTO ---

/**
 * Aplica enriquecimentos (nome do beneficiário do boleto, nome do
 * destinatário do PIX) sobre uma lista de lançamentos.
 * @returns {number} quantos lançamentos ganharam nome
 */
export function aplicarEnriquecimentos(lancamentos, enriquecimentos) {
  if (!enriquecimentos.length) return 0;

  const porDocumento = new Map();
  const porDataValor = new Map();
  for (const e of enriquecimentos) {
    if (e.documentoChave) {
      porDocumento.set(String(e.documentoChave).replace(/\D/g, ''), e);
    }
    const k = `${e.data}|${Math.abs(round2(e.valor)).toFixed(2)}`;
    if (!porDataValor.has(k)) porDataValor.set(k, []);
    porDataValor.get(k).push(e);
  }

  let n = 0;
  for (const l of lancamentos) {
    if (l.enriquecido) continue;
    let achado = null;

    // 1) Casamento exato pelo número do agendamento do boleto.
    const doc = String(l.documento || '').replace(/\D/g, '');
    if (doc && porDocumento.has(doc)) {
      const e = porDocumento.get(doc);
      if (Math.abs(Math.abs(e.valor) - Math.abs(l.valor)) < 0.02) achado = e;
    }

    // 2) Casamento por data + valor (com tolerância de dias opcional).
    if (!achado) {
      const k = `${l.data}|${Math.abs(round2(l.valor)).toFixed(2)}`;
      const cands = (porDataValor.get(k) || []).filter(
        (e) => Math.sign(e.valor) === Math.sign(l.valor) && !e.__usado
      );
      if (cands.length) achado = cands[0];
      else {
        // Tolerância: boleto liquidado alguns dias depois do vencimento.
        for (const [kk, lista] of porDataValor) {
          const [d, v] = kk.split('|');
          if (v !== Math.abs(round2(l.valor)).toFixed(2)) continue;
          const cand = lista.find((e) => !e.__usado && Math.sign(e.valor) === Math.sign(l.valor)
            && Math.abs(daysBetween(d, l.data)) <= (e.tolerancia ?? 3));
          if (cand) { achado = cand; break; }
        }
      }
    }

    if (achado) {
      achado.__usado = true;
      if (achado.contraparte && !l.contraparte) l.contraparte = achado.contraparte;
      else if (achado.contraparte && l.contraparte && !normalize(l.contraparte).includes(normalize(achado.contraparte).slice(0, 12))) {
        l.contraparte = achado.contraparte;
      }
      if (achado.documento && !l.doc_contraparte) l.doc_contraparte = achado.documento;
      l.detalhe = [l.detalhe, achado.detalhe].filter(Boolean).join(' · ');
      l.enriquecido = 1;
      l.fonte_enriquecimento = achado.fonte;
      n++;
    }
  }
  return n;
}

// -------------------------------------------------------- CONTRAPARTES ------

/**
 * Índice CNPJ/CPF -> contato, montado a partir do relatório de contatos do
 * Bling e do que o usuário já cadastrou.
 */
export function indexarContrapartes(contrapartes = []) {
  const idx = new Map();
  for (const c of contrapartes) {
    const doc = String(c.documento || '').replace(/\D/g, '');
    if (doc.length >= 11) idx.set(doc, c);
  }
  return idx;
}

/**
 * Dá nome e categoria aos lançamentos cujo CNPJ/CPF já é conhecido.
 * É o que transforma "PIX EMITIDO OUTRA IF — 09.574.015/0001-38" em
 * "LINZ FABRICA DE MOVEIS — Fornecedores", sem ninguém digitar nada.
 * @returns {number} quantos lançamentos foram identificados
 */
export function aplicarContrapartes(lancamentos, indice) {
  if (!indice || !indice.size) return 0;
  let n = 0;
  for (const l of lancamentos) {
    const doc = docContraparte(l);
    if (!doc) continue;
    const c = indice.get(doc);
    if (!c) continue;
    l.doc_contraparte = doc;
    // O nome do cadastro é melhor que o texto solto do extrato.
    if (c.nome && (!l.contraparte || /^[\d.\/\- ]+$/.test(l.contraparte))) l.contraparte = c.nome;
    l.contraparte_tipo = c.tipo || '';
    if (c.categoriaSugerida) l.categoria_contraparte = c.categoriaSugerida;
    l.identificado = 1;
    n++;
  }
  return n;
}

// ----------------------------------------------------------- CATEGORIZAÇÃO ---

/**
 * Texto usado pelas regras: descrição + contraparte + detalhe + documentos.
 * O CNPJ/CPF entra também em dígitos puros — é o identificador que mais se
 * repete no extrato, então uma regra por documento resolve dezenas de linhas
 * de uma vez (ex.: todo PIX para 82.951.310/0001-56 é ICMS).
 */
export const textoRegra = (l) => {
  const doc = l.doc_contraparte || extractDoc(l.contraparte) || extractDoc(l.descricao);
  return normalize(
    [l.descricao, l.contraparte, l.detalhe, l.documento, l.doc_contraparte].filter(Boolean).join(' ')
  ) + (doc ? ' ' + String(doc).replace(/\D/g, '') : '');
};

/** Documento (CNPJ/CPF) da contraparte, quando identificável. */
export const docContraparte = (l) =>
  (l.doc_contraparte || extractDoc(l.contraparte) || extractDoc(l.descricao) || '').replace(/\D/g, '');

/**
 * Escolhe a categoria de um lançamento.
 *
 * Ordem de precedência:
 *   1. regra criada pelo usuário  (ele mandou, vale)
 *   2. cadastro da contraparte     (CNPJ identificado no Bling)
 *   3. regras padrão por texto
 *   4. sugestão do próprio arquivo
 *
 * @param {Object} l lançamento
 * @param {Array} regrasUsuario regras aprendidas (têm prioridade sobre as padrão)
 * @returns {{categoria:string|null, confianca:'alta'|'baixa'|null, regra:string|null}}
 */
export function categorizar(l, regrasUsuario = []) {
  // Sugestão que veio do próprio parser (ex.: saque de gateway).
  const texto = textoRegra(l);
  const sinal = l.valor < 0 ? 'D' : 'C';

  const todas = [
    ...regrasUsuario.map((r) => ({ ...r, prioridade: (r.prioridade ?? 200), origem: 'usuario' })),
    ...REGRAS_PADRAO.map((r) => ({ ...r, origem: 'padrao' })),
  ].sort((a, b) => b.prioridade - a.prioridade);

  // Uma regra explícita do usuário ainda ganha do cadastro; por isso a busca
  // acontece em dois passos.
  const doUsuario = todas.filter((r) => r.origem === 'usuario');
  for (const r of doUsuario) {
    if (r.sinal && r.sinal !== sinal) continue;
    if (r.conta_id && r.conta_id !== l.conta_id) continue;
    const alvo = normalize(r.padrao);
    if (alvo && (r.exato ? texto === alvo : texto.includes(alvo))) {
      return { categoria: r.categoria, confianca: 'alta', regra: r.padrao, possivelTransferencia: r.possivelTransferencia ? 1 : 0 };
    }
  }

  if (l.categoria_contraparte) {
    return {
      categoria: l.categoria_contraparte,
      confianca: 'alta',
      regra: `cadastro: ${l.contraparte || l.doc_contraparte}`,
      possivelTransferencia: 0,
    };
  }

  for (const r of todas) {
    if (r.origem === 'usuario') continue;
    if (r.sinal && r.sinal !== sinal) continue;
    if (r.conta_id && r.conta_id !== l.conta_id) continue;
    const alvo = normalize(r.padrao);
    if (!alvo) continue;
    const casa = r.exato ? texto === alvo : texto.includes(alvo);
    if (!casa) continue;
    return {
      categoria: r.categoria,
      confianca: r.origem === 'usuario' ? 'alta' : (r.confianca || 'alta'),
      regra: r.padrao,
      possivelTransferencia: r.possivelTransferencia ? 1 : 0,
    };
  }

  if (l.sugestao) {
    return {
      categoria: l.sugestao, confianca: 'alta', regra: 'origem do arquivo',
      possivelTransferencia: l.sugestao === 'trf_interna' ? 1 : 0,
    };
  }
  return { categoria: null, confianca: null, regra: null, possivelTransferencia: 0 };
}

// ------------------------------------------------------ TRANSFERÊNCIAS ------

/**
 * Casa saídas de uma conta com entradas de outra: o saque do gateway que cai
 * no banco, o PIX entre contas próprias. Sem isso, o mesmo dinheiro é contado
 * duas vezes e a receita aparece inflada.
 *
 * @param {Array} lancamentos todos os lançamentos do período (várias contas)
 * @param {{janelaDias:number, tolerancia:number}} opts
 * @returns {{pares:Array, marcados:number}}
 */
export function detectarTransferencias(lancamentos, { janelaDias = 5, tolerancia = 0.02 } = {}) {
  const saidas = lancamentos.filter((l) => l.valor < 0 && !l.transfer_id && !l.bloqueia_transferencia);
  const entradas = lancamentos.filter((l) => l.valor > 0 && !l.transfer_id && !l.bloqueia_transferencia);

  const porValor = new Map();
  for (const e of entradas) {
    const k = Math.abs(round2(e.valor)).toFixed(2);
    if (!porValor.has(k)) porValor.set(k, []);
    porValor.get(k).push(e);
  }

  const pares = [];
  for (const s of saidas) {
    const k = Math.abs(round2(s.valor)).toFixed(2);
    const cands = (porValor.get(k) || []).filter(
      (e) => e.conta_id !== s.conta_id && !e.__pareado &&
             Math.abs(daysBetween(s.data, e.data)) <= janelaDias
    );
    if (!cands.length) continue;

    // Prefere a entrada mais próxima no tempo.
    cands.sort((a, b) => Math.abs(daysBetween(s.data, a.data)) - Math.abs(daysBetween(s.data, b.data)));
    const e = cands[0];
    e.__pareado = true;

    const tid = 'trf_' + uid();
    s.transfer_id = tid; e.transfer_id = tid;
    s.categoria = 'trf_interna'; e.categoria = 'trf_interna';
    s.confianca = 'alta'; e.confianca = 'alta';
    s.conciliado = 1; e.conciliado = 1;
    pares.push({ transfer_id: tid, saida: s, entrada: e, valor: Math.abs(s.valor), dias: Math.abs(daysBetween(s.data, e.data)) });
  }

  for (const e of entradas) delete e.__pareado;
  return { pares, marcados: pares.length * 2 };
}

// --------------------------------------------------------- PIPELINE IMPORT ---

/**
 * Roda a importação completa de um conjunto de arquivos já lidos.
 *
 * @param {Array} resultados saída de `lerArquivo`
 * @param {Object} ctx { contaPadraoId, contaPorArquivo, existentes, regrasUsuario, enriquecimentosSalvos }
 * @returns {Object} resumo + registros prontos para gravar
 */
export function processarImportacao(resultados, ctx) {
  const {
    contaPorArquivo = {}, contaPadraoId = null,
    existentes = [], regrasUsuario = [], enriquecimentosSalvos = [],
  } = ctx;

  // Índice do que já está gravado, para não duplicar.
  const chavesExistentes = new Set(existentes.map((l) => l.dedupe));
  const fracasExistentes = new Map();
  for (const l of existentes) {
    const k = chaveFraca(l, l.conta_id, 0);
    fracasExistentes.set(k, (fracasExistentes.get(k) || 0) + 1);
  }

  const novosEnriquecimentos = [];
  const novasVendas = [];
  const novasCompras = [];
  const novosDiasVenda = [];
  const novasContasPagar = [];
  const novosContatos = [];
  const brutos = [];
  const porArquivo = [];

  for (const r of resultados) {
    if (r.erro && !r.lancamentos.length && !r.enriquecimentos.length) {
      porArquivo.push({ arquivo: r.arquivo, tipo: r.tipo, erro: r.erro, novos: 0, duplicados: 0 });
      continue;
    }
    const contaId = contaPorArquivo[r.arquivo] || contaPadraoId;
    novosEnriquecimentos.push(...r.enriquecimentos);
    novasVendas.push(...r.vendas);
    novasCompras.push(...r.compras);
    novosDiasVenda.push(...r.diasVenda);
    novasContasPagar.push(...(r.contasPagar || []));
    novosContatos.push(...(r.contatos || []));

    for (const l of r.lancamentos) {
      brutos.push({ ...l, conta_id: contaId, arquivo: r.arquivo });
    }
    porArquivo.push({
      arquivo: r.arquivo, tipo: r.tipo, aviso: r.extra?.aviso,
      lidos: r.lancamentos.length,
      enriquecimentos: r.enriquecimentos.length,
      vendas: r.vendas.length, compras: r.compras.length,
      novos: 0, duplicados: 0,
    });
  }

  // --- Deduplicação ---
  const contador = new Map();
  const contadorFraco = new Map();
  const novos = [];
  const duplicados = [];

  for (const l of brutos) {
    const cBase = `${l.conta_id}|${l.ref || l.data + l.valor + normalize(l.descricao).slice(0, 40)}`;
    const oc = contador.get(cBase) || 0;
    contador.set(cBase, oc + 1);
    const dedupe = chaveDedupe(l, l.conta_id, oc);

    const fk = chaveFraca(l, l.conta_id, 0);
    const jaFracas = (fracasExistentes.get(fk) || 0);
    const ocFraco = contadorFraco.get(fk) || 0;

    const item = { ...l, dedupe };
    const linhaArquivo = porArquivo.find((p) => p.arquivo === l.arquivo);

    if (chavesExistentes.has(dedupe)) {
      duplicados.push({ ...item, motivo: 'Já importado antes (mesmo identificador).' });
      if (linhaArquivo) linhaArquivo.duplicados++;
      continue;
    }
    // Mesma conta/data/valor já gravada por outra fonte (ex.: OFX x PDF).
    if (jaFracas > ocFraco) {
      contadorFraco.set(fk, ocFraco + 1);
      duplicados.push({ ...item, motivo: 'Mesma data e valor já existem nesta conta (provável arquivo repetido).' });
      if (linhaArquivo) linhaArquivo.duplicados++;
      continue;
    }
    contadorFraco.set(fk, ocFraco + 1);
    chavesExistentes.add(dedupe);
    novos.push(item);
    if (linhaArquivo) linhaArquivo.novos++;
  }

  // --- Enriquecimento (usa também o que já foi salvo em importações anteriores) ---
  const todosEnriq = [...novosEnriquecimentos, ...enriquecimentosSalvos.map((e) => ({ ...e }))];
  const enriquecidosNovos = aplicarEnriquecimentos(novos, todosEnriq);
  // Lançamentos antigos ainda sem nome também aproveitam os enriquecimentos novos.
  const semNome = existentes.filter((l) => !l.enriquecido && !l.contraparte);
  const enriquecidosAntigos = aplicarEnriquecimentos(semNome, novosEnriquecimentos);

  // --- Identificação de contrapartes pelo CNPJ ---
  const idxContrapartes = indexarContrapartes(ctx.contrapartes || []);
  const identificados = aplicarContrapartes(novos, idxContrapartes) +
                        aplicarContrapartes(existentes.filter((l) => !l.identificado), idxContrapartes);

  // --- Categorização ---
  let autoCategorizados = 0;
  for (const l of novos) {
    l.competencia = competenciaOf(l.data);
    const c = categorizar(l, regrasUsuario);
    l.categoria = c.categoria;
    l.confianca = c.confianca;
    l.regra_aplicada = c.regra;
    l.possivel_transferencia = c.possivelTransferencia || 0;
    l.conciliado = c.categoria && c.confianca === 'alta' ? 1 : 0;
    if (c.categoria) autoCategorizados++;
  }

  // --- Transferências (considera o histórico para casar com o outro lado) ---
  const universo = [...existentes.filter((l) => !l.transfer_id), ...novos];
  const { pares } = detectarTransferencias(universo);
  const paresNovos = pares.filter((p) => novos.includes(p.saida) || novos.includes(p.entrada));
  const alteradosAntigos = universo.filter((l) => existentes.includes(l) && l.transfer_id);

  return {
    novos,
    duplicados,
    alteradosAntigos: [...new Set([...alteradosAntigos, ...semNome.filter((l) => l.enriquecido)])],
    enriquecimentos: novosEnriquecimentos,
    vendas: novasVendas,
    compras: novasCompras,
    diasVenda: novosDiasVenda,
    contasPagar: novasContasPagar,
    contatos: novosContatos,
    porArquivo,
    resumo: {
      arquivos: resultados.length,
      lidos: brutos.length,
      novos: novos.length,
      duplicados: duplicados.length,
      autoCategorizados,
      enriquecidos: enriquecidosNovos + enriquecidosAntigos,
      identificados,
      transferencias: paresNovos.length,
      pendentes: novos.filter((l) => !l.categoria || l.confianca === 'baixa').length,
    },
    pares: paresNovos,
  };
}

/** Recategoriza lançamentos existentes após mudança nas regras. */
export function recategorizar(lancamentos, regrasUsuario, { apenasPendentes = true } = {}) {
  let n = 0;
  for (const l of lancamentos) {
    if (l.travado) continue;                       // categoria definida à mão
    if (apenasPendentes && l.categoria && l.confianca === 'alta') continue;
    if (l.transfer_id) continue;
    const c = categorizar(l, regrasUsuario);
    if (c.categoria && c.categoria !== l.categoria) {
      l.categoria = c.categoria;
      l.confianca = c.confianca;
      l.regra_aplicada = c.regra;
      n++;
    }
  }
  return n;
}
