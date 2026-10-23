#ifndef __DEBUGLIB_SH__
#define __DEBUGLIB_SH__

vec3 convertRGB2HSL(vec3 _rgb)
{
	float h = 0.0;
	float s = 0.0;
	float l = 0.0;
	float cMin = min(_rgb.r, min(_rgb.g, _rgb.b));
	float cMax = max(_rgb.r, max(_rgb.g, _rgb.b));

	l = (cMax + cMin) / 2.0;
	if (cMax > cMin) {
		float cDelta = cMax - cMin;

		s = l < 0.5 ? cDelta / (cMax + cMin) : cDelta / (2.0 - (cMax + cMin));

		if (_rgb.r == cMax) {
			h = (_rgb.g - _rgb.b) / cDelta;
		} else if (_rgb.g == cMax) {
			h = 2.0 + (_rgb.b - _rgb.r) / cDelta;
		} else {
			h = 4.0 + (_rgb.r - _rgb.g) / cDelta;
		}

		if (h < 0.0) { h += 6.0; }
		h = h / 6.0;
	}
	return vec3(h, s, l);
}

vec3 convertHSL2RGB(vec3 _hsl)
{
	vec3 rgb = clamp(abs(mod(_hsl.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
	return _hsl.z + _hsl.y * (rgb-0.5)*(1.0-abs(2.0*_hsl.z-1.0));
}

vec3 adjustHSL(vec3 _rgb, vec3 _adj)
{
	vec3 hsl = convertRGB2HSL(_rgb);
	hsl.x = mod(hsl.x + 0.5 * _adj.x, 1.0);
	hsl.y = clamp(_adj.y < 0.0 ? hsl.y * (1.0+_adj.y) : hsl.y / (1.0 - min(_adj.y,0.999023)), 0.0, 1.0);
	_rgb = convertHSL2RGB(hsl);
	return _adj.z < 0.0 ? _rgb * (1.0+_adj.z) : _rgb * (1-_adj.z) + _adj.z;
}

vec4 adjustHSL(vec4 _rgb, vec3 _adj)
{
	_rgb.rgb = adjustHSL(_rgb.rgb, _adj);
	return _rgb;
}

#endif