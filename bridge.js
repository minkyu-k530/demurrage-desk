/* 정적 모드 브리지 — 서버 없이 브라우저(Pyodide)에서 같은 Python 엔진을 돌린다.
 *
 * window.DeskBridge = { ready, request(method, path, body), status, clearState() }
 *  - path·응답·오류는 server.py와 같다 (docs/api.md). 오류는 Error(message)로 던진다.
 *  - 엔진은 Web Worker 안에서 돌려 화면이 멈추지 않게 하고, 워커를 못 만들면 메인 스레드에서 돌린다.
 *  - 결정 상태(runtime/state.json)는 localStorage에 둔다. 엔진·데이터가 바뀐 빌드에서는 버린다.
 *  - 모든 사이트 경로는 상대 경로라 /demurrage-desk/ 같은 하위 경로에 올려도 동작한다.
 */
(function () {
  'use strict';

  var PYODIDE_VERSION = '0.27.7';
  var PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/';
  var STORAGE_KEY = 'demurrage-desk-state-v1';
  var APP_ROOT = '/home/pyodide/app';
  var STATE_PATH = APP_ROOT + '/runtime/state.json';
  var PERSIST = /^\/api\/(decide|reset)(\?|$)/;

  // server.py의 라우팅·JSON 규칙을 그대로 옮긴 디스패처. tests/test_build.py가 CPython에서 같은 코드를 실행해 확인한다.
  var DISPATCH_PY = String.raw`
# --- DESK DISPATCH START ---
import json
import sys
import traceback
from datetime import datetime
from urllib.parse import parse_qs, urlsplit

DESK_APP_ROOT = globals().get("DESK_APP_ROOT", "/home/pyodide/app")
if DESK_APP_ROOT not in sys.path:
    sys.path.insert(0, DESK_APP_ROOT)

from engine.service import Desk, DeskError  # noqa: E402

DESK_STATE_PATH = DESK_APP_ROOT + "/runtime/state.json"
_DESK = Desk(DESK_STATE_PATH)


def _default(o):
    if isinstance(o, datetime):
        return o.strftime("%Y-%m-%dT%H:%M")
    if isinstance(o, (set, frozenset)):
        return sorted(o)
    raise TypeError(f"not serializable: {type(o)}")


def _m(name):
    fn = getattr(_DESK, name, None)
    if fn is None:
        raise DeskError(f"이 엔진 버전에 없는 API: {name}")
    return fn


def _out(status, **kw):
    return json.dumps(dict(ok=status == 200, status=status, **kw), ensure_ascii=False, default=_default)


def desk_dispatch(method, path, body_json):
    url = urlsplit(path)
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    p = url.path
    try:
        if method == "GET":
            routes = {
                "/api/meta": lambda: _m("meta")(),
                "/api/state": lambda: _m("state")(q.get("t")),
                "/api/item": lambda: _m("item")(q["id"], q.get("t")),
                "/api/statement": lambda: _m("statement")(q["call_id"], q.get("t")),
                "/api/claims": lambda: _m("claims")(),
                "/api/claim": lambda: _m("claim")(q["id"]),
                "/api/golden": lambda: _m("golden")(),
                "/api/rules": lambda: _m("rules")(),
                "/api/audit": lambda: _m("audit")(),
                "/api/discovery": lambda: _m("discovery")(),
                "/api/diagnosis": lambda: _m("diagnosis")(q.get("case", "base")),
                "/api/validation": lambda: _m("validation")(),
                "/api/business_case": lambda: _m("business_case")(q),
                "/api/resources": lambda: _m("resources")(q.get("t"), q.get("scenario"), q.get("policy")),
                "/api/casestudies": lambda: _m("casestudies")(),
                "/api/casestudy": lambda: _m("casestudy")(q.get("call_id")),
                "/api/assurance": lambda: _m("assurance")(),
            }
        elif method == "POST":
            b = json.loads(body_json) if body_json else {}
            routes = {
                "/api/decide": lambda: _m("decide")(b["item_id"], b["decision"], b.get("t"), b.get("option_id"), b.get("note"),
                                                    b.get("body"), b.get("actor") or "터미널 담당자(데모)"),
                "/api/reset": lambda: _m("reset")(),
                "/api/intake/parse": lambda: _m("intake_parse")(b.get("text", ""), b.get("base_date")),
                "/api/intake/calc": lambda: _m("intake_calc")(b.get("text", ""), b.get("base_date"), b.get("terms") or {},
                                                              b.get("context") or {}),
            }
        else:
            return _out(405, error="method not allowed")
        if p not in routes:
            return _out(404, error=f"unknown endpoint: {method} {p}")
        return _out(200, data=routes[p]())
    except KeyError as e:
        return _out(400, error=f"missing parameter: {e}")
    except (DeskError, ValueError) as e:
        return _out(400, error=str(e))
    except Exception as e:  # noqa: BLE001 — server.py와 같이 오류를 화면에 보여 준다
        traceback.print_exc()
        return _out(500, error=f"{type(e).__name__}: {e}")


def desk_state_text():
    try:
        with open(DESK_STATE_PATH, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""
# --- DESK DISPATCH END ---
`;

  // 워커와 메인 스레드가 같이 쓰는 엔진 호스트. 문자열로 바꿔 Blob 워커에 넣으므로 바깥 변수를 참조하지 않는다.
  function hostFactory(env) {
    var py = null, dispatch = null, stateText = null;

    async function init(o) {
      var started = Date.now();
      env.progress('Python 런타임(Pyodide ' + o.pyodideVersion + ') 내려받는 중… 처음 한 번은 수십 초 걸릴 수 있다', 0.05);
      await env.loadScript(o.pyodideBase + 'pyodide.js');
      py = await env.scope.loadPyodide({ indexURL: o.pyodideBase });
      env.progress('엔진·데이터 파일 불러오는 중…', 0.6);
      var mres = await fetch(new URL('py/manifest.json?b=' + Date.now(), o.siteBase));
      if (!mres.ok) throw new Error('py/manifest.json을 불러오지 못함 (' + mres.status + ')');
      var manifest = await mres.json();
      var files = manifest.files || [];
      var v = encodeURIComponent(manifest.version || '');
      var texts = new Array(files.length), cursor = 0, done = 0;
      async function pull() {
        while (cursor < files.length) {
          var i = cursor++;
          var res = await fetch(new URL('py/' + files[i] + (v ? '?v=' + v : ''), o.siteBase));
          if (!res.ok) throw new Error('파일을 불러오지 못함: ' + files[i] + ' (' + res.status + ')');
          texts[i] = await res.text();
          done++;
          if (done % 5 === 0 || done === files.length) env.progress('엔진·데이터 파일 ' + done + '/' + files.length, 0.6 + 0.25 * done / files.length);
        }
      }
      var lanes = [];
      for (var k = 0; k < Math.min(8, files.length); k++) lanes.push(pull());
      await Promise.all(lanes);
      for (var j = 0; j < files.length; j++) {
        var full = o.appRoot + '/' + files[j];
        py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
        py.FS.writeFile(full, texts[j]);
      }
      py.FS.mkdirTree(o.appRoot + '/runtime');
      if (o.savedState && o.savedVersion === manifest.version) py.FS.writeFile(o.statePath, o.savedState);
      env.progress('엔진 초기화 중…', 0.9);
      py.globals.set('DESK_APP_ROOT', o.appRoot);
      py.runPython(o.dispatchPy);
      dispatch = py.globals.get('desk_dispatch');
      stateText = py.globals.get('desk_state_text');
      return { version: manifest.version, files: files.length, loadMs: Date.now() - started,
               restored: !!(o.savedState && o.savedVersion === manifest.version) };
    }

    function call(method, path, body, persist) {
      var out = JSON.parse(dispatch(method, path, body == null ? '' : JSON.stringify(body)));
      if (persist) out.state = stateText();
      return out;
    }

    return { init: init, call: call };
  }

  var WORKER_SRC = [
    'var host = (' + hostFactory.toString() + ')({',
    '  scope: self,',
    '  loadScript: function (url) { importScripts(url); return Promise.resolve(); },',
    '  progress: function (status, progress) { self.postMessage({ type: "progress", status: status, progress: progress }); }',
    '});',
    'self.onmessage = async function (e) {',
    '  var m = e.data;',
    '  if (m.type === "init") {',
    '    try { self.postMessage({ type: "ready", info: await host.init(m.opts) }); }',
    '    catch (err) { self.postMessage({ type: "fatal", error: String((err && err.message) || err) }); }',
    '    return;',
    '  }',
    '  var res;',
    '  try { res = host.call(m.method, m.path, m.body, m.persist); }',
    '  catch (err) { res = { ok: false, status: 500, error: String((err && err.message) || err) }; }',
    '  self.postMessage({ type: "response", id: m.id, res: res });',
    '};',
  ].join('\n');

  var bridge = { status: '대기 중', progress: 0, mode: null, info: null, pyodideVersion: PYODIDE_VERSION };
  window.DeskBridge = bridge;

  function setStatus(text, progress) {
    bridge.status = text;
    if (typeof progress === 'number') bridge.progress = progress;
    window.dispatchEvent(new CustomEvent('desk-bridge-progress', { detail: { status: text, progress: bridge.progress } }));
  }

  function readSaved() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return { state: obj.state || null, version: obj.version || null };
    } catch (_) { return {}; }
  }

  function save(stateTextValue) {
    if (!stateTextValue || !bridge.info) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: bridge.info.version, state: stateTextValue, saved_at: new Date().toISOString() })); }
    catch (_) { /* 비공개 창 등에서는 저장 없이 계속 */ }
  }

  bridge.clearState = function () {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (_) { /* 무시 */ }
  };

  var saved = readSaved();
  var opts = {
    pyodideBase: PYODIDE_BASE, pyodideVersion: PYODIDE_VERSION, siteBase: document.baseURI,
    appRoot: APP_ROOT, statePath: STATE_PATH, dispatchPy: DISPATCH_PY,
    savedState: saved.state || null, savedVersion: saved.version || null,
  };

  var pending = new Map(), nextId = 1, worker = null, localHost = null, chain = Promise.resolve();

  function finish(id, res) {
    var p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (p.persist && res.state) save(res.state);
    if (res.ok) p.resolve(res.data);
    else { var err = new Error(res.error || ('오류 ' + res.status)); err.status = res.status; p.reject(err); }
  }

  function startMainThread() {
    bridge.mode = 'main-thread';
    localHost = hostFactory({
      scope: window,
      loadScript: function (url) {
        if (typeof window.loadPyodide === 'function') return Promise.resolve();
        return new Promise(function (resolve, reject) {
          var s = document.createElement('script');
          s.src = url;
          s.onload = function () { resolve(); };
          s.onerror = function () { reject(new Error('Pyodide를 불러오지 못함: ' + url)); };
          document.head.appendChild(s);
        });
      },
      progress: setStatus,
    });
    return localHost.init(opts);
  }

  function startWorker() {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      worker = new Worker(url);
      bridge.mode = 'worker';
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.type === 'progress') setStatus(m.status, m.progress);
        else if (m.type === 'ready') resolve(m.info);
        else if (m.type === 'fatal') reject(new Error(m.error));
        else if (m.type === 'response') finish(m.id, m.res);
      };
      worker.onerror = function (e) { reject(new Error(e.message || '워커 오류')); };
      worker.postMessage({ type: 'init', opts: opts });
    });
  }

  bridge.ready = (function () {
    var boot;
    try { boot = startWorker(); } catch (_) { worker = null; boot = startMainThread(); }
    return boot.catch(function (err) {
      if (!worker) throw err;
      try { worker.terminate(); } catch (_) { /* 무시 */ }
      worker = null;
      setStatus('워커에서 시작하지 못해 메인 스레드로 다시 시도… (' + err.message + ')', 0.05);
      return startMainThread();
    }).then(function (info) {
      bridge.info = info;
      setStatus('준비 완료', 1);
      return info;
    }, function (err) {
      setStatus('엔진을 시작하지 못함: ' + err.message, 0);
      throw err;
    });
  })();

  bridge.request = function (method, path, body) {
    method = String(method || 'GET').toUpperCase();
    var persist = method === 'POST' && PERSIST.test(path);
    return bridge.ready.then(function () {
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        pending.set(id, { resolve: resolve, reject: reject, persist: persist });
        if (worker) {
          worker.postMessage({ type: 'request', id: id, method: method, path: path, body: body == null ? null : body, persist: persist });
        } else {
          // 메인 스레드 모드: 한 번에 하나씩, 화면이 그려질 틈을 주고 실행
          chain = chain.then(function () {
            return new Promise(function (r) { setTimeout(r, 0); });
          }).then(function () {
            var res;
            try { res = localHost.call(method, path, body == null ? null : body, persist); }
            catch (err) { res = { ok: false, status: 500, error: String((err && err.message) || err) }; }
            finish(id, res);
          });
        }
      });
    });
  };
})();
