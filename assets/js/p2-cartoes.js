import { sb, selectTodos } from './supabase-client.js';
import { fmt, fmtK, fmtPct, num, cent, mesNome, PAL, mkC, kpiHTML, renderTable, barOpts, catIcon, rotulosBarra } from './utils.js';

// ─── Página 2 · Cartões ───────────────────────────────────────────────────────
// Recebe a seleção de período de app.js (montarSelecao).
//
// Responsáveis: quem é "da casa" entra na análise de economia; os demais são
// terceiros que usaram o cartão emprestado (o valor é a receber deles).
// Para mudar quem é da casa, edite a lista abaixo.
const RESP_CASA = ['David', 'Vanessa', 'Família'];
const ehCasa = r => RESP_CASA.includes((r.responsavel || '').trim()) || !r.responsavel;

const COR_PAGO       = '#375623';
const COR_PROJETADO  = '#E0A100';
const COR_ANO        = '#6A1B9A';   // barras do ano atual
const COR_ANO_SEL    = '#002060';   // mês selecionado em destaque
const COR_ANO_PREV   = '#9AA5B8';   // linha do ano anterior
const N_MESES_PROJECAO = 4;
const MESES_CURTOS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

// Parâmetros da análise de economia
const ECO = {
  recorrente: 0.6,     // aparece em ≥ 60% dos meses analisados
  acimaMedia: 0.15,    // mês de referência ≥ 15% acima da média do ano
  minDiff:    50,      // diferença mínima em R$ para virar alerta
  pontualMax: 0.4,     // aparece em ≤ 40% dos meses → gasto pontual
  pontualMin: 150,     // valor mínimo para destacar um pontual
  tendencia:  0.2,     // média dos últimos 3 meses ≥ 20% acima dos meses anteriores
};

let _sel = null;
let _filtroCartao = null;
let _sortCol = null;
let _sortDir = 'asc';
let _cartoesAtual = [];
let _rankAbertos = new Set();
let _rankTodas = false;
let _respAbertos = new Set();

export async function render(sel) {
  _sel = sel;
  _filtroCartao = null;
  _sortCol = null;
  _rankAbertos = new Set();
  _respAbertos = new Set();
  _rankTodas = false;
  await _renderAll();
}

