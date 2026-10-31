#!/usr/bin/env bash
# Builds the mod and packs it into dist/DraftingTable-<version>.zip (needs .NET 6+ SDK).
set -euo pipefail
cd "$(dirname "$0")"
dotnet build DraftingTable/DraftingTable.csproj -c Release
version=$(python3 -c "import json;print(json.load(open('DraftingTable/manifest.json'))['Version'])")
out=dist/DraftingTable
rm -rf "$out" && mkdir -p "$out"
cp DraftingTable/bin/Release/net6.0/DraftingTable.dll DraftingTable/manifest.json "$out/"
cp -r DraftingTable/i18n DraftingTable/assets "$out/"
(cd dist && rm -f "DraftingTable-$version.zip" && python3 -c "
import shutil; shutil.make_archive('DraftingTable-$version', 'zip', '.', 'DraftingTable')")
echo "Packed dist/DraftingTable-$version.zip"
