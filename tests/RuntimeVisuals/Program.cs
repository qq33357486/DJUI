using DjuiRuntime;
using GameUI.Control;
using GameUI.Enum;

var checks = 0;
void Check(bool ok, string message) { checks++; if (!ok) throw new Exception(message); }
void Rect(Control c, float x, float y, float w, float h)
{
    Check(Math.Abs(c.Position.X - x) < .001f && Math.Abs(c.Position.Y - y) < .001f &&
          Math.Abs(c.Width - w) < .001f && Math.Abs(c.Height - h) < .001f,
          $"矩形应为 ({x},{y}) {w}x{h}，实际 ({c.Position.X},{c.Position.Y}) {c.Width}x{c.Height}");
}
DjuiNodeV6 ImageNode(string id, string fit, string starType = "Panel") => new()
{
    Id = id, Name = id, StarType = starType,
    Basic = new() { Visible = false },
    Transform = new() { X = 10, Y = 20, Width = 80, Height = 40 },
    Appearance = new() { Image = "preset.png", ImageFit = fit, SourceSize = new() { Width = 200, Height = 100 },
        ImageTint = "#123456", SlicedEdges = [2, 3, 4, 5], ImageFlipX = true },
};

var project = new DjuiProjectV6();
var source = ImageNode("template", "contain");
source.Children.Add(ImageNode("badge", "contain"));
source.Children[0].Transform = new() { X = 7, Y = 9, Width = 24, Height = 24 };
source.Children[0].Appearance!.SourceSize = new() { Width = 100, Height = 100 };
var page = new DjuiPageV6 { PageId = "test", Root = new() { Id = "root", StarType = "Panel", Children = [source] } };
using var tree = DjuiTreeBuilderV6.Build("test#1", project, page);
var solved = DjuiLayoutSolverV6.SolveV6(tree.Session.CurrentPage, tree.Session.CurrentPlan);
var clone = DjuiTreeBuilderV6.BuildClone(source, tree.Session, null, tree.ImageVisuals, tree.ProgressVisuals, tree.ButtonStates, "#c1", solved);
var badge = tree.GetControl<Panel>("badge#c1")!;
var badgeVisual = tree.ImageVisuals.GetVisual(badge)!;
Rect(badge, 7, 9, 24, 24);
Rect(badgeVisual, 0, 0, 24, 24);
Check(badgeVisual.Width > 0 && badgeVisual.Height > 0 && badgeVisual.Image == "preset.png", "克隆预置图需立即可绘制");
Check(!badge.Visible, "克隆保持隐藏");
badge.Visible = true;
Rect(badgeVisual, 0, 0, 24, 24);

// 明确覆盖未挂树且隐藏时的直接尺寸赋值，不依赖引擎事件或 SetImage。
badge.Visible = false;
badge.Width = 36; badge.Height = 18;
Game.Tick();
badge.Visible = true;
Rect(badgeVisual, 9, 0, 18, 18);
Check(badgeVisual.Image == "preset.png", "尺寸同步不能换图");
var writes = badgeVisual.RectWrites;
Game.Tick();
Check(badgeVisual.RectWrites == writes, "尺寸未变不能重复写矩形");
clone.Width = 240; clone.Height = 100;
badge.Width = 20; badge.Height = 30;
Check(DjuiWindowManagerV6.RefreshVisuals(clone, recursive: false), "单节点刷新成功");
Rect(tree.ImageVisuals.GetVisual(clone)!, 20, 0, 200, 100);
Rect(badgeVisual, 9, 0, 18, 18);
Check(DjuiWindowManagerV6.RefreshVisuals(clone), "子树刷新成功");
Rect(badgeVisual, 0, 5, 20, 20);
Check(!clone.Visible && badge.Visible, "刷新不回退业务显隐");
clone.ClipContent = true;
clone.Width = 250;
Game.Tick();
Check(clone.ClipContent, "尺寸自动同步不回退业务裁剪");
clone.Width = 240;
DjuiWindowManagerV6.RefreshVisuals(clone);
Rect(clone, solved["template"].X, solved["template"].Y, 240, 100);
Check(source.Transform!.Width == 80, "刷新不写 authored 布局模型");
tree.Session.Relayout();
Rect(tree.ImageVisuals.GetVisual(clone)!, 20, 0, 200, 100);
Check(badge.Visible, "authored 重布局不回退克隆显隐");
var authored = tree.GetControl<Panel>("template")!;
authored.Width = 100; authored.Height = 100;
Check(DjuiWindowManagerV6.RefreshVisuals(authored, false), "authored 节点立即刷新");
Rect(tree.ImageVisuals.GetVisual(authored)!, 0, 25, 100, 50);
authored.Width = 300; authored.Height = 60;
Game.Tick();
Rect(tree.ImageVisuals.GetVisual(authored)!, 90, 0, 120, 60);
tree.Session.Relayout();
Rect(tree.ImageVisuals.GetVisual(authored)!, 0, 0, 80, 40);

