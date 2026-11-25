// @name Auto play
// @id autoplay
// @description Plays for you. Runs away from animals that can kill you, hunts animals you can beat, eats food and wanders around when nothing is near. Press the keybind to toggle.
// @author akgazii⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠
// @tags gameplay, server-side

plugin.registerKeybind("Toggle auto play", "KeyO");

plugin.registerSetting({ 
  name: "Flee radius",  
  description: "run away from dangerous animals closer than this",  
  type: "number",
  defaultValue: 1000, 
});
plugin.registerSetting({
  name: "Danger bites", 
  description: "an animal is dangerous if it can kill you in this many bites or less", 
  type: "number", 
  defaultValue: 6,  
}); 
plugin.registerSetting({  
  name: "Hunt",  
  description: "chase animals you can kill faster than they can kill you", 
  type: "boolean",  
  defaultValue: true, 
});  
plugin.registerSetting({  
  name: "Hunt radius", 
  description: "how far to look for animals to hunt",  
  type: "number",  
  defaultValue: 1200, 
}); 
plugin.registerSetting({  
  name: "Max hunt bites",  
  description: "only hunt animals you can kill in this many bites or less",
  type: "number",  
  defaultValue: 4, 
});
plugin.registerSetting({  
  name: "Boost to escape",  
  description: "boost away when a dangerous animal gets close", 
  type: "boolean", 
  defaultValue: true, 
}); 
plugin.registerSetting({  
  name: "Boost to hunt", 
  description: "boost into the animal you are hunting when its close",  
  type: "boolean",
  defaultValue: true,
});  
plugin.registerSetting({
  name: "Wall check",  
  description: "don't swim or boost into walls",  
  type: "boolean", 
  defaultValue: true,  
}); 
plugin.registerSetting({
  name: "Dodge boosts", 
  description: "boost to the side when a dangerous animal boosts at you",  
  type: "boolean",  
  defaultValue: true,
}); 
plugin.registerSetting({  
  name: "Low HP (%)", 
  description: "below this health stop hunting and be more careful", 
  type: "number",  
  defaultValue: 40, 
});  
plugin.registerSetting({  
  name: "Auto evolve",
  description: "evolve automatically when you can",
  type: "boolean", 
  defaultValue: true,  
});
plugin.registerSetting({ 
  name: "Evolve priority",
  description: "animals to pick first when evolving, separated with commas (like: Shark, Orca, Marlin). random if none of them show up", 
  type: "string",  
  defaultValue: "", 
}); 
plugin.registerSetting({  
  name: "Meter limit (%)", 
  description: "if oxygen, temperature, pressure or salinity goes below this, swim back to where they were full", 
  type: "number", 
  defaultValue: 60, 
}); 
plugin.registerSetting({ 
  name: "Strongest evolve",  
  description: "pick the strongest animal (damage, health, armor, speed) and the path that leads to the strongest tier 9, instead of a random one",
  type: "boolean",  
  defaultValue: true, 
}); 
plugin.registerSetting({ 
  name: "Auto respawn", 
  description: "press continue and play again by itself when you die",  
  type: "boolean", 
  defaultValue: true,  
});  

var baseBite = 20;
var mapScale = 100; 
var willGrab = 1073741824;
var foodRules = {};  
var zones = null; 
var zonesMap = null;  
var zoneScale = 10;  
var habCold = 1;
var habWarm = 2; 
var habShallow = 4;  
var habDeep = 8;  
var habFresh = 16; 
var habSalt = 32;
var sunfish = -1; 
var energyPerBoost = 50;
var boostCooldown = 1500;
var wallCheckDistance = 600;  
var sameKindTier = 7;  
var badAir = {};  
var breathGoal = null;
var lastUnstick = 0; 
var game;  
var on = false;
var held = false;  
var goal = null; 
var goalUntil = 0; 
var wanderPoint = null;
var wanderUntil = 0; 
var lastBoost = 0; 
var mode = "";  
var walls = null; 
var wallsFrom = null;  
var wallsCount = 0;  
var solidLayers = ["terrains", "islands", "ceilings"];  
var tracked = new WeakMap();  
var evolveKey = ""; 
var evolvedAt = 0;  
var safeSpots = [];
var safeAt = 0;
var refilling = false; 
var respawnAt = 0; 
var rejoinAt = 0;  
var safeFish = null;  
var exploreDir = null;
var exploreIndex = 0; 
var exploreAt = 0;  
var exploreLast = 100;
var lastFish = null; 
var deathHandled = true; 
var ignoredFood = new WeakMap();
var foodTarget = null;
var closeSince = 0;  
var foodTargetDist = Infinity; 
var dietFails = {};
var dietGood = {};  
var stuckCheck = null;  
var stuckUntil = 0; 
var trail = [];  
var trailAt = 0; 
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

for (var animalKey in blockyfish.Animals)
{ 
  if (animalKey.toLowerCase().indexOf("sunfish")!=-1) 
  { 
    sunfish = blockyfish.Animals[animalKey];
  } 
} 

blockyfish.addEventListener("gameInit", function(e)  
{  
  game = e.game; 
  walls = null;
  tracked = new WeakMap(); 
}); 

function otherBusy() 
{
  var im = game!=null ? game.inputManager : null;  
  return im!=null && typeof im.orcaBusyUntil=="number" && im.orcaBusyUntil>performance.now();
}

