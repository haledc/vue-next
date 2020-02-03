import { isString } from '@vue/shared'
import { ForParseResult } from './transforms/vFor'
import {
  CREATE_VNODE,
  WITH_DIRECTIVES,
  RENDER_SLOT,
  CREATE_SLOTS,
  RENDER_LIST,
  OPEN_BLOCK,
  CREATE_BLOCK,
  FRAGMENT
} from './runtimeHelpers'
import { PropsExpression } from './transforms/transformElement'
import { ImportItem } from './transform'

// Vue template is a platform-agnostic superset of HTML (syntax only).
// More namespaces like SVG and MathML are declared by platform specific
// compilers.
export type Namespace = number

// ! 命名空间
export const enum Namespaces {
  HTML
}

// ! 节点类型
export const enum NodeTypes {
  ROOT,
  ELEMENT,
  TEXT,
  COMMENT,
  SIMPLE_EXPRESSION,
  INTERPOLATION,
  ATTRIBUTE,
  DIRECTIVE,
  // containers
  COMPOUND_EXPRESSION,
  IF,
  IF_BRANCH,
  FOR,
  TEXT_CALL,
  // codegen
  JS_CALL_EXPRESSION,
  JS_OBJECT_EXPRESSION,
  JS_PROPERTY,
  JS_ARRAY_EXPRESSION,
  JS_FUNCTION_EXPRESSION,
  JS_SEQUENCE_EXPRESSION,
  JS_CONDITIONAL_EXPRESSION,
  JS_CACHE_EXPRESSION,

  // ssr codegen
  JS_BLOCK_STATEMENT,
  JS_TEMPLATE_LITERAL,
  JS_IF_STATEMENT
}

// ! 元素类型
export const enum ElementTypes {
  ELEMENT,
  COMPONENT,
  SLOT,
  TEMPLATE
}

// ! 节点接口
export interface Node {
  type: NodeTypes
  loc: SourceLocation
}

// The node's range. The `start` is inclusive and `end` is exclusive.
// [start, end)
// ! 资源位置
export interface SourceLocation {
  start: Position
  end: Position
  source: string
}

// ! 解析的光标位置
export interface Position {
  offset: number // from start of file
  line: number
  column: number
}

// ! 父节点
export type ParentNode = RootNode | ElementNode | IfBranchNode | ForNode

// ! 表达式节点
export type ExpressionNode = SimpleExpressionNode | CompoundExpressionNode

// ! 模板子节点
export type TemplateChildNode =
  | ElementNode
  | InterpolationNode
  | CompoundExpressionNode
  | TextNode
  | CommentNode
  | IfNode
  | ForNode
  | TextCallNode

// ! 根节点
export interface RootNode extends Node {
  type: NodeTypes.ROOT
  children: TemplateChildNode[]
  helpers: symbol[]
  components: string[]
  directives: string[]
  hoists: JSChildNode[]
  imports: ImportItem[]
  cached: number
  codegenNode: TemplateChildNode | JSChildNode | BlockStatement | undefined
}

// ! 元素节点
export type ElementNode =
  | PlainElementNode
  | ComponentNode
  | SlotOutletNode
  | TemplateNode

// ! 基础元素节点
export interface BaseElementNode extends Node {
  type: NodeTypes.ELEMENT
  ns: Namespace
  tag: string
  tagType: ElementTypes
  isSelfClosing: boolean
  props: Array<AttributeNode | DirectiveNode>
  children: TemplateChildNode[]
  codegenNode:
    | CallExpression
    | SimpleExpressionNode
    | CacheExpression
    | SequenceExpression
    | undefined
}

// ! 普通元素节点
export interface PlainElementNode extends BaseElementNode {
  tagType: ElementTypes.ELEMENT
  codegenNode:
    | ElementCodegenNode
    | SimpleExpressionNode // when hoisted
    | CacheExpression // when cached by v-once
    | SequenceExpression // when turned into a block
    | undefined
  ssrCodegenNode?: TemplateLiteral
}

// ! 组件节点
export interface ComponentNode extends BaseElementNode {
  tagType: ElementTypes.COMPONENT
  codegenNode:
    | ComponentCodegenNode
    | CacheExpression // when cached by v-once
    | undefined
}

