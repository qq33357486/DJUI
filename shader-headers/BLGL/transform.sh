#ifndef __TRANSFORM_SH__
#define __TRANSFORM_SH__

#if BGFX_SHADER_LANGUAGE_METAL || BGFX_SHADER_LANGUAGE_HLSL
    #define TR(_mat) transpose(_mat)
#else
    #define TR(_mat) _mat
#endif

#if COMPILEVS
#include "CEGPAnimation.glsl"
#include "SkinMatricesTexture.glsl"
#include "CEGAnimation.glsl"



vec2 GetTexCoord(hvec2 texCoord)
{
    return vec2(dot(texCoord, cUOffset.xy) + cUOffset.w, dot(texCoord, cVOffset.xy) + cVOffset.w);
}

hvec4 GetClipPos(hvec3 worldPos)
{
    hvec4 ret = mul(mul(hvec4_init(worldPos, 1.0),u_view), u_proj); //mul(vec4(worldPos, 1.0), cViewProj);
    // While getting the clip coordinate, also automatically set gl_ClipVertex for user clip planes
    #ifdef CLIPPLANE
    #if !defined(GL_ES) && !defined(GL3) && !defined(D3D11)
        gl_ClipVertex = ret;
    #elif defined(GL3)
        gl_ClipDistance[0] = dot(cClipPlane, ret);
    #elif defined(D3D11)
        //vClip = dot(ret, cClipPlane);
    #endif
    #endif
    return ret;
}

float GetZonePos(hvec3 worldPos)
{
    return clamp(mul(vec4(worldPos, 1.0), cZone).z, 0.0, 1.0);
}

hfloat GetDepth(hvec4 clipPos)
{
    return dot(clipPos.zw, cDepthMode.zw);
}

#ifdef BILLBOARD
hvec3 GetBillboardPos(hvec4 iPos, hvec2 iSize, hmat4 modelMatrix)
{
    return mul(iPos, modelMatrix).xyz + mul(hvec3_init(iSize.x, iSize.y, 0.0), cBillboardRot);
}

hvec3 GetBillboardNormal()
{
    return hvec3_init(-cBillboardRot[0][2], -cBillboardRot[1][2], -cBillboardRot[2][2]);
}
#endif

#ifdef DIRBILLBOARD
hmat3 GetFaceCameraRotation(hvec3 position, hvec3 direction)
{
    hvec3 cameraDir = normalize(position - cCameraPos);
    hvec3 front = normalize(direction);
    hvec3 right = normalize(cross(front, cameraDir));
    hvec3 up = normalize(cross(front, right));

    return TR(hmat3_init(
        right.x, up.x, front.x,
        right.y, up.y, front.y,
        right.z, up.z, front.z
    ));
}

hvec3 GetBillboardPos(hvec4 iPos, hvec3 iDirection, hmat4 modelMatrix)
{
    hvec3 worldPos = mul(iPos, modelMatrix).xyz;
    return worldPos + mul(hvec3_init(iTexCoord1.x, 0.0, iTexCoord1.y), GetFaceCameraRotation(worldPos, iDirection));
}

hvec3 GetBillboardNormal(hvec4 iPos, hvec3 iDirection, hmat4 modelMatrix)
{
    hvec3 worldPos = mul(iPos, modelMatrix).xyz;
    return mul(hvec3_init(0.0, 1.0, 0.0), GetFaceCameraRotation(worldPos, iDirection));
}
#endif

#ifdef TRAILFACECAM
hvec3 GetTrailPos(hvec4 iPos, hvec3 iFront, hfloat iScale, hmat4 modelMatrix)
{
    hvec3 worldPos = mul(iPos, modelMatrix).xyz;
    hvec3 up = normalize(cCameraPos - worldPos);
    hvec3 front = mul(hvec4_init(iFront, 0.0), modelMatrix).xyz;
    hvec3 right = normalize(cross(front, up));
    // scale提前算过世界缩放了
    return worldPos + right * iScale;
}

hvec3 GetTrailNormal(hvec4 iPos, hmat4 modelMatrix)
{
    hvec3 worldPos = mul(iPos, modelMatrix).xyz;
    return normalize(cCameraPos - worldPos);
}
#endif

#ifdef TRAILBONE
hvec3 GetTrailPos(hvec4 iPos, hvec3 iParentPos, hfloat iScale, hmat4 modelMatrix)
{
    hvec3 right = iParentPos - iPos.xyz;
    return (mul(hvec4_init((iPos.xyz + right * iScale), 1.0), modelMatrix)).xyz;
}

hvec3 GetTrailNormal(hvec4 iPos, hvec3 iParentPos, hvec3 iForward)
{
    hvec3 left = normalize(iPos.xyz - iParentPos);
    hvec3 up = normalize(cross(normalize(iForward), left));
    return up;
}
#endif

#if defined(SKINNED)
    #define iModelMatrix mul(a_weight.x, u_model[int(a_indices.x)]) + \
                         mul(a_weight.y, u_model[int(a_indices.y)]) + \
                         mul(a_weight.z, u_model[int(a_indices.z)]) + \
                         mul(a_weight.w, u_model[int(a_indices.w)])
