import { OperationTypes } from './operations'
import { Dep, targetMap } from './reactive'
import { EMPTY_OBJ, extend } from '@vue/shared'

export const effectSymbol = Symbol(__DEV__ ? 'effect' : void 0)

export interface ReactiveEffect<T = any> {
  (): T
  [effectSymbol]: true // ! effect 函数标识
  active: boolean
  raw: () => T
  deps: Array<Dep>
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export interface ReactiveEffectOptions {
  lazy?: boolean // ! 延迟计算，用于计算属性
  computed?: boolean // ! 计算属性标识
  scheduler?: (run: Function) => void // ! 调度
  onTrack?: (event: DebuggerEvent) => void // ! track 监听器
  onTrigger?: (event: DebuggerEvent) => void // ! trigger 监听器
  onStop?: () => void // ! stop 监听器
}

// ! 事件接口
export interface DebuggerEvent {
  effect: ReactiveEffect
  target: any
  type: OperationTypes
  key: string | symbol | undefined
}

// ! 依赖 effect 收集栈
export const activeReactiveEffectStack: ReactiveEffect[] = []

export const ITERATE_KEY = Symbol('iterate')

export function isEffect(fn: any): fn is ReactiveEffect {
  return fn != null && fn[effectSymbol] === true
}

// ! 创建并返回响应式 effect 函数
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    effect() // ! lazy 为 flase，先执行一次
  }
  return effect
}

// ! 停止 effect
export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.onStop) {
      effect.onStop() // ! 执行 stop 监听器
    }
    effect.active = false
  }
}

// ! 创建 effect 函数的具体方法
function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  // ! 定义一个 effect 函数，返回执行 fn 的值
  const effect = function reactiveEffect(...args: any[]): any {
    return run(effect, fn, args)
  } as ReactiveEffect
  effect[effectSymbol] = true
  effect.active = true
  effect.raw = fn
  effect.scheduler = options.scheduler
  effect.onTrack = options.onTrack
  effect.onTrigger = options.onTrigger
  effect.onStop = options.onStop
  effect.computed = options.computed
  effect.deps = []
  return effect
}

// ! 执行函数 fn 的函数
function run(effect: ReactiveEffect, fn: Function, args: any[]): any {
  if (!effect.active) {
    return fn(...args) // ! 执行函数，触发函数里面数据的 getter，收集依赖
  }
  if (!activeReactiveEffectStack.includes(effect)) {
    cleanup(effect)
    try {
      activeReactiveEffectStack.push(effect) // ! effect 放入到收集栈中
      return fn(...args) // ! 执行一次，收集依赖
    } finally {
      activeReactiveEffectStack.pop() // ! 最后在收集栈中删除这个 effect
    }
  }
}

// ! 清除 effect 的所有依赖
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true

export function pauseTracking() {
  shouldTrack = false
}

export function resumeTracking() {
  shouldTrack = true
}

// ! 追踪
export function track(
  target: any,
  type: OperationTypes,
  key?: string | symbol
) {
  if (!shouldTrack) {
    return
  }
  const effect = activeReactiveEffectStack[activeReactiveEffectStack.length - 1]
  if (!effect) {
    return
  }
  if (type === OperationTypes.ITERATE) {
    key = ITERATE_KEY
  }
  let depsMap = targetMap.get(target) // ! 获取依赖 depsMap
  if (depsMap === void 0) {
    targetMap.set(target, (depsMap = new Map())) // ! 没有获取到依赖，创建 depsMap
  }
  let dep = depsMap.get(key!) // ! 获取 key 对应的 dep
  if (dep === void 0) {
    depsMap.set(key!, (dep = new Set())) // ! 没有获取到 dep，创建 dep
  }
  if (!dep.has(effect)) {
    dep.add(effect) // ! dep 添加 effect
    effect.deps.push(dep) // ! effect 的 deps 添加 dep 循环引用
    // ! 生产环境执行 track 监听器
    if (__DEV__ && effect.onTrack) {
      effect.onTrack({
        effect,
        target,
        type,
        key
      })
    }
  }
}

// ! 派发
export function trigger(
  target: any,
  type: OperationTypes,
  key?: string | symbol,
  extraInfo?: any
) {
  const depsMap = targetMap.get(target) // ! 获取依赖

  // ! 没有依赖直接返回
  if (depsMap === void 0) {
    // never been tracked
    return
  }
  const effects = new Set<ReactiveEffect>() // ! 创建依赖集合
  const computedRunners = new Set<ReactiveEffect>() // ! 创建计算属性依赖集合
  // ! 是清除类型时
  if (type === OperationTypes.CLEAR) {
    // collection being cleared, trigger all effects for target
    depsMap.forEach(dep => {
      addRunners(effects, computedRunners, dep) // ! 把 dep 里面的 effect 添加到相应的集合中
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      addRunners(effects, computedRunners, depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE
    if (type === OperationTypes.ADD || type === OperationTypes.DELETE) {
      const iterationKey = Array.isArray(target) ? 'length' : ITERATE_KEY
      addRunners(effects, computedRunners, depsMap.get(iterationKey))
    }
  }
  // ! 执行依赖的方法，调用调度器执行依赖
  const run = (effect: ReactiveEffect) => {
    scheduleRun(effect, target, type, key, extraInfo)
  }
  // Important: computed effects must be run first so that computed getters
  // can be invalidated before any normal effects that depend on them are run.
  computedRunners.forEach(run)
  effects.forEach(run)
}

// ! 添加执行依赖到集合中
function addRunners(
  effects: Set<ReactiveEffect>,
  computedRunners: Set<ReactiveEffect>,
  effectsToAdd: Set<ReactiveEffect> | undefined
) {
  if (effectsToAdd !== void 0) {
    effectsToAdd.forEach(effect => {
      if (effect.computed) {
        computedRunners.add(effect)
      } else {
        effects.add(effect)
      }
    })
  }
}

// ! 调度器执行依赖
function scheduleRun(
  effect: ReactiveEffect,
  target: any,
  type: OperationTypes,
  key: string | symbol | undefined,
  extraInfo: any
) {
  if (__DEV__ && effect.onTrigger) {
    effect.onTrigger(
      extend(
        {
          effect,
          target,
          key,
          type
        },
        extraInfo
      )
    )
  }
  if (effect.scheduler !== void 0) {
    effect.scheduler(effect)
  } else {
    effect()
  }
}
