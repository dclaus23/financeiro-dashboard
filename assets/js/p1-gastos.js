import { sb, getPeriodoAnterior, getMesmoMesAnoPassado } from './supabase-client.js';
import { fmt, fmtPct, num, mesNome, PAL, mkC, kpiHTML, renderTable, catIcon, doughnutOpts, legendHTML } from './utils.js';

let _periodo = null;
let _filtroCategoria = null;
let _sortCol = null;
let _sortDir = 'asc';
let _gastosAtual = [];
let _catOrigem = 'todos';   // tabela comparativa por categoria: 'todos' | 'conta' | 'cartao'
let _catDados  = null;      // { gastos, gastosP, cartoes, cartoesP, pLabel }

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
  const [gastos, salarios, cartoes] = await Promise.all([
    _queryGastos(_periodo),
    _querySalarios(_periodo),
    _queryCartoes(_periodo),
  ]);

  // Comparativos
  const prevAnoMes  = await getPeriodoAnterior(_periodo);
  const yagoAnoMes  = await getMesmoMesAnoPassado(_periodo);
  const [gastosP, salariosP, cartoesP] = prevAnoMes
    ? await Promise.all([_queryGastos(prevAnoMes), _querySalarios(prevAnoMes), _queryCartoes(prevAnoMes)])
    : [[], [], []];
  const [gastosY, salariosY, cartoesY] = yagoAnoMes
    ? await Promise.all([_queryGastos(yagoAnoMes), _querySalarios(yagoAnoMes), _queryCartoes(yagoAnoMes)])
    : [[], [], []];

  _gastosAtual = gastos;

  const gastosFiltrados = _filtroCategoria
    ? gastos.filter(r => r.categoria === _filtroCategoria)
    : gastos;

  // Cálculos — gastos da conta (fixos + pontuais), com filtro de categoria
  const soma    = (arr, col='valor') => arr.reduce((a,r) => a + num(r[col]), 0);
  const totalG  = soma(gastosFiltrados);
  const pagos   = soma(gastosFiltrados.filter(r => r.pago === 'SIM'));
  const aberto  = totalG - pagos;
  const totalS  = soma(salarios, 'valor_bruto');

  // Composição do saldo — sempre sobre o mês inteiro (ignora filtro de categoria)
  const fixos     = soma(gastos.filter(r => r.tipo_gasto === 'Fixo'));
  const pontuais  = soma(gastos.filter(r => r.tipo_gasto !== 'Fixo'));
  const totCart   = soma(cartoes, 'valor_parcela');
  const cartPagos = soma(cartoes.filter(r => r.pago === 'SIM'), 'valor_parcela');
  const cartAberto = totCart - cartPagos;
  const saldo     = totalS - fixos - pontuais - totCart;
  const nFixos    = gastos.filter(r => r.tipo_gasto === 'Fixo').length;
  const nPont     = gastos.length - nFixos;

  const prevTG  = soma(gastosP);
  const yagoTG  = soma(gastosY);
  const prevTS  = soma(salariosP, 'valor_bruto');
  const yagoTS  = soma(salariosY, 'valor_bruto');
  const prevFix = soma(gastosP.filter(r => r.tipo_gasto === 'Fixo'));
  const prevPon = soma(gastosP.filter(r => r.tipo_gasto !== 'Fixo'));
  const prevTC  = soma(cartoesP, 'valor_parcela');
  const yagoTC  = soma(cartoesY, 'valor_parcela');
  const prevSaldo = prevAnoMes ? prevTS - prevTG - prevTC : null;

  const pLabel  = prevAnoMes ? mesNome(prevAnoMes) : '';
  const yLabel  = yagoAnoMes ? mesNome(yagoAnoMes) + '/' + yagoAnoMes?.split('-')[0] : '';

  _catDados = { gastos, gastosP, cartoes, cartoesP, pLabel, temPrev: !!prevAnoMes };

  // Montar HTML
  el.innerHTML = `
  <!-- KPIs: de onde vem e para onde vai o salário -->
  <div class="sec">
    <div class="sec-title">Resumo — ${mesNome(_periodo)} ${_periodo?.split('-')[0]}</div>
    <div class="kg">
      ${kpiHTML({ label:'Receita total', valor:totalS, acc:'var(--gtxt)',
        comp:{ cur:totalS, prev:prevTS||null, yago:yagoTS||null, prevLabel:pLabel, yagoLabel:yLabel },
        sub:`${salarios.length} proventos` })}
      ${kpiHTML({ label:'(−) Gastos fixos', valor:fixos, acc:'var(--navy2)',
        comp:{ cur:fixos, prev:prevFix||null, prevLabel:pLabel, inverted:true },
        sub:`${nFixos} itens · ${fmtPct(fixos, totalS)} da receita` })}
      ${kpiHTML({ label:'(−) Gastos pontuais', valor:pontuais, acc:'var(--amber)',
        comp:{ cur:pontuais, prev:prevPon||null, prevLabel:pLabel, inverted:true },
        sub:`${nPont} itens · ${fmtPct(pontuais, totalS)} da receita` })}
      ${kpiHTML({ label:'(−) Cartões', valor:totCart, acc:'var(--purple)',
        comp:{ cur:totCart, prev:prevTC||null, yago:yagoTC||null, prevLabel:pLabel, yagoLabel:yLabel, inverted:true },
        sub:`${cartoes.length} parcelas · ${fmtPct(totCart, totalS)} da receita` })}
      <div class="kpi kpi-saldo" style="--acc:${saldo>=0?'var(--blue)':'var(--red)'}">
        <div class="k-lbl">(=) Saldo do mês</div>
        <div class="k-val">${fmt(saldo)}</div>
        <span class="badge ${saldo>=0?'bb':'br'}">${saldo>=0?'Sobrou':'Faltou'} · ${totalS>0 ? fmtPct(Math.abs(saldo), totalS)+' da receita' : '—'}</span>
        ${prevSaldo != null ? `<div class="k-comp ${saldo>=prevSaldo?'up':'down'}">${saldo>=prevSaldo?'▲':'▼'} ${fmt(Math.abs(saldo-prevSaldo))} vs ${pLabel}</div>` : ''}
        <div class="k-sub">Receita − fixos − pontuais − cartões</div>
      </div>
    </div>
  </div>

  <!-- Status de pagamento: conta e cartões separados -->
  <div class="sec">
    <div class="sec-title">Pagamentos do mês
      ${_filtroCategoria ? `<span style="font-size:11px;font-weight:600;color:var(--navy);margin-left:4px">· ${_filtroCategoria}</span>` : ''}
    </div>
    <div class="kg">
      ${kpiHTML({ label:'Conta · total gastos', valor:totalG, acc:'var(--red)',
        comp:{ cur:totalG, prev:(_filtroCategoria?null:prevTG)||null, prevLabel:pLabel, inverted:true },
        sub:`${gastosFiltrados.length} lançamentos (fixos + pontuais)` })}
      ${kpiHTML({ label:'Conta · pagos', valor:pagos, acc:'var(--gtxt)',
        badge:{ cls:'bg', txt:'✓ Pago' },
        sub:`${gastosFiltrados.filter(r=>r.pago==='SIM').length} itens` })}
      ${kpiHTML({ label:'Conta · a pagar', valor:aberto, acc:'var(--amber)',
        badge:aberto>0?{ cls:'ba', txt:'Pendente' }:null,
        sub:`${gastosFiltrados.filter(r=>r.pago!=='SIM').length} itens` })}
      ${kpiHTML({ label:'Cartões · pagos', valor:cartPagos, acc:'var(--gtxt)',
        badge:{ cls:'bg', txt:'✓ Pago' },
        sub:`${cartoes.filter(r=>r.pago==='SIM').length} parcelas` })}
      ${kpiHTML({ label:'Cartões · em aberto', valor:cartAberto, acc:'var(--purple)',
        badge:cartAberto>0?{ cls:'bp', txt:'Pendente' }:null,
        sub:`${cartoes.filter(r=>r.pago!=='SIM').length} parcelas` })}
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

  <!-- Comparativo por categoria: mês atual x anterior -->
  <div class="sec">
    <div class="sec-title">Por categoria — ${mesNome(_periodo)} vs ${pLabel || 'mês anterior'}</div>
    <div class="tcard">
      <div class="tbar">
        <h3>Comparativo por categoria <span style="font-size:10px;font-weight:500;color:var(--t3)">(clique numa linha para filtrar)</span></h3>
        <div class="stab-wrap" id="catOrigemTabs">
          <button class="stab" data-o="todos">Tudo</button>
          <button class="stab" data-o="conta">Conta</button>
          <button class="stab" data-o="cartao">Cartões</button>
        </div>
      </div>
      <div class="tw"><table class="cat-comp"><thead id="thCat1"></thead><tbody id="tbCat1"></tbody><tfoot id="tfCat1"></tfoot></table></div>
    </div>
  </div>

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
  const fixosLista = gastos.filter(r => r.tipo_gasto === 'Fixo');
  document.getElementById('fixoGrid').innerHTML = fixosLista.map(r => `
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

  // Abas da tabela comparativa por categoria
  document.querySelectorAll('#catOrigemTabs .stab').forEach(btn => {
    btn.addEventListener('click', () => { _catOrigem = btn.dataset.o; _renderCatComp(); });
  });

  window._p1ClearFilter = () => { _filtroCategoria = null; _renderAll(); };
  window._p1Search  = () => _renderTable();

  _renderTable();
  _renderCatComp();
}

