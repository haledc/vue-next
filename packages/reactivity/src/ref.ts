import { track, trigger } from './effect'
import { OperationTypes } from './operations'
import { isObject } from '@vue/shared'
import { reactive, isReactive } from './reactive'
import { ComputedRef } from './computed'
import { CollectionTypes } from './collectionHandlers'

const isRefSymbol = Symbol()

export interface Ref<T = any> {
  // This field is necessary to allow TS to differentiate a Ref from a plain
  // object that happens to have a "value" field.
  // However, checking a symbol on an arbitrary object is much slower than
  // checking a plain property, so we use a _isRef plain property for isRef()
  // check in the actual implementation.
  // The reason for not just declaring _isRef in the interface is because we
  // don't want this internal field to leak into userland autocompletion -
  // a private symbol, on the other hand, achieves just that.
  [isRefSymbol]: true // ! Ref 类型标识
  value: UnwrapRef<T> // ! 值的类型
}

// ! 转换 -> 对象类型转换成响应性对象，原始类型直接返回自身
const convert = <T extends unknown>(val: T): T =>
  isObject(val) ? reactive(val) : val

export function isRef(r: any): r is Ref {
  return r ? r._isRef === true : false
}

// ! 生成 Ref 类型的对象
export function ref<T extends Ref>(raw: T): T
export function ref<T>(raw: T): Ref<T>
export function ref<T = any>(): Ref<T>
export function ref(raw?: unknown) {
  if (isRef(raw)) {
    return raw
  }

  // ! 转换
  raw = convert(raw)
  // ! 包装成对象，为了 Proxy
  const r = {
    _isRef: true, // ! Ref 类型标识
    get value() {
      track(r, OperationTypes.GET, 'value') // ! 收集依赖
      return raw
    },
    set value(newVal) {
      raw = convert(newVal)
      // ! 触发依赖
      trigger(
        r,
        OperationTypes.SET,
        'value',
        __DEV__ ? { newValue: newVal } : void 0
      )
    }
  }
  return r
}

// ! 把普通对象的值转换成 Ref 类型
export function toRefs<T extends object>(
  object: T
): { [K in keyof T]: Ref<T[K]> } {
  if (__DEV__ && !isReactive(object)) {
    console.warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  const ret: any = {}
  for (const key in object) {
    ret[key] = toProxyRef(object, key) // ! 把 key 值转换成 Ref 类型
  }
  return ret
}

// ! 把 key 值转换成 Ref 类型的方法 -> Ref<T[K]>
function toProxyRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): Ref<T[K]> {
  return {
    _isRef: true,
    get value(): any {
      return object[key]
    },
    set value(newVal) {
      object[key] = newVal
    }
  } as any
}

type UnwrapArray<T> = { [P in keyof T]: UnwrapRef<T[P]> }

// Recursively unwraps nested value bindings.
// ! 递归获取嵌套数据的类型
export type UnwrapRef<T> = {
  // ! 如果是 ComputedRef，继续解套
  cRef: T extends ComputedRef<infer V> ? UnwrapRef<V> : T

  // ! 如果是 Ref，继续解套
  ref: T extends Ref<infer V> ? UnwrapRef<V> : T

  // ! 如果是数组类型，循环解套
  array: T extends Array<infer V> ? Array<UnwrapRef<V>> & UnwrapArray<T> : T

  // ! 如果是对象类型，遍历解套
  object: { [K in keyof T]: UnwrapRef<T[K]> }
}[T extends ComputedRef<any>
  ? 'cRef'
  : T extends Ref
    ? 'ref'
    : T extends Array<any>
      ? 'array'
      : T extends Function | CollectionTypes
        ? 'ref' // bail out on types that shouldn't be unwrapped
        : T extends object ? 'object' : 'ref']
