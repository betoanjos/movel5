// Painel do mês: a resposta curta para "a empresa deu dinheiro?" e o
// detalhamento que sustenta essa resposta.
import { estado } from '../store.js';
import { apurar, serieHistorica } from '../engine/relatorio.js';
import { brl, labelCompetencia, esc, prevCompetencia } from '../lib/util.js';
import { icone, bloco, vazio } from '../lib/ui.js';
import { graficoMensal, ativarGraficoMensal, graficoCategorias, graficoLinha, ativarGraficoLinha } from '../lib/graficos.js';

export function telaPainel(raiz) {
  const comp = estado.competencia;
  const dados = {
    lancamentos: estado.lancamentos, contas: estado.contas,
    fechamentos: estado.fechamentos, vendas: estado.vendas, compras: estado.compras,
    categorias: estado.categorias,
  };

  if (!estado.lancamentos.length) {
    raiz.innerHTML = `<div class="cartao">${vazio(
      'Ainda não há nada para mostrar',
      'Comece enviando os extratos e relatórios do mês. O painel lê OFX, PDF do Sicoob, planilhas da Vindi e do Mercado Pago e os relatórios do Bling.',
      '<a class="btn btn-principal" href="#/importar" style="margin-top:6px">Importar arquivos</a>'
    )}</div>`;
    return;
  }

  const a = apurar(comp, dados);
  const serie = serieHistorica(dados, { ate: comp, meses: 12 });
  const anterior = serie.length > 1 ? serie[serie.length - 2] : null;
  const lucro = a.resultado.resultadoOperacional;

  raiz.innerHTML = `
  <div class="pilha">
    ${a.alertas.length ? `<div class="pilha" style="gap:8px">${a.alertas.map(cartaoAlerta).join('')}</div>` : ''}

    ${heroi(a, lucro, anterior)}

    <div class="grade g4">
      ${kpi('Entradas no mês', a.caixa.entradas, 'pos', `${a.contagem.lancamentos} lançamentos no total`)}
      ${kpi('Saídas no mês', a.caixa.saidas, 'neg', 'tudo que saiu das contas')}
      ${kpi('Saldo em caixa hoje', a.caixa.final, a.caixa.final >= 0 ? 'pos' : 'neg',
            `abertura do mês: ${brl(a.caixa.inicial)}`)}
      ${cartaoHolding(a.holding)}
    </div>

    <div class="cartao">
      <div class="cartao-cabeca">
        <h2>Entradas, saídas e resultado</h2>
        <span class="mini mudo">últimos ${serie.length} ${serie.length === 1 ? 'mês' : 'meses'}</span>
      </div>
      <div class="cartao-corpo" id="gfx-mensal">${graficoMensal(serie)}</div>
    </div>

    <div class="grade g-2-1">
      <div class="cartao">
        <div class="cartao-cabeca"><h2>Para onde foi o dinheiro</h2>
          <span class="mini mudo">${brl(a.resultado.despesas)} em despesas</span></div>
        <div class="cartao-corpo">${graficoCategorias(a.despesasPorCategoria)}</div>
      </div>
      <div class="cartao">
        <div class="cartao-cabeca"><h2>De onde veio</h2></div>
        <div class="cartao-corpo">${graficoCategorias(a.receitasPorCategoria, { limite: 5, corBarra: '--serie-3' })}</div>
      </div>
    </div>

    <div class="grade g-2-1">
      ${cartaoContas(a)}
      ${cartaoPonte(a)}
    </div>

    <div class="grade g2">
      ${cartaoFaturamento(a)}
      <div class="cartao">
        <div class="cartao-cabeca"><h2>Saldo em caixa mês a mês</h2></div>
        <div class="cartao-corpo" id="gfx-caixa">
          ${graficoLinha(serie.map((s) => ({ rotulo: s.rotulo, valor: s.caixaFinal })), { rotulo: 'Saldo em caixa' })}
        </div>
      </div>
    </div>
  </div>`;

  ativarGraficoMensal(raiz.querySelector('#gfx-mensal'), serie);
  ativarGraficoLinha(raiz.querySelector('#gfx-caixa'),
    serie.map((s) => ({ rotulo: s.rotulo, valor: s.caixaFinal })), 'Saldo em caixa');
}

