// Gráficos em SVG puro — sem biblioteca externa.
// Especificações seguidas: barras finas (<=24px) com topo arredondado de 4px e
// base reta, linhas de 2px, marcadores de 8px com anel na cor do fundo,
// grade fina e discreta, rótulos diretos só nos extremos e legenda sempre
// presente quando há duas séries ou mais.
import { brl, esc } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const cor = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

/** Escala de valores para uma altura em pixels, com topo em número redondo. */
function escala(valores, altura, { zero = true } = {}) {
  let max = Math.max(...valores, zero ? 0 : -Infinity);
  let min = Math.min(...valores, zero ? 0 : Infinity);
  if (max === min) { max = max || 1; min = Math.min(0, min); }
  const span = max - min || 1;
  const passo = Math.pow(10, Math.floor(Math.log10(span))) / 2;
  max = Math.ceil(max / passo) * passo;
  min = Math.floor(min / passo) * passo;
  const y = (v) => altura - ((v - min) / (max - min)) * altura;
  return { min, max, y, zeroY: y(0) };
}

/** Marcas do eixo Y em números redondos. */
function ticks(min, max, n = 4) {
  const passo = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + passo * i);
}

const curto = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M';
  if (a >= 1000) return (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'k';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};

// ------------------------------------------------------------------ dica ---

