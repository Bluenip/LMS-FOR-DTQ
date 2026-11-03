---
name: Vietnamese Moral Education LMS
colors:
  surface: '#fff8f4'
  surface-dim: '#e0d9d3'
  surface-bright: '#fff8f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#faf2ec'
  surface-container: '#f4ece7'
  surface-container-high: '#eee7e1'
  surface-container-highest: '#e9e1db'
  on-surface: '#1e1b18'
  on-surface-variant: '#57423c'
  inverse-surface: '#33302c'
  inverse-on-surface: '#f7efe9'
  outline: '#8b716a'
  outline-variant: '#dec0b7'
  surface-tint: '#a53c19'
  primary: '#781f00'
  on-primary: '#ffffff'
  primary-container: '#9a3412'
  on-primary-container: '#ffbda9'
  inverse-primary: '#ffb59f'
  secondary: '#9b4500'
  on-secondary: '#ffffff'
  secondary-container: '#fd8a42'
  on-secondary-container: '#682c00'
  tertiary: '#004a1e'
  on-tertiary: '#ffffff'
  tertiary-container: '#00642c'
  on-tertiary-container: '#7ee092'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbd1'
  primary-fixed-dim: '#ffb59f'
  on-primary-fixed: '#3a0a00'
  on-primary-fixed-variant: '#842503'
  secondary-fixed: '#ffdbca'
  secondary-fixed-dim: '#ffb68e'
  on-secondary-fixed: '#331200'
  on-secondary-fixed-variant: '#763300'
  tertiary-fixed: '#95f8a7'
  tertiary-fixed-dim: '#79db8d'
  on-tertiary-fixed: '#00210a'
  on-tertiary-fixed-variant: '#005323'
  background: '#fff8f4'
  on-background: '#1e1b18'
  surface-variant: '#e9e1db'
typography:
  display-lg:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
  display-lg-mobile:
    fontFamily: Newsreader
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
  headline-lg:
    fontFamily: Newsreader
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: Newsreader
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  headline-sm:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  label-md:
    fontFamily: Be Vietnam Pro
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  label-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  gutter-desktop: 1.75rem
  margin: 1rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system serves a traditional Vietnamese moral and character education learning management platform, drawing heritage aesthetics from classic moral scripture portals (such as *Đệ Tử Quy*) while adopting the streamlined instructional usability of Google Classroom and SHub. The brand communicates filial reverence, disciplined scholarly focus, ethical balance, and communal warmth.

The visual direction merges **Traditional East Asian Scholasticism** with **Modern EdTech Utility**:
- Textured, parchment-tinted surfaces replace clinical sterile whites, evoking handmade paper, lacquered desks, and study chambers.
- Crisp structured card containers and actionable tools provide clarity for curriculum tracking, homework submissions, and pedagogical resources.
- The interface avoids heavy antique clutter, balancing formal typography with clean, accessible interactions suited for multi-generational users (teachers, students, and parents).

## Colors

The palette balances warm terracotta clay with golden lacquer and jade accents against sunlit parchment:

- **Primary (`#9A3412` - Terracotta Rust)**: Used for key calls to action, active navigation tabs, class title banners, and primary submission buttons. Evokes temple tiles and traditional Vietnamese terracotta seals.
- **Secondary (`#B45309` - Imperial Amber / Gold)**: Applied to class code chips, badges, featured quotes (*Tâm Đắc*), and highlighted announcements.
- **Tertiary (`#15803D` - Deep Jade)**: Connotes ethical vitality, growth, and moral rectitude; utilized for completion checkmarks, grade metrics, active status pills, and verified mentor labels.
- **Neutral (`#44403C` - Warm Lacquer Timber)**: Delivers warm, readable body copy without the harshness of pure black. Paired with background tints of parchment (`#FDFBF7`) and light straw borders (`#E7DEC8`).

## Typography

The typography couples the intellectual dignity of classic Vietnamese literature with functional, high-density LMS utility:

