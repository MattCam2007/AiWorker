// Bundle entry point for CodeMirror 6
// Built with esbuild into client/vendor/codemirror6.bundle.js

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter,
  drawSelection, rectangularSelection, crosshairCursor,
  highlightSpecialChars, dropCursor
} from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { minimalSetup } from 'codemirror';

// ---------------------------------------------------------------------------
// History + Commands
// ---------------------------------------------------------------------------
import {
  history, historyKeymap, undo, redo, undoDepth, redoDepth,
  toggleComment, indentWithTab, indentMore, indentLess, selectAll,
  cursorLineUp, cursorLineDown, defaultKeymap
} from '@codemirror/commands';

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
import {
  search, searchKeymap, openSearchPanel, gotoLine,
  selectNextOccurrence, highlightSelectionMatches
} from '@codemirror/search';

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------
import {
  autocompletion, completionKeymap, closeBrackets,
  closeBracketsKeymap, completeAnyWord
} from '@codemirror/autocomplete';

// ---------------------------------------------------------------------------
// Language support
// ---------------------------------------------------------------------------
import {
  indentUnit, foldAll, unfoldAll, foldKeymap, foldGutter,
  indentOnInput, bracketMatching, syntaxHighlighting,
  HighlightStyle, defaultHighlightStyle
} from '@codemirror/language';
import { tags } from '@lezer/highlight';

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------
import { oneDark } from '@codemirror/theme-one-dark';

// ---------------------------------------------------------------------------
// Vim
// ---------------------------------------------------------------------------
import { vim } from '@replit/codemirror-vim';

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------
import { showMinimap } from '@replit/codemirror-minimap';

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------
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


// ===========================================================================
//  Theme definitions
// ===========================================================================
// Each theme is an array of two extensions:
//   [EditorView.theme({...}), syntaxHighlighting(HighlightStyle.define([...]))]
// oneDark uses the official package directly.

