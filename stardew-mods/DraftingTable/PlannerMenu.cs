using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;
using Microsoft.Xna.Framework.Input.Touch;
using StardewValley.Menus;

namespace DraftingTable
{
    /// <summary>Top-down farm planner opened from the drafting table.</summary>
    internal sealed class PlannerMenu : IClickableMenu
    {
        private enum Mode { View, Build, Place, Remove }
        private enum Region { None, TopBar, Bottom, Map }

        private sealed class Button
        {
            public Rectangle Bounds;
            public string Label = "";
            public Action OnClick = () => { };
            public Func<bool> IsActive = () => false;
            public Func<bool> IsEnabled = () => true;
        }

        private sealed class Flash
        {
            public Point Tile;
            public Color Color;
            public double Until;
        }

        /*********
        ** Constants & palette
        *********/
        private const int TopBarHeight = 76;
        private const int BottomHeight = 128;
        private const int InfoHeight = 44;
        private const float MaxZoom = 1.5f;
        private const double PaintDelayMs = 180;

        private static readonly Color Paper = new(255, 236, 196);
        private static readonly Color PaperDark = new(235, 205, 150);
        private static readonly Color Wood = new(110, 62, 26);
        private static readonly Color Ink = new(64, 36, 16);
        private static readonly Color Blueprint = new(44, 92, 150);
        private static readonly Color Good = new(60, 190, 80);
        private static readonly Color Bad = new(220, 60, 50);

        /*********
        ** State
        *********/
        private readonly object farm;
        private readonly object? tableLocation;
        private readonly object? table;
        private readonly Vector2 tableTile;
        private readonly MapRenderer renderer;

        private Mode mode = Mode.View;
        private Vector2 camera;
        private float zoom = 0.4f;
        private float minZoom = 0.1f;
        private Rectangle mapArea;
        private Point ui;
        private double now;

        // pointer
        private bool pointerDown;
        private Region downRegion;
        private Vector2 downPos;
        private Vector2 lastPos;
        private double downTime;
        private bool dragged;
        private bool painting;
        private Point lastPaintTile;
        private Button? pressedButton;
        private Vector2 hoverPos = new(-1, -1);
        private double lastTouchTime = -10000;

        // pinch
        private bool gestureActive;
        private float gesturePrevDist;
        private Vector2 gesturePrevCenter;

        // UI content
        private readonly List<Button> topButtons = new();
        private readonly List<Button> bottomButtons = new();
        private float listScroll;
        private Rectangle listArea;
        private int listItemWidth;

        // building
        private readonly List<BlueprintInfo> blueprints;
        private int selectedBlueprint = -1;
        private Point? ghostTile;
        private bool[,]? ghostValid;
        private bool robinBusy;
        private double robinCheckedAt = -10000;

        // placing
        private readonly List<(int Slot, object Item)> placeables = new();
        private object? selectedItem;
        private double placeablesRefreshedAt = -10000;

        // feedback
        private string message = "";
        private Color messageColor = Ink;
        private double messageUntil;
        private readonly List<Flash> flashes = new();

        public PlannerMenu(object farm, object? tableLocation, object? table, Vector2 tableTile)
        {
            this.farm = farm;
            this.tableLocation = tableLocation;
            this.table = table;
            this.tableTile = tableTile;
            this.renderer = new MapRenderer(farm);

            try { this.blueprints = G.GetRobinBlueprints(); }
            catch (Exception ex) { G.LogOnce("blueprints", ex); this.blueprints = new(); }

            this.Layout();
            this.ResetCamera();
            this.ShowMessage(I18n.Get("hint.view"), Ink, 4000);
        }

        /*********
        ** Layout & camera
        *********/
        private void Layout()
        {
            this.ui = G.UiSize;
            this.xPositionOnScreen = 0;
            this.yPositionOnScreen = 0;
            this.width = this.ui.X;
            this.height = this.ui.Y;
            this.mapArea = new Rectangle(0, TopBarHeight, this.ui.X, Math.Max(100, this.ui.Y - TopBarHeight - BottomHeight));

            float fit = Math.Min(this.mapArea.Width / (this.renderer.TilesWide * 64f), this.mapArea.Height / (this.renderer.TilesHigh * 64f));
            this.minZoom = Math.Max(0.05f, fit * 0.8f);

            // top bar
            this.topButtons.Clear();
            int x = 10;
            void Tab(Mode m, string key)
            {
                var button = new Button { Label = I18n.Get(key), IsActive = () => this.mode == m, OnClick = () => this.SetMode(m) };
                button.Bounds = new Rectangle(x, 10, this.TextWidth(button.Label) + 28, TopBarHeight - 20);
                x += button.Bounds.Width + 6;
                this.topButtons.Add(button);
            }
            Tab(Mode.View, "tab.view");
            Tab(Mode.Build, "tab.build");
            Tab(Mode.Place, "tab.place");
            Tab(Mode.Remove, "tab.remove");

            int right = this.ui.X - 10;
            Button Small(string label, Action onClick)
            {
                right -= 56;
                var button = new Button { Label = label, OnClick = onClick, Bounds = new Rectangle(right, 10, 56, TopBarHeight - 20) };
                right -= 6;
                this.topButtons.Add(button);
                return button;
            }
            Small("X", this.Close);
            right -= 8;
            Small("+", () => this.ZoomAt(this.mapArea.Center.ToVector2(), 1.25f));
            Small("-", () => this.ZoomAt(this.mapArea.Center.ToVector2(), 0.8f));

            this.LayoutBottom();
        }