- **Display & Headlines (`Newsreader`)**: A literary serif that renders Vietnamese diacritics with grace. Reserved for platform headings, lesson titles, scriptural excerpts, and ceremonial banners.
- **Body & Functional UI (`Be Vietnam Pro`)**: A contemporary sans-serif engineered natively for Vietnamese typography. It handles dense assignment instructions, tabular submission logs, and student feedback with legibility.
- Line heights in body copy maintain an open rhythm (`1.57` to `1.625`) to prevent diacritic clashing in Vietnamese text strings (e.g., dấu hỏi, ngã, nặng).

## Layout & Spacing

The layout employs a responsive 12-column grid system built around structured academic views:

- **Canvas & Grids**:
  - **Desktop (>= 1200px)**: 12 columns with 28px (`gutter-desktop`) gutters and 40px outer margins. Classes, resources, and submissions arrange into 3-column cards or split 8/4 focus layouts (e.g., lecture video on the left, discussion and submission notes on the right).
  - **Tablet (768px - 1199px)**: 8 columns with 20px gutters; side drawers convert to overlay panels.
  - **Mobile (< 768px)**: 4 columns with 16px margins, stacking classroom tiles and nesting navigation inside persistent headers and bottom role docks.
- **Content Density**: Compact card layouts allow scanning across multiple courses, assignments, and recitation audios without excessive vertical scrolling.

## Elevation & Depth

Visual hierarchy relies on warm tonal layering and soft tactile borders rather than cold drop shadows:

- **Surface Layers**:
  - `Base Canvas`: Parchment Sand (`#FDFBF7`)
  - `Card / Container Tier`: Solid Clean Ivory (`#FFFFFF`) with a 1px warm sand border (`#E7DEC8`)
  - `Recessed Tier` (code blocks, audio players, metadata boxes): Soft Bamboo Wash (`#F7F3EB`)
- **Shadow Philosophy**: Ambient shadows use a warm brown cast (`rgba(68, 64, 60, 0.06)`) with broad diffusion. Floating modals and assignment drawers use a 24px blur with 12px vertical offset over a warm translucent backdrop scrim (`rgba(41, 37, 36, 0.45)`).

## Shapes

A balanced `roundedness: 2` (base 8px / `0.5rem`) provides soft discipline:

- **Class Cards & Video Shells**: 8px corner radius keeps corners orderly and aligned.
- **Header Banners**: 10px to 12px corners on desktop banners give cards an architectural feel.
- **Role Switchers & Badges**: Fully rounded pill shapes (`9999px`) provide clear differentiation for interactive tags and class code pills.

## Components

### Buttons
- **Primary**: Solid Terracotta (`#9A3412`) background with white text, 8px border radius, and bold Be Vietnam Pro type. Hover transitions to `#7C2D12`.
- **Secondary / Academic**: Outlined in Warm Amber (`#B45309`) with a 1px border over `#FDFBF7`, turning into a subtle amber wash on hover.
- **Text Action**: Lacquer timber text with an amber underline on hover, used for "Xem chi tiết" (View details) links.

### Class Cards & Header Banners
- Styled after modern LMS platforms: Top header banner displays warm woodblock or calligraphic patterns tinted with terracotta or amber, overlaid with white Newsreader class titles and student counts.
- Card bodies sit on ivory with 1px border (`#E7DEC8`), displaying teacher profile avatars, assignment count indicators, and a footer shortcut button.

### Class Code Chips
- Compact pill-shaped containers (`#FEF9C3` with border `#FDE047`) displaying monospaced class codes with a one-click copy icon.

### YouTube Video & Audio Recitation Players
- Wrapped in clean parchment-bordered containers (`#E7DEC8`).
- Video aspect ratio is fixed to 16:9 with rounded top edges; lower bar provides chapter markers, verse citations, and transcript toggle tabs.

### Assignment Submission Drawers
- Slides in from the right edge on desktop or bottom sheet on mobile.
- Features rich text instruction blocks, a jade verification chip ("Đã nộp" / "Chưa nộp"), file attachment drag zones, and a prominent terracotta submit button.

### Role Switcher (Teacher / Student)
- Segmented pill switch housed in `#F5F0E8` with a smooth slider effect: active role toggles between "Giảng Viên" (Teacher) and "Học Viên" (Student), shifting permission chips and view filters instantly.