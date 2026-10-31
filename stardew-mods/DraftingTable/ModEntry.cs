using System;
using System.Collections;
using System.Collections.Generic;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewModdingAPI;
using StardewModdingAPI.Events;

namespace DraftingTable
{
    internal sealed class ModConfig
    {
        /// <summary>"auto" (follow the game), "uk", "ru" or "en".</summary>
        public string Language { get; set; } = "auto";

        /// <summary>Optional keyboard/controller key that opens the planner anywhere (e.g. "F8"). "None" to disable.</summary>
        public string OpenMenuKey { get; set; } = "None";

        /// <summary>Give one free table the first time a save is loaded with the mod.</summary>
        public bool GiveFreeTable { get; set; } = true;

        /// <summary>Price of the table in Robin's shop (0 to not sell it).</summary>
        public int ShopPrice { get; set; } = 500;
    }

    internal sealed class SaveState
    {
        public bool GaveTable { get; set; }
    }

    public sealed class ModEntry : Mod
    {
        public const string ItemId = "Loranius.DraftingTable_Table";
        public const string QualifiedItemId = "(BC)" + ItemId;
        private const string TextureAsset = "Mods/Loranius.DraftingTable/Table";
        private const string SaveKey = "state";

        private ModConfig config = new();

        public override void Entry(IModHelper helper)
        {
            G.Helper = helper;
            G.Monitor = this.Monitor;
            this.config = helper.ReadConfig<ModConfig>();
            I18n.Load(this.config.Language, SafeLocale(helper));

            helper.Events.Content.AssetRequested += this.OnAssetRequested;
            helper.Events.GameLoop.SaveLoaded += this.OnSaveLoaded;
            helper.Events.Input.ButtonPressed += this.OnButtonPressed;
        }

        private static string SafeLocale(IModHelper helper)
        {
            try { return helper.Translation.Locale ?? ""; }
            catch { return ""; }
        }

        /*********
        ** Content: item, texture, Robin's shop
        *********/
        /// <summary>The game crashes on glyphs its font lacks, so swap any it can't draw.</summary>
        private static string FontSafe(string text)
        {
            try
            {
                SpriteFont? font = G.SmallFont;
                return font != null ? I18n.Safe(font, text) : text;
            }
            catch { return text; }
        }

        private static bool IsAsset(AssetRequestedEventArgs e, string name)
            => string.Equals(e.NameWithoutLocale.Name.Replace('\\', '/'), name, StringComparison.OrdinalIgnoreCase);

        private void OnAssetRequested(object? sender, AssetRequestedEventArgs e)
        {
            if (IsAsset(e, TextureAsset))
            {
                e.LoadFromModFile<Texture2D>("assets/drafting-table.png", AssetLoadPriority.Exclusive);
            }
            else if (IsAsset(e, "Data/BigCraftables"))
            {
                e.Edit(asset => this.Try("add item", () =>
                {
                    Type type = R.T("StardewValley.GameData.BigCraftables.BigCraftableData") ?? throw new TypeLoadException("BigCraftableData");
                    object entry = Activator.CreateInstance(type)!;
                    R.Set(entry, "Name", "Drafting Table");
                    R.Set(entry, "DisplayName", FontSafe(I18n.Get("item.name")));
                    R.Set(entry, "Description", FontSafe(I18n.Get("item.description")));
                    R.Set(entry, "Price", Math.Max(1, this.config.ShopPrice / 2));
                    R.Set(entry, "CanBePlacedOutdoors", true);
                    R.Set(entry, "CanBePlacedIndoors", true);
                    R.Set(entry, "Texture", TextureAsset);
                    R.Set(entry, "SpriteIndex", 0);
                    ((IDictionary)R.Raw(asset, "Data")!)[ItemId] = entry;
                }));
            }
            else if (IsAsset(e, "Data/Shops") && this.config.ShopPrice > 0)
            {
                e.Edit(asset => this.Try("add to Robin's shop", () =>
                {
                    var shops = (IDictionary)R.Raw(asset, "Data")!;
                    object? carpenter = shops.Contains("Carpenter") ? shops["Carpenter"] : null;
                    if (carpenter == null)
                        return;
                    Type type = R.T("StardewValley.GameData.Shops.ShopItemData") ?? throw new TypeLoadException("ShopItemData");
                    object entry = Activator.CreateInstance(type)!;
                    R.Set(entry, "Id", ItemId);
                    R.Set(entry, "ItemId", QualifiedItemId);
                    R.Set(entry, "Price", this.config.ShopPrice);
                    ((IList)R.Raw(carpenter, "Items")!).Add(entry);
                }));
            }
        }

        /*********
        ** Free table on first load
        *********/
        private void OnSaveLoaded(object? sender, SaveLoadedEventArgs e)
        {
            if (!this.config.GiveFreeTable || !Context.IsMainPlayer)
                return;

            this.Try("give table", () =>
            {
                SaveState state = this.Helper.Data.ReadSaveData<SaveState>(SaveKey) ?? new SaveState();
                if (state.GaveTable)
                    return;

                object? item = G.CreateItem(QualifiedItemId);
                if (item != null && G.AddToInventory(item))
                {
                    state.GaveTable = true;
                    this.Helper.Data.WriteSaveData(SaveKey, state);
                    this.Monitor.Log("Gave the player a drafting table.", LogLevel.Info);
                }
            });
        }

        /*********
        ** Opening the planner
        *********/
        private static readonly int[] ActionButtons =
        {
            (int)SButton.MouseRight,
            88,   // X (default keyboard action button)
            6096  // ControllerA
        };

        private void OnButtonPressed(object? sender, ButtonPressedEventArgs e)
        {
            if (!Context.IsWorldReady || !Context.IsPlayerFree)
                return;

            try
            {
                if (this.config.OpenMenuKey != "None" && string.Equals(e.Button.ToString(), this.config.OpenMenuKey, StringComparison.OrdinalIgnoreCase))
                {
                    this.Helper.Input.Suppress(e.Button);
                    this.OpenPlanner(null, null, Vector2.Zero);
                    return;
                }

                bool isAction = Array.IndexOf(ActionButtons, (int)e.Button) >= 0;
                bool isTap = e.Button == SButton.MouseLeft && OperatingSystem.IsAndroid();
                if (!isAction && !isTap)
                    return;

                object? location = G.CurrentLocation;
                if (location == null)
                    return;

                foreach (Vector2 tile in new[] { e.Cursor.GrabTile, e.Cursor.Tile, e.Cursor.Tile + new Vector2(0, 1) })
                {
                    object? obj = G.ObjectAt(location, tile);
                    if (obj != null && G.QualifiedId(obj) == QualifiedItemId)
                    {
                        this.Helper.Input.Suppress(e.Button);
                        this.OpenPlanner(location, obj, G.TileOf(obj));
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                G.LogOnce("button", ex);
            }
        }

        private void OpenPlanner(object? tableLocation, object? table, Vector2 tableTile)
        {
            this.Try("open planner", () =>
            {
                object farm = G.Farm ?? throw new InvalidOperationException("farm not loaded");
                G.ClearTextureCache();
                G.PlaySound("bigSelect");
                G.ActiveMenu = new PlannerMenu(farm, tableLocation, table, tableTile);
            });
        }

        private void Try(string what, Action action)
        {
            try { action(); }
            catch (Exception ex) { this.Monitor.Log($"Failed to {what}: {ex}", LogLevel.Error); }
        }
    }
}
