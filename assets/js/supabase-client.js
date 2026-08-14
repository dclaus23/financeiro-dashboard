// ─── Configuração Supabase ────────────────────────────────────────────────────
// ⚠️ Substitua pelos valores do SEU projeto Supabase
// Acesse: https://supabase.com → seu projeto → Settings → API
const SUPABASE_URL  = 'https://shxjmptwahpdqgouvnab.supabase.co';
const SUPABASE_ANON = 'sb_publishable_Dsdqi97NuYz8aASUHA5Mag_895eXWjo';  // Anon key (pública)

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── Helpers de query ─────────────────────────────────────────────────────────
export async function query(tabela, filtros = {}, colunas = '*') {
  let q = sb.from(tabela).select(colunas);
  for (const [col, val] of Object.entries(filtros)) {
    if (val !== null && val !== undefined) q = q.eq(col, val);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function queryPeriodo(tabela, anoMes, colunas = '*') {
  const { data, error } = await sb
    .from(tabela).select(colunas)
    .eq('ano_mes', anoMes);
  if (error) throw error;
  return data || [];
}

export async function queryTodos(tabela, colunas = '*') {
  const { data, error } = await sb.from(tabela).select(colunas).order('ano_mes');
  if (error) throw error;
  return data || [];
}

export async function getPeriodos() {
  const { data, error } = await sb
    .from('arquivos_processados')
    .select('ano_mes, ano, mes')
    .order('ano_mes');
  if (error) throw error;
  return data || [];
}

export async function getPeriodoAnterior(anoMes) {
  // Pega o período imediatamente anterior disponível no banco
  const { data } = await sb
    .from('arquivos_processados')
    .select('ano_mes')
    .lt('ano_mes', anoMes)
    .order('ano_mes', { ascending: false })
    .limit(1);
  return data?.[0]?.ano_mes || null;
}

export async function getMesmoMesAnoPassado(anoMes) {
  // Ex: 2026-08 → 2025-08
  const [ano, mes] = anoMes.split('-');
  const alvo = `${+ano - 1}-${mes}`;
  const { data } = await sb
    .from('arquivos_processados')
    .select('ano_mes')
    .eq('ano_mes', alvo)
    .single();
  return data?.ano_mes || null;
}
