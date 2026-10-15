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
  window.__SCENE_READY = true;
})();
