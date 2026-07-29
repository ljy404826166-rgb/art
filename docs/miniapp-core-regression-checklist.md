# Miniapp Core Regression Checklist

## Command Checks

- [ ] `node --test miniapp/services/*.test.mjs`
- [ ] `npm run check`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `git diff --check`

## WeChat Developer Tools Checks

### Home

- [ ] Home opens without duplicate title.
- [ ] Search input stays on home page.
- [ ] Search results update while typing.
- [ ] Clearing search restores the original home sections.
- [ ] Horizontal artwork rows can be dragged left and right.
- [ ] Artwork cards keep fixed media height and width based on image ratio.
- [ ] Section "查看更多" enters the correct tag result page.

### Category

- [ ] Filters select and deselect correctly.
- [ ] Result count matches selected filter.
- [ ] Artwork cards are two-column, shadowed, and text truncates to one line.
- [ ] Reaching bottom loads more when available.

### Artwork Detail

- [ ] Detail image uses display image, not download image.
- [ ] Favorite toggles without layout shift.
- [ ] Download saves image and records history.
- [ ] Artist pill navigates to artist detail without blocking modal.
- [ ] Tag pills navigate to tag result page.

### Artists

- [ ] Artist list reads cloud data, not local eight-card fallback.
- [ ] Filters work across currently loaded cloud artists.
- [ ] Reaching bottom appends 8 artists without losing scroll position.

### Artist Detail

- [ ] Header skeleton matches artist detail page.
- [ ] Artist profile renders before related artwork load finishes.
- [ ] Related artworks load 8 at a time.
- [ ] Reaching bottom appends related artworks without resetting scroll.
