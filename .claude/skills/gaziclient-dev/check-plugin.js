// Checks a GaziClient plugin before it is tested in game.
//
//   node .claude/skills/gaziclient-dev/check-plugin.js plugins/builtin/myplugin.js
//
// Run it from the repo root. For a file in plugins/builtin/ it also checks that the plugin is wired
// into the client: BUILTIN in src/plugins.rs, keyHelp, Turkish texts and the README.
// Exit code 1 when there are errors, 0 when there are only warnings or nothing.

var fs = require("fs");
var path = require("path");

var file = process.argv[2];
if (!file)
{
  console.log("usage: node check-plugin.js <plugin.js>");
  process.exit(2);
}
var code = fs.readFileSync(file, "utf8");
var errors = [];
var warnings = [];

function lineOf(index)
{
  return code.slice(0, index).split("\n").length;
}

// ---- header (src/plugins.rs reads the first 40 lines) ----
function header(tag)
{
  var lines = code.split(/\r?\n/).slice(0, 40);
  for(var i = 0;i<lines.length;i++)
  {
    var line = lines[i].trim();
    if (!line.startsWith("//"))
    {
      continue;
    }
    var rest = line.replace(/^\/+/, "").trim();
    if (rest.startsWith("@" + tag) && /^\s|^$/.test(rest.slice(tag.length + 1)))
    {
      return rest.slice(tag.length + 1).trim();
    }
  }
  return "";
}
var name = header("name");
var id = header("id");
if (!name)
{
  errors.push("no // @name in the first 40 lines");
}
if (!id)
{
  warnings.push("no // @id, the file name is used instead");
}
if (!header("description"))
{
  warnings.push("no // @description, the plugin list will show an empty line");
}

// ---- syntax, with the same parameters the runtime passes ----
var params = ["blockyfish", "plugin", "{hook, getnative, ishooked, restore, reflect, Reflect, Object}", "React", "ReactDOM", "{PIXI, gameState}", "{DeeeepioCustomButton, DeeeepioButton, DeeeepioCheckbox, DeeeepioTextInput, DeeeepioDropdown, DeeeepioLoadingSpinner, Modal}", "Buffer", "ui", "router", "capturer"];
try
{
  Function.apply(null, params.concat([code]));
}
catch (error)
{
  if (/<[A-Za-z]/.test(code))
  {
    warnings.push("not plain JS (" + error.message + "). Fine if it is JSX, the runtime compiles JSX first");
  }
  else
  {
    errors.push("syntax error: " + error.message);
  }
}

