# Audion Settings: Design Rules

Rules for every screen under Settings. Follow these when adding, moving, or restyling a setting. If a rule and a shortcut conflict, the rule wins.

Stack: Tauri + Svelte. Use existing CSS tokens (`--bg-*`, `--text-*`, `--accent-primary`, `--border-color`, `--spacing-*`, `--radius-md`). Never hardcode colors or sizes that a token already covers.

---

## 1. Principles

1. **Fewer decisions.** Every setting pushes a decision onto the user. Prefer a good default over a new option.
2. **Find it fast.** A new user should find "change theme" or "turn on crossfade" in under 10 seconds, by browsing or by search.
3. **Common first, rare hidden.** Most people touch about 10% of settings. Show those. Collapse the rest under Advanced.
4. **Instant and reversible.** Changes apply immediately. Anything risky can be undone or confirmed.
5. **Plain language.** Labels describe what the user gets, not how the code works.
6. **Calm surface.** No decoration that competes with reading.

---

## 2. Information architecture

### Categories (fixed, in this order)

| Category | Contains |
|---|---|
| General | Startup page, autostart, language, keyboard shortcuts |
| Sound | Output driver and device, equalizer, ReplayGain, crossfade |
| Playback | Autoplay and queue, lyrics |
| Library | Music folders, covers, artist delimiters, Subsonic/Navidrome sources |
| Appearance | Theme mode, accent color, then Advanced: Skin Studio, Custom JS, skin packages, community skins |
| Account | Profile and supporter status, Custom Server, cloud sync, ListenBrainz and scrobbling |
| Privacy & Data | Remote control, telemetry, then Danger zone: clear cache, reset database |
| About | Version, changelog, credits, one "Support Audion" section |

### Rules

- Group by the user's goal, not by code module. Name categories with everyday words.
- Maximum 8 top-level categories. Do not add a ninth; merge instead.
- Maximum 2 levels of navigation (category, then page). No third-level drill-down on desktop.
- A setting lives in exactly one place. Donation and support links appear only in About. Do not repeat Ko-fi or Patreon in other sections.
- Order within a category by frequency of use, not alphabetically.
- A category page with more than about 10 settings must be split into labeled sections.
- "More" and "Misc" are banned category names.

---

## 3. Page layout

```
┌ App nav ┬ Settings nav ┬ Content (max 760px) ──────────┐
│         │ 🔍 Search     │ Page title                    │
│         │ General       │ One-line description          │
│         │ Sound         │ ┌ Card ─────────────────────┐ │
│         │ ...           │ │ row                       │ │
│         │               │ │ row                       │ │
│         │               │ └───────────────────────────┘ │
│         │               │ ▸ Advanced                    │
└─────────┴──────────────┴───────────────────────────────┘
```

- **Content column:** `max-width: 760px`, left-aligned next to the settings nav. Never stretch rows across the full window.
- **Page title:** shown once, as `h1`. Add a one-line description only if it adds information.
- **Section headers:** only when a page has two or more sections. Never repeat the page title as a section header.
- **Cards:** one card per section. Rows inside a card, divided by 1px borders.
- **Bottom padding:** keep space below the last row so the player bar never covers content (`--player-height` plus 40px).
- **Mobile (below 641px):** categories become a drill-down list (list, then page, with a back button). Rows stack: label above control if width is under about 360px.

---

## 4. Setting rows

Every setting is one row with the same anatomy:

```
Label                                      [ control ]
Short description (one sentence)
```

- **Padding:** 14px 16px. **Divider:** 1px `--border-color` between rows, none after the last.
- **Label:** 15px, weight 500, `--text-primary`. Name the feature, not the technology ("Crossfade", not "Enable crossfade engine").
- **Description:** 13px, line-height 1.4, `--text-secondary`, max width 60ch. One sentence. Say what it does, not how to use it.
- **Control** sits on the right, vertically centered, minimum 44px tall hit area for toggles and buttons.
- **Disabled rows:** 50% opacity, and the description must say why ("Requires a signed-in account").
- **Dependent settings** (shown only when a parent is on) are indented 16px under the parent, or revealed with a short height transition. Never silently disappear without a parent toggle.

### Writing descriptions

- One sentence. Under about 90 characters when possible.
- Do not describe both states ("Turn off to use legacy behavior..."). Put detail in a "Learn more" link or tooltip.
- No developer terms in the label or description unless the setting is under Advanced.
- Lowercase technical names (`replaygain`, `rodio`) only appear inside Advanced.
- All text goes through `$_()` with a `default` value. No hardcoded user-facing strings.

