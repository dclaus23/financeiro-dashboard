// ─── Formatação ───────────────────────────────────────────────────────────────
export const fmt  = v => v == null || isNaN(+v) ? '—'
  : (+v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtK = v =>
  Math.abs(+v) >= 1000 ? 'R$' + (+v / 1000).toFixed(1) + 'k' : fmt(v);

export const fmtPct = (v, total) =>
  total > 0 ? ((+v / total) * 100).toFixed(1) + '%' : '—';

export const num = v => isNaN(+v) || v == null ? 0 : +v;

export const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

export const mesNome = anoMes => {
  if (!anoMes) return '';
  const mes = +anoMes.split('-')[1];
  return MESES[mes - 1] || '';
};

// ─── Paleta de cores ─────────────────────────────────────────────────────────
export const PAL = [
  '#002060','#1F4E79','#2E75B6','#9DC3E6',
  '#375623','#70AD47','#9C27B0','#CE93D8',
  '#C00000','#FF9800','#1565C0','#7F6000'
];

// ─── Chart helpers ────────────────────────────────────────────────────────────
let _charts = {};

export function mkC(id, cfg) {
  if (_charts[id]) { try { _charts[id].destroy(); } catch(e) {} }
  const el = document.getElementById(id);
  if (!el) return;
  _charts[id] = new Chart(el, cfg);
  return _charts[id];
}

export function killCharts() {
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch(e) {} });
  _charts = {};
}

// Opções comuns para gráficos de barra
export function barOpts(opts = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: opts.legend || { display: false },
      tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } },
    },
    scales: {
      y: { ticks: { callback: v => fmtK(v), font: { size: 10 } }, grid: { color: '#f0f0f0' } },
      x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      ...opts.scales,
    },
  };
}

// Opções comuns para gráficos de pizza/doughnut
export function doughnutOpts(total) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right', labels: { font: { size: 10 }, boxWidth: 10, padding: 6 } },
      tooltip: { callbacks: {
        label: c => ` ${fmt(c.raw)} (${fmtPct(c.raw, total)})`
      }},
    },
  };
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
export function kpiHTML({ label, valor, acc = 'var(--navy)', badge, sub, comp }) {
  return `
  <div class="kpi" style="--acc:${acc}">
    <div class="k-lbl">${label}</div>
    <div class="k-val">${fmt(valor)}</div>
    ${badge ? `<span class="badge ${badge.cls}">${badge.txt}</span>` : ''}
    ${comp ? compHTML(comp) : ''}
    ${sub ? `<div class="k-sub">${sub}</div>` : ''}
  </div>`;
}

function compHTML(comp) {
  let html = '';
  if (comp.prev != null) {
    const diff = comp.cur - comp.prev;
    const isPos = comp.inverted ? diff <= 0 : diff >= 0;
    html += `<div class="k-comp ${isPos ? 'up' : 'down'}">
      ${diff > 0 ? '▲' : '▼'} ${fmt(Math.abs(diff))} vs ${comp.prevLabel}
    </div>`;
  }
  if (comp.yago != null) {
    const diff = comp.cur - comp.yago;
    const isPos = comp.inverted ? diff <= 0 : diff >= 0;
    html += `<div class="k-comp ${isPos ? 'up' : 'down'}" style="margin-top:2px">
      ${diff > 0 ? '▲' : '▼'} ${fmt(Math.abs(diff))} vs ${comp.yagoLabel}
    </div>`;
  }
  return html;
}

// ─── Render de tabela genérica ────────────────────────────────────────────────
export function renderTable(thId, tbId, cols, rows, maxRows = 300) {
  const MO  = ['valor','valor_parcela','valor_bruto','valor_liquido','valor_total','valor_liq','preco_unit'];
  const SIM = ['pago','recebido'];
  const CTR = ['parcela_atual','total_parcelas','restam','quantidade','qtd_cotas'];

  const LABELS = {
    ano_mes:'Mês', categoria:'Categoria', descricao:'Descrição',
    responsavel:'Responsável', valor:'Valor', pago:'Pago?',
    tipo_gasto:'Tipo', cartao:'Cartão', valor_parcela:'Parcela',
    parcela_atual:'Parc.', total_parcelas:'Total', restam:'Rest.',
    valor_total:'Total Compra', valor_bruto:'Bruto', valor_liquido:'Líquido',
    tipo_provento:'Tipo', recebido:'Recebido?', ticker:'Ticker',
    classe_ativo:'Classe', operacao:'Operação', valor_liq:'Líquido',
    data_pgto:'Pagamento', tipo_evento:'Evento',
  };

  document.getElementById(thId).innerHTML =
    '<tr>' + cols.map(c => `<th>${LABELS[c] || c}</th>`).join('') + '</tr>';

  if (!rows.length) {
    document.getElementById(tbId).innerHTML =
      `<tr><td colspan="${cols.length}" style="padding:24px;text-align:center;color:var(--t3)">Nenhum registro</td></tr>`;
    return;
  }

  document.getElementById(tbId).innerHTML = rows.slice(0, maxRows).map(r =>
    '<tr>' + cols.map(col => {
      const v = r[col];
      if (SIM.includes(col)) {
        const s = v === 'SIM' ? 's-sim' : 's-nao';
        return `<td class="tc"><span class="status-pill-sm ${s}">${v === 'SIM' ? '✓ Pago' : '✗ Pend.'}</span></td>`;
      }
      if (MO.includes(col)) {
        const cls = num(v) < 0 ? 'neg' : '';
        return `<td class="tr bold ${cls}">${fmt(v)}</td>`;
      }
      if (CTR.includes(col)) return `<td class="tc">${v ?? '—'}</td>`;
      if (col === 'operacao') {
        const REND = ['Dividendo','JCP','Aluguel FII','Rendimento','Resgate'];
        const cls = v === 'Compra' ? 's-sim' : v === 'Venda' ? 's-nao' : 's-par';
        return `<td class="tc"><span class="status-pill-sm ${cls}">${v || '—'}</span></td>`;
      }
      const s = v != null ? String(v) : '—';
      return `<td>${s.length > 45 ? s.slice(0, 45) + '…' : s}</td>`;
    }).join('') + '</tr>'
  ).join('');
}

// ─── Ícones por categoria ────────────────────────────────────────────────────
const ICONS = {
  'Dízimo':'🙏', 'Internet':'📡', 'Celular':'📱', 'FIES':'🎓',
  'Assinatura':'📺', 'Água':'💧', 'Luz':'💡', 'Investimentos':'📈',
  'Mercado':'🛒', 'Farmácia':'💊', 'Uber':'🚗', 'RioCard':'🚌',
  'Academia':'🏋️', 'IASD':'⛪', 'Aluguel':'🏠', 'Gestação':'🤰',
  'Filho':'👶', 'Viagem':'✈️', 'Salão':'💇', 'Lanches':'🍽️',
};
export const catIcon = cat =>
  Object.entries(ICONS).find(([k]) => (cat || '').includes(k))?.[1] || '💸';