// ! 插槽节点
export interface SlotOutletNode extends BaseElementNode {
  tagType: ElementTypes.SLOT
  codegenNode: SlotOutletCodegenNode | undefined | CacheExpression // when cached by v-once
}

// ! 模板节点
export interface TemplateNode extends BaseElementNode {
  tagType: ElementTypes.TEMPLATE
  // TemplateNode is a container type that always gets compiled away
}

// ! 文件节点
export interface TextNode extends Node {
  type: NodeTypes.TEXT
  content: string
}

// ! 注释节点
export interface CommentNode extends Node {
  type: NodeTypes.COMMENT
  content: string
}

// ! 属性节点
export interface AttributeNode extends Node {
  type: NodeTypes.ATTRIBUTE
  name: string
  value: TextNode | undefined
}

// ! 子类节点
export interface DirectiveNode extends Node {
  type: NodeTypes.DIRECTIVE
  name: string
  exp: ExpressionNode | undefined
  arg: ExpressionNode | undefined
  modifiers: string[]
  // optional property to cache the expression parse result for v-for
  parseResult?: ForParseResult
}

// ! 简单表达式节点
export interface SimpleExpressionNode extends Node {
  type: NodeTypes.SIMPLE_EXPRESSION
  content: string
  isStatic: boolean
  isConstant: boolean
  // an expression parsed as the params of a function will track
  // the identifiers declared inside the function body.
  identifiers?: string[]
}

// ! 插值节点
export interface InterpolationNode extends Node {
  type: NodeTypes.INTERPOLATION
  content: ExpressionNode
}

// ! 混合表达式节点
export interface CompoundExpressionNode extends Node {
  type: NodeTypes.COMPOUND_EXPRESSION
  children: (
    | SimpleExpressionNode
    | InterpolationNode
    | TextNode
    | string
    | symbol)[]
  // an expression parsed as the params of a function will track
  // the identifiers declared inside the function body.
  identifiers?: string[]
}

// ! 条件节点
export interface IfNode extends Node {
  type: NodeTypes.IF
  branches: IfBranchNode[]
  codegenNode: IfCodegenNode
}

// ! 添加分支节点
export interface IfBranchNode extends Node {
  type: NodeTypes.IF_BRANCH
  condition: ExpressionNode | undefined // else
  children: TemplateChildNode[]
}

// ! 循环节点
export interface ForNode extends Node {
  type: NodeTypes.FOR
  source: ExpressionNode
  valueAlias: ExpressionNode | undefined
  keyAlias: ExpressionNode | undefined
  objectIndexAlias: ExpressionNode | undefined
  children: TemplateChildNode[]
  codegenNode: ForCodegenNode
}

// !
export interface TextCallNode extends Node {
  type: NodeTypes.TEXT_CALL
  content: TextNode | InterpolationNode | CompoundExpressionNode
  codegenNode: CallExpression
}

// JS Node Types ---------------------------------------------------------------

// We also include a number of JavaScript AST nodes for code generation.
// The AST is an intentionally minimal subset just to meet the exact needs of
// Vue render function generation.
export type JSChildNode =
  | CallExpression
  | ObjectExpression
  | ArrayExpression
  | ExpressionNode
  | FunctionExpression
  | ConditionalExpression
  | SequenceExpression
  | CacheExpression

// ! call 表达式
export interface CallExpression extends Node {
  type: NodeTypes.JS_CALL_EXPRESSION
  callee: string | symbol
  arguments: (
    | string
    | symbol
    | JSChildNode
    | SSRCodegenNode
    | TemplateChildNode
    | TemplateChildNode[])[]
}

// ! 对象表达式
export interface ObjectExpression extends Node {
  type: NodeTypes.JS_OBJECT_EXPRESSION
  properties: Array<Property>
}

// ! 属性接口
export interface Property extends Node {
  type: NodeTypes.JS_PROPERTY
  key: ExpressionNode
  value: JSChildNode
}

