global using ProjectArrayExtensions;

namespace ProjectArrayExtensions;

// Movie 全局扩展的兼容性探针：数组原地 Reverse 返回 void，不能被 LINQ 枚举误选。
public static class ArrayExtensions
{
    public static void Reverse<T>(this T[] array) => Array.Reverse(array);
}
