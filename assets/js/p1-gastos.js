import { sb, getPeriodoAnterior, getMesmoMesAnoPassado } from './supabase-client.js';
import { fmt, fmtK, num, mesNome, PAL, mkC, kpiHTML, renderTable, catIcon, doughnutOpts, barOpts, legendHTML } from './utils.js';

// Cores fixas pedidas: gastos sempre em vermelho clarinho, receita sempre em
// verde militar — independente de ser mês anterior/atual/ano passado.
const COR_GASTO   = '#EF9A9A';
const COR_RECEITA = '#375623';

let _periodo = null;
let _filtroCategoria = null;
let _sortCol = null;
let _sortDir = 'asc';
let _gastosAtual = [];

export async function render(periodo) {
  _periodo = periodo;
  _filtroCategoria = null;
  _sortCol = null;
  await _renderAll();
}

async function _renderAll() {
  const el = document.getElementById('p1');
  el.innerHTML = `<div style="padding:40px;text-align:center"><div class="spinner"></div></div>`;

  // Buscar dados do período atual
  const [gastos, salarios] = await Promise.all([
    _queryGastos(_periodo),
    _querySalarios(_periodo),
  ]);

  // Comparativos
  const prevAnoMes  = await getPeriodoAnterior(_periodo);
  const yagoAnoMes  = await getMesmoMesAnoPassado(_periodo);
  const [gastosP, salariosP] = prevAnoMes
    ? await Promise.all([_queryGastos(prevAnoMes), _querySalarios(prevAnoMes)])
    : [[], []];
  const [gastosY, salariosY] = yagoAnoMes
    ? await Promise.all([_queryGastos(yagoAnoMes), _querySalarios(yagoAnoMes)])
    : [[], []];

  _gastosAtual = gastos;

  const gastosFiltrados = _filtroCategoria
    ? gastos.filter(r => r.categoria === _filtroCategoria)
    : gastos;

  // Cálculos
  const totalG  = gastosFiltrados.reduce((a,r) => a + num(r.valor), 0);
  const pagos   = gastosFiltrados.filter(r => r.pago === 'SIM').reduce((a,r) => a + num(r.valor), 0);
  const aberto  = totalG - pagos;
  const totalS  = salarios.reduce((a,r) => a + num(r.valor_bruto), 0);
  const saldo   = totalS - totalG;

  const prevTG  = gastosP.reduce((a,r) => a + num(r.valor), 0);
  const yagoTG  = gastosY.reduce((a,r) => a + num(r.valor), 0);
  const prevTS  = salariosP.reduce((a,r) => a + num(r.valor_bruto), 0);
  const yagoTS  = salariosY.reduce((a,r) => a + num(r.valor_bruto), 0);

  const pLabel  = prevAnoMes ? mesNome(prevAnoMes) : '';
  const yLabel  = yagoAnoMes ? mesNome(yagoAnoMes) + '/' + yagoAnoMes?.split('-')[0] : '';

  // Montar HTML
  el.innerHTML = `
  <!-- KPIs -->
  <div class="sec">
    <div class="sec-title">Resumo — ${mesNome(_periodo)} ${_periodo?.split('-')[0]}</div>
    <div class="kg">
      ${kpiHTML({ label:'Receita total', valor:totalS, acc:'var(--gtxt)',
        comp:{ cur:totalS, prev:prevTS||null, yago:yagoTS||null, prevLabel:pLabel, yagoLabel:yLabel },
        sub:`${salarios.length} proventos` })}
      ${kpiHTML({ label:'Total gastos', valor:totalG, acc:'var(--red)',
        comp:{ cur:totalG, prev:prevTG||null, yago:yagoTG||null, prevLabel:pLabel, yagoLabel:yLabel, inverted:true },
        sub:`${gastosFiltrados.length} lançamentos` })}
      ${kpiHTML({ label:'Gastos pagos', valor:pagos, acc:'var(--gtxt)',
        badge:{ cls:'bg', txt:'✓ Pago' },
        sub:`${gastosFiltrados.filter(r=>r.pago==='SIM').length} itens` })}
      ${kpiHTML({ label:'A pagar', valor:aberto, acc:'var(--amber)',
        badge:aberto>0?{ cls:'ba', txt:'Pendente' }:null,
        sub:`${gastosFiltrados.filter(r=>r.pago==='NÃO').length} itens` })}
      ${kpiHTML({ label:'Saldo', valor:saldo, acc: saldo>=0?'var(--blue)':'var(--red)',
        badge:{ cls: saldo>=0?'bb':'br', txt: saldo>=0?'Positivo':'Negativo' } })}
      ${kpiHTML({ label:'Gastos fixos', valor:gastos.filter(r=>r.tipo_gasto==='Fixo').reduce((a,r)=>a+num(r.valor),0),
        acc:'var(--navy2)', sub:`${gastos.filter(r=>r.tipo_gasto==='Fixo').length} itens fixos` })}
    </div>
  </div>

  <!-- Gastos Fixos -->
  <div class="sec">
    <div class="sec-title">Gastos fixos — status de pagamento</div>
    <div class="fixo-grid" id="fixoGrid"></div>
  </div>

  <!-- Gráficos -->
  <div class="sec">
    <div class="sec-title">
      Distribuição
      ${_filtroCategoria ? `
        <span style="font-size:11px;font-weight:600;color:var(--navy);margin-left:4px">· ${_filtroCategoria}</span>
        <button onclick="window._p1ClearFilter()" style="font-size:10px;background:none;border:1px solid var(--brd);border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--t3);margin-left:6px">✕ Limpar</button>
      ` : ''}
    </div>
    <div class="cg2">
      <div class="cc">
        <h3>Por categoria <span style="font-size:10px;color:var(--t3)">(clique para filtrar)</span></h3>
        <div class="csub">Valor total no período</div>
        <div class="ch"><canvas id="chCat1"></canvas></div>
        <div class="chip-legend" id="legCat1"></div>
      </div>
      <div class="cc">
        <h3>Pago vs. A pagar</h3>
        <div class="csub">Status dos lançamentos</div>
        <div class="ch"><canvas id="chStatus1"></canvas></div>
        <div class="chip-legend" id="legStatus1"></div>
      </div>
    </div>
  </div>

  <!-- Comparativo -->
  ${prevAnoMes || yagoAnoMes ? `
  <div class="sec">
    <div class="sec-title">Comparativo mensal</div>
    <div class="cg2">
      <div class="cc">
        <h3>Gastos — comparativo</h3>
        <div class="csub">Mês atual vs anterior vs ano passado</div>
        <div class="ch"><canvas id="chCompG1"></canvas></div>
      </div>
      <div class="cc">
        <h3>Receita — comparativo</h3>
        <div class="csub">Evolução da renda</div>
        <div class="ch"><canvas id="chCompS1"></canvas></div>
      </div>
    </div>
  </div>` : ''}

  <!-- Tabela -->
  <div class="sec">
    <div class="sec-title">Lançamentos</div>
    <div class="tcard">
      <div class="tbar">
        <h3>Todos os gastos <span style="font-size:10px;font-weight:500;color:var(--t3)">(clique numa linha para filtrar por categoria)</span></h3>
        <input class="srch" id="srch1" type="text" placeholder="Buscar..." oninput="window._p1Search()">
      </div>
      <div class="tw"><table><thead id="th1"></thead><tbody id="tb1"></tbody></table></div>
    </div>
  </div>`;

  // Fixos visuais
  const fixos = gastos.filter(r => r.tipo_gasto === 'Fixo');
  document.getElementById('fixoGrid').innerHTML = fixos.map(r => `
    <div class="fixo-card ${r.pago === 'SIM' ? 'sim' : 'nao'}">
      <div class="fixo-ico">${catIcon(r.categoria)}</div>
      <div class="fixo-info">
        <div class="fixo-desc">${r.descricao || r.categoria || '—'}</div>
        <div class="fixo-cat">${r.categoria || ''} · ${r.responsavel || ''}</div>
      </div>
      <div class="fixo-right">
        <div class="fixo-val">${fmt(r.valor)}</div>
        <span class="status-pill-sm ${r.pago === 'SIM' ? 's-sim' : 's-nao'}">
          ${r.pago === 'SIM' ? '✓ Pago' : '✗ Pendente'}
        </span>
      </div>
    </div>`).join('') || '<p style="color:var(--t3);padding:12px">Nenhum gasto fixo no período</p>';

  // Gráfico categorias (clicável) + legenda com valor e %
  const cm = {};
  gastosFiltrados.forEach(r => { const k = r.categoria || 'Outros'; cm[k] = (cm[k] || 0) + num(r.valor); });
  const cs = Object.entries(cm).sort((a,b) => b[1]-a[1]).slice(0,8);

  mkC('chCat1', {
    type: 'doughnut',
    data: { labels: cs.map(x=>x[0]), datasets: [{ data: cs.map(x=>Math.round(x[1])), backgroundColor: PAL, borderWidth: 2, borderColor: '#fff' }] },
    options: {
      ...doughnutOpts(totalG, { legend:false }),
      onClick: (e, els) => {
        if (els.length) { _filtroCategoria = cs[els[0].index][0]; _renderAll(); }
      },
    },
  });
  document.getElementById('legCat1').innerHTML = legendHTML(
    cs.map(([label,value],i) => ({ label, value, color: PAL[i % PAL.length] })), totalG,
  );

  // Gráfico status + legenda
  mkC('chStatus1', {
    type: 'doughnut',
    data: { labels: ['Pago','A pagar'], datasets: [{ data: [Math.round(pagos), Math.round(aberto)], backgroundColor: ['#375623','#C00000'], borderWidth: 2, borderColor: '#fff' }] },
    options: doughnutOpts(totalG, { legend:false }),
  });
  document.getElementById('legStatus1').innerHTML = legendHTML([
    { label:'Pago',    value:pagos,  color:'#375623' },
    { label:'A pagar', value:aberto, color:'#C00000' },
  ], totalG);

  // Comparativos (cor única por gráfico)
  if (prevAnoMes || yagoAnoMes) {
    const labels = [pLabel, mesNome(_periodo), yLabel].filter(Boolean);
    const valsG  = [prevTG, totalG, yagoTG].filter((_,i) => [prevAnoMes, _periodo, yagoAnoMes][i]);
    const valsS  = [prevTS, totalS, yagoTS].filter((_,i) => [prevAnoMes, _periodo, yagoAnoMes][i]);

    mkC('chCompG1', { type: 'bar',
      data: { labels, datasets: [{ label:'Gastos', data: valsG.map(Math.round), backgroundColor: COR_GASTO, borderRadius: 6, borderWidth: 0 }] },
      options: barOpts() });

    mkC('chCompS1', { type: 'bar',
      data: { labels, datasets: [{ label:'Receita', data: valsS.map(Math.round), backgroundColor: COR_RECEITA, borderRadius: 6, borderWidth: 0 }] },
      options: barOpts() });
  }

  window._p1ClearFilter = () => { _filtroCategoria = null; _renderAll(); };
  window._p1Search  = () => _renderTable();

  _renderTable();
}

