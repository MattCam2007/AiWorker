# 25 Mobile Scroll Ideas for TerminalDeck

## Current Architecture Context

xterm.js scrolling works by forwarding `wheel` events as SGR mouse tracking sequences to tmux (terminal.js:147-176). The `.xterm-viewport` has `overflow-y: auto !important` and a 5000-line scrollback buffer. Mouse tracking is stripped from output so xterm.js selection works, then manually re-encoded for wheel events. There is **no touch scroll handling at all** -- touch events on the terminal do nothing for scrolling. The native scrollbar exists but is 6px wide and nearly impossible to grab on mobile.

---

## 1. Fat Touchable Scrollbar Overlay

**Idea:** Render a custom 30-40px wide semi-transparent scrollbar track on the right edge of the terminal, overlaying the content. The thumb is proportionally sized to represent visible rows vs total scrollback. Dragging the thumb scrolls via `terminal.scrollToLine()`.

**Good:** Most intuitive pattern -- users already know scrollbars. Always visible so discoverability is instant. No learning curve. Maps directly to xterm.js's `scrollToLine()` API.

**Bad:** Eats 30-40px of horizontal screen real estate on an already cramped mobile terminal. On a 375px wide phone, that's ~10% of width. The thumb gets tiny with 5000 lines of scrollback (viewport might be 40 rows = 0.8% of buffer), making it hard to grab accurately.

---

## 2. Auto-Expanding Scroll Rail

**Idea:** A 4px thin indicator strip on the right edge during normal use. When the user touches near it (within 30px), it animates to 40px wide, revealing a grabbable thumb. Releases back to 4px after 2 seconds of no touch.

**Good:** Zero screen real estate cost during normal use. Feels responsive and alive. The expansion gives clear feedback that the system recognized the scroll intent. Combines discoverability (always-visible thin strip) with usability (wide grab target on demand).

**Bad:** The initial 4px target is still hard to hit deliberately on mobile -- users might not realize they can touch near it. The expand animation adds latency before scrolling begins. Edge touches might conflict with Android system gestures.

---

## 3. iOS-Style Long-Press Scroll Handle

**Idea:** Show a small floating pill (like iOS 13+ scroll indicators) on the right edge. On long-press (300ms), the pill enlarges, fires `navigator.vibrate(10)` for haptic confirmation, and enters fast-scroll mode. Vertical drag maps directly to buffer position. Shows line number while dragging. Release exits the mode.

**Good:** Follows a platform pattern iOS users already know. Haptic feedback provides satisfying tactile confirmation of mode entry. The line number display during drag prevents disorientation. Extremely fast for navigating large scrollback (direct position mapping vs incremental scrolling).

**Bad:** 300ms long-press delay feels slow when you want to scroll NOW. Android users may not know this iOS convention. Long-press conflicts with text selection in some contexts. Requires the user to already know the feature exists -- no visual affordance until you try it.

---

## 4. Dedicated Scroll Gutter Zone

**Idea:** Reserve the rightmost 15-20% of the terminal as an invisible "scroll zone." Single-finger vertical swipes in this zone scroll the buffer. Swipes in the remaining 80-85% interact with the terminal normally.

**Good:** No UI elements needed -- zero visual overhead. Always available, no mode switching. Separates scroll intent from terminal interaction spatially. The right edge is where users instinctively reach for scrolling.

**Bad:** Undiscoverable without a tutorial or onboarding hint. Reduces the effective terminal interaction area. Users will accidentally trigger scrolls when trying to interact with content near the right edge, or accidentally interact when trying to scroll. The boundary is invisible and fuzzy.

---

## 5. Scroll Mode Toggle Button (Toolbar)

**Idea:** Add a button to the existing mobile toolbar that toggles "scroll mode." When active, the entire terminal surface becomes a scroll surface -- single-finger vertical swipes scroll the buffer with momentum physics. When inactive, touch behaves normally. Button shows a visual indicator (highlighted/colored) when scroll mode is on.

**Good:** Explicit mode is unambiguous -- no accidental triggers. Uses the existing toolbar infrastructure, no new UI elements. The full terminal surface becomes a scroll area, maximizing the touch target. Can implement proper momentum/inertia scrolling since the entire surface is dedicated.

**Bad:** Mode switching is a UX anti-pattern -- users forget which mode they're in, especially after putting the phone down and picking it back up. Every scroll requires two actions (tap toggle, then scroll, then tap toggle back). Interrupts flow. Users will type into a terminal that's in scroll mode and get confused.

