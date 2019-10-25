import { effect, ReactiveEffect, effectStack } from './effect'
import { Ref, UnwrapRef } from './ref'
import { isFunction, NOOP } from '@vue/shared'

// ! ComputedRef 类型
export interface ComputedRef<T> extends WritableComputedRef<T> {
  readonly value: UnwrapRef<T>
}

// ! WritableComputedRef 类型，设置了 setter
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

  let dirty = true // ! 设置 dirty 为 true
  let value: T

  // ! effect 返回值
  const runner = effect(getter, {
    lazy: true, // ! 延迟计算，不用立即执行
    // mark effect as computed so that it gets priority during trigger
    computed: true, // ! 计算属性依赖的标识
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
        value = runner() // ! 执行一次获取值
        dirty = false // ! 获取值后重置为 false，不用每次都执行
      }
      // When computed effects are accessed in a parent effect, the parent
      // should track all the dependencies the computed property has tracked.
      // This should also apply for chained computed properties.
      trackChildRun(runner) // ! track 子级，用于在 effect 中又引用了计算属性
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
  // ! 获取计算属性的父级 effect
  const parentRunner = effectStack[effectStack.length - 1]

  // ! 遍历子级，即本 effect
  for (let i = 0; i < childRunner.deps.length; i++) {
    const dep = childRunner.deps[i]
    // ! 如果子级的某个 dep 没有父级的 effect，把父级添加进去该 dep 中
    // ! 然后父级 effect 的 deps 也把该 dep 添加进去
    if (!dep.has(parentRunner)) {
      dep.add(parentRunner)
      parentRunner.deps.push(dep)
    }
  }
}
