const minPlayers = 4;
const maxPlayers = 12;
const pairs = [
  ['奶茶','咖啡'], ['橘子','橙子'], ['饺子','馄饨'], ['豆浆','牛奶'],
  ['薯片','薯条'], ['铅笔','蜡笔'], ['冰箱','冰柜'], ['电梯','扶梯'],
  ['玻璃杯','保温杯'], ['日历','手表'], ['熊猫','北极熊'], ['兔子','松鼠'],
  ['章鱼','鱿鱼'], ['海豚','鲸鱼'], ['火车','地铁'], ['公交车','校车'],
  ['围巾','领带'], ['手套','袜子'], ['滑板','滑板车'], ['电影','电视剧'],
  ['月饼','汤圆'], ['海浪','瀑布'], ['气球','泡泡'], ['足球','篮球'],
  ['门铃','闹钟'], ['地毯','瑜伽垫'], ['照片','油画'], ['书包','行李箱'],
  ['台灯','手电筒'], ['竹子','甘蔗'], ['马路','跑道'], ['地球仪','地图'],
  ['馒头','面包'], ['冰激凌','雪糕'], ['煎饼','蛋卷'], ['可乐','雪碧'],
  ['秋千','跷跷板'], ['滑雪','滑冰'], ['枕头','抱枕'], ['小溪','河流'],
  ['蝴蝶','蜻蜓'], ['公鸡','鸭子'], ['画笔','眉笔'], ['吉他','尤克里里'],
  ['浴巾','毛巾'], ['蜡烛','香薰'], ['排球','羽毛球'], ['番茄','柿子']
];
const ttl = 7 * 24 * 60 * 60 * 1000;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (data, status = 200) => Response.json(data, { status, headers });
const fail = (message, status = 400) => { throw { message, status }; };
const random = () => crypto.getRandomValues(new Uint32Array(1))[0];
const token = () => crypto.randomUUID() + crypto.randomUUID();

function readState(value) {
  const state = JSON.parse(value);
  if (state.players) return state;
  state.hostName = '裁判';
  state.players = Object.entries(state.seats).map(([name, key]) => ({ id: name, name, key }));
  state.order = state.players.map(player => player.id);
  state.speeches = [];
  state.turn += state.stage === 'describe' ? 1 : 0;
  state.eligible = state.eligible.filter(id => state.order.includes(id));
  state.alive = state.alive.filter(id => state.order.includes(id));
  state.words = pairs[state.pair] ?? null;
  delete state.seats;
  delete state.pair;
  return state;
}

function seat(state, key) {
  if (key === state.host) return 'host';
  return state.players.find(player => player.key === key)?.id;
}

function speaker(state) {
  if (state.stage !== 'describe') return null;
  const spoken = new Set(state.speeches.filter(entry => entry.turn === state.turn).map(entry => entry.player));
  return state.alive.find(id => !spoken.has(id)) ?? null;
}