// ---------------------------------------------------------------------------
// Dracula
// ---------------------------------------------------------------------------
const draculaTheme = EditorView.theme({
  '&': { backgroundColor: '#282a36', color: '#f8f8f2' },
  '.cm-content': { caretColor: '#f8f8f0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f8f8f0' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#44475a' },
  '.cm-panels': { backgroundColor: '#21222c', color: '#f8f8f2' },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid #191a21' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid #191a21' },
  '.cm-searchMatch': { backgroundColor: '#72593080', outline: '1px solid #725930' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#44475a' },
  '.cm-activeLine': { backgroundColor: '#44475a40' },
  '.cm-selectionMatch': { backgroundColor: '#44475a80' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#44475a', outline: '1px solid #f8f8f266' },
  '.cm-gutters': { backgroundColor: '#282a36', color: '#6272a4', borderRight: '1px solid #191a21' },
  '.cm-activeLineGutter': { backgroundColor: '#44475a40', color: '#f8f8f2' },
  '.cm-foldPlaceholder': { backgroundColor: '#44475a', border: 'none', color: '#6272a4' },
  '.cm-tooltip': { border: 'none', backgroundColor: '#21222c' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#21222c', borderBottomColor: '#21222c' },
  '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: '#44475a', color: '#f8f8f2' } },
  '.cm-line': { padding: '0 2px 0 6px' },
}, { dark: true });

const draculaHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#ff79c6' },
  { tag: tags.string, color: '#f1fa8c' },
  { tag: tags.number, color: '#bd93f9' },
  { tag: tags.bool, color: '#bd93f9' },
  { tag: tags.null, color: '#bd93f9' },
  { tag: tags.comment, color: '#6272a4', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#6272a4', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#6272a4', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#f8f8f2' },
  { tag: tags.definition(tags.variableName), color: '#50fa7b' },
  { tag: tags.function(tags.variableName), color: '#50fa7b' },
  { tag: tags.propertyName, color: '#66d9ef' },
  { tag: tags.definition(tags.propertyName), color: '#66d9ef' },
  { tag: tags.typeName, color: '#8be9fd', fontStyle: 'italic' },
  { tag: tags.className, color: '#8be9fd', fontStyle: 'italic' },
  { tag: tags.operator, color: '#ff79c6' },
  { tag: tags.punctuation, color: '#f8f8f2' },
  { tag: tags.meta, color: '#f8f8f2' },
  { tag: tags.regexp, color: '#ff5555' },
  { tag: tags.escape, color: '#ff79c6' },
  { tag: tags.heading, color: '#bd93f9', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold', color: '#ffb86c' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#f1fa8c' },
  { tag: tags.tagName, color: '#ff79c6' },
  { tag: tags.attributeName, color: '#50fa7b' },
  { tag: tags.attributeValue, color: '#f1fa8c' },
]);

const dracula = [draculaTheme, syntaxHighlighting(draculaHighlight)];

// ---------------------------------------------------------------------------
// Monokai
// ---------------------------------------------------------------------------
const monokaiTheme = EditorView.theme({
  '&': { backgroundColor: '#272822', color: '#f8f8f2' },
  '.cm-content': { caretColor: '#f8f8f0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f8f8f0' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#49483e' },
  '.cm-panels': { backgroundColor: '#1e1f1c', color: '#f8f8f2' },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid #1e1f1c' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid #1e1f1c' },
  '.cm-searchMatch': { backgroundColor: '#72593080', outline: '1px solid #725930' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#49483e' },
  '.cm-activeLine': { backgroundColor: '#3e3d3240' },
  '.cm-selectionMatch': { backgroundColor: '#49483e80' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#49483e', outline: '1px solid #f8f8f266' },
  '.cm-gutters': { backgroundColor: '#272822', color: '#75715e', borderRight: '1px solid #1e1f1c' },
  '.cm-activeLineGutter': { backgroundColor: '#3e3d3240', color: '#f8f8f2' },
  '.cm-foldPlaceholder': { backgroundColor: '#49483e', border: 'none', color: '#75715e' },
  '.cm-tooltip': { border: 'none', backgroundColor: '#1e1f1c' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#1e1f1c', borderBottomColor: '#1e1f1c' },
  '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: '#49483e', color: '#f8f8f2' } },
  '.cm-line': { padding: '0 2px 0 6px' },
}, { dark: true });

const monokaiHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#f92672' },
  { tag: tags.string, color: '#e6db74' },
  { tag: tags.number, color: '#ae81ff' },
  { tag: tags.bool, color: '#ae81ff' },
  { tag: tags.null, color: '#ae81ff' },
  { tag: tags.comment, color: '#75715e', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#75715e', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#75715e', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#f8f8f2' },
  { tag: tags.definition(tags.variableName), color: '#a6e22e' },
  { tag: tags.function(tags.variableName), color: '#a6e22e' },
  { tag: tags.propertyName, color: '#66d9ef' },
  { tag: tags.definition(tags.propertyName), color: '#66d9ef' },
  { tag: tags.typeName, color: '#66d9ef', fontStyle: 'italic' },
  { tag: tags.className, color: '#a6e22e', textDecoration: 'underline' },
  { tag: tags.operator, color: '#f92672' },
  { tag: tags.punctuation, color: '#f8f8f2' },
  { tag: tags.meta, color: '#f8f8f2' },
  { tag: tags.regexp, color: '#e6db74' },
  { tag: tags.escape, color: '#ae81ff' },
  { tag: tags.heading, color: '#a6e22e', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold', color: '#fd971f' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#e6db74' },
  { tag: tags.tagName, color: '#f92672' },
  { tag: tags.attributeName, color: '#a6e22e' },
  { tag: tags.attributeValue, color: '#e6db74' },
]);

const monokai = [monokaiTheme, syntaxHighlighting(monokaiHighlight)];

// ---------------------------------------------------------------------------
// Nord
// ---------------------------------------------------------------------------
const nordTheme = EditorView.theme({
  '&': { backgroundColor: '#2e3440', color: '#d8dee9' },
  '.cm-content': { caretColor: '#d8dee9' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#d8dee9' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#434c5e' },
  '.cm-panels': { backgroundColor: '#242933', color: '#d8dee9' },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid #1d2128' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid #1d2128' },
  '.cm-searchMatch': { backgroundColor: '#88c0d033', outline: '1px solid #88c0d066' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#434c5e' },
  '.cm-activeLine': { backgroundColor: '#3b425240' },
  '.cm-selectionMatch': { backgroundColor: '#434c5e80' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#434c5e', outline: '1px solid #88c0d066' },
  '.cm-gutters': { backgroundColor: '#2e3440', color: '#616e88', borderRight: '1px solid #3b4252' },
  '.cm-activeLineGutter': { backgroundColor: '#3b425240', color: '#d8dee9' },
  '.cm-foldPlaceholder': { backgroundColor: '#434c5e', border: 'none', color: '#616e88' },
  '.cm-tooltip': { border: 'none', backgroundColor: '#3b4252' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#3b4252', borderBottomColor: '#3b4252' },
  '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: '#434c5e', color: '#d8dee9' } },
  '.cm-line': { padding: '0 2px 0 6px' },
}, { dark: true });

const nordHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#81a1c1' },
  { tag: tags.string, color: '#a3be8c' },
  { tag: tags.number, color: '#b48ead' },
  { tag: tags.bool, color: '#81a1c1' },
  { tag: tags.null, color: '#81a1c1' },
  { tag: tags.comment, color: '#616e88', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#616e88', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#616e88', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#d8dee9' },
  { tag: tags.definition(tags.variableName), color: '#88c0d0' },
  { tag: tags.function(tags.variableName), color: '#88c0d0' },
  { tag: tags.propertyName, color: '#88c0d0' },
  { tag: tags.definition(tags.propertyName), color: '#88c0d0' },
  { tag: tags.typeName, color: '#8fbcbb' },
  { tag: tags.className, color: '#8fbcbb' },
  { tag: tags.operator, color: '#81a1c1' },
  { tag: tags.punctuation, color: '#eceff4' },
  { tag: tags.meta, color: '#d08770' },
  { tag: tags.regexp, color: '#ebcb8b' },
  { tag: tags.escape, color: '#d08770' },
  { tag: tags.heading, color: '#88c0d0', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold', color: '#81a1c1' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#a3be8c' },
  { tag: tags.tagName, color: '#81a1c1' },
  { tag: tags.attributeName, color: '#8fbcbb' },
  { tag: tags.attributeValue, color: '#a3be8c' },
]);

const nord = [nordTheme, syntaxHighlighting(nordHighlight)];

// ---------------------------------------------------------------------------
// Solarized Dark
// ---------------------------------------------------------------------------
const solarizedDarkTheme = EditorView.theme({
  '&': { backgroundColor: '#002b36', color: '#839496' },
  '.cm-content': { caretColor: '#839496' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#839496' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#073642' },
  '.cm-panels': { backgroundColor: '#00212b', color: '#839496' },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid #001e26' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid #001e26' },
  '.cm-searchMatch': { backgroundColor: '#b5890033', outline: '1px solid #b5890066' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#073642' },
  '.cm-activeLine': { backgroundColor: '#07364240' },
  '.cm-selectionMatch': { backgroundColor: '#07364280' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#073642', outline: '1px solid #93a1a166' },
  '.cm-gutters': { backgroundColor: '#002b36', color: '#586e75', borderRight: '1px solid #073642' },
  '.cm-activeLineGutter': { backgroundColor: '#07364240', color: '#93a1a1' },
  '.cm-foldPlaceholder': { backgroundColor: '#073642', border: 'none', color: '#586e75' },
  '.cm-tooltip': { border: 'none', backgroundColor: '#073642' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#073642', borderBottomColor: '#073642' },
  '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: '#073642', color: '#93a1a1' } },
  '.cm-line': { padding: '0 2px 0 6px' },
}, { dark: true });

const solarizedDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#859900' },
  { tag: tags.string, color: '#2aa198' },
  { tag: tags.number, color: '#d33682' },
  { tag: tags.bool, color: '#cb4b16' },
  { tag: tags.null, color: '#cb4b16' },
  { tag: tags.comment, color: '#586e75', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#586e75', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#586e75', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#839496' },
  { tag: tags.definition(tags.variableName), color: '#268bd2' },
  { tag: tags.function(tags.variableName), color: '#268bd2' },
  { tag: tags.propertyName, color: '#268bd2' },
  { tag: tags.definition(tags.propertyName), color: '#268bd2' },
  { tag: tags.typeName, color: '#b58900' },
  { tag: tags.className, color: '#b58900' },
  { tag: tags.operator, color: '#859900' },
  { tag: tags.punctuation, color: '#839496' },
  { tag: tags.meta, color: '#cb4b16' },
  { tag: tags.regexp, color: '#dc322f' },
  { tag: tags.escape, color: '#cb4b16' },
  { tag: tags.heading, color: '#b58900', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold', color: '#cb4b16' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#6c71c4' },
  { tag: tags.tagName, color: '#268bd2' },
  { tag: tags.attributeName, color: '#93a1a1' },
  { tag: tags.attributeValue, color: '#2aa198' },
]);

const solarizedDark = [solarizedDarkTheme, syntaxHighlighting(solarizedDarkHighlight)];

// ---------------------------------------------------------------------------
// GitHub Dark
// ---------------------------------------------------------------------------
const githubDarkTheme = EditorView.theme({
  '&': { backgroundColor: '#0d1117', color: '#c9d1d9' },
  '.cm-content': { caretColor: '#c9d1d9' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#c9d1d9' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#163d6180' },
  '.cm-panels': { backgroundColor: '#010409', color: '#c9d1d9' },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid #21262d' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid #21262d' },
  '.cm-searchMatch': { backgroundColor: '#ffa65733', outline: '1px solid #ffa65766' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#163d6180' },
  '.cm-activeLine': { backgroundColor: '#161b2240' },
  '.cm-selectionMatch': { backgroundColor: '#163d6140' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#163d61', outline: '1px solid #c9d1d933' },
  '.cm-gutters': { backgroundColor: '#0d1117', color: '#8b949e', borderRight: '1px solid #21262d' },
  '.cm-activeLineGutter': { backgroundColor: '#161b2240', color: '#c9d1d9' },
  '.cm-foldPlaceholder': { backgroundColor: '#21262d', border: 'none', color: '#8b949e' },
  '.cm-tooltip': { border: '1px solid #30363d', backgroundColor: '#161b22' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#161b22', borderBottomColor: '#161b22' },
  '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: '#163d61', color: '#c9d1d9' } },
  '.cm-line': { padding: '0 2px 0 6px' },
}, { dark: true });

const githubDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#ff7b72' },
  { tag: tags.string, color: '#a5d6ff' },
  { tag: tags.number, color: '#79c0ff' },
  { tag: tags.bool, color: '#79c0ff' },
  { tag: tags.null, color: '#79c0ff' },
  { tag: tags.comment, color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#c9d1d9' },
  { tag: tags.definition(tags.variableName), color: '#ffa657' },
  { tag: tags.function(tags.variableName), color: '#d2a8ff' },
  { tag: tags.propertyName, color: '#79c0ff' },
  { tag: tags.definition(tags.propertyName), color: '#79c0ff' },
  { tag: tags.typeName, color: '#ffa657' },
  { tag: tags.className, color: '#ffa657' },
  { tag: tags.operator, color: '#ff7b72' },
  { tag: tags.punctuation, color: '#c9d1d9' },
  { tag: tags.meta, color: '#79c0ff' },
  { tag: tags.regexp, color: '#7ee787' },
  { tag: tags.escape, color: '#79c0ff' },
  { tag: tags.heading, color: '#79c0ff', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold', color: '#c9d1d9' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#c9d1d9' },
  { tag: tags.tagName, color: '#7ee787' },
  { tag: tags.attributeName, color: '#79c0ff' },
  { tag: tags.attributeValue, color: '#a5d6ff' },
]);

const githubDark = [githubDarkTheme, syntaxHighlighting(githubDarkHighlight)];

// ---------------------------------------------------------------------------
// Material Dark
// ---------------------------------------------------------------------------
const materialDarkTheme = EditorView.theme({
  '&': { backgroundColor: '#212121', color: '#eeffff' },
  '.cm-content': { caretColor: '#ffcc00' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ffcc00' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#3f3f3f' },
  '.cm-panels': { backgroundColor: '#1a1a1a', color: '#eeffff' },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid #111111' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid #111111' },
  '.cm-searchMatch': { backgroundColor: '#ffcb6b33', outline: '1px solid #ffcb6b66' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#3f3f3f' },
  '.cm-activeLine': { backgroundColor: '#2c2c2c40' },
  '.cm-selectionMatch': { backgroundColor: '#3f3f3f80' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#3f3f3f', outline: '1px solid #eeffff33' },
  '.cm-gutters': { backgroundColor: '#212121', color: '#546e7a', borderRight: '1px solid #2c2c2c' },
  '.cm-activeLineGutter': { backgroundColor: '#2c2c2c40', color: '#eeffff' },
  '.cm-foldPlaceholder': { backgroundColor: '#2c2c2c', border: 'none', color: '#546e7a' },
  '.cm-tooltip': { border: 'none', backgroundColor: '#2c2c2c' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#2c2c2c', borderBottomColor: '#2c2c2c' },
  '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: '#3f3f3f', color: '#eeffff' } },
  '.cm-line': { padding: '0 2px 0 6px' },
}, { dark: true });

const materialDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea' },
  { tag: tags.string, color: '#c3e88d' },
  { tag: tags.number, color: '#f78c6c' },
  { tag: tags.bool, color: '#f78c6c' },
  { tag: tags.null, color: '#f78c6c' },
  { tag: tags.comment, color: '#546e7a', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#546e7a', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#546e7a', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#eeffff' },
  { tag: tags.definition(tags.variableName), color: '#82aaff' },
  { tag: tags.function(tags.variableName), color: '#82aaff' },
  { tag: tags.propertyName, color: '#f07178' },
  { tag: tags.definition(tags.propertyName), color: '#f07178' },
  { tag: tags.typeName, color: '#ffcb6b' },
  { tag: tags.className, color: '#ffcb6b' },
  { tag: tags.operator, color: '#89ddff' },
  { tag: tags.punctuation, color: '#89ddff' },
  { tag: tags.meta, color: '#f78c6c' },
  { tag: tags.regexp, color: '#f07178' },
  { tag: tags.escape, color: '#89ddff' },
  { tag: tags.heading, color: '#82aaff', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold', color: '#ffcb6b' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#c3e88d' },
  { tag: tags.tagName, color: '#f07178' },
  { tag: tags.attributeName, color: '#c792ea' },
  { tag: tags.attributeValue, color: '#c3e88d' },
]);

const materialDark = [materialDarkTheme, syntaxHighlighting(materialDarkHighlight)];

// ---------------------------------------------------------------------------
// Konsole (KDE terminal – green on black)
// ---------------------------------------------------------------------------
const konsoleTheme = EditorView.theme({
  '&': { backgroundColor: '#000000', color: '#00ff00' },
  '.cm-content': { caretColor: '#00ff00' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#00ff00' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#00550033' },
  '.cm-panels': { backgroundColor: '#0a0a0a', color: '#00ff00' },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid #003300' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid #003300' },
  '.cm-searchMatch': { backgroundColor: '#00880033', outline: '1px solid #00880066' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#005500' },
  '.cm-activeLine': { backgroundColor: '#003300' },
  '.cm-selectionMatch': { backgroundColor: '#00550044' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#005500', outline: '1px solid #00ff0044' },
  '.cm-gutters': { backgroundColor: '#000000', color: '#00aa00', borderRight: '1px solid #003300' },
  '.cm-activeLineGutter': { backgroundColor: '#003300', color: '#00ff00' },
  '.cm-foldPlaceholder': { backgroundColor: '#003300', border: 'none', color: '#00aa00' },
  '.cm-tooltip': { border: '1px solid #003300', backgroundColor: '#0a0a0a' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#0a0a0a', borderBottomColor: '#0a0a0a' },
  '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: '#003300', color: '#00ff00' } },
  '.cm-line': { padding: '0 2px 0 6px' },
}, { dark: true });

const konsoleHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#00ffaa', fontWeight: 'bold' },
  { tag: tags.string, color: '#66ff66' },
  { tag: tags.number, color: '#00ddff' },
  { tag: tags.bool, color: '#00ddff' },
  { tag: tags.null, color: '#00ddff' },
  { tag: tags.comment, color: '#007700', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#007700', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#007700', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#00ff00' },
  { tag: tags.definition(tags.variableName), color: '#88ffaa' },
  { tag: tags.function(tags.variableName), color: '#88ffaa' },
  { tag: tags.propertyName, color: '#44ddaa' },
  { tag: tags.definition(tags.propertyName), color: '#44ddaa' },
  { tag: tags.typeName, color: '#00ccff' },
  { tag: tags.className, color: '#00ccff' },
  { tag: tags.operator, color: '#00ffaa' },
  { tag: tags.punctuation, color: '#00cc00' },
  { tag: tags.meta, color: '#00aa88' },
  { tag: tags.regexp, color: '#ffaa00' },
  { tag: tags.escape, color: '#00ffaa' },
  { tag: tags.heading, color: '#00ffaa', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold', color: '#88ff88' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#66ff66' },
  { tag: tags.tagName, color: '#00ffaa' },
  { tag: tags.attributeName, color: '#44ddaa' },
  { tag: tags.attributeValue, color: '#66ff66' },
]);

const konsole = [konsoleTheme, syntaxHighlighting(konsoleHighlight)];

// ---------------------------------------------------------------------------
// Dracula Midnight (Dracula syntax on near-black background)
// ---------------------------------------------------------------------------
const draculaMidnightTheme = EditorView.theme({
  '&': { backgroundColor: '#0b0d0f', color: '#f8f8f2' },
  '.cm-content': { caretColor: '#f8f8f0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f8f8f0' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#1e2030' },
  '.cm-panels': { backgroundColor: '#08090b', color: '#f8f8f2' },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid #111318' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid #111318' },
  '.cm-searchMatch': { backgroundColor: '#72593080', outline: '1px solid #725930' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#1e2030' },
  '.cm-activeLine': { backgroundColor: '#12141a' },
  '.cm-selectionMatch': { backgroundColor: '#1e203080' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#1e2030', outline: '1px solid #f8f8f244' },
  '.cm-gutters': { backgroundColor: '#08090b', color: '#3d4466', borderRight: '1px solid #111318' },
  '.cm-activeLineGutter': { backgroundColor: '#12141a', color: '#6272a4' },
  '.cm-foldPlaceholder': { backgroundColor: '#1e2030', border: 'none', color: '#3d4466' },
  '.cm-tooltip': { border: '1px solid #1e2030', backgroundColor: '#08090b' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#08090b', borderBottomColor: '#08090b' },
  '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: '#1e2030', color: '#f8f8f2' } },
  '.cm-line': { padding: '0 2px 0 6px' },
}, { dark: true });

const draculaMidnightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#ff79c6' },
  { tag: tags.string, color: '#f1fa8c' },
  { tag: tags.number, color: '#bd93f9' },
  { tag: tags.bool, color: '#bd93f9' },
  { tag: tags.null, color: '#bd93f9' },
  { tag: tags.comment, color: '#4a5478', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#4a5478', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#4a5478', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#f8f8f2' },
  { tag: tags.definition(tags.variableName), color: '#50fa7b' },
  { tag: tags.function(tags.variableName), color: '#50fa7b' },
  { tag: tags.propertyName, color: '#66d9ef' },
  { tag: tags.definition(tags.propertyName), color: '#66d9ef' },
  { tag: tags.typeName, color: '#8be9fd', fontStyle: 'italic' },
  { tag: tags.className, color: '#8be9fd', fontStyle: 'italic' },
  { tag: tags.operator, color: '#ff79c6' },
  { tag: tags.punctuation, color: '#f8f8f2' },
  { tag: tags.meta, color: '#f8f8f2' },
  { tag: tags.regexp, color: '#ff5555' },
  { tag: tags.escape, color: '#ff79c6' },
  { tag: tags.heading, color: '#bd93f9', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold', color: '#ffb86c' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#f1fa8c' },
  { tag: tags.tagName, color: '#ff79c6' },
  { tag: tags.attributeName, color: '#50fa7b' },
  { tag: tags.attributeValue, color: '#f1fa8c' },
]);

const draculaMidnight = [draculaMidnightTheme, syntaxHighlighting(draculaMidnightHighlight)];


// ===========================================================================
//  Export everything on window.CM6
// ===========================================================================
window.CM6 = {
  // Core
  EditorView, EditorState, Compartment, keymap, minimalSetup,

  // View extensions
  lineNumbers, highlightActiveLineGutter, drawSelection,
  rectangularSelection, crosshairCursor, highlightSpecialChars, dropCursor,
  lineWrapping: EditorView.lineWrapping,

  // State
  tabSize: EditorState.tabSize,

  // History
  history, historyKeymap, undo, redo, undoDepth, redoDepth,

  // Commands
  defaultKeymap, toggleComment, indentWithTab, indentMore, indentLess, selectAll,

  // Search
  search, searchKeymap, openSearchPanel, gotoLine, selectNextOccurrence, highlightSelectionMatches,

  // Autocomplete
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, completeAnyWord,

  // Language
  indentUnit, foldAll, unfoldAll, foldKeymap, foldGutter, indentOnInput,
  bracketMatching, syntaxHighlighting, defaultHighlightStyle,

  // Vim
  vim,

  // Minimap
  showMinimap,

  // Themes
  themes: { oneDark, dracula, draculaMidnight, monokai, nord, solarizedDark, githubDark, materialDark, konsole },

  // Languages
  languages: { javascript, python, css, html, php, json, yaml, rust, cpp, java, sql, xml, markdown },
};

document.dispatchEvent(new Event('cm6-ready'));
