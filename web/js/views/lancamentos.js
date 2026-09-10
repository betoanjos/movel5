// Lançamentos: a lista completa, com busca, filtros, edição e inclusão manual.
// É aqui que ele acerta o passado — lança à mão o que não veio de arquivo.
import { estado, salvar, remover, categorias, nomeCategoria, nomeConta, contaPorId } from '../store.js';
import { brl, brDate, esc, uid, normalize, competenciaOf, sum, download, labelCompetencia } from '../lib/util.js';
import { icone, bloco, avisar, vazio, liga, modal, selectCategorias } from '../lib/ui.js';

let busca = '';
let fConta = '';
let fCategoria = '';
let fTipo = '';
let todosOsMeses = false;
let ordem = { campo: 'data', desc: true };
let selecionados = new Set();

export function telaLancamentos(raiz, ctx) {
  selecionados = new Set();
  desenhar(raiz, ctx);
}

function filtrados() {
  const alvo = normalize(busca);
  return estado.lancamentos.filter((l) => {
    if (!todosOsMeses && l.competencia !== estado.competencia) return false;
    if (fConta && l.conta_id !== fConta) return false;
    if (fCategoria && (l.categoria || '') !== fCategoria) return false;
    if (fTipo === 'C' && l.valor < 0) return false;
    if (fTipo === 'D' && l.valor >= 0) return false;
    if (alvo && !normalize([l.descricao, l.contraparte, l.documento, l.detalhe].join(' ')).includes(alvo)) return false;
    return true;
  }).sort((a, b) => {
    const s = ordem.desc ? -1 : 1;
    if (ordem.campo === 'valor') return (a.valor - b.valor) * s;
    if (ordem.campo === 'descricao') return String(a.contraparte || a.descricao).localeCompare(String(b.contraparte || b.descricao)) * s;
    return (a.data < b.data ? -1 : a.data > b.data ? 1 : 0) * s;
  });
}