        private void LayoutBottom()
        {
            this.bottomButtons.Clear();
            int top = this.ui.Y - BottomHeight;
            int right = this.ui.X - 12;

            switch (this.mode)
            {
                case Mode.View when this.table != null:
                    {
                        string label = I18n.Get("button.pickupTable");
                        int w = this.TextWidth(label) + 32;
                        this.bottomButtons.Add(new Button { Label = label, OnClick = this.PickUpTable, Bounds = new Rectangle(right - w, top + 30, w, 64) });
                        break;
                    }
                case Mode.Build:
                    {
                        string label = I18n.Get("button.build");
                        int w = this.TextWidth(label) + 40;
                        this.bottomButtons.Add(new Button
                        {
                            Label = label,
                            OnClick = this.TryBuild,
                            IsEnabled = () => this.selectedBlueprint >= 0 && this.ghostTile.HasValue,
                            Bounds = new Rectangle(right - w, top + 30, w, 64)
                        });
                        right -= w + 12;
                        break;
                    }
            }

            this.listItemWidth = this.mode == Mode.Build ? 220 : 80;
            this.listArea = new Rectangle(52, top + 10, Math.Max(80, right - 52 - 44), BottomHeight - 20);
            this.bottomButtons.Add(new Button { Label = "<", OnClick = () => this.listScroll -= this.listArea.Width * 0.8f, Bounds = new Rectangle(8, top + 30, 40, 64) });
            this.bottomButtons.Add(new Button { Label = ">", OnClick = () => this.listScroll += this.listArea.Width * 0.8f, Bounds = new Rectangle(this.listArea.Right + 4, top + 30, 40, 64) });
        }

        private void ResetCamera()
        {
            this.zoom = MathHelper.Clamp(this.minZoom * 2f, this.minZoom, MaxZoom);
            Vector2 focus = new(this.renderer.TilesWide * 32f, this.renderer.TilesHigh * 32f);
            try
            {
                object? house = G.Buildings(this.farm).FirstOrDefault(b => (R.Get<string>(b, "buildingType") ?? "").Contains("Farmhouse"));
                if (house != null)
                    focus = G.BuildingFootprint(house).Center.ToVector2() * 64f;
            }
            catch (Exception ex) { G.LogOnce("focus", ex); }
            this.camera = focus - new Vector2(this.mapArea.Width, this.mapArea.Height) / (2 * this.zoom);
            this.ClampCamera();
        }

        private void ClampCamera()
        {
            float viewW = this.mapArea.Width / this.zoom, viewH = this.mapArea.Height / this.zoom;
            float mapW = this.renderer.TilesWide * 64f, mapH = this.renderer.TilesHigh * 64f;
            this.camera.X = viewW >= mapW ? (mapW - viewW) / 2 : MathHelper.Clamp(this.camera.X, -viewW * 0.25f, mapW - viewW * 0.75f);
            this.camera.Y = viewH >= mapH ? (mapH - viewH) / 2 : MathHelper.Clamp(this.camera.Y, -viewH * 0.25f, mapH - viewH * 0.75f);
        }

        private void ZoomAt(Vector2 screen, float factor)
        {
            Vector2 world = this.ScreenToWorld(screen);
            this.zoom = MathHelper.Clamp(this.zoom * factor, this.minZoom, MaxZoom);
            this.camera = world - (screen - new Vector2(this.mapArea.X, this.mapArea.Y)) / this.zoom;
            this.ClampCamera();
        }

        private Vector2 ScreenToWorld(Vector2 screen)
            => this.camera + (screen - new Vector2(this.mapArea.X, this.mapArea.Y)) / this.zoom;

        private Point ScreenToTile(Vector2 screen)
        {
            Vector2 world = this.ScreenToWorld(screen);
            return new Point((int)Math.Floor(world.X / 64), (int)Math.Floor(world.Y / 64));
        }

        private bool InMap(Point tile) => tile.X >= 0 && tile.Y >= 0 && tile.X < this.renderer.TilesWide && tile.Y < this.renderer.TilesHigh;

        private void SetMode(Mode newMode)
        {
            this.mode = newMode;
            this.listScroll = 0;
            this.LayoutBottom();
            this.ShowMessage(I18n.Get(newMode switch
            {
                Mode.Build => this.IsRobinBusy() ? "build.robinBusy" : "hint.build",
                Mode.Place => "hint.place",
                Mode.Remove => "hint.remove",
                _ => "hint.view"
            }), Ink, 5000);
        }

        /*********
        ** Input: SMAPI/game callbacks
        *********/
        private bool TouchRecently() => this.now - this.lastTouchTime < 400 || SafeTouchCount() > 0;

        private static int SafeTouchCount()
        {
            try { return TouchPanel.GetState().Count; }
            catch { return 0; }
        }

        public override void receiveLeftClick(int x, int y, bool playSound = true)
        {
            if (!this.TouchRecently())
                this.PointerDown(new Vector2(x, y));
        }

        public override void leftClickHeld(int x, int y)
        {
            if (!this.TouchRecently() && this.pointerDown)
                this.PointerMove(new Vector2(x, y));
        }

        public override void releaseLeftClick(int x, int y)
        {
            if (!this.TouchRecently() && this.pointerDown)
                this.PointerUp(new Vector2(x, y));
        }

        public override void receiveRightClick(int x, int y, bool playSound = true)
        {
            // right click cancels the current selection
            this.selectedItem = null;
            this.ghostTile = null;
        }

