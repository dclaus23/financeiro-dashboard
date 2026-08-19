import { sb } from './supabase-client.js';
import { fmt, fmtK, num, mesNome, PAL, mkC, kpiHTML, renderTable, doughnutOpts, barOpts } from './utils.js';
import { getQuotesLive, TIPOS_COTAVEIS } from './brapi.js';

let _periodo = null;
let _renderId = 0;      // evita que uma resposta atrasada da brapi pinte uma tela antiga
let _refreshTimer = null;

export async function render(periodo) {
  _periodo = periodo;
  await _renderAll();
}

async function _renderAll() {
  const meuRenderId = ++_renderId;
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }

  const el = document.getElementById('p3');
  el.innerHTML = `<div style="padding:40px;text-align:center"><div class="spinner"></div></div>`;

  const [posicao, proventos, aportes] = await Promise.all([
    _queryPosicao(_periodo),
    _queryProventos(_periodo),
    _queryAportes(_periodo),
  ]);
  if (meuRenderId !== _renderId) return; // já navegou pra outro período/página

  if (!posicao.length && !aportes.length) {
    el.innerHTML = `
      <div class="center-state">
        <div class="ico">📈</div>
        <h2>Sem dados de carteira</h2>
        <p>Os dados da B3 serão carregados automaticamente quando você copiar o relatório mensal para a pasta OneDrive configurada no ETL.</p>
      </div>`;
    return;
  }

  // Consolidar posição por ticker (valores estáticos do relatório B3)
  const byTk = {};
  posicao.forEach(r => {
    if (!r.ticker || r.ticker.length > 10) return;
    if (!byTk[r.ticker]) byTk[r.ticker] = { ticker:r.ticker, tipo:r.tipo, qtd:0, valor:0 };
    byTk[r.ticker].qtd   += num(r.quantidade);
    byTk[r.ticker].valor += num(r.valor_atualizado);
  });
  const ativosBase = Object.values(byTk).filter(r => r.qtd > 0);

  // Proventos por ticker
  const provByTk = {};
  proventos.forEach(r => { provByTk[r.ticker] = (provByTk[r.ticker]||0) + num(r.valor_liq); });

  // Aportes
  const totalAp = aportes.filter(r=>r.operacao==='Compra').reduce((a,r)=>a+num(r.valor_total),0);

  // 1ª pintura: valores estáticos do relatório B3 (imediata, não espera a brapi)
  const ativosEstaticos = _semCotacao(ativosBase);
  _pintar(el, ativosEstaticos, provByTk, totalAp, aportes, proventos, 'estatico');

  // 2ª etapa: busca cotações em tempo real (ações, BDRs e FIIs) em segundo plano
  const tickersCotaveis = ativosBase.filter(r => TIPOS_COTAVEIS.includes(r.tipo)).map(r => r.ticker);

  // Liga o botão de atualizar manual a este conjunto de dados/período
  window._p3RefreshCotacoes = tickersCotaveis.length
    ? () => _atualizarCotacoes(el, ativosBase, provByTk, totalAp, aportes, proventos, meuRenderId, tickersCotaveis, true)
    : null;

  if (!tickersCotaveis.length) return;

  await _atualizarCotacoes(el, ativosBase, provByTk, totalAp, aportes, proventos, meuRenderId, tickersCotaveis);

  // Atualização automática a cada 60s enquanto a página Carteira estiver visível
  _refreshTimer = setInterval(() => {
    if (meuRenderId !== _renderId) { clearInterval(_refreshTimer); return; }
    if (document.getElementById('p3')?.style.display === 'none') return; // fora da página, pula
    _atualizarCotacoes(el, ativosBase, provByTk, totalAp, aportes, proventos, meuRenderId, tickersCotaveis);
  }, 60_000);
}

function _semCotacao(ativosBase) {
  return ativosBase
    .map(r => ({ ...r, valorLive:r.valor, precoAtual:null, variacaoPct:null, live:false }))
    .sort((a,b) => b.valorLive - a.valorLive);
}

async function _atualizarCotacoes(el, ativosBase, provByTk, totalAp, aportes, proventos, meuRenderId, tickers, forcar=false) {
  _setLiveBadge('carregando');
  try {
    const quotes = await getQuotesLive(tickers, forcar);
    if (meuRenderId !== _renderId) return;

    const ativos = ativosBase.map(r => {
      const q = quotes[r.ticker];
      if (!q) return { ...r, valorLive:r.valor, precoAtual:null, variacaoPct:null, live:false };
      return { ...r, valorLive:r.qtd*q.preco, precoAtual:q.preco, variacaoPct:q.variacaoPct, live:true };
    }).sort((a,b) => b.valorLive - a.valorLive);

    const algumaAoVivo = ativos.some(r => r.live);
    _pintar(el, ativos, provByTk, totalAp, aportes, proventos, algumaAoVivo ? 'ao-vivo' : 'indisponivel');
  } catch (err) {
    console.error('Cotações brapi indisponíveis:', err);
    if (meuRenderId !== _renderId) return;
    _setLiveBadge('erro');
  }
}

