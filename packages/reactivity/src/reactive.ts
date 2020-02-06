import { isObject, toRawType } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReadonlyHandlers,
  shallowReactiveHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers
} from './collectionHandlers'
import { UnwrapRef, Ref } from './ref'
import { makeMap } from '@vue/shared'

// WeakMaps that store {raw <-> observed} pairs.
const rawToReactive = new WeakMap<any, any>()
const reactiveToRaw = new WeakMap<any, any>()
const rawToReadonly = new WeakMap<any, any>()
const readonlyToRaw = new WeakMap<any, any>()

// WeakSets for values that are marked readonly or non-reactive during
// observable creation.
const readonlyValues = new WeakSet<any>() // ! 只读响应式对象集合
const nonReactiveValues = new WeakSet<any>() // ! 非响应式对象集合

const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
const isObservableType = /*#__PURE__*/ makeMap(
  'Object,Array,Map,Set,WeakMap,WeakSet' // ! 可以设置响应式的六种引用类型
)

// ! 判断能否监听
const canObserve = (value: any): boolean => {
  return (
    !value._isVue && // ! 不能是 Vue 组件
    !value._isVNode && // ! 不能是 VNode
    isObservableType(toRawType(value)) && // ! 必须符合设置的六种引用类型
    !nonReactiveValues.has(value) // ! 不能是非响应式集合中的值
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

// ! 生成响应式对象
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  if (readonlyToRaw.has(target)) {
    return target
  }
  // target is explicitly marked as readonly by user
  if (readonlyValues.has(target)) {
    return readonly(target)
  }
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

// ! 生成只读响应性对象 -> 存储对象的映射和代理的 handlers 不一样
// ! 解锁前不能修改值，触发依赖，解锁后可以
export function readonly<T extends object>(
  target: T
): Readonly<UnwrapNestedRefs<T>> {
  // value is a mutable observable, retrieve its original and return
  // a readonly version.
  if (reactiveToRaw.has(target)) {
    target = reactiveToRaw.get(target)
  }
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are readonly, and does NOT unwrap refs nor recursively convert
// returned properties.
// This is used for creating the props proxy object for stateful components.
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    shallowReadonlyHandlers,
    readonlyCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are reactive, and does NOT unwrap refs nor recursively convert
// returned properties.
export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    shallowReactiveHandlers,
    mutableCollectionHandlers
  )
}

function createReactiveObject(
  target: unknown,
  toProxy: WeakMap<any, any>,
  toRaw: WeakMap<any, any>,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target already has corresponding Proxy
  let observed = toProxy.get(target)
  if (observed !== void 0) {
    return observed
  }
  // target is already a Proxy
  if (toRaw.has(target)) {
    return target
  }
  // only a whitelist of value types can be observed.
  if (!canObserve(target)) {
    return target
  }

  // ! 根据 target 类型使用不同的 handlers
  const handlers = collectionTypes.has(target.constructor)
    ? collectionHandlers
    : baseHandlers
  observed = new Proxy(target, handlers) // ! 生成代理对象（响应式对象）
  toProxy.set(target, observed)
  toRaw.set(observed, target)
  return observed
}

// ! 判断是否是响应式对象 -> 包括只读的响应式
export function isReactive(value: unknown): boolean {
  return reactiveToRaw.has(value) || readonlyToRaw.has(value)
}

// ! 判断是否是只读响应式对象
export function isReadonly(value: unknown): boolean {
  return readonlyToRaw.has(value)
}

// ! 获取原始数据
export function toRaw<T>(observed: T): T {
  return reactiveToRaw.get(observed) || readonlyToRaw.get(observed) || observed
}

// ! 标记只读 -> 加入到只读集合中
export function markReadonly<T>(value: T): T {
  readonlyValues.add(value)
  return value
}

// ! 标记非响应 -> 加入到非响应集合中
export function markNonReactive<T>(value: T): T {
  nonReactiveValues.add(value)
  return value
}
