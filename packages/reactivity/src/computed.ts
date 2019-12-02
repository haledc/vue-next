import { effect, ReactiveEffect, effectStack } from './effect'
import { Ref, UnwrapRef } from './ref'
import { isFunction, NOOP } from '@vue/shared'

// ! ComputedRef 类型
export interface ComputedRef<T = any> extends WritableComputedRef<T> {
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

// ! 生成计算属性
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

  // ! 生成 effect -> 调用生成计算属性
  const runner = effect(getter, {
    lazy: true, // ! 延迟计算，不用立即执行
    // mark effect as computed so that it gets priority during trigger
    computed: true, // ! 计算属性依赖的标识，优先级比普通的 effect 更高
    scheduler: () => {
      dirty = true // ! T 值发生变化，触发依赖，执行 scheduler，设置为 true
    }
  })

  // ! 返回一个 Ref 类型的值
  return {
    _isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      if (dirty) {
        value = runner() // ! 执行 effect 获取新的 value 值
        dirty = false // ! 重置为 false，后面沿用 value 值，知道依赖的值发生变化
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
  } as any
}

// ! 追踪子级
function trackChildRun(childRunner: ReactiveEffect) {
  if (effectStack.length === 0) {
    return
  }
  // ! 获取计算属性的父级 effect
  const parentRunner = effectStack[effectStack.length - 1]

  // ! 遍历子级，即本 effect
  for (let i = 0; i < childRunner.deps.length; i++) {
    const dep = childRunner.deps[i]
    if (!dep.has(parentRunner)) {
      dep.add(parentRunner)
      parentRunner.deps.push(dep)
    }
  }
}
