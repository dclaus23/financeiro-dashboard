import { sb, getMesesDisponiveis, montarSelecao } from './supabase-client.js';
import { mesNome, killCharts, isHidden, setHideValues } from './utils.js';
import { render as renderP1 } from './p1-gastos.js';
import { render as renderP2 } from './p2-cartoes.js';
import { render as renderP3 } from './p3-carteira.js';

let _disponiveis = [];    // 'AAAA-MM' com dados para a página atual
let _ano  = null;         // 'AAAA'
let _mes  = null;         // 'AAAA-MM' | 'ano' (= ano inteiro)
let _page      = 'p1';
let _user      = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  setDot('spin', 'Verificando sessão...');
  atualizarBotaoOlho();

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
    await carregarDisponiveis();
    if (!_disponiveis.length) {
      setDot('err', 'Sem dados — execute o ETL primeiro');
      showNoData();
      return;
    }
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

// ─── Filtros de período: Ano + Mês ────────────────────────────────────────────
// Busca os meses com dados para a página atual e ajusta a seleção para algo
// que exista nela (ex.: Carteira tem meses da B3 que Gastos não tem).
async function carregarDisponiveis() {
  _disponiveis = await getMesesDisponiveis(_page);
  if (!_disponiveis.length) { buildPeriodBar(); return; }
  const anos = _anos();
  if (!_ano || !anos.includes(_ano)) {
    _ano = anos[anos.length - 1];
    _mes = _mesesDoAno(_ano).at(-1);           // padrão: mês mais recente
  } else if (_mes !== 'ano' && !_disponiveis.includes(_mes)) {
    _mes = _escolherMes(_ano, _mes);
  }
  buildPeriodBar();
}

const _anos = () => [...new Set(_disponiveis.map(p => p.split('-')[0]))].sort();
const _mesesDoAno = ano => _disponiveis.filter(p => p.startsWith(ano + '-'));

// Ao trocar de ano: mantém "ano inteiro"; senão tenta o mesmo mês, senão o mais recente.
function _escolherMes(ano, mesAtual) {
  if (mesAtual === 'ano') return 'ano';
  const meses = _mesesDoAno(ano);
  const mesmoNum = mesAtual ? `${ano}-${mesAtual.split('-')[1]}` : null;
  return meses.includes(mesmoNum) ? mesmoNum : meses.at(-1);
}

function buildPeriodBar() {
  const el = document.getElementById('periodBtns');
  if (!_disponiveis.length) { el.innerHTML = ''; document.getElementById('pbarRight').textContent = ''; return; }
  const meses = _mesesDoAno(_ano);

  el.innerHTML = `
    <select class="pfsel" id="anoSelect" onchange="window.setAno(this.value)" title="Ano">
      ${_anos().map(a => `<option value="${a}" ${a===_ano?'selected':''}>${a}</option>`).join('')}
    </select>
    <select class="pfsel" id="mesSelect" onchange="window.setMes(this.value)" title="Mês">
      <option value="ano" ${_mes==='ano'?'selected':''}>Ano inteiro</option>
      ${meses.map(p => `<option value="${p}" ${_mes===p?'selected':''}>${mesNome(p)}</option>`).join('')}
    </select>`;

  const ultimo = _disponiveis.at(-1);
  document.getElementById('pbarRight').textContent =
    `${meses.length} mês(es) carregados em ${_ano} · último: ${mesNome(ultimo)} ${ultimo.split('-')[0]}`;
}

window.setAno = async (ano) => {
  _mes = _escolherMes(ano, _mes);
  _ano = ano;
  buildPeriodBar();
  killCharts();
  await renderPage();
};

window.setMes = async (mes) => {
  _mes = mes;
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
  setDot('spin', 'Carregando...');
  try { await carregarDisponiveis(); } catch (err) { console.error(err); }
  await renderPage();
};

async function renderPage() {
  setDot('spin', 'Carregando...');
  try {
    if (!_disponiveis.length) { setDot('err', 'Sem dados para esta página'); _semDadosPagina(); return; }
    const sel = montarSelecao(_ano, _mes === 'ano' ? null : _mes, _disponiveis);
    if (_page === 'p1') await renderP1(sel);
    else if (_page === 'p2') await renderP2(sel);
    else await renderP3(sel);
    setDot('ok', 'Atualizado');
  } catch(err) {
    setDot('err', 'Erro ao carregar');
    console.error(err);
  }
}

// ─── Modo privacidade (ocultar valores) ────────────────────────────────────────
function atualizarBotaoOlho() {
  const btn = document.getElementById('btnEye');
  if (!btn) return;
  btn.textContent = isHidden() ? '🙈' : '👁';
  btn.title = isHidden() ? 'Mostrar valores' : 'Ocultar valores (em toda a tela)';
  btn.classList.toggle('on', isHidden());
}

window.toggleHideValues = async () => {
  setHideValues(!isHidden());
  atualizarBotaoOlho();
  killCharts();
  await renderPage();
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setDot(s, t) {
  const d = document.getElementById('statusDot');
  d.className = 'dot' + (s==='spin'?' spin':s==='err'?' err':'');
  document.getElementById('statusTxt').textContent = t;
}

function _semDadosPagina() {
  document.getElementById(_page).innerHTML = `
    <div class="center-state">
      <div class="ico">📂</div>
      <h2>Nenhum mês carregado para esta página</h2>
      <p>Assim que o ETL enviar os dados, os períodos aparecem no filtro.</p>
    </div>`;
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
      await carregarDisponiveis();
    })
  .subscribe();

boot();
