const fs = require('fs')

// ! 筛选 packages 中的包文件夹名称
const targets = (exports.targets = fs.readdirSync('packages').filter(f => {
  // ! 不是文件夹类型直接返回 false
  if (!fs.statSync(`packages/${f}`).isDirectory()) {
    return false
  }
  // ! 获取文件夹（包）里面的 package.json 文件
  const pkg = require(`../packages/${f}/package.json`)

  // ! 设置 private 且 没有 buildOptions 时，直接返回 false
  if (pkg.private && !pkg.buildOptions) {
    return false
  }
  return true
}))

// ! 模糊匹配目标
exports.fuzzyMatchTarget = (partialTargets, includeAllMatching) => {
  const matched = []
  partialTargets.some(partialTarget => {
    for (const target of targets) {
      // ! 匹配
      if (target.match(partialTarget)) {
        matched.push(target)
        if (!includeAllMatching) {
          break
        }
      }
    }
  })
  if (matched.length) {
    return matched
  } else {
    throw new Error(`Target ${partialTargets} not found!`)
  }
}
