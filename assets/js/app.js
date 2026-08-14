import { sb, getPeriodos } from './supabase-client.js';
import { mesNome, killCharts } from './utils.js';
import { render as renderP1 } from './p1-gastos.js';
import { render as renderP2 } from './p2-cartoes.js';
import { render as renderP3 } from './p3-carteira.js';

let _periodos  = [];
let _periodo   = null;   // 'AAAA-MM' | 'todos'
let _page      = 'p1';
let _user      = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  setDot('spin', 'Verificando sessão...');

  // Autenticação
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    showLogin();
    return;
  }
  _user = session.user;
  await afterLogin();
}

async function afterLogin() {
  setDot('spin', 'Carregando períodos...');
  document.getElementById('loginModal')?.remove();
  document.getElementById('appShell').style.display = 'block';

  try {
    _periodos = await getPeriodos();
    if (!_periodos.length) {
      setDot('err', 'Sem dados — execute o ETL primeiro');
      showNoData();
      return;
    }
    // Selecionar período mais recente por padrão
    _periodo = _periodos[_periodos.length - 1].ano_mes;
    buildPeriodBar();
    setDot('ok', 'Conectado');
    await renderPage();
  } catch(err) {
    setDot('err', err.message);
    console.error(err);
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginModal').style.display = 'flex';
}

document.getElementById('loginForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const pass  = document.getElementById('loginPass').value;
  const btn   = document.getElementById('loginBtn');

  btn.textContent = 'Entrando...'; btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    document.getElementById('loginError').textContent = error.message;
    btn.textContent = 'Entrar'; btn.disabled = false;
  } else {
    const { data: { session } } = await sb.auth.getSession();
    _user = session.user;
    await afterLogin();
  }
});

// ─── Barra de períodos ────────────────────────────────────────────────────────
function buildPeriodBar() {
  const el = document.getElementById('periodBtns');
  const maisRecente = _periodos[_periodos.length - 1];

  el.innerHTML = `
    <button class="pfbtn ${_periodo==='todos'?'active':''}" onclick="window.setPeriodo('todos')">Todos</button>
    ${_periodos.map(p => `
      <button class="pfbtn ${_periodo===p.ano_mes?'active':''}" onclick="window.setPeriodo('${p.ano_mes}')">
        ${mesNome(p.ano_mes)} ${p.ano}
      </button>
    `).join('')}`;

  document.getElementById('pbarRight').textContent =
    `${_periodos.length} mês(es) · último: ${mesNome(maisRecente.ano_mes)} ${maisRecente.ano}`;
}

window.setPeriodo = async (p) => {
  _periodo = p;
  buildPeriodBar();
  killCharts();
  await renderPage();
};

// ─── Navegação de páginas ─────────────────────────────────────────────────────
window.setPage = async (page, el) => {
  _page = page;
  document.querySelectorAll('.pg').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.page-content').forEach(d => d.style.display = 'none');
  document.getElementById(page).style.display = 'block';
  killCharts();
  await renderPage();
};

async function renderPage() {
  const p = _periodo === 'todos' ? _periodos[_periodos.length - 1]?.ano_mes : _periodo;
  setDot('spin', 'Carregando...');
  try {
    if (_page === 'p1') await renderP1(p);
    else if (_page === 'p2') await renderP2(p);
    else await renderP3(p);
    setDot('ok', 'Atualizado');
  } catch(err) {
    setDot('err', 'Erro ao carregar');
    console.error(err);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setDot(s, t) {
  const d = document.getElementById('statusDot');
  d.className = 'dot' + (s==='spin'?' spin':s==='err'?' err':'');
  document.getElementById('statusTxt').textContent = t;
}

function showNoData() {
  document.getElementById('p1').innerHTML = `
    <div class="center-state">
      <div class="ico">📂</div>
      <h2>Nenhum dado encontrado</h2>
      <p>Execute o ETL para carregar os arquivos Excel do OneDrive para o Supabase.</p>
      <code style="background:var(--surf);padding:8px 16px;border-radius:8px;font-size:12px;margin-top:8px">
        cd etl && node load-all.js
      </code>
    </div>`;
}

// Escuta atualizações em tempo real do Supabase
sb.channel('mudancas')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'arquivos_processados' },
    async () => {
      console.log('Novo arquivo detectado no banco — atualizando períodos...');
      _periodos = await getPeriodos();
      buildPeriodBar();
    })
  .subscribe();

boot();
