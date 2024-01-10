import Log, { IGroup, IHeader, ILogOptions } from './Log'
import isUndef from 'licia/isUndef'
import perfNow from 'licia/perfNow'
import now from 'licia/now'
import isStr from 'licia/isStr'
import extend from 'licia/extend'
import uniqId from 'licia/uniqId'
import isRegExp from 'licia/isRegExp'
import isFn from 'licia/isFn'
import $ from 'licia/$'
import Stack from 'licia/Stack'
import isEmpty from 'licia/isEmpty'
import contain from 'licia/contain'
import copy from 'licia/copy'
import each from 'licia/each'
import toArr from 'licia/toArr'
import keys from 'licia/keys'
import last from 'licia/last'
import throttle from 'licia/throttle'
import xpath from 'licia/xpath'
import lowerCase from 'licia/lowerCase'
import dateFormat from 'licia/dateFormat'
import isHidden from 'licia/isHidden'
import stripIndent from 'licia/stripIndent'
import ResizeSensor from 'licia/ResizeSensor'
import types from 'licia/types'
import isNull from 'licia/isNull'
import Component, { IComponentOptions } from './Component'
import raf from 'licia/raf'
import trim from 'licia/trim'
import { exportCjs } from './util'

const u = navigator.userAgent
const isAndroid = u.indexOf('Android') > -1 || u.indexOf('Adr') > -1

let id = 0

type InsertOptions = Partial<ILogOptions> & { type: string; args: any[] }
type AsyncItem = [
  string | InsertOptions,
  any[] | undefined,
  IHeader | undefined
]

/** IOptions */
export interface IOptions extends IComponentOptions {
  /** Max log number, zero means infinite. */
  maxNum?: number
  /** Asynchronous rendering. */
  asyncRender?: boolean
  /** Show time and from. */
  showHeader?: boolean
  /** Access getter value. */
  accessGetter?: boolean
  /** Show unenumerable properties. */
  unenumerable?: boolean
  /** Lazy evaluation for objects. */
  lazyEvaluation?: boolean
  /** Log filter. */
  filter?: string | RegExp | types.AnyFn
  /** Log level, verbose, info, warning and error. */
  level?: string | string[]
}

/**
 * Console for logging, similar to the one in chrome DevTools.
 * All these methods can be used in the same way as window.console object.
 * log, error, info, warn, dir, time/timeLog/timeEnd, clear, count/countReset, assert, table, group/groupCollapsed/groupEnd
 *
 * @example
 * const container = document.getElementById('container')
 * const console = new LunaConsole(container)
 * console.log('luna')
 */