// ---- keybinds and settings ----
var keybinds = [];
var re = /registerKeybind\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]*)["'`]/g;
var m;
while ((m = re.exec(code)) != null)
{
  keybinds.push(m[1]);
  if (!/^(Key[A-Z]|Digit[0-9]|Numpad\w+|F[0-9]{1,2}|Arrow\w+|Space|Tab|Enter|Backspace|Shift\w*|Control\w*|Alt\w*|Backquote|Minus|Equal|Bracket\w+|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|Escape)?$/.test(m[2]))
  {
    warnings.push("keybind \"" + m[1] + "\" default \"" + m[2] + "\" does not look like a KeyboardEvent.code (e.g. KeyG, Digit1)");
  }
  if (m[2] == "Escape")
  {
    warnings.push("keybind \"" + m[1] + "\" uses Escape, which GaziClient already uses for the Esc pause");
  }
  if (m[1].replace(/^Toggle /, "").length>18)
  {
    warnings.push("keybind name \"" + m[1] + "\" is long; on Android it is the on-screen button label");
  }
}
keybinds.forEach(function(bind)
{
  if (code.indexOf("onKeybindDown(\"" + bind + "\"") == -1 && code.indexOf("isKeybindDown(\"" + bind + "\"") == -1 && code.indexOf("onKeybindDown('" + bind + "'") == -1)
  {
    warnings.push("keybind \"" + bind + "\" is registered but never used with onKeybindDown / isKeybindDown");
  }
});
var settingNames = [];
var sre = /registerSetting\(\s*\{[^}]*?name\s*:\s*["'`]([^"'`]+)["'`]/g;
while ((m = sre.exec(code)) != null)
{
  settingNames.push(m[1]);
}
var gre = /getSetting\(\s*["'`]([^"'`]+)["'`]/g;
while ((m = gre.exec(code)) != null)
{
  if (settingNames.indexOf(m[1]) == -1)
  {
    warnings.push("line " + lineOf(m.index) + ": getSetting(\"" + m[1] + "\") but no registerSetting with that name");
  }
}

// ---- things that break live toggling ----
var tre = /^(var|let|const)\s+\w+\s*=\s*plugin\.getSetting\(/gm;
while ((m = tre.exec(code)) != null)
{
  warnings.push("line " + lineOf(m.index) + ": a setting read once at the top never sees menu changes; call getSetting where it is used");
}
var hre = /\b(?!window\b)\w+\.\w*[Hh]ooked\s*=\s*true/g;
while ((m = hre.exec(code)) != null)
{
  var before = code.slice(Math.max(0, m.index - 1), m.index);
  if (before != ".")
  {
    errors.push("line " + lineOf(m.index) + ": \"" + m[0] + "\" marks a game object as hooked; after off/on the hook is gone but the mark stays. Use a plugin-local WeakSet");
  }
}
var wre = /window\.(?!__gaziStatus|__gaziEscPause|location|innerWidth|innerHeight|devicePixelRatio)(\w+)\s*=[^=]/g;
while ((m = wre.exec(code)) != null)
{
  warnings.push("line " + lineOf(m.index) + ": sets window." + m[1] + ", which is not cleaned up when the plugin is turned off");
}

// ---- network rule: only deeeep.io ----
var ure = /https?:\/\/([a-z0-9.-]+)/gi;
while ((m = ure.exec(code)) != null)
{
  var host = m[1].toLowerCase();
  if (host != "deeeep.io" && !host.endsWith(".deeeep.io"))
  {
    warnings.push("line " + lineOf(m.index) + ": URL to " + host + "; GaziClient only talks to deeeep.io");
  }
}
if (/\beval\s*\(|new\s+Function\s*\(|import\s*\(/.test(code))
{
  errors.push("eval / new Function / import(): plugins must not load or run code from strings or the network");
}

// ---- wiring for built-in plugins ----
var rel = path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, "/");
if (rel.startsWith("plugins/builtin/"))
{
  var base = path.basename(file);
  var key = "gaziclient-plugins/" + base;
  var read = function(p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } };
  var rs = read("src/plugins.rs");
  var rt = read("runtime/runtime.js");
  var readme = read("README.md");
  if (rs != null && rs.indexOf("(\"" + base + "\", include_str!(\"../plugins/builtin/" + base + "\"))") == -1)
  {
    errors.push("not in BUILTIN in src/plugins.rs");
  }
  if (rt != null)
  {
    if (rt.indexOf("\"" + key + "\":") == -1)
    {
      warnings.push("no entries for \"" + key + "\" in runtime.js (keyHelp / pluginDescriptionsTr)");
    }
    var helpMatch = new RegExp("var keyHelp =[\\s\\S]*?\"" + key.replace(/[.\/]/g, "\\$&") + "\": (\\{[^\\n]*\\}),?\\s*\\n").exec(rt);
    keybinds.forEach(function(bind)
    {
      if (helpMatch == null || helpMatch[1].indexOf("\"" + bind + "\"") == -1)
      {
        warnings.push("keybind \"" + bind + "\" has no line in keyHelp");
      }
    });
    if (helpMatch != null)
    {
      var texts = helpMatch[1].match(/:\s*"([^"]+)"/g) || [];
      texts.forEach(function(t)
      {
        var text = t.replace(/^:\s*"/, "").replace(/"$/, "");
        if (rt.indexOf("\"" + text + "\": \"") == -1)
        {
          warnings.push("keyHelp text has no Turkish line in trText: \"" + text + "\"");
        }
      });
    }
    var trBlock = /var pluginDescriptionsTr =[\s\S]*?\n\};/.exec(rt);
    if (trBlock != null && trBlock[0].indexOf("\"" + key + "\"") == -1)
    {
      warnings.push("no Turkish description in pluginDescriptionsTr");
    }
  }
  if (readme != null && name && readme.indexOf(name) == -1)
  {
    warnings.push("\"" + name + "\" is not in the README plugin list");
  }
}

// ---- report ----
console.log((name || base || file) + (id ? " (" + id + ")" : "") + ": " + keybinds.length + " keybind(s), " + settingNames.length + " setting(s)");
errors.forEach(function(e) { console.log("  ERROR   " + e); });
warnings.forEach(function(w) { console.log("  warning " + w); });
if (errors.length == 0 && warnings.length == 0)
{
  console.log("  ok");
}
process.exit(errors.length>0 ? 1 : 0);
