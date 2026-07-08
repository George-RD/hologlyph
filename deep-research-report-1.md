Technical Blueprint for a High-Performance, Text-Textured Web Talking Head Library
The deployment of real-time, interactive 3D digital humans within web-native architectures requires a careful balance of rendering performance, asset optimization, and behavioural realism. While historical browser-based implementations suffered from high latency, massive asset sizes, and cartoonish animations, modern technologies such as WebGPU, the Three.js Shading Language (TSL), and low-latency audio processing workers enable high-fidelity client-side execution.   
This report details the implementation blueprint for a lightweight, performant JavaScript library designed to render a 3D talking head whose skin is procedurally textured with dynamic code or text. The system incorporates life-like ocular mechanics, multi-track skeletal gestures, interactive scroll-driven animations, and a custom fluid-emergence shader.   
Core System Architecture and Integration
To deliver frame rates of 60 frames per second on both desktop and mobile devices, the library's design separates heavy calculations from the main rendering thread. This is achieved through a decoupled architecture that delegates text tokenization, phonetic parsing, and real-time spectral audio calculations to dedicated Web Workers, keeping the main render loop free to handle WebGL and WebGPU draw calls.   
The rendering core is built on Three.js, leveraging its high-level 3D abstraction layer and broad device compatibility. The rendering engine targets the WebGPURenderer via Three.js Shading Language (TSL) nodes, which compiles directly to WGSL for devices that support WebGPU, while falling back gracefully to GLSL and WebGL2 on older mobile platforms.   
+-----------------------------------------------------------------------------------+
|                                Main Browser Thread                                |
|                                                                                   |
|  +---------------------------+  +--------------------------+  +----------------+  |
|  |     Core Player Loop      |  |  Procedural Anim. Track  |  | Shaders & VFX  |  |
|  | (Three.js WebGL/WebGPU)   |  |   (Gaze & Scroll Input)  |  |  (Liquid/HDR)  |  |
|  +-------------+-------------+  +------------+-------------+  +-------+--------+  |
|                ^                             ^                        ^           |
+----------------|-----------------------------|------------------------|-----------+
                 | (SharedArrayBuffer /        | (Skeletal Transforms)  |
                 |  Message Passing)           |                        |
+----------------|-----------------------------|------------------------|-----------+
|                v                             |                        |           |
|  +-------------+-------------+               |                        |           |
|  |    AudioWorkletProcessor  |               |                        |           |
|  | (Real-time PCM analysis)  |               |                        |           |
|  +-------------+-------------+               |                        |           |
|                |                             v                        |           |
|                |                   +---------+--------+               |           |
|                v                   |   MotionEngine   |               v           |
|  +-------------+-------------+     |  (Additive Pose  |      +--------+-------+   |
|  |     HeadTTS Worker        | ===>|    Blending)     | ===> |   Text-Skin    |   |
|  |  (Kokoro / WASM Speech)   |     +------------------+      |  Canvas Engine |   |
|  +---------------------------+                               +----------------+   |
|                                                                                   |
|                                 Web Workers                                       |
+-----------------------------------------------------------------------------------+
By keeping these subsystems separate, developers can configure the library's features to match their performance requirements, disabling heavy post-processing passes on low-end hardware while keeping core lip-sync and eye contact active.   
Holographic Text-Based Surface Shading and Dynamic API Text Projection
The library's key visual feature is rendering a 3D bust textured entirely with crawling lines of digital code or text, matching the cybernetic aesthetic shown in the reference image. This is accomplished using an off-screen HTML5 Canvas mapped as a dynamic texture, combined with GPU-accelerated coordinate scrolling.   
Texture Management and API Projection
To make the text customizable, the library exposes a developer-facing JavaScript API (for example, head.updateTextSkin(content)) that overwrites the texture source. By default, the system initializes with a placeholder "Lorem Ipsum" block. When a developer hooks the library into a live API, the source text can be dynamically swapped with live code, chat logs, or system logs.   
Writing text onto a 2D canvas and uploading those pixels to the GPU is a common performance bottleneck in web graphics. If the canvas is redrawn and re-uploaded on every frame using texture.needsUpdate = true, the constant memory transfers between the CPU and GPU will cause visible frame drops and stuttering.   
To solve this, the library uses a hybrid rendering system. The off-screen canvas is drawn as a static, high-density coordinate grid of characters, and the texture is only re-uploaded to the GPU when the underlying text content is modified via the developer API. All dynamic movement—such as the vertical scrolling of code lines or horizontal scanning sweeps—is handled entirely on the GPU in the vertex and fragment shader stages.   
Method
Rendering Pipeline
CPU Overhead
GPU Memory Overhead
Animation Performance
Naive Canvas Update
Redraws text via CPU fillText on every frame; calls needsUpdate = true to force complete GPU texture rebinding.
Extremely High (causes main-thread blocking)
Low (re-uses single texture slot)
Very Poor (drops to 15-20 FPS on larger canvases)
Troika-Three-Text Instancing
Renders each character as a separate instanced glyph mesh with unique spatial transforms.
High (requires syncing hundreds of separate objects)
Medium (instanced geometries are lightweight)
Poor to Medium (bottlenecks at higher character counts)
GPU Scroll Mapping
Draws static canvas textures on change; scrolls texture coordinates (UVs) on the GPU using time-dependent vertex offset nodes.
Negligible (only runs on initial write or API change)
Medium (requires a high-resolution, static 2D grid)
Excellent (runs at a locked 60 FPS on mobile chips)
  