export default class Console extends Component<IOptions> {
  renderViewport: (options?: any) => void
  private $el: $.$
  private el: HTMLElement
  private $fakeEl: $.$
  private fakeEl: HTMLElement
  private $space: $.$
  private space: HTMLElement
  private spaceHeight = 0
  private topSpaceHeight = 0
  // @ts-ignore
  private bottomSpaceHeight = 0
  private lastScrollTop = 0
  private lastTimestamp = 0
  private speedToleranceFactor = 100
  private maxSpeedTolerance = 2000
  private minSpeedTolerance = 100
  private logs: Log[] = []
  private displayLogs: Log[] = []
  private timer: { [key: string]: number } = {}
  private counter: { [key: string]: number } = {}
  private lastLog?: Log
  private asyncList: AsyncItem[] = []
  private asyncTimer: any = null
  private isAtBottom = true
  private groupStack = new Stack()
  private global: any
  private resizeSensor: ResizeSensor
  private selectedLog: Log | null = null
  constructor(container: HTMLElement, options: IOptions = {}) {
    super(container, { compName: 'console' }, options)

    this.initTpl()

    this.initOptions(options, {
      maxNum: 0,
      asyncRender: true,
      showHeader: false,
      filter: '',
      level: ['verbose', 'info', 'warning', 'error'],
      accessGetter: false,
      unenumerable: true,
      lazyEvaluation: true,
    })

    this.$el = this.find('.logs')
    this.el = this.$el.get(0) as HTMLElement
    this.$fakeEl = this.find('.fake-logs')
    this.fakeEl = this.$fakeEl.get(0) as HTMLElement
    this.$space = this.find('.logs-space')
    this.space = this.$space.get(0) as HTMLElement

    // For android slowing rendering
    if (isAndroid) {
      this.speedToleranceFactor = 800
      this.maxSpeedTolerance = 3000
      this.minSpeedTolerance = 800
    }

    this.resizeSensor = new ResizeSensor(container)

    this.renderViewport = throttle((options) => {
      this._renderViewport(options)
    }, 16)

    // https://developers.google.cn/web/tools/chrome-devtools/console/utilities
    this.global = {
      copy(value: string) {
        if (!isStr(value)) value = JSON.stringify(value, null, 2)
        copy(value)
      },
      $(selectors: string) {
        return document.querySelector(selectors)
      },
      $$(selectors: string) {
        return toArr(document.querySelectorAll(selectors))
      },
      $x(path: string) {
        return xpath(path)
      },
      clear: () => {
        this.clear()
      },
      dir: (value: any) => {
        this.dir(value)
      },
      table: (data: any, columns: any) => {
        this.table(data, columns)
      },
      keys,
    }

    this.bindEvent()
  }
  setGlobal(name: string, val: any) {
    this.global[name] = val
  }
  destroy() {
    this.$container.off('scroll', this.onScroll)
    this.resizeSensor.destroy()
    super.destroy()
  }
  count(label = 'default') {
    const { counter } = this

    !isUndef(counter[label]) ? counter[label]++ : (counter[label] = 1)

    this.info(`${label}: ${counter[label]}`)
  }
  countReset(label = 'default') {
    this.counter[label] = 0
  }
  assert(...args: any[]) {
    if (isEmpty(args)) return

    const exp = args.shift()

    if (!exp) {
      if (args.length === 0) args.unshift('console.assert')
      args.unshift('Assertion failed: ')
      this.insert('error', args)
    }
  }
  log(...args: any[]) {
    if (isEmpty(args)) return

    this.insert('log', args)
  }
  debug(...args: any[]) {
    if (isEmpty(args)) return

    this.insert('debug', args)
  }
  dir(obj: any) {
    if (isUndef(obj)) return

    this.insert('dir', [obj])
  }
  table(...args: any[]) {
    if (isEmpty(args)) return

    this.insert('table', args)
  }
  time(name = 'default') {
    if (this.timer[name]) {
      return this.insert('warn', [`Timer '${name}' already exists`])
    }
    this.timer[name] = perfNow()
  }
  timeLog(name = 'default') {
    const startTime = this.timer[name]

    if (!startTime) {
      return this.insert('warn', [`Timer '${name}' does not exist`])
    }

    this.info(`${name}: ${perfNow() - startTime}ms`)
  }
  timeEnd(name = 'default') {
    this.timeLog(name)

    delete this.timer[name]
  }
  clear(silent = false) {
    this.logs = []
    this.displayLogs = []
    this.selectLog(null)
    this.lastLog = undefined
    this.counter = {}
    this.timer = {}
    this.groupStack = new Stack()
    this.asyncList = []
    if (this.asyncTimer) {
      clearTimeout(this.asyncTimer)
      this.asyncTimer = null
    }

    if (silent) {
      this.render()
    } else {
      this.insert('log', [
        '%cConsole was cleared',
        'color:#808080;font-style:italic;',
      ])
    }
  }
  info(...args: any[]) {
    if (isEmpty(args)) return

    this.insert('info', args)
  }
  error(...args: any[]) {
    if (isEmpty(args)) return

    this.insert('error', args)
  }
  warn(...args: any[]) {
    if (isEmpty(args)) return

    this.insert('warn', args)
  }
  group(...args: any[]) {
    this.insert({
      type: 'group',
      args,
      ignoreFilter: true,
    })
  }
  groupCollapsed(...args: any[]) {
    this.insert({
      type: 'groupCollapsed',
      args,
      ignoreFilter: true,
    })
  }
  groupEnd() {
    this.insert('groupEnd')
  }
  /** Evaluate JavaScript. */
  evaluate(code: string) {
    this.insert({
      type: 'input',
      args: [code],
      ignoreFilter: true,
    })

    try {
      this.output(this.evalJs(code))
    } catch (e) {
      this.insert({
        type: 'error',
        ignoreFilter: true,
        args: [e],
      })
    }
  }
  /** Log out html content. */
  html(...args: any) {
    this.insert('html', args)
  }
  toggleGroup(log: Log) {
    const { targetGroup } = log
    ;(targetGroup as IGroup).collapsed
      ? this.openGroup(log)
      : this.collapseGroup(log)
  }
  private output(val: string) {
    this.insert({
      type: 'output',
      args: [val],
      ignoreFilter: true,
    })
  }
  private render() {
    const { logs, selectedLog } = this

    this.$el.html('')
    this.isAtBottom = true
    this.updateBottomSpace(0)
    this.updateTopSpace(0)
    this.displayLogs = []
    for (let i = 0, len = logs.length; i < len; i++) {
      this.attachLog(logs[i])
    }
    if (selectedLog) {
      if (!contain(this.displayLogs, selectedLog)) {
        this.selectLog(null)
      }
    }
  }
  private insert(type: string | InsertOptions, args?: any[]) {
    const { showHeader, asyncRender } = this.options

    let header
    if (showHeader) {
      header = {
        time: getCurTime(),
        from: getFrom(),
      }
    }

    if (asyncRender) {
      return this.insertAsync(type, args, header)
    }

    this.insertSync(type, args, header)
  }
  private insertAsync(
    type: string | InsertOptions,
    args?: any[],
    header?: IHeader
  ) {
    this.asyncList.push([type, args, header])

    this.handleAsyncList()
  }
  private insertSync(
    type: string | InsertOptions,
    args?: any[],
    header?: IHeader
  ) {
    const { logs, groupStack } = this
    const { maxNum, accessGetter, unenumerable, lazyEvaluation } = this.options

    let options: InsertOptions
    if (isStr(type)) {
      options = {
        type: type as string,
        args: args as any[],
        header,
      }
    } else {
      options = type as InsertOptions
    }

    // Because asynchronous rendering, groupEnd must be put here.
    if (options.type === 'groupEnd') {
      const lastLog = this.lastLog as Log
      lastLog.groupEnd()
      this.groupStack.pop()
      return
    }

    if (groupStack.size > 0) {
      options.group = groupStack.peek()
    }
    extend(options, {
      id: ++id,
      accessGetter,
      unenumerable,
      lazyEvaluation,
    })

    if (options.type === 'group' || options.type === 'groupCollapsed') {
      const group = {
        id: uniqId('group'),
        collapsed: false,
        parent: groupStack.peek(),
        indentLevel: groupStack.size + 1,
      }
      if (options.type === 'groupCollapsed') group.collapsed = true
      options.targetGroup = group
      groupStack.push(group)
    }

    let log = new Log(this, options as ILogOptions)
    log.on('updateHeight', () => {
      this.isAtBottom = false
      this.renderViewport()
    })

    const lastLog = this.lastLog
    if (
      lastLog &&
      !contain(['html', 'group', 'groupCollapsed'], log.type) &&
      lastLog.type === log.type &&
      log.isSimple() &&
      lastLog.text() === log.text()
    ) {
      lastLog.addCount()
      if (log.header) lastLog.updateTime(log.header.time)
      log = lastLog
      this.detachLog(lastLog)
    } else {
      logs.push(log)
      this.lastLog = log
    }

    if (maxNum !== 0 && logs.length > maxNum) {
      const firstLog = logs[0]
      this.detachLog(firstLog)
      logs.shift()
    }

    this.attachLog(log)

    this.emit('insert', log)
  }
  private updateTopSpace(height: number) {
    this.topSpaceHeight = height
    this.el.style.top = height + 'px'
  }
  private updateBottomSpace(height: number) {
    this.bottomSpaceHeight = height
  }
  private updateSpace(height: number) {
    if (this.spaceHeight === height) return
    this.spaceHeight = height
    this.space.style.height = height + 'px'
  }
  private detachLog(log: Log) {
    const { displayLogs } = this

    const idx = displayLogs.indexOf(log)
    if (idx > -1) {
      displayLogs.splice(idx, 1)
      this.renderViewport()
    }
  }
  // Binary search
  private attachLog(log: Log) {
    if (!this.filterLog(log) || log.collapsed) return

    const { displayLogs } = this

    if (displayLogs.length === 0) {
      displayLogs.push(log)
      this.renderViewport()
      return
    }

    const lastDisplayLog = last(displayLogs)
    if (log.id > lastDisplayLog.id) {
      displayLogs.push(log)
      this.renderViewport()
      return
    }

    let startIdx = 0
    let endIdx = displayLogs.length - 1

    let middleLog: any
    let middleIdx = 0

    while (startIdx <= endIdx) {
      middleIdx = startIdx + Math.floor((endIdx - startIdx) / 2)
      middleLog = displayLogs[middleIdx]

      if (middleLog.id === log.id) {
        return
      }

      if (middleLog.id < log.id) {
        startIdx = middleIdx + 1
      } else {
        endIdx = middleIdx - 1
      }
    }

    if (middleLog.id < log.id) {
      displayLogs.splice(middleIdx + 1, 0, log)
    } else {
      displayLogs.splice(middleIdx, 0, log)
    }

    this.renderViewport()
  }
  private handleAsyncList(timeout = 20) {
    const asyncList = this.asyncList

    if (this.asyncTimer) return

    this.asyncTimer = setTimeout(() => {
      this.asyncTimer = null
      let done = false
      const len = asyncList.length
      // insert faster if logs is huge, thus takes more time to render.
      let timeout: number, num
      if (len < 1000) {
        num = 200
        timeout = 400
      } else if (len < 5000) {
        num = 500
        timeout = 800
      } else if (len < 10000) {
        num = 800
        timeout = 1000
      } else if (len < 25000) {
        num = 1000
        timeout = 1200
      } else if (len < 50000) {
        num = 1500
        timeout = 1500
      } else {
        num = 2000
        timeout = 2500
      }
      if (num > len) {
        num = len
        done = true
      }
      for (let i = 0; i < num; i++) {
        const [type, args, header] = asyncList.shift() as AsyncItem
        this.insertSync(type, args, header)
      }
      if (!done) {
        raf(() => this.handleAsyncList(timeout))
      }
    }, timeout)
  }
  private injectGlobal() {
    each(this.global, (val, name) => {
      if (window[name]) return
      ;(window as any)[name] = val
    })
  }
  private clearGlobal() {
    each(this.global, (val, name) => {
      if (window[name] && window[name] === val) {
        delete window[name]
      }
    })
  }
  private evalJs(jsInput: string) {
    let ret

    this.injectGlobal()
    try {
      ret = eval.call(window, `(${jsInput})`)
    } catch (e) {
      ret = eval.call(window, jsInput)
    }
    this.setGlobal('$_', ret)
    this.clearGlobal()

    return ret
  }
  private filterLog(log: Log) {
    const { level } = this.options
    let { filter } = this.options

    if (log.ignoreFilter) {
      return true
    }

    if (!contain(level, log.level)) {
      return false
    }

    if (filter) {
      if (isFn(filter)) {
        return (filter as types.AnyFn)(log)
      } else if (isRegExp(filter)) {
        return (filter as RegExp).test(lowerCase(log.text()))
      } else if (isStr(filter)) {
        filter = trim(filter as string)
        if (filter) {
          return contain(lowerCase(log.text()), lowerCase(filter))
        }
      }
    }

    return true
  }
  private collapseGroup(log: Log) {
    const { targetGroup } = log
    ;(targetGroup as IGroup).collapsed = true
    log.updateIcon('caret-right')

    this.updateGroup(log)
  }
  private openGroup(log: Log) {
    const { targetGroup } = log
    ;(targetGroup as IGroup).collapsed = false
    log.updateIcon('caret-down')

    this.updateGroup(log)
  }
  private updateGroup(log: Log) {
    const { targetGroup } = log
    const { logs } = this
    const len = logs.length
    let i = logs.indexOf(log) + 1
    while (i < len) {
      const log = logs[i]
      if (!log.checkGroup() && log.group === targetGroup) {
        break
      }
      log.collapsed ? this.detachLog(log) : this.attachLog(log)
      i++
    }
  }
  private selectLog(log: Log | null) {
    if (this.selectedLog) {
      this.selectedLog.deselect()
      this.selectedLog = null
    }
    if (!isNull(log)) {
      this.selectedLog = log
      this.selectedLog?.select()
      this.emit('select', log)
    } else {
      this.emit('deselect')
    }
  }
  private bindEvent() {
    const { $el, c } = this

    this.resizeSensor.addListener(this.renderViewport)

    const self = this
    $el.on('click', c('.log-container'), function (this: any) {
      self.selectLog(this.log)
    })

    this.on('optionChange', (name, val) => {
      const { logs } = this
      switch (name) {
        case 'maxNum':
          if (val > 0 && logs.length > val) {
            this.logs = logs.slice(logs.length - (val as number))
            this.render()
          }
          break
        case 'filter':
          this.render()
          break
        case 'level':
          this.options.level = toArr(val)
          this.render()
          break
      }
    })

    this.$container.on('scroll', this.onScroll)
  }
  private onScroll = () => {
    const { scrollHeight, offsetHeight, scrollTop } = this
      .container as HTMLElement
    // safari bounce effect
    if (scrollTop <= 0) return
    if (offsetHeight + scrollTop > scrollHeight) return

    let isAtBottom = false
    if (scrollHeight === offsetHeight) {
      isAtBottom = true
    } else if (Math.abs(scrollHeight - offsetHeight - scrollTop) < 1) {
      isAtBottom = true
    }
    this.isAtBottom = isAtBottom

    const lastScrollTop = this.lastScrollTop
    const lastTimestamp = this.lastTimestamp

    const timestamp = now()
    const duration = timestamp - lastTimestamp
    const distance = scrollTop - lastScrollTop
    const speed = Math.abs(distance / duration)
    let speedTolerance = speed * this.speedToleranceFactor
    if (duration > 1000) {
      speedTolerance = 1000
    }
    if (speedTolerance > this.maxSpeedTolerance) {
      speedTolerance = this.maxSpeedTolerance
    }
    if (speedTolerance < this.minSpeedTolerance) {
      speedTolerance = this.minSpeedTolerance
    }
    this.lastScrollTop = scrollTop
    this.lastTimestamp = timestamp

    let topTolerance = 0
    let bottomTolerance = 0
    if (lastScrollTop < scrollTop) {
      topTolerance = this.minSpeedTolerance
      bottomTolerance = speedTolerance
    } else {
      topTolerance = speedTolerance
      bottomTolerance = this.minSpeedTolerance
    }

    if (
      this.topSpaceHeight < scrollTop - topTolerance &&
      this.topSpaceHeight + this.el.offsetHeight >
        scrollTop + offsetHeight + bottomTolerance
    ) {
      return
    }

    this.renderViewport({
      topTolerance: topTolerance * 2,
      bottomTolerance: bottomTolerance * 2,
    })
  }
  private _renderViewport({ topTolerance = 500, bottomTolerance = 500 } = {}) {
    const { el, container, space } = this
    if (isHidden(container)) return
    const { scrollTop, offsetHeight } = container as HTMLElement
    const containerWidth = space.getBoundingClientRect().width
    const top = scrollTop - topTolerance
    const bottom = scrollTop + offsetHeight + bottomTolerance

    const { displayLogs } = this

    let topSpaceHeight = 0
    let bottomSpaceHeight = 0
    let currentHeight = 0

    const len = displayLogs.length

    const { fakeEl } = this
    const fakeFrag = document.createDocumentFragment()
    const logs: Log[] = []
    for (let i = 0; i < len; i++) {
      const log = displayLogs[i]
      const { width, height } = log
      if (height === 0 || width !== containerWidth) {
        fakeFrag.appendChild(log.container)
        logs.push(log)
      }
    }
    if (logs.length > 0) {
      fakeEl.appendChild(fakeFrag)
      for (let i = 0, len = logs.length; i < len; i++) {
        logs[i].updateSize()
      }
      fakeEl.textContent = ''
    }

    const frag = document.createDocumentFragment()
    for (let i = 0; i < len; i++) {
      const log = displayLogs[i]
      const { container, height } = log

      if (currentHeight > bottom) {
        bottomSpaceHeight += height
      } else if (currentHeight + height > top) {
        frag.appendChild(container)
      } else if (currentHeight < top) {
        topSpaceHeight += height
      }

      currentHeight += height
    }

    this.updateSpace(currentHeight)
    this.updateTopSpace(topSpaceHeight)
    this.updateBottomSpace(bottomSpaceHeight)

    while (el.firstChild) {
      if (el.lastChild) {
        el.removeChild(el.lastChild)
      }
    }
    el.appendChild(frag)

    const { scrollHeight } = container
    if (this.isAtBottom && scrollTop <= scrollHeight - offsetHeight) {
      container.scrollTop = 10000000
    }
  }
  private initTpl() {
    this.$container.html(
      this.c(stripIndent`
      <div class="logs-space">
        <div class="fake-logs"></div>
        <div class="logs"></div>
      </div>
    `)
    )
  }
}

const getCurTime = () => dateFormat('HH:MM:ss ')

function getFrom() {
  const e = new Error()
  let ret = ''
  const lines = e.stack ? e.stack.split('\n') : ''

  for (let i = 0, len = lines.length; i < len; i++) {
    ret = lines[i]
    if (ret.indexOf('winConsole') > -1 && i < len - 1) {
      ret = lines[i + 1]
      break
    }
  }

  return ret
}
