import { Component, Data, validateComponentName } from './component'
import { ComponentOptions } from './apiOptions'
import { ComponentPublicInstance } from './componentProxy'
import { Directive, validateDirectiveName } from './directives'
import { RootRenderFunction } from './renderer'
import { InjectionKey } from './apiInject'
import { isFunction, NO, isObject } from '@vue/shared'
import { warn } from './warning'
import { createVNode, cloneVNode } from './vnode'

// ! App 接口
export interface App<HostElement = any> {
  config: AppConfig
  use(plugin: Plugin, ...options: any[]): this
  mixin(mixin: ComponentOptions): this
  component(name: string): Component | undefined
  component(name: string, component: Component): this
  directive(name: string): Directive | undefined
  directive(name: string, directive: Directive): this
  mount(
    rootComponent:
      | Component
      // for compatibility with defineComponent() return types
      | { new (): ComponentPublicInstance<any, any, any, any, any> },
    rootContainer: HostElement | string,
    rootProps?: Data
  ): ComponentPublicInstance
  unmount(rootContainer: HostElement | string): void
  provide<T>(key: InjectionKey<T> | string, value: T): this
}

// ! App 配置接口
export interface AppConfig {
  devtools: boolean
  performance: boolean
  readonly isNativeTag?: (tag: string) => boolean
  isCustomElement?: (tag: string) => boolean
  errorHandler?: (
    err: Error,
    instance: ComponentPublicInstance | null,
    info: string
  ) => void
  warnHandler?: (
    msg: string,
    instance: ComponentPublicInstance | null,
    trace: string
  ) => void
}

// ! App 上下文接口
export interface AppContext {
  config: AppConfig
  mixins: ComponentOptions[]
  components: Record<string, Component>
  directives: Record<string, Directive>
  provides: Record<string | symbol, any>
  reload?: () => void // HMR only
}

type PluginInstallFunction = (app: App, ...options: any[]) => any

// ! 插件
export type Plugin =
  | PluginInstallFunction & { install?: PluginInstallFunction }
  | {
      install: PluginInstallFunction
    }

// ! 创建 App 上下文 -> 生成初始配置
export function createAppContext(): AppContext {
  return {
    config: {
      devtools: true,
      performance: false,
      isNativeTag: NO,
      isCustomElement: NO,
      errorHandler: undefined,
      warnHandler: undefined
    },
    mixins: [],
    components: {},
    directives: {},
    provides: {}
  }
}

// ! 创建 App API -> 生成 createApp 函数
export function createAppAPI<HostNode, HostElement>(
  render: RootRenderFunction<HostNode, HostElement>
): () => App<HostElement> {
  return function createApp(): App {
    const context = createAppContext()
    const installedPlugins = new Set()

    let isMounted = false

    const app: App = {
      get config() {
        return context.config
      },

      set config(v) {
        if (__DEV__) {
          warn(
            `app.config cannot be replaced. Modify individual options instead.`
          )
        }
      },

      // ! 安装插件
      use(plugin: Plugin, ...options: any[]) {
        if (installedPlugins.has(plugin)) {
          __DEV__ && warn(`Plugin has already been applied to target app.`)
        } else if (plugin && isFunction(plugin.install)) {
          installedPlugins.add(plugin)
          plugin.install(app, ...options)
        } else if (isFunction(plugin)) {
          installedPlugins.add(plugin)
          plugin(app, ...options)
        } else if (__DEV__) {
          warn(
            `A plugin must either be a function or an object with an "install" ` +
              `function.`
          )
        }
        return app
      },

      // ! 混入 -> 添加 mixin
      mixin(mixin: ComponentOptions) {
        if (__DEV__ && !__FEATURE_OPTIONS__) {
          warn('Mixins are only available in builds supporting Options API')
        }

        if (!context.mixins.includes(mixin)) {
          context.mixins.push(mixin)
        } else if (__DEV__) {
          warn(
            'Mixin has already been applied to target app' +
              (mixin.name ? `: ${mixin.name}` : '')
          )
        }

        return app
      },

      // ! 注册组件
      component(name: string, component?: Component): any {
        if (__DEV__) {
          validateComponentName(name, context.config)
        }
        if (!component) {
          return context.components[name]
        }
        if (__DEV__ && context.components[name]) {
          warn(`Component "${name}" has already been registered in target app.`)
        }
        context.components[name] = component
        return app
      },

      // ! 注册指令
      directive(name: string, directive?: Directive) {
        if (__DEV__) {
          validateDirectiveName(name)
        }

        if (!directive) {
          return context.directives[name] as any
        }
        if (__DEV__ && context.directives[name]) {
          warn(`Directive "${name}" has already been registered in target app.`)
        }
        context.directives[name] = directive
        return app
      },

      // ! 挂载 App
      mount(
        rootComponent: Component,
        rootContainer: HostElement,
        rootProps?: Data | null
      ): any {
        if (!isMounted) {
          if (rootProps != null && !isObject(rootProps)) {
            __DEV__ &&
              warn(`root props passed to app.mount() must be an object.`)
            rootProps = null
          }
          const vnode = createVNode(rootComponent, rootProps)
          // store app context on the root VNode.
          // this will be set on the root instance on initial mount.
          vnode.appContext = context

          // HMR root reload
          if (__BUNDLER__ && __DEV__) {
            context.reload = () => {
              render(cloneVNode(vnode), rootContainer)
            }
          }

          render(vnode, rootContainer)
          isMounted = true
          return vnode.component!.proxy
        } else if (__DEV__) {
          warn(
            `App has already been mounted. Create a new app instance instead.`
          )
        }
      },

      unmount(rootContainer: HostElement) {
        render(null, rootContainer)
      },

      provide(key, value) {
        if (__DEV__ && key in context.provides) {
          warn(
            `App already provides property with key "${key}". ` +
              `It will be overwritten with the new value.`
          )
        }
        // TypeScript doesn't allow symbols as index type
        // https://github.com/Microsoft/TypeScript/issues/24587
        context.provides[key as string] = value

        return app
      }
    }

    return app
  }
}
