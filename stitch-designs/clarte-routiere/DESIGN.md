---
name: Clarté Routière
colors:
  surface: '#f7f9ff'
  surface-dim: '#d7dadf'
  surface-bright: '#f7f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f4f9'
  surface-container: '#ebeef3'
  surface-container-high: '#e5e8ee'
  surface-container-highest: '#e0e3e8'
  on-surface: '#181c20'
  on-surface-variant: '#434750'
  inverse-surface: '#2d3135'
  inverse-on-surface: '#eef1f6'
  outline: '#737781'
  outline-variant: '#c3c6d2'
  surface-tint: '#335f9d'
  primary: '#00376f'
  on-primary: '#ffffff'
  primary-container: '#1f4e8c'
  on-primary-container: '#9ec1ff'
  inverse-primary: '#a9c7ff'
  secondary: '#835500'
  on-secondary: '#ffffff'
  secondary-container: '#feae2c'
  on-secondary-container: '#6b4500'
  tertiary: '#00420c'
  on-tertiary: '#ffffff'
  tertiary-container: '#005c15'
  on-tertiary-container: '#82d37d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#a9c7ff'
  on-primary-fixed: '#001b3d'
  on-primary-fixed-variant: '#144684'
  secondary-fixed: '#ffddb4'
  secondary-fixed-dim: '#ffb955'
  on-secondary-fixed: '#291800'
  on-secondary-fixed-variant: '#633f00'
  tertiary-fixed: '#a3f69c'
  tertiary-fixed-dim: '#88d982'
  on-tertiary-fixed: '#002204'
  on-tertiary-fixed-variant: '#005312'
  background: '#f7f9ff'
  on-background: '#181c20'
  surface-variant: '#e0e3e8'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-lg-bold:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-md-bold:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system is engineered for utility, immediate trust, and high legibility under harsh equatorial sunlight. Tailored for young learner drivers and vocational administrators across Cameroon, the interface balances institutional authority with accessible warmth. 

The aesthetic adheres to **Corporate / Modern Utility**: clean tactile surfaces, crisp structural boundaries, generous touch targets, and unambiguous visual hierarchies. By stripping away non-essential decoration and emphasizing clear status communication, the system minimizes cognitive load and data ambiguity. Tone of voice in copy is direct, welcoming, and clear in French, prioritizing clarity over technical jargon.

## Colors

The palette is anchored by a high-contrast deep blue (`#1F4E8C`) and backed by functional semantic tiers engineered for instant comprehension in field conditions. 

### Core Palette
- **Primary Deep Blue (`#1F4E8C`):** Institutional brand core, primary actions, active navigation states, and the 'Essai gratuit' status marker.
- **Accent Amber (`#F5A623`):** Key highlights, secondary calls to action, and student progress alerts.
- **Neutral Dark (`#212529`):** High-contrast primary text on bright backgrounds to guarantee sunlight legibility (WCAG AAA contrast against white).
- **Neutral Muted (`#6C757D`):** Secondary metadata, helper text, and the 'Pas encore payé' default status indicator.
- **Background Light Gray (`#F8F9FA`):** Outdoor anti-glare canvas backing.
- **Surface White (`#FFFFFF`):** High-clarity tactile cards and input fields.

### Status Conventions & Semantics
Status badges and indicators follow strict real-world business conventions:
- **Green (`#2E7D32`):** 'À jour' (paid, compliant, validated).
- **Orange (`#ED6C02`):** 'Échéance proche' (deadline approaching within 7 days).
- **Red (`#D32F2F`):** 'En retard' (overdue balance, missing document).
- **Blue (`#1F4E8C`):** 'Essai gratuit' (trial or diagnostic phase).
- **Gray (`#6C757D`):** 'Pas encore payé' (unbilled, pending activation).

### Financial Formatting
All currency values must follow central African standards with non-breaking thin spaces: `50 000 FCFA`.

## Typography

Typography relies entirely on **Inter** for its neutral legibility, tall x-height, and open counters, which combat low-end screen rendering degradation and outdoor glare.

### Scaling & Legibility Strategy
- **Headlines:** Use tight tracking (`-0.01em` to `-0.02em`) and strong weights (`600`, `700`) to anchor scanning eyes.
- **Body Text:** Never drop below `14px` (`body-md`) for operational text. Core reading copy sits comfortably at `16px` (`body-lg`).
- **Numbers & Currencies:** Use tabular figures (`tnum`) for monetary outputs like `50 000 FCFA` to preserve column alignment inside payment histories.
- **Labels & Micro-copy:** Badges and navigation elements use `label-md` and `label-sm` with slightly loosened tracking for instant readability when printed or viewed in bright environments.

## Layout & Spacing

The layout is built around a rigorous 8px spatial grid, optimized primarily for a 390px mobile viewport with fluid responsiveness across tablet and desktop administration panels.

