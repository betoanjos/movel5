// Entrada do Worker quando o painel é publicado com o wrangler:
// a API vem de api.js e o site estático vem do binding de assets.
import { tratarAPI, ehAPI } from './api.js';

export default {
  async fetch(pedido, env) {
    const url = new URL(pedido.url);
    if (ehAPI(url)) return tratarAPI(pedido, env);
    return env.ASSETS.fetch(pedido);
  },
};
