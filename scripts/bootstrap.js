// create package.json, README, etc. for packages that don't have them yet

const args = require('minimist')(process.argv.slice(2)) // ! 获取命令参数
const fs = require('fs')
const path = require('path')
const version = require('../package.json').version

const packagesDir = path.resolve(__dirname, '../packages') // ! packages 路径
const files = fs.readdirSync(packagesDir) // ! 读取里面的全部文件

files.forEach(shortName => {
  // ! 不是文件夹返回
  if (!fs.statSync(path.join(packagesDir, shortName)).isDirectory()) {
    return
  }

  // ! 文件夹不是 vue 的全部加前缀 @vue/
  const name = shortName === `vue` ? shortName : `@vue/${shortName}`
  const pkgPath = path.join(packagesDir, shortName, `package.json`) // ! 获取文件夹中的 package.json 路径
  const pkgExists = fs.existsSync(pkgPath) // ! 判断 package.json 是否存在
  // ! 如果存在把它引入，如果里面设置了 private 属性，直接返回
  if (pkgExists) {
    const pkg = require(pkgPath)
    if (pkg.private) {
      return
    }
  }

  // ! 如果命令中存在 force 参数（--force）且不存在 package.json，创建文件
  if (args.force || !pkgExists) {
    // !  package.json 内容
    const json = {
      name,
      version,
      description: name,
      main: 'index.js',
      module: `dist/${shortName}.esm-bundler.js`,
      files: [`index.js`, `dist`],
      types: `dist/${shortName}.d.ts`,
      repository: {
        type: 'git',
        url: 'git+https://github.com/vuejs/vue.git'
      },
      keywords: ['vue'],
      author: 'Evan You',
      license: 'MIT',
      bugs: {
        url: 'https://github.com/vuejs/vue/issues'
      },
      homepage: `https://github.com/vuejs/vue/tree/dev/packages/${shortName}#readme`
    }
    fs.writeFileSync(pkgPath, JSON.stringify(json, null, 2)) // ! 把内容写入到路径文件中
  }

  const readmePath = path.join(packagesDir, shortName, `README.md`) // ! 获取 README.md 文件的路径

  // ! 如果命令中存在 force 参数（--force）且不存在 README.md，创建文件
  if (args.force || !fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, `# ${name}`)
  }

  // ! 获取 api-extractor.json 路径
  const apiExtractorConfigPath = path.join(
    packagesDir,
    shortName,
    `api-extractor.json`
  )

  // ! 如果命令中存在 force 参数（--force）且不存在 api-extractor.json，创建文件
  if (args.force || !fs.existsSync(apiExtractorConfigPath)) {
    fs.writeFileSync(
      apiExtractorConfigPath,
      `
{
  "extends": "../../api-extractor.json",
  "mainEntryPointFilePath": "./dist/packages/<unscopedPackageName>/src/index.d.ts",
  "dtsRollup": {
    "untrimmedFilePath": "./dist/<unscopedPackageName>.d.ts"
  }
}
`.trim()
    )
  }

  // ! 获取 src 路径
  const srcDir = path.join(packagesDir, shortName, `src`)
  // ! 获取 src/index.ts 路径
  const indexPath = path.join(packagesDir, shortName, `src/index.ts`)

  // ! 如果命令中存在 force 参数（--force）且不存在 src/index.ts，创建文件
  if (args.force || !fs.existsSync(indexPath)) {
    // ! 不存在 src 文件夹，先创建文件夹
    if (!fs.existsSync(srcDir)) {
      fs.mkdirSync(srcDir)
    }
    fs.writeFileSync(indexPath, ``) // ! 初始内容为空
  }

  // ! 获取包的默认入口 index.js 路径
  const nodeIndexPath = path.join(packagesDir, shortName, 'index.js')

  // ! 如果命令中存在 force 参数（--force）且不存在 index.ts，创建文件
  if (args.force || !fs.existsSync(nodeIndexPath)) {
    fs.writeFileSync(
      nodeIndexPath,
      `
'use strict'

if (process.env.NODE_ENV === 'production') {
  module.exports = require('./dist/${shortName}.cjs.prod.js')
} else {
  module.exports = require('./dist/${shortName}.cjs.js')
}
    `.trim() + '\n'
    )
  }
})
