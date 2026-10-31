using System;
using Microsoft.Xna.Framework;
using StardewModdingAPI.Events;

// Compile-time mirror of the subset of SMAPI 4.x public API used by the mod.
namespace StardewModdingAPI
{
    public enum LogLevel { Trace, Debug, Info, Warn, Error, Alert }

    public enum SButton
    {
        None = 0,
        MouseLeft = 1000,
        MouseRight = 1001,
        MouseMiddle = 1002,
    }

    public interface IMonitor
    {
        void Log(string message, LogLevel level = LogLevel.Trace);
    }

    public interface IManifest
    {
        string UniqueID { get; }
    }

    public interface IAssetName
    {
        string Name { get; }
        string BaseName { get; }
    }

    public interface IAssetInfo
    {
        IAssetName Name { get; }
    }

    public interface IAssetData<TValue> : IAssetInfo
    {
        TValue Data { get; }
    }

    public interface IAssetData : IAssetData<object> { }

    public interface ICursorPosition
    {
        Vector2 ScreenPixels { get; }
        Vector2 Tile { get; }
        Vector2 GrabTile { get; }
    }

    public interface IGameContentHelper
    {
        T Load<T>(string assetName) where T : notnull;
    }

    public interface IModContentHelper { }

    public interface IDataHelper
    {
        TModel? ReadSaveData<TModel>(string key) where TModel : class;
        void WriteSaveData<TModel>(string key, TModel? data) where TModel : class;
        TModel? ReadJsonFile<TModel>(string path) where TModel : class;
    }

    public interface IInputHelper
    {
        void Suppress(SButton button);
    }

    public interface ITranslationHelper
    {
        string Locale { get; }
    }

    public interface IModHelper
    {
        string DirectoryPath { get; }
        IModEvents Events { get; }
        IGameContentHelper GameContent { get; }
        IModContentHelper ModContent { get; }
        IDataHelper Data { get; }
        IInputHelper Input { get; }
        ITranslationHelper Translation { get; }
        TConfig ReadConfig<TConfig>() where TConfig : class, new();
        void WriteConfig<TConfig>(TConfig config) where TConfig : class, new();
    }

    public interface IMod
    {
        IModHelper Helper { get; }
        IMonitor Monitor { get; }
        IManifest ModManifest { get; }
        void Entry(IModHelper helper);
    }

    public abstract class Mod : IMod, IDisposable
    {
        public IModHelper Helper { get; internal set; } = null!;
        public IMonitor Monitor { get; internal set; } = null!;
        public IManifest ModManifest { get; internal set; } = null!;
        public abstract void Entry(IModHelper helper);
        public void Dispose() { }
    }

    public static class Context
    {
        public static bool IsWorldReady { get; }
        public static bool IsPlayerFree { get; }
        public static bool IsMainPlayer { get; }
    }
}

namespace StardewModdingAPI.Events
{
    public enum AssetLoadPriority { Low = -1000, Medium = 0, High = 1000, Exclusive = int.MaxValue }
    public enum AssetEditPriority { Early = -1000, Default = 0, Late = 1000 }

    public class SaveLoadedEventArgs : EventArgs { }
    public class ButtonPressedEventArgs : EventArgs
    {
        public SButton Button { get; }
        public ICursorPosition Cursor { get; } = null!;
    }
    public class AssetRequestedEventArgs : EventArgs
    {
        public IAssetName Name { get; } = null!;
        public IAssetName NameWithoutLocale { get; } = null!;
        public void LoadFromModFile<TAsset>(string relativePath, AssetLoadPriority priority) where TAsset : notnull { }
        public void Edit(Action<IAssetData> apply, AssetEditPriority priority = AssetEditPriority.Default, string? onBehalfOf = null) { }
    }

    public interface IGameLoopEvents
    {
        event EventHandler<SaveLoadedEventArgs> SaveLoaded;
    }
    public interface IInputEvents
    {
        event EventHandler<ButtonPressedEventArgs> ButtonPressed;
    }
    public interface IContentEvents
    {
        event EventHandler<AssetRequestedEventArgs> AssetRequested;
    }
    public interface IModEvents
    {
        IContentEvents Content { get; }
        IGameLoopEvents GameLoop { get; }
        IInputEvents Input { get; }
    }
}