// ─── Tabela: gasto por categoria, mês atual x mês anterior ───────────────────
function _renderCatComp() {
  if (!_catDados) return;
  const { gastos, gastosP, cartoes, cartoesP, pLabel, temPrev } = _catDados;
  document.querySelectorAll('#catOrigemTabs .stab').forEach(b =>
    b.classList.toggle('active', b.dataset.o === _catOrigem));

  const incConta  = _catOrigem !== 'cartao';
  const incCartao = _catOrigem !== 'conta';
  const mapa = {};
  const add = (arr, col, key) => arr.forEach(r => {
    const k = r.categoria || 'Outros';
    if (!mapa[k]) mapa[k] = { categoria:k, atual:0, prev:0 };
    mapa[k][key] += num(r[col]);
  });
  if (incConta)  { add(gastos,  'valor', 'atual');         add(gastosP,  'valor', 'prev'); }
  if (incCartao) { add(cartoes, 'valor_parcela', 'atual'); add(cartoesP, 'valor_parcela', 'prev'); }

  const linhas = Object.values(mapa).sort((a,b) => b.atual - a.atual || b.prev - a.prev);
  const totA = linhas.reduce((a,r) => a + r.atual, 0);
  const totP = linhas.reduce((a,r) => a + r.prev, 0);
  const prevNome = pLabel || 'Mês anterior';

  document.getElementById('thCat1').innerHTML = `<tr>
    <th>Categoria</th><th class="tr">${prevNome}</th><th class="tr">${mesNome(_periodo)}</th>
    <th class="tr">Variação R$</th><th class="tr">Variação %</th><th class="tr">% do mês</th></tr>`;

  const varCell = (a, p) => {
    const d = a - p;
    if (!temPrev) return ['<td class="tr" style="color:var(--t3)">—</td>', '<td class="tr" style="color:var(--t3)">—</td>'];
    const cls = d > 0.004 ? 'neg' : d < -0.004 ? 'pos' : '';
    const seta = d > 0.004 ? '▲ ' : d < -0.004 ? '▼ ' : '';
    const pct = p > 0 ? `${seta}${Math.abs(d / p * 100).toFixed(1)}%`
              : a > 0 ? '<span class="status-pill-sm s-par">Novo</span>' : '—';
    return [`<td class="tr ${cls}">${seta}${fmt(Math.abs(d))}</td>`, `<td class="tr ${cls}">${pct}</td>`];
  };

  const tb = document.getElementById('tbCat1');
  tb.innerHTML = linhas.length ? linhas.map(r => {
    const [vR, vP] = varCell(r.atual, r.prev);
    const ativo = _filtroCategoria === r.categoria ? ' row-active' : '';
    return `<tr class="row-click${ativo}" data-cat="${r.categoria.replace(/"/g,'&quot;')}">
      <td>${catIcon(r.categoria)} ${r.categoria}</td>
      <td class="tr">${r.prev ? fmt(r.prev) : '<span style="color:var(--t3)">—</span>'}</td>
      <td class="tr bold">${r.atual ? fmt(r.atual) : '<span style="color:var(--t3)">—</span>'}</td>
      ${vR}${vP}
      <td class="tr" style="color:var(--t3)">${fmtPct(r.atual, totA)}</td></tr>`;
  }).join('') : `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--t3)">Nenhum registro</td></tr>`;

  tb.querySelectorAll('tr.row-click').forEach(tr => tr.addEventListener('click', () => {
    const cat = tr.dataset.cat;
    _filtroCategoria = _filtroCategoria === cat ? null : cat;
    _renderAll();
  }));

  const [tR, tP] = varCell(totA, totP);
  document.getElementById('tfCat1').innerHTML = linhas.length ? `<tr class="tot-row">
    <td>Total</td><td class="tr">${fmt(totP)}</td><td class="tr">${fmt(totA)}</td>${tR}${tP}<td class="tr">100%</td></tr>` : '';
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

async function _queryCartoes(anoMes) {
  if (!anoMes) return [];
  const { data, error } = await sb.from('cartoes').select('categoria, valor_parcela, pago').eq('ano_mes', anoMes);
  if (error) throw error;
  return data || [];
}

async function _querySalarios(anoMes) {
  if (!anoMes) return [];
  const { data, error } = await sb.from('salarios').select('*').eq('ano_mes', anoMes);
  if (error) throw error;
  return data || [];
}
