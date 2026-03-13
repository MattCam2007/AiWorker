# Mobile Input Duplication Bug

## Summary
On mobile (Android Chrome), typing sometimes duplicates portions of the user's message. Root cause is in xterm.js's `CompositionHelper._handleAnyTextareaChanges()`.

## Root Cause

### How Android input works with xterm.js
- On Android Chrome, **every keystroke** goes through IME composition (keyCode 229)
- xterm.js accumulates characters in a hidden `<textarea>`, sending to PTY on `compositionend`
- Between compositions, `_handleAnyTextareaChanges()` detects text changes from autocorrect, predictive text, swipe-typing
- The textarea is **never cleared** during normal typing — it grows with every character

### The bug: two paths to duplication

**Path 1 — `String.replace` failure (primary):**

```javascript
_handleAnyTextareaChanges() {
  const before = this._textarea.value;
  setTimeout(() => {
    if (!this._isComposing) {
      const after = this._textarea.value;
      const diff = after.replace(before, "");  // ← BUG

      if (after.length > before.length) {
        triggerDataEvent(diff);  // sends "new" text
      }
    }
  }, 0);
}
```

When Gboard autocorrects a word (e.g., "reveiw" → "review"), the old textarea content is no longer a substring of the new content. `after.replace(before, "")` finds no match and returns `after` unchanged — the **entire textarea contents**. This re-sends everything previously typed.

Example:
```
before: "I want you to reveiw the code"
after:  "I want you to review the code"   ← autocorrect

"I want you to review the code".replace("I want you to reveiw the code", "")
  → "I want you to review the code"   // no match, returns full string
```

**Path 2 — Same-length replacement branch:**

```javascript
} else if (after.length === before.length && after !== before) {
  triggerDataEvent(after);  // sends ENTIRE textarea, not a diff
}
```

When autocorrect replaces a word with one of the same character length, this branch sends the full textarea value unconditionally.

### Why paragraphs duplicate (not just words)
The textarea accumulates all typed text. The only thing that clears it is the IME-flush code in `app.js:_sendToActiveTerminal()` (line ~1692) — which runs on **toolbar button presses**. So the duplicated portion = everything typed since the last toolbar button press.

### Why it's intermittent
Requires all three conditions simultaneously:
1. Autocorrect modifies already-committed text in the textarea
2. `_isComposing` is `false` at that moment (between word compositions)
3. A keydown with keyCode 229 fires (triggering `_handleAnyTextareaChanges`)

This is a race condition dependent on keyboard app, typing speed, and autocorrect timing.

## Fundamental Design Problem
xterm.js's `CompositionHelper` was built for desktop CJK input (explicit, deliberate composition). Android hijacks the composition API for ALL text input, creating rapid-fire micro-compositions. The `_handleAnyTextareaChanges` fallback's `String.replace` diffing is too naive for a continuously-growing textarea that gets retroactively modified by autocorrect.

## Key Files
- `client/vendor/xterm.js` — CompositionHelper (minified, around position 67600-69200)
- `client/js/terminal.js:151-207` — onData handler (single point where input reaches WebSocket)
- `client/js/app.js:1659-1706` — IME flush code in `_sendToActiveTerminal()` (toolbar button handler)

## Potential Fix Directions
1. Periodically clear the textarea after committed text is sent (limits blast radius)
2. Replace `String.replace` diffing with proper index-based tracking
3. Use `InputEvent.data` and `inputType` instead of textarea snapshotting for modern browsers
4. Cap the textarea length to prevent unbounded growth
5. Patch `_handleAnyTextareaChanges` to use `_compositionPosition` tracking instead of naive diffing
