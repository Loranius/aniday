using System;
using System.Collections.Generic;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace DraftingTable
{
    /// <summary>Draws a game location from above at any zoom level.</summary>
    /// <remarks>
    /// Map tiles are drawn straight from their tilesheets. World things (buildings, objects, paths, trees...)
    /// are drawn with the game's own draw methods while <c>Game1.viewport</c> temporarily points at the
    /// visible area, so the game's world-to-screen math lines up with our zoom matrix.
    /// </remarks>
    internal sealed class MapRenderer
    {
        private struct TileDraw
        {
            public Texture2D Texture;
            public Rectangle Source;
        }

        private static readonly string[] Layers = { "Back", "Buildings", "Front" };

        private readonly object location;
        public readonly int TilesWide;
        public readonly int TilesHigh;
        private readonly TileDraw?[][,] tiles;
        private bool worldDrawFailed;

        public MapRenderer(object location)
        {
            this.location = location;
            object map = R.Get(location, "Map") ?? throw new InvalidOperationException("Location has no map");

            this.tiles = new TileDraw?[Layers.Length][,];
            for (int l = 0; l < Layers.Length; l++)
            {
                object? layer = null;
                try { layer = R.Call(map, "GetLayer", Layers[l]); }
                catch (Exception ex) { G.LogOnce("GetLayer", ex); }
                if (layer == null)
                    continue;

                int w = R.Get<int>(layer, "LayerWidth");
                int h = R.Get<int>(layer, "LayerHeight");
                if (l == 0)
                {
                    this.TilesWide = w;
                    this.TilesHigh = h;
                }

                var grid = new TileDraw?[w, h];
                object? tileArray = R.Raw(layer, "Tiles");
                for (int x = 0; x < w; x++)
                {
                    for (int y = 0; y < h; y++)
                    {
                        try
                        {
                            object? tile = R.Call(tileArray!, "get_Item", x, y);
                            if (tile == null)
                                continue;
                            object? sheet = R.Get(tile, "TileSheet");
                            int index = R.Get<int>(tile, "TileIndex");
                            string? source = R.Get<string>(sheet, "ImageSource");
                            Texture2D? tex = G.LoadTexture(source);
                            if (tex == null || index < 0)
                                continue;
                            object? bounds = R.Call(sheet!, "GetTileImageBounds", index);
                            grid[x, y] = new TileDraw
                            {
                                Texture = tex,
                                Source = new Rectangle(R.Get<int>(bounds, "X"), R.Get<int>(bounds, "Y"), R.Get<int>(bounds, "Width"), R.Get<int>(bounds, "Height"))
                            };
                        }
                        catch (Exception ex) { G.LogOnce("tile", ex); }
                    }
                }
                this.tiles[l] = grid;
            }

            if (this.TilesWide <= 0 || this.TilesHigh <= 0)
            {
                this.TilesWide = 80;
                this.TilesHigh = 65;
            }
        }

        /// <param name="b">The sprite batch, currently begun by the game with default UI settings.</param>
        /// <param name="area">Screen area (UI pixels) the map is drawn into.</param>
        /// <param name="camera">World pixel shown at the top-left of <paramref name="area"/>.</param>
        /// <param name="zoom">UI pixels per world pixel (one tile = 64 world pixels).</param>
        public void Draw(SpriteBatch b, Rectangle area, Vector2 camera, float zoom, Action<SpriteBatch>? drawOverlay)
        {
            int camX = (int)Math.Floor(camera.X);
            int camY = (int)Math.Floor(camera.Y);
            int viewW = (int)Math.Ceiling(area.Width / zoom);
            int viewH = (int)Math.Ceiling(area.Height / zoom);

            int x0 = Math.Max(0, camX / 64 - 1), y0 = Math.Max(0, camY / 64 - 1);
            int x1 = Math.Min(this.TilesWide - 1, (camX + viewW) / 64 + 1);
            int y1 = Math.Min(this.TilesHigh - 1, (camY + viewH) / 64 + 3);

            Matrix toScreen = Matrix.CreateScale(zoom, zoom, 1) * Matrix.CreateTranslation(area.X, area.Y, 0);
            Matrix worldToScreen = Matrix.CreateTranslation(-camX, -camY, 0) * toScreen;

            b.End();
            bool begun = false;
            try
            {
                // map tiles
                b.Begin(SpriteSortMode.Deferred, BlendState.AlphaBlend, SamplerState.PointClamp, null, null, null, worldToScreen);
                begun = true;
                b.Draw(Pixel(b), new Rectangle(camX, camY, viewW, viewH), new Color(32, 48, 32));
                for (int l = 0; l < this.tiles.Length; l++)
                {
                    var grid = this.tiles[l];
                    if (grid == null)
                        continue;
                    int gw = grid.GetLength(0), gh = grid.GetLength(1);
                    for (int y = y0; y <= Math.Min(y1, gh - 1); y++)
                    {
                        for (int x = x0; x <= Math.Min(x1, gw - 1); x++)
                        {
                            TileDraw? t = grid[x, y];
                            if (t.HasValue)
                                b.Draw(t.Value.Texture, new Rectangle(x * 64, y * 64, 64, 64), t.Value.Source, Color.White);
                        }
                    }
                }
                b.End();
                begun = false;

                // world things, drawn by the game itself
                if (!this.worldDrawFailed)
                {
                    b.Begin(SpriteSortMode.FrontToBack, BlendState.AlphaBlend, SamplerState.PointClamp, null, null, null, toScreen);
                    begun = true;
                    this.DrawWorld(b, camX, camY, viewW, viewH, new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1));
                    b.End();
                    begun = false;
                }

                // overlay in world coordinates (grid, ghosts, highlights)
                if (drawOverlay != null)
                {
                    b.Begin(SpriteSortMode.Deferred, BlendState.AlphaBlend, SamplerState.PointClamp, null, null, null, worldToScreen);
                    begun = true;
                    drawOverlay(b);
                    b.End();
                    begun = false;
                }
            }
            catch (Exception ex)
            {
                G.LogOnce("map-draw", ex);
            }
            finally
            {
                if (begun)
                {
                    try { b.End(); } catch { /* ignore */ }
                }
                b.Begin(SpriteSortMode.Deferred, BlendState.AlphaBlend, SamplerState.PointClamp, null, null, null, null);
            }
        }

        private void DrawWorld(SpriteBatch b, int camX, int camY, int viewW, int viewH, Rectangle visibleTiles)
        {
            object? oldViewport;
            try
            {
                oldViewport = R.GetStatic(R.Game1, "viewport");
                Type vpType = oldViewport!.GetType();
                object newViewport = Activator.CreateInstance(vpType, camX, camY, viewW, viewH)!;
                R.SetStatic(R.Game1, "viewport", newViewport);
            }
            catch (Exception ex)
            {
                G.LogOnce("viewport", ex);
                this.worldDrawFailed = true;
                return;
            }

            try
            {
                Rectangle padded = new Rectangle(visibleTiles.X - 3, visibleTiles.Y - 3, visibleTiles.Width + 6, visibleTiles.Height + 8);

                foreach (object tf in G.TerrainFeatures(this.location))
                {
                    Vector2 tile = G.TileOf(tf);
                    if (padded.Contains((int)tile.X, (int)tile.Y))
                        Safe("terrain", () => R.Call(tf, "draw", b));
                }
                foreach (object clump in G.ResourceClumps(this.location))
                {
                    Vector2 tile = G.TileOf(clump);
                    if (padded.Contains((int)tile.X, (int)tile.Y))
                        Safe("clump", () => R.Call(clump, "draw", b));
                }
                foreach (object bush in G.LargeTerrainFeatures(this.location))
                {
                    Vector2 tile = G.TileOf(bush);
                    if (padded.Contains((int)tile.X, (int)tile.Y))
                        Safe("bush", () => R.Call(bush, "draw", b));
                }
                foreach (object obj in G.Objects(this.location))
                {
                    Vector2 tile = G.TileOf(obj);
                    if (padded.Contains((int)tile.X, (int)tile.Y))
                        Safe("object", () => R.Call(obj, "draw", b, (int)tile.X, (int)tile.Y));
                }
                foreach (object building in G.Buildings(this.location))
                {
                    Rectangle fp = G.BuildingFootprint(building);
                    Rectangle area = new Rectangle(fp.X, fp.Y - 8, fp.Width, fp.Height + 8);
                    if (area.Intersects(padded))
                        Safe("building", () => R.Call(building, "draw", b));
                }
            }
            finally
            {
                try { R.SetStatic(R.Game1, "viewport", oldViewport); }
                catch (Exception ex) { G.LogOnce("viewport-restore", ex); }
            }
        }

        private static readonly Dictionary<string, int> Failures = new();

        /// <summary>Run one draw call; a kind of thing that keeps failing is skipped so a bad member can't tank the frame rate.</summary>
        private static void Safe(string context, Action action)
        {
            if (Failures.TryGetValue(context, out int failures) && failures > 50)
                return;
            try { action(); }
            catch (Exception ex)
            {
                Failures[context] = failures + 1;
                G.LogOnce("draw-" + context, ex);
            }
        }

        private static Texture2D? pixel;

        public static Texture2D Pixel(SpriteBatch b)
        {
            if (pixel == null || pixel.IsDisposed)
            {
                pixel = new Texture2D(b.GraphicsDevice, 1, 1);
                pixel.SetData(new[] { Color.White });
            }
            return pixel;
        }
    }
}
