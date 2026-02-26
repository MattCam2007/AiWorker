(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  var AUTOSAVE_DELAY = 3000;

  function NotePanel(noteConfig) {
    this.id = noteConfig.id;
    this.config = {
      name: noteConfig.name,
      file: noteConfig.file
    };
    this.type = 'note';
    this._easyMDE = null;
    this._element = null;
    this._wrapper = null;
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

    // Create wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'note-panel-wrapper';
    el.appendChild(wrapper);
    this._wrapper = wrapper;

    // Create textarea
    var textarea = document.createElement('textarea');
    wrapper.appendChild(textarea);

    // Initialize EasyMDE
    var self = this;
    this._easyMDE = new EasyMDE({
      element: textarea,
      autofocus: false,
      spellChecker: false,
      status: false,
      toolbar: [
        'bold', 'italic', 'heading', 'quote',
        'unordered-list', 'ordered-list', 'link',
        '|',
        'preview', 'side-by-side',
        '|',
        {
          name: 'save',
          action: function () { self.save(); },
          className: 'fa fa-floppy-o',
          title: 'Save (Ctrl+S)'
        }
      ],
      previewRender: function (plainText) {
        // Use EasyMDE's built-in marked if available
        if (typeof marked !== 'undefined') {
          return marked.parse ? marked.parse(plainText) : marked(plainText);
        }
        // Fallback: escape HTML and convert newlines
        return plainText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      }
    });

    // Track changes for dirty state
    this._easyMDE.codemirror.on('change', function () {
      if (!self._dirty) {
        self._dirty = true;
        if (self._onDirtyChange) self._onDirtyChange(true);
      }
      self._scheduleAutosave();
    });

    // Ctrl+S to save
    if (this._easyMDE.codemirror.addKeyMap) {
      this._easyMDE.codemirror.addKeyMap({
        'Ctrl-S': function () { self.save(); }
      });
    }

    // Fetch content
    this._loadContent();
  };

  NotePanel.prototype._loadContent = function () {
    var self = this;
    fetch('/api/notes/' + this.id)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (self._easyMDE && data.content !== undefined) {
          self._easyMDE.value(data.content);
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
      if (self._dirty && !self._saving) {
        self.save();
      }
    }, AUTOSAVE_DELAY);
  };

  NotePanel.prototype.save = function () {
    if (!this._easyMDE) return Promise.resolve();

    var content = this._easyMDE.value();
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
    if (this._easyMDE) {
      try { this._easyMDE.toTextArea(); } catch (e) {}
      this._easyMDE = null;
    }
    if (this._wrapper && this._wrapper.parentNode) {
      this._wrapper.parentNode.removeChild(this._wrapper);
    }
    this._wrapper = null;
    this._element = null;
  };

  NotePanel.prototype.detach = function () {
    // Save unsaved changes before detaching
    if (this._dirty && this._easyMDE) {
      this.save();
    }
    this.unmount();
  };

  NotePanel.prototype.attach = function (el) {
    this.mount(el);
  };

  NotePanel.prototype.resize = function () {
    if (this._easyMDE && this._easyMDE.codemirror) {
      this._easyMDE.codemirror.refresh();
    }
  };

  NotePanel.prototype.refit = function () {
    this.resize();
  };

  NotePanel.prototype.focus = function () {
    if (this._easyMDE && this._easyMDE.codemirror) {
      this._easyMDE.codemirror.focus();
    }
  };

  NotePanel.prototype.getContent = function () {
    if (!this._easyMDE) return '';
    return this._easyMDE.value();
  };

  NotePanel.prototype.isDirty = function () {
    return this._dirty;
  };

  NotePanel.prototype.isActive = function () {
    return this._easyMDE !== null;
  };

  NotePanel.prototype.destroy = function () {
    this._destroyed = true;
    this.detach();
  };

  NotePanel.prototype.refresh = function () {
    this.resize();
  };

  NotePanel.prototype.moveTo = function (newMount) {
    if (this._wrapper) {
      newMount.appendChild(this._wrapper);
    }
    this._element = newMount;
  };

  ns.NotePanel = NotePanel;
})();
