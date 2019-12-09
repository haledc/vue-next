import { toRaw, reactive, readonly } from './reactive'
import { track, trigger, ITERATE_KEY } from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { LOCKED } from './lock'
import { isObject, capitalize, hasOwn, hasChanged } from '@vue/shared'

export type CollectionTypes = IterableCollections | WeakCollections

type IterableCollections = Map<any, any> | Set<any>
type WeakCollections = WeakMap<any, any> | WeakSet<any>
type MapTypes = Map<any, any> | WeakMap<any, any>
type SetTypes = Set<any> | WeakSet<any>

// ! 生成响应式对象
const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? reactive(value) : value

// ! 生成只读响应式对象
const toReadonly = <T extends unknown>(value: T): T =>
  isObject(value) ? readonly(value) : value

// ! 获取原型对象
const getProto = <T extends CollectionTypes>(v: T): any =>
  Reflect.getPrototypeOf(v)

function get(
  target: MapTypes,
  key: unknown,
  wrap: typeof toReactive | typeof toReadonly
) {
  target = toRaw(target) // ! 获取原始对象
  key = toRaw(key) // ! 获取原始 key
  track(target, TrackOpTypes.GET, key) // ! 收集依赖
  return wrap(getProto(target).get.call(target, key)) // ! 通过 call 绑定 this 指向原始对象
}

function has(this: CollectionTypes, key: unknown): boolean {
  const target = toRaw(this)
  key = toRaw(key)
  track(target, TrackOpTypes.HAS, key) // ! 收集依赖
  return getProto(target).has.call(target, key)
}

function size(target: IterableCollections) {
  target = toRaw(target)
  track(target, TrackOpTypes.ITERATE, ITERATE_KEY) // ! 收集依赖，这里是 ITERATE 类型
  return Reflect.get(getProto(target), 'size', target)
}

function add(this: SetTypes, value: unknown) {
  value = toRaw(value)
  const target = toRaw(this)
  const proto = getProto(target)
  const hadKey = proto.has.call(target, value) // ! 判断是否已经存在 key 值
  const result = proto.add.call(target, value) // ! 新增属性
  if (!hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, TriggerOpTypes.ADD, value, { newValue: value }) // ! 触发依赖
    } else {
      trigger(target, TriggerOpTypes.ADD, value)
    }
  }
  return result
}

function set(this: MapTypes, key: unknown, value: unknown) {
  value = toRaw(value)
  const target = toRaw(this)
  const proto = getProto(target)
  const hadKey = proto.has.call(target, key) // ! 判断是否已经存在 key 值
  const oldValue = proto.get.call(target, key) // ! 获取旧值
  const result = proto.set.call(target, key, value)
  /* istanbul ignore else */
  if (__DEV__) {
    const extraInfo = { oldValue, newValue: value }
    if (!hadKey) {
      trigger(target, TriggerOpTypes.ADD, key, extraInfo) // ! 触发依赖，这里是 ADD 类型
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
  return result
}

function deleteEntry(this: CollectionTypes, key: unknown) {
  const target = toRaw(this)
  const proto = getProto(target)
  const hadKey = proto.has.call(target, key)
  const oldValue = proto.get ? proto.get.call(target, key) : undefined // ! 获取旧值，没有则为 undefined
  // forward the operation before queueing reactions
  const result = proto.delete.call(target, key)
  if (hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, TriggerOpTypes.DELETE, key, { oldValue }) // ! 触发依赖
    } else {
      trigger(target, TriggerOpTypes.DELETE, key)
    }
  }
  return result
}

function clear(this: IterableCollections) {
  const target = toRaw(this)
  const hadItems = target.size !== 0 // ! 判断是否有元素
  const oldTarget = __DEV__
    ? target instanceof Map
      ? new Map(target)
      : new Set(target)
    : undefined
  // forward the operation before queueing reactions
  const result = getProto(target).clear.call(target)
  if (hadItems) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, TriggerOpTypes.CLEAR, void 0, { oldTarget }) // ! 触发依赖
    } else {
      trigger(target, TriggerOpTypes.CLEAR)
    }
  }
  return result
}

