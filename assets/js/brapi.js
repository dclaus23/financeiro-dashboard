// ─────────────────────────────────────────────────────────────────────────
// Cotações em tempo real — brapi.dev
// As chamadas passam pela Edge Function `brapi-quote` (Supabase), que guarda
// o token da brapi em segredo no servidor. Veja: supabase/functions/brapi-quote/
// ─────────────────────────────────────────────────────────────────────────
import { SUPABASE_URL, SUPABASE_ANON } from './supabase-client.js';

const FN_URL = `${SUPABASE_URL}/functions/v1/brapi-quote`;
const CACHE_MS = 60_000; // evita repetir a mesma consulta em menos de 1 minuto

// Tipos de ativo (coluna `tipo` de b3_posicao) que têm cotação de mercado.
// Fundo/CDB são renda fixa — não têm ticker cotado em bolsa.
export const TIPOS_COTAVEIS = ['ON', 'BDR', 'Cotas'];

let _cache = { key: '', at: 0, data: null };

/**
 * Busca cotações em tempo real para uma lista de tickers.
 * Retorna um mapa { TICKER: { preco, variacaoPct, variacao, atualizadoEm } }.
 * Tickers não encontrados na brapi simplesmente não aparecem no mapa — quem
 * chama deve usar o valor estático do relatório B3 como fallback.
 *
 * @param {string[]} tickers
 * @param {boolean}  forcar  ignora o cache (usado no botão de atualizar manual)
 */
export async function getQuotesLive(tickers, forcar = false) {
  const lista = [...new Set(tickers.filter(Boolean).map((t) => t.toUpperCase()))];
  if (!lista.length) return {};

  const key = [...lista].sort().join(',');
  if (!forcar && _cache.data && _cache.key === key && Date.now() - _cache.at < CACHE_MS) {
    return _cache.data;
  }

  const url = `${FN_URL}?tickers=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${SUPABASE_ANON}`, apikey: SUPABASE_ANON },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`brapi-quote (${res.status}): ${body || res.statusText}`);
  }

  const payload = await res.json();
  if (payload.error) throw new Error(payload.error);

  const out = {};
  (payload.results || []).forEach((r) => {
    if (r.regularMarketPrice == null) return;
    out[r.symbol] = {
      preco: r.regularMarketPrice,
      variacaoPct: r.regularMarketChangePercent ?? null,
      variacao: r.regularMarketChange ?? null,
      atualizadoEm: r.regularMarketTime || null,
    };
  });

  _cache = { key, at: Date.now(), data: out };
  return out;
}
