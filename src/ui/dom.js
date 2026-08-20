/**
 * Tiny DOM + formatting helpers shared by every screen.
 * No framework: the game is small enough that direct DOM is clearer, and it
 * keeps the whole thing to a single dependency-free file when bundled.
 */
window.PG = window.PG || {};
PG.ui = PG.ui || {};

PG.ui.dom = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function apply(node, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.setAttribute('class', v);
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') {
        Object.keys(v).forEach(function (s) {
          // Custom properties only take via setProperty.
          if (s.slice(0, 2) === '--') node.style.setProperty(s, v[s]);
          else node.style[s] = v[s];
        });
      } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'dataset') {
        Object.keys(v).forEach(function (d) {
          node.dataset[d] = v[d];
        });
      } else {
        node.setAttribute(k, v === true ? '' : v);
      }
    });
  }

  function append(node, children) {
    if (children === null || children === undefined) return;
    if (Array.isArray(children)) {
      children.forEach(function (c) {
        append(node, c);
      });
      return;
    }
    node.appendChild(
      children instanceof Node ? children : document.createTextNode(String(children))
    );
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    apply(node, attrs);
    append(node, children);
    return node;
  }

  function svg(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset') {
          Object.keys(v).forEach(function (d) {
            node.dataset[d] = v[d];
          });
        } else if (k === 'text') {
          node.textContent = v;
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    append(node, children);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function mount(node, children) {
    clear(node);
    append(node, children);
    return node;
  }

  return { el: el, svg: svg, clear: clear, mount: mount, append: append };
})();

PG.ui.fmt = (function () {
  'use strict';

  function money(game, amount) {
    var cur = PG.getState(game.stateId).currency;
    var n = Math.round(amount * 10) / 10;
    var shown = Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
    return cur.symbol + shown + ' ' + cur.unit;
  }

  function pct(v, dp) {
    return (v || 0).toFixed(dp === undefined ? 1 : dp) + '%';
  }

  function signed(v, dp) {
    var n = v || 0;
    var s = n.toFixed(dp === undefined ? 0 : dp);
    return (n > 0 ? '+' : '') + s;
  }

  function plural(n, one, many) {
    return n === 1 ? one : many || one + 's';
  }

  /** Blend a hex colour toward another by t in 0..1. */
  function mix(hexA, hexB, t) {
    function parse(h) {
      var s = h.replace('#', '');
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      return [
        parseInt(s.slice(0, 2), 16),
        parseInt(s.slice(2, 4), 16),
        parseInt(s.slice(4, 6), 16),
      ];
    }
    var a = parse(hexA);
    var b = parse(hexB);
    var out = a.map(function (v, i) {
      return Math.round(v + (b[i] - v) * t);
    });
    return (
      '#' +
      out
        .map(function (v) {
          return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
        })
        .join('')
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  return {
    money: money,
    pct: pct,
    signed: signed,
    plural: plural,
    mix: mix,
    escapeHtml: escapeHtml,
  };
})();
