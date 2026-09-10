// Apuração mensal: resultado da empresa, caixa por conta, conta corrente da
// holding e a ponte que explica a diferença entre lucro e dinheiro em caixa.
import { round2, sum, competenciaOf, prevCompetencia, nextCompetencia, labelCompetencia, groupBy } from '../lib/util.js';
import { CATEGORIA_POR_ID, NAO_OPERACIONAIS } from './seed.js';

const natureza = (catId) => CATEGORIA_POR_ID[catId]?.natureza || null;
const nomeCat = (catId) => CATEGORIA_POR_ID[catId]?.nome || 'Sem categoria';
const grupoCat = (catId) => CATEGORIA_POR_ID[catId]?.grupo || 'Sem categoria';

/**
 * Saldo de abertura de uma conta numa competência.
 * Usa o fechamento do mês anterior quando existir; senão, o saldo inicial
 * cadastrado na conta somado a tudo que houve antes da competência.
 */
export function saldoAbertura(contaId, competencia, { contas, lancamentos, fechamentos }) {
  const anterior = prevCompetencia(competencia);
  const f = fechamentos.find((x) => x.competencia === anterior && x.conta_id === contaId && x.fechado);
  if (f) return round2(f.saldo_final);

  const conta = contas.find((c) => c.id === contaId);
  const base = Number(conta?.saldo_inicial || 0);
  const antes = lancamentos.filter((l) => l.conta_id === contaId && l.competencia < competencia);
  return round2(base + sum(antes, (l) => l.valor));
}

/**
 * Apuração completa de uma competência (`YYYY-MM`).
 * @param {Object} dados { lancamentos, contas, fechamentos, vendas, compras, config }
 */
