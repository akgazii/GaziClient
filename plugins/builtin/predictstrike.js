// @name Predict strike
// @id predictstrike
// @description Hold the lock keybind to aim where the enemy closest to your mouse will be (uses their speed and where they are aiming), release to boost into them. Execute mode boosts by itself into any enemy you can finish in one bite. Shows a yellow ring where your target is going to be.
// @author akgazii⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠
// @tags gameplay, server-side

plugin.registerKeybind("Lock on", "KeyC"); 
plugin.registerKeybind("Toggle execute", "Numpad4");  

plugin.registerSetting({  
  name: "Lock range", 
  description: "max distance from your animal for the lock on target", 
  type: "number", 
  defaultValue: 1500,
}); 
plugin.registerSetting({
  name: "Execute range",  
  description: "execute only boosts into enemies closer than this", 
  type: "number",  
  defaultValue: 650,  
});
plugin.registerSetting({
  name: "Execute bites", 
  description: "execute enemies you can kill in this many bites or less",  
  type: "number", 
  defaultValue: 1,  
});  
plugin.registerSetting({ 
  name: "Boost speed",
  description: "how fast your boost moves per second, used to guess where they will be. raise if you overshoot, lower if you hit behind them",  
  type: "number",  
  defaultValue: 1300, 
}); 
plugin.registerSetting({  
  name: "Max lead (MS)",  
  description: "the furthest into the future it will predict",  
  type: "number", 
  defaultValue: 600,  
});  
plugin.registerSetting({ 
  name: "Turn delay (MS)", 
  description: "time between turning and boosting", 
  type: "number", 
  defaultValue: 30,  
});
plugin.registerSetting({ 
  name: "Execute cooldown (MS)",
  description: "min time between execute boosts",  
  type: "number",
  defaultValue: 1200,  
});  
plugin.registerSetting({  
  name: "Show prediction", 
  description: "draw a yellow ring where your target will be",  
  type: "boolean", 
  defaultValue: true, 
});

var baseBite = 20;
var energyPerBoost = 50;
var game;  
var locking = false;  
var lockTarget = null; 
var executeOn = true;  
var executeHeld = false; 
var lastExecute = 0; 
var aimPoint = null;  
var aimUntil = 0; 
var tracks = new WeakMap();  
var shown = null;  
var overlay = null; 
var overlayCtx = null;
var walls = null;
var wallsFrom = null;  
var wallsCount = 0; 
var solidLayers = ["terrains", "islands"]; 

var npcs = [
  blockyfish.Animals.Pollock,
  blockyfish.Animals.Remora,  
  blockyfish.Animals.Dragonfly, 
  blockyfish.Animals.Lanternfish,
  blockyfish.Animals.BabyPenguin, 
  blockyfish.Animals.LionsManeJellyfish,
  blockyfish.Animals.Firefly,  
  blockyfish.Animals.Sardine, 
  blockyfish.Animals.GiantSinophore,
]; 

blockyfish.addEventListener("gameInit", function(e) 
{ 
  game = e.game; 
  tracks = new WeakMap(); 
  walls = null;  
  lockTarget = null;
});  

function aiming()
{ 
  return aimPoint!=null && performance.now()<aimUntil; 
} 

// Kept here, not on im: after an off/on the hooks are gone but a mark on im would stay.
var hookedInputs = new WeakSet();

function hookInput() 
{  
  var im = game.inputManager; 
  if (im==null || hookedInputs.has(im))  
  {  
    return; 
  }  
  hookedInputs.add(im); 

  hook(im, "sendMoveToXY",  
  {  
    apply(f, th, args)
    { 
      if (aiming())
      {  
        args = [aimPoint.x, aimPoint.y, args[2]];  
      } 
      return reflect.apply(f, th, args);
    }, 
  });  

  hook(im, "getMouseWorldPosition",  
  {  
    apply(f, th, args) 
    {  
      var real = reflect.apply(f, th, args);  
      if (!aiming()) 
      { 
        return real; 
      }
      if (real!=null && typeof real.clone=="function") 
      {  
        var copy = real.clone(); 
        copy.x = aimPoint.x;
        copy.y = aimPoint.y;  
        return copy;  
      }  
      return { x: aimPoint.x, y: aimPoint.y };  
    }, 
  });  
} 

