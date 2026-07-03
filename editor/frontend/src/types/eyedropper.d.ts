// EyeDropper API 类型声明（TS 5.9 lib.dom.d.ts 尚未内置）
// 规范：https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper_API

interface EyeDropperResult {
    sRGBHex: string
}

interface EyeDropperOpenOptions {
    signal?: AbortSignal
}

interface EyeDropper {
    open(options?: EyeDropperOpenOptions): Promise<EyeDropperResult>
}

interface Window {
    EyeDropper?: { new(): EyeDropper }
}
