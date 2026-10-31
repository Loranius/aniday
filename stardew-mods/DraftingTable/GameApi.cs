using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewModdingAPI;

namespace DraftingTable
{
    /// <summary>A building Robin can construct, read from <c>Data/Buildings</c>.</summary>
    internal sealed class BlueprintInfo
    {
        public string Id = "";
        public string Name = "";
        public string Description = "";
        public int Cost;
        public int Days;
        public bool Magical;
        public Point Size = new(1, 1);
        public string? Texture;
        public Rectangle SourceRect;
        public List<(string ItemId, int Amount)> Materials = new();
    }

    /// <summary>Reflection-based wrappers around the game API.</summary>
    internal static class G
    {
        public static IMonitor Monitor = null!;
        public static IModHelper Helper = null!;
        private static readonly HashSet<string> LoggedErrors = new();

        public static void LogOnce(string context, Exception ex)
        {
            if (LoggedErrors.Add(context + ex.GetType().Name))
                Monitor.Log($"[{context}] {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}", LogLevel.Warn);
        }

        /*********
        ** Game state
        *********/
        public static object? Player => R.GetStatic(R.Game1, "player");
        public static object? CurrentLocation => R.GetStatic(R.Game1, "currentLocation");
        public static object? Farm => R.CallStatic(R.Game1, "getFarm");

        public static object? ActiveMenu
        {
            get => R.GetStatic(R.Game1, "activeClickableMenu");
            set => R.SetStatic(R.Game1, "activeClickableMenu", value);
        }

        public static SpriteFont? SmallFont => R.GetStatic<SpriteFont>(R.Game1, "smallFont");

        public static Point UiSize
        {
            get
            {
                try
                {
                    object? vp = R.GetStatic(R.Game1, "uiViewport");
                    int w = R.Get<int>(vp, "Width"), h = R.Get<int>(vp, "Height");
                    if (w > 0 && h > 0)
                        return new Point(w, h);
                }
                catch { /* fallback below */ }
                object? vp2 = R.GetStatic(R.Game1, "viewport");
                return new Point(R.Get<int>(vp2, "Width"), R.Get<int>(vp2, "Height"));
            }
        }

        public static int Money
        {
            get => R.Get<int>(Player, "Money");
            set => R.Set(Player!, "Money", value);
        }

        public static void PlaySound(string cue)
        {
            try { R.CallStatic(R.Game1, "playSound", cue); }
            catch (Exception ex) { LogOnce("sound", ex); }
        }

        /*********
        ** Items
        *********/
        public static object? CreateItem(string itemId)
            => R.CallStatic("StardewValley.ItemRegistry", "Create", itemId);

        public static string QualifyId(string itemId)
        {
            try { return R.CallStatic("StardewValley.ItemRegistry", "QualifyItemId", itemId) as string ?? itemId; }
            catch { return itemId; }
        }

        public static string ItemName(string itemId)
        {
            try
            {
                object? data = R.CallStatic("StardewValley.ItemRegistry", "GetDataOrErrorItem", itemId);
                return R.Get<string>(data, "DisplayName") ?? itemId;
            }
            catch { return itemId; }
        }

        public static string QualifiedId(object item) => R.Get<string>(item, "QualifiedItemId") ?? "";
        public static int Stack(object item) => R.Get<int>(item, "Stack");
        public static string DisplayName(object item) => R.Get<string>(item, "DisplayName") ?? "?";

        /// <summary>The player's inventory as (slot, item) pairs, skipping empty slots.</summary>
        public static IEnumerable<(int Slot, object Item)> Inventory()
        {
            object? items = R.Raw(Player, "Items");
            int slot = 0;
            if (items is IEnumerable enumerable)
            {
                foreach (object? item in enumerable)
                {
                    if (item != null)
                        yield return (slot, item);
                    slot++;
                }
            }
        }

        public static void SetSlot(int slot, object? item)
        {
            object items = R.Raw(Player, "Items")!;
            R.Call(items, "set_Item", slot, item);
        }

