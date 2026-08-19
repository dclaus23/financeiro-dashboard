import { sb, getPeriodoAnterior, getMesmoMesAnoPassado } from './supabase-client.js';
import { fmt, fmtK, num, mesNome, PAL, mkC, kpiHTML, renderTable, doughnutOpts, barOpts, catIcon } from './utils.js';

const COR_COMPARATIVO = '#002060'; // azul marinho único, pedido para o gráfico de comparativo
const COR_PAGO         = '#375623';
const COR_PROJETADO    = '#E0A100';
const N_MESES_PROJECAO = 4;

let _periodo = null;
let _filtroCartao = null;
let _sortCol = null;
let _sortDir = 'asc';
let _cartoesAtual = [];

export async function render(periodo) {
  _periodo = periodo;
  _filtroCartao = null;
  _sortCol = null;
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

  const c  = _filtroCartao ? cartoes.filter(r => r.cartao === _filtroCartao) : cartoes;
  const cP = _filtroCartao ? cartoesP.filter(r => r.cartao === _filtroCartao) : cartoesP;
  _cartoesAtual = c;

  const total   = c.reduce((a,r) => a + num(r.valor_parcela), 0);
  const pagos   = c.filter(r => r.pago==='SIM').reduce((a,r) => a + num(r.valor_parcela), 0);
  const aberto  = total - pagos;
  const futura  = c.filter(r => num(r.restam) > 0).reduce((a,r) => a + num(r.valor_parcela)*num(r.restam), 0);
  const prevT   = cartoesP.reduce((a,r) => a + num(r.valor_parcela), 0);
  const yagoT   = cartoesY.reduce((a,r) => a + num(r.valor_parcela), 0);
  const pLabel  = prevAnoMes ? mesNome(prevAnoMes) : '';
  const yLabel  = yagoAnoMes ? mesNome(yagoAnoMes)+'/'+yagoAnoMes?.split('-')[0] : '';

  // ── Projeção de gastos futuros (parcelas que ainda vão aparecer nas próximas faturas) ──
  const projecoes = [];
  for (let n = 1; n <= N_MESES_PROJECAO; n++) {
    const valor = c.filter(r => num(r.restam) >= n).reduce((a,r) => a + num(r.valor_parcela), 0);
    projecoes.push({ ...(_mesFuturo(_periodo, n)), valor });
  }

  // ── Ranking de categorias (valor + quantidade) ──
  const rankMap = {};
  c.forEach(r => {
    const k = r.categoria || 'Outros';
    if (!rankMap[k]) rankMap[k] = { categoria:k, valor:0, qtd:0 };
    rankMap[k].valor += num(r.valor_parcela);
    rankMap[k].qtd   += 1;
  });
  const ranking = Object.values(rankMap).sort((a,b) => b.valor - a.valor).slice(0, 5);

  // ── Cartão mais usado (por quantidade de transações, no período todo — sem filtro) ──
  const cartaoMap = {};
  cartoes.forEach(r => {
    const k = r.cartao || 'Outros';
    if (!cartaoMap[k]) cartaoMap[k] = { cartao:k, valor:0, qtd:0 };
    cartaoMap[k].valor += num(r.valor_parcela);
    cartaoMap[k].qtd   += 1;
  });
  const cartaoTop = Object.values(cartaoMap).sort((a,b) => b.qtd - a.qtd)[0];
  const cartaoTopNome = cartaoTop?.cartao?.replace(' (David)','').replace(' (Vanessa)','');

  // ── Oportunidades de economia (categorias que mais cresceram vs mês anterior) ──
  const catAtualMap = {};
  c.forEach(r => { const k = r.categoria||'Outros'; catAtualMap[k] = (catAtualMap[k]||0) + num(r.valor_parcela); });
  const catPrevMap = {};
  cP.forEach(r => { const k = r.categoria||'Outros'; catPrevMap[k] = (catPrevMap[k]||0) + num(r.valor_parcela); });
  const deltas = Object.entries(catAtualMap)
    .map(([cat, valor]) => ({ categoria:cat, valor, prev: catPrevMap[cat]||0, delta: valor - (catPrevMap[cat]||0) }))
    .filter(d => d.delta > 0)
    .sort((a,b) => b.delta - a.delta)
    .slice(0, 3);

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
      <div class="kpi" style="--acc:var(--purple)">
        <div class="k-lbl">Cartão mais usado</div>
        <div class="k-val" style="font-size:16px">${cartaoTopNome || '—'}</div>
        <div class="k-sub">${cartaoTop ? `${cartaoTop.qtd} transações · ${fmt(cartaoTop.valor)}` : 'Sem dados no período'}</div>
      </div>
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
    <div class="sec-title">Projeção de gastos futuros</div>
    <div class="cg2">
      <div class="cc">
        <h3>Parcelas que ainda vêm pela frente</h3>
        <div class="csub">Projeção com base nas parcelas restantes, comparada ao pago este mês</div>
        <div class="ch"><canvas id="chProj2"></canvas></div>
      </div>
      <div class="cc" style="display:flex;flex-direction:column;justify-content:center;gap:10px">
        ${kpiHTML({ label:`Projeção · ${projecoes[0]?.label || 'próx. mês'}`, valor:projecoes[0]?.valor||0, acc:'var(--amber)',
          comp:{ cur:projecoes[0]?.valor||0, prev:pagos||null, prevLabel:'pago este mês', inverted:true },
          sub:'estimado com base nas parcelas em aberto' })}
        <p style="font-size:11px;color:var(--t3);line-height:1.5">
          A projeção assume que cada compra parcelada continua aparecendo na fatura
          até o fim das parcelas, no mesmo valor de hoje — não considera compras novas.
        </p>
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Ranking de categorias — mais usadas</div>
    <div class="rank-list" id="rankGrid"></div>
  </div>

  <div class="sec">
    <div class="sec-title">Oportunidades de economia</div>
    <div class="insight-card" id="insightCard"></div>
  </div>

  <div class="sec">
    <div class="sec-title">Transações e parcelas</div>
    <div class="tcard">
      <div class="tbar">
        <h3>Compras com cartão <span style="font-size:10px;font-weight:500;color:var(--t3)">(clique numa linha para filtrar por cartão)</span></h3>
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
      data:{ labels, datasets:[{ data:vals.map(Math.round), backgroundColor: COR_COMPARATIVO, borderRadius:6, borderWidth:0 }] },
      options: barOpts() });
  }

  // Gráfico de projeção: 1ª barra = pago este mês (real), demais = projetado (parcelas restantes)
  mkC('chProj2', { type:'bar',
    data: {
      labels: ['Pago este mês', ...projecoes.map(p=>p.label)],
      datasets: [{
        data: [Math.round(pagos), ...projecoes.map(p=>Math.round(p.valor))],
        backgroundColor: [COR_PAGO, ...projecoes.map(()=>COR_PROJETADO)],
        borderRadius: 6, borderWidth: 0,
      }],
    },
    options: barOpts() });

  // Ranking de categorias
  document.getElementById('rankGrid').innerHTML = ranking.length ? ranking.map((r,i) => `
    <div class="rank-item">
      <div class="rank-pos">${i+1}</div>
      <div class="rank-info">
        <div class="rank-name">${catIcon(r.categoria)} ${r.categoria}</div>
        <div class="rank-sub">${r.qtd} transaç${r.qtd===1?'ão':'ões'}</div>
      </div>
      <div class="rank-val">${fmt(r.valor)}</div>
    </div>`).join('') : '<p class="insight-empty">Sem lançamentos no período</p>';

  // Oportunidades de economia
  document.getElementById('insightCard').innerHTML = !prevAnoMes
    ? '<p class="insight-empty">Ainda não há mês anterior para comparar.</p>'
    : (deltas.length ? deltas.map(d => `
        <div class="insight-row">
          <div class="insight-ico">📈</div>
          <div class="insight-txt"><b>${d.categoria}</b> subiu ${fmt(d.delta)} em relação a ${pLabel}
            (de ${fmt(d.prev)} para ${fmt(d.valor)}).</div>
        </div>`).join('')
      : '<p class="insight-empty">Nenhuma categoria cresceu em relação ao mês anterior — bom sinal.</p>');

  window._p2Clear  = () => { _filtroCartao = null; _renderAll(); };
  window._p2Search = () => _renderTabela();

  _renderTabela();
}