GLSL / TSL Text Shading and Selective Bloom Glow
To make the text appear to wrap naturally around the complex organic curves of the head, the material uses projective texture mapping. By using a projection matrix, the text is mapped onto the 3D head mesh as if it were projected from a single point in front of the model, preventing texture stretching around the ears and neck.   
To complete the cybernetic look, the text lines use High Dynamic Range (HDR) emission with selective bloom. The avatar material is configured as a MeshStandardNodeMaterial with standard tone-mapping disabled (toneMapped = false). This allows the emissive color coordinates to go beyond the standard low-dynamic-range (LDR) limit ([0.0,1.0]) into high-intensity ranges :   
C
emissive


=C
text


⋅I
glow


Where I
glow


≥10.0 represents the emissive scale. When passed through a selective post-processing bloom pass with a luminance threshold of 1.0, only the bright text lines glow with a soft, neon radiance, while the rest of the web page remains crisp and unaffected.   
OpenGL Shading Language

// GLSL snippet implementing time-scrolled projective text uv mapping
uniform sampler2D u_textTexture;
uniform float u_time;
uniform float u_scrollSpeed;
varying vec3 v_worldPosition;
varying vec3 v_normal;

void main() {
    // Basic projective UV generation based on XY world coordinates
    vec2 projectedUV = v_worldPosition.xy * 0.5 + 0.5;
    
    // Apply time-based vertical scroll entirely on the GPU
    projectedUV.y += u_time * u_scrollSpeed;
    
    // Sample the text texture using the scrolled coordinates
    vec4 textSample = texture2D(u_textTexture, fract(projectedUV));
    
    // Discard background pixels to make skin transparent, leaving only text
    if (textSample.a < 0.1) {
        discard;
    }
    
    gl_FragColor = textSample;
}
Fluid Interface Dynamics: The Emergence and Submergence Pool
To create a visually compelling transition, the library includes custom shaders that allow the talking head to emerge from or submerge back into a liquid pool.   
               
                         |
                         v
          +------------------------------+
          |      Vertex Shader Stage     |
          |  - Evaluates Vertex Height   |
          |  - Computes Distance to Pool |
          |  - Applies Surface Tension   |
          |    Displacement              |
          +--------------+---------------+
                         |
                         v
          +------------------------------+
          |    Fragment Shader Stage     |
          |  - Evaluates Clip Plane      |
          |  - Discards Beneath-Pool     |
          |    Fragments                 |
          |  - Renders Wet Line Glow     |
          +------------------------------+