        /// <summary>Remove <paramref name="count"/> from the item in a slot, clearing the slot when the stack runs out.</summary>
        public static void ReduceSlot(int slot, object item, int count)
        {
            int left = Stack(item) - count;
            if (left <= 0)
                SetSlot(slot, null);
            else
                R.Set(item, "Stack", left);
        }

        public static int CountItem(string itemId)
        {
            string qid = QualifyId(itemId);
            return Inventory().Where(p => QualifiedId(p.Item) == qid).Sum(p => Stack(p.Item));
        }

        public static void RemoveItems(string itemId, int amount)
        {
            string qid = QualifyId(itemId);
            foreach (var (slot, item) in Inventory().ToList())
            {
                if (amount <= 0)
                    break;
                if (QualifiedId(item) != qid)
                    continue;
                int take = Math.Min(amount, Stack(item));
                ReduceSlot(slot, item, take);
                amount -= take;
            }
        }

        public static bool AddToInventory(object item)
        {
            return R.Call(Player!, "addItemToInventoryBool", item) is true;
        }

        /*********
        ** Text & conditions
        *********/
        public static string ParseText(string? text)
        {
            if (string.IsNullOrEmpty(text))
                return "";
            try { return R.CallStatic("StardewValley.TokenizableStrings.TokenParser", "ParseText", text) as string ?? text; }
            catch { return text; }
        }

        public static bool CheckCondition(string? query)
        {
            if (string.IsNullOrWhiteSpace(query))
                return true;
            try { return R.CallStatic("StardewValley.GameStateQuery", "CheckConditions", query) is not false; }
            catch (Exception ex) { LogOnce("condition", ex); return true; }
        }

        /*********
        ** Content
        *********/
        private static readonly Dictionary<string, Texture2D?> Textures = new();

        public static Texture2D? LoadTexture(string? assetName)
        {
            if (string.IsNullOrEmpty(assetName))
                return null;
            if (Textures.TryGetValue(assetName, out Texture2D? cached))
                return cached;

            Texture2D? tex = null;
            foreach (string candidate in new[] { assetName, "Maps/" + assetName })
            {
                try
                {
                    tex = Helper.GameContent.Load<Texture2D>(candidate.Replace('\\', '/'));
                    break;
                }
                catch { /* try next */ }
            }
            Textures[assetName] = tex;
            return tex;
        }

        public static void ClearTextureCache() => Textures.Clear();

        public static object? LoadData(string assetName, Type dataType)
        {
            var method = typeof(IGameContentHelper).GetMethods()
                .First(m => m.Name == "Load" && m.IsGenericMethodDefinition && m.GetParameters().Length == 1 && m.GetParameters()[0].ParameterType == typeof(string));
            return method.MakeGenericMethod(dataType).Invoke(Helper.GameContent, new object[] { assetName });
        }

