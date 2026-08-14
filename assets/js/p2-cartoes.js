import { sb, getPeriodoAnterior, getMesmoMesAnoPassado } from './supabase-client.js';
import { fmt, fmtK, num, mesNome, PAL, mkC, kpiHTML, renderTable, doughnutOpts, barOpts } from './utils.js';

let _periodo = null;
let _filtroCartao = null;

export async function render(periodo) {
  _periodo = periodo;
  _filtroCartao = null;
  await _renderAll();
}

async function _renderAll() {
  const el = document.getElementById('p2');
  el.innerHTML = `<div style="padding:40px;text-align:center"><div class="spinner"></div></div>`;

  const cartoes = await _query(_periodo);
  const prevAnoMes = await getPeriodoAnterior(_periodo);
  const yagoAnoMes = await getMesmoMesAnoPassado(_periodo);
  const cartoesP = prevAnoMes ? await _query(prevAnoMes) : [];
  const cartoesY = yagoAnoMes ? await _query(yagoAnoMes) : [];

  const c = _filtroCartao ? cartoes.filter(r => r.cartao === _filtroCartao) : cartoes;

  const total   = c.reduce((a,r) => a + num(r.valor_parcela), 0);
  const pagos   = c.filter(r => r.pago==='SIM').reduce((a,r) => a + num(r.valor_parcela), 0);
  const aberto  = total - pagos;
  const futura  = c.filter(r => num(r.restam) > 0).reduce((a,r) => a + num(r.valor_parcela)*num(r.restam), 0);
  const prevT   = cartoesP.reduce((a,r) => a + num(r.valor_parcela), 0);
  const yagoT   = cartoesY.reduce((a,r) => a + num(r.valor_parcela), 0);
  const pLabel  = prevAnoMes ? mesNome(prevAnoMes) : '';
  const yLabel  = yagoAnoMes ? mesNome(yagoAnoMes)+'/'+yagoAnoMes?.split('-')[0] : '';

  el.innerHTML = `
  <div class="sec">
    <div class="sec-title">Cartões — ${mesNome(_periodo)} ${_periodo?.split('-')[0]}
      ${_filtroCartao ? `<span style="font-size:11px;font-weight:600;color:var(--navy);margin-left:4px">· ${_filtroCartao.replace(' (David)','').replace(' (Vanessa)','')}</span>
        <button onclick="window._p2Clear()" style="font-size:10px;background:none;border:1px solid var(--brd);border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--t3);margin-left:6px">✕ Limpar</button>` : ''}
    </div>
    <div class="kg">
      ${kpiHTML({ label:'Total faturas', valor:total, acc:'var(--navy)',
        comp:{ cur:total, prev:prevT||null, yago:yagoT||null, prevLabel:pLabel, yagoLabel:yLabel, inverted:true },
        sub:`${c.length} transações` })}
      ${kpiHTML({ label:'Pago', valor:pagos, acc:'var(--gtxt)', badge:{cls:'bg',txt:'✓ Pago'}, sub:`${c.filter(r=>r.pago==='SIM').length} faturas` })}
      ${kpiHTML({ label:'Em aberto', valor:aberto, acc:'var(--red)', badge:aberto>0?{cls:'br',txt:'Pendente'}:null, sub:`${c.filter(r=>r.pago==='NÃO').length} faturas` })}
      ${kpiHTML({ label:'Compromisso futuro', valor:futura, acc:'var(--amber)', badge:{cls:'ba',txt:'Parcelas'}, sub:'total a pagar nas próximas faturas' })}
      ${kpiHTML({ label:'Ticket médio', valor:c.length?total/c.length:0, acc:'var(--navy2)', sub:'por transação' })}
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Por cartão <span style="font-size:10px;color:var(--t3)">(clique para filtrar)</span></div>
    <div class="cg2">
      <div class="cc">
        <h3>Valor por cartão</h3>
        <div class="csub">Parcelas no período</div>
        <div class="ch"><canvas id="chCC2"></canvas></div>
      </div>
      <div class="cc">
        <h3>Status de pagamento</h3>
        <div class="csub">Pago vs. em aberto</div>
        <div class="ch"><canvas id="chSt2"></canvas></div>
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Categorias e comparativos</div>
    <div class="cg2">
      <div class="cc">
        <h3>Por categoria</h3>
        <div class="csub">Distribuição dos gastos no cartão</div>
        <div class="ch"><canvas id="chCatC2"></canvas></div>
      </div>
      ${prevAnoMes || yagoAnoMes ? `
      <div class="cc">
        <h3>Comparativo — faturas</h3>
        <div class="csub">Mês atual vs anterior vs ano passado</div>
        <div class="ch"><canvas id="chComp2"></canvas></div>
      </div>` : '<div></div>'}
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Transações e parcelas</div>
    <div class="tcard">
      <div class="tbar">
        <h3>Compras com cartão</h3>
        <input class="srch" id="srch2" type="text" placeholder="Buscar..." oninput="window._p2Search()">
      </div>
      <div class="tw"><table><thead id="th2"></thead><tbody id="tb2"></tbody></table></div>
    </div>
  </div>`;

  // Gráfico por cartão (barra horizontal, clicável)
  const bc = {};
  cartoes.forEach(r => { bc[r.cartao||'Outros'] = (bc[r.cartao||'Outros']||0) + num(r.valor_parcela); });
  const bcS = Object.entries(bc).sort((a,b) => b[1]-a[1]);
  const nomes = bcS.map(([n]) => n.replace(' (David)','').replace(' (Vanessa)',''));

  mkC('chCC2', {
    type: 'bar',
    data: { labels: nomes, datasets: [{ data: bcS.map(([,v])=>Math.round(v)), backgroundColor: PAL, borderRadius: 6, borderWidth: 0 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      onClick: (e, els) => { if (els.length) { _filtroCartao = bcS[els[0].index][0]; _renderAll(); } },
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c=>' '+fmt(c.raw) } } },
      scales: { x:{ ticks:{callback:v=>fmtK(v),font:{size:10}}, grid:{color:'#f0f0f0'} }, y:{ ticks:{font:{size:10}}, grid:{display:false} } },
    },
  });

  mkC('chSt2', {
    type: 'doughnut',
    data: { labels:['Pago','Em aberto'], datasets:[{ data:[Math.round(pagos),Math.round(aberto)], backgroundColor:['#375623','#C00000'], borderWidth:2, borderColor:'#fff' }] },
    options: doughnutOpts(total),
  });

  const cm = {};
  c.forEach(r => { const k=r.categoria||'Outros'; cm[k]=(cm[k]||0)+num(r.valor_parcela); });
  const cs = Object.entries(cm).sort((a,b)=>b[1]-a[1]).slice(0,8);
  mkC('chCatC2', { type:'doughnut', data:{ labels:cs.map(x=>x[0]), datasets:[{ data:cs.map(x=>Math.round(x[1])), backgroundColor:PAL, borderWidth:2, borderColor:'#fff' }] }, options: doughnutOpts(total) });

  if (prevAnoMes || yagoAnoMes) {
    const labels = [pLabel, mesNome(_periodo), yLabel].filter(Boolean);
    const vals   = [prevT, total, yagoT].filter((_,i) => [prevAnoMes,_periodo,yagoAnoMes][i]);
    mkC('chComp2', { type:'bar',
      data:{ labels, datasets:[{ data:vals.map(Math.round), backgroundColor:['#9DC3E6','#002060','#C9211E'].slice(0,vals.length), borderRadius:6, borderWidth:0 }] },
      options: barOpts() });
  }

  window._p2Clear  = () => { _filtroCartao = null; _renderAll(); };
  window._cartoes  = c;
  window._p2Search = () => {
    const s = document.getElementById('srch2')?.value?.toLowerCase() || '';
    const rows = s ? c.filter(r => Object.values(r).some(v=>v&&String(v).toLowerCase().includes(s))) : c;
    renderTable('th2','tb2',['ano_mes','categoria','descricao','cartao','valor_parcela','parcela_atual','total_parcelas','restam','pago','responsavel'], rows);
  };
  window._p2Search();
}

async function _query(anoMes) {
  if (!anoMes) return [];
  const { data, error } = await sb.from('cartoes').select('*').eq('ano_mes', anoMes).order('cartao').order('categoria');
  if (error) throw error;
  return data || [];
}
