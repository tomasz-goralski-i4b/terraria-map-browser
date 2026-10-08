namespace Terraria.WorldCodec.Synthetic;

/// <summary>Observation inputs for questions left open after the first game traversal.</summary>
internal static class AdditionalFramingCases
{
    internal static IEnumerable<FramingCase> Create()
    {
        Dictionary<char, Tile> Legend(int block, int partner = 0) => new()
        {
            ['.'] = new(), ['#'] = new() { Block = new VanillaContentRef(block) },
            ['d'] = new() { Block = new VanillaContentRef(partner) },
        };

        foreach (var (id, pattern) in new (string, string[])[]
        {
            ("dirt-pocket", ["ddd", "d#d", "ddd"]),
            ("dirt-boundary", ["dd##", "dd##", "dd##"]),
            ("isolated", ["...", ".#.", "..."]),
        })
        {
            yield return new("Coralstone", $"Coralstone-{id}", $"Coralstone {id}", pattern, Legend(315),
                "to observe: coralstone outline, connection or dirt rim; compare against the stone cases");
        }

        // Enumerate all NESW codes missing from the measured sheet art (docs/assets.md).
        // These are observation inputs, not a table of expected game-selected frames.
        const string missing = "dddx ddox ddxd ddxo ddxx dodx doxd doxx dxdd dxdo dxod dxxd dxxo oddx odxd odxx oxdd oxxd xddd xddo xddx xdod xdox xodd xodx xxdd xxdo xxod";
        foreach (var code in missing.Split(' '))
        {
            var rows = new[] { $".{code[0]}.", $"{code[3]}#{code[1]}", $".{code[2]}." };
            var legend = Legend(1);
            legend['x'] = new();
            legend['o'] = new() { Block = new VanillaContentRef(1) };
            yield return new("Rim fallback", $"Rim-missing-{code}", $"Stone missing rim {code}", rows, legend,
                "to observe: full outline fallback or retained partial dirt rim; inspect adjacent dirt edges too");
        }

        foreach (var (side, x, y) in new[] { ("north", 1, 0), ("east", 2, 1), ("south", 1, 2), ("west", 0, 1) })
        {
            for (var shape = 1; shape <= 5; shape++)
            {
                var rows = new[] { "ddd".ToCharArray(), "d#d".ToCharArray(), "ddd".ToCharArray() };
                rows[y][x] = 's';
                var legend = Legend(0);
                legend['s'] = new() { Block = new VanillaContentRef(0), Shape = (BlockShape)shape };
                yield return new("Shapes", $"Neighbour-shape{shape}-{side}", $"Full dirt with shape {shape} to {side}",
                    rows.Select(row => new string(row)).ToArray(), legend,
                    "to observe: centre edge toward the shaped neighbour; compare intact, half and cut faces");
            }
        }

        foreach (var (material, block) in new[] { ("dirt", 0), ("stone", 1) })
        {
            foreach (var (id, pattern) in new (string, string[])[]
            {
                ("three-holes", [".d.", "d#d", ".dd"]),
                ("four-holes", [".d.", "d#d", ".d."]),
                ("opposite-holes", [".dd", "d#d", "dd."]),
            })
            {
                yield return new("Corner priority", $"Corner-{material}-{id}", $"{material} {id}", pattern, Legend(block, block),
                    "to observe: centre corner notches and priority; all four cardinal neighbours are present");
            }
        }

        foreach (var (id, pattern) in new (string, string[])[]
        {
            ("three-stone-sides", ["ddd", "d#d", "..."]),
            ("stone-corner", ["...", ".#d", ".dd"]),
            ("stone-pillar", [".d.", ".#.", ".d."]),
        })
        {
            yield return new("Moss", $"Moss-{id}", $"Green moss {id}", pattern, Legend(179, 1),
                "to observe: grass transition rows 15-21 versus a stone-family frame; record before growth");
        }
    }
}
