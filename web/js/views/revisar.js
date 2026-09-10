// Caixa de revisão: só o que precisa de decisão humana.
// A ideia é resolver um punhado de linhas hoje e nunca mais ver as parecidas —
// cada escolha vira regra e vale para todas as importações seguintes.
import { estado, salvar, categorias, nomeCategoria, nomeConta, remover,
         ehHolding, destinosHolding, reconheceReceita } from '../store.js';
import { recategorizar, docContraparte, regraCombina, rotuloRegra } from '../engine/motor.js';
import { CATEGORIA_POR_ID } from '../engine/seed.js';
import { brl, brDate, esc, uid, normalize, labelCompetencia, round2, formatarDoc } from '../lib/util.js';
import { icone, bloco, avisar, vazio, liga, modal, selectCategorias } from '../lib/ui.js';
import { desmembrar, resumoSelecionados } from './lancamentos.js';

let filtro = 'pendentes';
let selecionados = new Set();

export function telaRevisar(raiz, { ir }) {
  selecionados = new Set();
  desenhar(raiz, ir);
}

const pendente = (l) => !l.categoria || (l.confianca === 'baixa' && !l.travado);

function listar() {
  const doMes = estado.lancamentos.filter((l) => l.competencia === estado.competencia);
  if (filtro === 'pendentes') return doMes.filter(pendente);
  if (filtro === 'sem-categoria') return doMes.filter((l) => !l.categoria);
  if (filtro === 'palpite') return doMes.filter((l) => l.categoria && l.confianca === 'baixa' && !l.travado);
  // Um lançamento que você já classificou não deve continuar pedindo atenção,
  // mesmo que a marca de "pode ser transferência" tenha ficado do jeito antigo.
  if (filtro === 'transferencia') {
    return doMes.filter((l) => l.possivel_transferencia && !l.transfer_id && !l.travado);
  }
  return doMes;
}