        public override void performHoverAction(int x, int y)
        {
            this.hoverPos = new Vector2(x, y);
        }

        public override void receiveScrollWheelAction(int direction)
        {
            Vector2 at = this.mapArea.Contains(this.hoverPos) ? this.hoverPos : this.mapArea.Center.ToVector2();
            this.ZoomAt(at, direction > 0 ? 1.15f : 1 / 1.15f);
        }

        public override void receiveKeyPress(Keys key)
        {
            if (key == Keys.Escape || key == Keys.Back)
                this.Close();
        }

        public override bool readyToClose() => true;

        public override void gameWindowSizeChanged(Rectangle oldBounds, Rectangle newBounds)
        {
            this.Layout();
            this.ClampCamera();
        }

        public override void update(GameTime time)
        {
            this.now += time.ElapsedGameTime.TotalMilliseconds;

            Point size = G.UiSize;
            if (size != this.ui)
            {
                this.Layout();
                this.ClampCamera();
            }

            this.UpdateTouch();
            this.UpdateKeyboard(time);

            // hold still on the map to start painting in place/remove modes
            if (this.pointerDown && this.downRegion == Region.Map && !this.painting && !this.gestureActive
                && (this.mode == Mode.Place || this.mode == Mode.Remove) && this.now - this.downTime >= PaintDelayMs)
            {
                this.StartPainting();
            }

            if (this.mode == Mode.Place && this.now - this.placeablesRefreshedAt > 300)
                this.RefreshPlaceables();

            this.flashes.RemoveAll(f => f.Until < this.now);
        }

        private void UpdateKeyboard(GameTime time)
        {
            try
            {
                KeyboardState keys = Keyboard.GetState();
                float speed = (float)(900 * time.ElapsedGameTime.TotalSeconds) / this.zoom;
                Vector2 move = Vector2.Zero;
                if (keys.IsKeyDown(Keys.Left) || keys.IsKeyDown(Keys.A)) move.X -= speed;
                if (keys.IsKeyDown(Keys.Right) || keys.IsKeyDown(Keys.D)) move.X += speed;
                if (keys.IsKeyDown(Keys.Up) || keys.IsKeyDown(Keys.W)) move.Y -= speed;
                if (keys.IsKeyDown(Keys.Down) || keys.IsKeyDown(Keys.S)) move.Y += speed;
                if (move != Vector2.Zero)
                {
                    this.camera += move;
                    this.ClampCamera();
                }
            }
            catch { /* no keyboard */ }
        }

        private void UpdateTouch()
        {
            TouchCollection touches;
            try { touches = TouchPanel.GetState(); }
            catch { return; }
            if (touches.Count == 0)
            {
                this.gestureActive = false;
                return;
            }

            this.lastTouchTime = this.now;
            var active = touches.Where(t => t.State == TouchLocationState.Pressed || t.State == TouchLocationState.Moved).ToList();

            if (active.Count >= 2)
            {
                Vector2 a = this.TouchToUi(active[0].Position), c = this.TouchToUi(active[1].Position);
                Vector2 center = (a + c) / 2;
                float dist = Vector2.Distance(a, c);
                if (!this.gestureActive)
                {
                    this.gestureActive = true;
                    this.CancelPointer();
                }
                else if (this.gesturePrevDist > 1)
                {
                    // zoom around the previous center, then follow the fingers
                    Vector2 world = this.ScreenToWorld(this.gesturePrevCenter);
                    this.zoom = MathHelper.Clamp(this.zoom * dist / this.gesturePrevDist, this.minZoom, MaxZoom);
                    this.camera = world - (center - new Vector2(this.mapArea.X, this.mapArea.Y)) / this.zoom;
                    this.ClampCamera();
                }
                this.gesturePrevDist = dist;
                this.gesturePrevCenter = center;
                return;
            }

            if (this.gestureActive)
            {
                // wait until every finger is lifted after a pinch
                return;
            }

            TouchLocation t = touches[0];
            Vector2 pos = this.TouchToUi(t.Position);
            switch (t.State)
            {
                case TouchLocationState.Pressed:
                    this.PointerDown(pos);
                    break;
                case TouchLocationState.Moved:
                    if (!this.pointerDown)
                        this.PointerDown(pos);
                    else
                        this.PointerMove(pos);
                    break;
                case TouchLocationState.Released:
                    if (this.pointerDown)
                        this.PointerUp(pos);
                    break;
            }
        }

        private Vector2 TouchToUi(Vector2 touch)
        {
            int dw = TouchPanel.DisplayWidth, dh = TouchPanel.DisplayHeight;
            if (dw <= 0 || dh <= 0)
                return touch;
            return new Vector2(touch.X * this.ui.X / dw, touch.Y * this.ui.Y / dh);
        }

        /*********
        ** Input: unified pointer
        *********/
        private void PointerDown(Vector2 pos)
        {
            this.pointerDown = true;
            this.downPos = this.lastPos = pos;
            this.downTime = this.now;
            this.dragged = false;
            this.painting = false;
            this.pressedButton = null;
            this.hoverPos = pos;

            if (pos.Y < TopBarHeight)
            {
                this.downRegion = Region.TopBar;
                this.pressedButton = this.topButtons.FirstOrDefault(b => b.Bounds.Contains(pos));
            }
            else if (pos.Y >= this.ui.Y - BottomHeight)
            {
                this.downRegion = Region.Bottom;
                this.pressedButton = this.bottomButtons.FirstOrDefault(b => b.Bounds.Contains(pos));
            }
            else
                this.downRegion = Region.Map;
        }

