import { reactive, readonly, toRaw } from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { track, trigger, ITERATE_KEY } from './effect'
import { LOCKED } from './lock'
import { isObject, hasOwn, isSymbol, hasChanged } from '@vue/shared'
import { isRef } from './ref'

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

function createGetter(isReadonly: boolean, shallow = false) {
  return function get(target: object, key: string | symbol, receiver: object) {
    const res = Reflect.get(target, key, receiver) // ! 获取原始数据返回值
    // ! 是内置的 Symbol 直接返回原始数据值
    if (isSymbol(key) && builtInSymbols.has(key)) {
      return res
    }
    if (shallow) {
      track(target, TrackOpTypes.GET, key)
      // TODO strict mode that returns a shallow-readonly version of the value
      return res
    }
    // ! 如果是 Ref 类型，返回它的 value -> Ref 类型自己会收集依赖
    if (isRef(res)) {
      return res.value
    }
    track(target, TrackOpTypes.GET, key) // ! 收集依赖
    // ! 返回值，对象类型转换成响应式对象
    return isObject(res)
      ? isReadonly
        ? // need to lazy access readonly and reactive here to avoid
          // circular dependency
          readonly(res)
        : reactive(res)
      : res
  }
}

function set(
  target: object,
  key: string | symbol,
  value: unknown,
  receiver: object
): boolean {
  value = toRaw(value)
  const oldValue = (target as any)[key]
  // ! 更新 Ref 旧值 -> Ref 类型自己会触发依赖
  if (isRef(oldValue) && !isRef(value)) {
    oldValue.value = value
    return true
  }
  const hadKey = hasOwn(target, key)
  const result = Reflect.set(target, key, value, receiver) // ! 获取原始数据返回值
  // don't trigger if target is something up in the prototype chain of original
  if (target === toRaw(receiver)) {
    /* istanbul ignore else */
    if (__DEV__) {
      const extraInfo = { oldValue, newValue: value }
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, extraInfo) // ! 触发依赖， 这里是 ADD 类型
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, extraInfo) // ! 触发依赖
      }
    } else {
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key)
      }
    }
  }
  return result
}

// ! 拦截删除 -> delete
function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, TriggerOpTypes.DELETE, key, { oldValue }) // ! 触发依赖
    } else {
      trigger(target, TriggerOpTypes.DELETE, key)
    }
  }
  return result
}

// ! 拦截查询 -> in
function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  track(target, TrackOpTypes.HAS, key) // ! 收集依赖
  return result
}

// ! 拦截自身读取 -> for...in Object.keys
function ownKeys(target: object): (string | number | symbol)[] {
  track(target, TrackOpTypes.ITERATE, ITERATE_KEY) // ! 收集依赖，这里是 ITERATE 类型
  return Reflect.ownKeys(target)
}

// ! 代理的 handlers
export const mutableHandlers: ProxyHandler<object> = {
  get: createGetter(false),
  set,
  deleteProperty,
  has,
  ownKeys
}

// ! 只读的代理的 handlers，
// ! 在拦截修改、新增、删除时判断是否解锁，如果没有解锁会报错且无法操作，解锁后才操作
export const readonlyHandlers: ProxyHandler<object> = {
  get: createGetter(true),

  set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // ! 判断是否 LOCK
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Set operation on key "${String(key)}" failed: target is readonly.`,
          target
        )
      }
      return true
    } else {
      return set(target, key, value, receiver)
    }
  },

  deleteProperty(target: object, key: string | symbol): boolean {
    // ! 判断是否 LOCK
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Delete operation on key "${String(
            key
          )}" failed: target is readonly.`,
          target
        )
      }
      return true
    } else {
      return deleteProperty(target, key)
    }
  },

  has,
  ownKeys
}

// props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers: ProxyHandler<object> = {
  ...readonlyHandlers,
  get: createGetter(true, true)
}
