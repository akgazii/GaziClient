---
name: gaziclient-dev
description: How GaziClient (the Rust/WebView2 Deeeep.io client in this repo) is built and how to write, add, debug and test plugins for it. Use when working on this repo - writing a new Deeeep.io plugin, building the exe or the Android apk, adding or changing a plugin in plugins/builtin, debugging a plugin that breaks or stops after toggling, touching runtime/runtime.js (menu, plugin API, translations, client options) or src/ (IPC, config), or preparing a release.
---

# GaziClient development

GaziClient is an unofficial Deeeep.io client. A small Rust shell (`tao` window + `wry` WebView2) loads https://deeeep.io directly and injects one init script built from `runtime/`. Everything in game (plugin API, menu, theme, key list) lives in that script. Plugins are plain JavaScript using the Blockyfish plugin API, so Blockyfish plugins run unchanged.

Read `DECISIONS.md` for the why behind the design. Some of its older lines (plugin registries, downloads, news feed) describe things that were later removed: plugins are now frozen inside the exe and nothing is downloaded.

## Repo map

| Path | What it is |
|---|---|
| `src/main.rs` | Window, WebView, IPC handler (`cmd == "boot"`, `"setData"`, `"saveFile"`, ...), editor window |
| `src/plugins.rs` | Plugin list: `BUILTIN` (GaziClient's own) and `BLOCKYFISH` (frozen copies), plus custom plugins from disk |
| `src/store.rs` | `config.json` / `plugin-data.json` in `%APPDATA%\GaziClient`, batched atomic writes |
| `src/adblock.rs`, `src/backgrounds.rs` | Ad/tracker blocking, home page backgrounds |
| `runtime/runtime.js` | The injected script: plugin API, live toggling, menu, translations, recommended setup, changelog |
| `runtime/menu.css` | Menu styles (pixel frames are 9-slice `border-image`, see DECISIONS 13-15) |
| `runtime/constants.js` | `ActionPacket`, `GeneralPacket`, `Animals`, `Emotes` ids |
| `runtime/editor/` | Plugin editor window (Monaco) and `blockyfish.d.ts`, the typed plugin API |
| `plugins/builtin/` | GaziClient's own plugins |
| `plugins/blockyfish/` | Blockyfish plugins, made by the Blockyfish devs. Do not change them; they are not under GaziClient's license |
| `android/` | Android app (one `MainActivity.java`, built without Gradle) |
| `docs/` | Website, served by GitHub Pages |
| `.github/workflows/release.yml` | Builds exe + apk on a `v*` tag push |

Every file in `runtime/` and `plugins/` is pulled into the exe with `include_str!`, so **any change there needs a rebuild**.

## Build

Windows, Rust with the MSVC toolchain:

```
cargo build --release
```

Output: `target\release\gaziclient.exe`. Close any running GaziClient first or the linker cannot overwrite the exe.

Android needs JDK 17 and the Android SDK (`platforms;android-34`, `build-tools;34.0.0`), no Gradle:

```
powershell -ExecutionPolicy Bypass -File android\build.ps1
```

It builds the exe first and takes the runtime and plugins from it, so both platforms run the same code. The first run makes a signing key in `%USERPROFILE%\.gaziclient`. Keep that folder: an apk signed with a different key cannot update an existing install.

## How plugins run

- Each plugin is wrapped with `new Function` using the same parameter list as Blockyfish 4.5.2:
  `blockyfish, plugin, {hook, getnative, ishooked, restore, reflect, Reflect, Object}, React, ReactDOM, {PIXI, gameState}, {DeeeepioCustomButton, DeeeepioButton, DeeeepioCheckbox, DeeeepioTextInput, DeeeepioDropdown, DeeeepioLoadingSpinner, Modal}, Buffer, ui, router, capturer`
- JSX is allowed: if the code is not valid JS it is compiled with sucrase first.
- **Live toggling, no reload.** Every plugin runs inside a scope (`newScope` / `disposeScope` in `runtime.js`). While plugin code runs, including later from its own timers, listeners, keybinds and hooks, the runtime records:
  - `setTimeout` / `setInterval` / `requestAnimationFrame`
  - `addEventListener` on any `EventTarget` (window, DOM, WebSocket, `blockyfish` itself)
  - `hook(...)`: the hook goes transparent at once and is taken out when nothing was hooked on top of it
  - DOM nodes added with `appendChild` / `insertBefore` / `insertAdjacentElement`
  - PIXI children added with `addChild` / `addChildAt` on any game container

  Turning the plugin off undoes all of that (`stopPlugin` → `disposeScope`). Changing a plugin's code restarts it.
- What is **not** undone: values a plugin writes straight into game objects (a name tag's `text`, a field on `inputManager`, a `window.*` global). Put those back yourself, or design so leftovers are harmless.
- **Do not mark "already hooked" on a game object** (`im.myHooked = true`). After an off/on in the same match the hook is gone but the flag is still there, so the plugin never hooks again. Keep that state in a plugin-local variable or `WeakSet`; plugin variables start fresh on every restart.
- `game` is null on the menu. It exists after the first Play: get it with `blockyfish.addEventListener("gameInit", e => game = e.game)`. A listener added when the game already exists is called right away (next tick), so a plugin turned on mid-match still gets it. `gameInit` fires again only when the game object itself is replaced, not on every respawn. Watch `game.currentScene` and `scene.myAnimals` for respawns and new matches.
- A plugin that throws before the game exists is retried once when the game starts.

## Writing a plugin

Files next to this one:
- [template.js](template.js): start here. It already has the toggle key, a setting, the `gameInit` handler, a guarded tick loop, a safe hook, the Esc pause and the status line.
- [game-reference.md](game-reference.md): the game fields the built-in plugins use (animal, entityData, fishLevelData, input, viewport, minimap, terrain), packet layouts and the deeeep.io web API. Read it before guessing field names.
- [check-plugin.js](check-plugin.js): static checks. Run it after every change:
  ```
  node .claude/skills/gaziclient-dev/check-plugin.js plugins/builtin/<id>.js
  ```
  - It reports: header, syntax with the runtime's real parameter list, keybind codes and names, `getSetting` without `registerSetting`, settings read once at the top, "hooked" marks on game objects, `window` globals, URLs outside deeeep.io, and `eval`.
  - For built-in plugins it also checks `BUILTIN`, `keyHelp`, Turkish texts and the README.
  - Fix every ERROR. Warnings need a reason to stay.

Workflow for a new plugin:
1. Copy the template to `%APPDATA%\GaziClient\plugins\custom\<id>.js` and fill in the header.
2. Look up the fields in `game-reference.md`, and check them live in DevTools with `gazi.game`.
3. Write it, run `check-plugin.js`, then turn it on in the Custom tab. It reloads live on save.
4. When it works, move it into the client ("Adding a plugin to the client" below) and run `check-plugin.js` again on the file in `plugins/builtin/`.

Header (read by `src/plugins.rs` from the first 40 lines):

```js
// @name My plugin
// @id myplugin
// @description One line that says what it does and which key toggles it.
// @author yourname
// @tags visual, client-side
```

The API, in short (full types in `runtime/editor/blockyfish.d.ts`):

```js
plugin.registerKeybind("Toggle thing", "KeyG");          // key codes are KeyboardEvent.code
plugin.onKeybindDown("Toggle thing", function() { ... });
plugin.onKeybindUp("Toggle thing", function() { ... });
plugin.isKeybindDown("Toggle thing");

plugin.registerSetting({ name: "Range", description: "...", type: "number", defaultValue: 500 });
// types: "string" | "number" | "boolean" | "list" (with choices: [...])
plugin.getSetting("Range"); plugin.setSetting("Range", 600);
// Changing a setting or a key in the menu does NOT restart the plugin: call getSetting where the
// value is used, do not copy it into a variable once at the top.

plugin.storage.get("k"); plugin.storage.set("k", value);  // saved in plugin-data.json
plugin.saveFile("log.txt", text);                          // Documents\GaziClient\<id>\

ui.toast.info("text");                                     // also .success / .error
blockyfish.Animals.Shark, blockyfish.Emotes, ...           // ids from runtime/constants.js
```

Useful game objects once `game` exists:

| Object | Use |
|---|---|
| `game.currentScene` | The current match. `scene.myAnimals` is your animal(s), `scene.myAnimal` your main one |
| `scene.entityManager.animalsList` / `.entitiesById` | Every animal / entity in view |
| `animal.position`, `.entityData`, `.fishLevelData` | Position, live data (`xpLeft`, health...), animal type (`fishLevel`, `chooseable`) |
| `animal.nameObject` | PIXI text of the name tag, supports `textStyles` tags |
| `scene.terrainManager`, `scene.minimap` | Walls / terrain, the minimap |
| `game.inputManager` | `getMouseWorldPosition()`, `sendMoveToXY(...)`, `lookAngle`. Hook these to steer or aim |
| `game.socketManager` | `sendBytePacket(...)`, `sendStringPacket(...)` |
| `gameState.token`, `.serverStats`, `.map`, `.choices`, `.ranking` | Vue state values, read `.value` |
| `scene.showMessagePopup(text, ms, false)` | The game's own center popup |

More detail is in [game-reference.md](game-reference.md), and the raw field lists are in `runtime/editor/blockyfish.d.ts`. The game updates often and these names can change, so check them in DevTools when something stops working.

### Common patterns (copy from the built-in plugins)

- **Steer or aim:** hook `game.inputManager` methods (see `hookInput()` in `autododge.js` and `predictstrike.js`). Keep the "already hooked" mark in a `WeakSet`, as in the template, not on `im`:
  ```js
  hook(im, "sendMoveToXY", { apply(f, th, args) { if (dodging()) { args = [p.x, p.y, args[2]]; } return reflect.apply(f, th, args); } });
  ```
- **Read server packets:** hook `WebSocket.prototype.send` once to catch the game socket, then listen to its `message` events. See `chatradar.js` and `userids.js`.
- **Send packets:**
  ```js
  game.socketManager.sendBytePacket(blockyfish.encodeBytePacket(gameState.token.value, blockyfish.ActionPacket.Emote, blockyfish.Emotes.HeartPenguin));
  ```
  For boosts, use `blockyfish.boost()`, `chargedBoost()`, `scalingBoost(n)`.
- **Draw in the world:** create a `PIXI.Graphics` / `PIXI.Text` and `addChild` it to a scene container or to the animal (see `aimlineplus.js`). It gets removed automatically when the plugin is turned off.
- **Game data:** fetch from `https://api.deeeep.io/` (`animals`, `skins`, `emotes`, `foods`, `users/<id>`). Cache the results; do not fetch every frame.

Conventions the built-in plugins follow (see `plugins/builtin/evolvewatch.js` as a small, complete example):

- Wrap per-frame work in `try { } catch (e) { }`. The game changes often and one bad frame must not kill the plugin.
- Guard every chain: `game == null || game.currentScene == null || ...`.
- A toggle key shows `"<Name> has been enabled/disabled"` with `showMessagePopup`, and ignores key repeat (`held` flag set in down, cleared in up).
- Plugins that act on their own (auto aim, dodge, play) register with the shared Esc pause and the start-of-match status line:
  ```js
  if (window.__gaziStatus != null) { window.__gaziStatus.parts.push({ name: "My plugin", active: function() { return on; } }); }
  if (window.__gaziEscPause != null) { window.__gaziEscPause.parts.push({ name: "My plugin", active: function() { return on; } }); }
  // then skip automatic actions while window.__gaziEscPause.paused is true
  ```
- On Android every keybind of an enabled plugin automatically gets a draggable on-screen button.
  - The label is the keybind name without `Toggle `, so keep names short.
  - The buttons fire synthetic `KeyboardEvent`s (with `code` and `key`) on `document.body`. `plugin.onKeybindDown` and normal keydown listeners work; checks on `event.isTrusted` do not.
  - Mouse-only actions (ctrl + click) do not work on phones.

### Quick test without rebuilding

Put the `.js` file in `%APPDATA%\GaziClient\plugins\custom\` (or use the Custom tab / Editor tab in the menu, Ctrl+S saves). It shows up as a custom plugin and turns on and off live. Move it into `plugins/builtin/` once it works.

### Adding a plugin to the client

1. Put the file in `plugins/builtin/<id>.js`.
2. Add it to `BUILTIN` in `src/plugins.rs`: `("<id>.js", include_str!("../plugins/builtin/<id>.js")),`. Its key becomes `gaziclient-plugins/<id>.js`.
3. In `runtime/runtime.js`:
   - `keyHelp`: one line per keybind, shown in the key list next to the plugins.
   - `trText`: a Turkish line for each `keyHelp` sentence and any other new UI string. UI text goes through `t("...")`.
   - `pluginDescriptionsTr`: the Turkish version of the `@description`.
   - `recommendedPlugins` / `recommendedKeys`: only if it belongs in "Akgazi's Recommended Settings". This list is the author's own setup, so ask before changing it.
4. Add the plugin's name to the "my plugins" line in `README.md`.
5. Run `check-plugin.js` on the file until it reports no errors.
6. `cargo build --release` and test it in a live match:
   - Turn it on, off and on again mid-match. It must still work, and nothing it drew or hooked may be left behind.
   - Die and respawn, and switch servers.
   - Test once in English and once in Turkish (flags on the home page).
   - Check the DevTools console for `[GaziClient]` errors.

## Debugging

- Start the exe with `GAZI_DEBUG_PORT=9222` set:
  - PowerShell: `$env:GAZI_DEBUG_PORT=9222; .\target\release\gaziclient.exe`
  - Then open `edge://inspect` and add `localhost:9222`.
- The console has a `window.gazi` helper:
  - `gazi.game`: the live game, null on the menu
  - `gazi.game.currentScene.myAnimals[0]`: your animal
  - `gazi.gameState`, `gazi.store`, `gazi.blockyfish`, `gazi.PIXI`
  - `gazi.ipc("plugins")`: calls the Rust side
  - `gazi.openMenu()`
- Explore game objects there before writing plugin code; field names in `blockyfish.d.ts` can be out of date.
- Plugin code shows in DevTools Sources as `gaziclient/<key>` (for example `gaziclient/gaziclient-plugins/evolvewatch.js`), so breakpoints work.
- Plugin errors show in the console as `[GaziClient] plugin <name> failed:` and as a red toast in game.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Plugin not in the list | Missing `@name`/`@id` in the first 40 lines, or the file is not `.js`. Built-in: not added to `BUILTIN`, or no rebuild |
| Two plugins share settings | Same `@id` / same file name: the key (`gaziclient-plugins/<file>`) is the identity |
| Error toast once, then nothing | A plugin that failed is not retried until its code changes. Fix and save, or toggle after editing |
| `plugin <name> deferred until the game starts` | It threw on the menu because `game` was null. Harmless, but better to wait for `gameInit` |
| Works once, dead after off/on | State kept on a game object or `window` survived the restart (see "Live toggling") |
| Keys do nothing | Keybinds are ignored while the GaziClient menu is open or a text box (chat, input) has focus |
| Saved keys/settings lost after renaming a built-in file | The key changed. Add the old name to `oldNames` in `migrateBuiltinData` |

## Changing the runtime or menu

- UI strings: wrap in `t("English text")` and add the Turkish line to `trText`.
- Do not patch the game's own bundle. The game object comes from the page's Vue state stores (see DECISIONS 4).
- Pixel art must sit on whole pixels (DECISIONS 13-15): integer scales only, frames pre-scaled 2x.
- New IPC commands: add a `cmd == "..."` branch in `src/main.rs` and call it with `ipcCall("name", {...})` in the runtime.
  - Android has its own bridge, a `switch (cmd)` in `MainActivity.java`. Add the command there too, or hide the feature with `if (!gaziMobile)`.
  - Android has no plugin editor, no Blockyfish import and no window commands.
- New client option: add the default in `default_config()` (`src/store.rs`), the control in the Client tab in `runtime.js`, and its Turkish text in `trText`.
- Phone-only UI: `gaziMobile` is true in the Android app, and the `<html>` element gets the `gz-mobile` class for CSS.

## Data on disk

Everything lives in `%APPDATA%\GaziClient`:
- `config.json`: client settings. Defaults are in `default_config()` in `src/store.rs`, and a new option needs a default there.
- `plugin-data.json`: per plugin key, `{ enabled, keybinds, settings, storage, version, official }`. Same format as Blockyfish.
- `plugins\custom\`: custom plugins.
- `backgrounds\`: home page backgrounds.

To start clean while testing, close the client and rename the folder.

## Updating a Blockyfish plugin

The copies in `plugins/blockyfish/` are frozen on purpose. To take a newer version, replace the file with the upstream file unchanged and bump its version string in the `BLOCKYFISH` list in `src/plugins.rs`. Read the diff first: it ships inside the exe.

## Release (maintainer)

1. Bump `version` in `Cargo.toml`.
2. Add a line at the top of `gaziChangelog` in `runtime/runtime.js` (newest first).
3. Commit and push to `main`.
4. Tag `vX.Y.Z` and push the tag. GitHub Actions builds `GaziClient.exe`, `GaziClient.apk` and `SHA256SUMS.txt` and attaches build attestations.

## Rules

- License is GPL-3.0 plus `NOTICE.md`: derived work must be open source and credit GaziClient visibly.
- Files in `plugins/blockyfish/` belong to the Blockyfish devs. Do not edit or relicense them.
- Plugin code is never downloaded at runtime. Everything ships inside the exe/apk so users can read exactly what runs. Keep it that way.
- The only network requests allowed are to deeeep.io's own servers (game data, animals, skins, emotes, usernames).
