// Relatório mensal: a versão que se lê na tela, se imprime e se baixa em PDF.
import { estado, nomeConta } from '../store.js';
import { apurar, serieHistorica, comparar } from '../engine/relatorio.js';
import { brl, labelCompetencia, prevCompetencia, brDate, esc, num } from '../lib/util.js';
import { icone, bloco, avisar } from '../lib/ui.js';
import { graficoMensal, ativarGraficoMensal, graficoCategorias } from '../lib/graficos.js';

const JSPDF = new URL('../../vendor/jspdf.umd.min.js', import.meta.url).href;
const AUTOTABLE = new URL('../../vendor/jspdf.plugin.autotable.min.js', import.meta.url).href;

export function telaRelatorio(raiz) {
  const comp = estado.competencia;
  const dados = {
    lancamentos: estado.lancamentos, contas: estado.contas,
    fechamentos: estado.fechamentos, vendas: estado.vendas, compras: estado.compras,
    categorias: estado.categorias,
  };
  const a = apurar(comp, dados);
  const serie = serieHistorica(dados, { ate: comp, meses: 12 });
  const anterior = prevCompetencia(comp);
  const temAnterior = estado.lancamentos.some((l) => l.competencia === anterior);
  const cmp = temAnterior ? comparar(anterior, comp, dados) : null;

  raiz.innerHTML = `
  <div class="pilha">
    <div class="linha-flex">
      <span class="mini secundario">Relatório de ${esc(labelCompetencia(comp))}, gerado em ${brDate(new Date().toISOString().slice(0, 10))}.</span>
      <span class="espaco"></span>
      <button class="btn" id="btn-imprimir">${icone('relatorio', 15)} Imprimir</button>
      <button class="btn btn-principal" id="btn-pdf">${icone('baixar', 15)} Baixar PDF</button>
    </div>

    ${a.contagem.pendentes ? bloco('atencao',
      `${a.contagem.pendentes} lançamento(s) ainda não foram revisados — os números abaixo podem mudar.`,
      '<a class="btn btn-pequeno" href="#/revisar">Revisar</a>') : ''}

    <div class="cartao">
      <div class="cartao-corpo">
        <div class="linha-flex" style="justify-content:space-between;align-items:flex-start;margin-bottom:20px">
          <div>
            <img class="logo logo-claro" src="assets/logo.png" alt="Móvel5" width="150" height="36">
            <img class="logo logo-escuro" src="assets/logo-escuro.png" alt="" aria-hidden="true" width="150" height="36">
            <p class="secundario mini" style="margin:6px 0 0">Indústria e Comércio · resultado de ${esc(labelCompetencia(comp))}</p>
          </div>
          <div class="direita">
            <div class="micro">Resultado do mês</div>
            <div class="num forte ${a.resultado.resultadoOperacional >= 0 ? 'pos' : 'neg'}"
                 style="font-size:1.6rem">${brl(a.resultado.resultadoOperacional)}</div>
          </div>
        </div>

        <div class="grade g4" style="gap:12px;margin-bottom:22px">
          ${quadro('Receita', a.resultado.receitas, 'pos')}
          ${quadro('Despesa', a.resultado.despesas, 'neg')}
          ${quadro('Margem', a.resultado.margem, '', '%')}
          ${quadro('Caixa no fim do mês', a.caixa.final, '')}
        </div>

        <h3 style="margin:22px 0 8px">Demonstrativo do mês</h3>
        ${tabelaDRE(a)}

        <h3 style="margin:26px 0 8px">Do resultado ao dinheiro em caixa</h3>
        <p class="mini secundario">Lucro não é o mesmo que dinheiro na conta. Estas linhas mostram a diferença.</p>
        ${tabelaPonte(a)}

        <h3 style="margin:26px 0 8px">Saldo por conta</h3>
        ${tabelaContas(a)}

        <h3 style="margin:26px 0 8px">Conta corrente com a holding</h3>
        ${tabelaHolding(a)}
        ${a.holding.porDestino.length ? `
          <h4 style="margin:18px 0 6px">Por destino</h4>
          ${tabelaDestinosHolding(a.holding)}` : ''}

        ${cmp ? `<h3 style="margin:26px 0 8px">Comparação com ${esc(labelCompetencia(anterior))}</h3>
          ${tabelaComparacao(cmp)}` : ''}
      </div>
    </div>

    <div class="cartao">
      <div class="cartao-cabeca"><h2>Histórico</h2></div>
      <div class="cartao-corpo" id="gfx-rel">${graficoMensal(serie)}</div>
    </div>

    <div class="grade g2">
      <div class="cartao">
        <div class="cartao-cabeca"><h2>Despesas por categoria</h2></div>
        <div class="cartao-corpo">${graficoCategorias(a.despesasPorCategoria, { limite: 12 })}</div>
      </div>
      <div class="cartao">
        <div class="cartao-cabeca"><h2>Receitas por categoria</h2></div>
        <div class="cartao-corpo">${graficoCategorias(a.receitasPorCategoria, { limite: 8, corBarra: '--serie-3' })}</div>
      </div>
    </div>
  </div>`;

  ativarGraficoMensal(raiz.querySelector('#gfx-rel'), serie);
  raiz.querySelector('#btn-imprimir').onclick = () => print();
  raiz.querySelector('#btn-pdf').onclick = (e) => gerarPDF(e.target.closest('button'), a, serie, cmp);
}

