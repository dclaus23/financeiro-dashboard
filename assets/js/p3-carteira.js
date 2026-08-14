import { sb } from './supabase-client.js';
import { fmt, fmtK, num, mesNome, PAL, mkC, kpiHTML, renderTable, doughnutOpts, barOpts } from './utils.js';

let _periodo = null;

export async function render(periodo) {
  _periodo = periodo;
  await _renderAll();
}

async function _renderAll() {
  const el = document.getElementById('p3');
  el.innerHTML = `<div style="padding:40px;text-align:center"><div class="spinner"></div></div>`;

  const [posicao, proventos, aportes] = await Promise.all([
    _queryPosicao(_periodo),
    _queryProventos(_periodo),
    _queryAportes(_periodo),
  ]);

  if (!posicao.length && !aportes.length) {
    el.innerHTML = `
      <div class="center-state">
        <div class="ico">📈</div>
        <h2>Sem dados de carteira</h2>
        <p>Os dados da B3 serão carregados automaticamente quando você copiar o relatório mensal para a pasta OneDrive configurada no ETL.</p>
      </div>`;
    return;
  }

  // Consolidar posição por ticker
  const byTk = {};
  posicao.forEach(r => {
    if (!r.ticker || r.ticker.length > 10) return;
    if (!byTk[r.ticker]) byTk[r.ticker] = { ticker:r.ticker, tipo:r.tipo, qtd:0, valor:0 };
    byTk[r.ticker].qtd   += num(r.quantidade);
    byTk[r.ticker].valor += num(r.valor_atualizado);
  });
  const ativos = Object.values(byTk).filter(r => r.qtd > 0).sort((a,b) => b.valor - a.valor);
  const totalPatr = ativos.reduce((a,r) => a + r.valor, 0);

  // Proventos por ticker
  const provByTk = {};
  proventos.forEach(r => { provByTk[r.ticker] = (provByTk[r.ticker]||0) + num(r.valor_liq); });
  const totalProv = Object.values(provByTk).reduce((a,v) => a+v, 0);

  // Aportes
  const totalAp = aportes.filter(r=>r.operacao==='Compra').reduce((a,r)=>a+num(r.valor_total),0);

  // Alocação por classe
  const byClasse = {};
  ativos.forEach(r => { byClasse[r.tipo||'Outros'] = (byClasse[r.tipo||'Outros']||0) + r.valor; });

  el.innerHTML = `
  <div class="sec">
    <div class="sec-title">Carteira — posição de ${mesNome(_periodo)} ${_periodo?.split('-')[0]}</div>
    <div class="kg">
      ${kpiHTML({ label:'Patrimônio total', valor:totalPatr, acc:'var(--purple)', sub:`${ativos.length} ativos` })}
      ${kpiHTML({ label:'Rend. do mês', valor:totalProv, acc:'var(--gtxt)', badge:{cls:'bg',txt:'Recebido'}, sub:'div + JCP + rendimentos' })}
      ${kpiHTML({ label:'Aportado', valor:totalAp, acc:'var(--navy)', sub:`${aportes.filter(r=>r.operacao==='Compra').length} compras` })}
      ${kpiHTML({ label:'Maior posição', valor:ativos[0]?.valor||0, acc:'var(--navy2)', sub:ativos[0]?.ticker||'—' })}
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
    data: { labels: ativos.map(r=>r.ticker), datasets: [{ data: ativos.map(r=>Math.round(r.valor)), backgroundColor: PAL, borderWidth: 2, borderColor: '#fff' }] },
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
    const p    = totalPatr > 0 ? r.valor/totalPatr*100 : 0;
    const prov = provByTk[r.ticker] || 0;
    const preco = r.qtd > 0 ? r.valor/r.qtd : 0;
    return `<div class="ativo-card">
      <div class="at-tk">${r.ticker}</div>
      <div class="at-cls">${r.tipo||'—'}</div>
      <div class="at-lbl">Patrimônio</div>
      <div class="at-val">${fmt(r.valor)}</div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--t3)">
        <span>Qtd: ${r.qtd}</span>
        <span>R$ ${preco.toFixed(2)}</span>
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
}

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