---

## 5. Controls

| Need | Control | Notes |
|---|---|---|
| On or off | Toggle | Applies instantly. Never pair a toggle with a Save button. |
| One of 2 to 4 options | Segmented control | Theme mode (Dark / Light / System) |
| One of 5 or more | Dropdown | Output device, language |
| Number in a range | Slider with visible value | Show the unit: `5 s`, `-3 dB` |
| Ordered list | Reorderable list with drag handle | Lyrics source priority |
| Free text, path, URL | Text input with validation and a Browse or Test button | Validate on blur, show error under the field |
| Action | Button | Label is a verb: "Rescan library", "Export skin" |
| Destructive action | Danger button in the Danger zone | Always confirm (section 8) |

Rules:
- A toggle means a state. An action is a button. Never use a toggle to trigger something.
- Never make users type a syntax. If input needs a format (`a/b/c`, delimiters), build a UI for it. A raw text field is allowed only under Advanced, with an example and a "Reset to default" button.
- Sliders also accept keyboard arrows. Show the current value next to the slider.
- Show the current value without opening anything (for example `Crossfade · 5 s` on dropdown rows or collapsed summaries).

---

## 6. Advanced

- Rarely used, risky, or developer-level settings go in a collapsed `▸ Advanced` block at the bottom of the relevant page. Do not create a separate Advanced category.
- Collapsed by default. Remember the open state per page for the session.
- If search leads to a setting inside Advanced, auto-expand it.
- Custom JS and any setting that executes code shows a visible warning above the control.
- Candidates today: output driver internals, source priority text field, dynamic alignment, Custom CSS and JS, skin packages, remote control, developer mode, database actions.

---

## 7. Typography and color

### Type scale

| Use | Size | Weight |
|---|---|---|
| Page title | 24px | 700 |
| Section header | 16px | 600 |
| Row label | 15px | 500 |
| Description | 13px (minimum) | 400 |
| Badge, caption | 12px (minimum) | 500 |

Never go below 12px. Never use 11px for descriptions.

### Color

- `--text-primary` for labels. `--text-secondary` for descriptions (neutral gray, not tinted). `--text-subdued` only for hints and disabled text.
- **Accent color means "interactive or active"**: toggles that are on, active nav item, links, focus rings. Do not use accent blue for passive description text.
- Text contrast against its surface must be at least 4.5:1 (WCAG AA). Test every theme and skin, not only the default.
- Status colors: success green, warning amber, error red. Always paired with an icon or text, never color alone.
- Do not tint card backgrounds with accent colors.

### Surfaces

- Settings page background is the theme's base surface. Cards use `--bg-surface`.
- **No decorative background effects behind Settings** (stars, particles, canvas effects). If a skin forces one, cards must be opaque enough to keep text contrast.
- Radius: `--radius-md` on cards, 6px on inputs and buttons. Keep one radius per component type.

---

## 8. Danger zone

- Lives at the bottom of **Privacy & Data**, visually separated: top margin 32px, red-tinted border, heading "Danger zone".
- Contains only destructive or irreversible actions: clear cache, wipe covers, reset database, remove account data.
- Every action opens a confirm dialog that states **what will be deleted** and **what will not**. The confirm button repeats the action ("Reset database"), never "OK".
- Prefer undo over confirmation when feasible (for example, a snackbar with Undo for 8 seconds).
- Never place a destructive button next to a harmless toggle.

---

## 9. Search

Search is the main escape hatch. It must be fast and forgiving.

- Entries are shown only when the setting is actually visible: hide `sync` when logged out, hide `shortcuts` on mobile, hide Advanced items only if the user cannot reach them.
- **Index every setting** with `title`, `subtitle`, `keywords`, `tab`, `sectionId`, and `targetElementId`. Always set `targetElementId` for rows so navigation lands on the row, not the section.
- Include keywords for what users type, not what the code says: "custom server", "server url", "dark mode", "volume", "gapless", "scrobble".
- **Match logic:** split the query into tokens. Every token must match something. Rank: title prefix, title contains, keyword prefix, keyword contains, subtitle.
- **Keyboard:** Arrow Up/Down moves the highlight, Enter opens, Escape clears, and clicking outside closes. Use `role="listbox"` and `role="option"`.
- Empty state: "No settings match “query”", with a suggestion of nearby categories.
- After navigating, scroll the row to the center and flash it for 2.2s (existing `setting-highlight-flash`). If the row is inside Advanced, expand it first and wait for `tick()` before scrolling.
- Placeholder is short: "Search settings".
- When adding a setting, add its index entry in the same commit. A setting not in the index is unfinished.

