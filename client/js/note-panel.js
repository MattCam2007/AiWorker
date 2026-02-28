(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  var AUTOSAVE_DELAY = 3000;

  function NotePanel(noteConfig) {
    this.id = noteConfig.id;
    this.config = {
      name: noteConfig.name,
      file: noteConfig.file,
      headerBg: null,
      headerColor: null
    };
    this.type = 'note';
    this._textarea = null;
    this._previewEl = null;
    this._editTab = null;
    this._previewTab = null;
    this._element = null;
    this._wrapper = null;
    this._mode = 'edit';
    this._dirty = false;
    this._saving = false;
    this._autosaveTimer = null;
    this._lastSavedContent = '';
    this._destroyed = false;

    // Callback hooks (set by App, mirrors TerminalConnection interface)
    this._onStatusChange = null;
    this._onDirtyChange = null;
  }

  NotePanel.prototype.mount = function (el) {
    this._element = el;

    var wrapper = document.createElement('div');
    wrapper.className = 'note-panel-wrapper';
    el.appendChild(wrapper);
    this._wrapper = wrapper;

    // Toolbar
    wrapper.appendChild(this._buildToolbar());

    // Editor area (holds textarea + preview, fills remaining height)
    var editorArea = document.createElement('div');
    editorArea.className = 'np-editor-area';
    wrapper.appendChild(editorArea);
    this._editorArea = editorArea;

    // Textarea
    var textarea = document.createElement('textarea');
    textarea.className = 'np-textarea';
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.autocorrect = 'off';
    textarea.autocapitalize = 'off';
    editorArea.appendChild(textarea);
    this._textarea = textarea;

    // Preview pane
    var preview = document.createElement('div');
    preview.className = 'np-preview np-hidden';
    editorArea.appendChild(preview);
    this._previewEl = preview;

    // Wire events
    var self = this;
    textarea.addEventListener('input', function () {
      if (!self._dirty) {
        self._dirty = true;
        if (self._onDirtyChange) self._onDirtyChange(true);
      }
      self._scheduleAutosave();
    });

    textarea.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        self.save();
        return;
      }
      // Tab → 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        textarea.dispatchEvent(new Event('input'));
      }
    });

    this._loadContent();
  };

  NotePanel.prototype._buildToolbar = function () {
    var self = this;
    var bar = document.createElement('div');
    bar.className = 'np-toolbar';

    function btn(label, title, fn, extraClass) {
      var b = document.createElement('button');
      b.className = 'np-btn' + (extraClass ? ' ' + extraClass : '');
      b.textContent = label;
      b.title = title;
      b.type = 'button';
      b.addEventListener('mousedown', function (e) {
        // Prevent textarea from losing focus
        e.preventDefault();
      });
      b.addEventListener('click', fn);
      return b;
    }

    function sep() {
      var s = document.createElement('span');
      s.className = 'np-sep';
      return s;
    }

    // Wrap selection with before/after
    function wrapSel(before, after) {
      return function () {
        var ta = self._textarea;
        var start = ta.selectionStart;
        var end = ta.selectionEnd;
        var sel = ta.value.substring(start, end) || 'text';
        var repl = before + sel + (after !== undefined ? after : before);
        ta.value = ta.value.substring(0, start) + repl + ta.value.substring(end);
        ta.selectionStart = start + before.length;
        ta.selectionEnd = start + before.length + sel.length;
        ta.dispatchEvent(new Event('input'));
      };
    }

    // Prepend prefix to current line
    function prependLine(prefix) {
      return function () {
        var ta = self._textarea;
        var start = ta.selectionStart;
        var lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
        ta.value = ta.value.substring(0, lineStart) + prefix + ta.value.substring(lineStart);
        ta.selectionStart = ta.selectionEnd = start + prefix.length;
        ta.dispatchEvent(new Event('input'));
      };
    }

    // Insert text at cursor, optional cursor offset inside inserted text
    function insertAt(text, cursorOffset) {
      return function () {
        var ta = self._textarea;
        var start = ta.selectionStart;
        ta.value = ta.value.substring(0, start) + text + ta.value.substring(start);
        ta.selectionStart = ta.selectionEnd = start + (cursorOffset !== undefined ? cursorOffset : text.length);
        ta.dispatchEvent(new Event('input'));
      };
    }

    var tableSnippet = '\n| Col 1 | Col 2 | Col 3 |\n|-------|-------|-------|\n| cell  | cell  | cell  |\n';

    bar.appendChild(btn('B',   'Bold',          wrapSel('**')));
    bar.appendChild(btn('I',   'Italic',         wrapSel('_')));
    bar.appendChild(btn('H',   'Heading',        prependLine('## ')));
    bar.appendChild(btn('`',   'Inline code',    wrapSel('`')));
    bar.appendChild(btn('```', 'Code block',     insertAt('\n```\n\n```\n', 5)));
    bar.appendChild(btn('•',   'Bullet list',    prependLine('- ')));
    bar.appendChild(btn('1.',  'Numbered list',  prependLine('1. ')));
    bar.appendChild(btn('"',   'Blockquote',     prependLine('> ')));
    bar.appendChild(btn('⊞',   'Insert table',   insertAt(tableSnippet, 3)));
    bar.appendChild(btn('—',   'Horizontal rule', insertAt('\n---\n')));
    bar.appendChild(btn('[]',  'Link',           wrapSel('[', '](url)')));
    bar.appendChild(sep());

    // Edit / Preview tabs
    var editTab = btn('Edit', 'Edit mode', function () { self._setMode('edit'); }, 'np-tab-btn np-tab-active');
    var previewTab = btn('Preview', 'Preview mode', function () { self._setMode('preview'); }, 'np-tab-btn');
    self._editTab = editTab;
    self._previewTab = previewTab;
    bar.appendChild(editTab);
    bar.appendChild(previewTab);
    bar.appendChild(sep());

    var saveBtn = btn('Save', 'Save (Ctrl+S)', function () { self.save(); }, 'np-save-btn');
    bar.appendChild(saveBtn);

    return bar;
  };

  NotePanel.prototype._setMode = function (mode) {
    this._mode = mode;
    if (mode === 'preview') {
      this._renderPreview();
      this._textarea.classList.add('np-hidden');
      this._previewEl.classList.remove('np-hidden');
      this._editTab.classList.remove('np-tab-active');
      this._previewTab.classList.add('np-tab-active');
    } else {
      this._textarea.classList.remove('np-hidden');
      this._previewEl.classList.add('np-hidden');
      this._editTab.classList.add('np-tab-active');
      this._previewTab.classList.remove('np-tab-active');
      this._textarea.focus();
    }
  };

  NotePanel.prototype._renderPreview = function () {
    var md = this._textarea ? this._textarea.value : '';
    if (typeof marked !== 'undefined') {
      var html = typeof marked.parse === 'function'
        ? marked.parse(md, { gfm: true, breaks: true })
        : marked(md, { gfm: true, breaks: true });
      this._previewEl.innerHTML = html;
    } else {
      // Bare fallback
      this._previewEl.textContent = md;
    }
  };

  NotePanel.prototype._loadContent = function () {
    var self = this;
    fetch('/api/notes/' + this.id)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (self._textarea && data.content !== undefined) {
          self._textarea.value = data.content;
          self._lastSavedContent = data.content;
          self._dirty = false;
        }
      })
      .catch(function (err) {
        console.error('[note-panel] failed to load:', err);
      });
  };

  NotePanel.prototype._scheduleAutosave = function () {
    var self = this;
    if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(function () {
      if (self._dirty && !self._saving) self.save();
    }, AUTOSAVE_DELAY);
  };

  NotePanel.prototype.save = function () {
    if (!this._textarea) return Promise.resolve();

    var content = this._textarea.value;
    if (content === this._lastSavedContent) {
      this._dirty = false;
      if (this._onDirtyChange) this._onDirtyChange(false);
      return Promise.resolve();
    }

    var self = this;
    this._saving = true;
    return fetch('/api/notes/' + this.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        self._saving = false;
        if (result.success) {
          self._lastSavedContent = content;
          self._dirty = false;
          if (self._onDirtyChange) self._onDirtyChange(false);
        }
      })
      .catch(function (err) {
        self._saving = false;
        console.error('[note-panel] save failed:', err);
      });
  };

  NotePanel.prototype.unmount = function () {
    if (this._autosaveTimer) {
      clearTimeout(this._autosaveTimer);
      this._autosaveTimer = null;
    }
    if (this._wrapper && this._wrapper.parentNode) {
      this._wrapper.parentNode.removeChild(this._wrapper);
    }
    this._textarea = null;
    this._previewEl = null;
    this._editTab = null;
    this._previewTab = null;
    this._wrapper = null;
    this._element = null;
  };

  NotePanel.prototype.detach = function () {
    if (this._dirty && this._textarea) this.save();
    this.unmount();
  };

  NotePanel.prototype.attach = function (el) {
    this.mount(el);
  };

  NotePanel.prototype.resize = function () {
    // textarea resizes naturally; no-op
  };

  NotePanel.prototype.refit = function () {};

  NotePanel.prototype.focus = function () {
    if (this._textarea && this._mode === 'edit') this._textarea.focus();
  };

  NotePanel.prototype.getContent = function () {
    return this._textarea ? this._textarea.value : '';
  };

  NotePanel.prototype.isDirty = function () {
    return this._dirty;
  };

  NotePanel.prototype.isActive = function () {
    return this._textarea !== null;
  };

  NotePanel.prototype.destroy = function () {
    this._destroyed = true;
    this.detach();
  };

  NotePanel.prototype.refresh = function () {};

  NotePanel.prototype.moveTo = function (newMount) {
    if (this._wrapper) newMount.appendChild(this._wrapper);
    this._element = newMount;
  };

  ns.NotePanel = NotePanel;
})();
