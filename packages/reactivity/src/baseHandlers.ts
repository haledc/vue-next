import { reactive, readonly, toRaw } from './reactive'
import { OperationTypes } from './operations'
import { track, trigger } from './effect'
import { LOCKED } from './lock'
import { isObject, hasOwn, isSymbol, hasChanged } from '@vue/shared'
import { isRef } from './ref'

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

// ! 生成 getter，根据参数是否生成只读的 getter
function createGetter(isReadonly: boolean) {
  return function get(target: object, key: string | symbol, receiver: object) {
    const res = Reflect.get(target, key, receiver) // ! 获取原始数据返回值

    // ! 是内置的 Symbol 直接返回原始数据值
    if (isSymbol(key) && builtInSymbols.has(key)) {
      return res
    }

    // ! 如果是 Ref 类型，返回它的 value
    if (isRef(res)) {
      return res.value
    }

    track(target, OperationTypes.GET, key) // ! 收集依赖

    // ! 返回值，对象类型进行深度监听
    return isObject(res)
      ? isReadonly
        ? // need to lazy access readonly and reactive here to avoid
          // circular dependency
          readonly(res) // ! 深度监听
        : reactive(res) // ! 深度监听
      : res
  }
}

// ! 拦截属性的修改或者新值
function set(
  target: object,
  key: string | symbol,
  value: unknown,
  receiver: object
): boolean {
  value = toRaw(value)
  const oldValue = (target as any)[key]
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
        trigger(target, OperationTypes.ADD, key, extraInfo) // ! 触发依赖执行
      } else if (hasChanged(value, oldValue)) {
        trigger(target, OperationTypes.SET, key, extraInfo) // ! 触发依赖执行
      }
    } else {
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, OperationTypes.SET, key)
      }
    }
  }
  return result
}

// ! 拦截 delete 操作
function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.DELETE, key, { oldValue }) // ! 触发依赖执行
    } else {
      trigger(target, OperationTypes.DELETE, key)
    }
  }
  return result
}

// ! 拦截 HasProperty 操作，比如使用 in 运算符
function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  track(target, OperationTypes.HAS, key) // ! 收集依赖
  return result
}

// ! 拦截自身属性的读取操作
function ownKeys(target: object): (string | number | symbol)[] {
  track(target, OperationTypes.ITERATE) // ! 收集依赖，这里是 ITERATE 类型
  return Reflect.ownKeys(target)
}

// ! 修改操作的 handlers
export const mutableHandlers: ProxyHandler<object> = {
  get: createGetter(false),
  set,
  deleteProperty,
  has,
  ownKeys
}

// ! 只读的 handlers，在拦截修改、新增、删除时特殊处理下
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