function shuffle(ids) {
  for (let i = ids.length - 1; i > 0; i--) {
    const j = random() % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

function clean(value, limit, label) {
  if (typeof value !== 'string') fail('请输入' + label + '。');
  const result = value.trim();
  if (!result || [...result].length > limit || /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(result)) {
    fail(label + '须为 1–' + limit + ' 个字，且不能换行。');
  }
  return result;
}

function view(state, role) {
  const host = role === 'host';
  const [common, odd] = state.words ?? [];
  const order = state.stage === 'lobby' ? state.players.map(player => player.id) : state.order;
  const summary = {
    role, hostName: state.hostName, round: state.round, turn: state.turn, stage: state.stage,
    minPlayers, maxPlayers, speaker: speaker(state), speeches: state.speeches,
    players: order.map((id, index) => ({
      id, name: state.players.find(player => player.id === id).name,
      number: state.stage === 'lobby' ? null : index + 1,
      alive: state.stage === 'lobby' || state.alive.includes(id),
      voted: state.stage === 'vote' && !!state.votes[id]
    })),
    eligible: state.eligible,
    history: host ? state.history : state.history.map(({ turn, counts, tied, out }) => ({ turn, counts, tied, out })),
    winner: state.winner,
    myVote: state.votes[role] ?? null,
    word: host ? null : (role === state.undercover ? odd : common)
  };
  if (host && state.stage === 'vote') summary.votes = state.votes;
  if (host || state.stage === 'ended') {
    summary.undercover = state.undercover;
    summary.common = common;
    summary.odd = odd;
  }
  return summary;
}

function act(state, role, body) {
  const { action, target } = body;
  if (body.round !== state.round || body.turn !== state.turn) fail('游戏已进入新的轮次，请查看当前局面。', 409);
  if (action === 'speak') {
    if (!speaker(state) || speaker(state) !== role) fail('请等轮到你再发言。', 409);
    state.speeches.push({ turn: state.turn, player: role, text: clean(body.text, 200, '发言') });
    if (!speaker(state)) state.stage = 'vote';
    return;
  }
  if (action === 'vote') {
    if (state.stage !== 'vote') fail('当前未开放投票。', 409);
    if (!state.alive.includes(role) || role === target || !state.eligible.includes(target)) fail('请选择可以投票的其他玩家。');
    if (state.votes[role]) fail('你已经投过票了。', 409);
    state.votes[role] = target;
    if (state.alive.every(name => state.votes[name])) {
      const counts = Object.fromEntries(state.eligible.map(name => [name, 0]));
      for (const name of Object.values(state.votes)) counts[name]++;
      const highest = Math.max(...Object.values(counts));
      const tied = state.eligible.filter(name => counts[name] === highest);
      const out = tied.length === 1 ? tied[0] : null;
      state.history.unshift({ turn: state.turn, counts, tied, out, votes: { ...state.votes } });
      if (out) {
        state.alive = state.alive.filter(name => name !== out);
        if (out === state.undercover) state.winner = '平民';
        else if (state.alive.length <= 2) state.winner = '卧底';
      }
      state.stage = state.winner ? 'ended' : 'describe';
      state.eligible = out ? state.alive : tied;
      if (!state.winner) {
        state.turn++;
        state.votes = {};
      }
    }
    return;
  }
  if (role !== 'host') fail('这个操作由裁判执行。', 403);
  if (action === 'start' && state.stage === 'lobby') {
    if (state.players.length < minPlayers) fail('至少四位玩家入座后才能开局。');
    if (!state.players.some(player => player.id === target)) fail('请从房间里选择一位卧底。');
    if (body.common || body.odd) {
      const common = clean(body.common, 24, '平民词');
      const odd = clean(body.odd, 24, '卧底词');
      if (common.normalize('NFKC').toLowerCase() === odd.normalize('NFKC').toLowerCase()) fail('两个词需要不同。');
      state.words = [common, odd];
    } else {
      const available = pairs.map((_, index) => index).filter(index => !state.used.includes(index));
      if (!available.length) fail('随机词组已用完，请手动输入一组词。');
      const pair = available[random() % available.length];
      state.used.push(pair);
      state.words = pairs[pair];
    }
    state.undercover = target;
    state.order = shuffle(state.players.map(player => player.id));
    state.alive = [...state.order];
    state.eligible = [...state.order];
    state.turn = 1;
    state.stage = 'describe';
    return;
  }
  if (action === 'next' && state.stage === 'ended') {
    Object.assign(state, {
      stage: 'lobby', round: state.round + 1, turn: 0, words: null, undercover: null,
      votes: {}, history: [], winner: null, alive: [], eligible: [], order: [], speeches: []
    });
    return;
  }
  if (action === 'remove' && state.stage === 'lobby') {
    if (!state.players.some(player => player.id === target)) fail('该玩家已离开。', 409);
    state.players = state.players.filter(player => player.id !== target);
    return;
  }
  fail('当前阶段无法执行这个操作。', 409);
}

async function api(request, env, path) {
  if (request.method !== 'POST') return json({ error: '请求方式不正确。' }, 405);
  if (request.headers.has('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) fail('请从游戏网页操作。', 403);
  const raw = await request.text();
  if (raw.length > 4096) fail('请求过大。', 413);
  let body;
  try { body = JSON.parse(raw); } catch { fail('请求格式不正确。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求格式不正确。');
  const now = Date.now();
  if (path === '/api/create') {
    const state = {
      host: token(), hostName: clean(body.name, 16, '裁判昵称'), players: [], round: 1, turn: 0, stage: 'lobby',
      alive: [], eligible: [], order: [], votes: {}, history: [], speeches: [], used: []
    };
    await env.DB.prepare('DELETE FROM rooms WHERE touched < ?').bind(now - ttl).run();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = (random() % 2176782336).toString(36).toUpperCase().padStart(6, '0');
      const result = await env.DB.prepare('INSERT OR IGNORE INTO rooms VALUES (?, 0, ?, ?)').bind(code, JSON.stringify(state), now).run();
      if (result.meta.changes) return json({ code, key: state.host, state: view(state, 'host'), version: 0 });
    }
    fail('房间创建失败，请再试一次。', 503);
  }
  if (!['/api/join', '/api/state', '/api/action'].includes(path)) fail('页面不存在。', 404);
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6}$/.test(code)) fail('请输入六位房间号。');
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await env.DB.prepare('SELECT version, state FROM rooms WHERE code = ? AND touched >= ?').bind(code, now - ttl).first();
    if (!row) fail('房间不存在或已过期。', 404);
    const state = readState(row.state);
    let key = typeof body.key === 'string' && body.key ? body.key : null;
    let role = key ? seat(state, key) : null;
    if (path === '/api/join') {
      if (role && role !== 'host') return json({ code, key, state: view(state, role), version: row.version });
      if (role) fail('此浏览器已在这个房间入座。', 409);
      if (state.stage !== 'lobby') fail('本局已经开始。', 409);
      if (state.players.length >= maxPlayers) fail('房间已满。', 409);
      const name = clean(body.name, 16, '玩家昵称');
      const normalized = name.normalize('NFKC').toLowerCase();
      if (state.players.some(player => player.name.normalize('NFKC').toLowerCase() === normalized)) fail('这个昵称已被使用，请换一个。', 409);
      role = crypto.randomUUID();
      key = token();
      state.players.push({ id: role, name, key });
    } else {
      if (!role) fail('此浏览器没有这个座位的权限。', 401);
      if (path === '/api/state') return json({ state: view(state, role), version: row.version });
      act(state, role, body);
    }
    const result = await env.DB.prepare('UPDATE rooms SET version = version + 1, state = ?, touched = ? WHERE code = ? AND version = ?')
      .bind(JSON.stringify(state), now, code, row.version).run();
    if (result.meta.changes) return json({ code, key, state: view(state, role), version: row.version + 1 });
  }
  fail('其他玩家正在操作，请再试一次。', 409);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/') return new Response(page, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'" } });
    try { return await api(request, env, path); }
    catch (error) {
      if (error.status) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: '服务器暂时无法处理请求，请稍后再试。' }, 500);
    }
  }
};
