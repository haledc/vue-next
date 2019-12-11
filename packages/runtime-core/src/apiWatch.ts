import {
  effect,
  stop,
  isRef,
  Ref,
  ComputedRef,
  ReactiveEffectOptions
} from '@vue/reactivity'
import { queueJob } from './scheduler'
import {
  EMPTY_OBJ,
  isObject,
  isArray,
  isFunction,
  isString,
  hasChanged
} from '@vue/shared'
import { recordEffect } from './apiReactivity'
import {
  currentInstance,
  ComponentInternalInstance,
  currentSuspense,
  Data
} from './component'
import {
  ErrorCodes,
  callWithErrorHandling,
  callWithAsyncErrorHandling
} from './errorHandling'
import { onBeforeUnmount } from './apiLifecycle'
import { queuePostRenderEffect } from './renderer'

export type WatchHandler<T = any> = (
  value: T,
  oldValue: T,
  onCleanup: CleanupRegistrator
) => any

// ! 观察选项接口
export interface WatchOptions {
  lazy?: boolean
  flush?: 'pre' | 'post' | 'sync'
  deep?: boolean
  onTrack?: ReactiveEffectOptions['onTrack']
  onTrigger?: ReactiveEffectOptions['onTrigger']
}

// ! 停止观察
type StopHandle = () => void

// ! 观察来源
type WatcherSource<T = any> = Ref<T> | ComputedRef<T> | (() => T)

type MapSources<T> = {
  [K in keyof T]: T[K] extends WatcherSource<infer V> ? V : never
}

export type CleanupRegistrator = (invalidate: () => void) => void

type SimpleEffect = (onCleanup: CleanupRegistrator) => void

const invoke = (fn: Function) => fn()

// overload #1: simple effect
export function watch(effect: SimpleEffect, options?: WatchOptions): StopHandle

// overload #2: single source + cb
export function watch<T>(
  source: WatcherSource<T>,
  cb: WatchHandler<T>,
  options?: WatchOptions
): StopHandle

// overload #3: array of multiple sources + cb
// Readonly constraint helps the callback to correctly infer value types based
// on position in the source array. Otherwise the values will get a union type
// of all possible value types.
export function watch<T extends Readonly<WatcherSource<unknown>[]>>(
  sources: T,
  cb: WatchHandler<MapSources<T>>,
  options?: WatchOptions
): StopHandle

// implementation
export function watch<T = any>(
  effectOrSource: WatcherSource<T> | WatcherSource<T>[] | SimpleEffect,
  cbOrOptions?: WatchHandler<T> | WatchOptions,
  options?: WatchOptions
): StopHandle {
  if (isFunction(cbOrOptions)) {
    // effect callback as 2nd argument - this is a source watcher
    return doWatch(effectOrSource, cbOrOptions, options)
  } else {
    // 2nd argument is either missing or an options object
    // - this is a simple effect watcher
    return doWatch(effectOrSource, null, cbOrOptions)
  }
}

// ! 执行观察的方法
function doWatch(
  source: WatcherSource | WatcherSource[] | SimpleEffect,
  cb: WatchHandler | null,
  { lazy, deep, flush, onTrack, onTrigger }: WatchOptions = EMPTY_OBJ
): StopHandle {
  const instance = currentInstance
  const suspense = currentSuspense

  // ! 提取 getter
  let getter: () => any
  // ! 监听多个 source, 返回数组类型的值
  if (isArray(source)) {
    getter = () =>
      source.map(
        s =>
          isRef(s)
            ? s.value
            : callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER)
      )
  } else if (isRef(source)) {
    getter = () => source.value
  } else if (cb) {
    // getter with cb
    getter = () =>
      callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER)
  } else {
    // no cb -> simple effect
    getter = () => {
      if (instance && instance.isUnmounted) {
        return
      }
      if (cleanup) {
        cleanup()
      }
      return callWithErrorHandling(
        source,
        instance,
        ErrorCodes.WATCH_CALLBACK,
        [registerCleanup]
      )
    }
  }

  // ! 深度观察
  if (deep) {
    const baseGetter = getter
    getter = () => traverse(baseGetter())
  }

  let cleanup: Function
  const registerCleanup: CleanupRegistrator = (fn: () => void) => {
    cleanup = runner.options.onStop = () => {
      callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP)
    }
  }

  let oldValue = isArray(source) ? [] : undefined
  const applyCb = cb
    ? () => {
        if (instance && instance.isUnmounted) {
          return
        }
        const newValue = runner()
        if (deep || hasChanged(newValue, oldValue)) {
          // cleanup before running cb again
          if (cleanup) {
            cleanup()
          }
          callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
            newValue,
            oldValue,
            registerCleanup
          ])
          oldValue = newValue
        }
      }
    : void 0

  // ! 定义调度器
  let scheduler: (job: () => any) => void
  // ! 同步观察
  if (flush === 'sync') {
    scheduler = invoke
  } else if (flush === 'pre') {
    scheduler = job => {
      if (!instance || instance.vnode.el != null) {
        queueJob(job)
      } else {
        // with 'pre' option, the first call must happen before
        // the component is mounted so it is called synchronously.
        job()
      }
    }
  } else {
    scheduler = job => {
      queuePostRenderEffect(job, suspense)
    }
  }

  // ! 执行器 -> effect
  const runner = effect(getter, {
    lazy: true,
    // so it runs before component update effects in pre flush mode
    computed: true,
    onTrack,
    onTrigger,
    scheduler: applyCb ? () => scheduler(applyCb) : scheduler
  })

  if (!lazy) {
    if (applyCb) {
      scheduler(applyCb)
    } else {
      scheduler(runner)
    }
  } else {
    oldValue = runner() // ! 只获取旧值
  }

  recordEffect(runner)
  // ! 返回一个执行后会停止观察的函数
  return () => {
    stop(runner)
  }
}

// this.$watch
export function instanceWatch(
  this: ComponentInternalInstance,
  source: string | Function,
  cb: Function,
  options?: WatchOptions
): StopHandle {
  const ctx = this.proxy as Data
  const getter = isString(source) ? () => ctx[source] : source.bind(ctx)
  const stop = watch(getter, cb.bind(ctx), options)
  onBeforeUnmount(stop, this)
  return stop
}

// ! 追踪 -> 实现深度观察的方法
function traverse(value: unknown, seen: Set<unknown> = new Set()) {
  if (!isObject(value) || seen.has(value)) {
    return
  }
  seen.add(value)
  if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen)
    }
  } else if (value instanceof Map) {
    value.forEach((v, key) => {
      // to register mutation dep for existing keys
      traverse(value.get(key), seen)
    })
  } else if (value instanceof Set) {
    value.forEach(v => {
      traverse(v, seen)
    })
  } else {
    for (const key in value) {
      traverse(value[key], seen)
    }
  }
  return value
}
