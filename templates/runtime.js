/* 场景运行时：由 03-scenes 注入 window.__SCENE__ = { duration, items:[{at}] } */
(function () {
  var D = window.__SCENE__ || {};
  var stage = document.querySelector('.stage');
  var targets = [].slice.call(document.querySelectorAll('[data-at]'));
  var t0 = null;
  var duration = D.duration || 5;

  function tick(ts) {
    if (t0 === null) t0 = ts;
    var t = (ts - t0) / 1000;
    for (var i = 0; i < targets.length; i++) {
      var el = targets[i];
      if (!el._on && t >= parseFloat(el.dataset.at || 0)) {
        el._on = true;
        el.classList.add(el.dataset.cls || 'show');
      }
    }
    if (!stage._off && t >= duration - 0.15) {
      stage._off = true;
      stage.classList.add('off');
    }
    if (t < duration + 0.5) requestAnimationFrame(tick);
  }

  window.__start = function () {
    stage.classList.add('on');
    requestAnimationFrame(tick);
  };

  // 渲染保活：Chrome 会把「画面静止」页面的 rAF 压到 ~1.5s 一次，data-at 揭示就会迟拍
  // （开头淡入也会冻结在中间态）。1px 微动画让合成器持续出帧，时钟/揭示按真实节奏走。
  // opacity .02 的白色 1px 在任何主题角上都不可见。
  try {
    var cs = document.createElement('style');
    cs.textContent = '@keyframes __canary{from{transform:translateY(0)}to{transform:translateY(2px)}}'
      + '.__canary{position:fixed;left:0;bottom:0;width:1px;height:1px;z-index:99;'
      + 'background:#fff;opacity:.02;animation:__canary .15s linear infinite alternate}';
    document.head.appendChild(cs);
    var canary = document.createElement('div');
    canary.className = '__canary';
    document.body.appendChild(canary);
  } catch (e) { /* 保活动画失败不致命 */ }

  window.__SCENE_READY = true;
})();