#elif defined(SKINNED_CS)
    #define iModelMatrix TR(mat4(vec4(1.0, 0.0, 0.0, 0.0), vec4(0.0, 1.0, 0.0, 0.0), vec4(0.0, 0.0, 1.0, 0.0), vec4(0.0, 0.0, 0.0, 1.0)))
#elif defined(INSTANCED) && !defined(CEGP_ANIMATION) && !defined(SKIN_MATRIX_TEXTURE)
    #define iModelMatrix TR(mat4(i_data0, i_data1, i_data2, vec4(0.0, 0.0, 0.0, 1.0)))
#elif defined(SKIN_MATRIX_TEXTURE)
    #define iModelMatrix TR(GetSkinMatrixFromTexture(iBlendWeights, iBlendIndices))
#elif defined(CEG_ANIMATION)
    #define iModelMatrix mul(GetSkinMatrixFromAnimationTexture(iBlendWeights, iBlendIndices),cModel)
#elif defined(CEGP_ANIMATION)
    #define iModelMatrix mul(TR(GetSkinMatrixFromCEGPTexture(iBlendWeights, iBlendIndices)),TR(GetCEGPWorldTransform()))
#else
    #define iModelMatrix cModel
#endif

#if defined(BILLBOARD)
    #define GetWorldPos(modelMatrix) GetBillboardPos(iPos, iSize, modelMatrix)
#elif defined(DIRBILLBOARD)
    #define GetWorldPos(modelMatrix) GetBillboardPos(iPos, iNormal, modelMatrix)
#elif defined(TRAILFACECAM)
    #define GetWorldPos(modelMatrix) GetTrailPos(iPos, iTangent.xyz, iTangent.w, modelMatrix)
#elif defined(TRAILBONE)
    #define GetWorldPos(modelMatrix) GetTrailPos(iPos, iTangent.xyz, iTangent.w, modelMatrix)
#else
    #define GetWorldPos(modelMatrix) mul(iPos, modelMatrix).xyz
#endif

#if defined(BILLBOARD)
    #define GetWorldNormal(modelMatrix) GetBillboardNormal()
#elif defined(DIRBILLBOARD)
    #define GetWorldNormal(modelMatrix) GetBillboardNormal(iPos, iNormal, modelMatrix)
#elif defined(TRAILFACECAM)
    #define GetWorldNormal(modelMatrix) GetTrailNormal(iPos, modelMatrix)
#elif defined(TRAILBONE)
    #define GetWorldNormal(modelMatrix) GetTrailNormal(iPos, iTangent.xyz, iNormal)
#else
    #define GetWorldNormal(modelMatrix) normalize(mul(vec4(iNormal.xyz, 0.0), modelMatrix).xyz)
#endif

#if defined(BILLBOARD)
    #define GetWorldTangent(modelMatrix) vec4(normalize(mul(vec3(1.0, 0.0, 0.0), cBillboardRot)), 1.0)
#elif defined(DIRBILLBOARD)
    #define GetWorldTangent(modelMatrix) vec4(normalize(mul(vec3(1.0, 0.0, 0.0), GetNormalMatrix(modelMatrix))), 1.0)
#else
    #define GetWorldTangent(modelMatrix) vec4(normalize(mul(vec4(iTangent.xyz, 0.0), modelMatrix).xyz), iTangent.w)
#endif

#if defined(SKINNED)
    #define iNodePosition cNodePosition
    #define iGroundZ cGroundZ
    #define iBBoxMaxZ cBBoxMaxZ
    #define iBBoxMinZ cBBoxMinZ
    #define iObjectType cObjectType
    #define iLightMapBias cLightMapBias
#elif defined(CEGP_ANIMATION)
    #error
#elif defined(INSTANCED)
    #define iNodePosition hvec3_init(i_data0.w, i_data1.w, i_data2.w)
    #define iGroundZ i_data3.x
    #define iBBoxMaxZ i_data3.y
    #define iBBoxMinZ i_data3.z
    #define iObjectType i_data3.w
    #define iLightMapBias i_data4
#else
    #define iNodePosition cNodePosition
    #define iGroundZ cGroundZ
    #define iBBoxMaxZ cBBoxMaxZ
    #define iBBoxMinZ cBBoxMinZ
    #define iObjectType cObjectType
    #define iLightMapBias cLightMapBias
#endif

// 高亮pass
#define iHighlightColor hvec4_init(iGroundZ, iBBoxMaxZ, iBBoxMinZ, iObjectType)

// 描边pass
#define iStrokeColor hvec4_init(iGroundZ, iBBoxMaxZ, iBBoxMinZ, iObjectType)

// 描边厚度
#define iStrokeThickness iLightMapBias.x

#endif

hfloat LinearizeDepth(hfloat depth, hfloat zNear, hfloat zFar)
{
#if BGFX_SHADER_LANGUAGE_GLSL || BGFX_SHADER_LANGUAGE_GLSL_HLSLCC
    hfloat z_n = 2.0 * depth - 1.0;
    hfloat linearDepth = 2.0 * zNear * zFar / (zFar + zNear - z_n * (zFar - zNear));
    return linearDepth;
#else
    hfloat linearDepth = zNear * zFar / (zFar - depth * (zFar - zNear));
    return linearDepth;
#endif
}

#endif