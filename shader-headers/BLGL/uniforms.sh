#ifndef __UNIFORMS_SH__
#define __UNIFORMS_SH__

#if COMPILEVS

// Vertex shader uniforms
uniform vec3 u_AmbientStartColor; //vec3
uniform vec3 u_AmbientEndColor; //vec3
uniform vec4 u_VertexAmbientColor; // vec4
uniform hmat3 u_BillboardRot; // mat3 hlslcc 算offset可能会有问题
uniform hvec3 u_CameraPos; //vec3
uniform hfloat u_NearClip; //float
uniform hfloat u_FarClip; //float
uniform hvec4 u_DepthMode;
uniform vec3 u_FrustumSize; //vec3
uniform hfloat u_DeltaTime; //float
uniform hfloat u_ElapsedTime; //float
uniform vec4 u_GBufferOffsets;
uniform hvec4 u_LightPos;
uniform vec3 u_LightDir; //vec3
uniform hvec4 u_NormalOffsetScale;
//uniform hmat4 cModel; u_model
//uniform hmat4 cView; u_view
//uniform hmat4 cViewInv; u_invView
//uniform hmat4 cViewProj; u_viewProj
uniform vec4 u_UOffset;
uniform vec4 u_VOffset;
uniform hmat4 u_Zone;
#if !defined(URHO3D_MOBILE) || defined(WEBGL)
    uniform hmat4 u_LightMatrices[4];
#else
    uniform hmat4 u_LightMatrices[2];
#endif
//#ifdef SKINNED
//    uniform hvec4 u_SkinMatrices[MAXBONES*3]; // u_model[BGFX_CONFIG_MAX_BONES]
//#endif
#ifdef NUMVERTEXLIGHTS
    uniform hvec4 u_VertexLights[4*3];
#endif
#ifdef GL3
    uniform hvec4 u_ClipPlane;
#endif
uniform hfloat u_ElapsedTimeReal;
uniform vec2 u_OddNegativeScale; // vec2
uniform hvec2 u_TerrainOffset;
uniform hvec2 u_TerrainSize;
uniform vec2 u_WeatherTiling;
uniform float u_DissolveRate; // float
uniform hvec3 u_BillboardCameraRight; // vec3

// 特殊的InstanceData0，用来保存Node的位置（为了兼容静态模型和骨骼模型，所以额外加了一个uniform）
uniform hvec4 u_InstanceData0;
uniform hvec4 u_InstanceData1;
uniform hvec4 u_InstanceData2;
uniform hvec4 u_InstanceData3;

uniform vec4 u_WindPowerOffset;
uniform vec4 u_WindLowNoise;
uniform vec4 u_WindHighNoise;
// uniform float u_WindRadiusScale;
// uniform float u_WindSpeed01;
// uniform float u_WindSpeed02;
// uniform float u_OverAllWindPower;

#define cAmbientStartColor u_AmbientStartColor
#define cAmbientEndColor u_AmbientEndColor
#define cVertexAmbientColor u_VertexAmbientColor
#define cBillboardRot u_BillboardRot
#define cCameraPos u_CameraPos
#define cNearClip u_NearClip
#define cFarClip u_FarClip
#define cDepthMode u_DepthMode
#define cFrustumSize u_FrustumSize
#define cDeltaTime u_DeltaTime
#define cElapsedTime u_ElapsedTime
#define cGBufferOffsets u_GBufferOffsets
#define cLightPos u_LightPos
#define cLightDir u_LightDir
#define cNormalOffsetScale u_NormalOffsetScale
#define cModel u_model[0]
#define cView u_view
#define cViewInv u_invView
#define cViewProj u_viewProj
#define cUOffset u_UOffset
#define cVOffset u_VOffset
#define cZone u_Zone
#define cLightMatrices u_LightMatrices
#define cSkinMatrices u_SkinMatrices
#define cVertexLights u_VertexLights

#define cClipPlane u_ClipPlane
#define cElapsedTimeReal u_ElapsedTimeReal
#define cNormalOddNegativeScale u_OddNegativeScale.x
#define cBitangentOddNegativeScale u_OddNegativeScale.y


