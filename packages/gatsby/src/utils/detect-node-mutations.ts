import type { IGatsbyNode } from "../redux/types"
import reporter from "gatsby-cli/lib/reporter"

const reported = new Set<string>()

const genericProxy = createProxyHandler()
const nodeInternalProxy = createProxyHandler({
  onGet(key, value) {
    if (key === `fieldOwners` || key === `content`) {
      // all allowed in here
      return value
    }
    return undefined
  },
  onSet(target, key, value) {
    if (key === `fieldOwners` || key === `content`) {
      target[key] = value
      return true
    }
    return undefined
  },
})

const nodeProxy = createProxyHandler({
  onGet(key, value) {
    if (key === `internal`) {
      return memoizedProxy(value, nodeInternalProxy)
    } else if (
      key === `__gatsby_resolved` ||
      key === `fields` ||
      key === `children`
    ) {
      // all allowed in here
      return value
    }
    return undefined
  },
  onSet(target, key, value) {
    if (key === `__gatsby_resolved` || key === `fields` || key === `children`) {
      target[key] = value
      return true
    }
    return undefined
  },
})

const referenceMap = new WeakMap<any, any>()
function memoizedProxy(target, handler): any {
  const alreadyWrapped = referenceMap.get(target)
  if (alreadyWrapped) {
    return alreadyWrapped
  } else {
    const wrapped = new Proxy(target, handler)
    referenceMap.set(target, wrapped)
    return wrapped
  }
}

function createProxyHandler({
  onGet,
  onSet,
}: {
  onGet?: (key: string | symbol, value: any) => any
  onSet?: (target: any, key: string | symbol, value: any) => boolean | undefined
} = {}): ProxyHandler<any> {
  return {
    get: function (target, key): any {
      const value = target[key]

      if (onGet) {
        const result = onGet(key, value)
        if (result !== undefined) {
          return result
        }
      }

      const fieldDescriptor = Object.getOwnPropertyDescriptor(target, key)
      if (fieldDescriptor && !fieldDescriptor.writable) {
        // this is to prevent errors like:
        // ```
        // TypeError: 'get' on proxy: property 'constants' is a read - only and
        // non - configurable data property on the proxy target but the proxy
        // did not return its actual value
        // (expected '[object Object]' but got '[object Object]')
        // ```
        return value
      }

      if (typeof value === `object` && value !== null) {
        return memoizedProxy(value, genericProxy)
      }

      return value
    },
    set: function (target, key, value): boolean {
      if (onSet) {
        const result = onSet(target, key, value)
        if (result !== undefined) {
          return result
        }
      }

      const error = new Error(
        `Mutating nodes is a no no, please use createNode, createNodeField and/or createParentChildLink`
      )

      if (process.env.GATSBY_NODE_MUTATION_THROW) {
        throw error
      }

      if (!error.stack) {
        throw new Error(`No stack!`)
      } else if (!reported.has(error.stack)) {
        reporter.error(error)
        reported.add(error.stack)
      }
      return true
    },
  }
}

const shouldWrap = process.env.GATSBY_DIAGNOSTICS
if (!process.env.GATSBY_WORKER_MODULE_PATH) {
  console.log(
    `NODE MUTATION DETECTION1: ${shouldWrap ? `ENABLED` : `DISABLED`}`
  )
}

export function wrapNode(node: IGatsbyNode): IGatsbyNode {
  if (shouldWrap) {
    return memoizedProxy(node, nodeProxy)
  } else {
    return node
  }
}
