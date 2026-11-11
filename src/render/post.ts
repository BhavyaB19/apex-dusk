import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Radial speed blur, chromatic fringe, vignette and a touch of grain. Runs in linear HDR. */
const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSpeed: { value: 0 },
    uBoost: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    uniform float uBoost;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 c = vUv - vec2(0.5, 0.46);
      float r = length(c);
      float amount = (uSpeed * 0.045 + uBoost * 0.045) * smoothstep(0.26, 0.85, r);

      vec3 col = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < 10; i++) {
        float t = float(i) / 9.0;
        float w = 1.0 - t * 0.55;
        col += texture2D(tDiffuse, vUv - c * amount * t).rgb * w;
        total += w;
      }
      col /= total;

      float ca = (0.0012 + uBoost * 0.004 + uSpeed * 0.0013) * r * 2.0;
      col.r = mix(col.r, texture2D(tDiffuse, vUv - c * (amount + ca * 3.0)).r, 0.5);
      col.b = mix(col.b, texture2D(tDiffuse, vUv + c * ca * 3.0).b, 0.5);

      col *= 1.0 - smoothstep(0.38, 0.98, r) * 0.6;
      col += vec3(0.02, 0.05, 0.09) * uBoost * smoothstep(0.3, 0.9, r);
      col += (hash(vUv * 900.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private speed: ShaderPass;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.55, 1.0);
    this.composer.addPass(this.bloom);
    this.speed = new ShaderPass(SpeedShader);
    this.composer.addPass(this.speed);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(dt: number, time: number, speed: number, boost: number): void {
    this.speed.uniforms.uSpeed.value = speed;
    this.speed.uniforms.uBoost.value = boost;
    this.speed.uniforms.uTime.value = time % 100;
    this.bloom.strength = 0.5 + boost * 0.22;
    this.composer.render(dt);
  }
}
