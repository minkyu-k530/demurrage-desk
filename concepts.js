/* 체선료 데스크 — 개념도·용어 사전·사용법·가이드 투어 (web/concepts.js)
 *
 * window.Concepts = { render(el, api), renderUsage(el, api), startTour(opts), tourDone(), glossary, term(word) }
 *  - api(path, opts): app.js가 넘겨 주는 호출 함수(서버·정적 Pyodide 모드 공통). 없으면 fetch('/api/…')를 쓴다.
 *  - 그림은 내장 예시(골든 케이스 TC-03·기준 시나리오)로 먼저 그리고, 엔진 응답이 오면 실제 값으로 바꾼다.
 *    아직 없는 엔드포인트(예: /api/resources)는 내장 그림을 그대로 둔다.
 *  - 외부 라이브러리 없음. 색은 styles.css 토큰을 써서 라이트·다크를 따라간다.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- 형식
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const arr = (x) => (Array.isArray(x) ? x : []);
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const pad = (n) => String(n).padStart(2, '0');
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';
  // 시각은 app.js와 같이 시간대 없는 'YYYY-MM-DDTHH:MM'으로 다룬다(UTC로 읽고 그대로 표시).
  const parseTs = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  };
  const fmtTs = (ms) => {
    if (ms == null) return '—';
    const d = new Date(ms);
    return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };
  const fmtHm = (ms) => { const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const usd = (v, signed) => {
    const n = num(v);
    if (n == null) return '—';
    const s = '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
    return n < 0 ? '−' + s : signed && n > 0 ? '+' + s : s;
  };
  const fmtH = (h) => {
    const n = num(h);
    if (n == null) return '—';
    const m = Math.round(n * 60);
    return m % 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m / 60}h`;
  };
  const pct = (x) => (num(x) == null ? '—' : `${Math.round(x * 1000) / 10}%`);
  const ruleChip = (id, status) => `<button type="button" class="rule-chip s-${esc(status || RULE_STATUS[id] || 'verify')}" data-rule="${esc(id)}" title="${esc(id)} — 눌러서 근거 보기">${esc(id)}</button>`;
  const chips = (ids) => arr(ids).map((id) => ruleChip(id)).join(' ');
  // 룰 상태(공개·확인 필요·가정·쟁점) — /api/rules가 오면 덮어쓴다
  const RULE_STATUS = {
    'ASB-05-LAYCAN': 'verify', 'ASB-06-NOR-START': 'verify', 'ASB-06-BERTH-DELAY-EXC': 'disputed', 'ASB-07-HOURS': 'verify', 'ASB-07-SHIFTING-EXCL': 'verify',
    'ASB-07-VESSEL-FAULT': 'verify', 'ASB-08-RATE-PRORATA': 'verify', 'ASB-08-HALF-RATE': 'verify', 'ASB-09-REACHABLE': 'verify', 'ASB-11-END-HOSES': 'verify',
    'LAW-NOR-ARRIVAL': 'verify', 'LAW-NOR-WAIVER': 'verify', 'LAW-ONCE-ON-DEM': 'disputed', 'RIDER-PUMPING': 'assumed', 'RIDER-TIMEBAR-90': 'assumed', 'RIDER-DOCS': 'assumed',
    'ULS-SBM-NIGHT': 'public', 'ULS-SK38-DAYTIME': 'public', 'ULS-DAYTIME-DEF': 'assumed', 'ULS-DWT-MAX': 'public', 'ULS-SBM-MIN-DWT': 'assumed', 'ULS-DRAFT-UKC': 'assumed',
    'ULS-LOA-MAX': 'assumed', 'ULS-CARGO-TYPE': 'public', 'ULS-WEATHER-LIMIT': 'assumed', 'BERTH-OOS': 'assumed', 'PLAN-DURATIONS': 'assumed', 'PLAN-TURNOVER': 'assumed',
    'PLAN-NOR-DELAY': 'assumed', 'PLAN-PUMP-RATE': 'assumed', 'ENG-LOW-MARGIN': 'assumed', 'ENG-DISPUTE-NO-AUTO': 'public', 'ENG-ETB-CHANGE': 'assumed', 'ENG-RECONCILE': 'assumed',
  };
  const RULE_TITLE = {};
  // 엔진에서 읽는 개수(룰 수 ← /api/rules, 시나리오 수 ← /api/validation). 응답이 오면 화면의 같은 숫자를 모두 바꾼다
  const COUNTS = { rules: 47, scenarios: 17 };
  const cnt = (k) => `<span data-cx-count="${k}">${COUNTS[k]}</span>`;
  const fillCounts = (html) => String(html).replace(/\{(rules|scenarios)\}/g, (_, k) => cnt(k));
  function setCount(k, n) {
    if (!(n > 0) || COUNTS[k] === n) return;
    COUNTS[k] = n;
    document.querySelectorAll(`[data-cx-count="${k}"]`).forEach((e) => { e.textContent = String(n); });
  }
  const smooth =() => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

  // ---------------------------------------------------------------- 링크 (#t=…&tab=…&item=…&call=…)
  function hashFor(params) {
    const p = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') p.set(k, v); });
    return '#' + p.toString().replace(/%3A/g, ':');
  }
  // t를 적지 않으면 app.js가 지금 시각을 그대로 둔다
  const hashLink = (params, label) => `<a class="linkbtn cx-go" href="${esc(hashFor(params))}">${esc(label)} →</a>`;
  // app.js의 [data-goto] 처리기가 탭을 열고 data-anchors 구획으로 스크롤한다(시각 유지)
  const gotoLink = (tab, anchor, label) => `<button type="button" class="linkbtn cx-go" data-goto="${esc(tab)}"${anchor ? ` data-anchor="${esc(anchor)}"` : ''}>${esc(label)} →</button>`;

  // ---------------------------------------------------------------- 데이터 (엔드포인트별 캐시, 실패는 캐시하지 않음)
  const CACHE = new Map();
  function cached(key, fn) {
    if (!CACHE.has(key)) CACHE.set(key, Promise.resolve().then(fn).catch((e) => { CACHE.delete(key); throw e; }));
    return CACHE.get(key);
  }
  async function fetchApi(path, opts) {
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
    return j;
  }
  function makeCtx(api) {
    const call = typeof api === 'function' ? api : fetchApi;
    return {
      get: (path, fresh) => (fresh ? Promise.resolve().then(() => call(path)) : cached(path, () => call(path))),
      post: (path, body) => cached(`${path} ${JSON.stringify(body)}`, () => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
    };
  }
  const discoveryList = (d, key) => {
    const v = d && d[key];
    return Array.isArray(v) ? v : arr(v && (v.stages || v.stakeholders || v.items || v.rows));
  };

  // ---------------------------------------------------------------- SVG 도구
  const CJK = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/;
  function textW(s, fs) {
    let w = 0;
    for (const c of String(s)) w += c === ' ' ? 0.3 : CJK.test(c) ? 0.95 : /[A-Z0-9$%#@&MWm~]/.test(c) ? 0.64 : 0.54;
    return w * fs;
  }
  function wrapText(s, maxW, fs, maxLines) {
    const out = [];
    let line = '';
    for (const word of String(s == null ? '' : s).split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word;
      if (textW(cand, fs) <= maxW) { line = cand; continue; }
      if (line) out.push(line);
      line = '';
      if (textW(word, fs) <= maxW) { line = word; continue; }
      let part = '';
      for (const c of word) {
        if (part && textW(part + c, fs) > maxW) { out.push(part); part = ''; }
        part += c;
      }
      line = part;
    }
    if (line) out.push(line);
    const n = maxLines || 3;
    if (out.length <= n) return out;
    const kept = out.slice(0, n);
    let last = kept[n - 1];
    while (last.length > 1 && textW(`${last}…`, fs) > maxW) last = last.slice(0, -1);
    kept[n - 1] = `${last}…`;
    return kept;
  }
  // o: {fs, cls, anchor, middle, maxW, maxLines, lh}
  function svgText(x, y, s, o) {
    o = o || {};
    const fs = o.fs || 12;
    const lh = o.lh || 1.25;
    const lines = o.maxW ? wrapText(s, o.maxW, fs, o.maxLines) : [String(s)];
    const y0 = o.middle ? y - ((lines.length - 1) * fs * lh) / 2 + fs * 0.36 : y;
    return `<text x="${x}" y="${y0.toFixed(1)}" text-anchor="${o.anchor || 'start'}" class="${o.cls || ''}" style="font-size:${fs}px">${lines.map((l, i) => `<tspan x="${x}" dy="${i ? (fs * lh).toFixed(1) : 0}">${esc(l)}</tspan>`).join('')}</text>`;
  }
  const svgOpen = (w, h, label, role) => `<svg class="cx-svg" viewBox="0 0 ${w} ${h}" role="${role || 'img'}" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">`;
  function defs(p) {
    const mk = (id, cls) => `<marker id="${p}-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="cx-arrowhead ${cls}" d="M0,0 L10,5 L0,10 z"/></marker>`;
    return `<defs>${mk('a', '')}${mk('m', 'money')}${mk('c', 'acc')}
      <pattern id="${p}-h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="cx-hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="cx-hatch-line"/></pattern></defs>`;
  }
  const edge = (x1, y1, x2, y2, cls, mk) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="cx-edge ${cls || ''}"${mk ? ` marker-end="url(#${mk})"` : ''}/>`;
  const pathEdge = (d, cls, mk) => `<path d="${d}" class="cx-edge ${cls || ''}"${mk ? ` marker-end="url(#${mk})"` : ''}/>`;
  // 상자 하나: 제목(굵게)·부제(작게)를 가운데 정렬. o: {attrs, fsT, fsS, tLines, sLines, rx, hatch, badge, tCls, sCls}
  function node(x, y, w, h, cls, title, sub, o) {
    o = o || {};
    const fsT = o.fsT || 12.5;
    const fsS = o.fsS || 10.5;
    const padX = o.badge ? 30 : 10;
    const tl = wrapText(title, w - padX - 10, fsT, o.tLines || 2);
    const sl = sub ? wrapText(sub, w - padX - 10, fsS, o.sLines || 2) : [];
    const blockH = tl.length * fsT * 1.2 + (sl.length ? 4 + sl.length * fsS * 1.25 : 0);
    const cx = x + (o.badge ? (w + 20) / 2 : w / 2);
    let yy = y + h / 2 - blockH / 2 + fsT * 0.9;
    let t = '';
    tl.forEach((l, i) => { t += `<text x="${cx.toFixed(1)}" y="${(yy + i * fsT * 1.2).toFixed(1)}" text-anchor="middle" class="t-b ${o.tCls || ''}" style="font-size:${fsT}px">${esc(l)}</text>`; });
    yy += (tl.length - 1) * fsT * 1.2 + 4 + fsS * 1.1;
    sl.forEach((l, i) => { t += `<text x="${cx.toFixed(1)}" y="${(yy + i * fsS * 1.25).toFixed(1)}" text-anchor="middle" class="${o.sCls || 't-mut'}" style="font-size:${fsS}px">${esc(l)}</text>`; });
    const hatch = o.hatch ? `<rect class="hatch" x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx == null ? 8 : o.rx}" style="fill:url(#${o.hatch})"/>` : '';
    const badge = o.badge ? `<circle cx="${x + 16}" cy="${y + h / 2}" r="10" class="cx-badge-c"/><text x="${x + 16}" y="${y + h / 2 + 3.8}" text-anchor="middle" class="t-b t-mono t-onacc" style="font-size:10.5px">${esc(o.badge)}</text>` : '';
    return `<g class="cx-box ${cls}" ${o.attrs || ''}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx == null ? 8 : o.rx}"/>${hatch}${badge}${t}</g>`;
  }

  // ---------------------------------------------------------------- 용어 사전
  const CATS = ['계약·레이타임', '도착·NOR', '체선료·정산', '문서·데이터', '터미널 운영', '분석·방법론', '에이전트·운영'];
  // [용어, 영문, 분류 번호, 정의, 별칭]
  const GLOSS_RAW = [
    ['용선계약', 'Charter Party · C/P', 0, '선주가 배를 빌려주고 용선주가 운임과 체선료를 내기로 한 계약. 레이타임·체선료율·공제 조항이 모두 여기 있다. 이 데모의 용선계약 서식은 Asbatankvoy.', ['C/P', 'CP', 'Charter Party', '용선 계약']],
    ['항해용선', 'Voyage Charter', 0, '항해 한 번 단위로 배를 빌리는 방식. 항구에서 허용 시간(레이타임)을 넘기면 용선주가 선주에게 체선료를 낸다.', ['voyage charter']],
    ['Asbatankvoy', 'Asbatankvoy', 0, '유조선 항해용선에 널리 쓰는 표준 서식. Part II cl.5(레이캔)·6(NOR·개시)·7(공제)·8(체선료·반액)·9(선석 제공)·11(종료)을 엔진 룰 ASB-*로 옮겼다(원문 대조 전).', ['ASBATANKVOY']],
    ['매매계약', 'Sales Contract · GTC', 0, '원유·제품을 사고파는 계약(일반거래조건 GTC 포함). DES·FOB 같은 인도 조건과 함께 레이타임·체선료 조항을 따로 둔다 — 용선계약과 숫자가 다를 수 있다.', ['GTC', 'SPA', '매매계약·GTC', 'Sales Contract']],
    ['DES', 'Delivered Ex Ship', 0, '매도인이 배를 마련해 도착항(울산)에서 인도하는 조건. 울산에서 생긴 대기는 매매계약에 따라 매수인(SK)이 매도인에게 정산한다.', ['DES 매수인', 'BUYER_DES']],
    ['FOB', 'Free On Board', 0, '매수인이 배를 마련하고 선적항(울산)에서 인도받는 조건. 울산 선적 중 지연은 매수인이 매도인(SK)에게 청구한다.', ['FOB 매도인', 'SELLER_FOB']],
    ['Back-to-back', 'Back-to-back', 0, '용선계약에서 낸 체선료를 같은 사건을 근거로 매매 상대방에게 넘겨 청구하는 것. 두 계약의 레이타임·요율·면책이 다르면 전액 회수되지 않는다.', ['백투백']],
    ['레이타임', 'Laytime', 0, '계약이 추가 비용 없이 허용한 하역 시간(이 데모 24~36시간). 다 쓰는 순간부터 체선이다.', ['laytime', '허용 시간', 'used laytime']],
    ['Running hours', 'Running hours', 0, '달력 시간을 그대로 세는 방식 — 야간·주말에도 시계가 간다. 공제는 계약에 적힌 사유만 인정된다(ASB-07-HOURS).', ['running hours']],
    ['통지시간', 'Notice Time', 0, 'NOR 수령 후 레이타임이 시작되기 전의 유예(Asbatankvoy 6시간). 그 전에 접안이 끝나면 접안 완료 시점에 바로 시작한다.', ['통지 시간', 'NOR+6h', 'notice time']],
    ['레이캔', 'Laycan', 0, '선박이 도착해야 하는 기간(Laydays/Cancelling). 레이캔 시작 전에는 NOR을 내도 레이타임이 개시되지 않는다(ASB-05-LAYCAN).', ['laycan', 'laydays']],
    ['이동', 'Shifting', 0, '묘박지에서 선석까지 옮기는 시간. 레이타임 중이면 공제(cl.7), 이미 체선 중이면 산입이 기본 — 용선주가 공제를 주장할 수 있는 쟁점.', ['shifting', '시프팅', '이동(shifting)']],
    ['Reachable on arrival', 'Reachable on arrival', 0, '용선주는 배가 도착하면 바로 갈 수 있는 선석을 마련할 의무가 있다(cl.9). 선석이 차서 기다린 시간은 레이타임에 산입된다.', ['reachable', '도착 즉시 접근 가능']],
    ['WIBON', 'Whether In Berth Or Not', 0, '‘선석에 있든 없든’ NOR을 낼 수 있다는 조항. 묘박지에서 기다려도 레이타임 시계가 가게 한다.', ['berth or no berth']],
    ['NOR', 'Notice of Readiness', 1, '선장이 ‘도착했고 모든 면에서 하역 준비가 끝났다’고 알리는 통지. 유효한 NOR이 있어야 통지시간·레이타임이 시작된다.', ['하역 준비 완료 통지', 'Notice of Readiness', 'NOR 제출']],
    ['도착선', 'Arrived Ship', 1, '계약상 ‘도착’으로 인정되는 상태. 이 데모는 관습 묘박지에 투묘한 시점을 도착으로 본다.', ['arrived ship']],
    ['무효 NOR', 'Invalid NOR', 1, '도착 전·준비 전에 낸 NOR. 다시 내기 전까지 효력이 없다(The Mexico I). 에이전트는 AIS로 확인하고 ‘validity reserved’ 회신 초안을 만든다.', ['조기 NOR', 'The Mexico I', 'invalid NOR']],
    ['Waiver', 'The Happy Day', 1, '무효 NOR이라도 용선주가 이의 없이 하역을 시작하면 하역 개시 시점부터 레이타임이 시작된다는 판례 원칙.', ['The Happy Day', '권리 포기']],
    ['Validity reserved', 'Validity reserved', 1, 'NOR을 받되 유효성은 유보한다는 회신. 무효 NOR을 그냥 받아들여 waiver가 되는 것을 막는다.', ['validity reserved', '유효성 유보']],
    ['Free Pratique', 'Free Pratique', 1, '검역 당국의 입항 허가. 받지 못하면 ‘모든 면에서 준비 완료’가 아니어서 NOR 유효성이 다퉈질 수 있다.', ['검역 허가']],
    ['체선료', 'Demurrage', 2, '레이타임을 넘긴 시간에 대해 용선주가 선주에게 내는 돈. 일 요율(USD/일)을 시간 비례로 계산한다(cl.8). 예: 일 $120,000 → 시간 $5,000.', ['demurrage', '체선료율']],
    ['체선', 'On Demurrage', 2, '레이타임을 다 쓴 상태. 이 시점부터는 대기·이동·하역 모든 시간이 돈이 된다.', ['체선 중', 'on demurrage', '체선 돌입']],
    ['반액', 'Half Rate', 2, '화재·폭발·폭풍·파업, 용선주 측 플랜트 고장으로 생긴 체선은 요율의 절반(cl.8). TC-03의 강풍 중단 6시간이 예.', ['반액 체선료', 'half rate']],
    ['Once on demurrage', 'Once on demurrage, always on demurrage', 2, '일단 체선이면 계속 체선 — 계약에 명시되지 않은 레이타임 예외는 체선 중에 적용하지 않는다는 원칙. 해석이 갈려 쟁점으로 둔다.', ['once on demurrage', '일단 체선이면 계속 체선']],
    ['조출료', 'Despatch', 2, '레이타임보다 빨리 끝낸 시간에 선주가 돌려주는 돈. 유조선 서식(Asbatankvoy)에는 보통 없다.', ['despatch']],
    ['펌핑 보증', 'Pumping Warranty', 2, '선박이 정해진 시간(예: 24시간) 안에 양하하거나 매니폴드 압력(예: 100 psi)을 유지하겠다는 보증. 못 지키면 초과 시간을 공제 — 육상 제약이 없을 때만.', ['pumping warranty', '펌핑 워런티', '펌프 보증']],
    ['시효', 'Time Bar', 2, '정해진 기간(이 데모 90일) 안에 증빙을 갖춰 청구하지 않으면 체선료 청구권이 사라진다(RIDER-TIMEBAR-90).', ['time bar', '청구 기한']],
    ['레이타임 계산서', 'Laytime Statement', 2, 'NOR·SOF를 근거로 레이타임 사용·공제·체선 시간과 금액을 정리한 문서. 클레임의 근거가 된다.', ['계산서', '타임시트', 'time sheet', 'laytime statement']],
    ['클레임', 'Demurrage Claim', 2, '선주(또는 매매 상대방)가 보낸 체선료 청구. 데스크는 같은 엔진으로 재계산하고 차이를 항목별(워터폴)로 보여 준 뒤 수용·반박을 제안한다.', ['체선료 청구', 'claim']],
    ['쟁점', 'Dispute Point', 2, '해석이 갈리는 시간 구간. 엔진은 자동 판정하지 않고 기본 계산과 대안 계산을 함께 낸다(ENG-DISPUTE-NO-AUTO).', ['dispute', '분쟁']],
    ['체선사유', 'Delay Reason', 2, '대기·지연을 원인별로 나눈 코드(R01 선석 점유, R02 야간 제한, R03 기상, R04 육상 수용률, R08 이동 등). 진단과 정산에 같은 분류를 쓴다.', ['체선 사유', '원인 코드']],
    ['SOF', 'Statement of Facts', 3, '항구에서 일어난 사건과 시각의 기록(도착·NOR·계류·호스·하역·중단·분리). 선장·대리점·터미널이 서명한다. 입력·계산기에 그대로 붙여 넣을 수 있다.', ['사실기록서', 'statement of facts']],
    ['LOP', 'Letter of Protest', 3, '상대방의 기록·조치에 이의를 남기는 서면. 나중에 쟁점 시간을 다툴 근거가 된다.', ['항의서', 'letter of protest']],
    ['Q88', 'Q88', 3, '유조선 표준 질의서(제원·펌프 능력·인증 등). 선석 적합성(DWT·LOA·흘수) 검사의 입력.', []],
    ['AIS', 'Automatic Identification System', 3, '선박 위치·속력 신호. 실제 도착 시각을 확인하고 도착 전 NOR을 가려낸다.', []],
    ['펌핑 로그', 'Pumping Log', 3, '하역 중 시간별 유량·압력 기록. 펌핑 보증 위반 여부를 가리는 증거.', ['pumping log']],
    ['대조', 'Reconciliation', 3, 'SOF와 터미널 기록이 10분 이상 다르면 표시한다. 접안·호스·하역 시각은 터미널 기록, 도착은 AIS를 우선한다(ENG-RECONCILE).', ['SOF 대조', '불일치', 'reconciliation']],
    ['가상 데이터', 'Synthetic · VIRTUAL', 3, '모든 선박·계약·수치는 교육용 가상 값이다. VIRTUAL 표시는 가상 시나리오로 계산했다는 뜻 — 실제 울산 CLX 사실이 아니다.', ['VIRTUAL', '가상', '합성 데이터', '가상 검증']],
    ['선석', 'Berth', 4, '배를 대는 자리. 데모의 울산 CLX에는 SBM 2기(SK2B·SK3B)와 부두 2곳(SK7·SK8)이 있고 선석마다 최대 DWT·수심·취급 화물이 다르다.', ['berth', '선석 배정']],
    ['SBM', 'Single Buoy Mooring', 4, '바다 위 부이에 VLCC 같은 대형 원유선을 묶고 해저 배관으로 하역하는 시설(SK2·SK3 Buoy). 야간 계류가 금지된다(ULS-SBM-NIGHT).', ['부이', 'Buoy', 'SK2 Buoy', 'SK3 Buoy', '단일점 계류']],
    ['부두', 'Pier · Jetty', 4, '육상과 이어진 접안 시설(SK7·SK8 Pier). 중소형 유조선·제품선이 쓴다.', ['Pier', '돌핀', 'Jetty']],
    ['주간 접안 제한', 'Daytime Restriction', 4, 'SBM과 대형선은 낮에만 계류·접안할 수 있다. 데모는 주간을 07:00~17:30으로 가정한다(ULS-DAYTIME-DEF).', ['주간 제한', '야간 계류 금지', '주간 창']],
    ['UKC', 'Under Keel Clearance', 4, '선저와 해저 사이의 여유 수심. 흘수 + UKC ≤ 수심이어야 배정된다(데모: max(1.0m, 흘수×10%)).', ['여유수심', '흘수']],
    ['조석 창', 'Tide Window', 4, '수심이 충분한 시간대. 흘수가 깊은 배는 이 창 안에서만 드나들 수 있다(시나리오 S04).', ['조석', 'tide window', '조위']],
    ['도선', 'Pilotage', 4, '도선사가 승선해 선박을 선석까지 안내하는 것. 도선사 배정·승선 시각이 실제 접안 시각을 정한다.', ['도선사', 'pilot']],
    ['예선', 'Tug', 4, '접·이안을 돕는 작은 배. 예선이 모자라거나 기상이 나쁘면 접안이 늦어진다.', ['예인선', 'tug']],
    ['선석 전환', 'Berth Turnover', 4, '앞 배가 떠난 뒤 다음 배를 받을 준비 시간(데모 60분, PLAN-TURNOVER).', ['턴오버', 'turnover']],
    ['육상 수용률', 'Shore Receiving Rate', 4, '터미널 탱크·배관이 받아들일 수 있는 최대 유량. 하역 속도 = min(선박 펌프, 육상 수용률, 배관 한도).', ['수용률', 'shore rate']],
    ['Ullage', 'Ullage', 4, '탱크의 빈 공간. 여유가 모자라면 하역을 늦추거나 탱크를 더 배정해야 한다(예: TK-104 추가 배정).', ['탱크 여유', '탱크 ullage']],
    ['라인 치환', 'Line Displacement', 4, '제품을 바꿀 때 배관 속 기존 유체를 밀어내는 작업. 시간이 들고 배관 충돌(S06)의 원인이 된다.', ['라인업', '라인 전환', 'line-up']],
    ['Vetting', 'Vetting · SIRE', 4, '선박 안전 검사 기록(SIRE 등). 승인되지 않은 선박은 접안이 거절되거나 지연된다.', ['SIRE', '검선', 'vetting']],
    ['매니폴드', 'Manifold', 4, '선박 갑판의 화물 배관 연결부. 호스를 여기 연결하고 펌핑 보증 압력도 여기서 잰다.', ['manifold']],
    ['ETA·ETB·ETC', 'Estimated Time of Arrival / Berthing / Completion', 4, '도착·접안·하역 완료 예정 시각. ETB가 30분 이상 바뀌거나 노출이 $5,000 이상 변하면 영향 설명 항목이 생긴다(ENG-ETB-CHANGE).', ['ETA', 'ETB', 'ETC']],
    ['부두제약', 'Berth Constraint', 4, '정비·고장 등으로 선석을 쓸 수 없는 기간(BERTH-OOS). 이 데모에서는 SK3 Buoy 정비가 11/05 07:00에 끝난다는 통보가 핵심 사건이다.', ['부두 제약', 'BERTH-OOS']],
    ['MECE', 'Mutually Exclusive, Collectively Exhaustive', 5, '겹치지 않고 빠짐없이 나누는 원칙. 질문 432개를 Coverage A~T로 나눌 때 썼다.', []],
    ['Coverage', 'Coverage A–T', 5, '체선료 문제를 20개 영역(A 범위 … T 사업화)으로 나눈 지도. 영역마다 모델 반영 상태(YES·PARTIAL·NO)를 표시한다.', ['Coverage Map', '커버리지']],
    ['Evidence Chain', 'Evidence Chain', 5, '질문 → 근거 → 인사이트 → 결정 → 요구사항으로 이어지는 사슬. 기능 하나가 어떤 질문과 근거에서 나왔는지 거꾸로 추적한다.', ['증거 사슬']],
    ['Pareto', 'Pareto Analysis', 5, '소수 원인이 비용 대부분을 만든다는 분석. 이번 가상 1주는 선석 점유 대기가 체선료의 약 60%.', ['파레토']],
    ['Root Cause', 'Root Cause', 5, '‘왜’를 반복해 구조적 원인까지 내려간 결과. 예: SBM이 1기만 운영 → 대형선이 한 선석에 줄을 선다.', ['근본 원인', 'root cause']],
    ['통제가능성', 'Controllability', 5, '원인을 A 통제 가능·B 예측 가능한 제약·C 불확실한 위험·D 대응 불가로 나눈 것. 무엇을 최적화하고 무엇을 대비할지 정한다.', ['통제 가능성', 'controllability', 'A~D 분류']],
    ['Value at Stake', 'Value at Stake', 5, '총 체선료에서 피할 수 없는 부분을 빼고 운영·일정·에이전트로 다룰 수 있는 금액만 남겨 기대 절감까지 내려가는 깔때기.', ['VaS', '걸린 돈']],
    ['Historical Replay', 'Historical Replay', 5, '지난 기간을 다시 돌리며 각 결정 시점에 그때 알던 정보만으로 정책을 실행하고, 실제 결과로 채점하는 검증.', ['리플레이', 'replay']],
    ['No-lookahead', 'No-lookahead', 5, '리플레이에서 결정 시점 이후 정보(실제 도착·관측 풍속·실제 부두제약)를 정책이 보지 못하게 막는 규칙.', ['미래 정보 차단', '사후 정보 금지', 'lookahead']],
    ['사후 최적', 'Hindsight Optimum', 5, '미래를 모두 안다고 가정한 최선의 결과. 실현할 수 없는 하한이자 정보 가치의 상한.', ['hindsight', '사후최적']],
    ['시나리오 분석', 'Scenario Analysis', 5, 'S01~S17 상황(동시 도착·폭풍·ETA 지연·탱크 부족·조석 창·배관 충돌·예선 부족·안개·너울 등)에서 정책이 얼마나 버티는지 비교한다.', ['시나리오']],
    ['민감도 분석', 'Sensitivity · Tornado', 5, '입력을 하나씩 흔들어 결과가 얼마나 변하는지 본다. 이번 사례에서 가장 민감한 입력은 하역 속도.', ['민감도', '토네이도', 'tornado']],
    ['FCFS', 'First Come, First Served', 5, '도착 순으로 선석을 주는 규칙. 현업 Rule·체선료율 우선 등과 함께 비교 기준 정책으로 쓴다.', ['선착순', '도착 순']],
    ['Benchmark', 'Benchmark · Case Study', 5, '외부 공개 사례(선석 배정·탱크·체선료 관리 등)를 같은 질문 틀로 비교해 해결 방식을 고른다.', ['벤치마크', 'Case Study', '사례 연구']],
    ['Optimizer', 'Optimizer', 6, '결정 시점마다 선석 배정·순서·탱크 레버 조합을 비교해 예상 체선료가 가장 작은 안을 고르는 계산기. SEAGATE Berth Optimization을 대체하지 않는다.', ['옵티마이저', '최적화']],
    ['Risk-aware', 'Risk-aware Optimizer', 6, '기준 예측만이 아니라 오차 시나리오(폭풍 종료 ±3h, ETA ±3h)까지 가중 평균해 평가하는 최적화.', ['Risk-aware Optimizer', '위험 고려']],
    ['Hard·Soft 제약', 'Hard / Soft Constraint', 6, 'Hard는 어기면 안 되는 조건(야간 계류 금지·DWT·UKC·부두제약), Soft는 어기면 비용·조율이 드는 선호(이동 횟수·작업 조율).', ['Hard 제약', 'Soft 제약', '하드 제약', '소프트 제약']],
    ['운영 레버', 'Operational Lever', 6, '선석 이동 말고 결과를 바꾸는 조치. 예: TK-104 추가 배정으로 육상 수용률 9,000 → 12,000 m³/h.', ['레버', 'lever']],
    ['HITL', 'Human-in-the-loop', 6, '에이전트는 제안만 하고 사람이 확인·승인·반려한다. 승인해야 계획 버전이 올라간다.', ['사람 승인', 'Human-in-the-loop']],
    ['후보 카드', 'Candidate Card', 6, '제안 하나를 예상 체선료·Baseline 대비·선정 이유·Risk·가정·대안·확인한 룰로 정리한 카드. 작업함의 영향 항목에 붙는다.', ['후보', '옵션 카드', 'Candidate']],
    ['재계산 트리거', 'Re-optimization Trigger', 6, 'ETA 변경·예보 갱신·부두제약 변경·SOF 사건처럼 계획을 다시 계산하게 만드는 사건.', ['트리거', 'trigger', '재계산']],
    ['계획 버전', 'Plan Version', 6, '승인할 때마다 v1 → v2 → … 로 올라가는 계획 번호. 항목이 생긴 뒤 계획이 바뀌면 그 항목의 후보는 승인할 수 없다.', ['plan version', '계획 v1']],
    ['감사 로그', 'Audit Log', 6, '누가 언제 무엇을 확인·승인·반려했는지 남기는 기록. 초기화해도 지워지지 않는다.', ['audit log']],
    ['Shadow Mode', 'Shadow Mode', 6, '실제 결정은 사람이 하던 대로 두고 에이전트 제안만 기록해 일치율·수용률을 재는 도입 단계.', ['섀도 모드', '쉐도우 모드']],
    ['듀얼 브레인', 'Dual Brain', 6, '숫자는 결정론적 엔진(룰·시뮬레이션·최적화)이, 문장은 템플릿 또는 LLM이 맡는 구조. 문장 쪽은 숫자를 바꿀 수 없다.', ['dual brain', 'LLM 슬롯']],
    ['MCP', 'Model Context Protocol', 6, 'AI 도구가 외부 시스템을 부르는 표준 프로토콜. 이 데스크는 읽기 전용 MCP 도구 18개를 제공한다 — 승인은 화면에서 사람만 한다.', ['mcp_server', 'Model Context Protocol']],
    ['Pyodide', 'Pyodide', 6, '브라우저 안에서 파이썬을 실행하는 런타임. 정적 사이트(GitHub Pages)가 서버 없이 같은 엔진을 돌린다.', ['정적 사이트', 'WebAssembly']],
    ['SEAGATE', 'SEAGATE', 6, '울산 CLX의 선박·부두 운영 포털(체선 리포트·Berth Optimization 등, 생산조정팀 소유·SK AX 운영). 이 프로토타입은 SEAGATE와 무관한 교육용 데모이며 SEAGATE를 자동 수집하지 않는다.', ['SEAGATE v1']],
  ];
  const glossary = GLOSS_RAW.map(([term, en, cat, def, aliases]) => Object.freeze({ term, en, cat: CATS[cat], def, aliases: Object.freeze(arr(aliases).slice()) }));
  const normKey = (s) => String(s || '').toLowerCase().replace(/[\s·()\-_/.,]+/g, '');
  const GLOSS_BY = new Map();
  glossary.forEach((g) => [g.term, g.en, ...g.aliases].forEach((k) => { const n = normKey(k); if (n && !GLOSS_BY.has(n)) GLOSS_BY.set(n, g); }));
  // 사전에 있으면 점선 밑줄 + 툴팁(마우스·포커스), 없으면 글자 그대로
  function term(word, label) {
    const g = GLOSS_BY.get(normKey(word));
    const text = esc(label == null ? word : label);
    return g ? `<abbr class="cx-term" tabindex="0" data-term="${esc(g.term)}">${text}</abbr>` : text;
  }

  // ---------------------------------------------------------------- 용어 툴팁 (문서 전체에 한 번만)
  let tipEl = null;
  let tipFor = null;
  function showTip(t) {
    const g = GLOSS_BY.get(normKey(t.dataset.term));
    if (!g) return;
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.id = 'cxTip';
      tipEl.className = 'cx-tip';
      tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
    }
    tipEl.innerHTML = `<b>${esc(g.term)}${g.en && g.en !== g.term ? ` · ${esc(g.en)}` : ''}</b>${esc(g.def)}`;
    tipEl.classList.add('on');
    t.setAttribute('aria-describedby', 'cxTip');
    tipFor = t;
    const r = t.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    let y = r.bottom + 6;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  }
  function hideTip() {
    if (tipEl) tipEl.classList.remove('on');
    if (tipFor) tipFor.removeAttribute('aria-describedby');
    tipFor = null;
  }
  const termOf = (e) => (e.target && e.target.closest ? e.target.closest('.cx-term') : null);
  document.addEventListener('mouseover', (e) => { const t = termOf(e); if (t && t !== tipFor) showTip(t); });
  document.addEventListener('mouseout', (e) => { const t = termOf(e); if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip(); });
  document.addEventListener('focusin', (e) => { const t = termOf(e); if (t) showTip(t); });
  document.addEventListener('focusout', (e) => { if (termOf(e)) hideTip(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tipFor) hideTip(); });
  window.addEventListener('scroll', () => { if (tipFor) hideTip(); }, true);

  // ---------------------------------------------------------------- 개념도 화면 골격
  const SECTIONS = [];
  const sec = (def) => SECTIONS.push(def);

  function render(el, api) {
    if (!el) return null;
    const ctx = makeCtx(api);
    // 룰 상태를 미리 받아 칩 색을 맞춘다(실패해도 내장 표를 쓴다)
    ctx.get('/api/rules').then((rs) => { arr(rs).forEach((r) => { if (r && r.id) { RULE_STATUS[r.id] = r.status; RULE_TITLE[r.id] = r.title; } }); setCount('rules', arr(rs).length); }).catch(() => {});
    const root = document.createElement('div');
    root.className = 'cx-page';
    root.innerHTML = `
      <div class="panel cx-hero" data-anchors="top concepts overview">
        <div class="cx-kicker">개념도 · 12장</div>
        <h2>체선료 데스크를 이해하는 12장의 그림</h2>
        <p>계약이 시간을 돈으로 바꾸는 방식에서 출발해 항만 프로세스·자원 제약·에이전트 구조·검증 방법까지 차례로 설명합니다. 그림마다 아래의 <b>프로토타입에서 보기 →</b>를 누르면 그 장면이 열린 콘솔로 이동합니다. 점선 밑줄 용어(예: ${term('레이타임')}, ${term('NOR')}, ${term('반액')})에 마우스를 올리거나 Tab으로 포커스하면 뜻이 보입니다. 모든 수치는 ${term('가상 데이터')}입니다.</p>
        <div class="chips"><button type="button" class="btn small primary cx-tourbtn" data-cx-tour>▶ 가이드 투어 시작</button><button type="button" class="btn small" data-cx-scroll="cx-glossary">용어 사전 (${glossary.length}개) ↓</button>${gotoLink('usage', null, '사용법')}</div>
        <nav class="cx-toc" aria-label="개념도 목차">${SECTIONS.map((s, i) => `<button type="button" data-cx-scroll="cx-${s.id}"><b>${i + 1}</b>${esc(s.short)}</button>`).join('')}<button type="button" data-cx-scroll="cx-glossary"><b>사전</b>용어 ${glossary.length}</button></nav>
      </div>
      ${SECTIONS.map((s, i) => `
      <section class="panel cx-sec" id="cx-${s.id}" data-anchors="${esc(s.anchors)}" aria-labelledby="cx-${s.id}-h">
        <div class="cx-sec-head"><h2 id="cx-${s.id}-h"><span class="cx-num">${i + 1}</span>${esc(s.title)}</h2>${s.kicker ? `<span class="cx-kick">${esc(s.kicker)}</span>` : ''}</div>
        <div class="cx-lead">${s.lead()}</div>
        <div class="cx-body"></div>
        <div class="cx-see"><span class="cx-see-l">프로토타입에서 보기 →</span>${s.links().join('')}</div>
      </section>`).join('')}
      <section class="panel cx-sec" id="cx-glossary" data-anchors="glossary terms dictionary" aria-labelledby="cx-glossary-h">
        <div class="cx-sec-head"><h2 id="cx-glossary-h"><span class="cx-num">사전</span>용어 사전</h2><span class="cx-kick">${glossary.length}개 · ${CATS.length}분류</span></div>
        <div class="cx-body"></div>
      </section>`;
    el.replaceChildren(root);
    root.addEventListener('click', onPageClick);
    root.addEventListener('keydown', onPageKey);
    SECTIONS.forEach((s) => {
      const body = root.querySelector(`#cx-${s.id} .cx-body`);
      try {
        s.mount(body, ctx);
      } catch (e) {
        console.error(e);
        body.innerHTML = `<div class="empty">그림을 그리지 못했습니다: ${esc(e && e.message)}</div>`;
      }
    });
    mountGlossary(root.querySelector('#cx-glossary .cx-body'));
    return null;
  }
  function onPageClick(e) {
    const sc = e.target.closest('[data-cx-scroll]');
    if (sc) {
      const t = document.getElementById(sc.dataset.cxScroll);
      if (t) t.scrollIntoView({ behavior: smooth(), block: 'start' });
      return;
    }
    if (e.target.closest('[data-cx-tour]')) startTour();
  }
  // SVG 안의 role=button 그룹은 Enter·Space로도 누른다
  function onPageKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target.closest && e.target.closest('g[role="button"]');
    if (!g) return;
    e.preventDefault();
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
  const failNote = (what) => `<span class="cx-verify">${esc(what)}</span>`;

  // ================================================================ 1. 레이타임 시계
  const TC03 = {
    source: 'builtin', base_date: '2026-11-03', title: '묘박지에서 체선 돌입, 체선 중 이동, 기상 중단 반액', vessel: 'ULSAN GLORY (가상) · VLCC 310,000 DWT · SK2 Buoy(SBM)',
    nor: '2026-11-03T10:00', laytime_start: '2026-11-03T16:00', demurrage_start: '2026-11-05T04:00', laytime_end: '2026-11-06T20:30',
    allowed_h: 36, rate_usd_day: 120000, amount_usd: 187500, demurrage_h: 40.5, full_h: 34.5, half_h: 6,
    segments: [
      ['2026-11-03T16:00', '2026-11-04T20:00', 'WAIT', 'CONGESTION', 'LAYTIME', 'COUNT', '대기 — 선석 점유'],
      ['2026-11-04T20:00', '2026-11-05T04:00', 'WAIT', 'NIGHT', 'LAYTIME', 'COUNT', '대기 — 야간 계류·접안 제한'],
      ['2026-11-05T04:00', '2026-11-05T07:00', 'WAIT', 'NIGHT', 'DEMURRAGE', 'FULL', '대기 — 야간 계류·접안 제한'],
      ['2026-11-05T07:00', '2026-11-05T09:00', 'SHIFT', '', 'DEMURRAGE', 'FULL', '이동(shifting)'],
      ['2026-11-05T09:00', '2026-11-05T10:30', 'BERTH_PREP', '', 'DEMURRAGE', 'FULL', '접안·호스 연결'],
      ['2026-11-05T10:30', '2026-11-05T22:00', 'PUMPING', '', 'DEMURRAGE', 'FULL', '하역'],
      ['2026-11-05T22:00', '2026-11-06T04:00', 'STOP', 'WEATHER', 'DEMURRAGE', 'HALF', '하역 중단 — 기상'],
      ['2026-11-06T04:00', '2026-11-06T19:30', 'PUMPING', '', 'DEMURRAGE', 'FULL', '하역'],
      ['2026-11-06T19:30', '2026-11-06T20:30', 'POST_OPS', '', 'DEMURRAGE', 'FULL', '호스 분리'],
    ].map(([from, to, kind, reason, phase, effect, label]) => ({ from, to, kind, reason, phase, effect, label })),
    events: [['ANCHORED', '2026-11-03T10:00'], ['NOR_RECEIVED', '2026-11-03T10:00'], ['BERTH_VACATED', '2026-11-04T19:00'], ['ANCHOR_AWEIGH', '2026-11-05T07:00'], ['ALL_FAST', '2026-11-05T09:00'],
      ['HOSES_CONNECTED', '2026-11-05T10:00'], ['OPS_COMMENCED', '2026-11-05T10:30'], ['OPS_STOPPED', '2026-11-05T22:00'], ['OPS_RESUMED', '2026-11-06T04:00'], ['OPS_COMPLETED', '2026-11-06T19:30'], ['HOSES_DISCONNECTED', '2026-11-06T20:30']]
      .map(([type, ts]) => ({ type, ts })),
    issues: [{ code: 'SHIFT_DURING_DEMURRAGE' }, { code: 'WAIT_NIGHT_WEATHER' }],
    alternatives: [{ code: 'CHTR_SHIFT_EXCL', title: '용선주 주장: 체선 중 이동도 공제', amount_usd: 177500, delta_usd: -10000 }, { code: 'CHTR_CL6_EXC', title: '용선주 주장: 야간·기상 대기는 cl.6 예외', amount_usd: 122500, delta_usd: -65000 }],
  };
  async function loadTC03(ctx) {
    const g = await ctx.get('/api/golden');
    const tc = arr(g && g.cases).find((c) => c.id === 'TC-03');
    if (!tc) throw new Error('골든 케이스 TC-03 없음');
    const r = await ctx.post('/api/intake/calc', { text: tc.sof_text, base_date: g.base_date, terms: tc.terms, context: tc.context });
    const st = r && r.statement;
    if (!st || st.status !== 'OK' || !arr(st.segments).length) throw new Error('TC-03 계산 실패');
    return {
      source: 'engine', base_date: g.base_date, title: tc.title, vessel: tc.vessel, expected: tc.expected,
      nor: (st.nor && (st.nor.effective || st.nor.received)) || TC03.nor, laytime_start: st.laytime_start, demurrage_start: st.demurrage_start, laytime_end: st.laytime_end,
      allowed_h: st.allowed_h, rate_usd_day: st.rate_usd_day, amount_usd: st.amount_usd, demurrage_h: st.demurrage_h, full_h: st.full_h, half_h: st.half_h,
      segments: st.segments, events: st.events, issues: st.issues, alternatives: st.alternatives,
    };
  }
  const evTs = (m, type) => { const e = arr(m.events).find((x) => x.type === type); return e ? parseTs(e.ts) : null; };
  const dayNo = (m, t) => Math.floor(t / DAY) - Math.floor(parseTs(`${m.base_date || '2026-11-03'}T00:00`) / DAY) + 1;
  const dLabel = (m, t) => (t == null ? '—' : `D${dayNo(m, t)} ${fmtTs(t)}`);
  const segsOf = (m) => arr(m.segments).map((x) => ({ a: parseTs(x.from), b: parseTs(x.to), kind: x.kind, reason: x.reason || '', phase: x.phase, effect: x.effect, label: x.label || x.kind }));
  const demFactor = (s) => (s.phase !== 'DEMURRAGE' ? 0 : s.effect === 'FULL' ? 1 : s.effect === 'HALF' ? 0.5 : 0);
  function clockAt(m, T) {
    const rateH = (m.rate_usd_day || 0) / 24;
    let lay = 0;
    let dem = 0;
    let amt = 0;
    segsOf(m).forEach((s) => {
      const o = Math.max(0, Math.min(s.b, T) - s.a) / HOUR;
      if (!o) return;
      if (s.phase === 'LAYTIME' && s.effect === 'COUNT') lay += o;
      const f = demFactor(s);
      if (f) { dem += o; amt += o * rateH * f; }
    });
    return { lay, dem, amt };
  }
  function clockState(m, T) {
    const nor = parseTs(m.nor);
    const ls = parseTs(m.laytime_start);
    const ds = parseTs(m.demurrage_start);
    const end = parseTs(m.laytime_end);
    if (T < nor) return '도착 전';
    if (T < ls) return '정지 — 통지시간';
    if (T < ds) return '진행 — 레이타임';
    if (T < end) {
      const half = segsOf(m).find((s) => s.effect === 'HALF' && s.a < T && s.b >= T);
      return half ? (half.b === T ? '반액 구간 끝 — 전액 재개' : '체선 중 (반액 구간)') : '진행 — 체선 중';
    }
    return '정지 — 호스 분리';
  }
  function laytimeSteps(m) {
    const nor = parseTs(m.nor);
    const ls = parseTs(m.laytime_start);
    const ds = parseTs(m.demurrage_start);
    const end = parseTs(m.laytime_end);
    const arrive = evTs(m, 'ANCHORED') != null ? evTs(m, 'ANCHORED') : nor;
    const vac = evTs(m, 'BERTH_VACATED');
    const aw = evTs(m, 'ANCHOR_AWEIGH') || ds;
    const af = evTs(m, 'ALL_FAST') || aw;
    const stp = evTs(m, 'OPS_STOPPED') || af;
    const rsm = evTs(m, 'OPS_RESUMED') || stp;
    const rateH = (m.rate_usd_day || 0) / 24;
    const segs = segsOf(m);
    const hours = (pred) => segs.filter(pred).reduce((a, s) => a + (s.b - s.a) / HOUR, 0);
    const congLay = hours((s) => s.phase === 'LAYTIME' && s.kind === 'WAIT' && s.reason === 'CONGESTION');
    const nightLay = hours((s) => s.phase === 'LAYTIME' && s.kind === 'WAIT' && /NIGHT|WEATHER/.test(s.reason));
    const shiftH = hours((s) => s.phase === 'DEMURRAGE' && s.kind === 'SHIFT');
    const alt = (code) => arr(m.alternatives).find((a) => a.code === code);
    const aShift = alt('CHTR_SHIFT_EXCL');
    const aCl6 = alt('CHTR_CL6_EXC');
    const noticeH = (ls - nor) / HOUR;
    return [
      { title: '도착·투묘', from: arrive, at: arrive, rules: ['LAW-NOR-ARRIVAL', 'ASB-09-REACHABLE'],
        text: `배가 관습 묘박지에 투묘하면 계약상 ${term('도착선')}이 된다. 선석(SK2 Buoy)은 앞 배가 쓰고 있어 바로 들어갈 수 없지만, 용선주는 도착 즉시 갈 수 있는 선석을 줄 의무가 있으므로(${term('Reachable on arrival')}) 이 대기는 곧 레이타임으로 센다.` },
      { title: 'NOR 제출·수령', from: nor, at: nor, rules: ['LAW-NOR-ARRIVAL', 'LAW-NOR-WAIVER', 'ASB-06-NOR-START'],
        text: `선장이 ${term('NOR')}을 내고 ${fmtHm(nor)}에 수령됐다. 도착 전에 낸 NOR은 ${term('무효 NOR')}이라 다시 내야 하지만, 이 배는 투묘와 동시에 냈으므로 유효하다. 유효한 NOR이 있어야 시계가 움직일 준비가 된다.` },
      { title: `통지시간 ${fmtH(noticeH)}`, from: nor, at: ls, rules: ['ASB-06-NOR-START'],
        text: `NOR 수령 뒤 ${fmtH(noticeH)}은 ${term('통지시간')} — 레이타임에 넣지 않는다. 시계는 ‘NOR + 6h’와 ‘접안 완료’ 중 이른 쪽에서 시작하는데, 배가 아직 묘박지에 있으므로 ${esc(dLabel(m, ls))}에 시작한다.` },
      { title: `레이타임 ${fmtH(m.allowed_h)} 소진`, from: ls, at: ds, rules: ['ASB-09-REACHABLE', 'ULS-SBM-NIGHT', 'ASB-06-BERTH-DELAY-EXC'],
        text: `선석이 빌 때까지 기다린 ${fmtH(congLay)}도 레이타임으로 센다. ${vac ? `${esc(dLabel(m, vac))}에 앞 배가 떠났지만 ` : ''}${term('SBM')}은 야간 계류가 금지라 아침까지 또 기다렸다(레이타임 중 ${fmtH(nightLay)}). 이 야간 대기를 누가 부담하느냐가 ${term('쟁점')} — 기본 계산은 산입, 용선주는 cl.6 예외를 주장할 수 있다${aCl6 ? `(인정되면 ${usd(aCl6.delta_usd)})` : ''}.` },
      { title: '체선 돌입', from: ds, at: aw, rules: ['ASB-08-RATE-PRORATA', 'LAW-ONCE-ON-DEM'],
        text: `허용 ${fmtH(m.allowed_h)}을 다 쓴 ${esc(dLabel(m, ds))}부터 ${term('체선')}. 이제 1시간마다 ${usd(rateH)}(일 ${usd(m.rate_usd_day)} ÷ 24)이 쌓인다. 배는 아직 묘박지 — 야간 계류 금지가 풀리는 ${fmtHm(aw)}까지 ${fmtH((aw - ds) / HOUR)}을 더 기다린다.` },
      { title: `이동 ${fmtH(shiftH)}`, from: aw, at: af, rules: ['ASB-07-SHIFTING-EXCL', 'LAW-ONCE-ON-DEM', 'ENG-DISPUTE-NO-AUTO'],
        text: `양묘 후 SBM까지 ${fmtH(shiftH)} ${term('이동')}. 레이타임 중이었다면 빠지는 시간(cl.7)이지만 이미 체선 중이므로 ${term('Once on demurrage')} 원칙에 따라 기본 계산은 산입한다. 용선주가 공제를 주장하면 ${aShift ? usd(aShift.delta_usd) : '−$10,000'} — 엔진은 판정하지 않고 두 계산을 함께 낸다.` },
      { title: `강풍 중단 ${fmtH((rsm - stp) / HOUR)} — 반액`, from: stp, at: rsm, rules: ['ASB-08-HALF-RATE', 'ULS-WEATHER-LIMIT'],
        text: `강풍으로 터미널 지시에 따라 하역을 멈췄다. 폭풍·화재·폭발·파업으로 생긴 체선은 ${term('반액')}(cl.8)이라 이 구간은 시간당 ${usd(rateH / 2)}만 쌓인다. 아래 누계 그래프의 기울기가 절반으로 꺾이는 곳이다.` },
      { title: '호스 분리 — 시계 정지', from: evTs(m, 'OPS_COMPLETED') || end, at: end, rules: ['ASB-11-END-HOSES', 'ASB-08-RATE-PRORATA'],
        text: `호스를 분리한 ${esc(dLabel(m, end))}에 시계가 멈춘다(cl.11). 체선 ${fmtH(m.demurrage_h)} = 전액 ${fmtH(m.full_h)} × ${usd(rateH)} + 반액 ${fmtH(m.half_h)} × ${usd(rateH / 2)} = <b>${usd(m.amount_usd)}</b>. 선주는 이 항차에 $207,500을 청구했다 — 차이는 작업함의 클레임 CLM-2026-036에서 항목별로 본다.` },
    ];
  }
  const PHYS = {
    WAIT: { cls: 'cx-ph-wait', t: '', label: (p) => (p.reason === 'NIGHT' ? '야간 대기' : p.reason === 'WEATHER' ? '기상 대기' : p.reason === 'CONGESTION' ? '선석 점유 대기' : '대기') },
    SHIFT: { cls: 'cx-ph-wait', hatch: true, t: 't-b', label: () => '이동' },
    BERTH_PREP: { cls: 'cx-ph-prep', t: '', label: () => '접안' },
    PUMPING: { cls: 'cx-ph-pump', t: 't-onfill', label: () => '하역' },
    STOP: { cls: 'cx-ph-stop', t: 't-onwarm', label: () => '중단' },
    POST_OPS: { cls: 'cx-ph-post', t: 't-onacc', label: () => '분리' },
  };
  function clockSvg(m, step) {
    const W = 1000;
    const L = 96;
    const R = 16;
    const P = 'cx1';
    const nor = parseTs(m.nor);
    const ls = parseTs(m.laytime_start);
    const ds = parseTs(m.demurrage_start);
    const end = parseTs(m.laytime_end);
    const arrive = evTs(m, 'ANCHORED') != null ? evTs(m, 'ANCHORED') : nor;
    const t0 = Math.floor((Math.min(arrive, nor) - 2 * HOUR) / HOUR) * HOUR;
    const t1 = Math.ceil((end + 2 * HOUR) / HOUR) * HOUR;
    const X = (t) => +(L + ((t - t0) / (t1 - t0)) * (W - L - R)).toFixed(1);
    const yTop = 42;
    const y1 = 50;
    const h1 = 30;
    const y2 = 100;
    const h2 = 30;
    const y3 = 146;
    const h3 = 86;
    const yAx = 240;
    const segs = segsOf(m);
    let s = svgOpen(W, 278, `레이타임 시계: ${dLabel(m, ls)} 개시, ${dLabel(m, ds)} 체선 돌입, ${dLabel(m, end)} 종료, 체선료 ${usd(m.amount_usd)}`) + defs(P);
    [[y1, h1, '선박 상태'], [y2, h2, '레이타임 시계'], [y3, h3, '체선료 누계']].forEach(([y, h, lb]) => {
      s += `<rect x="${L}" y="${y}" width="${W - L - R}" height="${h}" rx="4" class="lane-bg"/>`;
      s += svgText(L - 8, y + h / 2, lb, { anchor: 'end', middle: true, fs: 11.5, cls: 't-b', maxW: L - 14, maxLines: 2 });
    });
    // 야간(주간 창 07:00~17:30 밖)
    for (let d = Math.floor(t0 / DAY) * DAY - DAY; d < t1; d += DAY) {
      const a = Math.max(t0, d + 17.5 * HOUR);
      const b = Math.min(t1, d + DAY + 7 * HOUR);
      if (b > a) s += `<rect x="${X(a)}" y="${yTop}" width="${(X(b) - X(a)).toFixed(1)}" height="${yAx - yTop}" class="cx-night"><title>야간 ${fmtTs(a)}–${fmtTs(b)} (SBM 계류 불가)</title></rect>`;
    }
    // 선박 상태 레인 — 같은 종류·사유가 이어지면 하나로
    const phys = [];
    if (ls > arrive) phys.push({ a: arrive, b: ls, kind: 'WAIT', reason: segs[0] && segs[0].kind === 'WAIT' ? segs[0].reason : '' });
    segs.forEach((x) => {
      const last = phys[phys.length - 1];
      if (last && last.kind === x.kind && last.reason === x.reason && last.b === x.a) last.b = x.b;
      else phys.push({ a: x.a, b: x.b, kind: x.kind, reason: x.reason });
    });
    phys.forEach((p) => {
      const k = PHYS[p.kind] || PHYS.WAIT;
      const x = X(p.a);
      const w = Math.max(1, X(p.b) - x);
      const lab = k.label(p);
      s += `<rect x="${x}" y="${y1 + 3}" width="${w.toFixed(1)}" height="${h1 - 6}" rx="3" class="${k.cls}"${k.hatch ? ` style="fill:url(#${P}-h)"` : ''}><title>${esc(`${fmtTs(p.a)}–${fmtTs(p.b)} · ${lab} · ${fmtH((p.b - p.a) / HOUR)}`)}</title></rect>`;
      if (w > textW(lab, 10.5) + 10) s += `<text x="${(x + w / 2).toFixed(1)}" y="${y1 + h1 / 2 + 3.7}" text-anchor="middle" class="${k.t}" style="font-size:10.5px;pointer-events:none">${esc(lab)}</text>`;
    });
    // 레이타임 시계 레인 — 통지시간 → 레이타임 → 체선(전액·반액)
    const clk = [];
    if (ls > nor) clk.push({ a: nor, b: ls, key: 'NOTICE' });
    segs.forEach((x) => {
      const key = x.phase === 'LAYTIME' ? (x.effect === 'COUNT' ? 'LAY' : 'EXCL') : x.effect === 'FULL' ? 'DEM' : x.effect === 'HALF' ? 'HALF' : 'EXCL';
      const last = clk[clk.length - 1];
      if (last && last.key === key && last.b === x.a) last.b = x.b;
      else clk.push({ a: x.a, b: x.b, key });
    });
    const CLK = { NOTICE: ['cx-notice', '', '통지'], LAY: ['cx-lay', 't-onfill', '레이타임'], DEM: ['cx-dem', 't-onfill', '체선'], HALF: ['cx-half', 't-onwarm', '반액'], EXCL: ['cx-ph-wait', 't-b', '공제'] };
    clk.forEach((c) => {
      const [cls, tc, name] = CLK[c.key];
      const x = X(c.a);
      const w = Math.max(1, X(c.b) - x);
      const lab = `${name} ${fmtH((c.b - c.a) / HOUR)}`;
      s += `<rect x="${x}" y="${y2 + 3}" width="${w.toFixed(1)}" height="${h2 - 6}" rx="3" class="${cls}"${c.key === 'EXCL' ? ` style="fill:url(#${P}-h)"` : ''}><title>${esc(`${fmtTs(c.a)}–${fmtTs(c.b)} · ${lab}`)}</title></rect>`;
      if (w > textW(lab, 10.5) + 10) s += `<text x="${(x + w / 2).toFixed(1)}" y="${y2 + h2 / 2 + 3.7}" text-anchor="middle" class="${tc}" style="font-size:10.5px;pointer-events:none">${esc(lab)}</text>`;
    });
    // 쟁점 구간 테두리
    const codes = arr(m.issues).map((i) => i.code);
    const disp = segs.filter((x) => (codes.includes('SHIFT_DURING_DEMURRAGE') && x.kind === 'SHIFT' && x.phase === 'DEMURRAGE')
      || (codes.includes('WAIT_NIGHT_WEATHER') && x.kind === 'WAIT' && x.phase === 'LAYTIME' && /NIGHT|WEATHER/.test(x.reason)));
    disp.forEach((x) => {
      s += `<rect x="${(X(x.a) - 1).toFixed(1)}" y="${y2 - 2}" width="${(X(x.b) - X(x.a) + 2).toFixed(1)}" height="${h2 + 4}" rx="4" class="cx-dispute-box"><title>쟁점 구간 — 기본 계산과 대안 계산을 함께 둔다</title></rect>`;
      s += `<text x="${((X(x.a) + X(x.b)) / 2).toFixed(1)}" y="${y2 - 6}" text-anchor="middle" class="t-disp t-b" style="font-size:9.5px">쟁점</text>`;
    });
    // 체선료 누계 — 반액 구간에서 기울기가 절반
    const rateH = (m.rate_usd_day || 0) / 24;
    const pts = [[t0, 0], [ds, 0]];
    let cum = 0;
    const halfMarks = [];
    segs.filter((x) => x.phase === 'DEMURRAGE').sort((a, b) => a.a - b.a).forEach((x) => {
      const before = cum;
      cum += ((x.b - x.a) / HOUR) * rateH * demFactor(x);
      pts.push([x.b, cum]);
      if (x.effect === 'HALF') halfMarks.push([(x.a + x.b) / 2, (before + cum) / 2]);
    });
    pts.push([t1, cum]);
    const base = y3 + h3 - 8;
    const Y = (c) => +(base - (c / Math.max(1, cum)) * (h3 - 22)).toFixed(1);
    const line = pts.map(([t, c]) => `${X(t)},${Y(c)}`).join(' ');
    s += `<polygon points="${X(t0)},${base} ${line} ${X(t1)},${base}" class="cx-cum-area"/><polyline points="${line}" class="cx-cum-line"/>`;
    s += `<text x="${L + 6}" y="${base - 4}" class="t-mut t-mono" style="font-size:9.5px">$0</text>`;
    s += `<text x="${(X(end) - 8).toFixed(1)}" y="${(Y(cum) - 6).toFixed(1)}" text-anchor="end" class="t-dem t-b t-mono" style="font-size:12px">${usd(cum)}</text>`;
    halfMarks.forEach(([t, c]) => { s += `<text x="${(X(t) + 6).toFixed(1)}" y="${(Y(c) + 14).toFixed(1)}" class="t-mut" style="font-size:9.5px">반액 → 기울기 ½</text>`; });
    // 사건 표시선(두 줄로 번갈아 배치)
    const marks = [[nor, 'NOR'], [ls, '레이타임 시작'], [evTs(m, 'BERTH_VACATED'), '앞 배 이안'], [ds, '체선 시작'], [evTs(m, 'ALL_FAST'), '계류 완료'], [evTs(m, 'OPS_STOPPED'), '강풍 중단'], [evTs(m, 'OPS_RESUMED'), '재개'], [end, '호스 분리']]
      .filter(([t]) => t != null);
    const rowEnd = [-1e9, -1e9];
    marks.forEach(([t, lb]) => {
      const x = X(t);
      const w = textW(lb, 10.5);
      const cx = Math.min(Math.max(x, L + w / 2), W - R - w / 2);
      const r = rowEnd[0] < cx - w / 2 - 6 ? 0 : 1;
      rowEnd[r] = cx + w / 2;
      const ty = r ? 30 : 14;
      s += `<line x1="${x}" y1="${ty + 4}" x2="${x}" y2="${yAx}" class="cx-mline"/>`;
      s += `<text x="${cx.toFixed(1)}" y="${ty}" text-anchor="middle" class="t-mut" style="font-size:10.5px">${esc(lb)}</text>`;
    });
    // 지금 단계: 지난 구간 강조, 뒤는 흐리게
    if (step) {
      let a = step.from != null ? step.from : step.at;
      let b = step.at;
      if (b - a < 40 * 60000) { a -= 20 * 60000; b += 20 * 60000; }
      const xc = X(step.at);
      if (step.at < t1) s += `<rect x="${xc}" y="${yTop}" width="${(W - R - xc).toFixed(1)}" height="${yAx - yTop}" class="cx-future"/>`;
      s += `<rect x="${X(a)}" y="${y1 - 4}" width="${Math.max(4, X(b) - X(a)).toFixed(1)}" height="${y2 + h2 + 4 - (y1 - 4)}" rx="5" class="cx-hl"/>`;
      s += `<line x1="${xc}" y1="${yTop}" x2="${xc}" y2="${yAx}" class="cx-hl-line"/>`;
    }
    // 시간 축
    s += `<line x1="${L}" y1="${yAx}" x2="${W - R}" y2="${yAx}" class="grid strong"/>`;
    s += `<text x="${X(t0) + 3}" y="${yAx + 30}" class="t-b" style="font-size:10.5px">D${dayNo(m, t0)} ${fmtTs(t0).slice(0, 5)}</text>`;
    for (let t = Math.ceil(t0 / (6 * HOUR)) * 6 * HOUR; t <= t1; t += 6 * HOUR) {
      const x = X(t);
      const hh = new Date(t).getUTCHours();
      s += `<line x1="${x}" y1="${yAx}" x2="${x}" y2="${yAx + (hh === 0 ? 8 : 4)}" class="grid strong"/>`;
      s += `<text x="${x}" y="${yAx + 16}" text-anchor="middle" class="t-mut t-mono" style="font-size:9.5px">${pad(hh)}</text>`;
      if (hh === 0 && t > t0) s += `<text x="${x + 3}" y="${yAx + 30}" class="t-b" style="font-size:10.5px">D${dayNo(m, t)} ${fmtTs(t).slice(0, 5)}</text>`;
    }
    return `${s}</svg>`;
  }
  sec({
    id: 'laytime', short: '레이타임 시계', anchors: 'laytime clock demurrage nor tc03 tc-03', kicker: '골든 케이스 TC-03 · 기준일 D1 = 11/03',
    title: '레이타임 시계 — 시간이 돈으로 바뀌는 순간',
    lead: () => `<p>${term('레이타임')}은 계약이 허용한 하역 시간이다. 시계는 ${term('NOR')} 수령 후 ${term('통지시간')}(6h)이 지나거나 접안이 끝나는 것 중 이른 시점에 시작해 호스를 분리할 때 멈춘다. 허용 시간을 다 쓰면 그때부터 ${term('체선료')}가 시간 단위로 쌓이고, 계약은 일부 시간을 빼거나(${term('이동')}, 레이타임 중) 절반만 세게 한다(${term('반액')}, 폭풍·파업).</p>
      <p>아래는 골든 케이스 TC-03의 SOF를 엔진에 그대로 넣어 다시 계산한 결과다. <b>다음 ▶</b>(또는 그림을 누른 뒤 ←·→)으로 8단계를 넘기면 그 시점까지의 시계와 금액이 보인다.</p>`,
    links: () => [hashLink({ tab: 'intake' }, '입력·계산기 — 골든 케이스 직접 계산'), hashLink({ tab: 'inbox', item: 'CLM-2026-036' }, '작업함 — 같은 항차 클레임 CLM-2026-036'), hashLink({ tab: 'statement', call: 'ULS-2026-11-0101' }, '계산서 — TAEHWA HARMONY')],
    mount(body, ctx) {
      const st = { i: 0, m: TC03, err: null };
      const build = () => {
        if (!body.isConnected) return;
        const m = st.m;
        const ok = m.source === 'engine' && m.expected && Math.abs((m.amount_usd || 0) - (m.expected.amount_usd || 0)) < 0.01;
        const verify = m.source === 'engine'
          ? `<span class="cx-verify ok">엔진 재계산 ${usd(m.amount_usd)}${ok ? ' · TC-03 기대값과 일치 ✓' : ''}</span>`
          : failNote(st.err ? `내장 예시 데이터 (엔진 연결 실패: ${st.err})` : '내장 예시 데이터 · 엔진 재계산 중…');
        body.innerHTML = `
          <div class="cx-figtop">${verify}<span class="small muted">${esc(m.vessel)} — ${esc(m.title)}</span></div>
          <div class="cx-fig" tabindex="0" aria-label="레이타임 시계 그림. 왼쪽·오른쪽 화살표로 단계를 옮깁니다"></div>
          <div class="cx-legend"><span><i class="wait"></i>대기</span><span><i class="excl"></i>이동</span><span><i class="pump"></i>하역</span><span><i class="half"></i>중단</span><span><i class="notice"></i>통지시간</span><span><i class="lay"></i>레이타임</span><span><i class="dem"></i>체선(전액)</span><span><i class="half"></i>반액</span><span><i class="night"></i>야간 — 주간 창 07:00~17:30 밖</span><span><i class="disp"></i>쟁점</span></div>
          <div class="cx-stepper"><button type="button" class="btn small" data-cx-step="-1">◀ 이전</button><div class="cx-dots" role="group" aria-label="단계 선택"></div><button type="button" class="btn small primary" data-cx-step="1">다음 ▶</button></div>
          <div class="cx-stepcard" aria-live="polite"></div>
          <div class="cx-counters"></div>
          ${arr(m.alternatives).length ? `<div class="cx-note">쟁점 대안 — 엔진은 자동 판정하지 않고 함께 둔다: ${m.alternatives.map((a) => `<b>${esc(a.title)}</b> ${usd(a.amount_usd)} (${usd(a.delta_usd, true)})`).join(' · ')}</div>` : ''}`;
        paint();
      };
      const paint = () => {
        const steps = laytimeSteps(st.m);
        st.i = Math.max(0, Math.min(steps.length - 1, st.i));
        const s = steps[st.i];
        const c = clockAt(st.m, s.at);
        body.querySelector('.cx-fig').innerHTML = clockSvg(st.m, s);
        body.querySelector('.cx-dots').innerHTML = steps.map((x, k) => `<button type="button" class="cx-dot${k === st.i ? ' on' : ''}" data-cx-to="${k}" aria-pressed="${k === st.i}" aria-label="${k + 1}단계 ${esc(x.title)}">${k + 1}</button>`).join('');
        body.querySelector('[data-cx-step="-1"]').disabled = st.i === 0;
        body.querySelector('[data-cx-step="1"]').disabled = st.i === steps.length - 1;
        body.querySelector('.cx-stepcard').innerHTML = `<h4>${CIRCLED[st.i]} ${esc(s.title)}<span class="when">${esc(dLabel(st.m, s.at))}</span></h4><p>${s.text}</p><div class="chips" style="margin-top:6px">${chips(s.rules)}</div>`;
        body.querySelector('.cx-counters').innerHTML = `
          <div class="cx-counter"><div class="k">레이타임 사용</div><div class="v">${fmtH(c.lay)} <span class="small muted">/ ${fmtH(st.m.allowed_h)}</span></div></div>
          <div class="cx-counter"><div class="k">체선 시간</div><div class="v">${fmtH(c.dem)}</div></div>
          <div class="cx-counter"><div class="k">체선료 누계</div><div class="v dem">${usd(c.amt)}</div></div>
          <div class="cx-counter"><div class="k">시계 상태</div><div class="v small-v">${esc(clockState(st.m, s.at))}</div></div>`;
      };
      const move = (i, focusSel) => {
        st.i = i;
        paint();
        const f = focusSel && body.querySelector(focusSel);
        if (f && !f.disabled) f.focus();
      };
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cx-step],[data-cx-to]');
        if (!b) return;
        if (b.dataset.cxTo != null) move(+b.dataset.cxTo, `[data-cx-to="${b.dataset.cxTo}"]`);
        else move(st.i + +b.dataset.cxStep, `[data-cx-step="${b.dataset.cxStep}"]`);
      });
      body.addEventListener('keydown', (e) => {
        if (!e.target.closest('.cx-fig')) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); move(st.i + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); move(st.i - 1); }
      });
      build();
      loadTC03(ctx).then((m) => { st.m = m; build(); }).catch((e) => { st.err = e.message; build(); });
    },
  });

  // ================================================================ 2. 두 겹 계약
  const ROLE_INFO = {
    CHARTERER: ['SK = 용선주', '용선계약 · Asbatankvoy', 'SK → 선주에게 직접 지급', '회수할 곳이 없다 — 터미널 운영으로만 줄일 수 있다'],
    BUYER_DES: ['SK = DES 매수인', '매매계약 · GTC (DES)', '매도인이 선주에게 지급 → 매매계약 조건으로 SK에 청구', '매매계약의 레이타임·요율로 다시 계산 — 용선계약과 다르면 차액이 생긴다'],
    SELLER_FOB: ['SK = FOB 매도인', '매매계약 · GTC (FOB)', '매수인이 선주에게 지급 → 울산 선적 지연분을 SK에 청구', '선적항(울산) 지연은 SK 책임 — 터미널 운영이 곧 비용'],
  };
  // /api/meta가 없을 때 쓰는 기준 시나리오 6척
  const CALLS_FALLBACK = [
    ['ULS-2026-11-0101', 'TAEHWA HARMONY', 'DISCHARGE', 'CHARTERER', 'ASBATANKVOY', 'Owner: Taehwa Tankers (가상)', 36, 120000],
    ['ULS-2026-11-0102', 'MUNSU PEARL', 'DISCHARGE', 'BUYER_DES', 'GTC_DES', 'Seller: Gulf Crude Trading (가상)', 36, 115000],
    ['ULS-2026-11-0103', 'GANJEOLGOT DAWN', 'DISCHARGE', 'CHARTERER', 'ASBATANKVOY', 'Owner: East Sea Tankers (가상)', 30, 55000],
    ['ULS-2026-11-0104', 'JANGSAENGPO GRACE', 'DISCHARGE', 'BUYER_DES', 'GTC_DES', 'Seller: Pacific Oil Supply (가상)', 30, 58000],
    ['ULS-2026-11-0105', 'BANGEOJIN TRADER', 'DISCHARGE', 'CHARTERER', 'ASBATANKVOY', 'Owner: Aegean Bulk Tankers (가상)', 36, 78000],
    ['ULS-2026-11-0106', 'GANGDONG BREEZE', 'LOAD', 'SELLER_FOB', 'GTC_FOB', 'Buyer: Singapore Fuels (가상)', 24, 32000],
  ].map(([call_id, name, operation, sk_role, form, counterparty, laytime_hours, rate_usd_day]) => ({ call_id, operation, vessel: { name }, contract: { sk_role, form, counterparty, laytime_hours, notice_hours: 6, rate_usd_day, time_bar_days: 90 } }));
  function contractSvg() {
    const P = 'cx2';
    let s = svgOpen(1000, 300, '두 겹 계약 그림: 선주와 SK 사이의 용선계약, SK와 매매 상대방 사이의 매매계약, 시간이 쓰이는 터미널') + defs(P);
    s += pathEdge('M 145 40 V 16 H 855 V 40', 'soft', `${P}-a`);
    s += svgText(500, 12, '상대방이 배를 빌렸다면: 상대방 ↔ 선주 사이의 용선계약 (SK는 당사자가 아님)', { anchor: 'middle', fs: 10.5, cls: 't-mut' });
    s += node(30, 40, 230, 84, 'k-in', '선주 (Owner)', '배를 빌려주고 체선료를 청구한다', { fsT: 14 });
    s += node(385, 40, 230, 84, 'center', 'SK', '용선주 또는 매매 당사자', { fsT: 15, sCls: 't-onacc' });
    s += node(740, 40, 230, 84, 'k-in', '매매 상대방', '매도인(DES) 또는 매수인(FOB)', { fsT: 14 });
    s += edge(262, 64, 383, 64, 'acc', `${P}-c`);
    s += svgText(322, 58, '① 용선계약', { anchor: 'middle', fs: 11, cls: 't-b t-acc' });
    s += edge(383, 104, 262, 104, 'money', `${P}-m`);
    s += svgText(322, 120, 'SK가 용선주면 직접 지급', { anchor: 'middle', fs: 10.5, cls: 't-dem' });
    s += edge(617, 64, 738, 64, 'acc', `${P}-c`);
    s += svgText(678, 58, '② 매매계약', { anchor: 'middle', fs: 11, cls: 't-b t-acc' });
    s += edge(617, 104, 738, 104, 'money', `${P}-m`);
    s += svgText(678, 120, 'DES 매수·FOB 매도 정산', { anchor: 'middle', fs: 10.5, cls: 't-dem' });
    s += node(310, 206, 380, 70, 'k-out', '울산 CLX 터미널 — 시간이 실제로 쓰이는 곳', '선석·탱크·배관·기상 → SOF·터미널 기록', { fsT: 13 });
    s += edge(500, 204, 500, 128, 'acc', `${P}-c`);
    s += svgText(512, 170, 'SOF = 두 계약 공통의 증거', { fs: 10.5, cls: 't-mut' });
    s += pathEdge('M 308 241 H 145 V 126', 'soft', `${P}-a`);
    s += pathEdge('M 692 241 H 855 V 126', 'soft', `${P}-a`);
    s += svgText(145, 262, '같은 SOF로 선주가 청구', { anchor: 'middle', fs: 10.5, cls: 't-mut' });
    s += svgText(855, 262, '같은 SOF로 상대방이 청구', { anchor: 'middle', fs: 10.5, cls: 't-mut' });
    return `${s}</svg>`;
  }
  sec({
    id: 'contracts', short: '두 겹 계약', anchors: 'contracts contract back_to_back sk_role', kicker: '용선계약 × 매매계약',
    title: '두 겹 계약 — 같은 대기가 두 번 돈이 된다',
    lead: () => `<p>울산에서 쓴 시간은 두 계약으로 정산된다: 선주–용선주 사이의 ${term('용선계약')}, 그리고 화물을 사고파는 ${term('매매계약')}. SK가 어떤 역할이냐에 따라 누가 누구에게 내는지가 바뀌고, 두 계약의 레이타임·요율·공제 조항이 다르면 낸 돈과 돌려받는 돈이 맞지 않는다(${term('Back-to-back')} 불일치).</p>
      <p>그래서 데스크는 선박마다 ‘SK의 역할’을 먼저 정하고, 그 역할에 해당하는 계약 숫자로 계산한다. 아래 표는 이번 가상 1주의 6척이다.</p>`,
    links: () => [hashLink({ tab: 'timeline' }, '타임라인 — 선박별 계약·노출'), hashLink({ tab: 'statement', call: 'ULS-2026-11-0102' }, '계산서 — DES 매수 사례 MUNSU PEARL'), gotoLink('rules', null, '룰·근거 — Asbatankvoy 조항')],
    mount(body, ctx) {
      const draw = (calls, live) => {
        if (!body.isConnected) return;
        const groups = {};
        calls.forEach((c) => { const r = (c.contract && c.contract.sk_role) || 'CHARTERER'; (groups[r] = groups[r] || []).push(c); });
        body.innerHTML = `
          <div class="cx-fig">${contractSvg()}</div>
          <div class="cx-stack">
            <div class="cx-card"><h4>SK의 역할별 흐름</h4><div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>역할</th><th>계약</th><th>누가 누구에게</th><th>이번 데모 선박</th></tr></thead><tbody>
              ${Object.entries(ROLE_INFO).map(([k, [lb, layer, flow, why]]) => `<tr><td><b>${esc(lb)}</b><div class="small muted">${esc(why)}</div></td><td class="small">${esc(layer)}</td><td class="small">${esc(flow)}</td><td class="small">${arr(groups[k]).map((c) => esc(c.vessel && c.vessel.name)).join(', ') || '—'}</td></tr>`).join('')}
              <tr><td><b>(참고) CFR·CIF 매도</b><div class="small muted">이번 데모에는 없음</div></td><td class="small">용선계약 + 매매계약</td><td class="small">SK가 선주에게 지급 → 양하항 지연분은 매수인에게 back-to-back 청구</td><td class="small">—</td></tr>
            </tbody></table></div></div>
            <div class="cx-card"><h4>선박별 계약 숫자 ${live ? '' : '<span class="cx-tag">내장 예시</span>'}</h4><div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>선박</th><th>역할·서식</th><th class="num">레이타임</th><th class="num">요율/일</th><th class="num">시효</th></tr></thead><tbody>
              ${calls.map((c) => { const k = c.contract || {}; return `<tr><td><b>${esc(c.vessel && c.vessel.name)}</b><div class="small muted mono">${esc(c.call_id)} · ${c.operation === 'LOAD' ? '선적' : '양하'}</div></td><td class="small">${esc((ROLE_INFO[k.sk_role] || [k.sk_role])[0])}<div class="muted">${esc(k.form || '')} · ${esc(k.counterparty || '')}</div></td><td class="num">${fmtH(k.laytime_hours)}<div class="small muted">통지 ${fmtH(k.notice_hours)}</div></td><td class="num">${usd(k.rate_usd_day)}</td><td class="num">${k.time_bar_days ? `${k.time_bar_days}일` : '—'}</td></tr>`; }).join('')}
            </tbody></table></div><div class="cx-note">같은 8시간 대기라도 요율이 $32,000인 배와 $120,000인 배의 비용은 네 배 가까이 차이 난다 — Optimizer가 ‘요율 높은 배를 먼저’ 단순 규칙보다 나은 이유다(검증 탭의 ‘체선료율 우선’ 정책 결과 참고).</div></div>
          </div>`;
      };
      draw(CALLS_FALLBACK, false);
      ctx.get('/api/meta').then((m) => { if (arr(m && m.calls).length) draw(m.calls, true); }).catch(() => {});
    },
  });

  // ================================================================ 3. Port Call 프로세스 지도
  // [영문 단계, 한국어, 레이타임에서의 역할, 담당, 입력, 결정, 계약 영향, 프로토타입 반영]
  const STAGES = [
    ['Charter / Contract', '용선·계약', 'contract', '트레이딩·용선 담당, 선주·중개인', '화물·레이캔·요율 협상', '서식·허용 레이타임·요율·NOR 조건', '이후 모든 계산의 기준', 'data/live/contracts.json · engine/clock.py'],
    ['Voyage', '항해', 'none', '선주·선장', '항로·속력 계획', '속력 조정(ETA)', '레이캔 안에 도착해야 함', 'ETA 갱신 이력'],
    ['ETA Notice', 'ETA 통지', 'none', '대리점 → 선석 스케줄러', '72·48·24시간 전 ETA', '기준 계획 수정 여부', 'ETA 통지 의무(rider)', '재계산 트리거 ETA · 작업함 영향 항목'],
    ['Arrival / Anchorage', '도착·투묘', 'trigger', '선장·VTS', 'AIS 위치·투묘 시각', '도착선 인정 여부', '관습 묘박지 투묘 = 도착 (The Mexico I)', 'engine/sim.py ANCHORED · AIS 대조'],
    ['NOR', 'NOR 제출', 'trigger', '선장(제출) · 대리점·터미널(수령)', 'NOR 문서·수령 시각', '수락 또는 validity reserved', 'NOR + 6h = 레이타임 개시 후보', '작업함 NOR 항목 · ASB-06-NOR-START'],
    ['Berth Waiting', '선석 대기', 'count', '선석 스케줄러·선장', '선석 점유·순서·주간 창', '접안 순서·선석 배정', 'reachable on arrival → 산입', 'engine/sim.py 대기 사유 R01·R02·R03'],
    ['Pilot / Tug', '도선·예선', 'excluded', '대리점(주문) · 도선사·예선사', '도선 요청·예선 척수', '이동 개시 시각', '이동 시간 공제(cl.7), 체선 중이면 쟁점', 'PLAN-DURATIONS 고정 소요'],
    ['Berthing', '접안', 'trigger', '도선사·터미널 계류팀', '주간 창·풍속', '계류 가능 여부', '접안 완료가 NOR+6h보다 빠르면 이때 개시', 'ULS-SBM-NIGHT · ULS-WEATHER-LIMIT'],
    ['Safety Check', '안전 점검', 'count', '터미널 안전 담당·선박', '체크리스트', '작업 허가', '산입 — 선박 결함이면 공제', '고정 소요에 포함'],
    ['Hose Connection', '호스 연결', 'count', '터미널·선박', '매니폴드 사양', '연결 완료', '산입', 'engine/sim.py HOSES_CONNECTED'],
    ['Line-up', '라인업', 'count', '터미널 운영(탱크·배관)', '탱크·배관 경로', '라인 구성', '산입 — 육상 사유는 용선주 부담', '배관 제약(자원·제약 탭)'],
    ['Sampling / Analysis', '샘플링·분석', 'count', '검정인·실험실', '샘플', '품질 승인', '산입', '접안 후 준비 SAMPLING(시나리오)'],
    ['Loading / Discharging', '선적·양하', 'count', '터미널·선박', '선박 펌프·육상 수용률', '하역 속도·중단', '펌핑 보증, 기상 중단은 반액', 'PLAN-PUMP-RATE · TK-104 레버'],
    ['Tank / Line Change', '탱크·라인 전환', 'count', '탱크 담당·생산조정팀', '탱크 ullage', '탱크 추가 배정(레버)', '산입', 'data/live/plan.json 레버'],
    ['Stripping', '잔량 처리', 'end', '선박', '잔량', '종료 판단', '끝나고 호스를 분리하면 레이타임·체선 종료(cl.11)', '하역 시간에 포함'],
    ['Documentation', '서류', 'post', '대리점·검정인·터미널', 'SOF·B/L·서명', '서명·제출', '시계 밖 — 서류 대기는 쟁점이 될 수 있다', 'RIDER-DOCS 청구 필수 서류'],
    ['Unberthing', '이안', 'none', '도선사·예선·계류팀', '이안 허가', '이안 시각', '시계 밖 (다음 배의 선석 전환에 영향)', 'PLAN-TURNOVER 60분'],
    ['Departure', '출항', 'none', '선장·VTS', '출항 허가', '—', '시계 밖', '—'],
    ['Laytime Calculation', '레이타임 계산', 'contract', '원유 구매 담당 · 에이전트(초안)', 'NOR·SOF·계약 조건', '산입·공제·쟁점 판단', 'cl.6~11 전체', 'engine/clock.py · 작업함 계산서 초안'],
    ['Demurrage Settlement', '체선료 정산', 'contract', '선주(청구) · 원유 구매(검토·지급)', '계산서·클레임', '수용·반박·합의', '시효 90일 (RIDER-TIMEBAR-90)', 'engine/claims.py 클레임 검토'],
  ];
  const ROLE_LABEL = { contract: '계약·정산', none: '시계와 무관', trigger: '시계를 시작시킨다', count: '레이타임·체선에 산입', excluded: '공제될 수 있음(쟁점)', end: '시계를 멈춘다', post: '시계 밖 — 쟁점 가능' };
  const LENS = [['who', '담당 (Who)'], ['input', '입력 (Input)'], ['activity', '활동 (Activity)'], ['decision', '결정 (Decision)'], ['output', '산출물 (Output)'], ['time', '시간 (Time)'], ['delay', '지연 요인 (Delay)'], ['dependency', '의존성 (Dependency)'], ['contract', '계약 영향 (Contract)'], ['modeled_in', '프로토타입 반영']];
  function processSvg(sel) {
    const P = 'cx3';
    const w = 172;
    const h = 62;
    const xs = [22, 218, 414, 610, 806];
    const ys = [14, 106, 198, 290];
    const pos = (i) => { const r = Math.floor(i / 5); const c = i % 5; return [xs[r % 2 ? 4 - c : c], ys[r]]; };
    let s = svgOpen(1000, 366, 'Port Call 20단계 지도. 단계를 누르면 9개 관점의 설명이 아래에 나옵니다', 'group') + defs(P);
    for (let i = 0; i < 19; i++) {
      const [x1, y1] = pos(i);
      const [x2, y2] = pos(i + 1);
      if (y1 === y2) s += x2 > x1 ? edge(x1 + w + 2, y1 + h / 2, x2 - 3, y2 + h / 2, '', `${P}-a`) : edge(x1 - 2, y1 + h / 2, x2 + w + 3, y2 + h / 2, '', `${P}-a`);
      else s += edge(x1 + w / 2, y1 + h + 2, x2 + w / 2, y2 - 3, '', `${P}-a`);
    }
    STAGES.forEach(([en, ko, role], i) => {
      const [x, y] = pos(i);
      s += `<g class="cx-box r-${role} cx-click${i === sel ? ' sel' : ''}" role="button" tabindex="0" data-cx-stage="${i}" aria-pressed="${i === sel}" aria-label="${i + 1}. ${esc(ko)} — ${esc(ROLE_LABEL[role])}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>${role === 'excluded' ? `<rect class="hatch" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" style="fill:url(#${P}-h)"/>` : ''}
        <text x="${x + 10}" y="${y + 20}" class="t-b" style="font-size:12.5px"><tspan class="t-mono t-acc">${i + 1}</tspan> ${esc(ko)}</text>
        <text x="${x + 10}" y="${y + 36}" class="t-mut" style="font-size:10px">${esc(en)}</text>
        <text x="${x + 10}" y="${y + 52}" class="t-mut" style="font-size:9.5px">${esc(ROLE_LABEL[role])}</text></g>`;
    });
    return `${s}</svg>`;
  }
  sec({
    id: 'process', short: '프로세스 지도', anchors: 'process process_map port_call stages', kicker: '20단계 × 9관점',
    title: 'Port Call 프로세스 지도 — 시계는 어느 단계에서 움직이나',
    lead: () => `<p>배 한 척이 계약을 맺고 울산에 와서 하역하고 정산을 끝내기까지 20단계를 거친다. 단계마다 레이타임 시계에 주는 영향이 다르다 — 시계를 <b>시작</b>시키는 단계(도착·NOR·접안), 시간이 <b>산입</b>되는 단계, ${term('이동')}처럼 <b>공제</b>될 수 있는 단계, 시계를 <b>멈추는</b> 단계가 있다.</p>
      <p>단계를 누르면 담당·입력·결정·계약 영향과 이 프로토타입에서 어디에 반영됐는지가 나온다. 로드맵의 9개 관점(Who·Input·Activity·Decision·Output·Time·Delay·Dependency·Contract)이다.</p>`,
    links: () => [gotoLink('discovery', 'process_map', '로드맵 — Port Call 프로세스 맵'), hashLink({ tab: 'timeline' }, '타임라인 — 단계가 실제 시간축에 놓인 모습')],
    mount(body, ctx) {
      const st = { sel: 5, map: null };
      const detail = () => {
        const [en, ko, role, who, input, decision, contract, modeled] = STAGES[st.sel];
        const live = st.map && (st.map.find((x) => normKey(x.stage) === normKey(en)) || st.map[st.sel]);
        const rows = live
          ? LENS.filter(([k]) => live[k]).map(([k, lb]) => [lb, live[k]])
          : [['담당 (Who)', who], ['입력 (Input)', input], ['결정 (Decision)', decision], ['계약 영향 (Contract)', contract], ['프로토타입 반영', modeled]];
        return `<h4><span class="cx-num">${st.sel + 1}</span>${esc(ko)} <span class="small muted">${esc(en)}</span><span class="cx-tag ${role === 'count' ? 'info' : role === 'trigger' ? 'acc' : role === 'excluded' || role === 'post' ? 'disp' : role === 'contract' ? 'warn' : ''}">${esc(ROLE_LABEL[role])}</span>${live && live.status ? `<span class="cx-tag ${live.status === 'VIRTUAL' ? 'good' : ''}">${live.status === 'VIRTUAL' ? '가상 데이터로 계산' : live.status === 'HYPOTHESIS' ? '문서·가정으로만 기술' : esc(live.status)}</span>` : ''}</h4>
          <table class="cx-table"><tbody>${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
          ${live ? '' : '<div class="cx-note">내장 요약 — 로드맵 데이터(process_map)가 연결되면 9개 관점 전체가 나온다.</div>'}`;
      };
      const draw = () => {
        if (!body.isConnected) return;
        body.querySelector('.cx-fig').innerHTML = processSvg(st.sel);
        body.querySelector('.cx-detail').innerHTML = detail();
      };
      body.innerHTML = `<div class="cx-fig"></div>
        <div class="cx-legend"><span><i class="role-contract"></i>계약·정산</span><span><i class="role-trigger"></i>시계 시작</span><span><i class="role-count"></i>산입</span><span><i class="excl"></i>공제 가능(쟁점)</span><span><i class="role-end"></i>시계 정지</span><span><i class="role-post"></i>시계 밖·쟁점 가능</span><span><i class="off"></i>시계와 무관</span></div>
        <div class="cx-detail" aria-live="polite"></div>`;
      body.addEventListener('click', (e) => {
        const g = e.target.closest('[data-cx-stage]');
        if (!g) return;
        st.sel = +g.dataset.cxStage;
        draw();
        const again = body.querySelector(`[data-cx-stage="${st.sel}"]`);
        if (again) again.focus();
      });
      draw();
      ctx.get('/api/discovery').then((d) => { const pm = discoveryList(d, 'process_map'); if (pm.length) { st.map = pm; draw(); } }).catch(() => {});
    },
  });

  // ================================================================ 4. 이해관계자 지도
  const PEOPLE_FALLBACK = [
    ['SH-01', '생산조정팀', '내부', true, ['접안 순서·선석 확정', '탱크 추가 배정(레버)', '재계획 승인']],
    ['SH-02', '선석 스케줄러', '내부', true, ['순서·선석 초안', '재계획 상신', '대리점 통지']],
    ['SH-03', '부두 운영 (작업·안전)', '내부', false, ['하역 개시·중단', '접안 가능 여부(풍속·주간)']],
    ['SH-04', '원유 구매·용선', '내부', true, ['NOR 수락·유보', '체선료 수용·반박']],
    ['SH-05', '제품 출하·영업', '내부', false, ['긴급 출하 요청']],
    ['SH-06', 'SK AX (SEAGATE 운영)', '내부', false, ['연동 방식·권한']],
    ['SH-07', '선박 대리점', '외부', false, ['도선·예선 주문 시각']],
    ['SH-08', '선주·선장', '외부', false, ['NOR 제출 시점', '청구 금액']],
    ['SH-09', '도선사·예선·줄잡이', '외부', false, ['도선·예선 배정 시각·척수']],
    ['SH-10', '항만당국·VTS', '외부', false, ['항만 통제·입출항 제한']],
    ['SH-11', '검정인 (Surveyor)', '외부', false, ['검정 결과']],
    ['SH-12', '체선료 에이전트 (프로토타입)', '내부', false, []],
  ].map(([id, name, org, agent_user, decisions]) => ({ id, name, org, agent_user, decisions, inputs: [] }));
  const isHub = (p) => /에이전트|agent \(prototype\)|프로토타입/i.test(p.name || '') || p.id === 'SH-12';
  function peopleSvg(people) {
    const P = 'cx4';
    const hub = people.find(isHub);
    const inner = people.filter((p) => p !== hub && !/외부|external/i.test(p.org || ''));
    const outer = people.filter((p) => p !== hub && /외부|external/i.test(p.org || ''));
    const H = Math.max(inner.length, outer.length) * 54 + 30;
    const hy = H / 2;
    let s = svgOpen(1000, H, `이해관계자 지도: 내부 ${inner.length}, 외부 ${outer.length}, 가운데 체선료 데스크`) + defs(P);
    s += svgText(150, 14, '내부 (SK·터미널)', { anchor: 'middle', fs: 11, cls: 't-b t-mut' });
    s += svgText(850, 14, '외부 (선박·항만)', { anchor: 'middle', fs: 11, cls: 't-b t-mut' });
    const col = (list, x, right) => list.forEach((p, i) => {
      const step = (H - 30) / list.length;
      const y = 24 + i * step + (step - 46) / 2;
      const sub = arr(p.decisions).slice(0, 2).join(' · ') || (p.role ? String(p.role).replace(/\[[^\]]*\]\s*/g, '') : '');
      const nx = right ? x - 2 : x + 262;
      const hx = right ? 642 : 358;
      // 후보 카드를 받는 사용자는 허브 → 사람 방향 화살표
      s += p.agent_user ? edge(hx, hy, nx, y + 23, 'acc', `${P}-c`) : edge(nx, y + 23, hx, hy, 'soft', '');
      s += node(x, y, 260, 46, `k-in${p.agent_user ? ' agent-user' : ''}`, p.name, sub ? `결정: ${sub}` : '', { fsT: 12, fsS: 10, sLines: 1, tLines: 1 });
    });
    col(inner, 20, false);
    col(outer, 720, true);
    s += node(360, hy - 40, 280, 80, 'center', '체선료 데스크', '같은 사실(SOF·예보·계획)을 같은 숫자로', { fsT: 15, sCls: 't-onacc', sLines: 2 });
    return `${s}</svg>`;
  }
  sec({
    id: 'people', short: '이해관계자', anchors: 'stakeholders people raci who', kicker: 'Who 렌즈 · RACI',
    title: '이해관계자 지도 — 누가 무엇을 결정하나',
    lead: () => `<p>체선료는 한 부서의 숫자가 아니다. 선석을 정하는 사람, 탱크를 내주는 사람, 계약을 맺은 사람, 청구서를 받는 사람이 모두 다르다. 데스크는 가운데에서 같은 사실(SOF·예보·계획)을 같은 숫자로 보여 주는 허브 역할만 하고, 결정은 각 담당자가 한다(${term('HITL')}).</p>
      <p>굵은 테두리·실선 화살표는 에이전트 후보 카드를 직접 받아 결정하는 사용자다. ${term('SEAGATE')}의 체선 리포트·Berth Optimization(생산조정팀 소유·SK AX 운영)을 대체하지 않고 그 옆에서 체선료 관점의 설명을 더한다. 역할 배정은 조직도 확인 전이라 모두 [가정]이다.</p>`,
    links: () => [gotoLink('discovery', 'stakeholders', '로드맵 — 이해관계자·RACI'), hashLink({ t: '2026-11-04T10:00', tab: 'inbox', item: 'IMP-1104-1000' }, '작업함 — 협의 필요 상대가 적힌 후보 카드')],
    mount(body, ctx) {
      const draw = (people, live, tasks) => {
        if (!body.isConnected) return;
        const raciCols = tasks && tasks.length ? tasks : [...new Set(people.flatMap((p) => Object.keys(p.raci || {})))];
        const raci = raciCols.length && people.some((p) => p.raci)
          ? `<div class="cx-tablewrap" style="margin-top:8px"><table class="cx-table cx-raci"><thead><tr><th>이해관계자</th>${raciCols.map((t) => `<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>${people.filter((p) => p.raci).map((p) => `<tr><td><b>${esc(p.name)}</b>${p.agent_user ? ' <span class="cx-tag acc">에이전트 사용</span>' : ''}</td>${raciCols.map((t) => { const v = String((p.raci || {})[t] || ''); return `<td class="cx-rcell">${v.split(/[\s/,]+/).filter(Boolean).map((x) => `<span class="raci raci-${esc(x)}">${esc(x)}</span>`).join('')}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div><div class="cx-note">R 수행 · A 최종 책임(업무당 1명) · C 협의 · I 통보 — 전부 [가정], 조직도·업무 분장표로 확인할 항목.</div>`
          : `<div class="cx-tablewrap" style="margin-top:8px"><table class="cx-table"><thead><tr><th>이해관계자</th><th>구분</th><th>결정하는 것</th><th>에이전트</th></tr></thead><tbody>${people.filter((p) => !isHub(p)).map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="small">${esc(p.org)}</td><td class="small">${esc(arr(p.decisions).join(' · ') || '—')}</td><td class="small">${p.agent_user ? '후보 카드 사용' : '—'}</td></tr>`).join('')}</tbody></table></div>`;
        body.innerHTML = `${live ? '' : '<div class="cx-figtop"><span class="cx-tag">내장 요약</span></div>'}<div class="cx-fig">${peopleSvg(people)}</div>${raci}`;
      };
      draw(PEOPLE_FALLBACK, false, null);
      ctx.get('/api/discovery').then((d) => {
        const ps = discoveryList(d, 'stakeholders');
        const meta = d && d.stakeholders && !Array.isArray(d.stakeholders) ? d.stakeholders._meta : (d && d.stakeholders_meta);
        if (ps.length) draw(ps, true, arr(meta && meta.tasks));
      }).catch(() => {});
    },
  });

  // ================================================================ 5. 자원·제약 네트워크
  const CDOMAIN = { B: '계약', C: '선박·도착', D: '묘박지·도착', E: '선석·부두', F: '화물·제품', G: '탱크·저장', H: '배관·설비', I: '도선·예선', J: '기상·조석', K: '안전·규제' };
  // [키, 영역, 이름, 설명, x, y, 너비]
  const NET_NODES = [
    ['vessel', 'C', '선박·ETA', '도착 시각·흘수·펌프', 16, 150, 122],
    ['anch', 'D', '묘박지·도착', 'NOR·대기 순서', 156, 150, 122],
    ['marine', 'I', '도선·예선', '배정 시각·척수', 296, 150, 122],
    ['berth', 'E', '선석', 'SBM 2 · 부두 2 · 주간 창', 436, 150, 122],
    ['pipe', 'H', '배관·설비', '라인 한도·치환', 576, 150, 122],
    ['tank', 'G', '탱크', 'ullage·육상 수용률', 716, 150, 122],
    ['plant', '', '정제 공정', '원유 투입 계획', 856, 150, 128],
    ['wind', 'J', '풍속·파고', '접안 15 · 하역 18/20 m/s', 236, 36, 150],
    ['tide', 'J', '조석·UKC', '흘수 + 여유 수심', 406, 36, 150],
    ['fog', 'J', '시정', '도선·이동 가능 여부', 576, 36, 150],
    ['contract', 'B', '계약', '레이타임·요율·공제', 16, 268, 150],
    ['safety', 'K', '안전·규제', 'Vetting·작업 허가', 300, 268, 150],
    ['cargo', 'F', '화물·제품', '품질·샘플링·전환', 600, 268, 150],
    ['dem', '', '체선료 (결과)', '대기 시간 × 요율', 834, 268, 150],
  ];
  const NET_FALLBACK = [
    ['BERTH-OOS', 'E', 'SK3 Buoy 정비 — 11/05 07:00까지 사용 불가', 'BERTH-OOS', true],
    ['ULS-SBM-NIGHT', 'E', 'SBM 야간 계류 금지 (주간 07:00~17:30)', 'ULS-SBM-NIGHT', true],
    ['ULS-DWT-MAX', 'E', '선석별 최대 DWT·LOA', 'ULS-DWT-MAX', false],
    ['ULS-CARGO-TYPE', 'F', '선석 취급 화물 유형 일치', 'ULS-CARGO-TYPE', false],
    ['SHORE-RATE', 'G', '육상 수용률 = 탱크 여유 (TK-104 레버로 9,000 → 12,000 m³/h)', 'PLAN-PUMP-RATE', true],
    ['PIPE-LIMIT', 'H', '선석 배관 한도', 'PLAN-PUMP-RATE', false],
    ['MARINE-DUR', 'I', '도선·이동 고정 소요 (SBM 120분·부두 90분)', 'PLAN-DURATIONS', false],
    ['WEATHER', 'J', '풍속 15 m/s 이상 접·계류 불가, SBM 18 m/s 이상 하역 중단', 'ULS-WEATHER-LIMIT', true],
    ['UKC', 'J', '흘수 + UKC ≤ 수심', 'ULS-DRAFT-UKC', false],
    ['DAYTIME', 'K', 'SK3~8 대형선 주간 접안', 'ULS-SK38-DAYTIME', false],
  ].map(([id, domain, label, rule, binding]) => ({ id, domain, label, rule, active: true, binding, example: true }));
  function netKey(c) {
    const d = String(c.domain || '').trim().toUpperCase().charAt(0);
    const txt = `${c.id || ''} ${c.label || ''} ${c.rule || ''}`;
    if (d === 'J') return /TIDE|UKC|조석|조위|흘수/i.test(txt) ? 'tide' : /FOG|VIS|시정|안개/i.test(txt) ? 'fog' : 'wind';
    return { B: 'contract', C: 'vessel', D: 'anch', E: 'berth', F: 'cargo', G: 'tank', H: 'pipe', I: 'marine', K: 'safety' }[d] || null;
  }
  function netSvg(cons, sel, live) {
    const P = 'cx5';
    const st = {};
    cons.forEach((c) => {
      const k = netKey(c);
      if (!k) return;
      const b = (st[k] = st[k] || { n: 0, on: 0, bind: 0, h: 0, usd: 0 });
      b.n += 1;
      if (c.active !== false) b.on += 1;
      if (c.binding) { b.bind += 1; b.h += num(c.binding_hours) || 0; b.usd += num(c.cost_usd) || 0; }
    });
    let s = svgOpen(1000, 344, '자원·제약 네트워크: 선박→묘박지→도선·예선→선석→배관→탱크→정제 공정, 환경(풍속·조석·시정)과 안전·화물·계약이 고리를 막으면 대기가 생기고 체선료가 된다', 'group') + defs(P);
    const at = (k) => NET_NODES.find((n) => n[0] === k);
    const mid = (k, side) => { const [, , , , x, y, w] = at(k); return side === 'b' ? [x + w / 2, y + 56] : side === 't' ? [x + w / 2, y] : side === 'l' ? [x, y + 28] : [x + w, y + 28]; };
    ['vessel', 'anch', 'marine', 'berth', 'pipe', 'tank', 'plant'].reduce((a, b) => { const [x1, y1] = mid(a, 'r'); const [x2, y2] = mid(b, 'l'); s += edge(x1 + 1, y1, x2 - 3, y2, '', `${P}-a`); return b; });
    [['wind', 'marine'], ['wind', 'berth'], ['tide', 'berth'], ['tide', 'marine'], ['fog', 'marine']].forEach(([a, b]) => { const [x1, y1] = mid(a, 'b'); const [x2, y2] = mid(b, 't'); s += edge(x1, y1 + 1, x2, y2 - 3, 'soft', `${P}-a`); });
    [['safety', 'berth'], ['cargo', 'tank'], ['cargo', 'pipe']].forEach(([a, b]) => { const [x1, y1] = mid(a, 't'); const [x2, y2] = mid(b, 'b'); s += edge(x1, y1 - 1, x2, y2 + 3, 'soft', `${P}-a`); });
    s += pathEdge('M 217 206 V 240 H 909 V 265', 'money', `${P}-m`);
    s += svgText(560, 236, '어느 고리든 막히면 → 묘박지 대기 → 체선료', { anchor: 'middle', fs: 10.5, cls: 't-dem t-b' });
    s += pathEdge('M 91 324 V 338 H 909 V 327', 'money', `${P}-m`);
    s += svgText(500, 333, '계약 조건이 대기 시간을 돈으로 바꾼다', { anchor: 'middle', fs: 10, cls: 't-mut' });
    NET_NODES.forEach(([k, d, name, sub, x, y, w]) => {
      const b = st[k];
      const cls = k === 'dem' ? 'dem-node' : !live && !b ? '' : !b ? 'st-off' : b.bind ? 'st-bind' : b.on ? 'st-on' : 'st-off';
      const line = k === 'dem' || k === 'plant' || !b ? sub : b.bind ? `구속 ${b.bind}건${b.h ? ` · ${fmtH(b.h)}` : ''}${b.usd ? ` · ${usd(b.usd)}` : ''}` : `제약 ${b.n}건 · 지금 막지 않음`;
      const clickable = !!b;
      s += node(x, y, w, 56, `${cls}${clickable ? ' cx-click' : ''}${sel === k ? ' sel' : ''}`, name, line, {
        fsT: 12.5, fsS: 10, sLines: 2, tLines: 1, badge: d || '',
        attrs: clickable ? `role="button" tabindex="0" data-cx-net="${k}" aria-pressed="${sel === k}" aria-label="${esc(`${name}: ${line}`)}"` : '',
      });
    });
    return `${s}</svg>`;
  }
  sec({
    id: 'resources', short: '자원·제약', anchors: 'resources constraints network', kicker: 'Coverage E–K',
    title: '자원·제약 네트워크 — 대기는 어느 고리에서 생기나',
    lead: () => `<p>체선료는 ‘대기’의 결과이고, 대기는 자원 사슬의 어느 고리가 막혔는지로 설명된다. 배가 도착해도 ${term('도선')}·${term('예선')}, ${term('선석')}, 배관, 탱크 중 하나라도 준비되지 않으면 기다린다. 바람·${term('조석 창')}·시정 같은 환경은 이 고리의 문을 열고 닫고, 안전 검사(${term('Vetting')})와 화물 조건이 문 앞에 조건을 붙인다.</p>
      <p>빨간 테두리는 지금 시각에 실제로 계획을 막고 있는(구속) 제약이다. 상자를 누르면 아래 표가 그 영역만 보여 준다.</p>`,
    links: () => [hashLink({ tab: 'resources' }, '자원·제약 — 시나리오별 구속 제약'), hashLink({ tab: 'timeline' }, '타임라인 — 풍속·조위 띠')],
    mount(body, ctx) {
      const st = { cons: NET_FALLBACK, live: false, sel: null, t: null, sc: 'BASE', scs: [], err: null };
      const table = () => {
        const rows = st.cons.filter((c) => !st.sel || netKey(c) === st.sel)
          .sort((a, b) => (b.binding ? 1 : 0) - (a.binding ? 1 : 0) || (num(b.cost_usd) || 0) - (num(a.cost_usd) || 0) || (b.active !== false ? 1 : 0) - (a.active !== false ? 1 : 0));
        return `<div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>영역</th><th>제약</th><th>근거</th><th>상태</th><th class="num">구속 시간</th><th class="num">비용</th><th>위치·메모</th></tr></thead><tbody>
          ${rows.slice(0, st.all ? rows.length : 12).map((c) => { const d = String(c.domain || '').toUpperCase().charAt(0); return `<tr><td class="small nw"><b class="mono">${esc(d)}</b> ${esc(CDOMAIN[d] || '')}</td><td>${esc(c.label || c.id)}${c.phase ? `<div class="small muted">${esc(c.phase)}</div>` : ''}</td><td>${c.rule ? ruleChip(c.rule) : '—'}</td><td>${c.binding ? '<span class="cx-tag dem">구속</span>' : c.active === false ? '<span class="cx-tag">해당 없음</span>' : '<span class="cx-tag acc">활성</span>'}</td><td class="num">${c.binding_hours != null ? fmtH(c.binding_hours) : '—'}</td><td class="num">${c.cost_usd != null ? usd(c.cost_usd) : '—'}</td><td class="small">${esc([c.where, c.note].filter(Boolean).join(' · ') || '')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">이 영역에 해당하는 제약이 없습니다</td></tr>'}
          </tbody></table></div>${rows.length > 12 && !st.all ? `<button type="button" class="btn small" data-cx-all>모두 보기 (${rows.length})</button>` : ''}`;
      };
      const draw = () => {
        if (!body.isConnected) return;
        const head = st.live
          ? `<span class="cx-verify ok">엔진 응답 · ${st.t ? `기준 시각 ${esc(fmtTs(parseTs(st.t)))}` : '현재 시각'} · ${esc(st.sc)}</span>`
          : failNote(st.err ? `예시 그림 — /api/resources 연결 전 (${st.err})` : '예시 그림 · 자원 정보 불러오는 중…');
        const scSel = st.scs.length ? `<label class="small muted">시나리오 <select data-cx-sc>${['BASE', ...st.scs.map((x) => (typeof x === 'string' ? x : x.id)).filter((x) => x && x !== 'BASE')].map((id) => { const o = st.scs.find((x) => x && x.id === id); return `<option value="${esc(id)}"${id === st.sc ? ' selected' : ''}>${esc(id)}${o && o.title ? ` · ${esc(o.title)}` : ''}</option>`; }).join('')}</select></label>` : '';
        body.innerHTML = `<div class="cx-figtop">${head}${scSel}${st.sel ? `<button type="button" class="btn small" data-cx-net="${st.sel}">필터 해제 · ${esc((NET_NODES.find((n) => n[0] === st.sel) || [])[2] || '')}</button>` : ''}</div>
          <div class="cx-fig">${netSvg(st.cons, st.sel, st.live)}</div>
          <div class="cx-legend"><span><i class="bind"></i>구속 — 지금 계획을 막는 중</span><span><i class="on"></i>활성 — 검사하지만 막지 않음</span><span><i class="off"></i>해당 제약 없음</span><span><i class="dem"></i>체선료로 이어지는 흐름</span></div>
          ${table()}`;
      };
      const load = () => {
        const t = new URLSearchParams(location.hash.slice(1)).get('t');
        const q = [t ? `t=${encodeURIComponent(t)}` : '', st.sc !== 'BASE' ? `scenario=${encodeURIComponent(st.sc)}` : ''].filter(Boolean).join('&');
        ctx.get(`/api/resources${q ? `?${q}` : ''}`, true).then((r) => {
          const cons = arr(r && r.constraints);
          if (!cons.length) throw new Error('constraints 없음');
          Object.assign(st, { cons, live: true, t: (r && r.t) || t, scs: arr(r && r.scenarios), err: null });
          draw();
        }).catch((e) => { st.err = e.message; draw(); });
      };
      body.addEventListener('click', (e) => {
        if (e.target.closest('[data-cx-all]')) { st.all = true; draw(); return; }
        const g = e.target.closest('[data-cx-net]');
        if (!g) return;
        st.sel = st.sel === g.dataset.cxNet ? null : g.dataset.cxNet;
        st.all = false;
        draw();
        const again = body.querySelector(`g[data-cx-net="${g.dataset.cxNet}"]`);
        if (again) again.focus();
      });
      body.addEventListener('change', (e) => { const s = e.target.closest('[data-cx-sc]'); if (s) { st.sc = s.value; load(); } });
      draw();
      load();
    },
  });

  // ================================================================ 6. 시스템 아키텍처
  function archSvg() {
    const P = 'cx6';
    let s = svgOpen(1000, 456, '시스템 아키텍처: 입력 5종이 결정론적 엔진(시뮬레이션·최적화·에이전트·레이타임 시계·리플레이)으로 들어가고, 사람이 승인하면 계획 버전과 감사 로그가 바뀐다. 웹 콘솔·MCP·정적 사이트가 같은 엔진을 부른다') + defs(P);
    s += pathEdge('M 986 146 H 994 V 14 H 314 V 58', 'acc', `${P}-c`);
    s += svgText(650, 10, '승인 → 계획 v+1 → 같은 엔진으로 재시뮬레이션', { anchor: 'middle', fs: 10.5, cls: 't-acc t-b' });
    [['선박·ETA', '대리점 통지·AIS'], ['SOF·NOR 문서', '선장·대리점·터미널'], ['계약 조건', 'C/P·GTC (contracts.json)'], ['기상·조석 예보', 'KMA·KHOA (weather.json)'], ['터미널 자원', '선석·탱크·배관 (berths·plan)']]
      .forEach(([t, sub], i) => {
        const y = 40 + i * 72;
        s += node(14, y, 176, 56, 'k-in', t, sub, { fsT: 12.5, fsS: 10 });
        s += edge(190, y + 28, 202, y + 28, '');
      });
    s += edge(202, 68, 202, 356, '');
    [92, 212, 332].forEach((y) => { s += edge(202, y, 228, y, '', `${P}-a`); });
    s += `<rect x="214" y="24" width="562" height="376" rx="12" class="lane-bg"/>`;
    s += svgText(495, 44, 'Desk (engine/service.py) — 결정론적 파이썬 엔진', { anchor: 'middle', fs: 11.5, cls: 't-b t-mut' });
    const E = [[232, 60, 'SIM · 계획 시뮬레이션', 'sim.py · world.py'], [414, 60, 'OPTIMIZER · 후보 탐색', 'optimize.py'], [596, 60, 'AGENT · 후보 카드·초안', 'agent.py · drafts.py'],
      [232, 180, 'INTAKE · SOF 파싱·대조', 'intake.py'], [414, 180, 'CLOCK · 레이타임 시계', 'clock.py · reasons.py'], [596, 180, 'CLAIMS · 클레임 재계산', 'claims.py'],
      [232, 300, 'REPLAY · 정책 경쟁', 'replay.py · validate.py'], [414, 300, 'SCENARIO · 시나리오', 'scenarios.py'], [596, 300, 'DIAGNOSIS · 진단·사업성', 'diagnosis.py · business.py']];
    E.forEach(([x, y, t, sub]) => { s += node(x, y, 162, 64, 'k-eng', t, sub, { fsT: 11.5, fsS: 10, sCls: 't-mut t-mono' }); });
    [[394, 92, 412, 92], [576, 92, 594, 92], [394, 212, 412, 212], [576, 212, 594, 212], [394, 332, 412, 332], [576, 332, 594, 332]].forEach(([a, b, c, d]) => { s += edge(a, b, c, d, '', `${P}-a`); });
    s += edge(495, 178, 495, 127, 'acc', `${P}-c`);
    s += svgText(503, 156, '모든 후보를 같은 시계로', { fs: 9.5, cls: 't-acc' });
    s += pathEdge('M 240 300 V 270 H 222 V 108 H 229', 'soft', `${P}-a`);
    s += svgText(226, 286, 'SIM·OPTIMIZER 재사용', { fs: 9.5, cls: 't-mut' });
    s += node(794, 40, 192, 56, 'k-human', '사람 승인 (작업함)', '확인 · 옵션 적용 · 반려', { fsT: 12.5, fsS: 10 });
    s += node(794, 118, 192, 56, 'k-out', '계획 vN · 감사 로그', 'store.py (runtime/state.json)', { fsT: 12.5, fsS: 10, sCls: 't-mut t-mono' });
    s += node(794, 196, 192, 56, 'k-llm', 'LLM 슬롯 (선택)', '문장만 다듬음 · 숫자는 엔진 값 그대로', { fsT: 12, fsS: 10 });
    s += node(794, 272, 192, 56, 'k-out', '계산서 · 클레임 회신 초안', '체선사유 · 워터폴', { fsT: 12, fsS: 10 });
    s += node(794, 344, 192, 56, 'k-out', '진단 · 검증 · 사업성', 'VIRTUAL 리포트', { fsT: 12.5, fsS: 10 });
    s += edge(758, 80, 792, 68, 'acc', `${P}-c`);
    s += edge(890, 97, 890, 115, 'acc', `${P}-c`);
    s += svgText(898, 111, '승인', { fs: 10, cls: 't-acc t-b' });
    s += edge(758, 108, 792, 222, 'soft', '');
    s += edge(758, 212, 792, 298, '', `${P}-a`);
    s += edge(758, 332, 792, 370, '', `${P}-a`);
    s += svgText(495, 418, '같은 Desk를 부르는 세 개의 출입구', { anchor: 'middle', fs: 10.5, cls: 't-mut t-b' });
    [['웹 콘솔 · server.py', 214], ['MCP · 읽기 전용 18도구', 403], ['정적 사이트 · Pyodide', 592]].forEach(([t, x]) => { s += node(x, 426, 184, 28, 'k-out', t, '', { fsT: 11, tLines: 1, rx: 14 }); });
    return `${s}</svg>`;
  }
  sec({
    id: 'architecture', short: '시스템 구조', anchors: 'architecture system engine pipeline dual_brain', kicker: '입력 5 · 엔진 1 · 출입구 3',
    title: '시스템 아키텍처 — 계산은 엔진이, 결정은 사람이',
    lead: () => `<p>입력은 다섯 종류, 엔진은 하나, 출입구는 셋이다. 레이타임 계산·시뮬레이션·최적화는 모두 결정론적 파이썬 엔진이 하고, 같은 입력에는 항상 같은 숫자가 나온다. 사람은 작업함에서 승인·반려만 하며, 승인하면 ${term('계획 버전')}이 올라가고 같은 엔진이 새 계획으로 다시 돈다.</p>
      <p>LLM이 붙더라도 문장을 다듬는 슬롯일 뿐 숫자를 바꾸지 못한다(${term('듀얼 브레인')}). 웹 서버, ${term('MCP')} 서버, 브라우저 안의 ${term('Pyodide')}가 모두 같은 Desk를 부르므로 어디서 보든 답이 같다.</p>`,
    links: () => [hashLink({ tab: 'guide' }, '작동 원리 — 파이프라인·입력 데이터 출처'), hashLink({ tab: 'audit' }, '감사 로그 — 사람이 내린 결정')],
    mount(body) {
      body.innerHTML = `<div class="cx-fig">${archSvg()}</div>
        <div class="cx-legend"><span><i class="k-in"></i>입력</span><span><i class="on"></i>엔진 모듈</span><span><i class="part"></i>사람</span><span><i class="k-out"></i>산출물·출입구</span><span><i class="k-llm"></i>선택 슬롯(LLM)</span></div>
        <div class="cx-cols" style="margin-top:8px">
          <div class="cx-card"><h4>결정론적 계산</h4><ul><li>같은 SOF·계약 → 같은 계산서 (골든 케이스로 회귀 시험)</li><li>후보 비교·리플레이·시나리오 모두 같은 레이타임 시계(clock.py)</li><li>미리 계산한 검증 결과는 엔진 지문이 같을 때만 재사용</li></ul></div>
          <div class="cx-card"><h4>사람의 자리</h4><ul><li>후보 승인·반려, NOR 수락·유보, 클레임 수용·반박</li><li>쟁점은 자동 판정하지 않음 (${ruleChip('ENG-DISPUTE-NO-AUTO')})</li><li>MCP는 읽기 전용 — 승인은 화면에서만</li></ul></div>
          <div class="cx-card"><h4>세 개의 출입구</h4><ul><li><b>웹 콘솔</b>: <code>python3 server.py</code> — 결정이 runtime/state.json에 저장</li><li><b>MCP</b>: AI 도구에서 상태·계산서·규칙 조회</li><li><b>정적 사이트</b>: 서버 없이 브라우저에서 같은 엔진 실행</li></ul></div>
        </div>`;
    },
  });

  // ================================================================ 7. 문제 정의 (최적화 문제로 보기)
  const HARD_RULES = ['ULS-SBM-NIGHT', 'ULS-SK38-DAYTIME', 'ULS-DAYTIME-DEF', 'ULS-DWT-MAX', 'ULS-SBM-MIN-DWT', 'ULS-DRAFT-UKC', 'ULS-LOA-MAX', 'ULS-CARGO-TYPE', 'ULS-WEATHER-LIMIT', 'BERTH-OOS'];
  const PLAN_RULES = ['PLAN-DURATIONS', 'PLAN-TURNOVER', 'PLAN-NOR-DELAY', 'PLAN-PUMP-RATE', 'ENG-ETB-CHANGE', 'ENG-LOW-MARGIN'];
  const OBJ_RULES = ['ASB-06-NOR-START', 'ASB-07-SHIFTING-EXCL', 'ASB-08-RATE-PRORATA', 'ASB-08-HALF-RATE', 'ASB-09-REACHABLE', 'ASB-11-END-HOSES'];
  function problemSvg(o) {
    const P = 'cx7';
    let s = svgOpen(1000, 206, `최적화 문제: 결정 변수 → 후보 ${o.evaluated}개 생성 → 제약 검사로 ${o.excluded}건 탈락 → 같은 시계로 비용 평가 → 체선료 합 최소`) + defs(P);
    s += `<g class="cx-box k-in"><rect x="14" y="16" width="236" height="174" rx="10"/></g>`;
    s += svgText(30, 38, '결정 변수 x', { fs: 13, cls: 't-b' });
    ['x₁ 선석 배정 (SK2B·SK3B·SK7·SK8)', 'x₂ 접안 순서·시각', 'x₃ 운영 레버 (탱크 추가·수용률)', 'x₄ NOR 회신·통보 시점'].forEach((t, i) => { s += svgText(30, 64 + i * 30, t, { fs: 11.5 }); });
    s += edge(252, 103, 282, 103, '', `${P}-a`);
    s += node(286, 58, 150, 90, 'k-eng', `후보 생성 ${o.evaluated}개`, '이동 1~2건 · 순서 교체 · 레버 조합', { fsT: 13, fsS: 10.5 });
    s += edge(438, 103, 468, 103, '', `${P}-a`);
    s += `<polygon points="472,30 636,30 606,176 502,176" class="cx-funnel"/>`;
    s += svgText(554, 62, 'Hard 제약 검사', { anchor: 'middle', fs: 12.5, cls: 't-b' });
    s += svgText(554, 82, '야간 계류·DWT·UKC', { anchor: 'middle', fs: 10, cls: 't-mut' });
    s += svgText(554, 96, '화물 유형·풍속·정비', { anchor: 'middle', fs: 10, cls: 't-mut' });
    s += svgText(554, 128, `탈락 ${o.excluded}건`, { anchor: 'middle', fs: 13, cls: 't-dem t-b' });
    s += svgText(554, 148, `통과 → 상위 ${o.best}개 제시`, { anchor: 'middle', fs: 10, cls: 't-mut' });
    s += edge(626, 103, 664, 103, '', `${P}-a`);
    s += node(668, 58, 150, 90, 'k-eng', '비용 평가', '같은 레이타임 시계로 선박별 체선료 합산', { fsT: 13, fsS: 10.5 });
    s += edge(820, 103, 846, 103, '', `${P}-a`);
    s += `<g class="cx-box k-out"><rect x="850" y="28" width="136" height="150" rx="10"/></g>`;
    s += svgText(918, 56, '목적', { anchor: 'middle', fs: 12, cls: 't-b t-mut' });
    s += svgText(918, 84, 'min Σ 체선료', { anchor: 'middle', fs: 14, cls: 't-b' });
    s += svgText(918, 106, '+ λ·위험', { anchor: 'middle', fs: 11.5, cls: 't-mut' });
    s += svgText(918, 122, '(Risk-aware일 때)', { anchor: 'middle', fs: 9.5, cls: 't-mut' });
    s += svgText(918, 152, '→ 1순위 + 대안', { anchor: 'middle', fs: 11.5, cls: 't-acc t-b' });
    return `${s}</svg>`;
  }
  sec({
    id: 'problem', short: '문제 정의', anchors: 'problem optimization formulation constraints', kicker: '변수 · 제약 · 목적',
    title: '문제 정의 — 에이전트가 푸는 최적화 문제',
    lead: () => `<p>수식으로 쓰면 단순하다: <b>지금 알고 있는 정보로, 지켜야 할 규칙을 어기지 않는 계획 중 체선료 합이 가장 작은 것</b>을 찾는다. 어려운 부분은 ‘지켜야 할 규칙’을 빠짐없이 적는 것이다. 아래 칩을 누르면 근거와 확인 상태(공개자료·원문 대조 전·가정·쟁점)가 보인다.</p>
      <p>${term('Optimizer')}는 SEAGATE Berth Optimization을 대체하지 않는다. 사람이 한 줄로 이해하고 승인할 수 있는 작은 변경(이동 1~2건·순서 교체·${term('운영 레버')})만 후보로 만들어 체선료로 비교한다.</p>`,
    links: () => [hashLink({ t: '2026-11-04T10:00', tab: 'inbox', item: 'IMP-1104-1000' }, '작업함 — 후보 9개를 비교한 실제 항목'), gotoLink('rules', null, '룰·근거 — 전체 룰과 확인 상태')],
    mount(body, ctx) {
      const draw = (o, ex, live) => {
        if (!body.isConnected) return;
        body.innerHTML = `${live ? '<div class="cx-figtop"><span class="cx-verify ok">11/04 10:00 항목 IMP-1104-1000의 실제 탐색 결과</span></div>' : ''}<div class="cx-fig">${problemSvg(o)}</div>
          <div class="cx-formula">min  Σᵢ 체선료ᵢ(접안ᵢ, 하역ᵢ)              ← 같은 레이타임 시계(clock.py)로 계산
     + λ · 위험(폭풍 종료 ±3h, 도착 전 선박 ETA ±3h)   ← Risk-aware Optimizer일 때만
s.t. 선석 적합   DWT · LOA · 흘수 + UKC ≤ 수심 · 취급 화물      (Hard)
     시간 창     SBM 야간 계류 금지 · 주간 07:00~17:30 · 풍속 한계 (Hard)
     부두제약    정비 기간에는 배정 금지                        (Hard)
     하역 속도   min(선박 펌프, 육상 수용률, 배관 한도)          (모델)
     변경 크기   이동 1~2건 · 레버 소수 — 사람이 승인 가능한 범위   (Soft)</div>
          <div class="cx-cols" style="margin-top:10px">
            <div class="cx-card"><h4>Hard 제약 — 어기면 후보에서 탈락</h4><div class="chips">${chips(HARD_RULES)}</div></div>
            <div class="cx-card"><h4>계획 가정 — 소요 시간·속도·알림 기준</h4><div class="chips">${chips(PLAN_RULES)}</div></div>
            <div class="cx-card"><h4>목적 함수의 근거 — 계약 조항</h4><div class="chips">${chips(OBJ_RULES)}</div></div>
          </div>
          ${ex.length ? `<details class="cx-detail"><summary><b>탈락한 후보 ${ex.length}건과 이유</b></summary><div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>선박</th><th>선석</th><th>이유</th><th>룰</th></tr></thead><tbody>${ex.map((x) => `<tr><td>${esc(x.vessel || x.call_id || '')}</td><td class="mono small">${esc(x.berth_id || '')}</td><td class="small">${esc(x.msg || '')}</td><td>${chips(x.rules)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
      };
      draw({ evaluated: 9, excluded: 7, best: 3 }, [], false);
      ctx.get('/api/item?id=IMP-1104-1000&t=2026-11-04T10:00').then((it) => {
        const op = it && it.options;
        if (!op) return;
        draw({ evaluated: num(op.evaluated) || arr(op.best).length, excluded: arr(op.excluded).length, best: arr(op.best).length }, arr(op.excluded), true);
      }).catch(() => {});
    },
  });

  // ================================================================ 8. Historical Replay
  const REPLAY_FALLBACK = {
    decision_points: [['2026-11-03T00:00', 'INIT', '기준 계획 수립 (t0)'], ['2026-11-04T06:00', 'ETA', 'JANGSAENGPO GRACE ETA 갱신 → 11/04 13:00'], ['2026-11-04T08:00', 'FORECAST', '동해남부 앞바다 풍랑주의보 예상: 11/04 17시~11/05 09시 북동풍 15~23 m/s'], ['2026-11-04T10:00', 'CONSTRAINT', 'SK3 Buoy 점검 조기 완료: 11/05 07:00부터 사용 가능']].map(([t, trigger, label]) => ({ t, trigger, label })),
    replay: [['CURRENT_RULE', '현업 Rule (SEAGATE v1 유지)', 251749.99], ['FCFS', 'FCFS (도착 순)', 155325], ['RATE', '체선료율 우선', 269326.39], ['LAYTIME_RISK', '레이타임 임박 우선', 155325], ['OPTIMIZER', 'Optimizer (완전 탐색)', 108741.67], ['RISK_AWARE', 'Risk-aware Optimizer', 108741.67], ['AGENT_HITL', 'Agent + 사람 승인', 108741.67]].map(([policy, label, total_usd]) => ({ policy, label, total_usd })),
    hindsight: { total_usd: 108741.67 },
    headline: { base_usd: 251749.99, best_usd: 108741.67, saving_pct: 56.8, best_label: 'Optimizer (완전 탐색)' },
    no_lookahead: '각 결정 시점 t에는 t까지 발행된 ETA·예보·부두제약과 t까지의 관측·실제 사건만 쓴다(KnownEnv). 채점만 실제 세계(truth)로 한다.',
  };
  const FORECAST_FALLBACK = [{ id: 'FC-1102-18', issued_at: '2026-11-02T18:00', summary: '11/03~11/08 남동풍 6~10 m/s, 특보 없음' }, { id: 'FC-1104-08', issued_at: '2026-11-04T08:00', summary: '동해남부 앞바다 풍랑주의보 예상: 11/04 17시~11/05 09시 북동풍 15~23 m/s' }];
  const TRIG_KO = { INIT: '기준 계획', ETA: 'ETA 갱신', FORECAST: '예보 갱신', CONSTRAINT: '부두제약 변경' };
  function stormWindow(summary) {
    const m = /(\d{2})\/(\d{2})\s*(\d{2})시\s*~\s*(\d{2})\/(\d{2})\s*(\d{2})시/.exec(summary || '');
    return m ? [parseTs(`2026-${m[1]}-${m[2]}T${m[3]}:00`), parseTs(`2026-${m[4]}-${m[5]}T${m[6]}:00`)] : null;
  }
  function replaySvg(dps, fcs, storm, sel) {
    const P = 'cx8';
    const t0 = parseTs('2026-11-02T18:00');
    const t1 = parseTs('2026-11-06T06:00');
    const L = 132;
    const R = 16;
    const X = (t) => +(L + ((Math.max(t0, Math.min(t1, t)) - t0) / (t1 - t0)) * (1000 - L - R)).toFixed(1);
    const lanes = [[56, '당시 최신 예보'], [104, '결정 시점 사건'], [152, '실제 날씨 (사후)']];
    let s = svgOpen(1000, 236, 'Historical Replay: 결정 시점마다 그때까지 발표된 예보와 사건만 보고 결정한다. 실제 강풍은 모든 결정 시점보다 뒤에 왔다') + defs(P);
    lanes.forEach(([y, lb]) => { s += `<rect x="${L}" y="${y}" width="${1000 - L - R}" height="34" rx="4" class="lane-bg"/>`; s += svgText(L - 8, y + 17, lb, { anchor: 'end', middle: true, fs: 11.5, cls: 't-b', maxW: L - 14, maxLines: 2 }); });
    fcs.forEach((f, i) => {
      const a = parseTs(f.issued_at);
      const b = i + 1 < fcs.length ? parseTs(fcs[i + 1].issued_at) : t1;
      const w = X(b) - X(a);
      s += `<rect x="${X(a)}" y="59" width="${w.toFixed(1)}" height="28" rx="3" class="${i ? 'cx-ph-prep' : 'cx-ph-wait'}"><title>${esc(`${f.id} (${fmtTs(a)} 발표): ${f.summary}`)}</title></rect>`;
      const win = stormWindow(f.summary);
      if (win) s += `<rect x="${X(win[0])}" y="59" width="${(X(win[1]) - X(win[0])).toFixed(1)}" height="28" rx="3" class="cx-storm"><title>예보된 강풍 ${fmtTs(win[0])}–${fmtTs(win[1])}</title></rect>`;
      s += svgText(X(a) + 6, 77, `${f.id} · ${win ? '풍랑주의보 예상' : '평온 (특보 없음)'}`, { fs: 10.5, cls: 't-b', maxW: Math.max(40, w - 12), maxLines: 1 });
    });
    if (storm) {
      s += `<rect x="${X(storm[0])}" y="155" width="${(X(storm[1]) - X(storm[0])).toFixed(1)}" height="28" rx="3" class="cx-storm"><title>관측 강풍 ${fmtTs(storm[0])}–${fmtTs(storm[1])}</title></rect>`;
      s += svgText((X(storm[0]) + X(storm[1])) / 2, 173, `관측 강풍 ${fmtTs(storm[0])}부터 ${fmtH((storm[1] - storm[0]) / HOUR)}`, { anchor: 'middle', fs: 10.5, cls: 't-b' });
    }
    // 알던 구간·모르는 구간 — 예보 레인은 그 시각까지 '발표된' 예보는 보이고, 아직 발표 전인 예보만 가린다
    const T = parseTs(dps[sel].t);
    const xs = X(T);
    const nextFc = fcs.map((f) => parseTs(f.issued_at)).filter((t) => t > T).sort((a, b) => a - b)[0];
    s += `<rect x="${L}" y="52" width="${(xs - L).toFixed(1)}" height="142" class="cx-known"/>`;
    if (nextFc != null) s += `<rect x="${X(nextFc)}" y="56" width="${(1000 - R - X(nextFc)).toFixed(1)}" height="34" class="cx-future"/>`;
    s += `<rect x="${xs}" y="100" width="${(1000 - R - xs).toFixed(1)}" height="94" class="cx-future"/>`;
    dps.forEach((d, i) => {
      const x = X(parseTs(d.t));
      const cy = i % 2 ? 128 : 114;
      s += `<line x1="${x}" y1="40" x2="${x}" y2="190" class="cx-dp${i === sel ? ' sel' : ''}"/>`;
      s += `<g class="cx-click${i === sel ? ' sel' : ''}" role="button" tabindex="0" data-cx-dp="${i}" aria-pressed="${i === sel}" aria-label="결정 시점 ${i + 1}: ${esc(fmtTs(parseTs(d.t)))} ${esc(TRIG_KO[d.trigger] || d.trigger)}"><circle cx="${x}" cy="${cy}" r="9" class="cx-dp-dot"/><text x="${x}" y="${cy + 4}" text-anchor="middle" class="t-b t-mono t-onacc" style="font-size:10px">${i + 1}</text></g>`;
    });
    s += svgText(Math.max(L + 70, xs - 8), 46, '← 이 시점에 알던 것', { anchor: 'end', fs: 10.5, cls: 't-acc t-b' });
    s += svgText(Math.min(1000 - R - 160, xs + 8), 46, '모르는 것 — 리플레이에서 차단 →', { fs: 10.5, cls: 't-mut t-b' });
    s += `<line x1="${L}" y1="200" x2="${1000 - R}" y2="200" class="grid strong"/>`;
    for (let t = parseTs('2026-11-03T00:00'); t <= t1; t += 12 * HOUR) {
      const x = X(t);
      s += `<line x1="${x}" y1="200" x2="${x}" y2="${new Date(t).getUTCHours() ? 204 : 208}" class="grid strong"/>`;
      s += `<text x="${x}" y="220" text-anchor="middle" class="t-mut t-mono" style="font-size:9.5px">${esc(fmtTs(t))}</text>`;
    }
    return `${s}</svg>`;
  }
  function policyBars(rows, hind, bestId) {
    const max = Math.max(1, ...rows.map((r) => num(r.total_usd) || 0));
    const all = rows.concat(hind != null ? [{ policy: 'HINDSIGHT', label: '사후 최적 (미래를 모두 앎 · 하한)', total_usd: hind }] : []);
    const H = all.length * 26 + 12;
    let s = svgOpen(1000, H, `정책별 실제 체선료: ${all.map((r) => `${r.label} ${usd(r.total_usd)}`).join(', ')}`);
    all.forEach((r, i) => {
      const y = 6 + i * 26;
      const w = ((num(r.total_usd) || 0) / max) * 600;
      const cls = r.policy === 'HINDSIGHT' ? 'hind' : r.policy === 'CURRENT_RULE' ? 'base' : r.policy === bestId ? 'best' : '';
      s += svgText(232, y + 14, r.label, { anchor: 'end', fs: 11.5, cls: r.policy === bestId ? 't-b' : '' });
      s += `<rect x="242" y="${y + 2}" width="${Math.max(2, w).toFixed(1)}" height="17" rx="3" class="cx-bar ${cls}"/>`;
      s += `<text x="${(250 + w).toFixed(1)}" y="${y + 15}" class="t-mono${cls === 'best' ? ' t-good t-b' : ''}" style="font-size:11px">${usd(r.total_usd)}</text>`;
    });
    return `${s}</svg>`;
  }
  sec({
    id: 'replay', short: 'Historical Replay', anchors: 'replay historical_replay hindsight no_lookahead validation', kicker: 'no-lookahead · 사후 최적 = 하한',
    title: 'Historical Replay — 그때 알던 것만으로 결정했다면?',
    lead: () => `<p>검증의 핵심은 ‘미래를 몰랐던 척’ 하는 것이다. 지난 1주를 다시 돌리면서, 각 결정 시점에는 그때까지 발표된 ETA·예보·부두제약만 정책에 보여 준다(${term('No-lookahead')}). 채점만 실제로 일어난 일로 한다. 미래까지 다 아는 ${term('사후 최적')}은 도달할 수 없는 하한으로 함께 놓는다.</p>
      <p>결정 시점 번호를 누르면 그 시점에 보이던 것과 가려진 것이 바뀐다. 실제 강풍은 어느 결정 시점보다도 뒤에 왔다 — 정책은 예보만 보고 움직여야 했다.</p>`,
    links: () => [gotoLink('validation', 'replay', '검증 — 정책 경쟁·Historical Replay'), gotoLink('validation', 'decision_points', '검증 — 결정 시점'), hashLink({ t: '2026-11-04T08:00', tab: 'inbox', item: 'IMP-1104-0800' }, '작업함 — 예보가 들어온 순간')],
    mount(body, ctx) {
      const st = { sel: 2, v: REPLAY_FALLBACK, fcs: FORECAST_FALLBACK, storm: [parseTs('2026-11-04T19:00'), parseTs('2026-11-05T13:00')], live: false };
      const draw = () => {
        if (!body.isConnected) return;
        const dps = arr(st.v.decision_points).length ? st.v.decision_points : REPLAY_FALLBACK.decision_points;
        st.sel = Math.max(0, Math.min(dps.length - 1, st.sel));
        const d = dps[st.sel];
        const T = parseTs(d.t);
        const fc = st.fcs.filter((f) => parseTs(f.issued_at) <= T).pop();
        const hl = st.v.headline || {};
        const bestId = hl.best_policy || 'OPTIMIZER';
        body.innerHTML = `${st.live ? '<div class="cx-figtop"><span class="cx-verify ok">엔진 검증 결과 (리플레이 · 7개 정책)</span></div>' : '<div class="cx-figtop"><span class="cx-verify">내장 요약 · 검증 결과 불러오는 중…</span></div>'}
          <div class="cx-fig">${replaySvg(dps, st.fcs, st.storm, st.sel)}</div>
          <div class="cx-legend"><span><i class="wait"></i>평온 예보</span><span><i class="pump-soft"></i>풍랑주의보 예보</span><span><i class="storm"></i>강풍(예보·관측)</span><span><i class="known"></i>알던 구간</span></div>
          <div class="cx-stepcard" aria-live="polite"><h4>결정 시점 ${st.sel + 1} · ${esc(TRIG_KO[d.trigger] || d.trigger)}<span class="when">${esc(fmtTs(T))}</span></h4>
            <p>${esc(d.label)}. 이 시점의 최신 예보는 <b>${esc(fc ? fc.id : '없음')}</b>${fc ? ` — ${esc(fc.summary)}` : ''}. ${fc && stormWindow(fc.summary) ? '정책은 예보된 강풍을 피하는 계획을 세울 수 있다.' : '정책은 아직 폭풍을 모른다 — 이 시점의 결정을 사후에 탓하면 lookahead다.'}</p></div>
          <div class="cx-stack">
            <div class="cx-card"><h4>정책별 실제 체선료 (같은 정보, 다른 결정 규칙)</h4><div class="cx-fig">${policyBars(arr(st.v.replay), st.v.hindsight && st.v.hindsight.total_usd, bestId)}</div></div>
            <div class="cx-card"><h4>읽는 법</h4><ul>
              <li>현업 Rule(기준 계획 유지) ${usd(hl.base_usd)} → ${esc(hl.best_label || 'Optimizer')} ${usd(hl.best_usd)} <b>(−${esc(hl.saving_pct)}%)</b></li>
              <li>사후 최적 ${usd(st.v.hindsight && st.v.hindsight.total_usd)}는 미래를 다 아는 하한. 최선 정책이 하한과 같다 = 이번 사례에서는 예보·통보가 충분히 일찍 들어왔다.</li>
              <li>‘체선료율 우선’처럼 그럴듯한 단순 규칙이 오히려 현업보다 나쁠 수 있다 — 그래서 정책을 같은 조건으로 겨룬다.</li>
              <li class="muted">${esc(st.v.no_lookahead || REPLAY_FALLBACK.no_lookahead)}</li></ul></div>
          </div>`;
      };
      body.addEventListener('click', (e) => {
        const g = e.target.closest('[data-cx-dp]');
        if (!g) return;
        st.sel = +g.dataset.cxDp;
        draw();
        const again = body.querySelector(`[data-cx-dp="${st.sel}"]`);
        if (again) again.focus();
      });
      draw();
      ctx.get('/api/validation').then((v) => { setCount('scenarios', arr(v && v.scenarios).length); if (v && arr(v.replay).length) { st.v = v; st.live = true; draw(); } }).catch(() => {});
      ctx.get('/api/diagnosis').then((g) => {
        const f = g && g.facts;
        if (!f) return;
        if (arr(f.forecasts).length) st.fcs = f.forecasts;
        const w = f.weather;
        if (w && w.storm_start && num(w.storm_hours)) { const a = parseTs(w.storm_start); st.storm = [a, a + w.storm_hours * HOUR]; }
        draw();
      }).catch(() => {});
    },
  });

  // ================================================================ 9. 통제가능성 매트릭스
  const CTRL_FALLBACK = [
    ['WAIT:CONGESTION', 'R01', '선석 점유 대기', 151382.84, 3, 'A', 'Optimization'],
    ['SHORE_RATE', 'R04', '육상 수용률 제한(하역 지연)', 62225.46, 4, 'A', 'Optimization (운영 레버)'],
    ['STOP:WEATHER', 'R03', '기상 — 하역 중단', 20775.52, 1, 'C', 'Scenario / Risk'],
    ['WAIT:NIGHT', 'R02', '야간 계류·접안 제한', 13695.41, 2, 'B', 'Scheduling Constraint'],
    ['WAIT:WEATHER', 'R03', '기상 — 접안 불가', 3670.75, 1, 'C', 'Scenario / Risk'],
    ['NOR_TIMING', '—', 'NOR 시점·유효성 (도착 전 NOR 등)', 0, 1, 'A', 'Rule / Agent (NOR 점검·회신)'],
    ['SHIFT', 'R08', '이동(shifting)', 0, 3, 'D', 'Scope Outside'],
  ].map(([key, code, label, cost_usd, frequency, cls, solution]) => ({ key, code, label, cost_usd, frequency, class: cls, solution }));
  const CLASS_FALLBACK = [
    { class: 'A', label: 'A. 통제 가능 → Optimization Decision', rule: '직접 바꾸거나 협의로 바꿀 수 있다' },
    { class: 'B', label: 'B. 통제 불가·예측 가능 → Scheduling Constraint', rule: '바꿀 수는 없지만 미리 안다' },
    { class: 'C', label: 'C. 통제 불가·불확실 → Scenario / Risk', rule: '바꿀 수 없고 정확히 알기도 어렵다' },
    { class: 'D', label: 'D. 사실상 대응 불가 → Scope Outside', rule: '계약·물리적으로 피할 수 없다' },
  ];
  const CTRL_REGION = { A: [16, 40, 474, 252, 'qa', 'ca'], B: [510, 40, 474, 121, 'qb', 'cb'], C: [510, 171, 474, 121, 'qc', 'cc'], D: [16, 302, 968, 62, 'qd', 'cd'] };
  function ctrlSvg(items, classes, shares, sel) {
    const maxC = Math.max(1, ...items.map((x) => num(x.cost_usd) || 0));
    const rOf = (c) => (c > 0 ? Math.max(7, Math.sqrt(c / maxC) * 52) : 6);
    let s = svgOpen(1000, 372, `통제가능성 매트릭스: ${items.map((x) => `${x.label}(${x.class}) ${usd(x.cost_usd)}`).join(', ')}`, 'group');
    s += svgText(16, 22, '◀ 바꿀 수 있다', { fs: 11, cls: 't-mut t-b' });
    s += svgText(500, 22, '통제할 수 있나? · 미리 알 수 있나?', { anchor: 'middle', fs: 11.5, cls: 't-b' });
    s += svgText(984, 22, '바꿀 수 없다 ▶', { anchor: 'end', fs: 11, cls: 't-mut t-b' });
    Object.entries(CTRL_REGION).forEach(([k, [x, y, w, h, q, bub]]) => {
      const c = classes.find((z) => z.class === k) || {};
      const sh = shares && shares[k];
      s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="cx-quad ${q}"/>`;
      s += svgText(x + 12, y + 20, c.label || k, { fs: 12, cls: 't-b', maxW: k === 'D' ? 380 : w - 140, maxLines: 1 });
      s += svgText(x + 12, y + 36, c.rule || '', { fs: 10.5, cls: 't-mut', maxW: k === 'D' ? 380 : w - 24, maxLines: 1 });
      if (sh) s += svgText(x + w - 12, y + 20, `${usd(sh.usd)} · ${pct(sh.share)}`, { anchor: 'end', fs: 12, cls: 't-b t-mono' });
      const list = items.filter((it) => it.class === k).sort((a, b) => (num(b.cost_usd) || 0) - (num(a.cost_usd) || 0));
      let cx = k === 'D' ? x + 420 : x + 22;
      list.forEach((it) => {
        const r = rOf(num(it.cost_usd) || 0);
        const big = k === 'A';
        const lw = big ? 132 : 168;
        const bx = cx + (big ? Math.max(r, lw / 2) : r);
        const by = big ? y + 112 : k === 'D' ? y + 36 : y + 78;
        const tx = big ? bx : bx + r + 8;
        const ty = big ? y + 112 + 52 + 18 : by - 4;
        s += `<g class="cx-click${sel === it.key ? ' sel' : ''}" role="button" tabindex="0" data-cx-ctrl="${esc(it.key)}" aria-pressed="${sel === it.key}" aria-label="${esc(`${it.code} ${it.label}: ${usd(it.cost_usd)}, ${k} 분류`)}">
          <circle cx="${bx.toFixed(1)}" cy="${by}" r="${r.toFixed(1)}" class="cx-bub ${bub}${(num(it.cost_usd) || 0) > 0 ? '' : ' zero'}"/>
          ${svgText(tx, ty, `${it.code !== '—' ? `${it.code} ` : ''}${it.label}`, { anchor: big ? 'middle' : 'start', fs: 11, cls: 't-b', maxW: lw, maxLines: 2 })}
          ${svgText(tx, ty + (textW(`${it.code} ${it.label}`, 11) > lw ? 30 : 16), `${usd(it.cost_usd)}${it.frequency ? ` · ${it.frequency}회` : ''}`, { anchor: big ? 'middle' : 'start', fs: 10.5, cls: 't-mut t-mono' })}</g>`;
        cx += big ? Math.max(2 * r, lw) + 16 : 2 * r + 8 + Math.min(lw, textW(`${it.code} ${it.label}`, 11)) + 22;
      });
    });
    return `${s}</svg>`;
  }
  sec({
    id: 'control', short: '통제가능성', anchors: 'controllability control matrix abcd', kicker: 'A 최적화 · B 일정 제약 · C 위험 대비 · D 범위 밖',
    title: '통제가능성 매트릭스 — 무엇을 최적화하고 무엇을 대비할까',
    lead: () => `<p>모든 원인을 최적화할 수는 없다. 원인을 ‘바꿀 수 있나’와 ‘미리 알 수 있나’로 나누면 대응 방식이 갈린다: <b>A</b>는 계획을 바꾸고(최적화), <b>B</b>는 계획에 미리 넣고(일정 제약), <b>C</b>는 시나리오로 대비하고, <b>D</b>는 범위 밖으로 둔다(${term('통제가능성')}).</p>
      <p>원의 넓이는 이번 가상 1주의 원인별 체선료 기여액이다(${term('체선사유')} 코드). 원을 누르면 근거가 나온다. 금액이 0인 원인도 지우지 않는다 — 이번 주에 비용이 없었을 뿐 언제든 생길 수 있는 원인이다.</p>`,
    links: () => [gotoLink('diagnosis', 'controllability', '진단 — 통제가능성 표'), gotoLink('diagnosis', 'root_causes', '진단 — 근본 원인')],
    mount(body, ctx) {
      const st = { items: CTRL_FALLBACK, classes: CLASS_FALLBACK, shares: { A: { usd: 213608.3, share: 0.8485 }, B: { usd: 13695.41, share: 0.0544 }, C: { usd: 24446.27, share: 0.0971 }, D: { usd: 0, share: 0 } }, sel: 'WAIT:CONGESTION', live: false };
      const draw = () => {
        if (!body.isConnected) return;
        const it = st.items.find((x) => x.key === st.sel) || st.items[0];
        body.innerHTML = `${st.live ? '<div class="cx-figtop"><span class="cx-verify ok">진단 엔진 결과 (기준 계획 · 가상 1주)</span></div>' : '<div class="cx-figtop"><span class="cx-verify">내장 요약 · 진단 결과 불러오는 중…</span></div>'}
          <div class="cx-fig">${ctrlSvg(st.items, st.classes, st.shares, st.sel)}</div>
          ${it ? `<div class="cx-detail" aria-live="polite"><h4><span class="cx-tag">${esc(it.class)}</span>${esc(it.code)} ${esc(it.label)} <span class="mono">${usd(it.cost_usd)}</span></h4>
            <table class="cx-table"><tbody><tr><td class="k">분류</td><td>${esc(it.class_label || (st.classes.find((c) => c.class === it.class) || {}).label || it.class)}</td></tr><tr><td class="k">대응 방식</td><td>${esc(it.solution || '—')}</td></tr>${it.frequency ? `<tr><td class="k">발생</td><td>${esc(it.frequency)}회</td></tr>` : ''}${it.rationale ? `<tr><td class="k">근거</td><td>${esc(it.rationale)}</td></tr>` : ''}${it.basis ? `<tr><td class="k">출처</td><td class="small">${esc(it.basis)}</td></tr>` : ''}</tbody></table></div>` : ''}`;
      };
      body.addEventListener('click', (e) => {
        const g = e.target.closest('[data-cx-ctrl]');
        if (!g) return;
        st.sel = g.dataset.cxCtrl;
        draw();
        const again = body.querySelector(`[data-cx-ctrl="${CSS.escape(st.sel)}"]`);
        if (again) again.focus();
      });
      draw();
      ctx.get('/api/diagnosis').then((g) => {
        if (!g || !arr(g.controllability).length) return;
        st.items = g.controllability;
        if (g.class_shares) st.shares = g.class_shares;
        st.live = true;
        draw();
      }).catch(() => {});
      ctx.get('/api/discovery').then((d) => { if (arr(d && d.controllability_classes).length) { st.classes = d.controllability_classes; draw(); } }).catch(() => {});
    },
  });

  // ================================================================ 10. Value at Stake 깔때기
  const VAS_FALLBACK = {
    steps: [
      ['TOTAL', '총 체선료', 251749.99, 'total', '가상 시나리오 실제 결과'],
      ['UNAVOIDABLE', '통제 불가·불확실 원인 제외(C·D)', -24446.27, 'minus', '기상(불확실)·이동·선박 귀책 등 — 보수적으로 전부 제외'],
      ['OPERATIONALLY_ADDRESSABLE', '운영적으로 개선 가능', 227303.72, 'subtotal', 'A(통제 가능)+B(예측 가능 제약) 원인 비용'],
      ['SCHEDULING_ADDRESSABLE', 'Scheduling으로 줄일 수 있는 부분', 143008.32, 'subtotal', '이 결과 − 검증 정책 중 최저(Optimizer $108,742), 당시 정보만 사용'],
      ['AGENT_ADDRESSABLE', 'Agent(후보 제시+사람 승인)로 줄일 수 있는 부분', 143008.32, 'subtotal', '이 결과 − 에이전트 1순위 후보 승인 경로($108,742)'],
      ['EXPECTED_SAVING', '기대 절감액', 100105.82, 'result', 'Agent Addressable × 채택률 70% [가정]'],
    ].map(([key, label, v, kind, note]) => ({ key, label, usd: v, kind, note })),
    assumptions: ['원인별 비용은 단독 제거 효과(기여액) 비례 배분 [가정]', 'C(불확실)·D(대응 불가)는 Unavoidable로 보수적 제외 — 실제로는 예보에 대응해 일부 피할 수 있다(예: 폭풍 전 하역 종료)', '채택률 70%는 [가정] — Shadow Mode에서 잰 실제 수용률로 바꾼다'],
  };
  function vasSvg(steps) {
    const P = 'cx10';
    const total = Math.max(1, ...steps.map((x) => Math.abs(num(x.usd) || 0)));
    const CX = 650;
    const MAXW = 500;
    const H = steps.length * 58 + 12;
    let s = svgOpen(1000, H, `Value at Stake: ${steps.map((x) => `${x.label} ${usd(x.usd)}`).join(' → ')}`) + defs(P);
    let prev = null;
    steps.forEach((x, i) => {
      const y = 8 + i * 58;
      const v = num(x.usd) || 0;
      const w = Math.max(3, (Math.abs(v) / total) * MAXW);
      s += svgText(16, y + 18, x.label, { fs: 12, cls: 't-b', maxW: 360, maxLines: 1 });
      s += svgText(16, y + 34, x.note || '', { fs: 10, cls: 't-mut', maxW: 360, maxLines: 2, lh: 1.2 });
      if (x.kind === 'minus' && prev) {
        const right = prev.x + prev.w;
        s += `<rect x="${(right - w).toFixed(1)}" y="${y + 10}" width="${w.toFixed(1)}" height="28" rx="4" class="cx-minus"/>`;
        s += edge(right - w / 2, prev.y + 30, right - w / 2, y + 9, 'money', `${P}-m`);
      } else {
        const bx = CX - w / 2;
        if (prev) s += `<polygon points="${prev.x},${prev.y + 30} ${prev.x + prev.w},${prev.y + 30} ${bx + w},${y + 10} ${bx},${y + 10}" class="cx-funnel-link"/>`;
        s += `<rect x="${bx.toFixed(1)}" y="${y + 10}" width="${w.toFixed(1)}" height="28" rx="4" class="cx-funnel${x.kind === 'total' ? ' total' : x.kind === 'result' ? ' result' : ''}"/>`;
        prev = { x: +bx.toFixed(1), w: +w.toFixed(1), y: y + 8 };
      }
      s += `<text x="992" y="${y + 29}" text-anchor="end" class="t-mono t-b${x.kind === 'minus' ? ' t-dem' : x.kind === 'result' ? ' t-good' : ''}" style="font-size:13px">${usd(v)}</text>`;
    });
    return `${s}</svg>`;
  }
  sec({
    id: 'vas', short: 'Value at Stake', anchors: 'value_at_stake vas funnel saving', kicker: '총액 → 다룰 수 있는 돈 → 기대 절감',
    title: 'Value at Stake — ‘얼마나 아낄 수 있나’를 깎아 내려가며 답하기',
    lead: () => `<p>‘AI로 얼마나 아낄 수 있나’는 총액에서 출발해 깎아 내려가야 정직하게 답할 수 있다. 피할 수 없는 원인(C·D)을 빼고, 운영으로 다룰 수 있는 금액에서, 당시 정보만으로 일정 조정이 줄일 수 있었던 금액(${term('Historical Replay')}의 최선 정책), 그중 에이전트(후보 + 사람 승인)가 실제로 줄인 금액, 마지막으로 채택률 가정을 곱한 기대 절감까지 내려간다(${term('Value at Stake')}).</p>
      <p>이 숫자는 가상 1주 기준이다. 연간 환산·투자 대비 효과는 비즈니스 케이스 탭에서 가정(발생 빈도·채택률·비용)을 바꿔 가며 본다.</p>`,
    links: () => [gotoLink('diagnosis', 'value_at_stake', '진단 — Value at Stake'), gotoLink('business', 'waterfall', '비즈니스 케이스 — 연간 절감·ROI')],
    mount(body, ctx) {
      const draw = (v, live) => {
        if (!body.isConnected) return;
        body.innerHTML = `${live ? '<div class="cx-figtop"><span class="cx-verify ok">진단 엔진 결과</span></div>' : '<div class="cx-figtop"><span class="cx-verify">내장 요약 · 진단 결과 불러오는 중…</span></div>'}
          <div class="cx-fig">${vasSvg(arr(v.steps))}</div>
          <div class="cx-legend"><span><i class="dem-soft"></i>총액</span><span><i class="bind"></i>제외(피할 수 없음)</span><span><i class="on"></i>다룰 수 있는 금액</span><span><i class="good"></i>기대 절감</span></div>
          ${arr(v.assumptions).length ? `<div class="cx-card" style="margin-top:8px"><h4>가정 — 이 깔때기를 믿기 전에 확인할 것</h4><ul>${v.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}`;
      };
      draw(VAS_FALLBACK, false);
      ctx.get('/api/diagnosis').then((g) => { const v = g && g.value_at_stake; if (v && arr(v.steps).length) draw(v, true); }).catch(() => {});
    },
  });

  // ================================================================ 11. 에이전트 구조와 후보 카드
  const AGENT_STEPS = [
    ['이벤트 감지', 'ETA·예보·부두제약·SOF 변경', 'world.py', 'k-in'],
    ['상태 스냅샷', '그 시각까지 알려진 것만', 'world.py · store.py', 'k-in'],
    ['영향 계산', '지금 계획을 유지하면 체선료는?', 'sim.py · clock.py', 'k-eng'],
    ['원인 분해', '어느 대기·지연 때문인가', 'reasons.py', 'k-eng'],
    ['후보 생성', '이동 1~2건 · 순서 · 레버', 'optimize.py', 'k-eng'],
    ['제약 검사', 'Hard 제약 위반은 탈락', 'rules.py', 'k-eng'],
    ['비용 평가', '같은 시계로 후보별 체선료', 'sim.py · clock.py', 'k-eng'],
    ['스트레스 테스트', '기상 +3h · ETA ±3h', 'optimize.py', 'k-eng'],
    ['카드 작성', '이유·Risk·가정·대안·통보 초안', 'agent.py · drafts.py', 'k-eng'],
    ['사람 승인', '확인 · 옵션 적용 · 반려', '작업함 (HITL)', 'k-human'],
    ['계획 반영·기록', '계획 v+1 · 감사 로그', 'store.py', 'k-out'],
  ];
  function agentSvg() {
    const P = 'cx11';
    let s = svgOpen(1000, 236, '에이전트 11단계: 이벤트 감지부터 계획 반영까지, 새 사건이 오면 다시 1단계') + defs(P);
    const pos = (i) => (i < 6 ? [16 + i * 164, 24] : [836 - (i - 6) * 164, 140]);
    AGENT_STEPS.forEach(([t, d, mod, cls], i) => {
      const [x, y] = pos(i);
      const dl = wrapText(d, 130, 10, 2);
      s += `<g class="cx-box ${cls}"><rect x="${x}" y="${y}" width="150" height="74" rx="8"/>
        <circle cx="${x + 15}" cy="${y + 16}" r="10" class="cx-badge-c"/><text x="${x + 15}" y="${y + 19.8}" text-anchor="middle" class="t-b t-mono t-onacc" style="font-size:10px">${i + 1}</text>
        <text x="${x + 31}" y="${y + 20}" class="t-b" style="font-size:12px">${esc(t)}</text>
        ${dl.map((l, k) => `<text x="${x + 10}" y="${y + 38 + k * 12}" class="t-mut" style="font-size:10px">${esc(l)}</text>`).join('')}
        <text x="${x + 10}" y="${y + 66}" class="t-mut t-mono" style="font-size:9.5px">${esc(mod)}</text></g>`;
      if (i < 5) s += edge(x + 151, y + 37, x + 162, y + 37, '', `${P}-a`);
      if (i === 5) s += edge(x + 75, y + 75, x + 75, y + 114 + 24, '', `${P}-a`);
      if (i >= 6 && i < 10) s += edge(x - 1, y + 37, x - 12, y + 37, '', `${P}-a`);
    });
    s += pathEdge('M 180 214 H 91 V 101', 'acc', `${P}-c`);
    s += svgText(98, 230, '새 사건이 오면 다시 1단계', { fs: 10.5, cls: 't-acc t-b' });
    return `${s}</svg>`;
  }
  const CARD_FALLBACK = {
    id: 'OPT1', title: 'MUNSU PEARL: SK2B #2 → SK3B #1 + TAEHWA HARMONY 수입 탱크에 TK-104 추가 배정', expected_cost_usd: 101533.33, baseline_delta_usd: -140508.33,
    reason: 'BANGEOJIN TRADER 체선료 $84,446 → $0 · 접안 11/07 08:00 → 11/05 12:00 / TAEHWA HARMONY 체선료 $44,083 → $0 · 하역 종료 11/05 10:49 → 11/04 19:07',
    risk: { text: '스트레스 테스트 3종 모두 절감 $130,758 이상 유지', worst_saving_usd: 130758.33, tested: ['기상 악화가 3시간 더 길면: 절감 +$148,008', '미도착 선박 ETA가 3시간 늦으면: 절감 +$130,758', '미도착 선박 ETA가 3시간 빠르면: 절감 +$150,258'] },
    assumptions: ['ETA·도착: 11/04 10:00 시점 최신 통지값 (±3h 스트레스 테스트)', '기상: FC-1104-08 — 풍랑주의보 예상 11/04 17시~11/05 09시', '주간 계류 창 07:00~17:30 [가정 ULS-DAYTIME-DEF]', '풍속 한계 15/18/20 m/s [가정 ULS-WEATHER-LIMIT]', '생산조정팀 레버: TK-104는 11/04 08:00 출하 완료 후 수입 가능(가상)', 'SK3B 사용 가능 시점 11/05 07:00 (부두제약관리)'],
    fallback: { id: 'OPT2', title: 'MUNSU PEARL: SK2B #2 → SK3B #1' },
    moves: ['MUNSU PEARL: SK2B #2 → SK3B #1'], levers: [{ title: 'TAEHWA HARMONY 수입 탱크에 TK-104 추가 배정 (육상 수용률 9,000 → 12,000 m3/h)', owner: '생산조정팀' }],
    rules_checked: ['ULS-SBM-NIGHT', 'ULS-DWT-MAX', 'ULS-DRAFT-UKC', 'ULS-LOA-MAX', 'ULS-CARGO-TYPE', 'ULS-WEATHER-LIMIT', 'BERTH-OOS', 'PLAN-TURNOVER', 'PLAN-DURATIONS', 'PLAN-PUMP-RATE'],
    coordination: ['생산조정팀 확인 필요: TK-104 수입 가능 여부(가상)', '대리점·도선·예선 재통보 필요 (승인 후 통보문 초안 생성)', 'SK3B 정비 완료 확인 필요 (부두제약관리)'],
    approvable: true,
  };
  function anatomy(o, live) {
    const n = (k) => `<span class="cx-badge-n" aria-hidden="true">${k}</span>`;
    const row = (k, lbl, val) => `<div class="row">${n(k)}<div><div class="lbl">${esc(lbl)}</div><div class="val">${val}</div></div></div>`;
    const why = [
      ['무엇을 바꾸나', '사람이 한 줄로 이해할 수 있는 변경만 제안한다 — 선석·순서 변경 1~2건과 운영 레버.'],
      ['얼마인가', '같은 레이타임 시계로 계산한 예상 체선료와, 지금 계획(Baseline)을 그대로 둘 때와의 차이.'],
      ['왜', '선박별로 무엇이 얼마나 바뀌는지 — 체선료·접안 시각·하역 종료 시각.'],
      ['얼마나 확실한가', '기상·ETA를 흔든 스트레스 테스트에서 최악일 때도 남는 절감액.'],
      ['무엇을 가정했나', '틀리면 결론이 바뀔 수 있는 목록. [가정] 표시는 현업 확인이 필요한 값.'],
      ['안 되면', '레버를 못 쓰면 대안(다음 후보)으로 — 승인자가 고를 수 있게 함께 둔다.'],
      ['무엇을 지켰나', '검사한 Hard 제약. 칩을 누르면 근거·확인 상태가 나온다.'],
      ['누구와 맞춰야 하나', '실행 전에 확인할 상대(생산조정팀·대리점·도선·부두제약 담당).'],
      ['결정은 사람', '‘이 옵션 적용’을 눌러야 계획 버전이 오른다. 항목이 생긴 뒤 계획이 바뀌었으면 누를 수 없다.'],
    ];
    const change = [...arr(o.moves).map((m) => esc(m)), ...arr(o.levers).map((l) => `${esc(l.title)}${l.owner ? ` <span class="muted small">(${esc(l.owner)})</span>` : ''}`)];
    return `<div class="cx-anatomy">
      <div class="cx-mock" aria-label="후보 카드 예시">
        <div class="small muted">${live ? '실제 카드 · IMP-1104-1000 (11/04 10:00 SK3 Buoy 조기 완료)' : '예시 카드 · IMP-1104-1000'}</div>
        ${row(1, 'Candidate A · 최선 — 선석·순서 변경 / 운영 레버', `<b>${esc(o.title)}</b>${change.length ? `<ul>${change.map((c) => `<li>${c}</li>`).join('')}</ul>` : ''}`)}
        ${row(2, '예상 체선료 · Baseline 대비', `<span class="big">${usd(o.expected_cost_usd != null ? o.expected_cost_usd : o.total_usd)}</span> <span class="small muted">기준 대비</span> <span class="big save">${usd(o.baseline_delta_usd, true)}</span>`)}
        ${row(3, '주요 선정 이유', `<ul>${String(o.reason || '').split(' / ').filter(Boolean).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`)}
        ${row(4, '주요 Risk', `${esc((o.risk && o.risk.text) || '—')}${o.risk && arr(o.risk.tested).length ? `<ul>${o.risk.tested.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}`)}
        ${row(5, '핵심 가정', `<ul>${arr(o.assumptions).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`)}
        ${row(6, '대안', o.fallback ? `<span class="mono small">${esc(o.fallback.id || '')}</span> ${esc(o.fallback.title || '')}` : '—')}
        ${row(7, '확인한 룰', `<div class="chips">${chips(o.rules_checked)}</div>`)}
        ${row(8, '협의 필요', `<ul>${arr(o.coordination).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`)}
        ${row(9, '사람의 결정', `<span class="btn primary small" aria-hidden="true">이 옵션 적용</span> <span class="small muted">${o.approvable === false ? `지금은 적용 불가: ${esc(o.blocked_reason || '')}` : '승인하면 계획 버전 +1 · 감사 로그 기록'}</span>`)}
      </div>
      <ol class="cx-why">${why.map(([h, d], i) => `<li>${n(i + 1)}<div><b>${esc(h)}</b><div class="small">${esc(d)}</div></div></li>`).join('')}</ol>
    </div>`;
  }
  sec({
    id: 'agent', short: '에이전트 구조', anchors: 'agent pipeline candidate card hitl', kicker: '11단계 루프 · 후보 카드 해부',
    title: '에이전트 구조 — 판단 재료를 정리하는 11단계',
    lead: () => `<p>이 에이전트는 판단을 대신하는 AI가 아니라 <b>판단 재료를 정리하는 파이프라인</b>이다. 사건(${term('재계산 트리거')})이 들어오면 11단계를 돌아 ${term('후보 카드')} 한 장을 만들고, 사람(${term('HITL')})이 승인해야만 계획이 바뀐다. 1~9단계는 모두 결정론적 엔진이라 같은 입력이면 같은 카드가 나온다.</p>
      <p>아래 카드는 11/04 10:00 ‘SK3 Buoy 점검 조기 완료’ 통보로 생긴 실제 항목이다. 번호는 작업함 화면의 같은 칸을 가리킨다.</p>`,
    links: () => [hashLink({ t: '2026-11-04T10:00', tab: 'inbox', item: 'IMP-1104-1000' }, '작업함 — 이 카드 실제로 보기'), hashLink({ tab: 'guide' }, '작동 원리 — 파이프라인 표')],
    mount(body, ctx) {
      const draw = (o, live) => {
        if (!body.isConnected) return;
        body.innerHTML = `<div class="cx-fig">${agentSvg()}</div>
          <div class="cx-legend"><span><i class="k-in"></i>감지·스냅샷</span><span><i class="on"></i>엔진 계산</span><span><i class="part"></i>사람</span><span><i class="k-out"></i>반영·기록</span></div>
          <h4 style="margin:12px 0 6px">후보 카드 해부</h4>${anatomy(o, live)}`;
      };
      draw(CARD_FALLBACK, false);
      ctx.get('/api/item?id=IMP-1104-1000&t=2026-11-04T10:00').then((it) => { const o = it && it.options && arr(it.options.best)[0]; if (o) draw(o, true); }).catch(() => {});
    },
  });

  // ================================================================ 12. 로드맵 흐름과 Evidence Chain
  // 15단계 → [단계 묶음, 열 탭, 앵커, 콘솔 위치]
  const FLOW_MAP = [
    ['disc', 'discovery', 'goal', '로드맵 · 목표'], ['disc', 'discovery', 'process_map', '로드맵 · 프로세스 맵'], ['disc', 'diagnosis', 'pareto', '진단 · 파레토'],
    ['disc', 'discovery', 'hypotheses', '로드맵 · 가설'], ['disc', 'casestudy', '', '사례 복원'], ['diag', 'diagnosis', 'kpi', '진단 · KPI'],
    ['diag', 'diagnosis', 'root_causes', '진단 · 근본 원인'], ['diag', 'diagnosis', 'value_at_stake', '진단 · 통제가능성·VaS'], ['bench', 'benchmark', '', '벤치마크'],
    ['sol', 'validation', 'solutions', '검증 · 해결 대안 비교'], ['sol', 'inbox', '', '작업함 · 후보 비교'], ['val', 'validation', 'replay', '검증 · 리플레이·시나리오'],
    ['agent', 'guide', '', '작동 원리'], ['biz', 'business', '', '비즈니스 케이스'], ['biz', 'assurance', '', '도입 검증 · Shadow Mode'],
  ];
  const BAND_KO = { disc: 'Discovery', diag: 'Diagnosis', bench: 'Benchmark', sol: 'Solution', val: 'Validation', agent: 'Agent', biz: 'Business·Pilot' };
  const FLOW_FALLBACK = ['① 문제 정의', '② 실제 운영 프로세스 이해', '③ 체선료 발생 구조 분해', '④ 가설 수립', '⑤ 현업 인터뷰 및 실제 사례 분석', '⑥ 데이터 기반 현황 진단', '⑦ Root Cause 분석', '⑧ 통제 가능 영역 / Value at Stake 도출', '⑨ 외부 Case Study / Benchmark', '⑩ 해결 대안 비교', '⑪ Optimizer / Simulation 개발', '⑫ Historical Replay / Scenario 검증', '⑬ Agent 설계', '⑭ Business Case', '⑮ Pilot / 확장안'];
  const EC_FALLBACK = [{ id: 'EC-01', main_question: 'Q1', question: '체선료는 정확히 어디에서 발생하는가?', evidence: '가상 1주(SBM 1기·폭풍) 실제 체선료 $251,750. 선석은 SK2B SK2 Buoy $241,237(96%), 원인은 선석 점유 대기 60%·육상 수용률 제한(하역 지연) 25%', insight: 'SBM(VLCC·수에즈막스 전용)이 병목 — SBM이 1기만 운영되면 대형선이 한 선석에 줄을 서고 비용이 거기 몰린다', decision: 'SBM 배정·정비 일정과 선석 간 재배정을 Scope에 넣는다', requirement: '부두제약관리(정비) 이벤트 수신, 선석 이동 후보의 체선료 비교', basis: 'VIRTUAL', link: { tab: 'diagnosis', anchor: 'pareto' } }];
  function flowSvg(flow) {
    const P = 'cx12';
    const w = 176;
    const h = 60;
    const xs = [16, 214, 412, 610, 808];
    const ys = [14, 104, 194];
    const pos = (i) => { const r = Math.floor(i / 5); const c = i % 5; return [xs[r % 2 ? 4 - c : c], ys[r]]; };
    let s = svgOpen(1000, 268, `로드맵 15단계: ${flow.join(' → ')}. 단계를 누르면 해당 콘솔 화면으로 이동합니다`, 'group') + defs(P);
    for (let i = 0; i < flow.length - 1; i++) {
      const [x1, y1] = pos(i);
      const [x2, y2] = pos(i + 1);
      if (y1 === y2) s += x2 > x1 ? edge(x1 + w + 2, y1 + h / 2, x2 - 3, y2 + h / 2, '', `${P}-a`) : edge(x1 - 2, y1 + h / 2, x2 + w + 3, y2 + h / 2, '', `${P}-a`);
      else s += edge(x1 + w / 2, y1 + h + 2, x2 + w / 2, y2 - 3, '', `${P}-a`);
    }
    flow.forEach((f, i) => {
      const [x, y] = pos(i);
      const [band, tab, anchor, where] = FLOW_MAP[i] || ['disc', 'discovery', '', '로드맵'];
      s += node(x, y, w, h, `b-${band} cx-click`, f, `→ ${where}`, { fsT: 11.5, fsS: 10, tLines: 2, sLines: 1, attrs: `role="link" tabindex="0" data-goto="${esc(tab)}"${anchor ? ` data-anchor="${esc(anchor)}"` : ''} aria-label="${esc(`${f} — ${where} 열기`)}"` });
    });
    return `${s}</svg>`;
  }
  sec({
    id: 'roadmap', short: '로드맵·Evidence', anchors: 'roadmap flow evidence evidence_chain', kicker: '15단계 · Q1~Q7 · Evidence Chain',
    title: '로드맵 흐름과 Evidence Chain — 기능은 어떤 질문에서 왔나',
    lead: () => `<p>로드맵은 15단계지만 질문은 하나다: <b>어떤 결정을 바꾸면 실제 체선료가 줄어드는가?</b> 단계마다 산출물이 다음 단계의 입력이 되고, 각 단계는 콘솔의 한 화면에 대응한다(단계를 누르면 그 화면으로 이동).</p>
      <p>${term('Evidence Chain')}은 반대 방향으로 읽는다 — 화면에 있는 기능 하나가 어떤 질문(Q1~Q7)과 근거에서 나왔는지 <b>질문 → 근거 → 인사이트 → 결정 → 요구사항</b>으로 추적한다. 근거가 가상 시나리오면 VIRTUAL, 문서면 DOC로 표시한다.</p>`,
    links: () => [gotoLink('discovery', 'flow', '로드맵 — Discovery → Pilot 흐름'), gotoLink('discovery', 'coverage', '로드맵 — Coverage A–T'), gotoLink('discovery', 'questions', '로드맵 — 질문 시트 432개')],
    mount(body, ctx) {
      const st = { flow: FLOW_FALLBACK, ecs: EC_FALLBACK, sel: 0, live: false };
      const chain = () => {
        const e = st.ecs[st.sel] || st.ecs[0];
        if (!e) return '';
        const box = (h, v) => `<div class="c"><div class="h">${esc(h)}</div>${esc(v || '—')}</div>`;
        return `<div class="cx-chain">${box('질문', e.question)}${box('근거', e.evidence)}${box('인사이트', e.insight)}${box('결정', e.decision)}${box('요구사항', e.requirement)}</div>
          <div class="chips" style="margin-top:6px"><span class="cx-tag acc">${esc(e.main_question || '')}</span><span class="cx-tag ${e.basis === 'VIRTUAL' ? 'good' : 'info'}">${e.basis === 'VIRTUAL' ? 'VIRTUAL · 가상 시나리오 근거' : e.basis === 'DOC' ? 'DOC · 문서 근거' : esc(e.basis || '')}</span>
          ${e.link && e.link.tab ? gotoLink(e.link.tab, e.link.anchor, '근거 화면') : ''}<button type="button" class="linkbtn cx-go" data-ec="${esc(e.id)}">로드맵에서 이 사슬 열기 →</button></div>`;
      };
      const draw = () => {
        if (!body.isConnected) return;
        body.innerHTML = `<div class="cx-fig">${flowSvg(st.flow)}</div>
          <div class="cx-legend">${Object.entries(BAND_KO).map(([k, v]) => `<span><i class="band-${k}"></i>${esc(v)}</span>`).join('')}</div>
          <h4 style="margin:12px 0 6px">Evidence Chain ${st.live ? `<span class="small muted">${st.ecs.length}개</span>` : '<span class="cx-tag">내장 예시 1개</span>'}</h4>
          <div class="cx-chainsel" role="group" aria-label="Evidence Chain 선택">${st.ecs.map((e, i) => `<button type="button" class="filter-chip${i === st.sel ? ' active' : ''}" data-cx-ec="${i}" aria-pressed="${i === st.sel}"><b class="mono">${esc(e.id)}</b> ${esc(e.main_question || '')}</button>`).join('')}</div>
          <div class="cx-ecbody" aria-live="polite">${chain()}</div>`;
      };
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cx-ec]');
        if (!b) return;
        st.sel = +b.dataset.cxEc;
        body.querySelectorAll('[data-cx-ec]').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on); });
        body.querySelector('.cx-ecbody').innerHTML = chain();
      });
      draw();
      ctx.get('/api/discovery').then((d) => {
        if (!d) return;
        if (arr(d.flow).length) st.flow = d.flow;
        if (arr(d.evidence_chains).length) { st.ecs = d.evidence_chains; st.live = true; }
        draw();
      }).catch(() => {});
    },
  });

  // ================================================================ 용어 사전 (개념도 마지막 구획)
  function mountGlossary(body) {
    const st = { q: '', cat: '' };
    body.innerHTML = `<div class="cx-gloss-tools"><input type="search" class="cx-gloss-q" placeholder="용어·영문·설명 검색 (예: NOR, 반액, UKC)" aria-label="용어 검색">
      <div class="chips" role="group" aria-label="분류">${['', ...CATS].map((c) => `<button type="button" class="filter-chip${c ? '' : ' active'}" data-cx-cat="${esc(c)}" aria-pressed="${!c}">${esc(c || '전체')}</button>`).join('')}</div>
      <span class="small muted cx-gloss-n" aria-live="polite"></span></div><div class="cx-gloss"></div>`;
    const list = body.querySelector('.cx-gloss');
    const count = body.querySelector('.cx-gloss-n');
    const paint = () => {
      const q = normKey(st.q);
      const hits = glossary.filter((g) => (!st.cat || g.cat === st.cat) && (!q || [g.term, g.en, g.def, ...g.aliases].some((x) => normKey(x).includes(q))));
      count.textContent = `${glossary.length}개 중 ${hits.length}개`;
      list.innerHTML = hits.map((g) => `<div class="cx-gl"><span class="cat">${esc(g.cat)}</span><b>${esc(g.term)}</b>${g.en && g.en !== g.term ? `<span class="en">${esc(g.en)}</span>` : ''}<p>${esc(g.def)}</p></div>`).join('') || '<div class="empty">검색 결과가 없습니다</div>';
    };
    body.addEventListener('input', (e) => { if (e.target.matches('.cx-gloss-q')) { st.q = e.target.value; paint(); } });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cx-cat]');
      if (!b) return;
      st.cat = b.dataset.cxCat;
      body.querySelectorAll('[data-cx-cat]').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on); });
      paint();
    });
    paint();
  }

  // ================================================================ 사용법 화면
  // [탭, 묶음, 이름, 무엇을 보나, 이렇게 써 보기]
  const TAB_GUIDE = [
    ['concepts', '시작하기', '개념', '체선료가 생기는 원리와 이 데스크가 푸는 문제를 12장의 그림으로 설명. 용어 사전 포함.', '레이타임 시계를 8단계 넘겨 보고, 점선 밑줄 용어에 마우스를 올려 본다.'],
    ['usage', '시작하기', '사용법', '이 화면 — 실행 방법·화면 구성·데모 순서·결정 규칙·문제 해결.', '‘가이드 투어 시작’으로 2분 투어를 본다.'],
    ['discovery', 'Discovery·진단', '로드맵', '목표·7가지 핵심 질문(Q1~Q7)·Coverage A–T·Phase P0–P30·Evidence Chain·프로세스 맵·이해관계자·질문 시트.', 'Q1 카드를 눌러 답과 근거 화면으로 이동해 본다.'],
    ['diagnosis', 'Discovery·진단', '진단', '기준 계획을 그대로 따른 실제 체선료를 원인·선석·선종별로 쪼개고 통제가능성(A~D)과 Value at Stake를 계산.', '파레토에서 가장 큰 원인을 찾고 통제가능성 표에서 A 분류 금액을 확인한다.'],
    ['casestudy', 'Discovery·진단', '사례 복원', '어려웠던 하루를 T-72h부터 결과까지 시점별로 복원 — 그때 알던 것, 결정, 반사실, 교훈.', '사례 하나를 골라 ‘그때 알던 것’과 실제 결과를 비교한다.'],
    ['inbox', '에이전트 운영', '작업함', '에이전트가 만든 판단 대기 항목(기준 계획·영향·NOR·계산서·클레임). 후보 카드를 보고 확인·옵션 적용·반려.', '11/04 08:00로 옮겨 IMP-1104-0800의 최선 후보를 적용해 본다.'],
    ['timeline', '에이전트 운영', '타임라인', '선석별 물리 상태(대기·이동·하역)와 레이타임 시계, 풍속·조위. 지금 선 오른쪽은 예측.', '▶ 재생을 눌러 사건이 들어올 때마다 그림이 바뀌는 것을 본다.'],
    ['resources', '에이전트 운영', '자원·제약', '조석(UKC)·파고·시정·탱크·배관·예선·제품 전환·검사 제약이 언제·얼마나 계획을 막았나.', '시나리오를 바꿔 선석 밖 제약이 구속되는 때를 찾는다.'],
    ['statement', '에이전트 운영', '계산서', '시점 t 기준 항차별 레이타임 계산서(예측 포함)와 체선사유 분류.', 'TAEHWA HARMONY를 골라 시각을 옮기며 계산서가 확정되는 과정을 본다.'],
    ['intake', '에이전트 운영', '입력·계산기', 'SOF 표를 붙여 넣으면 같은 엔진으로 레이타임·체선료를 계산하고 골든 케이스 정답과 비교.', '골든 케이스 TC-03을 골라 $187,500이 나오는지 확인한다.'],
    ['validation', '검증·사업성', '검증', '해결 대안 비교·현업 판단 로직·정책 경쟁·Historical Replay·시나리오 {scenarios}개·민감도.', '정책 표에서 ‘체선료율 우선’이 현업보다 나쁜 이유를 찾아본다.'],
    ['benchmark', '검증·사업성', '벤치마크', '외부 공개 사례를 같은 15개 질문으로 비교 — 출처 링크 포함.', '선석 배정 사례와 이 데스크의 접근을 비교한다.'],
    ['business', '검증·사업성', '비즈니스 케이스', '가정값(빈도·채택률·비용)을 바꿔 연간 절감·ROI·회수 기간을 계산. 기본값은 보수적.', '채택률을 바꿔 회수 기간이 어떻게 변하는지 본다.'],
    ['assurance', '검증·사업성', '도입 검증', '검증 KPI·Shadow Mode 일치율·파일럿 단계·거버넌스 질문.', '파일럿 단계별 통과 기준을 확인한다.'],
    ['rules', '근거', '룰·근거', '모든 판정의 근거 룰 {rules}개와 상태(공개자료·원문 대조 전·가정·쟁점).', '‘쟁점’ 상태 룰(ASB-06-BERTH-DELAY-EXC, LAW-ONCE-ON-DEM)을 읽어 본다.'],
    ['audit', '근거', '감사 로그', '사람이 내린 결정 기록과 감사 로그 기반 Shadow Mode KPI. 초기화해도 남는다.', '후보를 하나 적용한 뒤 기록이 남는지 확인한다.'],
    ['guide', '근거', '작동 원리', '에이전트 파이프라인과 입력 데이터 출처, 로드맵 ↔ 화면 대응표.', '입력 데이터 표에서 각 수치가 어느 파일에서 오는지 확인한다.'],
  ];
  // [링크 파라미터 또는 [탭, 앵커], 제목, 할 일]
  const DEMO5 = [
    [{ t: '2026-11-03T00:00', tab: 'inbox', item: 'BASE-1103-0000' }, '11/03 00:00 · 기준 계획 점검', '기준 계획(SEAGATE v1)의 체선료 노출 $167,800과 최대 노출 선박(BANGEOJIN TRADER $84,446)을 확인한다. SK3 Buoy가 정비 중이라 대형선이 SK2 Buoy 하나에 몰린 것이 출발점.'],
    [{ t: '2026-11-04T08:00', tab: 'inbox', item: 'IMP-1104-0800' }, '11/04 08:00 · 폭풍 예보', '풍랑주의보 예보로 노출이 +$74,242. 후보 카드의 예상 체선료·선정 이유·Risk·가정을 읽고 최선 후보에 ‘이 옵션 적용’ → 계획 v2.'],
    [{ t: '2026-11-04T10:00', tab: 'inbox', item: 'IMP-1104-1000' }, '11/04 10:00 · SK3 Buoy 조기 완료', '선석 이동 + 탱크 레버 후보를 비교한다. 앞 단계에서 무엇을 승인했는지에 따라 이 항목의 금액이 달라진다 — 그것이 계획 버전의 의미.'],
    [{ t: '2026-11-05T12:00', tab: 'timeline' }, '11/05 12:00 · 타임라인', '바뀐 계획이 선석 그림에 들어간 모습. 지금 선 왼쪽은 실제, 오른쪽은 예측.'],
    [['validation', 'headline'], '검증 결과', '같은 정보로 겨룬 정책 결과: 현업 Rule $251,750 → 에이전트 + 사람 승인 $108,742 (−56.8%).'],
  ];
  const DEMO15 = [
    [{ tab: 'concepts' }, '개념 — 레이타임 시계', 'TC-03을 8단계로 넘기며 NOR·통지시간·체선·이동·반액을 익힌다 (2분).'],
    [{ t: '2026-11-03T02:30', tab: 'inbox', item: 'NOR-0101-11030230' }, '11/03 02:30 · 야간 NOR', '새벽 NOR. SBM 야간 계류 금지로 08:00 계류 — 접안이 통지시간 만료보다 빨라 레이타임 손실이 없다.'],
    [{ t: '2026-11-04T08:00', tab: 'inbox', item: 'IMP-1104-0800' }, '5분 데모 1~3단계', '기준 계획 → 폭풍 예보 → SK3 Buoy 조기 완료 순서로 후보를 판단한다.'],
    [{ t: '2026-11-04T12:10', tab: 'inbox', item: 'NOR-0104-11041210' }, '11/04 12:10 · 조기 NOR 의심', '묘박지 도착 전에 송신된 NOR. AIS로 항해 중임을 확인하고 ‘validity reserved’ 회신 초안을 본다.'],
    [{ tab: 'inbox', item: 'CLM-2026-036' }, '클레임 검토 CLM-2026-036', '선주 청구 $207,500 → 재계산 $187,500. 차이(종료 시각·반액)를 워터폴로 보고 반박(COUNTER) 초안을 확인한다.'],
    [{ tab: 'intake' }, '입력·계산기', '골든 케이스 TC-03의 SOF로 같은 결과가 나오는지 확인하고, 시각 하나를 바꿔 금액 변화를 본다.'],
    [['resources', null], '자원·제약', '시나리오를 바꿔 조석·탱크·배관·예선 제약이 언제 계획을 막는지 본다.'],
    [['validation', 'scenarios'], '시나리오·민감도', '{scenarios}개 시나리오와 민감도 — 가장 민감한 입력은 하역 속도다.'],
    [['business', 'params'], '비즈니스 케이스', '빈도·채택률 가정을 바꿔 연간 절감·ROI·회수 기간을 본다.'],
    [{ tab: 'audit' }, '감사 로그 → 초기화', '방금 내린 결정이 기록됐는지 보고, 상단 ‘초기화’로 처음 상태로 되돌린다(로그는 남음).'],
  ];
  const demoLink = (p, label) => (Array.isArray(p) ? gotoLink(p[0], p[1], label) : hashLink(p, label));
  function layoutSvg() {
    const tag = (x, y, n) => `<circle cx="${x}" cy="${y}" r="11" class="cx-badge-c"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="t-b t-mono t-onacc" style="font-size:11px">${n}</text>`;
    let s = svgOpen(1000, 304, '화면 구성: ① 이름·계획 버전 ② 시계·사건 이동·슬라이더 ③ 투어·테마·초기화 ④ 화면 목록 ⑤ 작업 영역 ⑥ 상세 서랍');
    s += `<rect x="4" y="4" width="992" height="54" rx="8" class="lane-bg"/>`;
    s += node(26, 13, 220, 36, 'k-in', '체선료 데스크 · 계획 v1', '', { fsT: 12, tLines: 1 }) + tag(26, 13, 1);
    s += node(296, 13, 420, 36, 'k-eng', '11/04 08:00 KST    ◀   ▶ 재생   ▶    ━━━●━━━━', '', { fsT: 12, tLines: 1 }) + tag(296, 13, 2);
    s += node(756, 13, 230, 36, 'k-out', '사용법 투어 · 테마 · 초기화', '', { fsT: 12, tLines: 1 }) + tag(756, 13, 3);
    s += `<rect x="4" y="66" width="168" height="234" rx="8" class="lane-bg"/>${tag(18, 80, 4)}`;
    ['시작하기', '개념 · 사용법', 'Discovery·진단', '로드맵 · 진단 · 사례 복원', '에이전트 운영', '작업함 · 타임라인 …', '검증·사업성', '근거'].forEach((t, i) => { s += svgText(34, 104 + i * 24, t, { fs: i % 2 ? 10.5 : 11, cls: i % 2 ? 't-mut' : 't-b', maxW: 130, maxLines: 1 }); });
    s += `<rect x="182" y="66" width="560" height="234" rx="8" class="lane-bg"/>${tag(196, 80, 5)}`;
    s += svgText(462, 108, '작업 영역 — 고른 화면의 내용', { anchor: 'middle', fs: 13, cls: 't-b' });
    [480, 420, 360, 440, 300].forEach((w, i) => { s += `<rect x="212" y="${134 + i * 30}" width="${w}" height="16" rx="4" class="cx-ph-wait"/>`; });
    s += `<rect x="752" y="66" width="244" height="234" rx="8" class="lane-bg cx-dash"/>${tag(766, 80, 6)}`;
    s += svgText(874, 108, '상세 서랍', { anchor: 'middle', fs: 13, cls: 't-b' });
    s += svgText(874, 132, '선박을 누르면 오른쪽에서 열림', { anchor: 'middle', fs: 10.5, cls: 't-mut' });
    s += svgText(874, 150, 'Esc 또는 ✕로 닫기', { anchor: 'middle', fs: 10.5, cls: 't-mut' });
    return `${s}</svg>`;
  }
  function renderUsage(el, api) {
    if (!el) return null;
    const ctx = makeCtx(api);
    const U = [
      ['start', '처음 5분', 'start quickstart'], ['run', '실행 방법', 'run install server mcp static'], ['layout', '화면 구성', 'layout screen'], ['time', '시간 다루기', 'time clock slider play'],
      ['tabs', '화면별 안내', 'tabs screens'], ['demo5', '5분 데모', 'demo demo5 order'], ['demo15', '15분 심화 데모', 'demo15 deep'], ['decide', '결정과 무효화 규칙', 'decide hitl approve invalidation'],
      ['inputs', '입력 데이터', 'input inputs data sof'], ['faq', '자주 묻는 질문·문제 해결', 'faq troubleshooting help'],
    ];
    const head = (i) => { const [id, title, anchors] = U[i]; return `<section class="panel cx-sec" id="cxu-${id}" data-anchors="${anchors}" aria-labelledby="cxu-${id}-h"><div class="cx-sec-head"><h2 id="cxu-${id}-h"><span class="cx-num">${i + 1}</span>${esc(title)}</h2></div>`; };
    const groups = [...new Set(TAB_GUIDE.map((x) => x[1]))];
    const root = document.createElement('div');
    root.className = 'cx-page cx-usage';
    root.innerHTML = `
      <div class="panel cx-hero" data-anchors="top usage">
        <div class="cx-kicker">사용법</div>
        <h2>체선료 데스크 사용 설명서</h2>
        <p>울산 CLX의 가상 1주(<span data-cx-meta>11/03 00:00 ~ 11/08 12:00 · 선박 6척</span>)를 시간 순서대로 재생하면서, 에이전트가 사건마다 체선료 노출을 다시 계산하고 줄일 수 있는 변경안을 제안하는 콘솔입니다. 결정은 사람이 하고, 모든 수치는 ${term('가상 데이터')}입니다. SK에너지·SEAGATE 공식 시스템과 무관한 교육용 프로토타입입니다.</p>
        <div class="chips"><button type="button" class="btn small primary cx-tourbtn" data-cx-tour>▶ 가이드 투어 시작 (2분)</button>${gotoLink('concepts', null, '개념도 먼저 보기')}<button type="button" class="btn small" data-cx-scroll="cxu-demo5">5분 데모 ↓</button></div>
        <nav class="cx-toc" aria-label="사용법 목차">${U.map(([id, title], i) => `<button type="button" data-cx-scroll="cxu-${id}"><b>${i + 1}</b>${esc(title)}</button>`).join('')}</nav>
      </div>
      ${head(0)}<div class="cx-lead">
        <ol>
          <li><b>개념 화면</b>에서 ‘레이타임 시계’ 그림을 끝까지 넘긴다 — 체선료가 어떻게 계산되는지 감이 온다.</li>
          <li>상단 시계를 <b>11/04 08:00</b>으로 옮긴다(▶ 다음 사건 버튼 또는 아래 5분 데모 링크).</li>
          <li><b>작업함</b>에서 폭풍 예보 항목을 열고 후보 카드를 읽은 뒤 <b>‘이 옵션 적용’</b>을 누른다. 상단 배지가 <b>계획 v2</b>로 바뀐다.</li>
          <li><b>타임라인</b>에서 바뀐 계획을, <b>검증</b>에서 정책별 결과를 확인한다.</li>
          <li>처음부터 다시 하려면 상단 <b>초기화</b>.</li>
        </ol></div></section>
      ${head(1)}
        <div class="cx-cols">
          <div class="cx-card"><h4>① 로컬 서버 (권장)</h4><pre>cd prototype
python3 server.py
# 브라우저: http://127.0.0.1:8787
# 포트가 쓰이고 있으면: --port 8790</pre><ul><li>표준 라이브러리만 사용 — 설치할 것 없음(Python 3.10+)</li><li>결정·계획 버전은 <code>runtime/state.json</code>에 저장 (<code>--state</code>로 다른 파일)</li><li><code>Address already in use</code> → 다른 포트로 띄우거나 이미 떠 있는 주소로 접속</li></ul></div>
          <div class="cx-card"><h4>② 정적 사이트 (GitHub Pages)</h4><p class="small"><a href="https://minkyu-k530.github.io/demurrage-desk/" target="_blank" rel="noopener">minkyu-k530.github.io/demurrage-desk</a></p><ul><li>서버 없이 브라우저 안에서 같은 파이썬 엔진(${term('Pyodide')})을 실행</li><li>첫 로딩 10~30초(엔진 내려받기), 두 번째부터 캐시</li><li>결정은 이 브라우저의 localStorage에만 저장 — 다른 사람과 공유되지 않음</li><li>무거운 검증 결과는 미리 계산한 파일을 쓴다</li></ul></div>
          <div class="cx-card"><h4>③ MCP (AI 도구에서 조회)</h4><pre>claude mcp add demurrage-desk -- \\
  python3 /절대경로/prototype/mcp_server.py</pre><ul><li>읽기 전용 도구 18개 — 상태·작업함·계산서·클레임·룰·로드맵·검증 조회</li><li>웹 서버와 같은 <code>runtime/state.json</code>을 읽어 화면의 결정이 반영됨</li><li>예: “11/04 08:00 작업함 요약해 줘”, “CLM-2026-036 검토 결과는?”</li></ul></div>
        </div></section>
      ${head(2)}<div class="cx-fig">${layoutSvg()}</div>
        <div class="cx-cols"><div class="cx-card"><ul><li><b>① 이름·계획 버전</b> — ‘계획 v1’ 배지는 승인할 때마다 올라간다.</li><li><b>② 시계</b> — 가상 현재 시각. ◀ ▶는 이전·다음 정보 사건, ‘▶ 재생’은 자동 진행.</li></ul></div>
          <div class="cx-card"><ul><li><b>③ 오른쪽 버튼</b> — 사용법 투어, 밝게/어둡게, 초기화(결정·계획 버전 되돌리기).</li><li><b>④ 화면 목록</b> — 개념 → Discovery·진단 → 운영 → 검증·사업성 → 근거 순서.</li></ul></div>
          <div class="cx-card"><ul><li><b>⑤ 작업 영역</b> — 고른 화면. 룰 칩(예: ${ruleChip('ULS-SBM-NIGHT')})을 누르면 근거가 뜬다.</li><li><b>⑥ 상세 서랍</b> — 선박을 누르면 열리고 Esc로 닫는다.</li></ul></div></div></section>
      ${head(3)}<div class="cx-lead">
        <p>이 콘솔은 <b>가상 현재 시각</b>을 가진다. 화면은 언제나 그 시각까지 알려진 정보만 보여 주고, 그 뒤는 ‘예측’으로 표시한다. 그 시각보다 뒤에 생기는 작업함 항목은 아직 보이지 않는다(미래 정보 차단).</p>
        <ul><li><b>◀ / ▶</b> — 이전·다음 정보 사건(ETA 갱신·예보·부두제약·SOF 사건)으로 점프.</li>
          <li><b>▶ 재생</b> — 시간을 흘려보낸다. 승인이 필요한 항목이 생기면 자동으로 멈춘다.</li>
          <li><b>슬라이더</b> — 15분 단위. 아래 눈금이 사건 시각이고 주황 눈금은 예보·부두제약 변경이다.</li>
          <li><b>링크 공유</b> — 주소창의 <code>#t=2026-11-04T08:00&amp;tab=inbox&amp;item=IMP-1104-0800</code>처럼 시각·화면·항목이 남는다. 그대로 보내면 같은 장면이 열린다.</li>
          <li>시각과 무관한 화면(개념·로드맵·진단·검증 등)은 시각을 옮겨도 다시 그리지 않는다.</li></ul></div></section>
      ${head(4)}${groups.map((g) => `<h4 class="cx-group">${esc(g)}</h4><div class="cx-tabs">${TAB_GUIDE.filter((x) => x[1] === g).map(([tab, , name, what, tryit]) => `<div class="cx-tabcard"><div class="top"><b>${esc(name)}</b>${gotoLink(tab, null, '열기')}</div><dl><dt>보는 것</dt><dd>${fillCounts(esc(what))}</dd><dt>해 볼 것</dt><dd>${fillCounts(esc(tryit))}</dd></dl></div>`).join('')}</div>`).join('')}</section>
      ${head(5)}<div class="cx-lead"><p>처음 보는 사람에게 보여 주는 동선이다. 링크를 누르면 시각·화면·항목이 한 번에 맞춰진다.</p></div>
        <ol class="cx-demo">${DEMO5.map(([p, t, d]) => `<li><b>${esc(t)}</b> ${demoLink(p, '열기')}<span class="what">${fillCounts(esc(d))}</span></li>`).join('')}</ol></section>
      ${head(6)}<div class="cx-lead"><p>계약·NOR·클레임까지 보여 주는 긴 동선이다. 결정을 내린 뒤에는 마지막에 초기화해 두면 다음 사람이 처음 상태로 볼 수 있다.</p></div>
        <ol class="cx-demo">${DEMO15.map(([p, t, d]) => `<li><b>${esc(t)}</b> ${demoLink(p, '열기')}<span class="what">${fillCounts(esc(d))}</span></li>`).join('')}</ol></section>
      ${head(7)}
        <div class="cx-cols">
          <div class="cx-card"><h4>세 가지 결정</h4><ul><li><b>확인</b> — 읽었다는 표시. 후보는 그대로 남아 나중에 적용할 수 있다.</li><li><b>이 옵션 적용</b> — 후보를 계획으로 채택. 계획 버전 +1, 그 시각 이후 계획이 바뀌고 감사 로그에 남는다. 대리점·생산조정팀 통보문 초안이 생긴다.</li><li><b>반려</b> — 후보를 쓰지 않는다. 메모를 남길 수 있다.</li></ul></div>
          <div class="cx-card"><h4>무효화 규칙 — 왜 버튼이 꺼져 있나</h4><ul><li>옵션은 항목 상태가 <b>새 항목·확인</b>일 때만 적용할 수 있다.</li><li>항목이 생긴 뒤 다른 승인으로 계획이 바뀌었으면 그 항목의 후보는 적용할 수 없다 — “항목 생성 뒤 계획이 vN로 바뀜”이 이유로 표시된다. 새 계획 기준으로 다시 만든 항목에서 판단한다.</li><li>항목이 생기기 전 시각에서는 그 항목을 열 수 없다.</li></ul></div>
          <div class="cx-card"><h4>사람만 하는 일</h4><ul><li>쟁점(이동·야간 대기 부담 등)은 자동 판정하지 않는다 — 기본 계산과 대안 계산을 함께 본다.</li><li>MCP·LLM은 승인할 수 없다. 숫자는 엔진, 문장은 초안.</li><li>초기화하면 결정·계획 버전만 되돌아가고 감사 로그는 남는다.</li></ul></div>
        </div></section>
      ${head(8)}<div class="cx-lead"><p>‘무엇을 넣어야 계산이 되나’에 대한 답이다. 입력·계산기에는 SOF와 계약 조건만 있으면 되고, 운영 시뮬레이션은 아래 데이터 파일을 읽는다.</p></div>
        <div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>입력</th><th>형식</th><th>어디에</th><th>예</th></tr></thead><tbody>
          <tr><td><b>SOF</b></td><td class="small"><code>| D1 10:00 | 묘박지 도착, NOR 제출·수령 |</code> 한 줄에 시각 하나 (D1 = 기준일)</td><td class="small">입력·계산기에 붙여 넣기 · data/live/sof_reports.json</td><td class="small">골든 케이스 TC-01~05</td></tr>
          <tr><td><b>기준일</b></td><td class="small">YYYY-MM-DD</td><td class="small">입력·계산기</td><td class="small">2026-11-03</td></tr>
          <tr><td><b>계약 조건</b> (필수: 레이타임·요율)</td><td class="small">laytime_hours · notice_hours(기본 6) · rate_usd_day · operation(DISCHARGE/LOAD) · form</td><td class="small">입력·계산기 · data/live/contracts.json</td><td class="small">36h · 6h · $120,000/일</td></tr>
          <tr><td><b>상황</b> (선택)</td><td class="small">berth_id · daytime_rule(주간 제한 적용) · berth_free_on_arrival</td><td class="small">입력·계산기 옵션</td><td class="small">SK2B · 주간 제한 적용</td></tr>
          <tr><td><b>선박·ETA</b></td><td class="small">DWT·LOA·흘수·펌프 능력, ETA 갱신 이력</td><td class="small">data/live/vessels.json · calls.json</td><td class="small">JANGSAENGPO GRACE ETA → 11/04 13:00</td></tr>
          <tr><td><b>기상 예보</b></td><td class="small">발표 시각·적용 기간·풍속</td><td class="small">data/live/weather.json</td><td class="small">FC-1104-08 풍랑주의보</td></tr>
          <tr><td><b>선석·자원</b></td><td class="small">선석 제원·부두제약·탱크 레버·조석·배관·예선</td><td class="small">data/live/berths.json · plan.json · resources.json</td><td class="small">SK3 Buoy 정비 → 11/05 07:00</td></tr>
          <tr><td><b>룰</b></td><td class="small">계약·판례·터미널·계획·엔진 룰 ${cnt('rules')}개와 확인 상태</td><td class="small">data/rules.json</td><td class="small">${ruleChip('ASB-08-HALF-RATE')}</td></tr>
        </tbody></table></div></section>
      ${head(9)}<dl class="cx-faq">
          <dt>숫자는 실제 데이터인가요?</dt><dd>아닙니다. 선박·계약·예보·금액 모두 교육용 가상 값이고, SEAGATE 화면을 자동 수집하지 않습니다(robots.txt로 막혀 있음).</dd>
          <dt>작업함이 비어 있거나 링크한 항목이 안 열립니다.</dt><dd>지금 시각보다 뒤에 생기는 항목은 보이지 않습니다. 상단 시각을 앞으로 옮기거나, 링크에 <code>#t=</code>가 들어 있는지 확인하세요.</dd>
          <dt>‘이 옵션 적용’ 버튼이 꺼져 있습니다.</dt><dd>이미 처리한 항목이거나, 항목이 생긴 뒤 계획 버전이 바뀐 경우입니다. 버튼 아래의 ‘적용 불가’ 이유를 보고 최신 항목에서 다시 판단하세요.</dd>
          <dt>결정을 되돌리고 싶습니다.</dt><dd>상단 ‘초기화’를 누르면 모든 결정과 계획 버전이 처음으로 돌아갑니다. 감사 로그는 남습니다.</dd>
          <dt>서버가 <code>Address already in use</code>로 안 뜹니다.</dt><dd>같은 포트에 이미 서버가 떠 있습니다. <code>python3 server.py --port 8790</code>처럼 다른 포트를 쓰거나, 떠 있는 서버 주소로 접속하세요.</dd>
          <dt>정적 사이트가 멈춘 것 같습니다.</dt><dd>첫 방문은 엔진을 내려받느라 10~30초 걸립니다. 진행 표시가 사라질 때까지 기다리고, 오래 걸리면 새로고침하세요.</dd>
          <dt>LLM이 금액을 만드나요?</dt><dd>아닙니다. 금액은 결정론적 엔진이 계산하고, 문장은 템플릿 초안입니다(LLM 슬롯은 선택이며 숫자를 바꾸지 못함).</dd>
          <dt>투어를 다시 보고 싶습니다.</dt><dd>상단 ‘사용법 투어’ 또는 이 화면의 ‘가이드 투어 시작’. 완료 여부는 이 브라우저에만 저장됩니다.</dd>
        </dl></section>`;
    el.replaceChildren(root);
    root.addEventListener('click', onPageClick);
    ctx.get('/api/rules').then((rs) => setCount('rules', arr(rs).length)).catch(() => {});
    ctx.get('/api/meta').then((m) => {
      const box = root.querySelector('[data-cx-meta]');
      const sc = m && m.scenario;
      if (box && sc && sc.t0 && sc.t_end) box.textContent = `${fmtTs(parseTs(sc.t0))} ~ ${fmtTs(parseTs(sc.t_end))} · 선박 ${arr(m.calls).length}척`;
    }).catch(() => {});
    return null;
  }

  // ================================================================ 가이드 투어
  const TOUR_KEY = 'dd-tour-v1';
  // sel: 강조할 요소 · tab: 먼저 열 화면 · hash: 먼저 맞출 장면 · fallback: sel이 없을 때 · wait: 찾는 시간(ms)
  const TOUR = [
    { center: true, title: '체선료 데스크 둘러보기', body: '2분이면 화면 구성과 데모 동선을 익힐 수 있습니다. <b>→</b> 또는 <b>Enter</b>로 다음, <b>←</b>로 이전, <b>Esc</b>로 닫습니다. 투어는 실제 화면을 옮겨 가며 보여 주지만 아무것도 승인하지 않습니다.' },
    { sel: '#nav', title: '왼쪽 — 화면 목록', body: '위에서 아래로 <b>개념 → Discovery·진단 → 에이전트 운영 → 검증·사업성 → 근거</b> 순서입니다. 처음이라면 ‘개념’과 ‘사용법’부터 보세요.' },
    { sel: '.clockbox', title: '가상 현재 시각', body: '이 콘솔은 11/03 00:00 ~ 11/08 12:00의 가상 1주를 재생합니다. 화면은 항상 이 시각까지 알려진 정보만 보여 주고, 그 뒤는 예측으로 표시합니다.' },
    { sel: '.controls', title: '사건 단위로 이동', body: '<b>◀ ▶</b>는 이전·다음 정보 사건(ETA·예보·부두제약·SOF)으로 점프합니다. <b>▶ 재생</b>은 시간을 흘려보내다 승인이 필요한 항목이 생기면 멈춥니다.' },
    { sel: '.slider-wrap', title: '슬라이더와 눈금', body: '15분 단위로 시각을 옮깁니다. 아래 눈금은 사건 시각이고, 주황 눈금은 예보·부두제약 변경입니다. 주소창의 <b>#t=…</b>에 시각이 남아 같은 장면을 링크로 공유할 수 있습니다.' },
    { sel: '#planChip', title: '계획 버전', body: '담당자가 후보를 승인할 때마다 <b>v1 → v2 → …</b>로 올라갑니다. 항목이 생긴 뒤 계획이 바뀌면 그 항목의 후보는 더는 적용할 수 없습니다.' },
    { tab: 'concepts', sel: '#main', title: '개념 — 12장의 그림', body: '레이타임 시계, 두 겹 계약, 프로세스·자원 지도, 에이전트 구조, 검증 방법을 그림으로 설명합니다. 점선 밑줄 용어에 마우스를 올리면 뜻이 보입니다.' },
    { tab: 'discovery', sel: '#main', title: '로드맵 (Discovery)', body: '목표와 7가지 핵심 질문(Q1~Q7), Coverage A–T, Phase P0–P30, Evidence Chain — ‘무엇을 왜 만들었나’를 거꾸로 추적하는 화면입니다.' },
    { tab: 'diagnosis', sel: '#main', title: '진단', body: '기준 계획의 실제 체선료를 원인·선석·선종별로 쪼개고, 통제가능성(A~D)과 Value at Stake로 줄일 수 있는 돈을 계산합니다.' },
    { hash: { t: '2026-11-04T08:00', tab: 'inbox', item: 'IMP-1104-0800' }, sel: '.option.best', fallback: '#main', wait: 8000, title: '작업함 — 후보 카드', body: '11/04 08:00, 폭풍 예보가 들어온 순간입니다. 에이전트가 계산한 1순위 후보(예상 체선료·선정 이유·Risk·가정·대안)를 보고 <b>‘이 옵션 적용’</b> 또는 반려합니다. 승인은 사람만 합니다.' },
    { tab: 'timeline', sel: '#main', title: '타임라인', body: '선석별 물리 상태(대기·이동·하역)와 레이타임 시계, 풍속을 한 축에 놓습니다. 지금 선 오른쪽은 예측 — 후보를 승인하면 이 그림이 바뀝니다.' },
    { tab: 'validation', sel: '#main', title: '검증', body: '같은 정보로 7가지 결정 규칙을 겨룬 Historical Replay, {scenarios}개 시나리오, 민감도 분석입니다. 미래 정보는 쓰지 않고 실제 결과로만 채점합니다.' },
    { tab: 'business', sel: '#main', title: '비즈니스 케이스', body: '발생 빈도·채택률 같은 가정을 바꿔 연간 절감·ROI·회수 기간을 계산합니다. 기본값은 보수적으로 잡았습니다.' },
    { sel: '#btnReset', title: '초기화와 다음 단계', body: '<b>초기화</b>는 모든 결정과 계획 버전을 처음으로 되돌립니다(감사 로그는 남음). 실행 방법, 5분·15분 데모 순서, 문제 해결은 ‘사용법’ 화면에 있습니다.' },
  ];
  let TS = null;
  function tourDone() {
    try { return !!window.localStorage.getItem(TOUR_KEY); } catch (_) { return false; }
  }
  function markTour(v) {
    try { window.localStorage.setItem(TOUR_KEY, v); } catch (_) { /* 저장소를 쓸 수 없는 환경 */ }
  }
  function openTab(tab) {
    const b = document.querySelector(`.navbtn[data-tab="${tab}"]`);
    if (b) { if (!b.classList.contains('active')) b.click(); return; }
    const h = hashFor({ tab });
    if (location.hash !== h) location.hash = h;
  }
  function waitFor(sel, ms, cancelled) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (cancelled()) { resolve(null); return; }
        const el = document.querySelector(sel);
        if (el && el.getClientRects().length) { resolve(el); return; }
        if (Date.now() - t0 > ms) { resolve(null); return; }
        setTimeout(tick, 120);
      };
      tick();
    });
  }
  function startTour(opts) {
    const o = opts || {};
    if (TS) endTour(false);
    hideTip();
    const root = document.createElement('div');
    root.className = 'cx-tour';
    root.innerHTML = '<div class="cx-tour-spot" hidden></div><div class="cx-tour-card" role="dialog" aria-modal="false" aria-labelledby="cxTourT" aria-describedby="cxTourB" tabindex="-1"></div>';
    document.body.appendChild(root);
    TS = { i: 0, root, spot: root.firstElementChild, card: root.lastElementChild, target: null, token: 0, prev: document.activeElement, raf: 0 };
    TS.onKey = onTourKey;
    TS.onReflow = () => { if (TS && !TS.raf) TS.raf = requestAnimationFrame(() => { if (TS) { TS.raf = 0; placeTour(); } }); };
    document.addEventListener('keydown', TS.onKey, true);
    window.addEventListener('resize', TS.onReflow);
    window.addEventListener('scroll', TS.onReflow, true);
    TS.card.addEventListener('click', onTourClick);
    showTourStep(Math.max(0, Math.min(TOUR.length - 1, num(o.step) || 0)));
    return true;
  }
  function paintTourCard(i, loading, missing) {
    const step = TOUR[i];
    const n = TOUR.length;
    TS.card.innerHTML = `<div class="stepn">${i + 1} / ${n}${loading ? ' · 화면을 여는 중…' : ''}</div>
      <h4 id="cxTourT">${esc(step.title)}</h4><p id="cxTourB">${fillCounts(step.body)}</p>
      ${missing ? '<p class="small muted">이 화면 요소를 찾지 못해 설명만 띄웠습니다.</p>' : ''}
      <div class="bar" aria-hidden="true"><i style="width:${(((i + 1) / n) * 100).toFixed(1)}%"></i></div>
      <div class="acts"><button type="button" class="btn small" data-tour="close">닫기 (Esc)</button><div class="r">
        ${i ? '<button type="button" class="btn small" data-tour="prev">← 이전</button>' : ''}
        ${i === n - 1 ? '<button type="button" class="btn small" data-tour="usage">사용법 열기</button><button type="button" class="btn small primary" data-tour="done">완료</button>' : '<button type="button" class="btn small primary" data-tour="next">다음 →</button>'}</div></div>`;
  }
  const reveal = (el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: r.height > window.innerHeight * 0.7 ? 'start' : 'center' });
  };
  async function showTourStep(i) {
    if (!TS) return;
    const st = TS;
    const step = TOUR[i];
    const token = ++st.token;
    clearInterval(st.poll);
    st.i = i;
    st.target = null;
    st.ready = false;
    paintTourCard(i, !step.center, false);
    placeTour();
    st.card.focus({ preventScroll: true });
    if (step.hash) { const h = hashFor(step.hash); if (location.hash !== h) location.hash = h; } else if (step.tab) openTab(step.tab);
    if (step.center) return;
    const el = await waitFor(step.sel, step.wait || 2500, () => !TS || token !== st.token);
    if (!TS || token !== st.token) return;
    const tgt = el || (step.fallback ? document.querySelector(step.fallback) : null);
    st.target = tgt;
    st.missing = !tgt;
    st.ready = true;
    if (tgt) reveal(tgt);
    paintTourCard(i, false, !tgt);
    placeTour();
    st.card.focus({ preventScroll: true });
    // 화면이 비동기로 다시 그려져도 강조 위치를 따라가도록 잠시 다시 맞춘다(늦게 나타난 주 대상으로 옮김)
    const until = Date.now() + 8000;
    st.poll = setInterval(() => { if (!TS || token !== st.token || Date.now() > until) { clearInterval(st.poll); return; } placeTour(); }, 400);
  }
  function placeTour() {
    if (!TS) return;
    const st = TS;
    const step = TOUR[st.i];
    let el = st.target;
    if (st.ready && step.sel) {
      const prim = document.querySelector(step.sel);
      if (prim && prim !== el && prim.getClientRects().length) {
        el = st.target = prim;
        reveal(prim);
        if (st.missing) { st.missing = false; paintTourCard(st.i, false, false); }
      } else if (el && !el.isConnected) {
        el = st.target = (step.fallback && document.querySelector(step.fallback)) || null;
      }
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 12;
    const card = st.card;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    if (!el) {
      st.spot.hidden = true;
      st.root.classList.add('dim');
      card.style.left = `${Math.max(m, (vw - cw) / 2)}px`;
      card.style.top = `${Math.max(m, (vh - ch) / 2)}px`;
      return;
    }
    st.root.classList.remove('dim');
    st.spot.hidden = false;
    const r = el.getBoundingClientRect();
    const x1 = Math.max(4, r.left - 6);
    const y1 = Math.max(4, r.top - 6);
    const x2 = Math.min(vw - 4, r.right + 6);
    const y2 = Math.min(vh - 4, r.bottom + 6);
    Object.assign(st.spot.style, { left: `${x1}px`, top: `${y1}px`, width: `${Math.max(0, x2 - x1)}px`, height: `${Math.max(0, y2 - y1)}px` });
    const cx = (x) => Math.min(Math.max(m, x), vw - cw - m);
    const cy = (y) => Math.min(Math.max(m, y), vh - ch - m);
    const spots = [[cx(x1), y2 + m, y2 + m + ch <= vh - m], [cx(x1), y1 - m - ch, y1 - m - ch >= m], [x2 + m, cy(y1), x2 + m + cw <= vw - m], [x1 - m - cw, cy(y1), x1 - m - cw >= m]];
    const c = spots.find((p) => p[2]) || [vw - cw - 2 * m, vh - ch - 2 * m];
    card.style.left = `${Math.max(m, c[0])}px`;
    card.style.top = `${Math.max(m, c[1])}px`;
  }
  function tourGo(d) {
    if (!TS) return;
    const j = TS.i + d;
    if (j < 0) return;
    if (j >= TOUR.length) { endTour(true); return; }
    showTourStep(j);
  }
  function endTour(done) {
    if (!TS) return;
    const st = TS;
    TS = null;
    clearInterval(st.poll);
    if (st.raf) cancelAnimationFrame(st.raf);
    document.removeEventListener('keydown', st.onKey, true);
    window.removeEventListener('resize', st.onReflow);
    window.removeEventListener('scroll', st.onReflow, true);
    st.root.remove();
    markTour(done ? 'done' : 'closed');
    if (st.prev && st.prev.isConnected && typeof st.prev.focus === 'function') st.prev.focus({ preventScroll: true });
  }
  function onTourClick(e) {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    const a = b.dataset.tour;
    if (a === 'next') tourGo(1);
    else if (a === 'prev') tourGo(-1);
    else if (a === 'close') endTour(false);
    else if (a === 'done') endTour(true);
    else if (a === 'usage') { endTour(true); openTab('usage'); }
  }
  function onTourKey(e) {
    if (!TS) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour(false); return; }
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const onControl = t && t.closest && t.closest('button, a, [role="button"], [role="link"]');
    if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onControl)) { e.preventDefault(); e.stopPropagation(); tourGo(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); tourGo(-1); }
  }

  window.Concepts = {
    render,
    renderUsage,
    startTour,
    tourDone,
    term,
    glossary: Object.freeze(glossary.slice()),
    categories: CATS.slice(),
  };
})();
