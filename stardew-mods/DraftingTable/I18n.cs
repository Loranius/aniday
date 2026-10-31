using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xna.Framework.Graphics;

namespace DraftingTable
{
    internal static class I18n
    {
        private static Dictionary<string, string> current = new();
        private static Dictionary<string, string> fallback = new();
        public static string Language { get; private set; } = "en";

        public static void Load(string configured, string gameLocale)
        {
            string lang = (configured ?? "auto").Trim().ToLowerInvariant();
            if (lang == "auto" || lang == "")
            {
                string locale = (gameLocale ?? "").ToLowerInvariant();
                lang = locale.StartsWith("uk") ? "uk" : locale.StartsWith("ru") ? "ru" : "en";
            }

            Language = lang;
            fallback = Read("en");
            current = lang == "en" ? fallback : Read(lang);
            if (current.Count == 0)
                current = fallback;
        }

        private static Dictionary<string, string> Read(string lang)
        {
            try { return G.Helper.Data.ReadJsonFile<Dictionary<string, string>>($"i18n/{lang}.json") ?? new(); }
            catch { return new(); }
        }

        public static string Get(string key, params object[] args)
        {
            if (!current.TryGetValue(key, out string? text) && !fallback.TryGetValue(key, out text))
                text = key;
            for (int i = 0; i < args.Length; i++)
                text = text.Replace("{" + i + "}", args[i]?.ToString() ?? "");
            return text;
        }

        private static readonly Dictionary<SpriteFont, HashSet<char>> Glyphs = new();

        /// <summary>Replace characters the game font can't draw (MonoGame throws on them).</summary>
        public static string Safe(SpriteFont font, string text)
        {
            if (!Glyphs.TryGetValue(font, out HashSet<char>? set))
            {
                set = new HashSet<char>(font.Characters);
                Glyphs[font] = set;
            }
            if (text.All(c => c == '\n' || set.Contains(c)))
                return text;
            char fallbackChar = font.DefaultCharacter ?? '?';
            return new string(text.Select(c => c == '\n' || set.Contains(c) ? c : Transliterate(c, set, fallbackChar)).ToArray());
        }

        // Ukrainian letters missing from fonts that only have Russian Cyrillic.
        private static char Transliterate(char c, HashSet<char> set, char fallbackChar)
        {
            char alt = c switch
            {
                'і' => 'i', 'І' => 'I', 'ї' => 'i', 'Ї' => 'I',
                'є' => 'е', 'Є' => 'Е', 'ґ' => 'г', 'Ґ' => 'Г',
                '’' => '\'', '—' => '-', '–' => '-', '…' => '.',
                _ => fallbackChar
            };
            return set.Contains(alt) ? alt : (set.Contains(fallbackChar) ? fallbackChar : ' ');
        }
    }
}