Fragment Clipping and Plane Intersection
Slicing the geometry by generating new physical vertices on the CPU is too slow for real-time web applications. Instead, the clean cut at the water's surface is handled entirely inside the fragment shader.   
Let P=[P
x


,P
y


,P
z


] represent the world-space coordinate of an incoming fragment, $\hat{\mathbf{N}} = $ be the normal of a flat, horizontal pool plane, and y
pool


 be the uniform height of the liquid surface. The fragment shader discards any fragments that fall below the pool plane :   
if (P⋅
N
^
−y
pool


<0.0)⟹discard;
This single-pass discard runs extremely fast on mobile graphics chips while keeping the underlying vertex memory untouched.   
Surface Tension and Adhesion Simulation
To mimic the physical behavior of liquid clinging to the skin as the bust rises, the library uses vertex-stage coordinate modification. As the head emerges, vertices that are just above the water are pulled downward toward the surface plane.   
Let y
v


 be the vertical world coordinate of a vertex, and let h
tension


 represent the maximum distance of fluid adhesion. For vertices within this sticky boundary layer (0.0≤y
v


−y
pool


≤h
tension


), we apply a downward displacement offset D
y


 modeled by a cubic decay function :   
D
y


=Δy
max


⋅(1.0−
h
tension



y
v


−y
pool




)
3
y
displaced


=mix(y
v


,y
p


ool,D
y


)
Where Δy
max


 is the maximum stretch length. This pulls the boundary vertices down toward the pool plane, visually stretching the mouth or chin geometry before snapping back into place as the bust clears the threshold, creating an organic "sticky fluid" look.   
The liquid pool itself is rendered as a reflective horizontal plane displaced by a GPU-driven Heightmap shader. By capturing the intersection point of the avatar's bounding box and passing it to a 2D wave-propagation shader, we generate dynamic expanding ripples that interact with mouse scroll inputs and avatar movements.   
Real-Time Lip-Sync and Phonetic Processing Pipeline
Achieving natural lip-syncing requires matching visual mouth movements (visemes) with playing audio. This is accomplished either via pre-calculated text parsing or real-time digital audio analysis.   
Text-Driven Viseme Generation
Since standard browser voice synthesis APIs lack accurate word-level timestamps, the library relies on advanced TTS engines (such as ElevenLabs, Google Cloud TTS, or Microsoft Azure) to return speech audio alongside precise phonetic timestamps.   
Written text is parsed into phonetic sequences using a Rule-Based Grapheme-to-Phoneme (G2P) mapper. These phonemes are mapped to 15 standard Oculus-compatible viseme shapes. These shapes are baked directly into the base mesh during the preparation phase using rigging suites such as the Faceit Blender add-on.   
Oculus Viseme
Corresponding Phonemes
Primary Shape Key Targets Triggered
Mouth Geometric Configuration
viseme_sil
Silence / Neutral
mouthPressLeft, mouthPressRight
Lips relaxed, jaw completely closed.
viseme_PP
/p/, /b/, /m/
mouthClose, lipsLowerClose
Lips pressed together, jaw closed.
viseme_FF
/f/, /v/
mouthFrownLeft, mouthFrownRight
Lower lip tucked under upper teeth.
viseme_TH
/θ/, /ð/
jawOpen, mouthShrugLower
Tongue placed behind upper teeth, open aperture.
viseme_DD
/d/, /t/, /n/, /l/
jawOpen, mouthDimpleLeft
Tongue touching palate, moderate mouth width.
viseme_kk
/k/, /g/, /ŋ/
jawOpen, mouthStretchLeft
Back of tongue raised, jaw moderately open.
viseme_CH
/tʃ/, /dʒ/, /ʃ/
mouthFunnel, mouthPucker
Lips pursed and pushed forward.
viseme_SS
/s/, /z/
mouthSmileLeft, mouthSmileRight
Teeth aligned, slight horizontal smile.
viseme_nn
/n/, /ŋ/
jawOpen, mouthDimpleRight
Jaw slightly open, tongue touching palate.
viseme_RR
/r/
mouthPucker, jawOpen
Lips slightly rounded and pulled forward.
viseme_aa
/ɑ/, /æ/, /ʌ/
jawOpen, mouthRollLower
Jaw wide open, lips relaxed.
viseme_E
/eɪ/, /ɛ/, /ʌ/
jawOpen, mouthStretchLeft, mouthStretchRight
Jaw moderately open, corners pulled back.
viseme_I
/i:/, /ɪ/
mouthStretchLeft, mouthStretchRight
Mouth highly widened, jaw narrowly open.
viseme_O
/oʊ/, /ɔ:/
mouthFunnel, jawOpen
Lips rounded into an oval shape.
viseme_U
/u:/, /ʊ/, /w/
mouthPucker, jawOpen
Lips tightly rounded into a circle.
  
