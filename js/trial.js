// Improvements on trial: each one can be switched back to how the game was before (the pause screen has a "新 / 旧"
// switch for each), so the two can be played side by side. The choice is kept in this browser. Once an improvement
// is kept or dropped for good, its entry here and the old (or new) code path go.
// DG.TRIAL.on(key) -> true when the new version is in use.
(function () {
  const LIST = [
    { key: 'safeWarn', name: '安全地帯の予告', desc: '新：脱出の段階に入ると「あと10秒で消える」と知らせ、ランタンが点滅してから消える（消えた時に守られなくなる）／ 旧：すぐに守られなくなり、6.5秒後に知らせる（協力・ホストの設定で決まる）' },
  ];
  const KEY = 'dg_trial';
  let st = {};
  try { st = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { st = {}; }
  const T = DG.TRIAL = {
    list: LIST,
    on: k => st[k] !== false, // new by default
    set(k, v) {
      st[k] = !!v; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { }
      T.apply();
    },
    // body classes, for the improvements that are only CSS (trial-<key>)
    apply() { LIST.forEach(o => document.body.classList.toggle('trial-' + o.key, T.on(o.key))); render(); }
  };
  // the switches on the pause screen
  function render() {
    const box = document.getElementById('trialBox'); if (!box) return;
    box.innerHTML = '<div class="tt">試験中の改善（新・旧を切り替えて比べられます）</div>' + LIST.map(o =>
      `<div class="tr" title="${o.desc}"><span class="nm">${o.name}</span><span class="toggle"><button data-k="${o.key}" data-v="1" class="${T.on(o.key) ? 'on' : ''}">新</button><button data-k="${o.key}" data-v="0" class="${T.on(o.key) ? '' : 'on'}">旧</button></span></div>`).join('');
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#trialBox button'); if (!b) return;
    e.stopPropagation(); T.set(b.dataset.k, b.dataset.v === '1');
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => T.apply()); else T.apply();
})();