// ─── Pintura da página (usada tanto na 1ª carga quanto nas atualizações) ──────
function _pintar(el, ativos, provByTk, totalAp, aportes, proventos, status) {
  const totalPatr = ativos.reduce((a,r) => a + r.valorLive, 0);
  const totalProv = Object.values(provByTk).reduce((a,v) => a+v, 0);

  // Alocação por classe
  const byClasse = {};
  ativos.forEach(r => { byClasse[r.tipo||'Outros'] = (byClasse[r.tipo||'Outros']||0) + r.valorLive; });

  el.innerHTML = `
  <div class="sec">
    <div class="sec-title">
      Carteira — posição de ${mesNome(_periodo)} ${_periodo?.split('-')[0]}
      <span id="liveBadge" class="live-badge"><span class="live-dot"></span> …</span>
      <button id="btnRefreshCot" class="refresh-btn" title="Atualizar cotações agora">⟳</button>
    </div>
    <div class="kg">
      ${kpiHTML({ label:'Patrimônio total', valor:totalPatr, acc:'var(--purple)', sub:`${ativos.length} ativos` })}
      ${kpiHTML({ label:'Rend. do mês', valor:totalProv, acc:'var(--gtxt)', badge:{cls:'bg',txt:'Recebido'}, sub:'div + JCP + rendimentos' })}
      ${kpiHTML({ label:'Aportado', valor:totalAp, acc:'var(--navy)', sub:`${aportes.filter(r=>r.operacao==='Compra').length} compras` })}
      ${kpiHTML({ label:'Maior posição', valor:ativos[0]?.valorLive||0, acc:'var(--navy2)', sub:ativos[0]?.ticker||'—' })}
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Alocação da carteira</div>
    <div class="cg2">
      <div class="cc">
        <h3>Por ativo</h3>
        <div class="csub">% do patrimônio total</div>
        <div class="ch lg"><canvas id="chPat3"></canvas></div>
      </div>
      <div class="cc" style="display:flex;flex-direction:column;justify-content:center;gap:10px" id="allocBars"></div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Posição detalhada por ativo</div>
    <div class="ativos-grid" id="ativosGrid"></div>
  </div>

  ${proventos.length ? `
  <div class="sec">
    <div class="sec-title">Proventos recebidos no período</div>
    <div class="tcard">
      <div class="tbar"><h3>Dividendos, JCP e Rendimentos</h3></div>
      <div class="tw"><table><thead id="thProv"></thead><tbody id="tbProv"></tbody></table></div>
    </div>
  </div>` : ''}

  ${aportes.length ? `
  <div class="sec">
    <div class="sec-title">Aportes do período</div>
    <div class="tcard">
      <div class="tbar">
        <h3>Compras, vendas e operações</h3>
        <input class="srch" id="srch3" type="text" placeholder="Buscar..." oninput="window._p3Search()">
      </div>
      <div class="tw"><table><thead id="th3"></thead><tbody id="tb3"></tbody></table></div>
    </div>
  </div>` : ''}`;

  // Gráfico pizza por ativo
  mkC('chPat3', {
    type: 'doughnut',
    data: { labels: ativos.map(r=>r.ticker), datasets: [{ data: ativos.map(r=>Math.round(r.valorLive)), backgroundColor: PAL, borderWidth: 2, borderColor: '#fff' }] },
    options: doughnutOpts(totalPatr),
  });

  // Barras de alocação por classe
  const allocEl = document.getElementById('allocBars');
  allocEl.innerHTML = Object.entries(byClasse).sort((a,b)=>b[1]-a[1]).map(([k,v]) => {
    const p = totalPatr > 0 ? v/totalPatr*100 : 0;
    return `<div>
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <span style="font-size:12px;font-weight:700">${k}</span>
        <span style="font-size:12px;font-weight:700;color:var(--purple)">${fmt(v)} <span style="color:var(--t3)">(${p.toFixed(1)}%)</span></span>
      </div>
      <div style="background:var(--brd);height:5px;border-radius:3px">
        <div style="width:${Math.min(p,100).toFixed(1)}%;background:var(--purple);height:5px;border-radius:3px"></div>
      </div>
    </div>`;
  }).join('');

  // Cards de ativos
  document.getElementById('ativosGrid').innerHTML = ativos.map(r => {
    const p        = totalPatr > 0 ? r.valorLive/totalPatr*100 : 0;
    const prov     = provByTk[r.ticker] || 0;
    const precoRef = r.live ? r.precoAtual : (r.qtd > 0 ? r.valor/r.qtd : 0);
    const chg      = r.variacaoPct;
    const chgHtml  = r.live && chg != null
      ? `<span class="at-chg ${chg>=0?'up':'down'}">${chg>=0?'▲':'▼'}${Math.abs(chg).toFixed(2)}%</span>`
      : '';
    return `<div class="ativo-card">
      <div class="at-tk">${r.ticker}${r.live ? '<span class="live-dot-sm" title="Cotação ao vivo"></span>' : ''}</div>
      <div class="at-cls">${r.tipo||'—'}</div>
      <div class="at-lbl">Patrimônio</div>
      <div class="at-val">${fmt(r.valorLive)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:10px;color:var(--t3)">
        <span>Qtd: ${r.qtd}</span>
        <span>R$ ${precoRef.toFixed(2)} ${chgHtml}</span>
      </div>
      <div class="at-bar"><div class="at-bar-f" style="width:${Math.min(p,100).toFixed(1)}%"></div></div>
      <div style="font-size:10px;color:var(--t3);margin-top:2px">${p.toFixed(1)}% da carteira</div>
      ${prov > 0 ? `<div style="font-size:11px;color:var(--gtxt);font-weight:700;margin-top:6px">Rend: ${fmt(prov)}</div>` : ''}
    </div>`;
  }).join('');

  // Tabela proventos
  if (proventos.length) {
    renderTable('thProv','tbProv',['ticker','data_pgto','tipo_evento','quantidade','preco_unit','valor_liq'], proventos);
  }

  // Tabela aportes
  if (aportes.length) {
    window._p3Search = () => {
      const s = document.getElementById('srch3')?.value?.toLowerCase() || '';
      const rows = s ? aportes.filter(r=>Object.values(r).some(v=>v&&String(v).toLowerCase().includes(s))) : aportes;
      renderTable('th3','tb3',['ano_mes','classe_ativo','ticker','operacao','qtd_cotas','preco_unit','valor_total','corretora','responsavel'], rows);
    };
    window._p3Search();
  }

  // Botão de atualizar cotações manualmente
  document.getElementById('btnRefreshCot')?.addEventListener('click', (e) => {
    e.currentTarget.classList.add('spin');
    window._p3RefreshCotacoes?.();
    setTimeout(() => e.currentTarget?.classList.remove('spin'), 600);
  });

  _setLiveBadge(status);
}

