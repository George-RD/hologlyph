---
id: res.viseme-provider-format
nodes: [hologlyph.runtime.speech, hologlyph.runtime.motion]
sources: [src.v2-research-agents]
date: 2026-07-10
---

Question: which cloud TTS viseme metadata format should the mode-2 adapter e2e fixture encode? The adapter contract (`ProviderSynthesisResult` in `src/speech/adapters/provider.ts`) consumes already-normalised `VisemeFrame[]`, so the fixture models a provider's raw payload plus the parser that maps it to the 15 canonical viseme morphs.

Provider survey (all claims from official docs): Azure Speech emits first-class viseme events (`{ audioOffset, visemeId: 0..21 }`, 22 IDs for en-US) plus an optional 55-blendshape JSON frame stream; mapping 22 IDs onto 15 morphs is lossy and the 55-blendshape stream is over-specified for this rig. Amazon Polly emits viseme speech marks as line-delimited JSON (`{"time": ms, "type": "viseme", "start", "end", "value"}`) with a 17-symbol en-US alphabet of mouth-shape labels; note speech marks are not supported by Polly's generative engine (standard/neural only). Google Cloud TTS has no visemes, only v1beta1 SSML-mark timepoints. ElevenLabs has no visemes, only character/phoneme alignment timestamps.

Recommendation: model the committed fixture on Amazon Polly viseme speech marks. The alphabet is small, shape-named, and maps onto the repo's 15 morphs with only benign many-to-one merges (`t`,`l` -> viseme_dd; `@`,`a` -> viseme_aa; `e`,`E` -> viseme_ee; `o`,`O` -> viseme_oh; `u` -> viseme_ou; `i` -> viseme_ih; `p` -> viseme_pp; `f` -> viseme_ff; `T` -> viseme_th; `s` -> viseme_ss; `S` -> viseme_ch; `k` -> viseme_kk; `r` -> viseme_rr; sil -> viseme_sil). The parser sets the mapped morph to 1.0 per event or interpolates between consecutive events.

> Correction (2026-07-13, res.local-tts-dev + dec.head-asset-source): fixture generation is now a committed dev-only espeak-ng script emitting this same strictly-Polly shape (no invented symbols), replacing hand-authoring as the default; a second canonical VisemeFrame fixture covers `viseme_nn`, which Polly's alphabet cannot express. The provenance rule below still holds.

Fixture provenance: author the JSONL in Polly's documented shape; do not commit a captured `SynthesizeSpeech` response (avoids AWS Service Terms questions entirely and keeps the fixture deterministic). Example, hand-authored, for "hello":

```jsonl
{"time":0,"type":"viseme","start":0,"end":0,"value":"sil"}
{"time":60,"type":"viseme","start":0,"end":2,"value":"@"}
{"time":180,"type":"viseme","start":2,"end":4,"value":"l"}
{"time":300,"type":"viseme","start":4,"end":5,"value":"o"}
{"time":460,"type":"viseme","start":5,"end":5,"value":"sil"}
```

References: Polly viseme table (https://docs.aws.amazon.com/polly/latest/dg/ph-table-english-us.html), Polly speech-mark format (https://docs.aws.amazon.com/polly/latest/dg/output.html), Azure viseme docs (https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme), Google TTS v1beta1 (https://cloud.google.com/text-to-speech/docs/reference/rest/v1beta1/text/synthesize), ElevenLabs timestamps (https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).