For client-side local execution, the library uses the in-browser HeadTTS module. This module runs WebGPU-accelerated Kokoro neural voices to generate both raw PCM audio and viseme indices directly on the user's machine.   
Audio-Driven Real-Time Analysis
When streaming live audio directly to the character (such as WebRTC or an active audio tag), the G2P pipeline is bypassed in favor of a low-latency AudioWorklet system. This process executes in a separate thread, running at a high audio sampling rate (e.g., 24,000 Hz or 48,000 Hz), and avoids stuttering by operating on a raw ring buffer.  
Inside the AudioWorkletProcessor, a Short-Time Fourier Transform (STFT) splits the audio signal into distinct energy bands. By evaluating the energy levels of lower vocal frequencies (Formant 1: F
1


, typically associated with jaw opening) and mid-range frequencies (Formant 2: F
2


, associated with lip rounding), the processor derives mouth geometry coordinates on the fly.   
Let the normalized spectral energy in the sub, low, mid, and high frequency ranges be represented by the vector 
E
 
=[E
sub


,E
low


,E
mid


,E
high


]. The target parameters for mouth openness (M
open


), mouth width (M
width


), and lip roundness (M
round


) are computed procedurally:   
M
open


=clamp(γ
1


⋅
E
sub


+ϵ

E
low


+E
mid




,0.0,1.0)
M
width


=clamp(γ
2


⋅
E
high


+ϵ

E
mid




,0.2,0.8)
M
round


=clamp(γ
3


⋅
E
mid


+ϵ

E
sub




,0.0,1.0)
Where γ
1


,γ
2


,γ
3


 are calibration scalars, and ϵ is a small constant to prevent division by zero. These three parameters are mapped directly to the active morph target array at 60 frames per second, creating real-time speech matching without needing text transcriptions.   
Behavioral Realism: Cognitive Gaze and Skeletal Gesture Engine
To prevent the avatar from appearing static and doll-like, the eye controllers must mimic the complex, organic gaze patterns of biological systems. This is achieved by combining distinct saccadic motion curves, cognitive blink reflexes, and social behavioral states.   
                              +-----------------------+
                              |   Behavioral State    |
                              | (Listening / Thinking)|
                              +-----------+-----------+
                                          |
                                          v
                              +-----------------------+
                              | Saccade Generator /   |
                              |    Target Selector    |
                              +-----------+-----------+
                                          |
                                          v
+-----------------------+     +-----------+-----------+     +-----------------------+
|    Natural Drift      | --->|     Procedural Gaze   | <---|     Micro-Saccades    |
|  (Gaussian Perlin)    |     |   Coordinate Mixer    |     | (High-Freq Jitter)    |
+-----------------------+     +-----------+-----------+     +-----------------------+
                                          |
                                          v
                              +-----------------------+
                              |    Target LookAt      |
                              |  (Yaw/Pitch Limits)   |
                              +-----------------------+
The Saccadic Main-Sequence
Eyes do not rotate continuously; instead, they move in rapid, sudden jumps known as saccades, followed by brief stationary periods called fixations. The physical execution of a saccade is defined by the empirical relationship known as the main-sequence. Let ΔR be the angular amplitude of the eye movement in degrees. The duration D of the movement in milliseconds and the peak angular velocity V
pk


 in degrees per second are modeled as:   
D=a+b⋅ΔR
V
pk


=V
0