function createForEach(isReadonly: boolean) {
  return function forEach(
    this: IterableCollections,
    callback: Function,
    thisArg?: unknown
  ) {
    const observed = this
    const target = toRaw(observed)
    const wrap = isReadonly ? toReadonly : toReactive
    track(target, TrackOpTypes.ITERATE, ITERATE_KEY) // ! 收集依赖，这里是 ITERATE 类型
    // important: create sure the callback is
    // 1. invoked with the reactive map as `this` and 3rd arg
    // 2. the value received should be a corresponding reactive/readonly.
    function wrappedCallback(value: unknown, key: unknown) {
      return callback.call(observed, wrap(value), wrap(key), observed) // ! key 和 value 转换成响应式对象
    }
    return getProto(target).forEach.call(target, wrappedCallback, thisArg)
  }
}

function createIterableMethod(method: string | symbol, isReadonly: boolean) {
  return function(this: IterableCollections, ...args: unknown[]) {
    const target = toRaw(this)
    // ! [key, value] 成对结构
    const isPair =
      method === 'entries' ||
      (method === Symbol.iterator && target instanceof Map)
    const innerIterator = getProto(target)[method].apply(target, args) // ! 调用对应的迭代方法，生成迭代器
    const wrap = isReadonly ? toReadonly : toReactive // ! 转换成响应式的方法
    track(target, TrackOpTypes.ITERATE, ITERATE_KEY) // ! 收集依赖，这里是 ITERATE 类型
    // return a wrapped iterator which returns observed versions of the
    // values emitted from the real iterator
    return {
      // iterator protocol
      next() {
        const { value, done } = innerIterator.next()
        return done
          ? { value, done } // ! { value: undefined, done: true }
          : {
              value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value), // ! 转换成响应式对象
              done // ! false
            }
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this
      }
    }
  }
}

// ! 创建只读方法
// ! 在拦截 add set delete clear 时判断是否解锁，如果没有解锁会报错，解锁后才能操作
function createReadonlyMethod(
  method: Function,
  type: TriggerOpTypes
): Function {
  return function(this: CollectionTypes, ...args: unknown[]) {
    if (LOCKED) {
      if (__DEV__) {
        const key = args[0] ? `on key "${args[0]}" ` : ``
        console.warn(
          `${capitalize(type)} operation ${key}failed: target is readonly.`,
          toRaw(this)
        )
      }
      return type === TriggerOpTypes.DELETE ? false : this
    } else {
      return method.apply(this, args)
    }
  }
}

// ! 可变插桩对象
const mutableInstrumentations: Record<string, Function> = {
  get(this: MapTypes, key: unknown) {
    return get(this, key, toReactive) // ! 传入 target 参数为 this，this 是代理的原始数据
  },
  get size(this: IterableCollections) {
    return size(this)
  },
  has,
  add,
  set,
  delete: deleteEntry,
  clear,
  forEach: createForEach(false)
}

// ! 只读可变插桩对象
const readonlyInstrumentations: Record<string, Function> = {
  get(this: MapTypes, key: unknown) {
    return get(this, key, toReadonly)
  },
  get size(this: IterableCollections) {
    return size(this)
  },
  has,
  add: createReadonlyMethod(add, TriggerOpTypes.ADD),
  set: createReadonlyMethod(set, TriggerOpTypes.SET),
  delete: createReadonlyMethod(deleteEntry, TriggerOpTypes.DELETE),
  clear: createReadonlyMethod(clear, TriggerOpTypes.CLEAR),
  forEach: createForEach(true)
}

const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]
iteratorMethods.forEach(method => {
  mutableInstrumentations[method as string] = createIterableMethod(
    method,
    false
  )
  readonlyInstrumentations[method as string] = createIterableMethod(
    method,
    true
  )
})

function createInstrumentationGetter(
  instrumentations: Record<string, Function>
) {
  return (
    target: CollectionTypes,
    key: string | symbol,
    receiver: CollectionTypes
  ) =>
    Reflect.get(
      // ! 改变反射的 target -> 有 key 时指向插桩对象
      hasOwn(instrumentations, key) && key in target
        ? instrumentations
        : target,
      key,
      receiver
    )
}

export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(mutableInstrumentations)
}

export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(readonlyInstrumentations)
}
