// Lançamentos: a lista completa, com busca, filtros, edição e inclusão manual.
// É aqui que ele acerta o passado — lança à mão o que não veio de arquivo.
import { estado, salvar, remover, categorias, categoriaPorId, nomeCategoria, nomeConta, contaPorId,
         ehHolding, destinosHolding } from '../store.js';
import { brl, brDate, esc, uid, normalize, competenciaOf, sum, round2, download, labelCompetencia } from '../lib/util.js';
import { icone, bloco, avisar, vazio, liga, modal, selectCategorias,
         campoDestinoHolding, ligarDestinoHolding } from '../lib/ui.js';

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
    // "__sem" pega tanto o que nunca foi classificado quanto o que ficou
    // apontando para uma categoria apagada — é onde costuma se esconder a
    // diferença que a ponte não explica.
    if (fCategoria === '__sem') {
      if (l.categoria && categoriaPorId(l.categoria)) return false;
    } else if (fCategoria && (l.categoria || '') !== fCategoria) return false;
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
            <option value="__sem"${fCategoria === '__sem' ? ' selected' : ''}>Sem categoria (ou apagada)</option>
            ${selectCategorias(categorias(), fCategoria, { vazioTexto: '— nenhuma —' })}</select>
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
      <span class="mini" id="soma-sel"></span>
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
    raiz.querySelector('#soma-sel').innerHTML = resumoSelecionados(selecionados);
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
              ${l.transfer_id ? '<span class="selo selo-acento" style="margin-left:4px">transferência</span>' : ''}
              ${l.desmembramento ? `<span class="selo" style="margin-left:4px" title="Este valor foi dividido em partes">parte ${l.parte}/${l.partes}</span>` : ''}
              ${l.destino_holding ? `<span class="selo" style="margin-left:4px;color:var(--holding)">${esc(l.destino_holding)}</span>` : ''}
              ${l.venda_numero ? `<span class="selo selo-acento" style="margin-left:4px">pedido ${esc(l.venda_numero)}</span>` : ''}</div>
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
      ${campoDestinoHolding(destinosHolding(), l?.destino_holding || '')}
      <label class="campo"><span class="campo-rotulo">Observação</span>
        <textarea id="e-obs" placeholder="Opcional">${esc(l?.obs || '')}</textarea></label>
      ${!novo ? `<div class="linha-flex" style="gap:8px;flex-wrap:wrap">
        <button class="btn btn-pequeno" id="e-desmembrar">${icone('mais', 14)} Desmembrar em partes</button>
        ${l.desmembramento && l.original ? `<button class="btn btn-pequeno" id="e-juntar">Juntar de volta</button>` : ''}
        <button class="btn btn-perigo btn-pequeno" id="e-excluir">${icone('lixo', 14)} Excluir</button>
      </div>` : ''}`,
    aoAbrir: (m) => {
      ligarDestinoHolding(m, 'e-categoria', ehHolding);
      m.querySelector('#e-desmembrar')?.addEventListener('click', () => {
        m.remove();
        desmembrar(l, aoTerminar);
      });
      m.querySelector('#e-juntar')?.addEventListener('click', async () => {
        const ok = await modal({ titulo: 'Juntar de volta',
          corpo: `<p>As partes somem e o lançamento volta a ser um só, como veio do arquivo.</p>`,
          confirmar: 'Juntar' });
        if (!ok) return;
        await juntarPartes(l);
        m.remove(); avisar('Lançamento reunido.'); aoTerminar();
      });
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
        destino_holding: ehHolding(categoria) ? (m.querySelector('#e-destino')?.value || '') : '',
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

// ------------------------------------------------------------ desmembrar --

/**
 * Divide um lançamento em partes. O caso que motivou isto: a parcela do
 * empréstimo sai inteira da conta da Móvel5, mas um pedaço é da holding.
 *
 * O lançamento original é substituído pelas partes — a soma das partes é
 * sempre igual ao valor que saiu do banco, então o saldo da conta não muda.
 * A chave de duplicidade do original fica na primeira parte, de modo que
 * reimportar o mesmo arquivo não traz o lançamento de volta.
 */
export function desmembrar(l, aoTerminar) {
  if (!l) return;
  if (l.transfer_id) {
    return avisar('Este lançamento faz parte de uma transferência pareada. Desfaça o pareamento antes de desmembrar.');
  }
  const total = Math.abs(l.valor);
  const sinal = l.valor < 0 ? -1 : 1;
  const destinos = destinosHolding();
  let partes = [
    { valor: '', categoria: l.categoria || '', destino: l.destino_holding || '' },
    { valor: '', categoria: 'hold_saida', destino: '' },
  ];
  if (sinal > 0) partes[1].categoria = 'hold_entrada';

  const linha = (p, i) => `
    <tr data-linha="${i}">
      <td style="width:130px"><input type="number" step="0.01" min="0" data-p="valor"
        value="${p.valor === '' ? '' : Number(p.valor).toFixed(2)}" placeholder="0,00" aria-label="Valor da parte ${i + 1}"></td>
      <td><select data-p="categoria">${selectCategorias(categorias(), p.categoria, { vazioTexto: '— escolher —' })}</select></td>
      <td style="width:150px"><select data-p="destino"${ehHolding(p.categoria) ? '' : ' disabled'}>
        <option value="">— destino —</option>
        ${destinos.map((d) => `<option value="${esc(d)}"${d === p.destino ? ' selected' : ''}>${esc(d)}</option>`).join('')}
      </select></td>
      <td style="width:auto" class="nowrap">
        <button class="btn btn-sutil btn-pequeno" data-resto="${i}" title="Usar o valor que falta">resto</button>
        ${partes.length > 2 ? `<button class="btn btn-sutil btn-pequeno" data-remover="${i}" title="Remover">${icone('x', 13)}</button>` : ''}
      </td>
    </tr>`;

  modal({
    titulo: 'Desmembrar lançamento',
    confirmar: 'Desmembrar',
    largo: true,
    corpo: `
      <div class="cartao" style="margin-bottom:14px"><div class="cartao-corpo">
        <div class="mini mudo">${brDate(l.data)} · ${esc(nomeConta(l.conta_id))}</div>
        <div class="forte">${esc(l.contraparte || l.descricao || '—')}</div>
        <div class="num forte ${l.valor >= 0 ? 'pos' : 'neg'}" style="font-size:1.2rem">${brl(l.valor)}</div>
      </div></div>
      <p class="mini secundario">Diga quanto é de cada um. A soma das partes tem que dar
        exatamente ${brl(total)} — o dinheiro que saiu do banco não muda.</p>
      <table class="tabela tabela-compacta"><tbody id="d-corpo"></tbody></table>
      <div class="linha-flex" style="margin-top:10px">
        <button class="btn btn-pequeno" id="d-mais">${icone('mais', 13)} Mais uma parte</button>
        <span class="espaco"></span>
        <span class="mini" id="d-resumo"></span>
      </div>`,
    aoAbrir: (m) => {
      const corpo = m.querySelector('#d-corpo');

      const coletar = () => {
        corpo.querySelectorAll('[data-linha]').forEach((tr) => {
          const i = Number(tr.dataset.linha);
          const v = tr.querySelector('[data-p="valor"]').value;
          partes[i].valor = v === '' ? '' : Number(v);
          partes[i].categoria = tr.querySelector('[data-p="categoria"]').value;
          partes[i].destino = tr.querySelector('[data-p="destino"]').value;
        });
      };
      // Lê os campos na hora: o total tem que mudar enquanto ele digita.
      const distribuido = () => round2([...corpo.querySelectorAll('[data-p="valor"]')]
        .reduce((a, i) => a + (Number(i.value) || 0), 0));
      const resumo = () => {
        const falta = round2(total - distribuido());
        const el = m.querySelector('#d-resumo');
        const feito = distribuido();
        el.className = `mini ${Math.abs(falta) < 0.005 ? 'pos forte' : 'neg forte'}`;
        el.textContent = Math.abs(falta) < 0.005
          ? `${brl(feito)} distribuídos — fecha certinho ✓`
          : falta > 0 ? `${brl(feito)} de ${brl(total)} · falta ${brl(falta)}`
                      : `${brl(feito)} de ${brl(total)} · passou ${brl(Math.abs(falta))}`;
      };
      const pintar = () => {
        corpo.innerHTML = partes.map(linha).join('');
        resumo();
      };

      corpo.addEventListener('input', resumo);
      corpo.addEventListener('change', (e) => {
        if (e.target.dataset.p === 'categoria') {
          const sel = e.target.closest('tr').querySelector('[data-p="destino"]');
          sel.disabled = !ehHolding(e.target.value);
          if (sel.disabled) sel.value = '';
        }
      });
      corpo.addEventListener('click', (e) => {
        const resto = e.target.closest('[data-resto]');
        const rem = e.target.closest('[data-remover]');
        if (resto) {
          const i = Number(resto.dataset.resto);
          coletar();
          const outros = round2(partes.reduce((a, p, j) => a + (j === i ? 0 : Number(p.valor) || 0), 0));
          partes[i].valor = round2(total - outros);
          pintar();
        }
        if (rem) { coletar(); partes.splice(Number(rem.dataset.remover), 1); pintar(); }
      });
      m.querySelector('#d-mais').addEventListener('click', () => {
        coletar();
        partes.push({ valor: '', categoria: '', destino: '' });
        pintar();
      });

      pintar();
      m._coletar = coletar;
      m._partes = () => partes;
    },
    aoConfirmar: async (m) => {
      m._coletar();
      const usadas = m._partes().filter((p) => Number(p.valor) > 0);
      if (usadas.length < 2) { avisar('Informe o valor de pelo menos duas partes.'); return false; }
      const soma = round2(usadas.reduce((a, p) => a + Number(p.valor), 0));
      if (Math.abs(round2(soma - total)) >= 0.005) {
        avisar(`As partes somam ${brl(soma)} e o lançamento é de ${brl(total)}.`); return false;
      }
      if (usadas.some((p) => !p.categoria)) { avisar('Escolha a categoria de cada parte.'); return false; }

      const grupo = 'dm_' + uid();
      const original = { ...l };
      const novos = usadas.map((p, i) => ({
        ...l,
        id: uid(),
        descricao: `${l.descricao || 'Lançamento'} — parte ${i + 1}/${usadas.length}`,
        valor: round2(sinal * Number(p.valor)),
        tipo: sinal < 0 ? 'D' : 'C',
        categoria: p.categoria,
        destino_holding: ehHolding(p.categoria) ? p.destino : '',
        confianca: 'alta',
        conciliado: 1,
        travado: 1,
        possivel_transferencia: 0,
        regra_aplicada: 'desmembrado por você',
        desmembramento: grupo,
        parte: i + 1,
        partes: usadas.length,
        original,
        dedupe: i === 0 ? l.dedupe : `${l.dedupe || 'dm'}#${i}`,
      }));

      await salvar('lancamentos', novos);
      await remover('lancamentos', l.id);
      avisar(`Dividido em ${novos.length} partes.`);
      return true;
    },
  }).then((r) => { if (r) aoTerminar?.(); });
}

