import { track, trigger } from './effect'
import { OperationTypes } from './operations'
import { isObject } from '@vue/shared'
import { reactive } from './reactive'
import { ComputedRef } from './computed'

export interface Ref<T = any> {
  _isRef: true // ! Ref 类型标识
  value: UnwrapRef<T> // ! 值的类型
}

// ! 转换，对象类型创建响应性对象，原始类型直接返回本身
const convert = (val: any): any => (isObject(val) ? reactive(val) : val)

// ! 创建 Ref 类型的对象
export function ref<T extends Ref>(raw: T): T
export function ref<T>(raw: T): Ref<T>
export function ref(raw: any) {
  // ! 已经是 Ref 类型直接返回，不会重复创建
  if (isRef(raw)) {
    return raw
  }

  // ! 转换
  raw = convert(raw)
  // ! 包装成对象，为了 Proxy
  const v = {
    _isRef: true, // ! Ref 类型标识
    get value() {
      track(v, OperationTypes.GET, '') // ! 收集依赖
      return raw
    },
    set value(newVal) {
      raw = convert(newVal) // ! 新增转换
      trigger(v, OperationTypes.SET, '') // ! 触发依赖执行
    }
  }
  return v as Ref
}

// ! 判断是否是 Ref 类型
export function isRef(v: any): v is Ref {
  return v ? v._isRef === true : false
}

// ! 把普通对象的 key 值转换成 Ref 类型
export function toRefs<T extends object>(
  object: T
): { [K in keyof T]: Ref<T[K]> } {
  const ret: any = {}
  for (const key in object) {
    ret[key] = toProxyRef(object, key) // ! 把 key 值转换成 Ref 类型
  }
  return ret
}

// ! 把 key 值转换成 Ref 类型的方法
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
  // ! 如果是 ComputedRef，继续解套
  cRef: T extends ComputedRef<infer V> ? UnwrapRef<V> : T

  // ! 如果是 Ref，继续解套
  ref: T extends Ref<infer V> ? UnwrapRef<V> : T

  // ! 如果是数组类型，循环解套
  array: T extends Array<infer V> ? Array<UnwrapRef<V>> : T

  // ! 如果是对象类型，遍历解套
  object: { [K in keyof T]: UnwrapRef<T[K]> }
}[T extends ComputedRef<any>
  ? 'cRef'
  : T extends Ref
    ? 'ref'
    : T extends Array<any>
      ? 'array'
      : T extends BailTypes
        ? 'ref' // bail out on types that shouldn't be unwrapped
        : T extends object ? 'object' : 'ref']
