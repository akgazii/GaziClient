# GaziClient - decisions

1. Shell: Rust with `tao` (window) + `wry` (WebView2), no Electron and no Tauri build step. Small exe (~1.5 MB), no bundled Chromium. Build with the MSVC toolchain (`rustup override` is set in this folder; VS 2022 Build Tools installed).
2. The game page (https://deeeep.io) is loaded directly. All in-game code (plugin API, menu, theme) is one init script built from `runtime/` and injected at document start.
3. Plugin compatibility target: Blockyfish plugin API (`blockyfish`, `plugin`, `hook/getnative/ishooked/restore/reflect`, `PIXI`, `gameState`, `React`, `ReactDOM`, Deeeepio components, `ui`, `router`, `capturer`). Same `new Function` parameter list as Blockyfish 4.5.2. Plugins run on page load; one that throws before the game exists is retried once at the first `gameInit`.
4. The game object is found through the page's state stores (`#app.__vue_app__.config.globalProperties.$simpleState.states`, the one whose `$state` has `gameManager`), no game bundle patching. `gameState.token` maps to `guToken`. `gameManager` is null on the menu and only exists after Play.
5. `encodeBytePacket` copies the game's own encoder: `chr(id)*3 + data`, XOR with token, base64, framed as `[VerifiedAction, ...b64, id]`.
6. PIXI classes are taken from live objects (stage tree, batch renderer) on first use.
7. Storage format is identical to Blockyfish `plugin-data.json` (keys `official-plugins/<id>.js`, `custom-plugins/<file>.js`), so Blockyfish data imports with a straight copy.
8. Disk writes are batched: the runtime debounces per plugin (400 ms), Rust flushes dirty state every 1.5 s and on exit, atomic rename.
9. Registry updates download in parallel (8 workers) and only when the version changed. Several registries supported; a local dev folder (`registry.json` + files) overrides them. (Currently both are off in the user's config: only custom plugins are used.)
10. `plugin.saveFile` writes real files (Documents\GaziClient\<folder>) instead of browser downloads.
11. Data lives in `%APPDATA%\GaziClient` (config.json, plugin-data.json, plugins\official, plugins\custom, backgrounds, webview profile, backup-* folders).
12. `GAZI_DEBUG_PORT=<port>` env var enables the WebView2 remote debugging port for testing. Every WebView must get the same browser args, or WebView2 refuses to create it.
13. UI frames are 9-slice from the user's `gui.png` (native copy `assets/frame.png`, 49x48, slice 4, edge 2 px). Colour variants are made at runtime by swapping the template's two colours (`buildFrames` in runtime.js) and pre-scaled 2x with nearest neighbour, then used 1:1 as `border-image` (slice 8, width 8px, `border-width: 0` so layout does not change). Browsers ignore `image-rendering: pixelated` for border-image, which is why the pre-scaling is needed. CSS vars `--gz-f-<name>`.
14. Pixel art must sit on whole pixels: mode buttons are fixed to 54 px, the logo box to an integer size, and the centre column is snapped with JS (`snapToPixels`). Image-backed elements (mode buttons, play bar) are clipped to the frame shape so the notch corners stay transparent.
15. Logos are used at native size (`assets/*-1x.png`, the source art is 20 px blocks) and only integer scales: home 3x, menu 1x, buttons 33x33. `*-1x-dark.png` swaps plum to red `#C24545` and slate to light grey for dark backgrounds.
16. Ad blocker: WebView2 `WebResourceRequested` filters per ad/tracker host return 403 (`src/adblock.rs`), plus CSS that hides `.ad-block`.
17. Frameless window: own window buttons, drag on empty header area, resize edges, size/position remembered. A right-side tab rail (Plugins/Custom/Editor/Client/About) shows only on the home page (home = `.modes-row` is visible).
18. Plugin editor: separate frameless window with Monaco 0.52.2 from jsDelivr (not bundled), Blockyfish typings (`runtime/editor/blockyfish.d.ts`) for autocomplete, Ctrl+S save, Ctrl+Shift+S save and reload game.
19. Home backgrounds: images in `%APPDATA%\GaziClient\backgrounds` rotate randomly every `backgroundInterval` seconds (default 10) with a 1.5 s crossfade (two layers inside `.home-bg`). `backgroundUrls` (default: the user's 20 wallhaven links, `src/backgrounds.rs`) are downloaded on start if missing, resized to max 1920 px. No images = site default.
20. Animal pictures: `https://deeeep.io/assets/characters/<name>.png`, names from `https://api.deeeep.io/animals` (`fishLevelsData` has no names).

## Not done yet

- Discord Rich Presence
- FPS counter, announcements panel
- Exe icon resource and installer
