/**
 * Small shared UI helpers: element building and Indian-format currency.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.dom = (function () {
  'use strict';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);

    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (s) {
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

    append(node, children);
    return node;
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

  function mount(node, children) {
    while (node.firstChild) node.removeChild(node.firstChild);
    append(node, children);
    return node;
  }

  /**
   * The same thing for SVG. A separate function because createElement makes an
   * HTMLUnknownElement for an <svg> tag — it appears in the DOM and renders
   * nothing at all, which is a hard bug to see.
   */
  function svg(tag, attrs, children) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);

    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (p) {
            if (p.slice(0, 2) === '--') node.style.setProperty(p, v[p]);
            else node.style[p] = v[p];
          });
        } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else {
          node.setAttribute(k, v === true ? '' : v);
        }
      });
    }

    append(node, children);
    return node;
  }

  return { el: el, svg: svg, mount: mount, append: append };
})();

CMP.ui.money = (function () {
  'use strict';

  var formatter = null;
  try {
    formatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  } catch (e) {
    formatter = null;
  }

  /** Indian digit grouping: 100000000 -> "10,00,00,000". */
  function group(n) {
    if (formatter) return formatter.format(n);
    // Manual fallback: last three digits, then pairs.
    var s = String(Math.round(n));
    if (s.length <= 3) return s;
    var last3 = s.slice(-3);
    var rest = s.slice(0, -3);
    return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }

  /** "₹10,00,00,000" */
  function format(n) {
    if (!n && n !== 0) return '';
    return '₹' + group(n);
  }

  /** Strip everything but digits, so "₹10,00,00,000" reads back as a number. */
  function parse(text) {
    var digits = String(text === null || text === undefined ? '' : text).replace(/[^0-9]/g, '');
    if (!digits) return 0;
    var n = parseInt(digits, 10);
    return isNaN(n) ? 0 : n;
  }

  /** A short human label: "₹10 crore", "₹50 lakh". */
  function words(n) {
    if (!n) return '';
    if (n >= 10000000) {
      var cr = n / 10000000;
      return '₹' + (cr % 1 === 0 ? cr : cr.toFixed(2)) + ' crore';
    }
    if (n >= 100000) {
      var l = n / 100000;
      return '₹' + (l % 1 === 0 ? l : l.toFixed(2)) + ' lakh';
    }
    return format(n);
  }

  return { format: format, parse: parse, group: group, words: words };
})();