/** Desfaz um desmembramento: apaga as partes e devolve o lançamento original. */
export async function juntarPartes(parte) {
  const grupo = parte.desmembramento;
  const original = parte.original;
  if (!grupo || !original) return;
  const irmas = estado.lancamentos.filter((l) => l.desmembramento === grupo);
  await salvar('lancamentos', [{ ...original }]);
  await remover('lancamentos', irmas.map((l) => l.id).filter((id) => id !== original.id));
}

/**
 * Soma do que está selecionado — serve de conferência antes de aplicar uma
 * categoria em lote ou de desmembrar. Mostra entradas e saídas separadas
 * quando há dos dois tipos, porque aí o total sozinho engana.
 */
export function resumoSelecionados(ids) {
  const itens = [...ids].map((id) => estado.lancamentos.find((l) => l.id === id)).filter(Boolean);
  if (!itens.length) return '';
  const entradas = sum(itens.filter((l) => l.valor > 0), (l) => l.valor);
  const saidas = sum(itens.filter((l) => l.valor < 0), (l) => l.valor);
  const total = round2(entradas + saidas);
  if (entradas && saidas) {
    return `<span class="secundario">soma</span> <strong class="num ${total >= 0 ? 'pos' : 'neg'}">${brl(total)}</strong>
      <span class="mudo">(${brl(entradas)} − ${brl(Math.abs(saidas))})</span>`;
  }
  return `<span class="secundario">soma</span> <strong class="num ${total >= 0 ? 'pos' : 'neg'}">${brl(total)}</strong>`;
}