---

## 10. Interaction

- **Instant apply.** Toggles, sliders, dropdowns, and segmented controls save immediately. Show nothing extra.
- **Explicit apply** only for changes that cost something: switching audio driver, changing server connection, changing library folders. Use a clear button and show progress or result.
- **Feedback.** Confirm saved changes quietly (the control state changing is enough). Show a toast only for non-obvious results such as "Library rescan started".
- **Errors** appear next to the control that caused them, in plain words, with a next step. Roll the control back to the last valid value.
- **Reset.** Each section has "Reset to defaults" in its overflow menu. Settings changed from default may show a small dot (optional).
- **Remember** the last visited category between sessions. Allow opening Settings directly on a category (deep link) for flows like the supporter email.
- **Motion.** 150 to 200ms for hover, toggle, and expand. Respect `prefers-reduced-motion`: disable the highlight flash glow and height animations.

---

## 11. Accessibility

- Everything works by keyboard. Tab order follows visual order. Focus ring is visible on every control (2px `--accent-primary`).
- Settings nav uses `role="tablist"` or a nav landmark with `aria-current="page"`. If tabs are used, arrow keys switch tabs and inactive tabs have `tabindex="-1"`.
- Each panel has `aria-labelledby` pointing at its heading.
- Every control has an accessible name equal to the row label. The row description is linked with `aria-describedby`.
- Toggles use `role="switch"` and `aria-checked`.
- Minimum hit target 32px on desktop, 44px on touch.
- Never convey state by color alone.
- Add `user-select: none` to nav items, tab labels, and buttons. Allow selection in descriptions and values (paths, versions).

---

## 12. Svelte and code conventions

- One section component per topic: `settings/<Topic>Section.svelte`. Sections receive `open` and emit `toggle` only on mobile.
- Shared building blocks (create once, reuse everywhere): `SettingRow`, `SettingToggle`, `SettingSegmented`, `SettingSlider`, `SettingSelect`, `SettingReorderList`, `AdvancedGroup`, `DangerZone`. Do not hand-write row markup in section files.
- Row IDs follow `setting-<kebab-name>` (for example `setting-crossfade`). They are the `targetElementId` for search.
- Use one breakpoint constant (641px) in both JS and CSS. Clean up `matchMedia` listeners in `onMount` cleanup.
- Persist settings through the existing settings stores. Each setting has a typed key and a default in one place.
- Use `await tick()` plus `requestAnimationFrame` for scroll-after-render, not fixed `setTimeout` delays.
- Long term: define settings as data (`id`, `label`, `description`, `keywords`, `control`, `advanced`) and render both the UI and the search index from it, so they cannot drift.

---

## 13. Checklist for adding a setting

Before merging, answer yes to all:

- [ ] Could this be a smart default instead? If yes, do not add it.
- [ ] It sits in the right category from section 2, and nowhere else.
- [ ] Label is plain language; description is one sentence at 13px or larger.
- [ ] Uses the right control from section 5 and applies instantly (or has an explicit Apply with a reason).
- [ ] Rare or technical? It is under Advanced.
- [ ] Destructive? It is in the Danger zone with a confirm dialog.
- [ ] Has a search index entry with keywords and `targetElementId`.
- [ ] Text goes through `$_()` with a default.
- [ ] Works with keyboard and has an accessible name.
- [ ] Readable in dark, light, and at least one custom skin.
- [ ] Has a sensible default and works with "Reset to defaults".

---

## 14. Anti-patterns (do not ship)

- Page title repeated as a section header.
- The same link (Ko-fi, Patreon, Discord) in several places.
- Raw text fields that require a syntax (`a/b/c`, regex, delimiter strings) outside Advanced.
- Descriptions that explain both on and off states.
- Descriptions below 13px, or tinted blue at low contrast.
- Toggle plus Save button.
- Destructive buttons mixed into normal sections.
- Search results that lead to hidden or non-existent items.
- Particles, gradients, or animation behind text.
- Jargon labels: "Enable rodio backend", "Use legacy alignment behavior".
- A "More" or "Misc" category.
- Full-width rows on large monitors.
- Hardcoded colors, hardcoded strings, or per-section custom row markup.