async function _renderAll() {
  const el = document.getElementById('p2');
  el.innerHTML = `<div style="padding:40px;text-align:center"><div class="spinner"></div></div>`;

  const sel = _sel;
  const ano = sel.ano;
  const [anoRows, anoPrevRows, cartoesPRaw, cartoesYRaw] = await Promise.all([
    _queryAno(ano), _queryAno(String(+ano - 1)),
    _query(sel.prev?.meses), _query(sel.yago?.meses),
  ]);

  const filtroC = arr => _filtroCartao ? arr.filter(r => r.cartao === _filtroCartao) : arr;
  const noPeriodo = new Set(sel.meses);
  const cartoesTodos = anoRows.filter(r => noPeriodo.has(r.ano_mes));       // sem filtro de cartão
  const c   = filtroC(cartoesTodos);
  const cP  = filtroC(cartoesPRaw);
  const cY  = filtroC(cartoesYRaw);
  const anoF     = filtroC(anoRows);
  const anoPrevF = filtroC(anoPrevRows);
  _cartoesAtual = c;

  const ehAno  = sel.modo === 'ano';
  const soma   = arr => arr.reduce((a,r) => a + num(r.valor_parcela), 0);
  const total  = soma(c);
  const pagos  = soma(c.filter(r => r.pago === 'SIM'));
  const aberto = total - pagos;
  const prevT  = soma(cP);
  const yagoT  = soma(cY);
  const pLabel = sel.prev?.label || '';
  const yLabel = sel.yago?.label || '';

  // Terceiros (cartão emprestado)
  const terc       = c.filter(r => !ehCasa(r));
  const totTerc    = soma(terc);

  // Projeção: sempre a partir do último mês do período
  const cUlt     = c.filter(r => r.ano_mes === sel.ultimo);
  const pagosUlt = soma(cUlt.filter(r => r.pago === 'SIM'));
  const lblUlt   = ehAno ? `pago em ${mesNome(sel.ultimo).slice(0,3)}` : 'pago este mês';
  const futura   = cUlt.filter(r => num(r.restam) > 0).reduce((a,r) => a + num(r.valor_parcela) * num(r.restam), 0);
  const projecoes = [];
  for (let n = 1; n <= N_MESES_PROJECAO; n++) {
    const valor = soma(cUlt.filter(r => num(r.restam) >= n));
    projecoes.push({ ...(_mesFuturo(sel.ultimo, n)), valor });
  }

  // Cartão mais usado (sem filtro)
  const cartaoMap = {};
  cartoesTodos.forEach(r => {
    const k = r.cartao || 'Outros';
    if (!cartaoMap[k]) cartaoMap[k] = { cartao:k, valor:0, qtd:0 };
    cartaoMap[k].valor += num(r.valor_parcela);
    cartaoMap[k].qtd   += 1;
  });
  const cartaoTop = Object.values(cartaoMap).sort((a,b) => b.qtd - a.qtd)[0];
  const nomeCartao = n => (n || '').replace(' (David)','').replace(' (Vanessa)','');

  el.innerHTML = `
  <div class="sec">
    <div class="sec-title">Cartões — ${sel.titulo}
      ${_filtroCartao ? `<span style="font-size:11px;font-weight:600;color:var(--navy);margin-left:4px">· ${nomeCartao(_filtroCartao)}</span>
        <button onclick="window._p2Clear()" style="font-size:10px;background:none;border:1px solid var(--brd);border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--t3);margin-left:6px">✕ Limpar</button>` : ''}
    </div>
    <div class="kg">
      ${kpiHTML({ label:'Total faturas', valor:total, acc:'var(--navy)',
        comp:{ cur:total, prev:sel.prev?prevT:null, yago:sel.yago?yagoT:null, prevLabel:pLabel, yagoLabel:yLabel, inverted:true },
        sub:`${c.length} transações · ticket médio ${fmt(c.length ? total / c.length : 0)}` })}
      ${kpiHTML({ label:'Pago', valor:pagos, acc:'var(--gtxt)', badge:{cls:'bg',txt:'✓ Pago'}, sub:`${c.filter(r=>r.pago==='SIM').length} parcelas` })}
      ${kpiHTML({ label:'Em aberto', valor:aberto, acc:'var(--red)', badge:aberto>0?{cls:'br',txt:'Pendente'}:null, sub:`${c.filter(r=>r.pago!=='SIM').length} parcelas` })}
      ${kpiHTML({ label:'Compromisso futuro', valor:futura, acc:'var(--amber)', badge:{cls:'ba',txt:'Parcelas'},
        sub: ehAno ? `a partir de ${mesNome(sel.ultimo)} · próximas faturas` : 'total a pagar nas próximas faturas' })}
      ${kpiHTML({ label:'Terceiros (a receber)', valor:totTerc, acc:'var(--blue)',
        badge: totTerc > 0 ? { cls:'bb', txt:`${fmtPct(totTerc, total)} da fatura` } : null,
        sub:`${terc.length} compras de ${new Set(terc.map(r=>r.responsavel)).size} pessoa(s)` })}
      <div class="kpi" style="--acc:var(--purple)">
        <div class="k-lbl">Cartão mais usado</div>
        <div class="k-val" style="font-size:16px">${nomeCartao(cartaoTop?.cartao) || '—'}</div>
        <div class="k-sub">${cartaoTop ? `${cartaoTop.qtd} transações · ${fmt(cartaoTop.valor)}` : 'Sem dados no período'}</div>
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Evolução das faturas — ${ano}</div>
    <div class="cc">
      <h3>Fatura mês a mês ${_filtroCartao ? `· ${nomeCartao(_filtroCartao)}` : ''}</h3>
      <div class="csub">Valor de cada fatura no ano${anoPrevF.length ? ` e linha de ${+ano - 1} para comparar` : ''}${!ehAno ? ` · ${sel.label} em destaque` : ''}</div>
      <div class="ch"><canvas id="chEvo2"></canvas></div>
      <div class="tw evo-tw"><table class="evo"><thead id="thEvo2"></thead><tbody id="tbEvo2"></tbody></table></div>
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
        <h3>Parcelas que ainda vêm pela frente</h3>
        <div class="csub">Projeção com base nas parcelas restantes de ${mesNome(sel.ultimo)}, comparada ao ${lblUlt} · não considera compras novas</div>
        <div class="ch"><canvas id="chProj2"></canvas></div>
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Por responsável</div>
    <div class="tcard">
      <div class="tbar">
        <h3>Quem usou o cartão <span style="font-size:10px;font-weight:500;color:var(--t3)">(clique em + para ver as compras)</span></h3>
        <span class="resp-legend"><span class="badge bg">Casa</span> ${RESP_CASA.join(', ')} &nbsp; <span class="badge bb">Terceiro</span> cartão emprestado</span>
      </div>
      <div id="respResumo"></div>
      <div class="tw" style="max-height:none"><table class="resp"><thead id="thResp2"></thead><tbody id="tbResp2"></tbody></table></div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Ranking de categorias — mais usadas</div>
    <div class="rank-list" id="rankGrid"></div>
  </div>

  <div class="sec">
    <div class="sec-title">Oportunidades de economia — análise do ano</div>
    <div id="ecoBox"></div>
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

  // ── Evolução do ano ──
  _renderEvolucao(anoF, anoPrevF);

  // ── Valor por cartão (barra horizontal, clicável) ──
  const bcS = Object.entries(Object.fromEntries(Object.entries(cartaoMap).map(([k,v]) => [k, v.valor])))
    .sort((a,b) => b[1]-a[1]);
  mkC('chCC2', {
    type: 'bar',
    data: { labels: bcS.map(([n]) => nomeCartao(n)), datasets: [{ data: bcS.map(([,v])=>cent(v)), backgroundColor: PAL, borderRadius: 6, borderWidth: 0 }] },
    plugins: [rotulosBarra({ fonte: 11 })],
    options: {
      layout: { padding: { right: 90 } },
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      onClick: (e, els) => { if (els.length) { _filtroCartao = bcS[els[0].index][0]; _renderAll(); } },
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c=>' '+fmt(c.raw) } } },
      scales: { x:{ ticks:{callback:v=>fmtK(v),font:{size:10}}, grid:{color:'#f0f0f0'} }, y:{ ticks:{font:{size:10}}, grid:{display:false} } },
    },
  });

  // ── Projeção ──
  mkC('chProj2', { type:'bar',
    data: {
      labels: [ehAno ? `Pago ${mesNome(sel.ultimo).slice(0,3)}` : 'Pago este mês', ...projecoes.map(p=>p.label)],
      datasets: [{
        data: [cent(pagosUlt), ...projecoes.map(p=>cent(p.valor))],
        backgroundColor: [COR_PAGO, ...projecoes.map(()=>COR_PROJETADO)],
        borderRadius: 6, borderWidth: 0,
      }],
    },
    plugins: [rotulosBarra()],
    options: { ...barOpts(), layout: { padding: { top: 18 } } } });

  _renderResponsaveis(c, cUlt, total);
  _renderRanking(c);
  _renderEconomia(anoRows.filter(r => r.ano_mes <= sel.ultimo), sel.ultimo);

  window._p2Clear  = () => { _filtroCartao = null; _renderAll(); };
  window._p2Search = () => _renderTabela();
  _renderTabela();
}

// ─── Evolução das faturas no ano (meses em colunas) ──────────────────────────
function _renderEvolucao(anoRows, anoPrevRows) {
  const ano  = _sel.ano;
  const porMes = (rows) => {
    const m = {}; rows.forEach(r => { m[r.ano_mes] = (m[r.ano_mes] || 0) + num(r.valor_parcela); }); return m;
  };
  const atual = porMes(anoRows);
  const prev  = porMes(anoPrevRows);
  const cols  = MESES_CURTOS.map((_, i) => String(i + 1).padStart(2, '0'));
  const kA    = n => `${ano}-${n}`;
  const kP    = n => `${+ano - 1}-${n}`;
  const temMes = n => atual[kA(n)] != null;
  const destaque = _sel.modo === 'mes' ? _sel.ultimo : null;

  mkC('chEvo2', {
    type: 'bar',
    data: {
      labels: MESES_CURTOS,
      datasets: [
        { type:'bar', label:String(ano), data: cols.map(n => temMes(n) ? cent(atual[kA(n)]) : null),
          backgroundColor: cols.map(n => kA(n) === destaque ? COR_ANO_SEL : COR_ANO), borderRadius: 6, borderWidth: 0, order: 2 },
        ...(anoPrevRows.length ? [{ type:'line', label:String(+ano - 1),
          data: cols.map(n => prev[kP(n)] != null ? cent(prev[kP(n)]) : null),
          borderColor: COR_ANO_PREV, backgroundColor: COR_ANO_PREV, borderDash:[4,4], pointRadius:3, spanGaps:true, order: 1 }] : []),
      ],
    },
    plugins: [rotulosBarra({ fonte: 9, datasets: [0] })],
    options: { ...barOpts({ legend: anoPrevRows.length ? { display:true, position:'bottom', labels:{ font:{size:10}, boxWidth:10 } } : { display:false } }),
               layout: { padding: { top: 18 } } },
  });

  // Tabela: Fatura | Variação R$ | Variação % — meses em colunas
  let anterior = null;
  const linhaVal = [], linhaR = [], linhaP = [];
  cols.forEach(n => {
    const k = kA(n);
    const cls = k === destaque ? ' sel' : '';
    if (!temMes(n)) { linhaVal.push(`<td class="tr vazio${cls}">—</td>`); linhaR.push(`<td class="tr vazio${cls}">—</td>`); linhaP.push(`<td class="tr vazio${cls}">—</td>`); anterior = null; return; }
    const v = atual[k];
    linhaVal.push(`<td class="tr bold${cls}">${fmt(v)}</td>`);
    if (anterior == null) { linhaR.push(`<td class="tr${cls}" style="color:var(--t3)">—</td>`); linhaP.push(`<td class="tr${cls}" style="color:var(--t3)">—</td>`); }
    else {
      const d = v - anterior;
      const c2 = d > 0.004 ? 'neg' : d < -0.004 ? 'pos' : '';
      const s  = d > 0.004 ? '▲ ' : d < -0.004 ? '▼ ' : '';
      linhaR.push(`<td class="tr ${c2}${cls}">${s}${fmt(Math.abs(d))}</td>`);
      linhaP.push(`<td class="tr ${c2}${cls}">${anterior > 0 ? s + Math.abs(d / anterior * 100).toFixed(1) + '%' : '—'}</td>`);
    }
    anterior = v;
  });
  const meses   = cols.filter(temMes);
  const totAno  = meses.reduce((a,n) => a + atual[kA(n)], 0);
  const media   = meses.length ? totAno / meses.length : 0;

  document.getElementById('thEvo2').innerHTML = `<tr><th></th>${MESES_CURTOS.map((m,i) =>
    `<th class="tr ${temMes(cols[i])?'':'vazio'} ${kA(cols[i])===destaque?'sel':''}">${m}</th>`).join('')}<th class="tr c-tot">Total</th><th class="tr c-tot">Média</th></tr>`;
  document.getElementById('tbEvo2').innerHTML = `
    <tr><td class="bold">Fatura</td>${linhaVal.join('')}<td class="tr c-tot">${fmt(totAno)}</td><td class="tr c-tot">${fmt(media)}</td></tr>
    <tr><td>Variação R$ <span class="hint">vs mês anterior</span></td>${linhaR.join('')}<td class="c-tot"></td><td class="c-tot"></td></tr>
    <tr><td>Variação %</td>${linhaP.join('')}<td class="c-tot"></td><td class="c-tot"></td></tr>`;
}

// ─── Quadro por responsável (casa x terceiros) ───────────────────────────────
function _renderResponsaveis(c, cUlt, total) {
  const mapa = {};
  c.forEach(r => {
    const k = (r.responsavel || 'Sem responsável').trim();
    if (!mapa[k]) mapa[k] = { nome:k, casa: ehCasa(r), qtd:0, valor:0, aberto:0, futuro:0, compras:[] };
    const m = mapa[k];
    m.qtd++; m.valor += num(r.valor_parcela);
    if (r.pago !== 'SIM') m.aberto += num(r.valor_parcela);
    m.compras.push(r);
  });
  // Parcelas futuras: a partir do último mês do período
  cUlt.forEach(r => {
    const k = (r.responsavel || 'Sem responsável').trim();
    if (mapa[k] && num(r.restam) > 0) mapa[k].futuro += num(r.valor_parcela) * num(r.restam);
  });
  const linhas = Object.values(mapa).sort((a,b) => (a.casa - b.casa) || b.valor - a.valor);  // terceiros primeiro

  const terc = linhas.filter(l => !l.casa);
  const tT   = terc.reduce((a,l) => a + l.valor, 0);
  const tAb  = terc.reduce((a,l) => a + l.aberto, 0);
  const tFut = terc.reduce((a,l) => a + l.futuro, 0);
  document.getElementById('respResumo').innerHTML = terc.length ? `
    <div class="resp-resumo">
      <b>Terceiros no período:</b> ${fmt(tT)} (${fmtPct(tT, total)} da fatura) em ${terc.reduce((a,l)=>a+l.qtd,0)} compras
      · ${fmt(tAb)} em faturas ainda abertas
      ${tFut > 0 ? `· <b>${fmt(tFut)}</b> ainda em parcelas futuras` : ''}
    </div>` : `<div class="resp-resumo">Nenhuma compra de terceiros no período.</div>`;

  document.getElementById('thResp2').innerHTML = `<tr>
    <th style="width:28px"></th><th>Responsável</th><th>Grupo</th><th class="tc">Compras</th>
    <th class="tr">Valor no período</th><th class="tr">% da fatura</th><th class="tr">Em aberto</th><th class="tr">Parcelas futuras</th></tr>`;

  const tb = document.getElementById('tbResp2');
  tb.innerHTML = linhas.map(l => {
    const aberto = _respAbertos.has(l.nome);
    let h = `<tr class="row-click resp-row${aberto?' row-active':''}" data-r="${l.nome.replace(/"/g,'&quot;')}">
      <td class="tc"><span class="exp-btn">${aberto ? '−' : '+'}</span></td>
      <td class="bold">${l.nome}</td>
      <td><span class="badge ${l.casa ? 'bg' : 'bb'}">${l.casa ? 'Casa' : 'Terceiro'}</span></td>
      <td class="tc">${l.qtd}</td>
      <td class="tr bold">${fmt(l.valor)}</td>
      <td class="tr" style="color:var(--t3)">${fmtPct(l.valor, total)}</td>
      <td class="tr ${l.aberto > 0 ? 'neg' : ''}">${fmt(l.aberto)}</td>
      <td class="tr">${l.futuro > 0 ? fmt(l.futuro) : '<span style="color:var(--t3)">—</span>'}</td></tr>`;
    if (aberto) h += `<tr class="det-row"><td></td><td colspan="7">${_listaCompras(l.compras, ['ano_mes','categoria','descricao','cartao','parcela','valor_parcela','pago'])}</td></tr>`;
    return h;
  }).join('') || `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--t3)">Nenhum registro</td></tr>`;

  tb.querySelectorAll('tr.resp-row').forEach(tr => tr.addEventListener('click', () => {
    const k = tr.dataset.r;
    _respAbertos.has(k) ? _respAbertos.delete(k) : _respAbertos.add(k);
    _renderResponsaveis(c, cUlt, total);
  }));
}

