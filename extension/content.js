// Orthoto content script. No page scan: only the field being edited is checked.
// - <textarea> / <input type=text>: underlines drawn on a transparent mirror overlay
// - contenteditable: underlines drawn with the CSS Custom Highlight API (no DOM change)
(() => {
  if (globalThis.__orthoto) return;
  globalThis.__orthoto = true;

  const DEBOUNCE_MS = 500;
  const MAX_CHARS = 20000;
  const CODE_EDITORS = '.monaco-editor, .cm-editor, .CodeMirror, .ace_editor';
  const OPT_OUT = '[data-gramm="false"], [data-gramm_editor="false"], [data-enable-grammarly="false"], [data-orthoto="off"]';
  const BLOCK_TAGS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION',
    'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
    'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL']);
  const MIRROR_PROPS = ['direction', 'fontFamily', 'fontFeatureSettings', 'fontKerning', 'fontSize', 'fontStretch',
    'fontStyle', 'fontVariant', 'fontWeight', 'letterSpacing', 'lineHeight', 'overflowWrap', 'paddingBottom',
    'paddingLeft', 'paddingRight', 'paddingTop', 'tabSize', 'textAlign', 'textIndent', 'textTransform',
    'whiteSpace', 'wordBreak', 'wordSpacing'];
  const UI_CSS = `
    [hidden] { display: none !important; }
    .mirror { position: fixed; overflow: hidden; box-sizing: border-box; margin: 0; border: 0; color: transparent;
      background: transparent; pointer-events: none; }
    .mirror span { text-decoration: underline wavy var(--c); text-decoration-thickness: 1.5px;
      text-decoration-skip-ink: none; }
    .spell { --c: #e5484d; }
    .grammar { --c: #f5a524; }
    .pill { position: fixed; width: 18px; height: 18px; border-radius: 9px; color: #fff; cursor: pointer;
      font: 600 11px/18px system-ui, sans-serif; text-align: center; user-select: none; pointer-events: auto;
      box-shadow: 0 1px 3px rgb(0 0 0 / .25); }
    .pill.bad { background: #e5484d; }
    .pill.ok { background: #30a46c; }
    .pill.err { background: #8b8d98; }
    .card { position: fixed; min-width: 160px; max-width: 320px; padding: 10px; border-radius: 10px;
      background: #fff; color: #1d1d1f; font: 14px/1.4 system-ui, sans-serif; pointer-events: auto;
      box-shadow: 0 6px 24px rgb(0 0 0 / .18), 0 0 0 1px rgb(0 0 0 / .06); }
    .opts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .opt { font: 600 14px/1.4 system-ui, sans-serif; color: #fff; background: #2563eb; border: 0;
      border-radius: 6px; padding: 3px 10px; cursor: pointer; }
    .opt:hover { background: #1d4ed8; }
    .msg { font-size: 12.5px; color: #55565d; }
    .ignore { margin-top: 6px; padding: 0; border: 0; background: none; color: #6b6b70; cursor: pointer;
      font: 12px system-ui, sans-serif; text-decoration: underline; }
    .panel { position: fixed; width: 320px; max-width: calc(100vw - 16px); display: flex; flex-direction: column;
      border-radius: 12px; background: #fff; color: #1d1d1f; font: 14px/1.4 system-ui, sans-serif;
      pointer-events: auto; overflow: hidden; box-shadow: 0 8px 32px rgb(0 0 0 / .2), 0 0 0 1px rgb(0 0 0 / .06); }
    .phead { display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-weight: 600;
      border-bottom: 1px solid rgb(0 0 0 / .08); }
    .phead .title { flex: 1; }
    .close { border: 0; background: none; color: #6b6b70; cursor: pointer; font: 18px/1 system-ui, sans-serif;
      padding: 0 2px; }
    .list { overflow-y: auto; overscroll-behavior: contain; }
    .item { display: flex; gap: 8px; padding: 9px 12px; border-bottom: 1px solid rgb(0 0 0 / .06); cursor: pointer; }
    .item:hover { background: rgb(0 0 0 / .035); }
    .dot { flex: none; width: 8px; height: 8px; margin-top: 7px; border-radius: 4px; background: var(--c); }
    .body { flex: 1; min-width: 0; }
    .fix { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .orig { text-decoration: line-through; color: #8b8d98; overflow-wrap: anywhere; }
    .arrow { color: #8b8d98; }
    .item .opt { font-size: 13px; padding: 1px 8px; }
    .item .msg { margin-top: 2px; }
    .item .ignore { margin-top: 2px; }
    .empty { padding: 16px 12px; color: #55565d; text-align: center; }
    .pfoot { padding: 10px 12px; }
    .all { width: 100%; font: 600 14px/1.4 system-ui, sans-serif; color: #fff; background: #2563eb; border: 0;
      border-radius: 8px; padding: 7px 10px; cursor: pointer; }
    .all:hover { background: #1d4ed8; }
    @media (prefers-color-scheme: dark) {
      .card, .panel { background: #232327; color: #ececf0; }
      .msg, .ignore, .close, .empty { color: #a1a1aa; }
      .phead, .item { border-color: rgb(255 255 255 / .08); }
      .item:hover { background: rgb(255 255 255 / .05); }
    }`;

  const listeners = new AbortController();
  const settings = { enabled: true, disabledSites: [] };
  const ignored = new Set();
  const keyOf = (m) => `${m.ruleId}\u0000${m.original}`;
  let field = null;
  let ui = null;
  let cardMatch = null;
  let panelOpen = false;
  let timer = 0;
  let seq = 0;
  let placeQueued = false;

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function getUI() {
    if (ui?.host.isConnected) return ui;
    const host = document.createElement('orthoto-ui');
    host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    const pill = h('div', 'pill');
    const card = h('div', 'card');
    const panel = h('div', 'panel');
    pill.hidden = card.hidden = panel.hidden = true;
    root.append(h('style', null, UI_CSS), pill, card, panel);
    document.documentElement.append(host);
    // Keep the focus (and selection) in the edited field when clicking our UI.
    for (const node of [pill, card, panel]) node.addEventListener('mousedown', (e) => e.preventDefault());
    pill.addEventListener('click', onPillClick);
    ui = { host, root, pill, card, panel };
    return ui;
  }

  function fieldBox(el) {
    const r = el.getBoundingClientRect();
    if (!el.clientWidth) return r;
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight, width: el.clientWidth, height: el.clientHeight };
  }

  const selectionFor = (el) => el.getRootNode().getSelection?.() ?? document.getSelection();

  // ---- <textarea> and <input type=text> ------------------------------------
  class InputField {
    constructor(el) {
      this.el = el;
      this.text = el.value;
      this.matches = [];
      this.spans = new Map();
      this.mirror = h('div', 'mirror');
      getUI().root.prepend(this.mirror);
      this.observer = new ResizeObserver(schedulePlace);
      this.observer.observe(el);
    }

    getText() { return this.el.value; }

    setMatches(matches, text) {
      this.matches = matches;
      this.text = text;
      this.render();
    }

    sync() {
      const text = this.el.value;
      if (text === this.text) return false;
      this.matches = shiftMatches(this.matches, this.text, text);
      this.text = text;
      this.render();
      return true;
    }

    render() {
      const frag = document.createDocumentFragment();
      this.spans.clear();
      let pos = 0;
      for (const m of this.matches) {
        if (m.offset < pos || this.text.slice(m.offset, m.offset + m.length) !== m.original) continue;
        const span = h('span', m.kind, m.original);
        this.spans.set(m, span);
        frag.append(this.text.slice(pos, m.offset), span);
        pos = m.offset + m.length;
      }
      // Zero-width space: a trailing newline must still produce a line, as in the field.
      frag.append(`${this.text.slice(pos)}\u200b`);
      this.mirror.replaceChildren(frag);
      this.place();
    }

    place() {
      const { el, mirror } = this;
      const box = fieldBox(el);
      mirror.hidden = !box.width || !box.height;
      if (mirror.hidden) return;
      const cs = getComputedStyle(el);
      for (const prop of MIRROR_PROPS) mirror.style[prop] = cs[prop];
      if (el instanceof HTMLInputElement) {
        mirror.style.whiteSpace = 'pre';
        mirror.style.lineHeight = `${box.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)}px`;
      }
      mirror.style.left = `${box.left}px`;
      mirror.style.top = `${box.top}px`;
      mirror.style.width = `${box.width}px`;
      mirror.style.height = `${box.height}px`;
      mirror.scrollTop = el.scrollTop;
      mirror.scrollLeft = el.scrollLeft;
    }

    matchAtCaret() {
      const { selectionStart: start, selectionEnd: end } = this.el;
      if (start !== end) return null;
      return this.matches.find((m) => this.spans.has(m) && m.offset <= start && start <= m.offset + m.length) ?? null;
    }

    rectOf(m) { return this.spans.get(m)?.getClientRects()[0] ?? null; }

    reveal(m) {
      this.el.focus();
      this.el.setSelectionRange(m.offset, m.offset);
    }

    apply(m, value) {
      const { el } = this;
      el.focus();
      el.setSelectionRange(m.offset, m.offset + m.length);
      // insertText keeps the native undo stack and notifies frameworks (React...).
      if (!document.execCommand('insertText', false, value)) {
        el.setRangeText(value, m.offset, m.offset + m.length, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // Edits are applied from the end of the text so the earlier offsets stay valid.
    applyAll(edits) {
      const sorted = edits.map(({ m, value }) => ({ ...m, value })).sort((a, b) => b.offset - a.offset);
      let applied = 0;
      for (const e of sorted) {
        if (this.el.value.slice(e.offset, e.offset + e.length) !== e.original) continue;
        this.apply(e, e.value);
        applied++;
      }
      return applied;
    }

    remove(...ms) {
      this.matches = this.matches.filter((x) => !ms.includes(x));
      this.render();
    }

    destroy() {
      this.observer.disconnect();
      this.mirror.remove();
    }
  }

  // ---- contenteditable -----------------------------------------------------
  // Flattens the editor into plain text; block elements and <br> become "\n".
  function extractText(root) {
    let text = '';
    const nodes = [];
    const visit = (parent) => {
      for (let n = parent.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === Node.TEXT_NODE) {
          if (n.data) nodes.push({ node: n, start: text.length });
          text += n.data;
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          const tag = n.tagName;
          if (tag === 'BR') text += '\n';
          else if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') continue;
          else if (n.getAttribute('contenteditable') === 'false') text += n.textContent; // e.g. @mention chips
          else {
            const block = BLOCK_TAGS.has(tag);
            if (block && text && !text.endsWith('\n')) text += '\n';
            visit(n);
            if (block && text && !text.endsWith('\n')) text += '\n';
          }
        }
      }
    };
    visit(root);
    return { text, nodes };
  }

  function locate(nodes, pos, isEnd) {
    let lo = 0;
    let hi = nodes.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (isEnd ? nodes[mid].start < pos : nodes[mid].start <= pos) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return null;
    const { node, start } = nodes[found];
    const offset = pos - start;
    return (isEnd ? offset <= node.length : offset < node.length) ? [node, offset] : null;
  }

  function toRange(nodes, start, end) {
    const a = locate(nodes, start, false);
    const b = locate(nodes, end, true);
    if (!a || !b) return null;
    const range = new Range();
    range.setStart(...a);
    range.setEnd(...b);
    return range;
  }

  const squash = (s) => s.replace(/\s+/g, '');

  class EditableField {
    constructor(el) {
      this.el = el;
      this.matches = [];
      this.observer = new ResizeObserver(schedulePlace);
      this.observer.observe(el);
    }

    getText() { return extractText(this.el).text; }

    setMatches(matches) {
      const { nodes } = extractText(this.el);
      this.matches = [];
      for (const m of matches) {
        const range = toRange(nodes, m.offset, m.offset + m.length);
        if (range) this.matches.push({ ...m, range });
      }
      this.paint();
    }

    // Ranges are live and follow the edits; drop those whose text changed.
    sync() {
      const count = this.matches.length;
      this.matches = this.matches.filter((m) => !m.range.collapsed && squash(m.range.toString()) === squash(m.original));
      if (this.matches.length === count) return false;
      this.paint();
      return true;
    }

    paint() {
      const spell = [];
      const grammar = [];
      for (const m of this.matches) (m.kind === 'spell' ? spell : grammar).push(m.range);
      CSS.highlights.set('orthoto-spell', new Highlight(...spell));
      CSS.highlights.set('orthoto-grammar', new Highlight(...grammar));
    }

    place() {}

    matchAtCaret() {
      const sel = selectionFor(this.el);
      if (!sel?.rangeCount || !sel.isCollapsed) return null;
      return this.matches.find((m) => m.range.isPointInRange(sel.anchorNode, sel.anchorOffset)) ?? null;
    }

    rectOf(m) { return m.range.getClientRects()[0] ?? null; }

    select(range) {
      this.el.focus({ preventScroll: true });
      const sel = selectionFor(this.el);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    reveal(m) {
      m.range.startContainer.parentElement?.scrollIntoView({ block: 'nearest' });
      const caret = m.range.cloneRange();
      caret.collapse(true);
      this.select(caret);
    }

    apply(m, value) {
      const range = m.range.cloneRange();
      this.select(range);
      // Editors with their own document model (Slate, Lexical...) handle beforeinput with its
      // target range and cancel it. Otherwise (plain contenteditable, ProseMirror...), fall
      // back to the native insertText, which keeps the undo stack.
      const { startContainer, startOffset, endContainer, endOffset } = range;
      const event = new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: value,
        targetRanges: [new StaticRange({ startContainer, startOffset, endContainer, endOffset })],
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      if (!this.el.dispatchEvent(event)) return;
      if (!document.execCommand('insertText', false, value)) {
        range.deleteContents();
        range.insertNode(document.createTextNode(value));
        this.el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // Ranges are live, but an editor re-rendering its DOM may break them: check each one first.
    applyAll(edits) {
      const sorted = [...edits].sort((a, b) => b.m.offset - a.m.offset);
      let applied = 0;
      for (const { m, value } of sorted) {
        if (m.range.collapsed || squash(m.range.toString()) !== squash(m.original)) continue;
        this.apply(m, value);
        applied++;
      }
      return applied;
    }

    remove(...ms) {
      this.matches = this.matches.filter((x) => !ms.includes(x));
      this.paint();
    }

    destroy() {
      this.observer.disconnect();
      CSS.highlights.delete('orthoto-spell');
      CSS.highlights.delete('orthoto-grammar');
    }
  }

  // shiftMatches() comes from core.classic.js, generated from web/core.js at build time
  // and loaded before this script (content scripts cannot import ES modules).

  // ---- Field detection -----------------------------------------------------
  function fieldElement(target) {
    if (!(target instanceof Element) || target.closest(CODE_EDITORS) || target.closest(OPT_OUT)) return null;
    const isInput = target instanceof HTMLInputElement;
    if (target instanceof HTMLTextAreaElement || (isInput && target.type === 'text')) {
      if (target.readOnly || target.disabled) return null;
      // Personal-data fields (name, e-mail, address...) only produce noise.
      if (isInput && target.autocomplete && target.autocomplete !== 'on' && target.autocomplete !== 'off') return null;
      // Tiny hidden textareas are used as input sinks by code editors.
      if (target.offsetWidth < 40 || target.offsetHeight < 14) return null;
      return target;
    }
    if (target.isContentEditable && 'highlights' in CSS) {
      let host = target;
      while (host.parentElement?.isContentEditable) host = host.parentElement;
      return host;
    }
    return null;
  }

  const enabledHere = () => settings.enabled && !settings.disabledSites.includes(location.hostname);

  function activate(el, delay) {
    deactivate();
    field = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? new InputField(el) : new EditableField(el);
    scheduleCheck(delay);
  }

  function deactivate() {
    clearTimeout(timer);
    hideCard();
    hidePanel();
    field?.destroy();
    field = null;
    if (ui) ui.pill.hidden = true;
  }

  // ---- Checking ------------------------------------------------------------
  function scheduleCheck(delay) {
    clearTimeout(timer);
    timer = setTimeout(runCheck, delay);
  }

  async function runCheck() {
    const f = field;
    if (!f || !enabledHere()) return;
    const text = f.getText();
    if (text === f.checkedText) return;
    if (!text.trim() || text.length > MAX_CHARS) {
      f.checkedText = text;
      f.hasResult = false;
      f.setMatches([], text);
      refreshPill();
      return;
    }
    const id = ++seq;
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'check', text });
    } catch {
      shutdown(); // the extension was reloaded or removed: this script is orphaned
      return;
    }
    if (id !== seq || f !== field || f.getText() !== text) return;
    f.checkedText = text;
    f.hasResult = true;
    f.error = res?.error ?? null;
    if (!f.error) f.setMatches(res.matches.filter((m) => !ignored.has(keyOf(m))), text);
    refreshPill();
  }

  // ---- Pill (error counter) and suggestion card ----------------------------
  function refreshPill() {
    const { pill } = getUI();
    pill.hidden = !field?.hasResult;
    if (pill.hidden) return hidePanel();
    const count = field.matches.length;
    pill.className = `pill ${field.error ? 'err' : count ? 'bad' : 'ok'}`;
    pill.textContent = field.error ? '!' : count ? String(Math.min(count, 99)) : '✓';
    pill.title = field.error ? `Orthoto: ${field.error}` : count ? `Orthoto: ${count} error${count > 1 ? 's' : ''}` : 'Orthoto: no errors';
    if (panelOpen) renderPanel();
    placePill();
  }

  function placePill() {
    if (!ui || ui.pill.hidden || !field) return;
    const box = fieldBox(field.el);
    const size = 18;
    const visible = box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
    ui.pill.style.visibility = visible ? 'visible' : 'hidden';
    ui.pill.style.left = `${Math.min(box.right, innerWidth) - size - 6}px`;
    ui.pill.style.top = `${Math.min(box.bottom, innerHeight) - size - 6}px`;
    placePanel();
  }

  function onPillClick() {
    if (!field) return;
    if (field.error) {
      chrome.runtime.sendMessage({ type: 'openOptions' }).catch(() => {});
      return;
    }
    if (panelOpen) return hidePanel();
    hideCard();
    panelOpen = true;
    renderPanel();
    placePill();
  }

  // ---- Panel listing every error of the field ------------------------------
  function openMatch(m) {
    hidePanel();
    field.reveal(m);
    requestAnimationFrame(() => {
      field?.place();
      if (field?.matches.includes(m)) showCard(m);
    });
  }

  function afterEdit() {
    refreshPill();
    scheduleCheck(DEBOUNCE_MS);
  }

  function fixAll() {
    if (!field) return;
    const edits = field.matches.filter((m) => m.options.length).map((m) => ({ m, value: m.options[0] }));
    hidePanel();
    if (!edits.length) return;
    field.applyAll(edits);
    // Editors applying the change themselves (Slate...) may not fire an input event.
    field.remove(...edits.map((e) => e.m));
    afterEdit();
  }

  function renderPanel() {
    const { panel } = getUI();
    if (!field || field.error) return hidePanel();
    const { matches } = field;
    const fixable = matches.filter((m) => m.options.length).length;
    const head = h('div', 'phead');
    head.append(h('span', 'title', matches.length ? `${matches.length} error${matches.length > 1 ? 's' : ''}` : 'Orthoto'));
    const close = h('button', 'close', '×');
    close.title = 'Close';
    close.addEventListener('click', hidePanel);
    head.append(close);
    const list = h('div', 'list');
    if (!matches.length) list.append(h('div', 'empty', 'No errors, nice work ✨'));
    for (const m of matches) {
      const item = h('div', `item ${m.kind}`);
      const body = h('div', 'body');
      const fix = h('div', 'fix');
      fix.append(h('span', 'orig', m.original));
      if (m.options.length) {
        fix.append(h('span', 'arrow', '→'));
        const button = h('button', 'opt', label(m.options[0]));
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!field) return;
          field.apply(m, m.options[0]);
          field.remove(m);
          afterEdit();
        });
        fix.append(button);
      }
      const ignore = h('button', 'ignore', 'Ignore');
      ignore.addEventListener('click', (e) => {
        e.stopPropagation();
        ignored.add(keyOf(m));
        field?.remove(m);
        refreshPill();
      });
      body.append(fix, h('div', 'msg', m.message), ignore);
      item.append(h('span', 'dot'), body);
      item.addEventListener('click', () => openMatch(m));
      list.append(item);
    }
    const children = [head, list];
    if (fixable) {
      const foot = h('div', 'pfoot');
      const all = h('button', 'all', fixable > 1 ? `Fix all (${fixable})` : 'Fix');
      all.addEventListener('click', fixAll);
      foot.append(all);
      children.push(foot);
    }
    panel.replaceChildren(...children);
    panel.hidden = false;
  }

  // Anchored to the pill, above it when there is room, right edges aligned.
  function placePanel() {
    if (!ui || ui.panel.hidden) return;
    const { pill, panel } = ui;
    const p = pill.getBoundingClientRect();
    const below = innerHeight - p.bottom - 14;
    const above = p.top - 14;
    const up = above >= Math.min(320, below);
    panel.style.maxHeight = `${Math.max(160, Math.min(420, up ? above : below))}px`;
    const w = panel.offsetWidth;
    const ht = panel.offsetHeight;
    panel.style.left = `${Math.max(8, Math.min(p.right - w, innerWidth - w - 8))}px`;
    panel.style.top = `${up ? Math.max(8, p.top - ht - 6) : p.bottom + 6}px`;
  }

  function hidePanel() {
    panelOpen = false;
    if (ui) ui.panel.hidden = true;
  }

  function label(value) {
    if (value === '') return '(delete)';
    return value.trim() === '' ? '␣' : value;
  }

  function showCard(m) {
    const rect = field?.rectOf(m);
    if (!rect) return hideCard();
    const { card } = getUI();
    card.replaceChildren();
    if (m.options.length) {
      const opts = h('div', 'opts');
      for (const value of m.options.slice(0, 4)) {
        const button = h('button', 'opt', label(value));
        button.addEventListener('click', () => {
          hideCard();
          if (!field) return;
          field.apply(m, value);
          // Editors applying the change themselves (Slate...) may not fire an input event.
          field.remove(m);
          refreshPill();
          scheduleCheck(DEBOUNCE_MS);
        });
        opts.append(button);
      }
      card.append(opts);
    }
    const ignore = h('button', 'ignore', 'Ignore');
    ignore.addEventListener('click', () => {
      ignored.add(keyOf(m));
      field?.remove(m);
      hideCard();
      refreshPill();
    });
    card.append(h('div', 'msg', m.message), ignore);
    card.hidden = false;
    cardMatch = m;
    const { offsetWidth: w, offsetHeight: ht } = card;
    let top = rect.bottom + 6;
    if (top + ht > innerHeight - 8) top = Math.max(8, rect.top - ht - 6);
    card.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - w - 8))}px`;
    card.style.top = `${top}px`;
  }

  function hideCard() {
    cardMatch = null;
    if (ui) ui.card.hidden = true;
  }

  // ---- Events ----------------------------------------------------------------
  function schedulePlace() {
    if (!field || placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => {
      placeQueued = false;
      if (!field) return;
      if (!field.el.isConnected) return deactivate();
      if (field.sync()) scheduleCheck(DEBOUNCE_MS);
      field.place();
      placePill();
    });
  }

  function onFocusIn(e) {
    if (!enabledHere()) return;
    const el = fieldElement(e.composedPath()[0]);
    if (el && el !== field?.el) activate(el, 0);
  }

  function onInput(e) {
    if (!enabledHere()) return;
    const el = fieldElement(e.composedPath()[0]);
    if (!el) return;
    if (el !== field?.el) return activate(el, DEBOUNCE_MS);
    hideCard();
    field.sync();
    refreshPill();
    scheduleCheck(DEBOUNCE_MS);
  }

  function onMouseUp(e) {
    if (!field) return;
    const path = e.composedPath();
    if (ui && path.includes(ui.host)) return;
    hidePanel();
    if (!path.includes(field.el)) return hideCard();
    setTimeout(() => {
      const m = field?.matchAtCaret();
      if (m) showCard(m);
      else hideCard();
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && (cardMatch || panelOpen)) {
      e.stopPropagation();
      hideCard();
      hidePanel();
    }
  }

  // Catches programmatic changes (e.g. a chat box cleared after sending).
  function onKeyUp() {
    if (field?.sync()) {
      refreshPill();
      scheduleCheck(DEBOUNCE_MS);
    }
  }

  function onScroll() {
    hideCard();
    schedulePlace();
  }

  function shutdown() {
    listeners.abort();
    deactivate();
    ui?.host.remove();
    globalThis.__orthoto = false;
  }

  const capture = { capture: true, signal: listeners.signal };
  document.addEventListener('focusin', onFocusIn, capture);
  document.addEventListener('input', onInput, capture);
  document.addEventListener('mouseup', onMouseUp, capture);
  document.addEventListener('keydown', onKeyDown, capture);
  document.addEventListener('keyup', onKeyUp, capture);
  document.addEventListener('scroll', onScroll, { ...capture, passive: true });
  window.addEventListener('resize', schedulePlace, { passive: true, signal: listeners.signal });

  chrome.storage.local.get(settings).then((s) => Object.assign(settings, s)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(settings)) if (key in changes) settings[key] = changes[key].newValue;
    if (!enabledHere()) deactivate();
    else if (field && ['lang', 'server', 'user', 'password'].some((k) => k in changes)) {
      field.checkedText = null;
      scheduleCheck(0);
    }
  });
})();