function desenhar(raiz, ir) {
  const itens = listar().sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const doMes = estado.lancamentos.filter((l) => l.competencia === estado.competencia);
  const contagem = {
    pendentes: doMes.filter(pendente).length,
    'sem-categoria': doMes.filter((l) => !l.categoria).length,
    palpite: doMes.filter((l) => l.categoria && l.confianca === 'baixa' && !l.travado).length,
    transferencia: doMes.filter((l) => l.possivel_transferencia && !l.transfer_id && !l.travado).length,
    todos: doMes.length,
  };

  raiz.innerHTML = `
  <div class="pilha">
    ${contagem.pendentes === 0 ? bloco('ok',
      `<strong>Tudo classificado em ${esc(labelCompetencia(estado.competencia))}.</strong>
       O resultado do painel já está confiável para este mês.`,
      '<a class="btn btn-pequeno" href="#/painel">Ver painel</a>') : bloco('info',
      `Classifique uma vez e marque <em>“vale para todas as parecidas”</em>: a próxima importação
       já vem pronta. É assim que os meses seguintes deixam de dar trabalho.`)}

    <div class="cartao">
      <div class="cartao-cabeca" style="padding-bottom:0;border-bottom:none">
        <div class="abas" style="flex:1">
          ${[['pendentes', 'Precisam de você'], ['sem-categoria', 'Sem categoria'],
             ['palpite', 'Classificados por palpite'], ['transferencia', 'Possível transferência'],
             ['todos', 'Todos do mês']].map(([k, r]) =>
            `<button class="aba" data-filtro="${k}" aria-selected="${filtro === k}">
              ${r}${contagem[k] ? ` <span class="mudo">(${contagem[k]})</span>` : ''}</button>`).join('')}
        </div>
      </div>
      <div class="cartao-corpo cartao-corpo-liso">
        ${itens.length ? tabela(itens) : vazio('Nada aqui', 'Nenhum lançamento neste filtro para o mês selecionado.')}
      </div>
    </div>
    ${itens.length ? barraSelecao() : ''}
  </div>`;

  liga(raiz, 'click', '[data-filtro]', (e, alvo) => {
    filtro = alvo.dataset.filtro; selecionados = new Set(); desenhar(raiz, ir);
  });
  liga(raiz, 'change', '[data-sel]', (e, alvo) => {
    const id = alvo.dataset.sel;
    alvo.checked ? selecionados.add(id) : selecionados.delete(id);
    alvo.closest('tr').classList.toggle('selecionada', alvo.checked);
    atualizarBarra(raiz);
  });
  liga(raiz, 'change', '#sel-todos', (e, alvo) => {
    selecionados = new Set(alvo.checked ? itens.map((i) => i.id) : []);
    raiz.querySelectorAll('[data-sel]').forEach((c) => {
      c.checked = alvo.checked; c.closest('tr').classList.toggle('selecionada', alvo.checked);
    });
    atualizarBarra(raiz);
  });
  liga(raiz, 'change', '[data-cat]', async (e, alvo) => {
    const l = estado.lancamentos.find((x) => x.id === alvo.dataset.cat);
    // Categoria de holding: já aproveita para perguntar de quem é o dinheiro.
    const destino = ehHolding(alvo.value) ? await escolherDestino([l]) : '';
    if (destino === null) { desenhar(raiz, ir); return; }
    await aplicarCategoria([l], alvo.value, { travado: 1, destino_holding: destino });
    desenhar(raiz, ir);
  });
  liga(raiz, 'click', '[data-regra]', (e, alvo) => {
    const l = estado.lancamentos.find((x) => x.id === alvo.dataset.regra);
    criarRegra(l, () => desenhar(raiz, ir));
  });
  liga(raiz, 'click', '[data-certo]', async (e, alvo) => {
    // Um clique para confirmar o palpite do painel — é o caminho mais curto
    // para esvaziar a caixa de revisão sem precisar reescolher a categoria.
    const l = estado.lancamentos.find((x) => x.id === alvo.dataset.certo);
    if (!l) return;
    if (ehHolding(l.categoria) && !l.destino_holding) {
      const destino = await escolherDestino([l]);
      if (destino === null) return;
      await aplicarCategoria([l], l.categoria, { travado: 1, destino_holding: destino });
    } else {
      await aplicarCategoria([l], l.categoria, { travado: 1 });
    }
    avisar(`Confirmado: ${nomeCategoria(l.categoria)}.`, 1800);
    desenhar(raiz, ir);
  });
  liga(raiz, 'click', '[data-desmembrar]', (e, alvo) => {
    const l = estado.lancamentos.find((x) => x.id === alvo.dataset.desmembrar);
    desmembrar(l, () => desenhar(raiz, ir));
  });
  liga(raiz, 'click', '[data-detalhe]', (e, alvo) => {
    const l = estado.lancamentos.find((x) => x.id === alvo.dataset.detalhe);
    verDetalhe(l);
  });
  liga(raiz, 'click', '[data-lote]', async (e, alvo) => acaoLote(alvo.dataset.lote, raiz, ir));
}