const quadro = (rotulo, valor, classe, sufixo = '') => `
  <div style="padding:12px 14px;background:var(--surface-sunken);border-radius:var(--r-md)">
    <div class="micro">${esc(rotulo)}</div>
    <div class="num forte ${classe}" style="font-size:1.15rem">
      ${sufixo === '%' ? num(valor) + '%' : brl(valor)}</div>
  </div>`;

function tabelaDRE(a) {
  const linhaGrupo = (nome, itens, total, classe) => `
    <tr style="background:var(--surface-sunken)">
      <td class="forte">${esc(nome)}</td><td class="num forte ${classe}">${brl(total)}</td><td class="num mudo"></td></tr>
    ${itens.map((c) => `<tr><td style="padding-left:26px">${esc(c.nome)}
      <span class="mini mudo">(${c.qtd})</span></td>
      <td class="num">${brl(c.total)}</td>
      <td class="num mudo mini">${(c.pct || 0).toFixed(1)}%</td></tr>`).join('')}`;

  return `<table class="tabela tabela-compacta">
    <thead><tr><th>Conta</th><th class="num">Valor</th><th class="num">%</th></tr></thead>
    <tbody>
      ${linhaGrupo('Receitas', a.receitasPorCategoria, a.resultado.receitas, 'pos')}
      ${a.grupos.map((g) => linhaGrupo(g.nome, g.itens, g.total, 'neg')).join('')}
      <tr style="border-top:2px solid var(--linha-forte)">
        <td class="forte">Resultado operacional</td>
        <td class="num forte ${a.resultado.resultadoOperacional >= 0 ? 'pos' : 'neg'}">${brl(a.resultado.resultadoOperacional)}</td>
        <td class="num mini forte">${num(a.resultado.margem)}%</td></tr>
    </tbody></table>`;
}

const tabelaPonte = (a) => `
  <table class="tabela tabela-compacta">
    <tbody>${a.ponte.map((p) => `<tr${p.total ? ' style="border-top:2px solid var(--linha-forte)"' : ''}>
      <td class="${p.total || p.destaque ? 'forte' : ''}">${esc(p.rotulo)}
        ${p.qtd ? `<span class="mini mudo">· ${p.qtd} lançamento(s)</span>` : ''}
        ${p.nota ? `<div class="mini mudo">${esc(p.nota)}</div>` : ''}</td>
      <td class="num ${p.valor >= 0 ? 'pos' : 'neg'} ${p.total ? 'forte' : ''}">${brl(p.valor)}</td></tr>`).join('')}
      <tr><td class="mudo mini">Variação de caixa de fato</td><td class="num mudo mini">${brl(a.caixa.variacao)}</td></tr>
    </tbody></table>`;