function _renderTable() {
  const srch = (document.getElementById('srch1')?.value || '').toLowerCase();
  const cols = ['ano_mes','categoria','descricao','responsavel','valor','pago','tipo_gasto'];

  let rows = _filtroCategoria ? _gastosAtual.filter(r => r.categoria === _filtroCategoria) : _gastosAtual;
  if (srch) rows = rows.filter(r => Object.values(r).some(v => v && String(v).toLowerCase().includes(srch)));

  if (_sortCol) {
    const dir = _sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a,b) => _comparar(a, b, _sortCol) * dir);
  }

  renderTable('th1', 'tb1', cols, rows, {
    sortable: true,
    sortCol: _sortCol,
    sortDir: _sortDir,
    onSort: (col) => {
      if (_sortCol === col) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
      else { _sortCol = col; _sortDir = 'asc'; }
      _renderTable();
    },
    onRowClick: (row) => {
      _filtroCategoria = _filtroCategoria === row.categoria ? null : (row.categoria || null);
      _renderAll();
    },
    isRowActive: (row) => !!_filtroCategoria && row.categoria === _filtroCategoria,
  });
}

function _comparar(a, b, col) {
  if (col === 'valor') return num(a[col]) - num(b[col]);
  return String(a[col] ?? '').localeCompare(String(b[col] ?? ''), 'pt-BR');
}

// Queries
async function _queryGastos(anoMes) {
  if (!anoMes) return [];
  const { data, error } = await sb.from('gastos').select('*').eq('ano_mes', anoMes).order('tipo_gasto').order('categoria');
  if (error) throw error;
  return data || [];
}

async function _querySalarios(anoMes) {
  if (!anoMes) return [];
  const { data, error } = await sb.from('salarios').select('*').eq('ano_mes', anoMes);
  if (error) throw error;
  return data || [];
}