        private void PointerMove(Vector2 pos)
        {
            Vector2 delta = pos - this.lastPos;
            this.lastPos = pos;
            this.hoverPos = pos;
            if (Vector2.Distance(pos, this.downPos) > 12)
                this.dragged = true;

            switch (this.downRegion)
            {
                case Region.Bottom:
                    if (this.dragged && this.pressedButton == null)
                        this.listScroll -= delta.X;
                    break;

                case Region.Map:
                    if (this.mode == Mode.View || this.mode == Mode.Build)
                    {
                        if (this.dragged)
                        {
                            this.camera -= delta / this.zoom;
                            this.ClampCamera();
                        }
                    }
                    else
                    {
                        Point tile = this.ScreenToTile(pos);
                        if (!this.painting && tile != this.ScreenToTile(this.downPos))
                            this.StartPainting();
                        if (this.painting)
                            this.PaintLine(this.lastPaintTile, tile);
                    }
                    break;
            }
        }

        private void PointerUp(Vector2 pos)
        {
            this.pointerDown = false;
            switch (this.downRegion)
            {
                case Region.TopBar:
                case Region.Bottom:
                    if (this.pressedButton != null && this.pressedButton.Bounds.Contains(pos) && this.pressedButton.IsEnabled())
                    {
                        G.PlaySound("smallSelect");
                        this.pressedButton.OnClick();
                    }
                    else if (this.downRegion == Region.Bottom && !this.dragged && this.listArea.Contains(pos))
                        this.ClickList(pos);
                    break;

                case Region.Map:
                    if (!this.dragged && !this.painting)
                        this.TapMap(this.ScreenToTile(pos));
                    break;
            }
            this.painting = false;
            this.pressedButton = null;
        }

        private void CancelPointer()
        {
            this.pointerDown = false;
            this.painting = false;
            this.pressedButton = null;
        }

        private void StartPainting()
        {
            this.painting = true;
            this.lastPaintTile = this.ScreenToTile(this.downPos);
            this.ApplyTool(this.lastPaintTile);
        }

        private void PaintLine(Point from, Point to)
        {
            if (from == to)
                return;
            int steps = Math.Max(Math.Abs(to.X - from.X), Math.Abs(to.Y - from.Y));
            for (int i = 1; i <= steps; i++)
            {
                Point p = new(
                    from.X + (int)Math.Round((to.X - from.X) * (i / (double)steps)),
                    from.Y + (int)Math.Round((to.Y - from.Y) * (i / (double)steps)));
                this.ApplyTool(p);
            }
            this.lastPaintTile = to;
        }

        private void TapMap(Point tile)
        {
            switch (this.mode)
            {
                case Mode.Build:
                    if (this.selectedBlueprint < 0)
                    {
                        this.ShowMessage(I18n.Get("build.pickFirst"), Bad, 2500);
                        return;
                    }
                    BlueprintInfo bp = this.blueprints[this.selectedBlueprint];
                    this.SetGhost(new Point(tile.X - (bp.Size.X - 1) / 2, tile.Y - (bp.Size.Y - 1) / 2));
                    break;

                case Mode.Place:
                case Mode.Remove:
                    this.ApplyTool(tile);
                    break;
            }
        }

        private void ApplyTool(Point tile)
        {
            if (!this.InMap(tile))
                return;
            if (this.mode == Mode.Place)
                this.PlaceAt(tile);
            else if (this.mode == Mode.Remove)
                this.RemoveAt(tile);
        }

        private void ClickList(Vector2 pos)
        {
            int index = (int)((pos.X - this.listArea.X + this.listScroll) / this.listItemWidth);
            if (this.mode == Mode.Build && index >= 0 && index < this.blueprints.Count)
            {
                this.selectedBlueprint = index;
                this.ghostTile = null;
                G.PlaySound("smallSelect");
                this.ShowMessage(I18n.Get("build.tapMap"), Ink, 3000);
            }
            else if (this.mode == Mode.Place && index >= 0 && index < this.placeables.Count)
            {
                this.selectedItem = this.placeables[index].Item;
                G.PlaySound("smallSelect");
                this.ShowMessage(I18n.Get("place.selected", G.DisplayName(this.selectedItem)), Ink, 3000);
            }
        }

        /*********
        ** Building (Robin)
        *********/
        private bool IsRobinBusy()
        {
            if (this.now - this.robinCheckedAt > 2000)
            {
                try { this.robinBusy = G.IsRobinBusy(); }
                catch (Exception ex) { G.LogOnce("robin", ex); this.robinBusy = false; }
                this.robinCheckedAt = this.now;
            }
            return this.robinBusy;
        }

        private void SetGhost(Point topLeft)
        {
            BlueprintInfo bp = this.blueprints[this.selectedBlueprint];
            this.ghostTile = topLeft;
            this.ghostValid = new bool[bp.Size.X, bp.Size.Y];
            bool allValid = true;
            for (int x = 0; x < bp.Size.X; x++)
            {
                for (int y = 0; y < bp.Size.Y; y++)
                {
                    Point t = new(topLeft.X + x, topLeft.Y + y);
                    bool ok = this.InMap(t) && G.IsBuildable(this.farm, new Vector2(t.X, t.Y));
                    this.ghostValid[x, y] = ok;
                    allValid &= ok;
                }
            }
            this.ShowMessage(I18n.Get(allValid ? "build.canPlace" : "build.cantPlace"), allValid ? Ink : Bad, 3000);
        }