⋅(1−e
−α⋅ΔR
)
Where typical human physiological parameters are set as a=21 ms, b=2.2 ms/deg, V
0


=450 deg/s, and α=0.04 deg
−1
. This ensures that wider eye movements take slightly longer and accelerate exponentially up to a hard physical speed limit.   
To prevent coordinate stretching on the Z-axis (which can happen when eyes are slightly flattened or non-spherical), look-at targets are converted to spherical rotation angles (pitch and yaw) applied directly to the eye bone quaternions rather than relying on standard coordinate projection.   
Social Behavioral States and Gaze Aversion
Gaze targets are determined by the avatar's internal behavioral state machine :   
	•	The Listening State: When the avatar is listening to user input, it maintains direct eye contact. To keep the stare looking natural, a micro-saccadic loop is active. At random intervals of 800 to 1200 milliseconds, the eye yaw and pitch are jittered within a narrow Gaussian distribution (σ≤1.5
	•	∘
	•	), simulating the microscopic drifting of human fixations.   
	•	The Speaking and Thinking States: During speech generation or cognitive pauses (thinking states), the avatar displays gaze aversion. Gaze aversion is procedurally modeled as a state machine that shifts focus to a target generated randomly within a constrained cone off-center (15
	•	∘
	•	 to 30
	•	∘
	•	 offset) for intervals conforming to natural human cognitive loading. Trust-gaze matrices scale the likelihood of eye contact based on positive or negative emotional cues.   
MotionEngine, Gestures, and Scroll-Driven Interactions
Body language, skeletal posture, and user-initiated browser actions are controlled through a layered motion playback system.   
Multi-Track Animation Architecture
The motion engine runs a concurrent, multi-track playback system to blend distinct skeletal postures smoothly :   
+-----------------------------------------------------------+
|                      Action Track                         |
|     (Temporal, one-shot triggers: nodding, waving)        |
+-----------------------------+-----------------------------+
                              | (Additive Blend)
                              v
+-----------------------------------------------------------+
|                        Mood Track                         |
|    (Persistent emotional expressions: thinking, smiling)  |
+-----------------------------+-----------------------------+
                              | (Weighted Linear Blend)
                              v
+-----------------------------------------------------------+
|                        Pose Track                         |
|      (Persistent base body and head alignment shifts)      |
+-----------------------------------------------------------+
To avoid jerky transitions when loading new animations, a spherical linear interpolation (SLERP) is applied to all bone rotations across a 300-millisecond crossfade window.   
Scroll-Driven Interface Control
To tie the avatar's presence into the webpage layout, page scrolling events are mapped directly to skeletal transformations and camera positioning. The current page scroll position is captured, normalized, and passed to a low-pass filter to smooth out sudden page movements :   
θ
target


=(
Scroll
max



Scroll
y




⋅Δθ
range


)+θ
base


θ
current


=lerp(θ
current


,θ
target


,α
smooth


)
Where α
smooth


∈[0.05,0.15] defines the damping strength, smoothing out quick mouse-wheel scrolling into a gentle head tilt or camera orbit. This creates a natural interaction where the character tracks the reading line or glances down as the user scrolls further down the page.   
Asset Optimization and Pipeline Integration
To ensure the library remains lightweight and compatible, default male and female busts are optimized through a rigorous compression pipeline before deployment.   
+------------------------------------+
|       3D Sculpt (Male/Female)      |
|  - High Resolution, Quad Topology  |
+-----------------+------------------+
                  |
                  v (Bake Normal & Texture Maps)
+-----------------+------------------+
|      Uncompressed Low-Poly glTF     |
|  - 52 ARKit Blendshapes            |
|  - 15 Oculus Visemes               |
+-----------------+------------------+
                  |
                  v (glTF-Transform Deconstruction)
+-----------------+------------------+
|     Optimized Pipeline Passes      |
|  - Draco / Meshopt Compression     |
|  - Texture Conversion (WebP/KTX2)  |
+-----------------+------------------+
                  |
                  v (Target Delivery Asset)
