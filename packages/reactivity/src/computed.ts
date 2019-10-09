import { effect, ReactiveEffect, activeReactiveEffectStack } from './effect'
import { Ref, refSymbol, UnwrapNestedRefs } from './ref'
import { isFunction } from '@vue/shared'

// ! 继承于 Ref
export interface ComputedRef<T> extends Ref<T> {
  readonly value: UnwrapNestedRefs<T>
  readonly effect: ReactiveEffect
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect
}

export interface WritableComputedOptions<T> {
  get: () => T
  set: (v: T) => void
}

export function computed<T>(getter: () => T): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: (() => T) | WritableComputedOptions<T>
): any {
  const isReadonly = isFunction(getterOrOptions)
  // ! 获取 getter
  const getter = isReadonly
    ? (getterOrOptions as (() => T))
    : (getterOrOptions as WritableComputedOptions<T>).get

  // ! 获取 setter
  const setter = isReadonly
    ? () => {
        // TODO warn attempting to mutate readonly computed value
      }
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
    [refSymbol]: true,
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
  const parentRunner =
    activeReactiveEffectStack[activeReactiveEffectStack.length - 1]
  if (parentRunner) {
    for (let i = 0; i < childRunner.deps.length; i++) {
      const dep = childRunner.deps[i]
      if (!dep.has(parentRunner)) {
        dep.add(parentRunner)
        parentRunner.deps.push(dep)
      }
    }
  }
}