---

## 6. Two-Finger Scroll

**Idea:** Detect touch count on the terminal surface. One finger = normal terminal interaction. Two fingers = scroll the buffer vertically. Calculate scroll delta from the average Y movement of both touch points.

**Good:** Familiar gesture from maps and web browsing. No UI elements, no mode switching. Both scrolling and interaction available simultaneously without switching. Natural and intuitive for anyone who uses a smartphone.

**Bad:** Browser may intercept two-finger gestures for pinch-to-zoom (need to `preventDefault` carefully). Some users find two-finger gestures physically awkward on a phone (works better on tablets). Conflicts with any future pinch-to-zoom-font-size feature. `touch-action` CSS must be carefully tuned. May not work reliably across all mobile browsers.

---

## 7. Swipe-to-Scroll with Velocity/Momentum

**Idea:** Intercept single-finger touchmove events on the terminal, translate vertical movement into `terminal.scrollLines()` calls, and on touchend calculate velocity to apply momentum scrolling (decelerating animation via requestAnimationFrame). Essentially replicate native scroll physics on the xterm viewport.

**Good:** Feels like native scrolling -- the gold standard UX. No extra UI elements. Direct, physical connection between finger movement and content movement. Momentum lets you cover large distances with a flick. This is what users EXPECT touch scrolling to feel like.

**Bad:** Conflicts directly with terminal interaction -- any touch on the terminal triggers scrolling instead of focusing/typing. Need to somehow distinguish scroll intent from interaction intent (the fundamental problem). If combined with a mode toggle (#5), loses the "native feel" advantage. xterm.js's viewport sits underneath row divs (issue #594), so you can't use native scroll -- must implement scroll physics from scratch.

---

## 8. Horizontal Scrubber Bar (Timeline)

**Idea:** A horizontal slider bar at the bottom of the terminal (between content and toolbar). Represents the entire scrollback as a timeline -- left = oldest, right = current. Drag the thumb to scrub through history. Show a floating tooltip with line number and text preview at the current scrub position.

**Good:** Terminal output IS temporal, so a timeline metaphor is natural and intuitive. Horizontal scrubbing on a phone is ergonomically comfortable (thumb sweeps naturally left-right). The preview tooltip prevents disorientation during fast scrubbing. Can be very compact vertically (~30px).

**Bad:** Adds another horizontal bar to an already crowded mobile layout (header + terminal + toolbar + this). Horizontal control for vertical content is conceptually backwards for some users. Precision is limited -- on a 375px wide phone, 5000 lines of scrollback means each pixel represents ~13 lines. May conflict with horizontal swipe gestures for tab switching.

**TASK**
REPLACE "SESSIONS" IN THE FOOTERBAR WITH THIS IDEA.

---

## 9. Edge-Swipe Scroll Activation

**Idea:** An invisible 20px hot zone on the right edge. Swiping inward from this zone (horizontal start, then vertical) activates a scroll overlay -- either a fat scrollbar, minimap, or scrubber that appears for the duration of the gesture. Releasing dismisses it.

**Good:** Zero screen real estate cost -- completely invisible until activated. The right edge is natural scrollbar territory. The horizontal-then-vertical gesture requirement reduces accidental triggers. The scroll UI only appears when needed, keeping the terminal clean.

**Bad:** Conflicts with Android's edge-back gesture on some devices (though that's usually left edge). Completely undiscoverable -- no visual hint that this feature exists. The compound gesture (swipe in, then up/down) is fiddly. If the scroll overlay appears on top of terminal content, it obscures what you're trying to read.

**THOUGHTS**
I LIKE THE IDEA BUT MORE THAN 20PX. INCLUDE THIS IN THE SUMMARY when i ask for it**

---

## 10. Command-Index Navigation Strip

**Idea:** Parse the scrollback buffer for shell prompts (PS1 patterns, `$` or `#` at line starts). Create a vertical strip of small markers along the right edge, one per detected command. Tapping a marker jumps to that command's output. Dragging along the strip scrubs through command history. Could show abbreviated command text on hover/press.

**Good:** Most terminal-specific idea on this list -- turns an undifferentiated text stream into structured, navigable history. Incredibly useful for real workflows: "where was that `npm install` output?", "scroll back to the `git diff`." Provides semantic navigation that no other scroll method offers. Users navigate by MEANING rather than position.