// ─── Ranking de categorias com detalhe expansível ────────────────────────────
function _renderRanking(c) {
  const mapa = {};
  c.forEach(r => {
    const k = r.categoria || 'Outros';
    if (!mapa[k]) mapa[k] = { categoria:k, valor:0, qtd:0, compras:[] };
    mapa[k].valor += num(r.valor_parcela);
    mapa[k].qtd   += 1;
    mapa[k].compras.push(r);
  });
  const todas = Object.values(mapa).sort((a,b) => b.valor - a.valor);
  const total = todas.reduce((a,r) => a + r.valor, 0);
  const lista = _rankTodas ? todas : todas.slice(0, 5);

  const grid = document.getElementById('rankGrid');
  grid.innerHTML = lista.length ? lista.map((r,i) => {
    const aberto = _rankAbertos.has(r.categoria);
    return `<div class="rank-wrap">
      <div class="rank-item rank-click" data-cat="${r.categoria.replace(/"/g,'&quot;')}">
        <span class="exp-btn">${aberto ? '−' : '+'}</span>
        <div class="rank-pos rp-${Math.min(i+1,4)}">${i+1}</div>
        <div class="rank-info">
          <div class="rank-name">${catIcon(r.categoria)} ${r.categoria}</div>
          <div class="rank-sub">${r.qtd} transaç${r.qtd===1?'ão':'ões'} · ${fmtPct(r.valor, total)} da fatura</div>
        </div>
        <div class="rank-val">${fmt(r.valor)}</div>
      </div>
      ${aberto ? `<div class="rank-det">${_listaCompras(r.compras, ['ano_mes','descricao','cartao','responsavel','parcela','valor_parcela'])}</div>` : ''}
    </div>`;
  }).join('') + (todas.length > 5 ? `
    <button class="rank-more" id="rankMore">${_rankTodas ? 'Mostrar só as 5 maiores' : `Mostrar todas as ${todas.length} categorias`}</button>` : '')
  : '<p class="insight-empty">Sem lançamentos no período</p>';

  grid.querySelectorAll('.rank-click').forEach(d => d.addEventListener('click', () => {
    const k = d.dataset.cat;
    _rankAbertos.has(k) ? _rankAbertos.delete(k) : _rankAbertos.add(k);
    _renderRanking(c);
  }));
  document.getElementById('rankMore')?.addEventListener('click', () => { _rankTodas = !_rankTodas; _renderRanking(c); });
}

