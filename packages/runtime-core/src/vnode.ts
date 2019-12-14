import {
  isArray,
  isFunction,
  isString,
  isObject,
  EMPTY_ARR,
  extend
} from '@vue/shared'
import {
  ComponentInternalInstance,
  Data,
  SetupProxySymbol,
  Component
} from './component'
import { RawSlots } from './componentSlots'
import { ShapeFlags } from './shapeFlags'
import { isReactive, Ref } from '@vue/reactivity'
import { AppContext } from './apiApp'
import { SuspenseBoundary } from './components/Suspense'
import { DirectiveBinding } from './directives'
import { SuspenseImpl } from './components/Suspense'
import { TransitionHooks } from './components/BaseTransition'
import { warn } from './warning'

export const Fragment = (Symbol(__DEV__ ? 'Fragment' : undefined) as any) as {
  __isFragment: true
  new (): {
    $props: VNodeProps
  }
}
export const Portal = (Symbol(__DEV__ ? 'Portal' : undefined) as any) as {
  __isPortal: true
  new (): {
    $props: VNodeProps & { target: string | object }
  }
}
export const Text = Symbol(__DEV__ ? 'Text' : undefined)
export const Comment = Symbol(__DEV__ ? 'Comment' : undefined)

// ! VNode 类型
export type VNodeTypes =
  | string
  | Component
  | typeof Fragment
  | typeof Portal
  | typeof Text
  | typeof Comment
  | typeof SuspenseImpl

// ! VNode 属性
export interface VNodeProps {
  [key: string]: any
  key?: string | number
  ref?: string | Ref | ((ref: object | null) => void)

  // vnode hooks
  onVnodeBeforeMount?: (vnode: VNode) => void
  onVnodeMounted?: (vnode: VNode) => void
  onVnodeBeforeUpdate?: (vnode: VNode, oldVNode: VNode) => void
  onVnodeUpdated?: (vnode: VNode, oldVNode: VNode) => void
  onVnodeBeforeUnmount?: (vnode: VNode) => void
  onVnodeUnmounted?: (vnode: VNode) => void
}

// ! VNode 子节点原子
type VNodeChildAtom<HostNode, HostElement> =
  | VNode<HostNode, HostElement>
  | string
  | number
  | boolean
  | null
  | void

// ! VNode 子节点
export interface VNodeChildren<HostNode = any, HostElement = any>
  extends Array<
      | VNodeChildren<HostNode, HostElement>
      | VNodeChildAtom<HostNode, HostElement>
    > {}

// ! VNode 单个子节点
export type VNodeChild<HostNode = any, HostElement = any> =
  | VNodeChildAtom<HostNode, HostElement>
  | VNodeChildren<HostNode, HostElement>

// ! 规范化的子节点
export type NormalizedChildren<HostNode = any, HostElement = any> =
  | string
  | VNodeChildren<HostNode, HostElement>
  | RawSlots
  | null

// ! VNode 接口
export interface VNode<HostNode = any, HostElement = any> {
  _isVNode: true
  type: VNodeTypes
  props: VNodeProps | null
  key: string | number | null
  ref: string | Ref | ((ref: object | null) => void) | null
  children: NormalizedChildren<HostNode, HostElement>
  component: ComponentInternalInstance | null
  suspense: SuspenseBoundary<HostNode, HostElement> | null
  dirs: DirectiveBinding[] | null
  transition: TransitionHooks | null

  // DOM
  el: HostNode | null
  anchor: HostNode | null // fragment anchor
  target: HostElement | null // portal target

  // optimization only
  shapeFlag: number
  patchFlag: number
  dynamicProps: string[] | null
  dynamicChildren: VNode[] | null

  // application root node only
  appContext: AppContext | null
}

// Since v-if and v-for are the two possible ways node structure can dynamically
// change, once we consider v-if branches and each v-for fragment a block, we
// can divide a template into nested blocks, and within each block the node
// structure would be stable. This allows us to skip most children diffing
// and only worry about the dynamic nodes (indicated by patch flags).
const blockStack: (VNode[] | null)[] = []
let currentBlock: VNode[] | null = null

// Open a block.
// This must be called before `createBlock`. It cannot be part of `createBlock`
// because the children of the block are evaluated before `createBlock` itself
// is called. The generated code typically looks like this:
//
//   function render() {
//     return (openBlock(),createBlock('div', null, [...]))
//   }
//
// disableTracking is true when creating a fragment block, since a fragment
// always diffs its children.
export function openBlock(disableTracking?: boolean) {
  blockStack.push((currentBlock = disableTracking ? null : []))
}

// Whether we should be tracking dynamic child nodes inside a block.
// Only tracks when this value is > 0
// We are not using a simple boolean because this value may need to be
// incremented/decremented by nested usage of v-once (see below)
let shouldTrack = 1