export function apurar(competencia, dados) {
  const { lancamentos = [], contas = [], fechamentos = [], vendas = [], config = {} } = dados;
  const doMes = lancamentos.filter((l) => l.competencia === competencia);
  const ativos = contas.filter((c) => c.ativo !== 0);

  // Onde a receita é reconhecida.
  //
  // Por padrão, só o que chega numa conta bancária ou no caixa vira receita.
  // As contas de gateway e marketplace são tratadas como passagem: o dinheiro
  // fica lá até ser sacado, e só conta como venda quando cai no banco.
  //
  // O motivo é prático: o extrato do banco é o único número que ele consegue
  // conferir. Quem preferir reconhecer a venda já na conta do gateway pode
  // ligar isso conta a conta, em Ajustes.
  const reconhece = (contaId) => {
    const c = contas.find((x) => x.id === contaId);
    if (!c) return true;
    return c.reconhece_receita ?? (c.tipo === 'banco' || c.tipo === 'caixa');
  };
  const noCaixa = (contaId) => {
    const c = contas.find((x) => x.id === contaId);
    if (!c) return true;
    return c.entra_no_caixa ?? (c.tipo === 'banco' || c.tipo === 'caixa');
  };

  // Repasse de gateway que chega no banco: só é transferência quando a conta
  // do gateway também reconhece receita (senão a venda nunca seria contada).
  const repasses = identificarRepasses(doMes, ativos, reconhece);
  const ehRepasse = (l) => repasses.ids.has(l.id);

  // Crédito numa conta de passagem: entra no saldo dela, mas não é receita.
  const emTransito = (l) => l.valor > 0 && !reconhece(l.conta_id);

  // ------------------------------------------------------------ por conta ---
  const porConta = ativos.map((c) => {
    const lc = doMes.filter((l) => l.conta_id === c.id);
    const inicial = saldoAbertura(c.id, competencia, { contas, lancamentos, fechamentos });
    const entradas = sum(lc.filter((l) => l.valor > 0), (l) => l.valor);
    const saidas = sum(lc.filter((l) => l.valor < 0), (l) => l.valor);
    const final = round2(inicial + entradas + saidas);
    const fech = fechamentos.find((f) => f.competencia === competencia && f.conta_id === c.id);
    const saldoBanco = fech && fech.saldo_banco != null ? Number(fech.saldo_banco) : null;
    return {
      conta: c, contaId: c.id, nome: c.nome, cor: c.cor, tipo: c.tipo,
      inicial, entradas, saidas, final,
      movimentos: lc.length,
      saldoBanco,
      diferenca: saldoBanco == null ? null : round2(saldoBanco - final),
      fechado: !!(fech && fech.fechado),
      reconheceReceita: reconhece(c.id),
      entraNoCaixa: noCaixa(c.id),
    };
  });

  const contasCaixa = porConta.filter((c) => c.entraNoCaixa);
  const contasTransito = porConta.filter((c) => !c.entraNoCaixa);

  const caixa = {
    inicial: sum(contasCaixa, (c) => c.inicial),
    entradas: sum(contasCaixa, (c) => c.entradas),
    saidas: sum(contasCaixa, (c) => c.saidas),
    final: sum(contasCaixa, (c) => c.final),
  };
  caixa.variacao = round2(caixa.final - caixa.inicial);

  // Dinheiro que já é da empresa mas ainda não chegou ao banco.
  const transito = {
    contas: contasTransito,
    inicial: sum(contasTransito, (c) => c.inicial),
    final: sum(contasTransito, (c) => c.final),
    entradas: sum(contasTransito, (c) => c.entradas),
    saidas: sum(contasTransito, (c) => c.saidas),
  };
  transito.variacao = round2(transito.final - transito.inicial);

  // ------------------------------------------------------- resultado -------
  const operacionais = doMes.filter((l) =>
    l.categoria && !NAO_OPERACIONAIS.has(l.categoria) && !ehRepasse(l) && !emTransito(l));
  const receitasL = operacionais.filter((l) => natureza(l.categoria) === 'receita');
  const despesasL = operacionais.filter((l) => natureza(l.categoria) === 'despesa');

  const receitas = sum(receitasL, (l) => Math.abs(l.valor));
  // Taxas de cartão/gateway ficam embutidas no valor líquido; somamos à parte
  // para que a receita apareça bruta e a taxa como custo real.
  const taxasEmbutidas = sum(doMes.filter((l) => reconhece(l.conta_id)), (l) => Number(l.taxa) || 0);
  const receitaBruta = round2(receitas + taxasEmbutidas);
  const despesas = round2(sum(despesasL, (l) => Math.abs(l.valor)) + taxasEmbutidas);
  const resultadoOperacional = round2(receitaBruta - despesas);

  // ------------------------------------------------------ por categoria ----
  const catMap = new Map();
  const somaCat = (catId, valor, extra = 0) => {
    if (!catMap.has(catId)) {
      catMap.set(catId, {
        id: catId, nome: nomeCat(catId), grupo: grupoCat(catId),
        natureza: natureza(catId), total: 0, qtd: 0,
      });
    }
    const e = catMap.get(catId);
    e.total = round2(e.total + Math.abs(valor) + extra);
    e.qtd++;
  };
  for (const l of operacionais) somaCat(l.categoria, l.valor);
  if (taxasEmbutidas > 0) {
    catMap.set('des_taxas_gateway', {
      id: 'des_taxas_gateway', nome: nomeCat('des_taxas_gateway'), grupo: 'Custos',
      natureza: 'despesa',
      total: round2((catMap.get('des_taxas_gateway')?.total || 0) + taxasEmbutidas),
      qtd: (catMap.get('des_taxas_gateway')?.qtd || 0) + doMes.filter((l) => Number(l.taxa) > 0).length,
    });
    // Receita bruta: devolve a taxa retida ao valor da venda.
    const rv = catMap.get('rec_vendas');
    if (rv) rv.total = round2(rv.total + taxasEmbutidas);
  }

  const categorias = [...catMap.values()].sort((a, b) => b.total - a.total);
  const despesasPorCategoria = categorias.filter((c) => c.natureza === 'despesa');
  const receitasPorCategoria = categorias.filter((c) => c.natureza === 'receita');
  for (const c of despesasPorCategoria) c.pct = despesas ? round2((c.total / despesas) * 100) : 0;
  for (const c of receitasPorCategoria) c.pct = receitaBruta ? round2((c.total / receitaBruta) * 100) : 0;

  const grupos = [...groupBy(despesasPorCategoria, (c) => c.grupo)].map(([nome, itens]) => ({
    nome, total: sum(itens, (i) => i.total), itens,
    pct: despesas ? round2((sum(itens, (i) => i.total) / despesas) * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // ------------------------------------------------------------ holding ----
  const holding = calcularHolding(competencia, lancamentos);

  // ------------------------------------------------- não operacionais ------
  const somaNat = (nat) =>
    sum(doMes.filter((l) => natureza(l.categoria) === nat && !ehRepasse(l) && !emTransito(l)), (l) => l.valor);
  const naoOperacional = {
    transferencias: round2(somaNat('transferencia') + repasses.total),
    investimentos: somaNat('investimento'),
    emprestimos: somaNat('emprestimo'),
    holding: holding.movimentoLiquido,
    semCategoria: sum(doMes.filter((l) => !l.categoria), (l) => l.valor),
  };

  // ------------------------------------------------------------- ponte ----
  // Explica, linha a linha, por que o lucro difere do dinheiro que sobrou.
  // A ponte explica a variação do CAIXA, então só o que passou por conta de
  // caixa entra nela. O que entrou no gateway e ainda não foi sacado aparece
  // à parte, como dinheiro em trânsito.
  const soCaixa = (l) => noCaixa(l.conta_id);
  const somaCaixa = (fn) => sum(doMes.filter((l) => soCaixa(l) && fn(l)), (l) => l.valor);
  const transferenciasCaixa = somaCaixa((l) => natureza(l.categoria) === 'transferencia' || ehRepasse(l));
  const emprestimosCaixa = somaCaixa((l) => natureza(l.categoria) === 'emprestimo');
  const investimentosCaixa = somaCaixa((l) => natureza(l.categoria) === 'investimento');
  const holdingCaixa = somaCaixa((l) => natureza(l.categoria) === 'holding');
  const semCategoriaCaixa = somaCaixa((l) => !l.categoria);
  const repassesCaixa = sum(doMes.filter((l) => ehRepasse(l) && soCaixa(l)), (l) => l.valor);

  const ponte = [
    { rotulo: 'Resultado operacional do mês', valor: resultadoOperacional, destaque: true },
    { rotulo: 'Taxas descontadas na origem', valor: taxasEmbutidas, nota: 'somadas de volta: o dinheiro nunca entrou na conta', oculto: taxasEmbutidas === 0, inverso: true },
    { rotulo: 'Holding (sócios)', valor: holdingCaixa },
    { rotulo: 'Empréstimos', valor: emprestimosCaixa },
    { rotulo: 'Aplicações e resgates', valor: investimentosCaixa },
    { rotulo: 'Transferências entre contas', valor: round2(transferenciasCaixa - repassesCaixa) },
    { rotulo: 'Recebido dos gateways', valor: repassesCaixa,
      oculto: repassesCaixa === 0,
      nota: 'venda já contada quando caiu na conta do gateway' },
    { rotulo: 'Ainda sem categoria', valor: semCategoriaCaixa, alerta: semCategoriaCaixa !== 0 },
  ].filter((x) => !x.oculto);

  const variacaoExplicada = round2(
    resultadoOperacional - taxasEmbutidas + holdingCaixa +
    emprestimosCaixa + investimentosCaixa + transferenciasCaixa + semCategoriaCaixa
  );
  ponte.push({ rotulo: 'Variação de caixa explicada', valor: variacaoExplicada, total: true });
  const residuo = round2(caixa.variacao - variacaoExplicada);

  // ------------------------------------------------------- faturamento ----
  const vendasMes = vendas.filter((v) => competenciaOf(v.data) === competencia && !v.cancelado);
  const faturamento = {
    qtd: vendasMes.length,
    total: sum(vendasMes, (v) => v.total),
    ticketMedio: vendasMes.length ? round2(sum(vendasMes, (v) => v.total) / vendasMes.length) : 0,
    canais: [...groupBy(vendasMes, (v) => v.canal || 'Não informado')]
      .map(([nome, itens]) => ({ nome, qtd: itens.length, total: sum(itens, (v) => v.total) }))
      .sort((a, b) => b.total - a.total),
    cancelados: sum(vendas.filter((v) => competenciaOf(v.data) === competencia && v.cancelado), (v) => v.total),
  };
  faturamento.recebidoNoCaixa = receitaBruta;
  faturamento.diferenca = round2(receitaBruta - faturamento.total);

  // ---------------------------------------------------------- alertas -----
  const alertas = [];
  const semCat = doMes.filter((l) => !l.categoria && !ehRepasse(l));
  if (transito.final || transito.variacao) {
    const desproporcional = transito.final > Math.max(5000, Math.abs(caixa.entradas) * 0.5);
    alertas.push({
      nivel: 'info',
      texto: desproporcional
        ? `${fmt(transito.final)} aparecem como saldo parado nas contas de gateway. Se na prática tudo que entra no gateway é transferido para o banco, esse número não deveria crescer — em geral significa que o relatório exportado lista as parcelas futuras, e não o dinheiro que entrou no mês. Nesse caso o extrato do gateway é dispensável: o crédito no banco já é a receita.`
        : `${fmt(transito.final)} estão nas contas de gateway/marketplace e ainda não caíram no banco. Esse valor não entra no caixa nem no resultado — vira receita quando for sacado.`,
      acao: 'conciliar',
    });
  }
  if (repasses.total) {
    alertas.push({
      nivel: 'info',
      texto: `${repasses.ids.size} recebimento(s) no banco, somando ${fmt(repasses.total)}, são repasses de gateway/marketplace. Como a conta do gateway também foi importada, essas vendas já estão contadas lá — aqui entram como transferência, para não dobrar a receita.`,
      acao: 'revisar',
    });
  }
  if (semCat.length) {
    alertas.push({
      nivel: 'atencao',
      texto: `${semCat.length} lançamento(s) sem categoria, somando ${fmt(sum(semCat, (l) => Math.abs(l.valor)))}. Enquanto não forem classificados, o resultado do mês está incompleto.`,
      acao: 'revisar',
    });
  }
  const baixaConfianca = doMes.filter((l) => l.categoria && l.confianca === 'baixa' && !l.travado);
  if (baixaConfianca.length) {
    alertas.push({
      nivel: 'info',
      texto: `${baixaConfianca.length} lançamento(s) foram classificados por palpite e merecem uma conferência rápida.`,
      acao: 'revisar',
    });
  }
  const gatewaysQueContam = ativos.filter(
    (c) => (c.tipo === 'gateway' || c.tipo === 'marketplace') && reconhece(c.id)
  );
  if (gatewaysQueContam.length) {
    const semPar = doMes.filter(
      (l) => l.possivel_transferencia && !l.transfer_id && !ehRepasse(l) && l.valor > 0 && noCaixa(l.conta_id)
    );
    if (semPar.length) {
      alertas.push({
        nivel: 'atencao',
        texto: `${semPar.length} recebimento(s) no banco parecem repasse de gateway, mas não achei o outro lado. Como ${gatewaysQueContam.map((c) => c.nome).join(' e ')} está configurado para reconhecer receita, existe risco de contar a mesma venda duas vezes.`,
        acao: 'importar',
      });
    }
  }
  for (const c of porConta) {
    if (c.diferenca != null && Math.abs(c.diferenca) >= 0.01) {
      alertas.push({
        nivel: 'erro',
        texto: `${c.nome}: o saldo calculado (${fmt(c.final)}) não bate com o saldo informado do banco (${fmt(c.saldoBanco)}). Diferença de ${fmt(c.diferenca)}.`,
        acao: 'conciliar',
      });
    }
  }
  if (Math.abs(residuo) >= 0.01) {
    alertas.push({
      nivel: 'erro',
      texto: `Diferença de ${fmt(residuo)} entre a variação de caixa e a soma das explicações. Normalmente é lançamento sem categoria ou transferência só de um lado.`,
      acao: 'revisar',
    });
  }

  return {
    competencia,
    rotulo: labelCompetencia(competencia),
    porConta, caixa, transito,
    resultado: {
      receitas: receitaBruta,
      despesas,
      resultadoOperacional,
      margem: receitaBruta ? round2((resultadoOperacional / receitaBruta) * 100) : 0,
      taxasEmbutidas,
    },
    categorias, receitasPorCategoria, despesasPorCategoria, grupos,
    holding, naoOperacional, ponte, residuo, faturamento, alertas, repasses,
    contagem: {
      lancamentos: doMes.length,
      semCategoria: semCat.length,
      pendentes: semCat.length + baixaConfianca.length,
      conciliados: doMes.filter((l) => l.conciliado).length,
    },
  };
}

/**
 * Recebimentos no banco que são apenas repasse de uma conta de gateway
 * já importada. Só valem como transferência se a conta do gateway tiver
 * movimento no mesmo mês — se ele não importou o gateway, o dinheiro que
 * chega no banco É a receita e continua contando como tal.
 *
 * @returns {{ids:Set<string>, total:number, contas:string[]}}
 */
export function identificarRepasses(doMes, contas, reconhece = () => true) {
  // Só conta como repasse quando o gateway de fato reconhece a venda; se ele
  // é tratado como passagem, a receita é reconhecida aqui, no banco.
  const repasse = new Set(
    contas.filter((c) => (c.tipo === 'gateway' || c.tipo === 'marketplace') && reconhece(c.id)).map((c) => c.id)
  );
  const comMovimento = [...new Set(doMes.filter((l) => repasse.has(l.conta_id)).map((l) => l.conta_id))];
  if (!comMovimento.length) return { ids: new Set(), total: 0, contas: [] };

  const ids = new Set();
  let total = 0;
  for (const l of doMes) {
    if (repasse.has(l.conta_id)) continue;          // só o lado do banco
    if (l.valor <= 0) continue;
    if (l.transfer_id) continue;                     // já pareado de verdade
    if (l.travado) continue;                         // ele decidiu à mão
    if (!l.possivel_transferencia) continue;
    ids.add(l.id);
    total = round2(total + l.valor);
  }
  return { ids, total, contas: comMovimento };
}

/**
 * Conta corrente com a holding / sócios.
 *
 * Regra: dinheiro que a empresa gastou com coisas dos sócios aumenta o que a
 * holding deve à empresa. Dinheiro que os sócios colocaram na empresa reduz.
 * O saldo é acumulado desde o início — é uma conta corrente, não um resultado.
 */
export function calcularHolding(competencia, lancamentos) {
  const eh = (l) => natureza(l.categoria) === 'holding';
  const ateAgora = lancamentos.filter((l) => eh(l) && l.competencia <= competencia);
  const doMes = lancamentos.filter((l) => eh(l) && l.competencia === competencia);

  // Saída de caixa da empresa por conta dos sócios => holding fica devendo.
  const pagoPelaEmpresa = sum(doMes.filter((l) => l.valor < 0), (l) => Math.abs(l.valor));
  const aportado = sum(doMes.filter((l) => l.valor > 0), (l) => l.valor);
  const movimentoLiquido = sum(doMes, (l) => l.valor);

  const saldoAcumulado = round2(
    sum(ateAgora.filter((l) => l.valor < 0), (l) => Math.abs(l.valor)) -
    sum(ateAgora.filter((l) => l.valor > 0), (l) => l.valor)
  );

  return {
    pagoPelaEmpresa,
    aportado,
    movimentoLiquido,
    saldoAcumulado,
    devedor: saldoAcumulado >= 0 ? 'holding' : 'empresa',
    interpretacao: saldoAcumulado > 0
      ? `A holding/sócios devem ${fmt(saldoAcumulado)} à Móvel5.`
      : saldoAcumulado < 0
        ? `A Móvel5 deve ${fmt(Math.abs(saldoAcumulado))} à holding/sócios.`
        : 'Contas acertadas com a holding.',
    lancamentosMes: doMes,
  };
}

/**
 * Série histórica para os gráficos e comparações.
 * @returns {Array} uma entrada por competência, da mais antiga para a mais nova
 */
export function serieHistorica(dados, { ate, meses = 12 } = {}) {
  const { lancamentos = [] } = dados;
  const comps = [...new Set(lancamentos.map((l) => l.competencia).filter(Boolean))].sort();
  if (!comps.length) return [];
  const fim = ate || comps[comps.length - 1];

  const lista = [];
  let c = fim;
  for (let i = 0; i < meses; i++) { lista.unshift(c); c = prevCompetencia(c); }

  return lista
    .filter((comp) => comp >= comps[0])
    .map((comp) => {
      const a = apurar(comp, dados);
      return {
        competencia: comp,
        rotulo: labelCompetencia(comp),
        receitas: a.resultado.receitas,
        despesas: a.resultado.despesas,
        resultado: a.resultado.resultadoOperacional,
        margem: a.resultado.margem,
        caixaFinal: a.caixa.final,
        entradas: a.caixa.entradas,
        saidas: Math.abs(a.caixa.saidas),
        holding: a.holding.saldoAcumulado,
        faturamento: a.faturamento.total,
        lancamentos: a.contagem.lancamentos,
      };
    });
}

/** Compara duas competências categoria a categoria. */
export function comparar(compA, compB, dados) {
  const a = apurar(compA, dados);
  const b = apurar(compB, dados);
  const ids = new Set([...a.categorias.map((c) => c.id), ...b.categorias.map((c) => c.id)]);
  const linhas = [...ids].map((id) => {
    const va = a.categorias.find((c) => c.id === id)?.total || 0;
    const vb = b.categorias.find((c) => c.id === id)?.total || 0;
    return {
      id, nome: nomeCat(id), grupo: grupoCat(id), natureza: natureza(id),
      anterior: va, atual: vb, delta: round2(vb - va),
      deltaPct: va ? round2(((vb - va) / va) * 100) : null,
    };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return { a, b, linhas };
}

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
