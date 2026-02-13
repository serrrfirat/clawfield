import * as THREE from 'three'

export type DitherUniforms = {
  uDitherCircleCenter: { value: THREE.Vector3 }
  uDitherChunkSize: { value: number }
  uDitherRadiusFactor: { value: number }
  uDitherFadeOffset: { value: number }
  uDitherBorderMult: { value: number }
  uDitherPixSize: { value: number }
  uDitherModeVal: { value: number }
  uDitherNoiseTex: { value: THREE.Texture | null }
  uDitherNoiseStr: { value: number }
  uDitherNoiseScl: { value: number }
}

type DitherValues = {
  circleCenter: THREE.Vector3
  chunkSize: number
  radiusFactor: number
  fadeOffset: number
  borderMult: number
  pixelSize: number
  ditherModeVal: number
  noiseTex: THREE.Texture | null
  noiseStr: number
  noiseScl: number
}

const DITHER_VERTEX_HEADER = /* glsl */ `
varying vec3 vDitherWorldPos;
`

const DITHER_VERTEX_MAIN = /* glsl */ `
vDitherWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`

const DITHER_FRAGMENT_HEADER = /* glsl */ `
uniform vec3 uDitherCircleCenter;
uniform float uDitherChunkSize;
uniform float uDitherRadiusFactor;
uniform float uDitherFadeOffset;
uniform float uDitherBorderMult;
uniform float uDitherPixSize;
uniform int uDitherModeVal;
uniform sampler2D uDitherNoiseTex;
uniform float uDitherNoiseStr;
uniform float uDitherNoiseScl;
varying vec3 vDitherWorldPos;

float revealDiamondThreshold(vec2 fc, float ps) {
  vec2 uv = mod(fc + 0.01, ps);
  vec2 c = (uv / ps) * 2.0 - 1.0;
  return (abs(c.x) + abs(c.y)) / 2.0;
}

float revealBayerThreshold(vec2 fc, float ps) {
  vec2 pc = floor(fc / ps);
  int x = int(mod(pc.x, 8.0));
  int y = int(mod(pc.y, 8.0));
  int M[64];
  M[0]=0;  M[1]=32; M[2]=8;  M[3]=40; M[4]=2;  M[5]=34; M[6]=10; M[7]=42;
  M[8]=48; M[9]=16; M[10]=56;M[11]=24;M[12]=50;M[13]=18;M[14]=58;M[15]=26;
  M[16]=12;M[17]=44;M[18]=4; M[19]=36;M[20]=14;M[21]=46;M[22]=6; M[23]=38;
  M[24]=60;M[25]=28;M[26]=52;M[27]=20;M[28]=62;M[29]=30;M[30]=54;M[31]=22;
  M[32]=3; M[33]=35;M[34]=11;M[35]=43;M[36]=1; M[37]=33;M[38]=9; M[39]=41;
  M[40]=51;M[41]=19;M[42]=59;M[43]=27;M[44]=49;M[45]=17;M[46]=57;M[47]=25;
  M[48]=15;M[49]=47;M[50]=7; M[51]=39;M[52]=13;M[53]=45;M[54]=5; M[55]=37;
  M[56]=63;M[57]=31;M[58]=55;M[59]=23;M[60]=61;M[61]=29;M[62]=53;M[63]=21;
  return float(M[y * 8 + x]) / 64.0;
}
`

const DITHER_FRAGMENT_MAIN = /* glsl */ `
{
  vec2 dwXZ = vDitherWorldPos.xz;
  vec2 dcXZ = uDitherCircleCenter.xz;
  float dDist = length(dwXZ - dcXZ) * uDitherBorderMult;
  vec2 dnUV = dwXZ * uDitherNoiseScl * 0.1;
  float dnVal = texture2D(uDitherNoiseTex, dnUV).r;
  float dnOff = (dnVal * 2.0 - 1.0) * uDitherNoiseStr;
  float dRad = uDitherChunkSize * uDitherRadiusFactor * (1.0 + dnOff);
  float dFade = 1.0 - (1.0 - smoothstep(dRad - uDitherFadeOffset, dRad, dDist));
  if (dFade > 0.0) {
    float dThr;
    if (uDitherModeVal == 0) {
      dThr = revealDiamondThreshold(gl_FragCoord.xy, uDitherPixSize + 4.0);
    } else {
      dThr = revealBayerThreshold(gl_FragCoord.xy, uDitherPixSize);
    }
    if (dThr < dFade) discard;
  }
}
`