function tabela(itens) {
  return `
  <div class="tabela-rolagem">
    <table class="tabela">
      <thead><tr>
        <th style="width:34px"><input type="checkbox" id="sel-todos" aria-label="Selecionar todos"></th>
        <th>Data</th><th>Lançamento</th><th>Conta</th><th class="num">Valor</th>
        <th style="width:40px"></th><th style="min-width:190px">Categoria</th><th></th>
      </tr></thead>
      <tbody>
      ${itens.map((l) => `
        <tr data-id="${l.id}">
          <td><input type="checkbox" data-sel="${l.id}" aria-label="Selecionar lançamento"></td>
          <td class="mini nowrap">${brDate(l.data)}</td>
          <td>
            <div class="mini forte">${esc(l.contraparte || l.descricao || '—')}</div>
            <div class="mini mudo">${esc(l.contraparte ? l.descricao : (l.detalhe || l.documento || ''))}
              ${l.possivel_transferencia && !l.transfer_id && !l.travado
                ? '<span class="selo selo-alerta" style="margin-left:4px">pode ser transferência</span>' : ''}
              ${l.enriquecido ? '<span class="selo selo-pos" style="margin-left:4px">identificado</span>' : ''}
              ${l.venda_numero ? `<span class="selo selo-acento" style="margin-left:4px"
                title="Ligado ao pedido de venda${l.venda_cliente ? ` de ${esc(l.venda_cliente)}` : ''}">pedido ${esc(l.venda_numero)}</span>` : ''}
              ${l.titulo_fornecedor ? `<span class="selo selo-acento" style="margin-left:4px"
                title="Ligado ao ${l.titulo_tipo === 'nota' ? 'lançamento da nota de entrada' : 'título de contas a pagar'} do Bling">${l.titulo_tipo === 'nota' ? 'nota' : 'título'}</span>` : ''}
            </div>
          </td>
          <td class="mini secundario">${esc(nomeConta(l.conta_id))}</td>
          <td class="num forte ${l.valor >= 0 ? 'pos' : 'neg'}">${brl(l.valor)}</td>
          <td>${l.categoria ? `<button class="btn btn-sutil btn-pequeno botao-ok" data-certo="${l.id}"
            title="Está certo: confirmar ${esc(nomeCategoria(l.categoria))}">${icone('ok', 16)}</button>` : ''}</td>
          <td>
            <select data-cat="${l.id}">${selectCategorias(categorias(), l.categoria || '', { vazioTexto: '— escolher —' })}</select>
            ${l.regra_aplicada ? `<div class="mini mudo" style="margin-top:2px">por: ${esc(l.regra_aplicada)}</div>` : ''}
          </td>
          <td class="nowrap">
            <button class="btn btn-sutil btn-pequeno" data-regra="${l.id}" title="Criar regra para lançamentos parecidos">${icone('raio', 14)}</button>
            <button class="btn btn-sutil btn-pequeno" data-desmembrar="${l.id}" title="Dividir este valor em partes (parte da empresa, parte da holding)">${icone('mais', 14)}</button>
            <button class="btn btn-sutil btn-pequeno" data-detalhe="${l.id}" title="Ver detalhes">${icone('info', 14)}</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function barraSelecao() {
  return `
  <div class="barra-acao" id="barra-sel" hidden>
    <span class="forte mini" id="conta-sel">0 selecionados</span>
    <span class="mini" id="soma-sel"></span>
    <span class="espaco"></span>
    <select id="cat-lote" style="width:auto;min-width:200px">${selectCategorias(categorias(), '', { vazioTexto: 'Aplicar categoria…' })}</select>
    <button class="btn" data-lote="categoria">Aplicar</button>
    <button class="btn" data-lote="certo" title="Confirmar a categoria que o painel já sugeriu">${icone('ok', 14)} Está certo</button>
    <button class="btn" data-lote="holding" title="Marcar como gasto/aporte dos sócios">${icone('holding', 14)} Holding</button>
    <button class="btn" data-lote="transferencia"
      title="Para o MESMO dinheiro que aparece duas vezes: saiu de uma conta sua e entrou em outra. Selecione as duas pontas — elas deixam de contar como receita e despesa.">Parear transferência</button>
    <button class="btn btn-perigo" data-lote="excluir">${icone('lixo', 14)} Excluir</button>
  </div>`;
}

function atualizarBarra(raiz) {
  const barra = raiz.querySelector('#barra-sel');
  if (!barra) return;
  barra.hidden = selecionados.size === 0;
  raiz.querySelector('#conta-sel').textContent =
    `${selecionados.size} selecionado${selecionados.size === 1 ? '' : 's'}`;
  raiz.querySelector('#soma-sel').innerHTML = resumoSelecionados(selecionados);
}

// ------------------------------------------------------------------ ações ---

async function aplicarCategoria(lancamentos, categoria, extra = {}) {
  const alterados = lancamentos.filter(Boolean).map((l) => ({
    ...l,
    categoria: categoria || null,
    confianca: categoria ? 'alta' : null,
    conciliado: categoria ? 1 : 0,
    regra_aplicada: categoria ? 'definido por você' : null,
    ...extra,
  }));
  await salvar('lancamentos', alterados);
}

async function acaoLote(acao, raiz, ir) {
  const itens = [...selecionados].map((id) => estado.lancamentos.find((l) => l.id === id)).filter(Boolean);
  if (!itens.length) return;

  if (acao === 'categoria') {
    const cat = raiz.querySelector('#cat-lote').value;
    if (!cat) return avisar('Escolha uma categoria primeiro.');
    await aplicarCategoria(itens, cat, { travado: 1 });
    avisar(`${itens.length} lançamento(s) classificados.`);
  }

  if (acao === 'certo') {
    const comPalpite = itens.filter((l) => l.categoria);
    if (!comPalpite.length) return avisar('Nenhum dos selecionados tem categoria sugerida.');
    await salvar('lancamentos', comPalpite.map((l) => ({
      ...l, confianca: 'alta', conciliado: 1, travado: 1,
      regra_aplicada: l.regra_aplicada ? `${l.regra_aplicada} (confirmado)` : 'confirmado por você',
    })));
    avisar(`${comPalpite.length} confirmado(s).`);
  }

  if (acao === 'holding') {
    const destino = await escolherDestino(itens);
    if (destino === null) return;
    const alterados = itens.map((l) => ({
      ...l,
      categoria: l.valor < 0 ? 'hold_saida' : 'hold_entrada',
      destino_holding: destino,
      confianca: 'alta', conciliado: 1, travado: 1, regra_aplicada: 'marcado como holding',
    }));
    await salvar('lancamentos', alterados);
    avisar(`${itens.length} lançamento(s) na conta da holding${destino ? ` — ${destino}` : ''}.`);
  }

  if (acao === 'transferencia') {
    const saida = itens.find((l) => l.valor < 0);
    const entrada = itens.find((l) => l.valor > 0);
    const parValido = itens.length === 2 && saida && entrada && saida.conta_id !== entrada.conta_id;

    if (parValido) {
      await parearTransferencia(saida, entrada);
    } else {
      await aplicarCategoria(itens, 'trf_interna', { travado: 1 });
      avisar(`${itens.length} marcados como transferência.`, 4000);
    }
  }

  if (acao === 'excluir') {
    const ok = await modal({
      titulo: 'Excluir lançamentos',
      corpo: `<p>Excluir ${itens.length} lançamento(s)? Eles somem do resultado e dos saldos.</p>
        <p class="mini mudo">Se vieram de um arquivo, reimportar o arquivo traz de volta.</p>`,
      confirmar: 'Excluir', perigo: true,
    });
    if (!ok) return;
    await remover('lancamentos', itens.map((l) => l.id));
    avisar(`${itens.length} excluído(s).`);
  }

  selecionados = new Set();
  desenhar(raiz, ir);
}

/**
 * Pareia manualmente uma saída de uma conta com a entrada em outra.
 *
 * Quando chega menos do que saiu, a diferença ficou pelo caminho — é a taxa
 * que o gateway cobra pelo saque. Nesse caso a saída é dividida em duas: o
 * valor que de fato chegou (a transferência, que se anula) e a taxa, que vira
 * despesa. Sem essa divisão a diferença apareceria como "não explicado" na
 * ponte entre lucro e caixa.
 */
async function parearTransferencia(saida, entrada) {
  // Armadilha: se a conta de origem é de passagem (gateway/marketplace), a
  // venda só é contada quando o dinheiro chega no banco. Parear as duas pontas
  // transformaria essa entrada em transferência e zeraria o faturamento.
  if (!reconheceReceita(saida.conta_id) && reconheceReceita(entrada.conta_id)) {
    const so = await modal({
      titulo: 'Não precisa parear',
      corpo: `<p>“${esc(nomeConta(saida.conta_id))}” é conta de passagem: a venda só é contada
          quando o dinheiro chega em ${esc(nomeConta(entrada.conta_id))}.</p>
        <p>Se eu parear os dois lados, essa entrada de ${brl(entrada.valor)} deixa de ser receita
          e o faturamento do mês some.</p>
        <p class="mini secundario">O certo é marcar só a saída do gateway como transferência —
          faço isso agora, se você quiser.</p>`,
      confirmar: 'Marcar só a saída',
    });
    if (!so) return;
    await salvar('lancamentos', [{
      ...saida, categoria: 'trf_interna', confianca: 'alta', conciliado: 1, travado: 1,
      possivel_transferencia: 0, regra_aplicada: 'saída de conta de passagem',
    }]);
    avisar('Saída marcada como transferência. A entrada no banco continua como receita.');
    return;
  }

  const enviado = Math.abs(saida.valor);
  const recebido = entrada.valor;
  const diferenca = round2(enviado - recebido);
  const tid = 'trf_' + uid();

  const comuns = {
    categoria: 'trf_interna', transfer_id: tid,
    confianca: 'alta', conciliado: 1, travado: 1, regra_aplicada: 'pareado por você',
  };

  if (Math.abs(diferenca) < 0.01) {
    await salvar('lancamentos', [{ ...saida, ...comuns }, { ...entrada, ...comuns }]);
    avisar('Transferência pareada — não conta como receita nem despesa.');
    return;
  }

  if (diferenca < 0) {
    // Chegou mais do que saiu: não é taxa. Pareia e avisa, para ele conferir.
    await salvar('lancamentos', [{ ...saida, ...comuns }, { ...entrada, ...comuns }]);
    avisar(`Pareado, mas entrou ${brl(-diferenca)} a mais do que saiu — vale conferir.`, 6000);
    return;
  }

  const confirma = await modal({
    titulo: 'Chegou menos do que saiu',
    corpo: `
      <p>Saiu <strong>${brl(enviado)}</strong> de ${esc(nomeConta(saida.conta_id))} e entrou
      <strong>${brl(recebido)}</strong> em ${esc(nomeConta(entrada.conta_id))}.</p>
      <p>A diferença de <strong>${brl(diferenca)}</strong> (${(diferenca / enviado * 100).toFixed(2)}%)
      pode ser lançada como taxa do gateway. A transferência passa a ser de ${brl(recebido)},
      que se anula entre as duas contas, e a taxa entra como despesa.</p>
      <label class="campo" style="margin-top:12px"><span class="campo-rotulo">Lançar a diferença como</span>
        <select id="p-cat">${selectCategorias(categorias(), 'des_taxas_gateway', { vazioTexto: 'Não lançar — só parear' })}</select></label>`,
    confirmar: 'Parear e lançar a taxa',
    // A escolha precisa ser lida enquanto o diálogo ainda está na tela.
    aoConfirmar: (m) => ({ categoria: m.querySelector('#p-cat').value }),
  });
  if (!confirma) return;

  const categoriaTaxa = confirma.categoria;

  const registros = [
    // A saída passa a valer o que realmente chegou do outro lado.
    { ...saida, ...comuns, valor: -recebido, tipo: 'D' },
    { ...entrada, ...comuns },
  ];
  if (categoriaTaxa) {
    registros.push({
      id: uid(),
      conta_id: saida.conta_id,
      data: saida.data,
      competencia: saida.competencia,
      descricao: 'Taxa sobre transferência para conta bancária',
      contraparte: saida.contraparte || nomeConta(saida.conta_id),
      valor: -diferenca,
      tipo: 'D',
      categoria: categoriaTaxa,
      confianca: 'alta',
      conciliado: 1,
      travado: 1,
      origem: 'manual',
      regra_aplicada: 'diferença do pareamento',
      transfer_id: tid,
      dedupe: 'taxa:' + tid,
    });
  }
  await salvar('lancamentos', registros);
  avisar(`Pareado. ${brl(diferenca)} lançados como taxa.`);
}

// ------------------------------------------------------------------ regra ---

function criarRegra(l, aoTerminar) {
  const doc = docContraparte(l);
  const valor = Math.abs(l.valor);
  const dia = Number(String(l.data || '').slice(8, 10));
  const trecho = (l.descricao || '').slice(0, 40);

  // Cada forma de reconhecer vira uma regra diferente. As três primeiras são
  // por texto; as de valor servem para o que repete igual todo mês (aluguel,
  // parcela, mensalidade) e não tem um texto que o identifique.
  const formas = [
    l.contraparte && { id: 'contraparte', rotulo: `Contraparte: ${l.contraparte}`,
      regra: { padrao: normalize(l.contraparte) } },
    doc && { id: 'doc', rotulo: `CNPJ/CPF ${formatarDoc(doc)} — todos deste mesmo pagador`,
      regra: { padrao: doc } },
    trecho && { id: 'descricao', rotulo: `Descrição: ${trecho}`,
      regra: { padrao: normalize(trecho) } },
    { id: 'valor', rotulo: `Valor exato: ${brl(valor)}`, regra: { valor } },
    { id: 'valor_dia', rotulo: `Valor ${brl(valor)} no dia ${dia} de cada mês`,
      regra: { valor, dia_mes: dia } },
    trecho && { id: 'valor_descricao', rotulo: `Valor ${brl(valor)} + descrição “${trecho}”`,
      regra: { valor, padrao: normalize(trecho) } },
  ].filter(Boolean);

  const padraoInicial = formas.find((f) => f.id === 'doc') || formas[0];

  modal({
    titulo: 'Vale para todas as parecidas',
    corpo: `
      <p class="mini secundario">Escolha o que identifica este tipo de lançamento. Toda vez que
      aparecer algo assim, a categoria será aplicada sozinha — inclusive nas próximas importações.</p>
      <label class="campo"><span class="campo-rotulo">Reconhecer por</span>
        <select id="r-padrao">
          ${formas.map((f) => `<option value="${esc(f.id)}"${f === padraoInicial ? ' selected' : ''}>${esc(f.rotulo)}</option>`).join('')}
          <option value="__custom">Outro texto…</option>
        </select></label>
      <label class="campo" id="cx-custom" hidden><span class="campo-rotulo">Texto a procurar</span>
        <input id="r-custom" placeholder="ex.: CELESC"></label>
      <p class="mini mudo" id="r-explica"></p>
      <label class="campo"><span class="campo-rotulo">Categoria</span>
        <select id="r-cat">${selectCategorias(categorias(), l.categoria || '', { vazioTexto: '— escolher —' })}</select></label>
      <label class="campo"><span class="campo-rotulo">Aplicar a</span>
        <select id="r-sinal">
          <option value="">entradas e saídas</option>
          <option value="D"${l.valor < 0 ? ' selected' : ''}>somente saídas</option>
          <option value="C"${l.valor >= 0 ? ' selected' : ''}>somente entradas</option>
        </select></label>
      <label class="check"><input type="checkbox" id="r-retro" checked>
        <span>Aplicar também aos lançamentos já importados que combinam</span></label>`,
    confirmar: 'Criar regra',
    aoAbrir: (m) => {
      const sel = m.querySelector('#r-padrao');
      const explicar = () => {
        m.querySelector('#cx-custom').hidden = sel.value !== '__custom';
        const forma = formas.find((f) => f.id === sel.value);
        const quantos = forma
          ? estado.lancamentos.filter((x) => regraCombina(
              { ...forma.regra, sinal: m.querySelector('#r-sinal').value || null }, x)).length
          : 0;
        m.querySelector('#r-explica').textContent = forma
          ? `${quantos} lançamento(s) já importados combinam com isso.` : '';
      };
      sel.onchange = explicar;
      m.querySelector('#r-sinal').onchange = explicar;
      explicar();
    },
    aoConfirmar: async (m) => {
      const escolha = m.querySelector('#r-padrao').value;
      const forma = formas.find((f) => f.id === escolha);
      const base = forma ? { ...forma.regra } : { padrao: m.querySelector('#r-custom').value.trim() };
      const categoria = m.querySelector('#r-cat').value;
      if (!base.padrao && base.valor == null) { avisar('Informe o texto a procurar.'); return false; }
      if (!categoria) { avisar('Escolha a categoria.'); return false; }

      const regra = {
        id: uid(), categoria,
        padrao: base.padrao || '',
        valor: base.valor ?? null,
        dia_mes: base.dia_mes ?? null,
        sinal: m.querySelector('#r-sinal').value || null,
        prioridade: 200, criada_em: new Date().toISOString(),
      };
      await salvar('regras', [regra]);

      let n = 1;
      await aplicarCategoria([l], categoria, { travado: 1 });

      if (m.querySelector('#r-retro').checked) {
        const combinam = estado.lancamentos.filter((x) =>
          x.id !== l.id && !x.travado && !x.transfer_id && regraCombina(regra, x));
        if (combinam.length) {
          await salvar('lancamentos', combinam.map((x) => ({
            ...x, categoria, confianca: 'alta', conciliado: 1, regra_aplicada: rotuloRegra(regra),
          })));
          n += combinam.length;
        }
      }
      avisar(`Regra criada — ${n} lançamento(s) classificados.`);
      return true;
    },
  }).then((r) => { if (r) aoTerminar(); });
}

function verDetalhe(l) {
  const cat = CATEGORIA_POR_ID[l.categoria] || estado.categorias.find((c) => c.id === l.categoria);
  const campos = [
    ['Data', brDate(l.data)],
    ['Conta', nomeConta(l.conta_id)],
    ['Valor', brl(l.valor)],
    ['Descrição', l.descricao],
    ['Contraparte', l.contraparte],
    ['CNPJ/CPF', docContraparte(l) ? formatarDoc(docContraparte(l)) : ''],
    ['Documento', l.documento],
    ['Detalhe', l.detalhe],
    ['Categoria', cat ? `${cat.nome} (${cat.grupo})` : 'sem categoria'],
    ['Classificado por', l.regra_aplicada],
    ['Origem do dado', l.origem],
    ['Arquivo', l.arquivo],
    ['Identificador do banco', l.ref],
    ['Pedido de venda', l.venda_numero ? `${l.venda_numero}${l.venda_canal ? ` (${l.venda_canal})` : ''}` : ''],
    ['Título / fornecedor', l.titulo_fornecedor],
    ['Cliente do pedido', l.venda_cliente],
    ['Destino na holding', l.destino_holding],
    ['Desmembrado', l.desmembramento ? `parte ${l.parte} de ${l.partes}` : ''],
    ['Transferência pareada', l.transfer_id ? 'sim' : ''],
  ].filter(([, v]) => v);

  modal({
    titulo: 'Detalhes do lançamento',
    confirmar: '', cancelar: 'Fechar',
    corpo: `<table class="tabela tabela-compacta">
      ${campos.map(([k, v]) => `<tr><td class="mini mudo nowrap">${esc(k)}</td><td class="mini">${esc(String(v))}</td></tr>`).join('')}
    </table>`,
  });
}

/**
 * Pergunta de quem é o dinheiro da holding. Devolve o nome escolhido,
 * '' quando ele preferir não informar, ou null se desistiu.
 */
async function escolherDestino(itens) {
  const destinos = destinosHolding();
  const total = round2(itens.reduce((a, l) => a + l.valor, 0));
  const r = await modal({
    titulo: 'Conta da holding',
    confirmar: 'Marcar como holding',
    corpo: `
      <p class="mini secundario">${itens.length} lançamento(s), ${brl(total)} no total.
        Saem do resultado da Móvel5 e entram na conta corrente com os sócios.</p>
      <label class="campo"><span class="campo-rotulo">De quem é esse dinheiro?</span>
        <select id="h-destino">
          <option value="">— não informar agora —</option>
          ${destinos.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
        </select>
        <span class="campo-dica">Serve para você ver depois para onde foi e lançar no financeiro
          de cada lugar. A lista é editável em Ajustes › Categorias.</span></label>`,
    aoConfirmar: (m) => ({ destino: m.querySelector('#h-destino').value }),
  });
  return r ? r.destino : null;
}
