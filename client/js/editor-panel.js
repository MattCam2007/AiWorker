/* editor-panel.js – CodeMirror 6 based file editor panel
 * Uses Compartments for runtime reconfiguration of themes, vim, minimap, etc.
 * Follows the same interface as TerminalConnection so the layout engine can host it.
 */
(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  var AUTOSAVE_DELAY = 3000;

  // ---------------------------------------------------------------------------
  //  Intelligent autocomplete sources (language-aware keywords & globals)
  // ---------------------------------------------------------------------------

  var JS_KEYWORDS = [
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
    'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof',
    'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'this',
    'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  ];
  var JS_GLOBALS = [
    'Array', 'Boolean', 'console', 'Date', 'document', 'Error', 'fetch',
    'FormData', 'Function', 'globalThis', 'Headers', 'JSON', 'Map', 'Math',
    'Number', 'Object', 'parseInt', 'parseFloat', 'Promise', 'Proxy',
    'Reflect', 'RegExp', 'Request', 'Response', 'Set', 'String', 'Symbol',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'URL', 'URLSearchParams', 'WeakMap', 'WeakSet', 'window',
    'addEventListener', 'removeEventListener', 'querySelector',
    'querySelectorAll', 'getElementById', 'createElement',
    'requestAnimationFrame', 'cancelAnimationFrame',
  ];
  var JS_SNIPPETS = [
    { label: 'function', detail: 'function declaration', apply: 'function name(params) {\n  \n}' },
    { label: 'arrow', detail: '=> arrow function', apply: '(params) => {\n  \n}' },
    { label: 'forof', detail: 'for...of loop', apply: 'for (const item of iterable) {\n  \n}' },
    { label: 'forin', detail: 'for...in loop', apply: 'for (const key in object) {\n  \n}' },
    { label: 'trycatch', detail: 'try/catch block', apply: 'try {\n  \n} catch (err) {\n  \n}' },
    { label: 'ife', detail: 'if/else', apply: 'if (condition) {\n  \n} else {\n  \n}' },
    { label: 'clf', detail: 'console.log()', apply: 'console.log()' },
    { label: 'imp', detail: 'import statement', apply: "import {  } from '';" },
    { label: 'req', detail: 'require()', apply: "const mod = require('');" },
    { label: 'asy', detail: 'async function', apply: 'async function name(params) {\n  \n}' },
    { label: 'prom', detail: 'new Promise', apply: 'new Promise((resolve, reject) => {\n  \n})' },
  ];

  var PY_KEYWORDS = [
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
    'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for',
    'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None',
    'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try',
    'while', 'with', 'yield',
  ];
  var PY_BUILTINS = [
    'abs', 'all', 'any', 'bin', 'bool', 'breakpoint', 'bytes', 'callable',
    'chr', 'classmethod', 'compile', 'complex', 'dict', 'dir', 'divmod',
    'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset',
    'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input',
    'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals',
    'map', 'max', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow',
    'print', 'property', 'range', 'repr', 'reversed', 'round', 'set',
    'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
    'tuple', 'type', 'vars', 'zip',
  ];
  var PY_SNIPPETS = [
    { label: 'def', detail: 'function definition', apply: 'def name(self):\n    ' },
    { label: 'ifmain', detail: 'if __name__ == "__main__"', apply: 'if __name__ == "__main__":\n    ' },
    { label: 'tryex', detail: 'try/except block', apply: 'try:\n    \nexcept Exception as e:\n    ' },
    { label: 'with', detail: 'with statement', apply: "with open('file') as f:\n    " },
    { label: 'cls', detail: 'class definition', apply: 'class Name:\n    def __init__(self):\n        ' },
    { label: 'lcomp', detail: 'list comprehension', apply: '[x for x in iterable]' },
    { label: 'dcomp', detail: 'dict comprehension', apply: '{k: v for k, v in iterable}' },
  ];

  var CSS_PROPS = [
    'align-items', 'align-content', 'align-self', 'animation', 'background',
    'background-color', 'background-image', 'border', 'border-radius',
    'bottom', 'box-shadow', 'box-sizing', 'color', 'cursor', 'display',
    'flex', 'flex-direction', 'flex-wrap', 'float', 'font-family',
    'font-size', 'font-weight', 'gap', 'grid', 'grid-template-columns',
    'grid-template-rows', 'height', 'justify-content', 'left', 'line-height',
    'margin', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top',
    'max-height', 'max-width', 'min-height', 'min-width', 'object-fit',
    'opacity', 'outline', 'overflow', 'overflow-x', 'overflow-y', 'padding',
    'padding-bottom', 'padding-left', 'padding-right', 'padding-top',
    'pointer-events', 'position', 'right', 'text-align', 'text-decoration',
    'text-transform', 'top', 'transform', 'transition', 'visibility',
    'white-space', 'width', 'word-break', 'z-index',
  ];
  var CSS_VALUES = [
    'absolute', 'auto', 'block', 'bold', 'center', 'column', 'contain',
    'cover', 'default', 'ease', 'ease-in', 'ease-in-out', 'ease-out',
    'fixed', 'flex', 'flex-end', 'flex-start', 'grid', 'hidden', 'inherit',
    'initial', 'inline', 'inline-block', 'inline-flex', 'left', 'none',
    'normal', 'nowrap', 'pointer', 'relative', 'right', 'row', 'scroll',
    'space-around', 'space-between', 'space-evenly', 'static', 'sticky',
    'stretch', 'transparent', 'unset', 'visible', 'wrap',
  ];

  /**
   * Build a CM6 completion source for a given language based on file extension.
   * Returns null if no custom completions are available for the language.
   */
  function _buildCompletionSource(fileExt) {
    var keywords, globals, snippets;
    switch (fileExt) {
      case 'js': case 'mjs': case 'cjs': case 'jsx':
      case 'ts': case 'tsx':
        keywords = JS_KEYWORDS;
        globals = JS_GLOBALS;
        snippets = JS_SNIPPETS;
        break;
      case 'py': case 'pyw':
        keywords = PY_KEYWORDS;
        globals = PY_BUILTINS;
        snippets = PY_SNIPPETS;
        break;
      case 'css': case 'scss': case 'less': case 'sass':
        keywords = CSS_PROPS;
        globals = CSS_VALUES;
        snippets = [];
        break;
      default:
        return null;
    }

    // Pre-build the options list once
    var options = [];
    for (var i = 0; i < keywords.length; i++) {
      options.push({ label: keywords[i], type: 'keyword', boost: 1 });
    }
    for (var j = 0; j < globals.length; j++) {
      options.push({ label: globals[j], type: 'variable', boost: 0 });
    }
    for (var k = 0; k < snippets.length; k++) {
      options.push({
        label: snippets[k].label,
        detail: snippets[k].detail,
        apply: snippets[k].apply,
        type: 'text',
        boost: 2,
      });
    }

    return function (context) {
      // Get the word before the cursor
      var word = context.matchBefore(/[\w\-]+/);
      if (!word) return null;
      // Don't complete single characters unless explicitly requested
      if (word.from === word.to && !context.explicit) return null;

      return {
        from: word.from,
        options: options,
        validFor: /^[\w\-]*$/,
      };
    };
  }

  // Theme display names for the settings UI
  var THEME_NAMES = {
    oneDark: 'One Dark',
    dracula: 'Dracula',
    monokai: 'Monokai',
    nord: 'Nord',
    solarizedDark: 'Solarized Dark',
    githubDark: 'GitHub Dark',
    materialDark: 'Material Dark',
    draculaMidnight: 'Dracula Midnight',
    konsole: 'Konsole (Green)',
  };

  // Language display names and associated extensions
  var LANG_INFO = {
    javascript: { name: 'JavaScript', exts: '.js .mjs .cjs .jsx .ts .tsx' },
    python:     { name: 'Python',     exts: '.py .pyw' },
    css:        { name: 'CSS',        exts: '.css .scss .less .sass' },
    html:       { name: 'HTML',       exts: '.html .htm' },
    php:        { name: 'PHP',        exts: '.php' },
    json:       { name: 'JSON',       exts: '.json' },
    yaml:       { name: 'YAML',       exts: '.yaml .yml' },
    rust:       { name: 'Rust',       exts: '.rs' },
    cpp:        { name: 'C/C++',      exts: '.c .h .cpp .cc .hpp' },
    java:       { name: 'Java',       exts: '.java' },
    sql:        { name: 'SQL',        exts: '.sql' },
    xml:        { name: 'XML',        exts: '.xml .svg' },
    markdown:   { name: 'Markdown',   exts: '.md' },
  };

  // Extensions whose files we treat as editable text
  var TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
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
    var noExt = ['dockerfile', 'makefile', 'gemfile', 'rakefile',
      'vagrantfile', 'procfile', 'cmakelists', '.gitignore',
      '.editorconfig', '.env', '.bashrc', '.zshrc'];
    if (noExt.indexOf(lower) !== -1) return true;
    var dotIdx = lower.lastIndexOf('.');
    if (dotIdx === -1) return false;
    var ext = lower.slice(dotIdx + 1);
    return TEXT_EXTENSIONS.has(ext);
  };

  // =========================================================================
  //  EditorPanel constructor
  // =========================================================================

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
    this._vimBadge = null;
    this._undoBtn = null;
    this._redoBtn = null;
    this._dirty = false;
    this._saving = false;
    this._autosaveTimer = null;
    this._lastSavedContent = '';
    this._onDirtyChange = null;
    this._destroyed = false;
    this._settingsUnsub = null;
    this._compartments = {};
    this._settingsPanel = null;
    this._contextMenu = null;
    this._initialLoad = true;
    this._previewEl = null;
    this._previewBtn = null;
    this._previewMode = false;
  }

  EditorPanel.prototype.isDirty = function () { return this._dirty; };
  EditorPanel.prototype.isActive = function () { return !!this._cmView; };
  EditorPanel.prototype.refresh = function () {};
  EditorPanel.prototype.resize = function () {};
  EditorPanel.prototype.refit = function () {
    if (this._cmView) this._cmView.requestMeasure();
  };

  // =========================================================================
  //  Mount – build DOM
  // =========================================================================

  EditorPanel.prototype.mount = function (el) {
    var self = this;
    var wrapper = document.createElement('div');
    wrapper.className = 'ep-wrapper';
    el.appendChild(wrapper);
    this._wrapper = wrapper;

    // --- Status bar ---
    var statusBar = document.createElement('div');
    statusBar.className = 'ep-statusbar';

    // Left group: undo/redo + status text
    var leftGroup = document.createElement('div');
    leftGroup.className = 'ep-status-left';

    var undoBtn = document.createElement('button');
    undoBtn.className = 'ep-history-btn';
    undoBtn.innerHTML = '&#x21B6;';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.disabled = true;
    undoBtn.addEventListener('click', function () { self._doUndo(); });
    this._undoBtn = undoBtn;
    leftGroup.appendChild(undoBtn);

    var redoBtn = document.createElement('button');
    redoBtn.className = 'ep-history-btn';
    redoBtn.innerHTML = '&#x21B7;';
    redoBtn.title = 'Redo (Ctrl+Shift+Z)';
    redoBtn.disabled = true;
    redoBtn.addEventListener('click', function () { self._doRedo(); });
    this._redoBtn = redoBtn;
    leftGroup.appendChild(redoBtn);

    var sep = document.createElement('span');
    sep.className = 'ep-history-sep';
    sep.textContent = '|';
    leftGroup.appendChild(sep);

    var statusText = document.createElement('span');
    statusText.className = 'ep-status-text';
    statusText.textContent = 'Loading\u2026';
    this._statusEl = statusText;
    leftGroup.appendChild(statusText);

    statusBar.appendChild(leftGroup);

    // Right group: vim badge, lang label, gear
    var rightGroup = document.createElement('div');
    rightGroup.className = 'ep-status-right';

    var vimBadge = document.createElement('span');
    vimBadge.className = 'ep-vim-badge';
    vimBadge.textContent = 'VIM';
    vimBadge.title = 'Toggle Vim Mode';
    vimBadge.style.cursor = 'pointer';
    if (ns.editorSettings && ns.editorSettings.get('vimMode')) {
      vimBadge.classList.add('active');
    }
    vimBadge.addEventListener('click', function () {
      if (ns.editorSettings) {
        ns.editorSettings.set('vimMode', !ns.editorSettings.get('vimMode'));
      }
    });
    this._vimBadge = vimBadge;
    rightGroup.appendChild(vimBadge);

    var langLabel = document.createElement('span');
    langLabel.className = 'ep-lang-label';
    langLabel.textContent = this._getLanguageName();
    this._langEl = langLabel;
    rightGroup.appendChild(langLabel);

    if (this._isMarkdown()) {
      var previewBtn = document.createElement('button');
      previewBtn.className = 'ep-preview-btn';
      previewBtn.textContent = 'Preview';
      previewBtn.title = 'Toggle Markdown Preview';
      previewBtn.addEventListener('click', function () { self._togglePreview(); });
      this._previewBtn = previewBtn;
      rightGroup.appendChild(previewBtn);
    }

    var gearBtn = document.createElement('button');
    gearBtn.className = 'ep-settings-btn';
    gearBtn.innerHTML = '&#x2699;';
    gearBtn.title = 'Editor Settings';
    gearBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      self._toggleSettings(gearBtn);
    });
    rightGroup.appendChild(gearBtn);

    statusBar.appendChild(rightGroup);
    wrapper.appendChild(statusBar);

    // --- CodeMirror container ---
    var cmContainer = document.createElement('div');
    cmContainer.className = 'ep-cm-container';
    wrapper.appendChild(cmContainer);
    this._cmContainer = cmContainer;

    // --- Markdown preview pane (hidden by default) ---
    if (this._isMarkdown()) {
      var previewEl = document.createElement('div');
      previewEl.className = 'ep-md-preview';
      wrapper.appendChild(previewEl);
      this._previewEl = previewEl;
      // Start in preview mode for markdown files
      this._previewMode = true;
      this._cmContainer.style.display = 'none';
      if (this._previewBtn) this._previewBtn.classList.add('active');
    }

    this._initCM();
  };

  // =========================================================================
  //  CM6 initialization with Compartments
  // =========================================================================

  EditorPanel.prototype._initCM = function () {
    var self = this;

    if (window.CM6 === undefined) {
      var handler = function () {
        document.removeEventListener('cm6-ready', handler);
        self._initCM();
      };
      document.addEventListener('cm6-ready', handler);
      return;
    }

    if (!window.CM6) {
      this._updateStatus('CodeMirror unavailable');
      return;
    }

    try {
      var cm6 = window.CM6;
      var settings = ns.editorSettings;
      var langExt = this._getLanguageExtension(cm6);

      // Create compartments for runtime reconfiguration
      this._compartments = {
        theme:        new cm6.Compartment(),
        tabSize:      new cm6.Compartment(),
        indentUnit:   new cm6.Compartment(),
        lineWrap:     new cm6.Compartment(),
        vim:          new cm6.Compartment(),
        autocomplete: new cm6.Compartment(),
        minimap:      new cm6.Compartment(),
        language:     new cm6.Compartment(),
        fontSize:     new cm6.Compartment(),
      };

      var comp = this._compartments;
      var themeKey = settings.get('theme');
      var themeExt = cm6.themes[themeKey] || cm6.themes.oneDark;

      var extensions = [
        // Minimal setup (core editing primitives)
        cm6.minimalSetup,

        // Explicit extensions replacing basicSetup
        cm6.lineNumbers(),
        cm6.highlightActiveLineGutter(),
        cm6.highlightSpecialChars(),
        cm6.drawSelection(),
        cm6.dropCursor(),
        cm6.rectangularSelection(),
        cm6.crosshairCursor(),
        cm6.bracketMatching(),
        cm6.closeBrackets(),
        cm6.indentOnInput(),
        cm6.foldGutter(),
        cm6.highlightSelectionMatches(),
        cm6.history(),
        cm6.search(),

        // Keymaps
        cm6.keymap.of(cm6.defaultKeymap),
        cm6.keymap.of(cm6.historyKeymap),
        cm6.keymap.of(cm6.searchKeymap),
        cm6.keymap.of(cm6.foldKeymap),
        cm6.keymap.of(cm6.closeBracketsKeymap),
        cm6.keymap.of(cm6.completionKeymap),
        cm6.keymap.of([cm6.indentWithTab]),

        // Compartmentalized settings
        comp.theme.of(themeExt),
        comp.tabSize.of(cm6.tabSize.of(settings.get('tabSize'))),
        comp.indentUnit.of(cm6.indentUnit.of(
          settings.get('useTabs') ? '\t' : ' '.repeat(settings.get('tabSize'))
        )),
        comp.lineWrap.of(settings.get('lineWrap') ? cm6.lineWrapping : []),
        comp.vim.of(settings.get('vimMode') ? cm6.vim() : []),
        comp.autocomplete.of(
          settings.get('autocomplete')
            ? this._buildAutocompletionExt(cm6)
            : []
        ),
        comp.minimap.of(settings.get('minimap') ? self._createMinimapExt() : []),
        comp.language.of(langExt || []),
        comp.fontSize.of(cm6.EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': {
            fontFamily: 'var(--td-font-terminal)',
            fontSize: settings.get('fontSize') + 'px',
          },
        })),

        // Custom keybindings
        cm6.keymap.of([
          { key: 'Ctrl-s', preventDefault: true, run: function () { self.save(); return true; } },
          { key: 'Cmd-s', preventDefault: true, run: function () { self.save(); return true; } },
        ]),

        // Update listener for dirty state + history indicators
        cm6.EditorView.updateListener.of(function (update) {
          if (update.docChanged && !self._initialLoad) {
            if (!self._dirty) {
              self._dirty = true;
              if (self._onDirtyChange) self._onDirtyChange(true);
            }
            self._updateStatus('Unsaved');
            self._scheduleAutosave();
            self._updatePreview();
          }
          self._updateHistoryButtons(update.state);
        }),

        // Context menu handler
        cm6.EditorView.domEventHandlers({
          contextmenu: function (e) {
            e.preventDefault();
            self._showContextMenu(e.clientX, e.clientY);
            return true;
          },
        }),
      ];

      var state = cm6.EditorState.create({ doc: '', extensions: extensions });
      this._cmView = new cm6.EditorView({ state: state, parent: this._cmContainer });

      // Subscribe to settings changes
      this._settingsUnsub = ns.editorSettings.onChange(function (key, value) {
        self._applySettingChange(key, value);
      });

      this._loadContent();
    } catch (err) {
      console.error('[editor-panel] CM6 init error:', err);
      this._updateStatus('Editor error: ' + err.message);
    }
  };

  // =========================================================================
  //  Apply setting changes via Compartment reconfiguration
  // =========================================================================

  EditorPanel.prototype._applySettingChange = function (key, value) {
    if (!this._cmView) return;
    var cm6 = window.CM6;
    var comp = this._compartments;
    var self = this;
    var effects;

    switch (key) {
      case 'theme':
        var themeExt = cm6.themes[value] || cm6.themes.oneDark;
        effects = comp.theme.reconfigure(themeExt);
        break;
      case 'tabSize':
        effects = comp.tabSize.reconfigure(cm6.tabSize.of(value));
        // Also update indent unit if using spaces
        if (!ns.editorSettings.get('useTabs')) {
          this._cmView.dispatch({
            effects: comp.indentUnit.reconfigure(cm6.indentUnit.of(' '.repeat(value))),
          });
        }
        break;
      case 'useTabs':
        var sz = ns.editorSettings.get('tabSize');
        effects = comp.indentUnit.reconfigure(cm6.indentUnit.of(value ? '\t' : ' '.repeat(sz)));
        break;
      case 'lineWrap':
        effects = comp.lineWrap.reconfigure(value ? cm6.lineWrapping : []);
        break;
      case 'vimMode':
        effects = comp.vim.reconfigure(value ? cm6.vim() : []);
        if (this._vimBadge) {
          this._vimBadge.classList.toggle('active', value);
        }
        break;
      case 'autocomplete':
        effects = comp.autocomplete.reconfigure(
          value ? self._buildAutocompletionExt(cm6) : []
        );
        break;
      case 'minimap':
        effects = comp.minimap.reconfigure(value ? self._createMinimapExt() : []);
        break;
      case 'fontSize':
        effects = comp.fontSize.reconfigure(cm6.EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': {
            fontFamily: 'var(--td-font-terminal)',
            fontSize: value + 'px',
          },
        }));
        break;
    }

    if (effects) {
      this._cmView.dispatch({ effects: effects });
    }
  };

  // =========================================================================
  //  Intelligent autocompletion
  // =========================================================================

  /**
   * Build the autocompletion extension array with language-aware sources,
   * document word completion, and smart configuration.
   */
  EditorPanel.prototype._buildAutocompletionExt = function (cm6) {
    var ext = this._fileExt();
    var sources = [];

    // Language-specific keyword/global/snippet completions
    var langSource = _buildCompletionSource(ext);
    if (langSource) sources.push(langSource);

    // Document word completion as a fallback for all languages
    if (cm6.completeAnyWord) sources.push(cm6.completeAnyWord);

    // If we have custom sources, use override to combine them.
    // We still get language completions by not preventing the default sources
    // from firing — override sources merge with language-provided ones in CM6
    // only when using the override array; but since language data sources are
    // separate, we use override only for our custom ones when there are no
    // language extensions loaded, and languageData.of otherwise.
    var parts = [];

    parts.push(cm6.autocompletion({
      activateOnTyping: true,
      defaultKeymap: true,
      maxRenderedOptions: 30,
      icons: true,
      override: sources.length > 0 ? sources : undefined,
    }));

    return parts;
  };

  // =========================================================================
  //  Minimap helper
  // =========================================================================

  EditorPanel.prototype._createMinimapExt = function () {
    var cm6 = window.CM6;
    if (!cm6.showMinimap) return [];
    try {
      return cm6.showMinimap.compute([], function () {
        return {
          create: function () {
            var dom = document.createElement('div');
            return { dom: dom };
          },
          displayText: 'blocks',
          showOverlay: 'mouse-over',
        };
      });
    } catch (e) {
      console.warn('[editor-panel] minimap init failed:', e);
      return [];
    }
  };

  // =========================================================================
  //  History (undo/redo) UI
  // =========================================================================

  EditorPanel.prototype._updateHistoryButtons = function (state) {
    var cm6 = window.CM6;
    if (!cm6 || !this._undoBtn) return;
    this._undoBtn.disabled = cm6.undoDepth(state) === 0;
    this._redoBtn.disabled = cm6.redoDepth(state) === 0;
  };

  EditorPanel.prototype._doUndo = function () {
    if (this._cmView) {
      window.CM6.undo(this._cmView);
      this._cmView.focus();
    }
  };

  EditorPanel.prototype._doRedo = function () {
    if (this._cmView) {
      window.CM6.redo(this._cmView);
      this._cmView.focus();
    }
  };

  // =========================================================================
  //  Context menu
  // =========================================================================

  EditorPanel.prototype._showContextMenu = function (x, y) {
    this._dismissContextMenu();
    var self = this;
    var view = this._cmView;
    if (!view) return;
    var cm6 = window.CM6;

    var menu = document.createElement('div');
    menu.className = 'ep-context-menu';

    var items = [
      { label: 'Cut', shortcut: 'Ctrl+X', action: function () { document.execCommand('cut'); } },
      { label: 'Copy', shortcut: 'Ctrl+C', action: function () { document.execCommand('copy'); } },
      { label: 'Paste', shortcut: 'Ctrl+V', action: function () {
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(function (text) {
            view.dispatch(view.state.replaceSelection(text));
            view.focus();
          }).catch(function () { document.execCommand('paste'); });
        } else {
          document.execCommand('paste');
        }
      }},
      null, // divider
      { label: 'Select All', shortcut: 'Ctrl+A', action: function () { cm6.selectAll(view); } },
      null,
      { label: 'Find / Replace', shortcut: 'Ctrl+F', action: function () { cm6.openSearchPanel(view); } },
      { label: 'Go to Line', shortcut: 'Ctrl+G', action: function () { cm6.gotoLine(view); } },
      { label: 'Select Next Occurrence', shortcut: 'Ctrl+D', action: function () { cm6.selectNextOccurrence(view); } },
      null,
      { label: 'Undo', shortcut: 'Ctrl+Z', action: function () { cm6.undo(view); } },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: function () { cm6.redo(view); } },
      null,
      { label: 'Toggle Comment', shortcut: 'Ctrl+/', action: function () { cm6.toggleComment(view); } },
      { label: 'Duplicate Line', action: function () { self._duplicateLine(); } },
      { label: 'Sort Lines (Asc)', action: function () { self._sortLines(false); } },
      { label: 'Sort Lines (Desc)', action: function () { self._sortLines(true); } },
      null,
      { label: 'Transform', submenu: [
        { label: 'UPPERCASE', action: function () { self._transformCase('upper'); } },
        { label: 'lowercase', action: function () { self._transformCase('lower'); } },
        { label: 'Title Case', action: function () { self._transformCase('title'); } },
      ]},
      null,
      { label: 'Fold All', action: function () { cm6.foldAll(view); } },
      { label: 'Unfold All', action: function () { cm6.unfoldAll(view); } },
      null,
      { label: 'Toggle Word Wrap', action: function () {
        var s = ns.editorSettings;
        s.set('lineWrap', !s.get('lineWrap'));
      }},
      { label: 'Toggle Minimap', action: function () {
        var s = ns.editorSettings;
        s.set('minimap', !s.get('minimap'));
      }},
    ];

    this._buildMenuItems(menu, items);

    document.body.appendChild(menu);
    this._contextMenu = menu;

    // Position: keep within viewport
    var rect = menu.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    if (x + rect.width > vw) x = vw - rect.width - 4;
    if (y + rect.height > vh) y = vh - rect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Dismiss on click outside or escape
    var dismiss = function (e) {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      // Don't dismiss when clicking inside the menu – let the item's click handler fire
      if (e.type === 'mousedown' && menu.contains(e.target)) return;
      self._dismissContextMenu();
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
    };
    setTimeout(function () {
      document.addEventListener('mousedown', dismiss, true);
      document.addEventListener('keydown', dismiss, true);
    }, 0);
  };

  EditorPanel.prototype._buildMenuItems = function (container, items) {
    var self = this;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item === null) {
        var div = document.createElement('div');
        div.className = 'ep-ctx-divider';
        container.appendChild(div);
        continue;
      }

      if (item.submenu) {
        var sub = document.createElement('div');
        sub.className = 'ep-ctx-submenu';
        var trigger = document.createElement('div');
        trigger.className = 'ep-ctx-item';
        trigger.innerHTML = '<span class="ep-ctx-item-label">' + item.label + '</span>';
        sub.appendChild(trigger);
        var subItems = document.createElement('div');
        subItems.className = 'ep-ctx-submenu-items';
        self._buildMenuItems(subItems, item.submenu);
        sub.appendChild(subItems);
        container.appendChild(sub);
        continue;
      }

      var el = document.createElement('div');
      el.className = 'ep-ctx-item';
      var labelSpan = '<span class="ep-ctx-item-label">' + item.label + '</span>';
      var shortcutSpan = item.shortcut
        ? '<span class="ep-ctx-item-shortcut">' + item.shortcut + '</span>'
        : '';
      el.innerHTML = labelSpan + shortcutSpan;
      (function (action) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          self._dismissContextMenu();
          action();
        });
      })(item.action);
      container.appendChild(el);
    }
  };

  EditorPanel.prototype._dismissContextMenu = function () {
    if (this._contextMenu && this._contextMenu.parentNode) {
      this._contextMenu.parentNode.removeChild(this._contextMenu);
    }
    this._contextMenu = null;
  };

  // =========================================================================
  //  Context menu actions
  // =========================================================================

  EditorPanel.prototype._duplicateLine = function () {
    var view = this._cmView;
    if (!view) return;
    var state = view.state;
    var range = state.selection.main;
    var line = state.doc.lineAt(range.head);
    var text = state.sliceDoc(line.from, line.to);
    view.dispatch({
      changes: { from: line.to, insert: '\n' + text },
      selection: { anchor: line.to + 1 + text.length },
    });
    view.focus();
  };

  EditorPanel.prototype._sortLines = function (desc) {
    var view = this._cmView;
    if (!view) return;
    var state = view.state;
    var range = state.selection.main;
    var from, to;
    if (range.empty) {
      from = 0;
      to = state.doc.length;
    } else {
      var startLine = state.doc.lineAt(range.from);
      var endLine = state.doc.lineAt(range.to);
      from = startLine.from;
      to = endLine.to;
    }
    var text = state.sliceDoc(from, to);
    var lines = text.split('\n');
    lines.sort(function (a, b) {
      var cmp = a.localeCompare(b);
      return desc ? -cmp : cmp;
    });
    view.dispatch({ changes: { from: from, to: to, insert: lines.join('\n') } });
    view.focus();
  };

  EditorPanel.prototype._transformCase = function (mode) {
    var view = this._cmView;
    if (!view) return;
    var state = view.state;
    var range = state.selection.main;
    if (range.empty) return;
    var text = state.sliceDoc(range.from, range.to);
    var result;
    switch (mode) {
      case 'upper': result = text.toUpperCase(); break;
      case 'lower': result = text.toLowerCase(); break;
      case 'title':
        result = text.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        break;
      default: return;
    }
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: result },
      selection: { anchor: range.from, head: range.from + result.length },
    });
    view.focus();
  };

  // =========================================================================
  //  Settings panel
  // =========================================================================

  EditorPanel.prototype._toggleSettings = function (anchorEl) {
    if (this._settingsPanel) {
      this._dismissSettings();
      return;
    }
    this._showSettings(anchorEl);
  };

  EditorPanel.prototype._showSettings = function (anchorEl) {
    var self = this;
    var settings = ns.editorSettings;
    if (!settings) return;

    var panel = document.createElement('div');
    panel.className = 'ep-settings-panel';

    // Header
    var header = document.createElement('div');
    header.className = 'ep-settings-header';
    header.innerHTML = '<span>Editor Settings</span>';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'ep-settings-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () { self._dismissSettings(); });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // --- Theme ---
    panel.appendChild(this._createSelectRow('Theme', 'theme', THEME_NAMES));

    // --- Tab Size ---
    panel.appendChild(this._createButtonGroupRow('Tab Size', 'tabSize', [
      { label: '2', value: 2 },
      { label: '4', value: 4 },
      { label: '8', value: 8 },
    ]));

    // --- Indent ---
    panel.appendChild(this._createButtonGroupRow('Indent', 'useTabs', [
      { label: 'Spaces', value: false },
      { label: 'Tabs', value: true },
    ]));

    // --- Word Wrap ---
    panel.appendChild(this._createToggleRow('Word Wrap', 'lineWrap'));

    // --- Vim Mode ---
    panel.appendChild(this._createToggleRow('Vim Mode', 'vimMode'));

    // --- Autocomplete ---
    panel.appendChild(this._createToggleRow('Autocomplete', 'autocomplete'));

    // --- Minimap ---
    panel.appendChild(this._createToggleRow('Minimap', 'minimap'));

    // --- Font Size ---
    panel.appendChild(this._createStepperRow('Font Size', 'fontSize', 10, 24));

    // --- Languages section ---
    var langSection = document.createElement('div');
    langSection.className = 'ep-languages-section';
    var langTitle = document.createElement('div');
    langTitle.className = 'ep-languages-title';
    langTitle.textContent = 'Loaded Languages';
    langSection.appendChild(langTitle);
    var langList = document.createElement('div');
    langList.className = 'ep-languages-list';
    var langKeys = Object.keys(LANG_INFO);
    for (var i = 0; i < langKeys.length; i++) {
      var info = LANG_INFO[langKeys[i]];
      var tag = document.createElement('span');
      tag.className = 'ep-lang-tag';
      tag.textContent = info.name;
      tag.title = info.exts;
      langList.appendChild(tag);
    }
    langSection.appendChild(langList);
    panel.appendChild(langSection);

    document.body.appendChild(panel);
    this._settingsPanel = panel;

    // Position near the gear button
    var btnRect = anchorEl.getBoundingClientRect();
    var pW = 320;
    var left = btnRect.right - pW;
    var top = btnRect.top - panel.offsetHeight - 4;
    if (top < 4) top = btnRect.bottom + 4;
    if (left < 4) left = 4;
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';

    // Dismiss on outside click
    var dismiss = function (e) {
      if (panel.contains(e.target) || e.target === anchorEl) return;
      self._dismissSettings();
      document.removeEventListener('mousedown', dismiss, true);
    };
    setTimeout(function () {
      document.addEventListener('mousedown', dismiss, true);
    }, 0);
  };

  EditorPanel.prototype._dismissSettings = function () {
    if (this._settingsPanel && this._settingsPanel.parentNode) {
      this._settingsPanel.parentNode.removeChild(this._settingsPanel);
    }
    this._settingsPanel = null;
  };

  // --- Settings UI helpers ---

  EditorPanel.prototype._createToggleRow = function (label, key) {
    var settings = ns.editorSettings;
    var row = document.createElement('div');
    row.className = 'ep-setting-row';
    row.innerHTML = '<span class="ep-setting-label">' + label + '</span>';

    var toggle = document.createElement('label');
    toggle.className = 'ep-toggle';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = settings.get(key);
    input.addEventListener('change', function () {
      settings.set(key, input.checked);
    });
    var track = document.createElement('span');
    track.className = 'ep-toggle-track';
    var thumb = document.createElement('span');
    thumb.className = 'ep-toggle-thumb';
    toggle.appendChild(input);
    toggle.appendChild(track);
    toggle.appendChild(thumb);

    var control = document.createElement('div');
    control.className = 'ep-setting-control';
    control.appendChild(toggle);
    row.appendChild(control);
    return row;
  };

  EditorPanel.prototype._createButtonGroupRow = function (label, key, options) {
    var settings = ns.editorSettings;
    var row = document.createElement('div');
    row.className = 'ep-setting-row';
    row.innerHTML = '<span class="ep-setting-label">' + label + '</span>';

    var group = document.createElement('div');
    group.className = 'ep-btn-group';
    var currentVal = settings.get(key);

    for (var i = 0; i < options.length; i++) {
      (function (opt) {
        var btn = document.createElement('button');
        btn.textContent = opt.label;
        if (currentVal === opt.value) btn.classList.add('active');
        btn.addEventListener('click', function () {
          var siblings = group.querySelectorAll('button');
          for (var j = 0; j < siblings.length; j++) siblings[j].classList.remove('active');
          btn.classList.add('active');
          settings.set(key, opt.value);
        });
        group.appendChild(btn);
      })(options[i]);
    }

    var control = document.createElement('div');
    control.className = 'ep-setting-control';
    control.appendChild(group);
    row.appendChild(control);
    return row;
  };

  EditorPanel.prototype._createSelectRow = function (label, key, optionMap) {
    var settings = ns.editorSettings;
    var row = document.createElement('div');
    row.className = 'ep-setting-row';
    row.innerHTML = '<span class="ep-setting-label">' + label + '</span>';

    var select = document.createElement('select');
    select.className = 'ep-select';
    var currentVal = settings.get(key);
    var keys = Object.keys(optionMap);
    for (var i = 0; i < keys.length; i++) {
      var opt = document.createElement('option');
      opt.value = keys[i];
      opt.textContent = optionMap[keys[i]];
      if (keys[i] === currentVal) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', function () {
      settings.set(key, select.value);
    });

    var control = document.createElement('div');
    control.className = 'ep-setting-control';
    control.appendChild(select);
    row.appendChild(control);
    return row;
  };

  EditorPanel.prototype._createStepperRow = function (label, key, min, max) {
    var settings = ns.editorSettings;
    var row = document.createElement('div');
    row.className = 'ep-setting-row';
    row.innerHTML = '<span class="ep-setting-label">' + label + '</span>';

    var stepper = document.createElement('div');
    stepper.className = 'ep-stepper';

    var minusBtn = document.createElement('button');
    minusBtn.textContent = '\u2212';
    var valueSpan = document.createElement('span');
    valueSpan.textContent = settings.get(key);
    var plusBtn = document.createElement('button');
    plusBtn.textContent = '+';

    minusBtn.addEventListener('click', function () {
      var v = settings.get(key);
      if (v > min) {
        settings.set(key, v - 1);
        valueSpan.textContent = v - 1;
      }
    });
    plusBtn.addEventListener('click', function () {
      var v = settings.get(key);
      if (v < max) {
        settings.set(key, v + 1);
        valueSpan.textContent = v + 1;
      }
    });

    stepper.appendChild(minusBtn);
    stepper.appendChild(valueSpan);
    stepper.appendChild(plusBtn);

    var control = document.createElement('div');
    control.className = 'ep-setting-control';
    control.appendChild(stepper);
    row.appendChild(control);
    return row;
  };

  // =========================================================================
  //  Language support
  // =========================================================================

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

  EditorPanel.prototype._isMarkdown = function () {
    var ext = this._fileExt();
    return ext === 'md' || ext === 'markdown';
  };

  EditorPanel.prototype._togglePreview = function () {
    this._previewMode = !this._previewMode;
    if (this._previewMode) {
      this._cmContainer.style.display = 'none';
      if (this._previewEl) {
        this._previewEl.style.display = '';
        this._updatePreview();
      }
      if (this._previewBtn) this._previewBtn.classList.add('active');
    } else {
      this._cmContainer.style.display = '';
      if (this._previewEl) this._previewEl.style.display = 'none';
      if (this._previewBtn) this._previewBtn.classList.remove('active');
      if (this._cmView) this._cmView.focus();
    }
  };

  EditorPanel.prototype._updatePreview = function () {
    if (!this._previewMode || !this._previewEl || !this._cmView) return;
    var md = this._cmView.state.doc.toString();
    this._previewEl.innerHTML = this._renderMarkdown(md);
  };

  EditorPanel.prototype._renderMarkdown = function (md) {
    function esc(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function safeHref(href) {
      return /^javascript:/i.test(href.trim()) ? '#' : href;
    }
    function inline(s) {
      // Split on inline code to preserve it
      var result = '';
      var codeRe = /`([^`\n]+)`/g;
      var last = 0;
      var m;
      while ((m = codeRe.exec(s)) !== null) {
        result += applyInline(s.slice(last, m.index));
        result += '<code>' + esc(m[1]) + '</code>';
        last = m.index + m[0].length;
      }
      result += applyInline(s.slice(last));
      return result;
    }
    function applyInline(s) {
      // Bold+italic
      s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
      s = s.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
      // Bold
      s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
      // Italic
      s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
      s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
      // Images before links
      s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, src) {
        return '<img alt="' + esc(alt) + '" src="' + esc(src) + '" style="max-width:100%">';
      });
      // Links
      s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, href) {
        return '<a href="' + esc(safeHref(href)) + '" target="_blank" rel="noopener">' + text + '</a>';
      });
      return s;
    }

    var lines = md.split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // Blank line
      if (line.trim() === '') { i++; continue; }

      // Fenced code block
      var fenceM = line.match(/^(`{3,}|~{3,})(\w*)$/);
      if (fenceM) {
        var fence = fenceM[1];
        var lang = fenceM[2];
        var codeLines = [];
        i++;
        while (i < lines.length && !lines[i].startsWith(fence)) {
          codeLines.push(esc(lines[i]));
          i++;
        }
        i++; // closing fence
        out.push('<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + codeLines.join('\n') + '</code></pre>');
        continue;
      }

      // ATX heading
      var hM = line.match(/^(#{1,6})\s+(.*)/);
      if (hM) {
        var lvl = hM[1].length;
        out.push('<h' + lvl + '>' + inline(hM[2]) + '</h' + lvl + '>');
        i++; continue;
      }

      // Horizontal rule
      if (line.match(/^\s*([-*_])\s*\1\s*\1[\s\1]*$/)) {
        out.push('<hr>'); i++; continue;
      }

      // Blockquote
      if (line.match(/^>\s?/)) {
        var qLines = [];
        while (i < lines.length && lines[i].match(/^>\s?/)) {
          qLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + qLines.map(inline).join('<br>') + '</blockquote>');
        continue;
      }

      // Unordered list
      if (line.match(/^[\s]*[-*+]\s+/)) {
        var ulItems = [];
        while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s+/)) {
          ulItems.push('<li>' + inline(lines[i].replace(/^[\s]*[-*+]\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ul>' + ulItems.join('') + '</ul>');
        continue;
      }

      // Ordered list
      if (line.match(/^[\s]*\d+\.\s+/)) {
        var olItems = [];
        while (i < lines.length && lines[i].match(/^[\s]*\d+\.\s+/)) {
          olItems.push('<li>' + inline(lines[i].replace(/^[\s]*\d+\.\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ol>' + olItems.join('') + '</ol>');
        continue;
      }

      // Paragraph: collect until blank line or block element
      var pLines = [];
      while (i < lines.length) {
        var pl = lines[i];
        if (pl.trim() === '') break;
        if (pl.match(/^#{1,6}\s/) || pl.match(/^(`{3,}|~{3,})/) || pl.match(/^>\s?/) ||
            pl.match(/^[\s]*[-*+]\s+/) || pl.match(/^[\s]*\d+\.\s+/) ||
            pl.match(/^\s*([-*_])\s*\1\s*\1[\s\1]*$/)) break;
        pLines.push(pl);
        i++;
      }
      if (pLines.length) out.push('<p>' + pLines.map(inline).join('<br>') + '</p>');
    }

    return out.join('\n');
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

  // =========================================================================
  //  Content loading and saving
  // =========================================================================

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
        self._initialLoad = false;
        self._updateStatus('Saved');
        if (self._onDirtyChange) self._onDirtyChange(false);
        self._updatePreview();
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
    self._updateStatus('Saving\u2026');

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

  // =========================================================================
  //  Panel interface (matches TerminalConnection)
  // =========================================================================

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
    if (this._settingsUnsub) this._settingsUnsub();
    this._dismissSettings();
    this._dismissContextMenu();
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