function number(value, fallback) 
{
  if (typeof value=="number" && !isNaN(value))
  {  
    return value;
  }  
  return fallback;
} 

function clamp(value)  
{ 
  return Math.min(Math.max(value, 0), 1); 
}  

function biteDamage(attacker, target) 
{  
  var level = attacker.fishLevelData;
  var data = attacker.entityData;  
  var other = target.entityData; 
  if (level==null || data==null || other==null)  
  { 
    return null; 
  }  
  var damage = baseBite * number(level.damageMultiplier, 1) * number(data.damageMultiplier, 1);
  var baseArmor = target.fishLevelData!=null ? number(target.fishLevelData.damageBlock, 0) : 0; 
  var armor = clamp(number(other.damageBlock, baseArmor * 100) / 100); 
  var pierce = clamp(number(data.armorPenetration, number(level.armorPenetration, 0) * 100) / 100);  
  return damage * (1 - armor * (1 - pierce));
}

function healthOf(animal)
{ 
  var data = animal.entityData; 
  if (data==null) 
  { 
    return null; 
  }
  var max = null; 
  if (animal.settings!=null && typeof animal.settings.maxHealth=="number")
  {  
    max = animal.settings.maxHealth;  
  } 
  else if (animal.fishLevelData!=null && typeof animal.fishLevelData.healthMultiplier=="number") 
  { 
    max = animal.fishLevelData.healthMultiplier * 100;
  } 
  if (max==null)  
  { 
    return null;  
  }  
  return max * number(data.hpPercentage, 100) / 100 + number(data.overHealth, 0); 
}  

function bitesToKill(attacker, target)
{ 
  var damage = biteDamage(attacker, target);  
  var health = healthOf(target);  
  if (damage==null || health==null) 
  {  
    return null;
  }
  if (damage<=0)  
  { 
    return Infinity; 
  }
  return Math.max(1, Math.ceil(health / damage));  
}

function protectedAnimal(a)  
{  
  return a.entityData!=null && (a.entityData.spawnProtected || a.entityData.evolutionProtected || a.entityData.isHiding); 
}  

function isEnemy(me, a)  
{ 
  var scene = game.currentScene; 
  if (a==me || a.position==null || a.removed || scene.myAnimals.includes(a)) 
  { 
    return false;  
  } 
  if (a.id!=null && a.id==me.id)  
  {  
    return false;
  }
  if (a.ally==true || (me.tribeId!=null && a.tribeId==me.tribeId))  
  {  
    return false; 
  }  
  if (a.fishLevelData!=null && (npcs.includes(a.fishLevelData.fishLevel) || a.fishLevelData.chooseable==false))
  { 
    return false; 
  }  
  return true;  
}

function track(a, now)
{ 
  var old = tracks.get(a);
  var x = a.position.x;
  var y = a.position.y;  
  if (old==null)
  { 
    tracks.set(a, { x: x, y: y, t: now, vx: 0, vy: 0 }); 
    return;  
  } 
  var dt = (now - old.t) / 1000;  
  if (dt<0.03)  
  {
    return; 
  }
  if (dt>0.5)  
  { 
    tracks.set(a, { x: x, y: y, t: now, vx: 0, vy: 0 }); 
    return;
  }
  var vx = (x - old.x) / dt;  
  var vy = (y - old.y) / dt; 
  var keep = 0.5;
  if (a.entityData!=null && (a.entityData.isBoosting || a.entityData.justBoost)) 
  {
    keep = 0.2;
  }  
  tracks.set(a, { x: x, y: y, t: now, vx: old.vx * keep + vx * (1 - keep), vy: old.vy * keep + vy * (1 - keep) }); 
}

