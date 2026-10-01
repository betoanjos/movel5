// Cartões: dividir o pagamento de uma fatura de cartão de crédito por destino.
//
// O extrato do banco mostra um débito só ("CC SICOOB R$ 6.680,16"). A fatura
// diz o que há dentro: anúncio da empresa, parcela de empréstimo, IOF, gasto
// de sócio. Aqui cada item da fatura ganha um destino — direto, ou por uma
// regra que vale para as próximas faturas — e o pagamento é desmembrado em
// uma parte para cada destino. A soma das partes é sempre o que saiu do banco.
import { estado, salvar, remover, categorias, nomeCategoria, nomeConta, ehHolding,
         destinosHolding } from '../store.js';
import { brl, brDate, esc, uid, round2 } from '../lib/util.js';
import { icone, bloco, avisar, liga, modal, selectCategorias } from '../lib/ui.js';
import { lerArquivo } from '../parsers/index.js';
import { CATEGORIA_FATURA, classificarFatura, agruparFatura, creditosJaPagos, distribuir, sugerirPagamentos, montarPartes,
         desfazerFatura, sugerirPadrao, casaPadrao } from '../engine/cartao.js';

// Pagamentos escolhidos para a fatura aberta, e os que vieram da revisão.
let escolhidos = new Set();
let escolhidosDe = null;
let vindosDaRevisao = [];

const finalDoCartao = (f) => String(f.cartao_conta || '').slice(-4);
const nomeFatura = (f) =>
  `${f.instituicao} ····${finalDoCartao(f)} · ${f.mes_nome.toLowerCase()}/${f.vencimento.slice(0, 4)}`;
const partesDe = (f) => estado.lancamentos.filter((l) => l.fatura_cartao === f.id);

// ------------------------------------------------------------ importação --

/** Guarda as faturas lidas, sem mexer nas que já foram trabalhadas. */
export async function registrarFaturas(lidas) {
  const novas = [];
  let repetidas = 0;
  for (const f of lidas) {
    if (estado.faturas.some((x) => x.id === f.id)) { repetidas++; continue; }
    novas.push(classificarFatura(f, estado.regrasCartao));
  }
  if (novas.length) await salvar('faturas', novas);
  return { novas: novas.length, repetidas };
}

async function importarArquivos(arquivos, saida) {
  const linhas = [];
  for (const arq of arquivos) {
    const r = await lerArquivo(arq);
    if (r.faturas?.length) {
      const g = await registrarFaturas(r.faturas);
      linhas.push(bloco(g.novas ? 'ok' : 'info', g.novas
        ? `<strong>${esc(r.tipo)}</strong> importada: ${esc(arq.name)}`
        : `<strong>${esc(arq.name)}</strong>: esta fatura já estava aqui, e o que você classificou foi mantido.`));
      if (r.extra?.aviso && g.novas) linhas.push(bloco('info', esc(r.extra.aviso)));
    } else {
      linhas.push(bloco('atencao', `<strong>${esc(arq.name)}</strong>: ${esc(r.erro || 'não é uma fatura de cartão.')}`));
    }
  }
  saida.innerHTML = `<div class="pilha" style="gap:8px;margin-bottom:12px">${linhas.join('')}</div>`;
}

// ---------------------------------------------------------------- a tela --

export function telaCartoes(raiz, { ir }) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  vindosDaRevisao = (q.get('pagamento') || '').split(',').filter(Boolean);
  let faturaId = q.get('fatura');

  // Veio da revisão com um pagamento marcado: abre a fatura que tem o mesmo total.
  if (!faturaId && vindosDaRevisao.length) {
    const pagos = estado.lancamentos.filter((l) => vindosDaRevisao.includes(l.id));
    const total = Math.round(pagos.reduce((a, l) => a + Math.abs(l.valor), 0) * 100);
    const f = estado.faturas.find((x) => Math.round((x.total || 0) * 100) === total && !partesDe(x).length);
    if (f) faturaId = f.id;
  }
  desenhar(raiz, ir, faturaId);
}

function desenhar(raiz, ir, faturaId) {
  const f = faturaId ? estado.faturas.find((x) => x.id === faturaId) : null;
  if (f) return desenharFatura(raiz, ir, f);
  desenharLista(raiz, ir);
}

// ----------------------------------------------------------------- lista --

