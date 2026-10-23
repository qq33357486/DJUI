#ifndef __SAMPLERS_SH__
#define __SAMPLERS_SH__


#ifdef COMPILEPS
SAMPLER2D(u_DiffMap, 0);
SAMPLER2DMS(u_DiffMapMS, 0);
SAMPLERCUBE(u_DiffCubeMap, 0);
SAMPLER2D(u_NormalMap, 1);
SAMPLER3D(u_LutMap3D, 1);
SAMPLER2D(u_SpecMap, 2);
SAMPLER2D(u_EmissiveMap, 3);
SAMPLER2D(u_EnvMap, 4);
SAMPLERCUBE(u_EnvCubeMap, 4);
SAMPLERCUBE(u_EnvDiffuse, 4);
SAMPLERCUBE(u_EnvSpecular, 5);

#define sDiffMap u_DiffMap
#define sDiffCubeMap u_DiffCubeMap
#define sNormalMap u_NormalMap
#define sLutMap3D u_LutMap3D
#define sSpecMap u_SpecMap
#define sEmissiveMap u_EmissiveMap
#define sEnvMap u_EnvMap
#define sEnvCubeMap u_EnvCubeMap
#define sEnvDiffuse u_EnvDiffuse
#define sEnvSpecular u_EnvSpecular

#ifndef URHO3D_MOBILE
    SAMPLER2D(u_AlbedoBuffer, 0);
    SAMPLER2D(u_NormalBuffer, 1);
    SAMPLERCUBE(u_LightCubeMap, 6);
    // SAMPLER3D(u_VolumeMap, 5);
    SAMPLER2DARRAY(u_FogOfWar, 6);
    SAMPLER2DARRAY(u_TerrainData, 7);
    SAMPLER2DARRAY(u_WeatherMap1, 7);
    // 8号被Cluster占用了，坑！
    SAMPLER2D(u_LightRampMap, 9);
    SAMPLER2D(u_LightSpotMap, 9);
    SAMPLER2DARRAY(u_WeatherMap2, 9);
    SAMPLER2D(u_LightMap, 12);
    SAMPLER2D(u_DepthBuffer, 13);
    SAMPLER2D(u_LightBuffer, 14);
    SAMPLER2D(u_AOMap, 14);

    #define sAlbedoBuffer u_AlbedoBuffer
    #define sNormalBuffer u_NormalBuffer
    #define sLightCubeMap u_LightCubeMap
    #define sVolumeMap u_VolumeMap
    #define sFogOfWar u_FogOfWar
    #define sLightRampMap u_LightRampMap
    #define sLightSpotMap u_LightSpotMap
    #define sDepthBuffer u_DepthBuffer
    #define sLightBuffer u_LightBuffer
    #define sAOMap u_AOMap
    #ifdef VSM_SHADOW
        SAMPLER2D(u_ShadowMap, 10);
    #else
        SAMPLER2DSHADOW(u_ShadowMap, 10);

    #endif
    #define sShadowMap u_ShadowMap
    #define sTerrainData u_TerrainData
    #define sLightMap u_LightMap

    SAMPLERCUBE(u_FaceSelectCubeMap, 11);
    SAMPLERCUBE(u_IndirectionCubeMap, 12);
    SAMPLERCUBE(u_ZoneCubeMap, 15);
    SAMPLER3D(u_ZoneVolumeMap, 15);
    #define sFaceSelectCubeMap u_FaceSelectCubeMap
    #define sIndirectionCubeMap u_IndirectionCubeMap
    #define sZoneCubeMap u_ZoneCubeMap
    #define sZoneVolumeMap, u_ZoneVolumeMap
#else
    SAMPLER2DARRAY(u_FogOfWar, 6);
    SAMPLER2D(u_LightRampMap, 7);
    SAMPLER2D(u_LightSpotMap, 7);
    SAMPLER2DARRAY(u_WeatherMap1, 7);
    SAMPLER2DSHADOW(u_ShadowMap, 8);
    SAMPLER2DARRAY(u_TerrainData, 9);
    SAMPLER2DARRAY(u_WeatherMap2, 9);
    SAMPLER2D(u_LightMap, 10);
    SAMPLER2D(u_AOMap, 12);

    #define sFogOfWar u_FogOfWar
    #define sLightRampMap u_LightRampMap
    #define sLightSpotMap u_LightSpotMap
    #define sShadowMap u_ShadowMap
    #define sTerrainData u_TerrainData
    #define sLightMap u_LightMap
    #define sAOMap u_AOMap
#endif

#define sTintMask u_EnvMap
#define sWeatherMap1 u_WeatherMap1
#define sWeatherMap2 u_WeatherMap2

vec3 DecodeNormal(vec4 normalInput)
{
#ifdef PACKEDNORMAL
    vec3 normal;
    normal.xy = normalInput.rg * 2.0 - 1.0;
    normal.z = sqrt(max(1.0 - dot(normal.xy, normal.xy), 0.0));
    return normal;
#else
    return normalize(normalInput.rgb * 2.0 - 1.0);
#endif
}

