import { OperationTypes } from './operations'
import { Dep, targetMap } from './reactive'
import { EMPTY_OBJ, extend } from '@vue/shared'

// ! effect 接口
export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true // ! effect 函数标识
  active: boolean // ! 激活开关，默认是 true, stop 后变为 false
  raw: () => T // ! 原始函数
  deps: Array<Dep> // ! dep 的集合 [{ effect1, effect2 }]
  options: ReactiveEffectOptions
}

// ! effect 选项接口
export interface ReactiveEffectOptions {
  lazy?: boolean // ! 延迟计算，为 true时，effect 不会立即执行一次
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

// ! 存放监听函数的数组
export const effectStack: ReactiveEffect[] = []

export const ITERATE_KEY = Symbol('iterate')

// ! 是否是监听函数
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn != null && fn._isEffect === true
}

// ! 创建并返回 effect 函数
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

// ! 停止：执行 onStop 并设置 active 为 false
export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop() // ! 执行 stop 监听器
    }
    effect.active = false
  }
}

// ! 创建 effect 函数的方法
function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  // ! 创建一个 effect 函数，使用 run 包裹原始函数
  const effect = function reactiveEffect(...args: unknown[]): unknown {
    return run(effect, fn, args)
  } as ReactiveEffect
  effect._isEffect = true
  effect.active = true
  effect.raw = fn // ! 存储原始函数
  effect.deps = []
  effect.options = options
  return effect
}

// ! 执行函数 fn 的函数
function run(effect: ReactiveEffect, fn: Function, args: unknown[]): unknown {
  // ! 激活开关关闭时，执行原始函数
  if (!effect.active) {
    return fn(...args)
  }

  // ! effect 栈中没有 effect 时，进栈并执行 fn，最后出栈
  if (!effectStack.includes(effect)) {
    cleanup(effect) // ! 执行之前，清除 effect 的所有 dep
    try {
      effectStack.push(effect) // ! 先把 effect 放入到栈中，给 track 函数收集集合
      return fn(...args) // ! 执行原始函数，触发函数里面对象的 getter, 收集依赖
    } finally {
      effectStack.pop() // ! 依赖收集完成后，在栈中删除这个 effect
    }
  }
}

// ! 清除 effect 的所有 dep，清除自身的引用
// ! 因为依赖的数据可能发生变化？？？
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

// ! 停止收集
export function pauseTracking() {
  shouldTrack = false
}

// ! 恢复收集
export function resumeTracking() {
  shouldTrack = true
}

// ! 收集依赖
export function track(target: object, type: OperationTypes, key?: unknown) {
  // ! shouldTrack 为 false 或者 effectStack 没有值时，直接返回
  if (!shouldTrack || effectStack.length === 0) {
    return
  }
  const effect = effectStack[effectStack.length - 1] // ! 从栈中获取依赖 最后一个 effect
  if (type === OperationTypes.ITERATE) {
    key = ITERATE_KEY // ! 迭代类型的依赖对应的 key 统一为 ITERATE_KEY（对象）
  }
  let depsMap = targetMap.get(target) // ! 获取对象的依赖映射 depsMap
  if (depsMap === void 0) {
    targetMap.set(target, (depsMap = new Map())) // ! 没有获取到，创建 depsMap
  }
  let dep = depsMap.get(key!) // ! 获取 key 对应的 dep（依赖集合）
  if (dep === void 0) {
    depsMap.set(key!, (dep = new Set())) // ! 没有获取到，创建 dep
  }
  if (!dep.has(effect)) {
    dep.add(effect) // ! dep 添加 effect
    effect.deps.push(dep) // ! effect 的 deps 也添加 dep（循环引用）
    // ! 生产环境执行 track 监听器
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

// ! 触发依赖执行
export function trigger(
  target: object,
  type: OperationTypes,
  key?: unknown,
  extraInfo?: DebuggerEventExtraInfo
) {
  const depsMap = targetMap.get(target) // ! 获取 target 的依赖

  // ! 没有获取到依赖，直接返回
  if (depsMap === void 0) {
    // never been tracked
    return
  }
  const effects = new Set<ReactiveEffect>() // ! 创建依赖集合
  const computedRunners = new Set<ReactiveEffect>() // ! 创建计算属性依赖集合

  // ! 如果是清除类型时
  if (type === OperationTypes.CLEAR) {
    // collection being cleared, trigger all effects for target
    depsMap.forEach(dep => {
      addRunners(effects, computedRunners, dep) // ! 把依赖的所有 dep 里面的 effect 添加到对应的集合中
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      // ! 把对应 key 的依赖 effect 添加到对应的集合中
      addRunners(effects, computedRunners, depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE
    if (type === OperationTypes.ADD || type === OperationTypes.DELETE) {
      // ! 数组类型对应的 key 是 length，其他类型对应的 key 是 Symbol('iterate')
      const iterationKey = Array.isArray(target) ? 'length' : ITERATE_KEY

      // ! 把迭代类型的 effect 添加到对应的集合中
      addRunners(effects, computedRunners, depsMap.get(iterationKey))
    }
  }
  // ! 执行依赖的方法，调用调度器函数执行依赖
  const run = (effect: ReactiveEffect) => {
    scheduleRun(effect, target, type, key, extraInfo)
  }
  // Important: computed effects must be run first so that computed getters
  // can be invalidated before any normal effects that depend on them are run.
  computedRunners.forEach(run) // ! 执行计算属性的依赖
  effects.forEach(run) // ! 执行依赖
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