function predict(me, a) 
{ 
  var info = tracks.get(a); 
  var vx = info!=null ? info.vx : 0; 
  var vy = info!=null ? info.vy : 0; 
  var data = a.entityData;
  var speed = Math.sqrt(vx*vx + vy*vy);  
  if (data!=null && data.moveTarget!=null && typeof data.moveTarget.x=="number" && speed>20)
  {  
    var tx = data.moveTarget.x - a.position.x;
    var ty = data.moveTarget.y - a.position.y;
    var tlen = Math.sqrt(tx*tx + ty*ty);
    if (tlen>1) 
    { 
      vx = vx * 0.6 + tx / tlen * speed * 0.4; 
      vy = vy * 0.6 + ty / tlen * speed * 0.4; 
    }  
  } 
  var boostSpeed = Math.max(plugin.getSetting("Boost speed"), 100);  
  var cap = plugin.getSetting("Max lead (MS)") / 1000;  
  var px = a.position.x; 
  var py = a.position.y;  
  for(var i = 0;i<3;i++) 
  {  
    var dx = px - me.position.x;  
    var dy = py - me.position.y; 
    var t = Math.min(Math.sqrt(dx*dx + dy*dy) / boostSpeed, cap);  
    px = a.position.x + vx * t;  
    py = a.position.y + vy * t; 
  } 
  return { x: px, y: py };  
}

function solidTerrains()  
{  
  var tm = game.currentScene.terrainManager; 
  if (tm==null || tm.terrains==null)  
  {
    return [];  
  } 
  if (walls!=null && wallsFrom==tm.terrains && wallsCount==tm.terrains.length) 
  { 
    return walls; 
  }  
  walls = []; 
  wallsFrom = tm.terrains;  
  wallsCount = tm.terrains.length;  
  for(var i = 0;i<tm.terrains.length;i++)
  {  
    var t = tm.terrains[i];  
    if (t==null || t.settings==null || t.terrainData==null || t.bounds==null || t.terrainData.points==null) 
    {  
      continue; 
    } 
    if (solidLayers.indexOf(t.settings.layerId)!=-1)  
    {  
      walls.push({ b: t.bounds, p: t.terrainData.points }); 
    }  
  }
  return walls; 
} 

