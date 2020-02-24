import { TrackOpTypes, TriggerOpTypes } from './operations'
import { EMPTY_OBJ, extend, isArray } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true // ! effect 标识
  active: boolean // ! 激活开关 -> 默认是 true, stop 后变为 false
  raw: () => T
  deps: Array<Dep>
  options: ReactiveEffectOptions
}

// ! effect 选项接口
export interface ReactiveEffectOptions {
  lazy?: boolean // ! 延迟计算，为 true 时 effect 不会立即执行一次
  computed?: boolean // ! 计算属性依赖的 effect
  scheduler?: (run: Function) => void // ! 调度器函数
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

// ! debugger 事件
export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

// ! debugger 事件扩展信息
export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

// ! 依赖收集栈 -> 存放 effect 的栈
const effectStack: ReactiveEffect[] = []

// ! 当前活跃的 effect
export let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol('iterate')

// ! 是否是 effect
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn != null && fn._isEffect === true
}

// ! 生成 effect
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)

  // ! 如果不是延迟执行，先执行一次
  if (!options.lazy) {
    effect()
  }
  return effect
}

// ! 停止 effect
export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

// ! 生成 effect 的方法 -> 包装 fn 函数，并赋予其属性
function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  // ! 创建一个 effect 函数，返回用 run 包装的原始函数
  const effect = function reactiveEffect(...args: unknown[]): unknown {
    return run(effect, fn, args)
  } as ReactiveEffect
  effect._isEffect = true
  effect.active = true // ! 初始为 true，使用 stop 后为 false
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}

// ! effect 执行函数
function run(effect: ReactiveEffect, fn: Function, args: unknown[]): unknown {
  // ! 激活开关关闭时 -> 使用 stop 后，不需要监听
  if (!effect.active) {
    return fn(...args)
  }

  // ! 栈中没有 effect 时，进栈并执行 fn，最后出栈
  if (!effectStack.includes(effect)) {
    cleanup(effect) // ! 执行之前，清除 effect 的所有 dep
    // ! 执行原始函数，触发函数里面数据的 getter, 收集依赖
    try {
      enableTracking()
      effectStack.push(effect)
      activeEffect = effect
      return fn(...args)
    } finally {
      effectStack.pop()
      resetTracking()
      activeEffect = effectStack[effectStack.length - 1]
    }
  }
}

// ! 清除 effect 的所有 dep，清除自身的引用
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

// ! 是否收集依赖
let shouldTrack = true
const trackStack: boolean[] = []

// ! 停止收集依赖
export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

// ! 恢复收集依赖
export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

// ! 重置收集依赖
export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    return
  }
  let depsMap = targetMap.get(target)
  if (depsMap === void 0) {
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (dep === void 0) {
    depsMap.set(key, (dep = new Set()))
  }
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect) // ! dep 添加 activeEffect
    activeEffect.deps.push(dep) // ! activeEffect 的 deps 也添加 dep（循环引用）
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

// ! 触发依赖
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target) // ! 获取 target 的所有依赖

  if (depsMap === void 0) {
    // never been tracked
    return
  }
  const effects = new Set<ReactiveEffect>()
  const computedRunners = new Set<ReactiveEffect>()
  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    depsMap.forEach(dep => {
      addRunners(effects, computedRunners, dep)
    })
  } else if (key === 'length' && isArray(target)) {
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) {
        addRunners(effects, computedRunners, dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      addRunners(effects, computedRunners, depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE | Map.SET
    if (
      type === TriggerOpTypes.ADD ||
      type === TriggerOpTypes.DELETE ||
      (type === TriggerOpTypes.SET && target instanceof Map)
    ) {
      const iterationKey = isArray(target) ? 'length' : ITERATE_KEY

      addRunners(effects, computedRunners, depsMap.get(iterationKey))
    }
  }
  // ! 执行集合里面的依赖
  const run = (effect: ReactiveEffect) => {
    scheduleRun(
      effect,
      target,
      type,
      key,
      __DEV__
        ? {
            newValue,
            oldValue,
            oldTarget
          }
        : undefined
    )
  }
  // Important: computed effects must be run first so that computed getters
  // can be invalidated before any normal effects that depend on them are run.
  computedRunners.forEach(run) // ! 先执行，优先级更高
  effects.forEach(run)
}

// ! 把需要执行的依赖添加到对应集合中
function addRunners(
  effects: Set<ReactiveEffect>,
  computedRunners: Set<ReactiveEffect>,
  effectsToAdd: Set<ReactiveEffect> | undefined
) {
  if (effectsToAdd !== void 0) {
    effectsToAdd.forEach(effect => {
      if (effect !== activeEffect) {
        if (effect.options.computed) {
          computedRunners.add(effect)
        } else {
          effects.add(effect)
        }
      } else {
        // the effect mutated its own dependency during its execution.
        // this can be caused by operations like foo.value++
        // do not trigger or we end in an infinite loop
      }
    })
  }
}

// ! 使用调度器函数执行依赖
function scheduleRun(
  effect: ReactiveEffect,
  target: object,
  type: TriggerOpTypes,
  key: unknown,
  extraInfo?: DebuggerEventExtraInfo
) {
  if (__DEV__ && effect.options.onTrigger) {
    const event: DebuggerEvent = {
      effect,
      target,
      key,
      type
    }
    effect.options.onTrigger(extraInfo ? extend(event, extraInfo) : event)
  }
  if (effect.options.scheduler !== void 0) {
    effect.options.scheduler(effect)
  } else {
    effect() // ! 没有设置 scheduler 直接执行
  }
}
