/*
 * dc-lite.js: a tiny standalone renderer for the Wingold preview pages.
 * It reads the page template (<template id="dc-tpl">) and the page logic
 * (<script type="text/x-dc" data-dc-script>), then renders {{holes}},
 * <sc-for> loops, <sc-if> branches and onClick/onChange handlers.
 */
(function () {
  'use strict';

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var pending = false;
  var renderFn = null;

  function schedule() {
    if (pending) { return; }
    pending = true;
    var tick = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    tick(function () {
      pending = false;
      if (renderFn) { renderFn(); }
    });
  }

  function DCLogic(props) {
    this.props = props || {};
  }
  DCLogic.prototype.setState = function (patch) {
    var prev = this.state || {};
    var next = typeof patch === 'function' ? patch(prev) : patch;
    this.state = Object.assign({}, prev, next || {});
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  function lookup(scope, expr) {
    expr = String(expr).trim();
    if (expr === 'true') { return true; }
    if (expr === 'false') { return false; }
    if (expr === 'null') { return null; }
    if (/^-?\d+(\.\d+)?$/.test(expr)) { return Number(expr); }
    if (/^'.*'$|^".*"$/.test(expr)) { return expr.slice(1, -1); }
    var parts = expr.split('.');
    var v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v === null || v === undefined) { return undefined; }
      v = v[parts[i]];
    }
    return v;
  }

  function str(v) { return v === null || v === undefined ? '' : String(v); }

  function interp(s, scope) {
    return s.replace(HOLE, function (_, e) { return str(lookup(scope, e)); });
  }

  function holeExpr(attr) {
    var m = (attr || '').match(WHOLE);
    return m ? m[1] : attr;
  }

  function processChildren(node, scope, out) {
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var res = processNode(kids[i], scope);
      for (var j = 0; j < res.length; j++) { out.push(res[j]); }
    }
    return out;
  }

  function processNode(node, scope) {
    if (node.nodeType === 3) {
      if (node.nodeValue.indexOf('{{') === -1) { return [document.createTextNode(node.nodeValue)]; }
      return [document.createTextNode(interp(node.nodeValue, scope))];
    }
    if (node.nodeType !== 1) { return []; }

    var tag = node.localName;

    if (tag === 'sc-for') {
      var list = lookup(scope, holeExpr(node.getAttribute('list'))) || [];
      var as = node.getAttribute('as') || 'item';
      var outFor = [];
      for (var i = 0; i < list.length; i++) {
        var s = Object.create(scope);
        s[as] = list[i];
        s.$index = i;
        processChildren(node, s, outFor);
      }
      return outFor;
    }

    if (tag === 'sc-if') {
      var cond = lookup(scope, holeExpr(node.getAttribute('value')));
      return cond ? processChildren(node, scope, []) : [];
    }

    var el = node.namespaceURI === SVG_NS
      ? document.createElementNS(SVG_NS, node.tagName)
      : document.createElement(node.tagName);

    var attrs = node.attributes;
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name;
      var val = attrs[a].value;
      if (val.indexOf('{{') === -1) {
        el.setAttribute(name, val);
        continue;
      }
      var m = val.match(WHOLE);
      if (m) {
        var v = lookup(scope, m[1]);
        if (/^on/i.test(name)) {
          if (typeof v === 'function') { el.addEventListener(name.slice(2).toLowerCase(), v); }
          continue;
        }
        if (typeof v === 'boolean') {
          if (/^aria-/i.test(name)) { el.setAttribute(name, String(v)); }
          else if (v) { el.setAttribute(name, ''); }
          if (name === 'checked') { el.checked = v; }
          continue;
        }
        if (v === null || v === undefined) { continue; }
        el.setAttribute(name, String(v));
        continue;
      }
      el.setAttribute(name, interp(val, scope));
    }

    var kids = processChildren(node, scope, []);
    for (var k = 0; k < kids.length; k++) { el.appendChild(kids[k]); }
    return [el];
  }

  function defaultsFrom(script) {
    var props = {};
    try {
      var spec = JSON.parse(script.getAttribute('data-props') || '{}');
      Object.keys(spec).forEach(function (key) {
        if (key.charAt(0) === '$') { return; }
        if (spec[key] && Object.prototype.hasOwnProperty.call(spec[key], 'default')) { props[key] = spec[key].default; }
      });
    } catch (e) { /* no props */ }
    return props;
  }

  function init() {
    var tpl = document.getElementById('dc-tpl');
    var script = document.querySelector('script[data-dc-script]');
    if (!tpl || !script) { return; }

    var Component = new Function('DCLogic', script.textContent + '\nreturn Component;')(DCLogic);
    var comp = new Component(defaultsFrom(script));

    var mount = document.createElement('div');
    mount.id = 'dc-root';
    tpl.parentNode.insertBefore(mount, tpl);

    renderFn = function () {
      var openDetails = Array.prototype.map.call(mount.querySelectorAll('details'), function (d) { return d.open; });
      var activeId = document.activeElement && document.activeElement.id;
      var scope = comp.renderVals() || {};
      var frag = document.createDocumentFragment();
      processChildren(tpl.content, scope, []).forEach(function (n) { frag.appendChild(n); });
      while (mount.firstChild) { mount.removeChild(mount.firstChild); }
      mount.appendChild(frag);
      Array.prototype.forEach.call(mount.querySelectorAll('details'), function (d, i) { if (openDetails[i]) { d.open = true; } });
      if (activeId) {
        var again = document.getElementById(activeId);
        if (again && again.focus) { again.focus({ preventScroll: true }); }
      }
    };

    renderFn();
    if (typeof comp.componentDidMount === 'function') { comp.componentDidMount(); }
    if (location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) { target.scrollIntoView(); }
    }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
