// @name Evolve watch
// @id evolvewatch
// @description Shows in front of every animal's name how much XP it still needs to evolve (⬆). Turns red with a warning when it is about to evolve. Press the keybind to toggle.
// @author akgazii⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠
// @tags visual, client-side

plugin.registerKeybind("Toggle evolve watch", "KeyF"); 

plugin.registerSetting({  
  name: "Warn below",  
  description: "turns red when the animal needs less XP than this to evolve", 
  type: "number", 
  defaultValue: 1000, 
});

var game; 
var on = true;
var held = false;  
var tagNear = "en" + Math.random().toString(36).slice(2, 6); 
var tagFar = "ef" + Math.random().toString(36).slice(2, 6);  
var nearStyle = { fill: "#ff4d4d", fontSize: 28, fontWeight: "bold" };
var farStyle = { fill: "#ffd84d", fontSize: 26 };  
var stripper = new RegExp("<(" + tagNear + "|" + tagFar + ")>[^<]*</(" + tagNear + "|" + tagFar + ")>\\s*", "g"); 

blockyfish.addEventListener("gameInit", function(e)  
{
  game = e.game; 
});  

function short(value)  
{ 
  if (value>=1000)  
  {
    return (value / 1000).toFixed(1) + "k";
  }  
  return String(Math.round(value)); 
} 

function writeName(animal, extra)  
{  
  var name = animal.nameObject;  
  if (name==null || typeof name.text!="string" || name.textStyles==null) 
  {  
    return;  
  }
  if (extra!="" && name.textStyles[tagNear]==null) 
  { 
    name.textStyles[tagNear] = nearStyle; 
    name.textStyles[tagFar] = farStyle; 
  }  
  var next = extra + name.text.replace(stripper, ""); 
  if (name.text!=next)  
  {  
    name.text = next;  
  }  
} 

function tick()  
{
  if (game==null || game.currentScene==null || game.currentScene.entityManager==null) 
  { 
    return;  
  }  
  var scene = game.currentScene; 
  var animals = scene.entityManager.animalsList;  
  if (animals==null) 
  { 
    return;
  }  
  var warn = plugin.getSetting("Warn below"); 
  for(var i = 0;i<animals.length;i++)  
  {
    var a = animals[i];  
    if (a==null || (scene.myAnimals!=null && scene.myAnimals.includes(a))) 
    {  
      continue; 
    }
    try
    { 
      var left = a.entityData!=null ? a.entityData.xpLeft : null;
      var npc = a.fishLevelData==null || a.fishLevelData.chooseable==false || a.fishLevelData.fishLevel==blockyfish.Animals.Ghost;  
      if (!on || npc || typeof left!="number" || left<=0)
      {
        writeName(a, ""); 
        continue;
      } 
      if (left<warn)
      {  
        writeName(a, "<" + tagNear + ">⚠⬆" + short(left) + "</" + tagNear + "> ");
      } 
      else
      {
        writeName(a, "<" + tagFar + ">⬆" + short(left) + "</" + tagFar + "> "); 
      } 
    }
    catch (e) 
    { 
    } 
  }
}  

setInterval(function()  
{ 
  try
  {
    tick();
  } 
  catch (e) 
  { 
  }
}, 250);  

plugin.onKeybindDown("Toggle evolve watch", function()
{ 
  if (held)  
  {  
    return;
  } 
  held = true;  
  on = !on; 
  try
  {  
    if (on)
    {  
      game.currentScene.showMessagePopup("Evolve watch has been enabled", 1000, false); 
    }  
    else
    {  
      game.currentScene.showMessagePopup("Evolve watch has been disabled", 1000, false); 
    } 
  }  
  catch (e)  
  {  
  }
}); 

plugin.onKeybindUp("Toggle evolve watch", function()
{
  held = false;
});  

if (window.__gaziStatus != null)  
{
  window.__gaziStatus.parts.push({ name: "Evolve watch", active: function() { return on; } }); 
} 