export function patchMaterialWithDither(
  material: THREE.Material,
  uniforms: DitherUniforms,
  cacheKey: string = 'dither-reveal-v1',
): void {
  const mat = material as THREE.MeshStandardMaterial
  if (!mat.isMeshStandardMaterial) return

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDitherCircleCenter = uniforms.uDitherCircleCenter
    shader.uniforms.uDitherChunkSize = uniforms.uDitherChunkSize
    shader.uniforms.uDitherRadiusFactor = uniforms.uDitherRadiusFactor
    shader.uniforms.uDitherFadeOffset = uniforms.uDitherFadeOffset
    shader.uniforms.uDitherBorderMult = uniforms.uDitherBorderMult
    shader.uniforms.uDitherPixSize = uniforms.uDitherPixSize
    shader.uniforms.uDitherModeVal = uniforms.uDitherModeVal
    shader.uniforms.uDitherNoiseTex = uniforms.uDitherNoiseTex
    shader.uniforms.uDitherNoiseStr = uniforms.uDitherNoiseStr
    shader.uniforms.uDitherNoiseScl = uniforms.uDitherNoiseScl

    shader.vertexShader = DITHER_VERTEX_HEADER + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      DITHER_VERTEX_MAIN + '\n#include <project_vertex>',
    )

    shader.fragmentShader = DITHER_FRAGMENT_HEADER + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      DITHER_FRAGMENT_MAIN + '\n#include <dithering_fragment>',
    )
  }

  mat.customProgramCacheKey = () => cacheKey
  mat.needsUpdate = true
}

export function createDitherUniforms(values: DitherValues): DitherUniforms {
  return {
    uDitherCircleCenter: { value: values.circleCenter.clone() },
    uDitherChunkSize: { value: values.chunkSize },
    uDitherRadiusFactor: { value: values.radiusFactor },
    uDitherFadeOffset: { value: values.fadeOffset },
    uDitherBorderMult: { value: values.borderMult },
    uDitherPixSize: { value: values.pixelSize },
    uDitherModeVal: { value: values.ditherModeVal },
    uDitherNoiseTex: { value: values.noiseTex },
    uDitherNoiseStr: { value: values.noiseStr },
    uDitherNoiseScl: { value: values.noiseScl },
  }
}

export function updateDitherUniforms(uniforms: DitherUniforms, values: DitherValues): void {
  uniforms.uDitherCircleCenter.value.copy(values.circleCenter)
  uniforms.uDitherChunkSize.value = values.chunkSize
  uniforms.uDitherRadiusFactor.value = values.radiusFactor
  uniforms.uDitherFadeOffset.value = values.fadeOffset
  uniforms.uDitherBorderMult.value = values.borderMult
  uniforms.uDitherPixSize.value = values.pixelSize
  uniforms.uDitherModeVal.value = values.ditherModeVal
  uniforms.uDitherNoiseTex.value = values.noiseTex
  uniforms.uDitherNoiseStr.value = values.noiseStr
  uniforms.uDitherNoiseScl.value = values.noiseScl
}

export function linkDitherUniformsFromTreeUniforms(
  treeUniforms: Record<string, { value: any }>,
  fallbackNoiseTexture: THREE.Texture,
): DitherUniforms {
  return {
    uDitherCircleCenter: treeUniforms.uCircleCenter,
    uDitherChunkSize: treeUniforms.uChunkSize,
    uDitherRadiusFactor: treeUniforms.uCircleRadiusFactor,
    uDitherFadeOffset: treeUniforms.uGrassFadeOffset,
    uDitherBorderMult: treeUniforms.uBorderTreesMultiplier,
    uDitherPixSize: treeUniforms.uPixelSize,
    uDitherModeVal: treeUniforms.uDitherMode,
    uDitherNoiseTex: treeUniforms.uNoiseTexture ?? { value: fallbackNoiseTexture },
    uDitherNoiseStr: treeUniforms.uNoiseStrength,
    uDitherNoiseScl: treeUniforms.uNoiseScale,
  }
}