        private void TryBuild()
        {
            if (this.selectedBlueprint < 0 || !this.ghostTile.HasValue)
                return;
            BlueprintInfo bp = this.blueprints[this.selectedBlueprint];

            this.robinCheckedAt = -10000;
            if (this.IsRobinBusy())
            {
                this.ShowMessage(I18n.Get("build.robinBusy"), Bad, 4000);
                return;
            }
            if (G.Money < bp.Cost)
            {
                this.ShowMessage(I18n.Get("build.noMoney"), Bad, 3000);
                return;
            }
            foreach (var (itemId, amount) in bp.Materials)
            {
                if (G.CountItem(itemId) < amount)
                {
                    this.ShowMessage(I18n.Get("build.noMaterials", G.ItemName(itemId)), Bad, 3000);
                    return;
                }
            }

            object? building;
            try
            {
                building = G.BuildStructure(this.farm, bp, new Vector2(this.ghostTile.Value.X, this.ghostTile.Value.Y));
            }
            catch (Exception ex)
            {
                G.LogOnce("build", ex);
                building = null;
            }
            if (building == null)
            {
                G.PlaySound("cancel");
                this.ShowMessage(I18n.Get("build.cantPlace"), Bad, 3000);
                return;
            }

            G.Money -= bp.Cost;
            foreach (var (itemId, amount) in bp.Materials)
                G.RemoveItems(itemId, amount);

            if (!bp.Magical && bp.Days > 0)
            {
                try
                {
                    if (R.Get<int>(building, "daysOfConstructionLeft") <= 0)
                        R.Set(building, "daysOfConstructionLeft", bp.Days);
                }
                catch (Exception ex) { G.LogOnce("construction-days", ex); }
            }

            G.PlaySound("axe");
            this.ShowMessage(bp.Magical || bp.Days <= 0 ? I18n.Get("build.doneInstant", bp.Name) : I18n.Get("build.done", bp.Name, bp.Days), Good, 6000);
            this.ghostTile = null;
            this.selectedBlueprint = -1;
            this.robinBusy = !bp.Magical && bp.Days > 0;
            this.robinCheckedAt = this.now;
        }

        /*********
        ** Placing & removing items
        *********/
        private void RefreshPlaceables()
        {
            this.placeablesRefreshedAt = this.now;
            this.placeables.Clear();
            try
            {
                foreach (var entry in G.Inventory())
                {
                    if (IsPlaceable(entry.Item))
                        this.placeables.Add(entry);
                }
            }
            catch (Exception ex) { G.LogOnce("placeables", ex); }

            if (this.selectedItem != null && !this.placeables.Any(p => ReferenceEquals(p.Item, this.selectedItem)))
                this.selectedItem = null;
        }

        private static bool IsPlaceable(object item)
        {
            if (!R.Is(item, "StardewValley.Object") || R.Is(item, "StardewValley.Objects.Furniture"))
                return false;
            try { return R.Call(item, "isPlaceable") is true; }
            catch { return false; }
        }

        private void PlaceAt(Point tile)
        {
            if (this.selectedItem == null)
            {
                this.ShowMessage(I18n.Get("place.pickFirst"), Bad, 2500);
                return;
            }

            this.RefreshPlaceables();
            var entry = this.placeables.FirstOrDefault(p => ReferenceEquals(p.Item, this.selectedItem));
            if (entry.Item == null)
            {
                this.selectedItem = null;
                this.ShowMessage(I18n.Get("place.runOut"), Bad, 2500);
                return;
            }

            object item = entry.Item;
            Vector2 tileVec = new(tile.X, tile.Y);
            bool canPlace = true;
            try { canPlace = R.Call(item, "canBePlacedHere", this.farm, tileVec) is not false; }
            catch (Exception ex) { G.LogOnce("canBePlacedHere", ex); }

            bool placed = false;
            if (canPlace)
            {
                try { placed = R.Call(item, "placementAction", this.farm, tile.X * 64, tile.Y * 64, G.Player) is true; }
                catch (Exception ex) { G.LogOnce("placementAction", ex); }
            }

            if (placed)
            {
                G.ReduceSlot(entry.Slot, item, 1);
                this.AddFlash(tile, Good);
                G.PlaySound("woodyStep");
                if (G.Stack(item) <= 0 || !G.Inventory().Any(p => ReferenceEquals(p.Item, item)))
                {
                    this.selectedItem = null;
                    this.ShowMessage(I18n.Get("place.runOut"), Ink, 2500);
                }
                this.RefreshPlaceables();
            }
            else
            {
                this.AddFlash(tile, Bad);
                if (!this.painting)
                    this.ShowMessage(I18n.Get("place.cant"), Bad, 2000);
            }
        }

        private void RemoveAt(Point tile)
        {
            Vector2 tileVec = new(tile.X, tile.Y);
            try
            {
                object? obj = G.ObjectAt(this.farm, tileVec);
                if (obj != null)
                {
                    this.RemoveObject(obj, tile);
                    return;
                }

                object? feature = G.TerrainFeatureAt(this.farm, tileVec);
                if (feature != null && R.Is(feature, "StardewValley.TerrainFeatures.Flooring"))
                {
                    string? itemId = R.Get<string>(R.Call(feature, "GetData"), "ItemId");
                    object? item = string.IsNullOrEmpty(itemId) ? null : G.CreateItem(itemId);
                    if (item != null && !G.AddToInventory(item))
                    {
                        this.ShowMessage(I18n.Get("remove.inventoryFull"), Bad, 2500);
                        return;
                    }
                    R.Call(R.Raw(this.farm, "terrainFeatures")!, "Remove", tileVec);
                    this.AddFlash(tile, Good);
                    G.PlaySound("hoeHit");
                    return;
                }
            }
            catch (Exception ex) { G.LogOnce("remove", ex); }

            if (!this.painting)
                this.ShowMessage(I18n.Get("remove.nothing"), Ink, 1500);
        }