#define cTerrainOffset u_TerrainOffset
#define cTerrainSize u_TerrainSize
#define cWeatherTiling u_WeatherTiling
#define _DissolveRate u_DissolveRate
#define cCameraRight u_BillboardCameraRight

#define cNodePosition u_InstanceData0.xyz
#define cGroundZ u_InstanceData1.x
#define cBBoxMaxZ u_InstanceData1.y
#define cBBoxMinZ u_InstanceData1.z
#define cObjectType u_InstanceData1.w
#define cLightMapBias u_InstanceData2

#define cWindPower u_WindPowerOffset.x

#define cWindLowFrequency u_WindLowNoise.x
#define cWindLowGrain u_WindLowNoise.y
#define cWindLowStrength u_WindLowNoise.zzw
#define cWindHighFrequency u_WindHighNoise.x
#define cWindHighGrain u_WindHighNoise.y
#define cWindHighStrength u_WindHighNoise.zzw
#define cWindHighTimeInterval u_WindPowerOffset.z
#define cWindOffset u_WindPowerOffset.y

#endif

#if COMPILEPS

uniform vec4 u_AmbientColor;
uniform hvec3 u_CameraPosPS; //hvec3
uniform float u_DeltaTimePS; //float
uniform hvec4 u_DepthReconstruct;
uniform float u_ElapsedTimePS; //float
uniform vec4 u_FogParams;
uniform vec4 u_FogParams2;
uniform vec3 u_FogColor; //vec3
uniform vec2 u_GBufferInvSize; //vec2
uniform vec4 u_LightColor;
uniform vec4 u_LightPosPS;
uniform vec3 u_LightDirPS; //vec3
uniform vec4 u_NormalOffsetScalePS;
uniform vec4 u_MatDiffColor;
uniform vec3 u_MatEmissiveColor; //vec3
uniform vec3 u_MatEnvMapColor; //vec3
uniform vec4 u_MatSpecColor;

#ifdef PBR
    uniform float u_Roughness; //float
    uniform float u_Metallic; //float
    uniform float u_LightRad; //float
    uniform float u_LightLength; //float
    // TODO: combine these into one
    //uniform hvec4 u_PBRParams
#endif
uniform vec3 u_ZoneMin; //vec3
uniform vec3 u_ZoneMax; //vec3
uniform vec3 u_EnvTextureIntensity; //vec3
uniform vec4 u_SinCosEnvCubeAngle; //vec4
uniform hfloat u_NearClipPS; //float
uniform hfloat u_FarClipPS; //float
uniform vec4 u_ShadowCubeAdjust;
uniform vec4 u_ShadowDepthFade;
uniform vec2 u_ShadowIntensity; //vec2
uniform vec2 u_ShadowMapInvSize; //vec2
uniform vec4 u_ShadowSplits;
uniform hmat4 u_LightMatricesPS[4];
#ifdef VSM_SHADOW
uniform vec2 u_VSMShadowParams; //vec2
#endif
uniform vec4 u_HighLightColor; //vec4
uniform float u_FresnelExpo; //float
uniform vec3 u_CloudFogColor; // vec3
uniform vec4 u_FOWAttr; // x: FOWBlend, y: FOWOpenSpeed, z: FOWBrightness
uniform vec3 u_FOWColor; // vec3
uniform vec3 u_FOWRangeColor; // vec3
uniform float u_AmbientOcclusionIntensity; // float
uniform float u_DissolveRate; // float
uniform vec3 u_LightMapScale0; // vec3
uniform vec3 u_LightMapScale1; // vec3
uniform vec4 u_LightMapDensityConsts;
uniform vec4 u_WeatherParam;
uniform vec2 u_GlobalRoughnessParam; // vec2
uniform hvec4 u_FocusClipParam; // hvec4