const tabelaContas = (a) => `
  <table class="tabela tabela-compacta">
    <thead><tr><th>Conta</th><th class="num">Abertura</th><th class="num">Entradas</th>
      <th class="num">Saídas</th><th class="num">Saldo final</th></tr></thead>
    <tbody>${a.porConta.map((c) => `<tr>
      <td>${esc(c.nome)}</td><td class="num mudo">${brl(c.inicial)}</td>
      <td class="num pos">${brl(c.entradas)}</td><td class="num neg">${brl(c.saidas)}</td>
      <td class="num forte">${brl(c.final)}</td></tr>`).join('')}
      <tr style="border-top:2px solid var(--linha-forte)"><td class="forte">Total</td>
        <td class="num">${brl(a.caixa.inicial)}</td><td class="num pos">${brl(a.caixa.entradas)}</td>
        <td class="num neg">${brl(a.caixa.saidas)}</td><td class="num forte">${brl(a.caixa.final)}</td></tr>
      ${a.caixa.aplicado > 0.005 ? `<tr><td colspan="5" class="mini mudo">
        Desse saldo, ${brl(a.caixa.aplicado)} estão no RDC automático — continuam disponíveis, só rendendo.</td></tr>` : ''}
    </tbody></table>`;

const tabelaHolding = (a) => `
  <table class="tabela tabela-compacta">
    <tbody>
      <tr><td>A empresa pagou por conta dos sócios neste mês</td><td class="num neg">${brl(a.holding.pagoPelaEmpresa)}</td></tr>
      <tr><td>Os sócios colocaram na empresa neste mês</td><td class="num pos">${brl(a.holding.aportado)}</td></tr>
      <tr style="border-top:2px solid var(--linha-forte)">
        <td class="forte">Saldo acumulado da conta</td>
        <td class="num forte" style="color:var(--holding)">${brl(Math.abs(a.holding.saldoAcumulado))}</td></tr>
      <tr><td colspan="2" class="mini secundario">${esc(a.holding.interpretacao)}</td></tr>
    </tbody></table>`;

/** Quebra da conta da holding por pessoa/negócio — só para enxergar. */
const tabelaDestinosHolding = (h) => `
  <table class="tabela tabela-compacta">
    <thead><tr><th>Destino</th><th class="num">Pagou por ele</th>
      <th class="num">Colocou na empresa</th><th class="num">Saldo acumulado</th></tr></thead>
    <tbody>
      ${h.porDestino.map((d) => `<tr>
        <td>${esc(d.destino)}</td>
        <td class="num neg">${d.pago ? brl(d.pago) : '—'}</td>
        <td class="num pos">${d.aportado ? brl(d.aportado) : '—'}</td>
        <td class="num forte" style="color:var(--holding)">${brl(d.saldoAcumulado)}</td></tr>`).join('')}
    </tbody>
  </table>
  <p class="mini mudo" style="margin-top:6px">Saldo positivo: esse destino deve à Móvel5.
    Negativo: a Móvel5 deve a ele.</p>`;

const tabelaComparacao = (cmp) => `
  <table class="tabela tabela-compacta">
    <thead><tr><th>Categoria</th><th class="num">${esc(labelCompetencia(cmp.a.competencia))}</th>
      <th class="num">${esc(labelCompetencia(cmp.b.competencia))}</th><th class="num">Diferença</th></tr></thead>
    <tbody>${cmp.linhas.slice(0, 14).map((l) => `<tr>
      <td>${esc(l.nome)}</td><td class="num mudo">${brl(l.anterior)}</td>
      <td class="num">${brl(l.atual)}</td>
      <td class="num ${(l.natureza === 'receita' ? l.delta >= 0 : l.delta <= 0) ? 'pos' : 'neg'}">
        ${l.delta >= 0 ? '+' : ''}${brl(l.delta)}
        ${l.deltaPct != null ? `<span class="mini mudo"> ${l.deltaPct >= 0 ? '+' : ''}${l.deltaPct.toFixed(0)}%</span>` : ''}
      </td></tr>`).join('')}
    </tbody></table>`;