function insidePolygon(points, x, y)
{
  var inside = false;  
  for(var i = 0, j = points.length - 1;i<points.length;j = i++)
  { 
    var xi = points[i][0];
    var yi = points[i][1];
    var xj = points[j][0];
    var yj = points[j][1];  
    if ((yi>y)!=(yj>y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi)
    {  
      inside = !inside;
    } 
  }  
  return inside; 
} 

function isWall(x, y)  
{ 
  var list = solidTerrains(); 
  for(var i = 0;i<list.length;i++)  
  { 
    var b = list[i].b; 
    if (x<b.minX || x>b.maxX || y<b.minY || y>b.maxY) 
    { 
      continue; 
    } 
    if (insidePolygon(list[i].p, x, y))  
    {
      return true;
    }  
  } 
  return false;
}

function lineClear(me, x, y)
{ 
  var dx = x - me.position.x; 
  var dy = y - me.position.y; 
  var steps = Math.ceil(Math.sqrt(dx*dx + dy*dy) / 120);  
  try
  {
    for(var i = 1;i<steps;i++)
    {
      if (isWall(me.position.x + dx * i / steps, me.position.y + dy * i / steps)) 
      {
        return false;  
      }  
    } 
  }  
  catch
  {
    return true; 
  }  
  return true;  
}

function hasEnergy(me)
{ 
  if (me.entityData==null || typeof me.entityData.energy!="number")  
  {  
    return true; 
  } 
  return me.entityData.energy >= energyPerBoost;
}

function sendBoost(me)  
{  
  try
  {  
    if (me._standing || blockyfish.ActionPacket==null) 
    {  
      blockyfish.boost();  
    } 
    else
    { 
      game.socketManager.sendBytePacket(blockyfish.encodeBytePacket(gameState.token._value, blockyfish.ActionPacket.Boost, ""));
    } 
  }
  catch {} 
}  

function aimAt(point, time) 
{  
  aimPoint = { x: point.x, y: point.y };  
  aimUntil = performance.now() + time;  
  game.inputManager.sendMoveToXY(point.x, point.y, 10000);
}  

function strike(me, point) 
{
  var delay = Math.max(plugin.getSetting("Turn delay (MS)"), 0);  
  aimAt(point, delay + 200);
  setTimeout(function()
  { 
    sendBoost(me); 
  }, delay);  
}  

function popup(text)
{ 
  try
  {  
    game.currentScene.showMessagePopup(text, 1000, false); 
  }
  catch {} 
}  

var escPause = window.__gaziEscPause; 
if (escPause == null)  
{
  escPause = window.__gaziEscPause = { paused: false, parts: [], show: null };  
  window.addEventListener("keydown", function(event) 
  {  
    if (event.code != "Escape" || event.repeat) 
    {
      return; 
    }  
    var target = event.target; 
    if (target != null && (target.tagName == "INPUT" || target.tagName == "TEXTAREA" || target.isContentEditable)) 
    {  
      return; 
    } 
    escPause.paused = !escPause.paused;
    var names = escPause.parts.filter(function(part) { return part.active(); }).map(function(part) { return part.name; }); 
    if (names.length > 0 && escPause.show != null) 
    {
      escPause.show(names.join(" and ") + (escPause.paused ? " paused (Esc to resume)" : " resumed"));
    } 
  }, true); 
}  
escPause.parts.push({ name: "Execute", active: function() { return executeOn; } });  
escPause.show = popup;

function closestToMouse(me, animals)
{ 
  var mouse = game.inputManager.getMouseWorldPosition(); 
  var range = plugin.getSetting("Lock range"); 
  var best = null; 
  var bestDist = Infinity;  
  for(var i = 0;i<animals.length;i++)
  {
    var a = animals[i]; 
    if (!isEnemy(me, a) || protectedAnimal(a))  
    {  
      continue;
    } 
    var mx = a.position.x - me.position.x;  
    var my = a.position.y - me.position.y;
    if (Math.sqrt(mx*mx + my*my)>range) 
    {  
      continue;  
    } 
    var dx = a.position.x - mouse.x;  
    var dy = a.position.y - mouse.y;  
    var dist = dx*dx + dy*dy;
    if (dist<bestDist) 
    { 
      bestDist = dist;  
      best = a;  
    }
  }
  return best;
}

function findExecute(me, animals)  
{
  var range = plugin.getSetting("Execute range"); 
  var bites = plugin.getSetting("Execute bites");  
  var best = null;  
  var bestDist = Infinity; 
  for(var i = 0;i<animals.length;i++) 
  {
    var a = animals[i]; 
    if (!isEnemy(me, a) || protectedAnimal(a)) 
    {  
      continue; 
    }  
    var dx = a.position.x - me.position.x;  
    var dy = a.position.y - me.position.y;  
    var dist = Math.sqrt(dx*dx + dy*dy);  
    if (dist>range || dist>=bestDist)
    { 
      continue;  
    } 
    var need = bitesToKill(me, a); 
    if (need==null || need>bites)  
    {
      continue;  
    } 
    if (!lineClear(me, a.position.x, a.position.y))  
    { 
      continue; 
    }
    best = a;  
    bestDist = dist; 
  }  
  return best;  
} 

function hideOverlay()
{  
  if (overlay!=null && overlay.style.display!="none") 
  { 
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);  
    overlay.style.display = "none"; 
  } 
}  