        /*********
        ** Buildings
        *********/
        public static List<BlueprintInfo> GetRobinBlueprints()
        {
            var result = new List<BlueprintInfo>();
            Type? dataType = R.T("StardewValley.GameData.Buildings.BuildingData");
            if (dataType == null)
                return result;

            Type dictType = typeof(Dictionary<,>).MakeGenericType(typeof(string), dataType);
            if (LoadData("Data/Buildings", dictType) is not IDictionary data)
                return result;

            foreach (DictionaryEntry entry in data)
            {
                try
                {
                    object d = entry.Value!;
                    string builder = R.Get<string>(d, "Builder") ?? "";
                    if (!string.Equals(builder, "Robin", StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (!string.IsNullOrEmpty(R.Get<string>(d, "BuildingToUpgrade")))
                        continue; // upgrades (Big Coop etc.) are still ordered from Robin directly
                    if (!CheckCondition(R.Get<string>(d, "BuildCondition")))
                        continue;

                    var info = new BlueprintInfo
                    {
                        Id = (string)entry.Key,
                        Name = ParseText(R.Get<string>(d, "Name")),
                        Description = ParseText(R.Get<string>(d, "Description")),
                        Cost = R.Get<int>(d, "BuildCost"),
                        Days = R.Get<int>(d, "BuildDays"),
                        Magical = R.Get<bool>(d, "MagicalConstruction"),
                        Size = R.Get<Point>(d, "Size"),
                        Texture = R.Get<string>(d, "Texture"),
                        SourceRect = R.Get<Rectangle>(d, "SourceRect")
                    };
                    if (info.Size.X <= 0 || info.Size.Y <= 0)
                        info.Size = new Point(1, 1);
                    foreach (object mat in R.Each(R.Raw(d, "BuildMaterials")))
                        info.Materials.Add((R.Get<string>(mat, "ItemId") ?? "", R.Get<int>(mat, "Amount")));
                    if (string.IsNullOrEmpty(info.Name))
                        info.Name = info.Id;
                    result.Add(info);
                }
                catch (Exception ex) { LogOnce("blueprint", ex); }
            }
            return result;
        }

        public static IEnumerable<object> Buildings(object location) => R.Each(R.Raw(location, "buildings"));

        public static Rectangle BuildingFootprint(object building)
        {
            return new Rectangle(
                R.Get<int>(building, "tileX"), R.Get<int>(building, "tileY"),
                Math.Max(1, R.Get<int>(building, "tilesWide")), Math.Max(1, R.Get<int>(building, "tilesHigh")));
        }

        /// <summary>Whether Robin is already busy constructing or upgrading something (only one job at a time, like in the base game).</summary>
        public static bool IsRobinBusy()
        {
            try
            {
                if (R.CallStatic(R.Game1, "IsThereABuildingUnderConstruction", "Robin") is bool busy)
                    return busy;
            }
            catch (Exception ex) { LogOnce("robin-busy", ex); }

            object? farm = Farm;
            return farm != null && Buildings(farm).Any(b =>
                R.Get<int>(b, "daysOfConstructionLeft") > 0 || R.Get<int>(b, "daysUntilUpgrade") > 0);
        }

        public static bool IsBuildable(object location, Vector2 tile)
        {
            try { return R.Call(location, "isBuildable", tile) is true; }
            catch (Exception ex) { LogOnce("isBuildable", ex); return true; }
        }

        /// <summary>Ask the game to place a building, the same call Robin's menu uses.</summary>
        public static object? BuildStructure(object location, BlueprintInfo blueprint, Vector2 tile)
        {
            object? result = R.CallOut(location, "buildStructure", out object?[] args, blueprint.Id, tile, Player, null, blueprint.Magical);
            if (result is not true)
                return null;
            object? building = args.Length > 3 ? args[3] : null;
            return building ?? Buildings(location).FirstOrDefault(b => BuildingFootprint(b).Location == new Point((int)tile.X, (int)tile.Y));
        }

        /*********
        ** World objects
        *********/
        public static object? ObjectAt(object location, Vector2 tile)
        {
            try { return R.Call(location, "getObjectAtTile", (int)tile.X, (int)tile.Y); }
            catch (Exception ex) { LogOnce("getObjectAtTile", ex); return null; }
        }

        public static object? TerrainFeatureAt(object location, Vector2 tile)
        {
            object? features = R.Raw(location, "terrainFeatures");
            if (features == null)
                return null;
            object? result = R.CallOut(features, "TryGetValue", out object?[] args, tile, null);
            return result is true ? args[1] : null;
        }

        public static IEnumerable<object> Objects(object location) => R.Values(R.Raw(location, "objects"));
        public static IEnumerable<object> TerrainFeatures(object location) => R.Values(R.Raw(location, "terrainFeatures"));
        public static IEnumerable<object> LargeTerrainFeatures(object location) => R.Each(R.Raw(location, "largeTerrainFeatures"));
        public static IEnumerable<object> ResourceClumps(object location) => R.Each(R.Raw(location, "resourceClumps"));

        public static Vector2 TileOf(object worldThing)
        {
            foreach (string name in new[] { "TileLocation", "Tile", "tileLocation", "tile", "currentTileLocation" })
            {
                try
                {
                    object? v = R.Get(worldThing, name);
                    if (v is Vector2 vec)
                        return vec;
                }
                catch { /* next */ }
            }
            return new Vector2(-1, -1);
        }
    }
}
