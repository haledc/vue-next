import { isObject, toTypeString } from '@vue/shared'
import { mutableHandlers, readonlyHandlers } from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers
} from './collectionHandlers'
import { ReactiveEffect } from './effect'
import { UnwrapRef, Ref } from './ref'
import { makeMap } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
export type Dep = Set<ReactiveEffect>
export type KeyToDepMap = Map<any, Dep>
export const targetMap = new WeakMap<any, KeyToDepMap>()

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
  ['Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet'] // ! 可以设置响应式的六种引用类型
    .map(t => `[object ${t}]`)
    .join(',')
)

// ! 判断能否观察
const canObserve = (value: any): boolean => {
  return (
    !value._isVue && // ! 不能是 Vue 组件
    !value._isVNode && // ! 不能是 VNode
    isObservableType(toTypeString(value)) && // ! 必须符合设置的六种引用类型
    !nonReactiveValues.has(value) // ! 不能是非响应式集合中的值
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

// ! 生成响应式对象
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // ! 已经是只读响应式对象时直接返回它
  if (readonlyToRaw.has(target)) {
    return target
  }
  // target is explicitly marked as readonly by user
  // ! 存在只读响应式对象集合中时使用生成只读响应式对象
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

// ! 生成只读响应性对象 -> 存储的映射和 handler 不一样
export function readonly<T extends object>(
  target: T
): Readonly<UnwrapNestedRefs<T>> {
  // value is a mutable observable, retrieve its original and return
  // a readonly version.
  if (reactiveToRaw.has(target)) {
    target = reactiveToRaw.get(target) // ! 获取原始对象
  }
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

// ! 生成响应式对象的方法
function createReactiveObject(
  target: unknown,
  toProxy: WeakMap<any, any>,
  toRaw: WeakMap<any, any>,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  // ! 目标不是对象时在生产环境时报错，并返回它
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target already has corresponding Proxy
  let observed = toProxy.get(target)
  if (observed !== void 0) {
    return observed // ! 已经是代理对象的直接从 toProxy 中通过 get 获取
  }
  // target is already a Proxy
  // ! 已经是响应式对象的直接返回它
  if (toRaw.has(target)) {
    return target
  }
  // only a whitelist of value types can be observed.
  // ! 无法监听的目标直接返回它
  if (!canObserve(target)) {
    return target
  }
  // ! 根据 target 类型使用不同的 handlers
  // ! Object, Array 类型使用 baseHandlers
  // ! Set, Map, WeakMap, WeakSet 类型使用 collectionHandlers
  const handlers = collectionTypes.has(target.constructor)
    ? collectionHandlers
    : baseHandlers
  observed = new Proxy(target, handlers) // ! 生成代理对象（响应式对象）
  toProxy.set(target, observed) // ! 存储到 toProxy 的映射表中 target -> observed
  toRaw.set(observed, target) // ! 存储到 toRaw 的映射表中 observed -> target

  // ! targetMap 没有 target 时创建新的 new Map()
  if (!targetMap.has(target)) {
    targetMap.set(target, new Map()) // ! 存储到 targetMap 的映射表中 target -> Map，用于收集依赖
  }
  return observed // ! 返回响应式对象
}

// ! 判断是否是响应式对象
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

// ! 加入到只读集合中
export function markReadonly<T>(value: T): T {
  readonlyValues.add(value)
  return value
}

// ! 加入到非响应集合中
export function markNonReactive<T>(value: T): T {
  nonReactiveValues.add(value)
  return value
}