// -------------------------------------------------------------------- PDF ---

/**
 * Carrega a logo para o PDF. Se falhar, o relatório sai mesmo assim — só com
 * o nome escrito, como antes.
 */
function carregarLogo() {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = new URL('../../assets/logo.png', import.meta.url).href;
  });
}

async function carregar(url) {
  return new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = url; s.onload = ok; s.onerror = () => err(new Error('Falha ao carregar o gerador de PDF'));
    document.head.appendChild(s);
  });
}

async function gerarPDF(btn, a, serie, cmp) {
  const rotulo = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="carregando"></span> Gerando…';
  try {
    if (!window.jspdf) await carregar(JSPDF);
    if (!window.jspdf.jsPDF.API.autoTable) await carregar(AUTOTABLE);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const L = 40;
    const larg = doc.internal.pageSize.getWidth();
    const azul = [42, 120, 214], verde = [18, 133, 94], vermelho = [201, 48, 47], cinza = [110, 108, 100];
    let y = 46;

    // ---- capa ----
    const marca = await carregarLogo();
    if (marca) {
      const larguraMarca = 118;
      doc.addImage(marca, 'PNG', L, y - 8, larguraMarca, larguraMarca * 143 / 600);
      y += larguraMarca * 143 / 600 + 6;
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...cinza);
      doc.text('Indústria e Comércio', L, y); y += 20;
    } else {
      doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(20, 20, 16);
      doc.text('Móvel5 Indústria e Comércio', L, y); y += 22;
    }
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(20, 20, 16);
    doc.text(`Resultado de ${labelCompetencia(a.competencia)}`, L, y); y += 24;

    const positivo = a.resultado.resultadoOperacional >= 0;
    doc.setFillColor(...(positivo ? [228, 244, 238] : [251, 234, 233]));
    doc.roundedRect(L, y, larg - L * 2, 68, 6, 6, 'F');
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...cinza);
    doc.text('A empresa deu dinheiro neste mês?', L + 16, y + 20);
    doc.setFont('helvetica', 'bold').setFontSize(24).setTextColor(...(positivo ? verde : vermelho));
    doc.text(brl(a.resultado.resultadoOperacional), L + 16, y + 46);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...cinza);
    doc.text(`${positivo ? 'Sobrou' : 'Faltou'} este valor · margem de ${num(a.resultado.margem)}% sobre ${brl(a.resultado.receitas)}`,
      L + 16, y + 60);
    y += 86;

    const tabela = (titulo, head, body, opts = {}) => {
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(20, 20, 16);
      doc.text(titulo, L, y); y += 8;
      doc.autoTable({
        startY: y, margin: { left: L, right: L },
        head: [head], body,
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: [40, 40, 36] },
        headStyles: { fontStyle: 'bold', textColor: cinza, fillColor: [244, 243, 240], lineWidth: 0 },
        alternateRowStyles: { fillColor: [252, 252, 251] },
        columnStyles: opts.colunas || {},
        // O autoTable não leva o alinhamento da coluna para o cabeçalho:
        // sem isto, "Valor" fica à esquerda e os números à direita.
        didParseCell: (dados) => {
          const col = (opts.colunas || {})[dados.column.index];
          if (col?.halign) dados.cell.styles.halign = col.halign;
          opts.celula?.(dados);
        },
      });
      y = doc.lastAutoTable.finalY + 22;
      if (y > doc.internal.pageSize.getHeight() - 110) { doc.addPage(); y = 46; }
    };

    const dir = { halign: 'right' };
    tabela('Resumo do mês', ['Indicador', 'Valor'], [
      ['Entradas em todas as contas', brl(a.caixa.entradas)],
      ['Saídas em todas as contas', brl(a.caixa.saidas)],
      ['Receita da empresa', brl(a.resultado.receitas)],
      ['Despesa da empresa', brl(a.resultado.despesas)],
      ['Resultado operacional', brl(a.resultado.resultadoOperacional)],
      ['Saldo em caixa no fim do mês', brl(a.caixa.final)],
    ], { colunas: { 1: dir } });

    tabela('Demonstrativo por categoria', ['Categoria', 'Grupo', 'Lanç.', 'Valor', '%'], [
      ...a.receitasPorCategoria.map((c) => [c.nome, 'Receitas', String(c.qtd), brl(c.total), `${(c.pct || 0).toFixed(1)}%`]),
      ...a.despesasPorCategoria.map((c) => [c.nome, c.grupo, String(c.qtd), brl(c.total), `${(c.pct || 0).toFixed(1)}%`]),
    ], { colunas: { 2: dir, 3: dir, 4: dir } });

    tabela('Do resultado ao dinheiro em caixa', ['Item', 'Valor'],
      a.ponte.map((p) => [p.rotulo, brl(p.valor)]), { colunas: { 1: dir } });

    tabela('Saldo por conta', ['Conta', 'Abertura', 'Entradas', 'Saídas', 'Saldo final'], [
      ...a.porConta.map((c) => [c.nome, brl(c.inicial), brl(c.entradas), brl(c.saidas), brl(c.final)]),
      ['TOTAL', brl(a.caixa.inicial), brl(a.caixa.entradas), brl(a.caixa.saidas), brl(a.caixa.final)],
    ], { colunas: { 1: dir, 2: dir, 3: dir, 4: dir } });

    tabela('Conta corrente com a holding', ['Item', 'Valor'], [
      ['A empresa pagou por conta dos sócios', brl(a.holding.pagoPelaEmpresa)],
      ['Os sócios colocaram na empresa', brl(a.holding.aportado)],
      ['Saldo acumulado', brl(Math.abs(a.holding.saldoAcumulado))],
      [a.holding.interpretacao, ''],
    ], { colunas: { 1: dir } });

    if (a.holding.porDestino.length) {
      tabela('Holding por destino', ['Destino', 'Pagou por ele', 'Colocou na empresa', 'Saldo acumulado'],
        a.holding.porDestino.map((d) => [d.destino, brl(d.pago), brl(d.aportado), brl(d.saldoAcumulado)]),
        { colunas: { 1: dir, 2: dir, 3: dir } });
    }

    if (serie.length > 1) {
      tabela('Histórico dos últimos meses', ['Mês', 'Receita', 'Despesa', 'Resultado', 'Caixa no fim'],
        serie.map((s) => [s.rotulo, brl(s.receitas), brl(s.despesas), brl(s.resultado), brl(s.caixaFinal)]),
        { colunas: { 1: dir, 2: dir, 3: dir, 4: dir } });
    }

    if (cmp) {
      tabela(`Comparação com ${labelCompetencia(cmp.a.competencia)}`,
        ['Categoria', labelCompetencia(cmp.a.competencia), labelCompetencia(cmp.b.competencia), 'Diferença'],
        cmp.linhas.slice(0, 18).map((l) => [l.nome, brl(l.anterior), brl(l.atual),
          `${l.delta >= 0 ? '+' : ''}${brl(l.delta)}`]),
        { colunas: { 1: dir, 2: dir, 3: dir } });
    }

    // rodapé em todas as páginas
    const total = doc.internal.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...cinza);
      doc.text(`Painel Financeiro Móvel5 · ${labelCompetencia(a.competencia)} · gerado em ${brDate(new Date().toISOString().slice(0, 10))}`,
        L, doc.internal.pageSize.getHeight() - 22);
      doc.text(`${p}/${total}`, larg - L, doc.internal.pageSize.getHeight() - 22, { align: 'right' });
    }

    doc.save(`movel5-relatorio-${a.competencia}.pdf`);
    avisar('PDF gerado.');
  } catch (e) {
    console.error(e);
    avisar('Não consegui gerar o PDF: ' + e.message, 5000);
  } finally {
    btn.disabled = false; btn.innerHTML = rotulo;
  }
}