function desenhar(raiz, ctx) {
  const itens = filtrados();
  const entradas = sum(itens.filter((l) => l.valor > 0), (l) => l.valor);
  const saidas = sum(itens.filter((l) => l.valor < 0), (l) => l.valor);

  raiz.innerHTML = `
  <div class="pilha">
    <div class="cartao">
      <div class="cartao-cabeca">
        <div class="linha-flex" style="flex:1;gap:8px">
          <label style="position:relative;flex:1;min-width:180px;max-width:320px">
            <input type="search" id="f-busca" placeholder="Buscar por nome, descrição, CNPJ…"
              value="${esc(busca)}" style="padding-left:32px">
            <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--ink-3)">${icone('busca', 16)}</span>
          </label>
          <select id="f-conta" style="width:auto"><option value="">Todas as contas</option>
            ${estado.contas.map((c) => `<option value="${c.id}"${fConta === c.id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
          <select id="f-categoria" style="width:auto;max-width:200px">
            <option value="">Todas as categorias</option>
            ${selectCategorias(categorias(), fCategoria, { vazioTexto: 'Sem categoria' })}</select>
          <select id="f-tipo" style="width:auto"><option value="">Entradas e saídas</option>
            <option value="C"${fTipo === 'C' ? ' selected' : ''}>Só entradas</option>
            <option value="D"${fTipo === 'D' ? ' selected' : ''}>Só saídas</option></select>
          <label class="check mini"><input type="checkbox" id="f-todos" ${todosOsMeses ? 'checked' : ''}>
            <span>Todos os meses</span></label>
        </div>
        <button class="btn" id="btn-exportar">${icone('baixar', 15)} CSV</button>
        <button class="btn btn-principal" id="btn-novo">${icone('mais', 15)} Novo lançamento</button>
      </div>
      <div class="cartao-corpo cartao-corpo-liso">
        ${itens.length ? tabela(itens) : vazio(
          'Nenhum lançamento com esses filtros',
          todosOsMeses ? 'Ajuste a busca ou inclua um lançamento manual.'
            : `Nada em ${esc(labelCompetencia(estado.competencia))} com esses filtros.`)}
      </div>
      ${itens.length ? `<div class="cartao-cabeca" style="border-bottom:none;border-top:1px solid var(--linha)">
        <span class="mini secundario">${itens.length} lançamento(s)</span>
        <span class="espaco"></span>
        <span class="mini">Entradas <strong class="num pos">${brl(entradas)}</strong></span>
        <span class="mini">Saídas <strong class="num neg">${brl(saidas)}</strong></span>
        <span class="mini">Saldo <strong class="num ${entradas + saidas >= 0 ? 'pos' : 'neg'}">${brl(entradas + saidas)}</strong></span>
      </div>` : ''}
    </div>
    ${itens.length ? `<div class="barra-acao" id="barra-sel" hidden>
      <span class="forte mini" id="conta-sel">0 selecionados</span>
      <span class="espaco"></span>
      <select id="cat-lote" style="width:auto;min-width:200px">${selectCategorias(categorias(), '', { vazioTexto: 'Aplicar categoria…' })}</select>
      <button class="btn" data-lote="categoria">Aplicar</button>
      <button class="btn btn-perigo" data-lote="excluir">${icone('lixo', 14)} Excluir</button>
    </div>` : ''}
  </div>`;

  const re = () => desenhar(raiz, ctx);
  let debounce;
  raiz.querySelector('#f-busca').oninput = (e) => {
    busca = e.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => { const p = e.target.selectionStart; re();
      const n = raiz.querySelector('#f-busca'); n.focus(); n.setSelectionRange(p, p); }, 260);
  };
  raiz.querySelector('#f-conta').onchange = (e) => { fConta = e.target.value; re(); };
  raiz.querySelector('#f-categoria').onchange = (e) => { fCategoria = e.target.value; re(); };
  raiz.querySelector('#f-tipo').onchange = (e) => { fTipo = e.target.value; re(); };
  raiz.querySelector('#f-todos').onchange = (e) => { todosOsMeses = e.target.checked; re(); };
  raiz.querySelector('#btn-novo').onclick = () => editar(null, re);
  raiz.querySelector('#btn-exportar').onclick = () => exportarCSV(itens);

  liga(raiz, 'click', '[data-ordenar]', (e, alvo) => {
    const campo = alvo.dataset.ordenar;
    ordem = { campo, desc: ordem.campo === campo ? !ordem.desc : true };
    re();
  });
  liga(raiz, 'click', '[data-editar]', (e, alvo) => {
    editar(estado.lancamentos.find((l) => l.id === alvo.dataset.editar), re);
  });
  liga(raiz, 'change', '[data-sel]', (e, alvo) => {
    alvo.checked ? selecionados.add(alvo.dataset.sel) : selecionados.delete(alvo.dataset.sel);
    alvo.closest('tr').classList.toggle('selecionada', alvo.checked);
    const barra = raiz.querySelector('#barra-sel');
    barra.hidden = !selecionados.size;
    raiz.querySelector('#conta-sel').textContent = `${selecionados.size} selecionado(s)`;
  });
  liga(raiz, 'click', '[data-lote]', async (e, alvo) => {
    const itensSel = [...selecionados].map((id) => estado.lancamentos.find((l) => l.id === id)).filter(Boolean);
    if (!itensSel.length) return;
    if (alvo.dataset.lote === 'categoria') {
      const cat = raiz.querySelector('#cat-lote').value;
      if (!cat) return avisar('Escolha uma categoria.');
      await salvar('lancamentos', itensSel.map((l) => ({
        ...l, categoria: cat, confianca: 'alta', conciliado: 1, travado: 1, regra_aplicada: 'definido por você',
      })));
      avisar(`${itensSel.length} classificado(s).`);
    } else {
      const ok = await modal({ titulo: 'Excluir lançamentos', perigo: true, confirmar: 'Excluir',
        corpo: `<p>Excluir ${itensSel.length} lançamento(s)?</p>` });
      if (!ok) return;
      await remover('lancamentos', itensSel.map((l) => l.id));
      avisar('Excluídos.');
    }
    selecionados = new Set();
    re();
  });
}

function tabela(itens) {
  const seta = (c) => ordem.campo === c ? (ordem.desc ? ' ↓' : ' ↑') : '';
  return `
  <div class="tabela-rolagem">
    <table class="tabela">
      <thead><tr>
        <th style="width:34px"></th>
        <th><button class="btn btn-sutil btn-pequeno" data-ordenar="data">Data${seta('data')}</button></th>
        <th><button class="btn btn-sutil btn-pequeno" data-ordenar="descricao">Lançamento${seta('descricao')}</button></th>
        <th>Conta</th><th>Categoria</th>
        <th class="num"><button class="btn btn-sutil btn-pequeno" data-ordenar="valor">Valor${seta('valor')}</button></th>
        <th></th>
      </tr></thead>
      <tbody>
      ${itens.slice(0, 600).map((l) => `
        <tr>
          <td><input type="checkbox" data-sel="${l.id}" aria-label="Selecionar"></td>
          <td class="mini nowrap">${brDate(l.data)}</td>
          <td>
            <div class="mini forte">${esc(l.contraparte || l.descricao || '—')}</div>
            <div class="mini mudo">${esc(((l.contraparte ? l.descricao : l.detalhe) || '').slice(0, 60))}
              ${l.origem === 'manual' ? '<span class="selo" style="margin-left:4px">manual</span>' : ''}
              ${l.transfer_id ? '<span class="selo selo-acento" style="margin-left:4px">transferência</span>' : ''}</div>
          </td>
          <td class="mini secundario nowrap">${esc(nomeConta(l.conta_id))}</td>
          <td class="mini">${l.categoria
            ? `<span class="selo">${esc(nomeCategoria(l.categoria))}</span>`
            : '<span class="selo selo-neg">sem categoria</span>'}</td>
          <td class="num forte ${l.valor >= 0 ? 'pos' : 'neg'}">${brl(l.valor)}</td>
          <td><button class="btn btn-sutil btn-pequeno" data-editar="${l.id}" aria-label="Editar">${icone('lapis', 14)}</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${itens.length > 600 ? `<p class="mini mudo centro" style="padding:12px">
      Mostrando os primeiros 600 de ${itens.length}. Use a busca ou os filtros para reduzir a lista.</p>` : ''}
  </div>`;
}

// ------------------------------------------------------------ criar/editar --

function editar(l, aoTerminar) {
  const novo = !l;
  const hoje = new Date().toISOString().slice(0, 10);

  modal({
    titulo: novo ? 'Novo lançamento' : 'Editar lançamento',
    confirmar: 'Salvar',
    corpo: `
      <div class="grade g2" style="gap:12px">
        <label class="campo"><span class="campo-rotulo">Data</span>
          <input type="date" id="e-data" value="${esc(l?.data || hoje)}" required></label>
        <label class="campo"><span class="campo-rotulo">Conta</span>
          <select id="e-conta">${estado.contas.map((c) =>
            `<option value="${c.id}"${l?.conta_id === c.id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      </div>
      <label class="campo"><span class="campo-rotulo">Descrição</span>
        <input id="e-descricao" value="${esc(l?.descricao || '')}" placeholder="ex.: Pagamento de energia" required></label>
      <label class="campo"><span class="campo-rotulo">Quem recebeu / quem pagou</span>
        <input id="e-contraparte" value="${esc(l?.contraparte || '')}" placeholder="ex.: CELESC"></label>
      <div class="grade g2" style="gap:12px">
        <label class="campo"><span class="campo-rotulo">Tipo</span>
          <select id="e-tipo">
            <option value="D"${!l || l.valor < 0 ? ' selected' : ''}>Saída (dinheiro saiu)</option>
            <option value="C"${l && l.valor >= 0 ? ' selected' : ''}>Entrada (dinheiro entrou)</option>
          </select></label>
        <label class="campo"><span class="campo-rotulo">Valor</span>
          <input type="number" step="0.01" min="0" id="e-valor"
            value="${l ? Math.abs(l.valor).toFixed(2) : ''}" placeholder="0,00" required></label>
      </div>
      <label class="campo"><span class="campo-rotulo">Categoria</span>
        <select id="e-categoria">${selectCategorias(categorias(), l?.categoria || '', { vazioTexto: '— escolher —' })}</select></label>
      <label class="campo"><span class="campo-rotulo">Observação</span>
        <textarea id="e-obs" placeholder="Opcional">${esc(l?.obs || '')}</textarea></label>
      ${!novo ? `<button class="btn btn-perigo btn-pequeno" id="e-excluir">${icone('lixo', 14)} Excluir este lançamento</button>` : ''}`,
    aoAbrir: (m) => {
      m.querySelector('#e-excluir')?.addEventListener('click', async () => {
        const ok = await modal({ titulo: 'Excluir lançamento', perigo: true, confirmar: 'Excluir',
          corpo: '<p>Este lançamento sai do resultado e dos saldos. Confirma?</p>' });
        if (!ok) return;
        await remover('lancamentos', l.id);
        m.remove(); avisar('Lançamento excluído.'); aoTerminar();
      });
    },
    aoConfirmar: async (m) => {
      const data = m.querySelector('#e-data').value;
      const bruto = Number(m.querySelector('#e-valor').value);
      const descricao = m.querySelector('#e-descricao').value.trim();
      if (!data || !bruto || !descricao) { avisar('Preencha data, descrição e valor.'); return false; }

      const valor = m.querySelector('#e-tipo').value === 'D' ? -Math.abs(bruto) : Math.abs(bruto);
      const categoria = m.querySelector('#e-categoria').value || null;

      const registro = {
        ...(l || {}),
        id: l?.id || uid(),
        data,
        competencia: competenciaOf(data),
        conta_id: m.querySelector('#e-conta').value,
        descricao,
        contraparte: m.querySelector('#e-contraparte').value.trim(),
        valor,
        tipo: valor < 0 ? 'D' : 'C',
        categoria,
        confianca: categoria ? 'alta' : null,
        conciliado: categoria ? 1 : 0,
        travado: 1,
        obs: m.querySelector('#e-obs').value.trim(),
        origem: l?.origem || 'manual',
        regra_aplicada: 'definido por você',
        dedupe: l?.dedupe || 'manual:' + uid(),
      };
      await salvar('lancamentos', [registro]);
      avisar(l ? 'Lançamento atualizado.' : 'Lançamento incluído.');
      return true;
    },
  }).then((r) => { if (r) aoTerminar(); });
}

// ---------------------------------------------------------------- exportar --

function exportarCSV(itens) {
  const cab = ['Data', 'Conta', 'Descrição', 'Contraparte', 'Documento', 'Categoria', 'Grupo', 'Valor', 'Origem'];
  const escapa = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = itens.map((l) => {
    const c = categorias().find((x) => x.id === l.categoria);
    return [brDate(l.data), nomeConta(l.conta_id), l.descricao, l.contraparte, l.documento,
            c?.nome || '', c?.grupo || '', l.valor.toFixed(2).replace('.', ','), l.origem].map(escapa).join(';');
  });
  const csv = '﻿' + [cab.map(escapa).join(';'), ...linhas].join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    `movel5-lancamentos-${todosOsMeses ? 'todos' : estado.competencia}.csv`);
  avisar('CSV baixado.');
}
