import { track, trigger } from './effect'
import { OperationTypes } from './operations'
import { isObject } from '@vue/shared'
import { reactive } from './reactive'

export const refSymbol = Symbol(__DEV__ ? 'refSymbol' : undefined)

export interface Ref<T = any> {
  [refSymbol]: true // ! 标识
  value: UnwrapRef<T> // ! 值
}

const convert = (val: any): any => (isObject(val) ? reactive(val) : val)

export function ref<T>(raw: T): Ref<T> {
  if (isRef(raw)) {
    return raw
  }
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

export function isRef(v: any): v is Ref {
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
  return {
    [refSymbol]: true,
    get value(): any {
      return object[key]
    },
    set value(newVal) {
      object[key] = newVal
    }
  }
}

// ! 不应该继续递归的引用类型
type BailTypes =
  | Function
  | Map<any, any>
  | Set<any>
  | WeakMap<any, any>
  | WeakSet<any>

// Recursively unwraps nested value bindings.
// ! 递归获取嵌套数据的类型
export type UnwrapRef<T> = {
  // ! 如果是 Ref 类型，继续解套
  ref: T extends Ref<infer V> ? UnwrapRef<V> : T

  // ! 如果是数组类型，循环解套
  array: T extends Array<infer V> ? Array<UnwrapRef<V>> : T

  // ! 如果是对象类型，遍历解套
  object: { [K in keyof T]: UnwrapRef<T[K]> }

  // ! 否则，停止解套
  stop: T
}[T extends Ref
  ? 'ref'
  : T extends Array<any>
    ? 'array'
    : T extends BailTypes
      ? 'stop' // bail out on types that shouldn't be unwrapped
      : T extends object ? 'object' : 'stop']

// only unwrap nested ref
// ! 类型别名，已经是 Ref 类型，不需要解套，否则递归解套
export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>