**Bad:** Requires reliable prompt detection, which varies wildly across shells, SSH sessions, docker containers, and custom PS1 configurations. Inside tmux, prompts may be even harder to detect. False positives (lines starting with `$` in output) would create wrong markers. Computational cost of scanning 5000+ lines of scrollback for patterns. The markers don't help for non-interactive output (log files, build output without prompts).

---

## 11. Minimap Popover Strip

**Idea:** When scroll mode is activated (via button, gesture, or other trigger), a narrow 40-60px strip appears on the right side showing a miniaturized view of the entire scrollback. Terminal lines rendered as 1px-high colored bars -- green for output, white for commands, red for stderr. A highlight rectangle shows the current viewport. Drag on the strip to navigate. Dismiss by tapping outside.

**Good:** Provides incredible information density -- you can SEE the shape of your terminal history at a glance. Color coding adds semantic meaning (long red blocks = error output, patterns of green = build steps). The viewport rectangle gives instant position awareness. VS Code proved this pattern works for code navigation.

**Bad:** Rendering a meaningful minimap from terminal ANSI content is complex -- need to parse escape codes to extract colors. 40-60px on a phone is significant real estate. The minimap will be visually noisy and potentially illegible at that scale. Computational cost of rendering thousands of lines into a canvas. May need to be regenerated as new output arrives.

---

## 12. Pull-Down Search (Overscroll Trigger)

**Idea:** When the user is at the top of the scrollback and pulls down further (overscroll), trigger a search input that slides in from the top. Type to search through terminal history. Results highlighted in the scrollback with jump-to-match navigation. Similar to pull-to-refresh but for search.

**Good:** Leverages an existing mobile pattern (pull-to-refresh) that users already understand. Search is often more useful than scrolling for finding specific content. The overscroll trigger is natural -- you're already at the end of scrollback and looking for something. No UI elements until triggered.

**Bad:** Only accessible from the very top of scrollback -- if you want to search from the middle, you have to scroll all the way up first (terrible UX). xterm.js already has a search addon that could be triggered more conventionally. Overscroll detection on touch is tricky with xterm.js's custom viewport. The pull-down gesture might conflict with the browser's address bar reveal on some mobile browsers.

**i like this idea but i dont know how it would fit. ibdont like only from the top, but i dont know where else to put it**

---

## 13. Floating Page Up/Down Buttons

**Idea:** Two small floating buttons (chevrons up/down) that appear on the right edge of the terminal. Tap = scroll one page, long-press = continuous scrolling with acceleration. Position them in the vertical center of the terminal, stacked. Auto-hide after 3 seconds of no scrolling, reappear on any scroll activity.

**Good:** Dead simple to implement -- just buttons that call `terminal.scrollPages(1)` or `terminal.scrollPages(-1)`. No gesture conflicts. Accessible and discoverable. Works for both normal and alternate screen buffers. Can be made large enough for easy touch targets (44px+). Long-press-to-continuous-scroll covers the "I need to go far" use case.

**Bad:** Page-at-a-time is coarse -- you either overshoot or undershoot your target. Not fluid like native scrolling. The buttons feel retro and clunky compared to gesture-based scrolling. They float over terminal content, obscuring text. Auto-hide means users might not know they exist; always-visible means permanent visual clutter.

---

## 14. Jog Dial / Rotary Control

**Idea:** A circular touch zone (80-100px diameter) that appears in the bottom-right corner when scroll mode is activated. The user places their thumb on it and rotates clockwise (scroll down) or counter-clockwise (scroll up). Rotation speed maps to scroll speed. Tap center to toggle scroll-lock.

