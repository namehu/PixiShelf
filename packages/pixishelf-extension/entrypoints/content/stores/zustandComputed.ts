import type { Mutate, StateCreator, StoreApi, StoreMutatorIdentifier } from 'zustand'
import { shallow } from 'zustand/shallow'

// ============================================================================
// 类型定义区域
// ============================================================================

export type ComputedStateOpts<T> =
  | {
      keys?: (keyof T)[]
    }
  | {
      shouldRecompute?: (state: T, nextState: T | Partial<T>) => boolean
      equalityFn?: <Y>(a: Y, b: Y) => boolean
    }

export type ComputedStateCreator = <T extends object, A extends object>(
  compute: (state: T) => A,
  opts?: ComputedStateOpts<T>
) => <
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
  U = T
>(
  f: StateCreator<T, [...Mps, ['chrisvander/zustand-computed', A]], Mcs>
) => StateCreator<T, Mps, [['chrisvander/zustand-computed', A], ...Mcs], U & A>

type Cast<T, U> = T extends U ? T : U
type Write<T, U> = Omit<T, keyof U> & U
type StoreCompute<S, A> = S extends {
  getState: () => infer T
}
  ? Omit<StoreApi<T & A>, 'setState'>
  : never
type WithCompute<S, A> = Write<S, StoreCompute<S, A>>

declare module 'zustand/vanilla' {
  interface StoreMutators<S, A> {
    'chrisvander/zustand-computed': WithCompute<Cast<S, object>, A>
  }
}

type ComputedStateImpl = <T extends object, A extends object>(
  compute: (state: T) => A,
  opts?: ComputedStateOpts<T>
) => (f: StateCreator<T, [], []>) => StateCreator<T, [], [], T & A>

// ============================================================================
// 核心实现逻辑
// ============================================================================

const computedImpl: ComputedStateImpl = (compute, opts) => (f) => {
  // 🟢 修复 1：在此处显式定义 T 和 A，解决 "找不到名称 T/A" 和 "隐式 any" 的报错
  // 通过 f 的返回值推断原始 State 类型 T
  type T = ReturnType<typeof f>
  // 通过 compute 的返回值推断计算属性类型 A
  type A = ReturnType<typeof compute>

  const optsKeys = opts && 'keys' in opts ? opts.keys : undefined
  const keysSet = optsKeys ? new Set(optsKeys as string[]) : undefined

  function defaultShouldRecomputeFn<U>(_: U, nextState: U | Partial<U>): boolean {
    if (!keysSet) return true
    if (nextState == null) return true
    return Object.keys(nextState).some((k) => keysSet.has(k))
  }

  const shouldRecomputeFn =
    opts && 'shouldRecompute' in opts ? (opts.shouldRecompute ?? defaultShouldRecomputeFn) : defaultShouldRecomputeFn

  return (set, get, api) => {
    const equalityFn = opts && 'equalityFn' in opts && opts.equalityFn ? opts.equalityFn : shallow

    function computeAndMerge(base: T | (T & A)): T & A {
      const computedState = compute(base as T)

      // 🟢 修复 2：现在 A 已定义，(keyof A)[] 类型断言将正常工作
      for (const k of Object.keys(computedState) as (keyof A)[]) {
        if (k in base && equalityFn(computedState[k], (base as T & A)[k])) {
          delete computedState[k]
        }
      }
      return { ...base, ...computedState }
    }

    const _api = api as Mutate<StoreApi<T>, [['chrisvander/zustand-computed', A]]>

    const setState: typeof _api.setState = (arg, replace) => {
      set(
        (state) => {
          const newStateOrPartial = typeof arg === 'function' ? (arg as Function)(state) : arg

          if (!shouldRecomputeFn(state, newStateOrPartial)) {
            return replace ? (newStateOrPartial as T) : (newStateOrPartial as Partial<T>)
          }

          const mergedState = replace ? (newStateOrPartial as T) : { ...state, ...newStateOrPartial }

          return computeAndMerge(mergedState)
        },
        // 🟢 修复 3：使用 "as any" 绕过 replace 参数的严格重载检查 (Error 2769)
        // Zustand 的 set 定义分成了 false|undefined 和 true 两个重载，
        // 直接传 boolean 会报错，这里强制转换最安全。
        replace as any
      )
    }

    _api.setState = setState
    const st = f(setState, get, _api)
    return { ...st, ...compute(st as T) }
  }
}

export const createComputed = computedImpl as unknown as ComputedStateCreator
