# Implementation notes

## Corrected premise

The todo reasoned from an unverified assumption that converting `mouth_interior` and `eye_trim` to node materials would drop authored maps or emissive data. The tracked audit at `meta/research/melt-internals-material-audit.md` establishes that the shipped GLB has no maps, emissive contribution, vertex colours, alpha variation, or double-sided state on either material. There is no asset-data trade and no owner ruling is needed.

The conversion must nevertheless copy every enumerable property from the authored `MeshStandardMaterial` to an owned `MeshStandardNodeMaterial`, mirroring Three r178's private `NodeLibrary.fromMaterial()` semantics. This preserves future authored material fields without coupling the library to Three's private renderer API.

## Texture ownership

Converted authored materials share their enumerable texture references with
their glTF sources. The replacement node material remains in the scene and
owns those textures through renderer traversal. The engine retains converted
sources separately, disposing only their material objects at teardown; they
must never enter `displacedMaterials`, which disposes referenced textures.

## Studio cold-start alignment

The studio oracle caught a first-navigation-only 1440×900 alignment failure:
the stage was centred in the full viewport while the rail was visible. The
script applied `rail-visible` only after asynchronous engine mount. The desktop
markup now starts rail-visible, while narrow pre-ready CSS keeps both stage and
rail collapsed until the controller initialises.

The same oracle exposed that its threshold-55 rendered centroid is a
resolution-dependent brightness diagnostic, not a centring measure. `glass`
measured 8.239 px at 1920×1080 and this branch measured 8.226 px, while shell
centroid and silhouette bounds stayed within 1 px. The oracle was already red
on `glass`, making this a latent studio-oracle defect rather than a regression
from this change. The smoke now reports that metric but asserts only the shell
centroid and silhouette bounds.

## Displacement graph regression

The shader tests prove the eyeball and converted authored `positionNode` graphs
reach both melt amount and melt extent uniforms. Removing either assignment
initially failed with `Cannot read properties of null (reading 'traverse')`;
the graph helper now returns `false` for a missing position node, so the
existing labelled expectation reports the violated reachability contract.

## Melt sweep acceptance

Captured and inspected `/tmp/melt-shots/melt-0.png`,
`melt-0.25.png`, `melt-0.5.png`, `melt-0.7.png`, `melt-0.85.png`, and
`melt-1.png`. No floating eyeball, mouth cavity, or eye trim was visible at
any captured amount. At 1 the expected zero-thickness puddle limitation remains.

## Conversion lifetime and continuity

At avatar setup, every eligible `mouth_interior` and `eye_trim` mesh replaces
its authored `MeshStandardMaterial` with a converted node material regardless
of `melt.amount`; it is not a lazy melt-time swap. Consequently the shipped
head at `melt.amount: 0` renders with converted node materials, rather than
the authored material instances. The conversion preserves every enumerable
authored property and its zero-melt position is an identity transform, but
this remains a material-path change and is covered by the rest-state visual
inspection and conversion-property test.

The live melt-lab `cycle` ran from 0 to 1 and back to 0 with no console errors.
Visual inspection found no appearance, disappearance, or jump as the amount
left or returned to 0; the intermediate and peak captures likewise kept the
internals attached to the shell.