        private void RemoveObject(object obj, Point tile)
        {
            string qid = G.QualifiedId(obj);
            if (qid == ModEntry.QualifiedItemId)
            {
                this.ShowMessage(I18n.Get("remove.table"), Bad, 3000);
                return;
            }

            bool crafted = qid.StartsWith("(BC)") || R.Get<string>(obj, "Type") == "Crafting";
            bool busy = R.Get(obj, "heldObject") != null
                || (R.Is(obj, "StardewValley.Objects.Chest") && R.Each(R.Raw(obj, "Items")).Any());
            if (!crafted || busy)
            {
                this.AddFlash(tile, Bad);
                if (!this.painting)
                    this.ShowMessage(I18n.Get(busy ? "remove.notEmpty" : "remove.notAllowed"), Bad, 2500);
                return;
            }

            string giveId = R.Is(obj, "StardewValley.Fence") && R.Get<bool>(obj, "isGate") ? "(O)325" : qid;
            object? item = G.CreateItem(giveId);
            if (item == null || !G.AddToInventory(item))
            {
                this.ShowMessage(I18n.Get("remove.inventoryFull"), Bad, 2500);
                return;
            }

            Vector2 key = G.TileOf(obj);
            if (key.X < 0)
                key = new Vector2(tile.X, tile.Y);
            R.Call(this.farm, "removeObject", key, false);
            this.AddFlash(tile, Good);
            G.PlaySound("pickUpItem");
        }

        private void PickUpTable()
        {
            if (this.table == null || this.tableLocation == null)
                return;
            try
            {
                object? current = G.ObjectAt(this.tableLocation, this.tableTile);
                if (!ReferenceEquals(current, this.table))
                {
                    this.Close();
                    return;
                }
                object? item = G.CreateItem(ModEntry.QualifiedItemId);
                if (item == null || !G.AddToInventory(item))
                {
                    this.ShowMessage(I18n.Get("remove.inventoryFull"), Bad, 2500);
                    return;
                }
                R.Call(this.tableLocation, "removeObject", this.tableTile, false);
                G.PlaySound("pickUpItem");
                this.Close();
            }
            catch (Exception ex) { G.LogOnce("pickup-table", ex); }
        }

        private void Close()
        {
            G.PlaySound("bigDeSelect");
            try { G.ActiveMenu = null; }
            catch (Exception ex) { G.LogOnce("close", ex); }
        }

        /*********
        ** Feedback
        *********/
        private void ShowMessage(string text, Color color, double ms)
        {
            this.message = text;
            this.messageColor = color;
            this.messageUntil = this.now + ms;
        }

        private void AddFlash(Point tile, Color color)
        {
            this.flashes.Add(new Flash { Tile = tile, Color = color, Until = this.now + 450 });
        }

        /*********
        ** Drawing
        *********/
        public override void draw(SpriteBatch b)
        {
            Texture2D px = MapRenderer.Pixel(b);
            b.Draw(px, new Rectangle(0, 0, this.ui.X, this.ui.Y), new Color(20, 30, 20));

            this.renderer.Draw(b, this.mapArea, this.camera, this.zoom, this.DrawOverlay);

            this.DrawTopBar(b, px);
            this.DrawBottom(b, px);
            this.DrawInfo(b, px);
        }

        private void DrawOverlay(SpriteBatch b)
        {
            Texture2D px = MapRenderer.Pixel(b);
            Rectangle visible = new(
                (int)this.camera.X / 64 - 1, (int)this.camera.Y / 64 - 1,
                (int)(this.mapArea.Width / this.zoom / 64) + 3, (int)(this.mapArea.Height / this.zoom / 64) + 3);

            // grid
            if (this.mode != Mode.View && this.zoom >= 0.25f)
            {
                int line = Math.Max(1, (int)(1 / this.zoom));
                Color gridColor = Color.White * 0.18f;
                for (int x = Math.Max(0, visible.Left); x <= Math.Min(this.renderer.TilesWide, visible.Right); x++)
                    b.Draw(px, new Rectangle(x * 64, Math.Max(0, visible.Top) * 64, line, Math.Min(this.renderer.TilesHigh, visible.Bottom) * 64), gridColor);
                for (int y = Math.Max(0, visible.Top); y <= Math.Min(this.renderer.TilesHigh, visible.Bottom); y++)
                    b.Draw(px, new Rectangle(Math.Max(0, visible.Left) * 64, y * 64, Math.Min(this.renderer.TilesWide, visible.Right) * 64, line), gridColor);
            }

            // building ghost
            if (this.mode == Mode.Build && this.selectedBlueprint >= 0 && this.ghostTile.HasValue && this.ghostValid != null)
            {
                BlueprintInfo bp = this.blueprints[this.selectedBlueprint];
                Point g = this.ghostTile.Value;
                Texture2D? tex = G.LoadTexture(bp.Texture);
                if (tex != null)
                {
                    Rectangle src = bp.SourceRect.IsEmpty ? tex.Bounds : bp.SourceRect;
                    int w = src.Width * 4, h = src.Height * 4;
                    int x = g.X * 64 + (bp.Size.X * 64 - w) / 2;
                    int y = (g.Y + bp.Size.Y) * 64 - h;
                    b.Draw(tex, new Rectangle(x, y, w, h), src, Color.White * 0.6f);
                }
                for (int tx = 0; tx < bp.Size.X; tx++)
                {
                    for (int ty = 0; ty < bp.Size.Y; ty++)
                        b.Draw(px, new Rectangle((g.X + tx) * 64 + 2, (g.Y + ty) * 64 + 2, 60, 60), (this.ghostValid[tx, ty] ? Good : Bad) * 0.45f);
                }
            }

            // hover tile (mouse)
            if ((this.mode == Mode.Place || this.mode == Mode.Remove) && this.mapArea.Contains(this.hoverPos) && !this.TouchRecently())
            {
                Point t = this.ScreenToTile(this.hoverPos);
                if (this.InMap(t))
                    this.DrawTileFrame(b, px, t, (this.mode == Mode.Place ? Blueprint : Bad) * 0.8f);
            }

            // flashes
            foreach (Flash f in this.flashes)
            {
                float alpha = (float)Math.Clamp((f.Until - this.now) / 450, 0, 1);
                b.Draw(px, new Rectangle(f.Tile.X * 64, f.Tile.Y * 64, 64, 64), f.Color * (0.5f * alpha));
            }

            // the table itself, so the player can see where they are
            if (this.table != null && ReferenceEquals(this.tableLocation, this.farm))
                this.DrawTileFrame(b, px, new Point((int)this.tableTile.X, (int)this.tableTile.Y), Color.Gold);
        }