#define cAmbientColor u_AmbientColor
#define cCameraPosPS u_CameraPosPS
#define cDeltaTimePS u_DeltaTimePS
#define cDepthReconstruct u_DepthReconstruct
#define cElapsedTimePS u_ElapsedTimePS
#define cFogParams u_FogParams
#define cFogParams2 u_FogParams2
#define cFogColor u_FogColor
#define cGBufferInvSize u_GBufferInvSize
#define cLightColor u_LightColor
#define cLightPosPS u_LightPosPS
#define cLightDirPS u_LightDirPS
#define cNormalOffsetScalePS u_NormalOffsetScalePS
#define cMatDiffColor u_MatDiffColor
#define cMatEmissiveColor u_MatEmissiveColor
#define cMatEnvMapColor u_MatEnvMapColor
#define cMatSpecColor u_MatSpecColor
#define cRoughness u_Roughness
#define cMetallic u_Metallic
#define cLightRad u_LightRad
#define cLightLength u_LightLength
//#define cRoughness u_PBRParams.x
//#define cMetallic u_PBRParams.y
//#define cLightRad u_PBRParams.z
//#define cLightLength u_PBRParams.w
#define cZoneMin u_ZoneMin
#define cZoneMax u_ZoneMax
#define cEnvDiffTextureIntensity u_EnvTextureIntensity.x
#define cEnvSpecTextureIntensity u_EnvTextureIntensity.y
#define cWaterReflectionIntensity u_EnvTextureIntensity.z
#define cNearClipPS u_NearClipPS
#define cFarClipPS u_FarClipPS
#define cShadowCubeAdjust u_ShadowCubeAdjust
#define cShadowDepthFade u_ShadowDepthFade
#define cShadowIntensity u_ShadowIntensity
#define cShadowMapInvSize u_ShadowMapInvSize
#define cShadowSplits u_ShadowSplits
#define cLightMatricesPS u_LightMatricesPS
#define cVSMShadowParams u_VSMShadowParams
#define cHighLightColor u_HighLightColor
#define cFresnelExpo u_FresnelExpo
#define cCloudFogColor u_CloudFogColor
#define cFOWBlend u_FOWAttr.x
#define cFOWOpenSpeed u_FOWAttr.y
#define cFOWBrightness u_FOWAttr.z
#define cFOWLayer u_FOWAttr.w
#define cFOWColor u_FOWColor
#define cFOWRangeColor u_FOWRangeColor
#define cAmbientOcclusionIntensity u_AmbientOcclusionIntensity
#define _DissolveRate u_DissolveRate
#define cLightMapScale0 u_LightMapScale0
#define cLightMapScale1 u_LightMapScale1
#define cLightMapMinDensity u_LightMapDensityConsts.x
#define cLightMapMaxDensity u_LightMapDensityConsts.y
#define cLightMapIdealDensity u_LightMapDensityConsts.z
#define cLightMapResolution u_LightMapDensityConsts.w
#define cWeatherSampleLayer u_WeatherParam.x
#define cWeatherOffset u_WeatherParam.y
#define cWeatherContrast u_WeatherParam.z
#define cWeatherHeightBlend u_WeatherParam.w
#define cGlobalRoughness u_GlobalRoughnessParam.x
#define cGlobalRoughnessOn u_GlobalRoughnessParam.y
#define _FocusClipPos u_FocusClipParam.xyz
#define _CosOuterCone u_FocusClipParam.w

#endif

#if COMPILECS

uniform hvec4 u_VertexInfo1;
uniform hvec4 u_VertexInfo2;
uniform hvec4 u_VertexInfo3;
uniform vec4 u_EtcParameters_ALPHA_DISTANCE_TABLES[16];
uniform vec4 u_EtcParameters_RGB_DISTANCE_TABLES[8];

#define cVertexCount uint(u_VertexInfo1.x)
#define cVertexSize uint(u_VertexInfo1.y)
#define cMatricesOffset uint(u_VertexInfo1.z)
#define cNumMatrices uint(u_VertexInfo1.w)

#define cNumBlocks uint(u_VertexInfo2.x)
#define cIndicesOffset uint(u_VertexInfo2.y)
#define cWeightOffset uint(u_VertexInfo2.z)

#define cPositionOffset uint(u_VertexInfo3.x)
#define cNormalOffset uint(u_VertexInfo3.y)
#define cTangentOffset uint(u_VertexInfo3.z)


#endif

#endif