// ! 数组表达式
export interface ArrayExpression extends Node {
  type: NodeTypes.JS_ARRAY_EXPRESSION
  elements: Array<string | JSChildNode>
}

// ! 函数表达式
export interface FunctionExpression extends Node {
  type: NodeTypes.JS_FUNCTION_EXPRESSION
  params: ExpressionNode | ExpressionNode[] | undefined
  returns?: TemplateChildNode | TemplateChildNode[] | JSChildNode
  body?: BlockStatement
  newline: boolean
  // so that codegen knows it needs to generate ScopeId wrapper
  isSlot: boolean
}

// ! 顺序表达式
export interface SequenceExpression extends Node {
  type: NodeTypes.JS_SEQUENCE_EXPRESSION
  expressions: JSChildNode[]
}

// ! 条件表达式
export interface ConditionalExpression extends Node {
  type: NodeTypes.JS_CONDITIONAL_EXPRESSION
  test: ExpressionNode
  consequent: JSChildNode
  alternate: JSChildNode
}

// ! 缓存表达式
export interface CacheExpression extends Node {
  type: NodeTypes.JS_CACHE_EXPRESSION
  index: number
  value: JSChildNode
  isVNode: boolean
}

// SSR-specific Node Types -----------------------------------------------------

export type SSRCodegenNode = BlockStatement | TemplateLiteral | IfStatement

export interface BlockStatement extends Node {
  type: NodeTypes.JS_BLOCK_STATEMENT
  body: (JSChildNode | IfStatement)[]
}

export interface TemplateLiteral extends Node {
  type: NodeTypes.JS_TEMPLATE_LITERAL
  elements: (string | JSChildNode)[]
}

export interface IfStatement extends Node {
  type: NodeTypes.JS_IF_STATEMENT
  test: ExpressionNode
  consequent: BlockStatement
  alternate: IfStatement | BlockStatement | undefined
}

// Codegen Node Types ----------------------------------------------------------

// createVNode(...)
// ! 普通元素节点
export interface PlainElementCodegenNode extends CallExpression {
  callee: typeof CREATE_VNODE | typeof CREATE_BLOCK
  arguments:  // tag, props, children, patchFlag, dynamicProps
    | [string | symbol]
    | [string | symbol, PropsExpression]
    | [string | symbol, 'null' | PropsExpression, TemplateChildNode[]]
    | [
        string | symbol,
        'null' | PropsExpression,
        'null' | TemplateChildNode[],
        string
      ]
    | [
        string | symbol,
        'null' | PropsExpression,
        'null' | TemplateChildNode[],
        string,
        string
      ]
}

// ! 元素节点
export type ElementCodegenNode =
  | PlainElementCodegenNode
  | CodegenNodeWithDirective<PlainElementCodegenNode>

// createVNode(...)
// ! 普通组件节点
export interface PlainComponentCodegenNode extends CallExpression {
  callee: typeof CREATE_VNODE | typeof CREATE_BLOCK
  arguments:  // Comp, props, slots, patchFlag, dynamicProps
    | [string | symbol]
    | [string | symbol, PropsExpression]
    | [string | symbol, 'null' | PropsExpression, SlotsExpression]
    | [
        string | symbol,
        'null' | PropsExpression,
        'null' | SlotsExpression,
        string
      ]
    | [
        string | symbol,
        'null' | PropsExpression,
        'null' | SlotsExpression,
        string,
        string
      ]
}

// ! 组件节点
export type ComponentCodegenNode =
  | PlainComponentCodegenNode
  | CodegenNodeWithDirective<PlainComponentCodegenNode>

export type SlotsExpression = SlotsObjectExpression | DynamicSlotsExpression

// { foo: () => [...] }
// ! 插槽对象表达式
export interface SlotsObjectExpression extends ObjectExpression {
  properties: SlotsObjectProperty[]
}

// ! 插槽对象属性
export interface SlotsObjectProperty extends Property {
  value: SlotFunctionExpression
}

// ! 插槽函数表达式
export interface SlotFunctionExpression extends FunctionExpression {
  returns: TemplateChildNode[]
}

