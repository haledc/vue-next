import { ComponentInternalInstance, formatComponentName } from './component'

let supported: boolean
let perf: any

// ! 开始测试
export function startMeasure(
  instance: ComponentInternalInstance,
  type: string
) {
  if (instance.appContext.config.performance && isSupported()) {
    perf.mark(`vue-${type}-${instance.uid}`)
  }
}

// ! 结束测试
export function endMeasure(instance: ComponentInternalInstance, type: string) {
  if (instance.appContext.config.performance && isSupported()) {
    const startTag = `vue-${type}-${instance.uid}`
    const endTag = startTag + `:end`
    perf.mark(endTag)
    perf.measure(
      `<${formatComponentName(instance, instance.type)}> ${type}`,
      startTag,
      endTag
    )
    perf.clearMarks(startTag)
    perf.clearMarks(endTag)
  }
}

// ! 是否支持 window.performance
function isSupported() {
  if (supported !== undefined) {
    return supported
  }
  /* eslint-disable no-restricted-globals */
  if (typeof window !== 'undefined' && window.performance) {
    supported = true
    perf = window.performance
  } else {
    supported = false
  }
  /* eslint-enable no-restricted-globals */
  return supported
}
