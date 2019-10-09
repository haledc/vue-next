import { track, trigger } from './effect'
import { OperationTypes } from './operations'
import { isObject } from '@vue/shared'
import { reactive } from './reactive'

export const refSymbol = Symbol(__DEV__ ? 'refSymbol' : undefined)

// ! Ref 对象类型
export interface Ref<T> {
  [refSymbol]: true
  value: UnwrapNestedRefs<T>
}

// ! 未包裹嵌套的 Ref 类型
export type UnwrapNestedRefs<T> = T extends Ref<any> ? T : UnwrapRef<T>

// ! 转换，对象类型的数据使用 reactive 转换
const convert = (val: any): any => (isObject(val) ? reactive(val) : val)

export function ref<T>(raw: T): Ref<T> {
  raw = convert(raw)
  // ! 包装成对象，为了 Proxy
  const v = {
    [refSymbol]: true, // ! Ref 类型标识
    get value() {
      track(v, OperationTypes.GET, '') // ! 追踪 GET 类型
      return raw
    },
    set value(newVal) {
      raw = convert(newVal)
      trigger(v, OperationTypes.SET, '') // ! 派发 SET 类型
    }
  }
  return v as Ref<T>
}

// ! 判断是否是 Ref 类型，通过标识判断
export function isRef(v: any): v is Ref<any> {
  return v ? v[refSymbol] === true : false
}

// ! 把普通对象的 key 值转换成 Ref 类型
export function toRefs<T extends object>(
  object: T
): { [K in keyof T]: Ref<T[K]> } {
  const ret: any = {}
  for (const key in object) {
    ret[key] = toProxyRef(object, key)
  }
  return ret
}

// ! 把 key 值转换成 Ref 类型
function toProxyRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): Ref<T[K]> {
  const v = {
    [refSymbol]: true,
    get value() {
      return object[key]
    },
    set value(newVal) {
      object[key] = newVal
    }
  }
  return v as Ref<T[K]>
}

// ! 忽略的类型
type BailTypes =
  | Function
  | Map<any, any>
  | Set<any>
  | WeakMap<any, any>
  | WeakSet<any>

// Recursively unwraps nested value bindings.
export type UnwrapRef<T> = {
  ref: T extends Ref<infer V> ? UnwrapRef<V> : T
  array: T extends Array<infer V> ? Array<UnwrapRef<V>> : T
  object: { [K in keyof T]: UnwrapRef<T[K]> }
  stop: T
}[T extends Ref<any>
  ? 'ref'
  : T extends Array<any>
    ? 'array'
    : T extends BailTypes
      ? 'stop' // bail out on types that shouldn't be unwrapped
      : T extends object ? 'object' : 'stop']