// ---------------------------------------------------------------- pedaços ---

function heroi(a, lucro, anterior) {
  const positivo = lucro >= 0;
  const delta = anterior ? lucro - anterior.resultado : null;
  const pendencia = a.contagem.pendentes;

  return `
  <div class="cartao">
    <div class="grade g-2-1" style="gap:0">
      <div class="kpi kpi-heroi" style="padding:26px 24px">
        <div class="kpi-rotulo">A empresa deu dinheiro em ${esc(labelCompetencia(a.competencia))}?</div>
        <div class="kpi-valor ${positivo ? 'pos' : 'neg'}">${brl(lucro)}</div>
        <div class="kpi-nota">
          ${positivo
            ? `Sim — sobrou ${brl(lucro)} depois de pagar tudo que é da empresa.`
            : `Não — faltou ${brl(Math.abs(lucro))} para cobrir as despesas da empresa.`}
          Margem de ${a.resultado.margem.toFixed(1)}% sobre ${brl(a.resultado.receitas)} de receita.
        </div>
        <div class="linha-flex" style="margin-top:12px">
          ${delta != null ? `<span class="selo ${delta >= 0 ? 'selo-pos' : 'selo-neg'}">
            ${delta >= 0 ? '▲' : '▼'} ${brl(Math.abs(delta))} vs. ${esc(labelCompetencia(prevCompetencia(a.competencia)))}</span>` : ''}
          ${pendencia
            ? `<a href="#/revisar" class="selo selo-alerta" style="text-decoration:none">
                ${pendencia} lançamento(s) a revisar — o número ainda vai mudar</a>`
            : '<span class="selo selo-pos">Tudo classificado</span>'}
        </div>
      </div>
      <div style="border-left:1px solid var(--linha);padding:22px 24px;display:flex;flex-direction:column;gap:14px;justify-content:center">
        ${miniLinha('Receita do mês', a.resultado.receitas, 'pos')}
        ${miniLinha('Despesa do mês', -a.resultado.despesas, 'neg')}
        <div style="height:1px;background:var(--linha)"></div>
        ${miniLinha('Resultado', a.resultado.resultadoOperacional, lucro >= 0 ? 'pos' : 'neg', true)}
      </div>
    </div>
  </div>`;
}

const miniLinha = (rotulo, valor, classe, forte = false) => `
  <div class="linha-flex" style="justify-content:space-between;gap:16px">
    <span class="${forte ? 'forte' : 'secundario'} mini">${esc(rotulo)}</span>
    <span class="num ${classe} ${forte ? 'forte' : ''}" style="font-size:${forte ? '1.05rem' : '.95rem'}">${brl(valor)}</span>
  </div>`;

const kpi = (rotulo, valor, classe, nota) => `
  <div class="cartao kpi">
    <div class="kpi-rotulo">${esc(rotulo)}</div>
    <div class="kpi-valor ${classe}">${brl(valor)}</div>
    <div class="kpi-nota">${esc(nota)}</div>
  </div>`;

function cartaoHolding(h) {
  const temSaldo = Math.abs(h.saldoAcumulado) >= 0.01;
  // Os maiores destinos aparecem aqui para ele saber, de relance, de quem é a conta.
  const destaques = h.porDestino.filter((d) => Math.abs(d.saldoAcumulado) >= 0.01).slice(0, 4);
  return `
  <div class="cartao kpi" style="border-color:${temSaldo ? 'color-mix(in srgb, var(--holding) 35%, var(--linha))' : 'var(--linha)'}">
    <div class="kpi-rotulo">${icone('holding', 14)} Conta com a holding</div>
    <div class="kpi-valor" style="color:var(--holding)">${brl(Math.abs(h.saldoAcumulado))}</div>
    <div class="kpi-nota">${esc(h.interpretacao)}</div>
    ${destaques.length ? `<div style="margin-top:8px;display:grid;gap:2px">
      ${destaques.map((d) => `<div class="linha-flex" style="justify-content:space-between;gap:10px">
        <span class="mini secundario">${esc(d.destino)}</span>
        <span class="mini num">${brl(d.saldoAcumulado)}</span></div>`).join('')}
      ${h.porDestino.length > destaques.length
        ? `<div class="mini mudo">+ ${h.porDestino.length - destaques.length} destino(s)</div>` : ''}
    </div>` : ''}
  </div>`;
}

