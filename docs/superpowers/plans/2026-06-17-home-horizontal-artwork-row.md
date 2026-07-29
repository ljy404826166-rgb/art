# Home Horizontal Artwork Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile home-page horizontal artwork list with a focused component that provides video-like drag scrolling while preserving the existing artwork-card visual rules.

**Architecture:** Add a local `horizontal-artwork-row` component. The component owns horizontal gesture handling and track translation; existing `artwork-card` remains responsible for card sizing, image mode, shadows, title truncation, and tap-to-detail behavior.

**Tech Stack:** Native WeChat Mini Program components, WXML/WXSS/JS, existing `artwork-card`, existing `ArtworkImage` thumbnail/display split.

---

## File Structure

- Create: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row.json`
  - Declares the component and imports `artwork-card`.
- Create: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row.wxml`
  - Renders a draggable viewport, a horizontal track, and artwork cards.
- Create: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row.wxss`
  - Defines viewport clipping, horizontal card spacing, and bottom padding for shadows.
- Create: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row.js`
  - Handles touch start/move/end, clamps translateX, and suppresses tap after a drag.
- Modify: `miniapp/pages/home/home.json`
  - Register `horizontal-artwork-row`.
- Modify: `miniapp/pages/home/home.wxml`
  - Replace inline `scroll-view` rows with `horizontal-artwork-row`.
- Modify: `miniapp/pages/home/home.js`
  - Remove home-level manual horizontal scroll handlers; keep `openDetail` and section data.
- Modify: `miniapp/pages/home/home.wxss`
  - Remove row-only styles no longer used by the page.

## Task 1: Add Horizontal Artwork Row Component

- [ ] Create component files under `miniapp/components/horizontal-artwork-row/`.
- [ ] Component props:
  - `items`: array of artworks.
  - `sectionIndex`: numeric index, used only for stable dataset context.
- [ ] Component events:
  - `tapcard` with `{ id }`, forwarded from child `artwork-card`.
- [ ] Gesture behavior:
  - On `touchstart`, store start point and current translate.
  - On `touchmove`, if horizontal movement dominates vertical movement, update `translateX`.
  - Clamp `translateX` between `0` and `minTranslate`.
  - On drag over 8px, set `dragging` and suppress tap for 250ms.
- [ ] Measurement behavior:
  - Use `createSelectorQuery().in(this)` to measure `.artwork-row-viewport` and `.artwork-row-track`.
  - Re-measure after initial render and after image/card layout changes.
  - No fixed card sizing is introduced.

## Task 2: Wire Component Into Home Page

- [ ] Register component in `miniapp/pages/home/home.json`.
- [ ] Replace the home page row `scroll-view` with:

```xml
<horizontal-artwork-row
  items="{{item.items}}"
  section-index="{{sectionIndex}}"
  bindtapcard="openDetail"
/>
```

- [ ] Remove home-level row touch handlers and `scroll-left` state.
- [ ] Keep section titles, search bar, and “查看更多” unchanged.

## Task 3: Verify Behavior

- [ ] Run syntax checks:

```powershell
node --check miniapp\components\horizontal-artwork-row\horizontal-artwork-row.js
node --check miniapp\pages\home\home.js
```

- [ ] Run project checks:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
```

- [ ] Manual WeChat DevTools verification:
  - Recompile miniapp.
  - Drag horizontally on the first home artwork row.
  - Confirm card tap still opens detail.
  - Confirm drag does not accidentally open detail.
  - Confirm card size, shadow, image behavior remain unchanged from before this component swap.

## Risk Controls

- Do not change `artwork-card` size constants, shadow CSS, image mode, or text truncation.
- Do not modify Supabase/CloudBase data access.
- Do not modify category, artist, profile, or detail pages.
- If the component still cannot drag in DevTools, stop and inspect whether touch events fire in the component before making another UI change.