vec3 EncodeNormal(vec3 N)
{
	return N * 0.5 + 0.5;
}

vec3 DecodeNormal(vec3 N)
{
	return N * 2.0 - 1.0;
}

vec3 EncodeDepth(float depth)
{
    // GL3宏现在不能用，先都当成32位深度贴图了，不支持32位深度贴图的手机暂时抱歉了
    return vec3(depth, 0.0, 0.0);
    #if defined(D3D11) || defined(GL3)
        // OpenGL 3 can use different MRT formats, so no need for encoding
        return vec3(depth, 0.0, 0.0);
    #else
        vec3 ret;
        depth *= 255.0;
        ret.x = floor(depth);
        depth = (depth - ret.x) * 255.0;
        ret.y = floor(depth);
        ret.z = (depth - ret.y);
        ret.xy *= 1.0 / 255.0;
        return ret;
    #endif
}

hfloat DecodeDepth(hvec3 depth)
{
    // GL3宏现在不能用，先都当成32位深度贴图了，不支持32位深度贴图的手机暂时抱歉了
    return depth.r;
    #if defined(D3D11) || defined(GL3)
        // OpenGL 3 can use different MRT formats, so no need for encoding
        return depth.r;
    #else
        const hvec3 dotValues = hvec3_init(1.0, 1.0 / 255.0, 1.0 / (255.0 * 255.0));
        return dot(depth, dotValues);
    #endif
}

hfloat ReconstructDepth(hfloat hwDepth)
{
    return dot(hvec2_init(hwDepth, cDepthReconstruct.y / (hwDepth - cDepthReconstruct.x)), cDepthReconstruct.zw);
}

vec3 Desaturation(vec3 inColor)
{
    float temp = dot(inColor, vec3(0.3, 0.59, 0.11));
    return vec3(temp, temp, temp);
}

#define saturate(data) clamp(data, 0.0, 1.0)

float Fresnel(vec4 worldPos, vec3 normal, float exponent)
{
	vec3 eyeVec = cCameraPosPS - worldPos.xyz;
	return pow(1.0 - clamp(dot(normal, eyeVec), 0.0, 1.0), exponent);
}

#endif

// 目前不需要反GAMMA,输入要么是线性的要么是纹理改成了srgb格式的
/*#define GAMMA_ENABLE
#ifdef GAMMA_ENABLE
    vec4 LinearColor(vec4 color)
    {
        return vec4(pow(color.r, 2.2), pow(color.g, 2.2), pow(color.b, 2.2), color.a);
    }
    vec4 LinearColorAlpha(vec4 color)
    {
        return vec4(pow(color.r,2.2), pow(color.g, 2.2), pow(color.b, 2.2), color.a);
    }
#else*/
    vec4 LinearColor(vec4 color)
    {
        return color;
    }

    vec4 LinearColorAlpha(vec4 color)
    {
        return color;
    }
//#endif

// 拟合函数，用于提高性能
float GammaToLinearSpaceExact(float value)
{
    if (value <= 0.04045f)
        return value / 12.92f;
    else if (value < 1.0f)
        return pow((value + 0.055f)/1.055f, 2.4f);
    else
        return pow(value, 2.2f);
}

float LinearToGammaSpaceExact(float value)
{
    if (value <= 0.0f)
        return 0.0f;
    else if (value <= 0.0031308f)
        return 12.92f * value;
    else if (value < 1.0f)
        return 1.055f * pow(value, 0.4166667f) - 0.055f;
    else
        return pow(value, 0.45454545f);
}

vec3 GammaToLinearSpace(vec3 sRGB)
{
    // Approximate version from http://chilliant.blogspot.com.au/2012/08/srgb-approximations-for-hlsl.html?m=1
    return sRGB * (sRGB * (sRGB * 0.305306011f + 0.682171111f) + 0.012522878f);

    // Precise version, useful for debugging.
    //return vec3(GammaToLinearSpaceExact(sRGB.r), GammaToLinearSpaceExact(sRGB.g), GammaToLinearSpaceExact(sRGB.b));
}

vec4 GammaToLinearSpace(vec4 sRGB)
{
    return vec4(GammaToLinearSpace(sRGB.rgb), sRGB.a);
}


vec3 LinearToGammaSpace(vec3 linRGB)
{
    linRGB = max(linRGB, vec3(0.f, 0.f, 0.f));
    // An almost-perfect approximation from http://chilliant.blogspot.com.au/2012/08/srgb-approximations-for-hlsl.html?m=1
    return max(1.055f * pow(linRGB, vec3_splat(0.416666667f)) - 0.055f, 0.f);

    // Exact version, useful for debugging.
    //return vec3(LinearToGammaSpaceExact(linRGB.r), LinearToGammaSpaceExact(linRGB.g), LinearToGammaSpaceExact(linRGB.b));
}

vec4 LinearToGammaSpace(vec4 linRGB)
{
    return vec4(LinearToGammaSpace(linRGB.rgb), linRGB.a);
}


#endif