function cartaoAlerta(a) {
  const tipo = { erro: 'erro', atencao: 'atencao', info: 'info' }[a.nivel] || 'info';
  const link = { revisar: '#/revisar', importar: '#/importar', conciliar: '#/fechamento' }[a.acao];
  const botao = link ? `<a class="btn btn-pequeno" href="${link}">Resolver</a>` : '';
  return bloco(tipo, esc(a.texto), botao);
}

function cartaoContas(a) {
  return `
  <div class="cartao">
    <div class="cartao-cabeca"><h2>Onde está o dinheiro</h2>
      <span class="mini mudo">saldo por conta no fim de ${esc(labelCompetencia(a.competencia))}</span></div>
    <div class="cartao-corpo cartao-corpo-liso tabela-rolagem">
      <table class="tabela">
        <thead><tr><th>Conta</th><th class="num">Abertura</th><th class="num">Entradas</th>
          <th class="num">Saídas</th><th class="num">Saldo final</th></tr></thead>
        <tbody>
          ${a.porConta.filter((c) => c.entraNoCaixa).map((c) => `
            <tr>
              <td><span class="linha-flex" style="gap:8px">
                <span class="ponto" style="background:${esc(c.cor || 'var(--ink-3)')}"></span>
                <span>${esc(c.nome)}</span>
                ${c.diferenca != null && Math.abs(c.diferenca) >= 0.01
                  ? `<span class="selo selo-neg" title="Saldo informado do banco: ${brl(c.saldoBanco)}">difere ${brl(c.diferenca)}</span>`
                  : c.saldoBanco != null ? '<span class="selo selo-pos">confere</span>' : ''}
              </span></td>
              <td class="num mudo">${brl(c.inicial)}</td>
              <td class="num pos">${c.entradas ? brl(c.entradas) : '—'}</td>
              <td class="num neg">${c.saidas ? brl(c.saidas) : '—'}</td>
              <td class="num forte">${brl(c.final)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr style="border-top:2px solid var(--linha-forte)">
          <td class="forte">Total em caixa</td>
          <td class="num mudo">${brl(a.caixa.inicial)}</td>
          <td class="num pos">${brl(a.caixa.entradas)}</td>
          <td class="num neg">${brl(a.caixa.saidas)}</td>
          <td class="num forte">${brl(a.caixa.final)}</td>
        </tr>
        ${a.caixa.aplicado > 0.005 ? `<tr>
          <td colspan="5" class="mini mudo" style="padding-top:6px">
            Desse saldo, <strong class="num">${brl(a.caixa.aplicado)}</strong> estão no RDC automático —
            continuam disponíveis, só rendendo.</td>
        </tr>` : ''}
        ${a.transito.contas.length ? `
          <tr><td colspan="5" style="padding-top:14px" class="micro">Contas de passagem — não entram no caixa</td></tr>
          ${a.transito.contas.map((c) => `<tr>
            <td class="mudo"><span class="linha-flex" style="gap:8px">
              <span class="ponto" style="background:${esc(c.cor || 'var(--ink-3)')};opacity:.5"></span>
              <span>${esc(c.nome)}</span></span></td>
            <td class="num mudo">${brl(c.inicial)}</td>
            <td class="num mudo">${c.entradas ? brl(c.entradas) : '—'}</td>
            <td class="num mudo">${c.saidas ? brl(c.saidas) : '—'}</td>
            <td class="num mudo">${brl(c.final)}</td></tr>`).join('')}` : ''}
        </tfoot>
      </table>
    </div>
    ${a.transito.contas.length ? `<div class="cartao-corpo" style="border-top:1px solid var(--linha);padding-top:14px">
      <p class="mini mudo" style="margin:0">
        Gateways e marketplaces contam como passagem: o dinheiro vira receita quando cai no banco.
        Dá para mudar isso conta a conta em Ajustes.</p></div>` : ''}
  </div>`;
}

function cartaoPonte(a) {
  return `
  <div class="cartao">
    <div class="cartao-cabeca"><h2>Do lucro ao caixa</h2></div>
    <div class="cartao-corpo">
      <p class="mini secundario" style="margin-bottom:14px">
        Lucro e dinheiro na conta são coisas diferentes. Esta lista mostra, item por item,
        o que separa um do outro neste mês.
      </p>
      ${a.ponte.map((p) => `
        <div class="linha-flex" style="justify-content:space-between;gap:12px;padding:6px 0;
          ${p.total ? 'border-top:1px solid var(--linha-forte);margin-top:6px;padding-top:10px;font-weight:650' : ''}">
          <span class="mini ${p.destaque || p.total ? 'forte' : 'secundario'}">${esc(p.rotulo)}
            ${p.qtd ? `<span class="mudo">· ${p.qtd}</span>` : ''}
            ${p.alerta ? '<span class="selo selo-alerta" style="margin-left:6px">revisar</span>' : ''}</span>
          <span class="num mini ${p.valor >= 0 ? 'pos' : 'neg'}" style="font-weight:600">${brl(p.valor)}</span>
        </div>`).join('')}
      ${Math.abs(a.residuo) >= 0.01
        ? bloco('erro', `Sobrou uma diferença de <strong>${brl(a.residuo)}</strong> que as linhas acima não explicam.`)
        : `<p class="mini mudo" style="margin-top:12px">
             Fecha exatamente com a variação de caixa de ${brl(a.caixa.variacao)}.</p>`}
    </div>
  </div>`;
}

function cartaoFaturamento(a) {
  const f = a.faturamento;
  if (!f.qtd) {
    return `<div class="cartao"><div class="cartao-cabeca"><h2>Vendas do Bling</h2></div>
      <div class="cartao-corpo"><p class="mini mudo">
        Importe o relatório de pedidos do Bling para comparar o que foi vendido com o que entrou no caixa.</p></div></div>`;
  }
  const diff = f.diferenca;
  return `
  <div class="cartao">
    <div class="cartao-cabeca"><h2>Vendido × recebido</h2>
      <span class="mini mudo">${f.qtd} pedidos</span></div>
    <div class="cartao-corpo">
      <div class="grade g2" style="gap:12px;margin-bottom:14px">
        <div>
          <div class="micro" title="Soma do campo Total dos pedidos com data neste mês, tirando os cancelados. Não é valor de nota fiscal.">Pedidos de venda no Bling</div>
          <div class="num forte" style="font-size:1.2rem">${brl(f.total)}</div>
          <div class="mini mudo">${f.qtd} pedido(s), pela data do pedido</div>
        </div>
        <div>
          <div class="micro">Entrou no caixa</div>
          <div class="num forte" style="font-size:1.2rem">${brl(f.recebidoNoCaixa)}</div>
          <div class="mini mudo">receita reconhecida no mês</div>
        </div>
      </div>
      ${f.cancelados ? `<p class="mini" style="margin:-6px 0 12px">
        <span class="selo selo-alerta">cancelados</span>
        <strong class="num neg">${brl(f.cancelados)}</strong>
        <span class="mudo">em pedidos cancelados no mês — fora da conta acima</span></p>` : ''}
      <p class="mini secundario">
        ${Math.abs(diff) < 1
          ? 'O que foi vendido no mês bate com o que entrou.'
          : diff < 0
            ? `Entrou ${brl(Math.abs(diff))} a menos do que foi vendido — normal quando há venda parcelada no cartão, que só cai nos meses seguintes.`
            : `Entrou ${brl(diff)} a mais do que foi vendido no mês — em geral são parcelas de vendas antigas caindo agora.`}
        Ticket médio de ${brl(f.ticketMedio)}.
      </p>
      ${f.canais.length > 1 ? `
        <div style="margin-top:14px">
          <div class="micro" style="margin-bottom:6px">Por canal</div>
          ${graficoCategorias(f.canais.map((c) => ({
            nome: c.nome, total: c.total, qtd: c.qtd,
            pct: f.total ? (c.total / f.total) * 100 : 0,
          })), { limite: 5, corBarra: '--serie-1' })}
        </div>` : ''}
    </div>
  </div>`;
}
