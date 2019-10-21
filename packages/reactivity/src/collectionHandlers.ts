import { toRaw, reactive, readonly } from './reactive'
import { track, trigger } from './effect'
import { OperationTypes } from './operations'
import { LOCKED } from './lock'
import { isObject, capitalize, hasOwn } from '@vue/shared'

const toReactive = (value: any) => (isObject(value) ? reactive(value) : value)
const toReadonly = (value: any) => (isObject(value) ? readonly(value) : value)

function get(target: any, key: any, wrap: (t: any) => any): any {
  target = toRaw(target) // ! 获取原始数据
  key = toRaw(key) // ! 获取原始数据
  const proto: any = Reflect.getPrototypeOf(target) // ! 获取原始数据的原型对象
  track(target, OperationTypes.GET, key) // ! 收集依赖
  const res = proto.get.call(target, key) // ! 使用原型方法，通过原始数据去获得该 key 的值
  return wrap(res) // ! wrap = reactive 转换成响应式数据
}

function has(this: any, key: any): boolean {
  const target = toRaw(this)
  key = toRaw(key)
  const proto: any = Reflect.getPrototypeOf(target)
  track(target, OperationTypes.HAS, key)
  return proto.has.call(target, key)
}

// ! 拦截 xxx.size 操作
function size(target: any) {
  target = toRaw(target)
  const proto = Reflect.getPrototypeOf(target)
  track(target, OperationTypes.ITERATE) // ! 收集依赖，这里是 ITERATE 类型
  return Reflect.get(proto, 'size', target)
}

function add(this: any, value: any) {
  value = toRaw(value)
  const target = toRaw(this)
  const proto: any = Reflect.getPrototypeOf(this)
  const hadKey = proto.has.call(target, value) // ! 判断是否已经存在 key 值
  const result = proto.add.call(target, value) // ! 增加值
  if (!hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.ADD, value, { value }) // ! 触发依赖执行
    } else {
      trigger(target, OperationTypes.ADD, value)
    }
  }
  return result
}

function set(this: any, key: any, value: any) {
  value = toRaw(value)
  const target = toRaw(this)
  const proto: any = Reflect.getPrototypeOf(this)
  const hadKey = proto.has.call(target, key) // ! 判断是否已经存在 key 值
  const oldValue = proto.get.call(target, key) // ! 获取旧值
  const result = proto.set.call(target, key, value)
  if (value !== oldValue) {
    /* istanbul ignore else */
    if (__DEV__) {
      const extraInfo = { oldValue, newValue: value }
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key, extraInfo) // ! 触发依赖执行，这里也是 ADD 类型
      } else {
        trigger(target, OperationTypes.SET, key, extraInfo) // ! 触发依赖执行
      }
    } else {
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key)
      } else {
        trigger(target, OperationTypes.SET, key)
      }
    }
  }
  return result
}

// ! 拦截 delete 操作
function deleteEntry(this: any, key: any) {
  const target = toRaw(this)
  const proto: any = Reflect.getPrototypeOf(this)
  const hadKey = proto.has.call(target, key)
  const oldValue = proto.get ? proto.get.call(target, key) : undefined // ! 获取旧值，没有则为 undefined
  // forward the operation before queueing reactions
  const result = proto.delete.call(target, key)
  if (hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.DELETE, key, { oldValue }) // ! 触发依赖执行
    } else {
      trigger(target, OperationTypes.DELETE, key)
    }
  }
  return result
}

function clear(this: any) {
  const target = toRaw(this)
  const proto: any = Reflect.getPrototypeOf(this)
  const hadItems = target.size !== 0 // ! 判断是否有元素
  const oldTarget = target instanceof Map ? new Map(target) : new Set(target)
  // forward the operation before queueing reactions
  const result = proto.clear.call(target)
  if (hadItems) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.CLEAR, void 0, { oldTarget }) // ! 触发依赖执行
    } else {
      trigger(target, OperationTypes.CLEAR)
    }
  }
  return result
}

