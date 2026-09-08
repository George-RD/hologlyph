# Design

`buildMouthMaterial` borrows the front surface's colour, position and normal node
graphs. The mouth therefore follows text changes, density, palette, scroll and
melt without a second atlas, uniform updater or draw pass. Desaturation, reduced
glyph gain and a bounded cool edge keep the cavity dark rather than producing
bright dentures or pink flesh.

The mouth remains opaque and depth-writing, using the existing internal render
order and glass-layer gate. It must not inherit the shell's transparency, lens
compositing or role as the body used for overlay meshes. The engine builds one
mouth material per avatar, retains original materials for disposal, and tears
the replacement down with the skin passes. Its disposal is idempotent because
an avatar may also release its installed materials.

The shipped GLB combines teeth, gums and tongue, so this deliberately uses one
coherent treatment rather than guessing anatomical regions from vertex positions.
Separate per-tooth or tongue colours would require an explicit asset contract and
are not introduced. Existing routing for other custom materials stays unchanged.
