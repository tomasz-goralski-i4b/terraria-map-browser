# Samples how a local Terraria installation paints and shades sprites, for docs/assets.md ("Paint"):
#   ./scripts/sprite-paint/observe.ps1 -Dir '<Terraria directory>' -Out paint.json
# Black-box observation (ADR 0003): the game's TileShader effect is loaded on a real GPU device and every one of its
# passes is drawn over a synthetic texture (the RGB cube in steps of 17); Main.ConvertPaintIdToTileShaderIndex says
# which pass each paint uses, Tile.actColor how an inactive tile is shaded, and TreePaintSystemData's settings applied by
# the game's TreePaintingSettings.ApplyShader how trees and grass are painted (their special groups). Only the results are recorded; no game
# code or shader code is read. The output is game-derived and never committed.
[CmdletBinding()]
param([string]$Dir = 'C:/Program Files (x86)/Steam/steamapps/common/Terraria', [Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
if ([Environment]::Is64BitProcess) {
  & (Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Dir $Dir -Out $Out
  return
}
$gac = 'C:/Windows/Microsoft.NET/assembly/GAC_32'
$refs = @("$gac/Microsoft.Xna.Framework/v4.0_4.0.0.0__842cf8be1de50553/Microsoft.Xna.Framework.dll",
  "$gac/Microsoft.Xna.Framework.Graphics/v4.0_4.0.0.0__842cf8be1de50553/Microsoft.Xna.Framework.Graphics.dll",
  "$gac/Microsoft.Xna.Framework.Game/v4.0_4.0.0.0__842cf8be1de50553/Microsoft.Xna.Framework.Game.dll",
  'System.Windows.Forms', 'System.Drawing')
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Reflection;
using System.Text;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Content;
using System.Windows.Forms;
public class Svc : IServiceProvider, IGraphicsDeviceService {
  public GraphicsDevice GraphicsDevice { get; set; }
  public event EventHandler<EventArgs> DeviceCreated { add { } remove { } }
  public event EventHandler<EventArgs> DeviceDisposing { add { } remove { } }
  public event EventHandler<EventArgs> DeviceReset { add { } remove { } }
  public event EventHandler<EventArgs> DeviceResetting { add { } remove { } }
  public object GetService(Type t) { return t == typeof(IGraphicsDeviceService) ? this : null; }
}
public static class Observer {
  const int Size = 64; // 4096 inputs: the RGB cube in steps of 17
  public static string Run(string dir) {
    var form = new Form();
    var pp = new PresentationParameters { BackBufferWidth = Size, BackBufferHeight = Size, DeviceWindowHandle = form.Handle, IsFullScreen = false };
    var device = new GraphicsDevice(GraphicsAdapter.DefaultAdapter, GraphicsProfile.HiDef, pp);
    var content = new ContentManager(new Svc { GraphicsDevice = device }, System.IO.Path.Combine(dir, "Content"));
    var fx = content.Load<Effect>("TileShader");
    var game = Assembly.LoadFrom(System.IO.Path.Combine(dir, "Terraria.exe"));
    var convert = game.GetType("Terraria.Main").GetMethod("ConvertPaintIdToTileShaderIndex", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
    var sb = new StringBuilder("{\"gameVersion\":\"");
    sb.Append("v" + game.GetName().Version).Append("\",\"parameters\":\"");
    foreach (var p in convert.GetParameters()) sb.Append(p.Name + " ");
    sb.Append("\",\"defaults\":{");
    bool first = true;
    foreach (var p in fx.Parameters) { if (!first) sb.Append(','); first = false; sb.AppendFormat("\"{0}\":\"{1}\"", p.Name, p.ParameterType == EffectParameterType.Bool ? p.GetValueBoolean().ToString() : p.GetValueSingle().ToString("R")); }
    sb.Append("},");
    var input = new Color[Size * Size];
    for (int i = 0; i < input.Length; i++) input[i] = new Color(17 * (i % 16), 17 * (i / 16 % 16), 17 * (i / 256), 255);
    var texture = new Texture2D(device, Size, Size);
    texture.SetData(input);
    var target = new RenderTarget2D(device, Size, Size, false, SurfaceFormat.Color, DepthFormat.None);
    var batch = new SpriteBatch(device);
    var output = new Color[Size * Size];
    sb.Append("\"passes\":[");
    for (int pass = 0; pass < fx.CurrentTechnique.Passes.Count; pass++) {
      device.SetRenderTarget(target);
      device.Clear(Color.Transparent);
      batch.Begin(SpriteSortMode.Immediate, BlendState.Opaque, SamplerState.PointClamp, DepthStencilState.None, RasterizerState.CullNone);
      fx.CurrentTechnique.Passes[pass].Apply();
      batch.Draw(texture, Vector2.Zero, Color.White);
      batch.End();
      device.SetRenderTarget(null);
      target.GetData(output);
      if (pass > 0) sb.Append(',');
      sb.Append('"');
      foreach (var c in output) sb.AppendFormat("{0:x2}{1:x2}{2:x2}{3:x2}", c.R, c.G, c.B, c.A);
      sb.Append('"');
    }
    sb.Append("],\"index\":[");
    for (int paint = 0; paint < 32; paint++) {
      if (paint > 0) sb.Append(',');
      sb.AppendFormat("[{0},{1},{2},{3}]", convert.Invoke(null, new object[] { paint, false, false }), convert.Invoke(null, new object[] { paint, false, true }),
        convert.Invoke(null, new object[] { paint, true, false }), convert.Invoke(null, new object[] { paint, true, true }));
    }
    // Special groups (trees, grass): the game's own settings applied by the game's own ApplyShader, per paint.
    var data = game.GetType("Terraria.GameContent.TreePaintSystemData");
    var probes = new System.Collections.Generic.List<object[]>();
    // Past the game's tile ids (754 in 1.4.5): the settings function takes any id.
    for (int t = 0; t < 1000; t++)
      for (int style = -1; style < 9; style++) probes.Add(new object[] { "tile:" + t + ":" + style, data.GetMethod("GetTileSettings").Invoke(null, new object[] { t, style }) });
    for (int f = 0; f < 32; f++)
      for (int style = -1; style < 9; style++) probes.Add(new object[] { "foliage:" + f + ":" + style, data.GetMethod("GetTreeFoliageSettings").Invoke(null, new object[] { f, style }) });
    var groups = new System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<string>>();
    var settingsOf = new System.Collections.Generic.Dictionary<string, object>();
    foreach (var entry in probes) {
      var settings = entry[1];
      var key = new StringBuilder();
      foreach (var f in settings.GetType().GetFields()) key.AppendFormat(System.Globalization.CultureInfo.InvariantCulture, "\"{0}\":{1},", f.Name, f.FieldType == typeof(bool) ? f.GetValue(settings).ToString().ToLowerInvariant() : ((float)f.GetValue(settings)).ToString("R", System.Globalization.CultureInfo.InvariantCulture));
      string k = key.ToString().TrimEnd(',');
      if (!groups.ContainsKey(k)) { groups[k] = new System.Collections.Generic.List<string>(); settingsOf[k] = settings; }
      groups[k].Add((string)entry[0]);
    }
    var apply = settingsOf.Count == 0 ? null : new System.Collections.Generic.List<object>(settingsOf.Values)[0].GetType().GetMethod("ApplyShader");
    sb.Append("],\"groups\":[");
    bool firstGroup = true;
    foreach (var k in groups.Keys) {
      sb.Append(firstGroup ? "" : ",").Append("{\"settings\":{").Append(k).Append("},\"keys\":[\"").Append(string.Join("\",\"", groups[k])).Append("\"],\"painted\":[");
      firstGroup = false;
      for (int paint = 0; paint < 32; paint++) {
        device.SetRenderTarget(target);
        device.Clear(Color.Transparent);
        batch.Begin(SpriteSortMode.Immediate, BlendState.Opaque, SamplerState.PointClamp, DepthStencilState.None, RasterizerState.CullNone);
        apply.Invoke(settingsOf[k], new object[] { paint, fx });
        batch.Draw(texture, Vector2.Zero, Color.White);
        batch.End();
        device.SetRenderTarget(null);
        target.GetData(output);
        sb.Append(paint == 0 ? "\"" : ",\"");
        foreach (var c in output) sb.AppendFormat("{0:x2}{1:x2}{2:x2}{3:x2}", c.R, c.G, c.B, c.A);
        sb.Append('"');
      }
      sb.Append("]}");
    }
    sb.Append("],\"inactive\":\"");
    var tile = game.GetType("Terraria.Tile");
    object probe = Activator.CreateInstance(tile);
    tile.GetMethod("inActive", new[] { typeof(bool) }).Invoke(probe, new object[] { true });
    sb.Append(tile.GetMethod("actColor", new[] { typeof(Color) }).Invoke(probe, new object[] { Color.White }));
    sb.Append("\"}");
    return sb.ToString();
  }
}
'@
[System.IO.File]::WriteAllText($Out, [Observer]::Run($Dir))
