# Final boreal-tree correction

The user supplied two in-game references: long exposed mottled trunks, sparse side branches, bare forked crowns and snow on the upper edges of branches. The final snowy hill uses this bare tree variant, with no needles or leaf clusters. The green tree on the sky island remains leafy. Only the original generated artwork is shipped.

Generated with the built-in ImageGen tool. The tree correction was applied to an intermediate right-side master (not retained) and carried into the active `world-art-right-matched-b-master.png`. Runtime derivative: `apps/web/src/brand/world-art-right.webp`, 768 × 1152px, WebP quality 88 with preserved alpha.

## Prompt

```text
Use case: precise-object-edit.
Edit target IMAGE 1: right-side pixel-art illustration with floating cloud island, large transparent gap, and a snowy hillside with THREE conifer trees.
Reference IMAGES 2 and 3: user-provided screenshots of the EXACT BARE BOREAL TREE TYPE wanted in the snowy biome.
Make ONE PRECISE CHANGE: replace all THREE CONIFERS on the LOWER SNOWY HILL with BARE DECIDUOUS BOREAL TREES following these reference silhouettes. The trees have:
- absolutely NO LEAVES, NO NEEDLES, NO GREEN FOLIAGE, NO triangular pine crown;
- a very long, slim, straight mottled gray-brown vertical trunk;
- irregular short branches sparsely alternating at lower and middle trunk levels;
- a compact forked, antler-like crown made solely of naked woody branches spreading upwards;
- small uneven white snow caps lying on the UPPER EDGES of SOME branches and crown forks;
- original fine pixel-art rendering, matching image 1's texture and pixel scale.
The upper crown should look like bare angular twigs, not snow arranged in the shape of a pine. Vary heights and branch patterns naturally across the three trees, matching the supplied references closely in species and silhouette without directly pasting game sprites. Remove the old needle foliage completely.
PRESERVE everything else EXACTLY: floating island, leafy green tree on the UPPER island (this one stays leafy!), compact gold/blue sky shrine, unfinished blueprint extension, cloud-bank underside, empty transparent middle, solid snowy hill slope and terrain texture, existing composition, size, pixel-art style, transparency and palette.
Output portrait RGBA on genuine transparent background. Do not add backgrounds or change lighting. No new caves, text, UI or labels. This is a specific tree species correction, not a scene redesign.
```
