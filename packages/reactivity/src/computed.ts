import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

// ! 生成计算属性值
export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  let dirty = true // ! 初始值为 true
  let value: T
  let computed: ComputedRef<T>

  // ! 生成 effect -> 包装 getter
  const runner = effect(getter, {
    lazy: true, // ! 延迟计算
    // mark effect as computed so that it gets priority during trigger
    computed: true,
    scheduler: () => {
      if (!dirty) {
        dirty = true // ! 当 T 值发生变化，触发依赖 -> 执行 scheduler 函数，重置为 true
        trigger(computed, TriggerOpTypes.SET, 'value')
      }
    }
  })
  computed = {
    _isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      if (dirty) {
        value = runner() // ! 调用 effect 获取 value 的新值
        dirty = false // ! 设置为 false，后面沿用 value 值，直到所依赖的值发生变化
      }
      track(computed, TrackOpTypes.GET, 'value')
      return value
    },
    set value(newValue: T) {
      setter(newValue) // ! 执行 setter
    }
  } as any
  return computed
}