function drawOverlay(me) 
{ 
  if (shown==null || !plugin.getSetting("Show prediction") || game.viewport==null || typeof game.viewport.toScreen!="function")
  {
    hideOverlay(); 
    return; 
  } 
  if (overlay==null)
  { 
    overlay = document.createElement("canvas");
    overlay.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:5;pointer-events:none;";  
    overlayCtx = overlay.getContext("2d");  
  } 
  if (overlay.parentNode==null) 
  { 
    document.body.appendChild(overlay); 
  }  
  overlay.style.display = "block"; 
  var ratio = window.devicePixelRatio || 1;
  var w = Math.floor(window.innerWidth * ratio);  
  var h = Math.floor(window.innerHeight * ratio);  
  if (overlay.width!=w || overlay.height!=h)
  { 
    overlay.width = w;  
    overlay.height = h;
  } 
  var renderer = game.app!=null ? game.app.renderer : game.renderer;  
  var rect = renderer.view.getBoundingClientRect();  
  var scaleX = rect.width / renderer.screen.width; 
  var scaleY = rect.height / renderer.screen.height;  
  var from = game.viewport.toScreen(shown.from.x, shown.from.y);  
  var to = game.viewport.toScreen(shown.to.x, shown.to.y); 
  var fx = rect.left + from.x * scaleX; 
  var fy = rect.top + from.y * scaleY;
  var tx = rect.left + to.x * scaleX;  
  var ty = rect.top + to.y * scaleY;  
  var g = overlayCtx;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.clearRect(0, 0, window.innerWidth, window.innerHeight);  
  g.strokeStyle = shown.kill ? "#ff4040" : "#ffd21f"; 
  g.lineWidth = 2;
  g.setLineDash([6, 6]);  
  g.beginPath();  
  g.moveTo(fx, fy);
  g.lineTo(tx, ty); 
  g.stroke(); 
  g.setLineDash([]); 
  g.lineWidth = 3; 
  g.beginPath();  
  g.arc(tx, ty, 10, 0, Math.PI * 2); 
  g.stroke();  
}

function tick()  
{  
  try
  {  
    shown = null; 
    if (game==null || game.currentScene==null || game.currentScene.myAnimals==null)  
    { 
      hideOverlay(); 
      return;
    }  
    var me = game.currentScene.myAnimals[0];
    if (me==null || me.position==null || game.inputManager==null)
    {
      lockTarget = null;  
      hideOverlay(); 
      return;  
    } 
    try
    { 
      hookInput();  
    } 
    catch {}  

    var now = performance.now();  
    var animals = game.currentScene.entityManager.animalsList;
    for(var i = 0;i<animals.length;i++) 
    {  
      if (animals[i]!=null && animals[i].position!=null) 
      { 
        track(animals[i], now);  
      } 
    }

    if (locking) 
    {  
      if (lockTarget==null || lockTarget.removed || lockTarget.position==null || !isEnemy(me, lockTarget)) 
      { 
        lockTarget = closestToMouse(me, animals);
      }
      if (lockTarget!=null)
      {
        var lockPoint = predict(me, lockTarget); 
        aimAt(lockPoint, 120); 
        shown = { from: lockTarget.position, to: lockPoint, kill: false }; 
      } 
    }  
    else if (executeOn && !escPause.paused)  
    { 
      var prey = findExecute(me, animals); 
      if (prey!=null)
      {
        var killPoint = predict(me, prey);
        shown = { from: prey.position, to: killPoint, kill: true }; 
        var busy = me.entityData!=null && me.entityData.isBoosting==true;
        if (!busy && hasEnergy(me) && Date.now() - lastExecute >= plugin.getSetting("Execute cooldown (MS)"))
        { 
          lastExecute = Date.now();
          strike(me, killPoint);  
        } 
      }
    }  

    drawOverlay(me);
  }
  catch {}  
} 

setInterval(tick, 15);

plugin.onKeybindDown("Lock on", function()  
{
  if (game==null || game.currentScene==null || locking) 
  {  
    return;  
  } 
  locking = true;
  lockTarget = null;  
});  

plugin.onKeybindUp("Lock on", function()
{ 
  if (!locking) 
  {
    return;
  }
  locking = false;  
  try
  {  
    var me = game.currentScene.myAnimals[0];  
    if (me!=null && lockTarget!=null && lockTarget.position!=null && hasEnergy(me)) 
    {  
      strike(me, predict(me, lockTarget));
    }  
  } 
  catch {} 
  lockTarget = null;
});

plugin.onKeybindDown("Toggle execute", function()
{ 
  if (game==null || game.currentScene==null || executeHeld) 
  {  
    return; 
  }  
  executeHeld = true;  
  executeOn = !executeOn;  
  if (executeOn)  
  {
    popup("Execute has been enabled"); 
  }  
  else
  { 
    popup("Execute has been disabled");
  }
});

plugin.onKeybindUp("Toggle execute", function() 
{  
  executeHeld = false;
});  

if (window.__gaziStatus != null) 
{  
  window.__gaziStatus.parts.push({ name: "Execute", active: function() { return executeOn; } }); 
} 