        private void DrawTileFrame(SpriteBatch b, Texture2D px, Point t, Color color)
        {
            int thick = Math.Max(2, (int)(3 / this.zoom));
            Rectangle r = new(t.X * 64, t.Y * 64, 64, 64);
            b.Draw(px, new Rectangle(r.X, r.Y, r.Width, thick), color);
            b.Draw(px, new Rectangle(r.X, r.Bottom - thick, r.Width, thick), color);
            b.Draw(px, new Rectangle(r.X, r.Y, thick, r.Height), color);
            b.Draw(px, new Rectangle(r.Right - thick, r.Y, thick, r.Height), color);
        }

        private void DrawTopBar(SpriteBatch b, Texture2D px)
        {
            DrawBox(b, px, new Rectangle(0, 0, this.ui.X, TopBarHeight), Paper, Wood);
            foreach (Button button in this.topButtons)
                this.DrawButton(b, px, button);

            // money, between tabs and zoom buttons if there is room
            int tabsRight = this.topButtons.Take(4).Max(t => t.Bounds.Right);
            int zoomLeft = this.topButtons.Skip(4).Min(t => t.Bounds.Left);
            string money = I18n.Get("money", G.Money);
            int mw = this.TextWidth(money);
            if (zoomLeft - tabsRight > mw + 24)
                this.DrawText(b, money, new Vector2(zoomLeft - mw - 16, TopBarHeight / 2f - 14), Ink);
        }

        private void DrawBottom(SpriteBatch b, Texture2D px)
        {
            int top = this.ui.Y - BottomHeight;
            DrawBox(b, px, new Rectangle(0, top, this.ui.X, BottomHeight), Paper, Wood);

            float maxScroll = Math.Max(0, this.ListCount() * this.listItemWidth - this.listArea.Width);
            this.listScroll = MathHelper.Clamp(this.listScroll, 0, maxScroll);

            switch (this.mode)
            {
                case Mode.View:
                case Mode.Remove:
                    {
                        string hint = I18n.Get(this.mode == Mode.View ? "hint.view" : "hint.remove");
                        this.DrawWrapped(b, hint, new Rectangle(20, top + 16, this.ui.X - 40 - (this.bottomButtons.Count > 2 ? this.bottomButtons[0].Bounds.Width + 20 : 0), BottomHeight - 24), Ink);
                        foreach (Button button in this.bottomButtons.Where(x => x.Label != "<" && x.Label != ">"))
                            this.DrawButton(b, px, button);
                        return;
                    }

                case Mode.Build:
                    if (this.blueprints.Count == 0)
                        this.DrawText(b, I18n.Get("build.none"), new Vector2(60, top + 44), Ink);
                    for (int i = 0; i < this.blueprints.Count; i++)
                    {
                        Rectangle card = this.ListCard(i);
                        if (card.Right < this.listArea.Left || card.Left > this.listArea.Right)
                            continue;
                        BlueprintInfo bp = this.blueprints[i];
                        DrawBox(b, px, card, i == this.selectedBlueprint ? new Color(190, 220, 255) : PaperDark, Wood);
                        this.DrawText(b, this.Fit(bp.Name, card.Width - 16), new Vector2(card.X + 8, card.Y + 8), Ink);
                        this.DrawText(b, I18n.Get("money", bp.Cost), new Vector2(card.X + 8, card.Y + 44), G.Money >= bp.Cost ? Ink : Bad);
                    }
                    break;

                case Mode.Place:
                    if (this.placeables.Count == 0)
                        this.DrawText(b, I18n.Get("place.none"), new Vector2(60, top + 44), Ink);
                    for (int i = 0; i < this.placeables.Count; i++)
                    {
                        Rectangle card = this.ListCard(i);
                        if (card.Right < this.listArea.Left || card.Left > this.listArea.Right)
                            continue;
                        object item = this.placeables[i].Item;
                        DrawBox(b, px, card, ReferenceEquals(item, this.selectedItem) ? new Color(190, 220, 255) : PaperDark, Wood);
                        try { R.Call(item, "drawInMenu", b, new Vector2(card.X + (card.Width - 64) / 2, card.Y + (card.Height - 64) / 2), 1f); }
                        catch (Exception ex) { G.LogOnce("drawInMenu", ex); }
                    }
                    break;
            }

            foreach (Button button in this.bottomButtons)
                this.DrawButton(b, px, button);
        }