foreach (var fit in new[] { "contain", "cover", "stretch" })
{
    var host = new Panel();
    var model = ImageNode(fit, fit);
    using var images = new DjuiImageVisualLayerV6();
    images.Apply(fit, host, model.Appearance);
    var visual = images.GetVisual(host)!;
    foreach (var size in new[] { (100f, 100f), (300f, 60f), (0f, 0f), (80f, 160f) })
    {
        host.Width = size.Item1; host.Height = size.Item2;
        Game.Tick();
        var scale = fit == "cover" ? Math.Max(size.Item1 / 200, size.Item2 / 100) : Math.Min(size.Item1 / 200, size.Item2 / 100);
        var w = fit == "stretch" ? size.Item1 : 200 * scale;
        var h = fit == "stretch" ? size.Item2 : 100 * scale;
        Rect(visual, (size.Item1 - w) / 2, (size.Item2 - h) / 2, w, h);
        Check(visual.SlicedEdges == new Thickness(2, 3, 4, 5), "九宫格边距保留在绘制层");
        Check(visual.Background == Color.FromArgb(255, 18, 52, 86) && visual.ImageFlipX, "染色与翻转保留");
        Check(host.ClipContent == (fit == "cover"), "cover 裁剪契约");
    }
    model.Appearance!.FocalX = 1; model.Appearance.FocalY = 0;
    host.Width = 100; host.Height = 100;
    images.Apply(fit, host, model.Appearance);
    if (fit == "contain") Rect(visual, 0, 0, 100, 50);
    if (fit == "cover") Rect(visual, -100, 0, 200, 100);
    model.Appearance.SourceSize = null;
    images.Apply(fit, host, model.Appearance);
    Rect(visual, 0, 0, 100, 100);
    model.Appearance.Image = null;
    images.Apply(fit, host, model.Appearance);
    Check(images.GetVisual(host) == null && !visual.IsValid, "撤图清理视觉状态");
    host.Dispose(); Game.Tick();
}

var buttonNode = ImageNode("button", "stretch", "Button");
buttonNode.Button = new() { ImageHover = "hover.png", ImagePressed = "pressed.png" };
var buttonSolved = new Dictionary<string, DjuiRectV6> { ["button"] = new(0, 0, 60, 30) };
var button = (Button)DjuiTreeBuilderV6.BuildClone(buttonNode, tree.Session, null, tree.ImageVisuals, tree.ProgressVisuals, tree.ButtonStates, "#c2", buttonSolved);
var bv = tree.ImageVisuals.GetVisual(button)!;
button.Hover(); button.Press();
Check(bv.Image == "pressed.png", "按压图片");
button.Opacity = .72f;
button.Width = 70; button.Height = 35; Game.Tick();
Check(bv.Image == "pressed.png" && button.Opacity == .72f, "自动同步保持按压图与动画透明度");
Rect(bv, 0, 0, 70, 35);
DjuiWindowManagerV6.RefreshVisuals(button);
Check(bv.Image == "pressed.png" && button.Opacity == .72f, "显式刷新保持按钮状态");
button.Release(); button.Exit();
DjuiButtonState.SetDisabled(button, true);
button.Width = 90; Game.Tick();
Check(bv.Desaturated && bv.Image == "preset.png" && button.Opacity == .5f, "尺寸变化保持禁用灰化");
Check(DjuiWindowManagerV6.SetTint(button, "#ABCDEF"), "染色 API");
Check(DjuiWindowManagerV6.SetImage(button, "new.png"), "换图 API");
button.Height = 90; Game.Tick();
Check(bv.Image == "new.png" && bv.Background == Color.FromArgb(255, 171, 205, 239) && bv.Desaturated, "換图染色禁用共存");

var progressNode = ImageNode("progress", "stretch", "Progress");
progressNode.Progress = new() { Value = .5f, ProgressionMode = "LeftToRight" };
var progress = (Progress)DjuiTreeBuilderV6.BuildClone(progressNode, tree.Session, null, tree.ImageVisuals, tree.ProgressVisuals, tree.ButtonStates, "#c3", new Dictionary<string, DjuiRectV6> { ["progress"] = new(0, 0, 80, 40) });
var fill = progress.Children.Single();
Rect(fill, 0, 0, 40, 40);
Rect(fill.Children.Single(), 0, 0, 80, 40);
progress.Width = 120;
Check(DjuiWindowManagerV6.RefreshVisuals(progress), "进度条立即刷新");
Rect(fill, 0, 0, 60, 40);
Rect(fill.Children.Single(), 0, 0, 120, 40);
Check(!DjuiWindowManagerV6.RefreshVisuals(new Panel()), "非 DJUI 控件返回 false");
Check(!DjuiWindowManagerV6.RefreshVisuals(null!), "空控件返回 false");
badge.Dispose(); Game.Tick();
Check(tree.ImageVisuals.GetVisual(badge) == null, "已销毁克隆视觉索引清理");
Check(!DjuiWindowManagerV6.RefreshVisuals(badge), "无效控件返回 false");
tree.Dispose(); Game.Tick();
Check(!DjuiWindowManagerV6.RefreshVisuals(clone), "已销毁树返回 false");
Console.WriteLine($"PASS: {checks} checks; production clone/layout/image/button/progress/public API paths");