function _renderTabela() {
  const s = (document.getElementById('srch2')?.value || '').toLowerCase();
  const cols = ['ano_mes','categoria','descricao','cartao','valor_parcela','parcela_atual','total_parcelas','restam','pago','responsavel'];

  let rows = _cartoesAtual;
  if (s) rows = rows.filter(r => Object.values(r).some(v=>v&&String(v).toLowerCase().includes(s)));

  if (_sortCol) {
    const dir = _sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a,b) => _comparar(a,b,_sortCol) * dir);
  }

  renderTable('th2', 'tb2', cols, rows, {
    sortable: true,
    sortCol: _sortCol,
    sortDir: _sortDir,
    onSort: (col) => {
      if (_sortCol === col) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
      else { _sortCol = col; _sortDir = 'asc'; }
      _renderTabela();
    },
    onRowClick: (row) => {
      _filtroCartao = _filtroCartao === row.cartao ? null : (row.cartao || null);
      _renderAll();
    },
    isRowActive: (row) => !!_filtroCartao && row.cartao === _filtroCartao,
  });
}

function _comparar(a, b, col) {
  const NUM = ['valor_parcela','parcela_atual','total_parcelas','restam'];
  if (NUM.includes(col)) return num(a[col]) - num(b[col]);
  return String(a[col] ?? '').localeCompare(String(b[col] ?? ''), 'pt-BR');
}

// Soma `n` meses a um período "AAAA-MM" e devolve o novo período + um rótulo curto (ex: "Out/2026")
function _mesFuturo(anoMes, n) {
  const [ano, mes] = anoMes.split('-').map(Number);
  const total = (mes - 1) + n;
  const anoNovo = ano + Math.floor(total / 12);
  const mesNovo = (total % 12) + 1;
  const anoMesNovo = `${anoNovo}-${String(mesNovo).padStart(2,'0')}`;
  return { anoMes: anoMesNovo, label: `${mesNome(anoMesNovo).slice(0,3)}/${anoNovo}` };
}

async function _query(anoMes) {
  if (!anoMes) return [];
  const { data, error } = await sb.from('cartoes').select('*').eq('ano_mes', anoMes).order('cartao').order('categoria');
  if (error) throw error;
  return data || [];
}
