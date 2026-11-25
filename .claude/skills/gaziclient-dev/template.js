// @name My plugin
// @id myplugin
// @description Says what it does in one line. Press the keybind to toggle.
// @author yourname
// @tags visual, client-side

// Starting point for a GaziClient plugin. Copy it to %APPDATA%\GaziClient\plugins\custom\myplugin.js
// to try it live, then to plugins/builtin/ to ship it (see SKILL.md).

plugin.registerKeybind("Toggle my plugin", "KeyG");

plugin.registerSetting({
  name: "Range",
  description: "how far away animals are still marked",
  type: "number",
  defaultValue: 1500,
});

var game = null;
var on = true;
var held = false;
// "Already hooked" lives here, not on the game object: these variables start fresh every time the
// plugin is turned back on, while a flag on game.inputManager would survive and block re-hooking.
var hookedInputs = new WeakSet();

blockyfish.addEventListener("gameInit", function(e)
{
  game = e.game;
});

function popup(text)
{
  try
  {
    game.currentScene.showMessagePopup(text, 1000, false);
  }
  catch (e)
  {
  }
}

// Example hook: runs on the player's input manager. The runtime removes it when the plugin is off.
function hookInput()
{
  var im = game.inputManager;
  if (im==null || hookedInputs.has(im))
  {
    return;
  }
  hookedInputs.add(im);
  hook(im, "getMouseWorldPosition",
  {
    apply(f, th, args)
    {
      var result = reflect.apply(f, th, args);
      // change `result` here while `on` is true and the Esc pause is off
      return result;
    },
  });
}

function tick()
{
  if (game==null || game.currentScene==null || game.currentScene.entityManager==null)
  {
    return;
  }
  hookInput();
  var paused = window.__gaziEscPause != null && window.__gaziEscPause.paused;
  if (!on || paused)
  {
    return;
  }
  var scene = game.currentScene;
  var me = scene.myAnimals!=null ? scene.myAnimals[0] : null;
  var animals = scene.entityManager.animalsList || [];
  // Read settings every time: changing one in the menu does not restart the plugin.
  var range = plugin.getSetting("Range");
  for(var i = 0;i<animals.length;i++)
  {
    var a = animals[i];
    if (a==null || a==me || me==null)
    {
      continue;
    }
    var dx = a.position.x - me.position.x;
    var dy = a.position.y - me.position.y;
    if (dx * dx + dy * dy<range * range)
    {
      // do something with `a`
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
}, 100);

plugin.onKeybindDown("Toggle my plugin", function()
{
  if (held)
  {
    return;
  }
  held = true;
  on = !on;
  popup(on ? "My plugin has been enabled" : "My plugin has been disabled");
});

plugin.onKeybindUp("Toggle my plugin", function()
{
  held = false;
});

// Show up in the start-of-match status line and in the Esc pause message.
if (window.__gaziStatus!=null)
{
  window.__gaziStatus.parts.push({ name: "My plugin", active: function() { return on; } });
}
if (window.__gaziEscPause!=null)
{
  window.__gaziEscPause.parts.push({ name: "My plugin", active: function() { return on; } });
}