// Mini-tabela de compras usada nos detalhes expansíveis
function _listaCompras(compras, cols) {
  const LBL = { ano_mes:'Mês', categoria:'Categoria', descricao:'Descrição', cartao:'Cartão', responsavel:'Responsável',
                parcela:'Parcela', valor_parcela:'Valor', pago:'Pago?' };
  const linhas = [...compras].sort((a,b) => (b.ano_mes||'').localeCompare(a.ano_mes||'') || num(b.valor_parcela) - num(a.valor_parcela));
  const cel = (r, col) => {
    if (col === 'valor_parcela') return `<td class="tr bold">${fmt(r.valor_parcela)}</td>`;
    if (col === 'parcela') return `<td class="tc">${num(r.total_parcelas) > 1 ? `${r.parcela_atual}/${r.total_parcelas}` : 'à vista'}</td>`;
    if (col === 'pago') return `<td class="tc"><span class="status-pill-sm ${r.pago==='SIM'?'s-sim':'s-nao'}">${r.pago==='SIM'?'✓ Pago':'✗ Pend.'}</span></td>`;
    if (col === 'cartao') return `<td>${(r.cartao||'—').replace(' (David)','').replace(' (Vanessa)','')}</td>`;
    const v = r[col] ?? '—'; const s = String(v);
    return `<td>${s.length > 40 ? s.slice(0,40) + '…' : s}</td>`;
  };
  return `<table class="mini"><thead><tr>${cols.map(c => `<th class="${c==='valor_parcela'?'tr':c==='parcela'||c==='pago'?'tc':''}">${LBL[c]}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map(r => `<tr>${cols.map(col => cel(r, col)).join('')}</tr>`).join('')}</tbody></table>`;
}

// ─── Oportunidades de economia: análise no contexto do ano ───────────────────
// Considera só gastos da casa (terceiros ficam fora) e todos os meses do ano
// até o mês de referência. Separa o que é aumento real (categoria recorrente
// acima da própria média) do que é compra pontual, que não indica tendência.
function _renderEconomia(rowsAno, ref) {
  const box   = document.getElementById('ecoBox');
  const rows  = rowsAno.filter(ehCasa);
  const meses = [...new Set(rowsAno.map(r => r.ano_mes))].sort();
  const N     = meses.length;
  const refNome = mesNome(ref);

  if (N < 3) {
    box.innerHTML = `<div class="insight-card"><p class="insight-empty">A análise precisa de pelo menos 3 meses carregados em ${_sel.ano} (há ${N}). Assim que entrarem mais faturas, ela aparece aqui.</p></div>`;
    return;
  }

  const soma = arr => arr.reduce((a,r) => a + num(r.valor_parcela), 0);
  const fatMes = {}; meses.forEach(m => fatMes[m] = 0);
  rows.forEach(r => fatMes[r.ano_mes] += num(r.valor_parcela));
  const totAno   = soma(rows);
  const mediaFat = totAno / N;
  const fatRef   = fatMes[ref] || 0;
  const tercRef  = soma(rowsAno.filter(r => r.ano_mes === ref && !ehCasa(r)));
  const tercAno  = soma(rowsAno.filter(r => !ehCasa(r)));

  // Por categoria
  const cats = {};
  rows.forEach(r => {
    const k = r.categoria || 'Outros';
    if (!cats[k]) cats[k] = { cat:k, porMes:{}, total:0, comprasRef:[] };
    cats[k].porMes[r.ano_mes] = (cats[k].porMes[r.ano_mes] || 0) + num(r.valor_parcela);
    cats[k].total += num(r.valor_parcela);
    if (r.ano_mes === ref) cats[k].comprasRef.push(r);
  });
  const ult3 = meses.slice(-3), antes = meses.slice(0, -3);
  const lista = Object.values(cats).map(k => {
    const presentes = meses.filter(m => k.porMes[m]).length;
    const atual = k.porMes[ref] || 0;
    const media = k.total / N;
    const m3  = ult3.reduce((a,m) => a + (k.porMes[m] || 0), 0) / ult3.length;
    const mAn = antes.length ? antes.reduce((a,m) => a + (k.porMes[m] || 0), 0) / antes.length : null;
    return { ...k, presentes, rec: presentes / N, atual, media, m3, mAn,
             parcRef: k.comprasRef.filter(r => num(r.total_parcelas) > 1).reduce((a,r)=>a+num(r.valor_parcela),0) };
  });

  const recorrentes = lista.filter(k => k.rec >= ECO.recorrente);
  const agir = recorrentes
    .filter(k => k.atual >= k.media * (1 + ECO.acimaMedia) && k.atual - k.media >= ECO.minDiff)
    .sort((a,b) => (b.atual - b.media) - (a.atual - a.media));
  const tendencia = N >= 4 ? recorrentes
    .filter(k => k.mAn != null && k.m3 >= k.mAn * (1 + ECO.tendencia) && k.m3 - k.mAn >= ECO.minDiff)
    .sort((a,b) => (b.m3 - b.mAn) - (a.m3 - a.mAn)) : [];
  const pontuais = lista
    .filter(k => k.rec <= ECO.pontualMax && k.atual >= ECO.pontualMin)
    .sort((a,b) => b.atual - a.atual);
  const abaixo = recorrentes
    .filter(k => k.atual <= k.media * (1 - ECO.acimaMedia) && k.media - k.atual >= ECO.minDiff)
    .sort((a,b) => (b.media - b.atual) - (a.media - a.atual));
  const potencial = agir.reduce((a,k) => a + (k.atual - k.media), 0);

  // Composição da fatura de referência
  const refRows   = rows.filter(r => r.ano_mes === ref);
  const vParc     = soma(refRows.filter(r => num(r.total_parcelas) > 1));
  const catsRec   = new Set(recorrentes.map(k => k.cat));
  const vRec      = soma(refRows.filter(r => num(r.total_parcelas) <= 1 && catsRec.has(r.categoria || 'Outros')));
  const vPont     = fatRef - vParc - vRec;
  const maxRestam = Math.max(0, ...refRows.map(r => num(r.restam)));

  // Cobranças que se repetem (mesma descrição, à vista, em ≥ 3 meses)
  const desc = {};
  rows.filter(r => num(r.total_parcelas) <= 1).forEach(r => {
    const k = (r.descricao || '').trim().toLowerCase();
    if (!k) return;
    if (!desc[k]) desc[k] = { nome:r.descricao.trim(), cat:r.categoria, meses:new Set(), total:0 };
    desc[k].meses.add(r.ano_mes); desc[k].total += num(r.valor_parcela);
  });
  const repet = Object.values(desc).filter(d => d.meses.size >= 3)
    .map(d => ({ ...d, mensal: d.total / d.meses.size }))
    .sort((a,b) => b.mensal - a.mensal);
  const repetMes = repet.reduce((a,d) => a + d.mensal, 0);

  const dRef = fatRef - mediaFat;
  const pct  = (a, b) => b > 0 ? Math.abs(a / b * 100).toFixed(0) + '%' : '—';
  const seta = d => d > 0 ? '▲' : '▼';

  const itemCat = (k, texto, valor, cls) => `
    <div class="eco-item">
      <div class="eco-ico">${catIcon(k.cat)}</div>
      <div class="eco-txt"><b>${k.cat}</b> ${texto}</div>
      <div class="eco-val ${cls}">${valor}</div>
    </div>`;

  box.innerHTML = `
  <div class="eco-head">
    <div class="eco-stat">
      <div class="k-lbl">Fatura média em ${_sel.ano} (casa)</div>
      <div class="eco-big">${fmt(mediaFat)}<span>/mês</span></div>
      <div class="k-sub">${N} meses analisados (${mesNome(meses[0]).slice(0,3)} a ${refNome.slice(0,3)})</div>
    </div>
    <div class="eco-stat">
      <div class="k-lbl">${refNome} vs média</div>
      <div class="eco-big ${dRef > 0 ? 'neg' : 'pos'}">${seta(dRef)} ${fmt(Math.abs(dRef))}</div>
      <div class="k-sub">fatura da casa ${fmt(fatRef)} · ${pct(dRef, mediaFat)} ${dRef > 0 ? 'acima' : 'abaixo'} da média</div>
    </div>
    <div class="eco-stat">
      <div class="k-lbl">Potencial de economia</div>
      <div class="eco-big ${potencial > 0 ? 'amb' : 'pos'}">${fmt(potencial)}<span>/mês</span></div>
      <div class="k-sub">${potencial > 0 ? `se as categorias recorrentes acima da média voltarem à média · ≈ ${fmt(potencial * 12)}/ano` : 'nenhuma categoria recorrente acima da média'}</div>
    </div>
    <div class="eco-stat">
      <div class="k-lbl">Composição de ${refNome}</div>
      <div class="eco-bar">
        <span style="width:${fatRef ? vRec/fatRef*100 : 0}%;background:var(--navy2)" title="Recorrente"></span>
        <span style="width:${fatRef ? vParc/fatRef*100 : 0}%;background:var(--amber)" title="Parcelas"></span>
        <span style="width:${fatRef ? Math.max(vPont,0)/fatRef*100 : 0}%;background:var(--purple)" title="Pontual"></span>
      </div>
      <div class="k-sub eco-leg">
        <span><i style="background:var(--navy2)"></i>Recorrente ${pct(vRec, fatRef)}</span>
        <span><i style="background:var(--amber)"></i>Parcelas ${pct(vParc, fatRef)}</span>
        <span><i style="background:var(--purple)"></i>Pontual ${pct(Math.max(vPont,0), fatRef)}</span>
      </div>
    </div>
  </div>

  <div class="eco-grid">
    <div class="eco-card eco-alerta">
      <h4>🎯 Onde agir — recorrentes acima da média</h4>
      <p class="eco-desc">Categorias que aparecem em quase todos os meses e em ${refNome} ficaram acima da média do ano. Aqui está o aumento real, não uma compra isolada.</p>
      ${agir.length ? agir.map(k => itemCat(k,
          `${fmt(k.atual)} em ${refNome.slice(0,3)} vs média de ${fmt(k.media)} · aparece em ${k.presentes}/${N} meses${k.parcRef > 0 ? ` · ${fmt(k.parcRef)} são parcelas` : ''}`,
          `+${fmt(k.atual - k.media)}`, 'neg')).join('')
        : '<p class="insight-empty">Nenhuma categoria recorrente acima da média — bom sinal.</p>'}
    </div>

    <div class="eco-card">
      <h4>📈 Tendência de alta — últimos 3 meses</h4>
      <p class="eco-desc">Média de ${ult3.map(m => mesNome(m).slice(0,3)).join('/')} comparada aos meses anteriores do ano. Mostra o que vem crescendo de forma contínua.</p>
      ${N < 4 ? '<p class="insight-empty">Precisa de pelo menos 4 meses para medir tendência.</p>'
        : tendencia.length ? tendencia.slice(0, 5).map(k => itemCat(k,
          `média ${fmt(k.m3)}/mês nos últimos 3 meses vs ${fmt(k.mAn)}/mês antes`,
          `${seta(1)} ${pct(k.m3 - k.mAn, k.mAn)}`, 'neg')).join('')
        : '<p class="insight-empty">Nenhuma categoria em alta contínua.</p>'}
    </div>

    <div class="eco-card">
      <h4>🛍️ Pontuais em ${refNome} — não são tendência</h4>
      <p class="eco-desc">Gastos que aparecem em poucos meses do ano. Pesaram na fatura deste mês, mas não indicam um padrão.</p>
      ${pontuais.length ? pontuais.slice(0, 5).map(k => itemCat(k,
          `aparece em ${k.presentes}/${N} meses · ${k.comprasRef.length} compra(s) em ${refNome.slice(0,3)}${k.parcRef > 0 ? ` · ${fmt(k.parcRef)} parcelado` : ''}`,
          fmt(k.atual), 'amb')).join('')
        : '<p class="insight-empty">Nenhum gasto pontual relevante neste mês.</p>'}
    </div>

    <div class="eco-card">
      <h4>🔁 Cobranças que se repetem</h4>
      <p class="eco-desc">Mesma descrição, à vista, em 3 ou mais meses (assinaturas, mercado fixo, serviços). Vale revisar se todas ainda fazem sentido.</p>
      ${repet.length ? repet.slice(0, 6).map(d => `
        <div class="eco-item">
          <div class="eco-ico">${catIcon(d.cat)}</div>
          <div class="eco-txt"><b>${d.nome}</b> ${d.cat || ''} · ${d.meses.size}/${N} meses</div>
          <div class="eco-val">${fmt(d.mensal)}<small>/mês</small></div>
        </div>`).join('') + `<div class="eco-foot">Total ≈ ${fmt(repetMes)}/mês · ${fmt(repetMes * 12)}/ano</div>`
        : '<p class="insight-empty">Nenhuma cobrança repetida identificada.</p>'}
    </div>
  </div>

  <div class="eco-notas">
    ${abaixo.length ? `<div>✅ <b>Abaixo da média em ${refNome}:</b> ${abaixo.slice(0,4).map(k => `${k.cat} (${fmt(k.atual)} vs ${fmt(k.media)})`).join(' · ')}</div>` : ''}
    ${vParc > 0 ? `<div>📌 <b>Parcelas:</b> ${fmt(vParc)} (${pct(vParc, fatRef)}) da fatura de ${refNome} já estava comprometida com compras anteriores${maxRestam > 0 ? `; a última termina em ${maxRestam} mês(es)` : ''}.</div>` : ''}
    ${tercAno > 0 ? `<div>🤝 <b>Terceiros fora da análise:</b> ${fmt(tercRef)} em ${refNome} e ${fmt(tercAno)} no ano foram compras de outras pessoas no seu cartão.</div>` : ''}
  </div>`;
}

// ─── Tabela de transações ────────────────────────────────────────────────────
function _renderTabela() {
  const s = (document.getElementById('srch2')?.value || '').toLowerCase();
  const cols = ['ano_mes','categoria','descricao','cartao','valor_parcela','parcela_atual','restam','total_parcelas','pago','responsavel'];

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

// ─── Queries ──────────────────────────────────────────────────────────────────
async function _query(meses) {
  if (!meses?.length) return [];
  return selectTodos(() => sb.from('cartoes').select('*').in('ano_mes', meses)
    .order('ano_mes', { ascending:false }).order('cartao').order('categoria').order('id'));
}

// Todas as faturas de um ano (para evolução e análise de economia)
async function _queryAno(ano) {
  return selectTodos(() => sb.from('cartoes').select('*')
    .gte('ano_mes', `${ano}-01`).lte('ano_mes', `${ano}-12`)
    .order('ano_mes', { ascending:false }).order('cartao').order('categoria').order('id'));
}
