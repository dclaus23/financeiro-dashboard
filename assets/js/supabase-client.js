// ─── Configuração Supabase ────────────────────────────────────────────────────
// ⚠️ Substitua pelos valores do SEU projeto Supabase
// Acesse: https://supabase.com → seu projeto → Settings → API
export const SUPABASE_URL  = 'https://shxjmptwahpdqgouvnab.supabase.co';
export const SUPABASE_ANON = 'sb_publishable_Dsdqi97NuYz8aASUHA5Mag_895eXWjo';  // Anon key (pública)

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
  // Um mesmo ano_mes pode ter mais de um arquivo processado (ex: financeiro
  // e B3 carregados separadamente) — dedupe para não duplicar o período no filtro.
  const vistos = new Set();
  return (data || []).filter(r => {
    if (vistos.has(r.ano_mes)) return false;
    vistos.add(r.ano_mes);
    return true;
  });
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

// ─── Seleção de período: Ano + Mês ─────────────────────────────────────────────
// Cada página só lista os meses que têm dados nas SUAS tabelas (ex.: Gastos não
// mostra meses que só têm relatório da B3).
const TABELAS_PAGINA = {
  p1: ['gastos', 'salarios', 'cartoes'],
  p2: ['cartoes'],
  p3: ['b3_posicao', 'b3_proventos', 'investimentos'],
};

// Lê a coluna ano_mes inteira de uma tabela, paginando de 1000 em 1000
// (limite padrão do Supabase por requisição).
async function _anoMesDaTabela(tabela) {
  const meses = new Set();
  const PASSO = 1000;
  for (let de = 0; ; de += PASSO) {
    const { data, error } = await sb.from(tabela).select('ano_mes').range(de, de + PASSO - 1);
    if (error) throw error;
    (data || []).forEach(r => r.ano_mes && meses.add(r.ano_mes));
    if (!data || data.length < PASSO) break;
  }
  return meses;
}

// Retorna os 'AAAA-MM' com dados para a página, em ordem crescente.
export async function getMesesDisponiveis(page) {
  const tabelas = TABELAS_PAGINA[page] || TABELAS_PAGINA.p1;
  const sets = await Promise.all(tabelas.map(_anoMesDaTabela));
  const todos = new Set();
  sets.forEach(s => s.forEach(m => todos.add(m)));
  return [...todos].sort();
}

const _MES_CURTO = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const _MES_LONGO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function _mesAnterior(anoMes) {
  const [a, m] = anoMes.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

// Monta o objeto de seleção usado por todas as páginas.
//   ano: 'AAAA'; mes: 'AAAA-MM' ou null (= ano inteiro); disponiveis: lista da página
// Retorna:
//   { modo:'mes'|'ano', ano, meses:[...], ultimo, label, titulo,
//     prev:{ meses, label } | null,   // mês de calendário anterior OU ano anterior (mesmos meses)
//     yago:{ meses, label } | null }  // mesmo mês do ano passado (só no modo mês)
export function montarSelecao(ano, mes, disponiveis) {
  const disp = new Set(disponiveis);
  if (mes) {
    const [a, m] = mes.split('-');
    const pm = _mesAnterior(mes);
    const ym = `${+a - 1}-${m}`;
    return {
      modo: 'mes', ano, meses: [mes], ultimo: mes,
      label: _MES_LONGO[+m - 1],
      titulo: `${_MES_LONGO[+m - 1]} ${a}`,
      prev: disp.has(pm) ? { meses: [pm], label: _MES_LONGO[+pm.split('-')[1] - 1] } : null,
      yago: disp.has(ym) ? { meses: [ym], label: `${_MES_CURTO[+m - 1]}/${+a - 1}` } : null,
    };
  }
  const meses = disponiveis.filter(p => p.startsWith(ano + '-'));
  const nums  = meses.map(p => p.split('-')[1]);
  const prevMeses = nums.map(n => `${+ano - 1}-${n}`).filter(p => disp.has(p));
  const faixa = meses.length
    ? `${_MES_CURTO[+nums[0] - 1]} a ${_MES_CURTO[+nums[nums.length - 1] - 1]}`
    : '';
  return {
    modo: 'ano', ano, meses, ultimo: meses[meses.length - 1] || null,
    label: String(ano),
    titulo: `${ano} · ano inteiro${faixa ? ` (${faixa})` : ''}`,
    prev: prevMeses.length ? { meses: prevMeses, label: String(+ano - 1) } : null,
    yago: null,
  };
}

// Busca todas as linhas de uma consulta, paginando de 1000 em 1000 (limite do
// Supabase por requisição). Uso: selectTodos(() => sb.from('x').select('*').in(...))
export async function selectTodos(montarQuery) {
  const PASSO = 1000;
  let todos = [];
  for (let de = 0; ; de += PASSO) {
    const { data, error } = await montarQuery().range(de, de + PASSO - 1);
    if (error) throw error;
    todos = todos.concat(data || []);
    if (!data || data.length < PASSO) break;
  }
  return todos;
}