### Layout Philosophy
- **Canvas Margins:** Fixed `16px` (`margin`) outer edge gutters ensure zero content clipping on mobile displays with curved bezels.
- **Vertical Rhythm:** Structural stacks use `space-md` (`16px`) between interactive cards, and `space-xl` (`32px`) between major contextual modules.
- **Touch-First Guardrails:** Every interactive element must uphold an absolute minimum physical touch target of `48px × 48px`, regardless of the visual glyph size.
- **Reflow:** On screens wider than 640px, the single-column feed reflows into a 2-column asymmetric grid, reserving the right rail for student dossier summaries and schedule logs.

## Elevation & Depth

To maintain visual contrast in bright outdoor lighting, depth is established through **tactile surface elevation paired with subtle contrast borders** rather than diffuse, washed-out shadows.

### Elevation Hierarchy
1. **Level 0 (Canvas):** Flat `#F8F9FA`. Base layer for all non-interactive backgrounds.
2. **Level 1 (Cards & Modules):** Pure white (`#FFFFFF`) surface combined with a crisp 1px border (`#E5E7EB`) and a soft downward shadow: `0 2px 4px rgba(31, 78, 140, 0.04), 0 1px 2px rgba(0, 0, 0, 0.04)`.
3. **Level 2 (Interactive Floating Elements & Bottom Navigation):** Raised white surface with `0 4px 12px rgba(31, 78, 140, 0.08), 0 2px 4px rgba(0, 0, 0, 0.03)` with a top border line (`#E5E7EB`).
4. **Level 3 (Modals, Action Sheets & Offline Banner):** Prominent elevation using `0 12px 24px rgba(15, 23, 42, 0.14)` to focus user attention above dimming overlays.

## Shapes

The shape system adopts a roundedness factor of **2 (Rounded)**, creating approachable, modern cards with a canonical 16px corner radius (`rounded-lg` / `1rem`).

### Corner Radius Mapping
- **Cards, Sheets & Containers:** `16px` (`1rem`) ensures strong card definition while preserving an accessible, soft mobile form factor.
- **Buttons & Text Inputs:** `12px` to `16px` to harmonize with primary cards.
- **Status Badges & Chips:** Full pill radius (`9999px`) to distinguish categorical metadata from interactive rectangular blocks.

## Components

### Buttons
- **Primary:** Background `#1F4E8C`, text `#FFFFFF`, height `52px` (minimum `48px`), border radius `16px`, font `body-lg-bold`. Active state deepens to `#163A69`.
- **Secondary:** Surface `#FFFFFF`, border `1.5px solid #1F4E8C`, text `#1F4E8C`, height `52px`.
- **Accent/Action:** Background `#F5A623`, text `#212529`, used for urgent conversions like "Réserver une leçon".

### Cards
- Container built with `#FFFFFF` fill, 16px corner radius, Level 1 shadow, and `16px` internal padding (`space-md`). 
- Dossier cards group student identity, license category (e.g., "Permis B"), upcoming driving hours, and financial status badges into organized zones separated by hairline dividers (`#F1F3F5`).

### Status Badges
- Pill-shaped (`rounded-full`), `6px` vertical by `12px` horizontal padding, `label-sm` bold uppercase text.
- **À jour:** Background `#E8F5E9`, text `#2E7D32`.
- **Échéance proche:** Background `#FFF3E0`, text `#ED6C02`.
- **En retard:** Background `#FFEBEE`, text `#D32F2F`.
- **Essai gratuit:** Background `#E3F2FD`, text `#1F4E8C`.
- **Pas encore payé:** Background `#F8F9FA`, border `1px solid #CED4DA`, text `#6C757D`.

### Input Fields & Controls
- Standard height `52px` to guarantee 48px+ touch compliance. Background `#FFFFFF`, 1px border `#CED4DA`, radius `12px`.
- Focus ring: `2px solid #1F4E8C` with `2px` offset.
- Floating or distinct top-aligned labels in `14px` bold text to prevent disappearing placeholders. Numeric inputs for phone numbers use standard Cameroon tel formatting (`+237 6XX XX XX XX`).

### Bottom Tab Navigation Bar
- Fixed at viewport bottom with safe-area padding. Background `#FFFFFF`, Level 2 shadow, height `64px`.
- Four persistent navigation hubs: *Accueil*, *Planning*, *Paiements*, *Mon Dossier*.
- Active icon and label tinted `#1F4E8C`; inactive states rendered in `#6C757D` with clean 2px outline icons.

### Offline & Sync Banner
- Sticky banner rendered directly below top bar or at canvas summit.
- Offline state: Soft amber background `#FFF3E0`, border-bottom `1px solid #FFE0B2`, text `#ED6C02`, displaying clear offline indicator: "Mode hors-ligne — Vos modifications seront synchronisées dès le retour du réseau."