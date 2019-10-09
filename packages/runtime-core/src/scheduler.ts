import { handleError, ErrorCodes } from './errorHandling'

const queue: Function[] = []
const postFlushCbs: Function[] = []
const p = Promise.resolve()

let isFlushing = false // ! 是否正在执行函数

// ! 使用 Promise 处理函数，无兼容处理
export function nextTick(fn?: () => void): Promise<void> {
  return fn ? p.then(fn) : p
}

// ! job 队列化
export function queueJob(job: () => void) {
  if (queue.indexOf(job) === -1) {
    queue.push(job)
    if (!isFlushing) {
      nextTick(flushJobs)
    }
  }
}

// ! cb 队列化
export function queuePostFlushCb(cb: Function | Function[]) {
  if (Array.isArray(cb)) {
    postFlushCbs.push.apply(postFlushCbs, cb) // ! 降维添加数组使用 apply
  } else {
    postFlushCbs.push(cb)
  }
  if (!isFlushing) {
    nextTick(flushJobs)
  }
}

// ! 去重的函数
const dedupe = (cbs: Function[]): Function[] => Array.from(new Set(cbs))

// ! 执行 cbs
export function flushPostFlushCbs() {
  if (postFlushCbs.length) {
    const cbs = dedupe(postFlushCbs) // ! 去重
    postFlushCbs.length = 0 // ! 清除
    for (let i = 0; i < cbs.length; i++) {
      cbs[i]()
    }
  }
}

const RECURSION_LIMIT = 100
type JobCountMap = Map<Function, number>

// ! 执行 jobs
function flushJobs(seenJobs?: JobCountMap) {
  isFlushing = true
  let job
  if (__DEV__) {
    seenJobs = seenJobs || new Map()
  }
  while ((job = queue.shift())) {
    if (__DEV__) {
      const seen = seenJobs!
      if (!seen.has(job)) {
        seen.set(job, 1)
      } else {
        const count = seen.get(job)!
        if (count > RECURSION_LIMIT) {
          throw new Error(
            'Maximum recursive updates exceeded. ' +
              "You may have code that is mutating state in your component's " +
              'render function or updated hook.'
          )
        } else {
          seen.set(job, count + 1)
        }
      }
    }
    try {
      job()
    } catch (err) {
      handleError(err, null, ErrorCodes.SCHEDULER)
    }
  }
  flushPostFlushCbs() // ! 执行 cbs
  isFlushing = false
  // some postFlushCb queued jobs!
  // keep flushing until it drains.
  if (queue.length) {
    flushJobs(seenJobs) // ! 执行 job
  }
}