// createSlots({ ... }, [
//    foo ? () => [] : undefined,
//    renderList(list, i => () => [i])
// ])
// ! 动态作用域插槽表达式
export interface DynamicSlotsExpression extends CallExpression {
  callee: typeof CREATE_SLOTS
  arguments: [SlotsObjectExpression, DynamicSlotEntries]
}

// ! 动态作用域插槽入口
export interface DynamicSlotEntries extends ArrayExpression {
  elements: (ConditionalDynamicSlotNode | ListDynamicSlotNode)[]
}

// ! 条件作用域插槽
export interface ConditionalDynamicSlotNode extends ConditionalExpression {
  consequent: DynamicSlotNode
  alternate: DynamicSlotNode | SimpleExpressionNode
}

// ! 动态作用域插槽列表
export interface ListDynamicSlotNode extends CallExpression {
  callee: typeof RENDER_LIST
  arguments: [ExpressionNode, ListDynamicSlotIterator]
}

export interface ListDynamicSlotIterator extends FunctionExpression {
  returns: DynamicSlotNode
}

// ! 动态插槽节点
export interface DynamicSlotNode extends ObjectExpression {
  properties: [Property, DynamicSlotFnProperty]
}

export interface DynamicSlotFnProperty extends Property {
  value: SlotFunctionExpression
}

// withDirectives(createVNode(...), [
//    [_directive_foo, someValue],
//    [_directive_bar, someValue, "arg", { mod: true }]
// ])
export interface CodegenNodeWithDirective<T extends CallExpression>
  extends CallExpression {
  callee: typeof WITH_DIRECTIVES
  arguments: [T, DirectiveArguments]
}

export interface DirectiveArguments extends ArrayExpression {
  elements: DirectiveArgumentNode[]
}

export interface DirectiveArgumentNode extends ArrayExpression {
  elements:  // dir, exp, arg, modifiers
    | [string]
    | [string, ExpressionNode]
    | [string, ExpressionNode, ExpressionNode]
    | [string, ExpressionNode, ExpressionNode, ObjectExpression]
}

// renderSlot(...)
export interface SlotOutletCodegenNode extends CallExpression {
  callee: typeof RENDER_SLOT
  arguments:  // $slots, name, props, fallback
    | [string, string | ExpressionNode]
    | [string, string | ExpressionNode, PropsExpression]
    | [
        string,
        string | ExpressionNode,
        PropsExpression | '{}',
        TemplateChildNode[]
      ]
}

export type BlockCodegenNode =
  | ElementCodegenNode
  | ComponentCodegenNode
  | SlotOutletCodegenNode

export interface IfCodegenNode extends SequenceExpression {
  expressions: [OpenBlockExpression, IfConditionalExpression]
}

export interface IfConditionalExpression extends ConditionalExpression {
  consequent: BlockCodegenNode
  alternate: BlockCodegenNode | IfConditionalExpression
}

export interface ForCodegenNode extends SequenceExpression {
  expressions: [OpenBlockExpression, ForBlockCodegenNode]
}

export interface ForBlockCodegenNode extends CallExpression {
  callee: typeof CREATE_BLOCK
  arguments: [typeof FRAGMENT, 'null', ForRenderListExpression, string]
}

export interface ForRenderListExpression extends CallExpression {
  callee: typeof RENDER_LIST
  arguments: [ExpressionNode, ForIteratorExpression]
}

export interface ForIteratorExpression extends FunctionExpression {
  returns: BlockCodegenNode
}

export interface OpenBlockExpression extends CallExpression {
  callee: typeof OPEN_BLOCK
  arguments: []
}

// AST Utilities ---------------------------------------------------------------

// Some expressions, e.g. sequence and conditional expressions, are never
// associated with template nodes, so their source locations are just a stub.
// Container types like CompoundExpression also don't need a real location.
export const locStub: SourceLocation = {
  source: '',
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 }
}

export function createArrayExpression(
  elements: ArrayExpression['elements'],
  loc: SourceLocation = locStub
): ArrayExpression {
  return {
    type: NodeTypes.JS_ARRAY_EXPRESSION,
    loc,
    elements
  }
}

