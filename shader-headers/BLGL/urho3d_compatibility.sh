#ifndef __URHO3D_COMPATIBILITY_SH__
#define __URHO3D_COMPATIBILITY_SH__

#if !defined(BILLBOARD) && !defined(TRAILFACECAM) && !defined(BASIC)
#define _NORMAL , a_normal
#elif defined(BASIC) && (defined(DIRBILLBOARD) || defined(TRAILBONE))
#define _NORMAL , a_normal
#else
#define _NORMAL
#endif

#if !defined(NOUV) && !defined(BASIC)
#define _TEXCOORD0 , a_texcoord0
#define _VTEXCOORD , vTexCoord
#elif defined(BASIC) && (defined(DIFFMAP) || defined(ALPHAMAP))
#define _TEXCOORD0 , a_texcoord0
#define _VTEXCOORD , vTexCoord
#else
#define _TEXCOORD0
#define _VTEXCOORD
#endif

#ifdef VERTEXCOLOR
#define _COLOR0 , a_color0
#define _VCOLOR , vColor
#elif defined(VERTEX_ANIMATION)
#define _COLOR0 , a_color0
#define _VCOLOR
#else
#define _COLOR0
#define _VCOLOR
#endif

#if (defined(NORMALMAP) || defined(TRAILFACECAM) || defined(TRAILBONE)) && !defined(BILLBOARD) && !defined(DIRBILLBOARD)
#define _ATANGENT , a_tangent
#else
#define _ATANGENT
#endif

#if defined(LIGHTMAP) || defined(AO) || defined(BILLBOARD) || defined(DIRBILLBOARD) || (defined(BASIC) && defined(MASK))
#define _TEXCOORD1 , a_texcoord1
#else
#define _TEXCOORD1
#endif

#if defined(DISSOLVE) || defined(PLANESOFTPARTICLE)
#define _TEXCOORD2 , a_texcoord2
#else 
#define _TEXCOORD2
#endif

#if defined(SKINNED) || defined(SKIN_MATRIX_TEXTURE) || defined(CEG_ANIMATION) || defined(CEGP_ANIMATION)
#define _SKINNED , a_weight, a_indices
#else
#define _SKINNED
#endif

#ifdef INSTANCED
    #if !defined(CEGP_ANIMATION) && !defined(LIGHTMAP) && !defined(INSTANCED_STROKE_THICKNESS)
        #define _INSTANCED , i_data0, i_data1, i_data2
        #define _INSTANCED_EXTRA1 , i_data3
        #define _INSTANCED_EXTRA2
    #else
        #define _INSTANCED , i_data0, i_data1, i_data2
        #define _INSTANCED_EXTRA1 , i_data3
        #define _INSTANCED_EXTRA2 , i_data4
    #endif
    #if defined(SKIN_MATRIX_TEXTURE)
        #define _INSTANCED_EXTRA3 , i_data5
    #else
        #define _INSTANCED_EXTRA3
    #endif
#else
    #define _INSTANCED
    #define _INSTANCED_EXTRA1
    #define _INSTANCED_EXTRA2
    #define _INSTANCED_EXTRA3
#endif

#if defined(DIRLIGHT) && (!defined(URHO3D_MOBILE) || defined(WEBGL))
#define _NUMCASCADES 4
#else
#define _NUMCASCADES 1
#endif

#ifdef NORMALMAP
#define _VTANGENT , vTangent
#else
#define _VTANGENT
#endif


#ifdef SHADOW
#if defined(DIRLIGHT) && (!defined(URHO3D_MOBILE) || defined(WEBGL))
#define _VSHADOWPOS , vShadowPos0, vShadowPos1, vShadowPos2, vShadowPos3
#define vShadowPos vShadowPos0, vShadowPos1, vShadowPos2, vShadowPos3
#else
#define _VSHADOWPOS , vShadowPos0
#define vShadowPos vShadowPos0
#endif
#else
#define _VSHADOWPOS
#endif

#ifdef SPOTLIGHT
#define _VSPOTPOS , vSpotPos
#else
#define _VSPOTPOS
#endif

#ifdef POINTLIGHT
#define _VCUBEMASKVEC , vCubeMaskVec
#else
#define _VCUBEMASKVEC
#endif

#ifdef ENVCUBEMAP
#define _VREFLECTIONVEC , vReflectionVec
#else
#define _VREFLECTIONVEC
#endif

#if defined(LIGHTMAP) || defined(AO) || (defined(BASIC) && defined(MASK))
#define _VTEXCOORD2 , vTexCoord2
#else
#define _VTEXCOORD2
#endif

#if defined(NO_SPEC_UV_ANIMATION)
#define _VTEXCOORD3 , vTexCoord3
#else
#define _VTEXCOORD3
#endif

#if defined(PLANT_ANIMATION)
#define _VPLANTMASK , vPlantMask
#else
#define _VPLANTMASK
#endif

#if defined(LIGHTMAP)
#define _VLIGHTMAPUV , vLightMapUV
#else
#define _VLIGHTMAPUV
#endif

#ifdef ORTHO
#define _VNEARRAY , vNearRay
#else
#define _VNEARRAY
#endif

#if defined(SOFTPARTICLES) || defined(UE3SOFTPARTICLE) || (defined(BASIC) && defined(ROUND))
#define _VSCREENPOS , vScreenPos
#else
#define _VSCREENPOS
#endif

#ifdef CLIPPLANE
#define _VCLIP //, vClip
#else
#define _VCLIP
#endif

#ifdef SPEED_TREE
//#define _OBJECTPOS , a_objectpos
#define _OBJECTPOS
#else
#define _OBJECTPOS
#endif

#if defined(BLEND1)
#define _BLEND , vBlend1Idx
#elif defined(BLEND2)
#define _BLEND , vBlend2, vBlendUV2
#elif defined(BLEND3)
#define _BLEND , vBlend3, vBlendUV2, vBlendUV3
#elif defined(BLEND9)
#define _BLEND , vBlend3, vBlend3_1, vBlend3_2, vBlendUV2, vBlendUV3, vBlendUV4, vBlendUV5, vBlendUV6, vBlendUV7, vBlendUV8, vBlendUV9
#elif defined(CLIFF1)
#define _BLEND , vBlendUV2 , vBlendCliff2
#elif defined(CLIFF2)
#define _BLEND , vBlendUV2 , vBlendUV3, vBlendCliff2
#else
#define _BLEND
#endif

#if defined(AO) && !defined(CLOSE_AO)
#define _AOUV , vAOUV
#else
#define _AOUV
#endif


// #define CLUSTER_VS //for test
#if defined(CLUSTER_VS)
#define _VCLUSTERVS , vVecIrrR, vVecIrrG, vMrpDir, vMrp
#else
#define _VCLUSTERVS
#endif

#define iPos a_position
#define iNormal a_normal
#define iTexCoord a_texcoord0
#define iColor a_color0
#define iColor2 a_color1
#define iColor3 a_color2
#define iColor4 a_color3
#define iTexCoord1 a_texcoord1
#define iTangent a_tangent
#define iBlendWeights a_weight
#define iBlendIndices a_indices
#define iSize a_texcoord1
#define iTexCoord4 i_data0
#define iTexCoord5 i_data1
#define iTexCoord6 i_data2
#define iObjectIndex i_data3
#define iTexCoord7 i_data4
#endif