function situacao(f) {
  const partes = partesDe(f);
  if (partes.length) {
    const resto = f.restante_anterior ? ` · falta ${brl(f.restante_anterior)} (pago antes)` : '';
    return { rotulo: `dividida em ${partes.length} parte${partes.length > 1 ? 's' : ''}${resto}`, cor: f.restante_anterior ? 'selo-alerta' : 'selo-pos' };
  }
  const { pendentes } = agruparFatura(f, { ehHolding });
  if (pendentes.length) return { rotulo: `${pendentes.length} ite${pendentes.length > 1 ? 'ns' : 'm'} sem destino`, cor: 'selo-alerta' };
  return { rotulo: 'pronta para dividir', cor: 'selo-acento' };
}

function desenharLista(raiz, ir) {
  const faturas = [...estado.faturas].sort((a, b) => b.vencimento.localeCompare(a.vencimento));
  const marcados = estado.lancamentos.filter((l) => l.categoria === CATEGORIA_FATURA && !l.fatura_cartao);
  const regras = estado.regrasCartao;

  raiz.innerHTML = `
  <div class="pilha">
    ${bloco('info', `O extrato do banco mostra o pagamento da fatura num débito só. Importe a fatura aqui: cada
      item ganha um destino (despesa da Móvel5, holding, empréstimo…), e o pagamento é dividido de acordo.
      As regras que você criar valem para as próximas faturas.`)}

    <div id="saida-import"></div>

    <div class="cartao">
      <div class="cartao-cabeca">
        <h2>Faturas</h2>
        <label class="btn btn-pequeno btn-principal" style="cursor:pointer">
          ${icone('importar', 14)} Importar fatura (PDF)
          <input type="file" id="arq-fatura" accept=".pdf,.ofx" multiple hidden>
        </label>
      </div>
      <div class="cartao-corpo cartao-corpo-liso tabela-rolagem">
        ${faturas.length ? `<table class="tabela">
          <thead><tr><th>Cartão</th><th>Vencimento</th><th class="num">Total</th><th>Itens</th><th>Situação</th><th></th></tr></thead>
          <tbody>${faturas.map((f) => {
            const s = situacao(f);
            return `<tr>
              <td><div class="forte">${esc(f.instituicao)} ····${esc(finalDoCartao(f))}</div>
                  <div class="mini mudo">${esc(f.titular)} · fatura de ${esc(f.mes_nome.toLowerCase())}</div></td>
              <td class="mini nowrap">${brDate(f.vencimento)}</td>
              <td class="num forte">${brl(f.total)}</td>
              <td class="mini mudo">${f.itens.length}${f.confere ? '' : ' <span class="selo selo-neg" title="Os itens não fecham com o total">não fecha</span>'}</td>
              <td><span class="selo ${s.cor}">${esc(s.rotulo)}</span></td>
              <td class="nowrap"><button class="btn btn-pequeno" data-abrir="${esc(f.id)}">Abrir</button></td>
            </tr>`;
          }).join('')}</tbody></table>`
          : `<div style="padding:20px" class="mini mudo">Nenhuma fatura ainda. Importe o PDF da fatura do cartão
              (no Sicoob: <em>Extrato de fatura de cartão de crédito</em>).</div>`}
      </div>
    </div>

    ${marcados.length ? `
    <div class="cartao">
      <div class="cartao-cabeca"><h2>Pagamentos marcados como fatura, esperando a fatura</h2></div>
      <div class="cartao-corpo cartao-corpo-liso tabela-rolagem">
        <table class="tabela tabela-compacta"><tbody>${marcados.map((l) => `<tr>
          <td class="mini nowrap">${brDate(l.data)}</td>
          <td class="mini">${esc((l.contraparte || l.descricao || '').slice(0, 70))}</td>
          <td class="mini mudo">${esc(nomeConta(l.conta_id))}</td>
          <td class="num forte neg">${brl(l.valor)}</td>
          <td class="nowrap"><button class="btn btn-sutil btn-pequeno" data-desmarcar="${l.id}">Desmarcar</button></td>
        </tr>`).join('')}</tbody></table>
      </div>
    </div>` : ''}

    ${regras.length ? `
    <div class="cartao">
      <div class="cartao-cabeca"><h2>Regras dos cartões</h2>
        <span class="mini mudo">valem para os itens de qualquer fatura ainda não dividida</span></div>
      <div class="cartao-corpo cartao-corpo-liso tabela-rolagem">
        <table class="tabela tabela-compacta">
          <thead><tr><th>Quando o item tiver</th><th>Vai para</th><th></th></tr></thead>
          <tbody>${regras.map((r) => `<tr>
            <td class="mini"><strong>${esc(r.padrao)}</strong>
              ${r.cartao_final ? `<span class="mudo"> · cartão final ${esc(r.cartao_final)}</span>` : ''}
              ${r.sentido === 'credito' ? '<span class="mudo"> · só créditos</span>' : ''}
              ${r.sentido === 'debito' ? '<span class="mudo"> · só gastos</span>' : ''}</td>
            <td class="mini">${esc(nomeCategoria(r.categoria))}${r.destino_holding ? ` · ${esc(r.destino_holding)}` : ''}</td>
            <td class="nowrap"><button class="btn btn-sutil btn-pequeno" data-apagar-regra="${r.id}">${icone('lixo', 14)}</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}
  </div>`;

  ligarComum(raiz, ir);
  liga(raiz, 'click', '[data-abrir]', (e, alvo) => ir('cartoes', `?fatura=${encodeURIComponent(alvo.dataset.abrir)}`));
  liga(raiz, 'click', '[data-desmarcar]', async (e, alvo) => {
    const l = estado.lancamentos.find((x) => x.id === alvo.dataset.desmarcar);
    if (!l) return;
    await salvar('lancamentos', [{ ...l, categoria: null, confianca: null, conciliado: 0, travado: 0, regra_aplicada: null }]);
    desenharLista(raiz, ir);
  });
  liga(raiz, 'click', '[data-apagar-regra]', async (e, alvo) => {
    await remover('regrasCartao', alvo.dataset.apagarRegra);
    await reclassificarTudo();
    desenharLista(raiz, ir);
  });
}

function ligarComum(raiz, ir) {
  raiz.querySelector('#arq-fatura')?.addEventListener('change', async (e) => {
    const arquivos = [...e.target.files];
    e.target.value = '';
    if (!arquivos.length) return;
    const saida = raiz.querySelector('#saida-import');
    saida.innerHTML = '<div class="mini mudo" style="margin-bottom:12px"><span class="carregando"></span> Lendo a fatura…</div>';
    try {
      await importarArquivos(arquivos, saida);
      const novaLista = [...estado.faturas].sort((a, b) => b.vencimento.localeCompare(a.vencimento));
      const guardada = saida.innerHTML;
      desenharLista(raiz, ir);
      raiz.querySelector('#saida-import').innerHTML = guardada;
      // Se veio da revisão e a fatura certa chegou, abre direto.
      if (vindosDaRevisao.length && novaLista.length) telaCartoes(raiz, { ir });
    } catch (err) {
      saida.innerHTML = bloco('erro', esc(err.message || 'Não consegui ler o arquivo.'));
    }
  });
}

/** Refaz a classificação automática das faturas que ainda não foram divididas. */
async function reclassificarTudo() {
  const mudadas = [];
  for (const f of estado.faturas) {
    if (partesDe(f).length) continue;
    const nova = classificarFatura(f, estado.regrasCartao);
    if (JSON.stringify(nova.itens) !== JSON.stringify(f.itens)) mudadas.push(nova);
  }
  if (mudadas.length) await salvar('faturas', mudadas);
}

// ---------------------------------------------------------------- fatura --

function desenharFatura(raiz, ir, f0) {
  const f = creditosJaPagos(f0);
  const partes = partesDe(f);
  const aplicada = partes.length > 0;
  const agr0 = agruparFatura(f, { ehHolding });

  // Quais débitos do extrato pagaram esta fatura.
  const sug = sugerirPagamentos(f, estado.lancamentos);
  const marcados = estado.lancamentos.filter((l) => l.categoria === CATEGORIA_FATURA && !l.fatura_cartao && l.valor < 0);
  const porId = new Map();
  for (const l of [...sug.candidatas, ...marcados,
    ...estado.lancamentos.filter((l) => vindosDaRevisao.includes(l.id))]) porId.set(l.id, l);
  const candidatas = [...porId.values()];

  if (escolhidosDe !== f.id) {
    escolhidosDe = f.id;
    const base = vindosDaRevisao.length ? vindosDaRevisao : (sug.exato || []).map((l) => l.id);
    escolhidos = new Set(base.filter((id) => porId.has(id)));
  }
  const pagamentos = candidatas.filter((l) => escolhidos.has(l.id));
  const pago = round2(pagamentos.reduce((a, l) => a + Math.abs(l.valor), 0));
  const contas = new Set(pagamentos.map((l) => l.conta_id));
  // Se um pedaço da fatura já foi pago antes, o que saiu agora é distribuído em proporção.
  const agr = pagamentos.length ? distribuir(agr0, pago) : agr0;

  const problemas = [];
  if (agr.pendentes.length) problemas.push(`${agr.pendentes.length} item(ns) ainda sem destino.`);
  if (agr.negativos.length) problemas.push(`O destino ${agr.negativos.map((g) => `"${nomeCategoria(g.categoria)}"`).join(', ')} ficou negativo: ` +
    'há um crédito sem gasto para abater ali. Ponha o crédito no mesmo destino do gasto que ele abate; ou, se ele é um ' +
    'pagamento que já saiu em outro mês, use o botão "já pago antes" na linha dele.');
  if (!pagamentos.length) problemas.push('Escolha o(s) débito(s) do extrato que pagaram esta fatura.');
  else if (Math.abs(round2(pago - agr.total)) >= 0.005) {
    problemas.push(`Os débitos escolhidos somam ${brl(pago)} e a fatura dividida soma ${brl(agr.total)} ` +
      `(diferença de ${brl(round2(pago - agr.total))}).` +
      (agr.total > pago ? ' Se a diferença é um pagamento feito antes, em outro mês, marque o crédito dele como "já pago antes".' : ''));
  }
  if (contas.size > 1) problemas.push('Os débitos escolhidos são de contas diferentes.');
  const pronto = !aplicada && !problemas.length;

  // Itens agrupados por cartão, para ler como a fatura.
  const secoes = [];
  for (const i of f.itens) {
    // Só tem seção própria quem veio sob "GASTOS DE <portador>"; anuidade e
    // encargos citam o final do cartão no texto, mas pertencem ao bloco geral.
    const chave = i.portador ? `${i.cartao_final}|${i.portador}` : '';
    let s = secoes.find((x) => x.chave === chave);
    if (!s) {
      s = { chave, titulo: i.portador
        ? `Cartão final ${i.cartao_final} — ${i.portador}`
        : 'Movimentos da fatura (anuidade, parcelamentos, encargos e créditos)', itens: [] };
      secoes.push(s);
    }
    s.itens.push(i);
  }

  const destinos = destinosHolding();
  const linhaItem = (i) => {
    if (i.neutro) {
      const antes = i.neutro === 'pago_antes';
      return `<tr style="opacity:.6">
        <td class="mini nowrap">${brDate(i.data)}</td>
        <td class="mini" colspan="2">${esc(i.descricao)}
          <div class="mini mudo">${antes
            ? 'pagamento feito antes, em outro mês — não é lançado aqui; o que saiu agora é distribuído em proporção'
            : `quita o saldo anterior de ${brl(f.saldo_anterior)} — fica de fora da divisão`}</div></td>
        <td class="num mini pos">${brl(i.valor)}</td><td colspan="2"></td>
        <td class="nowrap">${antes && !aplicada ? `<button class="btn btn-sutil btn-pequeno" data-pagoantes-nao="${esc(i.id)}">não é isso</button>` : ''}</td></tr>`;
    }
    const holding = ehHolding(i.categoria);
    const origem = { usuario: 'você', regra: 'regra', padrao: 'padrão' }[i.origem_classificacao] || '';
    return `<tr data-item="${esc(i.id)}">
      <td class="mini nowrap">${brDate(i.data)}</td>
      <td class="mini">${esc(i.descricao)}${i.parcela ? ` <span class="mudo">(parcela ${esc(i.parcela)})</span>` : ''}</td>
      <td class="mini mudo">${esc(i.tipo === 'compra' ? '' : i.tipo)}</td>
      <td class="num mini forte ${i.valor < 0 ? 'pos' : ''}">${brl(i.valor)}</td>
      <td style="min-width:190px"><select data-cat="${esc(i.id)}"${aplicada ? ' disabled' : ''}>
        ${selectCategorias(categorias(), i.categoria || '', { vazioTexto: '— escolher —' })}</select></td>
      <td style="min-width:120px"><select data-dest="${esc(i.id)}"${holding && !aplicada ? '' : ' disabled'}>
        <option value="">${holding ? '— destino —' : ''}</option>
        ${destinos.map((d) => `<option value="${esc(d)}"${d === i.destino_holding ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select></td>
      <td class="nowrap mini">${origem ? `<span class="selo">${origem}</span>` : ''}
        ${aplicada ? '' : `<button class="btn btn-sutil btn-pequeno" data-regra="${esc(i.id)}"
          title="Criar regra para itens parecidos, nesta e nas próximas faturas">${icone('raio', 14)}</button>`}
        ${aplicada || i.valor >= 0 ? '' : `<button class="btn btn-pequeno" data-pagoantes="${esc(i.id)}"
          title="Este crédito é um pagamento que já saiu do banco em outro mês: não é lançado aqui">já pago antes</button>`}</td>
    </tr>`;
  };

  raiz.innerHTML = `
  <div class="pilha">
    <div><button class="btn btn-sutil btn-pequeno" data-voltar>← Faturas</button></div>

    <div class="grade g3">
      <div class="cartao kpi"><div class="kpi-rotulo">${esc(nomeFatura(f))}</div>
        <div class="kpi-valor">${brl(f.total)}</div>
        <div class="kpi-nota">vence em ${brDate(f.vencimento)} · pagamento mínimo ${brl(f.minimo)}</div></div>
      <div class="cartao kpi"><div class="kpi-rotulo">Composição</div>
        <div class="kpi-valor" style="font-size:1.05rem">${brl(f.saldo_anterior)} anterior + ${brl(f.debitos)} compras</div>
        <div class="kpi-nota">+ ${brl(f.encargos)} encargos − ${brl(f.pagamentos)} créditos ·
          ${f.confere ? '<span class="pos">fecha com o total ✓</span>' : '<span class="neg">não fecha com o total</span>'}</div></div>
      <div class="cartao kpi"><div class="kpi-rotulo">Situação</div>
        <div class="kpi-valor" style="font-size:1.05rem">${aplicada ? `dividida em ${partes.length} partes` : (pronto ? 'pronta para dividir' : 'em andamento')}</div>
        <div class="kpi-nota">${aplicada
          ? (f.restante_anterior ? `falta dividir ${brl(f.restante_anterior)}: o pagamento feito antes` : 'o pagamento já foi desmembrado na conta')
          : 'escolha o destino de cada item'}</div></div>
    </div>

    <div class="cartao">
      <div class="cartao-cabeca"><h2>Itens da fatura</h2>
        <span class="mini mudo">${aplicada ? 'para mudar, desfaça a divisão' : 'escolha a categoria; em holding, para onde foi'}</span></div>
      <div class="cartao-corpo cartao-corpo-liso tabela-rolagem">
        <table class="tabela tabela-compacta">
          <thead><tr><th>Data</th><th>Descrição</th><th></th><th class="num">Valor</th><th>Categoria</th><th>Destino</th><th></th></tr></thead>
          <tbody>${secoes.map((s) => `
            <tr><td colspan="7" class="micro" style="background:var(--surface-sunken)">${esc(s.titulo)}</td></tr>
            ${s.itens.map(linhaItem).join('')}`).join('')}</tbody>
        </table>
      </div>
    </div>

    <div class="cartao">
      <div class="cartao-cabeca"><h2>Como o pagamento será dividido</h2>
        <span class="mini ${Math.abs(round2(pago - agr.total)) < 0.005 && pagamentos.length ? 'pos forte' : 'mudo'}">
          ${brl(agr.total)} a distribuir</span></div>
      <div class="cartao-corpo">
        ${agr.proporcional ? `<div style="margin-bottom:10px">${bloco('info',
          `Os <strong>${brl(agr.falta)}</strong> que a fatura teve a mais já foram pagos antes, em outro mês, e não são
           lançados aqui. A fatura não diz quais itens esse pagamento quitou, então o que saiu agora foi distribuído em
           proporção: cada destino recebe <strong>${(agr.fator * 100).toFixed(1).replace('.', ',')}%</strong> do seu valor.
           Os ${brl(agr.falta)} restantes ficam para dividir quando esse pagamento for importado.`)}</div>` : ''}
        ${agr.grupos.length ? `<table class="tabela tabela-compacta"><tbody>${agr.grupos.map((g) => `<tr>
          <td class="mini forte">${esc(nomeCategoria(g.categoria))}${g.destino ? ` · ${esc(g.destino)}` : ''}</td>
          <td class="mini mudo">${g.itens.length} ite${g.itens.length > 1 ? 'ns' : 'm'}${g.original != null ? ` · de ${brl(g.original)}` : ''}</td>
          <td class="num forte">${brl(g.total)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="mini mudo">Nada para dividir ainda: classifique os itens acima.</div>'}
        ${agr.zerados.length ? `<div class="mini mudo" style="margin-top:6px">Sem efeito (soma zero): ${
          agr.zerados.map((g) => esc(nomeCategoria(g.categoria))).join(', ')}.</div>` : ''}
      </div>
    </div>

    <div class="cartao">
      <div class="cartao-cabeca"><h2>Pagamento no extrato do banco</h2>
        <span class="mini mudo">${aplicada ? 'já dividido' : 'os débitos que pagaram esta fatura'}</span></div>
      <div class="cartao-corpo">
        ${aplicada ? `
          <table class="tabela tabela-compacta"><tbody>${partes.sort((a, b) => a.fatura_parte - b.fatura_parte).map((l) => `<tr>
            <td class="mini nowrap">${brDate(l.data)}</td>
            <td class="mini">${esc(l.descricao)}</td>
            <td class="num forte neg">${brl(l.valor)}</td></tr>`).join('')}</tbody></table>`
        : (candidatas.length ? `
          <table class="tabela tabela-compacta"><tbody>${candidatas.map((l) => `<tr>
            <td style="width:30px"><input type="checkbox" data-pg="${l.id}" ${escolhidos.has(l.id) ? 'checked' : ''}></td>
            <td class="mini nowrap">${brDate(l.data)}</td>
            <td class="mini">${esc(String(l.contraparte || l.descricao || '').replace(/\s+/g, ' ').slice(0, 80))}</td>
            <td class="mini mudo">${esc(nomeConta(l.conta_id))}</td>
            <td class="num forte neg">${brl(l.valor)}</td></tr>`).join('')}</tbody></table>
          <div class="mini" style="margin-top:8px">Escolhidos: <strong class="num">${brl(pago)}</strong> de ${brl(f.total)} da fatura
            ${sug.exato ? '<span class="mudo">· o painel achou a combinação exata e já marcou</span>' : ''}</div>`
          : '<div class="mini mudo">Não achei saídas perto do vencimento. Marque o pagamento na revisão (botão de cartão) ou confira as datas.</div>')}
      </div>
    </div>

    ${problemas.length && !aplicada ? `<div class="pilha" style="gap:8px">${problemas.map((p) => bloco('atencao', esc(p))).join('')}</div>` : ''}

    <div class="barra-acao">
      <span class="mini secundario">${aplicada
        ? 'O pagamento já está dividido. Desfazer devolve os débitos originais do extrato.'
        : (pronto ? 'Tudo certo: a soma das partes é exatamente o que saiu do banco.' : 'Falta resolver o que está acima.')}</span>
      <span class="espaco"></span>
      ${aplicada
        ? '<button class="btn" data-desfazer>Desfazer a divisão</button>'
        : `<button class="btn btn-principal" data-aplicar ${pronto ? '' : 'disabled'}>${icone('ok', 15)} Dividir o pagamento</button>`}
    </div>
  </div>`;

  // ---- eventos
  liga(raiz, 'click', '[data-voltar]', () => ir('cartoes'));

  liga(raiz, 'change', '[data-cat]', async (e, alvo) => {
    const cat = alvo.value;
    const item = f.itens.find((i) => i.id === alvo.dataset.cat);
    if (cat === CATEGORIA_FATURA && item && item.valor < 0) {
      await gravarItem(f, item.id, { neutro: 'pago_antes', categoria: '', destino_holding: '', origem_classificacao: '' });
    } else {
      await gravarItem(f, alvo.dataset.cat, { categoria: cat, destino_holding: '', origem_classificacao: cat ? 'usuario' : '' });
    }
    desenharFatura(raiz, ir, estado.faturas.find((x) => x.id === f.id));
  });
  liga(raiz, 'change', '[data-dest]', async (e, alvo) => {
    await gravarItem(f, alvo.dataset.dest, { destino_holding: alvo.value, origem_classificacao: 'usuario' });
    desenharFatura(raiz, ir, estado.faturas.find((x) => x.id === f.id));
  });
  liga(raiz, 'click', '[data-pagoantes]', async (e, alvo) => {
    await gravarItem(f, alvo.dataset.pagoantes, { neutro: 'pago_antes', categoria: '', destino_holding: '', origem_classificacao: '' });
    desenharFatura(raiz, ir, estado.faturas.find((x) => x.id === f.id));
  });
  liga(raiz, 'click', '[data-pagoantes-nao]', async (e, alvo) => {
    await gravarItem(f, alvo.dataset.pagoantesNao, { neutro: '' });
    desenharFatura(raiz, ir, estado.faturas.find((x) => x.id === f.id));
  });
  liga(raiz, 'change', '[data-pg]', (e, alvo) => {
    if (alvo.checked) escolhidos.add(alvo.dataset.pg); else escolhidos.delete(alvo.dataset.pg);
    desenharFatura(raiz, ir, f);
  });
  liga(raiz, 'click', '[data-regra]', (e, alvo) => {
    const item = f.itens.find((i) => i.id === alvo.dataset.regra);
    criarRegra(item, f, () => desenharFatura(raiz, ir, estado.faturas.find((x) => x.id === f.id)));
  });

  liga(raiz, 'click', '[data-aplicar]', async () => {
    const ok = await modal({
      titulo: 'Dividir o pagamento da fatura',
      confirmar: 'Dividir',
      corpo: `<p>Os débitos do extrato (<strong>${brl(pago)}</strong>) serão trocados por
          ${agr.grupos.length} parte${agr.grupos.length > 1 ? 's' : ''}, uma para cada destino:</p>
        <table class="tabela tabela-compacta"><tbody>${agr.grupos.map((g) => `<tr>
          <td class="mini">${esc(nomeCategoria(g.categoria))}${g.destino ? ` · ${esc(g.destino)}` : ''}</td>
          <td class="num forte">${brl(g.total)}</td></tr>`).join('')}</tbody></table>
        <p class="mini mudo" style="margin-top:8px">O dinheiro que saiu do banco não muda. Dá para desfazer depois.</p>`,
    });
    if (!ok) return;
    const r = montarPartes(f, pagamentos, agr, { uid, nomeCategoria });
    await salvar('lancamentos', r.novos);              // primeiro entram as partes…
    await remover('lancamentos', r.remover);           // …depois saem os originais
    await salvar('faturas', [{ ...f, situacao: 'dividida', pagamento_ids: r.novos.map((l) => l.id),
      restante_anterior: agr.proporcional ? agr.falta : 0, dividida_em: new Date().toISOString() }]);
    avisar(`Pagamento dividido em ${r.novos.length} partes.`);
    desenharFatura(raiz, ir, estado.faturas.find((x) => x.id === f.id));
  });

  liga(raiz, 'click', '[data-desfazer]', async () => {
    const ok = await modal({
      titulo: 'Desfazer a divisão', confirmar: 'Desfazer', perigo: true,
      corpo: '<p>As partes saem e os débitos originais do extrato voltam como estavam, sem categoria.</p>',
    });
    if (!ok) return;
    const d = desfazerFatura(f, estado.lancamentos);
    if (d.restaurar.length) await salvar('lancamentos', d.restaurar.map((l) => ({ ...l })));
    await remover('lancamentos', d.remover);
    await salvar('faturas', [{ ...f, situacao: 'importada', pagamento_ids: [], restante_anterior: 0, dividida_em: null }]);
    escolhidosDe = null;
    avisar('Divisão desfeita.');
    desenharFatura(raiz, ir, estado.faturas.find((x) => x.id === f.id));
  });
}

async function gravarItem(f, itemId, campos) {
  const atual = estado.faturas.find((x) => x.id === f.id);
  const itens = atual.itens.map((i) => (i.id === itemId ? { ...i, ...campos } : i));
  await salvar('faturas', [{ ...atual, itens }]);
}

// ----------------------------------------------------------------- regra --

function criarRegra(item, fatura, aoTerminar) {
  const destinos = destinosHolding();
  const padrao0 = sugerirPadrao(item);

  // Quantos itens de faturas ainda não divididas uma regra casaria.
  const contar = (padrao, final, sentido) => {
    let n = 0;
    for (const f of estado.faturas) {
      if (partesDe(f).length) continue;
      for (const i of f.itens) {
        if (i.neutro) continue;
        if (!casaPadrao(padrao, i.descricao)) continue;
        if (final && i.cartao_final !== final) continue;
        if (sentido && (i.valor < 0 ? 'credito' : 'debito') !== sentido) continue;
        n++;
      }
    }
    return n;
  };

  modal({
    titulo: 'Criar regra para os cartões',
    confirmar: 'Criar regra',
    largo: true,
    corpo: `
      <div class="cartao" style="margin-bottom:12px"><div class="cartao-corpo">
        <div class="mini mudo">${brDate(item.data)} · cartão final ${esc(item.cartao_final || '—')}</div>
        <div class="forte">${esc(item.descricao)}</div>
        <div class="num forte">${brl(item.valor)}</div>
      </div></div>
      <label class="campo"><span class="campo-rotulo">Quando a descrição tiver</span>
        <input id="r-padrao" value="${esc(padrao0)}">
        <span class="campo-dica" id="r-conta"></span></label>
      <div class="grade g2" style="gap:12px">
        <label class="campo"><span class="campo-rotulo">Vale para</span>
          <select id="r-sentido">
            <option value="">gastos e créditos</option>
            <option value="debito">só gastos</option>
            <option value="credito"${item.valor < 0 ? ' selected' : ''}>só créditos (pagamentos, estornos)</option>
          </select></label>
        ${item.cartao_final ? `<label class="campo"><span class="campo-rotulo">Cartão</span>
          <select id="r-final"><option value="">qualquer cartão</option>
            <option value="${esc(item.cartao_final)}">só o final ${esc(item.cartao_final)}</option></select></label>` : ''}
      </div>
      <div class="grade g2" style="gap:12px">
        <label class="campo"><span class="campo-rotulo">Categoria</span>
          <select id="r-cat">${selectCategorias(categorias(), item.categoria || '', { vazioTexto: '— escolher —' })}</select></label>
        <label class="campo"><span class="campo-rotulo">Destino na holding</span>
          <select id="r-dest"><option value="">— destino —</option>
            ${destinos.map((d) => `<option value="${esc(d)}"${d === item.destino_holding ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
      </div>`,
    aoAbrir: (m) => {
      const atualizar = () => {
        m.querySelector('#r-dest').disabled = !ehHolding(m.querySelector('#r-cat').value);
        const n = contar(m.querySelector('#r-padrao').value, m.querySelector('#r-final')?.value || '',
          m.querySelector('#r-sentido').value);
        m.querySelector('#r-conta').textContent = n
          ? `Casa com ${n} ite${n > 1 ? 'ns' : 'm'} das faturas ainda não divididas.`
          : 'Não casa com nenhum item das faturas importadas.';
      };
      m.addEventListener('input', atualizar);
      m.addEventListener('change', atualizar);
      atualizar();
    },
    aoConfirmar: async (m) => {
      const padrao = m.querySelector('#r-padrao').value.trim();
      const categoria = m.querySelector('#r-cat').value;
      const destino = ehHolding(categoria) ? m.querySelector('#r-dest').value : '';
      if (!padrao) { avisar('Diga o que procurar na descrição.'); return false; }
      if (!categoria) { avisar('Escolha a categoria.'); return false; }
      if (ehHolding(categoria) && !destino) { avisar('Escolha o destino na holding.'); return false; }

      await salvar('regrasCartao', [{
        id: uid(), padrao, categoria, destino_holding: destino,
        cartao_final: m.querySelector('#r-final')?.value || '',
        sentido: m.querySelector('#r-sentido').value,
        criada_em: new Date().toISOString(),
      }]);
      // O item de onde a regra nasceu passa a ser dela, e não "escolha sua":
      // assim, mudar a regra depois muda o item também.
      const atual = estado.faturas.find((x) => x.id === fatura.id);
      await salvar('faturas', [{ ...atual, itens: atual.itens.map((i) =>
        (i.id === item.id ? { ...i, origem_classificacao: '' } : i)) }]);
      await reclassificarTudo();
      avisar('Regra criada e aplicada às faturas ainda não divididas.');
      return true;
    },
  }).then((r) => { if (r) aoTerminar?.(); });
}
