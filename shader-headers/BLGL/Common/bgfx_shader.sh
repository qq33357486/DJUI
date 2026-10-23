/*
 * Copyright 2011-2020 Branimir Karadzic. All rights reserved.
 * License: https://github.com/bkaradzic/bgfx#license-bsd-2-clause
 */

#ifndef BGFX_SHADER_H_HEADER_GUARD
#define BGFX_SHADER_H_HEADER_GUARD

#if !defined(BGFX_CONFIG_MAX_BONES)
#	define BGFX_CONFIG_MAX_BONES 32
#endif // !defined(BGFX_CONFIG_MAX_BONES)

#ifndef __cplusplus

	#if BGFX_SHADER_LANGUAGE_HLSL > 300
	#	define BRANCH [branch]
	#	define LOOP   [loop]
	#	define UNROLL [unroll]
	#else
	#	define BRANCH
	#	define LOOP
	#	define UNROLL
	#endif // BGFX_SHADER_LANGUAGE_HLSL > 300

	#if BGFX_SHADER_LANGUAGE_HLSL > 300 && BGFX_SHADER_TYPE_FRAGMENT
	#	define EARLY_DEPTH_STENCIL [earlydepthstencil]
	#else
	#	define EARLY_DEPTH_STENCIL
	#endif // BGFX_SHADER_LANGUAGE_HLSL > 300 && BGFX_SHADER_TYPE_FRAGMENT

	#if BGFX_SHADER_LANGUAGE_GLSL
	#	define ARRAY_BEGIN(_type, _name, _count) _type _name[_count] = _type[](
	#	define ARRAY_END() )
	#else
	#	define ARRAY_BEGIN(_type, _name, _count) _type _name[_count] = {
	#	define ARRAY_END() }
	#endif // BGFX_SHADER_LANGUAGE_GLSL

	vec2 vec2_splat(float _x) { return vec2(_x, _x); }
	vec3 vec3_splat(float _x) { return vec3(_x, _x, _x); }
	vec4 vec4_splat(float _x) { return vec4(_x, _x, _x, _x); }

	#if BGFX_SHADER_LANGUAGE_GLSL >= 130 || BGFX_SHADER_LANGUAGE_HLSL || BGFX_SHADER_LANGUAGE_PSSL || BGFX_SHADER_LANGUAGE_SPIRV || BGFX_SHADER_LANGUAGE_METAL
		uvec2 uvec2_splat(uint _x) { return uvec2(_x, _x); }
		uvec3 uvec3_splat(uint _x) { return uvec3(_x, _x, _x); }
		uvec4 uvec4_splat(uint _x) { return uvec4(_x, _x, _x, _x); }
	#endif // BGFX_SHADER_LANGUAGE_GLSL >= 130 || BGFX_SHADER_LANGUAGE_HLSL || BGFX_SHADER_LANGUAGE_PSSL || BGFX_SHADER_LANGUAGE_SPIRV || BGFX_SHADER_LANGUAGE_METAL

	#if BGFX_SHADER_LANGUAGE_HLSL \
	 || BGFX_SHADER_LANGUAGE_PSSL \
	 || BGFX_SHADER_LANGUAGE_SPIRV \
	 || BGFX_SHADER_LANGUAGE_METAL
		#	define CONST(_x) static const _x
		#	define dFdx(_x) ddx(_x)
		#	define dFdy(_y) ddy(-_y)
		#	define inversesqrt(_x) rsqrt(_x)
		#	define fract(_x) frac(_x)

		#	define bvec2 bool2
		#	define bvec3 bool3
		#	define bvec4 bool4

		#	if BGFX_SHADER_LANGUAGE_HLSL > 400
		#		define REGISTER(_type, _reg) register(_type[_reg])
		#	else
		#		define REGISTER(_type, _reg) register(_type ## _reg)
		#	endif // BGFX_SHADER_LANGUAGE_HLSL

		#	if BGFX_SHADER_LANGUAGE_HLSL > 300 || BGFX_SHADER_LANGUAGE_PSSL || BGFX_SHADER_LANGUAGE_SPIRV || BGFX_SHADER_LANGUAGE_METAL
			#		if BGFX_SHADER_LANGUAGE_HLSL > 400 || BGFX_SHADER_LANGUAGE_PSSL || BGFX_SHADER_LANGUAGE_SPIRV || BGFX_SHADER_LANGUAGE_METAL
			#			define dFdxCoarse(_x) ddx_coarse(_x)
			#			define dFdxFine(_x)   ddx_fine(_x)
			#			define dFdyCoarse(_y) ddy_coarse(-_y)
			#			define dFdyFine(_y)   ddy_fine(-_y)
			#		endif // BGFX_SHADER_LANGUAGE_HLSL > 400

			#		if BGFX_SHADER_LANGUAGE_HLSL || BGFX_SHADER_LANGUAGE_SPIRV || BGFX_SHADER_LANGUAGE_METAL
				hfloat intBitsToFloat(int   _x) { return asfloat(_x); }
				hvec2  intBitsToFloat(uint2 _x) { return asfloat(_x); }
				hvec3  intBitsToFloat(uint3 _x) { return asfloat(_x); }
				hvec4  intBitsToFloat(uint4 _x) { return asfloat(_x); }


			#		endif // BGFX_SHADER_LANGUAGE_HLSL || BGFX_SHADER_LANGUAGE_SPIRV || BGFX_SHADER_LANGUAGE_METAL

			hfloat uintBitsToFloat(uint  _x) { return asfloat(_x); }
			hvec2  uintBitsToFloat(uint2 _x) { return asfloat(_x); }
			hvec3  uintBitsToFloat(uint3 _x) { return asfloat(_x); }
			hvec4  uintBitsToFloat(uint4 _x) { return asfloat(_x); }

			uint  floatBitsToUint(hfloat _x) { return asuint(_x); }
			uvec2 floatBitsToUint(hvec2  _x) { return asuint(_x); }
			uvec3 floatBitsToUint(hvec3  _x) { return asuint(_x); }
			uvec4 floatBitsToUint(hvec4  _x) { return asuint(_x); }

			int   floatBitsToInt(hfloat _x) { return asint(_x); }
			ivec2 floatBitsToInt(hvec2  _x) { return asint(_x); }
			ivec3 floatBitsToInt(hvec3  _x) { return asint(_x); }
			ivec4 floatBitsToInt(hvec4  _x) { return asint(_x); }

			uint  bitfieldReverse(uint  _x) { return reversebits(_x); }
			uint2 bitfieldReverse(uint2 _x) { return reversebits(_x); }
			uint3 bitfieldReverse(uint3 _x) { return reversebits(_x); }
			uint4 bitfieldReverse(uint4 _x) { return reversebits(_x); }

			#		if !BGFX_SHADER_LANGUAGE_SPIRV
				uint packHalf2x16(vec2 _x)
				{
					return (f32tof16(_x.y)<<16) | f32tof16(_x.x);
				}

				vec2 unpackHalf2x16(uint _x)
				{
					return vec2(f16tof32(_x & 0xffff), f16tof32(_x >> 16) );
				}
			#		endif // !BGFX_SHADER_LANGUAGE_SPIRV

			struct BgfxSampler2D
			{
				SamplerState m_sampler;
				Texture2D m_texture;
			};

			struct BgfxISampler2D
			{
				Texture2D<ivec4> m_texture;
			};

			struct BgfxUSampler2D
			{
				Texture2D<uvec4> m_texture;
			};

			struct BgfxSampler2DArray
			{
				SamplerState m_sampler;
				Texture2DArray m_texture;
			};

			struct BgfxSampler2DShadow
			{
				SamplerComparisonState m_sampler;
				Texture2D m_texture;
			};

			struct BgfxSampler2DArrayShadow
			{
				SamplerComparisonState m_sampler;
				Texture2DArray m_texture;
			};

			struct BgfxSampler3D
			{
				SamplerState m_sampler;
				Texture3D m_texture;
			};

			struct BgfxISampler3D
			{
				Texture3D<ivec4> m_texture;
			};

			struct BgfxUSampler3D
			{
				Texture3D<uvec4> m_texture;
			};

			struct BgfxSamplerCube
			{
				SamplerState m_sampler;
				TextureCube m_texture;
			};

			struct BgfxSamplerCubeShadow
			{
				SamplerComparisonState m_sampler;
				TextureCube m_texture;
			};

			struct BgfxSampler2DMS
			{
				Texture2DMS<hvec4> m_texture;
			};

			hvec4 bgfxTexture2D(BgfxSampler2D _sampler, vec2 _coord)
			{
				return _sampler.m_texture.Sample(_sampler.m_sampler, _coord);
			}

			hvec4 bgfxTexture2DBias(BgfxSampler2D _sampler, vec2 _coord, float _bias)
			{
				return _sampler.m_texture.SampleBias(_sampler.m_sampler, _coord, _bias);
			}

			hvec4 bgfxTexture2DLod(BgfxSampler2D _sampler, vec2 _coord, float _level)
			{
				return _sampler.m_texture.SampleLevel(_sampler.m_sampler, _coord, _level);
			}

			hvec4 bgfxTexture2DLodOffset(BgfxSampler2D _sampler, vec2 _coord, float _level, ivec2 _offset)
			{
				return _sampler.m_texture.SampleLevel(_sampler.m_sampler, _coord, _level, _offset);
			}

			hvec4 bgfxTexture2DProj(BgfxSampler2D _sampler, vec3 _coord)
			{
				vec2 coord = _coord.xy * vec2_splat(rcp(_coord.z));
				return _sampler.m_texture.Sample(_sampler.m_sampler, coord);
			}

			hvec4 bgfxTexture2DProj(BgfxSampler2D _sampler, vec4 _coord)
			{
				vec2 coord = _coord.xy * vec2_splat(rcp(_coord.w));
				return _sampler.m_texture.Sample(_sampler.m_sampler, coord);
			}

			hvec4 bgfxTexture2DGrad(BgfxSampler2D _sampler, vec2 _coord, vec2 _dPdx, vec2 _dPdy)
			{
				return _sampler.m_texture.SampleGrad(_sampler.m_sampler, _coord, _dPdx, _dPdy);
			}

			hvec4 bgfxTexture2DArray(BgfxSampler2DArray _sampler, vec3 _coord)
			{
				return _sampler.m_texture.Sample(_sampler.m_sampler, _coord);
			}

			hvec4 bgfxTexture2DArrayLod(BgfxSampler2DArray _sampler, vec3 _coord, float _lod)
			{
				return _sampler.m_texture.SampleLevel(_sampler.m_sampler, _coord, _lod);
			}

			hvec4 bgfxTexture2DArrayLodOffset(BgfxSampler2DArray _sampler, vec3 _coord, float _level, ivec2 _offset)
			{
				return _sampler.m_texture.SampleLevel(_sampler.m_sampler, _coord, _level, _offset);
			}

			hfloat bgfxShadow2D(BgfxSampler2DShadow _sampler, vec3 _coord)
			{
				return _sampler.m_texture.SampleCmpLevelZero(_sampler.m_sampler, _coord.xy, _coord.z);
			}

			hfloat bgfxShadow2DProj(BgfxSampler2DShadow _sampler, hvec4 _coord)
			{
			// 对于平行光：w一定是1.0，所以没必要在除一下
			#ifdef DIRLIGHT
				return _sampler.m_texture.SampleCmpLevelZero(_sampler.m_sampler, _coord.xy, _coord.z);
			#else
				hvec3 coord = _coord.xyz * vec3_splat(rcp(_coord.w));
				return _sampler.m_texture.SampleCmpLevelZero(_sampler.m_sampler, coord.xy, coord.z);
			#endif
			}

			hvec4 bgfxShadow2DArray(BgfxSampler2DArrayShadow _sampler, vec4 _coord)
			{
				return _sampler.m_texture.SampleCmpLevelZero(_sampler.m_sampler, _coord.xyz, _coord.w);
			}

			hvec4 bgfxTexture3D(BgfxSampler3D _sampler, vec3 _coord)
			{
				return _sampler.m_texture.Sample(_sampler.m_sampler, _coord);
			}

			hvec4 bgfxTexture3DLod(BgfxSampler3D _sampler, vec3 _coord, float _level)
			{
				return _sampler.m_texture.SampleLevel(_sampler.m_sampler, _coord, _level);
			}

			ivec4 bgfxTexture3D(BgfxISampler3D _sampler, hvec3 _coord)
			{
				uvec3 size;
				_sampler.m_texture.GetDimensions(size.x, size.y, size.z);
				return _sampler.m_texture.Load(ivec4(_coord * size, 0) );
			}

			uvec4 bgfxTexture3D(BgfxUSampler3D _sampler, hvec3 _coord)
			{
				uvec3 size;
				_sampler.m_texture.GetDimensions(size.x, size.y, size.z);
				return _sampler.m_texture.Load(ivec4(_coord * size, 0) );
			}

			hvec4 bgfxTextureCube(BgfxSamplerCube _sampler, hvec3 _coord)
			{
				return _sampler.m_texture.Sample(_sampler.m_sampler, _coord);
			}

			hvec4 bgfxTextureCubeBias(BgfxSamplerCube _sampler, hvec3 _coord, hfloat _bias)
			{
				return _sampler.m_texture.SampleBias(_sampler.m_sampler, _coord, _bias);
			}

			hvec4 bgfxTextureCubeLod(BgfxSamplerCube _sampler, hvec3 _coord, hfloat _level)
			{
				return _sampler.m_texture.SampleLevel(_sampler.m_sampler, _coord, _level);
			}

			hfloat bgfxShadowCube(BgfxSamplerCubeShadow _sampler, hvec4 _coord)
			{
				return _sampler.m_texture.SampleCmpLevelZero(_sampler.m_sampler, _coord.xyz, _coord.w);
			}

			hvec4 bgfxTexelFetch(BgfxSampler2D _sampler, ivec2 _coord, int _lod)
			{
				return _sampler.m_texture.Load(ivec3(_coord, _lod) );
			}

			hvec4 bgfxTexelFetchOffset(BgfxSampler2D _sampler, ivec2 _coord, int _lod, ivec2 _offset)
			{
				return _sampler.m_texture.Load(ivec3(_coord, _lod), _offset );
			}

			vec2 bgfxTextureSize(BgfxSampler2D _sampler, int _lod)
			{
				vec2 result;
				_sampler.m_texture.GetDimensions(result.x, result.y);
				return result;
			}

			hvec4 bgfxTextureGather(BgfxSampler2D _sampler, vec2 _coord)
			{
				return _sampler.m_texture.GatherRed(_sampler.m_sampler, _coord );
			}
			hvec4 bgfxTextureGatherOffset(BgfxSampler2D _sampler, vec2 _coord, ivec2 _offset)
			{
				return _sampler.m_texture.GatherRed(_sampler.m_sampler, _coord, _offset );
			}
			hvec4 bgfxTextureGather(BgfxSampler2DArray _sampler, vec3 _coord)
			{
				return _sampler.m_texture.GatherRed(_sampler.m_sampler, _coord );
			}
			hvec4 bgfxTextureGatherRed(BgfxSampler2D _sampler, vec2 _coord)
			{
				return _sampler.m_texture.GatherRed(_sampler.m_sampler, _coord );
			}
			hvec4 bgfxTextureGatherGreen(BgfxSampler2D _sampler, vec2 _coord)
			{
				return _sampler.m_texture.GatherGreen(_sampler.m_sampler, _coord );
			}
			hvec4 bgfxTextureGatherBlue(BgfxSampler2D _sampler, vec2 _coord)
			{
				return _sampler.m_texture.GatherBlue(_sampler.m_sampler, _coord );
			}

			ivec4 bgfxTexelFetch(BgfxISampler2D _sampler, ivec2 _coord, int _lod)
			{
				return _sampler.m_texture.Load(ivec3(_coord, _lod) );
			}

			uvec4 bgfxTexelFetch(BgfxUSampler2D _sampler, ivec2 _coord, int _lod)
			{
				return _sampler.m_texture.Load(ivec3(_coord, _lod) );
			}

			hvec4 bgfxTexelFetch(BgfxSampler2DMS _sampler, ivec2 _coord, int _sampleIdx)
			{
				return _sampler.m_texture.Load(_coord, _sampleIdx);
			}

			hvec4 bgfxTexelFetch(BgfxSampler2DArray _sampler, ivec3 _coord, int _lod)
			{
				return _sampler.m_texture.Load(ivec4(_coord, _lod) );
			}

			hvec4 bgfxTexelFetch(BgfxSampler3D _sampler, ivec3 _coord, int _lod)
			{
				return _sampler.m_texture.Load(ivec4(_coord, _lod) );
			}

			vec3 bgfxTextureSize(BgfxSampler3D _sampler, int _lod)
			{
				vec3 result;
				_sampler.m_texture.GetDimensions(result.x, result.y, result.z);
				return result;
			}

			#		define SAMPLER2D(_name, _reg) \
						uniform SamplerState _name ## Sampler : REGISTER(s, _reg); \
						uniform Texture2D _name ## Texture : REGISTER(t, _reg); \
						static BgfxSampler2D _name = { _name ## Sampler, _name ## Texture }
			#		define SAMPLER2DEX(_name, _reg, _texname) \
						uniform SamplerState _name ## Sampler : REGISTER(s, _reg); \
						static BgfxSampler2D _name = { _name ## Sampler, _texname ## Texture }
			#		define ISAMPLER2D(_name, _reg) \
						uniform Texture2D<ivec4> _name ## Texture : REGISTER(t, _reg); \
						static BgfxISampler2D _name = { _name ## Texture }
			#		define USAMPLER2D(_name, _reg) \
						uniform Texture2D<uvec4> _name ## Texture : REGISTER(t, _reg); \
						static BgfxUSampler2D _name = { _name ## Texture }
			#		define sampler2D BgfxSampler2D
			#		define texture2D(_sampler, _coord) bgfxTexture2D(_sampler, _coord)
			#		define texture2DBias(_sampler, _coord, _bias) bgfxTexture2DBias(_sampler, _coord, _bias)
			#		define texture2DLod(_sampler, _coord, _level) bgfxTexture2DLod(_sampler, _coord, _level)
			#		define texture2DLodOffset(_sampler, _coord, _level, _offset) bgfxTexture2DLodOffset(_sampler, _coord, _level, _offset)
			#		define texture2DProj(_sampler, _coord) bgfxTexture2DProj(_sampler, _coord)
			#		define texture2DGrad(_sampler, _coord, _dPdx, _dPdy) bgfxTexture2DGrad(_sampler, _coord, _dPdx, _dPdy)

			#		define SAMPLER2DARRAY(_name, _reg) \
						uniform SamplerState _name ## Sampler : REGISTER(s, _reg); \
						uniform Texture2DArray _name ## Texture : REGISTER(t, _reg); \
						static BgfxSampler2DArray _name = { _name ## Sampler, _name ## Texture }
			#		define sampler2DArray BgfxSampler2DArray
			#		define texture2DArray(_sampler, _coord) bgfxTexture2DArray(_sampler, _coord)
			#		define texture2DArrayLod(_sampler, _coord, _lod) bgfxTexture2DArrayLod(_sampler, _coord, _lod)
			#		define texture2DArrayLodOffset(_sampler, _coord, _level, _offset) bgfxTexture2DArrayLodOffset(_sampler, _coord, _level, _offset)

			#		define SAMPLER2DMS(_name, _reg) \
						uniform Texture2DMS<hvec4> _name ## Texture : REGISTER(t, _reg); \
						static BgfxSampler2DMS _name = { _name ## Texture }
			#		define sampler2DMS BgfxSampler2DMS

			#		define SAMPLER2DSHADOW(_name, _reg) \
						uniform SamplerComparisonState _name ## SamplerComparison : REGISTER(s, _reg); \
						uniform Texture2D _name ## Texture : REGISTER(t, _reg); \
						static BgfxSampler2DShadow _name = { _name ## SamplerComparison, _name ## Texture }
			#		define sampler2DShadow BgfxSampler2DShadow
			#		define shadow2D(_sampler, _coord) bgfxShadow2D(_sampler, _coord)
			#		define shadow2DProj(_sampler, _coord) bgfxShadow2DProj(_sampler, _coord)

			#		define SAMPLER2DARRAYSHADOW(_name, _reg) \
						uniform SamplerComparisonState _name ## SamplerComparison : REGISTER(s, _reg); \
						uniform Texture2DArray _name ## Texture : REGISTER(t, _reg); \
						static BgfxSampler2DArrayShadow _name = { _name ## SamplerComparison, _name ## Texture }
			#		define sampler2DArrayShadow BgfxSampler2DArrayShadow
			#		define shadow2DArray(_sampler, _coord) bgfxShadow2DArray(_sampler, _coord)

			#		define SAMPLER3D(_name, _reg) \
						uniform SamplerState _name ## Sampler : REGISTER(s, _reg); \
						uniform Texture3D _name ## Texture : REGISTER(t, _reg); \
						static BgfxSampler3D _name = { _name ## Sampler, _name ## Texture }
			#		define ISAMPLER3D(_name, _reg) \
						uniform Texture3D<ivec4> _name ## Texture : REGISTER(t, _reg); \
						static BgfxISampler3D _name = { _name ## Texture }
			#		define USAMPLER3D(_name, _reg) \
						uniform Texture3D<uvec4> _name ## Texture : REGISTER(t, _reg); \
						static BgfxUSampler3D _name = { _name ## Texture }
			#		define sampler3D BgfxSampler3D
			#		define texture3D(_sampler, _coord) bgfxTexture3D(_sampler, _coord)
			#		define texture3DLod(_sampler, _coord, _level) bgfxTexture3DLod(_sampler, _coord, _level)

			#		define SAMPLERCUBE(_name, _reg) \
						uniform SamplerState _name ## Sampler : REGISTER(s, _reg); \
						uniform TextureCube _name ## Texture : REGISTER(t, _reg); \
						static BgfxSamplerCube _name = { _name ## Sampler, _name ## Texture }
			#		define samplerCube BgfxSamplerCube
			#		define textureCube(_sampler, _coord) bgfxTextureCube(_sampler, _coord)
			#		define textureCubeBias(_sampler, _coord, _bias) bgfxTextureCubeBias(_sampler, _coord, _bias)
			#		define textureCubeLod(_sampler, _coord, _level) bgfxTextureCubeLod(_sampler, _coord, _level)

			#		define SAMPLERCUBESHADOW(_name, _reg) \
						uniform SamplerComparisonState _name ## SamplerComparison : REGISTER(s, _reg); \
						uniform TextureCube _name ## Texture : REGISTER(t, _reg); \
						static BgfxSamplerCubeShadow _name = { _name ## SamplerComparison, _name ## Texture }
			#		define samplerCubeShadow BgfxSamplerCubeShadow
			#		define shadowCube(_sampler, _coord) bgfxShadowCube(_sampler, _coord)

			#		define texelFetch(_sampler, _coord, _lod) bgfxTexelFetch(_sampler, _coord, _lod)
			#		define texelFetchOffset(_sampler, _coord, _lod, _offset) bgfxTexelFetchOffset(_sampler, _coord, _lod, _offset)
			#		define textureSize(_sampler, _lod) bgfxTextureSize(_sampler, _lod)
			#		define textureGather(_sampler, _coord) bgfxTextureGather(_sampler, _coord)
			#		define textureGatherOffset(_sampler, _coord, _offset) bgfxTextureGatherOffset(_sampler, _coord, _offset)
			#		define textureGatherRed(_sampler, _coord) bgfxTextureGatherRed(_sampler, _coord)
			#		define textureGatherGreen(_sampler, _coord) bgfxTextureGatherGreen(_sampler, _coord)
			#		define textureGatherBlue(_sampler, _coord) bgfxTextureGatherBlue(_sampler, _coord)

			//  gl is different with others
			// # define mul(_a, _b) ( (_b) * (_a) )

		#	else // BGFX_SHADER_LANGUAGE_HLSL > 300

			#		define sampler2DShadow sampler2D

			vec4 bgfxTexture2DProj(sampler2D _sampler, vec3 _coord)
			{
				return tex2Dproj(_sampler, vec4(_coord.xy, 0.0, _coord.z) );
			}

			vec4 bgfxTexture2DProj(sampler2D _sampler, vec4 _coord)
			{
				return tex2Dproj(_sampler, _coord);
			}

			hfloat bgfxShadow2D(sampler2DShadow _sampler, hvec3 _coord)
			{
			#if 0
				float occluder = tex2D(_sampler, _coord.xy).x;
				return step(_coord.z, occluder);
			#else
				return tex2Dproj(_sampler, hvec4_init(_coord.xy, _coord.z, 1.0) ).x;
			#endif // 0
			}

			hfloat bgfxShadow2DProj(sampler2DShadow _sampler, hvec4 _coord)
			{
			#if 0
				vec3 coord = _coord.xyz * vec3_splat(rcp(_coord.w));
				float occluder = tex2D(_sampler, coord.xy).x;
				return step(coord.z, occluder);
			#else
				return tex2Dproj(_sampler, _coord).x;
			#endif // 0
			}

			#		define SAMPLER2D(_name, _reg) uniform sampler2D _name : REGISTER(s, _reg)
			#		define SAMPLER2DEX(_name, _reg, _texname) SAMPLER2D(_name, _reg)
			#		define SAMPLER2DMS(_name, _reg) uniform sampler2DMS _name : REGISTER(s, _reg)
			#		define texture2D(_sampler, _coord) tex2D(_sampler, _coord)
			#		define texture2DProj(_sampler, _coord) bgfxTexture2DProj(_sampler, _coord)

			#		define SAMPLER2DARRAY(_name, _reg) SAMPLER2D(_name, _reg)
			#		define texture2DArray(_sampler, _coord) texture2D(_sampler, (_coord).xy)
			#		define texture2DArrayLod(_sampler, _coord, _lod) texture2DLod(_sampler, _coord, _lod)
			#if defined(URHO3D_MOBILE)
			#		define SAMPLER2DSHADOW(_name, _reg) uniform highp sampler2DShadow _name : REGISTER(s, _reg)
			#else 
			#		define SAMPLER2DSHADOW(_name, _reg) uniform highp sampler2DShadow _name : REGISTER(s, _reg)
			#endif
			#		define shadow2D(_sampler, _coord) bgfxShadow2D(_sampler, _coord)
			#		define shadow2DProj(_sampler, _coord) bgfxShadow2DProj(_sampler, _coord)

			#		define SAMPLER3D(_name, _reg) uniform sampler3D _name : REGISTER(s, _reg)
			#		define texture3D(_sampler, _coord) tex3D(_sampler, _coord)

			#if defined(URHO3D_MOBILE)
			#		define SAMPLERCUBE(_name, _reg) uniform highp samplerCUBE _name : REGISTER(s, _reg)
			#else
			#		define SAMPLERCUBE(_name, _reg) uniform highp samplerCUBE _name : REGISTER(s, _reg)
			#endif
			#		define textureCube(_sampler, _coord) texCUBE(_sampler, _coord)

			#		if BGFX_SHADER_LANGUAGE_HLSL == 200
			#			define texture2DLod(_sampler, _coord, _level) tex2D(_sampler, (_coord).xy)
			#			define texture2DGrad(_sampler, _coord, _dPdx, _dPdy) tex2D(_sampler, _coord)
			#			define texture3DLod(_sampler, _coord, _level) tex3D(_sampler, (_coord).xyz)
			#			define textureCubeLod(_sampler, _coord, _level) texCUBE(_sampler, (_coord).xyz)
			#		else
			#			define texture2DLod(_sampler, _coord, _level) tex2Dlod(_sampler, vec4( (_coord).xy, 0.0, _level) )
			#			define texture2DGrad(_sampler, _coord, _dPdx, _dPdy) tex2Dgrad(_sampler, _coord, _dPdx, _dPdy)
			#			define texture3DLod(_sampler, _coord, _level) tex3Dlod(_sampler, vec4( (_coord).xyz, _level) )
			#			define textureCubeLod(_sampler, _coord, _level) texCUBElod(_sampler, vec4( (_coord).xyz, _level) )
			#		endif // BGFX_SHADER_LANGUAGE_HLSL == 200

		#	endif // BGFX_SHADER_LANGUAGE_HLSL > 300
	
		
		# define lerp(_a, _b, _c) ((_a) + (_c) * ((_b) - (_a)))
	
		vec3 instMul(vec3 _vec, mat3 _mtx) { return mul(_mtx, _vec); }
		vec3 instMul(mat3 _mtx, vec3 _vec) { return mul(_vec, _mtx); }
		vec4 instMul(vec4 _vec, mat4 _mtx) { return mul(_mtx, _vec); }
		vec4 instMul(mat4 _mtx, vec4 _vec) { return mul(_vec, _mtx); }

		bvec2 lessThan(vec2 _a, vec2 _b) { return _a < _b; }
		bvec3 lessThan(vec3 _a, vec3 _b) { return _a < _b; }
		bvec4 lessThan(vec4 _a, vec4 _b) { return _a < _b; }

		bvec2 lessThanEqual(vec2 _a, vec2 _b) { return _a <= _b; }
		bvec3 lessThanEqual(vec3 _a, vec3 _b) { return _a <= _b; }
		bvec4 lessThanEqual(vec4 _a, vec4 _b) { return _a <= _b; }

		bvec2 greaterThan(vec2 _a, vec2 _b) { return _a > _b; }
		bvec3 greaterThan(vec3 _a, vec3 _b) { return _a > _b; }
		bvec4 greaterThan(vec4 _a, vec4 _b) { return _a > _b; }

		bvec2 greaterThanEqual(vec2 _a, vec2 _b) { return _a >= _b; }
		bvec3 greaterThanEqual(vec3 _a, vec3 _b) { return _a >= _b; }
		bvec4 greaterThanEqual(vec4 _a, vec4 _b) { return _a >= _b; }

		bvec2 notEqual(vec2 _a, vec2 _b) { return _a != _b; }
		bvec3 notEqual(vec3 _a, vec3 _b) { return _a != _b; }
		bvec4 notEqual(vec4 _a, vec4 _b) { return _a != _b; }

		bvec2 equal(vec2 _a, vec2 _b) { return _a == _b; }
		bvec3 equal(vec3 _a, vec3 _b) { return _a == _b; }
		bvec4 equal(vec4 _a, vec4 _b) { return _a == _b; }

		float mix(float _a, float _b, float _t) { return lerp(_a, _b, _t); }
		vec2  mix(vec2  _a, vec2  _b, vec2  _t) { return lerp(_a, _b, _t); }
		vec3  mix(vec3  _a, vec3  _b, vec3  _t) { return lerp(_a, _b, _t); }
		vec4  mix(vec4  _a, vec4  _b, vec4  _t) { return lerp(_a, _b, _t); }


		float mod(float _a, float _b) { return _a - _b * floor(_a / _b); }
		vec2  mod(vec2  _a, vec2  _b) { return _a - _b * floor(_a / _b); }
		vec3  mod(vec3  _a, vec3  _b) { return _a - _b * floor(_a / _b); }
		vec4  mod(vec4  _a, vec4  _b) { return _a - _b * floor(_a / _b); }


		#ifndef COMPILECS
	
			hvec3 instMul(hvec3 _vec, hmat3 _mtx) { return mul(_mtx, _vec); }
			hvec3 instMul(hmat3 _mtx, hvec3 _vec) { return mul(_vec, _mtx); }
			hvec4 instMul(hvec4 _vec, hmat4 _mtx) { return mul(_mtx, _vec); }
			hvec4 instMul(hmat4 _mtx, hvec4 _vec) { return mul(_vec, _mtx); }

			hfloat mix(hfloat _a, hfloat _b, hfloat _t) { return lerp(_a, _b, _t); }
			hvec2  mix(hvec2  _a, hvec2  _b, hvec2  _t) { return lerp(_a, _b, _t); }
			hvec3  mix(hvec3  _a, hvec3  _b, hvec3  _t) { return lerp(_a, _b, _t); }
			hvec4  mix(hvec4  _a, hvec4  _b, hvec4  _t) { return lerp(_a, _b, _t); }

			hfloat mod(hfloat _a, hfloat _b) { return _a - _b * floor(_a / _b); }
			hvec2  mod(hvec2  _a, hvec2  _b) { return _a - _b * floor(_a / _b); }
			hvec3  mod(hvec3  _a, hvec3  _b) { return _a - _b * floor(_a / _b); }
			hvec4  mod(hvec4  _a, hvec4  _b) { return _a - _b * floor(_a / _b); }

		#endif
	
	#else ////#if BGFX_SHADER_LANGUAGE_HLSL || BGFX_SHADER_LANGUAGE_PSSL || BGFX_SHADER_LANGUAGE_SPIRV || BGFX_SHADER_LANGUAGE_METAL
		#	define CONST(_x) const _x
		#	define atan2(_x, _y) atan(_x, _y)
		#	define mul(_a, _b) ( (_a) * (_b) )
		#	define saturate(_x) clamp(_x, 0.0, 1.0)
		#	define SAMPLER2D(_name, _reg)       layout(binding = _reg) uniform sampler2D _name
		#	define SAMPLER2DEX(_name, _reg, _texname)       layout(binding = _reg) uniform sampler2D _name
		#	define SAMPLER2DMS(_name, _reg)     layout(binding = _reg) uniform sampler2DMS _name
		#	define SAMPLER3D(_name, _reg)       layout(binding = _reg) uniform sampler3D _name
		#if defined(URHO3D_MOBILE)
			#	define SAMPLERCUBE(_name, _reg)     layout(binding = _reg) uniform highp samplerCube _name
		#else
			#	define SAMPLERCUBE(_name, _reg)     layout(binding = _reg) uniform highp samplerCube _name
		#endif
		#if defined(URHO3D_MOBILE)
			#	define SAMPLER2DSHADOW(_name, _reg) layout(binding = _reg) uniform highp sampler2DShadow _name
		#else
			#	define SAMPLER2DSHADOW(_name, _reg) layout(binding = _reg) uniform highp sampler2DShadow _name
		#endif

		#	define SAMPLER2DARRAY(_name, _reg)       layout(binding = _reg) uniform sampler2DArray _name
		#	define SAMPLER2DMSARRAY(_name, _reg)     layout(binding = _reg) uniform sampler2DMSArray _name
		#	define SAMPLERCUBEARRAY(_name, _reg)     layout(binding = _reg) uniform samplerCubeArray _name
		#	define SAMPLER2DARRAYSHADOW(_name, _reg) layout(binding = _reg) uniform sampler2DArrayShadow _name

		#	define ISAMPLER2D(_name, _reg) layout(binding = _reg) uniform isampler2D _name
		#	define USAMPLER2D(_name, _reg) layout(binding = _reg) uniform usampler2D _name
		#	define ISAMPLER3D(_name, _reg) layout(binding = _reg) uniform isampler3D _name
		#	define USAMPLER3D(_name, _reg) layout(binding = _reg) uniform usampler3D _name

		#	define texture2DBias(_sampler, _coord, _bias)      texture2D(_sampler, _coord, _bias)
		#	define textureCubeBias(_sampler, _coord, _bias)    textureCube(_sampler, _coord, _bias)
		#	define textureGatherRed(_sampler, _coord) textureGather(_sampler, _coord, 0)
		#	define textureGatherGreen(_sampler, _coord) textureGather(_sampler, _coord, 1)
		#	define textureGatherBlue(_sampler, _coord) textureGather(_sampler, _coord, 2)

		#	if BGFX_SHADER_LANGUAGE_GLSL >= 130
		#		define textureCube(_sampler, _coord)      texture(_sampler, _coord)
		#		define texture2D(_sampler, _coord)      texture(_sampler, _coord)
		#		define texture2DArray(_sampler, _coord) texture(_sampler, _coord)
		#		define texture3D(_sampler, _coord)      texture(_sampler, _coord)
		#	endif // BGFX_SHADER_LANGUAGE_GLSL >= 130

		vec3 instMul(vec3 _vec, mat3 _mtx) { return mul(_vec, _mtx); }
		vec3 instMul(mat3 _mtx, vec3 _vec) { return mul(_mtx, _vec); }
		vec4 instMul(vec4 _vec, mat4 _mtx) { return mul(_vec, _mtx); }
		vec4 instMul(mat4 _mtx, vec4 _vec) { return mul(_mtx, _vec); }

		float rcp(float _a) { return 1.0/_a; }
		vec2  rcp(vec2  _a) { return vec2(1.0)/_a; }
		vec3  rcp(vec3  _a) { return vec3(1.0)/_a; }
		vec4  rcp(vec4  _a) { return vec4(1.0)/_a; }
	#endif // BGFX_SHADER_LANGUAGE_*
	
	mat4 mtxFromRows(vec4 _0, vec4 _1, vec4 _2, vec4 _3)
	{
	#if BGFX_SHADER_LANGUAGE_GLSL
		return transpose(mat4(_0, _1, _2, _3) );
	#else
		return mat4(_0, _1, _2, _3);
	#endif // BGFX_SHADER_LANGUAGE_GLSL
	}
	mat4 mtxFromCols(vec4 _0, vec4 _1, vec4 _2, vec4 _3)
	{
	#if BGFX_SHADER_LANGUAGE_GLSL
		return mat4(_0, _1, _2, _3);
	#else
		return transpose(mat4(_0, _1, _2, _3) );
	#endif // BGFX_SHADER_LANGUAGE_GLSL
	}
	mat3 mtxFromRows(vec3 _0, vec3 _1, vec3 _2)
	{
	#if BGFX_SHADER_LANGUAGE_GLSL
		return transpose(mat3(_0, _1, _2) );
	#else
		return mat3(_0, _1, _2);
	#endif // BGFX_SHADER_LANGUAGE_GLSL
	}
	mat3 mtxFromCols(vec3 _0, vec3 _1, vec3 _2)
	{
	#if BGFX_SHADER_LANGUAGE_GLSL
		return mat3(_0, _1, _2);
	#else
		return transpose(mat3(_0, _1, _2) );
	#endif // BGFX_SHADER_LANGUAGE_GLSL
	}
	
	#if BGFX_SHADER_LANGUAGE_GLSL
		#define mtxFromRows3(_0, _1, _2)     transpose(mat3(_0, _1, _2) )
		#define mtxFromRows4(_0, _1, _2, _3) transpose(mat4(_0, _1, _2, _3) )
		#define mtxFromCols3(_0, _1, _2)               mat3(_0, _1, _2)
		#define mtxFromCols4(_0, _1, _2, _3)           mat4(_0, _1, _2, _3)
	#else
		#define mtxFromRows3(_0, _1, _2)               mat3(_0, _1, _2)
		#define mtxFromRows4(_0, _1, _2, _3)           mat4(_0, _1, _2, _3)
		#define mtxFromCols3(_0, _1, _2)     transpose(mat3(_0, _1, _2) )
		#define mtxFromCols4(_0, _1, _2, _3) transpose(mat4(_0, _1, _2, _3) )
	#endif // BGFX_SHADER_LANGUAGE_GLSL
	
	uniform hvec4 u_viewRect;
	uniform hvec4  u_viewTexel;
	uniform hmat4  u_view;
	uniform hmat4  u_invView;
	uniform hmat4  u_proj;
	uniform hmat4  u_invProj;
	uniform hmat4  u_viewProj;
	uniform hmat4  u_invViewProj;
	uniform hmat4  u_model[BGFX_CONFIG_MAX_BONES];
	uniform hmat4  u_modelView;
	uniform hmat4  u_modelViewProj;
	uniform hvec4  u_alphaRef4;
	#define u_alphaRef u_alphaRef4.x

#endif // __cplusplus

#endif // BGFX_SHADER_H_HEADER_GUARD
