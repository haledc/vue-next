import {
  VNode,
  VNodeProps,
  createVNode,
  VNodeChildren,
  Fragment,
  Portal,
  isVNode
} from './vnode'
import { Suspense, SuspenseProps } from './components/Suspense'
import { isObject, isArray } from '@vue/shared'
import { RawSlots } from './componentSlots'
import { FunctionalComponent } from './component'
import {
  ComponentOptionsWithoutProps,
  ComponentOptionsWithArrayProps,
  ComponentOptionsWithObjectProps,
  ComponentOptions
} from './apiOptions'
import { ExtractPropTypes } from './componentProps'

// `h` is a more user-friendly version of `createVNode` that allows omitting the
// props when possible. It is intended for manually written render functions.
// Compiler-generated code uses `createVNode` because
// 1. it is monomorphic and avoids the extra call overhead
// 2. it allows specifying patchFlags for optimization

/*
// type only
h('div')

// type + props
h('div', {})

// type + omit props + children
// Omit props does NOT support named slots
h('div', []) // array
h('div', 'foo') // text
h('div', h('br')) // vnode
h(Component, () => {}) // default slot

// type + props + children
h('div', {}, []) // array
h('div', {}, 'foo') // text
h('div', {}, h('br')) // vnode
h(Component, {}, () => {}) // default slot
h(Component, {}, {}) // named slots

// named slots without props requires explicit `null` to avoid ambiguity
h(Component, null, {})
**/

type RawProps = VNodeProps & {
  // used to differ from a single VNode object as children
  _isVNode?: never
  // used to differ from Array children
  [Symbol.iterator]?: never
}

type RawChildren =
  | string
  | number
  | boolean
  | VNode
  | VNodeChildren
  | (() => any)

// fake constructor type returned from `createComponent`
interface Constructor<P = any> {
  __isFragment?: never
  __isPortal?: never
  __isSuspense?: never
  new (): { $props: P }
}

// The following is a series of overloads for providing props validation of
// manually written render functions.

// element
export function h(type: string, children?: RawChildren): VNode
export function h(
  type: string,
  props?: RawProps | null,
  children?: RawChildren
): VNode

// fragment
export function h(type: typeof Fragment, children?: VNodeChildren): VNode
export function h(
  type: typeof Fragment,
  props?: RawProps | null,
  children?: VNodeChildren
): VNode

// portal (target prop is required)
export function h(
  type: typeof Portal,
  props: RawProps & { target: any },
  children: RawChildren
): VNode

// suspense
export function h(type: typeof Suspense, children?: RawChildren): VNode
export function h(
  type: typeof Suspense,
  props?: (RawProps & SuspenseProps) | null,
  children?: RawChildren | RawSlots
): VNode

// functional component
export function h(type: FunctionalComponent, children?: RawChildren): VNode
export function h<P>(
  type: FunctionalComponent<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

// stateful component
export function h(type: ComponentOptions, children?: RawChildren): VNode
export function h(
  type: ComponentOptionsWithoutProps | ComponentOptionsWithArrayProps,
  props?: RawProps | null,
  children?: RawChildren | RawSlots
): VNode
export function h<O>(
  type: ComponentOptionsWithObjectProps<O>,
  props?:
    | (RawProps & ExtractPropTypes<O>)
    | ({} extends ExtractPropTypes<O> ? null : never),
  children?: RawChildren | RawSlots
): VNode

// fake constructor type returned by `createComponent`
export function h(type: Constructor, children?: RawChildren): VNode
export function h<P>(
  type: Constructor<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

// Actual implementation
// ! h 函数 -> 为了更好创建 VNode 的函数
export function h(type: any, propsOrChildren?: any, children?: any): VNode {
  // ! 如果只有两个参数时，判断第二个参数是 props 还是 children
  if (arguments.length === 2) {
    // ! 如果它是一个对象而不是数组，说明是 props
    if (isObject(propsOrChildren) && !isArray(propsOrChildren)) {
      // single vnode without props
      // ! 如果它是一个 VNode
      if (isVNode(propsOrChildren)) {
        return createVNode(type, null, [propsOrChildren]) // ! 把 VNode 作为到 children 的元素创建 VNode
      }
      // props without children
      return createVNode(type, propsOrChildren) // ! 通过 type 和 props 创建 VNode
    } else {
      // omit props
      // ! 其他情况，作为 children
      return createVNode(type, null, propsOrChildren) // ! 通过 type 和 children 创建 VNode，此时 props 是 null
    }
    // ! 有一个或者三个参数时，一般是三个参数
  } else {
    // ! 如果第三个参数是 VNode，把 VNode 作为到 children 的元素
    if (isVNode(children)) {
      children = [children]
    }
    return createVNode(type, propsOrChildren, children) // ! 通过 type props 和 children 创建 VNode
  }
}
