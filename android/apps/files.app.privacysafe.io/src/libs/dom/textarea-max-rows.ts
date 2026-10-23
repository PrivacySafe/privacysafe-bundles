function createElement(tagName: string, attributes: string[]) {
  const element = document.createElement(tagName)

  for (const [key, value] of Object.entries(attributes)) {
    if (value) {
      element.setAttribute(key, value)
    }
  }

  return element
}

function shapeElement(element: HTMLElement, attributes: string[]) {
  for (const [key, value] of Object.entries(attributes)) {
    if (value) {
      element.setAttribute(key, value)
    }
  }

  return element
}

function moveElementOffscreen(element: HTMLElement) {
  const move = () => {
    element.style.position = 'absolute'
    element.style.left = `-${document.body.clientWidth * 2}px`
  }

  move()
  window.addEventListener('resize', move)

  return element
}

function syncWidthFrom(newElement: HTMLElement, existingElement: HTMLElement) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const resizeObserver = new ResizeObserver(([entry], _observer) => {
    const width = (entry.target as HTMLElement).offsetWidth
    newElement.style.width = `${width}px`
  })

  resizeObserver.observe(existingElement)
  return resizeObserver
}

function insertAfter(newNode: Node, existingNode: Node) {
  existingNode.parentNode?.insertBefore(newNode, existingNode.nextSibling)
}

export function patchTextareaMaxRowsSupport(element: HTMLElement, { shadowElement = null } = {}) {
  const attrClass = element.getAttribute('class')
  const attrStyle = element.getAttribute('style')
  const attrRows = element.getAttribute('rows') || 1
  const attrMaxRows = element.getAttribute('max-rows')

  // @ts-ignore
  const minRows = Number.parseInt(attrRows)
  // @ts-ignore
  const maxRows = Number.parseInt(attrMaxRows)

  const shouldInsertShadowElement = !shadowElement

  const attributes = {
    class: attrClass,
    style: `box-sizing: border-box !important; ${attrStyle}`,
    rows: attrRows,
    'max-rows': attrMaxRows,
  }

  if (shadowElement) {
    // @ts-ignore
    shadowElement = shapeElement(shadowElement, attributes)
  } else {
    // @ts-ignore
    shadowElement = createElement('textarea', attributes)
  }

  // @ts-ignore
  moveElementOffscreen(shadowElement)
  // @ts-ignore
  syncWidthFrom(shadowElement, element)
  if (shouldInsertShadowElement) {
    // @ts-ignore
    insertAfter(shadowElement, element)
  }

  function syncRows() {
    // copy the content from the real textarea
    // @ts-ignore
    shadowElement.value = element.value

    // get the height of content
    // @ts-ignore
    shadowElement.setAttribute('rows', 1)
    // @ts-ignore
    const contentHeight = shadowElement.scrollHeight

    // increase the number of rows until finding a proper number.
    for (let rows = minRows; rows <= maxRows; rows++) {
      // @ts-ignore
      shadowElement.setAttribute('rows', rows)

      // @ts-ignore
      if (shadowElement.clientHeight >= contentHeight) {
        break
      }
    }

    const oldRows = element.getAttribute('rows')
    // @ts-ignore
    const newRows = shadowElement.getAttribute('rows')
    element.setAttribute('rows', newRows)

    if (oldRows !== newRows) {
      const event = new CustomEvent('rows-change', {
        detail: { rows: Number.parseInt(newRows) },
      })
      element.dispatchEvent(event)
    }
  }

  element.addEventListener('input', () => {
    syncRows()
  })

  // override original getter and setter in order to call syncRows() when the value is set by JavaScript.
  // @ts-ignore
  const { get, set } = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
  Object.defineProperty(element, 'value', {
    get() {
      return get.call(this)
    },
    set(value) {
      set.call(this, value)

      const event = new CustomEvent('value-change', {
        detail: { value: value },
      })
      element.dispatchEvent(event)

      syncRows()
    },
  })
}
