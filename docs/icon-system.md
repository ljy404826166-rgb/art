# Icon System

## Source

P0/P1 icons use [Lucide Icons](https://github.com/lucide-icons/lucide), a restrained line icon set suitable for the miniapp's art archive visual language.

License: ISC License. A local copy is stored at `miniapp/assets/icons/lucide/LICENSE-lucide.txt`.

## P0 Icons

| Use | Lucide icon | Local asset |
| --- | --- | --- |
| Tab: Home | `house` | `miniapp/assets/tab/home.png`, `miniapp/assets/tab/home-active.png` |
| Tab: Category | `grid-2x2` | `miniapp/assets/tab/category.png`, `miniapp/assets/tab/category-active.png` |
| Tab: Artists | `palette` | `miniapp/assets/tab/artists.png`, `miniapp/assets/tab/artists-active.png` |
| Tab: Profile | `circle-user-round` | `miniapp/assets/tab/profile.png`, `miniapp/assets/tab/profile-active.png` |
| Search | `search` | `miniapp/assets/icons/lucide/svg/search.svg` |
| Filter | `sliders-horizontal` | `miniapp/assets/icons/lucide/svg/sliders-horizontal.svg` |
| Expand | `chevron-down` | `miniapp/assets/icons/lucide/svg/chevron-down.svg` |
| More link | `chevron-right` | `miniapp/assets/icons/lucide/svg/chevron-right.svg` |

## Color Rules

- Tab normal: `#7a736d`
- Tab active: `#111111`
- In-page action icons: `#202124`
- Expand chevron: `#1c1d1f`

The tabBar uses local PNG files for WeChat compatibility. In-page icons use local SVG files first; if device testing shows compatibility issues, export the same SVGs to PNG without changing layout.

## P1 Scope

P1 adds local Lucide assets for detail actions, profile menu rows, state components and artist-detail auxiliary labels.

| Use | Lucide icon | Local asset | Status |
| --- | --- | --- | --- |
| Detail back | `arrow-left` | `miniapp/assets/icons/lucide/svg/arrow-left.svg` | Asset reserved; current page uses native navigation |
| Detail favorite | `heart` | `miniapp/assets/icons/lucide/svg/heart.svg` | Asset reserved; no custom favorite button in current page |
| Detail download | `download` | `miniapp/assets/icons/lucide/svg/download.svg` | Profile download row uses it; detail download action is not present |
| Detail share | `share-2` | `miniapp/assets/icons/lucide/svg/share-2.svg` | Asset reserved; no custom share button in current page |
| Detail more | `more-horizontal` | `miniapp/assets/icons/lucide/svg/more-horizontal.svg` | Asset reserved; no custom more button in current page |
| Detail info | `info` | `miniapp/assets/icons/lucide/svg/info.svg` | Used in artwork description and About row |
| Detail close | `x` | `miniapp/assets/icons/lucide/svg/x.svg` | Asset reserved; no custom close button in current page |
| Profile personal data | `user` | `miniapp/assets/icons/lucide/svg/user.svg` | Used |
| Profile verification | `badge-check` | `miniapp/assets/icons/lucide/svg/badge-check.svg` | Used |
| Profile security | `shield` | `miniapp/assets/icons/lucide/svg/shield.svg` | Used |
| Profile membership | `star` | `miniapp/assets/icons/lucide/svg/star.svg` | Used |
| Profile preferences | `settings` | `miniapp/assets/icons/lucide/svg/settings.svg` | Used |
| Profile help | `circle-help` | `miniapp/assets/icons/lucide/svg/circle-help.svg` | Used |
| Profile logout | `log-out` | `miniapp/assets/icons/lucide/svg/log-out.svg` | Used |
| EmptyState | `image-off` | `miniapp/assets/icons/lucide/svg/image-off.svg` | Used by default |
| No search results | `search-x` | `miniapp/assets/icons/lucide/svg/search-x.svg` | Used on home search empty state |
| ErrorState | `circle-alert` | `miniapp/assets/icons/lucide/svg/circle-alert.svg` | Used by default |
| LoadingMore | `loader-circle` | `miniapp/assets/icons/lucide/svg/loader-circle.svg` | Used |
| Artist-detail biography | `book-open` | `miniapp/assets/icons/lucide/svg/book-open.svg` | Used for active period |
| Artist-detail region | `map-pin` | `miniapp/assets/icons/lucide/svg/map-pin.svg` | Used |
| Artist-detail style | `palette` | `miniapp/assets/icons/lucide/svg/palette.svg` | Reuses P0 asset |
| Artist-detail works | `image` | `miniapp/assets/icons/lucide/svg/image.svg` | Used |

## P2 Scope

P2 can replace future custom detail action buttons if they are added, profile statistic icons, and any icon introduced by download or account features. Keep using local assets only and do not route display images through `download_url`.
