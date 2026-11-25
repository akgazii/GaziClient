# Deeeep.io game reference for plugins

Fields that GaziClient's built-in plugins actually use today. The game is minified and changes without notice, so treat every field as "may be missing": check `typeof` before using it and confirm in the DevTools console (`gazi.game`) when something breaks. Fields starting with `_` are internal and the most likely to change.

## Scene

```js
var scene = game.currentScene;     // null between matches
scene.myAnimals                    // array, [0] is you; empty while dead
scene.myAnimal                     // your main animal (PIXI container, children[1] is its body)
scene.entityManager.animalsList    // every animal in view, including you
scene.entityManager.entitiesById   // id -> entity (animals, food, ...)
scene.entityManager.animalsByPlayerRoomId
scene.terrainManager.terrains      // walls / water / sky shapes, see "Terrain"
scene.minimap                      // PIXI container, see "Minimap"
scene.showMessagePopup(text, ms, false)
game.gameMode                      // mode number; some packet layouts differ per mode (chatradar.js handles 2 and 6)
```

A new match gives a new `currentScene`. Cache per-scene data keyed on the scene object and rebuild when it changes (see `autododge.js`, the wall cache).

## Animal

| Field | Meaning |
|---|---|
| `position.x`, `position.y` | World position |
| `targetPosition`, `targetVelocity` | Where the server says it is going; good for prediction (`predictstrike.js`) |
| `id`, `playerRoomId` | Entity id, player id in the room |
| `tribeId`, `ally` | Team: skip an animal when `a.ally==true` or `a.tribeId==me.tribeId` |
| `removed`, `destroyed` | It is gone: drop any reference to it |
| `nameObject` | PIXI text of the name tag. Supports `textStyles` tags (see `evolvewatch.js`) |
| `settings.maxHealth` | Max health, fallback when `fishLevelData` is missing |
| `damageBlock` | Current armor (percent) |
| `skin`, `skinId` | Skin; `skin.attributes` can change stats |
| `fadingTrail` | Boost trail object |
| `_standing`, `_oxygen`, `_temperature`, `_pressure`, `_salinity`, `_currentArea` | Your own animal's state (on land, meters, area) |

`animal.entityData` (live data from the server):

| Field | Meaning |
|---|---|
| `hpPercentage` | Health 0-100 |
| `energy` | Boost energy |
| `xpLeft` | XP still needed to evolve |
| `angle` | Facing angle |
| `isBoosting`, `justBoost`, `isUsingSkill`, `isHiding` | Current actions |
| `spawnProtected`, `evolutionProtected` | Cannot be hurt right now |
| `holded`, `effects`, `lifeSteal`, `ownerId`, `skinId`, `foodType` | Grabbed, status effects, misc |

`animal.fishLevelData` (the animal type, same for every animal of that kind):

| Field | Meaning |
|---|---|
| `fishLevel` | Animal id, compare with `blockyfish.Animals.Shark` |
| `level` | Tier |
| `chooseable` | false for NPCs and specials. `chooseable==false` or `fishLevel==Animals.Ghost` means "not a player animal" |
| `healthMultiplier` | Max health = `healthMultiplier * 100` (plus skin bonus) |
| `damageBlock` | Base armor |
| `habitat`, `breathesInAir`, `breathesInWater` | Where it can live |
| `hasSecondaryAbility`, `hasScalingBoost`, `hasWalkingAbility` | Abilities |

Animal names and pictures are not in the game object. Get names from `https://api.deeeep.io/animals` and pictures from `https://deeeep.io/assets/characters/<name>.png`.

## Input

```js
var im = game.inputManager;
im.getMouseWorldPosition()       // where the mouse points in world coordinates
im.sendMoveToXY(x, y, ...)       // the movement the client sends; hook it to steer
im.lookAngle
```

Hook these once per `inputManager` object, and keep the "hooked" mark in a plugin-local `WeakSet` (see the template).

## Screen, world and minimap

- World to screen: `game.viewport.toScreen(x, y)`. Zoom: `game.viewport.scale.x`.
- Something attached to `scene.myAnimal` or another world container moves with the world. Something attached to `game.app.stage` stays on screen.
- Minimap: add children to `scene.minimap`. Convert a world point with
  ```js
  var inner = new PIXI.Point(minimap.getRelativeX(x), minimap.getRelativeY(y));
  var p = minimap.toLocal(minimap.content.toGlobal(inner));
  ```
  `minimap.viewSize` is its size, and `minimap.habitats` lists the map areas.

## Terrain

`scene.terrainManager.terrains[i]` has `bounds` (fast box check first) and `terrainData.points` (the polygon). The type of a terrain decides wall, water or sky. See `terrainKind()` in `autododge.js`. The list can be replaced while a match runs, so check that it is still the same array before trusting a cache.

## Packets

Outgoing:

```js
// byte packet, e.g. an emote
game.socketManager.sendBytePacket(blockyfish.encodeBytePacket(gameState.token.value, blockyfish.ActionPacket.Emote, blockyfish.Emotes.HeartPenguin));
// string packet, e.g. evolve
game.socketManager.sendStringPacket(JSON.stringify({ p: blockyfish.GeneralPacket.Evolution, e: blockyfish.Animals.Crab }));
// boosts
blockyfish.boost(); blockyfish.chargedBoost(); blockyfish.scalingBoost(amount);
```

Incoming: the game socket is a normal `WebSocket`. Catch it by hooking `WebSocket.prototype.send` once, then listen to its `message` events (`chatradar.js`, `userids.js`). Binary messages are `ArrayBuffer`s:
- Byte 0 is the `GeneralPacket` id.
- Numbers are little-endian: `view.getUint16(off, true)`.
- Some layouts depend on `game.gameMode`.

| Id | Packet | Known layout |
|---|---|---|
| 105 | ChatMessages | `[1]` count, then per message: `u32` sender id, `i32` x, `i32` y, mode-specific bytes (+2 in mode 2, +5 in mode 6), 1 byte, name text, 2 bytes, message text |
| 128 / 133 | PlayerData | from offset 1: `u16` playerRoomId, ..., `u32` userId at +10 |
| 114 | Response | when `[5]==7 && [6]==128`, PlayerData starts at offset 7 |

Read packets inside `try { } catch (e) { }`: a layout change must not throw inside the game's socket handler.

## Vue state (`gameState`)

`gameState.<name>.value`: `token`, `serverStats`, `map`, `choices` (evolution options), `ranking` (`ranking.ranking[i].playerData` has `playerRoomId`, `userId`), `currentArea`. Some entries are refs and need `.value`; check `__v_isRef`.

## Web API (`api.deeeep.io`)

| Endpoint | Gives |
|---|---|
| `/animals` | Animal ids and names |
| `/skins` | Skins and their stat changes |
| `/emotes` | Emote list |
| `/foods` | Food types |
| `/users/<id>` | Account username |

Fetch once and cache (in a variable, or `plugin.storage` for data that rarely changes). Never fetch per frame or per animal without a cache.
