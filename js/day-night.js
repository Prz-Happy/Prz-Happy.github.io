/**
 * 按真实日照自动切换配色：太阳在地平线以上 → 白天模式（蓝天太阳），
 * 日落后 → 夜间模式（星空月亮）。
 *
 * - 观测点：南京（32.06N, 118.78E），换城市改下面两个数即可
 * - 访客手动切换过的选择（localStorage）始终优先；未手动选择时才按日照自动
 * - 页面停留期间跨过日出/日落时刻，会在一分钟内自动切换（仅对未手动选择的访客）
 * - 本文件由 scripts/color-scheme-inline.js 在构建时内联进 <head>（先于主题
 *   color-schema.js 执行），保证跳转/首屏不闪白；不要再通过 custom_js 引入
 */
(function () {
  var LAT = 32.06;
  var LNG = 118.78;
  var LS_KEY = 'Fluid_Color_Scheme';

  /* ---------- 太阳位置计算（基于简化天文算法，误差 < 1 分钟） ---------- */
  var dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
  var rad = Math.PI / 180, obliquity = rad * 23.4397;

  function toDays(date) { return date.valueOf() / dayMs - 0.5 + J1970 - J2000; }
  function fromJulian(j) { return new Date((j + 0.5 - J1970) * dayMs); }
  function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
  function eclipticLongitude(M) {
    var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + C + rad * 102.9372 + Math.PI;
  }
  function declination(l) { return Math.asin(Math.sin(obliquity) * Math.sin(l)); }
  function julianCycle(d, lw) { return Math.round(d - 0.0009 - lw / (2 * Math.PI)); }
  function approxTransit(Ht, lw, n) { return 0.0009 + (Ht + lw) / (2 * Math.PI) + n; }
  function solarTransitJ(ds, M, Ls) { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * Ls); }
  function hourAngle(h, phi, d) {
    return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
  }
  function getSetJ(h, lw, phi, dec, n, M, Ls) {
    return solarTransitJ(approxTransit(hourAngle(h, phi, dec), lw, n), M, Ls);
  }

  /** 返回 date 当天（观测点当地）的日出/日落时刻，UTC Date 对象 */
  function sunTimes(date) {
    var lw = rad * -LNG, phi = rad * LAT;
    var d = toDays(date);
    var n = julianCycle(d, lw);
    var ds = approxTransit(0, lw, n);
    var M = solarMeanAnomaly(ds);
    var Ls = eclipticLongitude(M);
    var dec = declination(Ls);
    var Jnoon = solarTransitJ(ds, M, Ls);
    var h = -0.833 * rad; // 太阳视半径 + 大气折射修正
    var Jset = getSetJ(h, lw, phi, dec, n, M, Ls);
    var Jrise = Jnoon - (Jset - Jnoon);
    return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
  }

  function isDaytime(now) {
    var t = sunTimes(now);
    if (isNaN(t.sunrise.valueOf()) || isNaN(t.sunset.valueOf())) {
      // 极昼/极夜兜底（南京不会触发，防御性处理）
      var h = now.getHours();
      return h >= 6 && h < 18;
    }
    return now >= t.sunrise && now <= t.sunset;
  }

  /* ---------- 应用到 Fluid 的配色机制 ---------- */
  function targetSchema() { return isDaytime(new Date()) ? 'light' : 'dark'; }

  function hasManualChoice() {
    try { return localStorage.getItem(LS_KEY) !== null; } catch (e) { return false; }
  }

  function applyHighlight(schema) {
    var lightCss = document.getElementById('highlight-css');
    var darkCss = document.getElementById('highlight-css-dark');
    if (!lightCss || !darkCss) return;
    if (schema === 'dark') {
      darkCss.removeAttribute('disabled');
      lightCss.setAttribute('disabled', '');
    } else {
      lightCss.removeAttribute('disabled');
      darkCss.setAttribute('disabled', '');
    }
  }

  function applyIfNeeded() {
    var schema = targetSchema();
    var root = document.documentElement;
    // 无论是否有手动选择，都把日照对应的自动值写进默认属性：
    // Fluid 启动时拿「手动选择(localStorage) vs 默认」比较——不同则保留手动，
    // 相同则归位自动。若手动存在时不更新默认值，主题会误把「手动==静态默认」
    // 当成自动，导致手动选择在下次跳转时被清掉、状态丢失
    if (root.getAttribute('data-default-color-scheme') !== schema) {
      root.setAttribute('data-default-color-scheme', schema);
    }
    // 访客手动选择过：运行时配色完全交给 Fluid，这里绝不覆盖
    if (hasManualChoice()) return;
    if (document.readyState === 'loading') {
      // 解析阶段只改默认值，由 Fluid 的启动逻辑统一应用
      return;
    }
    // 页面已加载完成后跨过日出/日落：直接切换运行时配色与代码高亮
    if (root.getAttribute('data-user-color-scheme') === schema) return;
    root.setAttribute('data-user-color-scheme', schema);
    applyHighlight(schema);
  }

  applyIfNeeded();
  setInterval(applyIfNeeded, 60000);
})();
