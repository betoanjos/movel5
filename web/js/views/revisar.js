// Caixa de revisão: só o que precisa de decisão humana.
// A ideia é resolver um punhado de linhas hoje e nunca mais ver as parecidas —
// cada escolha vira regra e vale para todas as importações seguintes.
import { estado, salvar, categorias, nomeCategoria, nomeConta, remover } from '../store.js';
import { recategorizar, docContraparte, textoRegra } from '../engine/motor.js';
import { CATEGORIA_POR_ID } from '../engine/seed.js';
import { brl, brDate, esc, uid, normalize, labelCompetencia } from '../lib/util.js';
import { icone, bloco, avisar, vazio, liga, modal, selectCategorias } from '../lib/ui.js';

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
  if (filtro === 'transferencia') return doMes.filter((l) => l.possivel_transferencia && !l.transfer_id);
  return doMes;
}

function desenhar(raiz, ir) {
  const itens = listar().sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const doMes = estado.lancamentos.filter((l) => l.competencia === estado.competencia);
  const contagem = {
    pendentes: doMes.filter(pendente).length,
    'sem-categoria': doMes.filter((l) => !l.categoria).length,
    palpite: doMes.filter((l) => l.categoria && l.confianca === 'baixa' && !l.travado).length,
    transferencia: doMes.filter((l) => l.possivel_transferencia && !l.transfer_id).length,
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
    await aplicarCategoria([l], alvo.value, { travado: 1 });
    desenhar(raiz, ir);
  });
  liga(raiz, 'click', '[data-regra]', (e, alvo) => {
    const l = estado.lancamentos.find((x) => x.id === alvo.dataset.regra);
    criarRegra(l, () => desenhar(raiz, ir));
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
        <th style="min-width:190px">Categoria</th><th></th>
      </tr></thead>
      <tbody>
      ${itens.map((l) => `
        <tr data-id="${l.id}">
          <td><input type="checkbox" data-sel="${l.id}" aria-label="Selecionar lançamento"></td>
          <td class="mini nowrap">${brDate(l.data)}</td>
          <td>
            <div class="mini forte">${esc(l.contraparte || l.descricao || '—')}</div>
            <div class="mini mudo">${esc(l.contraparte ? l.descricao : (l.detalhe || l.documento || ''))}
              ${l.possivel_transferencia && !l.transfer_id
                ? '<span class="selo selo-alerta" style="margin-left:4px">pode ser transferência</span>' : ''}
              ${l.enriquecido ? '<span class="selo selo-pos" style="margin-left:4px">identificado</span>' : ''}
            </div>
          </td>
          <td class="mini secundario">${esc(nomeConta(l.conta_id))}</td>
          <td class="num forte ${l.valor >= 0 ? 'pos' : 'neg'}">${brl(l.valor)}</td>
          <td>
            <select data-cat="${l.id}">${selectCategorias(categorias(), l.categoria || '', { vazioTexto: '— escolher —' })}</select>
            ${l.regra_aplicada ? `<div class="mini mudo" style="margin-top:2px">por: ${esc(l.regra_aplicada)}</div>` : ''}
          </td>
          <td class="nowrap">
            <button class="btn btn-sutil btn-pequeno" data-regra="${l.id}" title="Criar regra para lançamentos parecidos">${icone('raio', 14)}</button>
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
    <span class="espaco"></span>
    <select id="cat-lote" style="width:auto;min-width:200px">${selectCategorias(categorias(), '', { vazioTexto: 'Aplicar categoria…' })}</select>
    <button class="btn" data-lote="categoria">Aplicar</button>
    <button class="btn" data-lote="holding" title="Marcar como gasto/aporte dos sócios">${icone('holding', 14)} Holding</button>
    <button class="btn" data-lote="transferencia" title="Marcar como transferência entre contas próprias">Transferência</button>
    <button class="btn btn-perigo" data-lote="excluir">${icone('lixo', 14)} Excluir</button>
  </div>`;
}

function atualizarBarra(raiz) {
  const barra = raiz.querySelector('#barra-sel');
  if (!barra) return;
  barra.hidden = selecionados.size === 0;
  raiz.querySelector('#conta-sel').textContent =
    `${selecionados.size} selecionado${selecionados.size === 1 ? '' : 's'}`;
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

  if (acao === 'holding') {
    const alterados = itens.map((l) => ({
      ...l,
      categoria: l.valor < 0 ? 'hold_saida' : 'hold_entrada',
      confianca: 'alta', conciliado: 1, travado: 1, regra_aplicada: 'marcado como holding',
    }));
    await salvar('lancamentos', alterados);
    avisar(`${itens.length} lançamento(s) na conta da holding.`);
  }

  if (acao === 'transferencia') {
    if (itens.length === 2 && Math.abs(itens[0].valor + itens[1].valor) < 0.02
        && itens[0].conta_id !== itens[1].conta_id) {
      const tid = 'trf_' + uid();
      await salvar('lancamentos', itens.map((l) => ({
        ...l, categoria: 'trf_interna', transfer_id: tid,
        confianca: 'alta', conciliado: 1, travado: 1, regra_aplicada: 'pareado por você',
      })));
      avisar('Transferência pareada — não conta como receita nem despesa.');
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

// ------------------------------------------------------------------ regra ---

function criarRegra(l, aoTerminar) {
  const doc = docContraparte(l);
  const sugestoes = [
    l.contraparte && { valor: normalize(l.contraparte), rotulo: `Contraparte: ${l.contraparte}` },
    doc && { valor: doc, rotulo: `CNPJ/CPF ${formatarDoc(doc)} — pega todos deste mesmo pagador` },
    l.descricao && { valor: normalize(l.descricao).slice(0, 40), rotulo: `Descrição: ${l.descricao.slice(0, 40)}` },
  ].filter(Boolean);

  modal({
    titulo: 'Vale para todas as parecidas',
    corpo: `
      <p class="mini secundario">Escolha o que identifica este tipo de lançamento. Toda vez que
      aparecer algo com esse texto, a categoria será aplicada sozinha — inclusive nas próximas importações.</p>
      <label class="campo"><span class="campo-rotulo">Reconhecer por</span>
        <select id="r-padrao">
          ${sugestoes.map((s, i) => `<option value="${esc(s.valor)}"${i === 1 || sugestoes.length === 1 ? ' selected' : ''}>${esc(s.rotulo)}</option>`).join('')}
          <option value="__custom">Outro texto…</option>
        </select></label>
      <label class="campo" id="cx-custom" hidden><span class="campo-rotulo">Texto a procurar</span>
        <input id="r-custom" placeholder="ex.: CELESC"></label>
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
      m.querySelector('#r-padrao').onchange = (e) => {
        m.querySelector('#cx-custom').hidden = e.target.value !== '__custom';
      };
    },
    aoConfirmar: async (m) => {
      let padrao = m.querySelector('#r-padrao').value;
      if (padrao === '__custom') padrao = m.querySelector('#r-custom').value.trim();
      const categoria = m.querySelector('#r-cat').value;
      if (!padrao) { avisar('Informe o texto a procurar.'); return false; }
      if (!categoria) { avisar('Escolha a categoria.'); return false; }

      const regra = {
        id: uid(), padrao, categoria,
        sinal: m.querySelector('#r-sinal').value || null,
        prioridade: 200, criada_em: new Date().toISOString(),
      };
      await salvar('regras', [regra]);

      let n = 1;
      await aplicarCategoria([l], categoria, { travado: 1 });

      if (m.querySelector('#r-retro').checked) {
        const alvo = normalize(padrao);
        const combinam = estado.lancamentos.filter((x) =>
          x.id !== l.id && !x.travado && !x.transfer_id &&
          (!regra.sinal || (regra.sinal === 'D' ? x.valor < 0 : x.valor >= 0)) &&
          textoRegra(x).includes(alvo));
        if (combinam.length) {
          await salvar('lancamentos', combinam.map((x) => ({
            ...x, categoria, confianca: 'alta', conciliado: 1, regra_aplicada: padrao,
          })));
          n += combinam.length;
        }
      }
      avisar(`Regra criada — ${n} lançamento(s) classificados.`);
      return true;
    },
  }).then((r) => { if (r) aoTerminar(); });
}

const formatarDoc = (d) => d.length === 14
  ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  : d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

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
