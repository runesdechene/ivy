# Atelier Boréal — Design System Prompt

> A self-contained design brief for creating interfaces with a **Nordic-artisanal-editorial** aesthetic. Copy-paste this whole file into any LLM conversation (Claude, GPT, Gemini) and ask it to design a page/component following the system. It should produce something that *feels* part of the same family.
>
> Origin : designed in April 2026 for Ivy (Runes de Chêne), a textile production SaaS. Tested and approved as visually cohesive, dense, professional, warm. Reuse freely.

---

## 1 · Philosophy

The tool disappears, the craft remains. (« L'outil disparaît, le métier reste. »)

The interface must feel like a quiet workshop — linen, warm light, something human made it. It is **not** corporate, **not** playful-cartoony, **not** mystical-celtic, **not** flat-minimal-zero-personality. It sits in the sweet spot between **scandi-modern** and **editorial-artisanal**.

**Emotional register :** calm, competent, a little literary. The user should feel respected, not infantilized.

**Adjectives that fit :** restrained, warm, dense-but-respiring, natural, craftsmanship, deliberate, honest.
**Adjectives that don't fit :** bubbly, gamified, fluorescent, brutalist, trendy, punchy.

---

## 2 · Typography

Three faces. Each has a role. **Do not** add a fourth.

| Face | Role | Notes |
|---|---|---|
| **Fraunces** | Display + italic accents | Variable font, italic especially. Use for page titles, card headers, order numbers, quantities, timestamps, anything that deserves literary character. |
| **Inter** | Body + UI | Everything functional. Labels, body text, buttons, filter chips. Weights 400/500/600/700. |
| **JetBrains Mono** | Technical codes only | SKUs, IDs, URLs, hashes. Never body text. |

**When to use Fraunces italic :** variant descriptors (`Mocha · M`), timestamps (`il y a 3 min`), quantities (`×2`), eyebrow decorations, ornamental sub-labels (`coût`, `unit.`). Italic = quiet flourish, not shouting.

**Type scale :**

| Level | Face | Size / weight | Letter-spacing | Use |
|---|---|---|---|---|
| Display 1 | Fraunces italic | 56px / 400 | -0.03em | Hero, login |
| Display 2 | Fraunces | 40px / 500 | -0.02em | Page H1 (with italic colored accent word) |
| H1 | Fraunces | 28px / 500 | -0.015em | Section titles |
| H2 | Fraunces italic | 22px / 500 | — | Sub-section |
| H3 | Inter | 17px / 600 | -0.005em | Card titles, form sections |
| Body | Inter | 14px / 400 | — | Default |
| Body SM | Inter | 13px / 400 | — | Secondary text |
| Eyebrow | Inter | 11px / 600 uppercase | 0.18em | Page label above title |
| Italic accent | Fraunces italic | 14px / 400 | — | Meta, decoration |
| Mono | JetBrains Mono | 12px / 400 | 0.02em | Technical codes |

**Rule of thumb :** when in doubt whether something is "text" or "data", use Inter. When in doubt whether it's "data" or "decoration", use Fraunces italic.

---

## 3 · Color tokens

Three families. Every color has a semantic job. Don't mix — moss is *always* the positive signal, clay is *always* the urgent signal, etc.

### Surfaces (backgrounds, layers)

```css
--cream:       #f4f0e8;  /* main app background */
--cream-soft:  #faf7ef;  /* topnav, sidebar, cards body */
--cream-warm:  #ede5d3;  /* card head, hover states */
--sand-soft:   #e6dcc7;  /* "à valider" badge fill */
```

### Ink scale (text, dividers)

```css
--ink:          #1a1f2a;  /* default body text */
--slate:        #2b3440;  /* titles, primary CTA, active nav */
--slate-soft:   #556070;  /* secondary text */
--slate-muted:  #8b95a3;  /* metadata, dates */
--divider:         rgba(43,52,64,0.10);  /* 1px borders */
--divider-strong:  rgba(43,52,64,0.18);  /* hover borders, buttons */
```

### Accents (semantic meaning)

```css
--moss:      #6b7a55;  /* positive: success, active, progress, value */
--moss-soft: #8a9a73;
--moss-bg:   #eaeee0;  /* moss badge fill */
--clay:      #b38566;  /* soft alerts, urgent-ish */
--clay-bg:   #f2e1d3;
--rust:      #a04b3d;  /* errors, destructive, negative adjustments */
--plum:      #7a5b72;  /* metafield category ONLY (printing, embroidery, finish) */
--plum-bg:   #ede2e9;
--sand:      #d4c5a9;  /* stock orders, warm neutrals */
```

**Rule :** if you need a 4th accent, stop and reuse. The palette is deliberately narrow.

**Don't :** pure black (#000), pure white (#fff), saturated Material-style blue/green/red. Every color in the system sits in a muted, warm-shifted register.

---

## 4 · Mark / logo approach

The mark is a **wordmark + dot**. No icon. The dot is the leaf.

- Typeface : Fraunces italic, weight 400–500 depending on size
- The word : `Ivy` (or any short brand name — one syllable works best)
- The dot : `6px` circle in `--moss`, positioned as a baseline period, slightly raised (`top: -2px` at 30px font-size, scale proportionally)

**Sizes :**
- XL : 64px (login / hero)
- M : 30–36px (topnav)
- S : 24px (inline, footer)

**Lockup with parent brand :** if there's a parent company, add `par [Parent]` in Inter 10px uppercase, letter-spacing 0.14em, slate-muted, after the mark. On printed outputs (invoices, production sheets), inverse the hierarchy : parent dominant, wordmark discreet as "via [App]".

---

## 5 · Components

### Buttons

Four variants, three sizes. Border-radius 8px.

| Variant | Background | Text | When |
|---|---|---|---|
| Solid | `--slate` | `--cream` | Primary action (one per section) |
| Ghost | transparent + `--divider-strong` border | `--slate` | Secondary action |
| Moss | `--moss` | `--cream` | Positive action (sync, validate) |
| Danger | `--rust` | `--cream` | Destructive |

Sizes : SM 5×11px, MD (default) 8×16px, LG 11×22px. Icon-only : 32×32 square, 8px radius, transparent → `--cream-warm` on hover.

**Rule :** max ONE solid button per toolbar row. More than 3 actions → solid + ghost + kebab.

### Badges (status)

```
Moss bg+text = Payée / Validée / Ajoutée
Clay         = Urgent
Sand         = À valider / En attente
Slate        = Archivée / Terminée inerte
Plum         = Imprimée / État impression
```

Font : 11px / 600, padding 3×9, radius 6px, letter-spacing 0.02em.

### Tag pills (external tags, e.g. Shopify tags)

Dashed border, very low contrast :
- `background: rgba(43,52,64,0.06)` · `color: --slate-soft` · `border: 1px dashed rgba(43,52,64,0.15)`
- Font 10.5px / 500, lowercase, radius 4px

This is distinct from badges — tags are *imported data*, badges are *app status*.

### Meta chips (metafields, technical specs)

Plum family. The **key** is Fraunces italic (`Recto :`), the **value** is Inter (`DTG-CUI`). Combined in one chip:

```html
<span class="meta-chip">
  <strong>Recto :</strong>DTG-CUI
</span>
```

Style : `background: --plum-bg; color: --plum; padding: 2px 8px; radius: 5px; font-size: 10.5px.`

### SKU / code chips

JetBrains Mono, tiny, very discrete :
- `background: rgba(43,52,64,0.05)` · `color: --slate-soft` · `padding: 2px 7px; radius: 4px; letter-spacing: 0.04em`.

### Filter chips (tabs as pills)

Pill shape (`radius: 999px`). Active = `--slate` bg + `--cream` text. Inactive = transparent → `--cream-warm` on hover. Always followed by an italic count (Fraunces italic) : `Toutes 12`.

### Inputs

- Standard : 7×14 padding, `--cream` bg, 1px `--divider` border, 8px radius
- Pill : same but `radius: 999px` (for search, shop selectors)
- Numeric : short (80px min-width), right-aligned, Fraunces italic font
- **Focus :** border becomes `--moss`, bg becomes white

### Checkbox

18×18, radius 5px, 1.5px `--divider-strong` border, white bg. Checked state : `--moss` fill + `--cream` check icon. No intermediate states — either crossed or not.

### Progress bar

Height 6px, `--cream-warm` track, radius 999px. Fill = linear gradient `--moss → --moss-soft`, left-to-right. No animation required.

### Dropdown (kebab menu)

- Trigger : 32×32 icon button with three vertical dots
- Panel : white bg, 1px `--divider` border, 10px radius, `0 12px 32px rgba(43,52,64,0.08)` shadow
- Items : 8×12 padding, 13px text, hover `--cream-warm`
- Destructive items : `--rust` color, with a `--divider` separator above them

### Nav items (sidebar)

Non-active : transparent → `--cream-warm` on hover, slate-soft text.
Active : `--moss-bg` background, `--moss` text, **600 weight**, + a 3px `--moss` bar on the left edge (absolute positioned `::before`).

### Product thumbnails

48–54px square, radius 10px, 1px `--divider` border, inset 1px white highlight.

**If no image available :** use a color gradient matching the product variant color. E.g. variant `Mocha` → `linear-gradient(135deg, #8b6b4e 0%, #6a4e35 100%)`. Adds a fabric-swatch texture overlay : `repeating-linear-gradient(45deg, transparent 0 2px, rgba(255,255,255,0.04) 2px 4px)`.

### Cards (content blocks)

Three strata, same family :

```
card-head:  background: --cream-warm  (slightly darker, "label zone")
card-body:  background: --cream-soft  (content)
card-foot:  background: --cream       (neutral, separator actions)
```

Border : 1px `--divider`, radius 14px. Hover : `translateY(-2px)` + `0 8px 24px rgba(43,52,64,0.06)` + border `--divider-strong`.

---

## 6 · Density & spacing

Base unit : **4px**. Scale :

```
xs:   4px   (gap intra-item)
sm:   8px   (gap chip, checkbox ↔ label)
md:  12px   (button padding horizontal, nav item padding)
base:16px   (card body padding)
lg:  20px   (gap between grid cards)
xl:  32px   (topnav horizontal padding)
2xl: 44px   (content area padding)
```

### Border radius scale

```
xs:   4px   (tag-pill, sku-chip)
sm:   6px   (badge)
md:   8px   (button, input, nav-item)
lg:  10px   (thumb, dropdown)
xl:  14px   (card)
pill:999px  (filter-chip, search, shop-selector)
```

**Rule :** elements that "hold data" get larger radii; elements that "label data" get smaller. A card (xl) holds items (none visually) whose chips (xs) label their data.

---

## 7 · Motion

Transitions are **fast and boring**. The app is a workshop, not a demo.

- Hover nav → 150ms ease (color, background)
- Hover card → 200ms ease (translateY, shadow)
- Input focus → 150ms ease (border color)
- Click button → instant, no transition

**Nothing below 150ms. Nothing above 300ms.** No spring physics, no bounces, no easing cubics exotiques except for the card hover.

---

## 8 · Pitfalls to avoid

| ❌ Don't | ✅ Do |
|---|---|
| Add a 4th font | Reuse Fraunces italic for flourish |
| Add a 5th accent color | Reuse existing tokens with opacity |
| Use pure `#000` or `#fff` | `--ink` / `--cream-soft` |
| Use Material-style blue/green | Stick to warm-shifted palette |
| Use ALL CAPS for body | Only eyebrows + tag pills get caps |
| Use emojis as icons | Use Tabler / Phosphor line icons, 16–18px, 2px stroke |
| Stack 5 buttons in a row | One solid primary + ghost(s) + kebab for rest |
| Show raw prices in production views | Show *cost* (warmer semantic, moss color) |
| Center-align body text | Left-align. Centered = serif italic quotes only |
| Use drop shadows liberally | Shadows only on card hover + dropdowns |
| Use gradient backgrounds on buttons | Flat slate. Gradient reserved for progress bars |

---

## 9 · How to use this prompt

Paste this file (or the relevant sections) into an LLM conversation, then add your specific request. Example :

> Using the "Atelier Boréal" design system above, design a dashboard page for a **book inventory app**. The page shows a grid of 6 book cards, each with a cover thumbnail, title, author, reading progress, and a few status badges ("Lu", "À lire", "Prêté"). Include a topnav with a wordmark, a sidebar with nav items, and a filter bar. Output self-contained HTML + CSS.

The LLM will produce something that shares the DNA — same palette, same typographic feel, same restraint. Adjust by telling it which elements to emphasize (e.g. "lean more editorial", "tighter density", "swap plum for sage").

### Quick checklist before submitting LLM output

- [ ] Fraunces used for titles and italic accents only
- [ ] Inter is the default
- [ ] Palette stays in the 3 families (surfaces/ink/accents)
- [ ] Moss = positive, clay = urgent, rust = error, plum = category
- [ ] No `#000` or `#fff`
- [ ] Cards have head/body/foot strata
- [ ] Max one solid button per toolbar
- [ ] Motion is 150–300ms
- [ ] Wordmark has a dot (the leaf)
- [ ] Border radius scales with content "weight"

---

*Designed for Ivy · Runes de Chêne · April 2026. Free to reuse and adapt.*
