// Improvements on trial: each one can be switched back to how the game was before (the pause screen has a "新 / 旧"
// switch for each), so the two can be played side by side. The choice is kept in this browser. Once an improvement
// is kept or dropped for good, its entry here and the old (or new) code path go.
// DG.TRIAL.on(key) -> true when the new version is in use.
(function () {
  const LIST = [
    { key: 'safeWarn', host: 1, name: '安全地帯の予告', desc: '新：脱出の段階に入ると「あと10秒で消える」と知らせ、ランタンが点滅してから消える（消えた時に守られなくなる）／ 旧：すぐに守られなくなり、6.5秒後に知らせる（協力・ホストの設定で決まる）' },
    { key: 'catchContact', host: 1, name: '捕まる瞬間', desc: '新：飛びかかられても口が届くまでは逃げられ、届いた瞬間に捕まるかが決まる。外れると口が空を噛み、捕食者がよろめく ／ 旧：飛びかかりが始まった時点で捕まる（協力・ホストの設定で決まる）' },
    { key: 'stealthMeter', name: '見つかりやすさの表示', desc: '新：照準の下に、足音の大きさ（足跡）と目立ち具合（目）を5段階で出す ／ 旧：表示なし' },
    { key: 'mateMotion', name: '仲間の運ぶ・作業する姿', desc: '新：仲間が運んでいる物（燃料缶・卵・ドローン・負傷者）が手に見え、運ぶ姿勢や作業中の手の動きになる ／ 旧：歩く・走る動きのまま' },
    { key: 'phoneHud', name: 'スマホの画面整理', desc: '新：状態表示をミッション欄の下に移し、アイテム欄は持っている物だけ並べる ／ 旧：今までの配置' }
  ];
  const KEY = 'dg_trial';
  let st = {}, hostSt = null;
  try { st = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { st = {}; }
  const mine = k => st[k] !== false; // new by default
  const T = DG.TRIAL = {
    list: LIST,
    // in a co-op game the host's choice counts for the trials the host runs (host: 1), on every machine
    on: k => hostSt && k in hostSt ? !!hostSt[k] : mine(k),
    hostSet: () => LIST.filter(o => o.host).reduce((o, e) => (o[e.key] = mine(e.key) ? 1 : 0, o), {}),
    follow(o) { hostSt = o && typeof o === 'object' ? LIST.filter(e => e.host).reduce((r, e) => (r[e.key] = o[e.key] !== 0 && o[e.key] !== false, r), {}) : null; },
    set(k, v) {
      st[k] = !!v; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { }
      T.apply();
    },
    // body classes, for the improvements that are only CSS (trial-<key>)
    apply() { LIST.forEach(o => document.body.classList.toggle('trial-' + o.key, mine(o.key))); render(); }
  };
  // the switches on the pause screen
  function render() {
    const box = document.getElementById('trialBox'); if (!box) return;
    box.innerHTML = '<div class="tt">試験中の改善（新・旧を切り替えて比べられます）</div>' + LIST.map(o =>
      `<div class="tr" title="${o.desc}"><span class="nm">${o.name}</span><span class="toggle"><button data-k="${o.key}" data-v="1" class="${mine(o.key) ? 'on' : ''}">新</button><button data-k="${o.key}" data-v="0" class="${mine(o.key) ? '' : 'on'}">旧</button></span></div>`).join('');
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#trialBox button'); if (!b) return;
    e.stopPropagation(); T.set(b.dataset.k, b.dataset.v === '1');
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => T.apply()); else T.apply();
})();