let dica;
function mostrarDica(html, ev) {
  if (!dica) { dica = document.createElement('div'); dica.className = 'dica-gfx'; document.body.appendChild(dica); }
  dica.innerHTML = html;
  dica.classList.add('visivel');
  const r = dica.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY - r.height / 2;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  dica.style.left = Math.max(8, x) + 'px';
  dica.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
export function esconderDica() { dica?.classList.remove('visivel'); }

const linhaDica = (rotulo, valor, corSerie) =>
  `<div class="dica-linha"><em>${corSerie ? `<span class="ponto" style="background:${corSerie}"></span>` : ''}${esc(rotulo)}</em><strong>${brl(valor)}</strong></div>`;

// ----------------------------------------------- colunas + linha por mês ---

/**
 * Entradas, saídas e resultado por competência.
 * @param {Array} serie [{rotulo, receitas, despesas, resultado}]
 */
export function graficoMensal(serie, { altura = 230 } = {}) {
  if (!serie.length) return '<p class="mudo mini">Sem dados suficientes para o gráfico.</p>';
  // Um mês só não é uma série temporal: uma comparação direta lê melhor e não
  // deixa o cartão com um gráfico minúsculo perdido no meio do espaço.
  if (serie.length === 1) return comparacaoUnica(serie[0]);

  const M = { t: 22, r: 14, b: 26, l: 52 };
  // Com poucos meses o gráfico não precisa ocupar a largura toda do cartão.
  const largura = Math.max(300, Math.min(980, serie.length * 78 + M.l + M.r));
  const h = altura - M.t - M.b;
  const w = largura - M.l - M.r;

  const todos = serie.flatMap((s) => [s.receitas, -s.despesas, s.resultado]);
  const { min, max, y, zeroY } = escala(todos, h);

  const banda = w / serie.length;
  const larguraBarra = Math.min(22, banda * 0.3);
  const GAP = 2; // respiro na cor do fundo entre as duas colunas

  const c1 = cor('--serie-3'), c2 = cor('--serie-2'), c3 = cor('--serie-1');
  const fundo = cor('--surface-1');

  const barra = (cx, valor, corBarra) => {
    const topo = valor >= 0 ? y(valor) : zeroY;
    const alt = Math.max(1.5, Math.abs(zeroY - y(valor)));
    const r = Math.min(4, alt / 2, larguraBarra / 2);
    // Topo arredondado do lado do valor, base reta na linha do zero.
    const x = cx, yy = topo, wB = larguraBarra, hB = alt;
    const d = valor >= 0
      ? `M${x},${yy + hB} L${x},${yy + r} Q${x},${yy} ${x + r},${yy} L${x + wB - r},${yy} Q${x + wB},${yy} ${x + wB},${yy + r} L${x + wB},${yy + hB} Z`
      : `M${x},${yy} L${x},${yy + hB - r} Q${x},${yy + hB} ${x + r},${yy + hB} L${x + wB - r},${yy + hB} Q${x + wB},${yy + hB} ${x + wB},${yy + hB - r} L${x + wB},${yy} Z`;
    return `<path d="${d}" fill="${corBarra}"/>`;
  };

  let corpo = '';
  // grade
  for (const t of ticks(min, max)) {
    corpo += `<line class="${Math.abs(t) < 1e-9 ? 'base' : 'grade-linha'}" x1="0" x2="${w}" y1="${y(t)}" y2="${y(t)}"/>`;
    corpo += `<text class="eixo" x="-8" y="${y(t) + 4}" text-anchor="end">${curto(t)}</text>`;
  }

  // colunas
  serie.forEach((s, i) => {
    const centro = banda * i + banda / 2;
    corpo += barra(centro - larguraBarra - GAP / 2, s.receitas, c1);
    corpo += barra(centro + GAP / 2, -s.despesas, c2);
    corpo += `<text class="eixo" x="${centro}" y="${h + 17}" text-anchor="middle">${esc(s.rotulo)}</text>`;
  });

  // linha do resultado
  const pontos = serie.map((s, i) => [banda * i + banda / 2, y(s.resultado)]);
  corpo += `<path d="${pontos.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' ')}"
    fill="none" stroke="${c3}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pontos.forEach(([px, py], i) => {
    const ultimo = i === pontos.length - 1;
    corpo += `<circle cx="${px}" cy="${py}" r="${ultimo ? 5 : 4}" fill="${c3}" stroke="${fundo}" stroke-width="2"/>`;
  });
  // rótulo direto só no último ponto
  const ult = serie[serie.length - 1];
  const [ux, uy] = pontos[pontos.length - 1];
  const acima = uy > 26;
  corpo += `<text class="rotulo-valor" x="${ux}" y="${acima ? uy - 13 : uy + 20}" text-anchor="end">${brl(ult.resultado)}</text>`;

  // áreas de hover
  serie.forEach((s, i) => {
    corpo += `<rect x="${banda * i}" y="0" width="${banda}" height="${h}" fill="transparent"
      data-i="${i}" class="alvo-mes" style="cursor:crosshair"/>`;
  });

  // Largura natural com teto: sem isso o SVG estica para preencher o cartão e
  // amplia junto o texto dos rótulos, que fica desproporcional com poucos meses.
  const svg = `<svg class="gfx" viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="xMidYMid meet"
      style="width:100%;max-width:${largura}px;height:auto" role="img"
      aria-label="Entradas, saídas e resultado por mês">
      <g transform="translate(${M.l},${M.t})">${corpo}</g></svg>`;

  return `<div style="overflow-x:auto;display:flex;justify-content:center">${svg}</div>
    <div class="legenda">
      <span><span class="ponto" style="background:${c1}"></span>Entradas</span>
      <span><span class="ponto" style="background:${c2}"></span>Saídas</span>
      <span><span class="ponto" style="background:${c3};border-radius:50%"></span>Resultado</span>
    </div>`;
}

/** Três barras comparando entradas, saídas e resultado de um único mês. */
function comparacaoUnica(s) {
  const c1 = cor('--serie-3'), c2 = cor('--serie-2');
  const corResultado = s.resultado >= 0 ? cor('--positivo') : cor('--negativo');
  const max = Math.max(s.receitas, s.despesas, Math.abs(s.resultado)) || 1;

  const barra = (rotulo, valor, corBarra, nota) => `
    <div style="margin-bottom:14px">
      <div class="linha-flex" style="justify-content:space-between;gap:12px;margin-bottom:5px">
        <span class="mini forte">${esc(rotulo)}</span>
        <span class="num forte" style="font-size:1.05rem">${brl(valor)}</span>
      </div>
      <div class="barra-trilho" style="height:14px">
        <div class="barra-preenche" style="width:${Math.max(1.5, (Math.abs(valor) / max) * 100)}%;background:${corBarra}"></div>
      </div>
      ${nota ? `<div class="mini mudo" style="margin-top:3px">${esc(nota)}</div>` : ''}
    </div>`;

  return `
    <div style="max-width:560px">
      ${barra('Entradas', s.receitas, c1, 'tudo que a empresa recebeu no mês')}
      ${barra('Saídas', s.despesas, c2, 'tudo que a empresa pagou no mês')}
      <div style="height:1px;background:var(--linha);margin:18px 0 14px"></div>
      ${barra('Resultado', s.resultado, corResultado,
        s.resultado >= 0 ? 'o que sobrou' : 'o que faltou para fechar o mês')}
    </div>
    <p class="mini mudo" style="margin:6px 0 0">
      Importe outros meses para acompanhar a evolução mês a mês neste espaço.</p>`;
}

/** Liga o hover do gráfico mensal (chamar depois de inserir no DOM). */
export function ativarGraficoMensal(raiz, serie) {
  const c1 = cor('--serie-3'), c2 = cor('--serie-2'), c3 = cor('--serie-1');
  raiz.querySelectorAll('.alvo-mes').forEach((alvo) => {
    alvo.addEventListener('mousemove', (e) => {
      const s = serie[Number(alvo.dataset.i)];
      mostrarDica(`<b>${esc(s.rotulo)}</b>
        ${linhaDica('Entradas', s.receitas, c1)}
        ${linhaDica('Saídas', -s.despesas, c2)}
        ${linhaDica('Resultado', s.resultado, c3)}`, e);
    });
    alvo.addEventListener('mouseleave', esconderDica);
  });
}

// ------------------------------------------------------ barras horizontais ---

/**
 * Ranking de categorias — a pergunta é "qual é a maior", então uma cor só
 * (magnitude) com o valor rotulado na ponta de cada barra.
 * @param {Array} itens [{nome, total, pct, qtd}]
 */
export function graficoCategorias(itens, { limite = 8, corBarra = '--serie-2' } = {}) {
  if (!itens.length) return '<p class="mudo mini">Nenhuma despesa classificada neste mês.</p>';
  const lista = itens.slice(0, limite);
  const resto = itens.slice(limite);
  if (resto.length) {
    lista.push({
      nome: `Outras ${resto.length} categorias`,
      total: resto.reduce((a, b) => a + b.total, 0),
      pct: resto.reduce((a, b) => a + (b.pct || 0), 0),
      qtd: resto.reduce((a, b) => a + b.qtd, 0),
      resto: true,
    });
  }
  const max = Math.max(...lista.map((i) => i.total)) || 1;
  const c = cor(corBarra);

  return lista.map((i) => `
    <div class="barra-cat" title="${esc(i.nome)}: ${brl(i.total)} em ${i.qtd} lançamento(s)">
      <div class="mini ${i.resto ? 'mudo' : ''}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.nome)}</div>
      <div class="barra-trilho">
        <div class="barra-preenche" style="width:${Math.max(2, (i.total / max) * 100)}%;background:${i.resto ? cor('--linha-forte') : c};opacity:${i.resto ? .6 : 1}"></div>
      </div>
      <div class="mini forte num nowrap">${brl(i.total)}<span class="mudo" style="font-weight:400"> · ${(i.pct || 0).toFixed(0)}%</span></div>
    </div>`).join('');
}

// ------------------------------------------------------------- linha/área ---

/**
 * Evolução de um valor ao longo dos meses (saldo em caixa, conta da holding).
 * @param {Array} serie [{rotulo, valor}]
 */
export function graficoLinha(serie, { altura = 190, corSerie = '--serie-1', rotulo = 'Saldo' } = {}) {
  if (serie.length < 2) return '<p class="mudo mini">São necessários pelo menos dois meses para ver a evolução.</p>';

  const M = { t: 20, r: 46, b: 24, l: 52 };
  const largura = Math.max(300, Math.min(980, serie.length * 66 + M.l + M.r));
  const h = altura - M.t - M.b;
  const w = largura - M.l - M.r;
  const { min, max, y, zeroY } = escala(serie.map((s) => s.valor), h);
  const x = (i) => (serie.length === 1 ? w / 2 : (w / (serie.length - 1)) * i);

  const c = cor(corSerie);
  const fundo = cor('--surface-1');
  const pontos = serie.map((s, i) => [x(i), y(s.valor)]);
  const d = pontos.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' ');

  let corpo = '';
  for (const t of ticks(min, max, 3)) {
    corpo += `<line class="${Math.abs(t) < 1e-9 ? 'base' : 'grade-linha'}" x1="0" x2="${w}" y1="${y(t)}" y2="${y(t)}"/>`;
    corpo += `<text class="eixo" x="-8" y="${y(t) + 4}" text-anchor="end">${curto(t)}</text>`;
  }
  // área a 10% — um véu, nunca um bloco saturado
  corpo += `<path d="${d} L${pontos[pontos.length - 1][0]},${zeroY} L${pontos[0][0]},${zeroY} Z" fill="${c}" opacity=".1"/>`;
  corpo += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

  pontos.forEach(([px, py], i) => {
    corpo += `<circle cx="${px}" cy="${py}" r="4" fill="${c}" stroke="${fundo}" stroke-width="2"/>`;
    if (i % Math.ceil(serie.length / 8) === 0 || i === serie.length - 1) {
      corpo += `<text class="eixo" x="${px}" y="${h + 16}" text-anchor="middle">${esc(serie[i].rotulo)}</text>`;
    }
  });
  const [lx, ly] = pontos[pontos.length - 1];
  corpo += `<text class="rotulo-valor" x="${lx + 8}" y="${ly + 4}">${curto(serie[serie.length - 1].valor)}</text>`;

  serie.forEach((s, i) => {
    const passo = serie.length > 1 ? w / (serie.length - 1) : w;
    corpo += `<rect x="${x(i) - passo / 2}" y="0" width="${passo}" height="${h}" fill="transparent"
      class="alvo-linha" data-i="${i}" style="cursor:crosshair"/>`;
  });

  return `<div style="overflow-x:auto;display:flex;justify-content:center">
    <svg class="gfx" viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="xMidYMid meet"
      style="width:100%;max-width:${largura}px;height:auto" role="img"
      aria-label="${esc(rotulo)} por mês"><g transform="translate(${M.l},${M.t})">${corpo}</g></svg></div>`;
}

export function ativarGraficoLinha(raiz, serie, rotulo = 'Saldo', corSerie = '--serie-1') {
  const c = cor(corSerie);
  raiz.querySelectorAll('.alvo-linha').forEach((alvo) => {
    alvo.addEventListener('mousemove', (e) => {
      const s = serie[Number(alvo.dataset.i)];
      mostrarDica(`<b>${esc(s.rotulo)}</b>${linhaDica(rotulo, s.valor, c)}`, e);
    });
    alvo.addEventListener('mouseleave', esconderDica);
  });
}

/** Mini gráfico de linha embutido numa célula. */
export function faisca(valores, { largura = 90, altura = 24, corSerie = '--serie-1' } = {}) {
  if (valores.length < 2) return '';
  const max = Math.max(...valores), min = Math.min(...valores);
  const span = max - min || 1;
  const pts = valores.map((v, i) => [
    (largura / (valores.length - 1)) * i,
    altura - 2 - ((v - min) / span) * (altura - 4),
  ]);
  return `<svg width="${largura}" height="${altura}" class="gfx" aria-hidden="true">
    <path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"
      fill="none" stroke="${cor(corSerie)}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