// Block tracking sometimes needs to be disabled, for example during the
// creation of a tree that needs to be cached by v-once. The compiler generates
// code like this:
//   _cache[1] || (
//     setBlockTracking(-1),
//     _cache[1] = createVNode(...),
//     setBlockTracking(1),
//     _cache[1]
//   )
export function setBlockTracking(value: number) {
  shouldTrack += value
}

// Create a block root vnode. Takes the same exact arguments as `createVNode`.
// A block root keeps track of dynamic nodes within the block in the
// `dynamicChildren` array.
// ! 生成块 -> VNode
export function createBlock(
  type: VNodeTypes,
  props?: { [key: string]: any } | null,
  children?: any,
  patchFlag?: number,
  dynamicProps?: string[]
): VNode {
  // avoid a block with patchFlag tracking itself
  shouldTrack--
  const vnode = createVNode(type, props, children, patchFlag, dynamicProps)
  shouldTrack++
  // save current block children on the block vnode
  vnode.dynamicChildren = currentBlock || EMPTY_ARR
  // close block
  blockStack.pop()
  currentBlock = blockStack[blockStack.length - 1] || null
  // a block is always going to be patched, so track it as a child of its
  // parent block
  if (currentBlock !== null) {
    currentBlock.push(vnode)
  }
  return vnode
}

// ! 判断是否是 VNode
export function isVNode(value: any): value is VNode {
  return value ? value._isVNode === true : false
}

// ! 判断是否是相同的 VNode -> type 和 key 相同
export function isSameVNodeType(n1: VNode, n2: VNode): boolean {
  if (
    __BUNDLER__ &&
    __DEV__ &&
    n2.shapeFlag & ShapeFlags.COMPONENT &&
    (n2.type as Component).__hmrUpdated
  ) {
    // HMR only: if the component has been hot-updated, force a reload.
    return false
  }
  return n1.type === n2.type && n1.key === n2.key
}

// ! 创建 VNode
export function createVNode(
  type: VNodeTypes,
  props: (Data & VNodeProps) | null = null,
  children: unknown = null,
  patchFlag: number = 0,
  dynamicProps: string[] | null = null
): VNode {
  if (__DEV__ && !type) {
    warn(`Invalid vnode type when creating vnode: ${type}.`)
    type = Comment
  }

  // class & style normalization.
  if (props !== null) {
    // for reactive or proxy objects, we need to clone it to enable mutation.
    // ! 响应式对象或者代理对象需要克隆一份属性
    if (isReactive(props) || SetupProxySymbol in props) {
      props = extend({}, props)
    }
    let { class: klass, style } = props
    if (klass != null && !isString(klass)) {
      props.class = normalizeClass(klass) // ! 规范化 class
    }
    if (style != null) {
      // reactive state objects need to be cloned since they are likely to be
      // mutated
      if (isReactive(style) && !isArray(style)) {
        style = extend({}, style)
      }
      props.style = normalizeStyle(style) // ! 规范化 style
    }
  }

  // encode the vnode type information into a bitmap
  // ! 定义 shapeFlag 类型
  const shapeFlag = isString(type)
    ? ShapeFlags.ELEMENT
    : __FEATURE_SUSPENSE__ && (type as any).__isSuspense === true
      ? ShapeFlags.SUSPENSE
      : isObject(type)
        ? ShapeFlags.STATEFUL_COMPONENT
        : isFunction(type)
          ? ShapeFlags.FUNCTIONAL_COMPONENT
          : 0

  const vnode: VNode = {
    _isVNode: true,
    type,
    props,
    key: (props !== null && props.key) || null,
    ref: (props !== null && props.ref) || null,
    children: null,
    component: null,
    suspense: null,
    dirs: null,
    transition: null,
    el: null,
    anchor: null,
    target: null,
    shapeFlag,
    patchFlag,
    dynamicProps,
    dynamicChildren: null,
    appContext: null
  }

  normalizeChildren(vnode, children) // ! 规范化 children

  // presence of a patch flag indicates this node needs patching on updates.
  // component nodes also should always be patched, because even if the
  // component doesn't need to update, it needs to persist the instance on to
  // the next vnode so that it can be properly unmounted later.
  if (
    shouldTrack > 0 &&
    currentBlock !== null &&
    (patchFlag > 0 ||
      shapeFlag & ShapeFlags.STATEFUL_COMPONENT ||
      shapeFlag & ShapeFlags.FUNCTIONAL_COMPONENT)
  ) {
    currentBlock.push(vnode)
  }

  return vnode
}