// Exposto para o botão de atualizar manual (definido a cada _renderAll com o
// conjunto correto de tickers/período em escopo)
window._p3RefreshCotacoes = null;

// ─── Badge de status das cotações ─────────────────────────────────────────────
function _setLiveBadge(status) {
  const b = document.getElementById('liveBadge');
  if (!b) return;
  const hora = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  const MAP = {
    estatico:     { cls:'live-off',  txt:'posição do relatório B3' },
    carregando:   { cls:'live-load', txt:'atualizando cotações...' },
    'ao-vivo':    { cls:'live-on',   txt:`cotações ao vivo · ${hora}` },
    indisponivel: { cls:'live-warn', txt:'sem cotação p/ estes ativos' },
    erro:         { cls:'live-warn', txt:'falha ao buscar cotações — mostrando relatório B3' },
  };
  const s = MAP[status] || MAP.estatico;
  b.className = `live-badge ${s.cls}`;
  b.innerHTML = `<span class="live-dot"></span> ${s.txt}`;
}

// ─── Queries Supabase ──────────────────────────────────────────────────────────
async function _queryPosicao(anoMes) {
  if (!anoMes) return [];
  const { data, error } = await sb.from('b3_posicao').select('*').eq('ano_mes', anoMes);
  if (error) throw error;
  return data || [];
}
async function _queryProventos(anoMes) {
  if (!anoMes) return [];
  const { data, error } = await sb.from('b3_proventos').select('*').eq('ano_mes', anoMes).order('valor_liq', {ascending:false});
  if (error) throw error;
  return data || [];
}
async function _queryAportes(anoMes) {
  if (!anoMes) return [];
  const { data, error } = await sb.from('investimentos').select('*').eq('ano_mes', anoMes);
  if (error) throw error;
  return data || [];
}
