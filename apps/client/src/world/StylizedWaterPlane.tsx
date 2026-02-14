import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import CustomShaderMaterial from 'three-custom-shader-material'

import waterVertexShader from '../../vendor/stylized-water/src/components/Water/shaders/vertex.glsl'
import waterFragmentShader from '../../vendor/stylized-water/src/components/Water/shaders/fragment.glsl'

const DITHER_VERTEX_HEADER = /* glsl */ `
varying vec3 vDitherWorldPos;
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

const DITHER_FRAGMENT_BLOCK = /* glsl */ `
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
`

interface StylizedWaterPlaneProps {
  waterLevel: number
  size?: number
  positionX?: number
  positionZ?: number
  nearColor?: string
  farColor?: string
  waveSpeed?: number
  waveAmplitude?: number
  textureSize?: number
  treeMaterialUniforms?: Record<string, { value: any }>
  noiseTexture?: THREE.Texture
}

export default function StylizedWaterPlane({
  waterLevel,
  size = 2200,
  positionX = 0,
  positionZ = 0,
  nearColor = '#00fccd',
  farColor = '#1ceeff',
  waveSpeed = 1.2,
  waveAmplitude = 0.1,
  textureSize = 45,
  treeMaterialUniforms,
  noiseTexture,
}: StylizedWaterPlaneProps) {
  const materialRef = useRef<any>(null)
  const farColorObj = useMemo(() => new THREE.Color(farColor), [farColor])
  const fallbackNoiseTex = useMemo(() => {
    const data = new Uint8Array([255, 255, 255, 255])
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
    tex.needsUpdate = true
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    return tex
  }, [])

  const patchedVertexShader = useMemo(() => {
    const anchor = 'csm_Position = modifiedPosition;'
    const inject = `${anchor}\n  vDitherWorldPos = (modelMatrix * vec4(modifiedPosition, 1.0)).xyz;`
    return DITHER_VERTEX_HEADER + waterVertexShader.replace(anchor, inject)
  }, [])

  const patchedFragmentShader = useMemo(() => {
    const anchor = 'csm_FragColor = vec4(finalColor, alpha);'
    const inject = `${DITHER_FRAGMENT_BLOCK}\n\n    ${anchor}`
    return DITHER_FRAGMENT_HEADER + waterFragmentShader.replace(anchor, inject)
  }, [])

  useEffect(() => {
    if (!materialRef.current?.uniforms) return
    const u = materialRef.current.uniforms
    u.uColorFar.value = farColorObj
    u.uWaveSpeed.value = waveSpeed
    u.uWaveAmplitude.value = waveAmplitude
    u.uTextureSize.value = textureSize
    u.uDitherNoiseTex.value = noiseTexture ?? fallbackNoiseTex
  }, [farColorObj, waveSpeed, waveAmplitude, textureSize, noiseTexture, fallbackNoiseTex])

  useEffect(() => {
    return () => {
      fallbackNoiseTex.dispose()
    }
  }, [fallbackNoiseTex])

  useFrame(({ clock }) => {
    if (!materialRef.current?.uniforms) return
    const u = materialRef.current.uniforms
    u.uTime.value = clock.getElapsedTime()

    if (treeMaterialUniforms) {
      u.uDitherCircleCenter.value.copy(treeMaterialUniforms.uCircleCenter.value)
      u.uDitherChunkSize.value = treeMaterialUniforms.uChunkSize.value
      u.uDitherRadiusFactor.value = treeMaterialUniforms.uCircleRadiusFactor.value
      u.uDitherFadeOffset.value = treeMaterialUniforms.uGrassFadeOffset.value
      u.uDitherBorderMult.value = treeMaterialUniforms.uBorderTreesMultiplier.value
      u.uDitherPixSize.value = treeMaterialUniforms.uPixelSize.value
      u.uDitherModeVal.value = treeMaterialUniforms.uDitherMode.value
      u.uDitherNoiseStr.value = treeMaterialUniforms.uNoiseStrength.value
      u.uDitherNoiseScl.value = treeMaterialUniforms.uNoiseScale.value
    }
  })

  return (
    <mesh rotation-x={-Math.PI / 2} position={[positionX, waterLevel, positionZ]}>
      <planeGeometry args={[size, size]} />
      <CustomShaderMaterial
        ref={materialRef}
        baseMaterial={THREE.MeshStandardMaterial}
        vertexShader={patchedVertexShader}
        fragmentShader={patchedFragmentShader}
        uniforms={{
          uTime: { value: 0 },
          uColorFar: { value: farColorObj },
          uWaveSpeed: { value: waveSpeed },
          uWaveAmplitude: { value: waveAmplitude },
          uTextureSize: { value: textureSize },
          uDitherCircleCenter: { value: new THREE.Vector3(0, 0, 0) },
          uDitherChunkSize: { value: 1e6 },
          uDitherRadiusFactor: { value: 1.0 },
          uDitherFadeOffset: { value: 1.0 },
          uDitherBorderMult: { value: 1.0 },
          uDitherPixSize: { value: 4 },
          uDitherModeVal: { value: 1 },
          uDitherNoiseTex: { value: noiseTexture ?? fallbackNoiseTex },
          uDitherNoiseStr: { value: 0 },
          uDitherNoiseScl: { value: 0 },
        }}
        color={nearColor}
        transparent
      />
    </mesh>
  )
}
