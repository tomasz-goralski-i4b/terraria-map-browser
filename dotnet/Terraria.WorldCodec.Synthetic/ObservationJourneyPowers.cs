namespace Terraria.WorldCodec.Synthetic;

/// <summary>Freezes Journey time using the documented creative-power section, without a new codec writer.</summary>
internal static class ObservationJourneyPowers
{
    internal static WorldEnvelope FreezeTime(WorldEnvelope source)
    {
        var section = source.World.Entities.Single(entry => entry.Section == "CreativePowers");
        if (section.Error is not null || section.Data is not CreativePowersSection powers)
        {
            throw new InvalidDataException("Observation time freezing requires readable creative powers.");
        }

        var opaque = source.OpaqueSections.Single(entry => entry.Name == section.Section);
        var bytes = opaque.Bytes.ToArray();
        using var reader = new BinaryReader(new MemoryStream(bytes));
        var found = false;
        // docs/file-format/entities.md, section 10: Bool sentinel, Int16 id,
        // then the documented Bool or Single value. Preserve every other byte.
        foreach (var power in powers.Entries)
        {
            if (!reader.ReadBoolean() || reader.ReadInt16() != power.PowerId)
            {
                throw new InvalidDataException("Creative-power bytes contradict their decoded entries.");
            }

            var valueOffset = checked((int)reader.BaseStream.Position);
            if (power.BooleanValue is { } boolean)
            {
                if (reader.ReadBoolean() != boolean)
                {
                    throw new InvalidDataException("Creative-power Boolean differs from its decoded value.");
                }

                if (power.PowerId == 0)
                {
                    bytes[valueOffset] = 1;
                    found = true;
                }
            }
            else if (power.SliderValue is { } slider && reader.ReadSingle() == slider)
            {
                // Slider values are preserved; time freezing is a separate Boolean power.
            }
            else
            {
                throw new InvalidDataException("Creative-power value differs from its decoded value.");
            }
        }

        if (!found || reader.ReadBoolean() || reader.BaseStream.Position != bytes.Length)
        {
            throw new InvalidDataException("Creative powers must contain time freezing and a final false sentinel.");
        }

        var frozen = new CreativePowersSection(powers.Entries.Select(power => power.PowerId == 0
            ? power with { BooleanValue = true } : power).ToArray());
        return source with
        {
            OpaqueSections = source.OpaqueSections.Select(entry => entry.Name == section.Section
                ? entry with { Bytes = bytes } : entry).ToArray(),
            World = source.World with
            {
                Entities = source.World.Entities.Select(entry => entry.Section == section.Section
                    ? entry with { Data = frozen } : entry).ToArray(),
            },
        };
    }
}