export function createObjectExpression(
  properties: ObjectExpression['properties'],
  loc: SourceLocation = locStub
): ObjectExpression {
  return {
    type: NodeTypes.JS_OBJECT_EXPRESSION,
    loc,
    properties
  }
}

export function createObjectProperty(
  key: Property['key'] | string,
  value: Property['value']
): Property {
  return {
    type: NodeTypes.JS_PROPERTY,
    loc: locStub,
    key: isString(key) ? createSimpleExpression(key, true) : key,
    value
  }
}

export function createSimpleExpression(
  content: SimpleExpressionNode['content'],
  isStatic: SimpleExpressionNode['isStatic'],
  loc: SourceLocation = locStub,
  isConstant: boolean = false
): SimpleExpressionNode {
  return {
    type: NodeTypes.SIMPLE_EXPRESSION,
    loc,
    isConstant,
    content,
    isStatic
  }
}

export function createInterpolation(
  content: InterpolationNode['content'] | string,
  loc: SourceLocation
): InterpolationNode {
  return {
    type: NodeTypes.INTERPOLATION,
    loc,
    content: isString(content)
      ? createSimpleExpression(content, false, loc)
      : content
  }
}

export function createCompoundExpression(
  children: CompoundExpressionNode['children'],
  loc: SourceLocation = locStub
): CompoundExpressionNode {
  return {
    type: NodeTypes.COMPOUND_EXPRESSION,
    loc,
    children
  }
}

type InferCodegenNodeType<T> = T extends
  | typeof CREATE_VNODE
  | typeof CREATE_BLOCK
  ? PlainElementCodegenNode | PlainComponentCodegenNode
  : T extends typeof WITH_DIRECTIVES
    ?
        | CodegenNodeWithDirective<PlainElementCodegenNode>
        | CodegenNodeWithDirective<PlainComponentCodegenNode>
    : T extends typeof RENDER_SLOT ? SlotOutletCodegenNode : CallExpression

export function createCallExpression<T extends CallExpression['callee']>(
  callee: T,
  args: CallExpression['arguments'] = [],
  loc: SourceLocation = locStub
): InferCodegenNodeType<T> {
  return {
    type: NodeTypes.JS_CALL_EXPRESSION,
    loc,
    callee,
    arguments: args
  } as any
}

export function createFunctionExpression(
  params: FunctionExpression['params'],
  returns: FunctionExpression['returns'],
  newline: boolean = false,
  isSlot: boolean = false,
  loc: SourceLocation = locStub
): FunctionExpression {
  return {
    type: NodeTypes.JS_FUNCTION_EXPRESSION,
    params,
    returns,
    newline,
    isSlot,
    loc
  }
}

export function createSequenceExpression(
  expressions: SequenceExpression['expressions']
): SequenceExpression {
  return {
    type: NodeTypes.JS_SEQUENCE_EXPRESSION,
    expressions,
    loc: locStub
  }
}

export function createConditionalExpression(
  test: ConditionalExpression['test'],
  consequent: ConditionalExpression['consequent'],
  alternate: ConditionalExpression['alternate']
): ConditionalExpression {
  return {
    type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
    test,
    consequent,
    alternate,
    loc: locStub
  }
}

export function createCacheExpression(
  index: number,
  value: JSChildNode,
  isVNode: boolean = false
): CacheExpression {
  return {
    type: NodeTypes.JS_CACHE_EXPRESSION,
    index,
    value,
    isVNode,
    loc: locStub
  }
}

export function createBlockStatement(
  body: BlockStatement['body']
): BlockStatement {
  return {
    type: NodeTypes.JS_BLOCK_STATEMENT,
    body,
    loc: locStub
  }
}

export function createTemplateLiteral(
  elements: TemplateLiteral['elements']
): TemplateLiteral {
  return {
    type: NodeTypes.JS_TEMPLATE_LITERAL,
    elements,
    loc: locStub
  }
}

export function createIfStatement(
  test: IfStatement['test'],
  consequent: IfStatement['consequent'],
  alternate?: IfStatement['alternate']
): IfStatement {
  return {
    type: NodeTypes.JS_IF_STATEMENT,
    test,
    consequent,
    alternate,
    loc: locStub
  }
}
