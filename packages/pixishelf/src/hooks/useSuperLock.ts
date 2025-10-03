import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * 经过改进的超级锁 Hook。
 * 实现了三种锁定机制的清晰组合：
 * 1. 未运行完毕锁 (isExecutingRef)：防止在异步函数完成前重复调用。
 * 2. 调用频率锁 (lastCallTimeRef)：确保两次调用之间至少间隔 `delay` 毫秒（节流）。
 *
 * @param fun 需要被锁定的异步函数。
 * @param delay 锁定的延迟时间（毫秒），默认为 500。
 * @returns 返回一个元组：[被包裹的函数, 当前是否锁定 (boolean)]
 */
export function useSuperLock<T extends (...args: any[]) => Promise<any>>(fun: T, delay = 500) {
  // 使用 state 来驱动 UI 更新（例如，按钮的 disabled 状态）
  const [isLocked, setIsLocked] = useState(false)

  // 使用 ref 来存储不需要触发重渲染的状态
  const isExecutingRef = useRef(false)
  const lastCallTimeRef = useRef(0)

  // 确保 fun 函数总是最新的，避免闭包陷阱
  const funRef = useRef(fun)
  funRef.current = fun

  // 使用 useCallback 保证返回的函数引用稳定
  const lockedFn = useCallback(
    async (...args: Parameters<T>): Promise<ReturnType<T> | undefined> => {
      // 检查1：函数是否正在执行中？
      if (isExecutingRef.current) {
        console.warn('SuperLock: Function is already executing.')
        return
      }

      // 检查2：距离上次调用是否足够久？
      const now = Date.now()
      if (now - lastCallTimeRef.current < delay) {
        console.warn('SuperLock: Call is too frequent.')
        return
      }

      // 同时上两种锁
      isExecutingRef.current = true
      lastCallTimeRef.current = now
      setIsLocked(true)

      try {
        // 调用最新的函数，并返回结果
        return await funRef.current(...args)
      } catch (error) {
        // 如果发生错误，立即释放“执行锁”，但保留“频率锁”
        // 这样可以防止因错误导致按钮被永久锁住
        isExecutingRef.current = false
        setIsLocked(false)

        // 重新抛出错误，让调用者可以处理
        throw error
      } finally {
        // 无论成功还是失败，最终都要释放“执行锁”
        // 我们在 setTimeout 中释放 UI 锁，确保冷却时间
        setTimeout(() => {
          isExecutingRef.current = false
          setIsLocked(false)
        }, delay)
      }
    },
    [delay]
  ) // 依赖项只有 delay

  return [lockedFn, isLocked] as const
}

// --- 使用示例 ---
/*
function MyComponent() {
  const [myApiCall, isApiBusy] = useSuperLock(async (data) => {
    console.log('API called with:', data);
    // 模拟一个需要 1 秒的网络请求
    await new Promise(resolve => setTimeout(resolve, 1000));
    return 'Success';
  }, 500);

  const handleClick = async () => {
    try {
      const result = await myApiCall({ id: 123 });
      if (result) {
        console.log('API returned:', result);
      }
    } catch (error) {
      console.error('API call failed:', error);
    }
  };

  return (
    <button onClick={handleClick} disabled={isApiBusy}>
      {isApiBusy ? '正在提交...' : '提交'}
    </button>
  );
}
*/