        private int ListCount() => this.mode switch
        {
            Mode.Build => this.blueprints.Count,
            Mode.Place => this.placeables.Count,
            _ => 0
        };

        private Rectangle ListCard(int index)
        {
            int x = this.listArea.X + index * this.listItemWidth - (int)this.listScroll;
            return new Rectangle(x + 3, this.listArea.Y + 4, this.listItemWidth - 6, this.listArea.Height - 8);
        }

        private void DrawInfo(SpriteBatch b, Texture2D px)
        {
            string text;
            Color color;
            if (this.now < this.messageUntil && this.message.Length > 0)
            {
                text = this.message;
                color = this.messageColor;
            }
            else if (this.mode == Mode.Build && this.selectedBlueprint >= 0)
            {
                BlueprintInfo bp = this.blueprints[this.selectedBlueprint];
                var parts = new List<string> { $"{bp.Name}: {I18n.Get("money", bp.Cost)}" };
                parts.AddRange(bp.Materials.Select(m => $"{G.ItemName(m.ItemId)} {G.CountItem(m.ItemId)}/{m.Amount}"));
                if (bp.Days > 0 && !bp.Magical)
                    parts.Add(I18n.Get("build.days", bp.Days));
                text = string.Join("  ·  ", parts);
                color = Ink;
            }
            else if (this.mode == Mode.Place && this.selectedItem != null)
            {
                text = I18n.Get("place.selected", $"{G.DisplayName(this.selectedItem)} ×{G.Stack(this.selectedItem)}");
                color = Ink;
            }
            else
                return;

            SpriteFont? font = G.SmallFont;
            if (font == null)
                return;
            text = this.Fit(text, this.ui.X - 40);
            int w = this.TextWidth(text) + 32;
            Rectangle box = new((this.ui.X - w) / 2, this.ui.Y - BottomHeight - InfoHeight - 8, w, InfoHeight);
            DrawBox(b, px, box, Paper * 0.95f, Wood);
            this.DrawText(b, text, new Vector2(box.X + 16, box.Y + 8), color);
        }

        private void DrawButton(SpriteBatch b, Texture2D px, Button button)
        {
            bool enabled = button.IsEnabled();
            bool pressed = this.pressedButton == button && this.pointerDown;
            Color fill = !enabled ? new Color(200, 190, 170)
                : button.IsActive() ? new Color(255, 205, 90)
                : pressed ? new Color(240, 200, 140)
                : PaperDark;
            DrawBox(b, px, button.Bounds, fill, Wood);
            int tw = this.TextWidth(button.Label);
            this.DrawText(b, button.Label, new Vector2(button.Bounds.Center.X - tw / 2f, button.Bounds.Center.Y - 14), enabled ? Ink : new Color(130, 120, 110));
        }

        private static void DrawBox(SpriteBatch b, Texture2D px, Rectangle r, Color fill, Color border)
        {
            b.Draw(px, r, fill);
            const int t = 3;
            b.Draw(px, new Rectangle(r.X, r.Y, r.Width, t), border);
            b.Draw(px, new Rectangle(r.X, r.Bottom - t, r.Width, t), border);
            b.Draw(px, new Rectangle(r.X, r.Y, t, r.Height), border);
            b.Draw(px, new Rectangle(r.Right - t, r.Y, t, r.Height), border);
        }

        private void DrawText(SpriteBatch b, string text, Vector2 pos, Color color)
        {
            SpriteFont? font = G.SmallFont;
            if (font == null)
                return;
            try { b.DrawString(font, I18n.Safe(font, text), pos, color); }
            catch (Exception ex) { G.LogOnce("text", ex); }
        }

        private void DrawWrapped(SpriteBatch b, string text, Rectangle area, Color color)
        {
            SpriteFont? font = G.SmallFont;
            if (font == null)
                return;
            text = I18n.Safe(font, text);
            var lines = new List<string>();
            string line = "";
            foreach (string word in text.Split(' '))
            {
                string candidate = line.Length == 0 ? word : line + " " + word;
                if (font.MeasureString(candidate).X > area.Width && line.Length > 0)
                {
                    lines.Add(line);
                    line = word;
                }
                else
                    line = candidate;
            }
            if (line.Length > 0)
                lines.Add(line);

            float y = area.Y;
            foreach (string l in lines)
            {
                if (y + font.LineSpacing > area.Bottom + 4)
                    break;
                b.DrawString(font, l, new Vector2(area.X, y), color);
                y += font.LineSpacing;
            }
        }

        private int TextWidth(string text)
        {
            SpriteFont? font = G.SmallFont;
            if (font == null)
                return text.Length * 14;
            try { return (int)font.MeasureString(I18n.Safe(font, text)).X; }
            catch { return text.Length * 14; }
        }

        private string Fit(string text, int maxWidth)
        {
            if (this.TextWidth(text) <= maxWidth)
                return text;
            while (text.Length > 1 && this.TextWidth(text + "...") > maxWidth)
                text = text[..^1];
            return text + "...";
        }
    }
}