function steering() 
{  
  return on && goal!=null && performance.now()<goalUntil && !otherBusy();  
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
      if (steering())  
      {  
        args = [goal.x, goal.y, args[2]];  
      }
      return reflect.apply(f, th, args); 
    },
  });  

  hook(im, "getMouseWorldPosition",  
  { 
    apply(f, th, args)
    { 
      var real = reflect.apply(f, th, args);
      if (!steering()) 
      { 
        return real;  
      } 
      if (real!=null && typeof real.clone=="function")  
      {
        var copy = real.clone();  
        copy.x = goal.x;  
        copy.y = goal.y;  
        return copy; 
      }  
      return { x: goal.x, y: goal.y }; 
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
  if (target.entityData!=null && (target.entityData.spawnProtected || target.entityData.evolutionProtected)) 
  {
    return Infinity;
  }  
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

function hasEnergy(me)
{  
  if (me.entityData==null || typeof me.entityData.energy!="number") 
  {  
    return true;  
  } 
  return me.entityData.energy >= energyPerBoost; 
} 

function boost(me) 
{  
  if (Date.now() - lastBoost < boostCooldown || !hasEnergy(me)) 
  {  
    return;  
  }  
  lastBoost = Date.now();
  setTimeout(function()  
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
  }, 20); 
}

function unstick(me) 
{  
  var level = me.fishLevelData || {}; 
  if (me._standing && (level.hasScalingBoost==true || level.hasWalkingAbility==true))  
  {  
    if (Date.now() - lastUnstick < 1200) 
    {  
      return;
    } 
    lastUnstick = Date.now();
    try
    {
      blockyfish.halfChargedBoost(); 
    }  
    catch {} 
    return; 
  }  
  boost(me); 
} 

function popup(text) 
{
  try
  { 
    game.currentScene.showMessagePopup(text, 1000, false); 
  } 
  catch {}  
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

function isWall(me, x, y) 
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

function pathClear(me, dirX, dirY)
{
  if (!plugin.getSetting("Wall check"))  
  { 
    return true; 
  }  
  try
  { 
    for(var step = 1;step<=4;step++) 
    {
      var d = wallCheckDistance * step / 4;  
      if (isWall(me, me.position.x + dirX * d, me.position.y + dirY * d)) 
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

function pickDirection(me, dirX, dirY) 
{ 
  var angles = [0, 25, -25, 50, -50, 75, -75, 100, -100, 130, -130, 160, -160];
  for(var i = 0;i<angles.length;i++)  
  { 
    var r = angles[i] * Math.PI / 180;
    var x = dirX * Math.cos(r) - dirY * Math.sin(r);  
    var y = dirX * Math.sin(r) + dirY * Math.cos(r);  
    if (pathClear(me, x, y)) 
    {  
      return { x: x, y: y }; 
    }  
  }
  return { x: dirX, y: dirY };
}

function goTo(me, x, y, clearWalls)  
{ 
  var dx = x - me.position.x;  
  var dy = y - me.position.y;  
  var len = Math.sqrt(dx*dx + dy*dy); 
  if (len<1) 
  {
    return;  
  }  
  if (clearWalls)  
  { 
    var dir = pickDirection(me, dx / len, dy / len);  
    var far = Math.max(len, 600);
    x = me.position.x + dir.x * far;
    y = me.position.y + dir.y * far;  
  } 
  goal = { x: x, y: y }; 
  goalUntil = performance.now() + 300;
  game.inputManager.sendMoveToXY(x, y, 10000); 
}

function isOther(me, a) 
{  
  if (a==me || a.position==null || a.removed || game.currentScene.myAnimals.includes(a))
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
  return true; 
}  

function isNpc(a)
{
  if (a.fishLevelData==null)
  {
    return false;  
  }
  return npcs.includes(a.fishLevelData.fishLevel) || a.fishLevelData.chooseable==false;
}

function sameKind(me, a) 
{  
  if (me.fishLevelData==null || a.fishLevelData==null)
  { 
    return false; 
  }
  if (a.fishLevelData.fishLevel!=me.fishLevelData.fishLevel)  
  {
    return false; 
  }  
  return number(me.fishLevelData.level, 0) < sameKindTier;  
} 

function hpPercent(me)
{  
  if (me.entityData==null) 
  {
    return 100; 
  }  
  return number(me.entityData.hpPercentage, 100);
} 

function boostingAtMe(me, a, dx, dy, dist)
{ 
  var data = a.entityData;  
  if (data==null) 
  { 
    return false; 
  } 
  if (typeof data.effects=="number" && (data.effects & willGrab)!=0 && dist<600) 
  { 
    return true;  
  }
  if (data.isBoosting!=true)  
  { 
    return false; 
  } 
  var old = tracked.get(a); 
  if (old==null)  
  {
    return true; 
  }  
  var vx = a.position.x - old.x;  
  var vy = a.position.y - old.y; 
  var len = Math.sqrt(vx*vx + vy*vy);  
  if (len<1) 
  {  
    return true;  
  } 
  return (vx * -dx + vy * -dy) / (len * dist) > 0.8;
}

function evolveChoices()  
{
  try
  {  
    var options = gameState.choices.value.options; 
    if (options!=null && options.length>0)
    { 
      return options;  
    }  
  }  
  catch {} 
  return null;
}

function myAnimalNow()  
{  
  if (game==null || game.currentScene==null || game.currentScene.myAnimals==null) 
  { 
    return null; 
  } 
  return game.currentScene.myAnimals[0];
}  

function pickEvolution(options)
{
  var wanted = String(plugin.getSetting("Evolve priority")).split(","); 
  for(var i = 0;i<wanted.length;i++)
  {  
    var name = wanted[i].replace(/\s+/g, "").toLowerCase();
    if (name=="")
    {  
      continue;
    }
    for (var key in blockyfish.Animals)
    {
      if (key.toLowerCase()==name && options.indexOf(blockyfish.Animals[key])!=-1)  
      {  
        return blockyfish.Animals[key]; 
      }
    }
  }  
  var bad = badPicks();
  var area = currentArea(myAnimalNow()); 
  var livable = options.filter(function(o)
  { 
    var habitat = habitatOf(o);  
    return area==null || habitat==null || livesIn(habitat, area, o);  
  }); 
  if (livable.length==0)  
  {
    livable = options; 
  } 
  var good = livable.filter(function(o) { return bad.indexOf(o)==-1; });  
  if (good.length==0) 
  {  
    good = livable;  
  }
  if (!plugin.getSetting("Strongest evolve")) 
  {  
    return good[Math.floor(Math.random() * good.length)];
  }
  var best = good[0];
  var bestValue = -1; 
  for(var j = 0;j<good.length;j++)
  { 
    var value = pathValue(good[j], 0);  
    if (value>bestValue)
    { 
      bestValue = value; 
      best = good[j];  
    } 
  } 
  return best; 
} 

function powerOf(fishLevel) 
{ 
  var data = serverFish(fishLevel);  
  if (data==null)  
  { 
    return 0; 
  } 
  return number(data.damageMultiplier, 1) * number(data.healthMultiplier, 1) * (1 + number(data.damageBlock, 0)) * number(data.speedMultiplier, 1); 
}

function nextOptions(fishLevel)  
{ 
  var data = serverFish(fishLevel);  
  if (data==null)
  {  
    return []; 
  }  
  var levels = null; 
  try
  {  
    var stats = gameState.serverStats._value || gameState.serverStats;  
    levels = stats.levelsData[data.level + 1]; 
  }  
  catch {}  
  if (levels==null || levels.fishLevelsByCriteria==null) 
  {
    return [];
  } 
  return levels.fishLevelsByCriteria[fishLevel] || [];  
}  

function pathValue(fishLevel, depth)  
{ 
  var value = powerOf(fishLevel);  
  if (depth>=3)  
  { 
    return value; 
  } 
  var bad = badPicks(); 
  var next = nextOptions(fishLevel);
  var bestNext = 0;  
  for(var i = 0;i<next.length;i++) 
  {  
    if (bad.indexOf(next[i])!=-1 && next.length>1)  
    {
      continue;  
    }
    bestNext = Math.max(bestNext, pathValue(next[i], depth + 1));  
  } 
  return value + bestNext;  
} 

function autoEvolve() 
{  
  if (!plugin.getSetting("Auto evolve"))  
  {
    return; 
  }
  var options = evolveChoices();
  if (options==null)
  {
    return;  
  } 
  var me = null;
  if (game.currentScene!=null && game.currentScene.myAnimals!=null) 
  {  
    me = game.currentScene.myAnimals[0]; 
  }  
  if (me!=null && me.fishLevelData!=null && options.indexOf(me.fishLevelData.fishLevel)!=-1)  
  { 
    return;
  }  
  var key = options.join(","); 
  if (key==evolveKey && Date.now() - evolvedAt < 3000)
  {
    return; 
  }
  var choice = pickEvolution(options);  
  evolveKey = key; 
  evolvedAt = Date.now(); 
  game.socketManager.sendStringPacket(JSON.stringify({ p: blockyfish.GeneralPacket.Evolution, e: choice }));  
}

function findFood(me, animals) 
{ 
  var scene = game.currentScene; 
  var list = scene.entityManager.entitiesList;
  var found = [];
  for(var i = 0;i<list.length;i++) 
  {
    var e = list[i];
    if (e==null || e.position==null || e.removed || e.visible==false || animals.indexOf(e)!=-1) 
    { 
      continue;  
    }  
    if (ignoredFood.has(e) && ignoredFood.get(e)>Date.now()) 
    { 
      continue; 
    }
    var key = dietKey(me, e); 
    if (key!=null && dietFails[key]>=2 && dietGood[key]!=true)  
    { 
      continue;  
    }
    var p = e.parent;  
    if (e.hideSpaceData!=null || p==null || (p!=scene.foodContainer && p!=scene.foodLayer && p!=scene.foodGlowContainer))
    {
      continue; 
    }  
    var rule = e.entityData!=null ? foodRules[e.entityData.foodType] : null;
    var xp = rule!=null ? rule.xp : 150; 
    if (rule!=null && !canEat(me, rule))  
    {  
      continue; 
    }  
    if (xp<=0 && !needsAir(me))
    {  
      continue;
    } 
    var dx = e.position.x - me.position.x; 
    var dy = e.position.y - me.position.y;  
    var dist = Math.sqrt(dx*dx + dy*dy);  
    if (xp<=0)  
    { 
      dist = dist / 4;  
    }  
    else
    {
      dist = dist / Math.sqrt(Math.max(xp, 10) / 150);
    } 
    found.push({ food: e, dist: dist });
  } 
  found.sort(function(a, b) { return a.dist - b.dist; }); 
  for(var j = 0;j<found.length && j<10;j++) 
  {  
    if (lineClear(me, found[j].food.position.x, found[j].food.position.y)) 
    {  
      return found[j].food;  
    }  
    ignoredFood.set(found[j].food, Date.now() + 3000);  
  }
  return null; 
}

function ignoreAround(food, range, time)
{  
  var list = game.currentScene.entityManager.entitiesList; 
  for(var i = 0;i<list.length;i++) 
  {
    var e = list[i];  
    if (e==null || e==food || e.position==null || e.entityData==null || e.entityData.foodType==null)  
    { 
      continue;  
    }
    if (Math.abs(e.position.x - food.position.x) < range && Math.abs(e.position.y - food.position.y) < range)
    {
      ignoredFood.set(e, Date.now() + time); 
    } 
  }
}  

function loadFoodRules() 
{  
  fetch("https://api.deeeep.io/foods").then(function(r) { return r.json(); }).then(function(list)
  {  
    for(var i = 0;i<list.length;i++) 
    {  
      foodRules[list[i].id] = list[i]; 
    }
  }).catch(function() {});
} 

function idList(text)  
{ 
  if (text==null || text=="") 
  {  
    return []; 
  } 
  return String(text).split(",").map(function(s) { return Number(s); });
} 

function canEat(me, rule) 
{ 
  if (me.fishLevelData==null) 
  {  
    return true;
  }  
  var id = me.fishLevelData.fishLevel; 
  var tier = me.fishLevelData.level; 
  if (idList(rule.including).indexOf(id)!=-1) 
  { 
    return true;  
  }
  if (idList(rule.excluding).indexOf(id)!=-1)
  { 
    return false;
  }
  var mode = rule.exclusion_mode;
  if (mode==null || mode=="none" || rule.fish_level==null)  
  {  
    return true; 
  }  
  if (mode==">=")
  {
    return tier>=rule.fish_level; 
  }
  if (mode=="<=")  
  {  
    return tier<=rule.fish_level;
  } 
  if (mode=="=")  
  {  
    return id==rule.fish_level; 
  } 
  return true;  
}  

function needsAir(me)
{
  var level = me.fishLevelData || {};  
  return level.breathesInAir==true && typeof me._oxygen=="number" && me._oxygen<70; 
}  

function dietKey(me, food)  
{
  if (me.fishLevelData==null || food.entityData==null || food.entityData.foodType==null) 
  { 
    return null; 
  } 
  return me.fishLevelData.fishLevel + "|" + food.entityData.foodType;  
} 

function checkEaten(me)
{
  if (foodTarget==null)
  {  
    return;  
  }  
  if (foodTarget.removed==true || foodTarget.parent==null)  
  {
    if (foodTargetDist<250) 
    {  
      var key = dietKey(me, foodTarget); 
      if (key!=null) 
      {  
        dietGood[key] = true;
        dietFails[key] = 0;
      }  
    } 
    foodTarget = null;  
    foodTargetDist = Infinity; 
  } 
}

function lineClear(me, x, y)
{
  if (!plugin.getSetting("Wall check"))  
  { 
    return true;
  }  
  var dx = x - me.position.x;  
  var dy = y - me.position.y; 
  var len = Math.sqrt(dx*dx + dy*dy);  
  var steps = Math.ceil(len / 120); 
  try
  { 
    for(var i = 1;i<steps;i++)
    {  
      if (isWall(me, me.position.x + dx * i / steps, me.position.y + dy * i / steps)) 
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

function worstMeter(me)  
{ 
  var names = ["_oxygen", "_temperature", "_pressure", "_salinity"]; 
  var worst = { name: "", value: 100 }; 
  for(var i = 0;i<names.length;i++) 
  {  
    var value = me[names[i]];
    if (typeof value=="number" && value<worst.value) 
    {  
      worst = { name: names[i], value: value };  
    } 
  }  
  return worst; 
}

function rememberSafe(me, worst)  
{  
  var fish = me.fishLevelData!=null ? me.fishLevelData.fishLevel : null; 
  if (fish!=safeFish)  
  {  
    safeFish = fish; 
    safeSpots = []; 
    exploreDir = null;
  }  
  if (worst.value<99 || Date.now() - safeAt < 400)  
  {
    return;
  }  
  safeAt = Date.now(); 
  var last = safeSpots[safeSpots.length - 1];  
  if (last!=null && Math.abs(last.x - me.position.x) + Math.abs(last.y - me.position.y) < 200)  
  {
    return; 
  } 
  safeSpots.push({ x: me.position.x, y: me.position.y }); 
  if (safeSpots.length>60) 
  {  
    safeSpots.shift(); 
  }  
}

function bitCount(value)  
{  
  var count = 0;  
  while (value>0)
  {
    count = count + (value & 1); 
    value = value >> 1;  
  } 
  return count; 
}  

function livesIn(animal, area, fishLevel)  
{
  if (fishLevel!=sunfish && (animal & area & habDeep)!=0) 
  {  
    animal = animal | habWarm | habCold;
  } 
  var shared = animal & area; 
  var count = bitCount(shared);  
  if (count<Math.min(bitCount(area), 3))
  {
    return false; 
  }  
  if (count<3)
  {  
    return true; 
  }
  return (shared & (habFresh | habSalt))!=0 && (shared & (habShallow | habDeep))!=0 && (shared & (habWarm | habCold))!=0;  
} 

function serverFish(fishLevel)
{ 
  try
  {  
    var stats = gameState.serverStats._value || gameState.serverStats;
    return stats.fishLevelsData[fishLevel];
  } 
  catch {} 
  return null;  
}

function habitatOf(fishLevel) 
{
  var data = serverFish(fishLevel);
  if (data==null || typeof data.habitat!="number") 
  { 
    return null; 
  } 
  return data.habitat; 
}

function currentArea(me)
{  
  if (me!=null && typeof me._currentArea=="number")
  {  
    return me._currentArea; 
  } 
  try
  { 
    var area = gameState.currentArea._value; 
    if (typeof area=="number")  
    { 
      return area;  
    }  
  }
  catch {} 
  return null;  
} 

function canLiveHere(me)
{  
  var area = currentArea(me);  
  if (area==null || me.fishLevelData==null)
  { 
    return true;  
  }
  return livesIn(me.fishLevelData.habitat, area, me.fishLevelData.fishLevel);  
}

function nearestHabitat(me) 
{ 
  var rects = null;  
  try
  {  
    rects = game.currentScene.minimap.habitats;  
  } 
  catch {}  
  if (rects==null || me.fishLevelData==null)  
  {
    return null; 
  } 
  var best = null; 
  var bestDist = Infinity; 
  for(var i = 0;i<rects.length;i++)  
  { 
    var r = rects[i].rectangle;  
    if (r==null || !livesIn(me.fishLevelData.habitat, rects[i].habitat, me.fishLevelData.fishLevel))  
    {  
      continue;  
    } 
    var left = r.x * mapScale;
    var top = r.y * mapScale;
    var right = (r.x + r.width) * mapScale;
    var bottom = (r.y + r.height) * mapScale;
    var margin = Math.min(400, (right - left) / 3, (bottom - top) / 3);  
    var x = Math.min(Math.max(me.position.x, left + margin), right - margin); 
    var y = Math.min(Math.max(me.position.y, top + margin), bottom - margin); 
    var dx = x - me.position.x;  
    var dy = y - me.position.y;
    var dist = dx*dx + dy*dy;
    if (dist<bestDist)  
    { 
      bestDist = dist;  
      best = { x: x, y: y };
    } 
  }
  return best; 
}  

function layerShapes(names) 
{  
  var tm = game.currentScene.terrainManager;  
  var list = []; 
  if (tm==null || tm.terrains==null)  
  { 
    return list; 
  }  
  for(var i = 0;i<tm.terrains.length;i++) 
  { 
    var t = tm.terrains[i];  
    if (t==null || t.settings==null || t.bounds==null || t.terrainData==null || t.terrainData.points==null) 
    { 
      continue; 
    }
    if (names.indexOf(t.settings.layerId)!=-1) 
    { 
      list.push({ b: t.bounds, p: t.terrainData.points, layer: t.settings.layerId });
    } 
  }
  return list;  
}

function nearestInside(me, shapes, edge)
{
  var best = null;  
  var bestDist = Infinity; 
  for(var i = 0;i<shapes.length;i++)
  { 
    var b = shapes[i].b;
    var key = shapes[i].layer + Math.round(b.minX) + "," + Math.round(b.minY); 
    if (badAir[key]!=null && badAir[key]>Date.now()) 
    {
      continue;  
    } 
    var margin = Math.min(150, (b.maxX - b.minX) / 3, (b.maxY - b.minY) / 3);  
    var x = Math.min(Math.max(me.position.x, b.minX + margin), b.maxX - margin);
    var y = Math.min(Math.max(me.position.y, b.minY + margin), b.maxY - margin);  
    if (edge && shapes[i].layer=="sky") 
    {  
      y = b.maxY - margin; 
    }  
    if (!insidePolygon(shapes[i].p, x, y) || isWall(me, x, y))  
    { 
      continue;
    }  
    var dx = x - me.position.x;  
    var dy = y - me.position.y;
    var dist = dx*dx + dy*dy; 
    if (dist<bestDist)
    { 
      bestDist = dist;  
      best = { x: x, y: y, key: key };  
    }  
  } 
  return best;  
}

function checkBreath(me, target)  
{ 
  var now = Date.now(); 
  if (target==null) 
  {
    breathGoal = null;
    return; 
  }  
  if (breathGoal==null || breathGoal.key!=target.key) 
  {  
    breathGoal = { key: target.key, x: me.position.x, y: me.position.y, at: now, oxygen: me._oxygen };  
    return;
  }  
  if (now - breathGoal.at < 2500)  
  { 
    return;  
  } 
  var moved = Math.abs(me.position.x - breathGoal.x) + Math.abs(me.position.y - breathGoal.y); 
  if (moved<150 && !(me._oxygen > breathGoal.oxygen + 1))  
  {  
    badAir[target.key] = now + 20000; 
    breathGoal = null;  
    return;
  } 
  breathGoal = { key: target.key, x: me.position.x, y: me.position.y, at: now, oxygen: me._oxygen }; 
}  

function breathTarget(me) 
{  
  var level = me.fishLevelData || {};  
  if (level.breathesInAir==true && level.breathesInWater!=true) 
  {  
    return nearestInside(me, layerShapes(["sky", "air-pockets"]), true); 
  } 
  if (level.breathesInWater==true && level.breathesInAir!=true)  
  { 
    return nearestInside(me, layerShapes(["water"]), false);
  }
  return null;
} 

function safeTarget(me, worst)
{
  if (worst.name=="_oxygen")  
  { 
    var air = null; 
    try
    { 
      air = breathTarget(me); 
      checkBreath(me, air);
    } 
    catch {} 
    if (air!=null)  
    {  
      return air; 
    } 
    var level = me.fishLevelData || {};
    if (level.breathesInAir==true && level.breathesInWater!=true) 
    { 
      return { x: me.position.x, y: me.position.y - 1500 };  
    } 
  }  
  if (worst.name!="" && worst.name!="_oxygen" || !canLiveHere(me))  
  { 
    var home = nearestHabitat(me);  
    if (home!=null && Math.abs(home.x - me.position.x) + Math.abs(home.y - me.position.y) > 200) 
    {
      return home;  
    }  
    if (worst.name!="_oxygen") 
    {
      return explore(me, worst);  
    }
  }  
  var best = null; 
  var bestDist = Infinity;
  for(var i = 0;i<safeSpots.length;i++) 
  {  
    var dx = safeSpots[i].x - me.position.x;  
    var dy = safeSpots[i].y - me.position.y;  
    var dist = dx*dx + dy*dy;
    if (dist<bestDist) 
    {  
      bestDist = dist;
      best = safeSpots[i];  
    } 
  } 
  if (best!=null) 
  {
    return best; 
  }
  return explore(me, worst);  
} 

function explore(me, worst)  
{  
  var now = Date.now();  
  if (exploreDir==null)
  {  
    var level = me.fishLevelData || {}; 
    var back = { x: 0, y: -1 };  
    var old = trail.length>0 ? trail[0] : null; 
    if (old!=null)
    { 
      var bx = old.x - me.position.x;
      var by = old.y - me.position.y;
      var blen = Math.sqrt(bx*bx + by*by);
      if (blen>100)  
      {
        back = { x: bx / blen, y: by / blen };
      }
    }  
    if (worst.name=="_oxygen" && level.breathesInAir==true && level.breathesInWater!=true && old==null)
    {
      back = { x: 0, y: -1 }; 
    }
    exploreDir = [back, { x: -back.y, y: back.x }, { x: back.y, y: -back.x }, { x: -back.x, y: -back.y }];  
    exploreIndex = 0;
    exploreAt = now; 
    exploreLast = worst.value; 
  }  
  else if (worst.value>exploreLast + 1) 
  {  
    exploreAt = now;  
    exploreLast = worst.value; 
  }  
  else if (now - exploreAt > 4000) 
  { 
    exploreIndex = (exploreIndex + 1) % exploreDir.length;  
    exploreAt = now; 
    exploreLast = worst.value; 
  }  
  var dir = exploreDir[exploreIndex];
  return { x: me.position.x + dir.x * 1500, y: me.position.y + dir.y * 1500 }; 
}

function badPicks() 
{
  var list = plugin.storage.get("badPicks"); 
  if (list==null || typeof list.length!="number") 
  { 
    return []; 
  }  
  return list;  
} 

function learnDeath() 
{
  if (deathHandled) 
  { 
    return;  
  } 
  var reason = document.querySelector(".death-reason");
  if (reason==null)  
  {
    return;  
  }
  deathHandled = true; 
  if (lastFish!=null && reason.innerText.toLowerCase().indexOf("breathe")!=-1)  
  { 
    var counts = plugin.storage.get("meterDeaths") || {};  
    counts[lastFish] = (counts[lastFish] || 0) + 1;  
    plugin.storage.set("meterDeaths", counts); 
    var list = badPicks().slice();  
    if (counts[lastFish]>=2 && list.indexOf(lastFish)==-1)  
    { 
      list.push(lastFish); 
      plugin.storage.set("badPicks", list);  
    }
  }  
}

function visible(el)  
{
  return el!=null && el.getBoundingClientRect().width>0; 
}  

function clickRejoin()  
{ 
  if (Date.now() - rejoinAt < 1500)
  { 
    return; 
  } 
  var buttons = document.querySelectorAll("button");  
  for(var i = 0;i<buttons.length;i++) 
  {  
    var label = buttons[i].innerText.trim().toLowerCase();  
    if ((label.indexOf("rejoin")!=-1 || label.indexOf("reconnect")!=-1) && visible(buttons[i]))
    {  
      rejoinAt = Date.now();
      buttons[i].click();  
      return; 
    }  
  } 
} 

function respawn()
{
  if (!plugin.getSetting("Auto respawn") || Date.now() - respawnAt < 1500)  
  {  
    return; 
  }  
  var buttons = document.querySelectorAll("button"); 
  for(var i = 0;i<buttons.length;i++) 
  {  
    var label = buttons[i].innerText.trim().toLowerCase(); 
    if ((label=="continue" || label.indexOf("rejoin")!=-1 || label.indexOf("reconnect")!=-1) && visible(buttons[i]))  
    {  
      respawnAt = Date.now();
      buttons[i].click(); 
      return;  
    } 
  } 
  var play = document.querySelector("button.play-hero");  
  if (visible(play) && evolveChoices()==null) 
  { 
    respawnAt = Date.now();
    safeSpots = [];  
    play.click(); 
  }
}

function spawnZones() 
{ 
  var map = null; 
  try
  {
    map = gameState.map._value || gameState.map; 
  } 
  catch {}  
  if (map==null || map.data==null)
  {  
    return []; 
  }
  if (zones!=null && zonesMap==map) 
  { 
    return zones; 
  }  
  zones = []; 
  zonesMap = map;
  try
  {  
    var data = typeof map.data=="string" ? JSON.parse(map.data) : map.data;  
    var objects = data.screenObjects;
    for (var key in objects) 
    {  
      var o = objects[key]; 
      if (o==null || o.layerId!="food-spawns" || o.position==null || o.size==null || o.settings==null)
      {  
        continue;  
      } 
      zones.push({  
        left: o.position.x * zoneScale,
        top: o.position.y * zoneScale,
        right: (o.position.x + o.size.width) * zoneScale,
        bottom: (o.position.y + o.size.height) * zoneScale,  
        foods: o.settings.foodIds || [],
        count: o.settings.count || 1, 
        respawn: number(o.settings.reSpawnMs, 20000), 
      });
    }  
  }  
  catch {}  
  return zones; 
}  

function habitatAt(x, y)
{  
  var rects = null;
  try
  { 
    rects = game.currentScene.minimap.habitats;
  } 
  catch {} 
  if (rects==null) 
  {
    return null;  
  } 
  var found = null;  
  for(var i = 0;i<rects.length;i++)  
  {  
    var r = rects[i].rectangle;  
    if (r!=null && x>=r.x * mapScale && x<=(r.x + r.width) * mapScale && y>=r.y * mapScale && y<=(r.y + r.height) * mapScale) 
    {  
      found = rects[i].habitat;
    } 
  } 
  return found;  
}  

function zoneXp(me, zone) 
{
  var best = 0;
  for(var i = 0;i<zone.foods.length;i++)  
  { 
    var rule = foodRules[zone.foods[i]]; 
    if (rule==null)  
    { 
      best = Math.max(best, 150);
    }  
    else if (rule.xp>0 && canEat(me, rule))  
    { 
      best = Math.max(best, rule.xp);  
    } 
  } 
  return best;  
} 

function zoneUseful(me, zone) 
{
  if (zoneXp(me, zone)<=0)  
  { 
    return false;
  }
  if (me.fishLevelData==null) 
  { 
    return true;
  } 
  var area = habitatAt((zone.left + zone.right) / 2, (zone.top + zone.bottom) / 2); 
  return area==null || livesIn(me.fishLevelData.habitat, area, me.fishLevelData.fishLevel); 
}  

function zoneTarget(me)  
{ 
  var list = spawnZones(); 
  var best = null; 
  var bestScore = Infinity; 
  for(var i = 0;i<list.length;i++)  
  { 
    var z = list[i];  
    if (z.emptyUntil!=null && z.emptyUntil>Date.now())  
    { 
      continue;
    }  
    if (!zoneUseful(me, z)) 
    {  
      continue;  
    } 
    var x = Math.min(Math.max(me.position.x, z.left), z.right);  
    var y = Math.min(Math.max(me.position.y, z.top), z.bottom);  
    var dx = x - me.position.x; 
    var dy = y - me.position.y;
    var score = (Math.sqrt(dx*dx + dy*dy) + 300) / Math.sqrt(z.count * zoneXp(me, z) / 150); 
    if (z.visitedAt!=null && Date.now() - z.visitedAt < z.respawn)  
    {  
      score = score * 3;  
    }
    if (score<bestScore) 
    {  
      bestScore = score;  
      best = z;
    }
  } 
  if (best==null) 
  { 
    return null;
  }
  return { 
    x: best.left + Math.random() * (best.right - best.left),  
    y: best.top + Math.random() * (best.bottom - best.top), 
    zone: best,  
  };  
}

function wander(me)  
{
  var now = performance.now();
  if (wanderPoint!=null && now<wanderUntil)
  {  
    var dx = wanderPoint.x - me.position.x; 
    var dy = wanderPoint.y - me.position.y;
    if (dx*dx + dy*dy > 150*150)
    {
      return wanderPoint;  
    }
  } 
  if (wanderPoint!=null && wanderPoint.zone!=null)
  { 
    wanderPoint.zone.visitedAt = Date.now();  
    wanderPoint.zone.emptyUntil = Date.now() + Math.min(Math.max(wanderPoint.zone.respawn, 8000), 45000);  
  } 
  var zone = null;  
  try
  { 
    zone = zoneTarget(me);
  } 
  catch {}  
  if (zone!=null) 
  {  
    wanderPoint = zone;  
    wanderUntil = now + 15000; 
    return wanderPoint;  
  } 
  var r = Math.random() * Math.PI * 2;
  wanderPoint = { x: me.position.x + Math.cos(r) * 1500, y: me.position.y + Math.sin(r) * 1500 }; 
  wanderUntil = now + 4000;  
  return wanderPoint; 
} 

function tick()  
{
  try
  { 
    if (!on || game==null) 
    {
      return; 
    } 
    clickRejoin(); 
    var scene = game.currentScene; 
    var me = null;  
    if (scene!=null && scene.myAnimals!=null)  
    { 
      me = scene.myAnimals[0]; 
    } 
    if (me==null || me.position==null || game.inputManager==null) 
    {  
      refilling = false;
      trail = [];
      try
      { 
        learnDeath();  
        respawn();  
        autoEvolve();
      } 
      catch {}  
      return; 
    }  
    try
    {  
      hookInput(); 
    }  
    catch {}  
    try
    { 
      autoEvolve(); 
    }
    catch {}  
    if (otherBusy())  
    {  
      return; 
    }  

    var animals = game.currentScene.entityManager.animalsList;  
    var fleeRadius = plugin.getSetting("Flee radius"); 
    var dangerBites = plugin.getSetting("Danger bites"); 
    var huntRadius = plugin.getSetting("Hunt radius");
    var maxHuntBites = plugin.getSetting("Max hunt bites"); 
    var lowHp = hpPercent(me) < plugin.getSetting("Low HP (%)"); 
    var fleeX = 0;  
    var fleeY = 0;
    var closestThreat = Infinity; 
    var charger = null;  
    var prey = null;  
    var preyScore = Infinity;

    if (lowHp)  
    {  
      dangerBites = dangerBites * 2;
      fleeRadius = fleeRadius * 1.5; 
    }  

    if (me.holded==true || (me.entityData!=null && me.entityData.holded==true)) 
    { 
      mode = "grabbed";
      boost(me);  
    }  

    lastFish = me.fishLevelData!=null ? me.fishLevelData.fishLevel : null;
    deathHandled = false; 
    if (Date.now() - trailAt > 250)  
    {
      trailAt = Date.now(); 
      trail.push({ x: me.position.x, y: me.position.y }); 
      while (trail.length>12)  
      { 
        trail.shift();  
      }  
    }
    if (me._standing && goal!=null && goal.y < me.position.y - 100 && trail.length>=4) 
    {
      var before = trail[trail.length - 4];  
      if (Math.abs(before.x - me.position.x) + Math.abs(before.y - me.position.y) < 40) 
      { 
        unstick(me);  
      } 
    }
    if (stuckCheck==null || Date.now() - stuckCheck.t > 4000) 
    {  
      var stuckLimit = me._standing ? 120 : 40; 
      if (stuckCheck!=null && Math.abs(me.position.x - stuckCheck.x) + Math.abs(me.position.y - stuckCheck.y) < stuckLimit) 
      {
        stuckUntil = Date.now() + 2500; 
        if (me._standing) 
        { 
          unstick(me);
        } 
        var away = Math.random() * Math.PI * 2;  
        wanderPoint = { x: me.position.x + Math.cos(away) * 1200, y: me.position.y + Math.sin(away) * 1200 };  
        wanderUntil = performance.now() + 2500; 
      } 
      stuckCheck = { x: me.position.x, y: me.position.y, t: Date.now() }; 
    }
    var worst = worstMeter(me); 
    var meterLimit = plugin.getSetting("Meter limit (%)");
    rememberSafe(me, worst);  
    var wrongArea = !canLiveHere(me); 
    if (worst.value<meterLimit || (wrongArea && worst.value<99))  
    {  
      refilling = true; 
    }  
    if (refilling && worst.value>=95) 
    {
      refilling = false;  
      exploreDir = null;  
    } 
    var safe = refilling ? safeTarget(me, worst) : null;  
    if (safe!=null && worst.value<meterLimit / 2)  
    { 
      mode = "breathe";
      goTo(me, safe.x, safe.y, true);
      return; 
    }

    for(var i = 0;i<animals.length;i++)  
    {  
      var a = animals[i];  
      if (!isOther(me, a)) 
      {  
        continue;  
      } 
      var dx = a.position.x - me.position.x;
      var dy = a.position.y - me.position.y; 
      var dist = Math.sqrt(dx*dx + dy*dy);
      if (dist<1)
      { 
        continue;
      } 
      if (sameKind(me, a))  
      { 
        tracked.set(a, { x: a.position.x, y: a.position.y });
        continue;  
      }  
      var theirs = isNpc(a) ? Infinity : bitesToKill(a, me);  
      var mine = bitesToKill(me, a);  

      var danger = theirs!=null && theirs<=dangerBites && !(mine!=null && mine<theirs);
      var charging = danger && boostingAtMe(me, a, dx, dy, dist); 
      tracked.set(a, { x: a.position.x, y: a.position.y });

      if (danger && (dist<=fleeRadius || (charging && dist<=fleeRadius * 1.3)))
      {  
        var weight = 1 / Math.max(dist, 50); 
        if (a.entityData!=null && a.entityData.isUsingSkill==true) 
        {  
          weight = weight * 2;  
        } 
        fleeX = fleeX - dx / dist * weight;
        fleeY = fleeY - dy / dist * weight;  
        if (dist<closestThreat)
        { 
          closestThreat = dist; 
        }  
        if (charging && (charger==null || dist<charger.dist))
        { 
          charger = { dx: dx, dy: dy, dist: dist };  
        }  
        continue; 
      }

      if (plugin.getSetting("Hunt") && !lowHp && dist<=huntRadius && lineClear(me, a.position.x, a.position.y) && mine!=null && mine<=maxHuntBites && (theirs==null || mine<=theirs))  
      { 
        var score = dist * mine; 
        if (score<preyScore)  
        { 
          preyScore = score;
          prey = { animal: a, dist: dist }; 
        }  
      } 
    } 

    if (charger!=null && plugin.getSetting("Dodge boosts") && hasEnergy(me) && Date.now() - lastBoost >= boostCooldown) 
    {
      var sideX = charger.dy / charger.dist;
      var sideY = -charger.dx / charger.dist;
      if (fleeX * sideX + fleeY * sideY < 0) 
      {
        sideX = -sideX; 
        sideY = -sideY; 
      }
      mode = "dodge";  
      goTo(me, me.position.x + sideX * 1500, me.position.y + sideY * 1500, true);  
      boost(me); 
      return;
    }

    if (fleeX!=0 || fleeY!=0) 
    { 
      var len = Math.sqrt(fleeX*fleeX + fleeY*fleeY); 
      mode = "flee";  
      goTo(me, me.position.x + fleeX / len * 1500, me.position.y + fleeY / len * 1500, true); 
      if (plugin.getSetting("Boost to escape") && closestThreat<450)  
      {  
        boost(me); 
      }  
      return; 
    }

    if (safe!=null)  
    {  
      mode = "breathe"; 
      goTo(me, safe.x, safe.y, true);  
      return;  
    } 

    if (prey!=null) 
    {  
      var target = prey.animal;  
      var tx = target.position.x;  
      var ty = target.position.y; 
      if (target.targetVelocity!=null)  
      {
        tx = tx + number(target.targetVelocity.x, 0) * 0.3;  
        ty = ty + number(target.targetVelocity.y, 0) * 0.3; 
      } 
      mode = "hunt";
      goTo(me, tx, ty, false);
      if (plugin.getSetting("Boost to hunt") && prey.dist<400)
      { 
        boost(me); 
      }  
      return;
    } 

    if (Date.now()<stuckUntil)
    {  
      mode = "stuck";  
      var away = wander(me);
      goTo(me, away.x, away.y, true);  
      return;
    }  

    checkEaten(me);
    var food = findFood(me, animals); 
    if (food!=null)  
    { 
      var fx = food.position.x - me.position.x; 
      var fy = food.position.y - me.position.y;  
      if (food!=foodTarget)
      {
        foodTarget = food;
        closeSince = 0;  
      } 
      foodTargetDist = Math.sqrt(fx*fx + fy*fy);
      if (fx*fx + fy*fy < 200*200)
      {  
        if (closeSince==0) 
        { 
          closeSince = Date.now();  
        } 
        else if (Date.now() - closeSince > 1500)  
        {  
          ignoredFood.set(food, Date.now() + 30000);
          ignoreAround(food, 250, 15000); 
          var failKey = dietKey(me, food);  
          if (failKey!=null)
          { 
            dietFails[failKey] = (dietFails[failKey] || 0) + 1; 
          }  
          foodTarget = null; 
        } 
      }  
      mode = "food"; 
      goTo(me, food.position.x, food.position.y, false); 
      return; 
    }

    mode = "wander"; 
    var point = wander(me); 
    goTo(me, point.x, point.y, true);
  } 
  catch {}  
}  

loadFoodRules(); 
setInterval(tick, 50); 

plugin.onKeybindDown("Toggle auto play", function() 
{ 
  if (game==null || game.currentScene==null || held)
  {  
    return; 
  }  
  held = true;  
  on = !on; 
  goal = null;  
  wanderPoint = null; 
  if (on)
  {
    popup("Auto play has been enabled");
  }  
  else
  {  
    popup("Auto play has been disabled"); 
  }  
});  

plugin.onKeybindUp("Toggle auto play", function() 
{ 
  held = false;
});  

if (window.__gaziStatus != null)  
{  
  window.__gaziStatus.parts.push({ name: "Auto play", active: function() { return on; } }); 
}  