**Good:** Provides extremely precise, continuous scroll control -- small thumb movements cover large angular distances without needing to "ratchet" (lift and re-swipe). Stays in a thumb-friendly position. Can stay visible without obscuring much terminal content (it's in the corner). The speed-proportional-to-rotation gives natural acceleration. Novel and satisfying to use.

**Bad:** High learning curve -- nobody expects a jog dial in a terminal app. Implementation complexity: tracking angular velocity from touch coordinates requires trigonometry. May feel awkward for users not familiar with physical jog wheels. 80-100px circle in the corner still obscures some terminal content. Requires entering a scroll mode first.

---

## 15. Scroll Preview Window

**Idea:** When any fast-scroll mechanism is active (scrubber, handle drag, minimap), show a floating preview panel (~30% screen height) that displays the content at the current scroll target. The main terminal stays at its current position until the user releases, then it animates to the target position.

**Good:** Prevents the disorientation of fast-scrolling through thousands of lines of content-blur. Users can see both where they ARE and where they're GOING simultaneously. Useful for finding a specific output section in a large scrollback. The snap-on-release feels satisfying.

**Bad:** Not a scroll solution itself -- only a companion to other solutions. The preview panel takes significant screen space on mobile. Rendering two viewport positions simultaneously doubles the rendering cost. On a small phone screen, the preview may not show enough context to be useful. Implementation requires reading from xterm.js's internal buffer at arbitrary positions.

---

## 16. Velocity-Sensitive Swipe with Dead Zone

**Idea:** All single-finger vertical swipes on the terminal trigger scrolling, BUT only after exceeding a 15px vertical "dead zone" threshold, and only if the initial touch velocity is above a minimum (fast swipe = scroll intent, slow touch = interaction intent). Slow, deliberate touches pass through to the terminal for interaction.

**Good:** No UI elements, no mode switching, no gestures to learn. Leverages the natural difference between how users scroll (fast, sweeping) vs how they interact (slow, precise). Works everywhere on the terminal surface. Feels intuitive when tuned correctly -- fast swipes scroll, taps and slow drags interact.

**Bad:** The velocity threshold is a magic number that will feel wrong for some users. Edge cases abound: what about a slow, deliberate scroll? What about a fast tap? Tuning this to feel right across different devices, screen sizes, and user habits is very difficult. Will inevitably misclassify some gestures, causing frustration. Different users have different natural speeds.

---

## 17. Thumb-Zone Scroll Anchor

**Idea:** A small, draggable anchor pill (like a map pin) sits in the bottom-right corner. To scroll, grab and drag the anchor upward -- the terminal scrolls as you drag. The anchor stretches on a "rubber band" from its home position, and releasing it snaps it back while the terminal stays at the scroll position. Pull further = scroll faster (non-linear mapping).

**Good:** Ergonomically placed for right-hand thumb use. The rubber-band visual metaphor is intuitive (pull harder = go faster). The anchor is always visible and always in the same place, so it's easy to find. The non-linear speed mapping lets you do both fine and coarse scrolling with one control. The snap-back means the control is always ready for the next scroll.

**Bad:** Novel interaction pattern with a learning curve. The rubber-band physics need careful tuning to feel right. Might conflict with the mobile toolbar handle which is also at the bottom. One-directional at a time (drag up to scroll up, must release and drag down to scroll down). Left-handed users would prefer the left corner.

---

## 18. Tilt-to-Scroll (Accelerometer)

**Idea:** Use the DeviceOrientation API to detect phone tilt. When scroll mode is active, tilting the phone forward scrolls up, tilting backward scrolls down. Tilt angle maps to scroll speed. A visual indicator shows the current tilt and scroll direction.

**Good:** Completely hands-free scrolling -- the user can read the terminal while scrolling by just tilting the phone. No touch targets needed. Novel and fun. Could be useful for reading long logs or build output. Provides very smooth, continuous speed control.

**Bad:** Requires `DeviceOrientationEvent.requestPermission()` on iOS (user prompt). Very hard to hold the phone perfectly still -- the terminal would constantly jitter-scroll. Unusable while walking, on transit, or lying down. Requires a mode toggle to prevent constant scrolling. Battery impact from continuous accelerometer polling. Most users would find this gimmicky rather than useful. Accessibility concerns for users with motor control issues.

---

## 19. Split-View Scroll (Freeze + Navigate)

**Idea:** Tap a button to "freeze" the current terminal view in the top half of the screen. The bottom half becomes a freely scrollable view of the scrollback. Tapping a position in the bottom half jumps the main terminal there. Dismiss to return to normal single-view.

**Good:** Solves the "lose my place" problem completely -- you always see where you were. The scrollable half can use native scroll physics since it's not the live terminal. Great for comparing output at two different scroll positions (e.g., "what changed between this build and the last?"). Bottom half can be scrolled with normal touch gestures.

**Bad:** Halves the effective terminal size on an already small mobile screen. Implementation complexity: need to render the same buffer in two viewports. The frozen top half stops showing live output, which could miss important new content. The split metaphor may confuse users who expect a single terminal view.

---

## 20. Haptic Detent Scrollbar

**Idea:** A custom scrollbar (like #1) but with haptic "detents" -- as the user drags the scrollbar thumb, the phone vibrates briefly (5ms) each time the thumb crosses a command boundary in the scrollback. Stronger vibration (20ms) at the top and bottom of the buffer.

**Good:** Adds a physical, tactile dimension to scrolling that makes the scrollbar feel like a precision instrument. Users can "feel" their way to command boundaries without looking at the scrollbar position. The vibrations act as implicit bookmarks. Surprisingly useful -- similar to the satisfying click of a notched scroll wheel. Enhances any scrollbar implementation.

**Bad:** Requires parsing scrollback for command boundaries (same prompt detection challenge as #10). `navigator.vibrate()` not supported on iOS Safari at all. On Android, vibrations can feel cheap or annoying if too frequent. Won't work in silent mode. Battery impact from frequent vibrations during fast scrolling. Purely an enhancement -- still needs a base scrollbar solution.

**for sure want haptic when yiunfind whatever scroll mechanism you find. dont know i need it for every command though.**

---

## 21. Triple-Tap Scroll Zone Activation

**Idea:** Triple-tap anywhere on the terminal to temporarily convert the terminal surface into a scroll surface for 5 seconds (with a visual countdown indicator). During this window, vertical swipes scroll the buffer with momentum. After timeout or a single tap, revert to normal mode. Visual feedback: subtle border glow or tint during scroll window.

**Good:** No permanent UI elements. Works anywhere on the terminal. Triple-tap is unlikely to be triggered accidentally during normal typing. The auto-timeout prevents forgetting you're in scroll mode. The visual feedback makes the mode obvious.

**Bad:** Triple-tap is slow and deliberate -- three taps before you can start scrolling. Discoverability is zero -- how would a user know to triple-tap? The 5-second timeout may not be enough for deep scrolling, requiring repeated triple-taps. Some keyboards intercept triple-tap for text selection. The UX of a timed mode feels stressful ("hurry up and scroll before it expires!").

---

## 22. Scroll Gesture from Toolbar Handle

**Idea:** The existing mobile toolbar handle (the swipe-up bar at the bottom) gains a new gesture: instead of swiping up/down to change toolbar state, *swiping and holding* on the handle then moving up/down scrolls the terminal. The handle acts as a scroll initiator -- the gesture starts on the handle (avoiding terminal conflicts) but the scroll magnitude tracks your finger's Y position.

**Good:** Reuses existing UI -- no new elements. The toolbar handle is already a known touch target. The gesture starts outside the terminal, cleanly separating scroll intent from terminal interaction. Ergonomically great -- the handle is at the bottom where the thumb naturally rests. No mode switching needed.

**Bad:** Overloads the toolbar handle with multiple gesture meanings (swipe up = expand toolbar, swipe-and-hold = scroll). Distinguishing a quick swipe from a hold-and-drag requires careful timing thresholds. Limits scroll range to the distance from handle to top of screen (~600px on a phone). Users who want to expand the toolbar might accidentally trigger scrolling. The handle is small, limiting precision.

---

## 23. Shake-to-Scroll-Top / Shake-to-Bottom

**Idea:** Use the DeviceMotion API to detect phone shaking. A short shake snaps to the bottom of the scrollback (live terminal). A specific shake pattern (e.g., two quick shakes) jumps to the top. A visual animation confirms the action.

**Good:** Completely eyes-free and hands-free (well, arm-free) interaction. Great for the common "get back to the live terminal" action that currently requires scrolling through thousands of lines. Fun and memorable interaction. Zero screen real estate cost.

**Bad:** Only provides jump-to-top/bottom, not proportional scrolling -- it's a complement, not a replacement. Shake detection is unreliable and varies by device. False positives from walking, transit, or setting the phone down. Accessibility disaster for some users. Feels gimmicky. Battery drain from continuous motion monitoring. iOS requires explicit permission for motion APIs.

---

## 24. Scroll Breadcrumb Trail

**Idea:** As terminal output is generated, automatically detect and mark significant points (commands, errors, long pauses between output). Show these as tiny dot indicators along the right edge -- a sparse, minimal version of the command index (#10). Tapping a dot jumps to that point. The dots are color-coded: white for commands, red for errors, yellow for warnings.

**Good:** Passive and automatic -- no user action needed to create the markers. Much lighter-weight than a full command index or minimap. The dots are tiny (4-6px) so they don't interfere with the terminal. Color coding provides instant semantic meaning. Users can see at a glance where errors occurred in the scrollback. Works well with long build logs where you want to find the first error.

**Bad:** Prompt/error detection is fragile (same as #10). With lots of output, dots could become crowded and overlap. Tiny dots are hard to tap accurately on mobile (below the 44px touch target guideline). The dots need to be positioned correctly relative to the scroll position, which requires tracking buffer positions. New output shifts all dot positions, causing visual jitter.

---

## 25. Peek-Scroll (Hold Corner + Swipe)

**Idea:** Touch-and-hold the bottom-right corner of the terminal (a 60x60px zone). While holding, the terminal dims slightly and shows a "scroll ready" indicator. With your hold maintained, swipe up or down with a second finger anywhere on the screen to scroll. Release the corner hold to exit scroll mode. One finger anchors the mode, the other finger scrolls.

**Good:** Extremely clear intent separation -- the corner hold is a deliberate, unmistakable "I want to scroll" action. The second finger gets the full screen as a scroll surface, maximizing precision. The visual dim provides clear mode feedback. No UI elements, no buttons, no overlays. The corner position is ergonomically natural for the thumb of the holding hand.

**Bad:** Requires two hands (or two fingers of the same hand at extreme positions). Physically awkward -- holding one corner while swiping elsewhere is contortionist-level phone handling. The 60x60px corner zone might interfere with the scrollbar or other controls. Learning curve: who would guess to hold a corner? Zero discoverability. Complex gesture coordination may frustrate users.

---

## Summary Matrix

| # | Idea | Effort | Impact | Discoverability | Conflicts |
|---|------|--------|--------|-----------------|-----------|
| 1 | Fat Scrollbar Overlay | Low | High | Perfect | Width cost |
| 2 | Auto-Expanding Rail | Medium | High | Good | Edge gestures |
| 3 | Long-Press Handle | Medium | High | Poor | Text selection |
| 4 | Scroll Gutter Zone | Low | Medium | None | Misclassification |
| 5 | Scroll Mode Toggle | Low | Medium | Good | Mode confusion |
| 6 | Two-Finger Scroll | Medium | High | Medium | Pinch-to-zoom |
| 7 | Momentum Swipe | High | Highest | Perfect | Input conflict |
| 8 | Horizontal Scrubber | Medium | Medium | Good | Screen space |
| 9 | Edge-Swipe Activation | Medium | Medium | None | System gestures |
| 10 | Command-Index Strip | High | Highest | Good | Prompt detection |
| 11 | Minimap Popover | High | High | Good | Render cost |
| 12 | Pull-Down Search | Medium | Medium | Good | Only at top |
| 13 | Page Up/Down Buttons | Low | Low | Perfect | Coarse only |
| 14 | Jog Dial | High | Medium | Poor | Learning curve |
| 15 | Scroll Preview | Medium | Medium | N/A (companion) | Screen space |
| 16 | Velocity Dead Zone | Medium | High | Perfect | Misclassification |
| 17 | Thumb-Zone Anchor | Medium | Medium | Medium | Corner space |
| 18 | Tilt-to-Scroll | High | Low | Poor | Jitter, gimmicky |
| 19 | Split-View Scroll | High | Medium | Good | Half screen |
| 20 | Haptic Detent Scrollbar | Medium | Medium | N/A (enhancement) | iOS unsupported |
| 21 | Triple-Tap Zone | Low | Low | None | Timeout stress |
| 22 | Toolbar Handle Scroll | Low | High | Medium | Gesture overload |
| 23 | Shake-to-Top/Bottom | Low | Low | None | False positives |
| 24 | Scroll Breadcrumbs | Medium | High | Good | Detection accuracy |
| 25 | Peek-Scroll (Hold+Swipe) | Medium | Low | None | Two-hand only |

## Top Recommendations (Best Effort-to-Impact)

1. **#2 Auto-Expanding Rail** -- Best all-around. Minimal screen cost, intuitive, good discoverability via the always-visible thin indicator.
2. **#22 Toolbar Handle Scroll** -- Clever reuse of existing UI. Low implementation cost, ergonomically excellent. Worth trying despite gesture overload risk.
3. **#6 Two-Finger Scroll** -- If browser conflicts can be managed, this is the most natural and invisible solution.
4. **#1 Fat Scrollbar** -- Simple fallback if #2 is too complex. Just make the damn scrollbar bigger.
5. **#16 Velocity Dead Zone** -- High risk/high reward. If tuned perfectly, it's the best UX. If tuned wrong, it's the worst.

## Combinable Pairs

- **#2 + #20**: Auto-expanding rail with haptic detents at command boundaries
- **#1 + #15**: Fat scrollbar with scroll preview window during fast drag
- **#5 + #7**: Toggle button activates momentum swipe scrolling
- **#13 + #10**: Page buttons for coarse navigation + command index for precise jumps
- **#22 + #24**: Toolbar handle initiates scroll, breadcrumb dots show targets
