/*
Run Rollup in watch mode for development.

To specific the package to watch, simply pass its name and the desired build
formats to watch (defaults to "global"):

```
# name supports fuzzy match. will watch all packages with name containing "dom"
yarn dev dom

# specify the format to output
yarn dev core --formats cjs

# Can also drop all __DEV__ blocks with:
__DEV__=false yarn dev
```
*/

const execa = require('execa')
const { fuzzyMatchTarget } = require('./utils')
const args = require('minimist')(process.argv.slice(2)) // ! 获取参数
const target = args._.length ? fuzzyMatchTarget(args._)[0] : 'vue' // ! 获取目标
const formats = args.formats || args.f // ! 获取 formats 参数
const commit = execa.sync('git', ['rev-parse', 'HEAD']).stdout.slice(0, 7) // ! 执行 git

// ! 执行 rollup 观察模式
execa(
  'rollup',
  [
    '-wc',
    '--environment',
    [
      `COMMIT:${commit}`,
      `TARGET:${target}`,
      `FORMATS:${formats || 'global'}`
    ].join(',')
  ],
  {
    stdio: 'inherit'
  }
)
