import { sb, selectTodos } from './supabase-client.js';
import { fmt, fmtPct, num, mesNome, kpiHTML, renderTable, catIcon } from './utils.js';

// ─── Página 1 · Gastos & Salários ─────────────────────────────────────────────
// Recebe a seleção de período montada em app.js (montarSelecao):
//   modo 'mes' → um mês; comparações com o mês de calendário anterior
//   modo 'ano' → soma dos meses carregados no ano; comparações com o ano anterior
// Regra do saldo: Receita − Gastos fixos − Gastos pontuais − Cartões.
// Tipo de gasto: 'Fixo' e todo o resto = Pontual.

const MESES_CURTOS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

let _sel = null;
let _filtroCategoria = null;
let _sortCol = null;
let _sortDir = 'asc';
let _gastosAtual = [];
let _catOrigem = 'todos';   // tabela comparativa por categoria: 'todos' | 'conta' | 'cartao'
let _catDados  = null;
let _demoAbertos = { receita:false, fixo:true, pontual:true, cartao:false };  // grupos do demonstrativo

export async function render(sel) {
  _sel = sel;
  _filtroCategoria = null;
  _sortCol = null;
  await _renderAll();
}

async function _renderAll() {
  const el = document.getElementById('p1');
  el.innerHTML = `<div style="padding:40px;text-align:center"><div class="spinner"></div></div>`;

  const sel  = _sel;
  const prev = sel.prev;
  const yago = sel.yago;

  const [gastos, salarios, cartoes, gastosP, salariosP, cartoesP, salariosY, cartoesY] = await Promise.all([
    _queryGastos(sel.meses), _querySalarios(sel.meses), _queryCartoes(sel.meses),
    _queryGastos(prev?.meses), _querySalarios(prev?.meses), _queryCartoes(prev?.meses),
    _querySalarios(yago?.meses), _queryCartoes(yago?.meses),
  ]);

  _gastosAtual = gastos;
  const gastosFiltrados = _filtroCategoria ? gastos.filter(r => r.categoria === _filtroCategoria) : gastos;

  // ── Cálculos ──
  const soma    = (arr, col='valor') => arr.reduce((a,r) => a + num(r[col]), 0);
  const ehFixo  = r => r.tipo_gasto === 'Fixo';

  const totalS     = soma(salarios, 'valor_bruto');
  const fixos      = soma(gastos.filter(ehFixo));
  const pontuais   = soma(gastos.filter(r => !ehFixo(r)));
  const totCart    = soma(cartoes, 'valor_parcela');
  const saldo      = totalS - fixos - pontuais - totCart;
  const nFixos     = gastos.filter(ehFixo).length;
  const nPont      = gastos.length - nFixos;

  const totalG     = soma(gastosFiltrados);
  const pagos      = soma(gastosFiltrados.filter(r => r.pago === 'SIM'));
  const aberto     = totalG - pagos;
  const cartPagos  = soma(cartoes.filter(r => r.pago === 'SIM'), 'valor_parcela');
  const cartAberto = totCart - cartPagos;

  const prevTS  = soma(salariosP, 'valor_bruto');
  const prevFix = soma(gastosP.filter(ehFixo));
  const prevPon = soma(gastosP.filter(r => !ehFixo(r)));
  const prevTG  = prevFix + prevPon;
  const prevTC  = soma(cartoesP, 'valor_parcela');
  const prevSaldo = prev ? prevTS - prevTG - prevTC : null;
  const yagoTS  = soma(salariosY, 'valor_bruto');
  const yagoTC  = soma(cartoesY, 'valor_parcela');

  const pLabel = prev?.label || '';
  const yLabel = yago?.label || '';
  const ehAno  = sel.modo === 'ano';
  const nMeses = sel.meses.length;
  const unid   = ehAno ? 'período' : 'mês';

  _catDados = { gastos, gastosP, cartoes, cartoesP, prev, atualLabel: sel.label };

  // ── HTML ──
  el.innerHTML = `
  <!-- KPIs: de onde vem e para onde vai o salário -->
  <div class="sec">
    <div class="sec-title">Resumo — ${sel.titulo}</div>
    <div class="kg">
      ${kpiHTML({ label:'Receita total', valor:totalS, acc:'var(--gtxt)',
        comp:{ cur:totalS, prev:prev?prevTS:null, yago:yago?yagoTS:null, prevLabel:pLabel, yagoLabel:yLabel },
        sub: ehAno ? `${nMeses} meses · média ${fmt(totalS / (nMeses||1))}/mês` : `${salarios.length} proventos` })}
      ${kpiHTML({ label:'(−) Gastos fixos', valor:fixos, acc:'var(--navy2)',
        comp:{ cur:fixos, prev:prev?prevFix:null, prevLabel:pLabel, inverted:true },
        sub:`${nFixos} itens · ${fmtPct(fixos, totalS)} da receita` })}
      ${kpiHTML({ label:'(−) Gastos pontuais', valor:pontuais, acc:'var(--amber)',
        comp:{ cur:pontuais, prev:prev?prevPon:null, prevLabel:pLabel, inverted:true },
        sub:`${nPont} itens · ${fmtPct(pontuais, totalS)} da receita` })}
      ${kpiHTML({ label:'(−) Cartões', valor:totCart, acc:'var(--purple)',
        comp:{ cur:totCart, prev:prev?prevTC:null, yago:yago?yagoTC:null, prevLabel:pLabel, yagoLabel:yLabel, inverted:true },
        sub:`${cartoes.length} parcelas · ${fmtPct(totCart, totalS)} da receita` })}
      <div class="kpi kpi-saldo" style="--acc:${saldo>=0?'var(--blue)':'var(--red)'}">
        <div class="k-lbl">(=) Saldo do ${ehAno ? 'ano' : 'mês'}</div>
        <div class="k-val">${fmt(saldo)}</div>
        <span class="badge ${saldo>=0?'bb':'br'}">${saldo>=0?'Sobrou':'Faltou'} · ${totalS>0 ? fmtPct(Math.abs(saldo), totalS)+' da receita' : '—'}</span>
        ${prevSaldo != null ? `<div class="k-comp ${saldo>=prevSaldo?'up':'down'}">${saldo>=prevSaldo?'▲':'▼'} ${fmt(Math.abs(saldo-prevSaldo))} vs ${pLabel}</div>` : ''}
        <div class="k-sub">Receita − fixos − pontuais − cartões</div>
      </div>
    </div>
  </div>

  <!-- Status de pagamento: conta e cartões separados -->
  <div class="sec">
    <div class="sec-title">Pagamentos do ${unid}
      ${_filtroCategoria ? `
        <span style="font-size:11px;font-weight:600;color:var(--navy);margin-left:4px">· ${_filtroCategoria}</span>
        <button onclick="window._p1ClearFilter()" style="font-size:10px;background:none;border:1px solid var(--brd);border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--t3);margin-left:6px">✕ Limpar</button>` : ''}
    </div>
    <div class="kg">
      ${kpiHTML({ label:'Conta · total gastos', valor:totalG, acc:'var(--red)',
        comp:{ cur:totalG, prev:(prev && !_filtroCategoria) ? prevTG : null, prevLabel:pLabel, inverted:true },
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

  ${ehAno ? `
  <!-- Ano inteiro: demonstrativo com os meses em colunas -->
  <div class="sec">
    <div class="sec-title">Demonstrativo mês a mês — ${sel.ano}</div>
    <div class="tcard">
      <div class="tbar">
        <h3>Receita, gastos e saldo por mês <span style="font-size:10px;font-weight:500;color:var(--t3)">(clique num grupo para abrir/fechar o detalhe)</span></h3>
      </div>
      <div class="tw tw-demo"><table class="demo"><thead id="thDemo"></thead><tbody id="tbDemo"></tbody></table></div>
    </div>
  </div>` : `
  <!-- Mês: status de pagamento dos gastos fixos -->
  <div class="sec">
    <div class="sec-title">Gastos fixos — status de pagamento</div>
    <div class="fixo-grid" id="fixoGrid"></div>
  </div>`}

  <!-- Comparativo por categoria: atual x anterior -->
  <div class="sec">
    <div class="sec-title">Por categoria — ${sel.label} vs ${pLabel || (ehAno ? 'ano anterior' : 'mês anterior')}</div>
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

  <!-- Lançamentos -->
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

  if (ehAno) {
    _renderDemonstrativo({ gastos, salarios, cartoes });
  } else {
    const fixosLista = gastos.filter(ehFixo);
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
  }

  document.querySelectorAll('#catOrigemTabs .stab').forEach(btn => {
    btn.addEventListener('click', () => { _catOrigem = btn.dataset.o; _renderCatComp(); });
  });

  window._p1ClearFilter = () => { _filtroCategoria = null; _renderAll(); };
  window._p1Search  = () => _renderTable();

  _renderTable();
  _renderCatComp();
}

// ─── Demonstrativo do ano: grupos em linhas, meses em colunas ────────────────
function _renderDemonstrativo({ gastos, salarios, cartoes }) {
  const ano      = _sel.ano;
  const colMeses = MESES_CURTOS.map((_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
  const carregado = new Set(_sel.meses);

  // Agrupa linhas de detalhe: chave = categoria + descrição
  const agrupar = (arr, col, catFn, descFn) => {
    const mapa = {};
    arr.forEach(r => {
      const cat = catFn(r) || 'Outros', desc = descFn(r) || '';
      const k = cat + '|' + desc;
      if (!mapa[k]) mapa[k] = { cat, desc, porMes:{}, total:0 };
      mapa[k].porMes[r.ano_mes] = (mapa[k].porMes[r.ano_mes] || 0) + num(r[col]);
      mapa[k].total += num(r[col]);
    });
    return Object.values(mapa).sort((a,b) => b.total - a.total);
  };
  const somaMes = linhas => {
    const m = {}; let t = 0;
    linhas.forEach(l => { Object.entries(l.porMes).forEach(([k,v]) => { m[k] = (m[k]||0) + v; }); t += l.total; });
    return { porMes:m, total:t };
  };

  const grupos = [
    { key:'receita', nome:'Receita',              sinal:'',   cls:'g-rec',
      linhas: agrupar(salarios, 'valor_bruto', r => r.tipo_provento, r => [r.descricao, r.responsavel].filter(Boolean).join(' · ')) },
    { key:'fixo',    nome:'(−) Gastos fixos',     sinal:'−',  cls:'g-fix',
      linhas: agrupar(gastos.filter(r => r.tipo_gasto === 'Fixo'), 'valor', r => r.categoria, r => r.descricao) },
    { key:'pontual', nome:'(−) Gastos pontuais',  sinal:'−',  cls:'g-pon',
      linhas: agrupar(gastos.filter(r => r.tipo_gasto !== 'Fixo'), 'valor', r => r.categoria, r => r.descricao) },
    { key:'cartao',  nome:'(−) Cartões',          sinal:'−',  cls:'g-car',
      linhas: agrupar(cartoes, 'valor_parcela', r => r.categoria, () => '') },
  ];
  grupos.forEach(g => Object.assign(g, somaMes(g.linhas)));

  const saldoMes = {};
  colMeses.forEach(m => {
    if (!carregado.has(m)) return;
    const [rec, fix, pon, car] = grupos.map(g => g.porMes[m] || 0);
    saldoMes[m] = rec - fix - pon - car;
  });
  const [recT, fixT, ponT, carT] = grupos.map(g => g.total);
  const saldoT = recT - fixT - ponT - carT;

  const cel = (v, m, extra='') => {
    if (m && !carregado.has(m)) return `<td class="tr vazio">—</td>`;
    return `<td class="tr ${extra}">${v ? fmt(v) : '<span class="zero">–</span>'}</td>`;
  };

  document.getElementById('thDemo').innerHTML = `<tr>
    <th class="c-cat">Categoria</th><th class="c-desc">Descrição</th>
    ${colMeses.map((m,i) => `<th class="tr ${carregado.has(m)?'':'vazio'}">${MESES_CURTOS[i]}</th>`).join('')}
    <th class="tr c-tot">Total</th></tr>`;

  let html = '';
  grupos.forEach(g => {
    const aberto = _demoAbertos[g.key];
    html += `<tr class="demo-grp ${g.cls}" data-g="${g.key}">
      <td class="c-cat" colspan="2"><span class="caret">${aberto ? '▾' : '▸'}</span> ${g.nome}
        <span class="grp-n">${g.linhas.length}</span></td>
      ${colMeses.map(m => cel(g.porMes[m], m)).join('')}
      <td class="tr c-tot">${fmt(g.total)}</td></tr>`;
    if (aberto) {
      html += g.linhas.map(l => `<tr class="demo-det">
        <td class="c-cat">${catIcon(l.cat)} ${l.cat}</td>
        <td class="c-desc">${l.desc || '<span class="zero">—</span>'}</td>
        ${colMeses.map(m => cel(l.porMes[m], m)).join('')}
        <td class="tr c-tot">${fmt(l.total)}</td></tr>`).join('');
    }
  });

  html += `<tr class="demo-saldo">
    <td class="c-cat" colspan="2">(=) Saldo</td>
    ${colMeses.map(m => carregado.has(m)
      ? `<td class="tr ${saldoMes[m] < 0 ? 'neg' : 'pos'}">${fmt(saldoMes[m])}</td>`
      : `<td class="tr vazio">—</td>`).join('')}
    <td class="tr c-tot ${saldoT < 0 ? 'neg' : 'pos'}">${fmt(saldoT)}</td></tr>`;

  const pct = (s, r) => r > 0 ? (s / r * 100).toFixed(1) + '%' : '—';
  html += `<tr class="demo-pct">
    <td class="c-cat" colspan="2">% da receita que sobrou</td>
    ${colMeses.map(m => carregado.has(m)
      ? `<td class="tr ${saldoMes[m] < 0 ? 'neg' : 'pos'}">${pct(saldoMes[m], grupos[0].porMes[m] || 0)}</td>`
      : `<td class="tr vazio">—</td>`).join('')}
    <td class="tr c-tot ${saldoT < 0 ? 'neg' : 'pos'}">${pct(saldoT, recT)}</td></tr>`;

  const tb = document.getElementById('tbDemo');
  tb.innerHTML = html;
  tb.querySelectorAll('tr.demo-grp').forEach(tr => tr.addEventListener('click', () => {
    _demoAbertos[tr.dataset.g] = !_demoAbertos[tr.dataset.g];
    _renderDemonstrativo({ gastos, salarios, cartoes });
  }));
}

// ─── Tabela: gasto por categoria, período atual x anterior ───────────────────
function _renderCatComp() {
  if (!_catDados) return;
  const { gastos, gastosP, cartoes, cartoesP, prev, atualLabel } = _catDados;
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
  const temPrev  = !!prev;
  const prevNome = prev?.label || (_sel.modo === 'ano' ? 'Ano anterior' : 'Mês anterior');
  const pctLbl   = _sel.modo === 'ano' ? '% do ano' : '% do mês';

  document.getElementById('thCat1').innerHTML = `<tr>
    <th>Categoria</th><th class="tr">${prevNome}</th><th class="tr">${atualLabel}</th>
    <th class="tr">Variação R$</th><th class="tr">Variação %</th><th class="tr">${pctLbl}</th></tr>`;

  const varCell = (a, p) => {
    if (!temPrev) return ['<td class="tr" style="color:var(--t3)">—</td>', '<td class="tr" style="color:var(--t3)">—</td>'];
    const d = a - p;
    const cls  = d > 0.004 ? 'neg' : d < -0.004 ? 'pos' : '';
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
    <td>Total</td><td class="tr">${temPrev ? fmt(totP) : '—'}</td><td class="tr">${fmt(totA)}</td>${tR}${tP}<td class="tr">100%</td></tr>` : '';
}

// ─── Tabela de lançamentos ───────────────────────────────────────────────────
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

// ─── Queries (recebem a lista de meses 'AAAA-MM' do período) ─────────────────
async function _queryGastos(meses) {
  if (!meses?.length) return [];
  return selectTodos(() => sb.from('gastos').select('*').in('ano_mes', meses)
    .order('ano_mes', { ascending:false }).order('tipo_gasto').order('categoria').order('id'));
}

async function _queryCartoes(meses) {
  if (!meses?.length) return [];
  return selectTodos(() => sb.from('cartoes').select('ano_mes, categoria, valor_parcela, pago')
    .in('ano_mes', meses).order('id'));
}

async function _querySalarios(meses) {
  if (!meses?.length) return [];
  return selectTodos(() => sb.from('salarios').select('*').in('ano_mes', meses).order('id'));
}
