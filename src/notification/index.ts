import './style.scss'
import $ from 'licia/$'
import stripIndent from 'licia/stripIndent'
import uniqId from 'licia/uniqId'
import find from 'licia/find'

interface IPosition {
  x: string
  y: string
}

class Notification {
  private $container: $.$
  private $notification: $.$
  private notifications: NotificationItem[] = []
  private duration: number
  position: IPosition
  constructor(
    container: Element,
    {
      position = {
        x: 'right',
        y: 'bottom'
      },
      duration = 2000
    } = {}
  ) {
    this.$container = $(container)
    this.position = position
    this.duration = duration

    this.appendTpl()
  }
  notify(content: string, { duration = this.duration } = {}) {
    const notification = new NotificationItem(this, content)
    this.notifications.push(notification)
    this.add(notification)
    if (duration) {
      setTimeout(() => this.remove(notification.id), duration)
    }
  }
  dismissAll() {
    const { notifications } = this
    let notification = notifications[0]
    while (notification) {
      this.remove(notification.id)
      notification = notifications[0]
    }
  }
  private add(notification: NotificationItem) {
    this.$notification.append(notification.html())
  }
  private remove(id: string) {
    const { notifications } = this
    const notification = find(
      notifications,
      notification => notification.id === id
    )
    if (!notification) return
    this.$notification.find('#' + id).remove()
    const idx = notifications.indexOf(notification)
    notifications.splice(idx, 1)
  }
  private appendTpl() {
    const { $container } = this
    const { x, y } = this.position

    let justifyContent = 'flex-end'
    let alignItems = 'flex-end'
    switch (x) {
      case 'center':
        alignItems = 'center'
        break
      case 'left':
        alignItems = 'flex-start'
        break
    }
    if (y === 'top') justifyContent = 'flex-start'

    $container.append(stripIndent`
      <div class="luna-notification" style="justify-content: ${justifyContent}; align-items: ${alignItems}"></div>
    `)
    this.$notification = $container.find('.luna-notification')
  }
}

class NotificationItem {
  private container: Notification
  private content: string
  id: string
  constructor(container: Notification, content: string) {
    this.container = container
    this.content = content
    this.id = uniqId('luna-notification-')
  }
  html() {
    const { y } = this.container.position

    return stripIndent`
      <div id="${this.id}" class="luna-notification-item luna-notification-${
      y === 'bottom' ? 'lower' : 'upper'
    }">
        <div class="luna-notification-content">${this.content}</div>
      </div>
    `
  }
}

module.exports = Notification