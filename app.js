/* 체선료 데스크 — 콘솔 클라이언트. API 계약: ../docs/api.md. 외부 라이브러리 없음. */
'use strict';
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const main = $('#main');
  const TABS = ['concepts', 'usage', 'discovery', 'diagnosis', 'casestudy', 'inbox', 'timeline', 'resources', 'statement', 'intake',
    'validation', 'benchmark', 'business', 'assurance', 'rules', 'audit', 'guide'];
  // 시각을 옮겨도 다시 그리지 않는 탭(시점 t와 무관한 화면)
  const STATIC_TABS = new Set(['concepts', 'usage', 'discovery', 'diagnosis', 'casestudy', 'validation', 'benchmark', 'business', 'assurance', 'intake', 'rules', 'audit', 'guide']);
  const TAB_ALIAS = {
    roadmap: 'discovery', diag: 'diagnosis', valid: 'validation', business_case: 'business', bc: 'business', claims: 'inbox', claim: 'inbox',
    concept: 'concepts', glossary: 'concepts', help: 'usage', howto: 'usage', tour: 'usage', case: 'casestudy', case_study: 'casestudy', cases: 'casestudy',
    resource: 'resources', constraints: 'resources', bench: 'benchmark', benchmarks: 'benchmark', pilot: 'assurance', kpi: 'assurance',
  };
  const TAB_NAME = {
    concepts: '개념', usage: '사용법', discovery: '로드맵', diagnosis: '진단', casestudy: '사례 복원', inbox: '작업함', timeline: '타임라인', resources: '자원·제약',
    statement: '계산서', intake: '입력·계산기', validation: '검증', benchmark: '벤치마크', business: '비즈니스 케이스', assurance: '도입 검증',
    rules: '룰·근거', audit: '감사 로그', guide: '작동 원리',
  };
  // 메뉴 툴팁·사용법 화면에 쓰는 한 줄 설명
  const TAB_HELP = {
    concepts: '체선료·레이타임·NOR 같은 핵심 개념과 이 데스크가 푸는 문제를 그림으로 설명',
    usage: '화면별 사용법과 추천 데모 순서',
    discovery: '목표·7가지 질문·Coverage A–T·Phase P0–P30·Evidence Chain·프로세스 맵·이해관계자·질문 시트',
    diagnosis: '기준 계획의 체선료를 원인·선석·선종별로 쪼개고 통제 가능성과 Value at Stake 계산',
    casestudy: '어려웠던 하루를 T-72h부터 결과까지 시점별로 복원 — 그때 알던 것, 결정, 반사실, 교훈',
    inbox: '에이전트가 만든 판단 대기 항목 — 근거를 보고 확인·승인·반려',
    timeline: '선석별 물리 상태와 레이타임 시계, 풍속·조위 — 지금 선 오른쪽은 예측',
    resources: '조석(UKC)·파고·시정·탱크·배관·예선·제품 전환·검사 제약이 언제·얼마나 계획을 막았나',
    statement: '시점 t 기준 항차별 레이타임 계산서(예측 포함)와 체선사유 분류',
    intake: 'SOF를 붙여 넣어 같은 엔진으로 계산하고 정답과 비교',
    validation: '해결 대안 비교(P19)·현업 판단 로직(P11)·정책 경쟁·Historical Replay·시나리오·민감도',
    benchmark: '외부 공개 사례 A–G를 같은 15개 질문으로 비교 — 출처 링크 포함',
    business: '가정값을 바꿔 연간 절감·ROI·회수 기간 계산',
    assurance: '검증 KPI·Shadow Mode 일치율·파일럿 단계·거버넌스 질문',
    rules: '모든 판정의 근거 룰과 상태(공개자료·원문 대조 전·가정·쟁점)',
    audit: '사람이 내린 결정 기록과 감사 로그 기반 Shadow mode KPI',
    guide: '에이전트 파이프라인과 입력 데이터 출처, 로드맵 ↔ 화면 대응표',
  };
  const STEP_MS = 15 * 60 * 1000;
  const IS_STATIC = window.DESK_STATIC === true;

  // ---------------------------------------------------------------- 형식
  const pad = (n) => String(n).padStart(2, '0');
  function parseTs(s) {
    if (s == null) return null;
    if (typeof s === 'number') return s;
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(s));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }
  function isoOf(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  function fmtTs(s) {
    const ms = parseTs(s);
    if (ms == null) return '—';
    const d = new Date(ms);
    return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  function fmtDate(s) {
    const ms = parseTs(s);
    if (ms == null) return '—';
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  function fmtDay(ms) {
    const d = new Date(ms);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${'일월화수목금토'[d.getUTCDay()]})`;
  }
  function fmtH(h) {
    if (h == null || isNaN(h)) return '—';
    let total = Math.round(Number(h) * 60);
    const sign = total < 0 ? '−' : '';
    total = Math.abs(total);
    return `${sign}${Math.floor(total / 60)}h ${pad(total % 60)}m`;
  }
  function fmtDeltaH(h) {
    if (h == null || isNaN(h)) return '—';
    if (Math.abs(h) < 1 / 120) return '±0';
    return (h > 0 ? '+' : '') + fmtH(h);
  }
  // 엔진(Python) 문장과 같은 숫자가 나오도록 .5는 짝수 쪽으로 반올림한다
  function roundHalfEven(x) {
    const f = Math.floor(x);
    return Math.abs(x - f - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(x);
  }
  function fmtUSD(x) {
    if (x == null || isNaN(x)) return '—';
    const v = Number(x);
    const a = Math.abs(v);
    const cents = Math.round(a * 100) % 100 !== 0;
    const s = a < 100 && cents ? a.toFixed(2) : roundHalfEven(a).toLocaleString('en-US');
    return (v < 0 && Math.round(a) !== 0 ? '−$' : (v < 0 && cents ? '−$' : '$')) + s;
  }
  function fmtDelta(x) {
    if (x == null || isNaN(x)) return '—';
    if (Math.abs(x) < 0.5) return '$0';
    return (x > 0 ? '+' : '') + fmtUSD(x);
  }
  const dCls = (x) => (x == null ? 'muted' : x > 0.5 ? 'pos' : x < -0.5 ? 'neg' : 'muted');
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const num = (x, d = 0) => (x == null || isNaN(x) ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d }));
  const arr = (x) => (Array.isArray(x) ? x : []);

  // ---------------------------------------------------------------- 라벨
  const KIND_LABEL = { BASELINE: '기준 계획', IMPACT: '영향 설명', PLAN_APPLIED: '계획 반영', NOR: 'NOR', STATEMENT: '계산서', CLAIM: '클레임' };
  const STATUS_LABEL = { NEW: '새 항목', ACK: '확인됨', APPROVED: '승인', REJECTED: '반려', SENT: '발송 승인', STALE: '무효' };
  const SEV_LABEL = { high: '높음', medium: '중간', low: '낮음', error: '오류', critical: '중대', dispute: '쟁점', warning: '경고', info: '정보' };
  const ACTION_LABEL = { ACK: '확인', APPROVE: '확정·승인', APPROVE_OPTION: '옵션 적용', REJECT: '반려', SEND: '발송 승인', RESET: '초기화' };
  const TRIGGER_LABEL = {
    INIT: '초기', SOF: 'SOF', ETA: 'ETA 갱신', FORECAST: '기상예보', CONSTRAINT: '부두제약', PLAN: '계획 변경', CLAIM: '청구 접수',
    TIDE: '조석 예보', WAVE: '파고 예보', FOG: '시정 통제', TUG: '예선 가용', MARINE: '도선·예선', VETTING: '검사 결과', TANK: '탱크 재고', PIPELINE: '배관 운용',
  };
  // 대기·지연 사유 코드 (docs/api.md v3) — [한글, 묶음]. 색은 styles.css의 .rz-<코드>
  const REASON_META = {
    CONGESTION: ['선석 점유 대기', 'wait'], NIGHT: ['야간 제한', 'wait'], WEATHER: ['기상(풍속)', 'wait'], OOS: ['선석 정비·사용불가', 'wait'],
    TIDE: ['조석·UKC 창', 'wait'], TUG: ['예선·도선·계류감독 대기', 'wait'], VETTING: ['검사·승인 대기', 'wait'], FOG: ['시정 불량 항만 통제', 'wait'],
    WAVE: ['파고 제한', 'wait'], TANK: ['탱크 공간 부족(접안 보류)', 'wait'],
    PIPELINE: ['공유 주배관 제한', 'slow'], SHORE_TANK: ['육상 탱크 공간 제한', 'slow'],
    CHANGEOVER: ['제품 전환(라인 치환)', 'prep'], SAMPLING: ['샘플링·분석', 'prep'],
    WIND: ['풍속(기상)', 'stop'], SHORE_RATE: ['육상 수용률(탱크 배정)', 'slow'], UNBERTH: ['이안 지연', 'post'], OTHER: ['기타 대기', 'wait'],
  };
  const REASON_GROUP = { wait: '대기(접안 전)', slow: '하역 속도 제한', prep: '접안 후 준비', stop: '하역 중단', post: '이안 지연' };
  const NEW_REASONS = ['TIDE', 'TUG', 'VETTING', 'FOG', 'WAVE', 'TANK', 'PIPELINE', 'SHORE_TANK', 'CHANGEOVER', 'SAMPLING'];
  const NEW_REASON_SET = new Set(NEW_REASONS);
  const reasonCode = (key) => { const s = String(key || ''); const i = s.lastIndexOf(':'); return i >= 0 ? s.slice(i + 1) : s; };
  const reasonLabel = (code) => (REASON_META[code] ? REASON_META[code][0] : code);
  const reasonDot = (key) => { const c = reasonCode(key); return REASON_META[c] ? `<i class="rdot rz-${esc(c)}" title="${esc(REASON_META[c][0])}"></i>` : ''; };
  const EVENT_LABEL = {
    EOSP: '항해 종료', ANCHORED: '묘박지 투묘(도착)', NOR_TENDERED: 'NOR 제출', NOR_RECEIVED: 'NOR 수령', NOR_RETENDERED: 'NOR 재제출',
    FREE_PRATIQUE: '검역 허가', BERTH_VACATED: '앞 선박 이안', PILOT_ON_BOARD: '도선사 승선', ANCHOR_AWEIGH: '양묘·이동 시작',
    ALL_FAST: '접안·계류 완료', HOSES_CONNECTED: '호스 연결', OPS_COMMENCED: '하역 개시', OPS_STOPPED: '하역 중단', OPS_RESUMED: '하역 재개',
    OPS_COMPLETED: '하역 완료', HOSES_DISCONNECTED: '호스 분리', DOCS_ON_BOARD: '서류 완료', LAST_LINE: '이안(마지막 줄)', COSP: '출항',
  };
  const CLOCK_LABEL = { NOT_STARTED: '개시 전', LAYTIME: '레이타임 진행', EXCLUDED: '제외 구간', DEMURRAGE: '체선 중', DEMURRAGE_HALF: '체선(반액)', ENDED: '종료', UNKNOWN: '—' };
  const EFFECT_LABEL = { COUNT: '산입', EXCLUDE: '제외', FULL: '체선 전액', HALF: '체선 반액', NOTICE: '통지시간' };
  const PHYS_LABEL = { WAIT: '묘박 대기', SHIFT: '이동', BERTH: '접안·호스', OPS: '하역', STOP: '하역 중단', POST: '호스 분리', DOCS: '서류·이안' };
  const RULE_STATUS = { public: '공개자료', verify: '원문 대조 전', assumed: '가정', disputed: '쟁점' };
  const GROUP_LABEL = { CP: '용선계약', LAW: '판례', RIDER: 'Rider', TERMINAL: '터미널', PLAN: '계획 가정', ENGINE: '엔진' };
  const START_BASIS = { ALL_FAST: '접안 완료가 먼저', NOTICE: '통지시간 만료가 먼저', OPS_COMMENCED: '무효 NOR → 하역 개시', RETENDER: '재제출 NOR + 통지시간', LAYCAN: '레이캔 시작', OVERRIDE: '수동 지정' };
  const DOC_LABEL = { NOR: 'NOR', SOF_SIGNED: '3자 서명 SOF', TIMESHEET: '타임시트', PUMPING_LOG: '펌핑 로그', LOP: '항의서(LOP)', CP_RATE_EVIDENCE: 'CP 요율 증빙' };
  const STEP_MARK = { pass: '✓', warn: '!', fail: '✗', info: 'i' };
  const LAYER_LABEL = { CHARTER_PARTY: '용선계약', SALES_CONTRACT: '매매계약' };
  // v2 — 로드맵·진단·검증
  const DSTATUS = { OPEN: '미확인', HYPOTHESIS: '가설', VIRTUAL: '가상 검증', CONFIRMED: '확인' };
  const DSTATUS_ORDER = ['CONFIRMED', 'VIRTUAL', 'HYPOTHESIS', 'OPEN'];
  const MODELED_LABEL = { NO: '미반영', PARTIAL: '일부 반영', YES: '반영' };
  const PROTO_LABEL = { NONE: '없음', PARTIAL: '일부', DEMO: '데모' };
  const BASIS_LABEL = { VIRTUAL: '가상 데이터', DOC: '문서' };
  const ACTION2_LABEL = { AUTO_RECALC: '자동 재계산', APPROVAL: '승인 후 계산' };
  const SCORE_LABEL = {
    predictability: '예측 가능성', lead_time: '리드타임', accuracy: '정확도', control: '직접 통제', influence: '협의 영향',
    response: '대응 가능', scheduling_impact: '순서 영향', cost_impact: '비용 영향', frequency: '빈도', data_availability: '데이터',
  };
  const SCORE_KEYS = Object.keys(SCORE_LABEL);
  const CLASS_LEGEND = [
    ['A', '통제 가능', '최적화 결정변수 (Optimization Decision)'],
    ['B', '통제 불가 · 예측 가능', '스케줄링 제약 (Scheduling Constraint)'],
    ['C', '통제 불가 · 불확실', '시나리오·리스크 (Scenario / Risk)'],
    ['D', '사실상 대응 불가', 'Scope 밖'],
  ];
  const KPI_GROUPS = [['financial', '재무 Financial'], ['time', '시간 Time'], ['operational', '운영 Operational'], ['reliability', '신뢰도 Reliability']];
  const PARETO_DIMS = [['by_cause', '원인'], ['by_berth', '선석'], ['by_vessel_type', '선종'], ['by_size', '선형'], ['by_operation', '작업'], ['by_rate', '요율대']];
  const paretoDims = (d) => {
    const p = (d && d.pareto) || {};
    const known = PARETO_DIMS.filter(([k]) => Array.isArray(p[k]));
    const extra = Object.keys(p).filter((k) => k.startsWith('by_') && Array.isArray(p[k]) && !PARETO_DIMS.some(([x]) => x === k)).map((k) => [k, k.slice(3)]);
    return known.concat(extra);
  };
  const PARETO_METRICS = [['cost_usd', '금액'], ['duration_h', '시간'], ['frequency', '빈도']];
  const PHASE_BANDS = [['Discovery', 0, 12], ['진단', 13, 17], ['벤치마크', 18, 18], ['해결안', 19, 20], ['검증', 21, 25], ['에이전트', 26, 28], ['사업성·적용', 29, 30]];
  const REMIND = '이 정보를 알게 되면 프로젝트의 어떤 결정을 바꿀 수 있는가?';

  // ---------------------------------------------------------------- 상태
  const S = {
    meta: null, state: null, rules: {}, rulesList: [], golden: null,
    t: null, t0: 0, tEnd: 0, tab: 'concepts', itemId: null, item: null, filter: 'all',
    playing: false, playTimer: null, reqSeq: 0, itemSeq: 0, stmtSeq: 0, rendered: null,
    stmtCall: null, drawerCall: null, debounce: null,
    intake: { preset: '', result: null, parsed: null, request: null },
    ruleFilter: { group: '', status: '', q: '' },
    v2: { discovery: null, validation: null, diag: {}, business: null },
    qf: { phase: '', domain: '', status: '', mentor: false, q: '' }, qOpen: new Set(),
    diagCase: 'base', paretoDim: 'by_cause', paretoMetric: 'cost_usd',
    valPolicy: null, bizParams: {}, bizTimer: null, bizSeq: 0, pendingAnchor: null,
    // v3 — 자원·제약, 사례 복원, 벤치마크, 타임라인 조위
    resScenario: 'BASE', resPolicy: 'CURRENT_RULE', resSeq: 0, caseId: null, caseSnap: null, caseSeq: 0, bmView: 'cards', tide: null, tideLoading: false,
  };

  // ---------------------------------------------------------------- API
  // 정적 배포(GitHub Pages): 서버 대신 브라우저 안의 Python 엔진(Pyodide, web/bridge.js)에 같은 경로로 묻는다
  let bridgeWait = null;
  function bridgeReady() {
    if (bridgeWait) return bridgeWait;
    bridgeWait = (async () => {
      const ov = $('#bootOverlay');
      if (ov) ov.classList.remove('hidden');
      const started = Date.now();
      const tick = setInterval(() => {
        const sub = $('#bootSub');
        const st = window.DeskBridge && window.DeskBridge.status ? String(window.DeskBridge.status) + ' · ' : '';
        if (sub) sub.textContent = `${st}${Math.round((Date.now() - started) / 1000)}초`;
      }, 500);
      try {
        while (!window.DeskBridge) {
          if (Date.now() - started > 60000) throw new Error('브라우저 엔진(bridge.js)을 찾을 수 없습니다');
          await new Promise((r) => setTimeout(r, 100));
        }
        await window.DeskBridge.ready;
      } finally {
        clearInterval(tick);
        if (ov) ov.classList.add('hidden');
      }
    })();
    bridgeWait.catch(() => { bridgeWait = null; });
    return bridgeWait;
  }
  async function api(path, opts) {
    if (IS_STATIC) {
      await bridgeReady();
      const method = (opts && opts.method) || 'GET';
      let body = opts && opts.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { /* 문자열 그대로 */ } }
      try { return await window.DeskBridge.request(method, path, body); } catch (e) { throw new Error(e && e.message ? e.message : String(e)); }
    }
    let res;
    try { res = await fetch(path, opts); } catch (e) { throw new Error('서버에 연결할 수 없습니다 (' + e.message + ')'); }
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok || (data && data.error)) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
    return data;
  }
  const GET = (p) => api(p);
  const POST = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  // ---------------------------------------------------------------- 배너·로딩
  function showError(msg) { banner(msg, false); }
  function showOk(msg) { banner(msg, true); }
  function banner(msg, ok) {
    const b = $('#banner');
    b.innerHTML = `<div class="banner ${ok ? 'ok' : ''}" role="${ok ? 'status' : 'alert'}"><div class="msg">${esc(msg)}</div><button class="btn small" data-close-banner>닫기</button></div>`;
    if (ok) { clearTimeout(banner.tm); banner.tm = setTimeout(() => { if (b.firstChild && b.firstChild.classList.contains('ok')) b.innerHTML = ''; }, 5000); }
  }
  const setLoading = (on) => main.classList.toggle('loading', !!on);

  // ---------------------------------------------------------------- 룰 칩
  function setRules(list) {
    const rows = Array.isArray(list) ? list : arr(list && list.rules);
    S.rulesList = rows;
    S.rules = Object.fromEntries(rows.map((r) => [r.id, r]));
  }
  function chip(id) {
    if (!id) return '';
    const r = S.rules[id];
    return `<button type="button" class="rule-chip s-${esc(r ? r.status : 'unknown')}" data-rule="${esc(id)}" title="${esc(r ? r.title : id)}">${esc(id)}</button>`;
  }
  const chips = (ids) => arr(ids).map(chip).join('');
  function openRulePopover(btn) {
    const id = btn.dataset.rule;
    const r = S.rules[id];
    const pop = $('#popover');
    pop.innerHTML = r ? `
      <div class="rid">${esc(r.id)}</div>
      <div class="rt">${esc(r.title)}</div>
      <div class="chips" style="margin:4px 0"><span class="pill k">${esc(GROUP_LABEL[r.group] || r.group || '')}</span><span class="pill sev-${r.status === 'disputed' ? 'dispute' : r.status === 'assumed' ? 'warning' : 'info'}">${esc(RULE_STATUS[r.status] || r.status)}</span></div>
      <div class="rs">출처: ${esc(r.source || '—')}</div>
      ${r.url ? `<div class="rs"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></div>` : ''}
      ${r.params ? `<div class="rs mono">${esc(JSON.stringify(r.params))}</div>` : ''}
      ${r.note ? `<div class="rs" style="margin-top:4px">${esc(r.note)}</div>` : ''}
      ${arr(r.used_by).length ? `<div class="rs">사용 모듈: ${esc(r.used_by.join(', '))}</div>` : ''}`
      : `<div class="rid">${esc(id)}</div><div class="rs">레지스트리에 없는 룰 ID</div>`;
    pop.classList.add('open');
    const rc = btn.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    pop.style.left = Math.max(8, Math.min(rc.left, window.innerWidth - w - 8)) + 'px';
    const below = rc.bottom + 6;
    pop.style.top = (below + 160 > window.innerHeight ? Math.max(8, rc.top - 6 - pop.offsetHeight) : below) + 'px';
  }
  const closePopover = () => $('#popover').classList.remove('open');

  // ---------------------------------------------------------------- 해시
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const t = p.get('t');
    S.t = t && parseTs(t) != null ? isoOf(parseTs(t)) : S.t;
    const rawTab = p.get('tab');
    const tab = TAB_ALIAS[rawTab] || rawTab;
    if (TABS.includes(tab)) S.tab = tab;
    if (p.has('item')) S.itemId = p.get('item') || null;
    if (p.has('call')) { const c = p.get('call') || null; if (tab === 'casestudy') S.caseId = c; else S.stmtCall = c; }
    if (p.has('sc')) S.resScenario = (p.get('sc') || 'BASE').toUpperCase();
    if (p.has('pol')) S.resPolicy = (p.get('pol') || 'CURRENT_RULE').toUpperCase();
  }
  function updateHash() {
    const p = new URLSearchParams();
    if (S.t) p.set('t', S.t);
    p.set('tab', S.tab);
    if (S.tab === 'inbox' && S.itemId) p.set('item', S.itemId);
    if (S.tab === 'statement' && S.stmtCall) p.set('call', S.stmtCall);
    if (S.tab === 'casestudy' && S.caseId) p.set('call', S.caseId);
    if (S.tab === 'resources' && S.resScenario && S.resScenario !== 'BASE') {
      p.set('sc', S.resScenario);
      if (S.resPolicy && S.resPolicy !== 'CURRENT_RULE') p.set('pol', S.resPolicy);
    }
    const h = '#' + p.toString().replace(/%3A/g, ':');
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  // ---------------------------------------------------------------- 시간 조작
  const clampT = (ms) => Math.max(S.t0, Math.min(S.tEnd, ms));
  function infoTimes() {
    const set = new Set(arr(S.meta && S.meta.info_events).map((e) => parseTs(e.t)).filter((x) => x != null));
    set.add(S.t0); set.add(S.tEnd);
    return [...set].sort((a, b) => a - b);
  }
  function setupSlider() {
    const sl = $('#slider');
    sl.min = 0;
    sl.max = Math.max(1, Math.round((S.tEnd - S.t0) / STEP_MS));
    setupTicks();
  }
  function setupTicks() {
    const box = $('#ticks');
    const span = S.tEnd - S.t0 || 1;
    box.innerHTML = arr(S.meta && S.meta.info_events)
      .filter((e) => e.kind !== 'SOF' || ['NOR_TENDERED', 'HOSES_DISCONNECTED'].includes(e.type))
      .map((e) => {
        const x = ((parseTs(e.t) - S.t0) / span) * 100;
        return `<i class="k-${esc(e.kind)}" style="left:calc(${x.toFixed(3)}% - 1px)" title="${esc(fmtTs(e.t) + ' ' + (e.label || EVENT_LABEL[e.type] || e.kind))}"></i>`;
      }).join('');
  }
  function syncClock() {
    const ms = parseTs(S.t);
    $('#clock').innerHTML = `${esc(fmtTs(S.t))}<small>${esc(fmtDay(ms))} KST</small>`;
    $('#slider').value = Math.round((ms - S.t0) / STEP_MS);
  }
  function goto(ms, { immediate = true } = {}) {
    S.t = isoOf(clampT(ms));
    syncClock();
    updateHash();
    clearTimeout(S.debounce);
    if (immediate) return loadState();
    S.debounce = setTimeout(loadState, 260);
    return null;
  }
  function stepEvent(dir) {
    const cur = parseTs(S.t);
    const times = infoTimes();
    const next = dir > 0 ? times.find((x) => x > cur) : [...times].reverse().find((x) => x < cur);
    if (next != null) return goto(next);
    return null;
  }
  function play() {
    if (S.playing) return pause();
    S.playing = true;
    $('#btnPlay').textContent = '❚❚ 일시정지';
    const tick = async () => {
      if (!S.playing) return;
      const cur = parseTs(S.t);
      const next = infoTimes().find((x) => x > cur);
      if (next == null) { pause(); return; }
      await goto(next);
      if (S.playing) S.playTimer = setTimeout(tick, 1200);
    };
    tick();
    return null;
  }
  function pause() {
    S.playing = false;
    clearTimeout(S.playTimer);
    $('#btnPlay').textContent = '▶ 재생';
  }

  // ---------------------------------------------------------------- 로딩
  async function init() {
    readHash();
    bind();
    applyTheme(loadTheme());
    $$('.navbtn[data-tab]').forEach((b) => { if (TAB_HELP[b.dataset.tab] && !b.title) b.title = TAB_HELP[b.dataset.tab]; });
    if (IS_STATIC) $('#staticBar') && $('#staticBar').classList.remove('hidden');
    try {
      const [meta, rules] = await Promise.all([GET('/api/meta'), GET('/api/rules').catch(() => [])]);
      S.meta = meta;
      setRules(rules);
      S.t0 = parseTs(meta.scenario.t0);
      S.tEnd = parseTs(meta.scenario.t_end);
      S.t = isoOf(clampT(parseTs(S.t) ?? S.t0));
      setupSlider();
      syncClock();
      await loadState();
    } catch (e) {
      showError('초기화 실패: ' + e.message + (IS_STATIC
        ? '\n브라우저 안 Python 엔진(Pyodide)을 불러오지 못했습니다. 네트워크(cdn.jsdelivr.net)를 확인하고 새로고침하세요.'
        : '\nserver.py가 실행 중인지 확인하세요 (python3 server.py).'));
      main.innerHTML = `<div class="panel empty">${IS_STATIC ? '엔진 초기화 실패' : '서버 응답 없음'}</div>`;
    }
  }
  async function loadState() {
    const seq = ++S.reqSeq;
    setLoading(true);
    try {
      const st = await GET('/api/state?t=' + encodeURIComponent(S.t));
      if (seq !== S.reqSeq) return;
      const prev = S.state;
      S.state = st;
      renderTop();
      if (S.playing && prev) {
        const prevIds = new Set(arr(prev.inbox).map((i) => i.id));
        const fresh = arr(st.inbox).filter((i) => i.needs_decision && i.status === 'NEW' && !prevIds.has(i.id));
        if (fresh.length) {
          pause();
          S.tab = 'inbox';
          S.itemId = fresh[0].id;
          S.item = null;
          showOk(`승인이 필요한 새 항목: ${fresh[0].title} — 재생을 멈췄습니다`);
        }
      }
      if (S.itemId && !arr(st.inbox).some((i) => i.id === S.itemId)) { S.itemId = null; S.item = null; }
      await renderTab();
    } catch (e) {
      if (seq === S.reqSeq) showError(e.message);
    } finally {
      if (seq === S.reqSeq) setLoading(false);
    }
  }
  function renderTop() {
    const st = S.state;
    if (!st) return;
    const p = st.plan || {};
    $('#planChip').textContent = `계획 v${p.version ?? 1}${p.label ? ' · ' + p.label : ''}`;
    $('#planChip').title = p.source || '';
    const pending = st.kpi && st.kpi.pending_items != null ? st.kpi.pending_items : arr(st.inbox).filter((i) => i.needs_decision && i.status === 'NEW').length;
    const c = $('#navCount');
    c.textContent = pending;
    c.classList.toggle('hidden', !pending);
    syncClock();
  }
  async function renderTab(force) {
    $$('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
    updateHash();
    if (STATIC_TABS.has(S.tab) && S.rendered === S.tab && !force) return;
    S.rendered = S.tab;
    switch (S.tab) {
      case 'concepts': return renderConceptsTab('concepts');
      case 'usage': return renderConceptsTab('usage');
      case 'casestudy': return renderCaseStudy(force);
      case 'resources': return renderResources(force);
      case 'benchmark': return renderBenchmark(force);
      case 'assurance': return renderAssurance(force);
      case 'discovery': return renderDiscovery(force);
      case 'diagnosis': return renderDiagnosis(force);
      case 'inbox': return renderInbox();
      case 'timeline': return renderTimeline();
      case 'statement': return renderStatementTab();
      case 'intake': return renderIntake();
      case 'validation': return renderValidation(force);
      case 'business': return renderBusiness(force);
      case 'rules': return renderRules();
      case 'audit': return renderAudit();
      case 'guide': return renderGuide();
      default: return null;
    }
  }
  function gotoTab(tab, anchor) {
    const t = TAB_ALIAS[tab] || tab;
    if (!TABS.includes(t)) return;
    if (t === 'inbox' && anchor) {
      if (arr(S.state && S.state.inbox).some((i) => i.id === anchor)) { S.itemId = anchor; S.item = null; }
      else showOk(`${anchor}는 지금 시각(${fmtTs(S.t)})에는 아직 생성되지 않은 항목입니다 — 상단에서 시각을 앞으로 옮기면 열립니다`);
      anchor = null;
    }
    if (t === 'statement' && anchor && arr(S.state && S.state.calls).some((c) => c.call_id === anchor)) { S.stmtCall = anchor; anchor = null; }
    if (t === 'casestudy' && anchor && callMeta(anchor)) { if (S.caseId !== anchor) S.caseSnap = null; S.caseId = anchor; anchor = null; }
    if (t === 'resources' && anchor && /^(BASE|S\d+)$/i.test(anchor)) { S.resScenario = anchor.toUpperCase(); anchor = null; }
    S.tab = t;
    S.pendingAnchor = anchor || null;
    closeDrawer();
    renderTab(true);
    // 비동기로 그리는 탭은 그린 뒤 스스로 앵커로 이동한다
    if (!['discovery', 'diagnosis', 'validation', 'business', 'concepts', 'usage', 'casestudy', 'resources', 'benchmark', 'assurance'].includes(t)) setTimeout(flushAnchor, 60);
  }
  function flushAnchor() {
    const a = S.pendingAnchor;
    S.pendingAnchor = null;
    if (!a) { window.scrollTo({ top: 0 }); return; }
    const key = String(a).toLowerCase().replace(/-/g, '_');
    const el = $$('[data-anchors]').find((e) => e.dataset.anchors.toLowerCase().replace(/-/g, '_').split(/\s+/).includes(key)) || document.getElementById(a);
    if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  }
  const callMeta = (cid) => arr(S.meta && S.meta.calls).find((c) => c.call_id === cid);
  const vesselName = (cid) => {
    const c = callMeta(cid);
    if (c && c.vessel) return c.vessel.name;
    const s = arr(S.state && S.state.calls).find((x) => x.call_id === cid);
    return s ? s.vessel_name : cid;
  };

  // ================================================================ 작업함
  const FILTERS = [
    ['all', '전체', null], ['impact', '영향 설명', ['BASELINE', 'IMPACT', 'PLAN_APPLIED']], ['nor', 'NOR', ['NOR']],
    ['statement', '계산서', ['STATEMENT']], ['claim', '클레임', ['CLAIM']],
  ];
  function inboxRows() {
    const f = FILTERS.find((x) => x[0] === S.filter) || FILTERS[0];
    const rows = arr(S.state && S.state.inbox).filter((i) => !f[2] || f[2].includes(i.kind));
    const urgent = (i) => (i.needs_decision && i.status === 'NEW' ? 0 : 1);
    return rows.map((r, idx) => ({ r, idx })).sort((a, b) => urgent(a.r) - urgent(b.r) || a.idx - b.idx).map((x) => x.r);
  }
  async function renderInbox() {
    const rows = inboxRows();
    if (!rows.some((r) => r.id === S.itemId)) { S.itemId = rows.length ? rows[0].id : null; S.item = null; }
    const counts = Object.fromEntries(FILTERS.map(([k, , kinds]) => [k, arr(S.state && S.state.inbox).filter((i) => !kinds || kinds.includes(i.kind)).length]));
    main.innerHTML = `
      <div class="inbox">
        <div class="inbox-list">
          <div class="filters">${FILTERS.map(([k, label]) => `<button class="filter-chip ${S.filter === k ? 'active' : ''}" data-filter="${k}">${label} <span class="mono">${counts[k]}</span></button>`).join('')}</div>
          <div class="rows">${rows.length ? rows.map(inboxRow).join('') : '<div class="empty">이 시점까지 생성된 항목이 없습니다</div>'}</div>
        </div>
        <div id="detail">${S.item && S.item.id === S.itemId ? renderItem(S.item) : '<div class="panel empty">항목을 고르세요</div>'}</div>
      </div>`;
    if (S.itemId) await loadItem();
  }
  function inboxRow(i) {
    const decide = i.needs_decision && i.status === 'NEW';
    return `<button class="inbox-row ${i.id === S.itemId ? 'active' : ''} ${decide ? 'decide' : ''}" data-item="${esc(i.id)}">
      <div class="top"><span class="chips"><span class="pill k">${esc(KIND_LABEL[i.kind] || i.kind)}</span><span class="pill sev-${esc(i.severity)}">${esc(SEV_LABEL[i.severity] || i.severity || '')}</span></span><span class="when">${esc(fmtTs(i.created_at))}</span></div>
      <div class="title">${esc(i.title)}</div>
      ${i.summary ? `<div class="sum">${esc(i.summary)}</div>` : ''}
      <div class="meta"><span class="pill st-${esc(i.status)}">${esc(STATUS_LABEL[i.status] || i.status)}</span>${decide ? '<span class="pill sev-high">결정 필요</span>' : ''}${i.delta_usd != null && Math.abs(i.delta_usd) >= 0.5 ? `<span class="delta ${dCls(i.delta_usd)}">${fmtDelta(i.delta_usd)}</span>` : ''}</div>
    </button>`;
  }
  async function loadItem() {
    const id = S.itemId;
    const seq = ++S.itemSeq;
    const box = $('#detail');
    if (box && !(S.item && S.item.id === id)) box.innerHTML = '<div class="panel empty">불러오는 중…</div>';
    try {
      const it = await GET(`/api/item?id=${encodeURIComponent(id)}&t=${encodeURIComponent(S.t)}`);
      if (seq !== S.itemSeq || S.tab !== 'inbox') return;
      S.item = it;
      const d = $('#detail');
      if (d) d.innerHTML = renderItem(it);
    } catch (e) {
      const d = $('#detail');
      if (d && seq === S.itemSeq) d.innerHTML = `<div class="panel empty">항목을 불러오지 못했습니다: ${esc(e.message)}</div>`;
    }
  }

  function renderItem(it) {
    let body;
    try {
      switch (it.kind) {
        case 'BASELINE': body = renderBaseline(it); break;
        case 'IMPACT': case 'PLAN_APPLIED': body = renderImpact(it); break;
        case 'NOR': body = renderNor(it); break;
        case 'STATEMENT': body = renderStatementItem(it); break;
        case 'CLAIM': body = renderClaim(it); break;
        default: body = `<pre class="json">${esc(JSON.stringify(it, null, 2))}</pre>`;
      }
    } catch (e) {
      body = `<div class="issue error"><div class="t">표시 오류</div><div class="d">${esc(e.message)}</div></div><details><summary>원본 JSON</summary><pre class="json">${esc(JSON.stringify(it, null, 2))}</pre></details>`;
      console.error(e);
    }
    return `<div class="panel">${itemHead(it)}${body}${renderActions(it)}</div>`;
  }
  function itemHead(it) {
    const vessels = arr(it.call_ids).map(vesselName);
    return `<div class="detail-head">
      <div class="ttl">
        <div class="meta"><span class="pill k">${esc(KIND_LABEL[it.kind] || it.kind)}</span><span class="pill sev-${esc(it.severity)}">${esc(SEV_LABEL[it.severity] || it.severity || '')}</span><span class="pill st-${esc(it.status)}">${esc(STATUS_LABEL[it.status] || it.status)}</span><span class="mono small muted">${esc(fmtTs(it.created_at))} · ${esc(it.id)}</span></div>
        <h2>${esc(it.title)}</h2>
        ${it.summary ? `<p class="muted">${esc(it.summary)}</p>` : ''}
        ${arr(it.trigger).map((g) => `<div class="trig"><span class="pill k">${esc(TRIGGER_LABEL[g.kind] || g.kind)}</span> ${esc(g.label || '')}</div>`).join('')}
        ${vessels.length ? `<div class="chips">${vessels.map((v) => `<span class="pill status">${esc(v)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  }
  function renderActions(it) {
    const acts = arr(it.actions).filter((a) => a !== 'APPROVE_OPTION');
    const dec = it.decision;
    const note = dec ? `<div class="decision-note">결정: <b>${esc(ACTION_LABEL[dec.decision] || dec.decision)}</b>${dec.option_id ? ` · 옵션 ${esc(dec.option_id)}` : ''} · ${esc(dec.actor || '')} · 시나리오 ${esc(fmtTs(dec.at))}${dec.note ? ` · 메모: ${esc(dec.note)}` : ''}</div>` : '';
    if (!acts.length || it.status !== 'NEW') return note;
    return `${note}<div class="actions">${acts.map((a) => `<button class="btn ${a === 'REJECT' ? 'danger' : a === 'ACK' ? '' : 'primary'}" data-decide="${esc(a)}">${esc(ACTION_LABEL[a] || a)}</button>`).join('')}<span class="small muted">결정은 감사 로그에 남습니다. 발송·확정은 데모에서 기록만 합니다.</span></div>`;
  }

  // ---- BASELINE / IMPACT
  function renderBaseline(it) {
    const rows = arr(it.exposure);
    return `
      <div class="bignum"><span class="to pos">${fmtUSD(it.total_usd)}</span><span class="d muted">기준 계획 체선료 노출(예측)</span></div>
      <h3 style="margin-top:12px">항차별 노출</h3>
      <div class="table-scroll"><table><thead><tr><th>선박</th><th>선석</th><th class="num">체선</th><th class="num">노출</th><th>주요 사유</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r.vessel || vesselName(r.call_id))}</b><div class="small muted mono">${esc(r.call_id)}</div></td><td>${esc(r.berth_id)}</td><td class="num">${fmtH(r.demurrage_h)}</td><td class="num ${r.amount_usd > 0 ? 'pos' : ''}">${fmtUSD(r.amount_usd)}</td><td>${esc(r.top_reason || '—')}</td></tr>`).join('')}
      </tbody></table></div>
      ${it.recommendation ? `<div class="callout" style="margin-top:12px"><b>권고</b> ${esc(it.recommendation.text)} <span class="chips">${chips(it.recommendation.rules)}</span></div>` : ''}
      ${renderOptions(it.options, it)}
      ${renderDrafts(it.drafts, it)}`;
  }
  function renderImpact(it) {
    const ch = arr(it.changes);
    const told = new Set(arr(it.narrative));
    return `
      <div class="bignum"><span class="from">${fmtUSD(it.total_before)}</span><span class="arrow">→</span><span class="to">${fmtUSD(it.total_after)}</span><span class="d ${dCls(it.delta_usd)}">${fmtDelta(it.delta_usd)}</span><span class="small muted">체선료 노출(예측) 합계</span></div>
      ${ch.length ? `<h3 style="margin-top:12px">항차별 변화</h3>
      <div class="table-scroll"><table class="chg"><thead><tr><th>선박</th><th>선석</th><th>ETB 접안 (전 → 후)</th><th>하역 종료 (전 → 후)</th><th class="num">체선 (전 → 후)</th><th class="num">노출 Δ</th></tr></thead><tbody>
      ${ch.map((c) => `<tr><td><b>${esc(c.vessel || vesselName(c.call_id))}</b></td>
          <td>${c.berth_before && c.berth_after && (c.berth_before !== c.berth_after || c.seq_before !== c.seq_after) ? `<div class="muted">${esc(c.berth_before)} #${esc(c.seq_before)}</div><div><b>${esc(c.berth_after)} #${esc(c.seq_after)}</b></div>` : `${esc(c.berth_after || c.berth_before || '')}${c.seq_after != null ? ' #' + esc(c.seq_after) : ''}`}</td>
          <td class="mono"><div class="muted">${esc(fmtTs(c.etb_before))}</div><div><b>${esc(fmtTs(c.etb_after))}</b> ${c.etb_delta_min ? `<span class="${dCls(c.etb_delta_min)}">${fmtDeltaH(c.etb_delta_min / 60)}</span>` : ''}</div></td>
          <td class="mono"><div class="muted">${esc(fmtTs(c.etc_before))}</div><div>${esc(fmtTs(c.etc_after))}</div></td>
          <td class="num"><div class="muted">${fmtH(c.dem_before_h)}</div><div>${fmtH(c.dem_after_h)}</div>${c.margin_after_h != null && c.dem_after_h <= 0 ? `<div class="small muted">여유 ${fmtH(c.margin_after_h)}</div>` : ''}</td>
          <td class="num ${dCls(c.delta_usd)}"><b>${fmtDelta(c.delta_usd)}</b><div class="small muted">${fmtUSD(c.amount_before)} → ${fmtUSD(c.amount_after)}</div></td></tr>
          ${c.text && !told.has(c.text) ? `<tr class="sub"><td colspan="6">${esc(c.text)}</td></tr>` : ''}`).join('')}
      </tbody></table></div>` : ''}
      ${arr(it.narrative).length ? `<h3 style="margin-top:12px">왜 바뀌었나</h3><ul class="narrative">${it.narrative.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${arr(it.absorbed).filter((a) => !told.has(a.text)).length ? `<div class="decision-note" style="margin-top:10px"><b>영향이 흡수된 항차</b><ul class="narrative">${it.absorbed.filter((a) => !told.has(a.text)).map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul></div>` : ''}
      ${renderOptions(it.options, it)}
      ${renderDrafts(it.drafts, it)}`;
  }
  function renderOptions(op, it) {
    if (!op) return '';
    const best = arr(op.best);
    const canApprove = it && ['NEW', 'ACK'].includes(it.status) && arr(it.actions).includes('APPROVE_OPTION');
    const cards = best.map((o, i) => {
      const exp = o.expected_cost_usd != null ? o.expected_cost_usd : o.total_usd;
      const bd = o.baseline_delta_usd != null ? o.baseline_delta_usd : (o.saving_usd != null ? -o.saving_usd : null);
      const risk = o.risk && (o.risk.text || o.risk.worst_saving_usd != null || arr(o.risk.tested).length) ? o.risk : null;
      return `
      <div class="option ${i === 0 ? 'best' : ''}">
        <div><span class="pill ${i === 0 ? 'ok' : 'k'}">${i === 0 ? 'Candidate A · 최선' : `Candidate ${String.fromCharCode(65 + i)}`}</span> <b>${esc(o.title)}</b></div>
        <div class="cand-grid">
          <div class="cand-num"><span class="lbl">예상 체선료</span><span class="v">${fmtUSD(exp)}</span></div>
          <div class="cand-num"><span class="lbl">Baseline 대비</span><span class="v ${dCls(bd)}">${fmtDelta(bd)}</span></div>
        </div>
        ${o.reason ? `<div class="cand-row"><span class="lbl">주요 선정 이유</span><div>${esc(o.reason)}</div></div>` : ''}
        ${risk ? `<div class="cand-row risk"><span class="lbl">주요 Risk</span><div>${esc(risk.text || '')}${risk.worst_saving_usd != null ? ` <span class="small muted">(최악의 경우 절감 ${fmtUSD(risk.worst_saving_usd)})</span>` : ''}${arr(risk.tested).length ? `<div class="small muted">검토한 변동: ${esc(risk.tested.join(' · '))}</div>` : ''}</div></div>` : ''}
        ${arr(o.assumptions).length ? `<div class="cand-row"><span class="lbl">핵심 가정</span><ul>${o.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
        ${o.fallback ? `<div class="cand-row"><span class="lbl">대안</span><div><span class="mono small">${esc(o.fallback.id || '')}</span> ${esc(o.fallback.title || '')}</div></div>` : ''}
        ${arr(o.moves).length ? `<div><h3>선석·순서 변경</h3><ul>${o.moves.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
        ${arr(o.levers).length ? `<div><h3>운영 레버</h3><ul>${o.levers.map((l) => `<li>${esc(l.title)} <span class="small muted">(${esc(l.owner || '')}, ${esc(fmtTs(l.effective_from))}부터)</span></li>`).join('')}</ul></div>` : ''}
        ${arr(o.per_call).length ? `<table><thead><tr><th>선박</th><th class="num">전</th><th class="num">후</th><th class="num">Δ</th></tr></thead><tbody>${o.per_call.map((p) => `<tr><td>${esc(p.vessel || vesselName(p.call_id))}</td><td class="num">${fmtUSD(p.before)}</td><td class="num">${fmtUSD(p.after)}</td><td class="num ${dCls(p.delta)}">${fmtDelta(p.delta)}</td></tr>`).join('')}</tbody></table>` : ''}
        ${arr(o.rules_checked).length ? `<div class="chips"><span class="small muted">확인한 룰</span>${chips(o.rules_checked)}</div>` : ''}
        ${arr(o.coordination).map((c) => `<div class="coord">협의 필요 · ${esc(c)}</div>`).join('')}
        <div class="foot"><span class="small muted mono">${esc(o.id)}</span>
          ${canApprove ? `<button class="btn primary small" data-option="${esc(o.id)}" data-option-title="${esc(o.title)}" ${o.approvable === false ? `disabled title="${esc(o.blocked_reason || '지금 시점에는 적용할 수 없음')}"` : ''}>이 옵션 적용 요청</button>` : ''}
        </div>
        ${o.approvable === false && o.blocked_reason ? `<div class="small pos">적용 불가: ${esc(o.blocked_reason)}</div>` : ''}
      </div>`;
    }).join('');
    return `
      <div style="margin-top:14px">
        <div class="panel-head" style="margin-bottom:6px"><h4>후보 비교 — 체선료 관점</h4><span class="hint">검토 ${num(op.evaluated)}개 · 기준 ${fmtUSD(op.baseline_usd)} · 제안 기준 절감 ≥ ${fmtUSD(op.threshold_usd)} · 최종 확정은 담당자</span></div>
        ${best.length ? `<div class="options">${cards}</div>` : '<div class="decision-note">제안 기준 이상 절감되는 변경안이 없습니다.</div>'}
        ${arr(op.singles).length ? `<details><summary>단일 변경 결과 ${op.singles.length}개</summary><div class="table-scroll"><table><thead><tr><th>변경</th><th class="num">계획 후 노출</th><th class="num">기준 대비</th></tr></thead><tbody>${op.singles.map((s) => `<tr><td>${esc(s.title)}</td><td class="num">${fmtUSD(s.total_usd)}</td><td class="num ${dCls(s.delta_usd)}">${fmtDelta(s.delta_usd)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        ${arr(op.excluded).length ? `<details><summary>제원·규칙으로 제외 ${op.excluded.length}건</summary><ul class="narrative">${op.excluded.map((x) => `<li><b>${esc(x.vessel || vesselName(x.call_id))}</b> → ${esc(x.berth_id)}: ${esc(x.msg)} ${chips(x.rules)}</li>`).join('')}</ul></details>` : ''}
        ${op.note ? `<p class="small muted" style="margin-top:6px">${esc(op.note)}</p>` : ''}
      </div>`;
  }
  function renderDrafts(drafts, it) {
    const list = arr(drafts).filter(Boolean);
    if (!list.length) return '';
    const editable = it && it.status === 'NEW' && arr(it.actions).some((a) => a === 'SEND' || a === 'APPROVE');
    let editUsed = false;
    return `<h3 style="margin-top:14px">초안 ${list.length}건</h3>` + list.map((d, i) => {
      if (d.kind === 'seagate_entry') return renderSeagateEntry(d);
      const canEdit = editable && !editUsed && d.kind !== 'memo' && it.kind !== 'STATEMENT';
      if (canEdit) editUsed = true;
      return `<details class="draft ${d.kind === 'memo' ? 'memo' : ''}" ${i === 0 ? 'open' : ''}>
        <summary>${esc(d.subject || '(제목 없음)')} <span class="pill lang">${esc(d.lang || '')}</span>${canEdit ? '<span class="pill sev-medium">편집 가능</span>' : ''}</summary>
        <div class="body">
          <div class="hdr"><span>받는 곳</span><span>${esc(arr(d.to).join(', ') || '—')}</span>${arr(d.cc).length ? `<span>참조</span><span>${esc(d.cc.join(', '))}</span>` : ''}<span>종류</span><span>${esc(d.kind || 'email')}</span></div>
          ${canEdit ? `<textarea data-draft-edit rows="${Math.min(22, (d.body || '').split('\n').length + 2)}">${esc(d.body || '')}</textarea>` : `<pre>${esc(d.body || '')}</pre>`}
          <div class="foot">템플릿 초안 — LLM 교체 지점 (${esc(d.generated_by || 'template')}). 숫자는 엔진 계산값을 그대로 넣는다.</div>
        </div></details>`;
    }).join('');
  }
  function renderSeagateEntry(e) {
    if (!e) return '';
    return `<div class="draft" style="padding:10px 12px"><div class="small muted" style="margin-bottom:6px">${esc(e.target || 'SEAGATE 입력안')} · ${esc(e.call_id || '')} · ${esc(e.generated_by || '')}</div>
      <table><thead><tr><th>코드</th><th>사유</th><th class="num">시간</th><th class="num">체선료 기여</th></tr></thead><tbody>
      ${arr(e.rows).map((r) => `<tr><td class="mono">${esc(r.code)}</td><td>${esc(r.label)}</td><td class="num">${fmtH(r.hours)}</td><td class="num">${fmtUSD(r.marginal_usd)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // ---- NOR
  function renderNor(it) {
    const lp = it.laytime_projection || {};
    return `
      <dl class="kv"><dt>선박</dt><dd><b>${esc(it.vessel || vesselName(it.call_id))}</b> <span class="mono small muted">${esc(it.call_id || '')}</span></dd>
        <dt>NOR 시각</dt><dd class="mono">${esc(fmtTs(it.nor_at))}${it.retender ? ' <span class="pill k">재제출</span>' : ''}</dd>
        <dt>레이타임 개시(예측)</dt><dd><span class="mono">${esc(fmtTs(lp.start))}</span> ${esc(START_BASIS[lp.basis] || lp.basis || '')} ${chips(lp.rules)}</dd></dl>
      <h3 style="margin-top:12px">점검</h3>
      <ul class="checks">${arr(it.checks).map((c) => `<li><span class="mark ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na'}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'}</span><div><b>${esc(c.name)}</b><div class="small muted">${esc(c.detail || '')}</div><div class="chips">${chips(c.rules)}</div></div></li>`).join('')}</ul>
      ${it.impact ? `<div class="decision-note" style="margin-top:10px"><b>영향</b> ${esc(it.impact.text || '')}${it.impact.delta_usd != null ? ` <span class="delta ${dCls(it.impact.delta_usd)}">${fmtDelta(it.impact.delta_usd)}</span>` : ''}</div>` : ''}
      ${it.recommendation ? `<div class="callout" style="margin-top:10px"><b>권고</b> ${esc(it.recommendation.text || '')}</div>` : ''}
      ${renderDrafts(it.drafts, it)}`;
  }

  // ---- STATEMENT
  function renderStatementItem(it) {
    const rc = it.reconcile || {};
    return `
      ${renderStatementView(it.statement)}
      ${arr(rc.rows).length || rc.amount_sof != null ? `<h3 style="margin-top:16px">SOF ↔ 터미널 기록 대조</h3>
        <p class="small muted">대리점 SOF 그대로 계산하면 ${fmtUSD(rc.amount_sof)}, 터미널·AIS 기록 기준 ${fmtUSD(rc.amount_terminal)} (차이 <span class="${dCls(rc.delta_usd)}">${fmtDelta(rc.delta_usd)}</span>)</p>
        ${arr(rc.rows).length ? `<div class="table-scroll"><table><thead><tr><th>이벤트</th><th>SOF(대리점)</th><th>터미널·AIS</th><th class="num">차이</th><th>적용</th><th>메모</th></tr></thead><tbody>
        ${rc.rows.map((r) => `<tr><td>${esc(r.label || EVENT_LABEL[r.type] || r.type)}</td><td class="mono">${esc(fmtTs(r.sof_ts))}</td><td class="mono">${esc(fmtTs(r.terminal_ts))}</td><td class="num ${r.delta_min ? 'pos' : ''}">${r.delta_min != null ? fmtDeltaH(r.delta_min / 60) : '—'}</td><td>${esc(r.use || '')}</td><td class="small">${esc(r.note || '')}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="small muted">불일치 없음</p>'}` : ''}
      ${renderReasons(it.reasons, it.reasons_note)}
      ${it.seagate_entry ? `<h3 style="margin-top:14px">SEAGATE 체선사유 입력안</h3>${renderSeagateEntry(it.seagate_entry)}` : ''}
      ${renderDrafts(it.drafts, it)}`;
  }
  function renderReasons(reasons, note) {
    const rs = arr(reasons);
    if (!rs.length) return '';
    const foot = note || '코드표는 가상(SEAGATE 체선사유 코드표 수령 후 교체). "그 사유가 없었다면" = 해당 시간을 빼고 다시 계산한 체선료 감소분.';
    return `<h3 style="margin-top:16px">체선사유 분류</h3>
      <div class="table-scroll"><table><thead><tr><th>코드</th><th>사유</th><th class="num">시간</th><th class="num">레이타임 중</th><th class="num">체선 중</th><th class="num">제외</th><th class="num">그 사유가 없었다면</th></tr></thead><tbody>
      ${rs.map((r) => `<tr><td class="mono">${esc(r.code)}</td><td>${reasonDot(r.key || r.reason)}${esc(r.label || reasonLabel(reasonCode(r.key || r.reason)))}${NEW_REASON_SET.has(reasonCode(r.key || r.reason)) ? ` <span class="pill k" title="${esc(REASON_GROUP[REASON_META[reasonCode(r.key || r.reason)][1]])} — v3 자원 제약">${esc(REASON_GROUP[REASON_META[reasonCode(r.key || r.reason)][1]])}</span>` : ''}${r.estimated ? ' <span class="pill sev-medium">추정</span>' : ''}${r.detail ? `<div class="small muted">${esc(r.detail)}</div>` : ''}</td><td class="num">${fmtH(r.hours)}</td><td class="num">${fmtH(r.laytime_h)}</td><td class="num">${fmtH(r.demurrage_h)}</td><td class="num">${fmtH(r.excluded_h)}</td><td class="num ${r.marginal_usd > 0 ? 'neg' : ''}">${r.marginal_usd > 0 ? '−' + fmtUSD(r.marginal_usd) : '$0'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted">${esc(foot)}</p>`;
  }

  function renderStatementView(st, opts = {}) {
    if (!st) return '<div class="empty">계산서 없음</div>';
    const issues = renderIssues(st);
    if (st.status && st.status !== 'OK') {
      return `<div class="issue error"><div class="t">계산할 수 없음</div><div class="d">누락: ${esc(arr(st.missing).join(', ') || '—')}</div></div>${issues}`;
    }
    const alts = arr(st.alternatives);
    return `
      <div class="bignum" style="margin-bottom:6px"><span class="to ${st.amount_usd > 0 ? 'pos' : ''}">${fmtUSD(st.amount_usd)}</span>
        <span class="d muted" style="font-weight:400">체선 ${fmtH(st.demurrage_h)}${st.half_h > 0 ? ` (반액 ${fmtH(st.half_h)})` : ''} · 사용 ${fmtH(st.used_h)} / 허용 ${fmtH(st.allowed_h)}${st.demurrage_h <= 0 && st.margin_h != null ? ` · 여유 ${fmtH(st.margin_h)}` : ''}</span></div>
      ${segLane(st)}
      <h3 style="margin-top:10px">계산서</h3>
      <div class="table-scroll"><table class="stmt-table"><tbody>
        ${arr(st.rows).map((r, i, a) => `<tr class="${i === a.length - 1 ? 'total' : ''}"><td>${esc(r.label)}</td><td>${esc(r.value)}</td><td><span class="chips">${chips(r.rules)}${arr(r.refs).length ? `<span class="small muted mono">SOF#${r.refs.map(esc).join(',')}</span>` : ''}</span></td></tr>`).join('')}
      </tbody></table></div>
      <div class="grid2" style="margin-top:8px">
        <div>
          ${arr(st.story).length ? `<h3>설명</h3><ul class="story">${st.story.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${issues}
        </div>
        <div>
          ${alts.length ? `<h3>대안 계산 (쟁점별)</h3><table><thead><tr><th>입장</th><th class="num">금액</th><th class="num">기본 대비</th></tr></thead><tbody>
            <tr class="hl"><td>기본 계산</td><td class="num">${fmtUSD(st.amount_usd)}</td><td class="num">—</td></tr>
            ${alts.map((a) => `<tr><td>${esc(a.title)}<div class="small muted mono">${esc(a.code)}</div></td><td class="num">${fmtUSD(a.amount_usd)}</td><td class="num ${dCls(a.delta_usd)}">${fmtDelta(a.delta_usd)}</td></tr>`).join('')}
          </tbody></table>` : '<p class="small muted">쟁점 대안 계산 없음</p>'}
          ${arr(st.deductions).length ? `<h3 style="margin-top:10px">공제 구간</h3><table><tbody>${st.deductions.map((d) => `<tr><td>${esc(d.label || d.kind)}</td><td class="num">${fmtH(d.hours)}</td><td>${chip(d.rule)}</td></tr>`).join('')}</tbody></table>` : ''}
        </div>
      </div>
      ${opts.noEvents ? '' : `<details style="margin-top:8px"><summary>입력 이벤트 ${arr(st.events).length}건</summary><div class="table-scroll"><table><thead><tr><th>#</th><th>시각</th><th>이벤트</th><th>출처</th><th>사유·원문</th></tr></thead><tbody>
        ${arr(st.events).map((e) => `<tr class="${e.projected ? 'sub' : ''}"><td class="mono">${esc(e.row)}</td><td class="mono">${esc(fmtTs(e.ts))}${e.projected ? ' <span class="pill k">예측</span>' : ''}</td><td>${esc(EVENT_LABEL[e.type] || e.type)}</td><td>${esc(e.source || '')}</td><td class="small">${esc(e.reason || '')} ${esc(e.text || '')}</td></tr>`).join('')}
      </tbody></table></div></details>`}`;
  }
  function renderIssues(st) {
    const list = arr(st.issues);
    if (!list.length) return '<p class="small muted" style="margin-top:6px">쟁점·경고 없음</p>';
    return `<h3 style="margin-top:10px">쟁점·경고 ${list.length}건</h3>` + list.map((i) => `
      <div class="issue ${esc(i.severity)}"><div class="t"><span class="pill sev-${esc(i.severity)}">${esc(SEV_LABEL[i.severity] || i.severity)}</span>${esc(i.title)}</div>
      ${i.detail ? `<div class="d">${esc(i.detail)}</div>` : ''}
      <div class="chips" style="margin-top:3px">${chips(i.rules)}${i.alt ? `<span class="small muted">대안: ${esc(i.alt.title)}</span>` : ''}</div></div>`).join('');
  }
  function segLane(st) {
    const segs = arr(st.segments);
    const evs = arr(st.events);
    const norE = evs.find((e) => e.type === 'NOR_RETENDERED') || evs.find((e) => e.type === 'NOR_RECEIVED') || evs.find((e) => e.type === 'NOR_TENDERED');
    const start = parseTs(st.laytime_start);
    const end = parseTs(st.laytime_end);
    if (start == null || end == null || end <= start) return '';
    const norMs = norE ? parseTs(norE.ts) : null;
    const notice = norMs != null && norMs < start && start - norMs <= 6.02 * 3600e3 ? [norMs, start] : null;
    const a = notice ? notice[0] : start;
    const b = end;
    const W = 760, L = 8, R = 8, H = 64, y = 18, h = 16;
    const X = (ms) => L + ((ms - a) / (b - a)) * (W - L - R);
    const tickStep = (b - a) / 3600e3 > 60 ? 12 : (b - a) / 3600e3 > 24 ? 6 : 3;
    const ticks = [];
    const first = Math.ceil(a / (tickStep * 3600e3)) * tickStep * 3600e3;
    for (let t = first; t <= b; t += tickStep * 3600e3) ticks.push(t);
    const parts = [];
    if (notice) parts.push(`<rect class="s-NOTICE" x="${X(notice[0])}" y="${y}" width="${Math.max(1, X(notice[1]) - X(notice[0]))}" height="${h}"><title>통지시간 ${fmtTs(notice[0])}–${fmtTs(notice[1])}</title></rect>`);
    for (const s of segs) {
      const s0 = parseTs(s.from), s1 = parseTs(s.to);
      if (s0 == null || s1 == null) continue;
      const proj = parseTs(S.t) != null && s0 >= parseTs(S.t) && opts_isLive(st);
      parts.push(`<rect class="s-${esc(s.effect)} ${proj ? 'proj' : ''}" x="${X(s0)}" y="${y}" width="${Math.max(0.8, X(s1) - X(s0))}" height="${h}"><title>${esc(s.label)} · ${esc(EFFECT_LABEL[s.effect] || s.effect)} · ${fmtH(s.hours)}\n${fmtTs(s.from)}–${fmtTs(s.to)}\n${esc(s.rule || '')}</title></rect>`);
    }
    const dem = parseTs(st.demurrage_start);
    const marks = [];
    marks.push(`<path class="nor" d="M${X(start)} ${y - 2} l-4 -6 h8 z"><title>레이타임 개시 ${fmtTs(start)}</title></path>`);
    if (dem != null) marks.push(`<path class="expiry" d="M${X(dem)} ${y + h / 2 - 7} l6 7 l-6 7 l-6 -7 z"><title>레이타임 소진·체선 개시 ${fmtTs(dem)}</title></path>`);
    const axis = ticks.map((t) => {
      const d = new Date(t);
      const lbl = d.getUTCHours() === 0 ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : pad(d.getUTCHours());
      const anchor = X(t) > W - 24 ? 'end' : X(t) < 24 ? 'start' : 'middle';
      return `<line x1="${X(t)}" x2="${X(t)}" y1="${y + h + 2}" y2="${y + h + 6}"/><text x="${X(t)}" y="${y + h + 17}" text-anchor="${anchor}">${lbl}</text>`;
    }).join('');
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="min-width:560px;width:100%;height:auto" role="img" aria-label="레이타임 구간">
      ${svgDefs()}
      <text x="${L}" y="11" class="vsub" style="font-size:10.5px;fill:var(--muted)">${esc(fmtTs(a))}</text>
      <text x="${W - R}" y="11" text-anchor="end" style="font-size:10.5px;fill:var(--muted)">${esc(fmtTs(b))}</text>
      ${parts.join('')}${marks.join('')}<g class="lane-axis">${axis}</g></svg></div>
      <div class="legend"><span><i class="notice"></i>통지시간</span><span><i class="lay"></i>레이타임 산입</span><span><i class="excl"></i>제외(공제)</span><span><i class="dem"></i>체선 전액</span><span><i class="half"></i>체선 반액</span><span>▼ 개시 · ◆ 체선 돌입</span></div>`;
  }
  function opts_isLive(st) { return !!arr(st.events).some((e) => e.projected); }
  function svgDefs() {
    return `<defs>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface-2)"/><rect width="2.2" height="6" fill="var(--excl)"/></pattern>
      <pattern id="hatchwarm" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface-2)"/><rect width="2.6" height="6" fill="var(--dem-half)"/></pattern>
      <pattern id="hatchoos" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="7" height="7" fill="transparent"/><rect width="1.6" height="7" fill="var(--line-strong)"/></pattern>
    </defs>`;
  }

  // ---- CLAIM
  function renderClaim(it) {
    const rv = it.review || {};
    const c = rv.claim || {};
    const tb = rv.time_bar || {};
    const docs = rv.documents || {};
    const rec = rv.recommendation || {};
    const rg = rv.range || {};
    const received = new Set(arr(docs.received));
    return `
      <div class="bignum"><span class="from">청구 ${fmtUSD(rv.claimed ? rv.claimed.amount_usd : c.owner_calc && c.owner_calc.amount_usd)}</span><span class="arrow">→</span><span class="to">${fmtUSD(rv.computed && rv.computed.amount_usd)}</span><span class="d ${dCls(-(rv.variance_usd || 0))}">차이 ${fmtUSD(rv.variance_usd)}</span><span class="small muted">재계산(우리)</span></div>
      <dl class="kv" style="margin-top:8px"><dt>선박·항차</dt><dd><b>${esc(rv.vessel && rv.vessel.name)}</b> ${esc(rv.vessel && rv.vessel.type || '')} · <span class="mono">${esc(c.call_id || (rv.call && rv.call.call_id) || '')}</span> · ${esc(rv.call && rv.call.berth_id || '')}</dd>
        <dt>청구인</dt><dd>${esc(c.claimant || '')} · 접수 ${esc(fmtTs(c.received_at))}</dd>
        <dt>계약</dt><dd>${esc(rv.contract && rv.contract.form || '')} · ${esc(LAYER_LABEL[rv.contract && rv.contract.layer] || (rv.contract && rv.contract.layer) || '')} · 허용 ${esc(rv.contract && rv.contract.laytime_hours)}h · USD ${num(rv.contract && rv.contract.rate_usd_day)}/일</dd>
        ${c.cover_note ? `<dt>청구 메모</dt><dd class="small">${esc(c.cover_note)}</dd>` : ''}</dl>
      <div class="grid2" style="margin-top:12px">
        <div><h3>검토 파이프라인</h3><ol class="stepper">${arr(rv.steps).map((s) => `<li><span class="dot ${esc(s.status)}">${STEP_MARK[s.status] || '·'}</span><div class="nm">${esc(s.name)}</div><div class="sm">${esc(s.summary || '')}</div><div class="chips">${chips(s.rules)}</div></li>`).join('')}</ol></div>
        <div>
          <h3>시효</h3>
          <div class="decision-note" style="margin-top:0">${tb.ok === false ? '<span class="pill bad">시효 경과</span>' : tb.ok === true ? '<span class="pill ok">기한 내</span>' : ''}
            기준 ${esc(fmtDate(tb.base))} + ${esc(tb.days)}일 = 기한 <b class="mono">${esc(fmtDate(tb.deadline))}</b> · 접수 <span class="mono">${esc(fmtDate(tb.received_at))}</span>${tb.days_used != null ? ` (D+${esc(tb.days_used)})` : ''} ${chip(tb.rule)}</div>
          <h3 style="margin-top:10px">필수 서류</h3>
          <div class="docs">${arr(docs.required).map((d) => `<span class="pill ${received.has(d) && !arr(docs.missing).includes(d) ? 'ok' : 'bad'}">${received.has(d) && !arr(docs.missing).includes(d) ? '✓' : '✗'} ${esc(DOC_LABEL[d] || d)}</span>`).join('')}</div>
          ${arr(docs.missing_labels).length ? `<p class="small pos" style="margin-top:4px">누락: ${esc(docs.missing_labels.join(', '))}</p>` : ''}
          ${arr(docs.notes).length ? `<ul class="narrative small">${docs.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          ${docs.rule ? `<div class="chips" style="margin-top:4px">${chip(docs.rule)}</div>` : ''}
          <h3 style="margin-top:10px">권고</h3>
          <div class="callout"><b>${esc(rec.label || rec.code || '')}</b>${rec.amount_usd != null ? ` · <span class="mono">${fmtUSD(rec.amount_usd)}</span>` : ''}<div class="small" style="margin-top:3px">${esc(rec.text || '')}</div></div>
        </div>
      </div>
      <h3 style="margin-top:14px">청구액 → 재계산액 차이 분해</h3>
      ${renderWaterfall(rv)}
      ${arr(rv.disputes).length ? `<h3 style="margin-top:12px">쟁점 (자동 판정하지 않음)</h3>
        <table><thead><tr><th>쟁점</th><th class="num">대안 금액</th><th class="num">재계산 대비</th></tr></thead><tbody>${rv.disputes.map((d) => `<tr><td>${esc(d.title)}<div class="small muted mono">${esc(d.code)}</div></td><td class="num">${fmtUSD(d.alt_amount_usd)}</td><td class="num ${dCls(d.delta_usd)}">${fmtDelta(d.delta_usd)}</td></tr>`).join('')}</tbody></table>
        ${rg.min_usd != null ? `<p class="small muted" style="margin-top:4px">협상 범위: <span class="mono">${fmtUSD(rg.min_usd)} ~ ${fmtUSD(rg.max_usd)}</span></p>` : ''}` : ''}
      <details style="margin-top:12px"><summary>재계산 레이타임 계산서</summary>${renderStatementView(rv.statement)}</details>
      ${rv.sof_text ? `<details><summary>첨부 SOF 원문</summary><pre class="json">${esc(rv.sof_text)}</pre></details>` : ''}
      ${renderDrafts(rv.drafts, it)}`;
  }
  function renderWaterfall(rv) {
    const claimed = Number(rv.claimed ? rv.claimed.amount_usd : (rv.claim && rv.claim.owner_calc ? rv.claim.owner_calc.amount_usd : 0)) || 0;
    const computed = Number(rv.computed ? rv.computed.amount_usd : 0) || 0;
    const steps = arr(rv.waterfall).map((w) => ({ label: w.title, rule: w.rule, delta: Number(w.delta_usd) || 0, evidence: w.evidence, code: w.code }));
    if (Math.abs(rv.residual_usd || 0) >= 0.01) steps.push({ label: '산술 차이(설명되지 않은 잔여)', rule: null, delta: Number(rv.residual_usd), residual: true });
    const rows = [{ label: '선주·상대방 청구', value: claimed, kind: 'claim' }];
    let run = claimed;
    for (const s of steps) { rows.push({ ...s, from: run, to: run - s.delta, kind: s.residual ? 'res' : 'step' }); run -= s.delta; }
    rows.push({ label: '재계산(우리)', value: computed, kind: 'ours' });
    const max = Math.max(claimed, computed, ...rows.map((r) => Math.max(r.from || 0, r.to || 0, r.value || 0)), 1);
    const W = 760, LW = 250, VW = 110, rowH = 26, H = rows.length * rowH + 8;
    const X = (v) => LW + (Math.max(0, v) / max) * (W - LW - VW);
    const g = rows.map((r, i) => {
      const y = 4 + i * rowH;
      let bar;
      let val;
      if (r.kind === 'claim' || r.kind === 'ours') {
        bar = `<rect class="${r.kind === 'claim' ? 'wf-claim' : 'wf-ours'}" x="${LW}" y="${y + 4}" width="${Math.max(1, X(r.value) - LW)}" height="${rowH - 10}" rx="2"/>`;
        val = fmtUSD(r.value);
      } else {
        const x0 = X(Math.min(r.from, r.to)), x1 = X(Math.max(r.from, r.to));
        bar = `<rect class="${r.kind === 'res' ? 'wf-res' : r.delta >= 0 ? 'wf-step' : 'wf-res'}" x="${x0}" y="${y + 4}" width="${Math.max(1.5, x1 - x0)}" height="${rowH - 10}" rx="2"><title>${esc(r.label)}${r.evidence ? '\n' + esc(r.evidence) : ''}</title></rect>`;
        val = (r.delta >= 0 ? '−' : '+') + fmtUSD(Math.abs(r.delta));
      }
      const conn = i < rows.length - 1 ? `<line class="wf-conn" x1="${X(r.kind === 'claim' || r.kind === 'ours' ? r.value : r.to)}" x2="${X(r.kind === 'claim' || r.kind === 'ours' ? r.value : r.to)}" y1="${y + rowH - 6}" y2="${y + rowH + 4}"/>` : '';
      return `<text class="wf-label" x="0" y="${y + rowH / 2 + 4}">${esc(r.label.length > 34 ? r.label.slice(0, 33) + '…' : r.label)}</text>${bar}${conn}<text class="wf-val" x="${W}" y="${y + rowH / 2 + 4}" text-anchor="end">${val}</text>`;
    }).join('');
    const table = steps.length ? `<div class="table-scroll" style="margin-top:6px"><table><thead><tr><th>차이 사유</th><th>근거 룰</th><th class="num">금액</th><th>증빙</th></tr></thead><tbody>
      ${steps.map((s) => `<tr><td>${esc(s.label)}<div class="small muted mono">${esc(s.code || '')}</div></td><td>${chip(s.rule)}</td><td class="num">${fmtUSD(s.delta)}</td><td class="small">${esc(s.evidence || '')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="small muted">청구액과 재계산액의 차이가 없습니다.</p>';
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="min-width:600px;width:100%;height:auto" role="img" aria-label="청구액 차이 분해">${g}</svg></div>${table}`;
  }

  // ================================================================ 타임라인
  async function renderTimeline() {
    const st = S.state;
    if (!st) return;
    const k = st.kpi || {};
    const nd = k.next_demurrage;
    main.innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="label">체선료 노출(예측)</span><span class="value dem">${fmtUSD(k.exposure_usd)}</span><span class="sub">현재 계획·예보 기준 전 항차 합계</span></div>
        <div class="kpi"><span class="label">현재까지 발생</span><span class="value">${fmtUSD(k.accrued_usd)}</span><span class="sub">${esc(fmtTs(st.t))}까지 누적</span></div>
        <div class="kpi"><span class="label">체선 중</span><span class="value">${arr(k.on_demurrage).length}척</span><span class="sub">${esc(arr(k.on_demurrage).map(vesselName).join(', ') || '—')}</span></div>
        <div class="kpi"><span class="label">묘박 대기</span><span class="value">${arr(k.waiting).length}척</span><span class="sub">${esc(arr(k.waiting).map(vesselName).join(', ') || '—')}</span></div>
        <div class="kpi"><span class="label">다음 체선 돌입</span><span class="value wrap">${nd ? esc(nd.vessel || vesselName(nd.call_id)) : '—'}</span><span class="sub">${nd ? esc(fmtTs(nd.at)) : '예정 없음'}</span></div>
        <div class="kpi trend"><span class="label">노출 추이 (정보가 들어올 때마다 재계산)</span>${sparkline(st.trend)}</div>
      </div>
      <div class="panel tl">
        <div class="panel-head"><h4>선석별 항차 — 물리 상태(위)와 레이타임 시계(아래)</h4><span class="hint">${esc(st.wind && st.wind.forecast_summary ? '예보: ' + st.wind.forecast_summary : '')}</span></div>
        <div class="legend" style="margin-bottom:8px">
          <span><i class="wait"></i>묘박 대기</span><span><i class="excl"></i>이동·제외</span><span><i class="ops"></i>하역</span><span><i class="stop"></i>하역 중단</span>
          <span><i class="notice"></i>통지시간</span><span><i class="lay"></i>레이타임</span><span><i class="dem"></i>체선 전액</span><span><i class="half"></i>체선 반액</span>
          <span><i class="night"></i>야간(${esc(S.meta.daytime ? S.meta.daytime.end + '–' + S.meta.daytime.start : '')})</span><span><i class="oos"></i>정비·사용불가</span><span><i class="proj"></i>예측(지금 이후)</span><span>▼ NOR · ◆ 체선 돌입</span>
          ${uniq(arr(st.calls).flatMap((c) => arr(c.segments).map((s) => s.reason))).filter((r) => NEW_REASON_SET.has(r)).map((r) => `<span><i class="rz rz-${esc(r)}"></i>${esc(reasonLabel(r))}</span>`).join('')}
          ${S.tide && S.tide.data && S.tide.data.tide ? `<span title="${esc(S.tide.data.tide.source || '')}"><i class="tide-l"></i>조위 — 띠를 누르면 자원·제약</span>` : ''}
        </div>
        <div class="scroll">${timelineSvg(st)}</div>
      </div>
      <div class="tl-foot">
        <div class="panel"><div class="panel-head"><h4>에이전트 알림</h4><span class="hint">${arr(st.alerts).length}건 · 최신순</span></div>
          <ul class="alerts">${arr(st.alerts).map((a) => `<li><span class="at">${esc(fmtTs(a.at))}</span><span class="lv ${esc(a.level)}">${a.level === 'critical' ? '!!' : a.level === 'warning' ? '!' : '·'}</span><span>${esc(a.text)} <span class="chips">${chips(a.rules)}</span></span></li>`).join('') || '<li class="muted">알림 없음</li>'}</ul></div>
        <div>${renderOutcome(st)}${renderPlanHistory(st)}</div>
      </div>`;
    if (S.drawerCall) openDrawer(S.drawerCall, true);
    if (!S.tide && !S.tideLoading) loadTideOnce();
  }
  // 타임라인 풍속 아래 얇은 조위 띠 — /api/resources(BASE)가 있을 때만. 조위는 시각 t와 무관해 한 번만 받는다
  async function loadTideOnce() {
    S.tideLoading = true;
    try { S.tide = { data: await GET(`/api/resources?scenario=BASE&t=${encodeURIComponent(S.t)}`), error: null }; } catch (e) { S.tide = { data: null, error: e.message }; }
    S.tideLoading = false;
    const ok = S.tide.data && S.tide.data.tide && seriesPts(S.tide.data.tide.start, S.tide.data.tide.step_min, S.tide.data.tide.values_m).length > 1;
    if (ok && S.tab === 'timeline' && S.state) renderTimeline();
  }
  function tideStripSvg(res, pts, X, y, h, L, plotW) {
    const td = res.tide || {};
    const needs = arr(res.calls).map((c) => Number(c.tide_needed_m)).filter((v) => v > 0);
    const need = needs.length ? Math.max(...needs) : null;
    const vmax = Math.max(0.5, ...pts.map((p) => p.v), need || 0) * 1.1;
    const vmin = Math.min(0, ...pts.map((p) => p.v));
    const Y = (v) => y + h - ((v - vmin) / (vmax - vmin || 1)) * (h - 2);
    const ln = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
    const area = `${ln} L${X(pts[pts.length - 1].t).toFixed(1)} ${y + h} L${X(pts[0].t).toFixed(1)} ${y + h} Z`;
    return `<g class="tide-g" data-tide-link role="link" tabindex="0" aria-label="조위 — 자원·제약 탭(기준 시나리오)으로"><title>조위 ${esc(td.source || '')}${need != null ? ` · 가장 높은 필요 조위 ${need.toFixed(1)}m` : ''} — 누르면 자원·제약 탭</title>
      <rect x="${L}" y="${y}" width="${plotW}" height="${h}" fill="transparent"/>
      <text class="vname" x="8" y="${y + 11}">조위 m</text><text class="vsub" x="8" y="${y + 23}">${esc(trunc(td.datum || '조석예보', 22))}</text>
      <path class="tide-area" d="${area}"/><path class="tide-line" d="${ln}"/>
      ${need != null ? `<line class="tide-need" x1="${L}" x2="${L + plotW}" y1="${Y(need)}" y2="${Y(need)}"/><text x="${L + plotW + 4}" y="${Y(need) + 3}" style="font-size:9.5px;fill:var(--muted)">필요 ${need.toFixed(1)}m</text>` : ''}</g>`;
  }
  function renderOutcome(st) {
    const o = st.outcome;
    if (!o) return '';
    const approved = arr(o.approved);
    return `<div class="panel"><div class="panel-head"><h4>결과 — 승인한 제안의 효과</h4><span class="hint">${o.final ? '시나리오 종료 · 확정' : '진행 중 (끝까지 재생하면 확정)'}</span></div>
      ${o.final ? `<div class="bignum"><span class="from">기준 계획 그대로 ${fmtUSD(o.baseline_usd)}</span><span class="arrow">→</span><span class="to">${fmtUSD(o.actual_usd)}</span><span class="d ${o.saving_usd > 0 ? 'neg' : 'muted'}">${o.saving_usd > 0 ? '절감 ' + fmtUSD(o.saving_usd) : '변화 없음'}</span></div>` : `<p class="small muted">모든 항차가 하역을 마치면 실제 체선료와 기준 계획 대비 절감액이 확정됩니다.</p>`}
      ${approved.length ? `<ul class="narrative">${approved.map((a) => `<li>${a.version != null ? `<span class="pill k">v${esc(a.version)}</span> ` : ''}${esc(a.option_title || a.label || '')}${a.effective_from ? ` <span class="small muted">${esc(fmtTs(a.effective_from))}부터</span>` : ''} <span class="mono small muted">${esc(a.item_id || '')}</span></li>`).join('')}</ul>` : '<p class="small muted" style="margin-top:4px">승인한 변경안 없음</p>'}
      <p class="small muted" style="margin-top:6px">가상 시나리오의 계산값이다. 실제 효과로 발표하지 않는다.</p></div>`;
  }
  function renderPlanHistory(st) {
    const ph = arr(st.plan_history);
    if (!ph.length) return '';
    return `<div class="panel"><div class="panel-head"><h4>계획 버전</h4></div><table><tbody>${ph.map((p) => `<tr class="${st.plan && p.version === st.plan.version ? 'hl' : ''}"><td class="mono">v${esc(p.version)}</td><td class="mono">${esc(fmtTs(p.effective_from))}</td><td>${esc(p.label || '')}<div class="small muted">${esc(p.source || '')}</div></td></tr>`).join('')}</tbody></table></div>`;
  }
  function sparkline(trend) {
    const pts = arr(trend).map((p) => ({ x: parseTs(p.t), y: Number(p.total) || 0, v: p.plan_version })).filter((p) => p.x != null);
    const W = 300, H = 46, P = 3;
    if (!pts.length) return `<svg viewBox="0 0 ${W} ${H}"></svg>`;
    const maxY = Math.max(...pts.map((p) => p.y), 1);
    const X = (x) => P + ((x - S.t0) / (S.tEnd - S.t0 || 1)) * (W - 2 * P);
    const Y = (y) => H - P - (y / maxY) * (H - 2 * P - 10);
    let d = `M${X(pts[0].x)} ${Y(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i].x)} V${Y(pts[i].y)}`;
    const nowX = X(parseTs(S.t));
    d += ` H${nowX}`;
    const area = `${d} V${H - P} H${X(pts[0].x)} Z`;
    const plans = [];
    let lastLabelX = -Infinity, row = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].v == null || pts[i].v === pts[i - 1].v) continue;
      const px = X(pts[i].x);
      row = px - lastLabelX < 18 ? (row + 1) % 2 : 0;  // 가까운 계획 버전 라벨은 위아래로 엇갈려 겹치지 않게
      lastLabelX = px;
      plans.push(`<circle class="spark-plan" cx="${px}" cy="${Y(pts[i].y)}" r="3"><title>계획 v${pts[i].v} 반영 ${fmtTs(pts[i].x)}</title></circle><text x="${px + 4}" y="${10 + row * 11}" style="font-size:9.5px;fill:var(--accent)">v${pts[i].v}</text>`);
    }
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="노출 추이"><path class="spark-area" d="${area}"/><path class="spark" d="${d}"/>${plans.join('')}
      <text x="${W - P}" y="10" text-anchor="end" style="font-size:10px;fill:var(--muted);font-family:var(--font-mono)">${fmtUSD(last.y)}</text></svg>`;
  }

  function physPieces(c) {
    const ev = arr(c.events).slice().sort((a, b) => parseTs(a.ts) - parseTs(b.ts));
    const T = (type) => { const e = ev.find((x) => x.type === type); return e ? parseTs(e.ts) : null; };
    const anch = T('ANCHORED'), aw = T('ANCHOR_AWEIGH'), af = T('ALL_FAST'), oc = T('OPS_COMMENCED'), ocp = T('OPS_COMPLETED'), hd = T('HOSES_DISCONNECTED'), ll = T('LAST_LINE');
    const out = [];
    const push = (a, b, kind) => { if (a != null && b != null && b > a) out.push({ a, b, kind }); };
    push(anch, aw ?? af, 'WAIT');
    push(aw, af, 'SHIFT');
    push(af, oc ?? hd, 'BERTH');
    if (oc != null && ocp != null) {
      const stops = [];
      let open = null;
      for (const e of ev) {
        if (e.type === 'OPS_STOPPED' && open == null) open = parseTs(e.ts);
        else if (e.type === 'OPS_RESUMED' && open != null) { stops.push([open, parseTs(e.ts)]); open = null; }
      }
      if (open != null) stops.push([open, ocp]);
      let cur = oc;
      for (const [s, r] of stops) { push(cur, s, 'OPS'); push(s, r, 'STOP'); cur = Math.max(cur, r); }
      push(cur, ocp, 'OPS');
    }
    push(ocp, hd, 'POST');
    push(hd, ll, 'DOCS');
    return out;
  }
  const splitAt = (a, b, T) => {
    if (T == null || b <= T) return [{ a, b, proj: false }];
    if (a >= T) return [{ a, b, proj: true }];
    return [{ a, b: T, proj: false }, { a: T, b, proj: true }];
  };
  function timelineSvg(st) {
    const meta = S.meta;
    const W = 1240, L = 182, R = 112, plotW = W - L - R;
    const t0 = S.t0, t1 = S.tEnd;
    const X = (ms) => L + ((Math.max(t0, Math.min(t1, ms)) - t0) / (t1 - t0 || 1)) * plotW;
    const now = parseTs(st.t);
    const tideRes = S.tide && S.tide.data;
    const tidePts = tideRes && tideRes.tide ? seriesPts(tideRes.tide.start, tideRes.tide.step_min, tideRes.tide.values_m).filter((p) => p.t >= t0 && p.t <= t1) : [];
    const tideH = tidePts.length > 1 ? 26 : 0;
    const axisH = 30, windY = 34, windH = 40, tideY = windY + windH + 6, rowsY = tideH ? tideY + tideH + 10 : windY + windH + 10;
    const calls = arr(st.calls);
    const berthOrder = arr(meta.berths).map((b) => b.id);
    const groups = berthOrder.map((bid) => ({ berth: arr(meta.berths).find((b) => b.id === bid), calls: calls.filter((c) => c.berth_id === bid).sort((a, b) => (a.seq || 0) - (b.seq || 0)) }));
    const orphan = calls.filter((c) => !berthOrder.includes(c.berth_id));
    if (orphan.length) groups.push({ berth: { id: '?', name: '기타', type: '' }, calls: orphan });
    const headH = 22, rowH = 40, emptyH = 20;
    let y = rowsY;
    const layout = groups.map((g) => {
      const gy = y;
      const rows = g.calls.map((c, i) => ({ c, y: gy + headH + i * rowH }));
      const h = headH + (g.calls.length ? g.calls.length * rowH : emptyH);
      y += h + 6;
      return { ...g, y: gy, h, rows };
    });
    const H = y + 8;
    const out = [svgDefs()];
    // 야간 음영
    const dayStart = meta.daytime ? meta.daytime.start : '07:00';
    const dayEnd = meta.daytime ? meta.daytime.end : '17:30';
    const [sh, sm] = dayStart.split(':').map(Number);
    const [eh, em] = dayEnd.split(':').map(Number);
    const d0 = new Date(t0);
    let day = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - 86400e3;
    while (day < t1) {
      const nightA = day + (eh * 60 + em) * 60e3;
      const nightB = day + 86400e3 + (sh * 60 + sm) * 60e3;
      if (nightB > t0 && nightA < t1) out.push(`<rect class="night" x="${X(nightA)}" y="${axisH}" width="${X(nightB) - X(nightA)}" height="${H - axisH}"/>`);
      day += 86400e3;
    }
    // 축
    const ax = [];
    for (let t = Math.ceil(t0 / 21600e3) * 21600e3; t <= t1; t += 21600e3) {
      const d = new Date(t);
      const isDay = d.getUTCHours() === 0;
      ax.push(`<line class="gridline ${isDay ? 'day' : ''}" x1="${X(t)}" x2="${X(t)}" y1="${axisH - 4}" y2="${H}" ${isDay ? '' : 'stroke-dasharray="2 4"'}/>`);
      if (isDay) ax.push(`<text class="day" x="${X(t) + 4}" y="12">${fmtDay(t)}</text>`);
      else ax.push(`<text x="${X(t)}" y="${axisH - 8}" text-anchor="middle">${pad(d.getUTCHours())}</text>`);
    }
    if (new Date(t0).getUTCHours() !== 0) ax.push(`<text class="day" x="${X(t0) + 4}" y="12">${fmtDay(t0)}</text>`);
    out.push(`<g class="axis">${ax.join('')}</g>`);
    // 풍속
    const wind = st.wind || {};
    const ws = parseTs(wind.start) ?? t0;
    const obsUntil = parseTs(wind.observed_until) ?? now;
    const lim = meta.limits || { mooring_ms: 15, ops_sbm_ms: 18, ops_pier_ms: 20 };
    const vmax = 25;
    const wy = (v) => windY + windH - (Math.min(v, vmax) / vmax) * (windH - 4);
    const bars = arr(wind.values).map((v, i) => {
      const a = ws + i * 3600e3, b = a + 3600e3;
      if (b <= t0 || a >= t1) return '';
      const cls = v >= lim.ops_pier_ms ? 'wx3' : v >= lim.ops_sbm_ms ? 'wx2' : v >= lim.mooring_ms ? 'wx1' : 'wx0';
      const top = wy(v);
      return `<rect class="${cls} ${a >= obsUntil ? 'fc' : ''}" x="${X(a) + 0.3}" y="${top}" width="${Math.max(0.6, X(b) - X(a) - 0.6)}" height="${windY + windH - top}"><title>${fmtTs(a)} 풍속 ${v} m/s ${a >= obsUntil ? '(예보)' : '(관측)'}</title></rect>`;
    }).join('');
    const limLine = (v, lbl) => `<line class="limit" x1="${L}" x2="${L + plotW}" y1="${wy(v)}" y2="${wy(v)}"/><text x="${L + plotW + 4}" y="${wy(v) + 3}" style="font-size:9.5px;fill:var(--muted)">${v} ${lbl}</text>`;
    out.push(`<text class="vname" x="8" y="${windY + 14}">풍속 m/s</text><text class="vsub" x="8" y="${windY + 28}">관측 | 예보 ${esc(wind.forecast_id || '')}</text>${bars}${limLine(lim.mooring_ms, '접안')}${limLine(lim.ops_sbm_ms, 'SBM 하역')}${limLine(lim.ops_pier_ms, '부두 하역')}`);
    if (tideH) out.push(tideStripSvg(tideRes, tidePts, X, tideY, tideH, L, plotW));
    // 선석·항차
    const oosByBerth = Object.fromEntries(arr(st.berths).map((b) => [b.id, arr(b.oos)]));
    for (const g of layout) {
      const b = g.berth || {};
      out.push(`<rect class="bhead" x="0" y="${g.y}" width="${W}" height="${headH}" rx="3"/><text class="bname" x="8" y="${g.y + 15}">${esc(b.name || b.id)}</text><text class="bsub" x="${L - 6}" y="${g.y + 15}" text-anchor="end">${esc(b.type || '')}${b.max_dwt ? ' · ' + num(b.max_dwt) + ' DWT' : ''}</text>`);
      for (const w of oosByBerth[b.id] || []) {
        const a = parseTs(w.from), z = parseTs(w.to);
        if (a == null || z == null || z <= t0 || a >= t1) continue;
        out.push(`<rect class="oos" x="${X(a)}" y="${g.y}" width="${Math.max(1, X(z) - X(a))}" height="${g.h}"><title>${esc(w.reason || '사용 불가')} ${fmtTs(w.from)}–${fmtTs(w.to)}</title></rect><text class="oostext" x="${X(Math.max(a, t0)) + 6}" y="${g.y + headH + 13}">${esc(w.reason || '정비')} ~${fmtTs(w.to)}</text>`);
      }
      if (!g.calls.length) out.push(`<text class="vsub" x="8" y="${g.y + headH + 13}">배정 없음</text>`);
      for (const { c, y: ry } of g.rows) out.push(callRow(c, ry, rowH, X, now, L, W, R));
    }
    // 지금
    out.push(`<line class="now" x1="${X(now)}" x2="${X(now)}" y1="${axisH - 6}" y2="${H}"/><text class="nowlabel" x="${X(now) + 4}" y="${axisH - 10}">지금 ${fmtTs(now).slice(6)}</text>`);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="선석별 항차 타임라인">${out.join('')}</svg>`;
  }
  function callRow(c, y, rowH, X, now, L, W) {
    const by = y + 6, bh = 15, ly = y + 25, lh = 7;
    const parts = [];
    for (const p of physPieces(c)) {
      for (const s of splitAt(p.a, p.b, now)) {
        const x = X(s.a), w = Math.max(0.8, X(s.b) - X(s.a));
        parts.push(`<rect class="p-${p.kind} ${s.proj ? 'proj' : ''}" x="${x}" y="${by}" width="${w}" height="${bh}" rx="1.5"><title>${esc(c.vessel_name)} · ${PHYS_LABEL[p.kind]} ${fmtTs(p.a)}–${fmtTs(p.b)}${s.proj ? ' (예측)' : ''}</title></rect>`);
        if (s.proj && w > 2) parts.push(`<rect class="projline" x="${x}" y="${by}" width="${w}" height="${bh}" rx="1.5"/>`);
      }
    }
    // v3 새 사유(조석·예선·검사·시정·파고·탱크·배관·전환·샘플링) 구간은 물리 막대 아래쪽에 색 띠로 표시
    for (const sg of arr(c.segments)) {
      if (!NEW_REASON_SET.has(sg.reason)) continue;
      const a = parseTs(sg.from), b = parseTs(sg.to);
      if (a == null || b == null || b <= a) continue;
      parts.push(`<rect class="rstrip rz-${esc(sg.reason)}" x="${X(a)}" y="${by + bh - 4}" width="${Math.max(1, X(b) - X(a))}" height="4"><title>${esc(c.vessel_name)} · ${esc(reasonLabel(sg.reason))} · ${fmtH(sg.hours)}\n${fmtTs(sg.from)}–${fmtTs(sg.to)}${sg.rule ? ' · ' + esc(sg.rule) : ''}</title></rect>`);
    }
    // 통지시간
    const ev = arr(c.events);
    const norE = ev.find((e) => e.type === 'NOR_RETENDERED') || ev.find((e) => e.type === 'NOR_RECEIVED') || ev.find((e) => e.type === 'NOR_TENDERED');
    const ls = parseTs(c.laytime_start);
    if (norE && ls != null) {
      const n = parseTs(norE.ts);
      if (n < ls && ls - n <= 6.02 * 3600e3) for (const s of splitAt(n, ls, now)) parts.push(`<rect class="s-NOTICE ${s.proj ? 'proj' : ''}" x="${X(s.a)}" y="${ly}" width="${Math.max(0.8, X(s.b) - X(s.a))}" height="${lh}"><title>통지시간 ${fmtTs(n)}–${fmtTs(ls)}</title></rect>`);
    }
    for (const sg of arr(c.segments)) {
      const a = parseTs(sg.from), b = parseTs(sg.to);
      if (a == null || b == null) continue;
      for (const s of splitAt(a, b, now)) parts.push(`<rect class="s-${esc(sg.effect)} ${s.proj ? 'proj' : ''}" x="${X(s.a)}" y="${ly}" width="${Math.max(0.6, X(s.b) - X(s.a))}" height="${lh}"><title>${esc(sg.label)} · ${EFFECT_LABEL[sg.effect] || sg.effect} · ${fmtH(sg.hours)}\n${fmtTs(sg.from)}–${fmtTs(sg.to)} · ${esc(sg.rule || '')}</title></rect>`);
    }
    const tender = ev.find((e) => e.type === 'NOR_TENDERED');
    if (tender) parts.push(`<path class="nor" d="M${X(parseTs(tender.ts))} ${by - 1} l-4 -5 h8 z"><title>NOR 제출 ${fmtTs(tender.ts)}</title></path>`);
    const re = ev.find((e) => e.type === 'NOR_RETENDERED');
    if (re) parts.push(`<path d="M${X(parseTs(re.ts))} ${by - 1} l-4 -5 h8 z" fill="none" stroke="var(--fg)"><title>NOR 재제출 ${fmtTs(re.ts)}</title></path>`);
    const exp = parseTs(c.laytime_expiry);
    if (exp != null && c.demurrage_h > 0) parts.push(`<path class="expiry" d="M${X(exp)} ${ly - 3} l5 6.5 l-5 6.5 l-5 -6.5 z"><title>레이타임 소진·체선 돌입 ${fmtTs(exp)}</title></path>`);
    const issues = arr(c.issues);
    const flag = issues.some((i) => ['critical', 'error'].includes(i.severity)) ? '‼' : issues.some((i) => i.severity === 'dispute') ? '⚖' : issues.some((i) => i.severity === 'warning') ? '!' : '';
    const amtCls = c.amount_usd > 0.5 ? 'dem' : 'zero';
    return `<g class="row ${S.drawerCall === c.call_id ? 'sel' : ''}" data-call="${esc(c.call_id)}" tabindex="0">
      <rect class="rowbg" x="0" y="${y}" width="${W}" height="${rowH}"/>
      <text class="vname" x="8" y="${y + 16}">${esc(c.vessel_name)} ${flag ? `<tspan style="fill:var(--dem)">${flag}</tspan>` : ''}</text>
      <text class="vsub" x="8" y="${y + 31}">${esc(c.vessel_type || '')} · #${esc(c.seq)} · ${esc(c.status_label || c.status || '')}</text>
      ${parts.join('')}
      <text class="amt ${amtCls}" x="${W - 6}" y="${y + 17}" text-anchor="end">${fmtUSD(c.amount_usd)}</text>
      <text class="vsub" x="${W - 6}" y="${y + 31}" text-anchor="end">${esc(CLOCK_LABEL[c.clock && c.clock.state] || '')}</text>
      <title>${esc(c.vessel_name)} — 클릭해서 상세 보기</title>
    </g>`;
  }
  function openDrawer(cid, keep) {
    const c = arr(S.state && S.state.calls).find((x) => x.call_id === cid);
    const d = $('#drawer');
    if (!c) { closeDrawer(); return; }
    S.drawerCall = cid;
    const m = callMeta(cid) || {};
    const v = m.vessel || {};
    const ct = m.contract || {};
    const ck = c.clock || {};
    d.innerHTML = `<button class="btn small close" data-close-drawer>닫기</button>
      <h2>${esc(c.vessel_name)}</h2>
      <p class="muted small mono">${esc(cid)} · IMO ${esc(v.imo || '—')} (가상)</p>
      <div class="chips" style="margin:8px 0"><span class="pill status ${esc(c.status)}">${esc(c.status_label || c.status)}</span><span class="pill k">${esc(c.berth_id)} #${esc(c.seq)}</span><span class="pill k">${esc(CLOCK_LABEL[ck.state] || '')}</span></div>
      <dl class="kv">
        <dt>선박</dt><dd>${esc(v.type || c.vessel_type || '')} · ${num(v.dwt)} DWT · GT ${num(v.gt)} · 흘수 ${esc(v.draft_m ?? '—')}m</dd>
        <dt>화물</dt><dd>${esc(m.operation === 'LOAD' ? '선적' : '양하')} · ${esc(m.cargo || '')} · ${num(m.quantity_bbl)} bbl</dd>
        <dt>계약</dt><dd>${esc(LAYER_LABEL[ct.layer] || ct.layer || c.layer || '')} · ${esc(ct.form || '')}<div class="small muted">${esc(ct.sk_role_label || c.sk_role_label || '')}</div><div class="small muted">${esc(ct.counterparty || c.counterparty || '')}</div></dd>
        <dt>허용·요율</dt><dd>${esc(ct.laytime_hours ?? c.allowed_h)}h · USD ${num(ct.rate_usd_day ?? c.rate_usd_day)}/일</dd>
        <dt>대리점</dt><dd>${esc(m.agent || '—')}</dd>
      </dl>
      <h3 style="margin-top:12px">시각</h3>
      <dl class="kv"><dt>도착(투묘)</dt><dd class="mono">${esc(fmtTs(c.anchored))}</dd><dt>ETB 접안</dt><dd class="mono">${esc(fmtTs(c.etb))}</dd><dt>ETC 하역 종료</dt><dd class="mono">${esc(fmtTs(c.etc))}</dd><dt>ETD 이안</dt><dd class="mono">${esc(fmtTs(c.etd))}</dd>
        <dt>레이타임 개시</dt><dd class="mono">${esc(fmtTs(c.laytime_start))}</dd><dt>체선 돌입</dt><dd class="mono">${esc(fmtTs(c.demurrage_start))}</dd></dl>
      <h3 style="margin-top:12px">돈</h3>
      <dl class="kv"><dt>예상 체선료</dt><dd class="mono ${c.amount_usd > 0 ? 'pos' : ''}">${fmtUSD(c.amount_usd)} (체선 ${fmtH(c.demurrage_h)}${c.half_h > 0 ? `, 반액 ${fmtH(c.half_h)}` : ''})</dd>
        <dt>사용/허용</dt><dd class="mono">${fmtH(c.used_h)} / ${fmtH(c.allowed_h)}${c.demurrage_h <= 0 ? ` · 여유 ${fmtH(c.margin_h)}` : ''}</dd>
        <dt>지금까지</dt><dd class="mono">레이타임 ${fmtH(ck.laytime_used_h)} · 체선 ${fmtH(ck.demurrage_h)} · ${fmtUSD(ck.accrued_usd)}</dd></dl>
      ${arr(c.issues).length ? `<h3 style="margin-top:12px">쟁점·경고</h3>${c.issues.map((i) => `<div class="issue ${esc(i.severity)}"><div class="t"><span class="pill sev-${esc(i.severity)}">${esc(SEV_LABEL[i.severity] || i.severity)}</span>${esc(i.title)}</div></div>`).join('')}` : ''}
      <h3 style="margin-top:12px">이벤트</h3>
      <table><tbody>${arr(c.events).map((e) => `<tr class="${e.projected ? 'sub' : ''}"><td class="mono">${esc(fmtTs(e.ts))}</td><td>${esc(e.label || EVENT_LABEL[e.type] || e.type)}${e.reason ? ` <span class="small muted">(${reasonDot(e.reason)}${esc(REASON_META[e.reason] ? REASON_META[e.reason][0] : e.reason)})</span>` : ''}</td><td class="small muted">${e.projected ? '예측' : esc(e.source || '')}</td></tr>`).join('')}</tbody></table>
      <div class="actions"><button class="btn primary" data-open-stmt="${esc(cid)}">계산서 열기</button></div>`;
    d.classList.add('open');
    if (!keep) $$('svg .row').forEach((r) => r.classList.toggle('sel', r.dataset.call === cid));
  }
  function closeDrawer() {
    S.drawerCall = null;
    $('#drawer').classList.remove('open');
    $$('svg .row.sel').forEach((r) => r.classList.remove('sel'));
  }

  // ================================================================ 계산서 탭
  async function renderStatementTab() {
    const calls = arr(S.state && S.state.calls);
    if (!S.stmtCall || !calls.some((c) => c.call_id === S.stmtCall)) S.stmtCall = calls[0] ? calls[0].call_id : null;
    main.innerHTML = `<div class="panel"><div class="panel-head"><h4>라이브 항차 ${term('레이타임')} 계산서 — ${esc(fmtTs(S.t))} 시점</h4>
        <label class="small muted">항차 <select id="stmtSel">${calls.map((c) => `<option value="${esc(c.call_id)}" ${c.call_id === S.stmtCall ? 'selected' : ''}>${esc(c.vessel_name)} · ${esc(c.berth_id)} · ${esc(c.status_label || '')}</option>`).join('')}</select></label></div>
        <p class="small muted">지금 이후 시각은 예측값(예보·ETA·계획)이다. 확정 계산서는 하역 완료 후 작업함의 '계산서' 항목으로 만든다.</p>
        <div id="stmtBody"><div class="empty">불러오는 중…</div></div></div>`;
    updateHash();
    if (S.stmtCall) await loadStatement();
  }
  async function loadStatement() {
    const seq = ++S.stmtSeq;
    try {
      const r = await GET(`/api/statement?call_id=${encodeURIComponent(S.stmtCall)}&t=${encodeURIComponent(S.t)}`);
      if (seq !== S.stmtSeq || S.tab !== 'statement') return;
      const st = r && r.statement ? r.statement : r;
      const ct = r && r.contract ? r.contract : null;
      const vessel = r && r.vessel ? (typeof r.vessel === 'string' ? r.vessel : r.vessel.name) : vesselName(S.stmtCall);
      if (st && !st.story && r && r.story) st.story = r.story;
      $('#stmtBody').innerHTML = `
        <div class="chips" style="margin-bottom:8px"><b>${esc(vessel)}</b>${ct ? `<span class="pill k">${esc(LAYER_LABEL[ct.layer] || ct.layer || '')} · ${esc(ct.form || '')}</span><span class="pill k">허용 ${esc(ct.laytime_hours)}h · USD ${num(ct.rate_usd_day)}/일</span>${ct.counterparty ? `<span class="small muted">${esc(ct.counterparty)}</span>` : ''}` : ''}</div>
        ${renderStatementView(st)}${renderReasons(r && r.reasons, r && r.reasons_note)}`;
    } catch (e) {
      if (seq === S.stmtSeq) { const b = $('#stmtBody'); if (b) b.innerHTML = `<div class="empty">계산서를 불러오지 못했습니다: ${esc(e.message)}</div>`; }
    }
  }

  // ================================================================ 입력·계산기
  async function renderIntake() {
    if (!S.golden) {
      try { S.golden = await GET('/api/golden'); } catch (e) { showError('Golden Set을 불러오지 못했습니다: ' + e.message); S.golden = { cases: [] }; }
    }
    const g = S.golden || {};
    const cases = Array.isArray(g) ? g : arr(g.cases);
    main.innerHTML = `
      <div class="panel"><div class="panel-head"><h4>SOF를 넣으면 레이타임 계산서가 나온다</h4><span class="hint">문서 표(| D1 02:00 | 묘박지 도착 |)·로그(2026-11-03 02:00 Anchored) 모두 가능</span></div>
        <div class="form" style="margin-bottom:10px">
          <label style="grid-column:span 2">예제 불러오기 (docs/domain/04 Golden Set)<select id="inPreset"><option value="">— 빈 양식 —</option>${cases.map((c) => `<option value="${esc(c.id)}" ${S.intake.preset === c.id ? 'selected' : ''}>${esc(c.id)} · ${esc(c.title)}</option>`).join('')}</select></label>
          <label>기준일 (D1)<input type="text" id="inBase" value="${esc(g.base_date || '2026-11-03')}" placeholder="YYYY-MM-DD"></label>
          <label>작업<select id="inOp"><option value="DISCHARGE">양하 DISCHARGE</option><option value="LOAD">선적 LOAD</option></select></label>
        </div>
        <div class="intake">
          <div>
            <h3>SOF 원문</h3>
            <textarea id="inText" rows="14" placeholder="| D1 02:00 | 묘박지 도착, 투묘 |&#10;| D1 02:30 | NOR 제출·수령 |"></textarea>
            <h3 style="margin-top:10px">계약 조건 terms</h3>
            <div class="form">
              <label>허용 레이타임 h<input type="number" id="inLay" value="36" step="0.5"></label>
              <label>통지시간 h<input type="number" id="inNotice" value="6" step="0.5"></label>
              <label>체선료율 USD/일<input type="number" id="inRate" value="120000" step="1000"></label>
              <label>레이캔 시작<input type="text" id="inLaycan" placeholder="D1 00:00 또는 ISO"></label>
              <label>펌핑 보증 h<input type="number" id="inPwH" placeholder="예: 24"></label>
              <label>펌핑 보증 psi<input type="number" id="inPwPsi" placeholder="예: 100"></label>
            </div>
            <h3 style="margin-top:10px">맥락 context</h3>
            <div class="form">
              <label class="chk"><input type="checkbox" id="inDay" checked> 야간 계류·접안 제한 대상</label>
              <label class="chk"><input type="checkbox" id="inFree"> 도착 시 선석 비어 있음</label>
              <label>앞 선박 점유 종료<input type="text" id="inOcc" placeholder="D2 06:00"></label>
              <label>NOR 수령 문구<select id="inReceipt"><option value="">—</option><option value="RECEIVED">RECEIVED</option><option value="ACCEPTED">ACCEPTED</option><option value="RESERVED">RESERVED (validity reserved)</option></select></label>
              <label>평균 매니폴드 psi<input type="number" id="inPsi" placeholder="펌핑 로그"></label>
              <label class="chk"><input type="checkbox" id="inShore"> 육상 제한 기록 있음</label>
            </div>
            <div class="actions"><button class="btn" id="inParse">파싱</button><button class="btn primary" id="inCalc">계산</button><span class="small muted" id="inExpected"></span></div>
            <h3 style="margin-top:10px">보내는 입력 JSON</h3>
            <pre class="json" id="inJson">—</pre>
          </div>
          <div id="inResult"><div class="panel empty" style="margin:0">예제를 고르거나 SOF를 붙여 넣고 '계산'을 누르세요</div></div>
        </div></div>`;
    if (S.intake.preset) fillPreset(S.intake.preset, false);
    if (S.intake.result || S.intake.parsed) showIntakeResult();
  }
  function fillPreset(id, reset = true) {
    const g = S.golden || {};
    const cases = Array.isArray(g) ? g : arr(g.cases);
    const c = cases.find((x) => x.id === id);
    S.intake.preset = id;
    if (reset) { S.intake.result = null; S.intake.parsed = null; }
    if (!c) return;
    const t = c.terms || {};
    const x = c.context || {};
    $('#inText').value = c.sof_text || '';
    $('#inBase').value = g.base_date || $('#inBase').value;
    $('#inOp').value = t.operation || 'DISCHARGE';
    $('#inLay').value = t.laytime_hours ?? '';
    $('#inNotice').value = t.notice_hours ?? 6;
    $('#inRate').value = t.rate_usd_day ?? '';
    $('#inLaycan').value = t.laycan_from || '';
    $('#inPwH').value = t.pumping_warranty_hours ?? '';
    $('#inPwPsi').value = t.pumping_warranty_psi ?? '';
    $('#inDay').checked = x.daytime_rule !== false;
    $('#inFree').checked = !!x.berth_free_on_arrival;
    $('#inOcc').value = x.berth_occupied_until || '';
    $('#inReceipt').value = x.nor_receipt || '';
    $('#inPsi').value = x.pumping_log && x.pumping_log.avg_manifold_psi != null ? x.pumping_log.avg_manifold_psi : '';
    $('#inShore').checked = !!(x.pumping_log && x.pumping_log.shore_restriction);
    const e = c.expected || {};
    $('#inExpected').textContent = `정답(04 문서): ${fmtUSD(e.amount_usd)} · 체선 ${fmtH(e.demurrage_h)}${arr(e.flags).length ? ' · 플래그 ' + e.flags.join(', ') : ''}`;
    $('#inJson').textContent = JSON.stringify(intakeRequest(), null, 2);
  }
  function intakeRequest() {
    const v = (id) => $(id).value.trim();
    const n = (id) => (v(id) === '' ? null : Number(v(id)));
    const terms = { laytime_hours: n('#inLay'), notice_hours: n('#inNotice') ?? 6, rate_usd_day: n('#inRate'), operation: $('#inOp').value };
    if (v('#inLaycan')) terms.laycan_from = v('#inLaycan');
    if (n('#inPwH') != null) terms.pumping_warranty_hours = n('#inPwH');
    if (n('#inPwPsi') != null) terms.pumping_warranty_psi = n('#inPwPsi');
    const context = { daytime_rule: $('#inDay').checked };
    if ($('#inFree').checked) context.berth_free_on_arrival = true;
    if (v('#inOcc')) context.berth_occupied_until = v('#inOcc');
    if (v('#inReceipt')) context.nor_receipt = v('#inReceipt');
    if (n('#inPsi') != null || $('#inShore').checked) {
      context.pumping_log = { avg_manifold_psi: n('#inPsi'), shore_restriction: $('#inShore').checked, evidence: $('#inShore').checked ? '입력: 육상 제한 있음' : '입력: 육상 제한 없음' };
    }
    return { text: $('#inText').value, base_date: v('#inBase'), terms, context };
  }
  async function intakeRun(calc) {
    const req = intakeRequest();
    S.intake.request = req;
    $('#inJson').textContent = JSON.stringify(calc ? req : { text: req.text, base_date: req.base_date }, null, 2);
    if (!req.text.trim()) { showError('SOF 텍스트가 비어 있습니다'); return; }
    if (calc && (req.terms.laytime_hours == null || req.terms.rate_usd_day == null)) { showError('허용 레이타임과 체선료율을 입력하세요'); return; }
    try {
      if (calc) {
        const r = await POST('/api/intake/calc', req);
        S.intake.result = r;
        S.intake.parsed = r.parsed;
      } else {
        S.intake.parsed = await POST('/api/intake/parse', { text: req.text, base_date: req.base_date });
        S.intake.result = null;
      }
      showIntakeResult();
    } catch (e) { showError(e.message); }
  }
  function showIntakeResult() {
    const box = $('#inResult');
    if (!box) return;
    const p = S.intake.parsed;
    const r = S.intake.result;
    const st = r && r.statement;
    let cmp = '';
    if (st && S.intake.preset) {
      const g = S.golden || {};
      const c = (Array.isArray(g) ? g : arr(g.cases)).find((x) => x.id === S.intake.preset);
      const e = c ? c.expected || {} : {};
      const okAmt = Math.abs((st.amount_usd || 0) - (e.amount_usd || 0)) < 0.01;
      const okDem = e.demurrage_h == null || Math.abs((st.demurrage_h || 0) - e.demurrage_h) < 1e-4;
      const codes = new Set(arr(st.issues).map((i) => i.code));
      const okFlags = arr(e.flags).every((f) => codes.has(f));
      cmp = `<div class="cmp"><b>정답 비교 (${esc(S.intake.preset)})</b><span class="pill ${okAmt ? 'ok' : 'bad'}">${okAmt ? '✓' : '✗'} 금액 ${fmtUSD(st.amount_usd)} / 정답 ${fmtUSD(e.amount_usd)}</span><span class="pill ${okDem ? 'ok' : 'bad'}">${okDem ? '✓' : '✗'} 체선 ${fmtH(st.demurrage_h)}</span>${arr(e.flags).length ? `<span class="pill ${okFlags ? 'ok' : 'bad'}">${okFlags ? '✓' : '✗'} 플래그 ${esc(e.flags.join(', '))}</span>` : ''}</div>`;
    }
    box.innerHTML = `
      ${p ? `<div class="panel" style="margin:0 0 12px"><div class="panel-head"><h4>파싱 결과</h4><span class="hint">${arr(p.events).length}개 이벤트 · 줄 ${arr(p.lines).length}개</span></div>
        <div class="table-scroll"><table><thead><tr><th>#</th><th>원문</th><th>상태</th><th>이벤트</th></tr></thead><tbody>
        ${arr(p.lines).map((l) => `<tr class="line-${esc(l.status)}"><td class="mono">${esc(l.no)}</td><td class="small">${esc(l.raw)}</td><td>${esc({ parsed: '인식', derived: '계산 항목(무시)', ignored: '무시', unrecognized: '미인식' }[l.status] || l.status)}</td><td class="small">${esc(arr(l.events).map((t) => EVENT_LABEL[t] || t).join(', '))}</td></tr>`).join('')}
        </tbody></table></div>
        ${arr(p.checks).length ? `<h3 style="margin-top:8px">검증</h3>${p.checks.map((c) => `<div class="issue ${c.level === 'error' ? 'error' : 'warning'}"><div class="d" style="color:var(--fg)">${esc(c.msg)}</div></div>`).join('')}` : '<p class="small muted" style="margin-top:6px">검증 통과</p>'}
        ${arr(p.warnings).length ? `<details><summary>경고 ${p.warnings.length}건</summary><ul class="narrative">${p.warnings.map((w) => `<li class="small">${esc(w)}</li>`).join('')}</ul></details>` : ''}
        ${p.notes ? `<details><summary>맥락 메모(파서가 읽은 것)</summary><pre class="json">${esc(JSON.stringify(p.notes, null, 2))}</pre></details>` : ''}
      </div>` : ''}
      ${st ? `<div class="panel" style="margin:0"><div class="panel-head"><h4>레이타임 계산서</h4></div>${cmp}${renderStatementView(st)}${renderReasons(r.reasons, r.reasons_note)}</div>` : ''}`;
  }

  // ================================================================ 룰
  async function renderRules() {
    if (!S.rulesList.length) {
      try { setRules(await GET('/api/rules')); } catch (e) { showError(e.message); }
    }
    const groups = [...new Set(S.rulesList.map((r) => r.group))];
    main.innerHTML = `<div class="panel"><div class="panel-head"><h4>룰 레지스트리 — 모든 판정의 근거</h4><span class="hint">${S.rulesList.length}개 · data/rules.json</span></div>
      <div class="form" style="margin-bottom:10px">
        <label>분류<select id="rfGroup"><option value="">전체</option>${groups.map((g) => `<option value="${esc(g)}">${esc(GROUP_LABEL[g] || g)}</option>`).join('')}</select></label>
        <label>상태<select id="rfStatus"><option value="">전체</option>${Object.entries(RULE_STATUS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label style="grid-column:span 2">검색<input type="search" id="rfQ" placeholder="룰 ID·제목·출처"></label>
      </div>
      <div class="legend" style="margin-bottom:8px"><span><span class="rule-chip s-public">공개자료</span></span><span><span class="rule-chip s-verify">원문 대조 전</span></span><span><span class="rule-chip s-assumed">가정</span></span><span><span class="rule-chip s-disputed">쟁점</span></span></div>
      <div id="rulesTable"></div></div>`;
    $('#rfGroup').value = S.ruleFilter.group;
    $('#rfStatus').value = S.ruleFilter.status;
    $('#rfQ').value = S.ruleFilter.q;
    drawRulesTable();
  }
  function drawRulesTable() {
    const f = S.ruleFilter;
    const q = f.q.toLowerCase();
    const rows = S.rulesList.filter((r) => (!f.group || r.group === f.group) && (!f.status || r.status === f.status)
      && (!q || [r.id, r.title, r.source, r.note].join(' ').toLowerCase().includes(q)));
    $('#rulesTable').innerHTML = `<div class="table-scroll"><table><thead><tr><th>룰 ID</th><th>분류</th><th>내용</th><th>출처</th><th>상태</th><th>사용 모듈</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${chip(r.id)}</td><td class="nowrap">${esc(GROUP_LABEL[r.group] || r.group)}</td><td>${esc(r.title)}${r.params ? `<div class="small muted mono">${esc(JSON.stringify(r.params))}</div>` : ''}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td>
        <td class="small">${esc(r.source || '')}${r.url ? `<div><a href="${esc(r.url)}" target="_blank" rel="noopener">링크</a></div>` : ''}</td>
        <td><span class="pill sev-${r.status === 'disputed' ? 'dispute' : r.status === 'assumed' ? 'warning' : r.status === 'public' ? 'low' : 'info'}">${esc(RULE_STATUS[r.status] || r.status)}</span></td><td class="small">${esc(arr(r.used_by).join(', '))}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">조건에 맞는 룰 없음</td></tr>'}
      </tbody></table></div>`;
  }

  // ================================================================ 감사 로그
  function shadowKpis(rows) {
    // Phase 30 Shadow mode — 마지막 초기화 이후, 항목별 마지막 결정 기준
    const sorted = rows.slice().sort((x, y) => String(x.wall || '').localeCompare(String(y.wall || '')));
    let since = sorted;
    const lastReset = [...sorted].reverse().find((a) => a.decision === 'RESET');
    if (lastReset) since = sorted.slice(sorted.indexOf(lastReset) + 1);
    const latest = new Map();
    for (const a of since) if (a.item_id) latest.set(a.item_id, a);
    const decided = [...latest.values()];
    const optItems = decided.filter((a) => ['IMPACT', 'BASELINE'].includes(a.kind) && ['APPROVE_OPTION', 'REJECT', 'ACK', 'SEND'].includes(a.decision));
    const accepted = optItems.filter((a) => a.decision === 'APPROVE_OPTION').length;
    const overridden = optItems.filter((a) => a.decision === 'REJECT').length;
    const byKind = {};
    for (const a of decided) {
      const k = a.kind || '기타';
      byKind[k] = byKind[k] || {};
      byKind[k][a.decision] = (byKind[k][a.decision] || 0) + 1;
    }
    const pending = arr(S.state && S.state.inbox).filter((i) => ['IMPACT', 'BASELINE'].includes(i.kind) && i.needs_decision).length;
    const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
    return `<div class="panel"><div class="panel-head"><h4>Shadow mode KPI — 에이전트 추천 vs 사람의 판단</h4><span class="hint">${lastReset ? `마지막 초기화(${esc(lastReset.wall || '')}) 이후` : '전체 기록'} · 항목별 마지막 결정 기준</span></div>
      <p class="small muted" style="margin-bottom:10px">Phase 30: 에이전트는 추천만 하고 실제 결정은 사람이 내린다. 일정 기간 두 판단을 비교해 수용률·Override율로 도입 여부를 판단한다.</p>
      <div class="kpis shadow">
        <div class="kpi"><span class="label">결정한 영향·기준 항목</span><span class="value">${optItems.length}건</span><span class="sub">대기 중 ${pending}건 (지금 시점)</span></div>
        <div class="kpi"><span class="label">수용률 (옵션 적용)</span><span class="value">${pct(accepted, optItems.length)}</span><span class="sub">${accepted} / ${optItems.length}</span></div>
        <div class="kpi"><span class="label">Override율 (반려)</span><span class="value">${pct(overridden, optItems.length)}</span><span class="sub">${overridden} / ${optItems.length} · 사유는 아래 로그</span></div>
        <div class="kpi"><span class="label">확인만 함 (ACK)</span><span class="value">${optItems.filter((a) => a.decision === 'ACK').length}건</span><span class="sub">추천을 보고도 적용하지 않음</span></div>
      </div>
      ${Object.keys(byKind).length ? `<div class="table-scroll"><table><thead><tr><th>항목 종류</th><th>결정 분포</th></tr></thead><tbody>${Object.entries(byKind).map(([k, m]) => `<tr><td>${esc(KIND_LABEL[k] || k)}</td><td>${Object.entries(m).map(([d, n]) => `<span class="pill k">${esc(ACTION_LABEL[d] || d)} ${n}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">아직 결정이 없습니다.</p>'}
    </div>`;
  }
  async function renderAudit() {
    main.innerHTML = '<div id="shadowBox" data-anchors="shadow shadow_mode acceptance"></div><div class="panel"><div class="panel-head"><h4>감사 로그 — 사람이 내린 결정</h4><span class="hint">최신순 · 초기화해도 지워지지 않음</span></div><div id="auditBody" class="empty">불러오는 중…</div></div>';
    try {
      const r = await GET('/api/audit');
      const rows = Array.isArray(r) ? r : arr(r && (r.audit || r.rows));
      $('#shadowBox').innerHTML = shadowKpis(rows);
      $('#auditBody').classList.remove('empty');
      $('#auditBody').innerHTML = rows.length ? `<div class="table-scroll"><table><thead><tr><th>시나리오 시각</th><th>실제 시각</th><th>결정자</th><th>항목</th><th>결정</th><th>내용</th></tr></thead><tbody>
        ${rows.slice().sort((x, y) => String(y.wall || '').localeCompare(String(x.wall || ''))).map((a) => `<tr><td class="mono">${esc(fmtTs(a.at))}</td><td class="mono small">${esc(a.wall || '')}</td><td>${esc(a.actor || '')}</td><td class="mono small">${esc(a.item_id || '')}</td><td><span class="pill k">${esc(ACTION_LABEL[a.decision] || a.decision)}</span>${a.option_id ? ` <span class="mono small muted">${esc(a.option_id)}</span>` : ''}</td><td class="small">${esc(typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail || a.note || ''))}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">아직 결정이 없습니다. 작업함에서 항목을 확인·승인하면 여기에 남습니다.</div>';
    } catch (e) { $('#auditBody').innerHTML = `<div class="empty">불러오지 못했습니다: ${esc(e.message)}</div>`; }
    if (S.pendingAnchor) flushAnchor();
  }

  // ================================================================ 작동 원리
  function renderGuide() {
    const story = arr(S.meta && S.meta.scenario && S.meta.scenario.story);
    const sim = (S.meta && S.meta.simulator_doc) || 'docs/domain/demurrage-simulator.html';
    const inputs = [
      ['SEAGATE', '선석 제원 (Mooring Facilities)', 'data/live/berths.json', 'SIM·SCHED (DWT·수심·화물 적합성)'],
      ['SEAGATE', '접안계획 v1 (Berthing Schedule)', 'data/live/plan.json', 'SIM·EXPOSURE'],
      ['SEAGATE', 'ETB·ETC (Berthing Schedule·ETB Change Log)', '데모: engine/sim.py가 대신 생성', 'EXPOSURE·EXPLAIN'],
      ['SEAGATE', '부두제약관리 (정비·사용불가)', 'data/live/berths.json → constraint_updates', 'SIM·SCHED'],
      ['SEAGATE', '하역 실적 (Cargo Working·Performance Record)', '데모: 시뮬레이션 실적 = 터미널 기록', 'CLOCK·대조'],
      ['SEAGATE', '선박 제원 (Ship Particulars / Q88)', 'data/live/vessels.json', 'SIM·SCHED'],
      ['대리점·선장', 'NOR·ETA 통지', 'data/live/calls.json (eta_updates, nor_anomaly)', 'INTAKE·CLOCK'],
      ['대리점·선장', 'SOF (서명용)', 'data/live/sof_reports.json, 계산기 텍스트', 'INTAKE·대조'],
      ['트레이딩·용선', '계약 조건 (CP recap·GTC)', 'data/live/contracts.json', 'CLOCK·CLAIM'],
      ['생산조정팀', '탱크 수용률·레버', 'data/live/calls.json shore_rate_m3h, plan.json shore_options', 'SIM·SCHED'],
      ['KMA', '해양기상 관측·예보', 'data/live/weather.json', 'SIM·EXPOSURE·반액 증빙'],
      ['AIS', '도착(투묘) 시각', 'ANCHORED 이벤트 (source AIS)', 'NOR 유효성'],
      ['선주·상대방', '체선료 청구서·타임시트', 'data/claims/claims.json', 'CLAIM'],
      ['공개 규정·판례', '룰 레지스트리', 'data/rules.json', '전체 (모든 판정의 근거)'],
    ];
    main.innerHTML = `
      <div class="panel"><div class="panel-head"><h4>에이전트가 하는 일 — SEAGATE의 기록과 체선료 계산 '사이'</h4></div>
        <div class="pipeline">
          <div class="stage"><b>INTAKE</b><span>SOF·NOR·ETA·계약·청구서를 표준 이벤트로. 결정론적 검증 통과해야 계산</span></div><span class="arrow">→</span>
          <div class="stage"><b>CLOCK</b><span>레이타임 계산서: 개시·공제·반액·체선. 모든 행에 룰 ID</span></div><span class="arrow">→</span>
          <div class="stage"><b>EXPOSURE·EXPLAIN</b><span>정보가 들어올 때마다 재계산, ETB 변경 1건의 체선료 영향 설명</span></div><span class="arrow">→</span>
          <div class="stage"><b>SCHED (설명)</b><span>변경안 몇 개를 돈으로 비교. SEAGATE Berth Optimization을 대체하지 않음</span></div><span class="arrow">→</span>
          <div class="stage"><b>CLAIM</b><span>청구서 재계산, 시효·서류, 차이 분해, 쟁점 범위</span></div><span class="arrow">→</span>
          <div class="stage"><b>COMMS·HITL</b><span>회신·통보·메모 초안. 확정은 담당자 승인</span></div>
        </div>
        <div class="callout" style="margin-top:12px"><b>LLM이 들어가는 자리</b> — SOF·메일·PDF 추출(INTAKE), 초안 문장(COMMS), 설명 문장. <b>숫자 계산은 결정론적 엔진</b>이 하고, 쟁점은 자동 판정하지 않고 기본 계산과 대안 계산을 함께 낸다.</div>
      </div>
      <div class="panel"><div class="panel-head"><h4>무엇이 들어와야 하나 — 입력과 출처</h4><span class="hint">전부 가상 데이터, 규칙값은 가정</span></div>
        <div class="table-scroll"><table><thead><tr><th>출처</th><th>입력</th><th>프로토타입 파일</th><th>쓰는 모듈</th></tr></thead><tbody>
        ${inputs.map((r) => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td class="mono small">${esc(r[2])}</td><td class="small">${esc(r[3])}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="grid2">
        <div class="panel"><div class="panel-head"><h4>데모 순서</h4></div><ol class="narrative">${story.map((s) => `<li><span class="mono small">${esc(fmtTs(s.at))}</span> <b>${esc(s.title)}</b> — ${esc(s.what)}</li>`).join('') || '<li>meta.scenario.story 없음</li>'}</ol>
          <p class="small muted" style="margin-top:8px">상단 ▶ 재생은 정보 이벤트마다 멈추지 않고 진행하다가, 승인이 필요한 새 항목이 생기면 자동으로 멈춘다.</p></div>
        <div class="panel"><div class="panel-head"><h4>화면 읽는 법</h4></div><ul class="narrative">
          <li><b>개념 · 사용법</b>: 처음이면 여기부터. 상단 <b>사용법 투어</b>는 화면을 따라가며 안내한다</li>
          <li><b>작업함</b>: 에이전트가 만든 판단 대기 항목. 근거(룰 ID)·초안·변경안을 보고 확인·승인·반려</li>
          <li><b>타임라인</b>: 선석별 물리 상태와 레이타임 시계. 지금 선 오른쪽은 예측</li>
          <li><b>자원·제약</b>: 조석·파고·탱크·배관·예선·제품 전환·검사 제약이 언제 계획을 막았나 (시나리오·정책별)</li>
          <li><b>사례 복원</b>: 어려웠던 하루를 시점별로 — 그때 알던 것, 결정, 반사실</li>
          <li><b>계산서</b>: 시점 t 기준 항차별 레이타임 계산서(예측 포함)</li>
          <li><b>입력·계산기</b>: SOF를 붙여 넣으면 같은 엔진으로 계산. 04 문서 TC-01~05 정답과 비교</li>
          <li><b>검증 · 벤치마크 · 도입 검증</b>: 해결 대안 비교, 외부 사례, Shadow Mode·파일럿 단계</li>
          <li><b>룰·근거</b>: 공개자료·원문 대조 전·가정·쟁점 상태별 룰</li>
          <li>학습용 시뮬레이터(계획 편집 what-if)는 별도: <span class="mono">${esc(sim)}</span></li></ul></div>
      </div>
      ${renderRoadmapMap()}`;
  }
  // 로드맵 Phase → 프로토타입 화면. /api/discovery를 이미 받았으면 그 값(prototype.where)을 우선 쓴다
  const ROADMAP_MAP = [
    ['P0', 'Problem Framing', '로드맵 — 목표·7가지 Main Question'],
    ['P1', 'Port Call Process', '로드맵 — Port Call 프로세스 맵(단계 × 9관점) · 타임라인(물리 상태·SOF 이벤트)'],
    ['P2', 'Contract & Demurrage', '계산서 · 입력·계산기 · 룰·근거(계약 조항 룰)'],
    ['P3', 'Vessel / Arrival', '작업함 ETA 갱신 영향 · 진단(ETA 정확도)'],
    ['P4', 'Berth / Jetty', '자원·제약 — 선석·수심·제약 목록 · 룰·근거(선석 적합성) · 작업함 후보의 제외 사유'],
    ['P5', 'Cargo / Product', '자원·제약 — 선석별 제품·라인 전환(CHANGEOVER)'],
    ['P6', 'Tank / Storage', '자원·제약 — 탱크 재고(TANK·SHORE_TANK) · 작업함 탱크 레버(TK-104)'],
    ['P7', 'Pipeline / Equipment', '자원·제약 — 공유 주배관 사용률(PIPELINE)'],
    ['P8', 'Marine Service', '자원·제약 — 예선 수요·가용, 계류 감독(TUG)'],
    ['P9', 'Weather / Tide', '타임라인 풍속·조위 · 자원·제약 — 조석(UKC) 창·파고·시정(TIDE·WAVE·FOG)'],
    ['P10', 'Safety / Regulation', '자원·제약 — 검사(VETTING) · 룰·근거(야간 계류·주간 접안 등 하드 제약)'],
    ['P11', 'Current Decision Logic', '검증 — 현업 판단 로직(P11) · 현업 Rule 정책'],
    ['P12', 'Incident / Case Study', '사례 복원 — T-72h~결과 스냅샷·결정·반사실·교훈'],
    ['P13', 'Baseline / Performance', '진단 — KPI'],
    ['P14', 'Pareto / Segmentation', '진단 — Pareto'],
    ['P15', 'Root Cause', '진단 — 근본 원인 사슬'],
    ['P16', 'Controllability', '진단 — 통제 가능성 매트릭스'],
    ['P17', 'Value at Stake', '진단 — Value at Stake'],
    ['P18', 'Benchmark', '벤치마크 — 공개 사례 A–G × 15개 질문'],
    ['P19', 'Solution Option', '검증 — 해결 대안 비교(P19) · 정책 경쟁'],
    ['P20', 'Optimization Definition', '검증 — Optimizer 정책 · 작동 원리'],
    ['P21', 'Baseline Competition', '검증 — 정책 경쟁'],
    ['P22', 'Historical Replay', '검증 — 결정 시점별 리플레이(사후 정보 금지)'],
    ['P23', 'Scenario Analysis', '검증 — 시나리오 매트릭스'],
    ['P24', 'Sensitivity', '검증 — 민감도(토네이도)'],
    ['P25', 'Re-optimization Trigger', '로드맵 — 재계산 트리거 표 · 작업함'],
    ['P26', 'Agent Architecture', '작동 원리 — 파이프라인'],
    ['P27', 'Agent UX / HITL', '작업함 — 후보 카드(예상 체선료·이유·Risk·가정·대안)'],
    ['P28', 'Validation KPI', '도입 검증 — 검증 KPI · 감사 로그(Shadow mode KPI)'],
    ['P29', 'Business Case', '비즈니스 케이스'],
    ['P30', 'Implementation / Pilot', '도입 검증 — Shadow Mode·파일럿 단계·거버넌스'],
  ];
  function renderRoadmapMap() {
    const live = S.v2.discovery && S.v2.discovery.data ? arr(S.v2.discovery.data.phases) : [];
    const byId = Object.fromEntries(live.map((p) => [p.id, p]));
    return `<div class="panel"><div class="panel-head"><h4>로드맵 ↔ 프로토타입</h4><span class="hint">전략 컨설팅형 로드맵 P0~P30이 어느 화면에서 다뤄지는지${live.length ? ' · /api/discovery 기준' : ''}</span></div>
      <div class="table-scroll"><table><thead><tr><th>Phase</th><th>이름</th><th>프로토타입</th><th>상태</th></tr></thead><tbody>
      ${ROADMAP_MAP.map(([id, name, where]) => {
        const p = byId[id];
        const proto = p && p.prototype ? p.prototype : null;
        return `<tr><td class="mono">${esc(id)}</td><td>${esc(p ? p.name : name)}</td><td class="small">${esc(proto && proto.where ? proto.where : where)}${proto && proto.note ? `<div class="muted">${esc(proto.note)}</div>` : ''}</td><td>${proto ? `<span class="pill proto-${esc(proto.status)}">${esc(PROTO_LABEL[proto.status] || proto.status)}</span>` : ''}</td></tr>`;
      }).join('')}
      </tbody></table></div></div>`;
  }

  // ================================================================ v2 공통
  async function fetchV2(name, path, force) {
    const c = S.v2[name];
    if (!force && c && c.path === path && c.data) return c;
    try { S.v2[name] = { path, data: await GET(path), error: null }; } catch (e) { S.v2[name] = { path, data: null, error: e.message }; }
    return S.v2[name];
  }
  function v2Missing(path, err) {
    return `<div class="panel"><div class="empty"><b class="mono">${esc(path)}</b> 응답 없음 — ${esc(err || '')}
      <div class="small" style="margin-top:6px">이 화면은 로드맵 v2 API(docs/api.md v2)로 채워진다. 백엔드가 연결되지 않았거나 서버가 이전 코드로 떠 있으면 이렇게 보인다 — 서버를 다시 실행하고 새로고침하세요.</div></div></div>`;
  }
  const loadingPanel = (what) => `<div class="panel empty">${esc(what)} 불러오는 중…</div>`;
  const dstatusLabel = (code) => (S.v2.discovery && S.v2.discovery.data && S.v2.discovery.data.status_labels && S.v2.discovery.data.status_labels[code]) || DSTATUS[code] || code || '—';
  const dchip = (code) => `<span class="pill ds-${esc(code)}">${esc(dstatusLabel(code))}</span>`;
  function fmtPct(v, digits = 1) {
    if (v == null || isNaN(v)) return '—';
    const p = Math.abs(v) <= 1 ? v * 100 : Number(v);
    return `${p.toFixed(digits)}%`;
  }
  function fmtKpi(k) {
    const v = k.value;
    if (v == null || (typeof v === 'number' && isNaN(v))) return '—';
    if (typeof v === 'string') return esc(v);
    switch (k.unit) {
      case 'USD': return fmtUSD(v);
      case 'h': return fmtH(v);
      case '%': return fmtPct(v);
      case '척': return `${num(v, 1)}척`;
      case 'count': return num(v, 1);
      default: return `${num(v, 2)}${k.unit ? ' ' + esc(k.unit) : ''}`;
    }
  }
  function fmtKRW(usd, fx) {
    if (usd == null || isNaN(usd) || !fx) return '—';
    const w = Number(usd) * Number(fx);
    const a = Math.abs(w);
    const s = w < 0 ? '−' : '';
    if (a >= 1e8) return `${s}₩${(a / 1e8).toFixed(1)}억`;
    if (a >= 1e4) return `${s}₩${Math.round(a / 1e4).toLocaleString('en-US')}만`;
    return `${s}₩${Math.round(a).toLocaleString('en-US')}`;
  }
  const fmtMs = (ms) => (ms == null || isNaN(ms) ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
  const scoreChip = (v) => {
    if (v == null || v === '') return '<span class="muted">—</span>';
    const s = String(v);
    const lvl = { H: 'h', Y: 'h', M: 'm', PARTIAL: 'm', L: 'l', N: 'l' }[s.toUpperCase()];
    return lvl ? `<span class="sc sc-${lvl}">${esc(s === 'PARTIAL' ? '일부' : s)}</span>` : `<span class="small">${esc(s)}</span>`;
  };
  const classBadge = (c) => (c ? `<span class="cls cls-${esc(c)}">${esc(c)}</span>` : '');
  const linkBtn = (tab, anchor, label) => `<button type="button" class="linkbtn" data-goto="${esc(tab)}"${anchor ? ` data-anchor="${esc(anchor)}"` : ''}>${esc(label || (TAB_NAME[TAB_ALIAS[tab] || tab] || tab) + ' →')}</button>`;
  function sectionHead(title, hint, anchors) {
    return `<div class="section-head"${anchors ? ` data-anchors="${esc(anchors)}"` : ''}><h4>${esc(title)}</h4>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  }

  // ================================================================ 로드맵 (Discovery)
  async function renderDiscovery(force) {
    if (!(S.v2.discovery && S.v2.discovery.data)) main.innerHTML = loadingPanel('로드맵');
    const r = await fetchV2('discovery', '/api/discovery', force && !(S.v2.discovery && S.v2.discovery.data));
    if (S.tab !== 'discovery') return;
    if (!r.data) { main.innerHTML = v2Missing('/api/discovery', r.error); return; }
    const d = r.data;
    const ecIds = new Set(arr(d.evidence_chains).map((e) => e.id));
    main.innerHTML = `
      <div class="panel roadmap-head" data-anchors="goal top roadmap">
        <div class="eyebrow">전략 컨설팅형 Discovery &amp; Case Study 로드맵</div>
        <h2 class="goal">${esc(d.goal || '')}</h2>
        ${d.goal_result ? `<div class="goal-result"><span class="lbl">도출할 결과</span>${esc(d.goal_result)}</div>` : ''}
        ${arr(d.principles).length ? `<ul class="principles">${d.principles.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        <div class="remind">“${esc(REMIND)}” — 모든 조사에 붙이는 질문</div>
        <div class="legend" style="margin-top:8px">${DSTATUS_ORDER.slice().reverse().map((k) => `<span>${dchip(k)}</span>`).join('')}<span class="small muted">상태: 미확인 → 가설(문서 추정) → 가상 검증(가상 데이터) → 확인(현업)</span></div>
        ${discSummary(d.summary)}
        ${arr(d.notes).length ? `<ul class="dnotes">${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>
      ${storyFlow(d)}
      ${sectionHead('7가지 Main Question', '모든 조사·분석은 이 중 하나에 답해야 한다 · 근거를 누르면 Evidence Chain으로', 'main_questions mq')}
      <div class="mq-grid">${arr(d.main_questions).map((q) => `
        <div class="mq-card" data-anchors="${esc(q.id)}">
          <div class="mq-top"><span class="mq-id mono">${esc(q.id)}</span>${dchip(q.status)}</div>
          <div class="mq-q">${esc(q.question)}</div>
          <div class="small muted">결정되는 것 · <b>${esc(q.decides || '—')}</b>${arr(q.phases).length ? ` · Phase ${q.phases.map((p) => `<button type="button" class="linkbtn qph" data-qphase="${esc(p)}" title="${esc(phaseName(p))} — 이 Phase 질문만 보기">${esc(p)}</button>`).join(' ')}` : ''}</div>
          <div class="mq-a">${q.answer ? esc(q.answer) : '<span class="muted">아직 답 없음</span>'}</div>
          <div class="chips">${arr(q.evidence).map((id) => `<button type="button" class="linkbtn ec" data-ec="${esc(id)}" ${ecIds.has(id) ? '' : 'disabled title="해당 Evidence Chain 없음"'}>${esc(id)}</button>`).join('')}${arr(q.views).map((v) => linkBtn(v, null)).join('')}</div>
        </div>`).join('') || '<div class="empty">main_questions 없음</div>'}</div>
      <div class="grid2 v2grid">
        <div class="panel" data-anchors="coverage">
          <div class="panel-head"><h4>Coverage Map A–T</h4><span class="hint">칸을 누르면 아래 질문 시트를 그 영역으로 거른다</span></div>
          <div class="cov-grid">${arr(d.coverage).map(covCell).join('') || '<div class="empty">coverage 없음</div>'}</div>
        </div>
        <div class="panel" data-anchors="phases phase_rail">
          <div class="panel-head"><h4>Phase P0–P30 · 프로토타입 반영</h4><span class="hint">${Object.entries(PROTO_LABEL).map(([k, l]) => `<span class="pill proto-${k}">${l}</span>`).join(' ')}</span></div>
          ${phaseRail(arr(d.phases))}
        </div>
      </div>
      ${sectionHead('Evidence Chain', 'Question → Evidence → Insight → Decision → Requirement (로드맵 §31)', 'evidence_chains evidence')}
      <div class="ec-list">${arr(d.evidence_chains).map(ecCard).join('') || '<div class="panel empty">evidence_chains 없음</div>'}</div>
      ${processMapPanel(d.process_map)}
      ${stakeholderPanel(d.stakeholders)}
      <div class="grid2 v2grid">
        <div class="panel" data-anchors="hypotheses">
          <div class="panel-head"><h4>가설 목록</h4><span class="hint">${arr(d.hypotheses).length}건</span></div>
          <div class="table-scroll"><table><thead><tr><th>ID</th><th>가설</th><th>검증 방법</th><th>상태</th></tr></thead><tbody>
          ${arr(d.hypotheses).map((h) => `<tr><td class="mono">${esc(h.id)}</td><td>${esc(h.statement)}${h.source ? `<div class="small muted">${esc(h.source)}</div>` : ''}</td><td class="small">${esc(h.test || '')}</td><td>${dchip(h.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">가설 없음</td></tr>'}
          </tbody></table></div>
        </div>
        <div class="panel" data-anchors="triggers reoptimization">
          <div class="panel-head"><h4>재계산 트리거 (Phase 25)</h4><span class="hint">누가·어떤 데이터로 감지하고, 즉시 계산인지 승인 후인지</span></div>
          <div class="table-scroll"><table><thead><tr><th>트리거</th><th>감지</th><th>데이터</th><th>동작</th><th>구현</th></tr></thead><tbody>
          ${arr(d.triggers).map((g) => `<tr><td><b>${esc(g.trigger)}</b>${g.threshold ? `<div class="small muted">${esc(g.threshold)}</div>` : ''}</td><td class="small">${esc(g.detector || '')}</td><td class="small">${esc(g.data || '')}</td><td><span class="pill ${g.action === 'AUTO_RECALC' ? 'k' : 'sev-medium'}">${esc(ACTION2_LABEL[g.action] || g.action || '')}</span></td><td>${g.implemented ? '<span class="pill ok">✓ 구현</span>' : '<span class="pill k">✗ 미구현</span>'} ${chip(g.rule)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">트리거 없음</td></tr>'}
          </tbody></table></div>
        </div>
      </div>
      <div class="panel" data-anchors="questions question_sheet sheet">
        <div class="panel-head"><h4>Discovery Question Sheet</h4><span class="hint" id="qCount"></span></div>
        <div class="remind small">“${esc(REMIND)}” — 답해도 아무 결정도 바뀌지 않는 질문은 우선순위를 낮춘다 (로드맵 §32)</div>
        <div class="form qfilters">
          <label>Phase<select id="qfPhase"><option value="">전체</option>${uniq(arr(d.questions).map((q) => q.phase)).sort(byPhase).map((p) => `<option value="${esc(p)}">${esc(p)} ${esc(phaseName(p))}</option>`).join('')}</select></label>
          <label>영역(Domain)<select id="qfDomain"><option value="">전체</option>${uniq(arr(d.questions).map((q) => q.domain)).sort().map((x) => `<option value="${esc(x)}">${esc(x)} ${esc(domainName(x))}</option>`).join('')}</select></label>
          <label>상태<select id="qfStatus"><option value="">전체</option>${DSTATUS_ORDER.map((k) => `<option value="${k}">${esc(dstatusLabel(k))}</option>`).join('')}</select></label>
          <label class="chk"><input type="checkbox" id="qfMentor"> 멘토 확인 필요만</label>
          <label style="grid-column:span 3">검색<input type="search" id="qfQ" placeholder="질문·주제·답 검색"></label>
          <label class="btnlabel"><button type="button" class="btn" id="qExport">CSV 내보내기</button></label>
        </div>
        <div id="qTable"></div>
      </div>
      ${discAppendix(d)}`;
    $('#qfPhase').value = S.qf.phase;
    $('#qfDomain').value = S.qf.domain;
    $('#qfStatus').value = S.qf.status;
    $('#qfMentor').checked = S.qf.mentor;
    $('#qfQ').value = S.qf.q;
    drawQuestionSheet();
    if (S.pendingAnchor) flushAnchor();
  }
  function discSummary(s) {
    if (!s || !s.questions) return '';
    const bs = s.by_status || {};
    return `<div class="disc-sum">${statusBar(bs, s.questions)}<div class="small muted">질문 <b>${num(s.questions)}</b>개 · ${DSTATUS_ORDER.slice().reverse().map((k) => `${esc(dstatusLabel(k))} ${num(bs[k] || 0)}`).join(' · ')}${s.need_mentor != null ? ` · 멘토 확인 필요 ${num(s.need_mentor)}` : ''}</div></div>`;
  }
  const flowLine = (xs) => `<div class="flowline">${xs.map((x, i) => `${i ? '<span class="fl-arrow" aria-hidden="true">→</span>' : ''}<span class="fl-step">${esc(x)}</span>`).join('')}</div>`;
  function storyFlow(d) {
    const story = arr(d.story), flow = arr(d.flow);
    if (!story.length && !flow.length) return '';
    return `<div class="grid2 v2grid">
      ${story.length ? `<div class="panel" data-anchors="story storyline"><div class="panel-head"><h4>최종 스토리라인</h4><span class="hint">지금까지 숫자로 채운 결론 · 가상 데이터</span></div><ul class="story">${story.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${flow.length ? `<div class="panel" data-anchors="flow"><div class="panel-head"><h4>Discovery → Pilot 흐름</h4><span class="hint">${flow.length}단계</span></div>${flowLine(flow)}</div>` : ''}
    </div>`;
  }
  function discAppendix(d) {
    // 로드맵의 방법론 부록 — 응답에 있는 항목만 접이식으로
    const parts = [];
    if (arr(d.core_questions).length) parts.push(['core_questions', '핵심 질문', `${d.core_questions.length}개 · 모든 Phase를 관통`, `<ol class="appx-ol">${d.core_questions.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`]);
    if (arr(d.variable_gate).length) parts.push(['variable_gate', '변수 채택 게이트', '모두 “예”일 때만 Optimizer·Agent 변수로 넣는다', `<ol class="appx-ol">${d.variable_gate.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`]);
    if (arr(d.process_stages).length && !arr(d.process_map).length) parts.push(['process_map port_call', 'Port Call 프로세스 맵', `${d.process_stages.length}단계${arr(d.process_lenses).length ? ` × ${d.process_lenses.length}관점` : ''}`,
      `${flowLine(d.process_stages)}${arr(d.process_lenses).length ? `<div class="small muted" style="margin-top:8px">단계마다 보는 관점 · ${d.process_lenses.map((x) => `<span class="pill k">${esc(x)}</span>`).join(' ')}</div>` : ''}`]);
    if (arr(d.controllability_classes).length) parts.push(['controllability_classes', '통제 가능성 분류', 'A–D · 진단 화면에서 원인별로 분류', `<div class="table-scroll"><table><thead><tr><th>분류</th><th>판단 기준</th></tr></thead><tbody>${d.controllability_classes.map((c) => `<tr><td>${classBadge(c.class)} ${esc(c.label || '')}</td><td class="small">${esc(c.rule || '')}</td></tr>`).join('')}</tbody></table></div><div style="margin-top:6px">${linkBtn('diagnosis', 'controllability', '진단 화면의 분류 결과 →')}</div>`]);
    if (arr(d.benchmark_cases).length || arr(d.benchmark_template).length) parts.push(['benchmark case_study', '외부 Case Study / Benchmark', `${arr(d.benchmark).length || arr(d.benchmark_cases).length}개 사례 · 같은 틀로 비교`,
      `${arr(d.benchmark_cases).length ? `<div class="chips">${d.benchmark_cases.map((x) => `<span class="pill k">${esc(x)}</span>`).join('')}</div>` : ''}<div style="margin-top:6px">${linkBtn('benchmark', null, arr(d.benchmark).length ? '벤치마크 사례 카드 →' : '벤치마크 화면 →')}</div>${arr(d.benchmark_template).length ? `<div class="table-scroll" style="margin-top:8px"><table><thead><tr><th>항목</th><th>사례마다 답할 질문</th></tr></thead><tbody>${d.benchmark_template.map((t) => `<tr><td class="mono small">${esc(t.key)}</td><td class="small">${esc(t.question || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}`]);
    if (arr(d.solution_options).length) parts.push(['solution_options', '해결 대안', `${d.solution_options.length}개 옵션 · 검증 화면에서 정책으로 비교`, `<div class="chips">${d.solution_options.map((o) => `<span class="pill k"><b class="mono">${esc(o.id)}</b> ${esc(o.label || '')}</span>`).join('')}</div><div style="margin-top:6px">${linkBtn('validation', 'solution_matrix', '해결 대안 비교(P19) →')} ${linkBtn('validation', 'competition', '정책 경쟁 결과 →')}</div>`]);
    if (arr(d.pilot_stages).length) parts.push(['pilot pilot_stages', 'Pilot / 확장 단계', 'Shadow Mode에서 수용률을 먼저 잰다', `${flowLine(d.pilot_stages)}<div style="margin-top:6px">${linkBtn('assurance', 'pilot', '도입 검증 — 파일럿 단계 →')} ${linkBtn('assurance', 'shadow', 'Shadow Mode 일치율 →')}</div>`]);
    if (d.deliverables && typeof d.deliverables === 'object' && !Array.isArray(d.deliverables)) parts.push(['deliverables', '단계별 산출물', `${Object.keys(d.deliverables).length}단계`, `<div class="dlv-grid">${Object.entries(d.deliverables).map(([k, xs]) => `<div class="dlv"><b>${esc(k)}</b><ul>${arr(xs).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>`]);
    if (!parts.length) return '';
    return `${sectionHead('방법론 부록', '로드맵의 틀 — 눌러서 펼치기', 'appendix methodology')}
      ${parts.map(([anchors, title, hint, body]) => `<details class="panel appx" data-anchors="${esc(anchors)}"><summary><b>${esc(title)}</b><span class="hint">${esc(hint)}</span></summary><div class="appx-body">${body}</div></details>`).join('')}`;
  }
  const uniq = (xs) => [...new Set(xs.filter((x) => x != null && x !== ''))];
  const phaseNo = (p) => { const m = /(\d+)/.exec(String(p || '')); return m ? Number(m[1]) : 999; };
  const byPhase = (a, b) => phaseNo(a) - phaseNo(b) || String(a).localeCompare(String(b));
  function phaseName(id) { const d = S.v2.discovery && S.v2.discovery.data; const p = d && arr(d.phases).find((x) => x.id === id); return p ? p.name : ''; }
  function domainName(id) { const d = S.v2.discovery && S.v2.discovery.data; const c = d && arr(d.coverage).find((x) => x.id === id); return c ? c.name : ''; }
  function statusBar(bs, total) {
    const t = total || Object.values(bs || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    if (!t) return '<div class="sbar empty"></div>';
    return `<div class="sbar">${DSTATUS_ORDER.map((k) => {
      const n = Number((bs || {})[k]) || 0;
      return n ? `<i class="ds-bg-${k}" style="width:${((n / t) * 100).toFixed(2)}%" title="${esc(dstatusLabel(k))} ${n}"></i>` : '';
    }).join('')}</div>`;
  }
  function covCell(c) {
    const bs = c.by_status || {};
    const answered = (Number(bs.CONFIRMED) || 0) + (Number(bs.VIRTUAL) || 0) + (Number(bs.HYPOTHESIS) || 0);
    return `<button type="button" class="cov-cell ${S.qf.domain === c.id ? 'active' : ''}" data-domain="${esc(c.id)}" title="${esc(c.note || '')}">
      <div class="cov-top"><b class="mono">${esc(c.id)}</b><span class="pill mod-${esc(c.modeled)}">${esc(MODELED_LABEL[c.modeled] || c.modeled || '')}</span></div>
      <div class="cov-name">${esc(c.name)}</div>
      ${statusBar(bs, c.total)}
      <div class="small muted">${num(c.total)}문항 · 답 ${answered}</div>
    </button>`;
  }
  function phaseRail(phases) {
    if (!phases.length) return '<div class="empty">phases 없음</div>';
    return PHASE_BANDS.map(([band, a, b]) => {
      const ps = phases.filter((p) => phaseNo(p.id) >= a && phaseNo(p.id) <= b);
      if (!ps.length) return '';
      return `<div class="band"><div class="band-name">${esc(band)}</div><div class="band-row">${ps.map((p) => {
        const pr = p.prototype || {};
        return `<div class="ph proto-b-${esc(pr.status || 'NONE')}" data-qphase="${esc(p.id)}" role="button" tabindex="0" title="${esc([p.question, p.goal, arr(p.outputs).join(' · '), pr.note, '누르면 이 Phase 질문만 보기'].filter(Boolean).join('\n'))}">
          <div class="ph-top"><span class="mono">${esc(p.id)}</span><span class="pill proto-${esc(pr.status || 'NONE')}">${esc(PROTO_LABEL[pr.status] || pr.status || '없음')}</span></div>
          <div class="ph-name">${esc(p.name)}</div>
          ${pr.where ? `<div class="ph-where">${esc(pr.where)}</div>` : ''}
        </div>`;
      }).join('')}</div></div>`;
    }).join('') + (() => {
      const rest = phases.filter((p) => !PHASE_BANDS.some(([, a, b]) => phaseNo(p.id) >= a && phaseNo(p.id) <= b));
      return rest.length ? `<div class="band"><div class="band-name">기타</div><div class="band-row">${rest.map((p) => `<div class="ph"><span class="mono">${esc(p.id)}</span> ${esc(p.name)}</div>`).join('')}</div></div>` : '';
    })();
  }
  function ecCard(e) {
    const steps = [['Question', e.question], ['Evidence', e.evidence], ['Insight', e.insight], ['Decision', e.decision], ['Requirement', e.requirement]];
    const ln = e.link && e.link.tab ? linkBtn(e.link.tab, e.link.anchor, `근거 화면: ${TAB_NAME[TAB_ALIAS[e.link.tab] || e.link.tab] || e.link.tab} →`) : '';
    return `<div class="ec panel" id="ec-${esc(e.id)}" data-anchors="${esc(e.id)}">
      <div class="ec-head"><span class="mono"><b>${esc(e.id)}</b></span>${e.main_question ? `<span class="pill k">${esc(e.main_question)}</span>` : ''}<span class="pill basis-${esc(e.basis)}">${esc(BASIS_LABEL[e.basis] || e.basis || '')}</span>${ln}</div>
      <div class="ec-flow">${steps.map(([k, v], i) => `${i ? '<span class="ec-arrow" aria-hidden="true">→</span>' : ''}<div class="ec-step s${i}"><span class="lbl">${k}</span><div>${esc(v || '—')}</div></div>`).join('')}</div>
    </div>`;
  }
  function filteredQuestions() {
    const d = S.v2.discovery && S.v2.discovery.data;
    const f = S.qf;
    const q = f.q.trim().toLowerCase();
    return arr(d && d.questions).filter((x) => (!f.phase || x.phase === f.phase) && (!f.domain || x.domain === f.domain)
      && (!f.status || x.status === f.status) && (!f.mentor || x.need_mentor)
      && (!q || [x.id, x.topic, x.question, x.why, x.answer, x.evidence, x.insight, x.decision_impact, x.need_data].join(' ').toLowerCase().includes(q)));
  }
  function drawQuestionSheet() {
    const box = $('#qTable');
    if (!box) return;
    const d = S.v2.discovery && S.v2.discovery.data;
    const all = arr(d && d.questions);
    const rows = filteredQuestions();
    const cnt = $('#qCount');
    if (cnt) cnt.textContent = `${rows.length} / ${all.length}문항 · 멘토 확인 ${rows.filter((x) => x.need_mentor).length}`;
    $$('.cov-cell').forEach((c) => c.classList.toggle('active', c.dataset.domain === S.qf.domain));
    const shown = rows.slice(0, 800);
    box.innerHTML = `<div class="table-scroll"><table class="qsheet"><thead><tr><th>ID</th><th>Phase</th><th>영역</th><th>질문</th><th>상태</th><th>멘토</th><th>결정 영향</th></tr></thead><tbody>
      ${shown.map((x) => {
        const open = S.qOpen.has(x.id);
        return `<tr class="qrow ${open ? 'open' : ''}" data-q="${esc(x.id)}" tabindex="0" title="${esc(x.sub || '')}"><td class="mono small">${esc(x.id)}</td><td class="mono small" title="${esc(phaseName(x.phase))}">${esc(x.phase)}</td><td class="mono small" title="${esc(domainName(x.domain))}">${esc(x.domain)}</td>
          <td>${x.topic ? `<span class="pill k">${esc(x.topic)}</span> ` : ''}${esc(x.question)}</td><td>${dchip(x.status)}</td><td>${x.need_mentor ? '<span class="pill sev-medium">O</span>' : ''}</td><td class="small">${esc(x.decision_impact || '')}</td></tr>
          ${open ? `<tr class="qdetail"><td colspan="7"><dl class="kv">
            <dt>Why</dt><dd>${esc(x.why || '—')}</dd>
            <dt>결정 영향</dt><dd>${esc(x.decision_impact || '—')}</dd>
            <dt>필요 데이터</dt><dd>${esc(x.need_data || '—')}</dd>
            <dt>Answer</dt><dd>${esc(x.answer || '—')}</dd>
            <dt>Evidence</dt><dd>${esc(x.evidence || '—')}</dd>
            <dt>Insight</dt><dd>${esc(x.insight || '—')}</dd>
            <dt>출처</dt><dd class="small muted">${esc(x.source || '—')} · ${esc(x.sub || phaseName(x.phase))} · ${esc(domainName(x.domain))}</dd></dl></td></tr>` : ''}`;
      }).join('') || '<tr><td colspan="7" class="empty">조건에 맞는 질문 없음</td></tr>'}
      </tbody></table></div>${rows.length > shown.length ? `<p class="small muted">상위 ${shown.length}건만 표시 — 필터로 좁히거나 CSV로 내보내세요</p>` : ''}`;
  }
  function exportQuestionsCsv() {
    const rows = filteredQuestions();
    const head = ['Phase', 'Domain', 'Question', 'Why', 'Answer', 'Evidence', 'Insight', 'Decision Impact', 'Need Data', 'Need Mentor', 'Status'];
    const cell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head.join(',')].concat(rows.map((q) => [
      [q.phase, phaseName(q.phase)].filter(Boolean).join(' '), [q.domain, domainName(q.domain)].filter(Boolean).join(' '),
      q.question, q.why, q.answer, q.evidence, q.insight, q.decision_impact, q.need_data, q.need_mentor ? 'O' : '', dstatusLabel(q.status),
    ].map(cell).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `discovery-question-sheet${S.qf.domain ? '-' + S.qf.domain : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    showOk(`질문 ${rows.length}건을 CSV로 내보냈습니다 (UTF-8, 엑셀에서 바로 열림)`);
  }
  function openEvidenceChain(id) {
    const el = document.getElementById('ec-' + id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  }

  // ================================================================ 진단
  async function renderDiagnosis(force) {
    const cs = S.diagCase;
    const versions = arr(S.state && S.state.plan_history).length;
    const key = `${cs}|${cs === 'current' ? versions + ':' + arr(S.state && S.state.plan_history).map((h) => h.version + '@' + h.effective_from).join(',') : 'base'}`;
    let c = S.v2.diag[key];
    if (!c || !c.data || (force && c.error)) {
      main.innerHTML = loadingPanel('진단');
      try { c = { data: await GET(`/api/diagnosis?case=${encodeURIComponent(cs)}`), error: null }; } catch (e) { c = { data: null, error: e.message }; }
      S.v2.diag[key] = c;
    }
    if (S.tab !== 'diagnosis' || S.diagCase !== cs) return;
    if (!c.data) { main.innerHTML = diagToggle() + v2Missing(`/api/diagnosis?case=${cs}`, c.error); return; }
    const d = c.data;
    S.v2.diagShown = d;
    const k = d.kpi || {};
    main.innerHTML = `
      ${diagToggle(d)}
      <div data-anchors="kpi baseline performance">${KPI_GROUPS.map(([g, label]) => arr(k[g]).length ? `
        <div class="kpi-group"><div class="kg-name">${esc(label)}</div><div class="kpis v2">${k[g].map((x) => `
          <div class="kpi" title="${esc(x.note || '')}"><span class="label">${esc(x.label)}</span><span class="value ${x.unit === 'USD' && x.value > 0 ? 'dem' : ''}">${fmtKpi(x)}</span>${x.note ? `<span class="sub">${esc(x.note)}</span>` : ''}</div>`).join('')}</div></div>` : '').join('') || '<div class="panel empty">kpi 없음</div>'}</div>
      <div class="panel" data-anchors="pareto segmentation">
        <div class="panel-head"><h4>Pareto — 어디에 문제가 몰리나 (Phase 14)</h4>
          <div class="seg-wrap"><div class="seg">${paretoDims(d).map(([v, l]) => `<button type="button" class="${S.paretoDim === v ? 'active' : ''}" data-pareto-dim="${v}">${esc(l)}</button>`).join('')}</div>
          <div class="seg">${PARETO_METRICS.map(([v, l]) => `<button type="button" class="${S.paretoMetric === v ? 'active' : ''}" data-pareto-metric="${v}">${l}</button>`).join('')}</div></div></div>
        <div id="paretoBox"></div>
        ${arr(d.pareto && d.pareto.notes).length ? `<ul class="narrative small muted" style="margin-top:6px">${d.pareto.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="panel" data-anchors="per_call percall calls">
        <div class="panel-head"><h4>항차별 시간·비용 분해</h4><span class="hint">Port Stay = 묘박 대기 + 이동 + 작업 + 유휴</span></div>
        <div class="table-scroll"><table><thead><tr><th>선박</th><th>선석</th><th>계약</th><th class="num">체선료</th><th class="num">체선</th><th class="num">Port Stay</th><th class="num">묘박 대기</th><th class="num">접안 후 대기</th><th class="num">작업</th><th class="num">하역 중단</th><th class="num">유휴</th></tr></thead><tbody>
        ${arr(d.per_call).map((p) => `<tr><td><b>${esc(p.vessel || vesselName(p.call_id))}</b><div class="small muted">${esc(p.vessel_type || '')}${p.operation ? ' · ' + esc(p.operation === 'LOAD' ? '선적' : '양하') : ''} · <span class="mono">${esc(p.call_id)}</span></div></td><td>${esc(p.berth_id || '')}</td><td class="small">${esc(LAYER_LABEL[p.layer] || p.layer || '')}</td><td class="num ${p.amount_usd > 0 ? 'pos' : ''}">${fmtUSD(p.amount_usd)}</td><td class="num">${fmtH(p.demurrage_h)}</td><td class="num">${fmtH(p.port_stay_h)}</td><td class="num">${fmtH(p.anchorage_wait_h)}</td><td class="num">${fmtH(p.berth_wait_h)}</td><td class="num">${fmtH(p.operation_h)}</td><td class="num">${fmtH(p.stop_h)}</td><td class="num">${fmtH(p.idle_h)}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">per_call 없음</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="panel" data-anchors="root_causes rootcause root_cause">
        <div class="panel-head"><h4>근본 원인 — “왜 기다렸는가?”를 끝까지 (Phase 15)</h4><span class="hint">체선료가 생긴 항차별 원인 사슬</span></div>
        <div class="rc-grid">${arr(d.root_causes).map((rc) => `
          <div class="rc">
            <div class="rc-head"><b>${esc(rc.vessel || vesselName(rc.call_id))}</b><span class="mono pos">${fmtUSD(rc.amount_usd)}</span></div>
            <ol class="rc-chain">${arr(rc.chain).map((s) => `<li style="--lv:${Number(s.level) || 0}"><span class="rc-arrow">${(Number(s.level) || 0) ? '↳' : '●'}</span><span class="rc-t">${esc(s.text)} ${chip(s.rule)}</span></li>`).join('')}</ol>
            <div class="chips"><span class="pill ${rc.structural ? 'sev-high' : 'k'}">${rc.structural ? '구조적·반복' : '일회성'}</span>${rc.predictable ? `<span class="small muted">예측: ${esc(rc.predictable)}</span>` : ''}</div>
            ${rc.decision_alternative ? `<div class="rc-alt"><b>다른 의사결정이었다면</b> ${esc(rc.decision_alternative)}${rc.alternative && rc.alternative.item_id ? ` ${linkBtn('inbox', rc.alternative.item_id, '작업함 항목 →')}` : ''}</div>` : ''}
          </div>`).join('') || '<div class="empty">체선료가 생긴 항차가 없거나 root_causes 없음</div>'}</div>
      </div>
      <div class="panel" data-anchors="controllability control matrix">
        <div class="panel-head"><h4>통제 가능성 매트릭스 (Phase 16)</h4><span class="hint">문제를 발견했다고 모두 해결 대상은 아니다</span></div>
        <div class="cls-legend">${CLASS_LEGEND.map(([c, a, b]) => `<div>${classBadge(c)}<b>${esc(a)}</b><span class="small muted">→ ${esc(b)}</span>${d.class_shares && d.class_shares[c] ? `<span class="mono small">${fmtUSD(d.class_shares[c].usd)} · ${fmtPct(d.class_shares[c].share)}</span>` : ''}</div>`).join('')}</div>
        ${d.class_shares ? `<div class="sbar cls-bar" title="체선료 비용의 분류별 비중">${CLASS_LEGEND.map(([c]) => { const s = d.class_shares[c]; const sh = s ? (Math.abs(s.share) <= 1 ? s.share * 100 : s.share) : 0; return sh > 0 ? `<i class="cls-bg-${c}" style="width:${sh.toFixed(2)}%" title="${c} ${sh.toFixed(1)}%"></i>` : ''; }).join('')}</div>` : ''}
        <div class="table-scroll"><table class="ctl"><thead><tr><th>원인</th><th class="num">비용</th><th class="num">빈도</th>${SCORE_KEYS.map((s) => `<th class="sch">${esc(SCORE_LABEL[s])}</th>`).join('')}<th>분류</th></tr></thead><tbody>
        ${arr(d.controllability).map((x) => `<tr><td><b>${esc(x.label || x.key)}</b><div class="small muted mono">${esc([x.code, x.key].filter(Boolean).join(' · '))}</div>${x.rationale ? `<div class="small">${esc(x.rationale)}</div>` : ''}${x.basis ? `<span class="pill sev-warning">${esc(x.basis)}</span>` : ''}</td>
          <td class="num">${fmtUSD(x.cost_usd)}</td><td class="num">${num(x.frequency)}</td>${SCORE_KEYS.map((s) => `<td class="sc-c${s === 'lead_time' ? ' lt' : ''}">${scoreChip((x.scores || {})[s])}</td>`).join('')}<td>${classBadge(x.class)}<div class="small">${esc(x.class_label || '')}</div>${x.solution ? `<span class="pill k">${esc(x.solution)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="14" class="empty">controllability 없음</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="panel" data-anchors="value_at_stake vas value">
        <div class="panel-head"><h4>Value at Stake — 실제로 줄일 수 있는 비용 (Phase 17)</h4><span class="hint">총 체선료 → 통제 불가 제거 → … → 기대 절감</span></div>
        ${vasWaterfall(arr(d.value_at_stake && d.value_at_stake.steps))}
        ${arr(d.value_at_stake && d.value_at_stake.assumptions).length ? `<h3 style="margin-top:10px">가정</h3><ul class="narrative small">${d.value_at_stake.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      </div>`;
    drawPareto(d);
    if (S.pendingAnchor) flushAnchor();
  }
  function diagToggle(d) {
    return `<div class="panel v2head"><div class="panel-head" style="margin:0"><h4>진단 — 현재 상태가 실제로 얼마나 나쁜가</h4>
      <div class="seg"><button type="button" class="${S.diagCase === 'base' ? 'active' : ''}" data-diag-case="base">기준 계획 그대로</button><button type="button" class="${S.diagCase === 'current' ? 'active' : ''}" data-diag-case="current">내 결정 반영</button></div></div>
      <p class="small muted" style="margin-top:6px">${d && d.status ? `${dchip(d.status)} ` : ''}${d ? `${esc(d.label || '')} · 계획 버전 ${esc(d.plan_versions ?? '—')} · ` : ''}가상 시나리오(울산 11/03~07)의 실제 결과(truth)를 채점한 값이다. 실제 터미널 수치가 아니다.</p>
      ${d && arr(d.notes).length ? `<ul class="narrative small muted" style="margin-top:4px">${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  function paretoRows(d) {
    const metric = S.paretoMetric;
    const rows = arr(d.pareto && d.pareto[S.paretoDim]).map((r) => ({ ...r, m: Number(r[metric]) || 0 })).sort((a, b) => b.m - a.m);
    const total = rows.reduce((a, r) => a + Math.max(0, r.m), 0) || 0;
    let cum = 0;
    return rows.map((r) => { cum += Math.max(0, r.m); return { ...r, share2: total ? r.m / total : 0, cum2: total ? cum / total : 0 }; });
  }
  function drawPareto(d) {
    const box = $('#paretoBox');
    if (!box) return;
    const dims = paretoDims(d);
    if (dims.length && !dims.some(([k]) => k === S.paretoDim)) {
      S.paretoDim = dims[0][0];
      $$('[data-pareto-dim]').forEach((b) => b.classList.toggle('active', b.dataset.paretoDim === S.paretoDim));
    }
    const rows = paretoRows(d);
    const hasMarg = rows.some((r) => r.marginal_usd != null);
    if (!rows.length) { box.innerHTML = '<div class="empty">pareto 데이터 없음</div>'; return; }
    const fmtM = (v) => (S.paretoMetric === 'cost_usd' ? fmtUSD(v) : S.paretoMetric === 'duration_h' ? fmtH(v) : num(v));
    const W = 760, H = 250, L = 64, R = 46, T = 14, B = 58;
    const pw = W - L - R, ph = H - T - B;
    const n = rows.length;
    const max = Math.max(...rows.map((r) => r.m), 1);
    const slot = pw / n, bw = Math.min(64, slot * 0.66);
    const Y = (v) => T + ph - (v / max) * ph;
    const Yc = (f) => T + ph - f * ph;
    const bars = rows.map((r, i) => {
      const x = L + i * slot + (slot - bw) / 2;
      const lbl = String(r.label || r.key || '');
      const short = lbl.length > 9 ? lbl.slice(0, 8) + '…' : lbl;
      return `<rect class="pa-bar ${i === 0 ? 'top' : ''}" x="${x}" y="${Y(r.m)}" width="${bw}" height="${Math.max(0.5, T + ph - Y(r.m))}"><title>${esc(lbl)}: ${esc(fmtM(r.m))} (${(r.share2 * 100).toFixed(1)}%)</title></rect>
        <text class="pa-lbl" x="${x + bw / 2}" y="${T + ph + 14}" text-anchor="middle">${esc(short)}</text>
        ${r.code ? `<text class="pa-sub" x="${x + bw / 2}" y="${T + ph + 27}" text-anchor="middle">${esc(r.code)}</text>` : ''}`;
    }).join('');
    const pts = rows.map((r, i) => [L + i * slot + slot / 2, Yc(r.cum2)]);
    const line = `<polyline class="pa-cum" points="${pts.map((p) => p.join(',')).join(' ')}"/>${pts.map((p, i) => `<circle class="pa-dot" cx="${p[0]}" cy="${p[1]}" r="3"><title>누적 ${(rows[i].cum2 * 100).toFixed(1)}%</title></circle>`).join('')}`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line class="pa-grid" x1="${L}" x2="${L + pw}" y1="${Yc(f)}" y2="${Yc(f)}"/><text class="pa-ax" x="${L - 6}" y="${Yc(f) + 3}" text-anchor="end">${esc(fmtM(max * f))}</text><text class="pa-ax" x="${L + pw + 6}" y="${Yc(f) + 3}">${Math.round(f * 100)}%</text>`).join('');
    const p80 = `<line class="pa-80" x1="${L}" x2="${L + pw}" y1="${Yc(0.8)}" y2="${Yc(0.8)}"/><text class="pa-ax" x="${L + pw - 2}" y="${Yc(0.8) - 4}" text-anchor="end">80%</text>`;
    box.innerHTML = `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="min-width:560px;width:100%;height:auto" role="img" aria-label="Pareto 차트">${ticks}${p80}${bars}${line}</svg></div>
      <div class="legend"><span><i class="pa-l-bar"></i>${esc((PARETO_METRICS.find((m) => m[0] === S.paretoMetric) || [])[1] || '')}</span><span><i class="pa-l-cum"></i>누적 비중</span><span class="small muted">비중은 고른 지표 기준으로 다시 계산</span></div>
      <div class="table-scroll" style="margin-top:6px"><table><thead><tr><th>${esc((paretoDims(d).find((x) => x[0] === S.paretoDim) || [])[1] || '')}</th><th class="num">빈도</th><th class="num">시간</th><th class="num">금액(배분)</th>${hasMarg ? '<th class="num" title="그 원인만 없었다면 줄었을 체선료 — 원인끼리 겹쳐 합계 ≠ 총액">단독 제거 효과</th>' : ''}<th class="num">비중</th><th class="num">누적</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.label || r.key)}${r.code ? ` <span class="mono small muted">${esc(r.code)}</span>` : ''}</td><td class="num">${num(r.frequency)}</td><td class="num">${fmtH(r.duration_h)}</td><td class="num">${fmtUSD(r.cost_usd)}</td>${hasMarg ? `<td class="num">${r.marginal_usd != null ? fmtUSD(r.marginal_usd) : '—'}</td>` : ''}<td class="num">${(r.share2 * 100).toFixed(1)}%</td><td class="num">${(r.cum2 * 100).toFixed(1)}%</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  function vasWaterfall(steps) {
    if (!steps.length) return '<div class="empty">value_at_stake 없음</div>';
    let run = 0;
    const rows = steps.map((s) => {
      const v = Number(s.usd) || 0;
      const kind = s.kind || 'subtotal';
      let a, b;
      if (kind === 'minus') { const amt = Math.abs(v); a = run - amt; b = run; run -= amt; } else { a = 0; b = v; run = v; }
      return { ...s, kind, a, b, v };
    });
    const max = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b)));
    const W = 760, LW = 230, VW = 120, rowH = 30, H = rows.length * rowH + 8;
    const X = (v) => LW + (Math.max(0, v) / max) * (W - LW - VW);
    const g = rows.map((r, i) => {
      const y = 4 + i * rowH;
      const x0 = X(Math.min(r.a, r.b)), x1 = X(Math.max(r.a, r.b));
      const val = r.kind === 'minus' ? `−${fmtUSD(Math.abs(r.v))}` : fmtUSD(r.v);
      const conn = i < rows.length - 1 ? `<line class="wf-conn" x1="${X(r.kind === 'minus' ? r.a : r.b)}" x2="${X(r.kind === 'minus' ? r.a : r.b)}" y1="${y + rowH - 7}" y2="${y + rowH + 5}"/>` : '';
      const lbl = String(r.label || r.key || '');
      return `<text class="wf-label" x="0" y="${y + rowH / 2 + 4}">${esc(lbl.length > 30 ? lbl.slice(0, 29) + '…' : lbl)}</text>
        <rect class="vas-${esc(r.kind)}" x="${x0}" y="${y + 5}" width="${Math.max(1.5, x1 - x0)}" height="${rowH - 12}" rx="2"><title>${esc(lbl)}: ${esc(val)}${r.note ? '\n' + esc(r.note) : ''}</title></rect>${conn}
        <text class="wf-val" x="${W}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(val)}</text>`;
    }).join('');
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="min-width:600px;width:100%;height:auto" role="img" aria-label="Value at Stake">${g}</svg></div>
      <div class="legend"><span><i class="vas-l-total"></i>총액</span><span><i class="vas-l-minus"></i>제외(통제·대응 불가 등)</span><span><i class="vas-l-subtotal"></i>중간 합계</span><span><i class="vas-l-result"></i>결과</span></div>
      <div class="table-scroll" style="margin-top:6px"><table><thead><tr><th>단계</th><th class="num">금액</th><th>메모</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r.kind === 'result' ? 'hl' : ''}"><td>${esc(r.label || r.key)}</td><td class="num">${r.kind === 'minus' ? '−' + fmtUSD(Math.abs(r.v)) : fmtUSD(r.v)}</td><td class="small">${esc(r.note || '')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ================================================================ 검증
  async function renderValidation(force) {
    if (!(S.v2.validation && S.v2.validation.data)) main.innerHTML = loadingPanel('검증 결과');
    // 해결 대안 비교(P19)·현업 판단 로직(P11)은 /api/discovery에 있다 — 함께 받는다
    const [r] = await Promise.all([
      fetchV2('validation', '/api/validation', force && !(S.v2.validation && S.v2.validation.data)),
      S.v2.discovery && S.v2.discovery.data ? null : fetchV2('discovery', '/api/discovery'),
    ]);
    if (S.tab !== 'validation') return;
    if (!r.data) { main.innerHTML = v2Missing('/api/validation', r.error); return; }
    const v = r.data;
    const pols = arr(v.policies);
    const pl = (id) => (pols.find((p) => p.id === id) || {}).label || id;
    const reps = arr(v.replay);
    if (!S.valPolicy || !reps.some((x) => x.policy === S.valPolicy)) {
      const hl = v.headline && v.headline.best_policy;
      S.valPolicy = reps.some((x) => x.policy === hl) ? hl : (reps[0] && reps[0].policy);
    }
    const vsId = (v.headline && v.headline.vs) || 'CURRENT_RULE';
    const vsRow = reps.find((x) => x.policy === vsId);
    const best = reps.length ? reps.reduce((a, b) => (b.total_usd < a.total_usd ? b : a)) : null;
    const hl = v.headline || {};
    const savingPct = vsRow && vsRow.total_usd ? (Number(hl.saving_usd) || 0) / vsRow.total_usd : null;
    main.innerHTML = `
      <div class="panel v2head"><div class="panel-head" style="margin:0"><h4>검증 — 해결 대안 · 정책 경쟁 · ${term('Historical Replay')} · 시나리오 · 민감도 (Phase 11·19·21–24)</h4>
        <span class="hint"><span class="pill ${v.source === 'precomputed' ? 'k' : 'sev-low'}">${esc(v.source === 'precomputed' ? '미리 계산본' : v.source === 'live' ? '실시간 계산' : v.source || '')}</span> ${esc(v.computed_at ? '계산 ' + v.computed_at : '')}${v.runtime_s != null ? ` · ${esc(Number(v.runtime_s).toFixed(1))}s` : ''}</span></div>
        <div class="callout" style="margin-top:10px"><b>모든 정책은 결정 시점에 알던 정보만 사용(사후 정보 금지)</b> — 각 결정 시점에 발행돼 있던 ETA·예보·부두제약만 보고 계획을 정하고, 결과는 실제 세계로 채점한다. 이미 이동·접안한 선박은 바꾸지 않는다.</div>
      </div>
      ${hl.text || hl.best_policy ? `<div class="headline" data-anchors="headline">
        <div class="hl-num">${hl.saving_usd != null ? '−' + fmtUSD(hl.saving_usd) : ''}${savingPct != null ? `<span class="hl-pct">${fmtPct(savingPct)}</span>` : (hl.saving_pct != null ? `<span class="hl-pct">${fmtPct(hl.saving_pct)}</span>` : '')}</div>
        <div><b>${esc(hl.best_label || pl(hl.best_policy))}</b> vs ${esc(pl(vsId))}<div class="small">${esc(hl.text || '')}</div></div>
      </div>` : ''}
      ${valDiscoveryPanels(S.v2.discovery && S.v2.discovery.data, pl)}
      <div class="panel" data-anchors="competition baseline_competition policies replay">
        <div class="panel-head"><h4>정책 경쟁 — 같은 정보, 다른 결정 규칙</h4><span class="hint">행을 누르면 그 정책의 결정 기록</span></div>
        ${competitionChart(reps, pl, v.hindsight, vsId, best)}
        <div class="table-scroll" style="margin-top:8px"><table class="comp"><thead><tr><th>정책</th><th class="num">총 체선료</th><th class="num">${esc(pl(vsId))} 대비</th><th class="num">묘박 대기</th><th class="num">제약 위반</th><th class="num">계획 변경</th><th class="num">선석 가동률</th><th class="num">계산 시간</th></tr></thead><tbody>
        ${reps.map((x) => {
          const util = Object.entries(x.utilization || {});
          const avgU = util.length ? util.reduce((a, [, u]) => a + (Number(u) || 0), 0) / util.length : null;
          const dv = vsRow ? x.total_usd - vsRow.total_usd : null;
          return `<tr class="prow ${x.policy === S.valPolicy ? 'hl' : ''}" data-policy="${esc(x.policy)}" tabindex="0"><td><b>${esc(pl(x.policy))}</b>${best && x.policy === best.policy ? ' <span class="pill ok">최소</span>' : ''}<div class="small muted">${esc((pols.find((p) => p.id === x.policy) || {}).desc || '')}</div></td>
            <td class="num ${x.total_usd > 0 ? 'pos' : ''}"><b>${fmtUSD(x.total_usd)}</b></td><td class="num ${dCls(dv)}">${x.policy === vsId ? '기준' : fmtDelta(dv)}</td><td class="num">${fmtH(x.waiting_h)}</td>
            <td class="num ${x.violations ? 'pos' : ''}">${num(x.violations)}</td><td class="num">${num(x.plan_changes)}</td>
            <td class="num" title="${esc(util.map(([b, u]) => `${b} ${fmtPct(u)}`).join(' · '))}">${avgU != null ? fmtPct(avgU) : '—'}</td><td class="num">${fmtMs(x.compute_ms)}</td></tr>`;
        }).join('') || '<tr><td colspan="8" class="empty">replay 없음</td></tr>'}
        </tbody></table></div>
        ${v.hindsight ? `<p class="small muted" style="margin-top:6px">사후 최적 ${fmtUSD(v.hindsight.total_usd)} — ${esc(v.hindsight.note || '미래를 아는 계산이라 실현 불가능한 하한')}</p>` : ''}
        <div id="policyDetail">${policyDetail(reps.find((x) => x.policy === S.valPolicy), pl)}</div>
      </div>
      <div class="panel" data-anchors="decision_points decisions">
        <div class="panel-head"><h4>결정 시점</h4><span class="hint">정책이 계획을 다시 정할 수 있는 순간 = 새 정보가 들어온 순간</span></div>
        <ul class="dp">${arr(v.decision_points).map((p) => `<li><span class="mono">${esc(fmtTs(p.t))}</span><span class="pill k">${esc(TRIGGER_LABEL[p.trigger] || p.trigger || '')}</span><span>${esc(p.label || '')}</span></li>`).join('') || '<li class="muted">decision_points 없음</li>'}</ul>
      </div>
      <div class="panel" data-anchors="scenarios scenario">
        <div class="panel-head"><h4>시나리오 매트릭스 (Phase 23)</h4><span class="hint">칸 = 그 시나리오에서 정책의 실제 체선료 · 행 최솟값 기준 음영</span></div>
        ${scenarioMatrix(arr(v.scenarios), pols, pl)}
      </div>
      <div class="panel" data-anchors="sensitivity tornado">
        <div class="panel-head"><h4>민감도 (Phase 24)</h4><span class="hint">${v.sensitivity ? `${esc(pl(v.sensitivity.policy))} 계획 · ${esc(fmtTs(v.sensitivity.at))} 시점 · 기준 ${fmtUSD(v.sensitivity.base_usd)}` : ''}</span></div>
        ${v.sensitivity && (v.sensitivity.chosen_plan || v.sensitivity.label) ? `<p class="small muted" style="margin-bottom:6px">${esc(v.sensitivity.label || '')}${v.sensitivity.chosen_plan ? ` · 시험한 계획: ${esc(typeof v.sensitivity.chosen_plan === 'string' ? v.sensitivity.chosen_plan : JSON.stringify(v.sensitivity.chosen_plan))}` : ''}</p>` : ''}
        ${tornado(v.sensitivity)}
      </div>`;
    if (S.pendingAnchor) flushAnchor();
  }
  function competitionChart(reps, pl, hind, vsId, best) {
    if (!reps.length) return '';
    const vals = reps.map((x) => Number(x.total_usd) || 0).concat(hind && hind.total_usd != null ? [Number(hind.total_usd)] : []);
    const max = Math.max(1, ...vals);
    const W = 760, LW = 190, VW = 96, rowH = 26, T = 8, H = T + reps.length * rowH + 22;
    const X = (v) => LW + (Math.max(0, v) / max) * (W - LW - VW);
    const bars = reps.map((x, i) => {
      const y = T + i * rowH;
      const cls = best && x.policy === best.policy ? 'cp-best' : x.policy === vsId ? 'cp-base' : 'cp-bar';
      const lbl = String(pl(x.policy));
      return `<g class="prow-g" data-policy="${esc(x.policy)}"><text class="wf-label" x="0" y="${y + rowH / 2 + 4}">${esc(lbl.length > 24 ? lbl.slice(0, 23) + '…' : lbl)}</text>
        <rect class="${cls} ${x.policy === S.valPolicy ? 'sel' : ''}" x="${LW}" y="${y + 4}" width="${Math.max(1.5, X(x.total_usd) - LW)}" height="${rowH - 9}" rx="2"><title>${esc(lbl)} ${fmtUSD(x.total_usd)}</title></rect>
        <text class="wf-val" x="${W}" y="${y + rowH / 2 + 4}" text-anchor="end">${fmtUSD(x.total_usd)}</text></g>`;
    }).join('');
    const hx = hind && hind.total_usd != null ? X(hind.total_usd) : null;
    const hl = hx != null ? `<line class="cp-hind" x1="${hx}" x2="${hx}" y1="${T}" y2="${T + reps.length * rowH}"/><text class="cp-hind-t" x="${hx + 4}" y="${T + reps.length * rowH + 14}">사후 최적(실현 불가) ${fmtUSD(hind.total_usd)}</text>` : '';
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="min-width:600px;width:100%;height:auto" role="img" aria-label="정책별 총 체선료">${bars}${hl}</svg></div>`;
  }
  function policyDetail(x, pl) {
    if (!x) return '';
    return `<div class="pdetail"><div class="pd-title">${esc(pl(x.policy))} — 결정 기록</div>
      <ol class="stepper">${arr(x.decisions).map((dd) => `<li><span class="dot ${arr(dd.moves).length || arr(dd.levers).length ? 'pass' : 'info'}">·</span><div class="nm"><span class="mono">${esc(fmtTs(dd.t))}</span>${dd.trigger ? ` <span class="pill k">${esc(TRIGGER_LABEL[dd.trigger] || dd.trigger)}</span>` : ''} ${esc(dd.summary || '')}${dd.projected_usd != null ? ` <span class="small muted">· 그 시점 예측 ${fmtUSD(dd.projected_usd)}</span>` : ''}</div>
        ${arr(dd.moves).length ? `<div class="sm">변경: ${esc(dd.moves.join(' · '))}</div>` : ''}${arr(dd.levers).length ? `<div class="sm">레버: ${esc(dd.levers.join(' · '))}</div>` : ''}</li>`).join('') || '<li class="muted">결정 기록 없음 (계획 그대로)</li>'}</ol>
      <div class="table-scroll"><table><thead><tr><th>선박</th><th>선석</th><th>ETB</th><th class="num">체선료</th></tr></thead><tbody>
      ${arr(x.per_call).map((p) => `<tr><td>${esc(p.vessel || vesselName(p.call_id))}</td><td>${esc(p.berth_id || '')}</td><td class="mono">${esc(fmtTs(p.etb))}</td><td class="num ${p.amount_usd > 0 ? 'pos' : ''}">${fmtUSD(p.amount_usd)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  function scenarioMatrix(scs, pols, pl) {
    if (!scs.length) return '<div class="empty">scenarios 없음</div>';
    const order = pols.map((p) => p.id);
    const used = uniq(scs.flatMap((s) => arr(s.results).map((r) => r.policy)));
    const cols = order.filter((id) => used.includes(id)).concat(used.filter((id) => !order.includes(id)));
    const hasSave = scs.some((s) => s.saving_vs_rule_usd != null);
    return `<div class="table-scroll"><table class="scn"><thead><tr><th>시나리오</th>${cols.map((c) => `<th class="num">${esc(pl(c))}</th>`).join('')}${hasSave ? '<th class="num">최선 · 현업 Rule 대비</th>' : ''}</tr></thead><tbody>
      ${scs.map((s) => {
        const res = Object.fromEntries(arr(s.results).map((r) => [r.policy, Number(r.total_usd)]));
        const vals = cols.map((c) => res[c]).filter((x) => x != null && !isNaN(x));
        const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 0;
        const off = s.modeled === false;
        return `<tr class="${off ? 'off' : ''}"><td class="scn-name"><b class="mono">${esc(s.id)}</b> <b>${esc(s.title || '')}</b>${off ? '' : ` <button type="button" class="linkbtn" data-res-scenario="${esc(s.id)}" title="이 시나리오의 조석·탱크·배관·예선 제약을 자원·제약 탭에서 보기">자원 →</button>`}${arr(s.focus).length ? `<div class="chips" style="margin-top:2px">${s.focus.map((f) => `<span class="pill sev-low mono" title="이 시나리오에서 구속되는 제약">${esc(f)}</span>`).join('')}</div>` : ''}${s.desc ? `<div class="small muted clamp" title="${esc(s.desc)}">${esc(s.desc)}</div>` : ''}${off ? `<div class="small"><span class="pill k">미모델링</span> ${esc(s.note || '')}</div>` : (s.note ? `<div class="small muted clamp" title="${esc(s.note)}">${esc(s.note)}</div>` : '')}</td>
          ${cols.map((c) => {
            const x = res[c];
            if (x == null || isNaN(x)) return '<td class="num muted">—</td>';
            const t = hi > lo ? (x - lo) / (hi - lo) : 0;
            const isBest = Math.abs(x - lo) < 0.5 && vals.length > 1;
            return `<td class="num heat ${isBest ? 'best' : ''}" style="--heat:${(t * 100).toFixed(0)}%">${fmtUSD(x)}</td>`;
          }).join('')}${hasSave ? `<td class="num">${s.best_policy ? `<div class="small">${esc(pl(s.best_policy))}</div>` : ''}${s.saving_vs_rule_usd != null ? `<span class="${dCls(-s.saving_vs_rule_usd)}">${s.saving_vs_rule_usd > 0.5 ? '−' + fmtUSD(s.saving_vs_rule_usd) : '$0'}</span>` : '—'}</td>` : ''}</tr>`;
      }).join('')}
      </tbody></table></div><p class="small muted" style="margin-top:6px">초록 = 그 시나리오의 최솟값, 붉을수록 최솟값보다 비싸다. 미모델링 시나리오는 데이터·모델이 없어 계산하지 않은 것.</p>`;
  }
  function tornado(sv) {
    if (!sv || !arr(sv.factors).length) return '<div class="empty">sensitivity 없음</div>';
    const base = Number(sv.base_usd) || 0;
    const fs = arr(sv.factors).map((f) => {
      const lv = arr(f.levels).map((l) => ({ ...l, usd: Number(l.usd) }));
      const lo = Math.min(base, ...lv.map((l) => l.usd)), hi = Math.max(base, ...lv.map((l) => l.usd));
      return { ...f, lv, lo, hi, range: hi - lo };
    }).sort((a, b) => b.range - a.range);
    const gl = Math.min(...fs.map((f) => f.lo)), gh = Math.max(...fs.map((f) => f.hi));
    const pad0 = (gh - gl) * 0.06 || 1;
    const a = gl - pad0, b = gh + pad0;
    const W = 760, LW = 200, RW = 28, rowH = 42, T = 20, H = T + fs.length * rowH + 10;
    const X = (v) => LW + ((v - a) / (b - a || 1)) * (W - LW - RW);
    const rows = fs.map((f, i) => {
      const y = T + i * rowH;
      const cy = y + rowH / 2;
      // 가까운 수준 라벨은 막대 위·아래로 번갈아 놓는다
      let lastTop = -Infinity, lastBot = -Infinity;
      const placed = f.lv.map((l) => ({ l, x: X(l.usd) })).sort((p, q) => p.x - q.x).map((p) => {
        let top = true;
        if (p.x - lastTop >= 30) lastTop = p.x; else if (p.x - lastBot >= 30) { top = false; lastBot = p.x; } else lastTop = p.x;
        return { ...p, top };
      });
      const marks = placed.map(({ l, x, top }) => `<g><circle class="tn-pt ${l.flip ? 'flip' : ''}" cx="${x}" cy="${cy}" r="${l.flip ? 5 : 3.5}"><title>${esc(f.label || f.factor)} ${esc(l.label)}: ${fmtUSD(l.usd)}${l.flip ? ' · 추천 계획이 바뀜' : ''}</title></circle><text class="tn-lv" x="${x}" y="${top ? cy - 9 : cy + 17}" text-anchor="middle">${esc(l.label)}${l.flip ? ' ⇄' : ''}</text></g>`).join('');
      const name = String(f.label || f.factor);
      return `<text class="wf-label" x="0" y="${cy + 4}"><title>${esc(name)}</title>${esc(name.length > 17 ? name.slice(0, 16) + '…' : name)}</text>
        <rect class="tn-bar" x="${X(f.lo)}" y="${cy - 5}" width="${Math.max(1, X(f.hi) - X(f.lo))}" height="10" rx="2"/>${marks}`;
    }).join('');
    const bl = `<line class="tn-base" x1="${X(base)}" x2="${X(base)}" y1="${T - 6}" y2="${T + fs.length * rowH}"/><text class="tn-lv" x="${X(base)}" y="${T - 8}" text-anchor="middle">기준 ${fmtUSD(base)}</text>`;
    const anyFlip = fs.some((f) => f.lv.some((l) => l.flip));
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="min-width:600px;width:100%;height:auto" role="img" aria-label="민감도 토네이도">${bl}${rows}</svg></div>
      <div class="legend"><span><i class="tn-l-bar"></i>변동 범위</span><span><i class="tn-l-flip"></i>⇄ 추천 계획이 뒤집히는 수준</span></div>
      <div class="grid2" style="margin-top:8px">
        <div class="decision-note" style="margin-top:0"><b>가장 민감한 변수</b> ${esc(sv.most_sensitive || '—')}</div>
        <div class="decision-note" style="margin-top:0"><b>계획을 유지해도 되는 범위</b> ${esc(sv.keep_plan_within || '—')}${anyFlip ? '' : ' <span class="small muted">(시험한 범위에서 추천이 뒤집히지 않음)</span>'}</div>
      </div>
      <details style="margin-top:8px"><summary>수준별 값</summary><div class="table-scroll"><table><thead><tr><th>변수</th><th>수준</th><th class="num">총 체선료</th><th class="num">기준 대비</th><th>추천 변경</th></tr></thead><tbody>
      ${fs.flatMap((f) => f.lv.map((l) => `<tr><td>${esc(f.label || f.factor)}</td><td>${esc(l.label)}</td><td class="num">${fmtUSD(l.usd)}</td><td class="num ${dCls(l.usd - base)}">${fmtDelta(l.usd - base)}</td><td>${l.flip ? `<span class="pill sev-high">⇄ 바뀜</span>${l.best_usd != null ? ` <span class="small muted">새 최선 ${fmtUSD(l.best_usd)}</span>` : ''}${l.best_change ? `<div class="small">${esc(l.best_change)}</div>` : ''}` : '<span class="small muted">유지</span>'}</td></tr>`)).join('')}
      </tbody></table></div></details>`;
  }

  // ================================================================ 비즈니스 케이스
  function bizPath() {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(S.bizParams)) if (v !== '' && v != null && !isNaN(v)) qs.set(k, v);
    const s = qs.toString();
    return '/api/business_case' + (s ? '?' + s : '');
  }
  async function renderBusiness(force) {
    const have = S.v2.business && S.v2.business.data;
    if (!have) main.innerHTML = loadingPanel('비즈니스 케이스');
    const r = await fetchV2('business', bizPath(), force && !have);
    if (S.tab !== 'business') return;
    if (!r.data) { main.innerHTML = v2Missing('/api/business_case', r.error); return; }
    const b = r.data;
    for (const p of arr(b.params)) if (S.bizParams[p.key] == null) S.bizParams[p.key] = p.value;
    main.innerHTML = `
      <div class="assume-banner" role="note"><b>가정 기반 추정 — 실제 효과 아님.</b> 연간 규모·비율·비용은 전부 가정값이고, 절감률은 가상 시나리오 검증 결과에서 가져온다. 현업 데이터로 바꾸기 전에는 발표 숫자로 쓰지 않는다.</div>
      <div class="biz">
        <div class="panel" data-anchors="params assumptions">
          <div class="panel-head"><h4>가정값</h4><span class="hint">바꾸면 바로 다시 계산</span></div>
          ${arr(b.presets).length ? `<div class="bz-presets"><span class="small muted">프리셋</span>${b.presets.map((p) => `<button type="button" class="btn small ${bizPresetActive(p) ? 'active' : ''}" data-biz-preset="${esc(p.id)}" title="${esc(p.basis || '')}">${esc(p.label || p.id)}</button>`).join('')}</div>` : ''}
          <div class="bizparams">${arr(b.params).map((p) => {
            const v = S.bizParams[p.key] ?? p.value;
            const hasRange = p.min != null && p.max != null && Number(p.max) > Number(p.min);
            const krw = p.unit === 'KRW';
            return `<div class="bp"><div class="bp-top"><label for="bz-${esc(p.key)}">${esc(p.label)}</label>${krw ? `<span class="bp-fmt mono" data-biz-fmt="${esc(p.key)}">${esc(fmtKRW(v, 1))}</span>` : ''}</div>${p.basis ? `<div class="bp-basis ${/가정/.test(p.basis) ? 'assumed' : 'derived'}">${esc(p.basis)}</div>` : ''}
              <div class="bp-ctl">${hasRange ? `<input type="range" id="bz-${esc(p.key)}" data-biz="${esc(p.key)}" min="${esc(p.min)}" max="${esc(p.max)}" step="${esc(p.step || 'any')}" value="${esc(v)}">` : ''}
                <input type="number" data-biz-num="${esc(p.key)}" ${p.min != null ? `min="${esc(p.min)}"` : ''} ${p.max != null ? `max="${esc(p.max)}"` : ''} step="${esc(p.step || 'any')}" value="${esc(v)}"><span class="small muted">${esc(p.unit || '')}</span></div></div>`;
          }).join('') || '<div class="empty">params 없음</div>'}</div>
          <div class="actions" style="border:0;padding-top:4px"><button type="button" class="btn small" id="bizReset">가정 기본값으로</button></div>
        </div>
        <div id="bizResult">${bizResult(b)}</div>
      </div>`;
    if (S.pendingAnchor) flushAnchor();
  }
  function bizResult(b) {
    const steps = arr(b.steps);
    const get = (k) => steps.find((s) => s.key === k);
    const cost = get('COST');
    const net = b.net_benefit_usd != null ? Number(b.net_benefit_usd) : (get('NET_BENEFIT') ? Number(get('NET_BENEFIT').usd) : null);
    const costAbs = cost ? Math.abs(Number(cost.usd) || 0) : null;
    const roiCalc = costAbs ? net / costAbs : null;
    const fx = b.fx_krw_per_usd;
    const max = Math.max(1, ...steps.map((s) => Math.abs(Number(s.usd) || 0)));
    const W = 760, LW = 230, VW = 150, rowH = 30, H = steps.length * rowH + 8;
    const X = (v) => LW + (Math.abs(v) / max) * (W - LW - VW);
    const g = steps.map((s, i) => {
      const y = 4 + i * rowH;
      const v = Number(s.usd) || 0;
      const cls = s.key === 'COST' || v < 0 ? 'bz-cost' : s.key === 'NET_BENEFIT' ? 'bz-net' : s.key === 'EXPECTED_SAVING' ? 'bz-save' : i === 0 ? 'bz-total' : 'bz-sub';
      const lbl = String(s.label || s.key);
      return `<text class="wf-label" x="0" y="${y + rowH / 2 + 4}">${esc(lbl.length > 30 ? lbl.slice(0, 29) + '…' : lbl)}</text>
        <rect class="${cls}" x="${LW}" y="${y + 5}" width="${Math.max(1.5, X(v) - LW)}" height="${rowH - 12}" rx="2"><title>${esc(lbl)}: ${fmtUSD(v)}${s.note ? '\n' + esc(s.note) : ''}</title></rect>
        <text class="wf-val" x="${W}" y="${y + rowH / 2 + 4}" text-anchor="end">${fmtUSD(v)}${fx ? ` · ${fmtKRW(v, fx)}` : ''}</text>`;
    }).join('');
    return `
      <div class="kpis biz-kpis">
        <div class="kpi"><span class="label">연간 기대 절감</span><span class="value neg">${fmtUSD(b.annual_saving_usd)}</span><span class="sub">${fmtKRW(b.annual_saving_usd, fx)}</span></div>
        <div class="kpi"><span class="label">순편익 (절감 − 비용)</span><span class="value ${net != null && net < 0 ? 'dem' : ''}">${fmtUSD(net)}</span><span class="sub">${fmtKRW(net, fx)}</span></div>
        <div class="kpi"><span class="label">ROI</span><span class="value">${roiCalc != null && isFinite(roiCalc) ? `${roiCalc < 0 ? '−' : ''}${Math.abs(Math.round(roiCalc * 100)).toLocaleString('en-US')}%` : (b.roi != null ? esc(String(b.roi)) : '—')}</span><span class="sub" title="API roi = ${esc(String(b.roi))}">순편익 ÷ 연간 비용</span></div>
        <div class="kpi"><span class="label">회수 기간</span><span class="value">${b.payback_months != null && isFinite(b.payback_months) ? `${Number(b.payback_months).toFixed(1)}개월` : '—'}</span><span class="sub">환율 ${fx ? num(fx) + '원/USD' : '—'}</span></div>
      </div>
      <div class="panel" data-anchors="waterfall funnel steps">
        <div class="panel-head"><h4>연간 총 체선료 → 순편익</h4><span class="hint">로드맵 Phase 29 계산 사슬</span></div>
        ${steps.length ? `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="min-width:600px;width:100%;height:auto" role="img" aria-label="비즈니스 케이스">${g}</svg></div>
        <div class="table-scroll" style="margin-top:6px"><table><thead><tr><th>단계</th><th class="num">USD</th><th class="num">원화</th><th>근거</th></tr></thead><tbody>${steps.map((s) => `<tr class="${s.key === 'NET_BENEFIT' ? 'hl' : ''}"><td>${esc(s.label || s.key)}<div class="small muted mono">${esc(s.key)}</div></td><td class="num">${fmtUSD(s.usd)}</td><td class="num">${fmtKRW(s.usd, fx)}</td><td class="small">${esc(s.note || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">steps 없음</div>'}
      </div>
      <div class="grid2 v2grid">
        <div class="panel"><div class="panel-head"><h4>숫자의 출처</h4></div><dl class="kv">${Object.entries(b.sources || {}).map(([k, v]) => `<dt class="mono small">${esc(k)}</dt><dd class="small">${esc(v)}</dd>`).join('') || '<dt>—</dt><dd>—</dd>'}</dl></div>
        <div class="panel"><div class="panel-head"><h4>메모</h4></div><ul class="narrative small">${arr(b.notes).map((n) => `<li>${esc(n)}</li>`).join('') || '<li>—</li>'}</ul></div>
      </div>`;
  }
  function scheduleBiz() {
    clearTimeout(S.bizTimer);
    S.bizTimer = setTimeout(async () => {
      const seq = ++S.bizSeq;
      const path = bizPath();
      try {
        const data = await GET(path);
        if (seq !== S.bizSeq || S.tab !== 'business') return;
        S.v2.business = { path, data, error: null };
        const box = $('#bizResult');
        if (box) box.innerHTML = bizResult(data);
      } catch (e) { if (seq === S.bizSeq) showError('비즈니스 케이스 재계산 실패: ' + e.message); }
    }, 320);
  }

  function syncBiz(el) {
    const key = el.dataset.biz || el.dataset.bizNum;
    const v = el.value === '' ? '' : Number(el.value);
    S.bizParams[key] = v;
    const other = el.dataset.biz ? $(`[data-biz-num="${CSS.escape(key)}"]`) : $(`[data-biz="${CSS.escape(key)}"]`);
    if (other && other !== el && el.value !== '') other.value = el.value;
    const fmt = $(`[data-biz-fmt="${CSS.escape(key)}"]`);
    if (fmt) fmt.textContent = v === '' ? '—' : fmtKRW(v, 1);
    markBizPreset();
    scheduleBiz();
  }
  const bizPresetActive = (p) => Object.entries(p.params || {}).every(([k, v]) => Number(S.bizParams[k]) === Number(v));
  function markBizPreset() {
    const b = S.v2.business && S.v2.business.data;
    $$('[data-biz-preset]').forEach((x) => {
      const p = arr(b && b.presets).find((y) => y.id === x.dataset.bizPreset);
      x.classList.toggle('active', !!p && bizPresetActive(p));
    });
  }
  function applyBizPreset(id) {
    const b = S.v2.business && S.v2.business.data;
    const p = arr(b && b.presets).find((x) => x.id === id);
    if (!p) return;
    for (const [k, v] of Object.entries(p.params || {})) {
      S.bizParams[k] = v;
      const r = $(`[data-biz="${CSS.escape(k)}"]`);
      const n = $(`[data-biz-num="${CSS.escape(k)}"]`);
      if (r) r.value = v;
      if (n) n.value = v;
    }
    markBizPreset();
    scheduleBiz();
  }
  function selectPolicy(id) {
    if (!id) return;
    S.valPolicy = id;
    const v = S.v2.validation && S.v2.validation.data;
    if (!v) return;
    const pols = arr(v.policies);
    const pl = (pid) => (pols.find((p) => p.id === pid) || {}).label || pid;
    $$('tr.prow[data-policy]').forEach((r) => r.classList.toggle('hl', r.dataset.policy === id));
    $$('g.prow-g[data-policy] rect').forEach((r) => r.classList.toggle('sel', r.closest('g').dataset.policy === id));
    const box = $('#policyDetail');
    if (box) box.innerHTML = policyDetail(arr(v.replay).find((x) => x.policy === id), pl);
  }

  // ================================================================ v3 공통
  // concepts.js(WP-UI-A)가 있으면 용어에 설명을 붙이고, 없으면 글자 그대로 보여 준다
  function term(word) {
    const C = window.Concepts;
    if (C && typeof C.term === 'function') {
      try {
        const h = C.term(word);
        if (typeof h === 'string' && h) return h;
        if (h && typeof h.outerHTML === 'string') return h.outerHTML;
      } catch (_) { /* 사전에 없는 용어 */ }
    }
    return esc(word);
  }
  function v3Missing(path, err, what) {
    const pending = /준비 중|No module|404|not found|unknown/i.test(String(err || ''));
    const fix = IS_STATIC ? '정적 사이트를 다시 빌드(tools/build_site.py)하고 새로고침하세요.' : '서버(python3 server.py)를 다시 실행하고 새로고침하세요.';
    return `<div class="panel"><div class="empty"><b>${esc(what)}</b> 데이터를 받지 못했습니다 — <span class="mono">${esc(path)}</span>
      ${err ? `<div class="small" style="margin-top:6px">${esc(err)}</div>` : ''}
      <div class="small muted" style="margin-top:6px">${pending ? `엔진 모듈이 아직 준비 중입니다(docs/api.md v3). 엔진이 추가되면 ${fix}` : fix}</div></div></div>`;
  }
  const resEmpty = (msg) => `<div class="empty small">${esc(msg)}</div>`;
  // 엔진 문장의 [가정]·[추론]·[가상]·[사실…]·[문서] 꼬리표를 작은 배지로 바꾼다 (나머지는 그대로 이스케이프)
  const TAG_CLS = { 가정: 'tg-assume', 추론: 'tg-infer', 가상: 'tg-virtual', 사실: 'tg-fact', 문서: 'tg-fact', 추천: 'tg-rec', '확인 필요': 'tg-check' };
  function tagged(text) {
    return esc(text).replace(/\[(가정|추론|가상|사실|문서|추천|확인 필요)([^\]]{0,80})\]/g, (m, k, rest) => `<span class="tg ${TAG_CLS[k]}">${k}${rest}</span>`);
  }
  const trunc = (s, n) => { const x = String(s ?? ''); return x.length > n ? x.slice(0, Math.max(1, n - 1)) + '…' : x; };
  const fmtM = (x) => (x == null || x === '' || isNaN(x) ? '—' : `${Number(x).toFixed(1)}m`);
  function seriesPts(start, stepMin, values) {
    const s = parseTs(start);
    if (s == null) return [];
    const st = (Number(stepMin) || 60) * 60000;
    return arr(values).map((v, i) => ({ t: s + i * st, v: v == null || v === '' ? NaN : Number(v) })).filter((p) => !isNaN(p.v));
  }
  function niceTicks(a, b, n) {
    const span = b - a;
    if (!(span > 0)) return [a];
    const raw = span / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw - 1e-12) || mag * 10;
    const out = [];
    for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9; v += step) out.push(Number(v.toFixed(6)));
    return out;
  }
  function fmtTick(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
  // 값이 기준 이상인 시간대 — 시계열 점 사이를 선형 보간해 교차 시각을 잡는다
  function windowsAbove(pts, thr) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ia = a.v >= thr, ib = b.v >= thr;
      if (!ia && !ib) continue;
      const cross = a.t + ((thr - a.v) / ((b.v - a.v) || 1)) * (b.t - a.t);
      const s = ia ? a.t : cross, e = ib ? b.t : cross;
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - s) < 1000) last[1] = e; else out.push([s, e]);
    }
    return out;
  }
  // 계단형 시계열(각 값이 step 동안 유지)에서 조건을 만족하는 구간
  function stepWindows(pts, stepMs, pred) {
    const out = [];
    for (const p of pts) {
      if (!pred(p.v)) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - p.t) < 1000) last[1] = p.t + stepMs; else out.push([p.t, p.t + stepMs]);
    }
    return out;
  }
  // 자원 차트 공통 틀 — 모든 차트가 같은 x축(시나리오 t0~t_end)·야간 음영·지금 선을 쓴다
  const RES_W = 1240, RES_L = 176, RES_R = 124;
  let resClipSeq = 0;
  function resFrame(H, top) {
    const t0 = S.t0, t1 = S.tEnd, plotW = RES_W - RES_L - RES_R;
    const X = (ms) => RES_L + ((ms - t0) / (t1 - t0 || 1)) * plotW;
    const XC = (ms) => X(Math.max(t0, Math.min(t1, ms)));
    const id = `rsclip${++resClipSeq}`;
    const back = [];
    const dt = S.meta && S.meta.daytime;
    const [sh, sm] = String((dt && dt.start) || '07:00').split(':').map(Number);
    const [eh, em] = String((dt && dt.end) || '17:30').split(':').map(Number);
    const d0 = new Date(t0);
    for (let day = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - 86400e3; day < t1; day += 86400e3) {
      const a = day + (eh * 60 + em) * 60e3, b = day + 86400e3 + (sh * 60 + sm) * 60e3;
      if (b > t0 && a < t1) back.push(`<rect class="night" x="${XC(a)}" y="${top}" width="${Math.max(0, XC(b) - XC(a))}" height="${H - top}"/>`);
    }
    for (let t = Math.ceil(t0 / 21600e3) * 21600e3; t <= t1; t += 21600e3) {
      const isDay = new Date(t).getUTCHours() === 0;
      back.push(`<line class="gridline ${isDay ? 'day' : ''}" x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H}" ${isDay ? '' : 'stroke-dasharray="2 4"'}/>`);
      if (isDay) back.push(`<text class="rs-day" x="${X(t) + 4}" y="11">${fmtDay(t)}</text>`);
    }
    if (new Date(t0).getUTCHours() !== 0) back.push(`<text class="rs-day" x="${X(t0) + 4}" y="11">${fmtDay(t0)}</text>`);
    const now = parseTs(S.t);
    const nowLine = now != null && now >= t0 && now <= t1 ? `<line class="now" x1="${X(now)}" x2="${X(now)}" y1="${top - 4}" y2="${H}"/>` : '';
    return { X, XC, t0, t1, plotW, top, H, now, back: back.join(''), nowLine,
      clipDef: `<clipPath id="${id}"><rect x="${RES_L}" y="0" width="${plotW}" height="${H}"/></clipPath>`, clip: `clip-path="url(#${id})"` };
  }
  const resSvg = (f, body, label) => `<div class="scroll"><svg class="rs-svg" viewBox="0 0 ${RES_W} ${f.H}" role="img" aria-label="${esc(label)}"><defs>${f.clipDef}</defs>${f.back}${body}${f.nowLine}</svg></div>`;

  // ================================================================ 개념 · 사용법 (web/concepts.js — WP-UI-A)
  const NAV_GROUPS = [
    ['시작하기', ['concepts', 'usage']],
    ['Discovery·진단', ['discovery', 'diagnosis', 'casestudy']],
    ['에이전트 운영', ['inbox', 'timeline', 'resources', 'statement', 'intake']],
    ['검증·사업성', ['validation', 'benchmark', 'business', 'assurance']],
    ['근거', ['rules', 'audit', 'guide']],
  ];
  const DEMO_STEPS = [
    ['concepts', '체선료가 어떻게 생기는지(레이타임·NOR·체선) 그림으로 먼저 본다.'],
    ['timeline', '상단 ▶ 재생 — ETA·예보·부두 제약이 들어올 때마다 노출이 다시 계산되고, 승인이 필요한 항목이 생기면 멈춘다.'],
    ['inbox', '후보 카드(예상 체선료·선정 이유·Risk·가정·대안)를 보고 옵션 적용 또는 반려한다. 결정은 감사 로그에 남는다.'],
    ['resources', '시나리오를 바꿔 조석·탱크·배관·예선 같은 선석 밖 제약이 언제 계획을 막는지 본다.'],
    ['validation', '같은 정보로 여러 결정 규칙을 겨룬 결과, 해결 대안 비교(P19)와 현업 판단 로직(P11)을 확인한다.'],
    ['assurance', '검증 KPI와 Shadow Mode 일치율, 파일럿 단계로 도입 계획을 설명한다.'],
  ];
  const CONCEPT_FALLBACK = [
    ['레이타임 (Laytime)', '선박이 하역을 위해 추가 비용 없이 쓸 수 있는 허용 시간. 용선계약(CP)이 시간이나 하역 속도로 정한다.'],
    ['체선료 (Demurrage)', '허용 시간을 넘긴 시간 × 일당 요율. 선석이 막혀 묘박지에서 기다린 시간도 대부분 여기에 들어간다.'],
    ['NOR (하역 준비 완료 통지)', '선장이 “준비됐다”고 알리는 통지. 유효한 NOR와 통지시간이 지나야 레이타임이 시작된다.'],
    ['공제 · 반액', '계약이 정한 사유(이동, 육상 사정, 기상 등)의 시간은 빼거나(공제) 반만 센다(반액). 쟁점은 자동 판정하지 않는다.'],
    ['계획 버전 · 승인', '에이전트는 변경안을 돈으로 비교해 제안만 한다. 담당자가 승인하면 새 계획 버전이 생기고 그때부터 계산이 바뀐다.'],
    ['사후 정보 금지', '검증은 각 결정 시점에 알던 정보(ETA·예보·제약)만으로 결정하고, 결과는 실제 세계로 채점한다.'],
  ];
  async function renderConceptsTab(kind) {
    const C = window.Concepts;
    const fn = C && (kind === 'usage' ? C.renderUsage : C.render);
    if (typeof fn !== 'function') { main.innerHTML = conceptsFallback(kind); if (S.pendingAnchor) flushAnchor(); return; }
    // 탭을 옮긴 뒤 늦게 끝난 렌더가 다른 화면을 덮지 않도록 매번 새 컨테이너에 그린다
    main.innerHTML = `<div class="concepts-host" id="conceptsHost" data-kind="${kind}"></div>`;
    const host = $('#conceptsHost');
    try {
      await fn.call(C, host, (p, o) => api(p, o));
    } catch (e) {
      console.error(e);
      if (host.isConnected) host.innerHTML = `<div class="panel"><div class="issue error"><div class="t">${kind === 'usage' ? '사용법' : '개념'} 화면을 그리지 못했습니다</div><div class="d">${esc(e && e.message ? e.message : String(e))}</div></div></div>${conceptsFallback(kind)}`;
    }
    if (S.tab === kind && host.isConnected && S.pendingAnchor) flushAnchor();
  }
  function conceptsFallback(kind) {
    const missing = `<div class="assume-banner" role="note"><b>${kind === 'usage' ? '사용법' : '개념'} 모듈(web/concepts.js)을 불러오지 못했습니다.</b> 아래는 요약본입니다 — concepts.js가 배포되면 개념도와 투어가 함께 나옵니다.</div>`;
    if (kind === 'usage') {
      return `${missing}
        <div class="panel" data-anchors="demo order"><div class="panel-head"><h4>추천 데모 순서</h4><span class="hint">처음 보는 사람에게 10분 안에 보여 주는 동선</span></div>
          <ol class="narrative usage-steps">${DEMO_STEPS.map(([tab, what]) => `<li>${linkBtn(tab, null, TAB_NAME[tab] + ' →')} ${esc(what)}</li>`).join('')}</ol></div>
        <div class="usage-list">${NAV_GROUPS.map(([g, tabs]) => `<div class="panel usage-group"><h3>${esc(g)}</h3>${tabs.map((t) => `<div class="usage-row">${linkBtn(t, null, TAB_NAME[t])}<span>${esc(TAB_HELP[t] || '')}</span></div>`).join('')}</div>`).join('')}</div>`;
    }
    return `${missing}
      <div class="panel"><div class="panel-head"><h4>체선료 데스크가 푸는 문제</h4></div><p>선박이 계약에서 허용한 시간(레이타임)보다 오래 머물면 체선료가 나간다. 이 데스크는 ETA·기상·부두 제약이 바뀔 때마다 체선료 노출을 다시 계산하고, 줄일 수 있는 변경안을 돈으로 비교해 담당자에게 제안한다. 확정은 사람이 한다.</p></div>
      <div class="cfb-grid">${CONCEPT_FALLBACK.map(([t, d]) => `<div class="cfb"><b>${esc(t)}</b>${esc(d)}</div>`).join('')}</div>
      <div class="panel" style="margin-top:14px"><div class="panel-head"><h4>다음으로</h4></div><div class="chips">${linkBtn('usage', null, '사용법 →')}${linkBtn('timeline', null, '타임라인에서 ▶ 재생 →')}${linkBtn('inbox', null, '작업함 →')}</div></div>`;
  }
  function startTour() {
    const C = window.Concepts;
    if (C && typeof C.startTour === 'function') {
      try { C.startTour(); return; } catch (e) { console.error(e); showError('사용법 투어를 시작하지 못했습니다: ' + (e && e.message ? e.message : e)); }
    } else showOk('투어 모듈(web/concepts.js)이 없어 사용법 화면을 엽니다');
    gotoTab('usage');
  }

  // ================================================================ 자원·제약 (P4~P10)
  const RES_POLICIES = [['CURRENT_RULE', '현업 Rule'], ['OPTIMIZER', 'Optimizer']];
  const resPolName = (id, d) => {
    const p = arr(d && d.policies).find((x) => x && x.id === id);
    if (p && p.label) return p.label;
    const q = RES_POLICIES.find((x) => x[0] === id);
    return q ? q[1] : id;
  };
  const CDOMAIN_KO = { E: '선석·부두', F: '화물·제품', G: '탱크·저장', H: '배관·설비', I: '도선·예선', J: '기상·조석', K: '안전·규제' };
  const VET_LABEL = { APPROVED: ['승인', 'ok'], CONDITIONAL: ['조건부 승인', 'sev-low'], PENDING: ['승인 대기', 'sev-medium'], REJECTED: ['거부', 'bad'] };
  const LINE_ALLOC = { FIRST_BERTHED: '먼저 접안한 선박 우선', PRO_RATA: '비례 배분', EQUAL: '균등 배분' };
  function resPath() {
    const sc = S.resScenario || 'BASE';
    let q = `scenario=${encodeURIComponent(sc)}`;
    if (sc !== 'BASE') q += `&policy=${encodeURIComponent(S.resPolicy || 'CURRENT_RULE')}`;
    if (S.t) q += `&t=${encodeURIComponent(S.t)}`;
    return '/api/resources?' + q;
  }
  async function renderResources() {
    updateHash();
    const path = resPath();
    const prev = S.v2.resources;
    const seq = ++S.resSeq;
    let r = prev;
    if (!(prev && prev.path === path && prev.data)) {
      // 이미 자원 화면이면 그대로 두고 다시 계산, 아니면 이전 결과나 로딩 화면을 먼저 보인다
      if ($('#resRoot')) { const h = $('#resHint'); if (h) h.textContent = '다시 계산하는 중…'; } else if (prev && prev.data) main.innerHTML = resView(prev.data, true);
      else main.innerHTML = loadingPanel('자원·제약');
      setLoading(true);
      try { r = { path, data: await GET(path), error: null }; } catch (e) { r = { path, data: null, error: e.message }; }
      if (seq !== S.resSeq) return;
      setLoading(false);
      S.v2.resources = r;
    }
    if (S.tab !== 'resources') return;
    if (!r.data) { main.innerHTML = resError(path, r.error); return; }
    main.innerHTML = resView(r.data, false);
    if (S.pendingAnchor) flushAnchor();
  }
  function resError(path, err) {
    return `${v3Missing(path, err, '자원·제약')}${(S.resScenario || 'BASE') !== 'BASE' ? '<div class="panel" style="text-align:center"><button type="button" class="btn" data-res-scenario="BASE">기준(BASE)으로 돌아가기</button></div>' : ''}`;
  }
  function resView(d, stale) {
    const sc = S.resScenario || 'BASE';
    const isBase = sc === 'BASE';
    const listed = arr(d.scenarios).filter((s) => s && s.id);
    const scs = listed.some((s) => s.id === 'BASE') ? listed.slice() : [{ id: 'BASE', title: '기준 — 지금까지 승인한 계획 이력', modeled: true }].concat(listed);
    if (!scs.some((s) => s.id === sc)) scs.push({ id: sc, title: d.scenario_title || sc, modeled: true });
    const cur = scs.find((s) => s.id === sc) || {};
    const focus = new Set(arr(cur.focus));
    const flagged = scs.some((s) => s.constraint != null);
    const optGroups = (flagged ? [['기준', scs.filter((s) => s.id === 'BASE')], ['자원·제약 시나리오', scs.filter((s) => s.id !== 'BASE' && s.constraint === true)], ['운영 시나리오', scs.filter((s) => s.id !== 'BASE' && s.constraint !== true)]]
      : [['기준', scs.filter((s) => s.id === 'BASE')], ['시나리오', scs.filter((s) => s.id !== 'BASE')]]).filter(([, xs]) => xs.length);
    const opt = (s) => `<option value="${esc(s.id)}" ${s.id === sc ? 'selected' : ''}>${esc(s.id)} · ${esc(trunc(s.title || '', 30))}${s.modeled === false ? ' (미모델링)' : ''}</option>`;
    const curPol = S.resPolicy || 'CURRENT_RULE';
    const others = arr(d.policies).filter((p) => p && p.id && p.id !== 'AS_IS' && !RES_POLICIES.some(([id]) => id === p.id));
    const cons = arr(d.constraints);
    const binding = cons.filter((c) => c.binding).sort((a, b) => (Number(b.cost_usd) || 0) - (Number(a.cost_usd) || 0) || (Number(b.binding_hours) || 0) - (Number(a.binding_hours) || 0));
    const active = cons.filter((c) => c.active);
    const bindH = cons.reduce((a, c) => a + (Number(c.binding_hours) || 0), 0);
    const hoursOf = (c, k) => (Number((c.waits_h || {})[k]) || 0) + (Number((c.slow_h || {})[k]) || 0) + (Number((c.prep_h || {})[k]) || 0);
    const newH = arr(d.calls).reduce((a, c) => a + NEW_REASONS.reduce((b, k) => b + hoursOf(c, k), 0) + (c.unberth_delay_reason && NEW_REASON_SET.has(c.unberth_delay_reason) ? Number(c.unberth_delay_h) || 0 : 0), 0);
    const polLabel = d.policy_label || (isBase || d.policy === 'AS_IS' ? '현재 계획 이력(AS-IS)' : resPolName(d.policy || curPol, d));
    const desc = d.scenario_desc || cur.desc || '';
    return `<div id="resRoot">
      <div class="panel v2head" data-anchors="resources top">
        <div class="panel-head" style="margin:0"><h4>자원·제약 — 선석 밖의 병목 (Phase 4–10)</h4><span class="hint" id="resHint">${stale ? '다시 계산하는 중…' : `${esc(d.scenario_title || sc)}${String(d.scenario_title || '').includes(polLabel) ? '' : ` · ${esc(polLabel)}`} · ${esc(fmtTs(d.t || S.t))} 기준${d.runtime_ms != null ? ` · 계산 ${esc(fmtMs(Number(d.runtime_ms)))}` : ''}`}</span></div>
        <div class="res-controls">
          <label class="small muted">시나리오 <select id="resScenario">${optGroups.map(([g, xs]) => `<optgroup label="${esc(g)}">${xs.map(opt).join('')}</optgroup>`).join('')}</select></label>
          <span class="small muted">결정 정책</span>
          <div class="seg" role="group" aria-label="결정 정책">${RES_POLICIES.map(([id, l]) => `<button type="button" data-res-policy="${id}" class="${!isBase && curPol === id ? 'active' : ''}" title="${esc(resPolName(id, d))}" ${isBase ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</div>
          ${others.length ? `<select id="resPolicyMore" aria-label="다른 결정 정책" ${isBase ? 'disabled' : ''}><option value="">다른 정책…</option>${others.map((p) => `<option value="${esc(p.id)}" ${!isBase && curPol === p.id ? 'selected' : ''}>${esc(p.label || p.id)}</option>`).join('')}</select>` : ''}
          ${isBase ? '<span class="small muted">기준(BASE)은 지금까지 승인한 계획 이력 그대로라 정책을 고르지 않는다 — 시나리오를 고르면 켜진다</span>' : ''}
        </div>
        ${desc || focus.size ? `<div class="res-desc small">${focus.size ? `<span class="muted">초점 제약</span> ${[...focus].map((id) => `<span class="pill sev-low mono">${esc(id)}</span>`).join(' ')} ` : ''}${tagged(desc)}</div>` : ''}
        <div class="callout" style="margin-top:10px"><b>체선료는 선석만의 문제가 아니다.</b> 접안하려면 ${term('조석')}(${term('UKC')})·파고·시정이 허락하고 예선·도선이 있어야 하며, 하역하려면 육상 탱크에 빈 공간이, 공유 배관에 여유가 있어야 한다. 이 화면은 그 제약이 <b>언제·얼마나 계획을 막았는지(구속)</b>를 같은 시간축에 겹쳐 보여 준다. 기준(BASE)에서는 새 제약이 비구속이라 체선료 숫자가 바뀌지 않고, 자원·제약 시나리오에서 구속된다.</div>
      </div>
      <div class="kpis v2 res-kpis">
        ${d.total_usd != null ? `<div class="kpi"><span class="label">이 세계의 총 체선료</span><span class="value ${Number(d.total_usd) > 0.5 ? 'dem' : ''}">${fmtUSD(d.total_usd)}</span><span class="sub">${esc(polLabel)}</span></div>` : ''}
        <div class="kpi"><span class="label">활성 제약</span><span class="value">${active.length} / ${cons.length}</span><span class="sub">모델에 켜져 있는 제약</span></div>
        <div class="kpi"><span class="label">구속 제약</span><span class="value ${binding.length ? 'dem' : ''}">${binding.length}개</span><span class="sub">${binding.length ? esc(binding.slice(0, 3).map((c) => c.label || c.id).join(' · ')) : '계획을 막은 제약 없음'}</span></div>
        <div class="kpi"><span class="label">구속 시간 합</span><span class="value">${fmtH(bindH)}</span><span class="sub">제약별 구속 시간의 합(겹침 포함)</span></div>
        <div class="kpi"><span class="label">새 사유 대기·지연</span><span class="value">${fmtH(newH)}</span><span class="sub">조석·예선·검사·시정·파고·탱크·배관·전환·샘플링</span></div>
      </div>
      ${resConstraints(cons, binding, focus, d.note)}
      ${resTidePanel(d)}
      ${resWavePanel(d)}
      ${resTankPanel(d)}
      ${resLinePanel(d)}
      ${resMarinePanel(d)}
      <div class="grid2 v2grid">${resProductsPanel(d)}${resVettingPanel(d)}</div>
      ${resCallsPanel(d)}
    </div>`;
  }
  function resConstraints(cons, binding, focus, note) {
    const rank = (c) => (c.binding ? 0 : focus.has(c.id) ? 1 : c.active ? 2 : 3);
    const rows = cons.slice().sort((a, b) => rank(a) - rank(b) || phaseNo(a.phase) - phaseNo(b.phase));
    return `<div class="panel" data-anchors="constraints binding">
      <div class="panel-head"><h4>제약 목록 — 무엇이 계획을 막았나</h4><span class="hint">구속 = 그 제약 때문에 대기·감속·준비·이안 지연이 실제로 생김 · 룰 ID를 누르면 근거</span></div>
      ${binding.length ? `<div class="bind-sum">${binding.map((c) => `<span class="bind-chip"><b>${esc(c.label || c.id)}</b> <span class="mono">${fmtH(c.binding_hours)}</span>${Number(c.cost_usd) > 0.5 ? ` <span class="mono pos">${fmtUSD(c.cost_usd)}</span>` : ''}</span>`).join('')}</div>`
        : `<div class="decision-note" style="margin:0 0 10px">이 시나리오에서는 어떤 제약도 계획을 막지 않았다 — ${(S.resScenario || 'BASE') === 'BASE' ? '기준(BASE)은 새 제약이 비구속이라 체선료 숫자가 v2와 같다. 시나리오를 바꿔 보세요.' : '정책이 제약을 피했거나 제약이 느슨하다.'}</div>`}
      <div class="table-scroll"><table class="cons"><thead><tr><th>제약</th><th>영역 · Phase</th><th>근거 룰</th><th>상태</th><th class="num">구속 시간</th><th class="num">비용 영향</th><th>모델 위치</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="${c.binding ? 'binding' : ''} ${c.active ? '' : 'off'} ${focus.has(c.id) ? 'focus' : ''}"><td><b>${esc(c.label || c.id)}</b>${focus.has(c.id) ? ' <span class="pill sev-low">시나리오 초점</span>' : ''}<div class="small muted mono">${esc(c.id || '')}</div>${c.note ? `<div class="small muted">${tagged(c.note)}</div>` : ''}</td>
        <td class="nowrap"><span class="mono">${esc(c.domain || '')}</span> <span class="small">${esc(CDOMAIN_KO[c.domain] || domainName(c.domain) || '')}</span><div class="small muted mono">${esc(c.phase || '')}</div></td>
        <td>${c.rule ? chip(c.rule) : '<span class="muted">—</span>'}</td>
        <td>${!c.active ? '<span class="pill k">비활성</span>' : c.binding ? '<span class="pill bad">구속</span>' : '<span class="pill ok">활성 · 비구속</span>'}</td>
        <td class="num ${Number(c.binding_hours) > 0 ? '' : 'muted'}">${fmtH(Number(c.binding_hours) || 0)}</td>
        <td class="num ${Number(c.cost_usd) > 0.5 ? 'pos' : 'muted'}">${fmtUSD(Number(c.cost_usd) || 0)}</td>
        <td class="small mono muted">${esc(c.where || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">constraints 없음</td></tr>'}
      </tbody></table></div>
      ${note ? `<p class="small muted" style="margin-top:6px">${tagged(note)}</p>` : ''}</div>`;
  }
  function resTidePanel(d) {
    const td = d.tide || {};
    const calls = arr(d.calls);
    const needs = calls.filter((c) => Number(c.tide_needed_m) > 0).sort((a, b) => Number(b.tide_needed_m) - Number(a.tide_needed_m));
    const hasUkc = calls.some((c) => c.ukc_m != null);
    const tbl = calls.length ? `<details style="margin-top:8px" ${needs.length ? 'open' : ''}><summary>선박별 흘수·수심·필요 조위 ${calls.length}척</summary><div class="table-scroll"><table><thead><tr><th>선박</th><th>선석</th><th>제품</th><th class="num">흘수</th>${hasUkc ? '<th class="num">UKC</th>' : ''}<th class="num">요구 수심</th><th class="num">선석 수심</th><th class="num">필요 조위</th></tr></thead><tbody>
      ${calls.slice().sort((a, b) => (Number(b.tide_needed_m) || 0) - (Number(a.tide_needed_m) || 0)).map((c) => `<tr class="${Number(c.tide_needed_m) > 0 ? 'hl' : ''}"><td>${esc(c.vessel || vesselName(c.call_id))}${c.vessel_type ? ` <span class="small muted">${esc(c.vessel_type)}</span>` : ''}</td><td>${esc(c.berth_id || '')}</td><td class="small">${esc(c.product_label || c.product || '')}</td><td class="num">${fmtM(c.draft_m)}</td>${hasUkc ? `<td class="num">${fmtM(c.ukc_m)}</td>` : ''}<td class="num">${fmtM(c.required_depth_m)}</td><td class="num">${fmtM(c.berth_depth_m)}</td><td class="num">${Number(c.tide_needed_m) > 0 ? `<b>${fmtM(c.tide_needed_m)}</b>` : '<span class="muted">불필요</span>'}</td></tr>`).join('')}
      </tbody></table></div><p class="small muted">필요 조위 = 요구 수심(흘수 + 여유 수심 UKC) − 선석 수심. 0 이하이면 조석과 무관하게 드나들 수 있다.</p></details>` : '';
    const range = td.min_m != null && td.max_m != null ? ` · 조위 ${Number(td.min_m).toFixed(2)}~${Number(td.max_m).toFixed(2)}m` : '';
    return `<div class="panel" data-anchors="tide ukc">
      <div class="panel-head"><h4>조석 · ${term('UKC')} 창 (Phase 9)</h4><span class="hint">${esc([td.datum, td.source].filter(Boolean).join(' · '))}${esc(range)}${td.rule ? ` ${chip(td.rule)}` : ''}</span></div>
      ${resTideChart(td, needs)}
      <div class="legend"><span><i class="rs-l-tide"></i>조위</span><span><i class="rs-l-need"></i>선박별 필요 조위</span><span><i class="rs-l-win"></i>드나들 수 있는 창</span><span><i class="night"></i>야간</span><span>▼ 접안(ETB) · ▲ 이안(ETD)</span></div>
      ${needs.length ? '' : '<p class="small muted" style="margin-top:4px">이 세계에서는 조위가 필요한 선박이 없다 — 흘수가 선석 수심보다 충분히 얕다.</p>'}
      ${tbl}</div>`;
  }
  function resTideChart(td, needs) {
    const pts = seriesPts(td.start, td.step_min, td.values_m);
    if (pts.length < 2) return resEmpty('조석 시계열이 없습니다 (resources.tide.values_m)');
    const top = 18, plotH = 110, laneH = 13, laneGap = 4;
    const lanesY = top + plotH + 14;
    const H = lanesY + needs.length * (laneH + laneGap) + 4;
    const f = resFrame(H, top);
    const vals = pts.map((p) => p.v);
    const vmax = Math.max(0.5, ...vals, ...needs.map((c) => Number(c.tide_needed_m))) * 1.12;
    const vmin = Math.min(0, ...vals);
    const Y = (v) => top + plotH - ((v - vmin) / (vmax - vmin || 1)) * plotH;
    const ln = pts.map((p, i) => `${i ? 'L' : 'M'}${f.X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
    const area = `${ln} L${f.X(pts[pts.length - 1].t).toFixed(1)} ${Y(vmin).toFixed(1)} L${f.X(pts[0].t).toFixed(1)} ${Y(vmin).toFixed(1)} Z`;
    const yt = niceTicks(vmin, vmax, 4).map((v) => `<line class="gridline" x1="${RES_L}" x2="${RES_L + f.plotW}" y1="${Y(v)}" y2="${Y(v)}" stroke-dasharray="1 4"/><text class="rs-ax" x="${RES_L - 6}" y="${Y(v) + 3}" text-anchor="end">${fmtTick(v)}</text>`).join('');
    // 필요 조위선 — 같은 값은 한 줄로 묶고, 라벨이 겹치면 아래로 민다
    const byNeed = new Map();
    for (const c of needs) { const k = Number(c.tide_needed_m).toFixed(2); if (!byNeed.has(k)) byNeed.set(k, []); byNeed.get(k).push(c); }
    let lastLy = -Infinity;
    const needLines = [...byNeed.entries()].map(([k, cs]) => {
      const y = Y(Number(k));
      let ly = y + 3;
      if (ly - lastLy < 11) ly = lastLy + 11;
      lastLy = ly;
      const names = cs.map((c) => c.vessel || vesselName(c.call_id));
      return `<line class="rs-need" x1="${RES_L}" x2="${RES_L + f.plotW}" y1="${y}" y2="${y}"><title>${esc(names.join(', '))} 필요 조위 ${Number(k).toFixed(1)}m</title></line><text class="rs-sub" x="${RES_L + f.plotW + 4}" y="${ly}">${esc(trunc(names[0], 10))}${names.length > 1 ? ` 외 ${names.length - 1}` : ''} ${Number(k).toFixed(1)}m</text>`;
    }).join('');
    // 접안·이안 표시 — 응답의 선박별 ETB·ETD, 없으면 기준(BASE)일 때 지금 상태에서
    const live = (S.resScenario || 'BASE') === 'BASE' ? Object.fromEntries(arr(S.state && S.state.calls).map((c) => [c.call_id, c])) : {};
    const lanes = needs.map((c, i) => {
      const y = lanesY + i * (laneH + laneGap);
      const need = Number(c.tide_needed_m);
      const ws = windowsAbove(pts, need);
      const hrs = ws.reduce((a, [s, e]) => a + Math.max(0, Math.min(e, f.t1) - Math.max(s, f.t0)), 0) / 3600e3;
      const nm = c.vessel || vesselName(c.call_id);
      const src = c.etb || c.etd ? c : live[c.call_id];
      const marks = src ? [['etb', '▼', '접안'], ['etd', '▲', '이안']].map(([k, sym, lbl]) => {
        const ms = parseTs(src[k]);
        return ms != null && ms >= f.t0 && ms <= f.t1 ? `<text class="rs-mark" x="${f.X(ms)}" y="${y + laneH - 2}" text-anchor="middle">${sym}<title>${esc(nm)} ${lbl} ${fmtTs(ms)}</title></text>` : '';
      }).join('') : '';
      return `<text class="rs-lbl" x="8" y="${y + laneH - 3}"><title>${esc(nm)} — 필요 조위 ${need.toFixed(1)}m</title>${esc(trunc(nm, 20))}</text>
        <rect class="rs-lane" x="${RES_L}" y="${y}" width="${f.plotW}" height="${laneH}" rx="2"/>
        <g ${f.clip}>${ws.map(([s, e]) => `<rect class="rs-win" x="${f.X(s)}" y="${y + 1}" width="${Math.max(0.8, f.X(e) - f.X(s))}" height="${laneH - 2}" rx="2"><title>${esc(nm)} 드나들 수 있음 ${fmtTs(s)}–${fmtTs(e)} (조위 ≥ ${need.toFixed(1)}m)</title></rect>`).join('')}</g>${marks}
        <text class="rs-sub" x="${RES_L + f.plotW + 4}" y="${y + laneH - 3}">창 ${fmtH(hrs)}</text>`;
    }).join('');
    const body = `${yt}<text class="rs-lbl" x="8" y="${top + 14}">조위 m</text><text class="rs-sub" x="8" y="${top + 28}">${esc(trunc(td.datum || '', 22))}</text>
      <g ${f.clip}><path class="rs-tide-area" d="${area}"/><path class="rs-tide-line" d="${ln}"><title>조위 ${esc(td.source || '')}</title></path></g>${needLines}
      ${needs.length ? `<text class="rs-sub" x="8" y="${lanesY - 4}">선박별 통과 창</text>` : ''}${lanes}`;
    return resSvg(f, body, '조위와 선박별 필요 조위');
  }
  function resWavePanel(d) {
    const wv = d.wave || {};
    const vis = d.visibility || {};
    const closures = arr(vis.closures);
    const lim = wv.limits || {};
    const adv = arr(vis.advisories);
    const swell = arr(wv.swell);
    const hint = [lim.sbm_mooring_m != null ? `${term('SBM')} 계류 한계 ${esc(lim.sbm_mooring_m)}m` : '', lim.sbm_ops_m != null ? `SBM 하역 한계 ${esc(lim.sbm_ops_m)}m` : '',
      vis.threshold_km != null ? `시정 ${esc(vis.threshold_km)}km 미만 통제` : '', closures.length ? `시정 통제 ${closures.length}건` : ''].filter(Boolean).join(' · ');
    const hasFc = seriesPts(wv.start, wv.step_min, wv.known_at_t_m).length > 1;
    const describe = (x) => (typeof x === 'string' ? tagged(x) : esc([x.from && x.to ? `${fmtTs(x.from)}–${fmtTs(x.to)}` : '', x.label || x.reason || x.text || '', x.height_m != null ? `+${x.height_m}m` : '', x.issued_at ? `(${fmtTs(x.issued_at)} 발표)` : ''].filter(Boolean).join(' ')));
    return `<div class="panel" data-anchors="wave fog visibility">
      <div class="panel-head"><h4>파고 · 시정 (Phase 9)</h4><span class="hint">${hint}</span></div>
      ${resWaveChart(wv, closures)}
      <div class="legend"><span><i class="wx0"></i>여유</span><span><i class="wx1"></i>계류 한계 80% 이상</span><span><i class="wx2"></i>계류 한계 초과</span><span><i class="wx3"></i>하역 한계 초과</span>${hasFc ? '<span><i class="rs-l-fc"></i>지금 시점에 알던 값(관측+예보)</span>' : ''}<span><i class="rs-l-closure"></i>시정 불량 항만 통제(FOG)</span><span>흐린 막대 = 지금 이후</span></div>
      ${resVisChart(vis, closures)}
      ${closures.length || adv.length || swell.length ? `<ul class="narrative small" style="margin-top:6px">${closures.map((c) => `<li>시정 통제 <span class="mono">${esc(fmtTs(c.from))}–${esc(fmtTs(c.to))}</span> ${tagged(c.reason || '시정 불량 항만 통제')}</li>`).join('')}${adv.map((a) => `<li>주의보 ${describe(a)}</li>`).join('')}${swell.map((x) => `<li>너울 ${describe(x)}</li>`).join('')}</ul>` : ''}
      ${wv.source || vis.source ? `<p class="small muted" style="margin-top:4px">${tagged([wv.source, vis.source].filter(Boolean).join(' · '))}</p>` : ''}
    </div>`;
  }
  function resWaveChart(wv, closures) {
    const pts = seriesPts(wv.start, wv.step_min, wv.values_m);
    if (!pts.length && !closures.length) return resEmpty('파고·시정 데이터가 없습니다 (resources.wave · visibility)');
    const lim = wv.limits || {};
    const moor = Number(lim.sbm_mooring_m), ops = Number(lim.sbm_ops_m);
    const fcPts = seriesPts(wv.start, wv.step_min, wv.known_at_t_m);
    const top = 18, plotH = 76, H = top + plotH + 6;
    const f = resFrame(H, top);
    const vmax = Math.max(1, ...pts.map((p) => p.v), ...fcPts.map((p) => p.v), isNaN(moor) ? 0 : moor, isNaN(ops) ? 0 : ops) * 1.12;
    const Y = (v) => top + plotH - (Math.max(0, v) / vmax) * plotH;
    const stepMs = (Number(wv.step_min) || 60) * 60000;
    const bars = pts.map((p) => {
      const cls = !isNaN(ops) && p.v >= ops ? 'wx3' : !isNaN(moor) && p.v >= moor ? 'wx2' : !isNaN(moor) && p.v >= moor * 0.8 ? 'wx1' : 'wx0';
      const fc = f.now != null && p.t >= f.now;
      const x = f.X(p.t), w = Math.max(0.6, f.X(p.t + stepMs) - x - 0.6);
      return `<rect class="${cls} ${fc ? 'fc' : ''}" x="${x + 0.3}" y="${Y(p.v)}" width="${w}" height="${top + plotH - Y(p.v)}"><title>${fmtTs(p.t)} 파고 ${p.v.toFixed(2)}m${fc ? ' (지금 이후)' : ''}</title></rect>`;
    }).join('');
    const fcLine = fcPts.length > 1 ? `<path class="rs-fc-line" d="${fcPts.map((p, i) => `${i ? 'L' : 'M'}${f.X(p.t + stepMs / 2).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ')}"><title>지금 시점에 알던 파고(관측+예보)</title></path>` : '';
    const cl = closures.map((c) => {
      const a = parseTs(c.from), b = parseTs(c.to);
      if (a == null || b == null) return '';
      const x = f.X(a), w = Math.max(1, f.X(b) - x);
      return `<rect class="rs-closure" x="${x}" y="${top}" width="${w}" height="${plotH}"><title>시정 통제 ${fmtTs(c.from)}–${fmtTs(c.to)} ${esc(c.reason || '')}</title></rect>${w > 44 ? `<text class="rs-sub" x="${x + 4}" y="${top + 12}">시정 통제</text>` : ''}`;
    }).join('');
    const limLine = (v, lbl) => (isNaN(v) ? '' : `<line class="limit" x1="${RES_L}" x2="${RES_L + f.plotW}" y1="${Y(v)}" y2="${Y(v)}"/><text class="rs-sub" x="${RES_L + f.plotW + 4}" y="${Y(v) + 3}">${v}m ${lbl}</text>`);
    const yt = niceTicks(0, vmax, 3).map((v) => `<text class="rs-ax" x="${RES_L - 6}" y="${Y(v) + 3}" text-anchor="end">${fmtTick(v)}</text>`).join('');
    const body = `${yt}<text class="rs-lbl" x="8" y="${top + 14}">파고 m</text><text class="rs-sub" x="8" y="${top + 28}">유의파고 · 관측|예보</text><g ${f.clip}>${cl}${bars}${fcLine}</g>${limLine(moor, 'SBM 계류')}${limLine(ops, 'SBM 하역')}`;
    return resSvg(f, body, '파고와 시정 통제');
  }
  // 시정(km) — 기준 아래로 떨어진 구간은 항만 통제 후보
  function resVisChart(vis, closures) {
    const sr = vis.series || {};
    const pts = seriesPts(sr.start, sr.step_min, sr.km);
    if (pts.length < 2) return '';
    const thr = Number(vis.threshold_km);
    const top = 16, plotH = 46, H = top + plotH + 6;
    const f = resFrame(H, top);
    const vmax = Math.max(2, ...pts.map((p) => p.v)) * 1.05;
    const Y = (v) => top + plotH - (Math.max(0, v) / vmax) * plotH;
    const ln = pts.map((p, i) => `${i ? 'L' : 'M'}${f.X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
    const below = isNaN(thr) ? [] : windowsAbove(pts.map((p) => ({ t: p.t, v: -p.v })), -thr);
    const cl = closures.map((c) => { const a = parseTs(c.from), b = parseTs(c.to); return a == null || b == null ? '' : `<rect class="rs-closure" x="${f.X(a)}" y="${top}" width="${Math.max(1, f.X(b) - f.X(a))}" height="${plotH}"/>`; }).join('');
    const body = `<text class="rs-lbl" x="8" y="${top + 14}">시정 km</text><text class="rs-sub" x="8" y="${top + 28}">${isNaN(thr) ? '' : `${thr}km 미만 = 통제`}</text>
      ${niceTicks(0, vmax, 2).map((v) => `<text class="rs-ax" x="${RES_L - 6}" y="${Y(v) + 3}" text-anchor="end">${fmtTick(v)}</text>`).join('')}
      <g ${f.clip}>${cl}${below.map(([s, e]) => `<rect class="rs-over" x="${f.X(s)}" y="${top}" width="${Math.max(0.8, f.X(e) - f.X(s))}" height="${plotH}"><title>시정 ${thr}km 미만 ${fmtTs(s)}–${fmtTs(e)}</title></rect>`).join('')}<path class="rs-vis-line" d="${ln}"><title>시정 km</title></path></g>
      ${isNaN(thr) ? '' : `<line class="limit" x1="${RES_L}" x2="${RES_L + f.plotW}" y1="${Y(thr)}" y2="${Y(thr)}"/><text class="rs-sub" x="${RES_L + f.plotW + 4}" y="${Y(thr) + 3}">${thr}km 통제</text>`}`;
    return resSvg(f, body, '시정');
  }
  function resTankPanel(d) {
    const tanks = arr(d.tanks);
    return `<div class="panel" data-anchors="tanks tank storage">
      <div class="panel-head"><h4>육상 탱크 재고 (Phase 6)</h4><span class="hint">재고가 안전 상한에 닿으면 양하가 느려지거나(SHORE_TANK) 접안이 보류된다(TANK) · 하한은 공정 투입 차질</span></div>
      ${tanks.length ? resTankChart(tanks) : resEmpty('탱크 데이터가 없습니다 (resources.tanks)')}
      <div class="legend"><span><i class="rs-l-tank"></i>재고</span><span><i class="rs-l-cap"></i>안전 상한</span><span><i class="rs-l-capsoft"></i>탱크 용량</span><span><i class="rs-l-min"></i>최소 재고</span><span><i class="rs-l-over"></i>상한 도달</span><span><i class="rs-l-under"></i>최소 재고 도달</span></div>
    </div>`;
  }
  function resTankChart(tanks) {
    const top = 18, rowH = 58, gap = 12;
    const H = top + tanks.length * (rowH + gap) - gap + 6;
    const f = resFrame(H, top);
    const rows = tanks.map((tk, i) => {
      const y0 = top + i * (rowH + gap);
      const sr = tk.series || {};
      const pts = seriesPts(sr.start, sr.step_min, sr.level_m3);
      const stepMs = (Number(sr.step_min) || 60) * 60000;
      const capT = Number(tk.capacity_m3) || 0;
      const cap = Number(tk.max_m3) || capT;
      const mn = Number(tk.min_m3) || 0;
      const vmax = Math.max(capT, cap, ...pts.map((p) => p.v), 1) * 1.06;
      const Y = (v) => y0 + rowH - (Math.max(0, v) / vmax) * rowH;
      const ln = pts.map((p, j) => `${j ? 'L' : 'M'}${f.X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
      const area = pts.length > 1 ? `${ln} L${f.X(pts[pts.length - 1].t).toFixed(1)} ${y0 + rowH} L${f.X(pts[0].t).toFixed(1)} ${y0 + rowH} Z` : '';
      const over = cap > 0 ? stepWindows(pts, stepMs, (v) => v >= cap * 0.995) : [];
      const under = mn > 0 ? stepWindows(pts, stepMs, (v) => v <= mn * 1.005) : [];
      const bh = Number(tk.binding_hours) || 0;
      const lost = Number(tk.lost_h) || 0;
      const meta = [arr(tk.products).join('·'), arr(tk.berths).length ? '→ ' + tk.berths.join('·') : ''].filter(Boolean).join(' ');
      const flow = [tk.draw_m3h ? `투입 ${num(tk.draw_m3h)}` : '', tk.rundown_m3h ? `생산 유입 ${num(tk.rundown_m3h)}` : ''].filter(Boolean).join(' · ');
      const load = tk.load ? `입고 ${fmtTick(Number(tk.load.imports_m3) || 0)} · 출하 ${fmtTick(Number(tk.load.exports_m3) || 0)} m³` : '';
      const peak = pts.length ? Math.max(...pts.map((p) => p.v)) : null;
      const capLbl = Number(tk.max_m3) && capT && Number(tk.max_m3) !== capT ? `상한 ${fmtTick(cap)}` : `용량 ${fmtTick(cap)}`;
      return `<rect class="rs-plotbg" x="${RES_L}" y="${y0}" width="${f.plotW}" height="${rowH}"/>
        <text class="rs-lbl" x="8" y="${y0 + 13}"><title>${esc(tk.label || tk.id)} (${esc(tk.id || '')})${tk.note ? '\n' + esc(tk.note) : ''}</title>${esc(trunc(tk.label || tk.id, 22))}</text>
        <text class="rs-sub" x="8" y="${y0 + 26}"><title>${esc(flow)}${flow ? ' m³/h' : ''}</title>${esc(trunc(meta, 28))}</text>
        <text class="rs-sub ${bh > 0 ? 'rs-bind' : ''}" x="8" y="${y0 + 39}">${bh > 0 ? `구속 ${fmtH(bh)}${lost > 0 ? ` · 손실 ${fmtH(lost)}` : ''}` : tk.can_bind === false ? '비구속(이 세계에서 닿지 않음)' : '비구속'}</text>
        ${load ? `<text class="rs-sub" x="8" y="${y0 + 52}">${esc(load)}</text>` : ''}
        <g ${f.clip}>${over.map(([s, e]) => `<rect class="rs-over" x="${f.X(s)}" y="${y0}" width="${Math.max(0.8, f.X(e) - f.X(s))}" height="${rowH}"><title>상한 도달 ${fmtTs(s)}–${fmtTs(e)}</title></rect>`).join('')}${under.map(([s, e]) => `<rect class="rs-under" x="${f.X(s)}" y="${y0}" width="${Math.max(0.8, f.X(e) - f.X(s))}" height="${rowH}"><title>최소 재고 도달 ${fmtTs(s)}–${fmtTs(e)}</title></rect>`).join('')}
          ${area ? `<path class="rs-tank-area" d="${area}"/>` : ''}${ln ? `<path class="rs-tank-line" d="${ln}"><title>${esc(tk.label || tk.id)} 재고 m³${peak != null ? ` · 최고 ${num(peak)}` : ''}</title></path>` : ''}</g>
        ${capT && cap !== capT ? `<line class="rs-cap-soft" x1="${RES_L}" x2="${RES_L + f.plotW}" y1="${Y(capT)}" y2="${Y(capT)}"/>` : ''}
        ${cap > 0 ? `<line class="rs-cap" x1="${RES_L}" x2="${RES_L + f.plotW}" y1="${Y(cap)}" y2="${Y(cap)}"/><text class="rs-sub" x="${RES_L + f.plotW + 4}" y="${Y(cap) + 3}">${capLbl}</text>` : ''}
        ${mn > 0 ? `<line class="rs-min" x1="${RES_L}" x2="${RES_L + f.plotW}" y1="${Y(mn)}" y2="${Y(mn)}"/><text class="rs-sub" x="${RES_L + f.plotW + 4}" y="${Math.max(Y(mn) + 3, Y(cap) + 14)}">최소 ${fmtTick(mn)}</text>` : ''}
        ${pts.length ? '' : `<text class="rs-sub" x="${RES_L + 8}" y="${y0 + rowH / 2 + 4}">재고 시계열 없음</text>`}`;
    }).join('');
    return resSvg(f, rows, '탱크 재고');
  }
  function resLinePanel(d) {
    const lines = arr(d.lines);
    return `<div class="panel" data-anchors="lines pipeline">
      <div class="panel-head"><h4>공유 주배관 (Phase 7)</h4><span class="hint">여러 선석이 한 배관을 나눠 쓰면 동시에 하역할 때 속도가 깎인다(PIPELINE)</span></div>
      ${lines.length ? resLineChart(lines) : resEmpty('배관 데이터가 없습니다 (resources.lines)')}
      <div class="legend"><span><i class="rs-l-use"></i>사용 유량</span><span><i class="rs-l-cap"></i>배관 한도</span><span><i class="rs-l-over"></i>한도 도달(속도 제한)</span></div>
    </div>`;
  }
  function resLineChart(lines) {
    const top = 18, rowH = 50, gap = 12;
    const H = top + lines.length * (rowH + gap) - gap + 6;
    const f = resFrame(H, top);
    const rows = lines.map((li, i) => {
      const y0 = top + i * (rowH + gap);
      const sr = li.series || {};
      const pts = seriesPts(sr.start, sr.step_min, sr.used_m3h);
      const stepMs = (Number(sr.step_min) || 60) * 60000;
      const cap = Number(li.capacity_m3h) || 0;
      const vmax = Math.max(cap, ...pts.map((p) => p.v), 1) * 1.08;
      const Y = (v) => y0 + rowH - (Math.max(0, v) / vmax) * rowH;
      let dpath = '';
      pts.forEach((p, j) => { dpath += j ? ` V${Y(p.v).toFixed(1)} H${f.X(p.t + stepMs).toFixed(1)}` : `M${f.X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)} H${f.X(p.t + stepMs).toFixed(1)}`; });
      const area = pts.length ? `${dpath} V${y0 + rowH} H${f.X(pts[0].t).toFixed(1)} Z` : '';
      const over = cap > 0 ? stepWindows(pts, stepMs, (v) => v >= cap * 0.999) : [];
      const bh = Number(li.binding_hours) || 0;
      const lost = Number(li.lost_h) || 0;
      const peak = pts.length ? Math.max(...pts.map((p) => p.v)) : null;
      const who = arr(li.calls).map(vesselName).join(', ');
      return `<rect class="rs-plotbg" x="${RES_L}" y="${y0}" width="${f.plotW}" height="${rowH}"/>
        <text class="rs-lbl" x="8" y="${y0 + 13}"><title>${esc(li.label || li.id)} (${esc(li.id || '')})${li.note ? '\n' + esc(li.note) : ''}${who ? '\n사용 선박: ' + esc(who) : ''}</title>${esc(trunc(li.label || li.id, 22))}</text>
        <text class="rs-sub" x="8" y="${y0 + 26}">${esc(trunc([arr(li.berths).join('·'), LINE_ALLOC[li.allocation] || li.allocation || ''].filter(Boolean).join(' · '), 30))}</text>
        <text class="rs-sub ${bh > 0 ? 'rs-bind' : ''}" x="8" y="${y0 + 39}">${bh > 0 ? `구속 ${fmtH(bh)}${lost > 0 ? ` · 손실 ${fmtH(lost)}` : ''}` : '비구속'}${peak != null ? ` · 최고 ${fmtTick(peak)}` : ''}</text>
        <g ${f.clip}>${over.map(([s, e]) => `<rect class="rs-over" x="${f.X(s)}" y="${y0}" width="${Math.max(0.8, f.X(e) - f.X(s))}" height="${rowH}"><title>한도 도달 ${fmtTs(s)}–${fmtTs(e)}</title></rect>`).join('')}
          ${area ? `<path class="rs-use-area" d="${area}"/><path class="rs-use-line" d="${dpath}"><title>${esc(li.label || li.id)} 사용 유량 m³/h${peak != null ? ` · 최고 ${num(peak)}` : ''}</title></path>` : ''}</g>
        ${cap > 0 ? `<line class="rs-cap" x1="${RES_L}" x2="${RES_L + f.plotW}" y1="${Y(cap)}" y2="${Y(cap)}"/><text class="rs-sub" x="${RES_L + f.plotW + 4}" y="${Y(cap) + 3}">한도 ${fmtTick(cap)} m³/h</text>` : ''}
        ${pts.length ? '' : `<text class="rs-sub" x="${RES_L + 8}" y="${y0 + rowH / 2 + 4}">사용 유량 시계열 없음</text>`}`;
    }).join('');
    return resSvg(f, rows, '공유 주배관 사용 유량');
  }
  function resMarinePanel(d) {
    const m = d.marine || {};
    const mm = m.mooring_master || {};
    const cal = arr(m.tug_calendar);
    const req = m.tug_requirements && typeof m.tug_requirements === 'object' ? Object.entries(m.tug_requirements) : [];
    const reqCols = uniq(req.flatMap(([, v]) => Object.keys(v || {})));
    const pil = m.pilots || null;
    const delayed = arr(m.maneuvers).filter((x) => Number(x.delay_h) > 0);
    return `<div class="panel" data-anchors="marine tug pilotage">
      <div class="panel-head"><h4>도선 · 예선 (Phase 8)</h4><span class="hint">${m.tug_fleet != null ? `예선 ${num(m.tug_fleet)}척${m.tug_label ? ` (${esc(m.tug_label)})` : ''}` : ''}${m.tug_known_cap_at_t != null ? ` · 지금 시점에 알려진 가용 ${num(m.tug_known_cap_at_t)}척` : ''} · 접안·이안 때마다 필요 척수만큼 묶인다(TUG)</span></div>
      ${resMarineChart(m)}
      <div class="legend"><span><i class="rs-l-demand"></i>필요 예선</span><span><i class="rs-l-short"></i>부족</span><span><i class="rs-l-avail"></i>가용 예선</span><span><i class="rs-l-berthing"></i>접안 이동</span><span><i class="rs-l-unberthing"></i>이안 이동</span><span><i class="rs-l-delay"></i>예선·도선 때문에 늦어진 시간</span></div>
      ${delayed.length ? `<div class="bind-sum" style="margin-top:8px">${delayed.map((x) => `<span class="bind-chip"><b>${esc(x.vessel || vesselName(x.call_id))}</b> ${x.kind === 'UNBERTHING' ? '이안' : '접안'} <span class="mono">+${fmtH(x.delay_h)}</span> ${reasonDot(x.delay_reason)}${esc(reasonLabel(x.delay_reason) || '')}</span>`).join('')}</div>` : ''}
      <div class="grid2" style="margin-top:8px">
        <div>
          ${req.length ? `<div class="table-scroll"><table><thead><tr><th>선형</th>${reqCols.map((c) => `<th class="num">${esc(c === 'PIER' ? '부두' : c)}</th>`).join('')}</tr></thead><tbody>${req.map(([k, v]) => `<tr><td>${esc(k)}</td>${reqCols.map((c) => `<td class="num">${v && v[c] != null ? `${num(v[c])}척` : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">선형·선석별 필요 예선 척수 [가정]</p>` : ''}
          ${pil ? `<div class="decision-note"><b>도선사</b> ${pil.pool != null ? `${num(pil.pool)}인` : ''}${pil.lead_minutes != null ? ` · 승선 ${num(pil.lead_minutes)}분 전 배정` : ''}${pil.requirements ? ` · 필요 ${esc(Object.entries(pil.requirements).map(([k, v]) => `${k} ${v}인`).join(', '))}` : ''}</div>` : ''}
        </div>
        <div>
          <div class="decision-note" style="margin-top:0"><b>계류 감독(Mooring Master)</b> ${arr(mm.berths).length ? esc(mm.berths.join(', ')) : '—'} · ${mm.enabled ? '<span class="pill bad">1인 공용 적용</span>' : '<span class="pill k">미적용(기본)</span>'}<div class="small muted">${tagged(mm.note || 'SBM 계류·해지 작업에 계류 감독관이 함께한다 — 감독관이 한 명이면 두 SBM 작업이 겹칠 수 없다 [가정]')}</div></div>
          ${cal.length ? `<div class="table-scroll" style="margin-top:8px"><table><thead><tr><th>기간</th><th class="num">가용</th><th>사유</th><th>통보</th></tr></thead><tbody>${cal.map((c) => `<tr><td class="mono small">${esc(fmtTs(c.from))}–${esc(fmtTs(c.to))}</td><td class="num">${num(c.available)}척</td><td class="small">${tagged(c.reason || '')}</td><td class="small mono">${c.issued_at ? esc(fmtTs(c.issued_at)) : '—'}${c.known_at_t === false ? ' <span class="pill k">지금은 모름</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted" style="margin-top:8px">예선 가용성 변동 없음 (tug_calendar 비어 있음)</p>'}
        </div>
      </div></div>`;
  }
  function resMarineChart(m) {
    const fleet = Number(m.tug_fleet) || 0;
    const t0 = S.t0, t1 = S.tEnd;
    const cal = arr(m.tug_calendar).map((c) => ({ ...c, a: parseTs(c.from), b: parseTs(c.to), n: Number(c.available) })).filter((c) => c.a != null && c.b != null && !isNaN(c.n));
    const mv = arr(m.maneuvers).map((x) => ({ ...x, a: parseTs(x.from), b: parseTs(x.to), n: Number(x.tugs) || 0, dl: Number(x.delay_h) || 0 })).filter((x) => x.a != null && x.b != null && x.b > x.a && x.b > t0 && x.a < t1);
    const ts = m.tug_series || {};
    const availPts = seriesPts(ts.start, ts.step_min, ts.available);
    if (!mv.length && !cal.length && !fleet && !availPts.length) return resEmpty('도선·예선 데이터가 없습니다 (resources.marine)');
    // 선박 이동 레인 — 시간이 겹치면 아래 줄로
    const laneEnd = [];
    const placed = mv.slice().sort((x, y) => x.a - y.a).map((x) => {
      const a0 = x.a - x.dl * 3600e3;
      let k = laneEnd.findIndex((e) => e <= a0);
      if (k < 0) { k = laneEnd.length; laneEnd.push(0); }
      laneEnd[k] = x.b;
      return { ...x, lane: k };
    });
    const nl = Math.max(1, laneEnd.length);
    const top = 18, plotH = 64, laneH = 15, lanesY = top + plotH + 12;
    const H = lanesY + nl * (laneH + 3) + 4;
    const f = resFrame(H, top);
    // 가용: 응답의 시간별 tug_series가 있으면 그대로, 없으면 보유 척수 + 가용 달력
    const availAt = (ms) => {
      if (availPts.length) { let v = availPts[0].v; for (const p of availPts) { if (p.t <= ms) v = p.v; else break; } return v; }
      const cs = cal.filter((c) => c.a <= ms && c.b > ms);
      return cs.length ? Math.min(...cs.map((c) => c.n)) : fleet;
    };
    const bps = [...new Set([t0, t1, ...mv.flatMap((x) => [x.a, x.b]), ...cal.flatMap((c) => [c.a, c.b]), ...availPts.map((p) => p.t)])].filter((t) => t >= t0 && t <= t1).sort((a, b) => a - b);
    const segs = [];
    for (let i = 0; i < bps.length - 1; i++) {
      const a = bps[i], b = bps[i + 1], mid = (a + b) / 2;
      segs.push({ a, b, avail: availAt(mid), dem: mv.filter((x) => x.a <= mid && x.b > mid).reduce((s, x) => s + x.n, 0) });
    }
    const vmax = Math.max(1, fleet, ...segs.map((s) => Math.max(s.avail, s.dem))) + 0.6;
    const Y = (v) => top + plotH - (v / vmax) * plotH;
    const dem = segs.filter((s) => s.dem > 0).map((s) => `<rect class="${s.dem > s.avail ? 'rs-short' : 'rs-demand'}" x="${f.X(s.a)}" y="${Y(s.dem)}" width="${Math.max(0.8, f.X(s.b) - f.X(s.a))}" height="${top + plotH - Y(s.dem)}"><title>${fmtTs(s.a)}–${fmtTs(s.b)} 필요 ${s.dem}척 / 가용 ${s.avail}척${s.dem > s.avail ? ' — 부족' : ''}</title></rect>`).join('');
    let ap = '';
    segs.forEach((s, i) => { ap += `${i ? ` V${Y(s.avail).toFixed(1)}` : `M${f.X(s.a).toFixed(1)} ${Y(s.avail).toFixed(1)}`} H${f.X(s.b).toFixed(1)}`; });
    const stepT = Math.max(1, Math.ceil(vmax / 4));
    const yt = [];
    for (let v = 0; v <= vmax; v += stepT) yt.push(`<text class="rs-ax" x="${RES_L - 6}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`);
    const lanes = placed.map((x) => {
      const y = lanesY + x.lane * (laneH + 3);
      const xa = f.X(Math.max(x.a, t0)), w = Math.max(1.5, f.X(Math.min(x.b, t1)) - xa);
      const nm = x.vessel || vesselName(x.call_id);
      const da = x.dl > 0 ? f.X(Math.max(x.a - x.dl * 3600e3, t0)) : null;
      return `<g>${da != null ? `<rect class="rs-delay" x="${da}" y="${y + 3}" width="${Math.max(1, xa - da)}" height="${laneH - 6}"><title>${esc(nm)} ${x.kind === 'UNBERTHING' ? '이안' : '접안'} 지연 ${fmtH(x.dl)} — ${esc(reasonLabel(x.delay_reason) || x.delay_reason || '')}</title></rect>` : ''}<rect class="rs-mv rs-mv-${esc(x.kind || 'BERTHING')} ${x.dl > 0 ? 'late' : ''}" x="${xa}" y="${y}" width="${w}" height="${laneH}" rx="2"><title>${esc(nm)} ${x.kind === 'UNBERTHING' ? '이안' : '접안'} · ${esc(x.berth_id || '')} · ${fmtTs(x.a)}–${fmtTs(x.b)} · 예선 ${x.n}척${x.pilots != null ? ` · 도선사 ${x.pilots}인` : ''}${x.dl > 0 ? ` · 지연 ${fmtH(x.dl)}` : ''}</title></rect>${w > 46 ? `<text class="rs-mvt" x="${xa + 3}" y="${y + laneH - 4}">${esc(trunc(nm, Math.floor(w / 6.5)))}</text>` : ''}</g>`;
    }).join('');
    const body = `${yt.join('')}<text class="rs-lbl" x="8" y="${top + 14}">예선 척수</text><text class="rs-sub" x="8" y="${top + 28}">필요 vs 가용</text>
      <g ${f.clip}>${dem}${ap ? `<path class="rs-avail" d="${ap}"/>` : ''}</g>
      <text class="rs-sub" x="8" y="${lanesY + 11}">선박 이동</text>${lanes || `<text class="rs-sub" x="${RES_L + 8}" y="${lanesY + 11}">이동 기록 없음</text>`}`;
    return resSvg(f, body, '예선 수요와 가용');
  }
  function resProductsPanel(d) {
    const p = d.products || {};
    const L = p.labels || {};
    const pl = (x) => (x == null ? '—' : L[x] || x);
    const bp = arr(p.berth_products), co = arr(p.changeover_minutes), ap = arr(p.applied);
    const prods = uniq(co.flatMap((c) => [c.from, c.to]));
    const coMap = Object.fromEntries(co.map((c) => [`${c.from}→${c.to}`, c.minutes]));
    const sm = p.sampling_minutes && typeof p.sampling_minutes === 'object' ? p.sampling_minutes : null;
    const real = ap.filter((x) => (Number(x.minutes) || 0) > 0 || (Number(x.sampling_minutes) || 0) > 0);
    const shown = ap.filter((x) => x.prev_call || (Number(x.minutes) || 0) > 0 || (Number(x.sampling_minutes) || 0) > 0);
    return `<div class="panel" data-anchors="products changeover cargo">
      <div class="panel-head"><h4>제품 · 라인 전환 (Phase 5)</h4><span class="hint">앞 선박과 제품이 다르면 라인을 치환(CHANGEOVER)하고, 일부 제품은 샘플 분석(SAMPLING)이 끝나야 본 하역을 시작한다</span></div>
      ${bp.length ? `<div class="berth-prods">${bp.map((b) => `<div><b class="mono">${esc(b.berth_id)}</b> ${arr(b.manifolds).length ? b.manifolds.map((mf) => `<span class="pill k" title="${esc(mf.id)} · 처음 제품 ${esc(pl(mf.initial))}">${esc(mf.id)}: ${esc(arr(mf.products).map(pl).join('·'))}</span>`).join(' ') : arr(b.products).map((x) => `<span class="pill k">${esc(pl(x))}</span>`).join(' ')}</div>`).join('')}</div>` : ''}
      ${prods.length ? `<div class="table-scroll" style="margin-top:8px"><table class="co-mx"><thead><tr><th>전 → 후</th>${prods.map((x) => `<th>${esc(pl(x))}</th>`).join('')}</tr></thead><tbody>${prods.map((a) => `<tr><td><b>${esc(pl(a))}</b></td>${prods.map((b) => { const v = coMap[`${a}→${b}`]; return `<td class="${a === b ? 'muted' : ''}">${a === b ? '—' : v != null ? fmtH(Number(v) / 60) : `<span class="muted" title="표에 없음 — 기본값 ${esc(p.default_changeover_minutes ?? '?')}분">기본</span>`}</td>`; }).join('')}</tr>`).join('')}
        ${sm ? `<tr class="sub"><td>샘플 분석</td>${prods.map((x) => `<td>${sm[x] ? fmtH(Number(sm[x]) / 60) : '—'}</td>`).join('')}</tr>` : ''}</tbody></table></div>
        <p class="small muted">칸 = 라인 치환 시간${p.default_changeover_minutes != null ? ` · 표에 없는 조합은 기본 ${num(p.default_changeover_minutes)}분` : ''}</p>` : ''}
      <h3 style="margin-top:10px">실제 전환 ${real.length}건${shown.length > real.length ? ` <span class="muted">(같은 제품 연속 ${shown.length - real.length}건)</span>` : ''}</h3>
      ${shown.length ? `<div class="table-scroll"><table><thead><tr><th>선석·라인</th><th>앞 항차 → 다음 항차</th><th>제품</th><th class="num">치환</th><th class="num">샘플</th></tr></thead><tbody>${shown.map((x) => { const on = (Number(x.minutes) || 0) > 0 || (Number(x.sampling_minutes) || 0) > 0; return `<tr class="${on ? 'hl' : 'sub'}"><td class="mono">${esc(x.manifold || x.berth_id || '')}</td><td>${esc(x.prev_vessel || (x.prev_call ? vesselName(x.prev_call) : '— (첫 선박)'))} → <b>${esc(x.next_vessel || vesselName(x.next_call))}</b></td><td>${esc(pl(x.from))} → ${esc(pl(x.to))}</td><td class="num">${fmtH((Number(x.minutes) || 0) / 60)}</td><td class="num">${fmtH((Number(x.sampling_minutes) || 0) / 60)}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="small muted">전환 없음 — 같은 선석에 같은 제품이 이어졌다</p>'}
      ${p.note ? `<p class="small muted" style="margin-top:6px">${tagged(p.note)}</p>` : ''}
      ${!bp.length && !prods.length && !ap.length ? resEmpty('제품 데이터가 없습니다 (resources.products)') : ''}
    </div>`;
  }
  function resVettingPanel(d) {
    const vt = arr(d.vetting);
    const pill = (st) => { const s = VET_LABEL[st] || [st || '—', 'k']; return `<span class="pill ${s[1]}">${esc(s[0])}</span>`; };
    return `<div class="panel" data-anchors="vetting safety">
      <div class="panel-head"><h4>검사 · 승인 Vetting (Phase 10)</h4><span class="hint">승인 전에는 입항 이동을 할 수 없다(VETTING) · 지금 시점에 알던 상태와 최종 상태</span></div>
      ${vt.length ? `<div class="table-scroll"><table><thead><tr><th>선박</th><th>지금 알던 상태</th><th>최종</th><th>승인 시각</th><th>조건·변경</th></tr></thead><tbody>${vt.map((v) => {
        const kn = v.known_at_t || {};
        const fin = v.final_status || v.status;
        const known = kn.status || v.status;
        return `<tr class="${known !== 'APPROVED' || fin !== 'APPROVED' ? 'hl' : ''}"><td>${esc(v.vessel || vesselName(v.call_id))}<div class="small muted mono">${esc(v.call_id || '')}</div></td><td>${pill(known)}${kn.cleared_at && kn.cleared_at !== v.cleared_at ? `<div class="small muted mono">예정 ${esc(fmtTs(kn.cleared_at))}</div>` : ''}</td><td>${pill(fin)}</td><td class="mono">${v.cleared_at ? esc(fmtTs(v.cleared_at)) : '<span class="muted">—</span>'}</td><td class="small">${v.condition ? tagged(v.condition) : ''}${arr(v.updates).length ? `<div class="muted">변경 ${v.updates.length}건${v.updates.map((u) => (typeof u === 'object' ? ` · ${esc(fmtTs(u.at || u.issued_at || u.t))} ${esc(u.status || u.text || '')}` : ` · ${esc(u)}`)).join('')}</div>` : ''}${!v.condition && !arr(v.updates).length ? '<span class="muted">—</span>' : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : resEmpty('검사 기록이 없습니다 (resources.vetting)')}
    </div>`;
  }
  function resCallsPanel(d) {
    const calls = arr(d.calls);
    if (!calls.length) return `<div class="panel" data-anchors="calls breakdown"><div class="panel-head"><h4>항차별 대기·지연 분해</h4></div>${resEmpty('항차 데이터가 없습니다 (resources.calls)')}</div>`;
    const rows = calls.map((c) => {
      const parts = [];
      const add = (grp, k, v) => { if (Number(v) > 0.004) parts.push({ grp, k, v: Number(v), id: `${grp}:${k}` }); };
      for (const [grp, o] of [['wait', c.waits_h], ['slow', c.slow_h], ['prep', c.prep_h], ['stop', c.stops_h]]) for (const [k, v] of Object.entries(o || {})) add(grp, k, v);
      add('slow', 'SHORE_RATE', c.shore_rate_lost_h);
      if (Number(c.unberth_delay_h) > 0) add('post', c.unberth_delay_reason || 'UNBERTH', c.unberth_delay_h);
      return { c, parts, total: parts.reduce((a, x) => a + x.v, 0) };
    }).sort((a, b) => b.total - a.total);
    const cols = [];
    for (const r of rows) for (const p of r.parts) if (!cols.some((c) => c.id === p.id)) cols.push(p);
    const GORD = ['wait', 'slow', 'prep', 'stop', 'post'];
    cols.sort((a, b) => GORD.indexOf(a.grp) - GORD.indexOf(b.grp));
    const colLabel = (p) => `${reasonLabel(p.k)}${p.grp === 'stop' ? ' (중단)' : p.grp === 'post' ? ' (이안)' : ''}`;
    const W = 760, LW = 210, VW = 70, rowH = 24, H = rows.length * rowH + 8;
    const max = Math.max(1, ...rows.map((r) => r.total));
    const XW = (h) => (h / max) * (W - LW - VW);
    const g = rows.map((r, i) => {
      const y = 4 + i * rowH;
      let x = LW;
      const nm = r.c.vessel || vesselName(r.c.call_id);
      const segs = r.parts.slice().sort((a, b) => GORD.indexOf(a.grp) - GORD.indexOf(b.grp)).map((p) => {
        const w = XW(p.v);
        const s = `<rect class="rz rz-${esc(p.k)} rzg-${p.grp}" x="${x}" y="${y + 5}" width="${Math.max(0.8, w)}" height="${rowH - 10}"><title>${esc(nm)} · ${esc(colLabel(p))} ${fmtH(p.v)} — ${REASON_GROUP[p.grp] || p.grp}</title></rect>`;
        x += w;
        return s;
      }).join('');
      return `<text class="wf-label" x="0" y="${y + rowH / 2 + 4}"><title>${esc(nm)} · ${esc(r.c.berth_id || '')}${r.c.vessel_type ? ' · ' + esc(r.c.vessel_type) : ''}</title>${esc(trunc(`${nm} · ${r.c.berth_id || ''}`, 30))}</text>${segs || `<text class="rs-sub" x="${LW}" y="${y + rowH / 2 + 4}">대기·지연 없음</text>`}<text class="wf-val" x="${W}" y="${y + rowH / 2 + 4}" text-anchor="end">${fmtH(r.total)}</text>`;
    }).join('');
    const hasAmt = calls.some((c) => c.amount_usd != null);
    return `<div class="panel" data-anchors="calls breakdown waits">
      <div class="panel-head"><h4>항차별 대기·지연 분해</h4><span class="hint">대기(접안 전) · 하역 속도 제한 · 접안 후 준비 · 하역 중단 · 이안 지연을 사유별로 쌓았다</span></div>
      <div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="min-width:600px;width:100%;height:auto" role="img" aria-label="항차별 대기·지연">${g}</svg></div>
      <div class="legend" style="margin-top:4px">${uniq(cols.map((p) => p.k)).map((k) => `<span><i class="rz rz-${esc(k)}"></i>${esc(reasonLabel(k))}</span>`).join('') || '<span>대기·지연 없음</span>'}${cols.some((p) => p.grp === 'stop' || p.grp === 'post') ? '<span>점선 테두리 = 하역 중단·이안 지연</span>' : ''}</div>
      <details style="margin-top:8px"><summary>숫자로 보기</summary><div class="table-scroll"><table><thead><tr><th>선박</th><th>선석</th><th>제품</th>${cols.map((p) => `<th class="num" title="${esc(p.id)}">${esc(colLabel(p))}</th>`).join('')}<th class="num">합계</th>${hasAmt ? '<th class="num">체선료</th>' : ''}</tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.c.vessel || vesselName(r.c.call_id))}</td><td>${esc(r.c.berth_id || '')}</td><td class="small">${esc(r.c.product_label || r.c.product || '')}</td>${cols.map((p) => { const q = r.parts.find((x) => x.id === p.id); return `<td class="num ${q ? '' : 'muted'}">${q ? fmtH(q.v) : '—'}</td>`; }).join('')}<td class="num"><b>${fmtH(r.total)}</b></td>${hasAmt ? `<td class="num ${Number(r.c.amount_usd) > 0.5 ? 'pos' : ''}">${fmtUSD(r.c.amount_usd)}</td>` : ''}</tr>`).join('')}
      </tbody></table></div></details>
    </div>`;
  }

  // ================================================================ 사례 복원 (P12)
  const SNAP_ORDER = ['T-72h', 'T-48h', 'T-24h', 'ARRIVAL', 'DECISION', 'RESULT'];
  const SNAP_LABEL = { 'T-72h': '도착 72시간 전', 'T-48h': '도착 48시간 전', 'T-24h': '도착 24시간 전', ARRIVAL: '도착', DECISION: '결정', RESULT: '결과' };
  const KNOWN_ROWS = [['status', '상태', 'status'], ['eta', 'ETA 도착 예정', 'ts'], ['ata', 'ATA 실제 도착', 'ts'], ['etb', 'ETB 접안 예정', 'ts'], ['etc', 'ETC 하역 종료 예정', 'ts'],
    ['laytime_start', '레이타임 개시', 'ts'], ['demurrage_h', '체선 예상', 'h'], ['exposure_usd', '체선료 노출(예측)', 'usd'], ['plan_version', '계획 버전', 'ver'],
    ['forecast_id', '기상 예보', 'str'], ['berth_id', '선석', 'str'], ['berth_queue', '선석 대기열', 'queue']];
  const KNOWN_HIDE = new Set(['queue_basis']);
  const CALL_STATUS = { EN_ROUTE: '항해 중', NOT_ARRIVED: '도착 전', ARRIVING: '도착 전', WAITING: '묘박 대기', SHIFTING: '이동 중', BERTHED: '접안', OPS: '하역 중', STOPPED: '하역 중단', COMPLETED: '하역 완료', SAILED: '출항' };
  const snapCls = (k) => 'k-' + String(k || '').replace(/[^A-Za-z0-9]/g, '');
  function fmtKnown(v, kind) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '<span class="muted">—</span>';
    switch (kind) {
      case 'ts': return `<span class="mono">${esc(fmtTs(v))}</span>`;
      case 'usd': return `<span class="mono">${fmtUSD(v)}</span>`;
      case 'ver': return `v${esc(v)}`;
      case 'h': return `<span class="mono">${fmtH(v)}</span>`;
      case 'status': return `<span class="pill status ${esc(v)}">${esc(CALL_STATUS[v] || v)}</span>`;
      case 'queue': return `<span class="flowline">${arr(v).map((x, i) => `${i ? '<span class="fl-arrow">→</span>' : ''}<span class="fl-step">${esc(x)}</span>`).join('')}</span>`;
      default: return esc(typeof v === 'object' ? JSON.stringify(v) : v);
    }
  }
  async function renderCaseStudy(force) {
    const have = S.v2.cases && S.v2.cases.data;
    if (!have) main.innerHTML = loadingPanel('사례 목록');
    const r = await fetchV2('cases', '/api/casestudies', force && !have);
    if (S.tab !== 'casestudy') return;
    if (!r.data) { main.innerHTML = v3Missing('/api/casestudies', r.error, '사례 복원'); return; }
    const list = Array.isArray(r.data) ? r.data : arr(r.data.cases || r.data.items);
    if (!list.length) { main.innerHTML = '<div class="panel empty">복원할 사례가 없습니다</div>'; return; }
    if (!S.caseId || !list.some((c) => c.call_id === S.caseId)) { S.caseId = list[0].call_id; S.caseSnap = null; }
    updateHash();
    main.innerHTML = `
      <div class="panel v2head" data-anchors="casestudy top cases">
        <div class="panel-head" style="margin:0"><h4>사례 복원 — 어려웠던 하루를 시점별로 다시 본다 (Phase 12)</h4><span class="hint">가상 시나리오 · 체선료 큰 순 ${list.length}건</span></div>
        <p class="small muted" style="margin-top:6px">도착 72시간 전부터 결과까지, <b>그 시점에 알던 정보만</b>으로 무엇이 보였고 무엇을 결정했는지 되짚는다. 결과를 안 뒤의 “그때 이렇게 했어야”와 그때 정말 알 수 있었던 것을 구분하는 것이 목적이다.</p>
        <div class="case-picker" role="tablist" aria-label="사례">${list.map(casePick).join('')}</div>
      </div>
      <div id="caseBody">${loadingPanel('사례')}</div>`;
    await loadCase();
    if (S.tab === 'casestudy' && S.pendingAnchor) flushAnchor();
  }
  const casePick = (c) => `<button type="button" class="case-pick ${c.call_id === S.caseId ? 'active' : ''}" data-case="${esc(c.call_id)}" role="tab" aria-selected="${c.call_id === S.caseId}">
      <span class="cp-top"><b>${esc(c.vessel || vesselName(c.call_id))}</b><span class="mono small muted">${esc(c.berth_id || '')}</span></span>
      <span class="cp-amt mono ${Number(c.amount_usd) > 0.5 ? 'pos' : ''}">${fmtUSD(c.amount_usd)}</span>
      ${c.title ? `<span class="small muted clamp">${esc(c.title)}</span>` : ''}</button>`;
  async function loadCase() {
    const id = S.caseId;
    if (!id) return;
    const seq = ++S.caseSeq;
    const path = `/api/casestudy?call_id=${encodeURIComponent(id)}`;
    let r = S.v2.casestudy;
    if (!(r && r.path === path && r.data)) {
      const b = $('#caseBody');
      if (b) b.innerHTML = loadingPanel('사례');
      try { r = { path, data: await GET(path), error: null }; } catch (e) { r = { path, data: null, error: e.message }; }
      if (seq !== S.caseSeq) return;
      S.v2.casestudy = r;
    }
    const box = $('#caseBody');
    if (S.tab !== 'casestudy' || !box) return;
    if (!r.data) { box.innerHTML = v3Missing(path, r.error, '사례'); return; }
    const snaps = sortedSnaps(r.data);
    if (!S.caseSnap || !snaps.some((s) => s.key === S.caseSnap)) S.caseSnap = (snaps.find((s) => s.key === 'DECISION') || snaps[0] || {}).key || null;
    box.innerHTML = caseView(r.data);
  }
  function sortedSnaps(cs) {
    const ord = (k) => { const i = SNAP_ORDER.indexOf(k); return i < 0 ? 99 : i; };
    return arr(cs && cs.snapshots).slice().sort((a, b) => ord(a.key) - ord(b.key) || (parseTs(a.t) || 0) - (parseTs(b.t) || 0));
  }
  function caseView(cs) {
    const snaps = sortedSnaps(cs);
    const res = cs.result || {};
    const dps = arr(cs.decision_points);
    return `
      <div class="panel" data-anchors="summary">
        <div class="detail-head" style="margin:0"><div class="ttl">
          <div class="meta"><span class="pill k">${esc(cs.berth_id || '')}</span><span class="mono small muted">${esc(cs.call_id || '')}</span>${cs.call_id ? linkBtn('statement', cs.call_id, '계산서 →') : ''}</div>
          <h2>${tagged(cs.title || cs.vessel || '')}</h2>
          <div class="small"><b>${esc(cs.vessel || vesselName(cs.call_id))}</b>${cs.basis ? ` <span class="pill basis-${esc(cs.basis)}">${esc(BASIS_LABEL[cs.basis] || ABASIS[cs.basis] || cs.basis)}</span>` : ''}</div>
          ${cs.summary ? `<p class="muted" style="margin-top:4px">${tagged(cs.summary)}</p>` : ''}
          ${cs.reference && typeof cs.reference === 'object' ? `<div class="small muted" style="margin-top:4px">기준 시각 T = <span class="mono">${esc(fmtTs(cs.reference.T))}</span>${cs.reference.basis ? ` (${esc(cs.reference.basis)})` : ''}${cs.reference.plan_known_from ? ` · 기준 계획 공개 <span class="mono">${esc(fmtTs(cs.reference.plan_known_from))}</span>` : ''}</div>` : ''}
          ${cs.note ? `<div class="small muted">${tagged(cs.note)}</div>` : ''}
        </div>
        <div class="bignum"><span class="to ${Number(res.amount_usd) > 0.5 ? 'pos' : ''}">${fmtUSD(res.amount_usd)}</span><span class="d muted" style="font-weight:400">실제 체선료</span></div></div>
      </div>
      <div class="panel" data-anchors="snapshots rail">
        <div class="panel-head"><h4>시점별 스냅샷 — 그때 무엇을 알고 있었나</h4><span class="hint">카드를 누르면 그 시점의 정보 · 막대 = 그 시점에 예측한 체선료 노출</span></div>
        ${snaps.length ? `<div class="snap-rail" role="group" aria-label="스냅샷">${snaps.map((s) => snapCard(s, snaps)).join('')}</div>
        <div id="snapDetail">${snapDetail(snaps.find((s) => s.key === S.caseSnap))}</div>
        <div id="knowBox">${knowTable(snaps)}</div>` : '<div class="empty">snapshots 없음</div>'}
      </div>
      <div class="panel" data-anchors="decision_points decisions">
        <div class="panel-head"><h4>결정 시점 — 고른 것, 버린 것, 그때 없던 정보</h4><span class="hint">${dps.length}건</span></div>
        ${dps.map(decisionPointCard).join('') || '<div class="empty">decision_points 없음</div>'}
      </div>
      <div class="grid2 v2grid">
        <div class="panel" data-anchors="result">
          <div class="panel-head"><h4>결과</h4></div>
          <div class="kpis v2" style="margin-bottom:10px">
            <div class="kpi"><span class="label">묘박 대기</span><span class="value">${fmtH(res.wait_h)}</span></div>
            <div class="kpi"><span class="label">체선 시간</span><span class="value">${fmtH(res.demurrage_h)}</span></div>
            <div class="kpi"><span class="label">체선료</span><span class="value ${Number(res.amount_usd) > 0.5 ? 'dem' : ''}">${fmtUSD(res.amount_usd)}</span></div>
          </div>
          ${arr(res.wait_by_reason).length ? `<div class="chips" style="margin-bottom:8px"><span class="small muted">대기 사유</span>${res.wait_by_reason.map((w) => `<span class="pill k">${reasonDot(w.reason)}${esc(w.label || reasonLabel(w.reason))} <span class="mono">${fmtH(w.hours)}</span></span>`).join('')}</div>` : ''}
          <dl class="kv"><dt>계획 vs 실제</dt><dd>${tagged(res.plan_vs_actual || '—')}</dd><dt>다시 결정한다면</dt><dd>${tagged(res.would_decide_again || '—')}</dd></dl>
        </div>
        <div class="panel" data-anchors="counterfactual">
          <div class="panel-head"><h4>반사실 — 다르게 결정했다면</h4><span class="hint">같은 항차, 결정 규칙만 바꿔 다시 계산</span></div>
          ${cfChart(arr(cs.counterfactual))}
        </div>
      </div>
      <div class="panel" data-anchors="lessons">
        <div class="panel-head"><h4>교훈 — 다음 설계에 반영할 것</h4></div>
        ${arr(cs.lessons).length ? `<ol class="lessons">${cs.lessons.map((x) => `<li>${tagged(x)}</li>`).join('')}</ol>` : '<div class="empty">lessons 없음</div>'}
      </div>`;
  }
  function snapCard(s, snaps) {
    const k = s.known || {};
    const max = Math.max(1, ...snaps.map((x) => Number((x.known || {}).exposure_usd) || 0));
    const ex = k.exposure_usd == null || k.exposure_usd === '' ? NaN : Number(k.exposure_usd);
    const on = s.key === S.caseSnap;
    return `<button type="button" class="snap ${snapCls(s.key)} ${on ? 'active' : ''}" data-snap="${esc(s.key)}" aria-pressed="${on}">
      <span class="snap-key mono">${esc(s.key)}</span><span class="snap-lbl">${esc(s.label || SNAP_LABEL[s.key] || '')}</span>
      <span class="mono small muted">${esc(fmtTs(s.t))}</span>
      <span class="snap-exp mono ${ex > 0.5 ? 'pos' : ''}">${isNaN(ex) ? '—' : fmtUSD(ex)}</span>
      <span class="snap-bar" aria-hidden="true"><i style="width:${!isNaN(ex) && ex > 0 ? Math.max(2, (ex / max) * 100).toFixed(1) : 0}%"></i></span>
      <span class="snap-tags">${arr(s.changed).length ? `<span class="pill k">변경 ${s.changed.length}</span>` : ''}${arr(s.risks).length ? `<span class="pill sev-medium">위험 ${s.risks.length}</span>` : ''}${arr(s.item_ids).length ? `<span class="pill sev-low">작업함 ${s.item_ids.length}</span>` : ''}</span>
    </button>`;
  }
  function snapDetail(s) {
    if (!s) return '';
    const k = s.known || {};
    const known = KNOWN_ROWS.filter(([key]) => k[key] != null && k[key] !== '' && !(Array.isArray(k[key]) && !k[key].length)).map(([key, lbl, kind]) => `<dt>${esc(lbl)}</dt><dd>${fmtKnown(k[key], kind)}${key === 'berth_queue' && k.queue_basis ? `<div class="small muted">${tagged(k.queue_basis)}</div>` : ''}</dd>`).join('');
    const extra = Object.keys(k).filter((key) => !KNOWN_ROWS.some(([x]) => x === key) && !KNOWN_HIDE.has(key) && k[key] != null && k[key] !== '').map((key) => `<dt class="mono small">${esc(key)}</dt><dd>${fmtKnown(k[key], 'str')}</dd>`).join('');
    return `<div class="snap-detail">
      <div class="sd-head"><b>${esc(s.label || SNAP_LABEL[s.key] || s.key)}</b> <span class="mono small muted">${esc(s.key)} · ${esc(fmtTs(s.t))}</span></div>
      <div class="grid3x">
        <div><h3>알고 있던 값</h3>${known || extra ? `<dl class="kv">${known}${extra}</dl>` : '<p class="small muted">기록 없음</p>'}</div>
        <div><h3>새로 바뀐 것</h3>${arr(s.changed).length ? `<ul class="narrative">${s.changed.map((x) => `<li>${tagged(x)}</li>`).join('')}</ul>` : '<p class="small muted">변화 없음</p>'}</div>
        <div><h3>그때 보이던 위험</h3>${arr(s.risks).length ? `<ul class="narrative risks">${s.risks.map((x) => `<li>${tagged(x)}</li>`).join('')}</ul>` : '<p class="small muted">없음</p>'}
          ${arr(s.item_ids).length ? `<h3 style="margin-top:10px">연결된 작업함 항목</h3><div class="chips">${s.item_ids.map((id) => `<button type="button" class="linkbtn mono" data-open-item="${esc(id)}" data-at="${esc(s.t || '')}" title="시각을 ${esc(fmtTs(s.t))}(으)로 옮기고 작업함에서 엽니다">${esc(id)} → 작업함</button>`).join('')}</div>` : ''}</div>
      </div></div>`;
  }
  function knowTable(snaps) {
    if (snaps.length < 2) return '';
    const rows = KNOWN_ROWS.filter(([k]) => snaps.some((s) => (s.known || {})[k] != null));
    if (!rows.length) return '';
    return `<details class="know" style="margin-top:10px" open><summary>시점별로 알고 있던 값 — 앞 시점과 달라진 칸 강조</summary><div class="table-scroll"><table class="know-table"><thead><tr><th>항목</th>${snaps.map((s) => `<th class="${s.key === S.caseSnap ? 'cur' : ''}">${esc(s.key)}<div class="small muted mono">${esc(fmtTs(s.t))}</div></th>`).join('')}</tr></thead><tbody>
      ${rows.map(([k, lbl, kind]) => `<tr><td>${esc(lbl)}</td>${snaps.map((s, i) => {
        const v = (s.known || {})[k];
        const pv = i ? (snaps[i - 1].known || {})[k] : undefined;
        const chg = i > 0 && JSON.stringify(v ?? null) !== JSON.stringify(pv ?? null);
        return `<td class="${chg ? 'chg' : ''} ${s.key === S.caseSnap ? 'cur' : ''}">${fmtKnown(v, kind)}</td>`;
      }).join('')}</tr>`).join('')}
    </tbody></table></div></details>`;
  }
  function selectSnap(key) {
    const cs = S.v2.casestudy && S.v2.casestudy.data;
    if (!cs) return;
    S.caseSnap = key;
    const snaps = sortedSnaps(cs);
    $$('.snap[data-snap]').forEach((b) => { const on = b.dataset.snap === key; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    const d = $('#snapDetail');
    if (d) d.innerHTML = snapDetail(snaps.find((s) => s.key === key));
    const k = $('#knowBox');
    if (k) k.innerHTML = knowTable(snaps);
  }
  function decisionPointCard(p) {
    const opts = arr(p.options);
    const hasCall = opts.some((o) => o.call_delta_usd != null), hasTot = opts.some((o) => o.total_usd != null);
    return `<div class="dpoint">
      <div class="dp-head"><span class="mono">${esc(fmtTs(p.t))}</span>${p.trigger ? `<span class="pill k">${esc(TRIGGER_LABEL[p.trigger] || p.trigger)}</span>` : ''}${p.label ? `<span>${tagged(p.label)}</span>` : ''}${p.item_id ? `<button type="button" class="linkbtn mono" data-open-item="${esc(p.item_id)}" data-at="${esc(p.t || '')}" title="시각을 ${esc(fmtTs(p.t))}(으)로 옮기고 작업함에서 엽니다">${esc(p.item_id)} → 작업함</button>` : ''}</div>
      ${p.chosen ? `<div class="small" style="margin-bottom:6px">선택 <b>${tagged(p.chosen)}</b></div>` : ''}
      ${opts.length ? `<div class="table-scroll"><table><thead><tr><th>옵션</th><th>내용</th><th class="num">예상 절감(전체)</th>${hasCall ? '<th class="num">이 선박 Δ</th>' : ''}${hasTot ? '<th class="num">전체 노출</th>' : ''}<th>선택</th></tr></thead><tbody>
        ${opts.map((o) => `<tr class="${o.chosen ? 'hl' : ''}"><td class="mono">${esc(o.id || '')}</td><td>${tagged(o.title || '')}</td><td class="num ${Number(o.saving_usd) > 0.5 ? 'neg' : ''}">${fmtUSD(o.saving_usd)}</td>${hasCall ? `<td class="num ${dCls(o.call_delta_usd)}">${fmtDelta(o.call_delta_usd)}</td>` : ''}${hasTot ? `<td class="num">${fmtUSD(o.total_usd)}</td>` : ''}<td>${o.chosen ? '<span class="pill ok">✓ 선택</span>' : '<span class="small muted">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <div class="grid3x" style="margin-top:8px">
        <div class="dp-box why"><span class="lbl">왜 이것을 골랐나</span><div>${tagged(p.why || '—')}</div></div>
        <div class="dp-box rej"><span class="lbl">버린 대안과 이유</span>${arr(p.rejected_why).length ? `<ul>${p.rejected_why.map((x) => `<li>${tagged(x)}</li>`).join('')}</ul>` : '<div class="muted">—</div>'}</div>
        <div class="dp-box miss"><span class="lbl">그때 없던 정보</span>${arr(p.missing_info).length ? `<ul>${p.missing_info.map((x) => `<li>${tagged(x)}</li>`).join('')}</ul>` : '<div class="muted">—</div>'}</div>
      </div></div>`;
  }
  function cfChart(list) {
    const rows = list.filter((x) => x && x.usd != null && !isNaN(x.usd)).map((x) => ({ ...x, usd: Number(x.usd), hind: /사후|hindsight/i.test(String(x.label || '')) }));
    if (!rows.length) return '<div class="empty">counterfactual 없음</div>';
    const real = rows.filter((x) => !x.hind);
    const best = real.length ? Math.min(...real.map((x) => x.usd)) : null;
    const base = rows[0].usd;
    const max = Math.max(1, ...rows.map((x) => x.usd));
    const W = 540, LW = 140, VW = 158, rowH = 28, H = rows.length * rowH + 8;
    const X = (v) => LW + (Math.max(0, v) / max) * (W - LW - VW);
    const g = rows.map((x, i) => {
      const y = 4 + i * rowH;
      const cls = x.hind ? 'cf-hind' : i === 0 ? 'cf-base' : best != null && Math.abs(x.usd - best) < 0.5 ? 'cf-best' : 'cf-bar';
      return `<text class="wf-label" x="0" y="${y + rowH / 2 + 4}"><title>${esc(x.label)}</title>${esc(trunc(x.label, 18))}</text>
        <rect class="${cls}" x="${LW}" y="${y + 5}" width="${Math.max(1.5, X(x.usd) - LW)}" height="${rowH - 11}" rx="2"><title>${esc(x.label)} ${fmtUSD(x.usd)}${x.hind ? ' — 미래를 아는 계산(실현 불가)' : ''}</title></rect>
        <text class="wf-val" x="${W}" y="${y + rowH / 2 + 4}" text-anchor="end">${fmtUSD(x.usd)}${i ? ` (${fmtDelta(x.usd - base)})` : ''}</text>`;
    }).join('');
    const tot = rows.some((x) => x.total_usd != null);
    return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" style="min-width:420px;width:100%;height:auto" role="img" aria-label="반사실 비교">${g}</svg></div>
      <div class="legend" style="margin-top:4px"><span><i class="cf-l-base"></i>첫 줄(기준)</span><span><i class="cf-l-best"></i>실현 가능한 최소</span><span><i class="cf-l-hind"></i>사후 최적(실현 불가 하한)</span><span>괄호 = 첫 줄 대비</span></div>
      ${tot ? `<div class="table-scroll" style="margin-top:8px"><table><thead><tr><th>결정 규칙</th><th class="num">이 선박</th><th class="num">전체(모든 선박)</th></tr></thead><tbody>${rows.map((x, i) => `<tr class="${!x.hind && best != null && Math.abs(x.usd - best) < 0.5 ? 'hl' : ''}"><td>${esc(x.label)}${x.hind ? ' <span class="small muted">(실현 불가)</span>' : ''}</td><td class="num">${fmtUSD(x.usd)}</td><td class="num">${fmtUSD(x.total_usd)}${i && rows[0].total_usd != null && x.total_usd != null ? ` <span class="small ${dCls(x.total_usd - rows[0].total_usd)}">${fmtDelta(x.total_usd - rows[0].total_usd)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin-top:4px">한 선박만 보면 손해 같아도 전체로는 이득일 수 있다 — 결정은 전체 합으로 판단한다.</p>` : ''}`;
  }
  async function openItemAt(id, at) {
    const target = parseTs(at);
    pause();
    S.tab = 'inbox';
    S.itemId = id;
    S.item = null;
    closeDrawer();
    const cur = parseTs(S.t);
    if (target != null && (cur == null || target > cur)) await goto(target);
    else await renderTab(true);
    window.scrollTo({ top: 0 });
    if (!arr(S.state && S.state.inbox).some((i) => i.id === id)) showOk(`${id}는 ${fmtTs(S.t)} 시점 작업함에 없습니다 — 상단에서 시각을 옮겨 보세요`);
  }

  // ================================================================ 벤치마크 (P18)
  const BM_FIELDS = [
    ['context', '배경'], ['similarity', '울산 CLX와 비슷한 점'], ['problem', '해결한 문제'], ['baseline', '기존 방식'], ['decision', '결정한 것'],
    ['objective', '최소화한 것'], ['constraint', '반영한 현실 조건'], ['data', '필요했던 데이터'], ['method', '방법'], ['validation', '비교 기준'],
    ['result', '개선 결과'], ['limitation', '해결 못 한 것'], ['human', '사람의 개입'], ['sk_implication', 'SK 울산 시사점'], ['what_not_to_copy', '그대로 가져오면 안 되는 것'],
  ];
  const EVID_CLASS = { '사실': 'fact', '추론': 'infer', '혼합': 'mixed' };
  const evidPill = (e) => (e ? `<span class="pill ev-${EVID_CLASS[e] || 'mixed'}" title="사실 = 출처에 적힌 내용 · 추론 = 우리 해석 · 혼합 = 둘 다">${esc(e)}</span>` : '');
  function srcLink(s) {
    const u = String((s && s.url) || '');
    const t = (s && s.title) || u || '출처';
    return /^https?:\/\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t);
  }
  async function renderBenchmark(force) {
    const have = S.v2.discovery && S.v2.discovery.data;
    if (!have) main.innerHTML = loadingPanel('벤치마크');
    const r = await fetchV2('discovery', '/api/discovery', force && !have);
    if (S.tab !== 'benchmark') return;
    if (!r.data) { main.innerHTML = v2Missing('/api/discovery', r.error); return; }
    const d = r.data;
    const bm = arr(d.benchmark);
    const tq = Object.fromEntries(arr(d.benchmark_template).map((t) => [String(t.key || '').toLowerCase().replace(/[\s/-]+/g, '_'), t.question]));
    const ev = (x) => bm.filter((b) => b.evidence === x).length;
    main.innerHTML = `
      <div class="panel v2head" data-anchors="benchmark top">
        <div class="panel-head" style="margin:0"><h4>외부 벤치마크 — 공개 사례를 같은 15개 질문으로 (Phase 18)</h4><span class="hint">${bm.length ? `${bm.length}개 사례 · 사실 ${ev('사실')} · 혼합 ${ev('혼합')} · 추론 ${ev('추론')}` : '사례 준비 중'}</span></div>
        <div class="callout" style="margin-top:10px"><b>따라 할 것보다 검증할 것을 찾는다.</b> 실재하는 공개 사례만 쓰고 모든 사례에 출처 링크를 단다. ${evidPill('사실')} 출처에 적힌 내용 · ${evidPill('추론')} 우리 해석 · ${evidPill('혼합')} 둘 다. 마지막 두 칸(SK 울산 시사점 · 그대로 가져오면 안 되는 것)이 이 화면의 결론이다.</div>
        ${bm.length ? `<div class="seg-wrap" style="margin-top:10px"><div class="seg" role="group" aria-label="보기">${[['cards', '사례 카드'], ['matrix', '비교표']].map(([k, l]) => `<button type="button" data-bm-view="${k}" class="${S.bmView === k ? 'active' : ''}">${l}</button>`).join('')}</div>
          <div class="chips">${bm.map((b) => `<button type="button" class="linkbtn mono" data-bm-jump="${esc(b.id)}" title="${esc(b.title || '')}">${esc(b.id)}</button>`).join('')}</div></div>` : ''}
      </div>
      ${bm.length ? (S.bmView === 'matrix' ? bmMatrix(bm, tq) : `<div class="bm-grid">${bm.map((b) => bmCard(b, tq)).join('')}</div>`) : bmEmpty(d)}
      ${bmTemplate(d)}`;
    if (S.pendingAnchor) flushAnchor();
  }
  function bmCard(b, tq) {
    return `<article class="bm-card" id="bm-${esc(b.id)}" data-anchors="${esc(b.id)} case_${esc(String(b.id || '').toLowerCase())}">
      <div class="bm-head"><span class="bm-id mono">${esc(b.id)}</span>
        <div class="bm-ttl"><b>${esc(b.title || '')}</b><div class="small muted">${esc([b.organization, b.country, b.year].filter((x) => x != null && x !== '').join(' · '))}${b.type ? ` · <span class="pill k">${esc(b.type)}</span>` : ''}</div></div>
        ${evidPill(b.evidence)}</div>
      <dl class="bm-dl">${BM_FIELDS.map(([k, l]) => `<dt title="${esc(tq[k] || '')}">${esc(l)}</dt><dd class="${!b[k] ? 'muted' : k === 'sk_implication' ? 'bm-key' : k === 'what_not_to_copy' ? 'bm-warn' : ''}">${b[k] ? tagged(b[k]) : '—'}</dd>`).join('')}</dl>
      <div class="bm-src"><span class="small muted">출처</span>${arr(b.sources).length ? `<ul>${b.sources.map((s) => `<li>${srcLink(s)}</li>`).join('')}</ul>` : ' <span class="pill bad">출처 없음</span>'}${b.verified_on ? `<div class="small muted">확인일 ${esc(b.verified_on)}</div>` : ''}</div>
    </article>`;
  }
  function bmMatrix(bm, tq) {
    return `<div class="panel" data-anchors="matrix compare">
      <div class="panel-head"><h4>비교표 — 15개 질문 × ${bm.length}개 사례</h4><span class="hint">칸에 마우스를 올리면 전체 문장 · 왼쪽 항목에 마우스를 올리면 템플릿 질문</span></div>
      <div class="table-scroll"><table class="bm-matrix"><thead><tr><th>항목</th>${bm.map((b) => `<th title="${esc(b.title || '')}"><span class="mono">${esc(b.id)}</span> ${esc(trunc(b.title || '', 24))}<div>${evidPill(b.evidence)}</div></th>`).join('')}</tr></thead><tbody>
      ${BM_FIELDS.map(([k, l]) => `<tr class="${k === 'sk_implication' ? 'bm-row-key' : k === 'what_not_to_copy' ? 'bm-row-warn' : ''}"><td title="${esc(tq[k] || '')}">${esc(l)}</td>${bm.map((b) => `<td title="${esc(b[k] || '')}"><div class="clamp4">${b[k] ? tagged(b[k]) : '<span class="muted">—</span>'}</div></td>`).join('')}</tr>`).join('')}
      <tr><td>출처</td>${bm.map((b) => `<td class="small">${arr(b.sources).map(srcLink).join('<br>') || '<span class="pill bad">없음</span>'}</td>`).join('')}</tr>
      </tbody></table></div></div>`;
  }
  function bmEmpty(d) {
    return `<div class="panel" data-anchors="cases"><div class="panel-head"><h4>사례</h4><span class="hint">discovery.benchmark 준비 중 — 사례 목록과 템플릿만 표시</span></div>
      ${arr(d.benchmark_cases).length ? `<div class="chips">${d.benchmark_cases.map((x) => `<span class="pill k">${esc(x)}</span>`).join('')}</div>` : '<div class="empty">사례 없음</div>'}</div>`;
  }
  function bmTemplate(d) {
    const tpl = arr(d.benchmark_template);
    if (!tpl.length) return '';
    return `<details class="panel appx" data-anchors="template benchmark_template"><summary><b>사례 템플릿</b><span class="hint">모든 사례에 같은 ${tpl.length}개 질문을 던진다 — 비교 가능하게</span></summary><div class="appx-body"><div class="table-scroll"><table><thead><tr><th>항목</th><th>화면 표기</th><th>질문</th></tr></thead><tbody>
      ${tpl.map((t) => { const k = String(t.key || '').toLowerCase().replace(/[\s/-]+/g, '_'); const f = BM_FIELDS.find(([x]) => x === k); return `<tr><td class="mono small">${esc(t.key)}</td><td>${esc(f ? f[1] : '—')}</td><td class="small">${esc(t.question || '')}</td></tr>`; }).join('')}
      </tbody></table></div></div></details>`;
  }

  // ================================================================ 도입 검증 (P28·P30)
  const AGROUP = [['Financial', '재무'], ['Operational', '운영'], ['Risk', '리스크'], ['Decision Quality', '의사결정 품질'], ['Agent', '에이전트']];
  const ABASIS = { VIRTUAL: '가상 데이터', ASSUMED: '가정', NA: '미측정' };
  const ASTATUS = { OK: '목표 충족', WARN: '주의', NA: '측정 전' };
  const PSTATUS = { NOW: '지금', NEXT: '다음', LATER: '이후' };
  const PSTAGE_KO = { PoC: '개념 검증', 'Shadow Mode': '그림자 운영 — 추천만, 결정은 사람', Pilot: '시범 운영', 'Partial Adoption': '부분 도입', Integration: '시스템 연동', 'Scale-up': '확대' };
  // % 값은 v2 규약대로 0~100으로 읽는다(docs/api.md v2 덧붙임)
  function fmtAUnit(v, unit) {
    if (v == null || v === '' || (typeof v === 'number' && isNaN(v))) return '—';
    if (typeof v === 'string' && isNaN(Number(v))) return esc(v);
    const n = Number(v);
    switch (unit) {
      case 'USD': return fmtUSD(n);
      case 'h': return fmtH(n);
      case '%': return `${n.toFixed(Number.isInteger(n) ? 0 : 1)}%`;
      case 'count': return num(n, 1);
      case 'ms': return fmtMs(n);
      default: return `${num(n, 2)}${unit ? ' ' + esc(unit) : ''}`;
    }
  }
  async function renderAssurance(force) {
    const have = S.v2.assurance && S.v2.assurance.data;
    if (!have) main.innerHTML = loadingPanel('도입 검증');
    const r = await fetchV2('assurance', '/api/assurance', force && !have);
    if (S.tab !== 'assurance') return;
    if (!r.data) { main.innerHTML = v3Missing('/api/assurance', r.error, '도입 검증'); return; }
    const a = r.data;
    const kpis = arr(a.kpis);
    const known = AGROUP.map(([g]) => g);
    const groups = AGROUP.map(([g, ko]) => [g, ko, kpis.filter((k) => k.group === g)])
      .concat(uniq(kpis.map((k) => k.group)).filter((g) => !known.includes(g)).map((g) => [g, g, kpis.filter((k) => k.group === g)]))
      .filter(([, , ks]) => ks.length);
    const cnt = (s) => kpis.filter((k) => k.status === s).length;
    main.innerHTML = `
      <div class="panel v2head" data-anchors="assurance top">
        <div class="panel-head" style="margin:0"><h4>도입 검증 — 무엇을 재고, 어떻게 단계적으로 들이나 (Phase 28 · 30)</h4><span class="hint">${kpis.length ? `KPI ${kpis.length}개 · 충족 ${cnt('OK')} · 주의 ${cnt('WARN')} · 측정 전 ${cnt('NA')}` : ''}</span></div>
        <div class="callout" style="margin-top:10px"><b>절감액 하나로 도입을 결정하지 않는다.</b> 재무·운영·리스크·결정 품질·에이전트 신뢰도를 함께 재고, ${term('Shadow Mode')}(에이전트는 추천만, 결정은 사람) 기간에 같은 결정 시점의 두 판단을 비교해 일치율과 비용 차이로 다음 단계 진입을 정한다. 숫자는 가상 데이터, 목표값은 가정이다.</div>
        ${a.basis_note ? `<p class="small muted" style="margin-top:6px">${tagged(a.basis_note)}</p>` : ''}
      </div>
      <div class="akpi-groups" data-anchors="kpis kpi validation_kpi">${groups.length ? groups.map(([g, ko, ks]) => `<div class="akg"><div class="kg-name">${esc(ko)}${ko !== g ? ` <span class="muted">${esc(g)}</span>` : ''}</div><div class="akpi-grid">${ks.map(akpiTile).join('')}</div></div>`).join('') : '<div class="panel empty">kpis 없음</div>'}</div>
      ${shadowPanel(a.shadow || {})}
      ${pilotPanel(arr(a.pilot))}
      ${governancePanel(arr(a.governance))}`;
    if (S.pendingAnchor) flushAnchor();
  }
  function akpiTile(k) {
    const st = ASTATUS[k.status] ? k.status : 'NA';
    return `<div class="akpi st-${st}" title="${esc(k.note || '')}">
      <div class="ak-top"><span class="label">${esc(k.label || k.key)}</span><span class="ak-st" aria-label="${esc(ASTATUS[st])}">${st === 'OK' ? '✓' : st === 'WARN' ? '!' : '–'}</span></div>
      <div class="value">${fmtAUnit(k.value, k.unit)}</div>
      <div class="small muted">목표 ${tagged(k.target || '—')}</div>
      <div class="ak-foot"><span class="pill basis-${esc(ABASIS[k.basis] ? k.basis : 'NA')}">${esc(ABASIS[k.basis] || k.basis || '—')}</span><span class="small muted">${esc(ASTATUS[st])}</span></div>
      ${k.note ? `<div class="ak-note small muted">${tagged(k.note)}</div>` : ''}
    </div>`;
  }
  function shadowPanel(sh) {
    const dps = arr(sh.decision_points);
    const agreeN = dps.filter((p) => p.agree).length;
    // delta_usd의 부호가 무엇을 뜻하는지 데이터에서 읽는다
    const sample = dps.find((p) => p.delta_usd != null && p.human_usd != null && p.agent_usd != null && Math.abs(p.agent_usd - p.human_usd) > 0.5);
    const meaning = !sample ? '차이' : Math.abs(sample.delta_usd - (sample.agent_usd - sample.human_usd)) < 1 ? '에이전트 − 사람' : Math.abs(sample.delta_usd - (sample.human_usd - sample.agent_usd)) < 1 ? '사람 − 에이전트' : '차이';
    const sgn = meaning === '사람 − 에이전트' ? -1 : 1;
    const rate = sh.agreement_rate != null && !isNaN(sh.agreement_rate) ? Number(sh.agreement_rate) : (dps.length ? agreeN / dps.length : null);
    return `<div class="panel" data-anchors="shadow shadow_mode agreement">
      <div class="panel-head"><h4>${term('Shadow Mode')} — 같은 결정 시점, 사람 vs 에이전트</h4><span class="hint">${dps.length}개 결정 시점 · 비용 = 그 결정을 따랐을 때의 실제 체선료</span></div>
      <div class="kpis shadow">
        <div class="kpi"><span class="label">일치율</span><span class="value">${rate != null ? fmtPct(rate) : '—'}</span><span class="sub">${agreeN} / ${dps.length} 시점에서 같은 결정</span></div>
        <div class="kpi"><span class="label">${meaning === '사람 − 에이전트' ? '에이전트 1순위를 따랐다면 절감' : '비용 차이'} (${esc(meaning)})</span><span class="value ${dCls(sgn * (Number(sh.cost_delta_usd) || 0))}">${fmtDelta(sh.cost_delta_usd)}</span><span class="sub">결정 시점별 차이의 합</span></div>
        <div class="kpi"><span class="label">불일치</span><span class="value">${dps.length - agreeN}건</span><span class="sub">불일치 사유를 기록해 룰·모델을 고친다</span></div>
        <div class="kpi"><span class="label">실제 결정 기록</span><span class="value wrap">감사 로그</span><span class="sub">${linkBtn('audit', 'shadow', '수용률·Override율 →')}</span></div>
      </div>
      ${dps.length ? `<div class="table-scroll"><table class="shadow-tbl"><thead><tr><th>시각 · 들어온 정보</th><th>사람의 결정</th><th>에이전트 제안</th><th>일치</th><th class="num">사람 결정 비용</th><th class="num">에이전트 비용</th><th class="num">${esc(meaning)}</th></tr></thead><tbody>
        ${dps.map((p) => `<tr class="${p.agree ? '' : 'disagree'}"><td><span class="mono">${esc(fmtTs(p.t))}</span> ${p.trigger ? `<span class="pill k">${esc(TRIGGER_LABEL[p.trigger] || p.trigger)}</span>` : ''}${p.label ? `<div class="small muted">${tagged(p.label)}</div>` : ''}${p.item_id ? `<button type="button" class="linkbtn mono" data-open-item="${esc(p.item_id)}" data-at="${esc(p.t || '')}">${esc(p.item_id)} →</button>` : ''}</td>
          <td class="small">${tagged(p.human || '')}</td><td class="small">${tagged(p.agent || '')}${p.candidates != null ? `<div class="muted">후보 ${num(p.candidates)}개${p.gap_usd != null ? ` · 1·2순위 차이 ${fmtUSD(p.gap_usd)}` : ''}</div>` : ''}</td>
          <td>${p.agree ? '<span class="pill ok">✓ 일치</span>' : '<span class="pill bad">✗ 다름</span>'}</td><td class="num">${fmtUSD(p.human_usd)}</td><td class="num">${fmtUSD(p.agent_usd)}</td><td class="num ${dCls(sgn * (Number(p.delta_usd) || 0))}">${fmtDelta(p.delta_usd)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">shadow.decision_points 없음</div>'}
      ${sh.note ? `<p class="small muted" style="margin-top:6px">${tagged(sh.note)}</p>` : ''}
      <div class="chips" style="margin-top:8px">${linkBtn('business', 'params', '채택률 가정(비즈니스 케이스) →')}${linkBtn('validation', 'competition', '정책 경쟁(검증) →')}</div>
    </div>`;
  }
  function pilotPanel(ps) {
    const FIELDS = [['goal', '목표'], ['entry', '진입 조건'], ['exit', '통과 기준'], ['duration', '기간'], ['owner', '담당'], ['risk', '위험']];
    return `<div class="panel" data-anchors="pilot pilot_stages implementation">
      <div class="panel-head"><h4>단계적 도입 — PoC에서 확대까지 (Phase 30)</h4><span class="hint">단계마다 들어가는 조건과 통과 기준을 미리 정해 둔다</span></div>
      ${ps.length ? `<ol class="pilot-rail">${ps.map((p, i) => {
        const st = PSTATUS[p.status] ? p.status : 'LATER';
        return `<li class="pstage ps-${st}">
          <div class="ps-top"><span class="ps-no">${i + 1}</span><b>${esc(p.stage || '')}</b><span class="pill ${st === 'NOW' ? 'ok' : st === 'NEXT' ? 'sev-low' : 'k'}">${PSTATUS[st]}</span></div>
          ${PSTAGE_KO[p.stage] ? `<div class="small muted">${esc(PSTAGE_KO[p.stage])}</div>` : ''}
          <dl class="ps-dl">${FIELDS.map(([k, l]) => (p[k] ? `<dt>${l}</dt><dd>${tagged(p[k])}</dd>` : '')).join('')}</dl></li>`;
      }).join('')}</ol>` : '<div class="empty">pilot 없음</div>'}
    </div>`;
  }
  function governancePanel(gs) {
    return `<div class="panel" data-anchors="governance">
      <div class="panel-head"><h4>거버넌스 — 도입 전에 답해야 할 질문</h4><span class="hint">책임·권한·데이터·감사 · 눌러서 펼치기</span></div>
      ${gs.length ? `<div class="gov-list">${gs.map((g, i) => `<details class="gov" ${i < 2 ? 'open' : ''}><summary><span class="gov-q">${esc(g.question || '')}</span><span class="pill ${g.basis === '문서' ? 'sev-info' : 'sev-medium'}">${esc(g.basis || '가정')}</span></summary><div class="gov-a">${tagged(g.answer || '')}</div></details>`).join('')}</div>` : '<div class="empty">governance 없음</div>'}
    </div>`;
  }

  // ================================================================ 검증 탭 — 해결 대안(P19)·현업 판단 로직(P11)
  const COMPUTED_LABEL = {
    total_usd: '체선료', saving_usd: '절감', saving_pct: '절감률', saving_vs_current_usd: '현업 대비 절감', range_usd: '정책별 범위', violations: '제약 위반',
    waiting_h: '대기', plan_changes: '계획 변경', compute_ms: '계산 시간', policy: '정책', annual_saving_usd: '연간 절감',
  };
  const COMPUTED_SKIP = new Set(['label', 'basis']);
  function fmtComputed(k, v) {
    if (v == null) return '—';
    if (Array.isArray(v) && /_usd$/.test(k) && v.every((x) => typeof x === 'number')) return v.map((x) => fmtUSD(x)).join('~');
    if (typeof v !== 'number') return esc(typeof v === 'object' ? JSON.stringify(v) : v);
    if (/_usd$/.test(k)) return fmtUSD(v);
    if (/_pct$/.test(k)) return fmtPct(v);
    if (/_h$/.test(k)) return fmtH(v);
    if (/_ms$/.test(k)) return fmtMs(v);
    return num(v, 2);
  }
  // 정책 ID를 키로 쓰는 값(예: {CURRENT_RULE: 251749.99})은 정책 이름 + 금액으로 보여 준다
  const computedChips = (c, pl) => {
    const es = Object.entries(c || {}).filter(([k, v]) => v != null && !COMPUTED_SKIP.has(k));
    const name = (k) => (pl && pl(k) !== k ? pl(k) : null);
    return es.length ? `<div class="chips">${es.map(([k, v]) => {
      if (k === 'policy') return `<span class="pill k" title="policy">${esc((c && c.label) || (pl ? pl(v) : v))}</span>`;
      if (name(k) && typeof v === 'number') return `<span class="pill k" title="${esc(k)}">${esc(name(k))} ${fmtUSD(v)}</span>`;
      return `<span class="pill k" title="${esc(k)}">${esc(COMPUTED_LABEL[k] || k)} ${fmtComputed(k, v)}</span>`;
    }).join('')}</div>` : '<span class="muted">—</span>';
  };
  function statusPill(st) {
    if (!st) return '';
    if (DSTATUS[st]) return dchip(st);
    if (MODELED_LABEL[st]) return `<span class="pill mod-${esc(st)}">${esc(MODELED_LABEL[st])}</span>`;
    if (PROTO_LABEL[st]) return `<span class="pill proto-${esc(st)}">${esc(PROTO_LABEL[st])}</span>`;
    return `<span class="pill k">${esc(st)}</span>`;
  }
  function valDiscoveryPanels(dd, pl) {
    if (!dd) return '';
    const sm = dd.solution_matrix, dl = dd.decision_logic;
    const hasSm = !!(sm && arr(sm.options).length), hasDl = !!(dl && (arr(dl.rules).length || arr(dl.flow).length));
    if (!hasSm && !hasDl) return '<div class="panel" data-anchors="solution_matrix decision_logic p19 p11"><div class="panel-head" style="margin:0"><h4>해결 대안 비교(P19) · 현업 판단 로직(P11)</h4><span class="hint">discovery.solution_matrix · decision_logic 준비 중</span></div></div>';
    return `${hasSm ? solutionMatrixPanel(sm, pl) : ''}${hasDl ? decisionLogicPanel(dl, pl) : ''}`;
  }
  // 해결 대안 표의 '계산 근거' 칸 — 검증 결과 중 판단에 쓰는 숫자만 한 줄로
  function smComputed(c) {
    if (!c || !Object.keys(c).length) return '<span class="muted">—</span>';
    const sav = c.saving_vs_current_usd ?? c.saving_usd;
    const bits = [c.total_usd != null ? `<b class="mono">${fmtUSD(c.total_usd)}</b>` : '', sav != null ? `<span class="${sav > 0.5 ? 'neg' : 'muted'}">절감 ${fmtUSD(sav)}</span>` : '',
      c.plan_changes != null ? `변경 ${num(c.plan_changes)}` : '', c.violations ? `<span class="pos">위반 ${num(c.violations)}</span>` : ''].filter(Boolean);
    const extra = Array.isArray(c.range_usd) ? `정책별 ${c.range_usd.map((x) => fmtUSD(x)).join('~')}` : '';
    return `${bits.join(' · ') || computedChips(c)}${extra ? `<div class="muted">${esc(extra)}</div>` : ''}`;
  }
  function solutionMatrixPanel(sm, pl = (x) => x) {
    const crit = arr(sm.criteria);
    const opts = arr(sm.options);
    const scoreOf = (o, c) => Number(((o.scores || {})[c.key] || {}).score);
    const totals = opts.map((o) => (o.total != null && !isNaN(o.total) ? Number(o.total) : crit.reduce((a, c) => a + (scoreOf(o, c) || 0), 0)));
    const top = totals.length ? Math.max(...totals) : null;
    const tops = totals.filter((x) => x === top).length;
    // 권고 문장이 "E — …"처럼 대안 ID로 시작하면 그 행에 권고 표시
    const recText = String(sm.recommendation || '');
    const recM = /(?:Option|옵션|대안)\s*([A-Z])\b/i.exec(recText) || /^\s*(?:\[[^\]]*\]\s*)?([A-Z])\b/.exec(recText);
    const recId = recM && opts.some((o) => o.id === recM[1].toUpperCase()) ? recM[1].toUpperCase() : null;
    return `<div class="panel" data-anchors="solution_matrix solution p19">
      <div class="panel-head"><h4>해결 대안 비교 (Phase 19)</h4><span class="hint">대안 ${opts.length}개 × 기준 ${crit.length}개 · 1(낮음)~5(높음) · 칸에 마우스를 올리면 점수 근거</span></div>
      <div class="table-scroll"><table class="smx"><thead><tr><th>대안</th>${crit.map((c) => `<th class="num" title="${esc([c.key, c.question].filter(Boolean).join(' · '))}">${esc(c.label || c.key)}</th>`).join('')}<th class="num">합계${crit.length ? `<div class="small muted">/ ${crit.length * 5}</div>` : ''}</th><th>계산 근거(검증 결과)</th></tr></thead><tbody>
      ${opts.map((o, i) => `<tr class="${o.id === recId ? 'smx-best' : ''}"><td class="smx-name"><b class="mono">${esc(o.id)}</b> ${esc(o.label || '')}${totals[i] === top ? ` <span class="pill k">최고점${tops > 1 ? '(동점)' : ''}</span>` : ''}${o.id === recId ? ' <span class="pill ok">권고</span>' : ''}${arr(o.policies).length ? `<div class="small muted">정책 ${esc(o.policies.map((x) => pl(x)).join(' · '))}</div>` : ''}</td>
        ${crit.map((c) => {
          const sc = (o.scores || {})[c.key] || {};
          const v = scoreOf(o, c);
          const lv = isNaN(v) ? 0 : Math.max(1, Math.min(5, Math.round(v)));
          return `<td class="smx-c ${lv ? 'sm-' + lv : ''}" tabindex="0" title="${esc(`${o.id} · ${c.label || c.key}: ${isNaN(v) ? '—' : v}점${sc.rationale ? '\n' + sc.rationale : ''}`)}">${isNaN(v) ? '—' : esc(v)}</td>`;
        }).join('')}
        <td class="num"><b>${num(totals[i], 1)}</b></td><td class="small smx-comp">${smComputed(o.computed)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="legend" style="margin-top:6px">${[1, 2, 3, 4, 5].map((n) => `<span><i class="sm-${n}"></i>${n}점</span>`).join('')}<span>합계 = ${opts.some((o) => o.total != null) ? '엔진이 계산한 total' : '점수 합'}</span></div>
      ${sm.recommendation ? `<div class="callout" style="margin-top:10px"><b>권고</b> ${tagged(sm.recommendation)}</div>` : ''}
      ${sm.note ? `<p class="small muted" style="margin-top:6px">${tagged(sm.note)}</p>` : ''}
      ${sm._meta && sm._meta.policy_map ? `<p class="small muted">${tagged(sm._meta.policy_map)}</p>` : ''}
      <details style="margin-top:6px"><summary>점수 근거 전체</summary><div class="table-scroll"><table><thead><tr><th>대안</th><th>기준</th><th class="num">점수</th><th>근거</th></tr></thead><tbody>
      ${opts.flatMap((o) => crit.map((c) => { const sc = (o.scores || {})[c.key] || {}; return `<tr><td class="mono">${esc(o.id)}</td><td>${esc(c.label || c.key)}</td><td class="num">${sc.score != null ? esc(sc.score) : '—'}</td><td class="small">${tagged(sc.rationale || '')}</td></tr>`; })).join('')}
      </tbody></table></div></details>
    </div>`;
  }
  function decisionLogicPanel(dl, pl) {
    const rules = arr(dl.rules);
    const impl = new Set(arr(dl.implemented_in_current_rule));
    const meta = dl._meta || {};
    const ruleChips = (r) => (r ? String(r).split(/\s*[·,]\s*/).filter(Boolean).map((id) => chip(id)).join('') : '');
    const allPol = (xs) => arr(xs).length >= 5;
    return `<div class="panel" data-anchors="decision_logic p11 current_rule">
      <div class="panel-head"><h4>현업 판단 로직 (Phase 11)</h4><span class="hint">'현업 Rule' 정책이 흉내 내는 규칙 ${rules.length}개${impl.size ? ` · 그중 ${impl.size}개는 엔진 CURRENT_RULE에 구현` : ''} · 출처가 '가정'인 규칙은 현업 인터뷰로 확인</span></div>
      ${meta.description ? `<p class="small muted" style="margin-bottom:8px">${tagged(meta.description)}</p>` : ''}
      ${arr(dl.flow).length ? `<div style="margin-bottom:10px"><div class="small muted" style="margin-bottom:4px">판단 순서</div><ol class="dl-flow">${dl.flow.map((f) => `<li>${tagged(String(f).replace(/^[①-⑳]\s*/, ''))}</li>`).join('')}</ol></div>` : ''}
      ${rules.length ? `<div class="table-scroll"><table class="dl-table"><thead><tr><th>ID</th><th>조건</th><th>행동</th><th title="${esc(meta.priority || '')}">우선순위</th><th>출처</th><th>쓰는 정책</th><th>상태</th></tr></thead><tbody>
      ${rules.map((x) => `<tr><td class="mono">${esc(x.id || '')}${impl.has(x.id) ? '<div><span class="pill ok" title="엔진 CURRENT_RULE 정책에 구현">구현</span></div>' : ''}</td>
        <td>${tagged(x.condition || '')}${x.note ? `<div class="small muted">${tagged(x.note)}</div>` : ''}${arr(x.questions).length ? `<div class="small muted mono">${esc(x.questions.join(' · '))}</div>` : ''}</td>
        <td>${tagged(x.action || '')}${x.rule ? `<div class="chips" style="margin-top:3px">${ruleChips(x.rule)}</div>` : ''}${x.computed && Object.keys(x.computed).length ? `<div style="margin-top:3px">${computedChips(x.computed, pl)}</div>` : ''}</td>
        <td class="mono">${esc(x.priority ?? '')}</td><td><span class="pill ${x.source === '문서' ? 'sev-info' : 'sev-medium'}">${esc(x.source || '가정')}</span></td>
        <td>${allPol(x.used_by_policy) ? '<span class="pill k">모든 정책</span>' : arr(x.used_by_policy).map((p) => `<span class="pill k">${esc(pl(p))}</span>`).join(' ') || '<span class="muted">엔진에 없음</span>'}</td><td>${statusPill(x.status)}</td></tr>`).join('')}
      </tbody></table></div>${meta.priority ? `<p class="small muted" style="margin-top:6px">우선순위: ${tagged(meta.priority)}</p>` : ''}` : ''}
      ${arr(dl.tradeoffs).length ? `<div class="decision-note"><b>트레이드오프 — 이 규칙이 잃는 것</b><ul class="narrative">${dl.tradeoffs.map((t) => `<li>${tagged(t)}</li>`).join('')}</ul></div>` : ''}
    </div>`;
  }

  // ================================================================ 로드맵 — 프로세스 맵(P1)·이해관계자
  const PM_LENSES = [['who', '누가'], ['input', '입력'], ['activity', '활동'], ['decision', '결정'], ['output', '산출물'], ['time', '시간'], ['delay', '지연 요인'], ['dependency', '의존'], ['contract', '계약 영향']];
  // 프로세스 맵 상태 — Discovery 상태(OPEN·HYPOTHESIS·VIRTUAL·CONFIRMED)면 그 색, 아니면 반영 정도(YES·PARTIAL·NO)
  function statusTone(st) {
    const s = String(st || '').toUpperCase();
    if (DSTATUS[s]) return `ds-${s}`;
    if (['YES', 'DEMO', 'MODELED', 'DONE', 'FULL', 'IMPLEMENTED'].includes(s)) return 'YES';
    if (['PARTIAL', 'SOME'].includes(s)) return 'PARTIAL';
    return 'NO';
  }
  const TONE_LABEL = { YES: '모델 반영', PARTIAL: '일부 반영', NO: '미반영' };
  function processMapPanel(pm) {
    const rows = arr(pm);
    if (!rows.length) return '';
    const tones = rows.map((r) => statusTone(r.status));
    const present = uniq(tones);
    const toneName = (t) => (t.startsWith('ds-') ? dstatusLabel(t.slice(3)) : TONE_LABEL[t] || t);
    const cell = (v) => (v == null || v === '' ? '<span class="muted">—</span>' : tagged(Array.isArray(v) ? v.join(', ') : v));
    return `<div class="panel" data-anchors="process_map port_call p1">
      <div class="panel-head"><h4>Port Call 프로세스 맵 (Phase 1 · ${rows.length}단계 × ${PM_LENSES.length}관점)</h4><span class="hint">${present.map((t) => `${esc(toneName(t))} ${tones.filter((x) => x === t).length}`).join(' · ')} · 단계를 누르면 표의 그 행으로</span></div>
      <div class="pm-flow">${rows.map((r, i) => `${i ? '<span class="fl-arrow" aria-hidden="true">→</span>' : ''}<button type="button" class="pm-step pm-${tones[i]}" data-pm="${esc(r.id)}" title="${esc([r.activity, r.modeled_in].filter(Boolean).join(' · '))}">${esc(r.stage)}</button>`).join('')}</div>
      <div class="legend" style="margin-bottom:8px">${present.map((t) => `<span><i class="pm-l pm-${t}"></i>${esc(toneName(t))}</span>`).join('')}<span>표의 SOF 이벤트 = 그 단계에서 레이타임 계산에 쓰는 기록</span></div>
      <details class="pm-details"><summary>${rows.length}단계 × ${PM_LENSES.length}관점 표 — 누가·입력·활동·결정·산출물·시간·지연·의존·계약</summary>
      <div class="table-scroll"><table class="pmap"><thead><tr><th>단계</th>${PM_LENSES.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th>모델 반영 위치 · SOF 이벤트</th></tr></thead><tbody>
      ${rows.map((r) => `<tr id="pm-${esc(r.id)}"><td><span class="mono small muted">${esc(r.id)}</span> <b>${esc(r.stage)}</b><div>${statusPill(r.status)}</div></td>${PM_LENSES.map(([k]) => `<td>${cell(r[k])}</td>`).join('')}<td class="small"><span class="mono">${cell(r.modeled_in)}</span>${arr(r.sof_events).length ? `<div class="chips" style="margin-top:3px">${r.sof_events.map((e) => `<span class="pill k" title="${esc(e)}">${esc(EVENT_LABEL[e] || e)}</span>`).join('')}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div></details></div>`;
  }
  const RACI_LABEL = { R: '실행 Responsible', A: '최종 책임 Accountable', C: '협의 Consulted', I: '통보 Informed' };
  function stakeholderPanel(sh) {
    const rows = arr(sh);
    if (!rows.length) return '';
    const tasks = uniq(rows.flatMap((s) => Object.keys(s.raci || {})));
    const badge = (x, t) => `<span class="raci raci-${x}" title="${esc(t ? t + ': ' : '')}${esc(RACI_LABEL[x])}">${x}</span>`;
    return `<div class="panel" data-anchors="stakeholders raci">
      <div class="panel-head"><h4>이해관계자 맵 · RACI</h4><span class="hint">${Object.keys(RACI_LABEL).map((k) => `${badge(k)} ${esc(RACI_LABEL[k].split(' ')[0])}`).join(' · ')} · ★ 에이전트 사용자</span></div>
      <div class="table-scroll"><table class="raci-table"><thead><tr><th>이해관계자</th><th>역할</th>${tasks.map((t) => `<th class="raci-th">${esc(t)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((s) => `<tr><td><b>${esc(s.name || s.id)}</b>${s.agent_user ? ' <span class="pill ok" title="에이전트 화면을 직접 쓰는 사용자">★ 사용자</span>' : ''}<div><span class="pill ${s.org === '외부' ? 'sev-low' : 'k'}">${esc(s.org || '')}</span></div></td><td class="small">${tagged(s.role || '')}</td>${tasks.map((t) => {
        const v = String((s.raci || {})[t] || '').toUpperCase();
        const xs = v.split(/[\s,/+]+/).filter((x) => RACI_LABEL[x]);
        return `<td class="raci-c">${xs.length ? xs.map((x) => badge(x, t)).join('') : esc(v)}</td>`;
      }).join('')}</tr>`).join('')}
      </tbody></table></div>
      <details style="margin-top:8px"><summary>주는 정보 · 내리는 결정 · 근거</summary><div class="table-scroll"><table><thead><tr><th>이해관계자</th><th>주는 정보(입력)</th><th>내리는 결정</th><th>근거</th></tr></thead><tbody>
      ${rows.map((s) => `<tr><td><b>${esc(s.name || s.id)}</b></td><td class="small">${arr(s.inputs).map((x) => tagged(x)).join(' · ') || '—'}</td><td class="small">${arr(s.decisions).map((x) => tagged(x)).join(' · ') || '—'}</td><td class="small">${s.basis ? `<span class="pill ${s.basis === '문서' ? 'sev-info' : 'sev-medium'}">${esc(s.basis)}</span> ` : ''}${tagged(s.source || '')}</td></tr>`).join('')}
      </tbody></table></div></details></div>`;
  }

  // ================================================================ 결정
  async function decide(decision, extra = {}) {
    const it = S.item;
    if (!it) return;
    const body = { item_id: it.id, decision, t: S.t, ...extra };
    if (decision === 'REJECT') {
      const note = window.prompt('반려 사유 (선택)', '');
      if (note === null) return;
      body.note = note;
    }
    const ta = $('#detail textarea[data-draft-edit]');
    if (ta && (decision === 'SEND' || decision === 'APPROVE')) body.body = ta.value;
    try {
      const r = await POST('/api/decide', body);
      showOk((r && r.message) || '기록했습니다');
      await afterDecision();
    } catch (e) { showError(e.message); }
  }
  async function approveOption(optId, title) {
    const it = S.item;
    if (!it) return;
    if (!window.confirm(`'${title}'\n\n${fmtTs(S.t)}부터 새 계획 버전으로 적용합니다.\n(데모에서는 담당자가 SEAGATE에 반영한 것으로 간주) 계속할까요?`)) return;
    try {
      const r = await POST('/api/decide', { item_id: it.id, decision: 'APPROVE_OPTION', option_id: optId, t: S.t });
      showOk((r && r.message) || `계획 v${r && r.plan_version} 반영`);
      await afterDecision();
    } catch (e) { showError(e.message); }
  }
  async function afterDecision() {
    try { S.meta = await GET('/api/meta'); setupTicks(); } catch (_) { /* meta 갱신 실패는 무시 */ }
    S.item = null;
    S.rendered = null;
    // 결정·계획 이력에 따라 달라지는 v3 화면은 다시 받는다
    S.v2.resources = null; S.v2.cases = null; S.v2.casestudy = null; S.v2.assurance = null;
    await loadState();
  }

  // ================================================================ 테마
  function loadTheme() { try { return localStorage.getItem('dd-theme') || ''; } catch (_) { return ''; } }
  function applyTheme(v) {
    if (v) document.documentElement.setAttribute('data-theme', v); else document.documentElement.removeAttribute('data-theme');
    $('#btnTheme').textContent = v === 'dark' ? '테마: 어둡게' : v === 'light' ? '테마: 밝게' : '테마: 자동';
  }
  function cycleTheme() {
    const cur = loadTheme();
    const next = cur === '' ? 'dark' : cur === 'dark' ? 'light' : '';
    try { if (next) localStorage.setItem('dd-theme', next); else localStorage.removeItem('dd-theme'); } catch (_) { /* 저장 불가 환경 */ }
    applyTheme(next);
  }

  // ================================================================ 이벤트 바인딩
  function bind() {
    $('#btnPrev').addEventListener('click', () => { pause(); stepEvent(-1); });
    $('#btnNext').addEventListener('click', () => { pause(); stepEvent(1); });
    $('#btnPlay').addEventListener('click', play);
    $('#btnTheme').addEventListener('click', cycleTheme);
    const tourBtn = $('#btnTour');
    if (tourBtn) tourBtn.addEventListener('click', startTour);
    $('#btnReset').addEventListener('click', async () => {
      if (!window.confirm('모든 결정과 계획 버전을 처음 상태로 되돌립니다. 계속할까요?')) return;
      pause();
      try { const r = await POST('/api/reset', {}); showOk((r && r.message) || '초기화했습니다'); await afterDecision(); } catch (e) { showError(e.message); }
    });
    const sl = $('#slider');
    sl.addEventListener('input', () => { pause(); goto(S.t0 + Number(sl.value) * STEP_MS, { immediate: false }); });
    sl.addEventListener('change', () => { goto(S.t0 + Number(sl.value) * STEP_MS); });
    $('#nav').addEventListener('click', (e) => {
      const b = e.target.closest('.navbtn');
      if (!b) return;
      const changed = S.tab !== b.dataset.tab;
      S.tab = b.dataset.tab;
      closeDrawer();
      renderTab(true);
      if (changed) window.scrollTo({ top: 0 });
    });
    document.addEventListener('click', (e) => {
      const rc = e.target.closest('.rule-chip[data-rule]');
      if (rc) { e.preventDefault(); e.stopPropagation(); openRulePopover(rc); return; }
      if (!e.target.closest('#popover')) closePopover();
      if (e.target.closest('[data-close-banner]')) { $('#banner').innerHTML = ''; return; }
      if (e.target.closest('[data-close-drawer]')) { closeDrawer(); return; }
      const os = e.target.closest('[data-open-stmt]');
      if (os) { S.stmtCall = os.dataset.openStmt; S.tab = 'statement'; closeDrawer(); renderTab(true); return; }
      const fi = e.target.closest('[data-filter]');
      if (fi) { S.filter = fi.dataset.filter; renderInbox(); updateHash(); return; }
      const ir = e.target.closest('[data-item]');
      if (ir) {
        S.itemId = ir.dataset.item;
        $$('.inbox-row').forEach((r) => r.classList.toggle('active', r.dataset.item === S.itemId));
        updateHash();
        loadItem();
        return;
      }
      const ec = e.target.closest('[data-ec]');
      if (ec && !ec.disabled) { openEvidenceChain(ec.dataset.ec); return; }
      const gt = e.target.closest('[data-goto]');
      if (gt) { gotoTab(gt.dataset.goto, gt.dataset.anchor); return; }
      // 타임라인 조위 띠는 기준(BASE) 세계의 조위 — 자원·제약 탭을 BASE로 연다
      if (e.target.closest('[data-tide-link]')) { S.resScenario = 'BASE'; gotoTab('resources', 'tide'); return; }
      const cov = e.target.closest('.cov-cell[data-domain]');
      if (cov) {
        S.qf.domain = S.qf.domain === cov.dataset.domain ? '' : cov.dataset.domain;
        const sel = $('#qfDomain');
        if (sel) sel.value = S.qf.domain;
        drawQuestionSheet();
        const sheet = $('#qTable');
        if (sheet && S.qf.domain) sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const qph = e.target.closest('[data-qphase]');
      if (qph) {
        S.qf.phase = qph.dataset.qphase;
        const sel = $('#qfPhase');
        if (sel) sel.value = S.qf.phase;
        drawQuestionSheet();
        const sheet = $('#qTable');
        if (sheet) sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const qr = e.target.closest('tr.qrow[data-q]');
      if (qr) { const id = qr.dataset.q; if (S.qOpen.has(id)) S.qOpen.delete(id); else S.qOpen.add(id); drawQuestionSheet(); return; }
      if (e.target.closest('#qExport')) { exportQuestionsCsv(); return; }
      const dcs = e.target.closest('[data-diag-case]');
      if (dcs) { if (S.diagCase !== dcs.dataset.diagCase) { S.diagCase = dcs.dataset.diagCase; renderDiagnosis(false); } return; }
      const pd = e.target.closest('[data-pareto-dim]');
      if (pd) { S.paretoDim = pd.dataset.paretoDim; $$('[data-pareto-dim]').forEach((b) => b.classList.toggle('active', b === pd)); if (S.v2.diagShown) drawPareto(S.v2.diagShown); return; }
      const pm = e.target.closest('[data-pareto-metric]');
      if (pm) { S.paretoMetric = pm.dataset.paretoMetric; $$('[data-pareto-metric]').forEach((b) => b.classList.toggle('active', b === pm)); if (S.v2.diagShown) drawPareto(S.v2.diagShown); return; }
      const oi = e.target.closest('[data-open-item]');
      if (oi) { openItemAt(oi.dataset.openItem, oi.dataset.at); return; }
      const cpk = e.target.closest('[data-case]');
      if (cpk) {
        if (S.caseId !== cpk.dataset.case) {
          S.caseId = cpk.dataset.case;
          S.caseSnap = null;
          $$('.case-pick').forEach((b) => { const on = b.dataset.case === S.caseId; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
          updateHash();
          loadCase();
        }
        return;
      }
      const sn = e.target.closest('[data-snap]');
      if (sn) { selectSnap(sn.dataset.snap); return; }
      const rsc = e.target.closest('[data-res-scenario]');
      if (rsc) { S.resScenario = (rsc.dataset.resScenario || 'BASE').toUpperCase(); if (S.tab === 'resources') renderResources(); else gotoTab('resources'); return; }
      const rpo = e.target.closest('[data-res-policy]');
      if (rpo) { if (!rpo.disabled && S.resPolicy !== rpo.dataset.resPolicy) { S.resPolicy = rpo.dataset.resPolicy; renderResources(); } return; }
      const bmv = e.target.closest('[data-bm-view]');
      if (bmv) { if (S.bmView !== bmv.dataset.bmView) { S.bmView = bmv.dataset.bmView; renderBenchmark(false); } return; }
      const bmj = e.target.closest('[data-bm-jump]');
      if (bmj) {
        const id = bmj.dataset.bmJump;
        const go = () => { const el = document.getElementById('bm-' + id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); } };
        if (S.bmView !== 'cards') { S.bmView = 'cards'; renderBenchmark(false).then(go); } else go();
        return;
      }
      const pmb = e.target.closest('[data-pm]');
      if (pmb) {
        const row = document.getElementById('pm-' + pmb.dataset.pm);
        const det = row && row.closest('details');
        if (det && !det.open) det.open = true;
        if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('pm-hl'); setTimeout(() => row.classList.remove('pm-hl'), 1800); }
        return;
      }
      const pol = e.target.closest('[data-policy]');
      if (pol && S.tab === 'validation') { selectPolicy(pol.dataset.policy); return; }
      if (e.target.closest('#bizReset')) { S.bizParams = {}; S.v2.business = null; renderBusiness(true); return; }
      const bzp = e.target.closest('[data-biz-preset]');
      if (bzp) { applyBizPreset(bzp.dataset.bizPreset); return; }
      const dc = e.target.closest('[data-decide]');
      if (dc) { decide(dc.dataset.decide); return; }
      const op = e.target.closest('[data-option]');
      if (op && !op.disabled) { approveOption(op.dataset.option, op.dataset.optionTitle || op.dataset.option); return; }
      const row = e.target.closest('svg .row[data-call]');
      if (row) { openDrawer(row.dataset.call); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePopover(); closeDrawer(); }
      if (e.key === 'Enter') {
        const row = e.target.closest && e.target.closest('svg .row[data-call]');
        if (row) openDrawer(row.dataset.call);
        const qr = e.target.closest && e.target.closest('tr.qrow[data-q]');
        if (qr) qr.click();
        const pr = e.target.closest && e.target.closest('tr.prow[data-policy]');
        if (pr) selectPolicy(pr.dataset.policy);
        const ph = e.target.closest && e.target.closest('.ph[data-qphase]');
        if (ph) ph.click();
        // SVG 안의 링크 역할 그룹(타임라인 조위 띠 등) — 버튼이 아니라 Enter로 직접 연다
        const lg = e.target.closest && e.target.closest('g[role="link"][data-goto]');
        if (lg) gotoTab(lg.dataset.goto, lg.dataset.anchor);
        if (e.target.closest && e.target.closest('[data-tide-link]')) { S.resScenario = 'BASE'; gotoTab('resources', 'tide'); }
      }
    });
    main.addEventListener('change', (e) => {
      if (['qfPhase', 'qfDomain', 'qfStatus', 'qfMentor'].includes(e.target.id)) {
        S.qf.phase = $('#qfPhase').value; S.qf.domain = $('#qfDomain').value; S.qf.status = $('#qfStatus').value; S.qf.mentor = $('#qfMentor').checked;
        drawQuestionSheet();
      }
      if (e.target.dataset && (e.target.dataset.biz || e.target.dataset.bizNum)) syncBiz(e.target);
      if (e.target.id === 'stmtSel') { S.stmtCall = e.target.value; updateHash(); loadStatement(); }
      if (e.target.id === 'resScenario') { S.resScenario = e.target.value || 'BASE'; renderResources(); }
      if (e.target.id === 'resPolicyMore' && e.target.value) { S.resPolicy = e.target.value; renderResources(); }
      if (e.target.id === 'inPreset') { fillPreset(e.target.value); showIntakeResult(); if (!e.target.value) $('#inExpected').textContent = ''; }
      if (['rfGroup', 'rfStatus'].includes(e.target.id)) { S.ruleFilter.group = $('#rfGroup').value; S.ruleFilter.status = $('#rfStatus').value; drawRulesTable(); }
      if (S.tab === 'intake' && e.target.closest('.form, #inText') && $('#inJson')) $('#inJson').textContent = JSON.stringify(intakeRequest(), null, 2);
    });
    main.addEventListener('input', (e) => {
      if (e.target.id === 'rfQ') { S.ruleFilter.q = e.target.value; drawRulesTable(); }
      if (e.target.id === 'qfQ') { S.qf.q = e.target.value; drawQuestionSheet(); }
      if (e.target.dataset && (e.target.dataset.biz || e.target.dataset.bizNum)) syncBiz(e.target);
    });
    main.addEventListener('click', (e) => {
      if (e.target.id === 'inParse') intakeRun(false);
      if (e.target.id === 'inCalc') intakeRun(true);
    });
    window.addEventListener('hashchange', () => {
      const before = S.t;
      const tabBefore = S.tab;
      readHash();
      if (S.tab !== tabBefore) { closeDrawer(); window.scrollTo({ top: 0 }); } // 링크로 화면을 옮기면 이전 화면의 스크롤 위치를 버린다
      if (S.t !== before) { syncClock(); loadState(); } else renderTab(true);
    });
  }

  init();
})();
