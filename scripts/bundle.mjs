// Empacota o painel inteiro (API + site) num único módulo de Worker.
//
// O caminho normal de publicação é `npx wrangler deploy`, que usa o binding de
// assets da Cloudflare. Este empacotamento existe para publicar direto pela API
// — por exemplo a partir de um agente — quando o envio de assets não está
// disponível: os arquivos de web/ entram comprimidos dentro do próprio script.
//
// Uso:
//   node scripts/bundle.mjs                 pacote completo
//   node scripts/bundle.mjs --sem-vendor    sem as bibliotecas de terceiros,
//                                           que passam a vir do CDN
//   node scripts/bundle.mjs saida.js        escolhe o arquivo de saída

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_WEB = join(RAIZ, 'web');
const argumentos = process.argv.slice(2);
const semVendor = argumentos.includes('--sem-vendor');
const saida = resolve(
  argumentos.find((a) => !a.startsWith('--')) ||
  join(RAIZ, 'dist', semVendor ? 'worker-bundle-cdn.js' : 'worker-bundle.js')
);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Onde cada biblioteca vive no CDN, para o modo --sem-vendor. */
const CDN = {
  '/vendor/pdf.min.mjs': 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs',
  '/vendor/pdf.worker.min.mjs': 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs',
  '/vendor/xlsx.full.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  '/vendor/jspdf.umd.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js',
  '/vendor/jspdf.plugin.autotable.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.3/jspdf.plugin.autotable.min.js',
};

/** Lista recursivamente os arquivos de uma pasta. */
function listar(pasta) {
  const saida = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) saida.push(...listar(caminho));
    else saida.push(caminho);
  }
  return saida;
}

// Um fluxo comprimido só, em vez de um por arquivo: os arquivos se parecem
// muito entre si, então o dicionário compartilhado reduz bastante o tamanho.
const arquivos = {};
let cru = 0;

for (const caminho of listar(PASTA_WEB).sort()) {
  const rel = '/' + relative(PASTA_WEB, caminho).split('\\').join('/');
  if (semVendor && rel.startsWith('/vendor/')) continue;

  const bruto = readFileSync(caminho);
  cru += bruto.length;
  const tipo = TIPOS[extname(caminho).toLowerCase()] || 'application/octet-stream';
  const texto = bruto.toString('utf8');

  // Arquivo binário (ou com bytes inválidos em UTF-8) vai em base64.
  arquivos[rel] = Buffer.from(texto, 'utf8').equals(bruto)
    ? { t: tipo, c: texto }
    : { t: tipo, b: bruto.toString('base64') };
}

const pacote = gzipSync(Buffer.from(JSON.stringify(arquivos), 'utf8'), { level: 9 });

// A API é concatenada em vez de importada: o bundle precisa ser um módulo só.
const api = readFileSync(join(RAIZ, 'worker', 'src', 'api.js'), 'utf8')
  .replace(/^export (const|let|function|async function|class) /gm, '$1 ')
  .replace(/^export \{[^}]*\};?$/gm, '');

const bundle = `// GERADO POR scripts/bundle.mjs — NÃO EDITE À MÃO.
// Painel financeiro da Móvel5: API e site num módulo de Worker só.
// ${Object.keys(arquivos).length} arquivos · ${(cru / 1024).toFixed(0)} kB · pacote de ${(pacote.length / 1024).toFixed(0)} kB${semVendor ? ' · bibliotecas vindas do CDN' : ''}

${api}

// ---------------------------------------------------------- site estático ---

const PACOTE = '${pacote.toString('base64')}';
const CDN = ${JSON.stringify(semVendor ? CDN : {})};

let arquivos = null;

/** Descomprime o pacote uma vez por instância e guarda em memória. */
async function carregarArquivos() {
  if (arquivos) return arquivos;
  const bytes = Uint8Array.from(atob(PACOTE), (c) => c.charCodeAt(0));
  const fluxo = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
  arquivos = JSON.parse(await new Response(fluxo).text());
  return arquivos;
}

async function servirArquivo(caminho, pedido) {
  const arq = (await carregarArquivos())[caminho];
  if (!arq) return null;

  const corpo = arq.b ? Uint8Array.from(atob(arq.b), (c) => c.charCodeAt(0)) : arq.c;
  const etag = '"' + (arq.c ? arq.c.length : arq.b.length).toString(36) + '"';
  if (pedido.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(corpo, {
    headers: {
      'Content-Type': arq.t,
      // Sem cache longo: uma atualização precisa aparecer sem ninguém limpar nada.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Bibliotecas que não vieram no pacote são buscadas no CDN uma vez e guardadas
 * no cache da borda. O navegador continua pedindo sempre o mesmo /vendor/...,
 * então o código do painel é idêntico nos dois modos.
 */
async function servirDoCDN(caminho, pedido, ctx) {
  const origem = CDN[caminho];
  if (!origem) return null;

  const chave = new Request(new URL(pedido.url).origin + caminho);
  const guardado = await caches.default.match(chave);
  if (guardado) return guardado;

  const r = await fetch(origem, { cf: { cacheEverything: true, cacheTtl: 31536000 } });
  if (!r.ok) return new Response('Biblioteca indisponível no momento.', { status: 502 });

  const resposta = new Response(r.body, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  ctx.waitUntil(caches.default.put(chave, resposta.clone()));
  return resposta;
}

export default {
  async fetch(pedido, env, ctx) {
    const url = new URL(pedido.url);
    if (ehAPI(url)) return tratarAPI(pedido, env);

    if (pedido.method !== 'GET' && pedido.method !== 'HEAD') {
      return new Response('Método não permitido', { status: 405 });
    }

    const caminho = decodeURIComponent(url.pathname);
    const doCDN = await servirDoCDN(caminho, pedido, ctx);
    if (doCDN) return doCDN;

    const resposta =
      (await servirArquivo(caminho, pedido)) ||
      (await servirArquivo(caminho.replace(/\\/$/, '') + '/index.html', pedido)) ||
      // Aplicação de página única: qualquer rota desconhecida abre o painel.
      (await servirArquivo('/index.html', pedido));

    return resposta || new Response('Não encontrado', { status: 404 });
  },
};
`;

mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, bundle);

console.log(`${Object.keys(arquivos).length} arquivos${semVendor ? ' (sem vendor)' : ''}`);
console.log(`  crus:     ${(cru / 1024).toFixed(0)} kB`);
console.log(`  pacote:   ${(pacote.length / 1024).toFixed(0)} kB`);
console.log(`  bundle:   ${(bundle.length / 1024).toFixed(0)} kB  ->  ${saida}`);