// ! 创建 ForEach 方法
function createForEach(isReadonly: boolean) {
  return function forEach(this: any, callback: Function, thisArg?: any) {
    const observed = this
    const target = toRaw(observed)
    const proto: any = Reflect.getPrototypeOf(target)
    const wrap = isReadonly ? toReadonly : toReactive
    track(target, OperationTypes.ITERATE)
    // important: create sure the callback is
    // 1. invoked with the reactive map as `this` and 3rd arg
    // 2. the value received should be a corresponding reactive/readonly.
    function wrappedCallback(value: any, key: any) {
      return callback.call(observed, wrap(value), wrap(key), observed) // ! key 和 value 转换成响应式数据
    }
    return proto.forEach.call(target, wrappedCallback, thisArg)
  }
}

// ! 创建迭代器方法
function createIterableMethod(method: string | symbol, isReadonly: boolean) {
  return function(this: any, ...args: any[]) {
    const target = toRaw(this)
    const proto: any = Reflect.getPrototypeOf(target)
    // ! [key, value] 成对结构
    const isPair =
      method === 'entries' ||
      (method === Symbol.iterator && target instanceof Map)
    const innerIterator = proto[method].apply(target, args) // ! 调用对应的迭代方法，生成迭代器
    const wrap = isReadonly ? toReadonly : toReactive // ! 转换成响应式的方法
    track(target, OperationTypes.ITERATE) // ! 收集依赖，这里是 ITERATE 类型
    // return a wrapped iterator which returns observed versions of the
    // values emitted from the real iterator
    return {
      // iterator protocol
      next() {
        const { value, done } = innerIterator.next()
        return done
          ? { value, done } // ! { value: undefined, done: true }
          : {
              value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value), // ! 转换成响应式数据
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

// ! 创建只读方法，在拦截 add set delete clear 时会发出警告
function createReadonlyMethod(
  method: Function,
  type: OperationTypes
): Function {
  return function(this: any, ...args: any[]) {
    // ! 判断是否 LOCK
    if (LOCKED) {
      if (__DEV__) {
        const key = args[0] ? `on key "${args[0]}" ` : ``
        console.warn(
          `${capitalize(type)} operation ${key}failed: target is readonly.`,
          toRaw(this)
        )
      }
      return type === OperationTypes.DELETE ? false : this
    } else {
      return method.apply(this, args)
    }
  }
}

const mutableInstrumentations: any = {
  get(key: any) {
    return get(this, key, toReactive) // ! 传入 target 参数 this，this 为代理的原始数据
  },
  get size() {
    return size(this)
  },
  has,
  add,
  set,
  delete: deleteEntry,
  clear,
  forEach: createForEach(false)
}

const readonlyInstrumentations: any = {
  get(key: any) {
    return get(this, key, toReadonly)
  },
  get size() {
    return size(this)
  },
  has,
  add: createReadonlyMethod(add, OperationTypes.ADD),
  set: createReadonlyMethod(set, OperationTypes.SET),
  delete: createReadonlyMethod(deleteEntry, OperationTypes.DELETE),
  clear: createReadonlyMethod(clear, OperationTypes.CLEAR),
  forEach: createForEach(true)
}

const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]
iteratorMethods.forEach(method => {
  mutableInstrumentations[method] = createIterableMethod(method, false)
  readonlyInstrumentations[method] = createIterableMethod(method, true)
})

function createInstrumentationGetter(instrumentations: any) {
  return function getInstrumented(
    target: any,
    key: string | symbol,
    receiver: any
  ) {
    target =
      hasOwn(instrumentations, key) && key in target ? instrumentations : target // ! 改变反射的 target
    return Reflect.get(target, key, receiver)
  }
}

export const mutableCollectionHandlers: ProxyHandler<any> = {
  get: createInstrumentationGetter(mutableInstrumentations)
}

export const readonlyCollectionHandlers: ProxyHandler<any> = {
  get: createInstrumentationGetter(readonlyInstrumentations)
}