+-----------------+------------------+
|       Optimized GLB (< 1.5 MB)     |
+------------------------------------+
Geometry and Skeletal Optimization
The base 3D models are sculpted as clean, quad-only meshes capped at 15,000 triangles, containing only the upper torso, neck, head, and eyes. Each bust features standard skeletal structures rigged to be fully compatible with Mixamo animation bones, ensuring broad compatibility with pre-built skeletal motion files.   
JavaScript

// Initialization script preparing the loaders inside the browser environment
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Setup loaders with respective web-assembly decoders
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/decoders/draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

// Load the highly compressed model asynchronously
try {
    const gltf = await gltfLoader.loadAsync('/assets/bust_female_optimized.glb');
    const avatarMesh = gltf.scene;
    scene.add(avatarMesh);
} catch (error) {
    console.error("Critical error while loading optimized talking head asset:", error);
}
By applying Draco and Meshopt geometry compression, the delivery asset file sizes are compressed from over 15 MB down to under 1.5 MB. This ensures the 3D head is ready to render almost instantly upon the user's initial page load.   
Conclusions and Technical Roadmaps
Building a production-ready, client-side talking head library requires combining performance optimization with artistic styling. The following roadmap outlines the key steps to implement this library:
[Phase 1: Foundation] -> [Phase 2: Animation] -> ->
- Rigged Busts          - G2P Engine          - Saccades           - Fallbacks
- GLB Optimization      - AudioWorklet FFT    - Wet shaders        - CDNs & NPM
Phase 1: Base Asset Development and Loading Optimization
	•	Export default male and female busts with clean Mixamo rigs and the 52 standard ARKit blendshapes.   
	•	Run models through glTF-Transform to apply Draco and Meshopt geometry compression.   
	•	Convert all color and normal maps into high-performance, web-ready WebP formats.   
Phase 2: Speech Synthesis and Audio Analysis
	•	Implement a background worker G2P parsing module for text input.   
	•	Build a specialized, zero-dependency AudioWorklet to extract real-time viseme data from streaming audio inputs.   
	•	Create fallback mechanisms to use client-side APIs (such as Azure Visemes) when client hardware is constrained.   
Phase 3: Procedural Realism and Fluid Shaders
	•	Integrate the saccadic eye movement and cognitive blink reflexes into the update loop.   
	•	Write the GPU fragment shader clipping and vertex surface tension displacement shaders.   
	•	Connect scrolling events to the camera orbit and skeletal transform interpolations.   
Phase 4: Production Deployment and Browser Fallbacks
	•	Package the engine as a lightweight, bundle-optimized ES module.   
	•	Implement smooth fallbacks that swap WebGPU shaders to WebGL2, or disable heavy post-processing effects on mobile devices.   
	•	Host compiled assets on global Content Delivery Networks (CDNs) for lightning-fast loading speeds.   


 
github.com
GitHub - met4citizen/TalkingHead: Talking Head (3D): A JavaScript ...
Opens in a new window 
 
convai.com
Build Browser-Based Low-Latency Conversational AI Avatars with Three.js and React
Opens in a new window 
 
tympanus.net
How to Create a Liquid Raymarching Scene Using Three.js Shading Language | Codrops
Opens in a new window 
 
threejs.org
TSL Specification - Three.js
Opens in a new window 
 
stackoverflow.com
How to add 2D real time dynamic text to a Three.js scene? - Stack Overflow
Opens in a new window 
 
franky-arkon-digital.medium.com
Realistic and Fast Water Waves in Three.js | by Franky Hung | Medium
Opens in a new window 
 
journals.plos.org
Modelling 3D saccade generation by feedforward optimal control - Research journals
Opens in a new window 
 
erichlof.github.io
THREE.js-PathTracing-Renderer | Real-time PathTracing with global illumination and progressive rendering, all on top of the Three.js WebGL framework. Click here for Live Demo: https://erichlof.github.io/THREE.js-PathTracing-Renderer/Geometry_Showcase.html
Opens in a new window 
 
github.com
lip-sync-engine/examples/react/README.md at main - GitHub
Opens in a new window 
 
