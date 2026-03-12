/* editor-panel.js – CodeMirror 6 based file editor panel
 * Follows the same interface as NotePanel so the layout engine can host it.
 */
(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  var AUTOSAVE_DELAY = 3000;

  // Extensions whose files we treat as editable text
  var TEXT_EXTENSIONS = new Set([
    'txt', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
    'py', 'pyw', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
    'c', 'h', 'cpp', 'hpp', 'cc',
    'css', 'scss', 'less', 'sass',
    'html', 'htm', 'xml', 'svg',
    'php', 'json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env',
    'sh', 'bash', 'zsh', 'fish',
    'sql', 'graphql', 'gql',
    'r', 'lua', 'pl', 'scala',
    'dockerfile', 'makefile', 'gitignore', 'editorconfig',
  ]);

  ns.isTextFile = function (fileName) {
    var lower = fileName.toLowerCase();
    // Extensionless files by name
    var noExt = ['dockerfile', 'makefile', 'gemfile', 'rakefile',
      'vagrantfile', 'procfile', 'cmakelists', '.gitignore',
      '.editorconfig', '.env', '.bashrc', '.zshrc'];
    if (noExt.indexOf(lower) !== -1) return true;
    var dotIdx = lower.lastIndexOf('.');
    if (dotIdx === -1) return false;
    var ext = lower.slice(dotIdx + 1);
    return TEXT_EXTENSIONS.has(ext);
  };

  // -----------------------------------------------------------------------

  function EditorPanel(fileConfig) {
    this.id = fileConfig.id;
    this.config = {
      name: fileConfig.name,
      file: fileConfig.file,
      headerBg: null,
      headerColor: null,
    };
    this.type = 'editor';
    this._cmView = null;
    this._wrapper = null;
    this._cmContainer = null;
    this._statusEl = null;
    this._langEl = null;
    this._dirty = false;
    this._saving = false;
    this._autosaveTimer = null;
    this._lastSavedContent = '';
    this._onDirtyChange = null;
    this._destroyed = false;
  }

  EditorPanel.prototype.isDirty = function () { return this._dirty; };
  EditorPanel.prototype.isActive = function () { return !!this._cmView; };
  EditorPanel.prototype.refresh = function () {};
  EditorPanel.prototype.resize = function () {};
  EditorPanel.prototype.refit = function () {
    if (this._cmView) this._cmView.requestMeasure();
  };

  EditorPanel.prototype.mount = function (el) {
    var self = this;
    var wrapper = document.createElement('div');
    wrapper.className = 'ep-wrapper';
    el.appendChild(wrapper);
    this._wrapper = wrapper;

    // Status bar (bottom-of-toolbar strip)
    var statusBar = document.createElement('div');
    statusBar.className = 'ep-statusbar';

    var statusLeft = document.createElement('span');
    statusLeft.className = 'ep-status-text';
    statusLeft.textContent = 'Loading…';
    this._statusEl = statusLeft;
    statusBar.appendChild(statusLeft);

    var langLabel = document.createElement('span');
    langLabel.className = 'ep-lang-label';
    langLabel.textContent = this._getLanguageName();
    this._langEl = langLabel;
    statusBar.appendChild(langLabel);

    wrapper.appendChild(statusBar);

    // CodeMirror container
    var cmContainer = document.createElement('div');
    cmContainer.className = 'ep-cm-container';
    wrapper.appendChild(cmContainer);
    this._cmContainer = cmContainer;

    this._initCM();
  };

  EditorPanel.prototype._initCM = function () {
    var self = this;

    // CM6 is loaded asynchronously via an ES module in index.html.
    // window.CM6 === undefined  → not yet loaded
    // window.CM6 === false      → failed to load
    // window.CM6 === object     → ready
    if (window.CM6 === undefined) {
      var handler = function () {
        document.removeEventListener('cm6-ready', handler);
        self._initCM();
      };
      document.addEventListener('cm6-ready', handler);
      return;
    }

    if (!window.CM6) {
      this._updateStatus('CodeMirror unavailable – check network');
      return;
    }

    try {
      var cm6 = window.CM6;
      var langExt = this._getLanguageExtension(cm6);

      var extensions = [
        cm6.basicSetup,
        cm6.oneDark,
        cm6.EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': {
            fontFamily: 'var(--td-font-terminal)',
            fontSize: 'var(--td-font-size)',
          },
        }),
        cm6.EditorView.updateListener.of(function (update) {
          if (!update.docChanged) return;
          if (!self._dirty) {
            self._dirty = true;
            if (self._onDirtyChange) self._onDirtyChange(true);
          }
          self._updateStatus('Unsaved');
          self._scheduleAutosave();
        }),
      ];

      if (cm6.keymap) {
        extensions.push(cm6.keymap.of([{
          key: 'Ctrl-s',
          preventDefault: true,
          run: function () { self.save(); return true; },
        }]));
      }

      if (langExt) extensions.push(langExt);

      var state = cm6.EditorState.create({ doc: '', extensions: extensions });
      this._cmView = new cm6.EditorView({ state: state, parent: this._cmContainer });

      this._loadContent();
    } catch (err) {
      console.error('[editor-panel] CM6 init error:', err);
      this._updateStatus('Editor error: ' + err.message);
    }
  };

  EditorPanel.prototype._getLanguageExtension = function (cm6) {
    var ext = this._fileExt();
    var langs = cm6.languages;
    if (!langs) return null;
    switch (ext) {
      case 'js': case 'mjs': case 'cjs':
        return langs.javascript ? langs.javascript() : null;
      case 'jsx':
        return langs.javascript ? langs.javascript({ jsx: true }) : null;
      case 'ts':
        return langs.javascript ? langs.javascript({ typescript: true }) : null;
      case 'tsx':
        return langs.javascript ? langs.javascript({ jsx: true, typescript: true }) : null;
      case 'py': case 'pyw':
        return langs.python ? langs.python() : null;
      case 'css': case 'scss': case 'less': case 'sass':
        return langs.css ? langs.css() : null;
      case 'html': case 'htm':
        return langs.html ? langs.html() : null;
      case 'php':
        return langs.php ? langs.php() : null;
      case 'json':
        return langs.json ? langs.json() : null;
      case 'yaml': case 'yml':
        return langs.yaml ? langs.yaml() : null;
      case 'rs':
        return langs.rust ? langs.rust() : null;
      case 'cpp': case 'cc': case 'c': case 'h': case 'hpp':
        return langs.cpp ? langs.cpp() : null;
      case 'java':
        return langs.java ? langs.java() : null;
      case 'sql':
        return langs.sql ? langs.sql() : null;
      case 'xml': case 'svg':
        return langs.xml ? langs.xml() : null;
      case 'md': case 'markdown':
        return langs.markdown ? langs.markdown() : null;
      default:
        return null;
    }
  };

  EditorPanel.prototype._fileExt = function () {
    var name = (this.config.name || '').toLowerCase();
    var dot = name.lastIndexOf('.');
    return dot !== -1 ? name.slice(dot + 1) : '';
  };

  EditorPanel.prototype._getLanguageName = function () {
    var names = {
      js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
      jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX',
      py: 'Python', pyw: 'Python',
      rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
      kt: 'Kotlin', swift: 'Swift',
      c: 'C', h: 'C/C++', cpp: 'C++', cc: 'C++', hpp: 'C++',
      css: 'CSS', scss: 'SCSS', less: 'Less', sass: 'Sass',
      html: 'HTML', htm: 'HTML', xml: 'XML', svg: 'SVG',
      php: 'PHP', json: 'JSON',
      yaml: 'YAML', yml: 'YAML', toml: 'TOML',
      sh: 'Shell', bash: 'Bash', zsh: 'Zsh', fish: 'Fish',
      sql: 'SQL', graphql: 'GraphQL', gql: 'GraphQL',
      md: 'Markdown', txt: 'Text',
      r: 'R', lua: 'Lua', pl: 'Perl', scala: 'Scala',
    };
    var ext = this._fileExt();
    return names[ext] || (ext ? ext.toUpperCase() : 'Text');
  };

  EditorPanel.prototype._loadContent = function () {
    var self = this;
    fetch('/api/notes/' + encodeURIComponent(this.id))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (self._destroyed || !self._cmView) return;
        var content = data.content || '';
        self._cmView.dispatch({
          changes: { from: 0, to: self._cmView.state.doc.length, insert: content },
        });
        self._lastSavedContent = content;
        self._dirty = false;
        self._updateStatus('Saved');
        if (self._onDirtyChange) self._onDirtyChange(false);
      })
      .catch(function (err) {
        console.error('[editor-panel] load failed:', err);
        self._updateStatus('Load error');
      });
  };

  EditorPanel.prototype._scheduleAutosave = function () {
    var self = this;
    if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(function () {
      if (self._dirty && !self._saving) self.save();
    }, AUTOSAVE_DELAY);
  };

  EditorPanel.prototype.save = function () {
    if (!this._cmView) return Promise.resolve();
    var content = this._cmView.state.doc.toString();
    if (content === this._lastSavedContent) {
      this._dirty = false;
      if (this._onDirtyChange) this._onDirtyChange(false);
      this._updateStatus('Saved');
      return Promise.resolve();
    }

    var self = this;
    self._saving = true;
    self._updateStatus('Saving…');

    return fetch('/api/notes/' + encodeURIComponent(this.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content }),
    })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        self._saving = false;
        if (result.success) {
          self._lastSavedContent = content;
          self._dirty = false;
          if (self._onDirtyChange) self._onDirtyChange(false);
          self._updateStatus('Saved');
        }
      })
      .catch(function (err) {
        self._saving = false;
        console.error('[editor-panel] save failed:', err);
        self._updateStatus('Save error');
      });
  };

  EditorPanel.prototype._updateStatus = function (text) {
    if (this._statusEl) this._statusEl.textContent = text;
  };

  // --- Panel interface (matches NotePanel / TerminalConnection) ---

  EditorPanel.prototype.attach = function (el) {
    this.mount(el);
  };

  EditorPanel.prototype.detach = function () {
    if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
    if (this._dirty && !this._saving) this.save();
    if (this._wrapper && this._wrapper.parentNode) {
      this._wrapper.parentNode.removeChild(this._wrapper);
    }
  };

  EditorPanel.prototype.destroy = function () {
    this._destroyed = true;
    this.detach();
    if (this._cmView) {
      this._cmView.destroy();
      this._cmView = null;
    }
    this._wrapper = null;
  };

  EditorPanel.prototype.focus = function () {
    if (this._cmView) this._cmView.focus();
  };

  EditorPanel.prototype.moveTo = function (newMount) {
    if (this._wrapper) newMount.appendChild(this._wrapper);
    if (this._cmView) this._cmView.requestMeasure();
  };

  ns.EditorPanel = EditorPanel;

}());