// ! 克隆（可扩展属性） VNode
export function cloneVNode<T, U>(
  vnode: VNode<T, U>,
  extraProps?: Data & VNodeProps
): VNode<T, U> {
  // This is intentionally NOT using spread or extend to avoid the runtime
  // key enumeration cost.
  return {
    _isVNode: true,
    type: vnode.type,
    props: extraProps
      ? vnode.props
        ? mergeProps(vnode.props, extraProps)
        : extraProps
      : vnode.props,
    key: vnode.key,
    ref: vnode.ref,
    children: vnode.children,
    target: vnode.target,
    shapeFlag: vnode.shapeFlag,
    patchFlag: vnode.patchFlag,
    dynamicProps: vnode.dynamicProps,
    dynamicChildren: vnode.dynamicChildren,
    appContext: vnode.appContext,
    dirs: vnode.dirs,
    transition: vnode.transition,

    // These should technically only be non-null on mounted VNodes. However,
    // they *should* be copied for kept-alive vnodes. So we just always copy
    // them since them being non-null during a mount doesn't affect the logic as
    // they will simply be overwritten.
    component: vnode.component,
    suspense: vnode.suspense,
    el: vnode.el,
    anchor: vnode.anchor
  }
}

// ! 创建文本 VNode
export function createTextVNode(text: string = ' ', flag: number = 0): VNode {
  return createVNode(Text, null, text, flag)
}

// ! 创建注释 VNode
export function createCommentVNode(
  text: string = '',
  // when used as the v-else branch, the comment node must be created as a
  // block to ensure correct updates.
  asBlock: boolean = false
): VNode {
  return asBlock
    ? createBlock(Comment, null, text)
    : createVNode(Comment, null, text)
}

// ! 规范化 VNode -> 创建适当的 VNode
export function normalizeVNode<T, U>(child: VNodeChild<T, U>): VNode<T, U> {
  if (child == null) {
    // empty placeholder
    return createVNode(Comment) // ! 创建注释节点
  } else if (isArray(child)) {
    // fragment
    return createVNode(Fragment, null, child) // ! 创建 Fragment
  } else if (typeof child === 'object') {
    // already vnode, this should be the most common since compiled templates
    // always produce all-vnode children arrays
    return child.el === null ? child : cloneVNode(child) // ! 克隆节点
  } else {
    // primitive types
    return createVNode(Text, null, String(child)) // ! 创建文本节点
  }
}

// ! 规范化子 VNode
export function normalizeChildren(vnode: VNode, children: unknown) {
  let type = 0
  if (children == null) {
    children = null
  } else if (isArray(children)) {
    type = ShapeFlags.ARRAY_CHILDREN
  } else if (typeof children === 'object') {
    type = ShapeFlags.SLOTS_CHILDREN
  } else if (isFunction(children)) {
    children = { default: children } // ! 设置为 slot
    type = ShapeFlags.SLOTS_CHILDREN
  } else {
    children = String(children)
    type = ShapeFlags.TEXT_CHILDREN
  }
  vnode.children = children as NormalizedChildren
  vnode.shapeFlag |= type // ! 拼接类型
}

// ! 规范样式的方法
function normalizeStyle(
  value: unknown
): Record<string, string | number> | void {
  // ! 拆数组
  if (isArray(value)) {
    const res: Record<string, string | number> = {}
    for (let i = 0; i < value.length; i++) {
      const normalized = normalizeStyle(value[i])
      if (normalized) {
        for (const key in normalized) {
          res[key] = normalized[key]
        }
      }
    }
    return res
  } else if (isObject(value)) {
    return value
  }
}

// ! 规范类的方法
export function normalizeClass(value: unknown): string {
  let res = ''
  if (isString(value)) {
    res = value
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      res += normalizeClass(value[i]) + ' '
    }
  } else if (isObject(value)) {
    for (const name in value) {
      if (value[name]) {
        res += name + ' '
      }
    }
  }
  return res.trim()
}

const handlersRE = /^on|^vnode/

// ! 合并属性
export function mergeProps(...args: (Data & VNodeProps)[]) {
  const ret: Data = {}
  extend(ret, args[0])
  for (let i = 1; i < args.length; i++) {
    const toMerge = args[i]
    for (const key in toMerge) {
      if (key === 'class') {
        ret.class = normalizeClass([ret.class, toMerge.class]) // ! 合并类
      } else if (key === 'style') {
        ret.style = normalizeStyle([ret.style, toMerge.style]) // ! 合并样式
      } else if (handlersRE.test(key)) {
        // on*, vnode*
        const existing = ret[key]
        ret[key] = existing
          ? [].concat(existing as any, toMerge[key] as any) // ! 合并同类事件
          : toMerge[key]
      } else {
        ret[key] = toMerge[key] // ! 替换
      }
    }
  }
  return ret
}
