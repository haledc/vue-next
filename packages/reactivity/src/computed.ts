import { effect, ReactiveEffect, effectStack } from './effect'
import { Ref, UnwrapRef } from './ref'
import { isFunction, NOOP } from '@vue/shared'

// ! 新增 ComputedRef 接口
export interface ComputedRef<T> extends WritableComputedRef<T> {
  readonly value: UnwrapRef<T>
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = () => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

// ! 计算属性
export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  const isReadonly = isFunction(getterOrOptions)
  // ! 获取 getter
  const getter = isReadonly
    ? (getterOrOptions as ComputedGetter<T>)
    : (getterOrOptions as WritableComputedOptions<T>).get

  // ! 获取 setter
  const setter = isReadonly
    ? __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
    : (getterOrOptions as WritableComputedOptions<T>).set

  let dirty = true // ! 设置 dirty 为 true
  let value: T

  // ! 执行副作用
  const runner = effect(getter, {
    lazy: true, // ! 延迟计算
    // mark effect as computed so that it gets priority during trigger
    computed: true, // ! 计算属性
    scheduler: () => {
      dirty = true
    }
  })
  // ! 返回 Ref 类型的值
  return {
    _isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      if (dirty) {
        value = runner()
        dirty = false // ! 获取值后重置为 false
      }
      // When computed effects are accessed in a parent effect, the parent
      // should track all the dependencies the computed property has tracked.
      // This should also apply for chained computed properties.
      trackChildRun(runner)
      return value
    },
    set value(newValue: T) {
      setter(newValue)
    }
  }
}

function trackChildRun(childRunner: ReactiveEffect) {
  if (effectStack.length === 0) {
    return
  }
  const parentRunner = effectStack[effectStack.length - 1]
  for (let i = 0; i < childRunner.deps.length; i++) {
    const dep = childRunner.deps[i]
    if (!dep.has(parentRunner)) {
      dep.add(parentRunner)
      parentRunner.deps.push(dep)
    }
  }
}
