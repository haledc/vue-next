import { OperationTypes } from './operations'
import { Dep, targetMap } from './reactive'
import { EMPTY_OBJ, extend, isArray } from '@vue/shared'

// ! effect 接口
export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true // ! effect 标识
  active: boolean // ! 激活开关 -> 默认是 true, stop 后变为 false
  raw: () => T // ! 原始函数
  deps: Array<Dep> // ! dep 的集合 [{ effect1, effect2 }]
  options: ReactiveEffectOptions
}

// ! effect 选项接口
export interface ReactiveEffectOptions {
  lazy?: boolean // ! 延迟计算，为 true 时 effect 不会立即执行一次
  computed?: boolean // ! 是否是计算属性依赖的 effect
  scheduler?: (run: Function) => void // ! 调度器函数
  onTrack?: (event: DebuggerEvent) => void // ! track 监听器（调试使用）
  onTrigger?: (event: DebuggerEvent) => void // ! trigger 监听器（调试使用）
  onStop?: () => void // ! stop 事件监听器
}

// ! debugger 事件
export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: OperationTypes
  key: any
} & DebuggerEventExtraInfo

// ! debugger 事件扩展信息
export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

// ! 依赖收集栈 -> 存放 effect 的栈
export const effectStack: ReactiveEffect[] = []

export const ITERATE_KEY = Symbol('iterate')

// ! 是否是 effect
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn != null && fn._isEffect === true
}

// ! 创建并返回 effect
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)

  // ! 如果不是延迟执行（计算属性中设置），先执行一次
  if (!options.lazy) {
    effect()
  }
  return effect
}

// ! 停止 effect -> 执行 onStop 并设置 active 为 false
export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

// ! 创建 effect 的方法
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

// ! 执行原始函数 fn
function run(effect: ReactiveEffect, fn: Function, args: unknown[]): unknown {
  // ! 激活开关关闭时，直接执行原始函数，不被收集依赖 -> 使用 stop 后
  if (!effect.active) {
    return fn(...args)
  }

  // ! 栈中没有 effect 时，进栈并执行 fn，最后出栈
  if (!effectStack.includes(effect)) {
    cleanup(effect) // ! 执行之前，清除 effect 的所有 dep
    try {
      effectStack.push(effect) // ! 先把 effect 放入到栈中
      return fn(...args) // ! 执行原始函数，触发函数里面数据的 getter, 执行 track, 收集依赖
    } finally {
      effectStack.pop() // ! 依赖收集完成后，在栈中删除这个 effect
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

// ! 停止收集依赖
export function pauseTracking() {
  shouldTrack = false
}

// ! 恢复收集依赖
export function resumeTracking() {
  shouldTrack = true
}

// ! 收集依赖
export function track(target: object, type: OperationTypes, key?: unknown) {
  // ! shouldTrack 为 false 或者 effectStack 没有值时，不收集依赖
  if (!shouldTrack || effectStack.length === 0) {
    return
  }
  const effect = effectStack[effectStack.length - 1] // ! 从栈中获取依赖 -> 最后一个 effect

  // ! 迭代类型的依赖对应的 key 统一为 ITERATE_KEY
  if (type === OperationTypes.ITERATE) {
    key = ITERATE_KEY
  }

  let depsMap = targetMap.get(target) // ! 获取 target 的依赖
  if (depsMap === void 0) {
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key!) // ! 获取 key 的依赖
  if (dep === void 0) {
    depsMap.set(key!, (dep = new Set()))
  }
  if (!dep.has(effect)) {
    dep.add(effect) // ! dep 添加 effect
    effect.deps.push(dep) // ! effect 的 deps 也添加 dep（循环引用）
    if (__DEV__ && effect.options.onTrack) {
      effect.options.onTrack({
        effect,
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
  type: OperationTypes,
  key?: unknown,
  extraInfo?: DebuggerEventExtraInfo
) {
  const depsMap = targetMap.get(target) // ! 获取 target 的所有依赖

  if (depsMap === void 0) {
    // never been tracked
    return
  }

  const effects = new Set<ReactiveEffect>() // ! 创建依赖集合
  const computedRunners = new Set<ReactiveEffect>() // ! 创建计算属性依赖集合

  // ! 把依赖添加到对应的集合中
  if (type === OperationTypes.CLEAR) {
    // collection being cleared, trigger all effects for target
    depsMap.forEach(dep => {
      addRunners(effects, computedRunners, dep)
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      addRunners(effects, computedRunners, depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE
    if (type === OperationTypes.ADD || type === OperationTypes.DELETE) {
      const iterationKey = isArray(target) ? 'length' : ITERATE_KEY

      addRunners(effects, computedRunners, depsMap.get(iterationKey))
    }
  }
  // ! 执行依赖的方法 -> 可通过调度器函数执行依赖
  const run = (effect: ReactiveEffect) => {
    scheduleRun(effect, target, type, key, extraInfo)
  }
  // Important: computed effects must be run first so that computed getters
  // can be invalidated before any normal effects that depend on them are run.
  computedRunners.forEach(run) // ! 先执行计算属性的依赖，优先级更高
  effects.forEach(run) // ! 再执行普通依赖
}

// ! 把需要执行的依赖添加到对应集合中
function addRunners(
  effects: Set<ReactiveEffect>,
  computedRunners: Set<ReactiveEffect>,
  effectsToAdd: Set<ReactiveEffect> | undefined
) {
  if (effectsToAdd !== void 0) {
    effectsToAdd.forEach(effect => {
      if (effect.options.computed) {
        computedRunners.add(effect)
      } else {
        effects.add(effect)
      }
    })
  }
}

// ! 使用调度器函数执行依赖
function scheduleRun(
  effect: ReactiveEffect,
  target: object,
  type: OperationTypes,
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
