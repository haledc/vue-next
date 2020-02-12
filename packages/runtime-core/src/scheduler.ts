import { ErrorCodes, callWithErrorHandling } from './errorHandling'
import { isArray } from '@vue/shared'

const queue: (Function | null)[] = [] // ! job 队列
const postFlushCbs: Function[] = [] // ! cb 队列
const p = Promise.resolve()

let isFlushing = false
let isFlushPending = false

const RECURSION_LIMIT = 100
type CountMap = Map<Function, number>

// ! nextTick -> 使用 Promise.then 异步执行函数，目前版本无兼容处理
export function nextTick(fn?: () => void): Promise<void> {
  return fn ? p.then(fn) : p
}

// ! job 队列化
export function queueJob(job: () => void) {
  if (!queue.includes(job)) {
    queue.push(job)
    queueFlush()
  }
}

export function invalidateJob(job: () => void) {
  const i = queue.indexOf(job)
  if (i > -1) {
    queue[i] = null
  }
}
// ! cb 队列化
export function queuePostFlushCb(cb: Function | Function[]) {
  if (!isArray(cb)) {
    postFlushCbs.push(cb)
  } else {
    postFlushCbs.push(...cb)
  }
  queueFlush()
}

// ! 异步执行队列函数
function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    isFlushPending = true
    nextTick(flushJobs)
  }
}

const dedupe = (cbs: Function[]): Function[] => [...new Set(cbs)]

// ! 执行 cbs
export function flushPostFlushCbs(seen?: CountMap) {
  if (postFlushCbs.length) {
    const cbs = dedupe(postFlushCbs) // ! cbs 去重
    postFlushCbs.length = 0 // ! 清空值
    if (__DEV__) {
      seen = seen || new Map()
    }
    for (let i = 0; i < cbs.length; i++) {
      if (__DEV__) {
        checkRecursiveUpdates(seen!, cbs[i])
      }
      cbs[i]()
    }
  }
}

// ! 执行 jobs
function flushJobs(seen?: CountMap) {
  isFlushPending = false
  isFlushing = true
  let job
  if (__DEV__) {
    seen = seen || new Map()
  }
  while ((job = queue.shift()) !== undefined) {
    if (job === null) {
      continue
    }
    if (__DEV__) {
      checkRecursiveUpdates(seen!, job)
    }
    callWithErrorHandling(job, null, ErrorCodes.SCHEDULER) // ! 执行 job
  }
  flushPostFlushCbs(seen) // ! 执行 cbs -> 先执行 job 再执行 cb
  isFlushing = false
  // some postFlushCb queued jobs!
  // keep flushing until it drains.
  if (queue.length || postFlushCbs.length) {
    flushJobs(seen) // ! 执行 job
  }
}

function checkRecursiveUpdates(seen: CountMap, fn: Function) {
  if (!seen.has(fn)) {
    seen.set(fn, 1)
  } else {
    const count = seen.get(fn)!
    if (count > RECURSION_LIMIT) {
      throw new Error(
        'Maximum recursive updates exceeded. ' +
          "You may have code that is mutating state in your component's " +
          'render function or updated hook or watcher source function.'
      )
    } else {
      seen.set(fn, count + 1)
    }
  }
}
