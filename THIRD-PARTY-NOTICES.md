# Third-party notices

## Kokoro-82M and kokoro-js

The optional `hologlyph/speech` adapter can load `kokoro-js` and Kokoro-82M
model weights on demand. Neither the runtime package nor the model weights are
bundled with Hologlyph.

- Library: `kokoro-js` 1.2.1, https://www.npmjs.com/package/kokoro-js/v/1.2.1
- npm integrity: `sha512-oq0HZJWis3t8lERkMJh84WLU86dpYD0EuBPtqYnLlQzyFP1OkyBRDcweAqCfhNOpltyN9j/azp1H6uuC47gShw==`
- Model: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- Reviewed model revision: `1939ad2a8e416c0acfeecc08a694d14ef25f2231`
- Licence: Apache License 2.0
- Licence text: https://www.apache.org/licenses/LICENSE-2.0

`kokoro-js` 1.2.1 resolves model and voice files from the model's `main`
revision and does not expose a revision option. The reviewed revision above is
an audit record, not a runtime pin. Applications requiring immutable weights
must provide a loader backed by pinned or self-hosted content.

## snapDOM (`@zumer/snapdom`)

The optional page snapshot lens (`refract` / `engine.setLensSource`) can load
`@zumer/snapdom` on demand to rasterise a host-named DOM subtree. It is an
optional peer dependency, resolved through a dynamic import and excluded from
the library build, so it is neither bundled nor installed unless a host opts
in. A host that supplies its own rasteriser never loads it at all.

- Library: `@zumer/snapdom` 2.22.0, https://www.npmjs.com/package/@zumer/snapdom/v/2.22.0
- npm integrity: `sha512-XfOa0pqiRj9+zsrHm5+hLmKMmMuFxIhrmrSrJKMkSf9DFGnDsql89bd4IMFnLMWl1WmW0X5YOjtSZi8jvYkbVw==`
- Licence: MIT (same text as reproduced below for ICT-FaceKit, with copyright
  held by the snapDOM authors)

## ICT-FaceKit (USC Institute for Creative Technologies)

The default head bust shipped with this package (inside dist/, as an inlined
GLB asset) is derived from ICT-FaceKit's generic neutral mesh and ARKit-style
expression shapes.

- Source: https://github.com/USC-ICT/ICT-FaceKit
- Pinned commit: da5f95a607f5e6b37755b38d3385d7f2853732e5
- Licence: MIT (text below, as required by its terms)

MIT License

Copyright (c) 2020 USC Institute for Creative Technologies

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
