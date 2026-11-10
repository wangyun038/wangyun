const game = document.querySelector('#game');
const error = document.querySelector('#error');
const notice = document.querySelector('#notice');
const connection = document.querySelector('#connection');
const incoming = (new URL(location.href).searchParams.get('room') || '').trim().toUpperCase();
const validCode = code => /^[A-Z0-9]{6}$/.test(code);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const seatKey = code => 'undercover-seat-' + code;
const formValues = form => Object.fromEntries(new FormData(form));
let session, state, version = -1, busy = false, polling = false, revealed = false;
let mode = 'join';

function readSession() {
  try {
    const code = incoming || localStorage.getItem('undercover-last');
    const key = validCode(code) && localStorage.getItem(seatKey(code));
    return key ? { code, key } : null;
  } catch { return null; }
}

function remember(result) {
  session = { code: result.code, key: result.key };
  try {
    localStorage.setItem('undercover-last', result.code);
    localStorage.setItem(seatKey(result.code), result.key);
  } catch {}
}

async function api(path, body) {
  const response = await fetch('/api/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function apply(result) {
  if (result.version <= version) return;
  const samePhase = state && state.round === result.state.round && state.turn === result.state.turn && state.stage === result.state.stage;
  if (!state || state.round !== result.state.round) revealed = false;
  state = result.state;
  version = result.version;
  render(samePhase);
}

function renderHome(values = {}) {
  connection.textContent = '4–12 位玩家 · 1 位裁判';
  const joining = mode === 'join';
  game.innerHTML = `
    <section class="card entry">
      <div class="eyebrow">选择身份</div>
      <h2>你想怎么加入？</h2>
      <div class="actions">
        <button class="role" data-action="join" aria-pressed="${joining}">我是玩家</button>
        <button class="role" data-action="create" aria-pressed="${!joining}">我是裁判</button>
      </div>
      <form id="entry">
        <label>你的昵称<input name="name" maxlength="32" value="${escape(values.name)}" autocomplete="off" required></label>
        ${joining ? '<label>房间号<input name="code" maxlength="6" value="' + escape(values.code ?? incoming) + '" autocomplete="off" required></label>' : '<p class="muted">创建后，把邀请链接发给玩家。</p>'}
        <button class="primary">${joining ? '加入房间' : '创建房间'}</button>
      </form>
    </section>`;
}

function playerLabel(id) {
  const player = state.players.find(item => item.id === id);
  return player ? (player.number ? player.number + '号 ' : '') + player.name : '';
}

function playerOptions(ids) {
  return '<option value="">请选择</option>' + ids.map(id => '<option value="' + escape(id) + '">' + escape(playerLabel(id)) + '</option>').join('');
}

function renderLobby(host) {
  const count = state.players.length;
  return `<section class="card"><h2>等候开局</h2>
    <p class="muted">已加入 ${count} 位玩家 · 满 ${state.minPlayers} 人即可开始，最多 ${state.maxPlayers} 人。</p>
    ${host ? `<form id="start">
      <label>本局卧底（仅裁判可见）<select name="target" required>${playerOptions(state.players.map(player => player.id))}</select></label>
      <div class="fields">
        <label>平民词<input name="common" maxlength="48" placeholder="可留空"></label>
        <label>卧底词<input name="odd" maxlength="48" placeholder="可留空"></label>
      </div>
      <p class="help">两项都留空时，系统会随机抽词。裁判确认大家到齐后再开局。</p>
      <button class="primary"${count < state.minPlayers ? ' disabled' : ''}>开局并发词</button>
    </form>` : '<p>等待裁判分词并开局。</p>'}
  </section>`;
}

function renderWords(host) {
  if (host) return `<section class="card secret">
    <div class="eyebrow">仅裁判可见</div><h2>词语分配</h2>
    <p>卧底 <strong>${escape(playerLabel(state.undercover))}</strong></p>
    <p>平民词「${escape(state.common)}」 · 卧底词「${escape(state.odd)}」</p>
  </section>`;
  return `<section class="card"><div class="eyebrow">仅你可见 · 词卡</div>
    ${revealed ? '<div class="word">' + escape(state.word) + '</div>' : '<p class="muted">点击查看你的词语。</p>'}
    <button data-action="reveal">${revealed ? '收起词卡' : '查看词卡'}</button>
  </section>`;
}

function renderVoteDetails(votes) {
  if (!votes) return '';
  const voters = state.players.filter(player => Object.hasOwn(votes, player.id));
  if (!voters.length) return '';
  return '<h3>投票明细（仅裁判可见）</h3>' + voters.map(player =>
    '<div class="line"><strong>' + escape(playerLabel(player.id)) + '</strong>投给 ' +
    escape(playerLabel(votes[player.id])) + '</div>'
  ).join('');
}

function renderTurn(host) {
  const alive = state.players.filter(player => player.alive);
  const active = alive.some(player => player.id === state.role);
  const voting = state.stage === 'vote';
  let body;
  if (voting) {
    body = `<p class="muted">已投 ${alive.filter(player => player.voted).length} / ${alive.length} 票 · 收齐后公布</p>`;
    if (!host && !active) body += '<p>你已出局，可以继续观战。</p>';
    else if (state.myVote) body += '<p>你投给了 <strong>' + escape(playerLabel(state.myVote)) + '</strong>，等待其他玩家。</p>';
    else if (!host) body += `<form id="vote">
      <label>投给你怀疑的人<select name="target" required>${playerOptions(state.eligible.filter(id => id !== state.role))}</select></label>
      <button class="primary">确认投票</button>
    </form>`;
  } else if (state.speaker === state.role) {
    body = `<form id="speak"><label>轮到你发言<textarea name="text" rows="2" maxlength="400" placeholder="用一句话描述你的词（最多 200 字）" required></textarea></label>
      <button class="primary">发送发言</button>
    </form>`;
  } else {
    body = '<p>现在轮到 <strong>' + escape(playerLabel(state.speaker)) + '</strong> 发言。</p>';
    if (!host && !active) body += '<p class="muted">你已出局，可以继续观战。</p>';
  }
  return `<section class="card"><h2>第 ${state.turn} 轮 · ${voting ? '投票' : '发言'}</h2>${body}${voting && host ? renderVoteDetails(state.votes) : ''}</section>`;
}

function renderTranscript() {
  if (state.stage === 'lobby') return '';
  const turns = new Set([state.turn, ...state.speeches.map(entry => entry.turn), ...state.history.map(entry => entry.turn)]);
  return `<section class="card"><h2>发言与投票记录</h2>${[...turns].sort((a, b) => b - a).map(turn => {
    const speeches = state.speeches.filter(entry => entry.turn === turn);
    const result = state.history.find(entry => entry.turn === turn);
    const lines = speeches.map(entry => '<div class="line"><strong>' + escape(playerLabel(entry.player)) + '</strong>' + escape(entry.text) + '</div>').join('');
    const tally = result ? '<p><strong>' + (result.out ? escape(playerLabel(result.out)) + ' 出局' : '平票，下一轮重投') + '</strong></p><p class="muted">' +
      Object.entries(result.counts).map(([id, count]) => escape(playerLabel(id)) + ' ' + count + '票').join(' · ') + '</p>' : '';
    return '<div class="history"><strong>第 ' + turn + ' 轮</strong>' + (lines || '<p class="muted">暂无文字发言。</p>') + tally + renderVoteDetails(result?.votes) + '</div>';
  }).join('')}</section>`;
}

function renderEnd(host) {
  const winner = state.players.filter(player => (player.id === state.undercover) === (state.winner === '卧底'));
  const names = list => list.map(player => escape(playerLabel(player.id))).join('、');
  return `<section class="card">
    <div class="eyebrow">本局结果</div><h2>${state.winner}获胜</h2>
    <p><strong>获胜</strong>　${names(winner)}</p>
    <p><strong>落败</strong>　${names(state.players.filter(player => !winner.includes(player)))}</p>
    <p class="muted">卧底是 ${escape(playerLabel(state.undercover))} · 平民词「${escape(state.common)}」 · 卧底词「${escape(state.odd)}」</p>
    ${host ? '<button class="primary" data-action="next">进入下一局</button>' : '<p class="muted">等待裁判开启下一局。</p>'}
  </section>`;
}

function render(preserveForm = false) {
  if (!state) return renderHome();
  const prior = preserveForm && game.querySelector('form');
  const values = prior ? formValues(prior) : {};
  const activeField = prior && prior.contains(document.activeElement) ? document.activeElement : null;
  const selection = activeField && [activeField.selectionStart, activeField.selectionEnd];
  const host = state.role === 'host';
  const stage = { lobby:'等候开局', describe:'轮流发言', vote:'投票中', ended:'本局结束' }[state.stage];
  connection.textContent = '已连接 · ' + (host ? '裁判' : playerLabel(state.role));
  const seats = state.players.map(player => {
    const status = state.speaker === player.id ? '正在发言' : !player.alive ? '已淘汰' :
      state.stage === 'vote' ? (player.voted ? '已投票' : '待投票') : '已入座';
    const remove = host && state.stage === 'lobby' ? '<button class="compact" data-action="remove" data-target="' + escape(player.id) + '" aria-label="移除 ' + escape(player.name) + '">移除</button>' : '';
    return '<div class="seat ' + (player.id === state.role ? 'mine ' : '') + (state.speaker === player.id ? 'speaker ' : '') + (!player.alive ? 'out' : '') + '"><strong>' +
      escape(playerLabel(player.id)) + '</strong><small>' + status + '</small>' + remove + '</div>';
  }).join('');
  const panel = state.stage === 'lobby' ? renderLobby(host) : state.stage === 'ended' ? renderEnd(host) : renderWords(host) + renderTurn(host);
  game.innerHTML = `<section class="card">
    <div class="row spread"><div><span class="eyebrow">房间号</span> <strong class="room-code">${session.code}</strong>
    <p class="muted">第 ${state.round} 局 · ${stage} · 裁判 ${escape(state.hostName)}</p></div>
    <div class="actions"><button data-action="copy">复制邀请链接</button><button data-action="home">返回入口</button></div></div>
    ${seats ? '<div class="grid">' + seats + '</div>' : '<p class="muted">还没有玩家加入。</p>'}
  </section>` + panel + renderTranscript();
  const next = prior && game.querySelector('form');
  if (next && next.id === prior.id) {
    for (const [name, value] of Object.entries(values)) {
      const control = next.elements.namedItem(name);
      if (control && (control.tagName !== 'SELECT' || [...control.options].some(option => option.value === value))) control.value = value;
    }
    const field = activeField && next.elements.namedItem(activeField.name);
    if (field) {
      field.focus({ preventScroll: true });
      if (selection[0] != null) field.setSelectionRange(...selection);
    }
  }
}

function returnHome(clearSeat = false) {
  try {
    localStorage.removeItem('undercover-last');
    if (clearSeat && session) localStorage.removeItem(seatKey(session.code));
  } catch {}
  session = state = null;
  version = -1;
  revealed = false;
  renderHome();
}

async function refresh() {
  if (!session || busy || polling) return;
  const current = session;
  polling = true;
  try {
    const result = await api('state', current);
    if (session === current && !busy) {
      apply(result);
      connection.textContent = '已连接 · ' + (state.role === 'host' ? '裁判' : playerLabel(state.role));
    }
  } catch (err) {
    if (session !== current || busy) return;
    if ([401,404].includes(err.status)) {
      returnHome(true);
      error.textContent = err.status === 401 ? '你已离开这个房间，可以重新加入。' : err.message;
    } else connection.textContent = '正在尝试重连…';
  } finally { polling = false; }
}

function setBusy(value) {
  busy = value;
  game.querySelectorAll('button').forEach(button => {
    if (value && !button.disabled) { button.dataset.busy = '1'; button.disabled = true; }
    if (!value && button.dataset.busy) { delete button.dataset.busy; button.disabled = false; }
  });
}

async function perform(operation) {
  error.textContent = '';
  notice.textContent = '';
  setBusy(true);
  try { await operation(); }
  catch (err) { error.textContent = err.message; }
  finally { setBusy(false); }
}

const requestAction = (action, fields = {}) => api('action', {
  ...session, action, round: state.round, turn: state.turn, ...fields
});

game.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const fields = formValues(form);
  await perform(async () => {
    if (form.id !== 'entry') {
      apply(await requestAction(form.id, fields));
      return;
    }
    const code = (fields.code || '').trim().toUpperCase();
    let key;
    if (mode === 'join') try { key = localStorage.getItem(seatKey(code)); } catch {}
    const result = await api(mode, { ...fields, code, key });
    remember(result);
    version = -1;
    apply(result);
  });
});

game.addEventListener('click', async event => {
  const button = event.target.closest('button');
  const action = button?.dataset.action;
  if (!action || busy) return;
  error.textContent = '';
  notice.textContent = '';
  if (action === 'join' || action === 'create') {
    const values = formValues(game.querySelector('form'));
    mode = action;
    renderHome(values);
    game.querySelector('[aria-pressed="true"]').focus();
    return;
  }
  if (action === 'reveal') { revealed = !revealed; render(true); return; }
  if (action === 'home') { returnHome(); return; }
  if (action === 'copy') {
    const url = new URL('/', location.href);
    url.searchParams.set('room', session.code);
    try { await navigator.clipboard.writeText(url.href); notice.textContent = '邀请链接已复制。'; }
    catch { window.prompt('复制下面的邀请链接', url.href); }
    return;
  }
  await perform(async () => apply(await requestAction(action, { target: button.dataset.target })));
});

session = readSession();
renderHome();
if (session) refresh();
setInterval(refresh, 1800);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
