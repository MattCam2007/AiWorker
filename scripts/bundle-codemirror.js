// Bundle entry point for CodeMirror 6
// This gets built into client/vendor/codemirror6.bundle.js

import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';

import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { php } from '@codemirror/lang-php';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { markdown } from '@codemirror/lang-markdown';

window.CM6 = {
  EditorView,
  EditorState,
  keymap,
  basicSetup,
  oneDark,
  languages: {
    javascript,
    python,
    css,
    html,
    php,
    json,
    yaml,
    rust,
    cpp,
    java,
    sql,
    xml,
    markdown,
  },
};

document.dispatchEvent(new Event('cm6-ready'));