github.com
csmanioto/TalkingHead3D: Talking Head (3D): A JavaScript class for real-time lip-sync using Ready Player Me full-body 3D avatars. - GitHub
Opens in a new window 
 
forum.babylonjs.com
About the gltf-transform Tool - Questions - Babylon.js Forum
Opens in a new window 
 
medium.com
Three.JS WebGPURenderer Part 1: Fragment/Vertex Shaders | by Christian Helgeson
Opens in a new window 
 
discourse.threejs.org
100+ dynamic Troika-three-text labels with 1s updates - Questions
Opens in a new window 
 
codesandbox.io
threejs-holographic-material - Codesandbox
Opens in a new window 
 
tympanus.net
Playing with Texture Projection in Three.js - Codrops
Opens in a new window 
 
discourse.threejs.org
Postprocessing selective bloom - Questions - three.js forum
Opens in a new window 
 
discourse.threejs.org
Glowing Item Looking through Wall : Selective bloom - Questions - three.js forum
Opens in a new window 
 
discourse.threejs.org
How can I achieve selective glow with custom model? - Questions - three.js forum
Opens in a new window 
 
threejs.org
WaterMesh – three.js docs
Opens in a new window 
 
github.com
Clip geometry using plane and hiding part behind it · Issue #8462 · mrdoob/three.js - GitHub
Opens in a new window 
 
stackoverflow.com
Add clipping to THREE.ShaderMaterial - Stack Overflow
Opens in a new window 
 
discourse.threejs.org
Issue with global clipping planes and custom shader - Questions - three.js forum
Opens in a new window 
 
stackoverflow.com
Transitioning vertices between 3D models with three.js - Stack Overflow
Opens in a new window 
 
discussions.unity.com
Is there a way to calculate vertex tension for streched mesh areas to set alpha?
Opens in a new window 
 
github.com
GitHub - Amoner/lipsync-engine: Zero-dependency, renderer-agnostic streaming lip-sync engine for browser-based 2D animation. Real-time viseme detection via AudioWorklet + Web Audio API.
Opens in a new window 
 
github.com
Blend shapes (ARKit + Oculus visemes) and dynamic bones · Issue #302 · makehumancommunity/mpfb2 - GitHub
Opens in a new window 
 
reddit.com
I built a 15KB zero-dependency lip-sync engine that makes any 2D browser avatar talk from streaming audio : r/webdev - Reddit
Opens in a new window 
 
graphics.cs.wisc.edu
Stylized and Performative Gaze for Character Animation - University of Wisconsin–Madison
Opens in a new window 
 
arxiv.org
TalkingEyes: Pluralistic Speech-Driven 3D Eye Gaze Animation - arXiv
Opens in a new window 
 
mdpi.com
Review and Evaluation of Eye Movement Event Detection Algorithms - MDPI
Opens in a new window 
 
pmc.ncbi.nlm.nih.gov
Trajectory prediction of saccadic eye movements using a compressed exponential model
Opens in a new window 
 
discourse.threejs.org
Make only eyes move with (look at) the mouse cursor - three.js forum
Opens in a new window 
 
media.disneyanimation.com
Realistic Eye Motion Using Procedural Geometric Methods - Walt Disney Animation Studios
Opens in a new window 
 
repository.upenn.edu
Evaluating perceived trust from procedurally animated gaze - University of Pennsylvania
Opens in a new window 
 
offscreencanvas.com
Source code: threejs galleries, vertex displacement and more - Offscreen Canvas
Opens in a new window 
 
stackoverflow.com
How to make smooth transition in Three.js with shaders? - Stack Overflow
Opens in a new window 
 
threedee.design
Business Office Cartoon Woman - Rigged 3D Character for Blender - ThreeDee
Opens in a new window 
 
reddit.com
gltf models : r/threejs - Reddit
Opens in a new window 
 
gltf-transform.dev
draco - glTF Transform
Opens in a new window 
 
github.com
GitHub - donmccurdy/glTF-Transform: glTF 2.0 SDK for JavaScript and TypeScript, on Web and Node.js.

