using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace DraftingTable
{
    /// <summary>
    /// Small cached reflection layer. The mod talks to the game only through this class, so a member that
    /// differs between the PC and Android builds of the game fails softly (an exception we can catch and log)
    /// instead of making SMAPI reject the whole mod as "broken code".
    /// </summary>
    internal static class R
    {
        private const BindingFlags InstanceFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly;
        private const BindingFlags StaticFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.DeclaredOnly;

        private static readonly Dictionary<string, Type?> Types = new();
        private static readonly Dictionary<(Type, string, bool), MemberInfo?> Members = new();
        private static readonly Dictionary<(Type, string, bool), MethodInfo[]> Methods = new();
        private static readonly Dictionary<Type, PropertyInfo?> ValueProps = new();

        public const string Game1 = "StardewValley.Game1";

        public static Type? T(string fullName)
        {
            if (Types.TryGetValue(fullName, out Type? cached))
                return cached;

            Type? found = null;
            foreach (Assembly asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try { found = asm.GetType(fullName, false); }
                catch { found = null; }
                if (found != null)
                    break;
            }
            // don't cache misses forever: the assembly might load later
            if (found != null)
                Types[fullName] = found;
            return found;
        }

        public static bool Is(object? obj, string fullTypeName)
        {
            for (Type? t = obj?.GetType(); t != null; t = t.BaseType)
            {
                if (t.FullName == fullTypeName)
                    return true;
            }
            return false;
        }

        /*********
        ** Fields & properties
        *********/
        private static MemberInfo? FindMember(Type type, string name, bool isStatic)
        {
            var key = (type, name, isStatic);
            if (Members.TryGetValue(key, out MemberInfo? cached))
                return cached;

            MemberInfo? found = null;
            for (Type? t = type; t != null && found == null; t = t.BaseType)
            {
                BindingFlags flags = isStatic ? StaticFlags : InstanceFlags;
                found = t.GetProperties(flags).FirstOrDefault(p => p.Name == name && p.GetIndexParameters().Length == 0);
                found ??= t.GetField(name, flags);
            }

            Members[key] = found;
            return found;
        }

        private static object? Read(MemberInfo? member, object? target, string name, Type type)
        {
            return member switch
            {
                PropertyInfo p => p.GetValue(target),
                FieldInfo f => f.GetValue(target),
                _ => throw new MissingMemberException(type.FullName, name)
            };
        }

        /// <summary>Get an instance field/property value (raw, e.g. a net field object).</summary>
        public static object? Raw(object? target, string name)
        {
            if (target == null)
                return null;
            Type type = target.GetType();
            return Read(FindMember(type, name, false), target, name, type);
        }

        /// <summary>Get an instance field/property value, unwrapping net fields (anything with a <c>Value</c> property).</summary>
        public static object? Get(object? target, string name) => Val(Raw(target, name));

        public static TValue? Get<TValue>(object? target, string name, TValue? fallback = default)
        {
            try
            {
                object? raw = Raw(target, name);
                if (raw is TValue direct)
                    return direct;
                if (Val(raw) is TValue unwrapped)
                    return unwrapped;
            }
            catch { /* fall through */ }
            return fallback;
        }

        public static object? GetStatic(string typeName, string name)
        {
            Type type = T(typeName) ?? throw new TypeLoadException(typeName);
            return Read(FindMember(type, name, true), null, name, type);
        }

        public static TValue? GetStatic<TValue>(string typeName, string name, TValue? fallback = default)
        {
            try
            {
                object? raw = GetStatic(typeName, name);
                if (raw is TValue direct)
                    return direct;
                if (Val(raw) is TValue unwrapped)
                    return unwrapped;
            }
            catch { /* fall through */ }
            return fallback;
        }

        public static void SetStatic(string typeName, string name, object? value)
        {
            Type type = T(typeName) ?? throw new TypeLoadException(typeName);
            switch (FindMember(type, name, true))
            {
                case PropertyInfo p: p.SetValue(null, value); break;
                case FieldInfo f: f.SetValue(null, value); break;
                default: throw new MissingMemberException(type.FullName, name);
            }
        }

        /// <summary>Set an instance field/property. If the member is a net field, sets its <c>Value</c> instead.</summary>
        public static void Set(object target, string name, object? value)
        {
            Type type = target.GetType();
            MemberInfo member = FindMember(type, name, false) ?? throw new MissingMemberException(type.FullName, name);
            Type memberType = member is PropertyInfo pi ? pi.PropertyType : ((FieldInfo)member).FieldType;

            bool direct = value == null ? !memberType.IsValueType : memberType.IsInstanceOfType(value);
            if (!direct)
            {
                // probably a net field: write its Value
                object? netField = Read(member, target, name, type);
                PropertyInfo? valueProp = netField != null ? ValueProp(netField.GetType()) : null;
                if (valueProp != null && valueProp.CanWrite)
                {
                    valueProp.SetValue(netField, Convert(value, valueProp.PropertyType));
                    return;
                }
            }

            switch (member)
            {
                case PropertyInfo p: p.SetValue(target, Convert(value, p.PropertyType)); break;
                case FieldInfo f: f.SetValue(target, Convert(value, f.FieldType)); break;
            }
        }

        private static PropertyInfo? ValueProp(Type type)
        {
            if (ValueProps.TryGetValue(type, out PropertyInfo? cached))
                return cached;

            PropertyInfo? found = null;
            for (Type? t = type; t != null && found == null; t = t.BaseType)
                found = t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).FirstOrDefault(p => p.Name == "Value" && p.GetIndexParameters().Length == 0);

            ValueProps[type] = found;
            return found;
        }

        /// <summary>Unwrap a net field (NetInt, NetString, NetRef...). Plain values are returned unchanged.</summary>
        public static object? Val(object? value)
        {
            if (value == null || value is string || value.GetType().IsPrimitive || value.GetType().IsEnum)
                return value;
            if (!(value.GetType().Namespace ?? "").StartsWith("Netcode"))
                return value;
            PropertyInfo? prop = ValueProp(value.GetType());
            return prop != null ? prop.GetValue(value) : value;
        }

        /*********
        ** Methods
        *********/
        public static object? Call(object target, string name, params object?[] args)
            => Invoke(target.GetType(), target, name, args, false, out _);

        public static object? CallOut(object target, string name, out object?[] allArgs, params object?[] args)
            => Invoke(target.GetType(), target, name, args, false, out allArgs);

        public static object? CallStatic(string typeName, string name, params object?[] args)
        {
            Type type = T(typeName) ?? throw new TypeLoadException(typeName);
            return Invoke(type, null, name, args, true, out _);
        }

        public static bool Has(object target, string methodName)
            => GetMethods(target.GetType(), methodName, false).Length > 0;

        private static MethodInfo[] GetMethods(Type type, string name, bool isStatic)
        {
            var key = (type, name, isStatic);
            if (Methods.TryGetValue(key, out MethodInfo[]? cached))
                return cached;

            var list = new List<MethodInfo>();
            var seen = new HashSet<string>();
            for (Type? t = type; t != null; t = t.BaseType)
            {
                foreach (MethodInfo m in t.GetMethods(isStatic ? StaticFlags : InstanceFlags))
                {
                    if (m.Name != name || m.IsGenericMethodDefinition)
                        continue;
                    // skip base declarations that a subclass overrode
                    string sig = string.Join(",", m.GetParameters().Select(p => p.ParameterType.FullName));
                    if (seen.Add(sig))
                        list.Add(m);
                }
            }

            MethodInfo[] result = list.OrderBy(m => m.GetParameters().Length).ToArray();
            Methods[key] = result;
            return result;
        }

        private static object? Invoke(Type type, object? target, string name, object?[] args, bool isStatic, out object?[] allArgs)
        {
            foreach (MethodInfo method in GetMethods(type, name, isStatic))
            {
                ParameterInfo[] ps = method.GetParameters();
                if (ps.Length < args.Length)
                    continue;

                bool ok = true;
                for (int i = 0; i < ps.Length && ok; i++)
                {
                    if (i < args.Length)
                        ok = Compatible(ps[i].ParameterType, args[i]);
                    else
                        ok = ps[i].IsOut || ps[i].HasDefaultValue || ps[i].IsOptional;
                }
                if (!ok)
                    continue;

                object?[] full = new object?[ps.Length];
                for (int i = 0; i < ps.Length; i++)
                {
                    if (i < args.Length)
                        full[i] = Convert(args[i], ps[i].ParameterType.IsByRef ? ps[i].ParameterType.GetElementType()! : ps[i].ParameterType);
                    else if (ps[i].IsOut)
                        full[i] = null;
                    else
                        full[i] = Type.Missing;
                }

                try
                {
                    object? result = method.Invoke(target, full);
                    allArgs = full;
                    return result;
                }
                catch (TargetInvocationException ex) when (ex.InnerException != null)
                {
                    throw ex.InnerException;
                }
            }

            throw new MissingMethodException(type.FullName, $"{name}({string.Join(", ", args.Select(a => a?.GetType().Name ?? "null"))})");
        }

        private static bool Compatible(Type paramType, object? arg)
        {
            if (paramType.IsByRef)
                paramType = paramType.GetElementType()!;
            if (arg == null)
                return !paramType.IsValueType || Nullable.GetUnderlyingType(paramType) != null;

            Type target = Nullable.GetUnderlyingType(paramType) ?? paramType;
            if (target.IsInstanceOfType(arg))
                return true;
            if (target.IsEnum && arg is int)
                return true;
            if (target == typeof(float) && (arg is int || arg is double))
                return true;
            return false;
        }

        private static object? Convert(object? value, Type targetType)
        {
            if (value == null)
                return null;
            Type target = Nullable.GetUnderlyingType(targetType) ?? targetType;
            if (target.IsInstanceOfType(value))
                return value;
            if (target.IsEnum && value is int i)
                return Enum.ToObject(target, i);
            if (target == typeof(float) && value is int n)
                return (float)n;
            if (target == typeof(float) && value is double d)
                return (float)d;
            return value;
        }

        /*********
        ** Collections
        *********/
        public static IEnumerable<object> Each(object? collection)
        {
            if (collection is not IEnumerable enumerable)
                yield break;
            foreach (object? item in enumerable)
            {
                if (item != null)
                    yield return item;
            }
        }

        /// <summary>Get the values of a dictionary-like game collection (Dictionary, NetDictionary, OverlaidDictionary).</summary>
        public static IEnumerable<object> Values(object? collection)
        {
            if (collection == null)
                return Array.Empty<object>();

            foreach (string prop in new[] { "Values", "Pairs" })
            {
                try
                {
                    object? values = Raw(collection, prop);
                    if (values is IEnumerable)
                        return prop == "Values" ? Each(values) : Each(values).Select(pair => Raw(pair, "Value")).Where(v => v != null)!;
                }
                catch { /* try next */ }
            }

            return Each(collection).Select(item =>
            {
                Type t = item.GetType();
                return t.IsGenericType && t.Name.StartsWith("KeyValuePair") ? Raw(item, "Value") : item;
            }).Where(v => v != null)!;
        }
    }
}
